// @aitri-trace domain:periods — FR-1901: el periodo del ledger es año y mes.
//
// Módulo:       src/domain/periods.ts
// Propósito:    Definir `PeriodKey` ("YYYY-MM") y su aritmética. Sustituye a `months.ts`, que
//               declaraba los doce literales de un año implícito.
// Dependencias: ninguna.
//
// PURO Y SIN RELOJ (ADR-02 del TRD): aquí no se llama a `new Date()`. El periodo en curso lo
// calcula el borde (`src/lib/date.ts`) y se lo PASA al dominio. Si el dominio leyera el reloj,
// `computeBalanceSeries` y las 26 funciones de `reserve.ts` dejarían de ser deterministas y la
// suite se rompería sola cada mes.

/**
 * Periodo del ledger: año y mes, como "YYYY-MM".
 *
 * Es un alias de `string`, no una unión de literales: el conjunto de periodos es ABIERTO, así que
 * un tipo cerrado es imposible. La seguridad la dan los validadores de este módulo en los bordes
 * (dominio, API, base), no el compilador — de ahí que la validación de servidor sea un requisito
 * (NFR-1908) y no un adorno.
 */
export type PeriodKey = string;

/** Nombres de los doce meses. Datos puros para rótulos: NO son el eje de indexación. */
export const MONTH_LABELS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

/** Nombres cortos, para encabezados estrechos. */
export const MONTH_LABELS_SHORT = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
] as const;

// Feature ciclos (ADR-02): la clave puede llevar el sufijo «t» — el ciclo de TRANSICIÓN entre dos
// versiones de configuración cuando termina en el mismo mes que el ciclo que lo precede. Ordena por
// texto entre «2026-10» y «2026-11» sin tocar `comparePeriods`.
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])t?$/;

/** Longitudes admitidas: 7 («YYYY-MM») u 8 con el sufijo de transición (NFR-1908). */
const PERIOD_LEN = 7;
const CYCLE_KEY_LEN = 8;
/** Sufijo de la clave de transición (ADR-02). */
export const TRANSITION_SUFFIX = "t";

/**
 * True si `v` es un periodo bien formado. Único punto de verdad del formato.
 *
 * @aitri-trace FR-ID: FR-1901, US-ID: US-1901, AC-ID: AC-1903, TC-ID: TC-MAN-003f, TC-MAN-004e
 */
export function isPeriodKey(v: unknown): v is PeriodKey {
  return typeof v === "string" && (v.length === PERIOD_LEN || v.length === CYCLE_KEY_LEN) && PERIOD_RE.test(v);
}

/**
 * True si la clave es la de un ciclo de transición («YYYY-MMt»). Feature ciclos, ADR-02.
 *
 * @aitri-trace FR-ID: FR-2408, US-ID: US-2408, AC-ID: AC-2425, TC-ID: TC-CIC-080e
 */
export function isCycleKey(v: unknown): boolean {
  return isPeriodKey(v) && v.length === CYCLE_KEY_LEN;
}

/** La clave de mes de cualquier clave: «2026-10t» → «2026-10». Identidad para una clave de mes. */
export function monthOf(p: PeriodKey): PeriodKey {
  return isCycleKey(p) ? p.slice(0, PERIOD_LEN) : p;
}

/** La clave de transición del mes: «2026-10» → «2026-10t». */
export function transitionKey(month: PeriodKey): PeriodKey {
  return `${monthOf(month)}${TRANSITION_SUFFIX}`;
}

/** Año de un periodo. Devuelve NaN si el periodo es inválido. */
export function periodYear(p: PeriodKey): number {
  return isPeriodKey(p) ? Number(p.slice(0, 4)) : NaN;
}

/** Mes de un periodo, 1–12. Devuelve NaN si el periodo es inválido. */
export function periodMonth(p: PeriodKey): number {
  return isPeriodKey(p) ? Number(p.slice(5, 7)) : NaN;
}

/** Compone un periodo a partir de año y mes (1–12). No valida el rango del año. */
export function periodOf(year: number, month1to12: number): PeriodKey {
  return `${String(year).padStart(4, "0")}-${String(month1to12).padStart(2, "0")}`;
}

/**
 * Compara dos periodos. Como el formato es de ancho fijo y de mayor a menor significancia,
 * el orden de TEXTO coincide con el cronológico — incluido el salto de año.
 *
 * @aitri-trace FR-ID: FR-1901, US-ID: US-1901, AC-ID: AC-1902, TC-ID: TC-MAN-002e
 */
