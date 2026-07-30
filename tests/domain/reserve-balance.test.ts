/**
 * Feature transferencias · modelo v4 — FR-1009 (Balance: filas de un solo signo, Disponible del
 * mes, Saldo reservado acumulado) y NFR-1001 (conservación bajo secuencias mixtas).
 */
import { describe, it, expect } from "vitest";
import { AVAILABLE_ID, applyReserveCellEdit, applyReserveOp, removeReserveRetiro, resolvedBalance, reserveAportes, reserveLeafIds, reserveRetiros, setPlannedRetiro } from "@/domain/reserve";
import { addMovement } from "@/domain/mutations";
import { computeBalanceSeries, reserveNet } from "@/domain/balance";
import { MONTH_KEYS } from "@/domain/months";
import type { AmountMap, LedgerNode, LedgerState, MonthKey, Movement, NodeType } from "@/domain/types";

interface LeafSpec { id: string; type: NodeType; budget?: Partial<Record<MonthKey, number>>; actual?: Partial<Record<MonthKey, number>> }
function makeState(leaves: LeafSpec[]): LedgerState {
  const nodes: LedgerNode[] = []; const budgets: AmountMap = {}; const actuals: AmountMap = {}; const seen = new Set<NodeType>();
  leaves.forEach((l, i) => {
    if (!seen.has(l.type)) { seen.add(l.type); nodes.push({ id: `g-${l.type}`, ownerId: "local", type: l.type, level: "group", parentId: null, name: `Grupo ${l.type}`, icon: null, order: 0 }); }
    nodes.push({ id: l.id, ownerId: "local", type: l.type, level: "category", parentId: `g-${l.type}`, name: l.id, icon: null, order: i });
    if (l.budget) budgets[l.id] = { ...l.budget };
    if (l.actual) actuals[l.id] = { ...l.actual };
  });
  return { ownerId: "local", nodes, budgets, actuals, movements: [] };
}
function op(s: LedgerState, o: Parameters<typeof applyReserveOp>[1]): LedgerState {
  const r = applyReserveOp(s, o);
  if (!("state" in r)) throw new Error(`operación rechazada: ${JSON.stringify(r)}`);
  return r.state;
}
/** total(m) = total real previo + flujo(m) en ambos planos + Σ derivados == reservedBalance. */
function assertConservation(s: LedgerState) {
  const series = computeBalanceSeries(s);
  let prevTotalActual = 0;
  for (const mk of MONTH_KEYS) {
    const { budget, actual } = series[mk];
    expect(actual.total, `actual/${mk}`).toBe(prevTotalActual + actual.flow);
    expect(budget.total, `budget/${mk}`).toBe(prevTotalActual + budget.flow);
    const derivedSum = reserveLeafIds(s).reduce((acc, id) => acc + resolvedBalance(s, id, mk, "actual"), 0);
    expect(actual.reservedBalance, `Σderivados/${mk}`).toBe(derivedSum);
    prevTotalActual = actual.total;
  }
}

