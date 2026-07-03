import { describe, it, expect } from "vitest";
import { buildSeed, createNode, renameNode, canRename, canDelete, deleteNode } from "@/domain";
import { rollupBudget } from "@/domain/rollup";
import { findNode, childrenOf, isLeaf } from "@/domain/tree";
import { setLeafAmount } from "@/domain/mutations";

describe("FR-002 CRUD de categorías", () => {
  // @aitri-tc TC-002h
  it("TC-002h: crear grupo y categoría bajo un tipo aparecen en la jerarquía", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Estilo de vida" });
    const group = s.nodes.find((n) => n.name === "Estilo de vida" && n.type === "expense")!;
    expect(group.level).toBe("group");
    s = createNode(s, { level: "category", parentId: group.id, type: "expense", name: "Ocio" });
    const ocio = s.nodes.find((n) => n.name === "Ocio")!;
    expect(ocio.parentId).toBe(group.id);
    expect(ocio.type).toBe("expense");
  });

  // @aitri-tc TC-002e
  it("TC-002e: crear 1ª subcategoría traslada los montos de la categoría-hoja", () => {
    let s = buildSeed("local");
    // hacer de 'Vivienda' una hoja con budget ene=800000
    s = setLeafAmount(s, "c-vivienda", "ene", "budget", 800000);
    expect(rollupBudget(s, "c-vivienda", "ene")).toBe(800000);
    s = createNode(s, { level: "sub", parentId: "c-vivienda", type: "expense", name: "Arriendo" });
    const arriendo = s.nodes.find((n) => n.name === "Arriendo")!;
    expect(s.budgets[arriendo.id].ene).toBe(800000);
    expect(s.budgets["c-vivienda"]).toBeUndefined(); // ya no almacena monto propio
    expect(rollupBudget(s, "c-vivienda", "ene")).toBe(800000); // total no cae
  });

  // @aitri-tc TC-002f
  it("TC-002f: 'Sin asignar' (system) no es renombrable ni borrable; los tipos son fijos", () => {
    // materializar 'Sin asignar' del grupo Esenciales borrando una categoría con movimientos
    const s0 = buildSeed("local");
    const withMov = { ...s0, movements: [{ id: "m1", ownerId: "local", type: "expense" as const, catId: "c-comida", subId: null, target: "s-comida-mercado", amount: 1000, month: "ene" as const, createdAt: 1 }] };
    const res = deleteNode(withMov, "c-comida");
    const state = "state" in res ? res.state : withMov;
    const unassigned = findNode(state.nodes, "unassigned-g-esenciales")!;
    expect(unassigned.system).toBe(true);
    expect(canRename(unassigned)).toBe(false);
    expect(canDelete(unassigned)).toBe(false);
    // renameNode sobre system no cambia nada
    const s2 = renameNode(state, "unassigned-g-esenciales", "Otro nombre");
    expect(findNode(s2.nodes, "unassigned-g-esenciales")!.name).toBe("Sin asignar");
    // Tipos fijos: no existen como nodos editables (el eje de signo es constante)
    expect(state.nodes.some((n) => n.level === "group" && (n.type as string) === "type")).toBe(false);
  });
});

describe("FR-003 borrado → 'Sin asignar' del grupo", () => {
  function seedWithMovements() {
    const s0 = buildSeed("local");
    const movements = [
      { id: "m1", ownerId: "local", type: "expense" as const, catId: "c-cafe", subId: null, target: "c-cafe", amount: 1000, month: "ene" as const, createdAt: 1 },
      { id: "m2", ownerId: "local", type: "expense" as const, catId: "c-cafe", subId: null, target: "c-cafe", amount: 2000, month: "feb" as const, createdAt: 2 },
      { id: "m3", ownerId: "local", type: "expense" as const, catId: "c-cafe", subId: null, target: "c-cafe", amount: 3000, month: "mar" as const, createdAt: 3 },
    ];
    // crear categoría-hoja 'c-cafe' bajo Esenciales
    let s = createNode(s0, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cafetería" });
    const cafe = s.nodes.find((n) => n.name === "Cafetería" && n.level === "category")!;
    s = { ...s, nodes: s.nodes.map((n) => (n.id === cafe.id ? { ...n, id: "c-cafe" } : n)), movements };
    return s;
  }

  // @aitri-tc TC-003h
  it("TC-003h: borrar categoría con movimientos la convierte en sub de 'Sin asignar' del grupo", () => {
    const s = seedWithMovements();
    const res = deleteNode(s, "c-cafe");
    expect("state" in res).toBe(true);
    const state = "state" in res ? res.state : s;
    const cafe = findNode(state.nodes, "c-cafe")!;
    expect(cafe.level).toBe("sub");
    expect(cafe.parentId).toBe("unassigned-g-esenciales");
    // los 3 movimientos siguen resolviendo target existente
    const ids = new Set(state.nodes.map((n) => n.id));
    expect(state.movements.every((m) => ids.has(m.target))).toBe(true);
  });

  // @aitri-tc TC-003e
  it("TC-003e: borrar hoja sin movimientos la elimina directo; 'Sin asignar' no visible", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Gimnasio" });
    const gym = s.nodes.find((n) => n.name === "Gimnasio")!;
    const res = deleteNode(s, gym.id);
    const state = "state" in res ? res.state : s;
    expect(findNode(state.nodes, gym.id)).toBeUndefined();
    expect(state.budgets[gym.id]).toBeUndefined();
    // no se materializó 'Sin asignar'
    expect(findNode(state.nodes, "unassigned-g-esenciales")).toBeUndefined();
  });

  // Regresión BG-003: el seed trae ejecutado (actuals) SIN movements; borrar una categoría
  // semilla con ejecutado debe preservarla en 'Sin asignar', no eliminarla directo.
  it("BG-003: borrar categoría semilla con ejecutado (sin movements) la mueve a 'Sin asignar'", () => {
    const s = buildSeed("local");
    expect(s.movements.length).toBe(0); // el seed no genera movimientos
    const leafCat = s.nodes.find(
      (n) => n.level === "category" && isLeaf(n, s.nodes) && Object.values(s.actuals[n.id] ?? {}).some((v) => v > 0)
    )!;
    expect(leafCat).toBeDefined();
    const groupId = leafCat.parentId!;
    const res = deleteNode(s, leafCat.id);
    expect("state" in res).toBe(true);
    const state = "state" in res ? res.state : s;
    const moved = findNode(state.nodes, leafCat.id)!;
    expect(moved.level).toBe("sub");
    expect(moved.parentId).toBe(`unassigned-${groupId}`);
    // no se pierde el historial: su ejecutado se conserva
    expect(Object.values(state.actuals[leafCat.id] ?? {}).some((v) => v > 0)).toBe(true);
  });

  // @aitri-tc TC-003f
  it("TC-003f: borrar grupo con categorías se bloquea (nada cambia)", () => {
    const s = buildSeed("local");
    const res = deleteNode(s, "g-esenciales");
    expect(res).toEqual({ blocked: "group_not_empty" });
    // el estado original no se modificó
    expect(findNode(s.nodes, "g-esenciales")).toBeDefined();
  });
});
