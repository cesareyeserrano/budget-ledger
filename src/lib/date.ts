import type { PeriodKey } from "@/domain/types";
import { periodFromDate, periodOf } from "@/domain/periods";

/**
 * Helpers de fecha del registro (FR-210). El campo muestra "Hoy" por defecto; la hora se
 * persiste con el movimiento pero nunca se muestra. El `month` (PeriodKey) del modelo se
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
 * Deriva el periodo ("YYYY-MM") de una fecha ISO — puente al modelo de roll-ups (ADR-03, ahora con
 * año). Una fecha inválida cae al periodo EN CURSO, igual que antes caía al mes en curso.
 *
 * @aitri-trace FR-ID: FR-1908, US-ID: US-1908, AC-ID: AC-1923, TC-ID: TC-MAN-070h, TC-MAN-072e
 */
export function periodKeyFromDate(iso: string): PeriodKey {
  return periodFromDate(iso) ?? currentPeriod();
}

/**
 * EL RELOJ. Único punto del proyecto que pregunta la fecha para saber en qué periodo estamos.
 *
 * Vive aquí, fuera del dominio, por ADR-02 del TRD: si `computeBalanceSeries` o `reserve.ts`
 * leyeran el reloj dejarían de ser deterministas y la suite se rompería sola cada mes. El borde lo
 * consulta una vez y se lo PASA al dominio.
 *
 * @aitri-trace FR-ID: FR-1904, US-ID: US-1904, AC-ID: AC-1911, TC-ID: TC-MAN-032e
 */
export function currentPeriod(): PeriodKey {
  const d = new Date();
  return periodOf(d.getFullYear(), d.getMonth() + 1);
}
