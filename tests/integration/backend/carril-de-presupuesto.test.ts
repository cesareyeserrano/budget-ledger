/**
 * Feature carril-de-presupuesto — lado servidor contra Postgres efímero (Testcontainers).
 *
 * Módulo:       tests/integration/backend/carril-de-presupuesto.test.ts
 * Propósito:    El guardia del servidor juzga también el plano Presupuestado (FR-2906), con el mismo
 *               criterio que el navegador: rechaza lo que empeora el plan, acepta lo que no, respeta el
 *               orden de guardias del cierre (NFR-2904) y no guarda nada de una escritura rechazada ni
 *               de una lectura (NFR-2906).
 * Dependencias: rutas reales PUT/GET /api/v1/ledger y POST /api/v1/closure.
 *
 * Los planes se escriben en `budgets`, que no necesita movimientos detrás; lo ejecutado lleva su
 * movimiento (el servidor rechaza una celda de ingreso o gasto sin respaldo, NFR-2502).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger } from "@/server/data/ledgerRepo";
import { AVAILABLE_ID as D, applyReserveOp } from "@/domain/reserve";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as closurePOST } from "@/app/api/v1/closure/route";
import type { AmountMap, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";
import { P } from "../../helpers/periods";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
const ENE = "2026-01" as PeriodKey;
const SEP = "2026-09" as PeriodKey;
const OCT = "2026-10" as PeriodKey;
const NOV = "2026-11" as PeriodKey;
const DIC = "2026-12" as PeriodKey;
const ENE27 = "2027-01" as PeriodKey;
const HOY = "2026-10-05";

let ipCounter = 0;
const nextIp = () => `10.29.${Math.floor((++ipCounter) / 250)}.${ipCounter % 250}`;

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
const revisionDe = async (userId: string) => (await loadLedger(userId))!.revision;
const persistido = async (userId: string) => (await loadLedger(userId))!.state;

function nodos(ownerId: string): LedgerNode[] {
  return [
    { id: "g-i", ownerId, type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
    { id: "ing", ownerId, type: "income", level: "category", parentId: "g-i", name: "Sueldo", icon: null, order: 1 },
    { id: "g-e", ownerId, type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
    { id: "gas", ownerId, type: "expense", level: "category", parentId: "g-e", name: "Mercado", icon: null, order: 3 },
    { id: "g-t", ownerId, type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 4 },
    { id: "A", ownerId, type: "transfer", level: "category", parentId: "g-t", name: "Ahorro", icon: null, order: 5 },
    { id: "B", ownerId, type: "transfer", level: "category", parentId: "g-t", name: "Viaje", icon: null, order: 6 },
    { id: "C", ownerId, type: "transfer", level: "category", parentId: "g-t", name: "Colchón", icon: null, order: 7 },
  ];
}
const plan = (ownerId: string, budgets: AmountMap): LedgerState =>
  ({ ownerId, nodes: nodos(ownerId), budgets, actuals: {}, movements: [] } as LedgerState);
const conBudget = (s: LedgerState, leaf: string, p: PeriodKey, v: number): LedgerState =>
  ({ ...s, budgets: { ...s.budgets, [leaf]: { ...(s.budgets[leaf] ?? {}), [p]: v } } });

/** Un movimiento de ingreso con su celda cuadrada: el servidor no acepta celdas sin respaldo. */
function ingresoReal(s: LedgerState, period: PeriodKey, amount: number): LedgerState {
  const m = { id: `m-ing-${period}-${amount}`, ownerId: s.ownerId, type: "income", catId: "ing", subId: null,
    target: "ing", amount, period, createdAt: 1, date: `${period}-02` } as Movement;
  return { ...s, actuals: { ...s.actuals, ing: { ...(s.actuals.ing ?? {}), [period]: (s.actuals.ing?.[period] ?? 0) + amount } }, movements: [...s.movements, m] };
}
function op(s: LedgerState, from: string, to: string, period: PeriodKey, amount: number): LedgerState {
  const r = applyReserveOp(s, { from, to, period, amount, date: `${period}-15` }, P);
  if (!("state" in r)) return expect.fail(`rechazada en el dominio: ${JSON.stringify(r.rejected)}`);
  return r.state;
}

/**
 * Un plan LEGADO que ya se pasa en noviembre (A = 800 sobre 500), sembrado como pudo nacer: primero con
 * un ingreso de octubre que lo cubría y después bajando ese ingreso, que no toca reservas y por eso el
 * guardia no juzga (NFR-2908).
 */
async function sembrarPlanLegado(cookie: string, userId: string): Promise<LedgerState> {
  const cabia = plan(userId, { ing: { [OCT]: 1300 }, gas: { [OCT]: 500 }, A: { [NOV]: 800 } });
  expect((await putLedger(cookie, 0, cabia)).status).toBe(200);
  const legado = conBudget(await persistido(userId), "ing", OCT, 1000);
  expect((await putLedger(cookie, await revisionDe(userId), legado)).status).toBe(200);
  return persistido(userId);
}

