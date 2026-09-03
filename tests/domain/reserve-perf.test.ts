/**
 * Feature transferencias · modelo v4 — NFR-1005 (performance): la ruta real ≤150 ms con 30
 * alcancías, memoización por identidad y cero acoplamiento con la edición de gastos.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetReservePerfCounters,
  __reservePerfCounters,
  applyReserveCellEdit,
  resolvedSeries,
  resolvedTypeTotal,
  validateReserveWrite,
} from "@/domain/reserve";
import { setLeafAmount } from "@/domain/mutations";
import { computeBalanceSeries } from "@/domain/balance";
import { P as MONTH_KEYS } from "../helpers/periods";
import type { AmountMap, LedgerNode, LedgerState } from "@/domain/types";
import { P } from "../helpers/periods";

/** 30 alcancías × 12 meses con aportes mixtos + flujo real. */
function makeBigState(): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-ingresos", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
    { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ingresos", name: "Salario", icon: null, order: 1 },
    { id: "g-gastos", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
    { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gastos", name: "Mercado", icon: null, order: 3 },
    { id: "g-ahorro", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: null, order: 4 },
  ];
  const budgets: AmountMap = {};
  const actuals: AmountMap = { "c-salario": {}, "c-mercado": {} };
  for (const m of MONTH_KEYS) {
    actuals["c-salario"][m] = 90_000_000;
    actuals["c-mercado"][m] = 1_000_000;
  }
  for (let i = 0; i < 30; i++) {
    const id = `c-alcancia-${i}`;
    nodes.push({ id, ownerId: "local", type: "transfer", level: "category", parentId: "g-ahorro", name: `Alcancía ${i}`, icon: null, order: 5 + i });
    actuals[id] = {};
    budgets[id] = {};
    for (let mi = 0; mi < 12; mi++) {
      if ((mi + i) % 3 === 0) {
        actuals[id][MONTH_KEYS[mi]] = 100_000 + i * 10_000 + mi * 1_000;
        budgets[id][MONTH_KEYS[mi]] = 120_000 + i * 10_000 + mi * 1_000;
      }
    }
  }
  return { ownerId: "local", nodes, budgets, actuals, movements: [] };
}

beforeEach(() => {
  __resetReservePerfCounters();
});

describe("NFR-1005 · performance de la capa de reservas", () => {
  it("TC-TRF4-155h: edición + validación en cadena + balance ≤150ms con 30 alcancías", () => {
    // @aitri-tc TC-TRF4-155h
    const s = makeBigState();

    const t0 = performance.now();
    const verdict = validateReserveWrite(s, { leafId: "c-alcancia-7", period: "2026-09", plane: "actual", newAmount: 500_000 }, P);
    const applied = applyReserveCellEdit(s, { leafId: "c-alcancia-7", period: "2026-09", plane: "actual", newAmount: 500_000 }, P);
    if (!("state" in applied)) throw new Error("edición válida rechazada");
    const series = computeBalanceSeries(applied.state, P);
    for (const m of MONTH_KEYS) resolvedTypeTotal(applied.state, m, "actual", P);
    const elapsed = performance.now() - t0;

    expect(verdict.ok).toBe(true);
    expect(series["2026-12"].actual).toBeDefined();
    expect(elapsed, `ruta completa en ${elapsed.toFixed(1)}ms`).toBeLessThanOrEqual(150);
  });

  it("TC-TRF4-155e: la memoización por identidad evita recomputar sin cambios", () => {
    // @aitri-tc TC-TRF4-155e
    const s = makeBigState();

    const first = resolvedSeries(s, "c-alcancia-3", "actual", P);
    expect(__reservePerfCounters().seriesComputes).toBe(1);
    const second = resolvedSeries(s, "c-alcancia-3", "actual", P);
    for (const m of MONTH_KEYS) resolvedSeries(s, "c-alcancia-3", "actual", P);
    expect(second).toBe(first); // misma referencia = cero recomputos
    expect(__reservePerfCounters().seriesComputes).toBe(1);

    const applied = applyReserveCellEdit(s, { leafId: "c-alcancia-3", period: "2026-01", plane: "actual", newAmount: 999_000 }, P);
    if (!("state" in applied)) throw new Error("edición válida rechazada");
    __resetReservePerfCounters();
    const third = resolvedSeries(applied.state, "c-alcancia-3", "actual", P);
    expect(__reservePerfCounters().seriesComputes).toBe(1); // data nuevo SÍ recomputa
    expect(third).not.toBe(first);
    expect(third[0]).toBe(999_000);
  });

  it("TC-TRF4-155f: la edición de gastos/ingresos no pasa por las reglas de reservas", () => {
    // @aitri-tc TC-TRF4-155f
    const s = makeBigState();

    const t0 = performance.now();
    const next = setLeafAmount(s, "c-mercado", "2026-06", "actual", 2_000_000, P);
    const elapsed = performance.now() - t0;

    expect(__reservePerfCounters().validateCalls).toBe(0); // cero acoplamiento
    expect(next.actuals["c-mercado"]["2026-06"]).toBe(2_000_000);
    expect(elapsed, `edición expense en ${elapsed.toFixed(1)}ms`).toBeLessThanOrEqual(150);
  });
});
