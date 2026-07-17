// @aitri-trace Feature promote-to-group — FR-601..606 + NFR-601..605 (dominio).
// Cada test embebe su TC id para el mapeo de aitri verify-run.
import { describe, it, expect } from "vitest";
import { buildSeed, createNode, deleteNode, addMovement, moveNode } from "@/domain";
import { setLeafAmount, canDeleteNode } from "@/domain/mutations";
import { rollupBudget } from "@/domain/rollup";
import { findNode, childrenOf, isLeaf } from "@/domain/tree";
import type { LedgerState, LedgerNode } from "@/domain/types";

const byName = (s: LedgerState, name: string): LedgerNode =>
  s.nodes.find((n) => n.name === name)!;
const stateOf = (
  res: { state: LedgerState } | { rejected: string } | { blocked: string },
  fallback: LedgerState
) => ("state" in res ? res.state : fallback);

// Lista de destinos del registro (FR-606): categorías + grupos SIN hijos. Espeja el filtro de CategoryRow.
const registerDestinations = (s: LedgerState, type: string) =>
  s.nodes.filter(
    (n) =>
      n.type === type &&
      !n.system &&
      (n.level === "category" || (n.level === "group" && childrenOf(s.nodes, n.id).length === 0))
  );

describe("FR-601/FR-602 — promover a grupo (moveNode destino raíz)", () => {
  function seedWithCafeSub() {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "ComidaX" });
    const comida = byName(s, "ComidaX");
    s = createNode(s, { level: "sub", parentId: comida.id, type: "expense", name: "CafeX" });
    const cafe = byName(s, "CafeX");
    s = setLeafAmount(s, cafe.id, "ene", "budget", 1000);
    return { s, comidaId: comida.id, cafeId: cafe.id };
  }

  // @aitri-tc TC-602h
  it("TC-602h: moveNode(sub, root) → level group, parentId null, montos preservados", () => {
    const { s, cafeId } = seedWithCafeSub();
    const st = stateOf(moveNode(s, cafeId, { kind: "root", type: "expense" }), s);
    const g = findNode(st.nodes, cafeId)!;
    expect(g.level).toBe("group");
    expect(g.parentId).toBe(null);
    expect(st.budgets[cafeId].ene).toBe(1000);
  });

  // @aitri-tc TC-602e
  it("TC-602e: moveNode(categoría con subs, root) → subs pasan a category, movimientos sin huérfanos", () => {
    let { s, comidaId, cafeId } = seedWithCafeSub();
    s = addMovement(s, { type: "expense", catId: comidaId, subId: cafeId, amount: "500", month: "ene" });
    const st = stateOf(moveNode(s, comidaId, { kind: "root", type: "expense" }), s);
    expect(findNode(st.nodes, comidaId)!.level).toBe("group");
    expect(findNode(st.nodes, cafeId)!.level).toBe("category");
    expect(st.movements.every((m) => findNode(st.nodes, m.target))).toBe(true);
  });

  // @aitri-tc TC-602f
  it("TC-602f: moveNode a root de tipo distinto devuelve rejected:'cross_type' sin mutar", () => {
    const { s, cafeId } = seedWithCafeSub();
    const res = moveNode(s, cafeId, { kind: "root", type: "income" });
    expect(res).toEqual({ rejected: "cross_type" });
    expect(findNode(s.nodes, cafeId)!.level).toBe("sub"); // intacto
  });
});

describe("FR-603 — grupo sin hijos es hoja editable", () => {
  // @aitri-tc TC-603h
  it("TC-603h: isLeaf(grupo sin hijos)=true; setLeafAmount fija; rollup usa el monto propio", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Viajes" });
    const g = byName(s, "Viajes");
    expect(isLeaf(g, s.nodes)).toBe(true);
    s = setLeafAmount(s, g.id, "ene", "budget", 800000);
    expect(s.budgets[g.id].ene).toBe(800000);
    expect(rollupBudget(s, g.id, "ene")).toBe(800000);
  });

  // @aitri-tc TC-603f
  it("TC-603f: grupo CON hijo no es hoja; setLeafAmount es no-op; su valor es la suma del hijo", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Casa" });
    const casa = byName(s, "Casa");
    s = createNode(s, { level: "category", parentId: casa.id, type: "expense", name: "Luz" });
    const luz = byName(s, "Luz");
    s = setLeafAmount(s, luz.id, "ene", "budget", 500);
    expect(isLeaf(findNode(s.nodes, casa.id)!, s.nodes)).toBe(false);
    const s2 = setLeafAmount(s, casa.id, "ene", "budget", 999);
    expect(s2).toBe(s); // no-op: los padres no son editables
    expect(rollupBudget(s, casa.id, "ene")).toBe(500);
  });
});

