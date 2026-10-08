"use client";
// @aitri-trace components:mobile:LeafScreen — feature presupuesto-movil (FR-3105, FR-3106, FR-3109).
//
// Módulo:       src/components/mobile/LeafScreen.tsx
// Propósito:    La pantalla de una hoja —categoría o alcancía— en un periodo: lo presupuestado y lo
//               ejecutado (con «Cambiar» donde corresponde) y la lista de lo que forma esa cifra.
//               No valida ni calcula: llama a las mismas acciones del store que la grilla de escritorio.
// Dependencias: @/state/store, @/domain, ../cycleText, ../format, ../reserveText, ./AmountEditCard,
//               ./DetailHeader, ./screenStack, ./tone.

import { useMemo } from "react";
import { Info, MessageSquare, Pencil, Receipt, SlidersHorizontal } from "lucide-react";
import { cellGlyph, cellTone } from "@/domain/budgetState";
import {
  cellDetail, cellHeadroom, displayAmount, findNode, firstDayOf, formatDay, rollupTable, type DetailEntry,
} from "@/domain";
import type { LedgerNode, PeriodKey } from "@/domain/types";
import { useActivePeriods, useCalendar, useLedgerStore } from "@/state/store";
import { cycleLabel } from "../cycleText";
import { cellNum, money } from "../format";
import { blockMessage } from "../reserveText";
import { Button } from "../ui/button";
import { AmountEditCard } from "./AmountEditCard";
import { DetailHeader } from "./DetailHeader";
import { ClosedNotice } from "./PeriodBar";
import { REGISTRAR, openScreen, replaceScreen } from "./screenStack";
import { toneColor } from "./tone";

const TYPE_NAME: Record<LedgerNode["type"], string> = { income: "Ingresos", expense: "Gastos", transfer: "Reservas" };
/** Qué se anota desde Registrar según el tipo, para el texto del estado vacío. */
const EMPTY_WHAT: Record<LedgerNode["type"], string> = {
  income: "Los ingresos se anotan desde Registrar.",
  expense: "Los gastos se anotan desde Registrar.",
  transfer: "Los aportes se hacen desde Registrar → Reserva, o con «Cambiar».",
};

/**
 * La ruta de un nodo para la línea de contexto: «Gastos · Vivienda».
 *
 * @param nodes Nodos del ledger.
 * @param node Nodo cuya ruta se pide.
 * @returns El tipo y los ancestros, del más lejano al más cercano.
 * @throws Nunca. Un ciclo de padres se corta con un conjunto de visitados.
 */
export function pathOf(nodes: LedgerNode[], node: LedgerNode): string {
  const parts: string[] = [];
  const seen = new Set<string>([node.id]);
  let cur = node.parentId ? findNode(nodes, node.parentId) : undefined;
  while (cur && !seen.has(cur.id)) {
    parts.unshift(cur.name);
    seen.add(cur.id);
    cur = cur.parentId ? findNode(nodes, cur.parentId) : undefined;
  }
  return [TYPE_NAME[node.type], ...parts].join(" · ");
}

/**
 * Una fila de la lista: un movimiento, un ajuste, un comentario o una nota automática. Mismo
 * contenido que el Detalle de escritorio; el lápiz solo donde se puede editar.
 */