export function comparePeriods(a: PeriodKey, b: PeriodKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** El menor de dos periodos. */
export function minPeriod(a: PeriodKey, b: PeriodKey): PeriodKey {
  return comparePeriods(a, b) <= 0 ? a : b;
}

/**
 * Desplaza un periodo `n` meses (n puede ser negativo). Cruza el borde de año.
 * Un periodo inválido se devuelve tal cual: el llamador valida antes.
 */
export function addMonths(p: PeriodKey, n: number): PeriodKey {
  // Feature ciclos (FLAG-1): sobre una clave de transición la aritmética de meses NO tiene sentido
  // — la vecindad la da el calendario. Lanzar aquí es preferible a perder el sufijo en silencio.
  if (isCycleKey(p)) throw new Error(`addMonths: «${p}» es una clave de transición; usa calendar.next/prev`);
  if (!isPeriodKey(p) || !Number.isFinite(n)) return p;
  const total = periodYear(p) * 12 + (periodMonth(p) - 1) + Math.trunc(n);
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return periodOf(year, month);
}

/**
 * Feature ciclos (gate estático, TC-CIC-102e): vecinos de MES para el código que por contrato solo
 * opera en modo mes (el cierre normaliza su frontera sin calendario). En ciclos la vecindad la da
 * `calendar.next/prev`; ante una clave de transición lanzan, igual que `addMonths`.
 */
export function monthNext(p: PeriodKey): PeriodKey {
  return addMonths(p, 1);
}
export function monthPrev(p: PeriodKey): PeriodKey {
  return addMonths(p, -1);
}

/** Meses entre dos periodos (`to` − `from`). Negativo si `to` es anterior. */
export function monthsBetween(from: PeriodKey, to: PeriodKey): number {
  if (!isPeriodKey(from) || !isPeriodKey(to)) return NaN;
  return (periodYear(to) * 12 + periodMonth(to)) - (periodYear(from) * 12 + periodMonth(from));
}

/**
 * Lista ORDENADA y SIN HUECOS de periodos, de `from` a `to` inclusive.
 * Si `to` es anterior a `from`, devuelve vacío — nunca un rango invertido.
 *
 * Es la lista que el dominio recibe: que sea contigua y ordenada es lo que garantiza que el
 * arrastre encadene bien y que la columna que el usuario ve sea la que el techo evalúa.
 *
 * @aitri-trace FR-ID: FR-1906, US-ID: US-1906, AC-ID: AC-1916, TC-ID: TC-MAN-050h
 */
export function periodRange(from: PeriodKey, to: PeriodKey): PeriodKey[] {
  if (!isPeriodKey(from) || !isPeriodKey(to)) return [];
  // Cotas con sufijo se reducen a su mes: la lista de MESES nunca contiene transiciones (esas las
  // intercala `Calendar.keys`). Así esta ruta «nunca lanza» aunque la cota venga de un dato con «t».
  const f = monthOf(from);
  const n = monthsBetween(f, monthOf(to));
  if (!Number.isFinite(n) || n < 0) return [];
  const out: PeriodKey[] = [];
  for (let i = 0; i <= n; i++) out.push(addMonths(f, i));
  return out;
}

/**
 * Deriva el periodo de una fecha ISO ("YYYY-MM-DD…"). El puente entre la fecha de captura de un
 * movimiento y el eje de roll-ups (ADR-03 de stack-upgrade-theme, ahora con año).
 *
 * @aitri-trace FR-ID: FR-1908, US-ID: US-1908, AC-ID: AC-1923, TC-ID: TC-MAN-070h
 */
export function periodFromDate(iso: string): PeriodKey | null {
  if (typeof iso !== "string" || iso.length < 7) return null;
  const head = iso.slice(0, 7);
  return isPeriodKey(head) ? head : null;
}

/** Rótulo largo de un periodo: "Marzo 2026". */
export function periodLabel(p: PeriodKey): string {
  const m = periodMonth(p);
  return Number.isNaN(m) ? p : `${MONTH_LABELS[m - 1]} ${periodYear(p)}`;
}

/** Rótulo del mes sin el año: "Marzo". El año lo marca el encabezado (FR-1905). */
export function periodMonthLabel(p: PeriodKey): string {
  const m = periodMonth(p);
  return Number.isNaN(m) ? p : MONTH_LABELS[m - 1];
}

/** Rótulo corto: "Mar". */
export function periodMonthLabelShort(p: PeriodKey): string {
  const m = periodMonth(p);
  return Number.isNaN(m) ? p : MONTH_LABELS_SHORT[m - 1];
}

/** True si `p` es enero — el punto donde el encabezado marca el cambio de año (FR-1905). */
export function isYearStart(p: PeriodKey): boolean {
  return periodMonth(p) === 1;
}
