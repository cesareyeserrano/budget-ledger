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
import type { LedgerState, PeriodKey, NodeType } from "@/domain/types";
import { typeTotals } from "@/domain/rollup";
import { resolvedTypeTotal } from "@/domain/reserve";
import { isLeaf } from "@/domain/tree";
import { P as MONTH_KEYS } from "../helpers/periods";
import type { Plane } from "@/domain/reserve";
import { P } from "../helpers/periods";

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

/**
 * Invariante de conservación para RESERVAS (FR-1011): Σ de saldos RESUELTOS del tipo transfer,
 * mes a mes. Para saldos, sumar celdas de 12 meses no significa nada (200 constantes = 2.400);
 * lo que una reestructuración debe conservar es ESTA serie — idéntica antes y después, en los
 * 12 meses de ambos planos.
 */
export function resolvedYearByMonth(state: LedgerState, plane: Plane): Record<PeriodKey, number> {
  const out = {} as Record<PeriodKey, number>;
  for (const m of MONTH_KEYS) out[m] = resolvedTypeTotal(state, m, plane, P);
  return out;
}