function EntryRow({ entry, period, onEdit }: { entry: DetailEntry; period: PeriodKey; onEdit?: (movementId: string) => void }) {
  const row = "flex min-h-[52px] items-center gap-2 border-b border-border py-2";
  if (entry.kind === "auto") {
    return (
      <li data-testid="mb-mov-row" data-kind="auto" className={row}>
        <Info size={14} strokeWidth={1.5} className="flex-none text-fg-muted" aria-label="Automático" role="img" />
        <span className="caption min-w-0 flex-1 text-fg-secondary">{entry.text}</span>
      </li>
    );
  }
  if (entry.kind === "comment") {
    return (
      <li data-testid="mb-mov-row" data-kind="comment" className={row}>
        <MessageSquare size={14} strokeWidth={1.5} className="flex-none text-fg-muted" aria-label="Comentario" role="img" />
        <span className="tabular caption w-[52px] flex-none text-fg-muted">{entry.note.date ? formatDay(entry.note.date) : ""}</span>
        <span className="label min-w-0 flex-1 break-words font-normal text-fg">{entry.note.text}</span>
      </li>
    );
  }
  if (entry.kind === "tecleado") {
    const { sign, abs } = displayAmount(entry.amount);
    return (
      <li data-testid="mb-mov-row" data-kind="tecleado" className={row}>
        <SlidersHorizontal size={14} strokeWidth={1.5} className="flex-none text-fg-muted" aria-label="Escrito en la celda" role="img" />
        <span className="w-[52px] flex-none" />
        <span className="label min-w-0 flex-1 font-normal text-fg">Escrito en la celda</span>
        <span data-testid="mb-mov-amount" className="tabular label flex-none">{sign}{cellNum(abs)}</span>
      </li>
    );
  }
  const m = entry.movement;
  const { sign, abs } = displayAmount(m.amount);
  const Icon = entry.kind === "adjustment" ? SlidersHorizontal : Receipt;
  return (
    <li data-testid="mb-mov-row" data-kind={entry.kind} data-movement-id={m.id} className={row}>
      <Icon size={14} strokeWidth={1.5} className="flex-none text-fg-muted" aria-label={entry.kind === "adjustment" ? "Ajuste" : "Movimiento"} role="img" />
      <span data-testid="mb-mov-date" className="tabular caption w-[52px] flex-none text-fg-muted">
        {formatDay(m.date ?? firstDayOf(period))}
      </span>
      <span data-testid="mb-mov-note" className={`label min-w-0 flex-1 break-words font-normal ${m.note ? "text-fg" : "text-fg-muted"}`}>
        {m.note || "Sin nota"}
      </span>
      <span data-testid="mb-mov-amount" className="tabular label flex-none">{sign}{cellNum(abs)}</span>
      {onEdit && (
        <button
          type="button"
          data-testid="mb-mov-edit"
          aria-label={`Editar ${m.note || "movimiento"} de ${money(m.amount)}`}
          onClick={() => onEdit(m.id)}
          className="-mr-2 flex h-(--control-md) w-(--control-md) flex-none items-center justify-center rounded-(--radius-sm) text-fg-secondary"
        >
          <Pencil size={18} strokeWidth={1.75} />
        </button>
      )}
    </li>
  );
}

/**
 * Pantalla de una categoría o una alcancía.
 *
 * @param node Hoja que se muestra.
 * @param period Periodo mostrado.
 * @param closed Si el periodo está cerrado: se ve todo, sin acciones de cambio (FR-3112).
 * @param notice Aviso opcional que se pinta bajo el encabezado (el de impacto, impacto-movil FR-3303).
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3106, US-ID: US-3106, AC-ID: AC-3116, TC-ID: TC-PMV-050h, TC-PMV-051e, TC-PMV-052f
 * @aitri-trace FR-ID: FR-3105, US-ID: US-3105, AC-ID: AC-3113, TC-ID: TC-PMV-040h
 * @aitri-trace FR-ID: FR-3109, US-ID: US-3109, AC-ID: AC-3125, TC-ID: TC-PMV-080h, TC-PMV-081f, TC-PMV-082f, TC-PMV-083e
 */
