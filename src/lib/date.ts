import type { PeriodKey } from "@/domain/types";
import { periodFromDate, periodOf } from "@/domain/periods";
import { localDay, type Calendar } from "@/domain/cycles";

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

/**
 * Feature ciclos (FLAG-2). «Hoy» como «YYYY-MM-DD». Sin `tz`, la fecha LOCAL del proceso (el
 * navegador del usuario). Con `tz` (IANA, p. ej. `America/Bogota`), la fecha civil en esa zona: es
 * lo que usa el servidor, cuyo reloj corre en UTC, para decidir «hoy» como lo vive el usuario.
 *
 * @aitri-trace FR-ID: FR-2409, US-ID: US-2409, AC-ID: AC-2430, TC-ID: TC-CIC-088f
 */
export function todayISO(tz?: string, now: Date = new Date()): string {
  if (tz) {
    // `en-CA` formatea como YYYY-MM-DD: es el locale con ese orden en Intl sin más piezas.
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
  return localDay(now);
}

/**
 * Feature ciclos (FR-2407). El periodo «de hoy» según el calendario vigente: en modo mes es
 * `currentPeriod()`; en ciclos, el ciclo que contiene hoy. Sustituye a `currentPeriod()` en los
 * 14 sitios que decidían «hoy» (FLAG-1).
 *
 * @aitri-trace FR-ID: FR-2407, US-ID: US-2407, AC-ID: AC-2422, TC-ID: TC-CIC-071e
 */
export function currentPeriodFor(calendar: Calendar, today: string = todayISO()): PeriodKey {
  return calendar.periodForDate(today);
}
