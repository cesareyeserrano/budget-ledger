"use client";
// @aitri-trace components:CellDetail — feature diario-de-celda (FR-2501, FR-2508, FR-2509).
//
// Módulo:       src/components/CellDetail.tsx
// Propósito:    El panel «Detalle» del editor de una celda: qué movimientos la forman y qué
//               comentarios la acompañan. PINTA, no decide — el orden y el contenido salen de
//               `cellDetail` (dominio puro); aquí solo viven la anatomía de la fila, los tintes y
//               el posicionamiento del panel.
// Dependencias: @/domain (cellDetail, displayAmount), @/state/store, ./format, ./CellNoteInput.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Info, MessageSquare, Receipt, SlidersHorizontal } from "lucide-react";
import { cellDetail, displayAmount, firstDayOf, findNode, formatDay, type DetailEntry } from "@/domain";
import type { NodeType, PeriodKey } from "@/domain/types";
import { useLedgerStore, useActivePeriods } from "@/state/store";
import { money } from "./format";
import { CellNoteInput } from "./CellNoteInput";
import { AddMovementLine } from "./AddMovementLine";

/** Ancho del panel y alto máximo de la lista (UX spec § Component Inventory). */
const PANEL_MAX_W = 320;
const VIEWPORT_MARGIN = 32;
const LIST_MAX_H = 360;

/**
 * Cuánto dura el resaltado del ajuste recién creado (FR-2504).
 *
 * DOS DOCUMENTOS APROBADOS DISCREPAN: el UX spec dice «resaltado 1,5 s» y TC-DDC-062h exige que el
 * borde siga siendo `--accent` al instante y haya dejado de serlo «tras 2 s». Se implementa lo que
 * el TC verifica; la diferencia es de medio segundo y no cambia el comportamiento que el usuario
 * percibe, pero queda anotada aquí en vez de resolverse en silencio.
 */
const RESALTADO_MS = 2000;

/** Tinte común de TODAS las filas: la misma «caja» del comentario automático, pero neutra. */
const ROW_TINT = "color-mix(in srgb, var(--fg-muted) 4%, transparent)";
/** Tinte propio del comentario automático (su aspecto vigente, FR-1804). */
const AUTO_TINT = "color-mix(in srgb, var(--alert-soft) 8%, transparent)";
/** «Eyebrow» del sistema: el `caption` en versalitas con tracking (no hay utilidad propia). */
const EYEBROW = "text-caption font-semibold uppercase tracking-[0.09em]";

/**
 * «18 sep»: día y mes corto, sin año ni hora — el formato que pide el UX spec para la fila.
 *
 * Exportada para poder afirmarla sin montar el componente: un movimiento SIN fecha se pinta con el
 * primer día de su periodo, y eso es una regla, no un detalle de render (TC-DDC-010e).
 */
export function dayLabel(iso: string): string {
  return formatDay(iso);
}

/**
 * Una línea del Detalle. Las cuatro formas comparten anatomía (ícono 12 px · contenido · monto a la
 * derecha) y se distinguen por el ícono y su etiqueta accesible, no por el color (WCAG 1.4.1).
 */
function DetailRow({ entry, type, period, resaltado }: { entry: DetailEntry; type: NodeType; period: PeriodKey; resaltado?: boolean }) {
  const base = "flex items-start gap-1.5 rounded-(--radius-xs) px-1.5 py-1 text-caption";
  // FR-2504: el ajuste recién creado se señala un instante. Es la respuesta a una acción, no un
  // estado permanente, así que el borde se apaga solo (H1: el usuario ve QUÉ pasó al teclear).
  const borde = resaltado ? { border: "1px solid var(--accent)" } : undefined;

  if (entry.kind === "auto") {
    return (
      <div data-testid="detail-row" data-kind="auto" className={base} style={{ background: AUTO_TINT }}>
        <Info size={12} strokeWidth={1.5} className="flex-none mt-[2px]" aria-label="Automático" style={{ color: "var(--alert-soft)" }} />
        <span data-testid="carry-note" style={{ color: "var(--fg)" }}>{entry.text}</span>
      </div>
    );
  }

  if (entry.kind === "comment" || entry.kind === "reserveNote") {
    const text = entry.kind === "comment" ? entry.note.text : entry.text;
    return (
      <div data-testid="detail-row" data-kind="comment" className={base} style={{ background: ROW_TINT }}>
        <MessageSquare size={12} strokeWidth={1.5} className="flex-none mt-[2px]" aria-label="Comentario" style={{ color: "var(--fg-muted)" }} />
        <span data-testid="cell-note" className="break-words" style={{ color: "var(--fg)" }}>{text}</span>
      </div>
    );
  }

  const m = entry.movement;
  const { sign, abs, addsToCell } = displayAmount(type, m.amount);
  const Icon = entry.kind === "adjustment" ? SlidersHorizontal : Receipt;
  return (
    <div data-testid="detail-row" data-kind={entry.kind} className={base} style={{ background: ROW_TINT, ...borde }}>
      <Icon
        size={12}
        strokeWidth={1.5}
        className="flex-none mt-[2px]"
        aria-label={entry.kind === "adjustment" ? "Ajuste" : "Movimiento"}
        style={{ color: "var(--fg-muted)" }}
      />
      <span data-testid="detail-date" className="tabular flex-none w-[44px]" style={{ color: "var(--fg-muted)" }}>
        {dayLabel(m.date ?? firstDayOf(period))}
      </span>
      <span
        data-testid="detail-note"
        title={m.note ?? undefined}
        className="flex-1 min-w-0 truncate"
        style={{ color: m.note ? "var(--fg)" : "var(--fg-muted)" }}
      >
        {m.note || "Sin nota"}
      </span>
      <span
        data-testid="detail-amount"
        className="tabular flex-none"
        // El color separa lo que SUMA al total de la celda (color del tipo) de lo que le resta
        // (secundario): así un «+10.000» dentro de un gasto no se lee como un ingreso.
        style={{ color: addsToCell ? `var(--type-${type})` : "var(--fg-secondary)" }}
      >
        {sign}{money(abs).replace("$", "")}
      </span>
    </div>
  );
}

