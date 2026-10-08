"use client";
// @aitri-trace components:mobile:ImpactCard — feature impacto-movil (FR-3301, FR-3302, FR-3303, FR-3304).
//
// Módulo:       src/components/mobile/ImpactCard.tsx
// Propósito:    El aviso de impacto del teléfono: al corregir un mes reabierto, qué meses posteriores
//               se movieron y cuáles quedaron sin cubrir. Mismo contenido que el `ImpactPanel` de
//               escritorio (cierre-de-mes FR-2010), en una tarjeta plegable. PINTA, no calcula: las
//               filas salen del mismo hook que usa escritorio. No frena nada: solo informa.
// Dependencias: @/state/store (useDownstreamImpact, useClosureStatus, useCalendar), ../cycleText,
//               ../format, lucide-react.

import { ArrowRight, ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useCalendar, useClosureStatus, useDownstreamImpact } from "@/state/store";
import { cn } from "@/lib/utils";
import { cycleLabel } from "../cycleText";
import { money } from "../format";

interface Props {
  /** Si la lista de meses está desplegada. Lo guarda quien monta la tarjeta, para que sobreviva al ir al detalle. */
  open: boolean;
  /** Pliega o despliega. */
  onToggle: () => void;
}

/**
 * Tarjeta de impacto de una corrección sobre un mes reabierto.
 *
 * @returns La tarjeta, o `null` si no hay mes reabierto o ningún mes posterior se movió: sin nada que
 *   decir no existe y no ocupa espacio.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3301, US-ID: US-3301, AC-ID: AC-3301, TC-ID: TC-IMV-001h, TC-IMV-002h, TC-IMV-004e
 * @aitri-trace FR-ID: FR-3302, US-ID: US-3302, AC-ID: AC-3305, TC-ID: TC-IMV-010h, TC-IMV-011f, TC-IMV-013e
 * @aitri-trace FR-ID: FR-3304, US-ID: US-3304, AC-ID: AC-3312, TC-ID: TC-IMV-031f, TC-IMV-032f, TC-IMV-057f
 */
export function ImpactCard({ open, onToggle }: Props) {
  const rows = useDownstreamImpact();
  const { reopened } = useClosureStatus();
  const cal = useCalendar();

  if (!reopened || rows.length === 0) return null;

  const broken = rows.filter((r) => r.brokenByThisEdit).length;
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <section
      role="status"
      data-testid="mb-impact"
      data-reopened={reopened}
      data-rows={rows.length}
      data-broken={broken}
      className="elevated-sm mb-3 rounded-(--radius-md) border bg-card px-3"
      style={{ borderColor: broken > 0 ? "var(--alert-strong)" : "var(--border)" }}
    >
      <button
        type="button"
        data-testid="mb-impact-toggle"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-(--control-lg) w-full items-center gap-2 py-2 text-left"
      >
        <TriangleAlert
          size={14}
          strokeWidth={1.75}
          className="flex-none"
          style={{ color: broken > 0 ? "var(--alert-strong)" : "var(--alert-soft)" }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span data-testid="mb-impact-title" className="label block text-fg">
            Al corregir {cycleLabel(cal, reopened)} {rows.length === 1 ? "se movió 1 mes" : `se movieron ${rows.length} meses`}
          </span>
          <span className="caption block text-fg-muted">
            frente a cómo estaban al reabrirlo
            {broken > 0 && (
              <span data-testid="mb-impact-broken-count" style={{ color: "var(--alert-strong)" }}>
                {" · "}{broken === 1 ? "1 quedó sin cubrir" : `${broken} quedaron sin cubrir`}
              </span>
            )}
          </span>
        </span>
        <Chevron size={14} strokeWidth={1.75} className="flex-none text-fg-muted" aria-hidden />
      </button>

      {open && (
        <>
          <ul>
            {rows.map((r) => (
              <li
                key={r.period}
                data-testid="mb-impact-row"
                data-period={r.period}
                data-broken={r.brokenByThisEdit ? "true" : "false"}
                className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-t border-border py-2"
              >
                <span className="caption text-fg-muted">{cycleLabel(cal, r.period)}</span>
                {/* Las cifras no se cortan: si no caben junto al periodo, el bloque entero baja de línea. */}
                <span data-testid="mb-impact-figures" className="tabular label ml-auto flex items-center gap-1.5 whitespace-nowrap font-normal">
                  <span data-testid="mb-impact-before" className="text-fg-secondary">{money(r.availableBefore)}</span>
                  <ArrowRight size={12} className="flex-none text-fg-muted" aria-hidden />
                  <span data-testid="mb-impact-after" className="text-fg">{money(r.availableAfter)}</span>
                </span>
                {/* La señal de roto no depende solo del color: ícono y texto. */}
                {r.brokenByThisEdit && (
                  <span
                    data-testid="mb-impact-broken"
                    className={cn("caption flex basis-full items-center justify-end gap-1")}
                    style={{ color: "var(--alert-strong)" }}
                  >
                    <TriangleAlert size={12} aria-hidden />
                    quedó sin cubrir
                  </span>
                )}
              </li>
            ))}
          </ul>
          {broken > 0 && (
            <p data-testid="mb-impact-foot" className="caption pb-2.5 pt-1 text-fg-muted">
              {broken === 1 ? "Ese mes quedó" : "Esos meses quedaron"} con gastos sin cubrir por
              esta corrección. La app no te frena: puedes arreglarlo ahora o dejarlo para después.
            </p>
          )}
        </>
      )}
    </section>
  );
}
