"use client";
// @aitri-trace components:mobile:BudgetSections — feature presupuesto-movil (FR-3103, FR-3114).
//
// Módulo:       src/components/mobile/BudgetSections.tsx
// Propósito:    Pinta la lista de un periodo: una sección por tipo y una tarjeta por grupo, con la
//               fila de presupuesto (nombre, ejecutado, barra de avance y «de <presupuestado>»).
//               PINTA, no calcula: todo sale del view-model `periodView`.
// Dependencias: @/domain (PeriodView), ../format, ./tone, lucide-react.

import { ArrowLeft, ArrowRight, ArrowRightLeft, ChevronDown, ChevronRight } from "lucide-react";
import { RETIROS_PLAN_ID, type PeriodRow, type PeriodSection, type PeriodView } from "@/domain";
import type { NodeType } from "@/domain/types";
import { cn } from "@/lib/utils";
import { cellNum } from "../format";
import { ORGANIZE, openScreen } from "./screenStack";
import { barColor, toneColor } from "./tone";

const SECTION: Record<NodeType, { label: string; Icon: typeof ArrowLeft }> = {
  income: { label: "Ingresos", Icon: ArrowLeft },
  expense: { label: "Gastos", Icon: ArrowRight },
  transfer: { label: "Reservas", Icon: ArrowRightLeft },
};

/** A partir de esta longitud la cifra baja un escalón de tamaño para no desbordar (FR-3114). */
const LONG_FIGURE = 11;
const PERCENT = 100;

/**
 * Barra de avance: ejecutado sobre presupuestado, con el tono de estado de la fila.
 *
 * Es decorativa para lectores de pantalla: la información está en las dos cifras.
 *
 * @param progress Avance de 0 a 1.
 * @param color Color del relleno.
 * @throws Nunca.
 */
function ProgressBar({ progress, color }: { progress: number; color: string }) {
  return (
    <div data-testid="mb-bar" aria-hidden className="mt-1.5 mb-1 h-1 overflow-hidden rounded-full bg-border">
      <div
        data-testid="mb-bar-fill"
        className="h-full rounded-full"
        style={{ width: `${Math.round(progress * PERCENT)}%`, background: color }}
      />
    </div>
  );
}

interface RowProps {
  row: PeriodRow;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onOpen: (row: PeriodRow) => void;
}

/**
 * Una fila de presupuesto y, si está desplegada, sus hijas.
 *
 * Toda la fila es el control: una hoja abre su pantalla; un nodo con hijos se pliega y despliega.
 *
 * @aitri-trace FR-ID: FR-3103, US-ID: US-3103, AC-ID: AC-3107, TC-ID: TC-PMV-020h, TC-PMV-021h, TC-PMV-024e
 * @aitri-trace FR-ID: FR-3103, US-ID: US-3103, AC-ID: AC-3109, TC-ID: TC-PMV-022e
 */
function BudgetRow({ row, expanded, onToggle, onOpen }: RowProps) {
  const open = !row.leaf && !!expanded[row.id];
  const isGroup = row.level === 0;
  const isRetiros = row.id === RETIROS_PLAN_ID;
  const actual = row.actual ? `${row.glyph ? `${row.glyph} ` : ""}${cellNum(row.actual)}` : "—";
  const long = actual.length >= LONG_FIGURE;
  const Chevron = row.leaf ? ChevronRight : open ? ChevronDown : ChevronRight;

  return (
    <>
      <button
        type="button"
        data-testid="mb-row"
        data-node-id={row.id}
        data-leaf={row.leaf}
        aria-expanded={row.leaf ? undefined : open}
        onClick={() => (row.leaf ? onOpen(row) : onToggle(row.id))}
        className="block w-full min-h-(--control-lg) border-b border-border py-3 pb-2 text-left last:border-b-0"
        style={{ paddingLeft: row.level * 14 }}
      >
        <span className="flex items-center gap-2">
          <span
            data-testid="mb-row-name"
            className={cn("min-w-0 flex-1 truncate text-label", isGroup ? "font-semibold" : "font-medium")}
          >
            {row.name}
          </span>
          <span
            data-testid="mb-row-actual"
            // La cifra del grupo va un escalón por encima de la de sus hijos (`title-sm` contra `label`),
            // siempre en peso 400: DM Mono no trae negrita y el navegador la falsearía.
            className={cn("tabular flex-none whitespace-nowrap", isGroup && !long ? "title-sm" : "text-label")}
            style={{ color: toneColor(row.tone), fontWeight: 400 }}
          >
            {actual}
          </span>
          <Chevron size={14} strokeWidth={1.75} className="flex-none text-fg-muted" aria-hidden />
        </span>
        {!isRetiros && <ProgressBar progress={row.progress} color={barColor(row.tone)} />}
        <span data-testid="mb-row-budget" className="block pr-[22px] text-right caption text-fg-muted">
          {isRetiros ? `Plan ${cellNum(row.budget)}` : `de ${cellNum(row.budget)}`}
        </span>
      </button>
      {open && row.children.map((c) => <BudgetRow key={c.id} row={c} expanded={expanded} onToggle={onToggle} onOpen={onOpen} />)}
    </>
  );
}

/**
 * Una sección por tipo: encabezado con sus totales y una tarjeta por grupo.
 *
 * @aitri-trace FR-ID: FR-3103, US-ID: US-3103, AC-ID: AC-3110, TC-ID: TC-PMV-023f
 */
function Section({ section, ...rest }: { section: PeriodSection } & Omit<RowProps, "row">) {
  const { label, Icon } = SECTION[section.type];
  return (
    <section data-testid={`mb-section-${section.type}`} className="mt-5">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow flex items-center gap-1.5">
          <Icon size={12} strokeWidth={2} aria-hidden />
          {label}
        </h2>
        <span data-testid="mb-section-total" className="tabular caption text-fg-muted whitespace-nowrap">
          {cellNum(section.actual)} de {cellNum(section.budget)}
        </span>
      </div>
      {section.groups.length === 0 && (
        <p data-testid="mb-section-empty" className="caption text-fg-muted">
          Aún no hay categorías.{" "}
          <button
            type="button"
            data-testid="mb-section-empty-link"
            onClick={() => openScreen(ORGANIZE)}
            className="-my-3 inline-flex min-h-(--control-md) items-center font-semibold text-fg-secondary underline"
          >
            Crear la primera ›
          </button>
        </p>
      )}
      {section.groups.map((g) => (
        <div
          key={g.id}
          data-testid="mb-group"
          className="elevated-sm mb-2.5 rounded-(--radius-lg) border border-border bg-card px-3.5"
        >
          <BudgetRow row={g} {...rest} />
        </div>
      ))}
    </section>
  );
}

/**
 * La lista completa de un periodo.
 *
 * @param view View-model del periodo.
 * @param expanded Qué nodos están desplegados.
 * @param onToggle Pliega o despliega un nodo con hijos.
 * @param onOpen Abre la pantalla de una hoja o de la fila de retiros.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3103, US-ID: US-3103, AC-ID: AC-3107, TC-ID: TC-PMV-020h
 */
export function BudgetSections({ view, ...rest }: { view: PeriodView } & Omit<RowProps, "row">) {
  return (
    <div data-testid="mb-sections">
      {view.sections.map((s) => (
        <Section key={s.type} section={s} {...rest} />
      ))}
    </div>
  );
}
