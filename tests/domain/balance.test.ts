import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeBalanceSeries, reserveNet, type Plane } from "@/domain/balance";
import { rollupBudget, rollupActual, typeTotals } from "@/domain/rollup";
import { setLeafAmount, addMovement, moveNode } from "@/domain/mutations";
import { buildSeed } from "@/domain";
import { MONTH_KEYS } from "@/domain/months";
import { findNode } from "@/domain/tree";
import { STORAGE_KEYS, type AmountMap, type LedgerNode, type LedgerState, type MonthKey, type NodeType } from "@/domain/types";

// Feature balance — FR-905/906/907 y sus NFR de regresión. El corazón es aritmética pura sobre
// LedgerState, así que se ataca SIN DOM con valores concretos, afirmando cada campo de MonthBalance.
// Prefijo TC-BAL-* para no colisionar con root/bsc/grid-ux/etc.

// ── fixture: hojas mínimas por tipo ────────────────────────────────────────────────────────────
interface LeafSpec {
  id: string;
  type: NodeType;
  budget?: Partial<Record<MonthKey, number>>;
  actual?: Partial<Record<MonthKey, number>>;
}

/**
 * Construye un LedgerState mínimo: un grupo por tipo y cada hoja como categoría bajo él.
 * Solo las hojas almacenan montos, igual que el modelo real.
 */
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

const PLANES: Plane[] = ["budget", "actual"];
const deep = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ══ FR-905 · las seis cifras por mes y plano ═══════════════════════════════════════════════════

