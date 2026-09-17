/**
 * Feature diario-de-celda — EP-02: el ajuste NEGATIVO visto por los agregados.
 *
 * Un ajuste puede restar (FR-2504), y hasta esta feature ningún movimiento lo hacía. Aquí se afirma
 * que todo lo que suma movimientos respeta ese signo: el roll-up de los padres, el Balance del mes y
 * la reubicación de ciclos — que es donde el signo se perdía (`placementContext` usaba `Math.abs`).
 */
import { describe, it, expect } from "vitest";
import { rollupActual } from "@/domain/rollup";
import { computeBalanceSeries } from "@/domain/balance";
import { buildCalendar, checkRelocationInvariants, placementContext, relocate, MONTH_CALENDAR } from "@/domain/cycles";
import type { CycleConfig, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";
import { P, M } from "../helpers/periods";

const SEP = M.sep;

const NODES: LedgerNode[] = [
  { id: "g-esenciales", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Esenciales", icon: null, order: 0 },
  { id: "c-comida", ownerId: "local", type: "expense", level: "category", parentId: "g-esenciales", name: "Comida", icon: null, order: 0 },
  { id: "s-rest", ownerId: "local", type: "expense", level: "sub", parentId: "c-comida", name: "Restaurantes", icon: null, order: 0 },
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 1 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
];

/** Restaurantes en septiembre: un gasto de 50.000 y un ajuste de −10.000 → la celda vale 40.000. */
function estado(): LedgerState {
  const movimientos: Movement[] = [
    {
      id: "m-gasto", ownerId: "local", type: "expense", catId: "c-comida", subId: "s-rest",
      target: "s-rest", amount: 50_000, period: SEP, createdAt: 1, date: "2026-09-05T12:00",
    },
    {
      id: "m-ajuste", ownerId: "local", type: "expense", catId: "c-comida", subId: "s-rest",
      target: "s-rest", amount: -10_000, period: SEP, createdAt: 2, date: "2026-09-06T12:00",
      note: "Ajuste manual", kind: "adjustment",
    },
  ];
  return {
    ownerId: "local",
    nodes: NODES,
    budgets: {},
    actuals: { "s-rest": { [SEP]: 40_000 }, "c-salario": { [SEP]: 3_000_000 } },
    movements: movimientos,
  };
}

const CFG21: CycleConfig = {
  mode: "cycle",
  versions: [{
    seq: 1, mode: "cycle", anchorDay: 21, eomPolicy: "last_day",
    effectiveFrom: "2026-01-01", firstPay: null, restoreStartMonth: "2026-01",
    createdAt: "2026-01-01T00:00:00.000Z",
  }],
};

describe("FR-2504 · los agregados cuentan el ajuste negativo con su signo", () => {
  it("TC-DDC-074e: roll-up, Balance y reubicación de ciclos respetan el signo", () => {
    // @aitri-tc TC-DDC-074e
    const s = estado();

    // (1) Roll-up: el padre y el grupo valen lo que vale la celda, no la suma de valores absolutos.
    expect(rollupActual(s, "c-comida", SEP)).toBe(40_000);
    expect(rollupActual(s, "g-esenciales", SEP)).toBe(40_000);

    // (2) Balance del mes: el gasto EJECUTADO de septiembre es 40.000. La serie viene indexada por
    // periodo y cada mes trae sus dos planos.
    const serie = computeBalanceSeries(s, P);
    expect(serie[SEP]!.actual.expense).toBe(40_000);

    // (3) El contexto de ubicación del paso a ciclos cuenta −10.000, no +10.000. Es el punto exacto
    // donde el signo se perdía: `placementContext` aplicaba `Math.abs` porque hasta esta feature
    // ningún movimiento podía ser negativo.
    const cal21 = buildCalendar(CFG21, { from: "2026-01", to: "2027-12" });
    const ctx = placementContext(s, cal21, "activate");
    const porMes = ctx.byMonth.get("s-rest");
    const total = [...(porMes?.values() ?? [])].reduce((acc, m) => acc + [...m.values()].reduce((a, v) => a + v, 0), 0);
    expect(total, "50.000 − 10.000, no 50.000 + 10.000").toBe(40_000);

    // (4) Ida y vuelta a ciclos: la celda sigue en 40.000, el ajuste conserva su signo y los
    // invariantes de la reubicación no rechazan.
    const ida = relocate(s, MONTH_CALENDAR, cal21, "2026-09-14");
    if ("blocked" in ida) throw new Error(`la activación no debería bloquearse: ${ida.blocked}`);
    const vuelta = relocate(ida.state, cal21, MONTH_CALENDAR, "2026-09-14");
    if ("blocked" in vuelta) throw new Error(`la vuelta a mes no debería bloquearse: ${vuelta.blocked}`);
    const ajuste = vuelta.state.movements.find((m) => m.id === "m-ajuste")!;
    expect(ajuste.amount).toBe(-10_000);
    expect(ajuste.kind).toBe("adjustment");
    expect(vuelta.state.actuals["s-rest"]?.[SEP]).toBe(40_000);
    expect(checkRelocationInvariants(s, ida.state, cal21).ok).toBe(true);
    expect(checkRelocationInvariants(ida.state, vuelta.state, MONTH_CALENDAR).ok).toBe(true);
  });
});
