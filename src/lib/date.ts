import type { MonthKey } from "@/domain/types";
import { MONTH_KEYS } from "@/domain/months";

/**
 * Helpers de fecha del registro (FR-210). El campo muestra "Hoy" por defecto; la hora se
 * persiste con el movimiento pero nunca se muestra. El `month` (MonthKey) del modelo se
 * DERIVA de la fecha (ADR-03) — único puente entre la fecha nueva y los roll-ups por mes.
 */

const LIST_FORMAT = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Instante actual apto para <input type="datetime-local"> ("YYYY-MM-DDTHH:mm"). */
export function nowForInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** True si `value` es una fecha parseable no vacía. */
export function isValidDate(value: string | null | undefined): boolean {
  if (!value) return false;
  return Number.isFinite(Date.parse(value));
}

/** True si la fecha cae en el día actual del dispositivo. */
export function isToday(iso: string): boolean {
  if (!isValidDate(iso)) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Fecha formateada para lista/etiqueta ("15 jun 2026"), sin puntos del formato corto. */
export function formatListDate(iso: string): string {
  if (!isValidDate(iso)) return "";
  return LIST_FORMAT.format(new Date(iso)).replace(/\./g, "");
}

/**
 * Etiqueta del campo de fecha (FR-210): "Hoy" si es el día actual; si no, la fecha
 * formateada. La hora nunca se muestra.
 *
 * @aitri-trace FR-ID: FR-210, US-ID: US-210, AC-ID: AC-212, TC-ID: TC-SUT-231h
 */
export function dateLabel(iso: string): string {
  if (!isValidDate(iso)) return "";
  return isToday(iso) ? "Hoy" : formatListDate(iso);
}

/**
 * Deriva el MonthKey (ene…dic) de una fecha ISO — puente al modelo de roll-ups (ADR-03).
 *
 * @aitri-trace FR-ID: FR-212, US-ID: US-212, AC-ID: AC-215, TC-ID: TC-SUT-241h
 */
export function monthKeyFromDate(iso: string): MonthKey {
  const d = isValidDate(iso) ? new Date(iso) : new Date();
  return MONTH_KEYS[d.getMonth()];
}