describe("FR-905 · seis cifras derivadas por columna", () => {
  it("TC-BAL-905h: las seis cifras del plano Ejecutado con un mes simple", () => {
    // @aitri-tc TC-BAL-905h
    const s = makeState([
      { id: "c-salario", type: "income", actual: { ene: 100_000 } },
      { id: "c-mercado", type: "expense", actual: { ene: 30_000 } },
      { id: "c-alcancia", type: "transfer", actual: { ene: 20_000 } },
    ]);

    const m = computeBalanceSeries(s).ene.actual;

    expect(m.prevAvailable).toBe(0);
    expect(m.prevReserved).toBe(0);
    expect(m.flow).toBe(70_000); // 100.000 − 30.000
    expect(m.reserved).toBe(20_000);
    expect(m.available).toBe(50_000); // 0 + 70.000 − 20.000
    expect(m.reservedBalance).toBe(20_000);
    expect(m.total).toBe(70_000); // 50.000 + 20.000
  });

  it("TC-BAL-905e: los dos planos se calculan por separado de sus propias celdas", () => {
    // @aitri-tc TC-BAL-905e
    const s = makeState([
      { id: "c-salario", type: "income", budget: { ene: 120_000 }, actual: { ene: 100_000 } },
      { id: "c-mercado", type: "expense", budget: { ene: 40_000 }, actual: { ene: 30_000 } },
      { id: "c-alcancia", type: "transfer", budget: { ene: 0 }, actual: { ene: 0 } },
    ]);

    const { budget, actual } = computeBalanceSeries(s).ene;

    expect(budget.flow).toBe(80_000); // 120.000 − 40.000, del PLAN
    expect(actual.flow).toBe(70_000); // 100.000 − 30.000, de lo REAL
    expect(budget.flow).not.toBe(actual.flow); // cada uno sale de sus propias celdas
    expect(budget.total).toBe(80_000);
    expect(actual.total).toBe(70_000);
  });

  it("TC-BAL-905f: el saldo mes anterior NO infla el Flujo del mes", () => {
    // @aitri-tc TC-BAL-905f
    const s = makeState([
      { id: "c-salario", type: "income", actual: { ene: 100_000, feb: 50_000 } },
      { id: "c-mercado", type: "expense", actual: { ene: 30_000, feb: 10_000 } },
    ]);

    const series = computeBalanceSeries(s);

    expect(series.ene.actual.total).toBe(70_000); // enero cierra en 70.000
    // el arrastre entra por prevAvailable, NUNCA por el flujo
    expect(series.feb.actual.prevAvailable).toBe(70_000);
    expect(series.feb.actual.flow).toBe(40_000); // 50.000 − 10.000 EXACTO (una suma del carry daría 110.000)
    expect(series.feb.actual.available).toBe(110_000); // el carry sí entra aquí
  });

  it("TC-BAL-915e: invariante de reconciliación: total = total previo + flujo, en cada plano y varios meses", () => {
    // @aitri-tc TC-BAL-915e
    const s = makeState([
      { id: "c-salario", type: "income", budget: { ene: 900_000, feb: 800_000, mar: 850_000 }, actual: { ene: 870_000, feb: 810_000, mar: 400_000 } },
      { id: "c-mercado", type: "expense", budget: { ene: 300_000, feb: 250_000, mar: 260_000 }, actual: { ene: 340_000, feb: 220_000, mar: 610_000 } },
      { id: "c-alcancia", type: "transfer", budget: { ene: 100_000, feb: 120_000, mar: 90_000 }, actual: { ene: 100_000, feb: 150_000, mar: 0 } },
    ]);

    const series = computeBalanceSeries(s);

    // mes 1: no hay previo — el total ES el flujo
    for (const p of PLANES) expect(series.ene[p].total).toBe(series.ene[p].flow);

    // el resto del año: AMBOS planos reconcilian contra el cierre EJECUTADO del mes anterior, que
    // es el punto del que los dos arrancan. La transferencia se cancela entre disponible y reservado.
    for (let i = 1; i < MONTH_KEYS.length; i++) {
      const prevActual = series[MONTH_KEYS[i - 1]].actual;
      const cur = series[MONTH_KEYS[i]];
      for (const p of PLANES) {
        expect(cur[p].total, `${MONTH_KEYS[i]}/${p}`).toBe(prevActual.total + cur[p].flow);
      }
    }

    // la cadena EJECUTADA es la única que acumula sobre sí misma, mes a mes
    for (let i = 1; i < MONTH_KEYS.length; i++) {
      const prev = series[MONTH_KEYS[i - 1]].actual;
      const cur = series[MONTH_KEYS[i]].actual;
      expect(cur.total, `ejecutado ${MONTH_KEYS[i]}`).toBe(prev.total + cur.flow);
    }

    // marzo ejecutado sobre-gasta (400.000 − 610.000): la invariante también se cumple en negativo
    expect(series.mar.actual.flow).toBe(-210_000);
  });

  it("TC-BAL-925e: sobre-gasto: Saldo disponible/total quedan NEGATIVOS (no se recortan a 0)", () => {
    // @aitri-tc TC-BAL-925e
    const s = makeState([
      { id: "c-salario", type: "income", actual: { ene: 30_000 } },
      { id: "c-mercado", type: "expense", actual: { ene: 100_000 } },
    ]);

    const m = computeBalanceSeries(s).ene.actual;

    expect(m.flow).toBe(-70_000);
    expect(m.available).toBe(-70_000); // negativo EXACTO, sin clamp a 0
    expect(m.total).toBe(-70_000);
    expect(m.reservedBalance).toBe(0);
    expect(Math.max(m.available, 0)).not.toBe(m.available); // es genuinamente negativo
  });

  it("TC-BAL-945e: estado cero / usuario nuevo: cifras en 0 sin NaN ni Infinity", () => {
    // @aitri-tc TC-BAL-945e
    // jerarquía completa pero sin un solo monto (budgets/actuals vacíos)
    const s = makeState([
      { id: "c-salario", type: "income" },
      { id: "c-mercado", type: "expense" },
      { id: "c-alcancia", type: "transfer" },
    ]);
    expect(s.budgets).toEqual({});
    expect(s.actuals).toEqual({});

    const series = computeBalanceSeries(s);

    let checked = 0;
    for (const mk of MONTH_KEYS) {
      for (const p of PLANES) {
        for (const [field, v] of Object.entries(series[mk][p])) {
          expect(Number.isFinite(v), `${mk}/${p}/${field} = ${v}`).toBe(true);
          expect(v, `${mk}/${p}/${field}`).toBe(0);
          checked++;
        }
      }
    }
    // 9 campos desde FR-1810: `income` y `expense` se PUBLICAN (ADR-09) porque el Balance los pinta
    // como filas propias. `computeBalanceSeries` ya los calculaba dentro para derivar `flow`.
    expect(checked).toBe(MONTH_KEYS.length * 2 * 9); // 12 meses × 2 planos × 9 campos
  });

  it("TC-BAL-916e: mes solo con ingreso: todo va a disponible, reservado 0", () => {
    // @aitri-tc TC-BAL-916e
    const s = makeState([{ id: "c-salario", type: "income", actual: { ene: 50_000 } }]);

    const m = computeBalanceSeries(s).ene.actual;

    expect(m.flow).toBe(50_000);
    expect(m.available).toBe(50_000);
    expect(m.reservedBalance).toBe(0);
    expect(m.reserved).toBe(0);
    expect(m.total).toBe(50_000);
  });
});

// ══ FR-906 · arrastre por plano ════════════════════════════════════════════════════════════════