describe("FR-604 — traslado de montos al primer hijo", () => {
  // @aitri-tc TC-604h
  it("TC-604h: crear la 1ª categoría de un grupo-hoja traslada sus montos y el total no cae", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Ocio" });
    const ocio = byName(s, "Ocio");
    s = setLeafAmount(s, ocio.id, "ene", "budget", 800000);
    s = createNode(s, { level: "category", parentId: ocio.id, type: "expense", name: "Cine" });
    const cine = byName(s, "Cine");
    expect(s.budgets[cine.id].ene).toBe(800000);
    expect(s.budgets[ocio.id]?.ene ?? undefined).toBeUndefined();
    expect(rollupBudget(s, ocio.id, "ene")).toBe(800000);
  });

  // @aitri-tc TC-604e
  it("TC-604e: promover una sub con montos a grupo la deja grupo-hoja con sus montos, sin hijo sintético", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "CatX" });
    const catx = byName(s, "CatX");
    s = createNode(s, { level: "sub", parentId: catx.id, type: "expense", name: "SubX" });
    const subx = byName(s, "SubX");
    s = setLeafAmount(s, subx.id, "ene", "budget", 1000);
    const before = s.nodes.length;
    const st = stateOf(moveNode(s, subx.id, { kind: "root", type: "expense" }), s);
    expect(childrenOf(st.nodes, subx.id).length).toBe(0);
    expect(st.budgets[subx.id].ene).toBe(1000);
    expect(st.nodes.length).toBe(before); // no se creó ningún nodo
  });

  // @aitri-tc TC-604f
  it("TC-604f: tras trasladar al 1er hijo, setLeafAmount sobre el grupo es no-op", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Ocio2" });
    const ocio = byName(s, "Ocio2");
    s = setLeafAmount(s, ocio.id, "ene", "budget", 800000);
    s = createNode(s, { level: "category", parentId: ocio.id, type: "expense", name: "Cine2" });
    const s2 = setLeafAmount(s, ocio.id, "ene", "budget", 999);
    expect(s2).toBe(s);
    expect(rollupBudget(s, ocio.id, "ene")).toBe(800000);
  });
});

describe("FR-605 — un grupo que pierde su último hijo vuelve a hoja en 0", () => {
  // @aitri-tc TC-605h
  it("TC-605h: borrar el último hijo vuelve el grupo hoja editable en 0", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Temp" });
    const temp = byName(s, "Temp");
    s = createNode(s, { level: "category", parentId: temp.id, type: "expense", name: "C1" });
    const c1 = byName(s, "C1");
    const st = stateOf(deleteNode(s, c1.id), s); // C1 sin datos → borrable
    expect(childrenOf(st.nodes, temp.id).length).toBe(0);
    expect(isLeaf(findNode(st.nodes, temp.id)!, st.nodes)).toBe(true);
    expect(rollupBudget(st, temp.id, "ene")).toBe(0);
  });

  // @aitri-tc TC-605e
  it("TC-605e: promover el único hijo fuera deja el grupo hoja editable en 0", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Temp2" });
    const temp = byName(s, "Temp2");
    s = createNode(s, { level: "category", parentId: temp.id, type: "expense", name: "C2" });
    const c2 = byName(s, "C2");
    const st = stateOf(moveNode(s, c2.id, { kind: "root", type: "expense" }), s);
    expect(childrenOf(st.nodes, temp.id).length).toBe(0);
    expect(isLeaf(findNode(st.nodes, temp.id)!, st.nodes)).toBe(true);
    expect(rollupBudget(st, temp.id, "ene")).toBe(0);
  });

  // @aitri-tc TC-605f
  it("TC-605f: el grupo NO reabsorbe el monto del hijo que sale (queda en 0)", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Grp" });
    const grp = byName(s, "Grp");
    s = createNode(s, { level: "category", parentId: grp.id, type: "expense", name: "Child" });
    const child = byName(s, "Child");
    s = setLeafAmount(s, child.id, "ene", "budget", 800000);
    expect(rollupBudget(s, grp.id, "ene")).toBe(800000);
    const st = stateOf(moveNode(s, child.id, { kind: "root", type: "expense" }), s);
    expect(rollupBudget(st, grp.id, "ene")).toBe(0); // el grupo original no reabsorbe
    expect(st.budgets[child.id].ene).toBe(800000); // el hijo (ahora grupo) conserva el monto
  });
});

