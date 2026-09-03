import { describe, it, expect } from "vitest";
import type { LedgerNode, LedgerState } from "@/domain/types";
import { computeBalanceSeries } from "@/domain/balance";
import { AVAILABLE_ID, resolvedBalance } from "@/domain/reserve";
import { P as MONTH_KEYS } from "../helpers/periods";
import { P } from "../helpers/periods";

// Feature resumen-plegado — NFR-1502 (regresión): la feature cambia QUÉ cifra se pinta al plegar,
// no CÓMO se calcula. `src/domain/balance.ts` no se tocó, y estos TCs lo afirman: reconciliación,
// arrastre entre meses y el caso de retiro neto siguen exactamente como los dejó `transferencias`.

const OWNER = "local";
const GASTO = "c-mercado";
const ING = "c-salario";
const ALC = "c-alcancia";

const node = (id: string, type: LedgerNode["type"], name: string): LedgerNode => ({
  id, ownerId: OWNER, type, level: "category", parentId: null, name, icon: null, order: 0,
});

function estado(opts: {
  ingBudget: number; ingActual: number; gasto: number; aporte: number;
  retiro?: { period: (typeof MONTH_KEYS)[number]; amount: number };
}): LedgerState {
  const porMes = (v: number) => Object.fromEntries(MONTH_KEYS.map((m) => [m, v]));
  return {
    ownerId: OWNER,
    nodes: [node(GASTO, "expense", "Mercado"), node(ING, "income", "Salario"), node(ALC, "transfer", "Alcancía")],
    budgets: { [ING]: porMes(opts.ingBudget), [GASTO]: porMes(opts.gasto), [ALC]: porMes(opts.aporte) },
    actuals: { [ING]: porMes(opts.ingActual), [GASTO]: porMes(opts.gasto), [ALC]: porMes(opts.aporte) },
    movements: opts.retiro
      ? [{
          id: "mov-retiro", ownerId: OWNER, type: "transfer", catId: ALC, subId: null, target: ALC,
          amount: opts.retiro.amount, period: opts.retiro.period, createdAt: 1,
          from: ALC, to: AVAILABLE_ID,
        }]
      : [],
  };
}

/** Las 24 comprobaciones de reconciliación: total = disponible + reservado, mes a mes y plano a plano. */
function desviaciones(state: LedgerState): number[] {
  const s = computeBalanceSeries(state, P);
  const out: number[] = [];
  for (const m of MONTH_KEYS) {
    for (const p of ["budget", "actual"] as const) {
      const b = s[m][p];
      out.push(b.total - b.available - b.reservedBalance);
    }
  }
  return out;
}

describe("resumen-plegado · NFR-1502 — la aritmética del balance no cambia", () => {
  it("TC-RSP-030h: total = disponible + reservado en los 12 meses y los 2 planos", () => {
    const s = estado({ ingBudget: 1_000_000, ingActual: 1_000_000, gasto: 300_000, aporte: 100_000 });

    const series = computeBalanceSeries(s, P);
    // el fixture SEPARA las dos cifras — sin eso, la reconciliación pasaría por casualidad
    expect(series["2026-01"].actual.available).toBe(600_000);
    expect(series["2026-01"].actual.reservedBalance).toBe(100_000);
    expect(series["2026-01"].actual.total).toBe(700_000);

    const d = desviaciones(s);
    expect(d).toHaveLength(24);
    expect(d.every((x) => x === 0)).toBe(true);
  });

  it("TC-RSP-031e: ambos planos abren el mes con el cierre EJECUTADO real del mes previo", () => {
    const s = estado({ ingBudget: 1_000_000, ingActual: 600_000, gasto: 300_000, aporte: 100_000 });
    const series = computeBalanceSeries(s, P);

    // enero cierra distinto en cada plano...
    expect(series["2026-01"].budget.available).toBe(600_000);
    expect(series["2026-01"].actual.available).toBe(200_000);

    // ...y aun así febrero abre los DOS planos con el cierre ejecutado (ADR-03 de `balance`)
    expect(series["2026-02"].budget.prevAvailable).toBe(200_000);
    expect(series["2026-02"].actual.prevAvailable).toBe(200_000);
  });

  it("TC-RSP-032f: un mes con retiro neto no rompe la reconciliación ni deja la alcancía en rojo", () => {
    const s = estado({
      ingBudget: 1_000_000, ingActual: 1_000_000, gasto: 300_000, aporte: 100_000,
      retiro: { period: "2026-03", amount: 150_000 }, // > el aporte del mes → marzo queda en retiro NETO
    });
    const series = computeBalanceSeries(s, P);

    expect(series["2026-03"].actual.reserved).toBeLessThan(0); // marzo es retiro NETO
    expect(desviaciones(s).every((x) => x === 0)).toBe(true);
    for (const m of MONTH_KEYS) {
      expect(resolvedBalance(s, ALC, m, "actual", P)).toBeGreaterThanOrEqual(0);
    }
  });
});
