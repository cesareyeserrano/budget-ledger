// @aitri-trace domain:dashboard — FR-009: 7 indicadores mínimos con filtro Mes/Año.
import type { LedgerState, MonthKey } from "./types";
import { MONTH_KEYS } from "./months";
import { typeTotals } from "./rollup";
import { subtreeIds, isLeaf } from "./tree";

export type Period = { mode: "month"; month: MonthKey } | { mode: "year" };

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

function months(period: Period): MonthKey[] {
  return period.mode === "month" ? [period.month] : MONTH_KEYS;
}

export function dashboardMetrics(state: LedgerState, period: Period): DashboardVM {
  const ms = months(period);
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
