/**
 * BG-039 — mover una categoría CON subcategorías a un grupo-hoja con montos.
 *
 * La regla FR-604 dice que cuando un nodo hoja con montos gana su primer hijo, sus montos y sus
 * movimientos viajan a una hoja real para que ningún total se pierda. La rama `dest.kind === "group"`
 * de `moveNode` (src/domain/mutations.ts) los mandaba al nodo MOVIDO. Si ese nodo es una categoría
 * con subcategorías no es hoja: celdas y movimientos del grupo quedaban en un nodo no editable,
 * fuera del roll-up de Presupuestado (solo hojas) y, con diario-de-celda, fuera de todo Detalle.
 *
 * El arreglo manda montos y movimientos a la PRIMERA hoja del nodo movido: la misma idea que
 * `createNode`, que los pasa al primer hijo. Si el movido ya es hoja, la primera hoja es él mismo y
 * nada cambia respecto al comportamiento anterior.
 */
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { addMovement, createNode, moveNode, setLeafAmount } from "@/domain/mutations";
import { findNode, isLeaf } from "@/domain/tree";
import type { LedgerState } from "@/domain/types";
import { P, P0 } from "../helpers/periods";

const idPorNombre = (s: LedgerState, nombre: string) => s.nodes.find((n) => n.name === nombre)!.id;

/** Un grupo-hoja «Viaje» con presupuesto y un gasto, y una categoría «Hogar» con una subcategoría «Aseo». */
function escenario(): { s: LedgerState; grupo: string; cat: string; sub: string } {
  let s = buildSeed("u", P0);
  s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Viaje" });
  const grupo = idPorNombre(s, "Viaje");
  s = setLeafAmount(s, grupo, P0, "budget", 80_000, P);
  s = addMovement(s, { type: "expense", catId: grupo, amount: 50_000, period: P0, note: "Hotel" }, P);
  s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Hogar" });
  const cat = idPorNombre(s, "Hogar");
  s = createNode(s, { level: "sub", parentId: cat, type: "expense", name: "Aseo" });
  const sub = idPorNombre(s, "Aseo");
  return { s, grupo, cat, sub };
}

describe("BG-039 · mover una categoría con subcategorías a un grupo-hoja con montos", () => {
  it("BG-039a: los montos y el movimiento del grupo pasan a la primera hoja del nodo movido, no a la categoría", () => {
    const { s, grupo, cat, sub } = escenario();
    // Precondiciones: el escenario es el del bug.
    expect(isLeaf(findNode(s.nodes, grupo)!, s.nodes)).toBe(true);
    expect(isLeaf(findNode(s.nodes, cat)!, s.nodes)).toBe(false);
    expect(s.actuals[grupo]?.[P0]).toBe(50_000);

    const res = moveNode(s, cat, { kind: "group", id: grupo });
    if (!("state" in res)) throw new Error(`el movimiento se rechazó: ${JSON.stringify(res)}`);
    const n = res.state;

    // La categoría no es hoja: no puede guardar cifras.
    expect(n.actuals[cat]).toBeUndefined();
    expect(n.budgets[cat]).toBeUndefined();
    // Todo cae en la primera hoja real.
    expect(n.actuals[sub]?.[P0]).toBe(50_000);
    expect(n.budgets[sub]?.[P0]).toBe(80_000);
    // El grupo, que dejó de ser hoja, queda sin cifras propias.
    expect(n.actuals[grupo]).toBeUndefined();
    expect(n.budgets[grupo]).toBeUndefined();
  });

  it("BG-039b: el movimiento del grupo sigue a sus celdas y apunta a la subcategoría", () => {
    const { s, grupo, cat, sub } = escenario();
    const res = moveNode(s, cat, { kind: "group", id: grupo });
    if (!("state" in res)) throw new Error(`el movimiento se rechazó: ${JSON.stringify(res)}`);
    const mv = res.state.movements.find((m) => m.note === "Hotel")!;
    expect(mv.target).toBe(sub);
    expect(mv.catId).toBe(cat);
    expect(mv.subId).toBe(sub);
    // Cero movimientos apuntando a un nodo que no es hoja.
    const noHoja = res.state.movements.filter((m) => {
      const t = findNode(res.state.nodes, m.target);
      return !t || !isLeaf(t, res.state.nodes);
    });
    expect(noHoja).toEqual([]);
  });

  it("BG-039c: si el nodo movido ya es hoja, el comportamiento no cambia (los montos van a él)", () => {
    let s = buildSeed("u", P0);
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Viaje" });
    const grupo = idPorNombre(s, "Viaje");
    s = setLeafAmount(s, grupo, P0, "budget", 80_000, P);
    s = createNode(s, { level: "category", parentId: "g-esenciales", type: "expense", name: "Hogar" });
    const cat = idPorNombre(s, "Hogar");
    const res = moveNode(s, cat, { kind: "group", id: grupo });
    if (!("state" in res)) throw new Error(`el movimiento se rechazó: ${JSON.stringify(res)}`);
    expect(res.state.budgets[cat]?.[P0]).toBe(80_000);
    expect(res.state.budgets[grupo]).toBeUndefined();
  });

  it("BG-039d: el total del grupo se conserva exacto tras mover (el roll-up no pierde nada)", () => {
    const { s, grupo, cat } = escenario();
    const res = moveNode(s, cat, { kind: "group", id: grupo });
    if (!("state" in res)) throw new Error(`el movimiento se rechazó: ${JSON.stringify(res)}`);
    const suma = (m: LedgerState["actuals"]): number => {
      let total = 0;
      for (const meses of Object.values(m)) for (const v of Object.values(meses ?? {})) total += v ?? 0;
      return total;
    };
    expect(suma(res.state.actuals)).toBe(suma(s.actuals));
    expect(suma(res.state.budgets)).toBe(suma(s.budgets));
  });
});
