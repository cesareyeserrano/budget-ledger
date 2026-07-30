/**
 * Feature transferencias (Reservas) — EP-02: el Balance deriva de saldos resueltos.
 * FR-1009 (reserveNet = delta de saldos; filas Reservas/Retiros de un solo signo) y NFR-1001
 * (conservación total = total previo + flujo bajo las operaciones nuevas, reserved negativo incluido).
 */
import { describe, it, expect } from "vitest";
import {
  AVAILABLE_ID,
  applyReserveCellEdit,
  applyReserveOp,
  reserveAportes,
  reserveRetiros,
} from "@/domain/reserve";
import { addMovement } from "@/domain/mutations";
import { computeBalanceSeries, reserveNet } from "@/domain/balance";
import { MONTH_KEYS } from "@/domain/months";
import type { AmountMap, LedgerNode, LedgerState, MonthKey, NodeType } from "@/domain/types";

interface LeafSpec {
  id: string;
  type: NodeType;
  budget?: Partial<Record<MonthKey, number>>;
  actual?: Partial<Record<MonthKey, number>>;
}

function makeState(leaves: LeafSpec[]): LedgerState {
  const nodes: LedgerNode[] = [];
  const budgets: AmountMap = {};
  const actuals: AmountMap = {};
  const seen = new Set<NodeType>();
  leaves.forEach((l, i) => {
    if (!seen.has(l.type)) {
      seen.add(l.type);
      nodes.push({ id: `g-${l.type}`, ownerId: "local", type: l.type, level: "group", parentId: null, name: `Grupo ${l.type}`, icon: null, order: 0 });
    }
    nodes.push({ id: l.id, ownerId: "local", type: l.type, level: "category", parentId: `g-${l.type}`, name: l.id, icon: null, order: i });
    if (l.budget) budgets[l.id] = { ...l.budget };
    if (l.actual) actuals[l.id] = { ...l.actual };
  });
  return { ownerId: "local", nodes, budgets, actuals, movements: [] };
}

/** Aplica una operación que DEBE pasar (falla el test si el dominio la rechaza). */
function op(s: LedgerState, o: Parameters<typeof applyReserveOp>[1]): LedgerState {
  const r = applyReserveOp(s, o);
  if (!("state" in r)) throw new Error(`operación rechazada: ${JSON.stringify(r)}`);
  return r.state;
}

/** La identidad de conservación en un plano: total(m) = total real previo + flujo(m). */
function assertConservation(s: LedgerState) {
  const series = computeBalanceSeries(s);
  let prevTotalActual = 0;
  for (const mk of MONTH_KEYS) {
    const { budget, actual } = series[mk];
    expect(actual.total, `actual/${mk}`).toBe(prevTotalActual + actual.flow);
    // El plan abre en el cierre REAL previo (ADR-03): misma identidad, anclada al real.
    expect(budget.total, `budget/${mk}`).toBe(prevTotalActual + budget.flow);
    prevTotalActual = actual.total;
  }
}

