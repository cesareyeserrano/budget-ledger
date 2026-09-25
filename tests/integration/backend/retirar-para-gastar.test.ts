/**
 * Feature retirar-para-gastar — lado servidor contra Postgres efímero (Testcontainers).
 *
 * Módulo:       tests/integration/backend/retirar-para-gastar.test.ts
 * Propósito:    El guardia del servidor aplica la MISMA regla neta que el navegador (FR-2807), el ledger
 *               viaja por la base sin cambios (FR-2806), los meses cerrados siguen congelados (NFR-2804)
 *               y un descuadre sigue bloqueando el cierre (NFR-2808).
 * Dependencias: rutas reales PUT/GET /api/v1/ledger, POST /api/v1/movements, POST/DELETE /api/v1/closure.
 *
 * Los estados se construyen con el dominio (applyReserveOp) y se siembran por la ruta real. Ingresos y
 * gastos llevan su movimiento detrás: el servidor rechaza una escritura que descuadre (NFR-2502).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger } from "@/server/data/ledgerRepo";
import { AVAILABLE_ID as D, applyReserveOp, applyReserveCellEdit, monthIssues } from "@/domain/reserve";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as movsPOST } from "@/app/api/v1/movements/route";
import { POST as closurePOST, DELETE as closureDELETE } from "@/app/api/v1/closure/route";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";
import { P } from "../../helpers/periods";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
const ENE = "2026-01" as PeriodKey;
const JUN = "2026-06" as PeriodKey;
const HOY = "2026-07-05";

let ipCounter = 0;
const nextIp = () => `10.28.${Math.floor((++ipCounter) / 250)}.${ipCounter % 250}`;

async function newUser(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { cookie, userId };
}

function req(url: string, init: { method?: string; cookie?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const putLedger = (cookie: string, baseRevision: number, state: LedgerState) =>
  ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, body: { baseRevision, state } }));
const cerrar = (cookie: string, baseRevision: number) =>
  closurePOST(req("/api/v1/closure", { method: "POST", cookie, body: { baseRevision } }));
const reabrir = (cookie: string, baseRevision: number) =>
  closureDELETE(req("/api/v1/closure", { method: "DELETE", cookie, body: { baseRevision } }));
const revisionDe = async (userId: string) => (await loadLedger(userId))!.revision;
const persistido = async (userId: string) => (await loadLedger(userId))!.state;

// ── Estados ──────────────────────────────────────────────────────────────────────────────────────

function nodos(ownerId: string): LedgerNode[] {
  return [
    { id: "g-i", ownerId, type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
    { id: "ing", ownerId, type: "income", level: "category", parentId: "g-i", name: "Sueldo", icon: null, order: 1 },
    { id: "g-e", ownerId, type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
    { id: "gas", ownerId, type: "expense", level: "category", parentId: "g-e", name: "Mercado", icon: null, order: 3 },
    { id: "g-t", ownerId, type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 4 },
    { id: "A", ownerId, type: "transfer", level: "category", parentId: "g-t", name: "Ahorro", icon: null, order: 5 },
  ];
}

/** Un movimiento de ingreso o gasto con su celda cuadrada: el servidor no acepta celdas sin respaldo. */
function flujo(s: LedgerState, catId: "ing" | "gas", period: PeriodKey, amount: number): LedgerState {
  const m: Movement = { id: `m-${catId}-${period}-${amount}`, ownerId: s.ownerId, type: catId === "ing" ? "income" : "expense",
    catId, subId: null, target: catId, amount, period, createdAt: 1, date: `${period}-02` } as Movement;
  const celda = (s.actuals[catId]?.[period] ?? 0) + amount;
  return { ...s, actuals: { ...s.actuals, [catId]: { ...(s.actuals[catId] ?? {}), [period]: celda } }, movements: [...s.movements, m] };
}
function op(s: LedgerState, from: string, to: string, period: PeriodKey, amount: number): LedgerState {
  const r = applyReserveOp(s, { from, to, period, amount, date: `${period}-15` }, P);
  if (!("state" in r)) return expect.fail(`rechazada en el dominio: ${JSON.stringify(r.rejected)}`);
  return r.state;
}
const vacio = (ownerId: string) => ({ ownerId, nodes: nodos(ownerId), budgets: {}, actuals: {}, movements: [] } as LedgerState);