describe("FR-1009 · el Balance con filas de un solo signo", () => {
  it("TC-TRF4-009h: el escenario del usuario, número a número", () => {
    // @aitri-tc TC-TRF4-009h
    const base = makeState([{ id: "c-ingreso", type: "income" }, { id: "c-gasto", type: "expense" }, { id: "c-viaje", type: "transfer" }]);
    let s = addMovement(base, { type: "income", catId: "c-ingreso", amount: 500_000, month: "jul" });
    s = op(s, { from: AVAILABLE_ID, to: "c-viaje", month: "jul", amount: 200_000 });
    const jul = computeBalanceSeries(s).jul.actual;
    expect([jul.available, jul.reservedBalance, jul.total]).toEqual([300_000, 200_000, 500_000]);

    s = op(s, { from: "c-viaje", to: AVAILABLE_ID, month: "ago", amount: 50_000 });
    const sinGasto = computeBalanceSeries(s).ago.actual;
    expect([sinGasto.available, sinGasto.reservedBalance, sinGasto.total]).toEqual([350_000, 150_000, 500_000]);

    s = addMovement(s, { type: "expense", catId: "c-gasto", amount: 50_000, month: "ago" });
    const ago = computeBalanceSeries(s).ago.actual;
    expect([ago.available, ago.reservedBalance, ago.total]).toEqual([300_000, 150_000, 450_000]);
    // filas de un solo signo
    expect(reserveAportes(s, "jul", "actual")).toBe(200_000);
    expect(reserveRetiros(s, "jul", "actual")).toBe(0);
    expect(reserveAportes(s, "ago", "actual")).toBe(0);
    expect(reserveRetiros(s, "ago", "actual")).toBe(50_000);
  });

  it("TC-TRF4-009e: 'Disponible del mes' es lo del MES y el reservado ARRASTRA el acumulado", () => {
    // @aitri-tc TC-TRF4-009e
    const base = makeState([{ id: "c-ingreso", type: "income", actual: { jul: 500_000 } }, { id: "c-viaje", type: "transfer", actual: { jul: 200_000 } }]);
    const series = computeBalanceSeries(base);
    // Disponible del mes (la fila nueva) = flow − reserved, sin arrastre.
    expect(series.jul.actual.flow - series.jul.actual.reserved).toBe(300_000);
    // sep sin operaciones: aportes 0, retiros 0 y el reservado arrastra el acumulado.
    expect(reserveAportes(base, "sep", "actual")).toBe(0);
    expect(reserveRetiros(base, "sep", "actual")).toBe(0);
    expect(series.sep.actual.reservedBalance).toBe(series.ago.actual.reservedBalance);
    expect(series.sep.actual.reservedBalance).toBe(200_000);
    expect(reserveNet(base, "sep", "actual")).toBe(0);
  });

  it("TC-TRF4-009f: total(m) = total(m−1) + flujo(m) para cualquier estado alcanzable", () => {
    // @aitri-tc TC-TRF4-009f
    const base = makeState([{ id: "c-ingreso", type: "income" }, { id: "c-gasto", type: "expense" }, { id: "c-viaje", type: "transfer" }, { id: "c-fondo", type: "transfer" }]);
    let s = addMovement(base, { type: "income", catId: "c-ingreso", amount: 1_500_000, month: "ene" });
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const leaves = ["c-viaje", "c-fondo"];
    for (let i = 0; i < 100; i++) {
      const month = MONTH_KEYS[Math.floor(rand() * 12)];
      const amount = Math.floor(rand() * 300_000) + 1;
      const a = leaves[Math.floor(rand() * 2)];
      const b = leaves.find((l) => l !== a)!;
      const kind = rand();
      const attempt = kind < 0.35
        ? applyReserveOp(s, { from: AVAILABLE_ID, to: a, month, amount })
        : kind < 0.65
          ? applyReserveOp(s, { from: a, to: AVAILABLE_ID, month, amount })
          : applyReserveOp(s, { from: a, to: b, month, amount });
      if ("state" in attempt) s = attempt.state;
      if (i % 10 === 0) s = addMovement(s, { type: rand() < 0.5 ? "expense" : "income", catId: rand() < 0.5 ? "c-gasto" : "c-ingreso", amount: 50_000, month });
    }
    assertConservation(s);
  });
});

