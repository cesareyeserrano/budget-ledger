/**
 * Feature tony-ledger · EP-02 — Lecturas del agente, la parte pura.
 *
 * Módulo:       tests/unit/agente-lecturas.test.ts
 * Propósito:    Que el resumen salga de las funciones del dominio y no de una copia (FR-3415), que
 *               esas funciones den lo mismo que antes y no dependan de la marca de origen
 *               (NFR-3403), la marca de hoja del árbol (FR-3407) y las fronteras del calendario
 *               (FR-3417).
 * Dependencias: el dominio puro; ninguna base de datos.
 */
import { describe, expect, it } from "vitest";
import { buildSummary, monthRange } from "@/server/data/agentRepo";
import { serverScope } from "@/server/data/ledgerRepo";
import { rollupTable, typeTotals } from "@/domain/rollup";
import { computeBalanceSeries } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { reserveLeafIds, resolvedBalance } from "@/domain/reserve";
import { buildCalendar } from "@/domain/cycles";
import { isLeaf } from "@/domain/tree";
import { periodRange } from "@/domain/periods";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain";

const OWNER = "u-prueba";
const OCT: PeriodKey = "2026-10";

function nodo(id: string, type: LedgerNode["type"], level: LedgerNode["level"], parentId: string | null, order: number): LedgerNode {
  return { id, ownerId: OWNER, type, level, parentId, name: id, icon: null, order };
}
const NODOS: LedgerNode[] = [
  nodo("g-vida", "expense", "group", null, 0),
  nodo("c-alimentacion", "expense", "category", "g-vida", 1),
  nodo("s-mercado", "expense", "sub", "c-alimentacion", 2),
  nodo("s-restaurantes", "expense", "sub", "c-alimentacion", 3),
  nodo("c-transporte", "expense", "category", "g-vida", 4),
  nodo("g-ingresos", "income", "group", null, 5),
  nodo("c-salario", "income", "category", "g-ingresos", 6),
  nodo("g-reservas", "transfer", "group", null, 7),
  nodo("c-metas", "transfer", "category", "g-reservas", 8),
  nodo("s-viaje", "transfer", "sub", "c-metas", 9),
];

/** El estado fijo de NFR-3403: octubre con plan, ejecución y un aporte, sin apertura. */
function estadoFijo(): LedgerState {
  return {
    ownerId: OWNER, nodes: NODOS, movements: [],
    budgets: { "s-mercado": { [OCT]: 800_000 }, "s-restaurantes": { [OCT]: 200_000 } },
    actuals: {
      "s-mercado": { [OCT]: 320_000 }, "s-restaurantes": { [OCT]: 250_000 },
      "c-salario": { [OCT]: 3_000_000 }, "s-viaje": { [OCT]: 200_000 },
    },
  };
}

/** Seis periodos con movimientos de los tres tipos, incluidos un retiro y un mover. */
function estadoDeSeisPeriodos(conOrigen: boolean): LedgerState {
  const periodos = periodRange("2026-05", "2026-10");
  const actuals: LedgerState["actuals"] = { "s-mercado": {}, "s-restaurantes": {}, "c-transporte": {}, "c-salario": {}, "s-viaje": {} };
  const budgets: LedgerState["budgets"] = { "s-mercado": {}, "c-transporte": {} };
  const movements: Movement[] = [];
  let seq = 0;
  const mv = (m: Omit<Movement, "id" | "ownerId" | "createdAt">): void => {
    seq += 1;
    movements.push({
      ...m, id: `m-${seq}`, ownerId: OWNER, createdAt: seq,
      ...(conOrigen ? { origin: { ref: `L${seq}`, agentId: "agt_1", agentName: "Agent-L" } } : {}),
    });
  };
  periodos.forEach((p, i) => {
    budgets["s-mercado"]![p] = 500_000 + i * 10_000;
    budgets["c-transporte"]![p] = 100_000;
    actuals["c-salario"]![p] = 2_000_000 + i * 50_000;
    actuals["s-mercado"]![p] = 300_000 + i * 7_000;
    actuals["s-restaurantes"]![p] = 90_000;
    actuals["c-transporte"]![p] = 40_000 + i * 1_000;
    actuals["s-viaje"]![p] = 150_000;
    mv({ type: "income", catId: "c-salario", subId: null, target: "c-salario", amount: 2_000_000 + i * 50_000, period: p });
    mv({ type: "expense", catId: "c-alimentacion", subId: "s-mercado", target: "s-mercado", amount: 300_000 + i * 7_000, period: p });
    mv({ type: "transfer", catId: "c-metas", subId: "s-viaje", target: "s-viaje", amount: 150_000, period: p, from: "@disponible", to: "s-viaje" });
    if (i === 3) mv({ type: "transfer", catId: "c-metas", subId: "s-viaje", target: "s-viaje", amount: 100_000, period: p, from: "s-viaje", to: "@disponible" });
  });
  return { ownerId: OWNER, nodes: NODOS, budgets, actuals, movements };
}

