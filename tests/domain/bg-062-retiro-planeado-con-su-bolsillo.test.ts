/**
 * BG-062 — activar ciclos no separa el retiro planeado de un bolsillo de su aporte planeado.
 *
 * Cada fila del plan se reubicaba por su propia clave, y la de retiros planeados (`@retiros:<id>`)
 * no tiene movimientos propios que le digan a qué ciclo ir. Con el aporte del bolsillo fechado el
 * 25 de septiembre y día de pago 21, el aporte planeado iba al ciclo de octubre y el retiro planeado
 * se quedaba en el de septiembre: el plan del bolsillo quedaba en negativo. Y el piso que bloquea el
 * cambio solo miraba Ejecutado.
 */
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { isLeaf } from "@/domain/tree";
import { applyReserveOp, plannedRetiroKey, resolvedBalance, AVAILABLE_ID } from "@/domain/reserve";
import { buildCalendar, checkRelocationInvariants, relocate, MONTH_CALENDAR } from "@/domain/cycles";
import type { CycleConfig, LedgerState, PeriodKey } from "@/domain/types";

const SEP: PeriodKey = "2026-09";
const HOY = "2026-09-14";
const CFG21: CycleConfig = {
  mode: "cycle",
  versions: [{ seq: 1, mode: "cycle", anchorDay: 21, eomPolicy: "last_day", effectiveFrom: "2026-09-10", firstPay: null, restoreStartMonth: null, createdAt: "2026-09-10T00:00:00.000Z" }],
};
const CAL21 = buildCalendar(CFG21, { from: "2026-01", to: "2027-12" });

/** Ingreso 1.000.000; bolsillo con aporte REAL del 25-sep y 100.000 planeados de entrada y de salida. */
function escenario(): { state: LedgerState; bolsillo: string } {
  const seed = buildSeed("u", SEP);
  const ing = seed.nodes.find((n) => n.type === "income" && isLeaf(n, seed.nodes))!.id;
  const bolsillo = seed.nodes.find((n) => n.type === "transfer" && isLeaf(n, seed.nodes))!.id;
  const base: LedgerState = {
    ...seed, budgets: {}, movements: [],
    actuals: { [ing]: { [SEP]: 1_000_000 } },
  };
  const r = applyReserveOp(base, { from: AVAILABLE_ID, to: bolsillo, period: SEP, amount: 100_000, date: "2026-09-25T12:00" }, [SEP]);
  if (!("state" in r)) throw new Error(`no se pudo aportar: ${JSON.stringify(r)}`);
  const state: LedgerState = {
    ...r.state,
    budgets: { [bolsillo]: { [SEP]: 100_000 }, [plannedRetiroKey(bolsillo)]: { [SEP]: 100_000 } },
  };
  return { state, bolsillo };
}

describe("BG-062 — el retiro planeado viaja con su bolsillo", () => {
  it("activar ciclos deja el aporte y el retiro planeados en el MISMO ciclo, y el plan nunca negativo", () => {
    const { state, bolsillo } = escenario();
    const r = relocate(state, MONTH_CALENDAR, CAL21, HOY);
    expect("state" in r, JSON.stringify("blocked" in r ? r : "")).toBe(true);
    const next = (r as { state: LedgerState }).state;

    const aporte = Object.keys(next.budgets[bolsillo] ?? {}).filter((k) => (next.budgets[bolsillo]![k as PeriodKey] ?? 0) !== 0);
    const retiro = Object.keys(next.budgets[plannedRetiroKey(bolsillo)] ?? {}).filter((k) => (next.budgets[plannedRetiroKey(bolsillo)]![k as PeriodKey] ?? 0) !== 0);
    expect(retiro).toEqual(aporte);

    const periods = CAL21.keys("2026-08", "2026-11");
    for (const p of periods) expect(resolvedBalance(next, bolsillo, p, "budget", periods), p).toBeGreaterThanOrEqual(0);
  });
});

describe("BG-062 — el piso del plan bloquea la reubicación", () => {
  /** El estado con el retiro planeado movido a mano a un ciclo ANTERIOR al aporte: plan en negativo. */
  function separado(): { before: LedgerState; after: LedgerState; bolsillo: string } {
    const { state, bolsillo } = escenario();
    const r = relocate(state, MONTH_CALENDAR, CAL21, HOY) as { state: LedgerState };
    const fila = plannedRetiroKey(bolsillo);
    const k = Object.keys(r.state.budgets[bolsillo]!).find((x) => (r.state.budgets[bolsillo]![x as PeriodKey] ?? 0) !== 0) as PeriodKey;
    const antes = CAL21.prev(k);
    const after: LedgerState = { ...r.state, budgets: { ...r.state.budgets, [fila]: { [antes]: 100_000 } } };
    return { before: state, after, bolsillo };
  }

  it("un plan que queda en negativo se rechaza con reserve_floor", () => {
    const { before, after, bolsillo } = separado();
    const v = checkRelocationInvariants(before, after, CAL21, MONTH_CALENDAR);
    expect(v).toMatchObject({ ok: false, detail: { rule: "reserve_floor", leafId: bolsillo } });
  });

  it("control: si el plan YA venía en negativo antes del cambio, no se bloquea por él", () => {
    const { before, after, bolsillo } = separado();
    // El plan de antes ya era negativo: solo retiro planeado, sin aporte.
    const yaNegativo: LedgerState = { ...before, budgets: { [plannedRetiroKey(bolsillo)]: { [SEP]: 100_000 } } };
    const sinAporte: LedgerState = { ...after, budgets: { [plannedRetiroKey(bolsillo)]: after.budgets[plannedRetiroKey(bolsillo)]! } };
    expect(checkRelocationInvariants(yaNegativo, sinAporte, CAL21, MONTH_CALENDAR)).toEqual({ ok: true });
  });
});