export function LeafScreen({ node, period, closed, notice }: {
  node: LedgerNode; period: PeriodKey; closed: boolean; notice?: React.ReactNode;
}) {
  const data = useLedgerStore((s) => s.data);
  const periods = useActivePeriods();
  const cal = useCalendar();
  const setLeafAmount = useLedgerStore((s) => s.setLeafAmount);
  const applyReserveEdit = useLedgerStore((s) => s.applyReserveEdit);

  const isReserve = node.type === "transfer";
  const cell = useMemo(() => rollupTable(data, [period]).cell(node.id, period), [data, node.id, period]);
  const entries = useMemo(() => cellDetail(data, node.id, period, periods, "actual"), [data, node.id, period, periods]);
  const glyph = cellGlyph(node.type, cell.budget, cell.actual);
  const label = cycleLabel(cal, period);

  /** Guarda el aporte de una alcancía en un plano, con las reglas y el texto de escritorio. */
  const saveReserve = (plane: "budget" | "actual") => (value: number): string | null => {
    if (closed) return `${label} está cerrado.`;
    const current = plane === "budget" ? cell.budget : cell.actual;
    if (value === current) return null;
    const maxTotal = cellHeadroom(data, node.id, period, plane, periods);
    const r = applyReserveEdit(node.id, period, plane, value);
    if (!("rejected" in r)) return null;
    if (r.rejected === "invalid_target" || r.rejected.ok) return "Operación inválida";
    return blockMessage(data, r.rejected, { editedMonth: period, attempted: value - current, maxTotal });
  };
  const saveBudget = (value: number): string | null => {
    // La acción del store no conoce el cierre (la grilla lo resuelve no ofreciendo el campo): aquí se
    // rechaza antes de escribir, para no pintar un cambio que el servidor va a devolver.
    if (closed) return `${label} está cerrado.`;
    setLeafAmount(node.id, period, "budget", value);
    return null;
  };
  const maxOf = (plane: "budget" | "actual") =>
    isReserve ? <>Máx. <span className="tabular">{money(cellHeadroom(data, node.id, period, plane, periods))}</span></> : undefined;

  const canEditMovements = !closed && !isReserve;
  const edit = (movementId: string) =>
    openScreen({ view: "presupuesto", detail: { kind: "edit", leafId: node.id, movementId } });

  return (
    <div data-testid="mb-leaf" data-node-id={node.id}>
      <DetailHeader title={node.name} context={`${pathOf(data.nodes, node)} · ${label}`} />
      {closed && <ClosedNotice period={period} />}
      {/* impacto-movil FR-3303: el aviso de impacto, donde se corrige. La pantalla no sabe qué es. */}
      {notice}
      <div className="my-3 grid grid-cols-2 gap-3">
        <AmountEditCard
          plane="budget"
          label={isReserve ? "Pres." : "Presupuestado"}
          value={cell.budget}
          display={cellNum(cell.budget)}
          editable={!closed}
          hint={maxOf("budget")}
          onSave={isReserve ? saveReserve("budget") : saveBudget}
        />
        <AmountEditCard
          plane="actual"
          label={isReserve ? "Ejec." : "Ejecutado"}
          value={cell.actual}
          display={cell.actual ? `${glyph ? `${glyph} ` : ""}${cellNum(cell.actual)}` : "—"}
          color={toneColor(cellTone(node.type, cell.budget, cell.actual))}
          editable={isReserve && !closed}
          hint={maxOf("actual")}
          onSave={isReserve ? saveReserve("actual") : undefined}
        />
      </div>

      <h2 className="eyebrow mb-1">{isReserve ? "Aportes" : "Movimientos"}</h2>
      {entries.length === 0 ? (
        <div data-testid="mb-mov-empty" className="py-4">
          <p className="label font-normal text-fg-secondary">
            {isReserve ? "Sin aportes" : "Sin movimientos"} en {label}. {EMPTY_WHAT[node.type]}
          </p>
          <Button type="button" data-testid="mb-go-register" className="mt-3 h-(--control-md)" onClick={() => replaceScreen(REGISTRAR)}>
            Ir a Registrar
          </Button>
        </div>
      ) : (
        <ul data-testid="mb-mov-list" className="m-0 list-none p-0">
          {entries.map((e, i) => (
            <EntryRow
              key={e.kind === "movement" || e.kind === "adjustment" ? e.movement.id : `${e.kind}-${i}`}
              entry={e}
              period={period}
              onEdit={canEditMovements && (e.kind === "movement" || e.kind === "adjustment") ? edit : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