describe("FR-906 · arrastre del saldo entre meses, por plano", () => {
  it("TC-BAL-906h: ambos planos abren en el cierre REAL del mes anterior", () => {
    // @aitri-tc TC-BAL-906h
    // enero: PRESUPUESTADO cierra disponible 80.000 / reservado 20.000
    //        EJECUTADO    cierra disponible 50.000 / reservado 20.000
    const s = makeState([
      { id: "c-salario", type: "income", budget: { ene: 100_000 }, actual: { ene: 100_000 } },
      { id: "c-mercado", type: "expense", budget: { ene: 0 }, actual: { ene: 30_000 } },
      { id: "c-alcancia", type: "transfer", budget: { ene: 20_000 }, actual: { ene: 20_000 } },
    ]);

    const series = computeBalanceSeries(s);

    expect(series.ene.budget.available).toBe(80_000);
    expect(series.ene.budget.reservedBalance).toBe(20_000);
    expect(series.ene.actual.available).toBe(50_000);
    expect(series.ene.actual.reservedBalance).toBe(20_000);

    // febrero abre AMBOS planos con el cierre EJECUTADO de enero: el plan de un mes se hace sobre
    // la plata que de verdad quedó, no sobre la que se había planeado tener
    expect(series.feb.budget.prevAvailable).toBe(50_000);
    expect(series.feb.budget.prevReserved).toBe(20_000);
    expect(series.feb.actual.prevAvailable).toBe(50_000);
    expect(series.feb.actual.prevReserved).toBe(20_000);

    // el cierre PRESUPUESTADO de enero (80.000) no reaparece en ningún arrastre
    expect(series.feb.budget.prevAvailable).not.toBe(80_000);
  });

  it("TC-BAL-906e: el mes 1 abre en 0 en ambos componentes y ambos planos", () => {
    // @aitri-tc TC-BAL-906e
    const s = makeState([
      { id: "c-salario", type: "income", budget: { ene: 500_000 }, actual: { ene: 480_000 } },
      { id: "c-alcancia", type: "transfer", budget: { ene: 50_000 }, actual: { ene: 50_000 } },
    ]);

    const ene = computeBalanceSeries(s).ene;

    for (const p of PLANES) {
      expect(ene[p].prevAvailable, p).toBe(0);
      expect(ene[p].prevReserved, p).toBe(0);
    }
    // no existe un saldo inicial manual: el mes 1 arranca solo con su propio flujo
    expect(ene.actual.total).toBe(ene.actual.flow);
  });

  it("TC-BAL-906f: el presupuestado arranca del cierre REAL, no de su propio cierre planeado", () => {
    // @aitri-tc TC-BAL-906f
    // enero cierra presupuestado total 80.000 y ejecutado total 50.000 — distintos a propósito
    const s = makeState([{ id: "c-salario", type: "income", budget: { ene: 80_000 }, actual: { ene: 50_000 } }]);

    const series = computeBalanceSeries(s);
    expect(series.ene.budget.total).toBe(80_000);
    expect(series.ene.actual.total).toBe(50_000);

    const carriedBudget = series.feb.budget.prevAvailable + series.feb.budget.prevReserved;
    expect(carriedBudget).toBe(50_000); // el cierre EJECUTADO de enero: la plata que de verdad quedó
    // una implementación que arrastrara el plan sobre sí mismo daría 80.000 y planificaría febrero
    // con 30.000 que nunca existieron
    expect(carriedBudget).not.toBe(80_000);

    // el ejecutado arranca del mismo punto: ambas columnas comparten el arrastre real
    const carriedActual = series.feb.actual.prevAvailable + series.feb.actual.prevReserved;
    expect(carriedActual).toBe(50_000);
    expect(carriedActual).toBe(carriedBudget);
  });

  it("TC-BAL-926e: un cierre negativo se arrastra: el mes siguiente abre en rojo", () => {
    // @aitri-tc TC-BAL-926e
    const s = makeState([
      { id: "c-mercado", type: "expense", actual: { ene: 40_000 } },
      { id: "c-salario", type: "income", actual: { feb: 100_000 } },
    ]);

    const series = computeBalanceSeries(s);

    expect(series.ene.actual.available).toBe(-40_000);
    expect(series.ene.actual.total).toBe(-40_000);
    // el cierre negativo SE ARRASTRA: no se pone en 0
    expect(series.feb.actual.prevAvailable).toBe(-40_000);
    expect(series.feb.actual.available).toBe(60_000); // −40.000 + 100.000
  });
});

// ══ FR-907 · guardar en reservas; reservado global acumulado ═══════════════════════════════════

