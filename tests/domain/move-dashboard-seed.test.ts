import { describe, it, expect } from "vitest";
import { createNode, moveNode, dashboardMetrics, deleteNode } from "@/domain";
import { findNode, childrenOf, subtreeIds, isLeaf } from "@/domain/tree";
import { setLeafAmount } from "@/domain/mutations";
import { P as MONTH_KEYS, REF_YEAR } from "../helpers/periods";
import { yearTotals, orphanBudgetNodes } from "../helpers/totals";
import { P, P0 } from "../helpers/periods";
import { buildSeedConMontos } from "../helpers/seedConMontos";
import { rollupBudget, rollupActual } from "@/domain/rollup";
import type { LedgerState, NodeType, PeriodKey } from "@/domain/types";

// BL-062: estas pruebas se escribieron sobre una semilla CON montos. Desde FR-2301 `buildSeed` sale
// vacía, y compararon cero contra cero durante semanas sin ponerse en rojo. Parten de la semilla
// poblada y cada una exige que su cifra de partida sea mayor que cero.

/** Σ del Ejecutado de las hojas de un tipo en un mes, leyendo las celdas — sin pasar por el roll-up. */
function sumaHojas(s: LedgerState, type: NodeType, month: PeriodKey): number {
  return s.nodes
    .filter((n) => n.type === type && isLeaf(n, s.nodes))
    .reduce((acc, n) => acc + (s.actuals[n.id]?.[month] ?? 0), 0);
}

