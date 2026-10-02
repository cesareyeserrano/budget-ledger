/**
 * BG-079 (a) — el ajuste de apertura de una celda de TRANSICIÓN lleva una fecha de su propio ciclo.
 *
 * La migración 0011 fechó todos sus ajustes el día 1 del mes de la clave. Para una clave de mes eso
 * está bien; para una de transición («2026-10t») no: un ciclo de transición empieza siempre el día 2
 * o después, así que el día 1 es del ciclo ANTERIOR. Un solo movimiento así hace que el servidor
 * rechace todo guardado con `period_mismatch`. La reparación le pone el primer día de su ciclo.
 */
import { describe, it, expect } from "vitest";
import { repairOpeningAdjustmentDates, OPENING_ADJUSTMENT_PREFIX } from "@/domain/adjust";
import { buildCalendar, isValidMovementPeriod, MONTH_CALENDAR } from "@/domain/cycles";
import type { CycleConfig, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

/** Día de pago 21, cambiado a 30 con primer pago el 30 de octubre: «2026-10t» va del 21 al 29. */
const CFG: CycleConfig = {
  mode: "cycle",
  versions: [
    { seq: 1, mode: "cycle", anchorDay: 21, eomPolicy: "last_day", effectiveFrom: "2026-01-01", firstPay: null, restoreStartMonth: "2026-01", createdAt: "2026-01-01T00:00:00.000Z" },
    { seq: 2, mode: "cycle", anchorDay: 30, eomPolicy: "last_day", effectiveFrom: "2026-10-30", firstPay: "2026-10-30", restoreStartMonth: null, createdAt: "2026-10-30T00:00:00.000Z" },
  ],
};
const CAL = buildCalendar(CFG, { from: "2026-01" as PeriodKey, to: "2027-12" as PeriodKey });
const T = "2026-10t" as PeriodKey;

const NODES: LedgerNode[] = [
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Esenciales", icon: null, order: 0 },
  { id: "c-taxi", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Taxi", icon: null, order: 1 },
];

function ajuste(id: string, period: PeriodKey, date: string | undefined, over: Partial<Movement> = {}): Movement {
  return {
    id, ownerId: "local", type: "expense", catId: "c-taxi", subId: null, target: "c-taxi", amount: 45_000, period, createdAt: 1,
    ...(date !== undefined ? { date } : {}), note: "Ajuste de apertura", kind: "adjustment", ...over,
  };
}
function estado(movements: Movement[]): LedgerState {
  return {
    ownerId: "local", nodes: NODES, budgets: {}, movements, cycles: CFG,
    actuals: { "c-taxi": { [T]: 45_000 } },
    cellNotes: { "c-taxi": { [T]: [{ id: "n1", createdAt: 2, text: "Un comentario" }] } },
  };
}

describe("BG-079 (a) · la fecha del ajuste de apertura en una clave de transición", () => {
  it("BG-079a: el escenario es el del defecto — el día 1 no pertenece al ciclo de transición", () => {
    expect(CAL.rangeOf(T)).toEqual({ start: "2026-10-21", end: "2026-10-29" });
    expect(isValidMovementPeriod(CAL, ajuste("x", T, "2026-10-01T12:00"))).toBe(false);
  });

  it("BG-079a: la reparación le pone el primer día de su ciclo, y nada más cambia", () => {
    const malo = ajuste(`${OPENING_ADJUSTMENT_PREFIX}aaaa`, T, "2026-10-01T12:00");
    const antes = estado([malo]);
    const { state: next, repaired } = repairOpeningAdjustmentDates(antes, CAL);

    expect(repaired).toEqual([malo.id]);
    expect(next.movements[0]).toEqual({ ...malo, date: "2026-10-21T12:00" });
    expect(isValidMovementPeriod(CAL, next.movements[0]!)).toBe(true);
    expect(next.actuals).toEqual(antes.actuals);
    expect(next.budgets).toEqual(antes.budgets);
    expect(next.cellNotes).toEqual(antes.cellNotes);
  });

  it("BG-079a: es idempotente — la segunda pasada devuelve el mismo objeto", () => {
    const una = repairOpeningAdjustmentDates(estado([ajuste(`${OPENING_ADJUSTMENT_PREFIX}aaaa`, T, "2026-10-01T12:00")]), CAL).state;
    const dos = repairOpeningAdjustmentDates(una, CAL);
    expect(dos.repaired).toEqual([]);
    expect(dos.state).toBe(una);
  });

  it("BG-079a: no toca lo que no es suyo", () => {
    const intactos = [
      ajuste(`${OPENING_ADJUSTMENT_PREFIX}mes`, "2026-09" as PeriodKey, "2026-09-01T12:00"), // clave de ciclo corriente: el día 1 sí es suyo
      ajuste("ajuste-del-usuario", T, "2026-10-01T12:00"),                                  // sin el prefijo de la migración
      ajuste(`${OPENING_ADJUSTMENT_PREFIX}bien`, T, "2026-10-25T12:00"),                    // ya está dentro de su ciclo
      ajuste(`${OPENING_ADJUSTMENT_PREFIX}fuera`, "2031-05" as PeriodKey, "2031-05-01T12:00"), // clave fuera de la tabla
    ];
    const s = estado(intactos);
    const r = repairOpeningAdjustmentDates(s, CAL);
    expect(r.repaired).toEqual([]);
    expect(r.state).toBe(s);
  });

  it("BG-079a: en modo mes no hay nada que reparar", () => {
    const s = estado([ajuste(`${OPENING_ADJUSTMENT_PREFIX}aaaa`, "2026-10" as PeriodKey, "2026-10-01T12:00")]);
    const r = repairOpeningAdjustmentDates(s, MONTH_CALENDAR);
    expect(r.state).toBe(s);
  });
});