/** El plan de octubre deja 500: ingreso 1.000, gasto 500. */
async function sembrarOctubre(cookie: string, userId: string): Promise<LedgerState> {
  expect((await putLedger(cookie, 0, plan(userId, { ing: { [OCT]: 1000 }, gas: { [OCT]: 500 } }))).status).toBe(200);
  return persistido(userId);
}

async function filas(userId: string): Promise<{ celdas: unknown[]; movimientos: unknown[] }> {
  const c = await testDb().execute(sql`SELECT node_id, period, kind, amount FROM amount_cell WHERE owner_id = ${userId}
    ORDER BY node_id, period, kind`);
  const m = await testDb().execute(sql`SELECT id, type, target, amount, period, date, from_id, to_id FROM movement
    WHERE owner_id = ${userId} ORDER BY id`);
  return { celdas: [...c], movimientos: [...m] };
}

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = HOY;
});
afterAll(async () => {
  delete process.env.LEDGER_TODAY;
  await closeTestDb();
});

// ══ FR-2906 · el servidor aplica las reglas del plan ═══════════════════════════════════════════

describe("FR-2906 · el servidor juzga el plano Presupuestado", () => {
  /** @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2920, TC-ID: TC-CDP-060h */
  it("TC-CDP-060h: PUT que baja una reserva del plan se acepta", async () => {
    // @aitri-tc TC-CDP-060h
    const { cookie, userId } = await newUser("cdp-060@example.com");
    const legado = await sembrarPlanLegado(cookie, userId);
    const r = await revisionDe(userId);
    const res = await putLedger(cookie, r, conBudget(legado, "A", NOV, 700));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: r + 1 });
    expect((await persistido(userId)).budgets.A[NOV]).toBe(700);
  });

  /** @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2919, TC-ID: TC-CDP-061f */
  it("TC-CDP-061f: PUT que sube el plan por encima del cupo se rechaza", async () => {
    // @aitri-tc TC-CDP-061f
    const { cookie, userId } = await newUser("cdp-061@example.com");
    const base = await sembrarOctubre(cookie, userId);
    const r = await revisionDe(userId);
    const res = await putLedger(cookie, r, conBudget(base, "A", NOV, 501));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "domain_rule_violation", detail: { violations: [{ rule: "techo", period: NOV, limit: 500 }] } },
    });
    expect(await revisionDe(userId)).toBe(r);
    expect((await persistido(userId)).budgets.A).toBeUndefined();
  });

  /** @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2919, TC-ID: TC-CDP-062f */
  it("TC-CDP-062f: PUT que deja el plan en déficit se rechaza", async () => {
    // @aitri-tc TC-CDP-062f
    const { cookie, userId } = await newUser("cdp-062@example.com");
    expect((await putLedger(cookie, 0, plan(userId, { ing: { [OCT]: 1000 }, gas: { [DIC]: 900 } }))).status).toBe(200);
    const r = await revisionDe(userId);
    const res = await putLedger(cookie, r, conBudget(await persistido(userId), "A", OCT, 200));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("domain_rule_violation");
    expect(body.error.detail.violations[0]).toMatchObject({ rule: "deficit", period: DIC });
    expect(await revisionDe(userId)).toBe(r);
  });

  /** @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2921, TC-ID: TC-CDP-063e */
  it("TC-CDP-063e: PUT de solo Ejec. se juzga como antes", async () => {
    // @aitri-tc TC-CDP-063e
    // El escenario de retirar-para-gastar: enero con ingreso 1.000, 1.000 reservados y 500 sacados.
    const { cookie, userId } = await newUser("cdp-063@example.com");
    const base = op(op(ingresoReal(plan(userId, {}), ENE, 1000), D, "A", ENE, 1000), "A", D, ENE, 500);
    expect((await putLedger(cookie, 0, base)).status).toBe(200);
    const enBase = await persistido(userId);
    const celda = (v: number): LedgerState => ({ ...enBase, actuals: { ...enBase.actuals, A: { ...enBase.actuals.A, [ENE]: v } } });
    // Un peso por encima del límite se rechaza con el mismo límite de siempre…
    const pasa = await putLedger(cookie, await revisionDe(userId), celda(1501));
    expect(pasa.status).toBe(422);
    expect((await pasa.json()).error.detail.violations[0]).toEqual({ rule: "techo", period: ENE, limit: 500 });
    // …y el límite exacto se acepta.
    expect((await putLedger(cookie, await revisionDe(userId), celda(1500))).status).toBe(200);
  });

  /** @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2921, TC-ID: TC-CDP-064e */
  it("TC-CDP-064e: PUT que no toca reservas pasa sobre un plan legado", async () => {
    // @aitri-tc TC-CDP-064e
    const { cookie, userId } = await newUser("cdp-064@example.com");
    const legado = await sembrarPlanLegado(cookie, userId);
    const res = await putLedger(cookie, await revisionDe(userId), conBudget(legado, "gas", ENE27, 300));
    expect(res.status).toBe(200);
    expect((await persistido(userId)).budgets.gas[ENE27]).toBe(300);
  });
});