describe("NFR-1001 · conservación bajo el modelo v4", () => {
  it("TC-TRF4-151h: conservación bajo secuencias mixtas, retiros y eliminaciones incluidos", () => {
    // @aitri-tc TC-TRF4-151h
    const base = makeState([{ id: "c-ingreso", type: "income" }, { id: "c-gasto", type: "expense" }, { id: "c-a", type: "transfer" }, { id: "c-b", type: "transfer" }]);
    let s = addMovement(base, { type: "income", catId: "c-ingreso", amount: 2_000_000, month: "ene" });
    let seed = 99;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const leaves = ["c-a", "c-b"];
    const retiros: string[] = [];
    let accepted = 0;
    for (let i = 0; i < 120; i++) {
      const month = MONTH_KEYS[Math.floor(rand() * 12)];
      const amount = Math.floor(rand() * 250_000) + 1;
      const a = leaves[Math.floor(rand() * 2)];
      const b = leaves.find((l) => l !== a)!;
      const kind = rand();
      if (kind < 0.25) {
        const r = applyReserveOp(s, { from: AVAILABLE_ID, to: a, month, amount });
        if ("state" in r) { s = r.state; accepted++; }
      } else if (kind < 0.45) {
        const r = applyReserveOp(s, { from: a, to: AVAILABLE_ID, month, amount });
        if ("state" in r) { s = r.state; retiros.push(r.movement.id); accepted++; }
      } else if (kind < 0.6) {
        const r = applyReserveOp(s, { from: a, to: b, month, amount });
        if ("state" in r) { s = r.state; accepted++; }
      } else if (kind < 0.72) {
        const r = applyReserveCellEdit(s, { leafId: a, month, plane: "budget", newAmount: amount });
        if ("state" in r) { s = r.state; accepted++; }
      } else if (kind < 0.8) {
        const r = setPlannedRetiro(s, month, Math.floor(amount / 2));
        if ("state" in r) { s = r.state; accepted++; }
      } else if (kind < 0.9 && retiros.length > 0) {
        s = removeReserveRetiro(s, retiros.pop()!);
        accepted++;
      } else {
        s = addMovement(s, { type: rand() < 0.5 ? "expense" : "income", catId: rand() < 0.5 ? "c-gasto" : "c-ingreso", amount: 40_000, month });
        accepted++;
      }
      assertConservation(s);
    }
    expect(accepted).toBeGreaterThan(60); // el fuzz ejerció de verdad
  });

  it("TC-TRF4-151e: conservación con operaciones entrelazadas en ambos planos", () => {
    // @aitri-tc TC-TRF4-151e
    const base = makeState([
      { id: "c-ingreso", type: "income", budget: { ene: 900_000, jun: 200_000 } },
      { id: "c-gasto", type: "expense", budget: { feb: 150_000 } },
      { id: "c-viaje", type: "transfer" },
    ]);
    let s = addMovement(base, { type: "income", catId: "c-ingreso", amount: 700_000, month: "ene" });
    s = op(s, { from: AVAILABLE_ID, to: "c-viaje", month: "ene", amount: 300_000 });
    const p1 = applyReserveCellEdit(s, { leafId: "c-viaje", month: "feb", plane: "budget", newAmount: 200_000 });
    if (!("state" in p1)) throw new Error("el plan jamás bloquea aportes");
    s = p1.state;
    const p2 = setPlannedRetiro(s, "mar", 150_000);
    if (!("state" in p2)) throw new Error("retiro planeado válido rechazado");
    s = p2.state;
    s = op(s, { from: "c-viaje", to: AVAILABLE_ID, month: "jun", amount: 50_000 });
    assertConservation(s);
    // el plan jamás altera el ejecutado
    expect(s.actuals["c-viaje"]).toEqual({ ene: 300_000 });
  });

  it("TC-TRF4-151f: mutación centinela: solo los retiros reales cuentan como retiros", () => {
    // @aitri-tc TC-TRF4-151f
    const s = makeState([{ id: "c-gasto", type: "expense" }, { id: "c-viaje", type: "transfer", actual: { ene: 200_000 } }]);
    const weird: Movement[] = [
      { id: "w-1", ownerId: "local", type: "expense", catId: "c-gasto", subId: null, target: "c-gasto", amount: 10_000, month: "feb", createdAt: 1, from: "c-viaje", to: AVAILABLE_ID },
      { id: "w-2", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 15_000, month: "feb", createdAt: 2 }, // viejo, sin from
      { id: "w-3", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 30_000, month: "feb", createdAt: 3, from: "c-viaje", to: AVAILABLE_ID }, // retiro REAL
    ];
    s.movements.push(...weird);
    expect(reserveRetiros(s, "feb", "actual")).toBe(30_000); // solo el retiro real
    expect(resolvedBalance(s, "c-viaje", "feb", "actual")).toBe(170_000);
  });
});
