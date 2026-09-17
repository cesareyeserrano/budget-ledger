import { describe, it, expect } from "vitest";
// NFR-2303 (semilla-intacta): estas pruebas necesitan un ledger CON celdas para operar; su
// intención nunca fue verificar que la semilla traiga dinero. Desde FR-2301 la siembra del
// producto sale vacía, así que componen la semilla poblada de siempre con este helper.
import { addMovement, createNode, deleteNode } from "@/domain";
import { buildSeedConMontos as buildSeed } from "../helpers/seedConMontos";
import { rollupBudget } from "@/domain/rollup";
import { findNode, childrenOf, isLeaf } from "@/domain/tree";
import { canDeleteNode } from "@/domain/mutations";
import { setLeafAmount } from "@/domain/mutations";
import { P, P0 } from "../helpers/periods";

describe("FR-002 CRUD de categorías", () => {
  // @aitri-tc TC-002h
  it("TC-002h: crear grupo y categoría bajo un tipo aparecen en la jerarquía", () => {
    let s = buildSeed("local", P0);
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
    let s = buildSeed("local", P0);
    // hacer de 'Vivienda' una hoja con budget ene=800000
    s = setLeafAmount(s, "c-vivienda", "2026-01", "budget", 800000, P);
    expect(rollupBudget(s, "c-vivienda", "2026-01")).toBe(800000);
    s = createNode(s, { level: "sub", parentId: "c-vivienda", type: "expense", name: "Arriendo" });
    const arriendo = s.nodes.find((n) => n.name === "Arriendo")!;
    expect(s.budgets[arriendo.id]["2026-01"]).toBe(800000);
    expect(s.budgets["c-vivienda"]).toBeUndefined(); // ya no almacena monto propio
    expect(rollupBudget(s, "c-vivienda", "2026-01")).toBe(800000); // total no cae
  });

  // @aitri-tc TC-002f
  it("TC-002f: los tipos son fijos y un grupo con categorías no es borrable", () => {
    const s = buildSeed("local", P0);
    // Tipos fijos: no existen como nodos editables (el eje de signo es constante)
    expect(s.nodes.some((n) => n.level === "group" && (n.type as string) === "type")).toBe(false);
    // Un grupo con categorías no se puede borrar (bloqueado hasta vaciarlo)
    expect(canDeleteNode(s, "g-esenciales", P)).toBe(false);
    expect(deleteNode(s, "g-esenciales", P)).toEqual({ blocked: "has_children" });
  });
});

