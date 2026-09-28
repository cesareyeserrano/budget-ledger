/**
 * Feature saldo-de-bolsillo — lado servidor contra Postgres efímero (Testcontainers).
 *
 * Módulo:       tests/integration/backend/saldo-de-bolsillo.test.ts
 * Propósito:    La conversión única de los retiros planeados sin bolsillo (FR-3006, NFR-3007), el guardia
 *               sobre las filas por bolsillo (FR-3008), el cierre (NFR-3004) y los ciclos (NFR-3005).
 * Dependencias: rutas reales GET/PUT /api/v1/ledger y POST /api/v1/closure; SQL directo para sembrar
 *               ledgers con el formato anterior (data_version 5 y la fila global `@retiros`).
 *
 * La marca de la conversión es data_version 7 y no 6 como decía el TRD: la migración 0002 ya usó 6
 * (ver DATA_VERSION_PLAN_BY_POCKET en ledgerRepo.ts). Declarado en el build report.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger } from "@/server/data/ledgerRepo";
import { plannedRetiroKey } from "@/domain/reserve";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as closurePOST } from "@/app/api/v1/closure/route";
import { PUT as cyclesPUT } from "@/app/api/v1/ledger/cycles/route";
import type { AmountMap, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
const SEP = "2026-09" as PeriodKey;
const OCT = "2026-10" as PeriodKey;
const NOV = "2026-11" as PeriodKey;
const HOY = "2026-10-05";

let ipCounter = 0;
const nextIp = () => `10.30.${Math.floor((++ipCounter) / 250)}.${ipCounter % 250}`;

async function newUser(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { cookie, userId };
}
function req(url: string, init: { method?: string; cookie?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${url}`, { method: init.method ?? "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}
const putLedger = (cookie: string, baseRevision: number, state: LedgerState) =>
  ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, body: { baseRevision, state } }));
const getLedger = (cookie: string) => ledgerGET(req("/api/v1/ledger", { cookie }));
const revisionDe = async (userId: string) => (await loadLedger(userId))!.revision;
const persistido = async (userId: string) => (await loadLedger(userId))!.state;

function nodos(ownerId: string): LedgerNode[] {
  return [
    { id: "g-i", ownerId, type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
    { id: "ing", ownerId, type: "income", level: "category", parentId: "g-i", name: "Sueldo", icon: null, order: 1 },
    { id: "g-t", ownerId, type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 2 },
    { id: "A", ownerId, type: "transfer", level: "category", parentId: "g-t", name: "Ahorros", icon: null, order: 3 },
    { id: "B", ownerId, type: "transfer", level: "category", parentId: "g-t", name: "Ahorros 2", icon: null, order: 4 },
  ];
}
const plan = (ownerId: string, budgets: AmountMap): LedgerState =>
  ({ ownerId, nodes: nodos(ownerId), budgets, actuals: {}, movements: [] } as LedgerState);

async function filas(userId: string) {
  const c = await testDb().execute(sql`SELECT node_id, period, kind, amount FROM amount_cell WHERE owner_id = ${userId} ORDER BY node_id, period, kind`);
  const m = await testDb().execute(sql`SELECT id, amount, period FROM movement WHERE owner_id = ${userId} ORDER BY id`);
  return { celdas: [...c], movimientos: [...m] };
}
async function versionDe(userId: string): Promise<number> {
  const [row] = (await testDb().execute(sql`SELECT data_version FROM ledger WHERE owner_id = ${userId}`)) as unknown as { data_version: number }[];
  return row.data_version;
}

/**
 * Un ledger con el formato ANTERIOR: el plan se guarda por la ruta real y después, por SQL, se le añade la
 * fila global `@retiros` y se retrocede a data_version 5 — que es como está hoy un ledger de producción.
 */
