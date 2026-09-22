/**
 * Feature ciclos — EP-02: el servidor. Ejerce los route handlers REALES en proceso con cookies de
 * sesión sobre un Postgres de Testcontainers migrado hasta 0007.
 * TCs: FR-2401 (004f,153e) · FR-2403 (024h,028f,029e,171f) · FR-2404 (032f,037h,039f,042f,156f,157e,158e,159e,169h) ·
 *      FR-2405 (048f,049f,050f) · FR-2406 (060f) · FR-2408 (074e,075f,078f,152f) · FR-2409 (082h,084f,088f,089e) ·
 *      FR-2403 (177h) · FR-2410 (090h,092f,095f) · NFR-2404 (111f) · NFR-2405 (113e,114f) · NFR-2406 (115h,116e,117f) ·
 *      NFR-2408 (122f,123f,124f,125f,126f,127h,128e) · NFR-2410 (133e,134f)
 *
 * Es la capa donde la configuración es AUTORIDAD (ADR-03/05): lo que el navegador impide es
 * ergonomía; lo que se prueba aquí es el contrato — la lección de BG-002.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { PUT as startPUT } from "@/app/api/v1/ledger/start/route";
import { PUT as cyclesPUT } from "@/app/api/v1/ledger/cycles/route";
import { POST as previewPOST } from "@/app/api/v1/ledger/cycles/preview/route";
import { POST as movsPOST } from "@/app/api/v1/movements/route";
import { POST as closePOST, DELETE as reopenDELETE } from "@/app/api/v1/closure/route";
import { GET as streamGET } from "@/app/api/v1/sync/stream/route";
import { GET as healthGET } from "@/app/health/route";
import { computeBalanceSeries, ZERO_CARRY } from "@/domain/balance";
import { buildCalendar } from "@/domain/cycles";
import type { LedgerState } from "@/domain/types";
import { estadoReal, estadoSyn, estadoGrande, mvTransfer, resetSeq, F_REAL_SUMAS } from "../../fixtures/ciclos";
import { estadoUsuario, F_USER_INICIO, hojaPorNombre } from "../../fixtures/ciclos-usuario";
/** Hojas reales de F-USER para las pruebas de cierre (F-USER no tiene los rubros sintéticos de F-SYN). */
const REST = hojaPorNombre("Restaurantes");
const AHORROS = hojaPorNombre("Ahorros");

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
let ipCounter = 0;
function nextIp(): string { ipCounter += 1; return `10.7.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`; }
async function newUser(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { cookie, userId };
}
function req(url: string, init: { method?: string; cookie?: string; body?: unknown; origin?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin !== undefined) headers.origin = init.origin;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${url}`, { method: init.method ?? "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}
const DIA21 = { mode: "cycle", anchorDay: 21, eomPolicy: "last_day" } as const;
type Sesion = { cookie: string; userId: string };

async function getLedger(s: Sesion): Promise<{ revision: number; state: LedgerState }> {
  const res = await ledgerGET(req("/api/v1/ledger", { cookie: s.cookie }));
  expect(res.status).toBe(200);
  return res.json();
}
async function putLedger(s: Sesion, state: LedgerState, baseRevision: number): Promise<Response> {
  return ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie: s.cookie, origin: ORIGIN, body: { baseRevision, state } }));
}
async function putCycles(s: Sesion, baseRevision: number, target: unknown, origin = ORIGIN): Promise<Response> {
  return cyclesPUT(req("/api/v1/ledger/cycles", { method: "PUT", cookie: s.cookie, origin, body: { baseRevision, target } }));
}
async function preview(s: Sesion, target: unknown, origin = ORIGIN): Promise<Response> {
  return previewPOST(req("/api/v1/ledger/cycles/preview", { method: "POST", cookie: s.cookie, origin, body: { target } }));
}
async function postMov(s: Sesion, body: unknown): Promise<Response> {
  return movsPOST(req("/api/v1/movements", { method: "POST", cookie: s.cookie, origin: ORIGIN, body }));
}
async function close(s: Sesion): Promise<Response> {
  const { revision } = await getLedger(s);
  return closePOST(req("/api/v1/closure", { method: "POST", cookie: s.cookie, origin: ORIGIN, body: { baseRevision: revision } }));
}
async function reopen(s: Sesion): Promise<Response> {
  const { revision } = await getLedger(s);
  return reopenDELETE(req("/api/v1/closure", { method: "DELETE", cookie: s.cookie, origin: ORIGIN, body: { baseRevision: revision } }));
}
async function count(q: ReturnType<typeof sql>): Promise<number> {
  const rows = [...(await testDb().execute(q))] as Array<{ n: number | string }>;
  return Number(rows[0]?.n ?? 0);
}
async function sumas(userId: string): Promise<{ budget: number; actual: number; movements: number }> {
  const c = [...(await testDb().execute(sql`SELECT kind, COALESCE(SUM(amount),0)::bigint AS s FROM amount_cell WHERE owner_id=${userId} GROUP BY kind`))] as Array<{ kind: string; s: string }>;
  const m = [...(await testDb().execute(sql`SELECT COALESCE(SUM(amount),0)::bigint AS s FROM movement WHERE owner_id=${userId}`))] as Array<{ s: string }>;
  return { budget: Number(c.find((r) => r.kind === "budget")?.s ?? 0), actual: Number(c.find((r) => r.kind === "actual")?.s ?? 0), movements: Number(m[0]?.s ?? 0) };
}
/** Siembra F-REAL para la sesión: snapshot + mes de inicio y saldo inicial. */
async function sembrarReal(s: Sesion): Promise<number> {
  const st = { ...estadoReal(), ownerId: s.userId };
  expect((await putLedger(s, st, 0)).status).toBe(200);
  const r1 = await getLedger(s);
  const res = await startPUT(req("/api/v1/ledger/start", { method: "PUT", cookie: s.cookie, origin: ORIGIN, body: { baseRevision: r1.revision, startMonth: "2026-08", openingBalance: F_REAL_SUMAS.saldoInicial } }));
  expect(res.status).toBe(200);
  return (await getLedger(s)).revision;
}
/** Siembra F-USER (réplica del ledger del usuario previo a activar): snapshot + mes de inicio y saldo inicial. */
async function sembrarUsuario(s: Sesion): Promise<number> {
  expect((await putLedger(s, { ...estadoUsuario(), ownerId: s.userId }, 0)).status).toBe(200);
  const r1 = await getLedger(s);
  const res = await startPUT(req("/api/v1/ledger/start", { method: "PUT", cookie: s.cookie, origin: ORIGIN, body: { baseRevision: r1.revision, startMonth: F_USER_INICIO.startMonth, openingBalance: F_USER_INICIO.openingBalance } }));
  expect(res.status).toBe(200);
  return (await getLedger(s)).revision;
}
const filasMemoria = (userId: string) => count(sql`SELECT count(*)::int AS n FROM relocation_origin WHERE owner_id=${userId}`);
async function sembrarSyn(s: Sesion, over: Partial<LedgerState> = {}): Promise<number> {
  expect((await putLedger(s, { ...estadoSyn(over), ownerId: s.userId }, 0)).status).toBe(200);
  return (await getLedger(s)).revision;
}
async function activar(s: Sesion, target: unknown = DIA21): Promise<number> {
  const { revision } = await getLedger(s);
  const res = await putCycles(s, revision, target);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()).revision as number;
}
/**
 * Fija el instante del SERVIDOR (`LEDGER_NOW`, solo pruebas) sin falsear `Date`: un reloj falso
 * global caduca la sesión de Better Auth y todo responde 401. NOTA DE BUILD: el TC nombraba
 * `vi.setSystemTime`; el mecanismo real es equivalente y ejerce la misma conversión de zona horaria.
 */
async function conFecha(iso: string, fn: () => Promise<void>): Promise<void> {
  process.env.LEDGER_NOW = iso;
  try { await fn(); } finally { delete process.env.LEDGER_NOW; }
}

beforeEach(async () => { await truncateAll(); process.env.LEDGER_TODAY = "2026-09-10"; });
afterEach(() => { delete process.env.LEDGER_TODAY; delete process.env.LEDGER_NOW; delete process.env.LEDGER_TEST_FAIL_AFTER; delete process.env.LEDGER_TZ; });
afterAll(async () => { await closeTestDb(); });

describe("FR-2401 — el modo en el servidor", () => {
  it("TC-CIC-004f: PUT /api/v1/ledger/cycles con anchorDay 40 responde 422 invalid_payload y no escribe", async () => {
    // @aitri-tc TC-CIC-004f
    const s = await newUser("cic-004@test.local");
    const R = await sembrarReal(s);
    const res = await putCycles(s, R, { mode: "cycle", anchorDay: 40, eomPolicy: "last_day" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_payload");
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(0);
    expect((await getLedger(s)).revision).toBe(R);
  });
  it("TC-CIC-153e: la política «desplazar» se persiste y se lee de vuelta", async () => {
    // @aitri-tc TC-CIC-153e
    const s = await newUser("cic-153@test.local");
    await sembrarSyn(s);
    await activar(s, { mode: "cycle", anchorDay: 30, eomPolicy: "shift" });
    const { state } = await getLedger(s);
    expect(state.cycles?.versions[0]?.eomPolicy).toBe("shift");
    const rows = [...(await testDb().execute(sql`SELECT eom_policy FROM cycle_config_version WHERE owner_id=${s.userId}`))] as Array<{ eom_policy: string }>;
    expect(rows[0]?.eom_policy).toBe("shift");
  });
});

describe("FR-2403 — la previsualización", () => {
  it("TC-CIC-024h: POST preview sobre F-USER devuelve los ciclos y el resumen 15 · 10 · 3 sin escribir", async () => {
    // @aitri-tc TC-CIC-024h
    const s = await newUser("cic-024@test.local");
    const R = await sembrarUsuario(s);
    const res = await preview(s, DIA21);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cycles[0]).toEqual({ key: "2026-09", label: "Septiembre 2026", start: "2026-08-21", end: "2026-09-20", transition: false, current: true });
    expect(body.cycles).toHaveLength(6);
    // 28 desde diario-de-celda (FR-2511): F-USER tenía la celda de «Internet» con 96.400 y CERO
    // movimientos detrás. Nadie lo notaba porque nada miraba el cuadre; ahora un mes con celdas sin
    // respaldo no se cierra, así que el fixture ganó el movimiento que faltaba. Lo que este caso
    // afirma no cambia: cuenta cuántos movimientos reubica, no cuántos debería haber.
    expect(body.relocation).toMatchObject({ cellsMoved: 15, movementsMoved: 28, movementsKeyChanged: 10, mergedCells: 3, identical: true, historyStart: "2026-09" });
    expect((await getLedger(s)).revision).toBe(R);
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(0);
    expect(await filasMemoria(s.userId)).toBe(0);
  });
  it("TC-CIC-028f: previsualizar volver a mes con un ciclo cerrado responde 422 closed_period", async () => {
    // @aitri-tc TC-CIC-028f
    const s = await newUser("cic-028@test.local");
    await sembrarUsuario(s);
    await activar(s);
    process.env.LEDGER_TODAY = "2026-09-25";
    expect((await close(s)).status).toBe(200);
    const res = await preview(s, { mode: "month" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toEqual({ code: "closed_period", detail: { period: "2026-09" } });
  });
  it("TC-CIC-029e: previsualizar dos veces devuelve el mismo cuerpo y no crea versiones", async () => {
    // @aitri-tc TC-CIC-029e
    const s = await newUser("cic-029@test.local");
    const R = await sembrarReal(s);
    const a = await (await preview(s, DIA21)).json();
    const b = await (await preview(s, DIA21)).json();
    expect(a).toEqual(b);
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(0);
    expect((await getLedger(s)).revision).toBe(R);
  });
  it("TC-CIC-171f: la previsualización devuelve el bloqueo reserve_floor con la alcancía y el ciclo", async () => {
    // @aitri-tc TC-CIC-171f
    const s = await newUser("cic-171@test.local");
    resetSeq();
    const aporte = mvTransfer("@disponible", "c-alcancia", 10_000, "2026-08-25", "2026-08");
    const retiro = mvTransfer("c-alcancia", "@disponible", 60_000, "2026-08-15", "2026-08");
    await sembrarSyn(s, { movements: [aporte, retiro], actuals: { "c-alcancia": { "2026-08": 110_000 } } });
    const res = await preview(s, DIA21);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toEqual({ code: "relocation_invariant", detail: { rule: "reserve_floor", leafId: "c-alcancia", period: "2026-08" } });
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(0);
    expect(await filasMemoria(s.userId)).toBe(0);
  });
  it("TC-CIC-177h: previsualizar la vuelta sobre F-USER activado devuelve el resumen inverso 15 · 10 · 3 sin escribir", async () => {
    // @aitri-tc TC-CIC-177h
    const s = await newUser("cic-177@test.local");
    await sembrarUsuario(s);
    const R = await activar(s);
    expect(await filasMemoria(s.userId)).toBe(50);
    const res = await preview(s, { mode: "month" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).relocation).toMatchObject({ cellsMoved: 15, movementsKeyChanged: 10, mergedCells: 3, identical: true });
    expect(await filasMemoria(s.userId)).toBe(50);
    expect((await getLedger(s)).revision).toBe(R);
  });
});

describe("FR-2404 — activar en el servidor", () => {
  it("TC-CIC-037h: PUT /cycles sobre F-USER persiste la reubicación y su memoria, sube revision y sobrevive a la recarga", async () => {
    // @aitri-tc TC-CIC-037h
    const s = await newUser("cic-037@test.local");
    const R = await sembrarUsuario(s);
    const antes = await sumas(s.userId);
    const res = await putCycles(s, R, DIA21);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).revision).toBe(R + 1);
    expect(await count(sql`SELECT count(*)::int AS n FROM amount_cell WHERE owner_id=${s.userId} AND period='2026-08' AND amount <> 0`)).toBe(0);
    expect(await count(sql`SELECT count(*)::int AS n FROM amount_cell WHERE owner_id=${s.userId} AND period='2026-09'`)).toBeGreaterThan(0);
    // 28: F-USER ganó el movimiento que respalda «Internet» (ver TC-CIC-024h).
    expect(await count(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id=${s.userId} AND period='2026-09'`)).toBe(28);
    const head = [...(await testDb().execute(sql`SELECT start_month FROM ledger WHERE owner_id=${s.userId}`))] as Array<{ start_month: string }>;
    expect(head[0]?.start_month).toBe("2026-09");
    expect(await filasMemoria(s.userId)).toBe(50);
    expect(await sumas(s.userId)).toEqual(antes);
    const { revision, state } = await getLedger(s);
    expect(revision).toBe(R + 1);
    expect(state.cycles?.mode).toBe("cycle");
    expect(state.origins).toBeUndefined();
  });
  it("TC-CIC-032f: atomicidad — un fallo tras la primera escritura deja el ledger en modo mes sin ningún cambio", async () => {
    // @aitri-tc TC-CIC-032f
    const s = await newUser("cic-032@test.local");
    const R = await sembrarReal(s);
    process.env.LEDGER_TEST_FAIL_AFTER = "first_insert";
    const res = await putCycles(s, R, DIA21);
    expect(res.status).toBe(500);
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(0);
    expect(await count(sql`SELECT count(*)::int AS n FROM amount_cell WHERE owner_id=${s.userId} AND period='2026-08'`)).toBe(14);
    const head = [...(await testDb().execute(sql`SELECT revision, start_month FROM ledger WHERE owner_id=${s.userId}`))] as Array<{ revision: number; start_month: string }>;
    expect(Number(head[0]?.revision)).toBe(R);
    expect(head[0]?.start_month).toBe("2026-08");
  });
  it("TC-CIC-039f: baseRevision obsoleta responde 409 y no reubica", async () => {
    // @aitri-tc TC-CIC-039f
    const s = await newUser("cic-039@test.local");
    const R = await sembrarReal(s);
    const { state } = await getLedger(s);
    expect((await putLedger(s, state, R)).status).toBe(200);
    const res = await putCycles(s, R, DIA21);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "revision_conflict" }, revision: R + 1 });
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(0);
    expect(await count(sql`SELECT count(*)::int AS n FROM amount_cell WHERE owner_id=${s.userId} AND period='2026-08'`)).toBe(14);
  });
  it("TC-CIC-042f: activar con el mismo día estando en ciclos responde 422 no_change", async () => {
    // @aitri-tc TC-CIC-042f
    const s = await newUser("cic-042@test.local");
    await sembrarReal(s);
    const R = await activar(s);
    const res = await putCycles(s, R, DIA21);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("no_change");
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(1);
  });
  it("TC-CIC-156f: baseRevision negativo o ausente se rechaza con invalid_payload", async () => {
    // @aitri-tc TC-CIC-156f
    const s = await newUser("cic-156@test.local");
    await sembrarSyn(s);
    const a = await putCycles(s, -1, DIA21);
    expect(a.status).toBe(422); expect((await a.json()).error.code).toBe("invalid_payload");
    const b = await cyclesPUT(req("/api/v1/ledger/cycles", { method: "PUT", cookie: s.cookie, origin: ORIGIN, body: { target: DIA21 } }));
    expect(b.status).toBe(422); expect((await b.json()).error.code).toBe("invalid_payload");
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(0);
  });
  it("TC-CIC-157e: PUT /ledger ignora un campo cycles en el cuerpo", async () => {
    // @aitri-tc TC-CIC-157e
    const s = await newUser("cic-157@test.local");
    await sembrarSyn(s, { budgets: { "c-comida": { "2026-09": 1000 } } });
    const R = await activar(s);
    const { state } = await getLedger(s);
    const res = await putLedger(s, { ...state, cycles: { mode: "month", versions: [] } }, R);
    expect(res.status).toBe(200);
    const after = await getLedger(s);
    expect(after.state.cycles?.mode).toBe("cycle");
    expect(after.state.cycles?.versions[0]?.anchorDay).toBe(21);
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(1);
  });
  it("TC-CIC-158e: dos PUT /cycles concurrentes con la misma baseRevision: uno 200 y otro 409", async () => {
    // @aitri-tc TC-CIC-158e
    const s = await newUser("cic-158@test.local");
    const R = await sembrarReal(s);
    const [a, b] = await Promise.all([putCycles(s, R, DIA21), putCycles(s, R, DIA21)]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(1);
    expect((await getLedger(s)).revision).toBe(R + 1);
  });
  it("TC-CIC-159e: tras aplicar, el otro dispositivo recibe el evento SSE con la revisión nueva", async () => {
    // @aitri-tc TC-CIC-159e
    const s = await newUser("cic-159@test.local");
    const R = await sembrarSyn(s, { budgets: { "c-comida": { "2026-09": 1000 } } });
    const stream = await streamGET(req("/api/v1/sync/stream", { cookie: s.cookie }));
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    const recibido = (async () => {
      const inicio = Date.now();
      let buf = "";
      while (Date.now() - inicio < 1000) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
        const m = buf.match(/event: revision\ndata: (\{[^\n]*\})/);
        if (m) return JSON.parse(m[1]!) as { revision: number };
      }
      return null;
    })();
    expect((await putCycles(s, R, DIA21)).status).toBe(200);
    const ev = await recibido;
    await reader.cancel().catch(() => {});
    expect(ev?.revision).toBe(R + 1);
    expect((await getLedger(s)).state.cycles?.mode).toBe("cycle");
  });
  it("TC-CIC-169h: tras aplicar y reiniciar el módulo del repositorio, la configuración y las claves se leen igual", async () => {
    // @aitri-tc TC-CIC-169h
    const s = await newUser("cic-169@test.local");
    const R = await sembrarUsuario(s);
    await activar(s);
    vi.resetModules();
    const repo = await import("@/server/data/ledgerRepo");
    const loaded = await repo.loadLedger(s.userId);
    expect(loaded?.revision).toBe(R + 1);
    expect(loaded?.state.cycles?.mode).toBe("cycle");
    expect(loaded?.state.cycles?.versions[0]?.anchorDay).toBe(21);
    expect(loaded?.state.movements.filter((m) => m.period === "2026-09")).toHaveLength(28);
    for (const m of [loaded!.state.budgets, loaded!.state.actuals]) for (const cells of Object.values(m)) expect(cells?.["2026-08"] ?? 0).toBe(0);
  });
});

