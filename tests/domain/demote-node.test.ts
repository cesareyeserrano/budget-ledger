// @aitri-trace Feature demote-node — FR-702/703 + NFR-701..704 (dominio).
// Nivel = profundidad: grupo=0, categoría=1, sub=2; cabida = destDepth + subtreeDepth ≤ 2.
// Cada test embebe su TC id para el mapeo de aitri verify-run.
import { describe, it, expect } from "vitest";
import { buildSeed, createNode, deleteNode, addMovement, moveNode } from "@/domain";
import { setLeafAmount, canDeleteNode, blockPolicy, type OverflowPolicy } from "@/domain/mutations";
import { subtreeDepth } from "@/domain/tree";
import { rollupBudget, typeTotals } from "@/domain/rollup";
import { findNode, childrenOf, isLeaf } from "@/domain/tree";
import type { LedgerState, LedgerNode } from "@/domain/types";

const byName = (s: LedgerState, name: string): LedgerNode =>
  s.nodes.find((n) => n.name === name)!;
const stateOf = (
  res: { state: LedgerState } | { rejected: string } | { blocked: string },
  fallback: LedgerState
): LedgerState => ("state" in res ? res.state : fallback);

// Grupo de gasto SIN hijos con un budget propio (grupo-hoja) — el caso de degradación más simple.
function seedGroupLeaf(name = "g-suelto", ene = 1000): { s: LedgerState; id: string } {
  let s = buildSeed("local");
  s = createNode(s, { level: "group", parentId: null, type: "expense", name });
  const id = byName(s, name).id;
  s = setLeafAmount(s, id, "ene", "budget", ene);
  return { s, id };
}

// Grupo de gasto con 2 categorías-hoja (subárbol profundidad 1). 'c-a' con un movimiento.
function seedGroupWithLeafCats(name = "g-src"): { s: LedgerState; gId: string; caId: string; cbId: string } {
  let s = buildSeed("local");
  s = createNode(s, { level: "group", parentId: null, type: "expense", name });
  const gId = byName(s, name).id;
  s = createNode(s, { level: "category", parentId: gId, type: "expense", name: "c-a" });
  s = createNode(s, { level: "category", parentId: gId, type: "expense", name: "c-b" });
  const caId = byName(s, "c-a").id;
  const cbId = byName(s, "c-b").id;
  s = addMovement(s, { type: "expense", catId: caId, subId: null, amount: "500", month: "ene" });
  return { s, gId, caId, cbId };
}

// Grupo con una categoría 'c-a' que tiene una subcategoría 's-a' (subárbol profundidad 2 = nietos).
function seedGroupWithGrandchild(): { s: LedgerState; gId: string; caId: string; saId: string } {
  let s = buildSeed("local");
  s = createNode(s, { level: "group", parentId: null, type: "expense", name: "g-src" });
  const gId = byName(s, "g-src").id;
  s = createNode(s, { level: "category", parentId: gId, type: "expense", name: "c-a" });
  const caId = byName(s, "c-a").id;
  s = createNode(s, { level: "sub", parentId: caId, type: "expense", name: "s-a" });
  const saId = byName(s, "s-a").id;
  s = setLeafAmount(s, saId, "ene", "budget", 700);
  s = addMovement(s, { type: "expense", catId: caId, subId: saId, amount: "300", month: "ene" });
  return { s, gId, caId, saId };
}

describe("tree.subtreeDepth — profundidad del subárbol", () => {
  it("0 para una hoja, 1 con hijos, 2 con nietos", () => {
    const { s: leaf, id } = seedGroupLeaf();
    expect(subtreeDepth(leaf.nodes, id)).toBe(0);
    const { s: cats, gId } = seedGroupWithLeafCats();
    expect(subtreeDepth(cats.nodes, gId)).toBe(1);
    const { s: gk, gId: gid2 } = seedGroupWithGrandchild();
    expect(subtreeDepth(gk.nodes, gid2)).toBe(2);
  });
});

