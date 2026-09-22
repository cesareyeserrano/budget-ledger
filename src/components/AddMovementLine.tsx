"use client";
// @aitri-trace components:AddMovementLine — feature diario-de-celda (FR-2502, FR-2503).
//
// Módulo:       src/components/AddMovementLine.tsx
// Propósito:    La línea «Añadir movimiento» del pie del Detalle: monto, nota y fecha, en UNA fila.
//               Valida en el cliente lo que el dominio ya sabe (entero ≥1, nota ≤280, fecha dentro
//               del periodo de la celda) para que «Añadir» solo esté activo cuando el guardado va a
//               salir bien; la autoridad sigue siendo el servidor.
// Dependencias: @/domain (CELL_NOTE_MAX, isDateInPeriod, proposedDate), @/state/store, ./format.

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarClock, Plus } from "lucide-react";
import { CELL_NOTE_MAX, formatDay, isDateInPeriod, proposedDate } from "@/domain";
import type { PeriodKey } from "@/domain/types";
import { useCalendar, useLedgerStore } from "@/state/store";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

// El calendario se carga aparte, como en el registro (FR-210): no pesa en el arranque de la grilla.
const DateCalendar = dynamic(() => import("./register/DateCalendar"), { ssr: false });

/** «YYYY-MM-DDTHH:mm» de un Date, en hora local — el mismo formato que guarda el dominio. */
function isoMinute(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * La línea de añadir del Detalle. Enter en cualquier campo confirma, igual que el botón.
 *
 * @param leafId Hoja de la celda abierta.
 * @param month Periodo de la celda: acota el calendario y decide la fecha propuesta.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2502, US-ID: US-2502, AC-ID: AC-2502a, TC-ID: TC-DDC-021h, TC-DDC-025f, TC-DDC-027f
 */
export function AddMovementLine({ leafId, month }: { leafId: string; month: PeriodKey }) {
  const calendar = useCalendar();
  const add = useLedgerStore((s) => s.addMovementInCell);
  const propuesta = useMemo(() => proposedDate(calendar, month, new Date()), [calendar, month]);

  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [fecha, setFecha] = useState(propuesta);
  const [abierto, setAbierto] = useState(false);

  const amount = Number(monto);
  const notaLarga = nota.length > CELL_NOTE_MAX;
  const puedeAñadir = monto !== "" && Number.isInteger(amount) && amount >= 1 && !notaLarga;
  // «Hoy» solo si la propuesta es hoy; si no, el día corto — el usuario ve SIEMPRE qué fecha va.
  const etiquetaFecha = fecha.slice(0, 10) === isoMinute(new Date()).slice(0, 10) ? "Hoy" : formatDay(fecha);

  const montoRef = useRef<HTMLInputElement>(null);

  function confirmar() {
    if (!puedeAñadir) return;
    if (!add({ leafId, period: month, amount, note: nota.trim() === "" ? null : nota, date: fecha })) return;
    setMonto("");
    setNota("");
    setFecha(propuesta);
    // El foco vuelve a «Monto» (FR-2502): añadir gastos es una ráfaga —el usuario transcribe varios
    // seguidos—, y obligarle a volver con el ratón rompería justo eso.
    montoRef.current?.focus();
  }

  return (
    <div data-testid="add-movement" className="flex flex-col gap-1">
      <span className="text-caption font-semibold uppercase tracking-[0.09em]" style={{ color: "var(--fg-secondary)" }}>
        Añadir movimiento
      </span>
      <div className="flex items-center gap-1.5 text-caption">
        <input
          ref={montoRef}
          aria-label="Monto"
          inputMode="numeric"
          value={monto}
          placeholder="Monto"
          onChange={(e) => setMonto(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); confirmar(); } }}
          className="tabular w-[96px] flex-none bg-elevated border border-border rounded-(--radius-sm) text-fg px-1.5 py-1 outline-none focus:border-accent"
        />
        <input
          aria-label="Nota"
          value={nota}
          placeholder="Nota (opcional)"
          onChange={(e) => setNota(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); confirmar(); } }}
          className="flex-1 min-w-0 bg-elevated border border-border rounded-(--radius-sm) text-fg px-1.5 py-1 outline-none focus:border-accent"
        />
        <Popover open={abierto} onOpenChange={setAbierto}>
          <PopoverTrigger asChild>
            <button
              data-testid="add-date"
              type="button"
              // Con un monto ya escrito, Enter aquí registra como en cualquier otro campo de la línea;
              // el calendario se sigue abriendo con clic o espacio.
              onKeyDown={(e) => { if (e.key === "Enter" && monto !== "") { e.preventDefault(); e.stopPropagation(); confirmar(); } }}
              className="flex-none flex items-center gap-1 rounded-(--radius-sm) border border-border px-1.5 py-1 cursor-pointer"
              style={{ color: "var(--fg-secondary)" }}
            >
              <CalendarClock size={12} strokeWidth={1.5} aria-hidden="true" />
              {etiquetaFecha}
            </button>
          </PopoverTrigger>
          <PopoverContent
            data-testid="add-date-popover"
            className="w-auto p-2"
            align="start"
            // Al elegir un día el foco va al monto, no al botón de fecha: así el siguiente Enter registra
            // en vez de reabrir el calendario. Se mueve YA en `onSelect` —esperar al cierre dejaba ~0,5 s
            // de animación con el foco en el body, donde un Enter rápido se perdía—; esto solo evita que
            // Radix lo devuelva luego al botón.
            onCloseAutoFocus={(e) => { e.preventDefault(); montoRef.current?.focus(); }}
          >
            <DateCalendar
              selected={new Date(fecha)}
              // El calendario solo habilita los días del mes o ciclo de ESTA celda (FR-2503): un
              // movimiento fechado fuera lo rechazaría el servidor, así que no se ofrece siquiera.
              disabled={(d: Date) => !isDateInPeriod(calendar, month, isoMinute(d))}
              onSelect={(d) => {
                if (!d) return;
                setFecha(`${isoMinute(d).slice(0, 10)}T12:00`);
                setAbierto(false);
                montoRef.current?.focus();
              }}
            />
          </PopoverContent>
        </Popover>
        <button
          data-testid="add-movement-confirm"
          disabled={!puedeAñadir}
          onMouseDown={(e) => e.preventDefault()}
          onClick={confirmar}
          aria-label="Añadir"
          className="flex-none flex items-center cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default disabled:opacity-50"
          style={{ color: "var(--fg)" }}
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      {nota.length > 0 && (
        <span data-testid="add-note-counter" className="tabular self-end text-caption" style={{ color: notaLarga ? "var(--error)" : "var(--fg-muted)" }}>
          {nota.length}/{CELL_NOTE_MAX}
        </span>
      )}
    </div>
  );
}