describe("FR-1009 · el Balance deriva de saldos resueltos", () => {
  it("TC-TRF-109h: el escenario del usuario, número a número, con las dos filas", () => {
    // @aitri-tc TC-TRF-109h
    const base = makeState([{ id: "c-ingreso", type: "income" }, { id: "c-gasto", type: "expense" }, { id: "c-viaje", type: "transfer" }]);
    // jul: flujo +500.000 y guardar 200.000
    let s = addMovement(base, { type: "income", catId: "c-ingreso", amount: 500_000, month: "jul" });
    s = op(s, { from: AVAILABLE_ID, to: "c-viaje", month: "jul", amount: 200_000 });
    const jul = computeBalanceSeries(s).jul.actual;
    expect(jul.available).toBe(300_000);
    expect(jul.reservedBalance).toBe(200_000);
    expect(jul.total).toBe(500_000);

    // ago: sacar 50.000 → el total NO cambia al sacar
    s = op(s, { from: "c-viaje", to: AVAILABLE_ID, month: "ago", amount: 50_000 });
    const agoSinGasto = computeBalanceSeries(s).ago.actual;
    expect(agoSinGasto.available).toBe(350_000);
    expect(agoSinGasto.reservedBalance).toBe(150_000);
    expect(agoSinGasto.total).toBe(500_000);

    // ago además con gasto de 50.000 → el total baja EXACTAMENTE el gasto
    s = addMovement(s, { type: "expense", catId: "c-gasto", amount: 50_000, month: "ago" });
    const ago = computeBalanceSeries(s).ago.actual;
    expect(ago.available).toBe(300_000);
    expect(ago.reservedBalance).toBe(150_000);
    expect(ago.total).toBe(450_000);

    // Las dos filas de un solo signo: aportes y retiros nunca llevan doble negativo.
    expect(reserveAportes(s, "jul", "actual")).toBe(200_000);
    expect(reserveRetiros(s, "jul", "actual")).toBe(0);
    expect(reserveAportes(s, "ago", "actual")).toBe(0);
    expect(reserveRetiros(s, "ago", "actual")).toBe(50_000);
    expect(reserveAportes(s, "ago", "actual")).toBeGreaterThanOrEqual(0);
    expect(reserveRetiros(s, "ago", "actual")).toBeGreaterThanOrEqual(0);
  });

  it("TC-TRF-109e: el arrastre no es movimiento: mes sin operaciones = Reservas 0 y Retiros 0", () => {
    // @aitri-tc TC-TRF-109e
    const s = makeState([
      { id: "c-viaje", type: "transfer", actual: { jul: 200_000 } },
      { id: "c-fondo", type: "transfer", actual: { feb: 300_000 } },
    ]);

    // sep no tiene operación alguna: ambas alcancías arrastran, y arrastrar no mueve plata.
    expect(reserveAportes(s, "sep", "actual")).toBe(0);
    expect(reserveRetiros(s, "sep", "actual")).toBe(0);
    expect(reserveNet(s, "sep", "actual")).toBe(0);
    // El negativo exacto de los retiros fantasma: reserved del mes es 0, no −500.000.
    expect(computeBalanceSeries(s).sep.actual.reserved).toBe(0);
  });

  it("TC-TRF-109f: ninguna secuencia de operaciones rompe total = total previo + flujo", () => {
    // @aitri-tc TC-TRF-109f
    const base = makeState([{ id: "c-ingreso", type: "income" }, { id: "c-gasto", type: "expense" }, { id: "c-viaje", type: "transfer" }, { id: "c-fondo", type: "transfer" }]);
    let s = addMovement(base, { type: "income", catId: "c-ingreso", amount: 1_000_000, month: "ene" });

    // Secuencia determinista de operaciones válidas e inválidas (las inválidas no mutan).
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const leaves = ["c-viaje", "c-fondo"];
    for (let i = 0; i < 120; i++) {
      const month = MONTH_KEYS[Math.floor(rand() * 12)];
      const amount = Math.floor(rand() * 400_000) + 1;
      const kind = rand();
      const a = leaves[Math.floor(rand() * 2)];
      const b = leaves.find((l) => l !== a)!;
      const attempt =
        kind < 0.4
          ? applyReserveOp(s, { from: AVAILABLE_ID, to: a, month, amount })
          : kind < 0.8
            ? applyReserveOp(s, { from: a, to: AVAILABLE_ID, month, amount })
            : applyReserveOp(s, { from: a, to: b, month, amount });
      if ("state" in attempt) s = attempt.state;
      if (i % 10 === 0) s = addMovement(s, { type: rand() < 0.5 ? "expense" : "income", catId: rand() < 0.5 ? "c-gasto" : "c-ingreso", amount: 50_000, month });
    }

    assertConservation(s);
  });
});

