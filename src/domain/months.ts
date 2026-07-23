import type { MonthKey } from "./types";

export const MONTHS: { k: MonthKey; label: string }[] = [
  { k: "ene", label: "Enero" },
  { k: "feb", label: "Febrero" },
  { k: "mar", label: "Marzo" },
  { k: "abr", label: "Abril" },
  { k: "may", label: "Mayo" },
  { k: "jun", label: "Junio" },
  { k: "jul", label: "Julio" },
  { k: "ago", label: "Agosto" },
  { k: "sep", label: "Septiembre" },
  { k: "oct", label: "Octubre" },
  { k: "nov", label: "Noviembre" },
  { k: "dic", label: "Diciembre" },
];

export const MONTH_KEYS: MonthKey[] = MONTHS.map((m) => m.k);

export function monthLabel(k: MonthKey): string {
  return MONTHS.find((m) => m.k === k)?.label ?? k;
}

/**
 * Mes en curso según el reloj (v1 es single-year 2026; solo importa el mes).
 * Único punto de verdad para el default de periodo (store), el fallback del
 * toggle Año→Mes (DesktopShell) y el auto-scroll inicial de la grilla (BG-007).
 */
export function currentMonthKey(): MonthKey {
  return MONTH_KEYS[new Date().getMonth()] ?? "ene";
}