/** Junio: ingreso 1.000 y 1.000 reservados en A (disponible 0). */
const junioReservado = (u: string) => op(flujo(vacio(u), "ing", JUN, 1000), D, "A", JUN, 1000);

/**
 * Siembra «junio con gasto sin cubrir» en DOS escrituras: primero la reserva (disponible 0), después el
 * gasto. El gasto no toca reservas, así que el guardia no lo juzga (NFR-1803); sembrarlo todo de golpe
 * se rechazaría con razón, porque introduciría un mes en déficit.
 */
async function sembrarJunioConGasto(cookie: string, userId: string): Promise<LedgerState> {
  const r1 = await putLedger(cookie, 0, junioReservado(userId));
  expect(r1.status).toBe(200);
  const conGasto = flujo(await persistido(userId), "gas", JUN, 300);
  const r2 = await putLedger(cookie, await revisionDe(userId), conGasto);
  expect(r2.status).toBe(200);
  return persistido(userId);
}

/** Plata fresca: ingreso 1.400, gasto 300, 1.000 reservados y 300 sacados (disponible 400). */
function plataFresca(u: string): LedgerState {
  let s = junioReservado(u);
  s = flujo(flujo(s, "gas", JUN, 300), "ing", JUN, 400);
  return op(s, "A", D, JUN, 300);
}

const celdaA = (s: LedgerState, p: PeriodKey, v: number): LedgerState =>
  ({ ...s, actuals: { ...s.actuals, A: { ...(s.actuals.A ?? {}), [p]: v } } });

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = HOY;
});
afterAll(async () => {
  delete process.env.LEDGER_TODAY;
  await closeTestDb();
});

// ══ FR-2806 · el ledger viaja por la base sin cambios ═══════════════════════════════════════════

