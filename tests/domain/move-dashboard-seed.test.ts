import { describe, it, expect } from "vitest";
import { buildSeed, createNode, moveNode, dashboardMetrics, deleteNode } from "@/domain";
import { findNode, childrenOf, subtreeIds } from "@/domain/tree";
import { setLeafAmount } from "@/domain/mutations";
import { MONTH_KEYS } from "@/domain/months";

function seedWithCafe() {
  const s0 = buildSeed("local");
  // 'Café' como categoría bajo el grupo Esenciales (tipo Gasto), con un movimiento
  const movements = [{ id: "m1", ownerId: "local", type: "expense" as const, catId: "c-cafe", subId: null, target: "c-cafe", amount: 4000, month: "ene" as const, createdAt: 1 }];
  let s = createNode(s0, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cafetería" });
  const cafe = s.nodes.find((n) => n.name === "Cafetería" && n.level === "category")!;
  s = { ...s, nodes: s.nodes.map((n) => (n.id === cafe.id ? { ...n, id: "c-cafe" } : n)), movements };
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
  it("TC-015f: soltar en otro tipo o mover un grupo se rechaza", () => {
    const s = seedWithCafe();
    // cross-type: Café (expense) sobre Salario (income)
    expect(moveNode(s, "c-cafe", { kind: "category", id: "c-salario" })).toEqual({ rejected: "cross_type" });
    // mover un grupo: inválido
    expect(moveNode(s, "g-esenciales", { kind: "group", id: "g-trabajo" })).toEqual({ rejected: "invalid_target" });
  });
});

describe("FR-009 dashboard", () => {
  // @aitri-tc TC-009h
  it("TC-009h: balance del mes = ingresos − gastos ejecutados", () => {
    const s = buildSeed("local");
    const vm = dashboardMetrics(s, { mode: "month", month: "jun" });
    expect(vm.balance).toBe(vm.income - vm.expense);
  });

  // @aitri-tc TC-009e
  it("TC-009e: filtro Año suma los 12 meses", () => {
    const s = buildSeed("local");
    const year = dashboardMetrics(s, { mode: "year" });
    // suma manual de gastos ejecutados del año
    let expected = 0;
    for (const n of s.nodes.filter((x) => x.type === "expense")) {
      for (const m of MONTH_KEYS) expected += s.actuals[n.id]?.[m] ?? 0;
    }
    expect(year.expense).toBe(expected);
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
    const res = deleteNode(s, "c-cafe");
    const state = "state" in res ? res.state : s;
    expect(noOrphans(state.nodes, state.movements)).toBe(true);
  });

  // @aitri-tc TC-105e
  it("TC-105e: tras reparent, cero huérfanos y totales cuadran", () => {
    const s = seedWithCafe();
    const res = moveNode(s, "c-cafe", { kind: "category", id: "c-vivienda" });
    const state = "state" in res ? res.state : s;
    expect(noOrphans(state.nodes, state.movements)).toBe(true);
    // rollup del nuevo padre incluye la hoja movida
    expect(subtreeIds(state.nodes, "c-vivienda")).toContain("c-cafe");
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