describe("FR-702 — moveNode admite un grupo como origen (cabida + re-nivelado)", () => {
  // @aitri-tc TC-702h
  it("TC-702h: moveNode(grupo sin hijos, {kind:'group'}) → level category, parentId, montos preservados", () => {
    const { s, id } = seedGroupLeaf("g-suelto", 1000);
    const st = stateOf(moveNode(s, id, { kind: "group", id: "g-esenciales" }), s);
    const moved = findNode(st.nodes, id)!;
    expect(moved.level).toBe("category");
    expect(moved.parentId).toBe("g-esenciales");
    expect(st.budgets[id].ene).toBe(1000);
  });

  // @aitri-tc TC-702e
  it("TC-702e: moveNode(grupo con categorías-hoja, {kind:'group'}) → categoría + subs, sin huérfanos", () => {
    const { s, gId, caId, cbId } = seedGroupWithLeafCats();
    const st = stateOf(moveNode(s, gId, { kind: "group", id: "g-esenciales" }), s);
    expect(findNode(st.nodes, gId)!.level).toBe("category");
    expect(findNode(st.nodes, gId)!.parentId).toBe("g-esenciales");
    expect(findNode(st.nodes, caId)!.level).toBe("sub");
    expect(findNode(st.nodes, cbId)!.level).toBe("sub");
    expect(findNode(st.nodes, caId)!.parentId).toBe(gId); // estructura relativa intacta
    expect(st.movements.every((m) => findNode(st.nodes, m.target))).toBe(true); // 0 huérfanos
  });

  // @aitri-tc TC-702f
  it("TC-702f: moveNode(grupo, destino de tipo distinto) → rejected:'cross_type' sin mutar", () => {
    const { s, id } = seedGroupLeaf();
    const res = moveNode(s, id, { kind: "category", id: "c-salario" }); // c-salario es income
    expect(res).toEqual({ rejected: "cross_type" });
    expect(findNode(s.nodes, id)!.level).toBe("group"); // intacto
  });
});

describe("FR-703 — bloqueo por desborde (would_overflow)", () => {
  // @aitri-tc TC-703h
  it("TC-703h: moveNode que desborda el techo devuelve 'would_overflow' sin cambiar el estado", () => {
    const { s, gId } = seedGroupWithGrandchild();
    const res = moveNode(s, gId, { kind: "category", id: "c-vivienda" }); // nietos caerían a nivel 4
    expect(res).toEqual({ rejected: "would_overflow" });
  });

  // @aitri-tc TC-703e
  it("TC-703e: tras un intento que desborda, cero cambios de nivel/parentId y cero pérdida de montos/movimientos", () => {
    const { s, gId } = seedGroupWithGrandchild();
    const before = structuredClone(s);
    const res = moveNode(s, gId, { kind: "category", id: "c-vivienda" });
    expect("rejected" in res).toBe(true);
    // El estado de entrada no se mutó (moveNode es puro y bloqueó antes de clonar).
    expect(s.nodes).toEqual(before.nodes);
    expect(s.budgets).toEqual(before.budgets);
    expect(s.actuals).toEqual(before.actuals);
    expect(s.movements).toEqual(before.movements);
  });

  // @aitri-tc TC-703f
  it("TC-703f: un movimiento que SÍ cabe no se bloquea (sin falso positivo)", () => {
    const { s, gId } = seedGroupWithLeafCats(); // subárbol prof 1 → grupo destino (prof 1): 1+1=2 cabe
    const res = moveNode(s, gId, { kind: "group", id: "g-esenciales" });
    expect("state" in res).toBe(true);
  });
});

describe("NFR-701 — el seam de política de desborde", () => {
  const overflowingMove = () => {
    const { s, gId } = seedGroupWithGrandchild();
    return { s, gId, dest: { kind: "category", id: "c-vivienda" } as const };
  };

  // @aitri-tc TC-751h
  it("TC-751h: moveNode delega el desborde a la OverflowPolicy provista y usa su resolución", () => {
    const { s, gId, dest } = overflowingMove();
    const marker = structuredClone(s);
    marker.movements = []; // un estado claramente distinto = el marcador
    const testPolicy: OverflowPolicy = () => ({ kind: "resolve", state: marker });
    const res = moveNode(s, gId, dest, testPolicy);
    expect(res).toEqual({ state: marker }); // respetó la política enchufada, no bloqueó por su cuenta
  });

  // @aitri-tc TC-751e
  it("TC-751e: sin política explícita, el default blockPolicy rechaza el desborde", () => {
    const { s, gId, dest } = overflowingMove();
    expect(moveNode(s, gId, dest)).toEqual({ rejected: "would_overflow" });
    expect(blockPolicy({ state: s, nodeId: gId, dest, delta: 2 })).toEqual({ kind: "block" });
  });

  // @aitri-tc TC-751f
  it("TC-751f: la política NO se consulta cuando el movimiento cabe", () => {
    const { s, id } = seedGroupLeaf(); // grupo sin hijos → siempre cabe
    const throwingPolicy: OverflowPolicy = () => {
      throw new Error("la política no debe consultarse cuando cabe");
    };
    const res = moveNode(s, id, { kind: "group", id: "g-esenciales" }, throwingPolicy);
    expect("state" in res).toBe(true); // aplicado sin invocar la política
  });
});