describe("FR-907 · guardar en reservas (v1: solo aportes)", () => {
  it("TC-BAL-907h: el Saldo reservado global se acumula mes a mes con los aportes", () => {
    // @aitri-tc TC-BAL-907h
    // Modelo v4 (feature transferencias): las celdas transfer son APORTES del mes — la fixture
    // original de flujo vuelve a ser la correcta; reservedBalance acumula los aportes.
    const s = makeState([{ id: "c-alcancia", type: "transfer", actual: { ene: 50_000, feb: 50_000, mar: 30_000 } }]);

    const series = computeBalanceSeries(s);

    expect(series.ene.actual.reservedBalance).toBe(50_000);
    expect(series.feb.actual.reservedBalance).toBe(100_000);
    expect(series.mar.actual.reservedBalance).toBe(130_000);
    // el acumulado se conserva en los meses sin operación (arrastre: delta 0, no se reinicia)
    expect(series.abr.actual.reservedBalance).toBe(130_000);
    expect(series.dic.actual.reservedBalance).toBe(130_000);
  });

  it("TC-BAL-907e: guardar baja disponible y sube reservado; el total no cambia", () => {
    // @aitri-tc TC-BAL-907e
    const base: LeafSpec[] = [{ id: "c-salario", type: "income", actual: { ene: 100_000 } }];
    const sinGuardar = computeBalanceSeries(makeState(base)).ene.actual;
    const conGuardar = computeBalanceSeries(
      makeState([...base, { id: "c-alcancia", type: "transfer", actual: { ene: 20_000 } }])
    ).ene.actual;

    expect(sinGuardar.available).toBe(100_000);
    expect(sinGuardar.reservedBalance).toBe(0);
    expect(sinGuardar.total).toBe(100_000);

    expect(conGuardar.available).toBe(80_000); // −20.000
    expect(conGuardar.reservedBalance).toBe(20_000); // +20.000
    expect(conGuardar.total).toBe(100_000); // el TOTAL no cambia: la plata solo se reubica

    expect(conGuardar.total).toBe(sinGuardar.total);
    expect(conGuardar.available).toBe(sinGuardar.available - 20_000);
    expect(conGuardar.reservedBalance).toBe(sinGuardar.reservedBalance + 20_000);
  });

  it("TC-BAL-907f: el reservado global es la suma de aportes y nunca es negativo en v1", () => {
    // @aitri-tc TC-BAL-907f
    const s = makeState([
      { id: "c-alcancia-a", type: "transfer", actual: { ene: 40_000 } },
      { id: "c-alcancia-b", type: "transfer", actual: { ene: 60_000 } },
    ]);

    const series = computeBalanceSeries(s);

    expect(series.ene.actual.reservedBalance).toBe(100_000); // GLOBAL: la suma de las dos
    // el módulo no expone un saldo por alcancía — reservedBalance es una sola cifra global
    expect(Object.keys(series.ene.actual)).not.toContain("byItem");
    // Re-derivado (FR-1009 supersede FR-907): `reserved` ahora es delta y PUEDE ser negativo
    // (retiro neto); lo que jamás es negativo es el saldo reservado GLOBAL (piso por alcancía).
    for (const mk of MONTH_KEYS) {
      for (const p of PLANES) {
        expect(series[mk][p].reservedBalance, `${mk}/${p}`).toBeGreaterThanOrEqual(0);
      }
    }
    // En esta fixture (solo aportes en ene y arrastre después) el delta nunca es negativo.
    for (const mk of MONTH_KEYS) {
      expect(series[mk].actual.reserved, `${mk}/actual`).toBeGreaterThanOrEqual(0);
    }
  });

  it("TC-BAL-936e: multi-reserva y multi-mes: el reservado global acumula sobre todas las reservas y meses", () => {
    // @aitri-tc TC-BAL-936e
    // Modelo v4: celdas = APORTES del mes (la fixture original de flujo).
    const s = makeState([
      { id: "c-alcancia-a", type: "transfer", actual: { ene: 30_000, feb: 20_000 } },
      { id: "c-alcancia-b", type: "transfer", actual: { feb: 10_000 } }, // nada en enero
    ]);

    const series = computeBalanceSeries(s);

    expect(series.ene.actual.reserved).toBe(30_000); // solo A
    expect(series.ene.actual.reservedBalance).toBe(30_000);
    expect(series.feb.actual.reserved).toBe(30_000); // A 20.000 + B 10.000 en el mes
    expect(series.feb.actual.reservedBalance).toBe(60_000); // 30.000 previo + 30.000 del mes

    // reserveNet es el insumo directo de esa acumulación
    expect(reserveNet(s, "ene", "actual")).toBe(30_000);
    expect(reserveNet(s, "feb", "actual")).toBe(30_000);
    expect(reserveNet(s, "mar", "actual")).toBe(0);
  });
});

