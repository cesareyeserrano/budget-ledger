import { describe, it, expect } from "vitest";
import { addMovement, buildSeed, createNode, deleteNode } from "@/domain";
import { rollupBudget } from "@/domain/rollup";
import { findNode, childrenOf, isLeaf } from "@/domain/tree";
import { canDeleteNode } from "@/domain/mutations";
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
  it("TC-002f: los tipos son fijos y un grupo con categorías no es borrable", () => {
    const s = buildSeed("local");
    // Tipos fijos: no existen como nodos editables (el eje de signo es constante)
    expect(s.nodes.some((n) => n.level === "group" && (n.type as string) === "type")).toBe(false);
    // Un grupo con categorías no se puede borrar (bloqueado hasta vaciarlo)
    expect(canDeleteNode(s, "g-esenciales")).toBe(false);
    expect(deleteNode(s, "g-esenciales")).toEqual({ blocked: "has_children" });
  });
});

describe("Borrado (sin 'Sin asignar' — bloquea si hay datos)", () => {
  // Flujo real: los movimientos se registran vía addMovement (suman a actuals), como en la app.
  function seedWithMovements() {
    const s0 = buildSeed("local");
    // crear categoría-hoja 'c-cafe' bajo Esenciales
    let s = createNode(s0, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cafetería" });
    const cafe = s.nodes.find((n) => n.name === "Cafetería" && n.level === "category")!;
    s = { ...s, nodes: s.nodes.map((n) => (n.id === cafe.id ? { ...n, id: "c-cafe" } : n)) };
    s = addMovement(s, { type: "expense", catId: "c-cafe", subId: null, amount: "1000", month: "ene" });
    s = addMovement(s, { type: "expense", catId: "c-cafe", subId: null, amount: "2000", month: "feb" });
    s = addMovement(s, { type: "expense", catId: "c-cafe", subId: null, amount: "3000", month: "mar" });
    return s;
  }

  // @aitri-tc TC-003h
  it("TC-003h: borrar categoría CON movimientos (ejecutado > 0) está bloqueado (no se borra, no se pierde)", () => {
    const s = seedWithMovements();
    expect(canDeleteNode(s, "c-cafe")).toBe(false); // no borrable → la UI no muestra 🗑
    const res = deleteNode(s, "c-cafe");
    expect(res).toEqual({ blocked: "has_data" });
    // la categoría sigue existiendo con sus movimientos intactos
    expect(findNode(s.nodes, "c-cafe")).toBeDefined();
    expect(s.movements.length).toBe(3);
  });

  // BG-006: una categoría/sub VACIADA (ejecutado en 0 en todos los meses) debe poder borrarse,
  // aunque tenga movimientos históricos en el journal (el journal es inmutable y antes la
  // bloqueaba para siempre). Al borrarla, sus movimientos se retiran para no dejar huérfanos.
  it("BG-006: categoría vaciada (ejecutado en 0) se puede borrar aunque tenga movimientos históricos", () => {
    let s = seedWithMovements();
    expect(canDeleteNode(s, "c-cafe")).toBe(false); // con ejecutado > 0 sigue bloqueada
    // el usuario la vacía: pone el ejecutado en 0 en los meses que tenían monto
    s = setLeafAmount(s, "c-cafe", "ene", "actual", 0);
    s = setLeafAmount(s, "c-cafe", "feb", "actual", 0);
    s = setLeafAmount(s, "c-cafe", "mar", "actual", 0);
    expect(canDeleteNode(s, "c-cafe")).toBe(true); // vaciada → borrable
    const res = deleteNode(s, "c-cafe");
    expect("state" in res).toBe(true);
    const next = ("state" in res ? res.state : s);
    expect(findNode(next.nodes, "c-cafe")).toBeUndefined();
    expect(next.movements.some((m) => m.target === "c-cafe")).toBe(false); // sin huérfanos
    expect(next.actuals["c-cafe"]).toBeUndefined();
  });

  // @aitri-tc TC-003e
  it("TC-003e: borrar hoja sin datos la elimina directo", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Gimnasio" });
    const gym = s.nodes.find((n) => n.name === "Gimnasio")!;
    const res = deleteNode(s, gym.id);
    const state = "state" in res ? res.state : s;
    expect(findNode(state.nodes, gym.id)).toBeUndefined();
    expect(state.budgets[gym.id]).toBeUndefined();
    
  });

  // BG-003 (revisado): el seed trae ejecutado (actuals) SIN movements; borrar una categoría
  // semilla con ejecutado está BLOQUEADO (hay que vaciarla primero) — no se pierde el dato.
  it("BG-003: borrar categoría semilla con ejecutado (sin movements) está bloqueado", () => {
    const s = buildSeed("local");
    expect(s.movements.length).toBe(0); // el seed no genera movimientos
    const leafCat = s.nodes.find(
      (n) => n.level === "category" && isLeaf(n, s.nodes) && Object.values(s.actuals[n.id] ?? {}).some((v) => v > 0)
    )!;
    expect(leafCat).toBeDefined();
    expect(canDeleteNode(s, leafCat.id)).toBe(false); // ejecutado > 0 → no borrable
    expect(deleteNode(s, leafCat.id)).toEqual({ blocked: "has_data" });
    // sigue existiendo y su ejecutado se conserva
    expect(findNode(s.nodes, leafCat.id)).toBeDefined();
    expect(Object.values(s.actuals[leafCat.id] ?? {}).some((v) => v > 0)).toBe(true);
  });

  // BG-002 (FR-110): un PADRE con hijos no se borra, aplique a grupo O categoría, tenga o no
  // valores propios. Antes el bloqueo por hijos solo miraba node.level === "group", así que una
  // categoría con subcategorías (sin datos) se dejaba borrar, arrastrando sus subs.
  // @aitri-tc TC-217f
  it("TC-217f: BG-002: una categoría CON subcategorías no es borrable (aunque no tenga valores)", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Servicios" });
    const cat = s.nodes.find((n) => n.name === "Servicios" && n.level === "category")!;
    s = createNode(s, { level: "sub", parentId: cat.id, type: "expense", name: "Internet" });
    // la categoría no tiene montos propios, pero SÍ tiene una subcategoría
    expect(canDeleteNode(s, cat.id)).toBe(false);
    expect(deleteNode(s, cat.id)).toEqual({ blocked: "has_children" });
    expect(findNode(s.nodes, cat.id)).toBeDefined(); // no se borró
    // solo tras quitar el hijo (y sin datos) la categoría es borrable
    const sub = s.nodes.find((n) => n.name === "Internet")!;
    const st = deleteNode(s, sub.id);
    const next = "state" in st ? st.state : s;
    expect(canDeleteNode(next, cat.id)).toBe(true);
  });

  // @aitri-tc TC-003f
  it("TC-003f: borrar grupo con categorías se bloquea (nada cambia)", () => {
    const s = buildSeed("local");
    const res = deleteNode(s, "g-esenciales");
    expect(res).toEqual({ blocked: "has_children" });
    // el estado original no se modificó
    expect(findNode(s.nodes, "g-esenciales")).toBeDefined();
  });

  // BG-001 (FR-110): un GRUPO-HOJA (sin categorías) también almacena montos (FR-603).
  // Antes la rama de grupo solo miraba los hijos y dejaba borrarlo con valores propios,
  // perdiéndolos silenciosamente. Ahora se le aplica la misma regla de datos que a una hoja.
  it("BG-001: borrar grupo-hoja CON ejecutado está bloqueado (no se pierde el valor)", () => {
    let s = buildSeed("local");
    // grupo nuevo sin categorías → es una hoja que puede recibir montos
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Viáticos" });
    const grp = s.nodes.find((n) => n.name === "Viáticos" && n.level === "group")!;
    expect(canDeleteNode(s, grp.id)).toBe(true); // vacío → borrable
    // el usuario captura un ejecutado directo en el grupo-hoja
    s = setLeafAmount(s, grp.id, "ene", "actual", 5000);
    expect(canDeleteNode(s, grp.id)).toBe(false); // con valor → la UI no muestra 🗑
    const res = deleteNode(s, grp.id);
    expect(res).toEqual({ blocked: "has_data" });
    // el grupo y su valor siguen intactos
    expect(findNode(s.nodes, grp.id)).toBeDefined();
    expect(s.actuals[grp.id]?.ene).toBe(5000);
  });

  // BG-001: "con valores" incluye PRESUPUESTADO, no solo ejecutado — y aplica a TODOS los
  // niveles (grupo-hoja, categoría, sub). Una categoría con solo presupuesto tampoco se borra.
  // @aitri-tc TC-217e
  it("TC-217e: BG-001: borrar categoría/grupo con solo PRESUPUESTADO está bloqueado (todos los niveles)", () => {
    let s = buildSeed("local");
    // categoría-hoja con solo presupuesto (sin ejecutado)
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Ahorro" });
    const cat = s.nodes.find((n) => n.name === "Ahorro" && n.level === "category")!;
    s = setLeafAmount(s, cat.id, "ene", "budget", 3000);
    expect(canDeleteNode(s, cat.id)).toBe(false); // presupuesto > 0 → no borrable
    expect(deleteNode(s, cat.id)).toEqual({ blocked: "has_data" });
    // grupo-hoja con solo presupuesto
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Reserva" });
    const grp = s.nodes.find((n) => n.name === "Reserva" && n.level === "group")!;
    s = setLeafAmount(s, grp.id, "ene", "budget", 9000);
    expect(canDeleteNode(s, grp.id)).toBe(false);
    expect(deleteNode(s, grp.id)).toEqual({ blocked: "has_data" });
    // vaciar el presupuesto → borrable
    s = setLeafAmount(s, cat.id, "ene", "budget", 0);
    expect(canDeleteNode(s, cat.id)).toBe(true);
  });

  // BG-001 (cont.): un grupo-hoja vaciado sí se borra, y limpia sus montos (sin huérfanos).
  // @aitri-tc TC-217h
  it("TC-217h: BG-001: grupo-hoja vaciado (sin hijos, sin valores) se borra y limpia budgets/actuals", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Viáticos" });
    const grp = s.nodes.find((n) => n.name === "Viáticos" && n.level === "group")!;
    s = setLeafAmount(s, grp.id, "ene", "actual", 5000);
    s = setLeafAmount(s, grp.id, "ene", "actual", 0); // lo vacía
    expect(canDeleteNode(s, grp.id)).toBe(true);
    const res = deleteNode(s, grp.id);
    expect("state" in res).toBe(true);
    const next = "state" in res ? res.state : s;
    expect(findNode(next.nodes, grp.id)).toBeUndefined();
    expect(next.actuals[grp.id]).toBeUndefined();
    expect(next.budgets[grp.id]).toBeUndefined();
  });
});