/**
 * El panel «Detalle» de una celda: lista sus líneas y, al pie, el campo de comentario.
 *
 * Posición: bajo la celda y alineado a su borde izquierdo; si no cabe a la derecha del viewport, se
 * alinea al borde DERECHO de la celda. Se mide después de pintar (`useLayoutEffect`) porque la
 * grilla tiene scroll horizontal propio y la misma celda cae en sitios distintos según el scroll
 * (FR-2501: sin desborde a 768 ni a 1440 px).
 *
 * @param leafId Hoja cuya celda está abierta.
 * @param month Periodo de la celda.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2501, US-ID: US-2501, AC-ID: AC-2501a, TC-ID: TC-DDC-001h, TC-DDC-003e, TC-DDC-006e
 */
export function CellDetail({ leafId, month }: { leafId: string; month: PeriodKey }) {
  const data = useLedgerStore((s) => s.data);
  const periods = useActivePeriods();
  const ref = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);
  const [width, setWidth] = useState(PANEL_MAX_W);

  const node = findNode(data.nodes, leafId);
  const entries = cellDetail(data, leafId, month, periods);

  // FR-2504: el ajuste que acaba de nacer se señala un instante y el borde se apaga solo. Se
  // detecta comparando la lista con la del render anterior —el panel no recibe avisos del store— y
  // se limita a los ajustes: un movimiento que el usuario tecleó él mismo no necesita que le digan
  // dónde quedó, pero uno que apareció SOLO al teclear un total, sí.
  const [recien, setRecien] = useState<string | null>(null);
  const idsPrevios = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(entries.flatMap((e) => (e.kind === "movement" || e.kind === "adjustment" ? [e.movement.id] : [])));
    const previos = idsPrevios.current;
    idsPrevios.current = ids;
    if (!previos) return; // primer render: nada es «nuevo»
    const nuevo = entries.find(
      (e) => e.kind === "adjustment" && !previos.has(e.movement.id)
    );
    if (!nuevo || nuevo.kind !== "adjustment") return;
    setRecien(nuevo.movement.id);
    const t = setTimeout(() => setRecien(null), RESALTADO_MS);
    return () => clearTimeout(t);
  }, [entries]);

  useLayoutEffect(() => {
    const w = Math.min(PANEL_MAX_W, window.innerWidth - VIEWPORT_MARGIN);
    setWidth(w);
    const el = ref.current;
    const cell = el?.parentElement?.getBoundingClientRect();
    if (!cell) return;
    setAlignRight(cell.left + w > window.innerWidth);
  }, [leafId, month, entries.length]);

  if (!node) return null;

  return (
    <div
      ref={ref}
      data-testid="cell-notes"
      className="absolute top-full z-20 mt-1 flex flex-col gap-2 rounded-(--radius-sm) border border-border p-2"
      style={{
        background: "var(--bg-elevated)",
        boxShadow: "var(--shadow-md)",
        width,
        ...(alignRight ? { right: 0 } : { left: 0 }),
      }}
    >
      <span className={EYEBROW} style={{ color: "var(--fg-secondary)" }}>Detalle</span>

      {entries.length === 0 ? (
        <span data-testid="cell-notes-empty" className="text-caption" style={{ color: "var(--fg-muted)" }}>
          Sin movimientos ni comentarios
        </span>
      ) : (
        <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: LIST_MAX_H }}>
          {entries.map((e, i) => (
            <DetailRow
              key={entryKey(e, i)}
              entry={e}
              type={node.type}
              period={month}
              resaltado={(e.kind === "movement" || e.kind === "adjustment") && e.movement.id === recien}
            />
          ))}
        </div>
      )}

      {/* FR-2502: la línea de añadir es de gasto e ingreso. Un bolsillo no registra movimientos
          desde aquí — sus operaciones De→A tienen su propia vía (NFR-2503, TC-DDC-343e). */}
      {node.type !== "transfer" && <AddMovementLine leafId={leafId} month={month} />}

      <CellNoteInput leafId={leafId} month={month} />
    </div>
  );
}

/** Clave estable de una fila: el id del dato cuando existe, y su posición cuando no. */
function entryKey(e: DetailEntry, i: number): string {
  if (e.kind === "movement" || e.kind === "adjustment") return e.movement.id;
  if (e.kind === "comment") return e.note.id;
  return `${e.kind}-${i}`;
}