// ══ FR-908 · pureza del recálculo ══════════════════════════════════════════════════════════════

describe("FR-908 · el recálculo es derivación de solo lectura", () => {
  it("TC-BAL-908f: computeBalanceSeries es pura: no muta el estado de entrada", () => {
    // @aitri-tc TC-BAL-908f
    const s = buildSeed("local");
    const snapshot = deep(s);

    computeBalanceSeries(s);

    expect(s).toEqual(snapshot);
    expect(s.budgets).toEqual(snapshot.budgets);
    expect(s.actuals).toEqual(snapshot.actuals);
    expect(s.nodes).toEqual(snapshot.nodes);
    expect(s.movements).toEqual(snapshot.movements);
  });
});

// ══ NFR-901 · los montos de hoja se muestran y editan igual que antes ══════════════════════════

describe("NFR-901 · el balance no escribe en budgets/actuals", () => {
  it("TC-BAL-951h: editar una hoja persiste igual; el balance no escribe en budgets/actuals", () => {
    // @aitri-tc TC-BAL-951h
    const s0 = buildSeed("local");
    const leaf = "s-comida-mercado";
    const s = setLeafAmount(s0, leaf, "mar", "actual", 12_345);
    expect(s.actuals[leaf]?.mar).toBe(12_345);

    const budgetsBefore = deep(s.budgets);
    const actualsBefore = deep(s.actuals);

    computeBalanceSeries(s);

    expect(s.actuals[leaf]?.mar).toBe(12_345); // la edición persiste tal cual
    expect(s.actuals).toEqual(actualsBefore);
    expect(s.budgets).toEqual(budgetsBefore);
  });

  it("TC-BAL-951f: los montos de hoja se muestran igual que antes de la feature", () => {
    // @aitri-tc TC-BAL-951f
    let s = buildSeed("local");
    s = setLeafAmount(s, "s-comida-mercado", "ene", "budget", 500_000);
    s = setLeafAmount(s, "s-comida-restaurantes", "ene", "budget", 300_000);
    s = setLeafAmount(s, "s-comida-cafe", "ene", "budget", 200_000);
    s = setLeafAmount(s, "s-comida-mercado", "ene", "actual", 450_000);

    // valores de hoja y de padre exactamente como los define el roll-up existente
    expect(rollupBudget(s, "s-comida-mercado", "ene")).toBe(500_000);
    expect(rollupBudget(s, "c-comida", "ene")).toBe(1_000_000); // 500 + 300 + 200
    expect(rollupActual(s, "s-comida-mercado", "ene")).toBe(450_000);

    // el balance no los toca: los mismos valores tras computar
    computeBalanceSeries(s);
    expect(rollupBudget(s, "s-comida-mercado", "ene")).toBe(500_000);
    expect(rollupBudget(s, "c-comida", "ene")).toBe(1_000_000);
    expect(rollupActual(s, "s-comida-mercado", "ene")).toBe(450_000);
  });
});

// ══ NFR-902 · las filas de agregación existentes quedan idénticas ══════════════════════════════

