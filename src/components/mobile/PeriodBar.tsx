"use client";
// @aitri-trace components:mobile:PeriodBar — feature presupuesto-movil (FR-3102, FR-3112).
//
// Módulo:       src/components/mobile/PeriodBar.tsx
// Propósito:    Elegir el periodo que muestra la vista de presupuesto: anterior, siguiente y un
//               selector con los mismos periodos y rótulos que escritorio. Marca los cerrados.
// Dependencias: @/state/store, @/domain (isClosed), ../cycleText, ../ui/select, lucide-react.

import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { isClosed, nextReopenable } from "@/domain";
import type { PeriodKey } from "@/domain/types";
import { useCalendar, useClosure, useLedgerStore } from "@/state/store";
import { cycleLabel, withRange } from "../cycleText";
import { CLOSURE, openScreen } from "./screenStack";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const STEP_BUTTON =
  "flex h-(--control-md) w-(--control-md) flex-none items-center justify-center rounded-(--radius-sm) border border-border bg-card text-fg disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * Barra de periodo, fija arriba al hacer scroll.
 *
 * @param period Periodo mostrado.
 * @param periods Periodos activos, en orden (los mismos del selector de escritorio).
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3102, US-ID: US-3102, AC-ID: AC-3104, TC-ID: TC-PMV-010h, TC-PMV-011e, TC-PMV-013e
 * @aitri-trace FR-ID: FR-3102, US-ID: US-3102, AC-ID: AC-3105, TC-ID: TC-PMV-012f
 * @aitri-trace FR-ID: FR-3102, US-ID: US-3102, AC-ID: AC-3106, TC-ID: TC-PMV-014h
 */
export function PeriodBar({ period, periods }: { period: PeriodKey; periods: PeriodKey[] }) {
  const cal = useCalendar();
  const closure = useClosure();
  const setPeriod = useLedgerStore((s) => s.setPeriod);
  const i = periods.indexOf(period);
  const go = (p: PeriodKey | undefined) => {
    if (p) setPeriod({ mode: "month", month: p });
  };
  const closed = isClosed(closure, period);

  return (
    <div data-testid="mb-period-bar" className="sticky top-0 z-10 flex items-center gap-2 bg-bg py-3">
      <button
        type="button"
        data-testid="mb-period-prev"
        aria-label="Periodo anterior"
        className={STEP_BUTTON}
        disabled={i <= 0}
        onClick={() => go(periods[i - 1])}
      >
        <ChevronLeft size={18} strokeWidth={1.75} />
      </button>
      <div className="min-w-0 flex-1">
        <Select value={period} onValueChange={(v) => go(v as PeriodKey)}>
          <SelectTrigger data-testid="mb-period-select" aria-label="Periodo" className="h-(--control-md) label">
            <SelectValue>
              <span className="flex min-w-0 items-center gap-1.5">
                {closed && <Lock size={14} strokeWidth={1.75} aria-label="cerrado" role="img" className="flex-none" />}
                <span data-testid="mb-period-label" className="truncate">{withRange(cal, period)}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p} value={p}>
                <span className="inline-flex items-center gap-1.5">
                  {withRange(cal, p)}
                  {isClosed(closure, p) && <Lock size={12} strokeWidth={1.75} aria-label="cerrado" role="img" />}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <button
        type="button"
        data-testid="mb-period-next"
        aria-label="Periodo siguiente"
        className={STEP_BUTTON}
        disabled={i < 0 || i >= periods.length - 1}
        onClick={() => go(periods[i + 1])}
      >
        <ChevronRight size={18} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/**
 * Aviso de periodo cerrado: se puede mirar, no cambiar.
 *
 * Desde gestion-movil (FR-3209) ya no manda al computador: si el periodo es el último cerrado, lleva
 * a «Cierre de mes»; si no, explica que solo ese se reabre.
 *
 * @param period Periodo cerrado.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3112, US-ID: US-3112, AC-ID: AC-3133, TC-ID: TC-PMV-110h
 * @aitri-trace FR-ID: FR-3209, US-ID: US-3209, AC-ID: AC-3230, TC-ID: TC-GMV-100h, TC-GMV-101f, TC-GMV-104e
 */
export function ClosedNotice({ period }: { period: PeriodKey }) {
  const cal = useCalendar();
  const reopenable = nextReopenable(useClosure());
  return (
    <div
      data-testid="mb-closed-notice"
      role="note"
      className="mb-3 flex items-start gap-2 rounded-(--radius-sm) border border-border bg-sunken px-3 py-2 caption text-fg-secondary"
    >
      <Lock size={14} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
      {reopenable === period ? (
        <span className="min-w-0">
          {cycleLabel(cal, period)} está cerrado. Puedes mirarlo; para cambiarlo, reábrelo.{" "}
          <button
            type="button"
            data-testid="mb-closed-notice-link"
            onClick={() => openScreen(CLOSURE)}
            className="-my-3 inline-flex min-h-(--control-md) items-center font-semibold underline"
          >
            Ir a Cierre de mes ›
          </button>
        </span>
      ) : (
        <span className="min-w-0">
          {cycleLabel(cal, period)} está cerrado. Solo se puede reabrir el último mes cerrado
          {reopenable ? ` (${cycleLabel(cal, reopenable)})` : ""}.
        </span>
      )}
    </div>
  );
}