describe("FR-606 — grupo sin hijos como destino de movimientos", () => {
  // @aitri-tc TC-606h
  it("TC-606h: addMovement contra un grupo sin hijos incrementa su ejecutado en exactamente el monto", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Directo" });
    const g = byName(s, "Directo");
    s = addMovement(s, { type: "expense", catId: g.id, subId: null, amount: "2500", month: "ene" });
    expect(s.actuals[g.id].ene).toBe(2500);
    expect(s.movements[0].target).toBe(g.id);
  });

  // @aitri-tc TC-606f (unit del filtro; el e2e cubre el selector real)
  it("TC-606f-unit: un grupo CON hijos no está en la lista de destinos; uno sin hijos sí", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Vacio" });
    const vacio = byName(s, "Vacio");
    const dests = registerDestinations(s, "expense").map((n) => n.id);
    expect(dests).toContain(vacio.id); // grupo sin hijos: destino
    expect(dests).not.toContain("g-esenciales"); // grupo con hijos: no
  });
});

describe("NFR-601 — regresión: traslado categoría→sub (FR-002)", () => {
  // @aitri-tc TC-651h
  it("TC-651h: crear la 1ª sub de una categoría-hoja traslada sus montos a la sub", () => {
    let s = buildSeed("local");
    s = setLeafAmount(s, "c-vivienda", "ene", "budget", 800000);
    s = createNode(s, { level: "sub", parentId: "c-vivienda", type: "expense", name: "Arriendo" });
    const arr = byName(s, "Arriendo");
    expect(s.budgets[arr.id].ene).toBe(800000);
    expect(s.budgets["c-vivienda"]?.ene ?? undefined).toBeUndefined();
    expect(rollupBudget(s, "c-vivienda", "ene")).toBe(800000);
  });

  // @aitri-tc TC-651e
  it("TC-651e: crear una 2ª sub NO re-traslada montos", () => {
    let s = buildSeed("local");
    s = setLeafAmount(s, "c-vivienda", "ene", "budget", 800000);
    s = createNode(s, { level: "sub", parentId: "c-vivienda", type: "expense", name: "Arriendo" });
    s = createNode(s, { level: "sub", parentId: "c-vivienda", type: "expense", name: "Servicios" });
    const arr = byName(s, "Arriendo");
    const serv = byName(s, "Servicios");
    expect(s.budgets[arr.id].ene).toBe(800000);
    expect(s.budgets[serv.id]?.ene ?? 0).toBe(0);
  });

  // @aitri-tc TC-651f
  it("TC-651f: crear una sub bajo categoría sin montos no inventa un traslado", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Vacia" });
    const v = byName(s, "Vacia");
    s = createNode(s, { level: "sub", parentId: v.id, type: "expense", name: "S1" });
    const s1 = byName(s, "S1");
    const total = Object.values(s.budgets[s1.id] ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });
});

describe("NFR-602 — regresión: invariante padre==Σhojas y cero huérfanos", () => {
  // @aitri-tc TC-652h
  it("TC-652h: tras promover un nodo a grupo, todo movimiento apunta a un nodo existente", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cat" });
    const cat = byName(s, "Cat");
    s = createNode(s, { level: "sub", parentId: cat.id, type: "expense", name: "Sub" });
    const sub = byName(s, "Sub");
    s = addMovement(s, { type: "expense", catId: cat.id, subId: sub.id, amount: "300", month: "ene" });
    const st = stateOf(moveNode(s, cat.id, { kind: "root", type: "expense" }), s);
    expect(st.movements.every((m) => findNode(st.nodes, m.target))).toBe(true);
  });

  // @aitri-tc TC-652e
  it("TC-652e: el invariante padre==Σhojas se mantiene tras traslado al 1er hijo y reverso a 0", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "G" });
    const g = byName(s, "G");
    s = setLeafAmount(s, g.id, "ene", "budget", 800000);
    s = createNode(s, { level: "category", parentId: g.id, type: "expense", name: "Cat" });
    const cat = byName(s, "Cat");
    expect(rollupBudget(s, g.id, "ene")).toBe(800000); // == Σ hojas (la categoría)
    const st = stateOf(deleteNode(s, cat.id), s);
    expect(rollupBudget(st, g.id, "ene")).toBe(0); // == Σ hojas (grupo-hoja sin monto)
  });

  // @aitri-tc TC-652f
  it("TC-652f: promover una categoría con 2 subs+movimientos no crea huérfanos ni pierde movimientos", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cat" });
    const cat = byName(s, "Cat");
    s = createNode(s, { level: "sub", parentId: cat.id, type: "expense", name: "S1" });
    s = createNode(s, { level: "sub", parentId: cat.id, type: "expense", name: "S2" });
    const s1 = byName(s, "S1");
    const s2 = byName(s, "S2");
    s = addMovement(s, { type: "expense", catId: cat.id, subId: s1.id, amount: "100", month: "ene" });
    s = addMovement(s, { type: "expense", catId: cat.id, subId: s2.id, amount: "200", month: "ene" });
    const before = s.movements.length;
    const st = stateOf(moveNode(s, cat.id, { kind: "root", type: "expense" }), s);
    expect(st.movements.length).toBe(before); // ninguno perdido
    expect(st.movements.every((m) => findNode(st.nodes, m.target))).toBe(true); // ninguno huérfano
  });
});

