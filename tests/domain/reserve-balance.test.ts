/**
 * Feature transferencias · modelo v4 — FR-1009 (Balance: filas de un solo signo, Disponible del
 * mes, Saldo reservado acumulado) y NFR-1001 (conservación bajo secuencias mixtas).
 */
import { describe, it, expect } from "vitest";
import { AVAILABLE_ID, applyReserveCellEdit, applyReserveOp, resolvedBalance, reserveAportes, reserveLeafIds, reserveRetiros, setPlannedRetiro } from "@/domain/reserve";
import { removeOrFail, removeIfAllowed } from "../helpers/reserve";
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
        s = removeIfAllowed(s, retiros.pop()!);
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
    const s = makeState([{ id: "c-gasto", type: "expense" }, { id: "c-viaje", type: "transfer", actual: { ene: 200_000 } }, { id: "c-uk", type: "transfer" }]);
    const weird: Movement[] = [
      { id: "w-1", ownerId: "local", type: "expense", catId: "c-gasto", subId: null, target: "c-gasto", amount: 10_000, month: "feb", createdAt: 1, from: "c-viaje", to: AVAILABLE_ID },
      { id: "w-2", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 15_000, month: "feb", createdAt: 2 }, // viejo, sin from
      { id: "w-3", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 30_000, month: "feb", createdAt: 3, from: "c-viaje", to: AVAILABLE_ID }, // retiro REAL
      // BG-001 — el agujero que este centinela tenía: un MOVER alcancía→alcancía sale de una
      // alcancía igual que un retiro, pero jamás baja a Disponible. Antes se colaba aquí.
      { id: "w-4", ownerId: "local", type: "transfer", catId: "c-uk", subId: null, target: "c-uk", amount: 40_000, month: "feb", createdAt: 4, from: "c-viaje", to: "c-uk" },
    ];
    s.movements.push(...weird);
    expect(reserveRetiros(s, "feb", "actual")).toBe(30_000); // solo el retiro real, sin el mover
    expect(resolvedBalance(s, "c-viaje", "feb", "actual")).toBe(130_000); // el mover SÍ vacía el origen
  });
});

/**
 * BG-001 — un mover alcancía→alcancía se contaba a la vez como reserva (su llegada vive en la
 * celda del destino) y como retiro (sale de una alcancía real), así que el Balance anunciaba una
 * bajada a Disponible que nunca ocurrió y una reserva que era plata ya reservada. El usuario lo
 * encontró el 2026-08-29 con un mover de 9.200.300: veía el mismo dinero como retirado y como
 * reservado, sin forma de conciliarlo.
 */
describe("BG-001 · el mover alcancía→alcancía no es ni reserva ni retiro", () => {
  it("BG-001a: el mover no aparece en «Reservas del mes» ni en «Retiros del mes», y el neto no cambia", () => {
    const base = makeState([
      { id: "c-ingreso", type: "income" },
      { id: "c-viaje", type: "transfer" },
      { id: "c-uk", type: "transfer" },
    ]);
    let s = addMovement(base, { type: "income", catId: "c-ingreso", amount: 500_000, month: "jul" });
    s = op(s, { from: AVAILABLE_ID, to: "c-viaje", month: "jul", amount: 200_000 });

    // Sin el mover: jul reserva 200.000 y no retira nada.
    expect(reserveAportes(s, "jul", "actual")).toBe(200_000);
    expect(reserveRetiros(s, "jul", "actual")).toBe(0);
    const netoAntes = reserveNet(s, "jul", "actual");
    const julAntes = computeBalanceSeries(s).jul.actual;

    // El mover NO es plata nueva ni plata que baja: solo cambia de caja dentro de las reservas.
    s = op(s, { from: "c-viaje", to: "c-uk", month: "jul", amount: 150_000 });
    expect(s.actuals["c-uk"]?.jul ?? 0).toBe(0); // FR-1601: el mover NO escribe la celda del destino
    expect(reserveAportes(s, "jul", "actual")).toBe(200_000); // no infla las reservas
    expect(reserveRetiros(s, "jul", "actual")).toBe(0); // ni inventa un retiro

    // El neto y las tres cifras del Balance salen EXACTAMENTE iguales que antes del mover.
    expect(reserveNet(s, "jul", "actual")).toBe(netoAntes);
    const julDespues = computeBalanceSeries(s).jul.actual;
    expect([julDespues.available, julDespues.reservedBalance, julDespues.total])
      .toEqual([julAntes.available, julAntes.reservedBalance, julAntes.total]);

    // La plata se movió de verdad entre las dos alcancías.
    expect(resolvedBalance(s, "c-viaje", "jul", "actual")).toBe(50_000);
    expect(resolvedBalance(s, "c-uk", "jul", "actual")).toBe(150_000);
    assertConservation(s);
  });

  it("BG-001b: un retiro real sigue contando aunque haya moveres en el mismo mes", () => {
    const base = makeState([
      { id: "c-ingreso", type: "income" },
      { id: "c-viaje", type: "transfer" },
      { id: "c-uk", type: "transfer" },
    ]);
    let s = addMovement(base, { type: "income", catId: "c-ingreso", amount: 500_000, month: "jul" });
    s = op(s, { from: AVAILABLE_ID, to: "c-viaje", month: "jul", amount: 300_000 });
    s = op(s, { from: "c-viaje", to: "c-uk", month: "jul", amount: 100_000 }); // mover
    s = op(s, { from: "c-uk", to: AVAILABLE_ID, month: "jul", amount: 40_000 }); // retiro REAL

    expect(reserveAportes(s, "jul", "actual")).toBe(300_000);
    expect(reserveRetiros(s, "jul", "actual")).toBe(40_000); // el retiro, no el mover
    expect(reserveNet(s, "jul", "actual")).toBe(260_000);
    const jul = computeBalanceSeries(s).jul.actual;
    expect([jul.available, jul.reservedBalance, jul.total]).toEqual([240_000, 260_000, 500_000]);
    assertConservation(s);
  });

  it("BG-001c: el plano Pres. no conoce moveres (solo existen en el ejecutado)", () => {
    const base = makeState([{ id: "c-viaje", type: "transfer", budget: { jul: 100_000 } }, { id: "c-uk", type: "transfer" }]);
    expect(reserveAportes(base, "jul", "budget")).toBe(100_000);
  });
});