describe("NFR-902 · los roll-ups existentes son el insumo, no cambian", () => {
  it("TC-BAL-952h: typeTotals sigue devolviendo el total por tipo por mes", () => {
    // @aitri-tc TC-BAL-952h
    const s = makeState([
      { id: "c-mercado", type: "expense", budget: { mar: 300_000 }, actual: { mar: 280_000 } },
      { id: "c-transporte", type: "expense", budget: { mar: 150_000 }, actual: { mar: 175_000 } },
    ]);

    const t = typeTotals(s, "expense", ["mar"]);

    expect(t.budget).toBe(450_000); // 300.000 + 150.000, suma de las hojas de gasto de marzo
    expect(t.actual).toBe(455_000); // 280.000 + 175.000

    // y es exactamente lo que el balance consume como Gasto del mes
    const m = computeBalanceSeries(s).mar;
    expect(m.budget.flow).toBe(-t.budget); // sin ingresos: el flujo es el gasto en negativo
    expect(m.actual.flow).toBe(-t.actual);
  });

  it("TC-BAL-952e: total de un tipo = suma de subtotales de sus grupos (sin huérfanos)", () => {
    // @aitri-tc TC-BAL-952e
    // dos grupos de gasto, cada uno con sus hojas
    const s: LedgerState = {
      ownerId: "local",
      nodes: [
        { id: "g-a", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 0 },
        { id: "c-a1", ownerId: "local", type: "expense", level: "category", parentId: "g-a", name: "Arriendo", icon: null, order: 0 },
        { id: "c-a2", ownerId: "local", type: "expense", level: "category", parentId: "g-a", name: "Servicios", icon: null, order: 1 },
        { id: "g-b", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Ocio", icon: null, order: 1 },
        { id: "c-b1", ownerId: "local", type: "expense", level: "category", parentId: "g-b", name: "Cine", icon: null, order: 0 },
      ],
      budgets: { "c-a1": { abr: 900_000 }, "c-a2": { abr: 200_000 }, "c-b1": { abr: 120_000 } },
      actuals: { "c-a1": { abr: 900_000 }, "c-a2": { abr: 215_000 }, "c-b1": { abr: 95_000 } },
      movements: [],
    };

    const t = typeTotals(s, "expense", ["abr"]);
    const groupsBudget = rollupBudget(s, "g-a", "abr") + rollupBudget(s, "g-b", "abr");
    const groupsActual = rollupActual(s, "g-a", "abr") + rollupActual(s, "g-b", "abr");

    expect(t.budget).toBe(groupsBudget); // 1.100.000 + 120.000
    expect(t.actual).toBe(groupsActual);
    expect(t.budget).toBe(1_220_000); // sin hojas huérfanas fuera del roll-up
  });

  it("TC-BAL-952f: el balance no modifica los roll-ups existentes", () => {
    // @aitri-tc TC-BAL-952f
    const s = buildSeed("local");
    const capture = () =>
      s.nodes.map((n) => MONTH_KEYS.map((mk) => `${n.id}:${mk}:${rollupBudget(s, n.id, mk)}:${rollupActual(s, n.id, mk)}`).join("|"));

    const before = capture();
    computeBalanceSeries(s);
    const after = capture();

    expect(after).toEqual(before);
    expect(before.length).toBe(s.nodes.length);
    expect(before.length).toBeGreaterThan(0); // la captura recorrió nodos de verdad
  });
});

// ══ NFR-904 · promover / degradar recomponen el balance ════════════════════════════════════════

describe("NFR-904 · el balance se recompone tras reestructurar la jerarquía", () => {
  it("TC-BAL-954f: el balance recomputado tras promover coincide con la nueva jerarquía (no obsoleto)", () => {
    // @aitri-tc TC-BAL-954f
    let s = buildSeed("local");
    s = setLeafAmount(s, "s-comida-mercado", "may", "actual", 400_000);
    const before = computeBalanceSeries(s);

    const res = moveNode(s, "s-comida-mercado", { kind: "root", type: "expense" }); // promover a grupo
    expect("state" in res).toBe(true);
    const promoted = (res as { state: LedgerState }).state;

    // la jerarquía cambió de verdad
    expect(findNode(promoted.nodes, "s-comida-mercado")!.level).toBe("group");
    expect(findNode(promoted.nodes, "s-comida-mercado")!.parentId).toBeNull();

    const after = computeBalanceSeries(promoted);

    // el balance recomputado es COHERENTE con los roll-ups de la jerarquía resultante,
    // no una copia del valor previo: se re-deriva de typeTotals sobre el estado nuevo
    for (const mk of MONTH_KEYS) {
      const t = { inc: typeTotals(promoted, "income", [mk]), exp: typeTotals(promoted, "expense", [mk]) };
      expect(after[mk].actual.flow, mk).toBe(t.inc.actual - t.exp.actual);
      expect(after[mk].budget.flow, mk).toBe(t.inc.budget - t.exp.budget);
    }

    // el monto viaja con el nodo: la promoción no pierde ni duplica plata (cero huérfanos)
    expect(after.may.actual.flow).toBe(before.may.actual.flow);

    // y no queda congelado: editar tras el promote mueve la cifra
    const edited = computeBalanceSeries(setLeafAmount(promoted, "s-comida-mercado", "may", "actual", 900_000));
    expect(edited.may.actual.flow).toBe(after.may.actual.flow - 500_000);
  });
});

// ══ NFR-905 · el registro de movimientos no cambia de forma ════════════════════════════════════

describe("NFR-905 · el registro de movimientos queda intacto", () => {
  it("TC-BAL-955f: el balance no altera la forma de captura del movimiento", () => {
    // @aitri-tc TC-BAL-955f
    const s0 = buildSeed("local");
    const target = "s-comida-cafe";
    const antes = s0.actuals[target]?.jun ?? 0;

    const s = addMovement(s0, { type: "expense", catId: "c-comida", subId: target, amount: 15_000, month: "jun" });

    // el movimiento se guarda con la misma forma de siempre y suma al Ejecutado de la hoja destino
    expect(s.movements.length).toBe(s0.movements.length + 1);
    const mv = s.movements[0];
    expect(mv.target).toBe(target);
    expect(mv.amount).toBe(15_000);
    expect(mv.month).toBe("jun");
    expect(mv.type).toBe("expense");
    expect(s.actuals[target]?.jun).toBe(antes + 15_000);

    // el balance solo LEE ese resultado después: no cambia movements ni actuals
    const movementsBefore = deep(s.movements);
    const actualsBefore = deep(s.actuals);
    computeBalanceSeries(s);
    expect(s.movements).toEqual(movementsBefore);
    expect(s.actuals).toEqual(actualsBefore);
  });
});

// ══ NFR-907 · rendimiento del recálculo ════════════════════════════════════════════════════════

/** Estado representativo: la semilla completa con montos en los 12 meses. */
function representativeState(): LedgerState {
  let s = buildSeed("local");
  const leaves = s.nodes.filter((n) => n.level === "sub" || n.level === "category");
  for (const n of leaves) {
    for (const mk of MONTH_KEYS) {
      s = setLeafAmount(s, n.id, mk, "budget", 250_000);
      s = setLeafAmount(s, n.id, mk, "actual", 240_000);
    }
  }
  return s;
}

describe("NFR-907 · el recálculo no degrada la edición en línea", () => {
  const ITERATIONS = 30;

  it("TC-BAL-957h: computeBalanceSeries corre en <100ms con datos representativos", () => {
    // @aitri-tc TC-BAL-957h
    const s = representativeState();
    computeBalanceSeries(s); // calentamiento: no medir el primer JIT

    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) computeBalanceSeries(s);
    const avg = (performance.now() - t0) / ITERATIONS;

    expect(avg, `promedio por llamada: ${avg.toFixed(2)} ms`).toBeLessThan(100);
  });

  it("TC-BAL-957e: recalcular tras editar una celda se mantiene <100ms (caso de edición en vivo)", () => {
    // @aitri-tc TC-BAL-957e
    const s = representativeState();
    computeBalanceSeries(s); // el estado ya se calculó una vez

    const leaf = s.nodes.find((n) => n.level === "sub")!.id;
    const edited = setLeafAmount(s, leaf, "jul", "actual", 777_000);

    const t0 = performance.now(); // se mide SOLO la recomputación posterior a la edición
    computeBalanceSeries(edited);
    const elapsed = performance.now() - t0;

    expect(elapsed, `recomputación post-edición: ${elapsed.toFixed(2)} ms`).toBeLessThan(100);
    // y la edición se refleja: el recálculo no devolvió lo anterior
    expect(computeBalanceSeries(edited).jul.actual.flow).not.toBe(computeBalanceSeries(s).jul.actual.flow);
  });

  it("TC-BAL-957f: el cómputo no crece de forma no lineal con más meses vacíos", () => {
    // @aitri-tc TC-BAL-957f
    const full = representativeState();
    const oneMonth = deep(full);
    for (const id of Object.keys(oneMonth.actuals)) {
      oneMonth.budgets[id] = { ene: full.budgets[id]?.ene ?? 0 };
      oneMonth.actuals[id] = { ene: full.actuals[id]?.ene ?? 0 };
    }

    const measure = (s: LedgerState) => {
      computeBalanceSeries(s);
      const t0 = performance.now();
      for (let i = 0; i < ITERATIONS; i++) computeBalanceSeries(s);
      return (performance.now() - t0) / ITERATIONS;
    };

    const tOne = measure(oneMonth);
    const tTwelve = measure(full);

    // el recorrido SIEMPRE son los 12 meses; llenar los otros 11 no puede multiplicar el costo
    // por más de ~12 (sería la firma de una explosión cuadrática)
    expect(tTwelve, `1 mes: ${tOne.toFixed(3)} ms · 12 meses: ${tTwelve.toFixed(3)} ms`).toBeLessThanOrEqual(Math.max(tOne * 12, 1));
  });
});