describe("FR-2806 · ida y vuelta por la base", () => {
  /** @aitri-trace FR-ID: FR-2806, US-ID: US-2806, AC-ID: AC-2815, TC-ID: TC-RPG-063e */
  it("TC-RPG-063e: ida y vuelta por la base: el ledger se guarda y se lee idéntico y sin marca", async () => {
    // @aitri-tc TC-RPG-063e
    const { cookie, userId } = await newUser("rpg-063@example.com");
    const enviado = await sembrarJunioConGasto(cookie, userId);
    const ciclo = op(enviado, "A", D, JUN, 300);
    expect((await putLedger(cookie, await revisionDe(userId), ciclo)).status).toBe(200);

    const res = await ledgerGET(req("/api/v1/ledger", { cookie }));
    expect(res.status).toBe(200);
    const { state } = (await res.json()) as { state: LedgerState };
    expect(state.actuals).toEqual(ciclo.actuals);
    const firma = (s: LedgerState) => s.movements.map((m) => `${m.id}|${m.type}|${m.amount}|${m.period}|${m.from ?? ""}|${m.to ?? ""}`).sort();
    expect(firma(state)).toEqual(firma(ciclo));
    const filas = await testDb().execute(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${userId}`);
    expect(([...filas][0] as { n: number }).n).toBe(ciclo.movements.length);
    expect(monthIssues(state, P).filter((i) => i.kind === "techo")).toEqual([]);
  });
});

// ══ FR-2807 · el servidor aplica la regla neta ══════════════════════════════════════════════════

describe("FR-2807 · el servidor acepta y rechaza lo mismo que el navegador", () => {
  /** @aitri-trace FR-ID: FR-2807, US-ID: US-2807, AC-ID: AC-2817, TC-ID: TC-RPG-071h */
  it("TC-RPG-071h: PUT con el retiro para cubrir el gasto responde 200 y lo persiste", async () => {
    // @aitri-tc TC-RPG-071h
    const { cookie, userId } = await newUser("rpg-071@example.com");
    const base = await sembrarJunioConGasto(cookie, userId);
    const res = await putLedger(cookie, await revisionDe(userId), op(base, "A", D, JUN, 300));
    expect(res.status).toBe(200);
    const r = await testDb().execute(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${userId}
      AND from_id = 'A' AND to_id = ${D} AND amount = 300 AND period = ${JUN}`);
    expect(([...r][0] as { n: number }).n).toBe(1);
  });

  /** @aitri-trace FR-ID: FR-2807, US-ID: US-2807, AC-ID: AC-2818, TC-ID: TC-RPG-072f */
  it("TC-RPG-072f: PUT que reserva 401 con disponible 400 responde 422 y no persiste", async () => {
    // @aitri-tc TC-RPG-072f
    const { cookie, userId } = await newUser("rpg-072@example.com");
    expect((await putLedger(cookie, 0, plataFresca(userId))).status).toBe(200);
    const rev = await revisionDe(userId);
    const res = await putLedger(cookie, rev, celdaA(await persistido(userId), JUN, 1401));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; detail: { violations: unknown[] } } };
    expect(body.error.code).toBe("domain_rule_violation");
    expect(body.error.detail.violations[0]).toMatchObject({ rule: "techo", period: JUN, limit: 400 });
    expect(await revisionDe(userId)).toBe(rev);
    expect((await persistido(userId)).actuals.A[JUN]).toBe(1000);
  });

  /** @aitri-trace FR-ID: FR-2807, US-ID: US-2807, AC-ID: AC-2819, TC-ID: TC-RPG-073f */
  it("TC-RPG-073f: PUT que borra el retiro del encierro responde 422", async () => {
    // @aitri-tc TC-RPG-073f
    const { cookie, userId } = await newUser("rpg-073@example.com");
    let s = op(op(flujo(vacio(userId), "ing", ENE, 1000), D, "A", ENE, 1000), "A", D, ENE, 500);
    const e = applyReserveCellEdit(s, { leafId: "A", period: ENE, plane: "actual", newAmount: 1500 }, P);
    if (!("state" in e)) return expect.fail(`encierro rechazado en el dominio: ${JSON.stringify(e.rejected)}`);
    s = e.state;
    expect((await putLedger(cookie, 0, s)).status).toBe(200);
    const guardado = await persistido(userId);
    const retiro = guardado.movements.find((m) => m.from === "A" && m.to === D)!;
    const res = await putLedger(cookie, await revisionDe(userId),
      { ...guardado, movements: guardado.movements.filter((m) => m.id !== retiro.id) });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; detail: { violations: { period: string }[] } } };
    expect(body.error.code).toBe("domain_rule_violation");
    expect(body.error.detail.violations[0].period).toBe(ENE);
    expect((await persistido(userId)).movements.some((m) => m.id === retiro.id)).toBe(true);
  });

  /** @aitri-trace FR-ID: FR-2807, US-ID: US-2807, AC-ID: AC-2818, TC-ID: TC-RPG-074e */
  it("TC-RPG-074e: PUT que reserva exactamente 400 responde 200", async () => {
    // @aitri-tc TC-RPG-074e
    const { cookie, userId } = await newUser("rpg-074@example.com");
    expect((await putLedger(cookie, 0, plataFresca(userId))).status).toBe(200);
    const res = await putLedger(cookie, await revisionDe(userId), celdaA(await persistido(userId), JUN, 1400));
    expect(res.status).toBe(200);
    const r = await testDb().execute(sql`SELECT amount FROM amount_cell WHERE owner_id = ${userId}
      AND node_id = 'A' AND period = ${JUN} AND kind = 'actual'`);
    expect(Number(([...r][0] as { amount: number | string }).amount)).toBe(1400);
  });

  /** @aitri-trace FR-ID: FR-2807, US-ID: US-2807, AC-ID: AC-2817, TC-ID: TC-RPG-075h */
  it("TC-RPG-075h: POST /api/v1/movements con el retiro responde 201", async () => {
    // @aitri-tc TC-RPG-075h
    const { cookie, userId } = await newUser("rpg-075@example.com");
    await sembrarJunioConGasto(cookie, userId);
    const rev = await revisionDe(userId);
    const res = await movsPOST(req("/api/v1/movements", { method: "POST", cookie,
      body: { type: "transfer", catId: "A", amount: 300, period: JUN, date: `${JUN}-20`, from: "A", to: D } }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { movement: { amount: number }; revision: number };
    expect(body.movement.amount).toBe(300);
    expect(body.revision).toBe(rev + 1);
  });
});

// ══ NFR-2804 · los meses cerrados siguen congelados ═════════════════════════════════════════════

