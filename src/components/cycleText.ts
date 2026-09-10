/**
 * Module: src/components/cycleText
 * Purpose: Los rótulos de un periodo bajo el calendario vigente (feature ciclos, FR-2407): nombre
 *   («Septiembre 2026» o «Transición»), rango («21 ago – 20 sep») y su unión con « · ». Un solo
 *   sitio para que grilla, selector, Registro, cierre y Configuración digan lo mismo (NFR-2412).
 * Dependencies: @/domain/periods, @/domain/cycles
 */
import { periodLabel, periodMonthLabel, monthOf, type PeriodKey } from "@/domain/periods";
import type { Calendar } from "@/domain/cycles";

export const TRANSITION_NAME = "Transición";
export const RANGE_SEPARATOR = " · ";

/** «Septiembre 2026», o «Transición» para un ciclo de transición. */
export function cycleLabel(cal: Calendar, p: PeriodKey): string {
  return cal.isTransition(p) ? TRANSITION_NAME : periodLabel(monthOf(p));
}
/** «Septiembre», o «Transición». Para la cabecera de la grilla, donde el año lo pone la banda. */
export function cycleMonthLabel(cal: Calendar, p: PeriodKey): string {
  return cal.isTransition(p) ? TRANSITION_NAME : periodMonthLabel(monthOf(p));
}
/** «Septiembre 2026 · 21 ago – 20 sep» en ciclos; «Septiembre 2026» en mes. */
export function withRange(cal: Calendar, p: PeriodKey): string {
  const r = cal.rangeLabel(p);
  return r ? `${cycleLabel(cal, p)}${RANGE_SEPARATOR}${r}` : cycleLabel(cal, p);
}
/** «10 sep 2026» para una fecha civil «YYYY-MM-DD». */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${meses[(m ?? 1) - 1]} ${y}`;
}
/** «21 de octubre» para el mensaje del primer pago. */
export function longDayMonth(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} de ${periodMonthLabel(`${iso.slice(0, 4)}-${String(m).padStart(2, "0")}`).toLocaleLowerCase("es")}`;
}
