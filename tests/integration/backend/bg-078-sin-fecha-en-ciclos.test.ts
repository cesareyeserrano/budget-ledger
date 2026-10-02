/**
 * BG-078 (a) — un movimiento viejo sin fecha no deja el libro sin poder guardar.
 *
 * Módulo:       tests/integration/backend/bg-078-sin-fecha-en-ciclos.test.ts
 * Propósito:    Un movimiento sin fecha sobrevive a activar ciclos (FR-2404), pero la regla del servidor
 *               era absoluta: mientras existiera, TODO guardado respondía 422 period_mismatch. Ahora se
 *               aceptan los que ya estaban guardados así, y se sigue rechazando crear uno sin fecha,
 *               quitarle la fecha a uno o cambiar de periodo a uno sin fecha.
 * Dependencias: rutas reales PUT /api/v1/ledger y PUT /api/v1/ledger/cycles.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { PUT as cyclesPUT } from "@/app/api/v1/ledger/cycles/route";
import type { LedgerState, Movement } from "@/domain/types";
import { estadoSyn } from "../../fixtures/ciclos";

const ORIGIN = "http://localhost:3100";
type Sesion = { cookie: string; userId: string };

beforeEach(async () => { await truncateAll(); process.env.LEDGER_TODAY = "2026-09-10"; });
afterEach(() => { delete process.env.LEDGER_TODAY; });
afterAll(async () => { await closeTestDb(); });

function req(url: string, init: { method?: string; cookie: string; body?: unknown }): Request {
  return new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers: { cookie: init.cookie, origin: ORIGIN, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const getLedger = async (s: Sesion) =>
  (await (await ledgerGET(req("/api/v1/ledger", { cookie: s.cookie }))).json()) as { revision: number; state: LedgerState };
const putLedger = (s: Sesion, state: LedgerState, baseRevision: number) =>
  ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie: s.cookie, body: { baseRevision, state } }));

/** Un gasto viejo SIN fecha y otro con fecha, en modo mes; después se activan los ciclos (día 21). */
async function conMovimientoSinFecha(nombre: string): Promise<Sesion & { revision: number; state: LedgerState }> {
  const { cookie } = await signUp(`${nombre}@example.com`, "Contra$eña123", nombre, `10.78.1.${nombre.length}`);
  const s: Sesion = { cookie, userId: (await getSessionUser(new Headers({ cookie })))!.userId };
  const viejo: Movement = { id: "m-viejo", ownerId: s.userId, type: "expense", catId: "c-comida", subId: null, target: "c-comida", amount: 30_000, period: "2026-09", createdAt: 1 };
  const fechado: Movement = { ...viejo, id: "m-fechado", amount: 20_000, createdAt: 2, date: "2026-09-05T12:00" };
  const semilla = { ...estadoSyn({ actuals: { "c-comida": { "2026-09": 50_000 } }, movements: [viejo, fechado] }), ownerId: s.userId };
  expect((await putLedger(s, semilla, 0)).status).toBe(200);
  const activar = await cyclesPUT(req("/api/v1/ledger/cycles", { method: "PUT", cookie, body: { baseRevision: (await getLedger(s)).revision, target: { mode: "cycle", anchorDay: 21, eomPolicy: "last_day" } } }));
  expect(activar.status, await activar.clone().text()).toBe(200);
  const cargado = await getLedger(s);
  // El escenario es el del defecto: ciclos activos y el movimiento viejo sigue sin fecha.
  expect(cargado.state.cycles?.mode).toBe("cycle");
  expect(cargado.state.movements.find((m) => m.id === "m-viejo")?.date).toBeUndefined();
  return { ...s, ...cargado };
}
const error = async (res: Response) => ((await res.json()) as { error: { code: string; detail?: { ids?: string[] } } }).error;

describe("BG-078 (a) · movimientos viejos sin fecha con ciclos activos", () => {
  it("BG-078a: editar una celda que no tiene que ver se guarda (antes, 422)", async () => {
    const s = await conMovimientoSinFecha("bg078a-uno");
    const res = await putLedger(s, { ...s.state, budgets: { ...s.state.budgets, "c-transporte": { "2026-10": 80_000 } } }, s.revision);
    expect(res.status, await res.clone().text()).toBe(200);
    const despues = await getLedger(s);
    expect(despues.state.budgets["c-transporte"]?.["2026-10"]).toBe(80_000);
    expect(despues.state.movements.find((m) => m.id === "m-viejo")).toMatchObject({ amount: 30_000 });
  });

  it("BG-078a: ponerle fecha al movimiento viejo también se guarda", async () => {
    const s = await conMovimientoSinFecha("bg078a-dos0");
    const viejo = s.state.movements.find((m) => m.id === "m-viejo")!;
    // Con día de pago 21, una fecha dentro del ciclo en el que el movimiento ya estaba.
    const dentro = s.state.movements.find((m) => m.id === "m-fechado")!.period === viejo.period ? "2026-09-06T12:00" : `${viejo.period.slice(0, 7)}-10T12:00`;
    const res = await putLedger(s, { ...s.state, movements: s.state.movements.map((m) => (m.id === "m-viejo" ? { ...m, date: dentro } : m)) }, s.revision);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("BG-078a: crear un movimiento nuevo sin fecha se sigue rechazando, con su id", async () => {
    const s = await conMovimientoSinFecha("bg078a-tres0");
    const viejo = s.state.movements.find((m) => m.id === "m-viejo")!;
    const nuevo: Movement = { ...viejo, id: "m-nuevo-sin-fecha", amount: 5_000, createdAt: 99 };
    const actuals = { ...s.state.actuals, "c-comida": { ...s.state.actuals["c-comida"], [viejo.period]: (s.state.actuals["c-comida"]?.[viejo.period] ?? 0) + 5_000 } };
    const res = await putLedger(s, { ...s.state, actuals, movements: [nuevo, ...s.state.movements] }, s.revision);
    expect(res.status).toBe(422);
    expect(await error(res)).toEqual({ code: "period_mismatch", detail: { ids: ["m-nuevo-sin-fecha"] } });
  });

  it("BG-078a: quitarle la fecha a un movimiento que la tenía se sigue rechazando", async () => {
    const s = await conMovimientoSinFecha("bg078a-cuatro");
    const sinFecha = s.state.movements.map((m) => { if (m.id !== "m-fechado") return m; const { date: _quitada, ...resto } = m; void _quitada; return resto as Movement; });
    const res = await putLedger(s, { ...s.state, movements: sinFecha }, s.revision);
    expect(res.status).toBe(422);
    expect(await error(res)).toEqual({ code: "period_mismatch", detail: { ids: ["m-fechado"] } });
  });

  it("BG-078a: cambiar de periodo al movimiento viejo, todavía sin fecha, se sigue rechazando", async () => {
    const s = await conMovimientoSinFecha("bg078a-cinco00");
    const res = await putLedger(s, { ...s.state, movements: s.state.movements.map((m) => (m.id === "m-viejo" ? { ...m, period: "2026-12" } : m)) }, s.revision);
    expect(res.status).toBe(422);
    expect((await error(res)).detail?.ids).toContain("m-viejo");
  });
});