function seedWithCafe() {
  const s0 = buildSeedConMontos("local", P0);
  // 'Café' como categoría bajo el grupo Esenciales (tipo Gasto), con un movimiento
  const movements = [{ id: "m1", ownerId: "local", type: "expense" as const, catId: "c-cafe", subId: null, target: "c-cafe", amount: 4000, period: "2026-01" as const, createdAt: 1 }];
  let s = createNode(s0, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cafetería" });
  const cafe = s.nodes.find((n) => n.name === "Cafetería" && n.level === "category")!;
  s = { ...s, nodes: s.nodes.map((n) => (n.id === cafe.id ? { ...n, id: "c-cafe" } : n)), movements: [...s.movements, ...movements] };
  return s;
}

describe("FR-015 reparent por drag-and-drop", () => {
  // @aitri-tc TC-015h
  it("TC-015h: mover categoría/sub sobre otra categoría la vuelve su subcategoría", () => {
    const s = seedWithCafe();
    const res = moveNode(s, "c-cafe", { kind: "category", id: "c-vivienda" });
    expect("state" in res).toBe(true);
    const state = "state" in res ? res.state : s;
    const cafe = findNode(state.nodes, "c-cafe")!;
    expect(cafe.level).toBe("sub");
    expect(cafe.parentId).toBe("c-vivienda");
    // movimiento sigue con target válido (cero huérfanos)
    expect(state.nodes.some((n) => n.id === "c-cafe")).toBe(true);
  });

  // @aitri-tc TC-015e
  it("TC-015e: soltar en la zona de un grupo la promueve a categoría nueva", () => {
    const s = seedWithCafe();
    const res = moveNode(s, "c-cafe", { kind: "group", id: "g-esenciales" });
    const state = "state" in res ? res.state : s;
    const cafe = findNode(state.nodes, "c-cafe")!;
    expect(cafe.level).toBe("category");
    expect(cafe.parentId).toBe("g-esenciales");
  });

  // @aitri-tc TC-015f
  it("TC-015f: soltar en otro tipo se rechaza (feature demote-node: un grupo ya SÍ se puede mover, pero nunca cruza de tipo)", () => {
    const s = seedWithCafe();
    // cross-type: Café (expense) sobre Salario (income)
    expect(moveNode(s, "c-cafe", { kind: "category", id: "c-salario" })).toEqual({ rejected: "cross_type" });
    // mover un grupo a un destino de OTRO tipo sigue rechazado por cruce de tipo (g-esenciales expense → g-trabajo income).
    // Antes de demote-node esto era 'invalid_target' (los grupos no se movían); ahora la regla dura de tipo lo rige.
    expect(moveNode(s, "g-esenciales", { kind: "group", id: "g-trabajo" })).toEqual({ rejected: "cross_type" });
  });
});

describe("FR-009 dashboard", () => {
  // @aitri-tc TC-009h
  it("TC-009h: balance del mes = ingresos − gastos ejecutados", () => {
    const s = buildSeedConMontos("local", P0);
    const vm = dashboardMetrics(s, { mode: "month", month: "2026-06" }, P);
    // Ingresos y gastos se comparan contra la suma de las celdas, no contra el propio `vm`.
    const ingresos = sumaHojas(s, "income", "2026-06");
    const gastos = sumaHojas(s, "expense", "2026-06");
    expect(ingresos).toBeGreaterThan(0);
    expect(gastos).toBeGreaterThan(0);
    expect(vm.income).toBe(ingresos);
    expect(vm.expense).toBe(gastos);
    expect(vm.balance).toBe(ingresos - gastos);
    // Los aportes a bolsillos NO entran en el balance del mes: es ingreso menos gasto, nada más.
    expect(sumaHojas(s, "transfer", "2026-06")).toBeGreaterThan(0);
    expect(vm.balance).toBe(2_157_000); // 3.488.000 − 1.331.000 con la semilla determinista
  });

  // @aitri-tc TC-009e
  it("TC-009e: filtro Año suma los 12 meses", () => {
    const s = buildSeedConMontos("local", P0);
    const year = dashboardMetrics(s, { mode: "year", year: REF_YEAR }, P);
    // suma manual de gastos ejecutados del año
    let expected = 0;
    for (const n of s.nodes.filter((x) => x.type === "expense")) {
      for (const m of MONTH_KEYS) expected += s.actuals[n.id]?.[m] ?? 0;
    }
    expect(expected).toBeGreaterThan(0);
    expect(year.expense).toBe(expected);
    // El año es la suma de sus doce meses vistos uno por uno, y más que cualquiera de ellos solo.
    const porMes = MONTH_KEYS.map((m) => dashboardMetrics(s, { mode: "month", month: m }, P));
    expect(year.expense).toBe(porMes.reduce((acc, vm) => acc + vm.expense, 0));
    expect(year.income).toBe(porMes.reduce((acc, vm) => acc + vm.income, 0));
    expect(year.income).toBeGreaterThan(Math.max(...porMes.map((vm) => vm.income)));
    expect(year.expense).toBeGreaterThan(Math.max(...porMes.map((vm) => vm.expense)));
  });
});

describe("NFR-005 regresión — invariantes de integridad", () => {
  function noOrphans(nodes: { id: string }[], movements: { target: string }[]): boolean {
    const ids = new Set(nodes.map((n) => n.id));
    return movements.every((m) => ids.has(m.target));
  }

  // @aitri-tc TC-105h
  it("TC-105h: tras borrar categoría con movimientos, cero huérfanos", () => {
    const s = seedWithCafe();
    const res = deleteNode(s, "c-cafe", P);
    const state = "state" in res ? res.state : s;
    expect(noOrphans(state.nodes, state.movements)).toBe(true);
  });

  // @aitri-tc TC-105e
  it("TC-105e: tras reparent, cero huérfanos y totales cuadran", () => {
    const s = seedWithCafe();
    const antes = yearTotals(s);
    // c-vivienda es una categoría-HOJA con montos en la semilla: al recibir a c-cafe deja de ser
    // hoja, que es el caso donde BG-009 perdía su presupuesto de todos los agregados.
    // BL-062: «con montos» se COMPRUEBA. Sin ellos esta prueba no entra en la rama que arregló BG-009.
    expect(isLeaf(findNode(s.nodes, "c-vivienda")!, s.nodes)).toBe(true);
    const viviendaAntes = MONTH_KEYS.map((m) => [rollupBudget(s, "c-vivienda", m), rollupActual(s, "c-vivienda", m)]);
    expect(viviendaAntes.every(([budget]) => budget > 0)).toBe(true);
    expect(antes.expense.budget).toBeGreaterThan(0);
    expect(antes.expense.actual).toBeGreaterThan(0);
    const res = moveNode(s, "c-cafe", { kind: "category", id: "c-vivienda" });
    expect("state" in res).toBe(true);
    const state = "state" in res ? res.state : s;
    expect(noOrphans(state.nodes, state.movements)).toBe(true);
    // rollup del nuevo padre incluye la hoja movida
    expect(subtreeIds(state.nodes, "c-vivienda")).toContain("c-cafe");
    // …y "totales cuadran" se COMPRUEBA, no solo se enuncia (BG-009/BL-008): reestructurar no
    // puede cambiar cuánto suma el año, ni dejar presupuesto colgado de un nodo que ya no es hoja.
    expect(yearTotals(state)).toEqual(antes);
    expect(orphanBudgetNodes(state)).toEqual([]);
    // rollup(padre) === Σ hojas: c-vivienda, ya con un hijo, sigue sumando mes a mes lo mismo que
    // tenía como hoja, y su grupo también.
    expect(MONTH_KEYS.map((m) => [rollupBudget(state, "c-vivienda", m), rollupActual(state, "c-vivienda", m)])).toEqual(viviendaAntes);
    for (const m of MONTH_KEYS) {
      expect(rollupBudget(state, "g-esenciales", m), m).toBe(rollupBudget(s, "g-esenciales", m));
      expect(rollupActual(state, "g-esenciales", m), m).toBe(rollupActual(s, "g-esenciales", m));
    }
  });

  // @aitri-tc TC-105f
  it("TC-105f: operación cross-type no altera la jerarquía ni crea huérfanos", () => {
    const s = seedWithCafe();
    const res = moveNode(s, "c-cafe", { kind: "category", id: "c-salario" });
    expect("rejected" in res).toBe(true);
    // jerarquía intacta
    expect(findNode(s.nodes, "c-cafe")!.parentId).toBe("g-esenciales");
    expect(noOrphans(s.nodes, s.movements)).toBe(true);
  });
});
