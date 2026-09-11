// @aitri-trace domain:dashboard — FR-009: 7 indicadores mínimos con filtro Mes/Año.
import type { LedgerState, PeriodKey } from "./types";
import { periodYear } from "./periods";
import { typeTotals } from "./rollup";
import { subtreeIds, isLeaf } from "./tree";

/**
 * Alcance del filtro. El modo amplio sigue siendo UN AÑO — decisión del usuario (2026-09-02):
 * «año no puede ser todo, debe ser año, y ya no puede tener un balance de todo sin filtro».
 *
 * Lo que cambia con multi-anio es que el año deja de ser implícito: hay que DECIR cuál. Antes el
 * modo "year" no llevaba dato porque solo existía un año; ahora lo lleva.
 */
export type Period = { mode: "month"; month: PeriodKey } | { mode: "year"; year: number };

export interface OverBudgetItem { catId: string; name: string; over: number; pct: number }
export interface TopCatItem { catId: string; name: string; amount: number }

export interface DashboardVM {
  income: number;
  expense: number;
  balance: number;
  savingsRate: number; // %
  adherence: number; // % ejecutado del presupuesto de gastos
  topCategories: TopCatItem[];
  overBudget: OverBudgetItem[];
}

function months(period: Period, scope: readonly PeriodKey[]): readonly PeriodKey[] {
  if (period.mode === "month") return [period.month];
  // Los periodos del año pedido que EXISTEN en el rango activo. Un año sin datos ni horizonte no
  // inventa doce columnas: devuelve lo que hay.
  return scope.filter((p) => periodYear(p) === period.year);
}

/** Las tres cifras de la franja «Resumen» del escritorio (FR-016), todas del tipo Gasto. */
export interface SummaryKpis {
  /** Presupuestado agregado del tipo Gasto en el alcance del filtro. */
  presupuestado: number;
  /** Ejecutado agregado del tipo Gasto en el alcance del filtro. */
  ejecutado: number;
  /** Porcentaje consumido del presupuesto, entero. 0 si no hay presupuesto (no divide por cero). */
  pct: number;
  /** Presupuestado − Ejecutado. Negativo = sobre el plan. */
  available: number;
}

/**
 * Cifras de la franja «Resumen» (FR-016). DERIVADA, nunca almacenada — misma decisión que los
 * roll-ups (ADR-02): sin estado propio no puede desincronizarse de la grilla.
 *
 * Vivía como un useMemo dentro de DesktopShell, que es justamente por qué el requisito no tenía
 * test: la lógica no era alcanzable sin montar el componente. Extraída aquí, se verifica como el
 * resto del dominio.
 *
 * Solo agrega el tipo `expense`: es lo que hace comparable el par «presupuestado vs disponible»
 * del plan de gasto — un Ingreso o una Transferencia no lo alteran.
 *
 * @aitri-trace domain:summary — FR-016, TC-016h/TC-016e/TC-016f
 */
export function summaryKpis(state: LedgerState, period: Period, scope: readonly PeriodKey[]): SummaryKpis {
  const exp = typeTotals(state, "expense", months(period, scope));
  return {
    presupuestado: exp.budget,
    ejecutado: exp.actual,
    pct: exp.budget > 0 ? Math.round((exp.actual / exp.budget) * 100) : 0,
    available: exp.budget - exp.actual,
  };
}

export function dashboardMetrics(state: LedgerState, period: Period, scope: readonly PeriodKey[]): DashboardVM {
  const ms = months(period, scope);
  const inc = typeTotals(state, "income", ms);
  const exp = typeTotals(state, "expense", ms);
  const balance = inc.actual - exp.actual;
  const savingsRate = inc.actual > 0 ? Math.round((balance / inc.actual) * 100) : 0;
  const adherence = exp.budget > 0 ? Math.round((exp.actual / exp.budget) * 100) : 0;

  // Top categorías de gasto y categorías sobre presupuesto (nivel categoría del tipo expense).
  const expenseCats = state.nodes.filter((n) => n.type === "expense" && n.level === "category");
  const top: TopCatItem[] = [];
  const over: OverBudgetItem[] = [];
  for (const cat of expenseCats) {
    const ids = subtreeIds(state.nodes, cat.id);
    const leaves = ids.filter((cid) => {
      const c = state.nodes.find((n) => n.id === cid);
      return c && isLeaf(c, state.nodes);
    });
    let actual = 0;
    let budget = 0;
    for (const m of ms) {
      for (const cid of ids) actual += state.actuals[cid]?.[m] ?? 0;
      for (const cid of leaves) budget += state.budgets[cid]?.[m] ?? 0;
    }
    if (actual > 0) top.push({ catId: cat.id, name: cat.name, amount: actual });
    if (actual > budget) {
      over.push({ catId: cat.id, name: cat.name, over: actual - budget, pct: budget > 0 ? Math.round((actual / budget) * 100) : 0 });
    }
  }
  top.sort((a, b) => b.amount - a.amount);
  over.sort((a, b) => b.over - a.over);

  return { income: inc.actual, expense: exp.actual, balance, savingsRate, adherence, topCategories: top, overBudget: over };
}
