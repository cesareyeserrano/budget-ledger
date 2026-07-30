/**
 * Feature transferencias (Reservas) — EP-08: NFR-1005 (performance).
 * El guardrail heredado (≤150 ms por edición) se MIDE de nuevo sobre la ruta real — resolución por
 * hoja + validación en cadena + balance — no se hereda la cifra vieja (9.2).
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
import { MONTH_KEYS } from "@/domain/months";
import type { AmountMap, LedgerNode, LedgerState, MonthKey } from "@/domain/types";

/** 30 alcancías × 12 meses con historia mixta (explícitos y arrastres) + flujo real. */
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
    actuals["c-salario"][m] = 90_000_000; // margen holgado: la edición cronometrada no bloquea
    actuals["c-mercado"][m] = 1_000_000;
  }
  for (let i = 0; i < 30; i++) {
    const id = `c-alcancia-${i}`;
    nodes.push({ id, ownerId: "local", type: "transfer", level: "category", parentId: "g-ahorro", name: `Alcancía ${i}`, icon: null, order: 5 + i });
    actuals[id] = {};
    budgets[id] = {};
    // Historia mixta: explícitos en meses alternos (según i), arrastre en los demás.
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
  it("TC-TRF-155h: edición + validación en cadena + balance ≤150ms con 30 alcancías", () => {
    // @aitri-tc TC-TRF-155h
    const s = makeBigState();

    const t0 = performance.now();
    // La ruta REAL de un tecleo: validar…
    const verdict = validateReserveWrite(s, { leafId: "c-alcancia-7", month: "sep", plane: "actual", newBalance: 500_000 });
    // …aplicar la edición (incluye su propia validación en cadena)…
    const applied = applyReserveCellEdit(s, { leafId: "c-alcancia-7", month: "sep", plane: "actual", newBalance: 500_000 });
    if (!("state" in applied)) throw new Error("edición válida rechazada");
    // …y recomputar lo que la pantalla consume: balance completo + fila total de los 12 meses.
    const series = computeBalanceSeries(applied.state);
    for (const m of MONTH_KEYS) resolvedTypeTotal(applied.state, m, "actual");
    const elapsed = performance.now() - t0;

    expect(verdict.ok).toBe(true);
    expect(series.dic.actual).toBeDefined();
    expect(elapsed, `ruta completa en ${elapsed.toFixed(1)}ms`).toBeLessThanOrEqual(150);
  });

  it("TC-TRF-155e: la memoización por identidad evita recomputar sin cambios", () => {
    // @aitri-tc TC-TRF-155e
    const s = makeBigState();

    const first = resolvedSeries(s, "c-alcancia-3", "actual");
    const computesAfterFirst = __reservePerfCounters().seriesComputes;
    expect(computesAfterFirst).toBe(1);

    // Mismo objeto data, consultas repetidas: cero recomputos y la MISMA referencia.
    const second = resolvedSeries(s, "c-alcancia-3", "actual");
    for (const m of MONTH_KEYS) resolvedSeries(s, "c-alcancia-3", "actual");
    expect(second).toBe(first);
    expect(__reservePerfCounters().seriesComputes).toBe(1);

    // Una mutación (data nuevo) SÍ recomputa — y el resultado refleja el cambio.
    const applied = applyReserveCellEdit(s, { leafId: "c-alcancia-3", month: "ene", plane: "actual", newBalance: 999_000 });
    if (!("state" in applied)) throw new Error("edición válida rechazada");
    __resetReservePerfCounters();
    const third = resolvedSeries(applied.state, "c-alcancia-3", "actual");
    expect(__reservePerfCounters().seriesComputes).toBe(1);
    expect(third).not.toBe(first);
    expect(third[0]).toBe(999_000);
  });

  it("TC-TRF-155f: la validación no degrada la edición de gastos/ingresos", () => {
    // @aitri-tc TC-TRF-155f
    const s = makeBigState();

    const t0 = performance.now();
    const next = setLeafAmount(s, "c-mercado", "jun", "actual", 2_000_000);
    const elapsed = performance.now() - t0;

    // Un gasto JAMÁS pasa por las reglas de reservas (contador 0) y queda dentro del guardrail.
    expect(__reservePerfCounters().validateCalls).toBe(0);
    expect(next.actuals["c-mercado"].jun).toBe(2_000_000);
    expect(elapsed, `edición expense en ${elapsed.toFixed(1)}ms`).toBeLessThanOrEqual(150);
  });
});