describe("Borrado (sin 'Sin asignar' — bloquea si hay datos)", () => {
  // Flujo real: los movimientos se registran vía addMovement (suman a actuals), como en la app.
  function seedWithMovements() {
    const s0 = buildSeed("local", P0);
    // crear categoría-hoja 'c-cafe' bajo Esenciales
    let s = createNode(s0, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cafetería" });
    const cafe = s.nodes.find((n) => n.name === "Cafetería" && n.level === "category")!;
    s = { ...s, nodes: s.nodes.map((n) => (n.id === cafe.id ? { ...n, id: "c-cafe" } : n)) };
    s = addMovement(s, { type: "expense", catId: "c-cafe", subId: null, amount: "1000", period: "2026-01" }, P);
    s = addMovement(s, { type: "expense", catId: "c-cafe", subId: null, amount: "2000", period: "2026-02" }, P);
    s = addMovement(s, { type: "expense", catId: "c-cafe", subId: null, amount: "3000", period: "2026-03" }, P);
    return s;
  }

  // @aitri-tc TC-003h
  it("TC-003h: borrar categoría CON movimientos (ejecutado > 0) está bloqueado (no se borra, no se pierde)", () => {
    const s = seedWithMovements();
    expect(canDeleteNode(s, "c-cafe", P)).toBe(false); // no borrable → la UI no muestra 🗑
    const res = deleteNode(s, "c-cafe", P);
    expect(res).toEqual({ blocked: "has_data" });
    // la categoría sigue existiendo con sus movimientos intactos
    expect(findNode(s.nodes, "c-cafe")).toBeDefined();
    // NFR-2502: se cuentan LOS SUYOS. La semilla poblada de esta suite crea ahora el movimiento que
    // respalda cada celda (el servidor ya no admite una celda sin respaldo), así que el total del
    // ledger dejó de ser 3 — pero lo que esta prueba afirma es que el borrado bloqueado no se llevó
    // por delante los movimientos de la categoría.
    expect(s.movements.filter((m) => m.target === "c-cafe")).toHaveLength(3);
  });

  // BG-006: una categoría/sub VACIADA (ejecutado en 0 en todos los meses) debe poder borrarse,
  // aunque tenga movimientos históricos en el journal (el journal es inmutable y antes la
  // bloqueaba para siempre). Al borrarla, sus movimientos se retiran para no dejar huérfanos.
  // @aitri-tc TC-003g
  it("TC-003g: BG-006 — categoría vaciada (ejecutado en 0) se puede borrar aunque tenga movimientos históricos", () => {
    let s = seedWithMovements();
    expect(canDeleteNode(s, "c-cafe", P)).toBe(false); // con ejecutado > 0 sigue bloqueada
    // el usuario la vacía: pone el ejecutado en 0 en los meses que tenían monto
    s = setLeafAmount(s, "c-cafe", "2026-01", "actual", 0, P);
    s = setLeafAmount(s, "c-cafe", "2026-02", "actual", 0, P);
    s = setLeafAmount(s, "c-cafe", "2026-03", "actual", 0, P);
    expect(canDeleteNode(s, "c-cafe", P)).toBe(true); // vaciada → borrable
    const res = deleteNode(s, "c-cafe", P);
    expect("state" in res).toBe(true);
    const next = ("state" in res ? res.state : s);
    expect(findNode(next.nodes, "c-cafe")).toBeUndefined();
    expect(next.movements.some((m) => m.target === "c-cafe")).toBe(false); // sin huérfanos
    expect(next.actuals["c-cafe"]).toBeUndefined();
  });

  // @aitri-tc TC-003e
  it("TC-003e: borrar hoja sin datos la elimina directo", () => {
    let s = buildSeed("local", P0);
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Gimnasio" });
    const gym = s.nodes.find((n) => n.name === "Gimnasio")!;
    const res = deleteNode(s, gym.id, P);
    const state = "state" in res ? res.state : s;
    expect(findNode(state.nodes, gym.id)).toBeUndefined();
    expect(state.budgets[gym.id]).toBeUndefined();
    
  });

  // BG-003 (revisado): el seed trae ejecutado (actuals) SIN movements; borrar una categoría
  // semilla con ejecutado está BLOQUEADO (hay que vaciarla primero) — no se pierde el dato.
  it("BG-003: borrar categoría semilla con ejecutado (sin movements) está bloqueado", () => {
    // El escenario de este caso es literal: celdas CON ejecutado y SIN movimientos. La semilla
    // poblada de la suite ahora crea el respaldo de cada celda (NFR-2502: el servidor ya no admite
    // una celda sin él), así que aquí se le quitan — es el estado que la prueba describe y el que
    // sigue existiendo en la realidad: un ledger anterior a esta feature.
    const s = { ...buildSeed("local", P0), movements: [] };
    expect(s.movements.length).toBe(0); // el seed no genera movimientos
    const leafCat = s.nodes.find(
      (n) => n.level === "category" && isLeaf(n, s.nodes) && Object.values(s.actuals[n.id] ?? {}).some((v) => (v ?? 0) > 0)
    )!;
    expect(leafCat).toBeDefined();
    expect(canDeleteNode(s, leafCat.id, P)).toBe(false); // ejecutado > 0 → no borrable
    expect(deleteNode(s, leafCat.id, P)).toEqual({ blocked: "has_data" });
    // sigue existiendo y su ejecutado se conserva
    expect(findNode(s.nodes, leafCat.id)).toBeDefined();
    expect(Object.values(s.actuals[leafCat.id] ?? {}).some((v) => (v ?? 0) > 0)).toBe(true);
  });

  // BG-002 (FR-110): un PADRE con hijos no se borra, aplique a grupo O categoría, tenga o no
  // valores propios. Antes el bloqueo por hijos solo miraba node.level === "group", así que una
  // categoría con subcategorías (sin datos) se dejaba borrar, arrastrando sus subs.
  // @aitri-tc TC-217f
  it("TC-217f: BG-002: una categoría CON subcategorías no es borrable (aunque no tenga valores)", () => {
    let s = buildSeed("local", P0);
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Servicios" });
    const cat = s.nodes.find((n) => n.name === "Servicios" && n.level === "category")!;
    s = createNode(s, { level: "sub", parentId: cat.id, type: "expense", name: "Internet" });
    // la categoría no tiene montos propios, pero SÍ tiene una subcategoría
    expect(canDeleteNode(s, cat.id, P)).toBe(false);
    expect(deleteNode(s, cat.id, P)).toEqual({ blocked: "has_children" });
    expect(findNode(s.nodes, cat.id)).toBeDefined(); // no se borró
    // solo tras quitar el hijo (y sin datos) la categoría es borrable
    const sub = s.nodes.find((n) => n.name === "Internet")!;
    const st = deleteNode(s, sub.id, P);
    const next = "state" in st ? st.state : s;
    expect(canDeleteNode(next, cat.id, P)).toBe(true);
  });

  // @aitri-tc TC-003f
  it("TC-003f: borrar grupo con categorías se bloquea (nada cambia)", () => {
    const s = buildSeed("local", P0);
    const res = deleteNode(s, "g-esenciales", P);
    expect(res).toEqual({ blocked: "has_children" });
    // el estado original no se modificó
    expect(findNode(s.nodes, "g-esenciales")).toBeDefined();
  });

  // BG-001 (FR-110): un GRUPO-HOJA (sin categorías) también almacena montos (FR-603).
  // Antes la rama de grupo solo miraba los hijos y dejaba borrarlo con valores propios,
  // perdiéndolos silenciosamente. Ahora se le aplica la misma regla de datos que a una hoja.
  it("BG-001: borrar grupo-hoja CON ejecutado está bloqueado (no se pierde el valor)", () => {
    let s = buildSeed("local", P0);
    // grupo nuevo sin categorías → es una hoja que puede recibir montos
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Viáticos" });
    const grp = s.nodes.find((n) => n.name === "Viáticos" && n.level === "group")!;
    expect(canDeleteNode(s, grp.id, P)).toBe(true); // vacío → borrable
    // el usuario captura un ejecutado directo en el grupo-hoja
    s = setLeafAmount(s, grp.id, "2026-01", "actual", 5000, P);
    expect(canDeleteNode(s, grp.id, P)).toBe(false); // con valor → la UI no muestra 🗑
    const res = deleteNode(s, grp.id, P);
    expect(res).toEqual({ blocked: "has_data" });
    // el grupo y su valor siguen intactos
    expect(findNode(s.nodes, grp.id)).toBeDefined();
    expect(s.actuals[grp.id]?.["2026-01"]).toBe(5000);
  });

  // BG-001: "con valores" incluye PRESUPUESTADO, no solo ejecutado — y aplica a TODOS los
  // niveles (grupo-hoja, categoría, sub). Una categoría con solo presupuesto tampoco se borra.
  // @aitri-tc TC-217e
  it("TC-217e: BG-001: borrar categoría/grupo con solo PRESUPUESTADO está bloqueado (todos los niveles)", () => {
    let s = buildSeed("local", P0);
    // categoría-hoja con solo presupuesto (sin ejecutado)
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Ahorro" });
    const cat = s.nodes.find((n) => n.name === "Ahorro" && n.level === "category")!;
    s = setLeafAmount(s, cat.id, "2026-01", "budget", 3000, P);
    expect(canDeleteNode(s, cat.id, P)).toBe(false); // presupuesto > 0 → no borrable
    expect(deleteNode(s, cat.id, P)).toEqual({ blocked: "has_data" });
    // grupo-hoja con solo presupuesto
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Reserva" });
    const grp = s.nodes.find((n) => n.name === "Reserva" && n.level === "group")!;
    s = setLeafAmount(s, grp.id, "2026-01", "budget", 9000, P);
    expect(canDeleteNode(s, grp.id, P)).toBe(false);
    expect(deleteNode(s, grp.id, P)).toEqual({ blocked: "has_data" });
    // vaciar el presupuesto → borrable
    s = setLeafAmount(s, cat.id, "2026-01", "budget", 0, P);
    expect(canDeleteNode(s, cat.id, P)).toBe(true);
  });

  // BG-001 (cont.): un grupo-hoja vaciado sí se borra, y limpia sus montos (sin huérfanos).
  // @aitri-tc TC-217h
  it("TC-217h: BG-001: grupo-hoja vaciado (sin hijos, sin valores) se borra y limpia budgets/actuals", () => {
    let s = buildSeed("local", P0);
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Viáticos" });
    const grp = s.nodes.find((n) => n.name === "Viáticos" && n.level === "group")!;
    s = setLeafAmount(s, grp.id, "2026-01", "actual", 5000, P);
    s = setLeafAmount(s, grp.id, "2026-01", "actual", 0, P); // lo vacía
    expect(canDeleteNode(s, grp.id, P)).toBe(true);
    const res = deleteNode(s, grp.id, P);
    expect("state" in res).toBe(true);
    const next = "state" in res ? res.state : s;
    expect(findNode(next.nodes, grp.id)).toBeUndefined();
    expect(next.actuals[grp.id]).toBeUndefined();
    expect(next.budgets[grp.id]).toBeUndefined();
  });

  // BG-017 (FR-604): el traslado al ganar el primer hijo movía las CELDAS al hijo pero dejaba los
  // MOVIMIENTOS de ingreso/gasto apuntando al padre — que ya no es hoja. Como ninguna pantalla
  // muestra ese journal, el desfase entre la grilla y la BD era invisible: un movimiento fantasma
  // (caso real 2026-08-31: un ingreso de 6.500.000 contra el grupo «Trabajo», visible solo en la
  // base). El journal debe seguir a las celdas en TODO tipo, no solo en transfer.
  it("BG-017: al crear el primer hijo, los movimientos de ingreso siguen a las celdas (sin fantasmas)", () => {
    let s = buildSeed("local", P0);
    s = createNode(s, { level: "group", parentId: null, type: "income", name: "Trabajo BG017" });
    const grupo = s.nodes.find((n) => n.name === "Trabajo BG017")!;
    // Registrar contra el grupo-hoja: la app lo ofrece mientras no tenga categorías (FR-603).
    s = addMovement(s, { type: "income", catId: grupo.id, subId: null, period: "2026-08", amount: 6_500_000 }, P);
    const mvId = s.movements[0].id;
    expect(s.actuals[grupo.id]?.["2026-08"]).toBe(6_500_000);

    // El grupo gana su primera categoría → las celdas se trasladan al hijo.
    s = createNode(s, { level: "category", parentId: grupo.id, type: "income", name: "Salario BG017" });
    const salario = s.nodes.find((n) => n.name === "Salario BG017")!;
    expect(s.actuals[salario.id]?.["2026-08"]).toBe(6_500_000);
    expect(s.actuals[grupo.id]).toBeUndefined();

    // El movimiento tiene que haber seguido a la celda: apuntar al hijo, no al grupo.
    const mv = s.movements.find((m) => m.id === mvId)!;
    expect(mv.target).toBe(salario.id);
    expect(mv.catId).toBe(salario.id);
    expect(mv.subId).toBeNull();
    expect(s.movements.some((m) => m.target === grupo.id)).toBe(false);

    // Y tras vaciar la celda del hijo, no queda ningún movimiento apuntando a un nodo no-hoja:
    // lo que la grilla muestra (0) es lo que el journal respalda.
    s = setLeafAmount(s, salario.id, "2026-08", "actual", 0, P);
    const huerfanos = s.movements.filter((m) => !isLeaf(findNode(s.nodes, m.target)!, s.nodes));
    expect(huerfanos).toEqual([]);
  });
});
