"use client";

import { DayPicker, type Matcher } from "react-day-picker";
import { es } from "react-day-picker/locale";
import "react-day-picker/style.css";
import type { CSSProperties } from "react";

interface Props {
  selected: Date | undefined;
  onSelect: (day: Date | undefined) => void;
  /**
   * Días que NO se pueden elegir (feature diario-de-celda, FR-2503). El Detalle lo usa para acotar
   * el calendario al mes o ciclo de la celda: un movimiento fechado fuera lo rechazaría el servidor,
   * así que no se ofrece. Ausente ≡ todos los días habilitados, que es el registro de siempre.
   */
  disabled?: Matcher | Matcher[];
}

/**
 * Calendario (react-day-picker) aislado para carga diferida (FR-210). Se importa
 * dinámicamente desde DateTimeField (ssr:false) → no pesa en el bundle inicial.
 *
 * @aitri-trace FR-ID: FR-210, US-ID: US-210, AC-ID: AC-212, TC-ID: TC-SUT-230e
 */
export default function DateCalendar({ selected, onSelect, disabled }: Props) {
  return (
    <DayPicker
      mode="single"
      // BG-001 (stack-upgrade-theme): sin `required`, tocar el día ya elegido lo deselecciona
      // (onSelect(undefined)) y el popover no se cierra. Con él, re-elegirlo cierra como cualquier otro día.
      required
      locale={es}
      captionLayout="dropdown"
      startMonth={new Date(2000, 0)}
      endMonth={new Date(2100, 11)}
      selected={selected}
      onSelect={onSelect}
      disabled={disabled}
      styles={{
        root: {
          fontSize: "0.875rem",
          margin: 0,
        } as CSSProperties,
      }}
    />
  );
}