describe("NFR-2804 · un mes cerrado no admite el retiro aunque la regla neta lo acepte", () => {
  /** @aitri-trace FR-ID: NFR-2804, US-ID: US-2807, AC-ID: AC-2817, TC-ID: TC-RPG-131f */
  it("TC-RPG-131f: PUT con retiro en un mes cerrado responde closed_period_violation", async () => {
    // @aitri-tc TC-RPG-131f
    const { cookie, userId } = await newUser("rpg-131@example.com");
    const base = await sembrarJunioConGasto(cookie, userId);
    expect((await cerrar(cookie, await revisionDe(userId))).status).toBe(200);
    expect((await persistido(userId)).closure?.closedThrough).toBe(JUN);
    const res = await putLedger(cookie, await revisionDe(userId), { ...op(base, "A", D, JUN, 300), closure: (await persistido(userId)).closure });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("closed_period_violation");
    expect((await persistido(userId)).movements.some((m) => m.from === "A" && m.to === D)).toBe(false);
  });

  /** @aitri-trace FR-ID: NFR-2804, US-ID: US-2807, AC-ID: AC-2817, TC-ID: TC-RPG-132h */
  it("TC-RPG-132h: el mismo PUT con junio abierto responde 200", async () => {
    // @aitri-tc TC-RPG-132h
    const { cookie, userId } = await newUser("rpg-132@example.com");
    const base = await sembrarJunioConGasto(cookie, userId);
    expect((await persistido(userId)).closure?.closedThrough ?? null).toBeNull();
    expect((await putLedger(cookie, await revisionDe(userId), op(base, "A", D, JUN, 300))).status).toBe(200);
    expect((await persistido(userId)).movements.filter((m) => m.from === "A" && m.to === D)).toHaveLength(1);
  });

  /** @aitri-trace FR-ID: NFR-2804, US-ID: US-2807, AC-ID: AC-2817, TC-ID: TC-RPG-133e */
  it("TC-RPG-133e: reabrir junio y sacar se acepta", async () => {
    // @aitri-tc TC-RPG-133e
    const { cookie, userId } = await newUser("rpg-133@example.com");
    await sembrarJunioConGasto(cookie, userId);
    expect((await cerrar(cookie, await revisionDe(userId))).status).toBe(200);
    expect((await reabrir(cookie, await revisionDe(userId))).status).toBe(200);
    const reabierto = await persistido(userId);
    expect(reabierto.closure?.reopened).toBe(JUN);
    expect((await putLedger(cookie, await revisionDe(userId), op(reabierto, "A", D, JUN, 300))).status).toBe(200);
    expect((await persistido(userId)).movements.filter((m) => m.from === "A" && m.to === D)).toHaveLength(1);
  });
});

// ══ NFR-2808 · un descuadre sigue bloqueando el cierre ══════════════════════════════════════════

/**
 * Descuadra una celda POR DEBAJO de la API: el servidor rechaza una escritura que descuadre (NFR-2502),
 * así que es la única vía para sembrar uno. Mismo precedente que diario-de-celda-cierre.test.ts.
 */
async function descuadrar(userId: string, nodeId: string, period: PeriodKey, amount: number): Promise<void> {
  await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                             VALUES (${userId}, ${nodeId}, ${period}, 'actual', ${amount})
                             ON CONFLICT (owner_id, node_id, period, kind) DO UPDATE SET amount = ${amount}`);
}

describe("NFR-2808 · los descuadres siguen bloqueando el cierre", () => {
  /** @aitri-trace FR-ID: NFR-2808, US-ID: US-2806, AC-ID: AC-2816, TC-ID: TC-RPG-171f */
  it("TC-RPG-171f: una celda descuadrada bloquea el cierre", async () => {
    // @aitri-tc TC-RPG-171f
    const { cookie, userId } = await newUser("rpg-171@example.com");
    await sembrarJunioConGasto(cookie, userId);
    await descuadrar(userId, "gas", JUN, 120); // su único movimiento es de 300
    const res = await cerrar(cookie, await revisionDe(userId));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unbalanced_cells");
    expect((await persistido(userId)).closure?.closedThrough ?? null).toBeNull();
  });

  /** @aitri-trace FR-ID: NFR-2808, US-ID: US-2806, AC-ID: AC-2816, TC-ID: TC-RPG-172h */
  it("TC-RPG-172h: con la celda cuadrada el cierre se acepta", async () => {
    // @aitri-tc TC-RPG-172h
    const { cookie, userId } = await newUser("rpg-172@example.com");
    await sembrarJunioConGasto(cookie, userId);
    const res = await cerrar(cookie, await revisionDe(userId));
    expect(res.status).toBe(200);
    expect((await persistido(userId)).closure?.closedThrough).toBe(JUN);
  });
});
