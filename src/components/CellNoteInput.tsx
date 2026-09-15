"use client";
// @aitri-trace components:CellNoteInput — feature diario-de-celda (FR-2508, FR-2509).
//
// Módulo:       src/components/CellNoteInput.tsx
// Propósito:    El campo «Añadir comentario» del pie del Detalle: escribir, contar y añadir.
// Dependencias: @/state/store, @/domain (CELL_NOTE_MAX).
//
// Por qué vive APARTE y ya no dentro de ReserveCells: el panel es ahora `CellDetail`, que monta
// este campo al pie y también se usa en las celdas de bolsillos que pinta `ReserveCells`. Dejarlo
// allí obligaba a que los dos módulos se importaran mutuamente — un ciclo que funciona hasta que el
// orden de evaluación cambia y falla en tiempo de ejecución. Una pieza independiente lo evita.

import { useState } from "react";
import { CELL_NOTE_MAX } from "@/domain";
import type { PeriodKey } from "@/domain/types";
import { useLedgerStore } from "@/state/store";

/**
 * Campo de comentario de una celda: texto ≤280 con contador y botón «Añadir».
 *
 * Rechaza vacío y exceso SIN truncar (regla vigente de FR-1809): el botón queda deshabilitado y
 * Enter no hace nada, así que el texto de más nunca se recorta a espaldas del usuario.
 *
 * @param leafId Hoja cuya celda se comenta.
 * @param month Periodo de la celda.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2508, US-ID: US-2508, AC-ID: AC-2508b, TC-ID: TC-DDC-152h, TC-DDC-155f
 */
export function CellNoteInput({ leafId, month }: { leafId: string; month: PeriodKey }) {
  const addNote = useLedgerStore((s) => s.addCellNote);
  const [draft, setDraft] = useState("");
  const over = draft.length > CELL_NOTE_MAX;
  const canAdd = draft.trim().length > 0 && !over;

  return (
    <div className="flex items-center gap-2 text-caption">
      <input
        aria-label="Añadir comentario"
        value={draft}
        placeholder="Añadir comentario"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Solo el ENTER se retiene: es el que, si burbujeara, cometería la celda al añadir un
          // comentario. Escape SÍ debe subir — el UX spec declara «Esc cierra sin guardar» para
          // el editor, y reteniéndolo el panel quedaba abierto sin salida por teclado.
          if (e.key === "Enter") {
            e.stopPropagation();
            if (canAdd && addNote(leafId, month, draft)) setDraft("");
          }
        }}
        className="w-full bg-elevated border border-border rounded-(--radius-sm) text-fg px-1.5 py-1 outline-none focus:border-accent"
      />
      <span data-testid="cell-note-counter" className="flex-none tabular" style={{ color: over ? "var(--error)" : "var(--fg-muted)" }}>
        {draft.length}/{CELL_NOTE_MAX}
      </span>
      <button
        data-testid="cell-note-add"
        disabled={!canAdd}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (addNote(leafId, month, draft)) setDraft("");
        }}
        className="flex-none cursor-pointer border-0 bg-transparent p-0 font-semibold disabled:cursor-default disabled:opacity-50"
        style={{ color: "var(--fg)" }}
      >
        Añadir
      </button>
    </div>
  );
}
