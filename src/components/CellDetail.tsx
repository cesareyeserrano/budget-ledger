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
import { Check, Info, Lock, MessageSquare, Pencil, Receipt, SlidersHorizontal, Trash2, TriangleAlert, X } from "lucide-react";
import {
  cellDetail, deleteMovement as ensayarBorrado, displayAmount, firstDayOf, findNode, formatDay,
  isClosed, periodLabel, type DetailEntry,
} from "@/domain";
import type { LedgerState, Movement, NodeType, PeriodKey } from "@/domain/types";
import { useLedgerStore, useActivePeriods } from "@/state/store";
import { money, textoBorradoNegativo } from "./format";
import { CellNoteInput } from "./CellNoteInput";
import { AddMovementLine } from "./AddMovementLine";
import { MovementEditor } from "./MovementEditor";

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
function DetailRow({
  entry, type, period, resaltado, acciones,
}: {
  entry: DetailEntry; type: NodeType; period: PeriodKey; resaltado?: boolean;
  /** Ausente en un mes cerrado: ahí la lista se ve igual pero no se puede tocar (FR-2507). */
  acciones?: { onEdit: () => void; onDelete: () => void; onCancel: () => void; bloqueo: number | null };
}) {
  const base = "flex items-start gap-1.5 rounded-(--radius-xs) px-1.5 py-1 text-caption";
  // FR-2504: el ajuste recién creado se señala un instante. Es la respuesta a una acción, no un
  // estado permanente, así que el borde se apaga solo (H1: el usuario ve QUÉ pasó al teclear).
  const borde = resaltado ? { border: "1px solid var(--accent)" } : undefined;

  if (entry.kind === "auto") {
    // El MISMO fondo que las demás filas (FR-2508): la distingue su ícono, no un color. Antes iba en
    // ámbar (--alert-soft), color de ALERTA que FR-1201 prohíbe para clasificar (BG-042).
    return (
      <div data-testid="detail-row" data-kind="auto" className={base} style={{ background: ROW_TINT }}>
        <Info size={12} strokeWidth={1.5} className="flex-none mt-[2px]" aria-label="Automático" style={{ color: "var(--fg-muted)" }} />
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
  const { sign, abs, addsToCell } = displayAmount(m.amount);
  const Icon = entry.kind === "adjustment" ? SlidersHorizontal : Receipt;
  return (
    <div data-testid="detail-row" data-kind={entry.kind} className={`group ${base}`} style={{ background: ROW_TINT, ...borde }}>
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
        // Lo que SUMA va en el color normal del texto; lo que RESTA, en gris y con «−». NUNCA un
        // color de tipo: FR-1201 (refinamiento-ui) reserva el rojo y el verde para señalar una
        // excepción —pasarse del presupuesto, un saldo negativo— y prohíbe usarlos para decir «esto
        // es un gasto». Pintar aquí cada gasto de rojo contradecía a la grilla, donde el rojo
        // significa «te pasaste», y el usuario leía como alarma diecinueve gastos que estaban en su
        // presupuesto. La distinción suma/resta no se pierde: viaja por el signo y el gris (WCAG 1.4.1).
        style={{ color: addsToCell ? "var(--fg)" : "var(--fg-secondary)" }}
      >
        {sign}{money(abs).replace("$", "")}
      </span>
      {acciones && <AccionesDeFila {...acciones} />}
    </div>
  );
}

/**
 * Lápiz y papelera de una fila (FR-2505, FR-2506). Aparecen al pasar el ratón o al enfocar con el
 * teclado — `focus-within` no es un adorno: sin él las acciones serían INALCANZABLES sin ratón.
 *
 * La papelera se sustituye por la confirmación en línea que ya usa la grilla (check / X), en vez de
 * inventar un segundo gesto de borrado para el mismo producto. Y si el borrado dejaría la celda bajo
 * cero, en su lugar aparece el motivo: el check no llega a existir, así que no hay nada que pulsar
 * para provocar un error (UX spec F5).
 */
function AccionesDeFila({ onEdit, onDelete, onCancel, bloqueo }: { onEdit: () => void; onDelete: () => void; onCancel: () => void; bloqueo: number | null }) {
  const [confirmando, setConfirmando] = useState(false);
  const btn = "inline-flex p-[3px] rounded-md cursor-pointer bg-transparent border-0";
  // Al cerrar la confirmación desaparece el botón que tenía el foco: hay que devolverlo al panel o
  // el Escape deja de alcanzar al contenedor que cierra el editor.
  const cerrar = () => { setConfirmando(false); onCancel(); };

  if (confirmando) {
    return bloqueo !== null ? (
      <span className="flex items-start gap-1 flex-none" style={{ color: "var(--error)" }}>
        <TriangleAlert size={12} strokeWidth={1.5} className="flex-none mt-[2px]" aria-hidden="true" />
        <span data-testid="delete-blocked">{textoBorradoNegativo(bloqueo)}</span>
        <button aria-label="Cancelar borrado" onClick={cerrar} className={btn} style={{ color: "var(--fg-muted)" }}>
          <X size={12} />
        </button>
      </span>
    ) : (
      <span className="flex gap-1 flex-none">
        <button aria-label="Confirmar borrado" onClick={() => { setConfirmando(false); onDelete(); }} className={btn} style={{ color: "var(--error)" }}>
          <Check size={12} />
        </button>
        <button aria-label="Cancelar borrado" onClick={cerrar} className={btn} style={{ color: "var(--fg-muted)" }}>
          <X size={12} />
        </button>
      </span>
    );
  }

  return (
    <span className="flex gap-px flex-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
      <button aria-label="Editar movimiento" onClick={onEdit} className={btn} style={{ color: "var(--fg-muted)" }}>
        <Pencil size={12} />
      </button>
      <button aria-label="Borrar movimiento" onClick={() => setConfirmando(true)} className={btn} style={{ color: "var(--fg-muted)" }}>
        <Trash2 size={12} />
      </button>
    </span>
  );
}

/** Cuánto quedaría la celda si se borrara ese movimiento, o `null` si no la deja negativa. */
function bloqueoDeBorrado(state: LedgerState, m: Movement): number | null {
  const r = ensayarBorrado(state, m.id);
  return "rejected" in r && r.rejected === "negative_cell" ? r.cells[0].value : null;
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
  const borrar = useLedgerStore((s) => s.deleteMovement);
  /**
   * Devuelve el foco AL PANEL cuando se desmonta algo de dentro (el bloque de edición, el check de
   * confirmar borrado).
   *
   * No es cosmética: el Escape que cierra el editor de la celda se atiende en su CONTENEDOR
   * (`BudgetGrid.tsx`), así que solo llega si el foco está dentro. Al desaparecer el botón o el
   * campo que lo tenía, el foco cae al `body` y el panel se queda abierto sin salida por teclado —
   * el mismo fallo que ese fichero ya arregló dos veces para el mes cerrado y para el modo de solo
   * comentarios.
   */
  const volverElFoco = () => ref.current?.focus();
  // FR-2507: en un mes cerrado la lista se ve IGUAL, pero sin acciones y sin línea de añadir. El
  // panel lo deriva él mismo del estado, como hace la grilla — no hace falta pasárselo.
  const cerrado = isClosed(data.closure, month);
  const [editando, setEditando] = useState<string | null>(null);

  /**
   * Si el mes se CIERRA con el bloque de edición abierto, ese bloque se retira (FR-2507).
   *
   * Pasa de verdad: el mes se cierra desde otro dispositivo, el canal de sincronización trae el
   * estado nuevo y este panel se vuelve a pintar. Sin esto, el bloque sobrevivía al cambio y el
   * usuario se quedaba con un campo «Monto» y un botón «Guardar» VIVOS sobre un mes cerrado — la
   * fila ya no ofrecía lápiz ni papelera, pero la vía que estaba abierta seguía abierta, que es
   * justo lo que FR-2507 prohíbe. El servidor lo rechazaba igual (422), así que nunca llegó a
   * corromper nada; lo que fallaba era la promesa de la pantalla (TC-DDC-139f).
   *
   * Se devuelve el foco al panel al retirarlo, por el mismo motivo que `volverElFoco`: si no, cae
   * al `body` y el Escape que cierra el editor de la celda deja de alcanzar a su contenedor.
   */
  useEffect(() => {
    if (cerrado && editando !== null) {
      setEditando(null);
      volverElFoco();
    }
  }, [cerrado, editando]);

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
      // Enfocable por código (nunca con Tab): es lo que permite devolverle el foco cuando un bloque
      // de dentro se desmonta, para que el Escape del contenedor siga alcanzable.
      tabIndex={-1}
      className="absolute top-full z-20 mt-1 flex flex-col gap-2 rounded-(--radius-sm) border border-border p-2"
      style={{
        background: "var(--bg-elevated)",
        boxShadow: "var(--shadow-md)",
        width,
        ...(alignRight ? { right: 0 } : { left: 0 }),
      }}
    >
      <span className={EYEBROW} style={{ color: "var(--fg-secondary)" }}>Detalle</span>

      {cerrado && (
        <span data-testid="closed-notice" className="flex items-start gap-1.5 text-caption" style={{ color: "var(--fg-secondary)" }}>
          <Lock size={12} strokeWidth={1.5} className="flex-none mt-[2px]" aria-hidden="true" />
          {periodLabel(month)} está cerrado. Para cambiar sus movimientos, reábrelo desde el cierre de mes.
        </span>
      )}

      {entries.length === 0 ? (
        <span data-testid="cell-notes-empty" className="text-caption" style={{ color: "var(--fg-muted)" }}>
          Sin movimientos ni comentarios
        </span>
      ) : (
        <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: LIST_MAX_H }}>
          {entries.map((e, i) => {
            const esMovimiento = e.kind === "movement" || e.kind === "adjustment";
            // `!cerrado` además del efecto de arriba: el efecto corre DESPUÉS del pintado, así
            // que sin esta guarda habría un fotograma con el bloque de edición vivo sobre un mes
            // ya cerrado. Dos líneas de defensa para una promesa que es de la pantalla.
            if (esMovimiento && editando === e.movement.id && !cerrado) {
              return (
                <MovementEditor
                  key={entryKey(e, i)}
                  movement={e.movement}
                  month={month}
                  onDone={() => { setEditando(null); volverElFoco(); }}
                />
              );
            }
            return (
              <DetailRow
                key={entryKey(e, i)}
                entry={e}
                type={node.type}
                period={month}
                resaltado={esMovimiento && e.movement.id === recien}
                {...(esMovimiento && !cerrado
                  ? {
                      acciones: {
                        onEdit: () => setEditando(e.movement.id),
                        onDelete: () => { borrar(e.movement.id); volverElFoco(); },
                        onCancel: volverElFoco,
                        bloqueo: bloqueoDeBorrado(data, e.movement),
                      },
                    }
                  : {})}
              />
            );
          })}
        </div>
      )}

      {/* FR-2502: la línea de añadir es de gasto e ingreso. Un bolsillo no registra movimientos
          desde aquí — sus operaciones De→A tienen su propia vía (NFR-2503, TC-DDC-343e). */}
      {node.type !== "transfer" && !cerrado && <AddMovementLine leafId={leafId} month={month} />}

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