async function sembrarLegado(email: string, extra: AmountMap = {}) {
  const u = await newUser(email);
  const s = plan(u.userId, { ing: { [SEP]: 50_000_000 }, A: { [SEP]: 43_728_582 }, B: { [OCT]: 1_000_000 }, ...extra });
  expect((await putLedger(u.cookie, 0, s)).status).toBe(200);
  await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount) VALUES (${u.userId}, '@retiros', ${OCT}, 'budget', 10000000)`);
  await testDb().execute(sql`UPDATE ledger SET data_version = 5 WHERE owner_id = ${u.userId}`);
  return u;
}

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = HOY;
});
afterAll(async () => {
  delete process.env.LEDGER_TODAY;
  await closeTestDb();
});

// ══ FR-3006 · conversión única ══════════════════════════════════════════════════════════════════

describe("FR-3006 · los retiros planeados sin bolsillo se reparten al cargar", () => {
  /** @aitri-trace FR-ID: FR-3006, US-ID: US-3006, AC-ID: AC-3020, TC-ID: TC-SDB-054h */
  it("TC-SDB-054h: la conversión se persiste", async () => {
    // @aitri-tc TC-SDB-054h
    const { cookie, userId } = await sembrarLegado("sdb-054@example.com");
    expect((await getLedger(cookie)).status).toBe(200);
    const r = (await testDb().execute(sql`SELECT node_id, period, amount FROM amount_cell WHERE owner_id = ${userId} AND node_id LIKE '@retiros%'`)) as unknown as { node_id: string; period: string; amount: number }[];
    // `amount` es bigint en Postgres y el driver lo devuelve como texto: se compara como número.
    expect(r.map((x) => ({ ...x, amount: Number(x.amount) }))).toEqual([{ node_id: plannedRetiroKey("A"), period: OCT, amount: 10_000_000 }]);
    expect(await versionDe(userId)).toBe(7);
  });

  /** @aitri-trace FR-ID: FR-3006, US-ID: US-3006, AC-ID: AC-3023, TC-ID: TC-SDB-053f */
  it("TC-SDB-053f: cargar dos veces no vuelve a convertir", async () => {
    // @aitri-tc TC-SDB-053f
    const { cookie, userId } = await sembrarLegado("sdb-053@example.com");
    await getLedger(cookie);
    const tras1 = await filas(userId);
    const rev1 = await revisionDe(userId);
    await getLedger(cookie);
    expect(await filas(userId)).toEqual(tras1);
    expect(await revisionDe(userId)).toBe(rev1);
    expect(await versionDe(userId)).toBe(7);
  });

  /** @aitri-trace FR-ID: FR-3006, US-ID: US-3006, AC-ID: AC-3022, TC-ID: TC-SDB-055e */
  it("TC-SDB-055e: un cliente viejo que reenvía la fila global se convierte al guardar", async () => {
    // @aitri-tc TC-SDB-055e
    const { cookie, userId } = await newUser("sdb-055@example.com");
    expect((await putLedger(cookie, 0, plan(userId, { ing: { [NOV]: 1000 }, A: { [NOV]: 500 } }))).status).toBe(200);
    const viejo = plan(userId, { ing: { [NOV]: 1000 }, A: { [NOV]: 500 }, "@retiros": { [NOV]: 100 } });
    expect((await putLedger(cookie, await revisionDe(userId), viejo)).status).toBe(200);
    const s = await persistido(userId);
    expect(s.budgets[plannedRetiroKey("A")]).toEqual({ [NOV]: 100 });
    expect(s.budgets["@retiros"]).toBeUndefined();
  });
});

// ══ NFR-3007 · abrir no cambia los datos ════════════════════════════════════════════════════════

describe("NFR-3007 · abrir un ledger solo convierte lo que debe", () => {
  /** @aitri-trace FR-ID: FR-3006, US-ID: US-3006, AC-ID: AC-3023, TC-ID: TC-SDB-161h */
  it("TC-SDB-161h: un ledger sin retiros globales no cambia al cargar", async () => {
    // @aitri-tc TC-SDB-161h
    const { cookie, userId } = await newUser("sdb-161@example.com");
    expect((await putLedger(cookie, 0, plan(userId, { ing: { [OCT]: 1000 }, A: { [OCT]: 300 } }))).status).toBe(200);
    await testDb().execute(sql`UPDATE ledger SET data_version = 5 WHERE owner_id = ${userId}`);
    const antes = await filas(userId);
    const rev = await revisionDe(userId);
    await getLedger(cookie);
    expect(await filas(userId)).toEqual(antes);
    expect(await revisionDe(userId)).toBe(rev);
    expect(await versionDe(userId)).toBe(7);
  });

  /** @aitri-trace FR-ID: FR-3006, US-ID: US-3006, AC-ID: AC-3022, TC-ID: TC-SDB-162e */
  it("TC-SDB-162e: con retiros globales solo cambian esas filas", async () => {
    // @aitri-tc TC-SDB-162e
    const { cookie, userId } = await sembrarLegado("sdb-162@example.com");
    const antes = await filas(userId);
    await getLedger(cookie);
    const despues = await filas(userId);
    const sinPlan = (xs: unknown[]) => (xs as { node_id: string }[]).filter((r) => !r.node_id.startsWith("@retiros"));
    expect(sinPlan(despues.celdas)).toEqual(sinPlan(antes.celdas));
    expect(despues.movimientos).toEqual(antes.movimientos);
    const total = (xs: unknown[]) => (xs as { node_id: string; amount: number }[]).filter((r) => r.node_id.startsWith("@retiros")).reduce((a, r) => a + Number(r.amount), 0);
    expect(total(despues.celdas)).toBe(total(antes.celdas));
  });
});

// ══ FR-3008 · guardia ═══════════════════════════════════════════════════════════════════════════

describe("FR-3008 · el servidor juzga los retiros planeados por bolsillo", () => {
  /** @aitri-trace FR-ID: FR-3008, US-ID: US-3008, AC-ID: AC-3027, TC-ID: TC-SDB-070f */
  it("TC-SDB-070f: PUT con un retiro planeado que deja el bolsillo en negativo", async () => {
    // @aitri-tc TC-SDB-070f
    const { cookie, userId } = await newUser("sdb-070@example.com");
    const base = plan(userId, { ing: { [OCT]: 1000 }, A: { [OCT]: 500 } });
    expect((await putLedger(cookie, 0, base)).status).toBe(200);
    const r = await revisionDe(userId);
    const res = await putLedger(cookie, r, plan(userId, { ...base.budgets, [plannedRetiroKey("A")]: { [OCT]: 600 } }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("domain_rule_violation");
    expect(body.error.detail.violations[0]).toMatchObject({ rule: "piso", leafId: "A" });
    expect(await revisionDe(userId)).toBe(r);
  });

  /** @aitri-trace FR-ID: FR-3008, US-ID: US-3008, AC-ID: AC-3028, TC-ID: TC-SDB-071h */
  it("TC-SDB-071h: PUT con un retiro planeado cubierto", async () => {
    // @aitri-tc TC-SDB-071h
    const { cookie, userId } = await newUser("sdb-071@example.com");
    const base = plan(userId, { ing: { [OCT]: 1000 }, A: { [OCT]: 500 } });
    expect((await putLedger(cookie, 0, base)).status).toBe(200);
    const res = await putLedger(cookie, await revisionDe(userId), plan(userId, { ...base.budgets, [plannedRetiroKey("A")]: { [OCT]: 300 } }));
    expect(res.status).toBe(200);
    expect((await persistido(userId)).budgets[plannedRetiroKey("A")]).toEqual({ [OCT]: 300 });
  });
});

// ══ NFR-3004 · cierre ═══════════════════════════════════════════════════════════════════════════

describe("NFR-3004 · el cierre manda", () => {
  async function conSeptiembreCerrado(email: string) {
    const u = await newUser(email);
    expect((await putLedger(u.cookie, 0, plan(u.userId, { ing: { [SEP]: 1000, [OCT]: 1000 }, A: { [SEP]: 500, [OCT]: 500 } }))).status).toBe(200);
    expect((await closurePOST(req("/api/v1/closure", { method: "POST", cookie: u.cookie, body: { baseRevision: await revisionDe(u.userId) } }))).status).toBe(200);
    return { ...u, s: await persistido(u.userId) };
  }

  /** @aitri-trace FR-ID: FR-3008, US-ID: US-3008, AC-ID: AC-3028, TC-ID: TC-SDB-131h */
  it("TC-SDB-131h: escribir en un mes abierto con anteriores cerrados", async () => {
    // @aitri-tc TC-SDB-131h
    const { cookie, userId, s } = await conSeptiembreCerrado("sdb-131@example.com");
    const res = await putLedger(cookie, await revisionDe(userId), { ...s, budgets: { ...s.budgets, [plannedRetiroKey("A")]: { [OCT]: 200 } } });
    expect(res.status).toBe(200);
  });

  /** @aitri-trace FR-ID: FR-3008, US-ID: US-3008, AC-ID: AC-3027, TC-ID: TC-SDB-132f */
  it("TC-SDB-132f: un retiro planeado en un mes cerrado choca con el cierre", async () => {
    // @aitri-tc TC-SDB-132f
    const { cookie, userId, s } = await conSeptiembreCerrado("sdb-132@example.com");
    const res = await putLedger(cookie, await revisionDe(userId), { ...s, budgets: { ...s.budgets, [plannedRetiroKey("A")]: { [SEP]: 200 } } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("closed_period_violation");
  });
});

// ══ NFR-3005 · ciclos ═══════════════════════════════════════════════════════════════════════════

describe("NFR-3005 · en ciclos la fecha manda", () => {
  /** @aitri-trace FR-ID: FR-3002, US-ID: US-3002, AC-ID: AC-3005, TC-ID: TC-SDB-143f */
  it("TC-SDB-143f: el servidor rechaza una fecha fuera de su ciclo", async () => {
    // @aitri-tc TC-SDB-143f
    const { cookie, userId } = await newUser("sdb-143@example.com");
    const base = plan(userId, {});
    expect((await putLedger(cookie, 0, base)).status).toBe(200);
    const act = await cyclesPUT(req("/api/v1/ledger/cycles", { method: "PUT", cookie, body: { baseRevision: await revisionDe(userId), target: { mode: "cycle", anchorDay: 21, eomPolicy: "last_day" } } }));
    expect(act.status).toBe(200);
    const s = await persistido(userId);
    const aporte: Movement = { id: "m-sdb-143", ownerId: userId, type: "transfer", catId: "A", subId: null, target: "A", amount: 100, period: OCT, createdAt: 1, date: "2026-10-25T10:00", from: "@disponible", to: "A" } as Movement;
    const res = await putLedger(cookie, await revisionDe(userId), { ...s, actuals: { ...s.actuals, A: { [OCT]: 100 } }, movements: [...s.movements, aporte] });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("period_mismatch");
  });
});