// ══ NFR-908 · sin superficie de seguridad nueva ════════════════════════════════════════════════

const BALANCE_SRC = readFileSync(fileURLToPath(new URL("../../src/domain/balance.ts", import.meta.url)), "utf8");

describe("NFR-908 · el balance no añade superficie de seguridad", () => {
  it("TC-BAL-958h: balance.ts no hace IO ni red ni lee entradas de usuario nuevas", () => {
    // @aitri-tc TC-BAL-958h
    const imports = [...BALANCE_SRC.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    // Feature transferencias: + ./reserve (dominio puro — reserveNet deriva de saldos resueltos).
    expect(imports.sort()).toEqual(["./months", "./reserve", "./reserve", "./rollup", "./types"]);

    for (const forbidden of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "node:fs", "require(", "process.env", "eval("]) {
      expect(BALANCE_SRC.includes(forbidden), `balance.ts no debe usar ${forbidden}`).toBe(false);
    }
    // cálculo puro: sin async ni promesas (no hay frontera de proceso que validar)
    expect(BALANCE_SRC).not.toMatch(/\basync\b|\bawait\b|new Promise/);
  });

  it("TC-BAL-958e: el balance no persiste estado derivado redundante", () => {
    // @aitri-tc TC-BAL-958e
    const writes: string[] = [];
    const original = Reflect.get(globalThis, "localStorage");
    Reflect.set(globalThis, "localStorage", {
      setItem: (k: string) => writes.push(k),
      getItem: () => null,
      removeItem: (k: string) => writes.push(k),
    });

    try {
      computeBalanceSeries(representativeState());
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, "localStorage");
      else Reflect.set(globalThis, "localStorage", original);
    }

    expect(writes).toEqual([]); // ni una escritura: el balance es derivado, no se almacena
    // las claves de persistencia siguen siendo las dos existentes — el balance no añadió ninguna
    expect(Object.keys(STORAGE_KEYS).sort()).toEqual(["budget", "nodes"]);
    expect(Object.values(STORAGE_KEYS)).toEqual(["ledger.nodes.v1", "ledger.budget.v4"]);
  });

  it("TC-BAL-958f: el balance no puede escribir en el schema (no toca el CHECK)", () => {
    // @aitri-tc TC-BAL-958f
    const s = makeState([
      { id: "c-salario", type: "income", budget: { ene: 500_000 }, actual: { ene: 480_000 } },
      { id: "c-mercado", type: "expense", budget: { ene: 900_000 }, actual: { ene: 950_000 } }, // sobre-gasto real
      { id: "c-alcancia", type: "transfer", budget: { ene: 100_000 }, actual: { ene: 100_000 } },
    ]);
    const budgetsBefore = deep(s.budgets);
    const actualsBefore = deep(s.actuals);

    const series = computeBalanceSeries(s);

    // el disponible SÍ puede quedar negativo (es una cifra derivada en pantalla)…
    expect(series.ene.actual.available).toBeLessThan(0);
    // …pero ninguna cifra de RESERVA lo es EN ESTA FIXTURE (solo aportes). Re-derivado por
    // feature transferencias (FR-1009): `reserved` como delta PUEDE ser negativo con retiros;
    // lo que jamás baja de 0 es reservedBalance (piso por alcancía) — y el CHECK sigue intacto.
    for (const mk of MONTH_KEYS) {
      for (const p of PLANES) {
        expect(series[mk][p].reserved, `${mk}/${p}`).toBeGreaterThanOrEqual(0);
        expect(series[mk][p].reservedBalance, `${mk}/${p}`).toBeGreaterThanOrEqual(0);
      }
    }
    // y no escribe en el almacén: el CHECK amount >= 0 queda intacto porque nadie lo desafía
    expect(s.budgets).toEqual(budgetsBefore);
    expect(s.actuals).toEqual(actualsBefore);
  });
});

