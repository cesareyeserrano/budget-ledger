"use client";

import { DayPicker } from "react-day-picker";
import { es } from "react-day-picker/locale";
import "react-day-picker/style.css";
import type { CSSProperties } from "react";

interface Props {
  selected: Date | undefined;
  onSelect: (day: Date | undefined) => void;
}

/**
 * Calendario (react-day-picker) aislado para carga diferida (FR-210). Se importa
 * dinámicamente desde DateTimeField (ssr:false) → no pesa en el bundle inicial.
 *
 * @aitri-trace FR-ID: FR-210, US-ID: US-210, AC-ID: AC-212, TC-ID: TC-SUT-230e
 */
export default function DateCalendar({ selected, onSelect }: Props) {
  return (
    <DayPicker
      mode="single"
      locale={es}
      captionLayout="dropdown"
      startMonth={new Date(2000, 0)}
      endMonth={new Date(2100, 11)}
      selected={selected}
      onSelect={onSelect}
      styles={{
        root: {
          fontSize: "0.875rem",
          margin: 0,
        } as CSSProperties,
      }}
    />
  );
}
