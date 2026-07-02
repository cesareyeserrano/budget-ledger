import { describe, it, expect } from "vitest";
import { buildSeed, createNode, moveNode, deleteNode } from "@/domain";
import { subtreeIds, isAncestor, findNode } from "@/domain/tree";
import type { LedgerNode } from "@/domain/types";

// Correcciones del pase adversarial (no mapean a un TC; previenen regresión de invariantes).

function withUnassigned() {
  const s0 = buildSeed("local");
  const movements = [{ id: "m1", ownerId: "local", type: "expense" as const, catId: "c-x", subId: null, target: "c-x", amount: 1000, month: "ene" as const, createdAt: 1 }];
  let s = createNode(s0, { level: "category", parentId: "g-esenciales", type: "expense", name: "X" });
  const x = s.nodes.find((n) => n.name === "X" && n.level === "category")!;
  s = { ...s, nodes: s.nodes.map((n) => (n.id === x.id ? { ...n, id: "c-x" } : n)), movements };
  const res = deleteNode(s, "c-x"); // materializa 'unassigned-g-esenciales'
  return "state" in res ? res.state : s;
}

describe("hardening moveNode: guard de system (FINDING 1)", () => {
  it("no permite mover la categoría 'Sin asignar'", () => {
    const s = withUnassigned();
    expect(moveNode(s, "unassigned-g-esenciales", { kind: "category", id: "c-vivienda" })).toEqual({ rejected: "invalid_target" });
  });
  it("no permite soltar un nodo dentro de 'Sin asignar'", () => {
    const s = withUnassigned();
    expect(moveNode(s, "c-vivienda", { kind: "category", id: "unassigned-g-esenciales" })).toEqual({ rejected: "invalid_target" });
  });
});

describe("hardening createNode: valida forma de la jerarquía (FINDING 3)", () => {
  it("rechaza una subcategoría cuyo padre es un grupo", () => {
    const s = buildSeed("local");
    const s2 = createNode(s, { level: "sub", parentId: "g-esenciales", type: "expense", name: "malo" });
    expect(s2).toBe(s); // no-op
  });
  it("rechaza una categoría con padre inexistente", () => {
    const s = buildSeed("local");
    const s2 = createNode(s, { level: "category", parentId: "no-existe", type: "expense", name: "malo" });
    expect(s2).toBe(s);
  });
  it("rechaza cruzar de tipo (sub bajo categoría de otro tipo)", () => {
    const s = buildSeed("local");
    const s2 = createNode(s, { level: "sub", parentId: "c-salario", type: "expense", name: "malo" });
    expect(s2).toBe(s);
  });
});

describe("hardening tree: robusto ante parentId cíclico (FINDING 2)", () => {
  it("subtreeIds/isAncestor terminan (no cuelgan) con un ciclo a↔b", () => {
    const nodes: LedgerNode[] = [
      { id: "a", ownerId: "local", type: "expense", level: "category", parentId: "b", name: "a", icon: null, order: 0 },
      { id: "b", ownerId: "local", type: "expense", level: "category", parentId: "a", name: "b", icon: null, order: 1 },
    ];
    expect(subtreeIds(nodes, "a").length).toBeLessThan(10); // termina
    expect(isAncestor(nodes, "a", "b")).toBe(true); // termina y responde
  });
});

describe("hardening createNode: traslado de 1ª sub con solo actuals (FINDING 4)", () => {
  it("traslada actuals aunque no haya budget en el padre", () => {
    let s = buildSeed("local");
    // dejar 'c-vivienda' con solo actuals (sin budget)
    s = { ...s, budgets: { ...s.budgets }, actuals: { ...s.actuals, "c-vivienda": { ene: 7000 } } };
    delete s.budgets["c-vivienda"];
    s = createNode(s, { level: "sub", parentId: "c-vivienda", type: "expense", name: "Arriendo" });
    const arriendo = s.nodes.find((n) => n.name === "Arriendo")!;
    expect(s.actuals[arriendo.id].ene).toBe(7000);
    expect(s.actuals["c-vivienda"]).toBeUndefined();
  });
});