describe("NFR-603 — regresión: gate de borrado (FR-003 + BG-006)", () => {
  // @aitri-tc TC-653h
  it("TC-653h: canDeleteNode bloquea una categoría con ejecutado > 0", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cat" });
    const cat = byName(s, "Cat");
    s = setLeafAmount(s, cat.id, "ene", "actual", 3000);
    expect(canDeleteNode(s, cat.id)).toBe(false);
    expect(deleteNode(s, cat.id)).toEqual({ blocked: "has_data" });
  });

  // @aitri-tc TC-653e
  it("TC-653e: una categoría vaciada (ejecutado 0) se borra y retira sus movimientos", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cat" });
    const cat = byName(s, "Cat");
    s = addMovement(s, { type: "expense", catId: cat.id, subId: null, amount: "1000", month: "ene" });
    s = setLeafAmount(s, cat.id, "ene", "actual", 0); // vaciar
    expect(canDeleteNode(s, cat.id)).toBe(true);
    const st = stateOf(deleteNode(s, cat.id), s);
    expect(findNode(st.nodes, cat.id)).toBeUndefined();
    expect(st.movements.some((m) => m.target === cat.id)).toBe(false); // sin huérfanos
  });

  // @aitri-tc TC-653f
  it("TC-653f: borrar un grupo con categorías sigue bloqueado", () => {
    const s = buildSeed("local");
    expect(deleteNode(s, "g-esenciales")).toEqual({ blocked: "group_not_empty" });
  });
});

describe("NFR-604 — regresión: reparent existente, cross-type, grupos con hijos calculados", () => {
  // @aitri-tc TC-654h
  it("TC-654h: moveNode(sub, categoría) reubica sin cruzar de tipo", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cat" });
    const cat = byName(s, "Cat");
    s = createNode(s, { level: "sub", parentId: cat.id, type: "expense", name: "Sub" });
    const sub = byName(s, "Sub");
    const st = stateOf(moveNode(s, sub.id, { kind: "category", id: "c-vivienda" }), s);
    expect(findNode(st.nodes, sub.id)!.parentId).toBe("c-vivienda");
    expect(findNode(st.nodes, sub.id)!.level).toBe("sub");
  });

  // @aitri-tc TC-654e
  it("TC-654e: un grupo con hijos no es hoja ni destino de movimientos", () => {
    const s = buildSeed("local");
    expect(isLeaf(findNode(s.nodes, "g-esenciales")!, s.nodes)).toBe(false);
    expect(registerDestinations(s, "expense").map((n) => n.id)).not.toContain("g-esenciales");
  });

  // @aitri-tc TC-654f
  it("TC-654f: moveNode cross-type se rechaza", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cat" });
    const cat = byName(s, "Cat");
    s = createNode(s, { level: "sub", parentId: cat.id, type: "expense", name: "Sub" });
    const sub = byName(s, "Sub");
    const res = moveNode(s, sub.id, { kind: "category", id: "c-salario" }); // c-salario es income
    expect(res).toEqual({ rejected: "cross_type" });
  });
});

describe("NFR-605 — regresión: movimiento exacto a la hoja destino", () => {
  // @aitri-tc TC-655h
  it("TC-655h: un movimiento contra una categoría incrementa su ejecutado en exactamente el monto", () => {
    let s = buildSeed("local");
    const before = s.actuals["c-vivienda"]?.ene ?? 0;
    s = addMovement(s, { type: "expense", catId: "c-vivienda", subId: null, amount: "4200", month: "ene" });
    expect(s.actuals["c-vivienda"].ene).toBe(before + 4200); // incremento exacto
  });

  // @aitri-tc TC-655f
  it("TC-655f: un movimiento con subId apunta a la sub, no a la categoría", () => {
    let s = buildSeed("local");
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Cat" });
    const cat = byName(s, "Cat");
    s = createNode(s, { level: "sub", parentId: cat.id, type: "expense", name: "Sub" });
    const sub = byName(s, "Sub");
    s = addMovement(s, { type: "expense", catId: cat.id, subId: sub.id, amount: "700", month: "ene" });
    expect(s.actuals[sub.id].ene).toBe(700);
    expect(s.actuals[cat.id]?.ene ?? 0).toBe(0);
  });
});