describe("NFR-1001 · conservación del balance bajo las operaciones nuevas", () => {
  it("TC-TRF-151h: conservación bajo reserved negativo: el retiro no toca el total", () => {
    // @aitri-tc TC-TRF-151h
    const base = makeState([{ id: "c-ingreso", type: "income" }, { id: "c-fondo", type: "transfer" }]);
    let s = addMovement(base, { type: "income", catId: "c-ingreso", amount: 800_000, month: "ene" });
    s = op(s, { from: AVAILABLE_ID, to: "c-fondo", month: "ene", amount: 500_000 });
    s = op(s, { from: "c-fondo", to: AVAILABLE_ID, month: "mar", amount: 200_000 });

    const mar = computeBalanceSeries(s).mar.actual;
    expect(mar.reserved).toBe(-200_000); // retiro neto: reserved NEGATIVO es legal (FR-1009)
    expect(mar.flow).toBe(0);
    expect(mar.total).toBe(computeBalanceSeries(s).feb.actual.total); // el retiro no crea ni destruye
    assertConservation(s);
  });

  it("TC-TRF-151e: conservación con operaciones en ambos planos entrelazadas", () => {
    // @aitri-tc TC-TRF-151e
    const base = makeState([
      { id: "c-ingreso", type: "income", budget: { ene: 900_000, jun: 200_000 } },
      { id: "c-gasto", type: "expense", budget: { feb: 150_000 } },
      { id: "c-viaje", type: "transfer" },
      { id: "c-fondo", type: "transfer" },
    ]);
    let s = addMovement(base, { type: "income", catId: "c-ingreso", amount: 700_000, month: "ene" });
    // Ejecutado: guardar, mover, sacar…
    s = op(s, { from: AVAILABLE_ID, to: "c-viaje", month: "ene", amount: 300_000 });
    // …entrelazado con el plan: trayectorias tecleadas en Pres. (avisa, jamás bloquea).
    const p1 = applyReserveCellEdit(s, { leafId: "c-viaje", month: "feb", plane: "budget", newBalance: 500_000 });
    if (!("state" in p1)) throw new Error("el plan jamás bloquea");
    s = p1.state;
    s = op(s, { from: "c-viaje", to: "c-fondo", month: "abr", amount: 100_000 });
    const p2 = applyReserveCellEdit(s, { leafId: "c-fondo", month: "may", plane: "budget", newBalance: 250_000 });
    if (!("state" in p2)) throw new Error("el plan jamás bloquea");
    s = p2.state;
    s = op(s, { from: "c-fondo", to: AVAILABLE_ID, month: "jun", amount: 50_000 });

    assertConservation(s); // la identidad se cumple en los 12 meses de AMBOS planos
  });

  it("TC-TRF-151f: mutación centinela: romper el arreglo de reserveNet hace fallar la suite", () => {
    // @aitri-tc TC-TRF-151f
    // El estado centinela: una alcancía que ARRASTRA su saldo con un mes explícito igual al previo.
    // La implementación vieja (typeTotals: sumar celdas como flujo) devolvería 200.000 en ago
    // (re-contando el saldo) y 0 en sep con delta −200.000 implícito en typeTotals... — cualquier
    // regresión a "sumar celdas" rompe estas tres aserciones a la vez.
    const s = makeState([{ id: "c-viaje", type: "transfer", actual: { jul: 200_000, ago: 200_000 } }]);

    expect(reserveNet(s, "jul", "actual")).toBe(200_000); // el aporte real de julio
    expect(reserveNet(s, "ago", "actual")).toBe(0); // saldo mantenido ≠ aporte nuevo (typeTotals diría 200.000)
    expect(reserveNet(s, "sep", "actual")).toBe(0); // arrastre ≠ retiro fantasma (typeTotals diría 0 pero el delta crudo −200.000)
    // Y el acumulado del balance no se duplica: reservado global constante desde julio.
    const series = computeBalanceSeries(s);
    expect(series.jul.actual.reservedBalance).toBe(200_000);
    expect(series.ago.actual.reservedBalance).toBe(200_000);
    expect(series.dic.actual.reservedBalance).toBe(200_000);
  });
});
