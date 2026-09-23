"use client";
// @aitri-trace components:MovementEditor — feature diario-de-celda (FR-2505).
//
// Módulo:       src/components/MovementEditor.tsx
// Propósito:    El bloque que SUSTITUYE a una fila del Detalle mientras se edita: monto, nota, fecha
//               y categoría, con «Guardar» habilitado solo cuando el cambio va a entrar. Valida
//               ensayando la MISMA función del dominio que correrá el servidor, así que lo que aquí
//               se deshabilita es exactamente lo que allí se rechazaría.
// Dependencias: @/domain (editMovement, isDateInPeriod), @/state/store, ./ui/select, ./ui/popover.

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarClock, TriangleAlert } from "lucide-react";
import {
  CELL_NOTE_MAX, deleteMovement as ensayarBorrado, editMovement as dryRun, formatDay, isClosed, isLeaf, periodLabel,
  type MovementPatch,
} from "@/domain";
import type { Movement, PeriodKey } from "@/domain/types";
import { useActivePeriods, useCalendar, useLedgerStore } from "@/state/store";
import { money, textoBorradoNegativo } from "./format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const DateCalendar = dynamic(() => import("./register/DateCalendar"), { ssr: false });

/** «YYYY-MM-DDTHH:mm» de un Date en hora local — el mismo formato que guarda el dominio. */
function isoMinute(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * El bloque de edición de un movimiento.
 *
 * Enter guarda y Escape cancela SOLO esta edición: el segundo Escape, ya sin bloque, es el que
 * cierra el editor de la celda (UX spec F4, TC-DDC-099e). Por eso el componente detiene la
 * propagación de esas teclas — si las dejara subir, un Escape cerraría las dos cosas a la vez y el
 * usuario perdería el panel entero por cancelar una edición.
 *
 * @param movement Movimiento que se edita.
 * @param month Periodo de la celda abierta.
 * @param onDone Cierra el bloque (guardado o cancelado).
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2505, US-ID: US-2505, AC-ID: AC-2505a, TC-ID: TC-DDC-082h, TC-DDC-086e, TC-DDC-088f, TC-DDC-093f
 */
export function MovementEditor({ movement, month, onDone }: { movement: Movement; month: PeriodKey; onDone: () => void }) {
  const data = useLedgerStore((s) => s.data);
  const periods = useActivePeriods();
  const cal = useCalendar();
  const guardar = useLedgerStore((s) => s.editMovement);

  const esAjuste = movement.kind === "adjustment";
  const [monto, setMonto] = useState(String(movement.amount));
  const [nota, setNota] = useState(movement.note ?? "");
  const [fecha, setFecha] = useState(movement.date ?? `${month}-01T12:00`);
  const [destino, setDestino] = useState(movement.target);
  const [abierto, setAbierto] = useState(false);

  /** Las hojas del MISMO tipo: un gasto no se convierte en ingreso cambiándole la categoría. */
  const hojas = useMemo(
    () => data.nodes.filter((n) => n.type === movement.type && isLeaf(n, data.nodes)),
    [data.nodes, movement.type]
  );

  const amount = Number(monto);
  const notaLarga = nota.length > CELL_NOTE_MAX;
  // CERO = ELIMINAR (FR-2505), no un monto inválido. Es el idioma que la app ya tiene para los
  // retiros de bolsillo (FR-1802 de `techo-de-flujo`, fijado con palabras del usuario), y tenerlo
  // solo en la mitad de la app obligaba a aprender dos reglas para la misma intención.
  const eliminar = monto !== "" && amount === 0;
  const montoOk = monto !== "" && Number.isInteger(amount) && (eliminar || (esAjuste ? amount !== 0 : amount >= 1));

  const patch: MovementPatch = {
    amount,
    note: nota.trim() === "" ? null : nota,
    date: fecha,
    ...(destino !== movement.target ? { catId: destino } : {}),
  };

  // El ENSAYO: se corre la misma mutación que correrá el servidor y se mira si la rechazaría. No es
  // una validación paralela —que podría divergir—, es LA validación, ejecutada antes de escribir.
  // Con el monto en 0 el ensayo es el del BORRADO —la misma función que corre la papelera— para que
  // las dos vías den el mismo veredicto y el mismo texto. Una validación propia acabaría divergiendo.
  const ensayo = montoOk && !notaLarga
    ? (eliminar ? ensayarBorrado(data, movement.id) : dryRun(data, movement.id, patch, cal, periods))
    : null;
  const negativa = ensayo && "rejected" in ensayo && ensayo.rejected === "negative_cell" ? ensayo.cells[0] : null;
  const otroRechazo = ensayo && "rejected" in ensayo && ensayo.rejected !== "negative_cell" ? ensayo.rejected : null;

  // El periodo al que iría la fecha elegida: decide el aviso «Pasará a …» Y el bloqueo por cierre.
  let destinoPeriodo: PeriodKey | null = null;
  try { destinoPeriodo = cal.periodForDate(fecha); } catch { destinoPeriodo = null; }
  const cambiaDePeriodo = destinoPeriodo !== null && destinoPeriodo !== movement.period;

  // El DESTINO cerrado se comprueba AQUÍ y no en el ensayo: `editMovement` es dominio puro y no
  // conoce la frontera de cierre, así que sin esto «Guardar» quedaría habilitado y el rechazo
  // llegaría del servidor — el usuario vería su cambio aparecer y desaparecer (FR-2507).
  const destinoCerrado = destinoPeriodo !== null && cambiaDePeriodo && isClosed(data.closure, destinoPeriodo);

  const puedeGuardar = montoOk && !notaLarga && !destinoCerrado && ensayo !== null && !("rejected" in ensayo);

  function confirmar() {
    if (!puedeGuardar) return;
    const r = guardar(movement.id, patch);
    if (!r.ok) return; // el aviso ya está a la vista: el bloque NO se cierra sobre un fallo
    onDone();
  }

  const montoRef = useRef<HTMLInputElement>(null);
  const campo = "bg-elevated border border-border rounded-(--radius-sm) text-fg px-1.5 py-1 outline-none focus:border-accent";
  const etiqueta = "text-caption";

  return (
    <div
      data-testid="movement-editor"
      className="flex flex-col gap-1.5 rounded-(--radius-xs) border border-border-strong p-1.5"
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.stopPropagation(); confirmar(); }
        // Escape cancela SOLO la edición de la fila (dos niveles, TC-DDC-099e).
        if (e.key === "Escape") { e.stopPropagation(); onDone(); }
      }}
    >
      <div className="flex items-center gap-1.5 text-caption">
        <label className="flex flex-col gap-0.5">
          <span className={etiqueta} style={{ color: "var(--fg-secondary)" }}>Monto</span>
          <input
            autoFocus
            ref={montoRef}
            aria-label="Monto"
            inputMode="numeric"
            value={monto}
            // El «−» inicial SOLO se admite editando un ajuste: es el único movimiento que puede ser
            // negativo (FR-2504, TC-DDC-101f). En uno manual el signo se descarta al teclearlo.
            onChange={(e) => setMonto(e.target.value.replace(esAjuste ? /(?!^-)[^0-9]/g : /[^0-9]/g, ""))}
            className={`tabular w-[104px] flex-none ${campo}`}
          />
        </label>
        <label className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className={etiqueta} style={{ color: "var(--fg-secondary)" }}>Nota</span>
          <input aria-label="Nota" value={nota} onChange={(e) => setNota(e.target.value)} className={`w-full ${campo}`} />
        </label>
      </div>

      <div className="flex items-center gap-1.5 text-caption">
        <label className="flex flex-col gap-0.5">
          <span className={etiqueta} style={{ color: "var(--fg-secondary)" }}>Fecha</span>
          <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
              <button
                data-testid="edit-date"
                type="button"
                className="flex items-center gap-1 rounded-(--radius-sm) border border-border px-1.5 py-1 cursor-pointer"
                style={{ color: "var(--fg-secondary)" }}
              >
                <CalendarClock size={12} strokeWidth={1.5} aria-hidden="true" />
                {formatDay(fecha)}
              </button>
            </PopoverTrigger>
            <PopoverContent
              data-testid="edit-date-popover"
              className="w-auto p-2"
              align="start"
              // Igual que en la línea de añadir: tras elegir la fecha, Enter guarda, no reabre el calendario.
              onCloseAutoFocus={(e) => { e.preventDefault(); montoRef.current?.focus(); }}
            >
              <DateCalendar
                selected={new Date(fecha)}
                onSelect={(d) => { if (!d) return; setFecha(`${isoMinute(d).slice(0, 10)}T12:00`); setAbierto(false); montoRef.current?.focus(); }}
              />
            </PopoverContent>
          </Popover>
        </label>
        <label className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className={etiqueta} style={{ color: "var(--fg-secondary)" }}>Categoría</span>
          <Select value={destino} onValueChange={setDestino}>
            <SelectTrigger data-testid="edit-category" aria-label="Categoría" className="text-caption h-auto py-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hojas.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
      </div>

      {nota.length > 0 && (
        <span data-testid="edit-note-counter" className="tabular self-end text-caption" style={{ color: notaLarga ? "var(--error)" : "var(--fg-muted)" }}>
          {nota.length}/{CELL_NOTE_MAX}
        </span>
      )}

      {destinoCerrado && destinoPeriodo && (
        <span data-testid="edit-closed-warning" className="flex items-start gap-1 text-caption" style={{ color: "var(--error)" }}>
          <TriangleAlert size={12} strokeWidth={1.5} className="flex-none mt-[2px]" aria-hidden="true" />
          {periodLabel(destinoPeriodo)} está cerrado. Para cambiar sus movimientos, reábrelo desde el cierre de mes.
        </span>
      )}

      {cambiaDePeriodo && !destinoCerrado && destinoPeriodo && (
        <span data-testid="edit-period-notice" className="text-caption" style={{ color: "var(--fg-secondary)" }}>
          Pasará a «{periodLabel(destinoPeriodo)}{cal.rangeLabel(destinoPeriodo) ? ` · ${cal.rangeLabel(destinoPeriodo)}` : ""}»
        </span>
      )}

      {negativa && (
        <span
          // Con el monto en 0 esto es un BORRADO, así que lleva el testid y el texto de la papelera:
          // dos vías para el mismo acto tienen que decir lo mismo, o el usuario creerá que son
          // operaciones distintas y que quizá una sí le deje (TC-DDC-126f compara los dos textos).
          data-testid={eliminar ? "delete-blocked" : "negative-cell-warning"}
          className="flex items-start gap-1 text-caption"
          style={{ color: "var(--error)" }}
        >
          <TriangleAlert size={12} strokeWidth={1.5} className="flex-none mt-[2px]" aria-hidden="true" />
          {eliminar
            ? textoBorradoNegativo(negativa.value)
            : `No se puede: ${nombreDe(data.nodes, negativa.nodeId)} quedaría en ${money(negativa.value)}, y ninguna celda puede quedar por debajo de 0.`}
        </span>
      )}

      {otroRechazo && (
        <span data-testid="edit-reject-warning" className="flex items-start gap-1 text-caption" style={{ color: "var(--error)" }}>
          <TriangleAlert size={12} strokeWidth={1.5} className="flex-none mt-[2px]" aria-hidden="true" />
          {otroRechazo === "period_mismatch"
            ? "Esa fecha no cae en ningún mes abierto."
            : otroRechazo === "invalid_target"
              ? "Esa categoría no admite este movimiento."
              : "Ese monto no es válido para este movimiento."}
        </span>
      )}

      <div className="flex items-center justify-end gap-1.5">
        <button
          data-testid="edit-cancel"
          type="button"
          onClick={onDone}
          className="text-caption cursor-pointer bg-transparent border-0 p-0"
          style={{ color: "var(--fg-secondary)" }}
        >
          Cancelar
        </button>
        <button
          data-testid="edit-save"
          type="button"
          disabled={!puedeGuardar}
          onClick={confirmar}
          className="text-caption cursor-pointer rounded-(--radius-sm) border border-border px-2 py-1 disabled:cursor-default disabled:opacity-50"
          // El rótulo cambia con el valor tecleado: la consecuencia se lee ANTES de pulsar, así que
          // nadie borra creyendo que guarda. Por eso no se pide una segunda confirmación — teclear 0
          // y pulsar un botón que dice «Eliminar» ya son dos actos deliberados, igual que la
          // papelera no la pide dos veces (UX spec F4).
          style={{ color: eliminar ? "var(--error)" : "var(--fg)" }}
        >
          {eliminar ? "Eliminar" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

/** El nombre de la hoja, para que el aviso diga «Restaurantes» y no un id. */
function nombreDe(nodes: { id: string; name: string }[], id: string): string {
  return nodes.find((n) => n.id === id)?.name ?? "La celda";
}
