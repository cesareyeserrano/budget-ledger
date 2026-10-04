"use client";
// @aitri-trace components:mobile:SummaryCard — feature presupuesto-movil (FR-3115), ADR-04.
//
// Módulo:       src/components/mobile/SummaryCard.tsx
// Propósito:    El resumen de saldos del periodo: pequeño, plegable y con los valores protegidos.
//               Mientras están ocultos NO se renderiza ninguna cifra —se pinta un literal fijo—, así
//               que los dígitos no están en el DOM: ni en una captura, ni en un lector de pantalla.
// Dependencias: ../balanceView (BalanceSummary), ../format, ./screenStack, ./useHoldReveal, lucide-react.

import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import type { BalanceSummary, SaldoPar } from "../balanceView";
import { openScreen } from "./screenStack";
import { useHoldReveal } from "./useHoldReveal";

/** Lo que se pinta en lugar de una cifra oculta. Ancho fijo: no delata la magnitud. */
export const MASK = "$ ••••••";
const ICON_BUTTON = "flex h-(--control-md) w-(--control-md) flex-none items-center justify-center rounded-full";

/** Una cifra del resumen: el número con su signo, o «0». Nunca el guion: un saldo en cero es una respuesta. */
function figure(n: number): string {
  return `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("es-CO")}`;
}

/** El texto de un saldo: su cifra si está revelado; el literal fijo si no. */
function Saldo({ id, value, shown, className }: { id: string; value: number; shown: boolean; className: string }) {
  return (
    // Peso 400 siempre: las cifras van en DM Mono, que no trae negrita.
    <span data-testid={id} className={className} style={{ fontWeight: 400 }} aria-label={shown ? undefined : "oculto"}>
      {shown ? figure(value) : MASK}
    </span>
  );
}

const OTHERS: { key: "resultado" | "reservado" | "total"; label: string }[] = [
  { key: "resultado", label: "Resultado del mes" },
  { key: "reservado", label: "Saldo reservado" },
  { key: "total", label: "Saldo total" },
];

/**
 * Tarjeta de resumen de saldos.
 *
 * Abre plegada (solo «Saldo disponible») y oculta. La flecha la despliega; mantener presionado el
 * ojo muestra los valores mientras dura la presión.
 *
 * @param summary Los cuatro saldos del periodo, en lo real y en lo planeado.
 * @param open Si está desplegada.
 * @param onToggle Pliega o despliega.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3115, US-ID: US-3115, AC-ID: AC-3142, TC-ID: TC-PMV-140h, TC-PMV-146f, TC-PMV-147e
 * @aitri-trace FR-ID: FR-3115, US-ID: US-3115, AC-ID: AC-3144, TC-ID: TC-PMV-142h
 */
export function SummaryCard({ summary, open, onToggle }: { summary: BalanceSummary; open: boolean; onToggle: () => void }) {
  const { shown, hint, bind } = useHoldReveal();
  const plan = (p: SaldoPar, id: string) => (
    <div className="text-caption whitespace-nowrap" style={{ opacity: 0.7 }}>
      Plan <Saldo id={id} value={p.budget} shown={shown} className="tabular" />
    </div>
  );
  /** Rótulo en versalitas del sistema (`eyebrow`), con el color del texto de la tarjeta y no el atenuado. */
  const eyebrow = (text: string) => <div className="eyebrow" style={{ color: "inherit", opacity: 0.7 }}>{text}</div>;

  return (
    <div className="mb-1">
      <div
        data-testid="mb-summary"
        data-open={open}
        data-shown={shown}
        className="elevated-md rounded-(--radius-lg) py-2.5 pl-4 pr-2"
        style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {eyebrow("Saldo disponible")}
            <Saldo id="mb-saldo-disponible" value={summary.disponible.actual} shown={shown} className="tabular block title" />
          </div>
          <div className="flex flex-none">
            <button
              type="button"
              data-testid="mb-summary-eye"
              aria-label="Mantén presionado para ver los saldos"
              aria-pressed={shown}
              className={ICON_BUTTON}
              style={{
                userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", touchAction: "none",
                background: shown ? "color-mix(in srgb, var(--primary-foreground) 22%, transparent)" : "transparent",
              }}
              {...bind}
            >
              {shown ? <Eye size={18} strokeWidth={1.75} aria-hidden /> : <EyeOff size={18} strokeWidth={1.75} aria-hidden />}
            </button>
            <button
              type="button"
              data-testid="mb-summary-toggle"
              aria-label={open ? "Plegar el resumen" : "Desplegar el resumen"}
              aria-expanded={open}
              className={ICON_BUTTON}
              onClick={onToggle}
            >
              {open ? <ChevronUp size={18} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={18} strokeWidth={1.75} aria-hidden />}
            </button>
          </div>
        </div>

        {open && (
          <div data-testid="mb-summary-more" className="pr-2">
            {plan(summary.disponible, "mb-plan-disponible")}
            {/* Una fila por saldo, con lo real a la derecha y su plan debajo: la misma lectura que el
                Balance. Tres columnas no dan para cifras de nueve dígitos dentro de la escala de letra. */}
            <div
              className="mt-2.5 flex flex-col gap-1.5 pt-2.5"
              style={{ borderTop: "1px solid color-mix(in srgb, var(--primary-foreground) 25%, transparent)" }}
            >
              {OTHERS.map(({ key, label }) => (
                <div key={key} className="flex items-start justify-between gap-3">
                  {eyebrow(label)}
                  <div className="flex flex-col items-end">
                    <Saldo id={`mb-saldo-${key}`} value={summary[key].actual} shown={shown} className="tabular text-label" />
                    {plan(summary[key], `mb-plan-${key}`)}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              data-testid="mb-summary-balance"
              className="mt-1 flex min-h-(--control-md) items-center text-caption font-medium"
              style={{ color: "inherit" }}
              onClick={() => openScreen({ view: "presupuesto", detail: { kind: "balance" } })}
            >
              Ver Balance completo ›
            </button>
          </div>
        )}
      </div>
      <p data-testid="mb-summary-hint" role="status" className="caption min-h-5 pt-1 text-fg-muted">
        {hint ? "Mantén presionado para ver" : ""}
      </p>
    </div>
  );
}
