// BL-009 — `rollupTable` calcula todos los roll-ups de la grilla en una pasada. Su contrato es dar
// EXACTAMENTE lo mismo que `rollupBudget`/`rollupActual`/`typeTotals` celda a celda: la grilla dejó
// de llamar a esas funciones por celda y pasó a leer la tabla, así que cualquier diferencia sería
// una cifra distinta en pantalla.
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { rollupBudget, rollupActual, typeTotals, rollupTable } from "@/domain/rollup";
import type { LedgerNode, LedgerState, NodeLevel, NodeType, PeriodKey } from "@/domain/types";
import { P, P0 } from "../helpers/periods";

const TYPES: NodeType[] = ["expense", "income", "transfer"];

/** Generador determinista (mulberry32): cada semilla da siempre el mismo árbol. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Árbol aleatorio con los casos raros que las funciones originales resuelven a su manera:
 * grupos y categorías sin hijos (son hoja), subcategorías CON hijos (siguen siendo hoja), un padre
 * que no existe, y celdas con y sin monto en nodos no-hoja.
 */
function randomState(seed: number, size: number): LedgerState {
  const r = rng(seed);
  const nodes: LedgerNode[] = [];
  const levels: NodeLevel[] = ["group", "category", "sub"];
  for (let i = 0; i < size; i++) {
    const type = TYPES[Math.floor(r() * 3)];
    const sameType = nodes.filter((n) => n.type === type);
    const roll = r();
    const parentId = roll < 0.25 || sameType.length === 0 ? null : roll < 0.28 ? "no-existe" : sameType[Math.floor(r() * sameType.length)].id;
    nodes.push({ id: `n${i}`, type, level: levels[Math.floor(r() * 3)], parentId, name: `n${i}`, order: i } as LedgerNode);
  }
  const budgets: LedgerState["budgets"] = {};
  const actuals: LedgerState["actuals"] = {};
  for (const n of nodes) {
    for (const m of P) {
      if (r() < 0.7) (budgets[n.id] ??= {})[m] = Math.floor(r() * 1_000_000);
      if (r() < 0.7) (actuals[n.id] ??= {})[m] = Math.floor(r() * 1_000_000);
    }
  }
  return { ...buildSeed("local", P0), nodes, budgets, actuals };
}

function expectSameAsOriginal(state: LedgerState, periods: readonly PeriodKey[]) {
  const table = rollupTable(state, periods);
  for (const n of state.nodes) {
    for (const m of periods) {
      expect(table.cell(n.id, m), `${n.id} · ${m}`).toEqual({
        budget: rollupBudget(state, n.id, m),
        actual: rollupActual(state, n.id, m),
      });
    }
  }
  for (const t of TYPES) {
    for (const m of periods) expect(table.type(t, m), `${t} · ${m}`).toEqual(typeTotals(state, t, [m]));
  }
}

describe("BL-009 · rollupTable da lo mismo que las funciones celda a celda", () => {
  it("sobre la semilla", () => {
    expectSameAsOriginal(buildSeed("local", P0), P);
  });

  it("sobre 200 árboles aleatorios con hojas raras, padres huérfanos y celdas vacías", () => {
    for (let seed = 1; seed <= 200; seed++) expectSameAsOriginal(randomState(seed, 5 + (seed % 60)), P);
  });

  it("con datos corruptos (ciclo de padres) delega en las funciones originales", () => {
    const state = randomState(7, 20);
    const nodes = state.nodes.map((n) =>
      n.id === "n1" ? { ...n, parentId: "n2" } : n.id === "n2" ? { ...n, parentId: "n1" } : n
    );
    expectSameAsOriginal({ ...state, nodes }, P);
  });

  it("un nodo inexistente vale 0 (como en las originales) y un periodo no pedido también", () => {
    const state = buildSeed("local", P0);
    const table = rollupTable(state, P.slice(0, 1));
    expect(table.cell("no-existe", P[0])).toEqual({ budget: 0, actual: 0 });
    expect(table.cell(state.nodes[0].id, P[1])).toEqual({ budget: 0, actual: 0 });
  });
});
