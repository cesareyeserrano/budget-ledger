/**
 * Helpers de conservación de totales — el invariante que NFR-005 (raíz) y NFR-902 (feature balance)
 * declaran y que hasta BG-009 ningún test comprobaba: reestructurar la jerarquía NO puede cambiar
 * cuánto suma el presupuesto ni el ejecutado.
 *
 * Por qué hace falta un helper y no una aserción suelta: los tests de reparent afirmaban "totales
 * cuadran" con `noOrphans()` y `subtreeIds().toContain()`, que verifican la FORMA del árbol, no el
 * DINERO. Un nodo puede estar perfectamente colgado y aun así llevarse un presupuesto fuera de todos
 * los agregados. Estas dos funciones miden el dinero.
 */
import type { LedgerState, NodeType } from "@/domain/types";
import { typeTotals } from "@/domain/rollup";
import { isLeaf } from "@/domain/tree";
import { MONTH_KEYS } from "@/domain/months";

const TYPES: NodeType[] = ["expense", "income", "transfer"];

export type YearTotals = Record<NodeType, { budget: number; actual: number }>;

/**
 * Presupuestado y Ejecutado de cada tipo sumando los 12 meses. Es la cifra más alta de la grilla:
 * si una reestructuración la mueve, algo se perdió o se duplicó por el camino.
 */
export function yearTotals(state: LedgerState): YearTotals {
  const out = {} as YearTotals;
  for (const t of TYPES) out[t] = typeTotals(state, t, MONTH_KEYS);
  return out;
}

/**
 * Nodos que retienen presupuesto siendo NO-hoja: dinero invisible.
 *
 * `rollupBudget` agrega SOLO hojas, así que un monto de Presupuestado colgado de un nodo con hijos no
 * lo suma nadie — ni su grupo, ni su tipo, ni los KPIs, ni el módulo de Balance —, pero sigue en
 * `state.budgets` sin forma de recuperarlo desde la UI. Es exactamente la fuga de BG-009.
 *
 * Solo mira `budgets`: `rollupActual` agrega todo el subárbol (`subtreeIds`), de modo que un
 * Ejecutado en un nodo interno SÍ se cuenta y no se pierde.
 */
export function orphanBudgetNodes(state: LedgerState): string[] {
  return state.nodes
    .filter((n) => !isLeaf(n, state.nodes))
    .filter((n) => Object.values(state.budgets[n.id] ?? {}).some((v) => (v ?? 0) > 0))
    .map((n) => n.id);
}