describe("FR-2405 / FR-2406 — la asignación por fecha, en el servidor", () => {
  it("TC-CIC-048f: POST /movements sin fecha en modo ciclos responde 422", async () => {
    // @aitri-tc TC-CIC-048f
    // NOTA DE BUILD: el esquema Zod no conoce el modo del dueño, así que la fecha obligatoria es una
    // regla de SERVIDOR y el código es `period_mismatch` (con expected null), no `invalid_payload`.
    const s = await newUser("cic-048@test.local");
    await sembrarSyn(s, { budgets: { "c-comida": { "2026-09": 1000 } } });
    await activar(s);
    const n = await count(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id=${s.userId}`);
    const res = await postMov(s, { type: "expense", catId: "c-comida", amount: 1000, period: "2026-10" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("period_mismatch");
    expect(await count(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id=${s.userId}`)).toBe(n);
  });
  it("TC-CIC-049f: POST /movements con periodo incoherente con la fecha responde 422 period_mismatch", async () => {
    // @aitri-tc TC-CIC-049f
    const s = await newUser("cic-049@test.local");
    await sembrarSyn(s, { budgets: { "c-comida": { "2026-09": 1000 } } });
    await activar(s);
    const res = await postMov(s, { type: "expense", catId: "c-comida", amount: 1000, period: "2026-11", date: "2026-10-05T12:00" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toEqual({ code: "period_mismatch", detail: { expected: "2026-10" } });
    expect(await count(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id=${s.userId}`)).toBe(0);
  });
  it("TC-CIC-050f: PUT /ledger con un movimiento incoherente responde 422 con los ids afectados", async () => {
    // @aitri-tc TC-CIC-050f
    const s = await newUser("cic-050@test.local");
    await sembrarSyn(s, { budgets: { "c-comida": { "2026-09": 1000 } } });
    await activar(s);
    expect((await postMov(s, { type: "expense", catId: "c-comida", amount: 1000, period: "2026-10", date: "2026-10-05T12:00" })).status).toBe(201);
    const { revision, state } = await getLedger(s);
    const roto = { ...state, movements: state.movements.map((m, i) => (i === 0 ? { ...m, period: "2026-12" } : m)) };
    const res = await putLedger(s, roto, revision);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toEqual({ code: "period_mismatch", detail: { ids: [state.movements[0]!.id] } });
    const after = await getLedger(s);
    expect(after.revision).toBe(revision);
    expect(after.state.movements[0]!.period).toBe("2026-10");
  });
  it("TC-CIC-060f: el servidor acepta period = ciclo siguiente solo dentro de la ventana", async () => {
    // @aitri-tc TC-CIC-060f
    const s = await newUser("cic-060@test.local");
    await sembrarSyn(s, { budgets: { "c-comida": { "2026-09": 1000 } } });
    await activar(s);
    const a = await postMov(s, { type: "income", catId: "c-salario", amount: 100, period: "2026-12", date: "2026-11-10T12:00" });
    expect(a.status).toBe(422); expect((await a.json()).error.code).toBe("period_mismatch");
    const b = await postMov(s, { type: "income", catId: "c-salario", amount: 100, period: "2026-12", date: "2026-11-20T12:00" });
    expect(b.status).toBe(201); expect((await b.json()).movement.period).toBe("2026-12");
  });
});

describe("FR-2408 — cambiar el día de pago, en el servidor", () => {
  it("TC-CIC-074e: 21→5 con primer pago 5-nov: transición de 15 días y dos versiones consultables", async () => {
    // @aitri-tc TC-CIC-074e
    const s = await newUser("cic-074@test.local");
    await sembrarSyn(s, { budgets: { "c-comida": { "2026-09": 1000 } } });
    const R = await activar(s);
    const res = await putCycles(s, R, { mode: "cycle", anchorDay: 5, eomPolicy: "last_day", firstPayDate: "2026-11-05" });
    expect(res.status, await res.clone().text()).toBe(200);
    const { state } = await getLedger(s);
    expect(state.cycles?.versions).toHaveLength(2);
    expect(state.cycles?.versions[1]).toMatchObject({ anchorDay: 5, firstPay: "2026-11-05", effectiveFrom: "2026-11-05" });
    const cal = buildCalendar(state.cycles, { from: "2026-06", to: "2027-12" });
    expect(cal.rangeOf("2026-11")).toEqual({ start: "2026-10-21", end: "2026-11-04" });
    expect(cal.isTransition("2026-11")).toBe(true);
    expect(cal.rangeOf("2026-12")).toEqual({ start: "2026-11-05", end: "2026-12-04" });
    expect(cal.keys("2026-06", "2027-12").some((k) => k.endsWith("t"))).toBe(false);
  });
  it("TC-CIC-075f: primer pago dentro de un ciclo cerrado o no posterior al último pago se rechaza con first_pay_invalid", async () => {
    // @aitri-tc TC-CIC-075f
    const s = await newUser("cic-075@test.local");
    await sembrarUsuario(s);
    await activar(s);
    process.env.LEDGER_TODAY = "2026-10-25";
    expect((await close(s)).status).toBe(200);
    expect((await close(s)).status).toBe(200);
    expect((await getLedger(s)).state.closure?.closedThrough).toBe("2026-10");
    for (const firstPayDate of ["2026-10-10", "2026-10-21"]) {
      const { revision } = await getLedger(s);
      const res = await putCycles(s, revision, { mode: "cycle", anchorDay: 30, eomPolicy: "last_day", firstPayDate });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("first_pay_invalid");
      expect(body.error.detail.lastPay).toBe("2026-10-21");
    }
    expect((await getLedger(s)).state.cycles?.versions).toHaveLength(1);
  });
  it("TC-CIC-078f: cambiar el día sin fecha de primer pago se rechaza con first_pay_required", async () => {
    // @aitri-tc TC-CIC-078f
    const s = await newUser("cic-078@test.local");
    await sembrarSyn(s);
    const R = await activar(s);
    const res = await putCycles(s, R, { mode: "cycle", anchorDay: 30, eomPolicy: "last_day" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("first_pay_required");
    expect((await getLedger(s)).state.cycles?.versions).toHaveLength(1);
  });
  it("TC-CIC-152f: firstPayDate '2027-02-30' pasa la regex y se rechaza en dominio con first_pay_invalid", async () => {
    // @aitri-tc TC-CIC-152f
    const s = await newUser("cic-152@test.local");
    await sembrarSyn(s);
    const R = await activar(s);
    const res = await putCycles(s, R, { mode: "cycle", anchorDay: 30, eomPolicy: "last_day", firstPayDate: "2027-02-30" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("first_pay_invalid");
    expect((await getLedger(s)).state.cycles?.versions).toHaveLength(1);
  });
});

describe("FR-2409 — el cierre sobre la frontera del ciclo, en el servidor", () => {
  it("TC-CIC-082h: cerrar Septiembre el 2026-09-25 congela sus cifras y Octubre abre con su resultado", async () => {
    // @aitri-tc TC-CIC-082h
    const s = await newUser("cic-082@test.local");
    await sembrarUsuario(s);
    await activar(s);
    delete process.env.LEDGER_TODAY;
    process.env.LEDGER_TZ = "America/Bogota";
    await conFecha("2026-09-25T20:00:00Z", async () => {
      expect((await close(s)).status).toBe(200);
    });
    const { state } = await getLedger(s);
    expect(state.closure?.closedThrough).toBe("2026-09");
    expect(await count(sql`SELECT count(*)::int AS n FROM closure_event WHERE owner_id=${s.userId} AND period='2026-09' AND action='close'`)).toBe(1);
    const res = await postMov(s, { type: "expense", catId: REST, amount: 1000, period: "2026-09", date: "2026-09-05T12:00" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("closed_period_violation");
    const cal = buildCalendar(state.cycles, { from: "2026-06", to: "2027-12" });
    const keys = cal.keys("2026-09", "2026-12");
    const series = computeBalanceSeries(state, keys, ZERO_CARRY);
    expect(series["2026-10"]!.actual.prevAvailable).toBe(series["2026-09"]!.actual.available);
  });
  it("TC-CIC-084f: registrar en un ciclo cerrado se rechaza; tras reabrir se acepta y queda rastro", async () => {
    // @aitri-tc TC-CIC-084f
    const s = await newUser("cic-084@test.local");
    await sembrarUsuario(s);
    await activar(s);
    process.env.LEDGER_TODAY = "2026-09-25";
    expect((await close(s)).status).toBe(200);
    const mov = { type: "expense", catId: REST, amount: 1000, period: "2026-09", date: "2026-09-05T12:00" };
    const a = await postMov(s, mov);
    expect(a.status).toBe(422); expect((await a.json()).error.code).toBe("closed_period_violation");
    const r = await reopen(s);
    expect(r.status).toBe(200); expect((await r.json()).closure.reopened).toBe("2026-09");
    expect((await postMov(s, mov)).status).toBe(201);
    expect(await count(sql`SELECT count(*)::int AS n FROM closure_event WHERE owner_id=${s.userId} AND period='2026-09' AND action='reopen'`)).toBe(1);
  });
  it("TC-CIC-088f: el servidor usa LEDGER_TZ: a las 23:30 de Bogotá del 20-sep Octubre sigue sin ser cerrable", async () => {
    // @aitri-tc TC-CIC-088f
    const s = await newUser("cic-088@test.local");
    await sembrarUsuario(s);
    await activar(s);
    process.env.LEDGER_TODAY = "2026-09-25";
    expect((await close(s)).status).toBe(200);
    delete process.env.LEDGER_TODAY;
    process.env.LEDGER_TZ = "America/Bogota";
    await conFecha("2026-09-21T04:30:00Z", async () => {
      const res = await close(s);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toEqual({ code: "not_closable", detail: { closable: null } });
    });
    process.env.LEDGER_TZ = "UTC";
    await conFecha("2026-09-21T04:30:00Z", async () => {
      expect((await close(s)).status).toBe(200);
    });
  });
  it("TC-CIC-089e: closure_event acepta una clave de transición", async () => {
    // @aitri-tc TC-CIC-089e
    const s = await newUser("cic-089@test.local");
    // Con la regla nueva un rubro sin movimientos queda en el ciclo del mismo nombre: se siembra en octubre
    // para que el historial empiece en «Octubre» y el segundo cierre caiga en la transición.
    await sembrarSyn(s, { budgets: { "c-comida": { "2026-10": 1000 } } });
    const R = await activar(s);
    expect((await putCycles(s, R, { mode: "cycle", anchorDay: 30, eomPolicy: "last_day", firstPayDate: "2026-10-30" })).status).toBe(200);
    process.env.LEDGER_TODAY = "2026-11-15";
    expect((await close(s)).status).toBe(200);
    expect((await getLedger(s)).state.closure?.closedThrough).toBe("2026-10");
    expect((await close(s)).status).toBe(200);
    expect((await getLedger(s)).state.closure?.closedThrough).toBe("2026-10t");
    expect(await count(sql`SELECT count(*)::int AS n FROM closure_event WHERE owner_id=${s.userId} AND period='2026-10t' AND action='close'`)).toBe(1);
  });
});

describe("FR-2410 — volver a mes, en el servidor", () => {
  const sinMeta = (st: LedgerState) => { const { cycles: _c, ...rest } = st; void _c; return rest; };
  it("TC-CIC-090h: ida y vuelta sin ediciones sobre F-USER deja el snapshot persistido byte a byte igual y la memoria vacía", async () => {
    // @aitri-tc TC-CIC-090h
    const s = await newUser("cic-090@test.local");
    await sembrarUsuario(s);
    const S0 = sinMeta((await getLedger(s)).state);
    const R1 = await activar(s);
    expect(await filasMemoria(s.userId)).toBe(50);
    const vuelta = await putCycles(s, R1, { mode: "month" });
    expect(vuelta.status, await vuelta.clone().text()).toBe(200);
    const after = await getLedger(s);
    expect(sinMeta(after.state)).toEqual(S0);
    expect(after.state.startMonth).toBe("2026-08");
    expect(after.state.cycles?.mode).toBe("month");
    expect(after.state.cycles?.versions).toHaveLength(2);
    expect(await filasMemoria(s.userId)).toBe(0);
  });
  it("TC-CIC-092f: con un ciclo cerrado, volver a mes se rechaza con closed_period", async () => {
    // @aitri-tc TC-CIC-092f
    const s = await newUser("cic-092@test.local");
    await sembrarUsuario(s);
    await activar(s);
    process.env.LEDGER_TODAY = "2026-09-25";
    expect((await close(s)).status).toBe(200);
    const { revision } = await getLedger(s);
    const res = await putCycles(s, revision, { mode: "month" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toEqual({ code: "closed_period", detail: { period: "2026-09" } });
    const { state } = await getLedger(s);
    expect(state.cycles?.mode).toBe("cycle");
    expect(state.cycles?.versions).toHaveLength(1);
  });
  it("TC-CIC-095f: atomicidad inversa — un fallo a mitad deja el ledger íntegro en ciclos", async () => {
    // @aitri-tc TC-CIC-095f
    const s = await newUser("cic-095@test.local");
    await sembrarReal(s);
    const R = await activar(s);
    const antes = [...(await testDb().execute(sql`SELECT period, count(*)::int AS n FROM amount_cell WHERE owner_id=${s.userId} GROUP BY period ORDER BY period`))];
    process.env.LEDGER_TEST_FAIL_AFTER = "first_insert";
    const res = await putCycles(s, R, { mode: "month" });
    expect(res.status).toBe(500);
    delete process.env.LEDGER_TEST_FAIL_AFTER;
    const despues = [...(await testDb().execute(sql`SELECT period, count(*)::int AS n FROM amount_cell WHERE owner_id=${s.userId} GROUP BY period ORDER BY period`))];
    expect(despues).toEqual(antes);
    expect((await getLedger(s)).state.cycles?.mode).toBe("cycle");
  });
});

describe("NFR-2404 / NFR-2405 — reservas y saldo inicial bajo ciclos", () => {
  it("TC-CIC-111f: una operación de reserva en el ciclo de transición la juzga la regla, no la clave", async () => {
    // @aitri-tc TC-CIC-111f
    // NOTA DE BUILD: un retiro que rompe el piso lo rechaza el dominio y la API responde
    // `invalid_movement` (movements/route.ts), no un código 'floor'. Lo que se prueba es que la
    // transición EXISTE para el servidor: el rechazo es por regla, nunca period_mismatch ni 500.
    const s = await newUser("cic-111@test.local");
    await sembrarSyn(s, { actuals: { "c-alcancia": { "2026-09": 100_000 } } });
    const R = await activar(s);
    expect((await putCycles(s, R, { mode: "cycle", anchorDay: 30, eomPolicy: "last_day", firstPayDate: "2026-10-30" })).status).toBe(200);
    const excede = await postMov(s, { type: "transfer", catId: "c-alcancia", amount: 150_000, period: "2026-10t", date: "2026-10-25T12:00", from: "c-alcancia", to: "@disponible" });
    expect(excede.status).toBe(422);
    const code = (await excede.json()).error.code;
    expect(["invalid_movement", "domain_rule_violation"]).toContain(code);
    expect(code).not.toBe("period_mismatch");
    const dentro = await postMov(s, { type: "transfer", catId: "c-alcancia", amount: 20_000, period: "2026-10t", date: "2026-10-25T12:00", from: "c-alcancia", to: "@disponible" });
    expect(dentro.status, await dentro.clone().text()).toBe(201);
    expect((await dentro.json()).movement.period).toBe("2026-10t");
  });
  it("TC-CIC-113e: el saldo inicial solo se edita con el primer ciclo abierto", async () => {
    // @aitri-tc TC-CIC-113e
    const s = await newUser("cic-113@test.local");
    await sembrarReal(s);
    await activar(s);
    process.env.LEDGER_TODAY = "2026-09-25";
    expect((await close(s)).status).toBe(200);
    const { revision } = await getLedger(s);
    const res = await startPUT(req("/api/v1/ledger/start", { method: "PUT", cookie: s.cookie, origin: ORIGIN, body: { baseRevision: revision, startMonth: "2026-09", openingBalance: 1 } }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("month_closed");
  });
  it("TC-CIC-114f: un mes de inicio malformado se rechaza; la clave de transición es legítima", async () => {
    // @aitri-tc TC-CIC-114f
    const s = await newUser("cic-114@test.local");
    await sembrarSyn(s);
    const R = await activar(s);
    expect((await putCycles(s, R, { mode: "cycle", anchorDay: 30, eomPolicy: "last_day", firstPayDate: "2026-10-30" })).status).toBe(200);
    const { revision } = await getLedger(s);
    const a = await startPUT(req("/api/v1/ledger/start", { method: "PUT", cookie: s.cookie, origin: ORIGIN, body: { baseRevision: revision, startMonth: "2026-10x", openingBalance: 0 } }));
    expect(a.status).toBe(422); expect((await a.json()).error.code).toBe("invalid_payload");
    const b = await startPUT(req("/api/v1/ledger/start", { method: "PUT", cookie: s.cookie, origin: ORIGIN, body: { baseRevision: revision, startMonth: "2026-10t", openingBalance: 0 } }));
    expect(b.status, await b.clone().text()).toBe(200);
    expect((await b.json()).startMonth).toBe("2026-10t");
  });
});

describe("NFR-2406 — la migración 0007", () => {
  it("TC-CIC-115h: la migración aplicada dos veces no falla ni cambia el esquema", async () => {
    // @aitri-tc TC-CIC-115h
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const path = await import("node:path");
    const esquema = async () => [...(await testDb().execute(sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conname`))];
    const antes = await esquema();
    for (let i = 0; i < 2; i++) {
      const client = postgres(process.env.DATABASE_URL!, { max: 1 });
      await migrate(drizzle(client), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
      await client.end();
    }
    expect(await esquema()).toEqual(antes);
    expect(await count(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='cycle_config_version'`)).toBe(1);
    // Los siete CHECKs relajados por 0007 viven en tablas previas; relocation_origin (0008) trae el suyo propio.
    const checks = antes.filter((c) => { const n = String((c as { conname: string }).conname); return /period_ck|closed_through_ck|reopened_period_ck|start_month_ck/.test(n) && !n.startsWith("relocation_origin_"); });
    expect(checks.length).toBe(7);
    for (const c of checks) expect(String((c as { def: string }).def)).toContain("t?$");
    const memoria = antes.find((c) => (c as { conname: string }).conname === "relocation_origin_period_ck") as { def: string } | undefined;
    expect(memoria?.def).toContain("t?$");
  });
  it("TC-CIC-116e: un snapshot anterior a la feature carga en modo mes y se guarda sin alterar una celda", async () => {
    // @aitri-tc TC-CIC-116e
    const s = await newUser("cic-116@test.local");
    await sembrarReal(s);
    const antes = await sumas(s.userId);
    const { revision, state } = await getLedger(s);
    expect("cycles" in state).toBe(false);
    expect((await putLedger(s, state, revision)).status).toBe(200);
    expect(await sumas(s.userId)).toEqual(antes);
    expect(await count(sql`SELECT count(*)::int AS n FROM amount_cell WHERE owner_id=${s.userId} AND period='2026-08'`)).toBe(14);
  });
  it("TC-CIC-117f: los CHECKs relajados aceptan '2026-10t' y siguen rechazando basura", async () => {
    // @aitri-tc TC-CIC-117f
    const s = await newUser("cic-117@test.local");
    await sembrarSyn(s);
    const ins = (id: string, period: string) => testDb().execute(sql`INSERT INTO movement (owner_id,id,type,cat_id,sub_id,target,amount,period,created_at) VALUES (${s.userId},${id},'expense','c-comida',NULL,'c-comida',1,${period},1)`);
    await ins("m-ok", "2026-10t");
    expect(await count(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id=${s.userId} AND period='2026-10t'`)).toBe(1);
    for (const [id, p] of [["m-b1", "2026-1t"], ["m-b2", "2026-10tt"]] as const) {
      // Drizzle envuelve el error de Postgres: el SQLSTATE viaja en `cause`.
      await expect(ins(id, p)).rejects.toSatisfy((e: unknown) => {
        const cause = (e as { cause?: { code?: string } }).cause;
        return cause?.code === "23514" || /23514|movement_period_ck/.test(String(cause ?? e));
      });
    }
  });
});

describe("NFR-2408 — seguridad de las rutas nuevas", () => {
  it("TC-CIC-122f: sin sesión, preview y apply responden 401 sin cuerpo de datos", async () => {
    // @aitri-tc TC-CIC-122f
    const a = await previewPOST(req("/api/v1/ledger/cycles/preview", { method: "POST", origin: ORIGIN, body: { target: DIA21 } }));
    const b = await cyclesPUT(req("/api/v1/ledger/cycles", { method: "PUT", origin: ORIGIN, body: { baseRevision: 0, target: DIA21 } }));
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    const ja = await a.json(); const jb = await b.json();
    expect(ja).not.toHaveProperty("cycles"); expect(ja).not.toHaveProperty("relocation"); expect(jb).not.toHaveProperty("cycles");
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version`)).toBe(0);
  });
  it("TC-CIC-123f: autorización horizontal — la sesión de w1 no ve ni cambia la configuración de w0", async () => {
    // @aitri-tc TC-CIC-123f
    const w0 = await newUser("cic-123-w0@test.local");
    const w1 = await newUser("cic-123-w1@test.local");
    await sembrarSyn(w0); await sembrarSyn(w1);
    await activar(w0);
    const g = await getLedger(w1);
    expect(g.state.cycles).toBeUndefined();
    const res = await putCycles(w1, g.revision, { mode: "month" });
    expect(res.status).toBe(422); expect((await res.json()).error.code).toBe("no_change");
    const rows = [...(await testDb().execute(sql`SELECT anchor_day FROM cycle_config_version WHERE owner_id=${w0.userId}`))] as Array<{ anchor_day: number }>;
    expect(rows).toHaveLength(1); expect(rows[0]!.anchor_day).toBe(21);
  });
  it("TC-CIC-124f: valores extremos y de tipo incorrecto se rechazan con 422 invalid_payload", async () => {
    // @aitri-tc TC-CIC-124f
    const s = await newUser("cic-124@test.local");
    const R = await sembrarSyn(s);
    const casos = [
      { mode: "cycle", anchorDay: 9007199254740992, eomPolicy: "last_day" },
      { mode: "cycle", anchorDay: null, eomPolicy: "last_day" },
      { mode: "cycle", anchorDay: [21], eomPolicy: "last_day" },
      { mode: "cycle", anchorDay: "21", eomPolicy: "last_day" },
      { mode: "cycle", anchorDay: 21, eomPolicy: "last_day", firstPayDate: "a".repeat(10_000) },
    ];
    for (const target of casos) {
      const res = await putCycles(s, R, target);
      expect(res.status).toBe(422); expect((await res.json()).error.code).toBe("invalid_payload");
    }
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(0);
  });
  it("TC-CIC-125f: caracteres especiales e inyección en el cuerpo no alteran la base", async () => {
    // @aitri-tc TC-CIC-125f
    const s = await newUser("cic-125@test.local");
    const R = await sembrarSyn(s, { budgets: { "c-comida": { "2026-09": 1 } } });
    const antes = { cells: await count(sql`SELECT count(*)::int AS n FROM amount_cell`), movs: await count(sql`SELECT count(*)::int AS n FROM movement`), cfg: await count(sql`SELECT count(*)::int AS n FROM cycle_config_version`) };
    const casos = [
      { mode: "cycle", anchorDay: 21, eomPolicy: "last_day'; DROP TABLE cycle_config_version; --" },
      { mode: "cycle", anchorDay: 21, eomPolicy: "last_day", firstPayDate: "<script>alert(1)</script>" },
      { mode: "cycle", anchorDay: "21 ", eomPolicy: "last_day" },
    ];
    for (const target of casos) {
      const res = await putCycles(s, R, target);
      expect(res.status).toBe(422); expect((await res.json()).error.code).toBe("invalid_payload");
    }
    expect({ cells: await count(sql`SELECT count(*)::int AS n FROM amount_cell`), movs: await count(sql`SELECT count(*)::int AS n FROM movement`), cfg: await count(sql`SELECT count(*)::int AS n FROM cycle_config_version`) }).toEqual(antes);
  });
  it("TC-CIC-126f: Origin fuera de la allowlist responde 403 en las dos rutas", async () => {
    // @aitri-tc TC-CIC-126f
    const s = await newUser("cic-126@test.local");
    const R = await sembrarSyn(s);
    expect((await putCycles(s, R, DIA21, "https://evil.example")).status).toBe(403);
    expect((await preview(s, DIA21, "https://evil.example")).status).toBe(403);
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(0);
  });
  it("TC-CIC-127h: el dueño autenticado con Origin válido y cuerpo válido obtiene 200 en apply", async () => {
    // @aitri-tc TC-CIC-127h
    const s = await newUser("cic-127@test.local");
    const R = await sembrarSyn(s);
    const res = await putCycles(s, R, DIA21);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision).toBe(R + 1);
    expect(body.cycles.versions[0].anchorDay).toBe(21);
  });
  it("TC-CIC-128e: la regla de dominio del primer pago se impone en el servidor aunque el cliente la salte", async () => {
    // @aitri-tc TC-CIC-128e
    const s = await newUser("cic-128@test.local");
    await sembrarUsuario(s);
    await activar(s);
    process.env.LEDGER_TODAY = "2026-10-25";
    expect((await close(s)).status).toBe(200);
    expect((await close(s)).status).toBe(200);
    const { revision } = await getLedger(s);
    const res = await putCycles(s, revision, { mode: "cycle", anchorDay: 5, eomPolicy: "last_day", firstPayDate: "2026-10-05" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("first_pay_invalid");
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(1);
  });
});

describe("NFR-2410 — observabilidad", () => {
  it("TC-CIC-133e: cada petición a las rutas nuevas deja una línea de log con método, ruta y estado", async () => {
    // @aitri-tc TC-CIC-133e
    const s = await newUser("cic-133@test.local");
    await sembrarSyn(s);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect((await preview(s, DIA21)).status).toBe(200);
      const lineas = spy.mock.calls.map((c) => String(c[0]));
      expect(lineas.some((l) => /^\[\d{4}-\d{2}-\d{2}T.*\] POST \/api\/v1\/ledger\/cycles\/preview 200 \(\d+ms\) rid=/.test(l))).toBe(true);
    } finally { spy.mockRestore(); }
  });
  it("TC-CIC-134f: un rechazo también queda en el log con su estado, y /health sigue en 200", async () => {
    // @aitri-tc TC-CIC-134f
    const s = await newUser("cic-134@test.local");
    const R = await sembrarSyn(s);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect((await putCycles(s, R, { mode: "cycle", anchorDay: 40, eomPolicy: "last_day" })).status).toBe(422);
      expect(spy.mock.calls.map((c) => String(c[0])).some((l) => l.includes("PUT /api/v1/ledger/cycles 422"))).toBe(true);
    } finally { spy.mockRestore(); }
    expect((await healthGET(req("/health"))).status).toBe(200);
  });
});

// ═══════════════════════════ EP-04 — regresión de modo mes y volumen en el servidor ═══════════════════════════
describe("NFR-2401 / NFR-2409 — EP-04 en el servidor", () => {
  it("TC-CIC-101f: en modo mes una clave con sufijo no puede persistirse", async () => {
    // @aitri-tc TC-CIC-101f
    const s = await newUser("cic-101@test.local");
    await sembrarSyn(s, { budgets: { "c-comida": { "2026-09": 1000 } } });
    const antes = await getLedger(s);
    const conSufijo: LedgerState = {
      ...antes.state,
      budgets: { ...antes.state.budgets, "c-comida": { ...antes.state.budgets["c-comida"], "2026-10t": 100 } },
    };
    const res = await putLedger(s, conSufijo, antes.revision);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("period_mismatch");
    expect(await getLedger(s)).toEqual(antes);
  });

  it("TC-CIC-130e: reubicar 5000 celdas y 2000 movimientos tarda menos de 2 s y cumple los invariantes", async () => {
    // @aitri-tc TC-CIC-130e
    // NOTA DE BUILD: el TC nombra la cuenta e2e-w2; aquí es un usuario del Postgres de Testcontainers,
    // que es donde la medida del servidor no se mezcla con el arranque de Next ni con el navegador.
    const s = await newUser("cic-130@test.local");
    expect((await putLedger(s, { ...estadoGrande(5000, 2000), ownerId: s.userId }, 0)).status).toBe(200);
    const { revision } = await getLedger(s);
    const antes = await sumas(s.userId);
    expect(antes.budget).toBeGreaterThan(0);
    const celdasAntes = await count(sql`SELECT count(*)::int AS n FROM amount_cell WHERE owner_id=${s.userId}`);

    const t0 = performance.now();
    const res = await putCycles(s, revision, DIA21);
    const ms = performance.now() - t0;
    expect(res.status, await res.clone().text()).toBe(200);
    expect(ms, `PUT /cycles sobre F-BIG en ${ms.toFixed(0)} ms`).toBeLessThan(2000);

    expect(await sumas(s.userId)).toEqual(antes);
    expect(await filasMemoria(s.userId)).toBe(celdasAntes);
    const { state } = await getLedger(s);
    const cal = buildCalendar(state.cycles!, { from: "2026-01", to: "2029-12" });
    const validas = new Set(cal.keys("2026-01", "2029-12"));
    const periodos = [...(await testDb().execute(sql`SELECT DISTINCT period FROM amount_cell WHERE owner_id=${s.userId} UNION SELECT DISTINCT period FROM movement WHERE owner_id=${s.userId}`))] as Array<{ period: string }>;
    expect(periodos.length).toBeGreaterThan(0);
    expect(periodos.map((r) => r.period).filter((p) => !validas.has(p))).toEqual([]);
  }, 60_000);

  it("TC-CIC-131f: una reubicación grande que viola una invariante aborta en < 2 s sin escribir nada", async () => {
    // @aitri-tc TC-CIC-131f
    const s = await newUser("cic-131@test.local");
    const big = estadoGrande(5000, 2000);
    // Mismo caso que TC-CIC-170f/171f, a escala: el residuo tecleado de agosto sigue al aporte fechado
    // del 25-ago a «Septiembre», y el retiro del 15-ago se queda en «Agosto» sin fondos.
    const aporte = mvTransfer("@disponible", "c-alcancia", 10_000, "2026-08-25", "2026-08");
    const retiro = mvTransfer("c-alcancia", "@disponible", 60_000, "2026-08-15", "2026-08");
    const estado: LedgerState = {
      ...big, ownerId: s.userId,
      movements: [...big.movements, aporte, retiro],
      actuals: { ...big.actuals, "c-alcancia": { "2026-08": 110_000 } },
    };
    expect((await putLedger(s, estado, 0)).status).toBe(200);
    const { revision } = await getLedger(s);
    const conteos = async () => [...(await testDb().execute(sql`
      SELECT 'celda' AS t, period, count(*)::int AS n FROM amount_cell WHERE owner_id=${s.userId} GROUP BY period
      UNION ALL
      SELECT 'mov' AS t, period, count(*)::int AS n FROM movement WHERE owner_id=${s.userId} GROUP BY period
      ORDER BY 1, 2`))];
    const antes = await conteos();

    const t0 = performance.now();
    const res = await putCycles(s, revision, DIA21);
    const ms = performance.now() - t0;
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; detail: { rule: string } } };
    expect(body.error.code).toBe("relocation_invariant");
    expect(body.error.detail.rule).toBe("reserve_floor");
    expect(ms, `rechazo sobre F-BIG en ${ms.toFixed(0)} ms`).toBeLessThan(2000);

    expect(await conteos()).toEqual(antes);
    expect(await count(sql`SELECT count(*)::int AS n FROM cycle_config_version WHERE owner_id=${s.userId}`)).toBe(0);
    expect((await getLedger(s)).revision).toBe(revision);
  }, 60_000);
});