describe("NFR-702 — regresión: promote-to-group intacto", () => {
  // @aitri-tc TC-752h
  it("TC-752h: promover una sub a grupo sigue funcionando", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Comida" });
    const comida = byName(s, "Comida");
    s = createNode(s, { level: "sub", parentId: comida.id, type: "expense", name: "c-cafe" });
    const cafe = byName(s, "c-cafe");
    const st = stateOf(moveNode(s, cafe.id, { kind: "root", type: "expense" }), s);
    expect(findNode(st.nodes, cafe.id)!.level).toBe("group");
    expect(findNode(st.nodes, cafe.id)!.parentId).toBe(null);
  });

  // @aitri-tc TC-752e
  it("TC-752e: un grupo sin hijos sigue editable (isLeaf) y como destino de movimientos", () => {
    const { s, id } = seedGroupLeaf("Directo", 0);
    expect(isLeaf(findNode(s.nodes, id)!, s.nodes)).toBe(true);
    const st = addMovement(s, { type: "expense", catId: id, subId: null, amount: "2500", month: "ene" });
    expect(st.actuals[id].ene).toBe(2500);
  });

  // @aitri-tc TC-752f
  it("TC-752f: el traslado al primer hijo y el reverso a 0 siguen intactos", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Ocio" });
    const ocio = byName(s, "Ocio");
    s = setLeafAmount(s, ocio.id, "ene", "budget", 800000);
    s = createNode(s, { level: "category", parentId: ocio.id, type: "expense", name: "Cine" });
    const cine = byName(s, "Cine");
    expect(s.budgets[cine.id].ene).toBe(800000); // traslado al primer hijo
    // BG-001: un nodo con presupuesto no es borrable; se vacía primero, LUEGO se borra.
    s = setLeafAmount(s, cine.id, "ene", "budget", 0);
    const st = stateOf(deleteNode(s, cine.id), s);
    expect(rollupBudget(st, ocio.id, "ene")).toBe(0); // reverso a 0
  });
});

