"use client";
// @aitri-trace components:mobile:BalanceScreen — feature presupuesto-movil (FR-3111).
//
// Módulo:       src/components/mobile/BalanceScreen.tsx
// Propósito:    El Balance del periodo en el teléfono: los tres bloques de escritorio, cada fila con
//               lo real y, debajo, lo planeado. Solo lectura. Valores, color y la regla del cero salen
//               de las MISMAS funciones que usa el módulo de escritorio (`balanceView`).
// Dependencias: @/domain/balance, ../balanceRows, ../balanceView, ../cycleText, ./DetailHeader.

import { useMemo } from "react";
import { balanceAt, type BalanceSeries } from "@/domain/balance";
import type { PeriodKey } from "@/domain/types";
import { useCalendar, useLedgerStore } from "@/state/store";
import { BLOCKS, ROWS, type RowSpec } from "../balanceRows";
import { balanceColor, balanceRowValue, reserveFlows, zeroIsAnswer } from "../balanceView";
import { cycleLabel } from "../cycleText";
import { DetailHeader } from "./DetailHeader";

/** La cifra de una fila: «0» si el cero es una respuesta, «—» si es la ausencia de dato. */
function figure(spec: RowSpec, value: number): string {
  if (value === 0) return zeroIsAnswer(spec, value) ? "0" : "—";
  return `${value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("es-CO")}`;
}

/**
 * Pantalla del Balance de un periodo.
 *
 * @param series Serie del Balance, ya calculada por la vista (una vez por estado).
 * @param period Periodo mostrado.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3111, US-ID: US-3111, AC-ID: AC-3130, TC-ID: TC-PMV-100h
 * @aitri-trace FR-ID: FR-3111, US-ID: US-3111, AC-ID: AC-3131, TC-ID: TC-PMV-101h, TC-PMV-103e
 * @aitri-trace FR-ID: FR-3111, US-ID: US-3111, AC-ID: AC-3132, TC-ID: TC-PMV-102f
 */
export function BalanceScreen({ series, period }: { series: BalanceSeries; period: PeriodKey }) {
  const data = useLedgerStore((s) => s.data);
  const cal = useCalendar();
  const flows = useMemo(() => reserveFlows(data, [period])[period], [data, period]);
  const month = balanceAt(series, period);

  return (
    <div data-testid="mb-balance">
      <DetailHeader title="Balance" context={cycleLabel(cal, period)} />
      <p className="caption mb-2 mt-1 text-fg-muted">Lo real en grande; lo planeado debajo.</p>
      {BLOCKS.map((block) => (
        <section key={block.key} data-testid="mb-balance-block" data-block={block.key} className="elevated-sm mb-2.5 rounded-(--radius-md) border border-border bg-card px-3 py-2">
          <h2 className="eyebrow mb-0.5 mt-0.5">{block.label}</h2>
          {ROWS.filter((r) => r.block === block.key).map((spec) => {
            const actual = balanceRowValue(month.actual, spec.key, flows.actual);
            const budget = balanceRowValue(month.budget, spec.key, flows.budget);
            return (
              <div
                key={spec.key}
                data-testid="mb-balance-row"
                data-row={spec.key}
                className="grid min-h-(--control-md) grid-cols-[14px_1fr_auto] items-center gap-1.5 py-1"
                style={{ fontWeight: spec.weight }}
              >
                <span className="text-fg-muted" aria-hidden>{spec.op}</span>
                <span data-testid="mb-balance-label" className="label min-w-0" style={{ fontWeight: spec.weight }}>{spec.label}</span>
                <span className="flex flex-col items-end">
                  <span
                    data-testid="mb-balance-actual"
                    className="tabular text-label whitespace-nowrap"
                    style={{ color: actual ? balanceColor(spec, actual) : "var(--fg-muted)" }}
                  >
                    {figure(spec, actual)}
                  </span>
                  <span data-testid="mb-balance-budget" className="text-caption font-normal whitespace-nowrap text-fg-muted">
                    Plan <span className="tabular">{figure(spec, budget)}</span>
                  </span>
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
