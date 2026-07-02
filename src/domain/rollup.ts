// @aitri-trace domain:rollup — FR-004: Presupuestado agrega hojas; Ejecutado agrega el subárbol.
import type { LedgerState, MonthKey, NodeType } from "./types";
import { isLeaf, leafDescendants, subtreeIds, findNode } from "./tree";
import { MONTH_KEYS } from "./months";

/** Presupuestado de un nodo en un mes = suma de sus hojas descendientes. */
export function rollupBudget(state: LedgerState, nodeId: string, month: MonthKey): number {
  const node = findNode(state.nodes, nodeId);
  if (!node) return 0;
  const leaves = isLeaf(node, state.nodes) ? [nodeId] : leafDescendants(state.nodes, nodeId);
  return leaves.reduce((sum, id) => sum + (state.budgets[id]?.[month] ?? 0), 0);
}

/** Ejecutado de un nodo en un mes = suma de todo su subárbol (incluye montos directos en categoría-hoja). */
export function rollupActual(state: LedgerState, nodeId: string, month: MonthKey): number {
  const node = findNode(state.nodes, nodeId);
  if (!node) return 0;
  const ids = isLeaf(node, state.nodes) ? [nodeId] : subtreeIds(state.nodes, nodeId);
  return ids.reduce((sum, id) => sum + (state.actuals[id]?.[month] ?? 0), 0);
}

/** Totales de un tipo (Presupuestado por hojas del tipo; Ejecutado por todo nodo del tipo). */
export function typeTotals(
  state: LedgerState,
  type: NodeType,
  months: MonthKey[] = MONTH_KEYS
): { budget: number; actual: number } {
  const leaves = state.nodes.filter((n) => n.type === type && isLeaf(n, state.nodes)).map((n) => n.id);
  const all = state.nodes.filter((n) => n.type === type).map((n) => n.id);
  let budget = 0;
  let actual = 0;
  for (const m of months) {
    for (const id of leaves) budget += state.budgets[id]?.[m] ?? 0;
    for (const id of all) actual += state.actuals[id]?.[m] ?? 0;
  }
  return { budget, actual };
}