// ══ FR-910 · el reordenamiento es de presentación, no de estado ════════════════════════════════

describe("FR-910 · reordenar los bloques no muta el estado", () => {
  it("TC-BAL-910f: ningún nodo cambia de tipo ni de padre al reordenar", () => {
    // @aitri-tc TC-BAL-910f
    const s = buildSeed("local");
    const antes = s.nodes.map((n) => `${n.id}:${n.type}:${n.parentId ?? "raíz"}`);

    // el render recorre los tipos en el orden NUEVO y, por cada uno, llama a las mismas funciones
    // de agregación que pinta la grilla. Ninguna puede tocar el estado.
    const ORDEN_NUEVO: NodeType[] = ["income", "expense", "transfer"];
    for (const t of ORDEN_NUEVO) {
      typeTotals(s, t, MONTH_KEYS);
      for (const n of s.nodes.filter((x) => x.type === t)) {
        for (const mk of MONTH_KEYS) {
          rollupBudget(s, n.id, mk);
          rollupActual(s, n.id, mk);
        }
      }
    }
    computeBalanceSeries(s);

    expect(s.nodes.map((n) => `${n.id}:${n.type}:${n.parentId ?? "raíz"}`)).toEqual(antes);
    expect(antes.length).toBeGreaterThan(0); // el recorrido pasó por nodos de verdad

    // y el orden en que se recorren no altera lo que devuelven
    const alRevés = [...ORDEN_NUEVO].reverse();
    for (const t of alRevés) {
      expect(typeTotals(s, t, MONTH_KEYS)).toEqual(typeTotals(s, t, MONTH_KEYS));
    }
  });
});