// ══ NFR-2904 · el cierre de mes no cambia ═══════════════════════════════════════════════════════

describe("NFR-2904 · el cierre manda antes que la regla del plan", () => {
  async function conSeptiembreCerrado(email: string) {
    const { cookie, userId } = await newUser(email);
    expect((await putLedger(cookie, 0, plan(userId, { ing: { [SEP]: 500, [OCT]: 500 } }))).status).toBe(200);
    expect((await cerrar(cookie, await revisionDe(userId))).status).toBe(200);
    const s = await persistido(userId);
    expect(s.closure?.closedThrough).toBe(SEP);
    return { cookie, userId, s };
  }

  /** @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2920, TC-ID: TC-CDP-131h */
  it("TC-CDP-131h: el plan de un mes abierto se edita con meses anteriores cerrados", async () => {
    // @aitri-tc TC-CDP-131h
    const { cookie, userId, s } = await conSeptiembreCerrado("cdp-131@example.com");
    const res = await putLedger(cookie, await revisionDe(userId), conBudget(s, "A", OCT, 400));
    expect(res.status).toBe(200);
    expect((await persistido(userId)).budgets.A[OCT]).toBe(400);
  });

  /** @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2919, TC-ID: TC-CDP-132f */
  it("TC-CDP-132f: una escritura del plan en un mes cerrado choca primero con el cierre", async () => {
    // @aitri-tc TC-CDP-132f
    const { cookie, userId, s } = await conSeptiembreCerrado("cdp-132@example.com");
    // 999 en septiembre también rompería el techo del plan (500): manda el cierre.
    const res = await putLedger(cookie, await revisionDe(userId), conBudget(s, "A", SEP, 999));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("closed_period_violation");
    expect(body.error.detail.periods).toEqual([SEP]);
  });
});

// ══ NFR-2906 · nada guardado cambia ═════════════════════════════════════════════════════════════

describe("NFR-2906 · sin migración y sin escrituras parciales", () => {
  /** Un ledger con los tres bolsillos, celdas en los dos planos y movimientos reales. */
  async function sembrarCompleto(email: string) {
    const { cookie, userId } = await newUser(email);
    let s = plan(userId, { ing: { [SEP]: 3000, [OCT]: 3000 }, gas: { [SEP]: 1000, [OCT]: 1200 }, A: { [SEP]: 300 }, B: { [OCT]: 200 }, C: { [OCT]: 100 } });
    s = ingresoReal(ingresoReal(s, SEP, 2800), OCT, 3100);
    s = op(op(op(s, D, "A", SEP, 300), D, "B", OCT, 200), "A", D, OCT, 100);
    expect((await putLedger(cookie, 0, s)).status).toBe(200);
    return { cookie, userId };
  }

  /** @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2920, TC-ID: TC-CDP-151h */
  it("TC-CDP-151h: cargar y guardar sin cambios no altera ninguna fila", async () => {
    // @aitri-tc TC-CDP-151h
    const { cookie, userId } = await sembrarCompleto("cdp-151@example.com");
    const antes = await filas(userId);
    expect(antes.celdas.length).toBeGreaterThanOrEqual(10);
    expect(antes.movimientos.length).toBe(5);
    const r = await revisionDe(userId);
    const leido = await (await ledgerGET(req("/api/v1/ledger", { cookie }))).json();
    expect((await putLedger(cookie, leido.revision, leido.state)).status).toBe(200);
    expect(await filas(userId)).toEqual(antes);
    expect(await revisionDe(userId)).toBe(r + 1);
  });

  /** @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2920, TC-ID: TC-CDP-152e */
  it("TC-CDP-152e: leer no escribe", async () => {
    // @aitri-tc TC-CDP-152e
    const { cookie, userId } = await sembrarCompleto("cdp-152@example.com");
    const r = await revisionDe(userId);
    const revs: number[] = [];
    for (let i = 0; i < 3; i++) revs.push((await (await ledgerGET(req("/api/v1/ledger", { cookie }))).json()).revision);
    expect(revs).toEqual([r, r, r]);
    expect(await revisionDe(userId)).toBe(r);
  });

  /** @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2919, TC-ID: TC-CDP-153f */
  it("TC-CDP-153f: un rechazo del plan no deja escrituras parciales", async () => {
    // @aitri-tc TC-CDP-153f
    const { cookie, userId } = await newUser("cdp-153@example.com");
    const base = await sembrarOctubre(cookie, userId);
    const antes = await filas(userId);
    const r = await revisionDe(userId);
    const mixto = conBudget(conBudget(base, "gas", ENE27, 300), "A", NOV, 501);
    expect((await putLedger(cookie, r, mixto)).status).toBe(422);
    expect(await filas(userId)).toEqual(antes);
    expect(await revisionDe(userId)).toBe(r);
  });
});