describe("NFR-703 — regresión: reparent existente + integridad (padre==Σhojas, cero huérfanos)", () => {
  // @aitri-tc TC-753h
  it("TC-753h: moveNode(sub, categoría) sigue reubicando (camino subir/lateral intacto)", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Comida" });
    const comida = byName(s, "Comida");
    s = createNode(s, { level: "sub", parentId: comida.id, type: "expense", name: "c-cafe" });
    const cafe = byName(s, "c-cafe");
    const st = stateOf(moveNode(s, cafe.id, { kind: "category", id: "c-vivienda" }), s);
    expect(findNode(st.nodes, cafe.id)!.parentId).toBe("c-vivienda");
    expect(findNode(st.nodes, cafe.id)!.level).toBe("sub");
  });

  // @aitri-tc TC-753e
  it("TC-753e: tras una degradación válida, padre==Σhojas y cero huérfanos", () => {
    const { s, gId, caId, cbId } = seedGroupWithLeafCats();
    // dar montos a las dos categorías-hoja
    let s2 = setLeafAmount(s, caId, "ene", "budget", 300);
    s2 = setLeafAmount(s2, cbId, "ene", "budget", 200);
    const st = stateOf(moveNode(s2, gId, { kind: "group", id: "g-esenciales" }), s2);
    // 0 huérfanos
    expect(st.movements.every((m) => findNode(st.nodes, m.target))).toBe(true);
    // padre == Σ hojas: g-src (ahora categoría) = c-a + c-b (ahora subs)
    expect(rollupBudget(st, gId, "ene")).toBe(500);
  });

  // @aitri-tc TC-753e — degradar un grupo DENTRO de una categoría-hoja con presupuesto NO pierde
  // el presupuesto del destino (el destino deja de ser hoja; su monto se traslada a la hoja entrante).
  it("TC-753e-cat: degradar un grupo dentro de una categoría-hoja con presupuesto conserva el total (padre==Σhojas)", () => {
    let s = buildSeed("local");
    // c-vivienda es una categoría-hoja de gasto con presupuesto sembrado.
    const vivBudget = s.budgets["c-vivienda"]?.ene ?? 0;
    expect(vivBudget).toBeGreaterThan(0); // el bug solo aparece si el destino tenía monto
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "g-suelto" });
    const gId = byName(s, "g-suelto").id;
    s = setLeafAmount(s, gId, "ene", "budget", 1000);
    const totalBefore = typeTotals(s, "expense", ["ene"]).budget;

    const st = stateOf(moveNode(s, gId, { kind: "category", id: "c-vivienda" }), s);

    expect(findNode(st.nodes, gId)!.level).toBe("sub");
    // el presupuesto del destino NO se estranca: el roll-up de c-vivienda = su monto previo + el del entrante.
    expect(rollupBudget(st, "c-vivienda", "ene")).toBe(vivBudget + 1000);
    // el total del tipo se conserva exacto (cero pérdida silenciosa de presupuesto).
    expect(typeTotals(st, "expense", ["ene"]).budget).toBe(totalBefore);
  });

  // Regresión (hallazgo de auditoría de cobertura): el aplanado categoría→categoría con NIETOS
  // es el riesgo #1 de ADR-03 al remover el guard de grupos. Un origen CATEGORÍA no debe entrar al
  // camino nuevo de degradación: sigue por la rama existente que aplana sus subs al destino.
  it("TC-753g-flatten (audit): aplanar una categoría CON subcategorías sobre otra categoría — nietos → subs del destino, cero huérfanos", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Origen" });
    const origen = byName(s, "Origen");
    s = createNode(s, { level: "sub", parentId: origen.id, type: "expense", name: "N1" });
    s = createNode(s, { level: "sub", parentId: origen.id, type: "expense", name: "N2" });
    const n1 = byName(s, "N1");
    const n2 = byName(s, "N2");
    s = addMovement(s, { type: "expense", catId: origen.id, subId: n1.id, amount: "150", month: "ene" });

    const st = stateOf(moveNode(s, origen.id, { kind: "category", id: "c-vivienda" }), s);

    // 'Origen' baja a subcategoría de c-vivienda…
    expect(findNode(st.nodes, origen.id)!.level).toBe("sub");
    expect(findNode(st.nodes, origen.id)!.parentId).toBe("c-vivienda");
    // …y sus nietos se APLANAN a subs de c-vivienda (no caen a un nivel 4 imposible bajo 'Origen').
    expect(findNode(st.nodes, n1.id)!.level).toBe("sub");
    expect(findNode(st.nodes, n1.id)!.parentId).toBe("c-vivienda");
    expect(findNode(st.nodes, n2.id)!.level).toBe("sub");
    expect(findNode(st.nodes, n2.id)!.parentId).toBe("c-vivienda");
    // el techo de 3 niveles se respeta: ningún nodo quedó bajo subcategoría.
    expect(st.nodes.every((n) => ["group", "category", "sub"].includes(n.level))).toBe(true);
    // cero huérfanos: todo movimiento sigue apuntando a un nodo existente.
    expect(st.movements.every((m) => findNode(st.nodes, m.target))).toBe(true);
  });

  // @aitri-tc TC-753f
  it("TC-753f: moveNode cross-type se rechaza sin mutar", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Comida" });
    const comida = byName(s, "Comida");
    s = createNode(s, { level: "sub", parentId: comida.id, type: "expense", name: "c-cafe" });
    const cafe = byName(s, "c-cafe");
    const res = moveNode(s, cafe.id, { kind: "category", id: "c-salario" }); // c-salario es income
    expect(res).toEqual({ rejected: "cross_type" });
  });
});

describe("NFR-704 — regresión: gate de borrado + registro de movimientos", () => {
  // @aitri-tc TC-754h
  it("TC-754h: canDeleteNode bloquea una categoría con ejecutado > 0", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cat" });
    const cat = byName(s, "Cat");
    s = setLeafAmount(s, cat.id, "ene", "actual", 3000);
    expect(canDeleteNode(s, cat.id)).toBe(false);
    expect(deleteNode(s, cat.id)).toEqual({ blocked: "has_data" });
  });

  // @aitri-tc TC-754e
  it("TC-754e: (BG-006) una categoría vaciada se borra y retira sus movimientos", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cat" });
    const cat = byName(s, "Cat");
    s = addMovement(s, { type: "expense", catId: cat.id, subId: null, amount: "1000", month: "ene" });
    s = setLeafAmount(s, cat.id, "ene", "actual", 0); // vaciar
    const st = stateOf(deleteNode(s, cat.id), s);
    expect(findNode(st.nodes, cat.id)).toBeUndefined();
    expect(st.movements.some((m) => m.target === cat.id)).toBe(false);
  });

  // @aitri-tc TC-754f
  it("TC-754f: un movimiento incrementa su hoja destino en exactamente el monto", () => {
    let s = buildSeed("local");
    const before = s.actuals["c-vivienda"]?.ene ?? 0;
    s = addMovement(s, { type: "expense", catId: "c-vivienda", subId: null, amount: "4200", month: "ene" });
    expect(s.actuals["c-vivienda"].ene).toBe(before + 4200);
  });
});