describe("FR-3415 — el resumen sale del dominio", () => {
  it("TC-AGT-151h: el resumen sale de las funciones del dominio, no de una copia", () => {
    // @aitri-tc TC-AGT-151h
    const state = estadoDeSeisPeriodos(false);
    const periodos = periodRange("2026-05", "2026-10");
    let comparadas = 0;
    for (const p of periodos) {
      const r = buildSummary(state, 7, p);
      const tabla = rollupTable(state, [p]);
      const scope = serverScope(state, p);
      const plano = computeBalanceSeries(state, scope, openingCarry(state, scope))[p].actual;

      expect(r.nodes).toHaveLength(NODOS.length);
      for (const n of r.nodes) {
        const c = tabla.cell(n.id, p);
        expect([n.budget, n.actual, n.remaining], `${n.id} ${p}`).toEqual([c.budget, c.actual, c.budget - c.actual]);
        comparadas += 1;
      }
      expect(r.totals.income).toEqual(typeTotals(state, "income", [p]));
      const gastos = typeTotals(state, "expense", [p]);
      expect(r.totals.expense).toEqual({ ...gastos, remaining: gastos.budget - gastos.actual });
      expect(r.balance).toEqual({ available: plano.available, reserved: plano.reservedBalance });
      expect(r.pockets.map((k) => k.id)).toEqual(reserveLeafIds(state));
      for (const k of r.pockets) expect(k.balance).toBe(resolvedBalance(state, k.id, p, "actual", scope));
      expect(r.revision).toBe(7);
    }
    expect(comparadas).toBe(periodos.length * NODOS.length);
    // Y las cifras no son cero por accidente: el retiro del cuarto periodo se nota en el saldo.
    expect(buildSummary(state, 7, OCT).pockets[0].balance).toBe(6 * 150_000 - 100_000);
  });
});

describe("NFR-3403 — las cifras de la pantalla no cambian", () => {
  it("TC-AGT-210h: las funciones de cálculo devuelven lo mismo que antes", () => {
    // @aitri-tc TC-AGT-210h
    const state = estadoFijo();
    expect(rollupTable(state, [OCT]).cell("c-alimentacion", OCT)).toEqual({ budget: 1_000_000, actual: 570_000 });
    expect(typeTotals(state, "expense", [OCT])).toEqual({ budget: 1_000_000, actual: 570_000 });
    expect(typeTotals(state, "income", [OCT])).toEqual({ budget: 0, actual: 3_000_000 });
    const plano = computeBalanceSeries(state, [OCT])[OCT].actual;
    expect(plano.available).toBe(2_230_000);
    expect(plano.reservedBalance).toBe(200_000);
  });

  it("TC-AGT-211e: un movimiento con marca cuenta igual que uno sin marca", () => {
    // @aitri-tc TC-AGT-211e
    const sin = estadoDeSeisPeriodos(false);
    const con = estadoDeSeisPeriodos(true);
    expect(con.movements.every((m) => m.origin?.agentName === "Agent-L")).toBe(true);
    expect(sin.movements.some((m) => m.origin)).toBe(false);

    const periodos = periodRange("2026-05", "2026-10");
    expect(computeBalanceSeries(con, periodos)).toEqual(computeBalanceSeries(sin, periodos));
    for (const p of periodos) {
      for (const n of NODOS) expect(rollupTable(con, [p]).cell(n.id, p)).toEqual(rollupTable(sin, [p]).cell(n.id, p));
      for (const tipo of ["income", "expense", "transfer"] as const) expect(typeTotals(con, tipo, [p])).toEqual(typeTotals(sin, tipo, [p]));
      expect(resolvedBalance(con, "s-viaje", p, "actual", periodos)).toBe(resolvedBalance(sin, "s-viaje", p, "actual", periodos));
      const { revision: _a, ...resumenCon } = buildSummary(con, 1, p);
      const { revision: _b, ...resumenSin } = buildSummary(sin, 2, p);
      expect(resumenCon).toEqual(resumenSin);
    }
  });
});

describe("FR-3407 — la marca de hoja", () => {
  it("TC-AGT-074e: la marca de hoja coincide con la regla del dominio", () => {
    // @aitri-tc TC-AGT-074e
    const nodos: LedgerNode[] = [
      nodo("g-x", "expense", "group", null, 0),
      nodo("c-a", "expense", "category", "g-x", 1),
      nodo("s-a1", "expense", "sub", "c-a", 2),
      nodo("s-a2", "expense", "sub", "c-a", 3),
      nodo("c-b", "expense", "category", "g-x", 4),
    ];
    const hoja = Object.fromEntries(nodos.map((n) => [n.id, isLeaf(n, nodos)]));
    expect(hoja).toEqual({ "g-x": false, "c-a": false, "s-a1": true, "s-a2": true, "c-b": true });
  });
});

describe("FR-3417 — fronteras del calendario", () => {
  it("TC-AGT-173e: la frontera del ciclo cae entre el día 20 y el 21", () => {
    // @aitri-tc TC-AGT-173e
    const cal = buildCalendar(
      { mode: "cycle", versions: [{ seq: 1, mode: "cycle", anchorDay: 21, eomPolicy: "last_day", effectiveFrom: "2026-01-01", firstPay: null, restoreStartMonth: null, createdAt: "2026-01-01T00:00:00Z" }] },
      { from: "2026-01", to: "2028-12" }
    );
    const dia20 = cal.periodForDate("2026-10-20");
    const dia21 = cal.periodForDate("2026-10-21");
    expect(dia21).not.toBe(dia20);
    expect(cal.next(dia20)).toBe(dia21);
    expect(cal.rangeOf(dia20)).toEqual({ start: "2026-09-21", end: "2026-10-20" });
    expect(cal.rangeOf(dia21)!.start).toBe("2026-10-21");
    expect(() => cal.periodForDate("2028-02-29")).not.toThrow();
    expect(cal.rangeOf(cal.periodForDate("2028-02-29"))).toEqual({ start: "2028-02-21", end: "2028-03-20" });
  });

  it("TC-AGT-174h: en modo mes el rango es el primer y el último día del mes", () => {
    // @aitri-tc TC-AGT-174h
    expect(monthRange("2027-02")).toEqual({ start: "2027-02-01", end: "2027-02-28" });
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});
