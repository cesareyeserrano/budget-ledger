// @aitri-trace domain:cycles — feature ciclos (FR-2402, FR-2404, FR-2405, FR-2406, FR-2408, FR-2410).
//
// Module:       src/domain/cycles.ts
// Purpose:      El único sitio que sabe qué es un ciclo de pago. Expone `Calendar` (fecha ↔ clave,
//               clave → rango), `MONTH_CALENDAR` (= el comportamiento de siempre), el constructor
//               desde la configuración versionada, la reubicación pura en ambas direcciones (ADR-06),
//               la regla del ingreso adelantado y el validador de periodo de un movimiento.
// Dependencies: ./periods, ./types, ./reserve (isAvailable, resolvedBalance), ./closure, ./opening.
//
// PURO Y SIN RELOJ (ADR-02 de multi-anio): «hoy» entra como argumento. Determinista: misma entrada,
// misma salida; nada aquí llama a `new Date()` sin argumento.
//
// LA DECISIÓN QUE GOBIERNA TODO (ADR-01): la clave de periodo «YYYY-MM» NO cambia. Un ciclo es esa
// misma clave con otro rango de fechas detrás, nombrado por el MES EN QUE TERMINA («Septiembre» =
// 21 ago – 20 sep). Todo lo indexado por clave (celdas, cierre, balance, reservas) sigue igual; lo
// único que cambia es (1) cómo una FECHA se vuelve clave, (2) cómo se rotula, (3) cuál es «hoy» y
// (4) qué lista de claves se pinta. Las cuatro cosas viven aquí.

import type {
  CycleConfig, CycleVersion, EndOfMonthPolicy, LedgerState, Movement, NodeType, OriginPart, PeriodKey, PeriodMode,
} from "./types";
import {
  addMonths, comparePeriods, isCycleKey, isPeriodKey, monthOf, periodFromDate, periodOf, periodRange,
  periodYear, periodMonth, MONTH_LABELS_SHORT, transitionKey, monthPrev,
} from "./periods";
import { isAvailable, resolvedBalance } from "./reserve";
import { closureOf } from "./closure";
import { normalizeStartMonth } from "./opening";

// ── Fechas civiles como «YYYY-MM-DD» en UTC: cuatro operaciones, ninguna dependencia ────────────

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True si `iso` es una fecha civil EXISTENTE («2026-02-30» no lo es aunque case la regex). */
export function isIsoDate(iso: unknown): iso is string {
  if (typeof iso !== "string" || !ISO_DATE_RE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}
function toUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}
function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
/** Suma días a una fecha civil. */
export function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * DAY_MS);
}
/** Días entre dos fechas (`b − a`). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}
/** Días que tiene el mes de una clave. */
export function daysInMonth(month: PeriodKey): number {
  const y = periodYear(month);
  const m = periodMonth(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** La fecha ISO de un día dentro de un mes, sin validar el día. */
function dateOf(month: PeriodKey, day: number): string {
  return `${monthOf(month)}-${String(day).padStart(2, "0")}`;
}
/** «YYYY-MM-DD…» (fecha de captura con hora) → «YYYY-MM-DD». */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

// ── Configuración ────────────────────────────────────────────────────────────────────────────────

export const ANCHOR_DAY_MIN = 1;
export const ANCHOR_DAY_MAX = 31;
export const EOM_POLICIES: readonly EndOfMonthPolicy[] = ["last_day", "shift"];
/** Ventana del ingreso adelantado (FR-2406): hasta 3 días antes del próximo día de pago. */
export const OPENING_WINDOW_DAYS = 3;
/** Cuántos ciclos lista la previsualización (FR-2403). */
export const PREVIEW_CYCLES = 6;

export class InvalidCycleConfig extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCycleConfig";
  }
}

/** Configuración vacía: modo mes, sin versiones. Es lo que tiene todo ledger previo a la feature. */
export const NO_CYCLES: CycleConfig = { mode: "month", versions: [] };

/**
 * Normaliza una configuración de procedencia dudosa. Misma política que `normalizeClosure`: nunca
 * lanza; lo ilegible degrada a «modo mes» — que es seguro porque el servidor sigue validando.
 *
 * @aitri-trace FR-ID: FR-2401, US-ID: US-2401, AC-ID: AC-2401, TC-ID: TC-CIC-008e
 */
export function normalizeCycleConfig(v: unknown): CycleConfig {
  if (!v || typeof v !== "object") return NO_CYCLES;
  const raw = v as { versions?: unknown };
  if (!Array.isArray(raw.versions)) return NO_CYCLES;
  const versions: CycleVersion[] = [];
  for (const x of raw.versions) {
    if (!x || typeof x !== "object") return NO_CYCLES;
    const r = x as Record<string, unknown>;
    const mode = r.mode === "cycle" ? "cycle" : r.mode === "month" ? "month" : null;
    if (mode === null || !isIsoDate(r.effectiveFrom)) return NO_CYCLES;
    if (mode === "cycle") {
      if (!isAnchorDay(r.anchorDay) || !isEomPolicy(r.eomPolicy)) return NO_CYCLES;
      if (r.firstPay !== null && r.firstPay !== undefined && !isIsoDate(r.firstPay)) return NO_CYCLES;
    }
    versions.push({
      seq: typeof r.seq === "number" ? r.seq : versions.length + 1,
      mode,
      anchorDay: mode === "cycle" ? (r.anchorDay as number) : null,
      eomPolicy: mode === "cycle" ? (r.eomPolicy as EndOfMonthPolicy) : null,
      effectiveFrom: r.effectiveFrom as string,
      firstPay: mode === "cycle" && isIsoDate(r.firstPay) ? r.firstPay : null,
      restoreStartMonth: isPeriodKey(r.restoreStartMonth) ? r.restoreStartMonth : null,
      createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    });
  }
  versions.sort((a, b) => a.seq - b.seq);
  const last = versions[versions.length - 1];
  return { mode: last ? last.mode : "month", versions };
}
export function isAnchorDay(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= ANCHOR_DAY_MIN && v <= ANCHOR_DAY_MAX;
}
export function isEomPolicy(v: unknown): v is EndOfMonthPolicy {
  return v === "last_day" || v === "shift";
}

/** Las versiones «cycle» vigentes: las posteriores a la última vuelta a mes. */
function activeCycleVersions(cfg: CycleConfig): CycleVersion[] {
  let start = 0;
  cfg.versions.forEach((v, i) => { if (v.mode === "month") start = i + 1; });
  return cfg.versions.slice(start).filter((v) => v.mode === "cycle");
}

/**
 * La fecha de pago de un mes bajo un día y una política de fin de mes (FR-2402).
 * `last_day`: el último día del mes si el día no existe. `shift`: el día 1 del mes siguiente.
 *
 * @aitri-trace FR-ID: FR-2402, US-ID: US-2402, AC-ID: AC-2406, TC-ID: TC-CIC-011e, TC-CIC-012e
 */
export function anchorDateOf(month: PeriodKey, anchorDay: number, policy: EndOfMonthPolicy): string {
  const dim = daysInMonth(month);
  if (anchorDay <= dim) return dateOf(month, anchorDay);
  return policy === "last_day" ? dateOf(month, dim) : dateOf(addMonths(monthOf(month), 1), 1);
}

// ── Calendar ──────────────────────────────────────────────────────────────────────────────────────

export interface CycleEntry {
  key: PeriodKey;
  start: string;
  end: string;
  transition: boolean;
}

export interface Calendar {
  readonly mode: PeriodMode;
  readonly config: CycleConfig;
  /** Lista contigua y ordenada de claves entre dos cotas (inclusive), con las transiciones. */
  keys(from: PeriodKey, to: PeriodKey): PeriodKey[];
  next(p: PeriodKey): PeriodKey;
  prev(p: PeriodKey): PeriodKey;
  /** RF-10: la clave que contiene la fecha. Lanza si la fecha es inválida o cae fuera de la tabla. */
  periodForDate(iso: string): PeriodKey;
  /** El rango de fechas de una clave, o null (modo mes, o clave desconocida). */
  rangeOf(p: PeriodKey): { start: string; end: string } | null;
  isTransition(p: PeriodKey): boolean;
  /** «21 ago – 20 sep», o null en modo mes. Formato único en toda la app (NFR-2412). */
  rangeLabel(p: PeriodKey): string | null;
  containsToday(p: PeriodKey, todayISO: string): boolean;
  /** Las entradas de la tabla (modo ciclos) — para la previsualización. */
  entries(): readonly CycleEntry[];
}

/**
 * El calendario de siempre: un mes es un mes. Delega en `periods.ts`, así el modo mes queda idéntico
 * por construcción (NFR-2401), no por disciplina.
 */
export const MONTH_CALENDAR: Calendar = {
  mode: "month",
  config: NO_CYCLES,
  keys: (from, to) => periodRange(from, to),
  next: (p) => addMonths(monthOf(p), 1),
  prev: (p) => addMonths(monthOf(p), -1),
  periodForDate: (iso) => {
    const p = periodFromDate(iso);
    if (p === null) throw new InvalidCycleConfig(`fecha inválida: ${iso}`);
    return p;
  },
  rangeOf: () => null,
  isTransition: () => false,
  rangeLabel: () => null,
  containsToday: (p, todayISO) => periodFromDate(todayISO) === p,
  entries: () => [],
};

/** Meses de margen que la tabla construye a cada lado de las cotas pedidas. */
const TABLE_MARGIN_MONTHS = 3;

/**
 * Construye el calendario de ciclos para unas cotas de MESES (FR-2402, FR-2408).
 *
 * Algoritmo: (1) por cada versión «cycle» vigente se generan sus fechas de pago (anclas); la primera
 * cubre todo el rango, cada siguiente empieza en su `firstPay`; (2) la lista ordenada de anclas
 * define los ciclos: cada uno va de un ancla al día anterior del siguiente; (3) el ciclo que va del
 * último pago de una versión al primer pago de la siguiente es la TRANSICIÓN si no coincide con lo
 * que la versión vieja habría pagado; (4) cada ciclo se nombra por el mes en que TERMINA, y solo si
 * esa clave ya la ocupa el ciclo anterior recibe el sufijo «t» (ADR-02, hallazgo 5 de la revisión).
 * Contigüidad por construcción: cada `end` se deriva del `start` siguiente (RV-03, RV-06).
 *
 * @aitri-trace FR-ID: FR-2402, US-ID: US-2402, AC-ID: AC-2405, TC-ID: TC-CIC-010h, TC-CIC-014e, TC-CIC-016e
 * @aitri-trace FR-ID: FR-2408, US-ID: US-2408, AC-ID: AC-2425, TC-ID: TC-CIC-073h, TC-CIC-149e, TC-CIC-150e
 */
export function buildCalendar(
  cfg: CycleConfig | undefined, bounds: { from: PeriodKey; to: PeriodKey }
): Calendar {
  // Aquí se VALIDA, no se degrada: una configuración inválida lanza (TC-CIC-013f/017f) y el
  // calendario anterior, que vive en el llamador, queda intacto. La degradación silenciosa es de
  // `normalizeCycleConfig`, para el borde (carga/hidratación), no para construir.
  const config: CycleConfig = cfg ?? NO_CYCLES;
  if (!Array.isArray(config.versions)) throw new InvalidCycleConfig("versions inválido");
  for (const v of config.versions) {
    if (v.mode !== "cycle" && v.mode !== "month") throw new InvalidCycleConfig("mode inválido");
    if (!isIsoDate(v.effectiveFrom)) throw new InvalidCycleConfig(`effectiveFrom inválido: ${v.effectiveFrom}`);
    if (v.mode === "cycle") {
      if (!isAnchorDay(v.anchorDay)) throw new InvalidCycleConfig(`anchorDay inválido: ${v.anchorDay}`);
      if (!isEomPolicy(v.eomPolicy)) throw new InvalidCycleConfig(`eomPolicy inválido: ${v.eomPolicy}`);
      if (v.firstPay !== null && v.firstPay !== undefined && !isIsoDate(v.firstPay)) throw new InvalidCycleConfig(`firstPay inválido: ${v.firstPay}`);
    }
  }
  const versions = activeCycleVersions(config);
  const mode = config.versions.length > 0 ? config.versions[config.versions.length - 1]!.mode : "month";
  if (mode !== "cycle" || versions.length === 0) return MONTH_CALENDAR;
  if (!isPeriodKey(bounds.from) || !isPeriodKey(bounds.to)) throw new InvalidCycleConfig("cotas inválidas");
  const fromM = addMonths(monthOf(bounds.from), -TABLE_MARGIN_MONTHS);
  const toM = addMonths(monthOf(bounds.to), TABLE_MARGIN_MONTHS);
  const months = periodRange(addMonths(fromM, -1), addMonths(toM, 1));

  // (1) anclas por versión, segmentadas por firstPay
  type Anchor = { date: string; versionIdx: number; nominalNext: string };
  const anchors: Anchor[] = [];
  versions.forEach((v, idx) => {
    const day = v.anchorDay as number;
    const policy = v.eomPolicy as EndOfMonthPolicy;
    const from = idx === 0 ? null : (v.firstPay as string | null);
    const until = versions[idx + 1]?.firstPay ?? null;
    for (let i = 0; i < months.length; i++) {
      const date = anchorDateOf(months[i]!, day, policy);
      if (from !== null && date < from) continue;
      if (until !== null && date >= until) continue;
      const nominalNext = anchorDateOf(months[i + 1] ?? addMonths(months[i]!, 1), day, policy);
      anchors.push({ date, versionIdx: idx, nominalNext });
    }
  });
  anchors.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Sin duplicados (una política «shift» puede pisar el día 1 del mes siguiente dos veces)
  const uniq: Anchor[] = [];
  for (const a of anchors) if (uniq.length === 0 || uniq[uniq.length - 1]!.date !== a.date) uniq.push(a);

  // (2)(3)(4) ciclos, transición, nombre
  const entries: CycleEntry[] = [];
  for (let i = 0; i + 1 < uniq.length; i++) {
    const a = uniq[i]!;
    const b = uniq[i + 1]!;
    const start = a.date;
    const end = addDays(b.date, -1);
    if (end < start) continue; // RV-08: nunca un ciclo de duración cero o negativa
    const transition = b.versionIdx !== a.versionIdx && b.date !== a.nominalNext;
    let key = periodOf(Number(end.slice(0, 4)), Number(end.slice(5, 7)));
    const prevKey = entries[entries.length - 1]?.key;
    if (prevKey !== undefined && monthOf(prevKey) === key) key = transitionKey(key);
    entries.push({ key, start, end, transition });
  }
  return makeCalendar(config, entries);
}

function makeCalendar(config: CycleConfig, entries: CycleEntry[]): Calendar {
  const index = new Map<PeriodKey, number>();
  entries.forEach((e, i) => index.set(e.key, i));
  const rangeOf = (p: PeriodKey) => {
    const i = index.get(p);
    return i === undefined ? null : { start: entries[i]!.start, end: entries[i]!.end };
  };
  const periodForDate = (iso: string): PeriodKey => {
    if (typeof iso !== "string" || !isIsoDate(dayOf(iso))) throw new InvalidCycleConfig(`fecha inválida: ${iso}`);
    const d = dayOf(iso);
    let lo = 0;
    let hi = entries.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const e = entries[mid]!;
      if (d < e.start) hi = mid - 1;
      else if (d > e.end) lo = mid + 1;
      else return e.key;
    }
    throw new InvalidCycleConfig(`fecha fuera del calendario: ${iso}`);
  };
  return {
    mode: "cycle",
    config,
    entries: () => entries,
    // Las cotas son de MES: una transición que termina en el mes de `to` («2026-10t» con to
    // «2026-10») está DENTRO del rango; y una cota `from` con sufijo excluye al mes que la precede.
    keys: (from, to) => entries.filter((e) => comparePeriods(e.key, from) >= 0 && comparePeriods(monthOf(e.key), monthOf(to)) <= 0).map((e) => e.key),
    next: (p) => {
      const i = index.get(p);
      if (i !== undefined && entries[i + 1]) return entries[i + 1]!.key;
      return addMonths(monthOf(p), 1);
    },
    prev: (p) => {
      const i = index.get(p);
      if (i !== undefined && i > 0) return entries[i - 1]!.key;
      return addMonths(monthOf(p), -1);
    },
    periodForDate,
    rangeOf,
    isTransition: (p) => {
      const i = index.get(p);
      return i !== undefined && entries[i]!.transition;
    },
    rangeLabel: (p) => {
      const r = rangeOf(p);
      return r ? formatRange(r.start, r.end) : null;
    },
    containsToday: (p, todayISO) => {
      const r = rangeOf(p);
      return !!r && r.start <= dayOf(todayISO) && dayOf(todayISO) <= r.end;
    },
  };
}

/**
 * «21 ago – 20 sep»: día sin cero, mes en tres letras minúsculas, guion corto con espacios. El año
 * nunca va en el rango: lo lleva el nombre o la banda de año (NFR-2412).
 *
 * @aitri-trace FR-ID: FR-2407, US-ID: US-2407, AC-ID: AC-2422, TC-ID: TC-CIC-066e
 */
export function formatRange(start: string, end: string): string {
  const f = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTH_LABELS_SHORT[Number(iso.slice(5, 7)) - 1]!.toLowerCase()}`;
  return `${f(start)} – ${f(end)}`;
}

/** El calendario que corresponde a un estado, con cotas de mes generosas alrededor de sus datos. */
export function calendarFor(state: Pick<LedgerState, "cycles">, bounds: { from: PeriodKey; to: PeriodKey }): Calendar {
  return buildCalendar(state.cycles, bounds);
}

// ── Asignación por fecha (FR-2405) y el ingreso adelantado (FR-2406) ─────────────────────────────

/**
 * FR-2406. Si el movimiento es un INGRESO fechado dentro de los 3 días anteriores al próximo día de
 * pago, devuelve el ciclo que ese pago abre (la propuesta); si no, null. En modo mes, siempre null.
 *
 * @aitri-trace FR-ID: FR-2406, US-ID: US-2406, AC-ID: AC-2419, TC-ID: TC-CIC-055e, TC-CIC-057f, TC-CIC-059e
 */
export function proposeOpeningCycle(cal: Calendar, type: NodeType, iso: string): PeriodKey | null {
  if (cal.mode !== "cycle" || type !== "income") return null;
  const p = cal.periodForDate(iso);
  const next = cal.next(p);
  const r = cal.rangeOf(next);
  if (!r) return null;
  const diff = daysBetween(dayOf(iso), r.start);
  return diff >= 1 && diff <= OPENING_WINDOW_DAYS ? next : null;
}

/**
 * FR-2405 / RV-01 / RV-02. El periodo de un movimiento es válido si es el de su fecha, o el ciclo
 * que abre (FR-2406) para un ingreso dentro de la ventana. Sin fecha: válido solo en modo mes.
 *
 * @aitri-trace FR-ID: FR-2405, US-ID: US-2405, AC-ID: AC-2415, TC-ID: TC-CIC-046e, TC-CIC-049f
 */
export function isValidMovementPeriod(
  cal: Calendar, mv: Pick<Movement, "type" | "period"> & { date?: string | undefined }
): boolean {
  if (!isPeriodKey(mv.period)) return false;
  if (!mv.date) return cal.mode === "month";
  let p: PeriodKey;
  try { p = cal.periodForDate(mv.date); } catch { return false; }
  if (mv.period === p) return true;
  return proposeOpeningCycle(cal, mv.type, mv.date) === mv.period;
}

// ── Descomposición del Ejecutado (ADR-06) ───────────────────────────────────────────────────────

/**
 * EXACTAMENTE lo que registrar `mv` hizo sobre `actuals` (ADR-06, FLAG-6): gasto/ingreso suman a
 * su hoja; un aporte desde Disponible suma a la alcancía destino (`applyReserveOp`,
 * reserve.ts:1128); un retiro o un mover entre alcancías es solo journal y no escribe celda.
 *
 * @aitri-trace FR-ID: FR-2404, US-ID: US-2404, AC-ID: AC-2412, TC-ID: TC-CIC-148e, TC-CIC-041e
 */
export function movementDeltas(mv: Movement): Array<{ leafId: string; delta: number }> {
  if (mv.type !== "transfer") return [{ leafId: mv.target, delta: mv.amount }];
  if (isAvailable(mv.from) && mv.to && !isAvailable(mv.to)) return [{ leafId: mv.to, delta: mv.amount }];
  return [];
}

type CellMap = Record<string, Partial<Record<PeriodKey, number>>>;

function addCell(map: CellMap, leafId: string, period: PeriodKey, delta: number): void {
  if (delta === 0 && map[leafId]?.[period] !== undefined) return;
  map[leafId] = { ...(map[leafId] ?? {}) };
  map[leafId]![period] = (map[leafId]![period] ?? 0) + delta;
}

/**
 * Primitiva de la reubicación: mueve un movimiento a otro periodo llevándose sus deltas — la
 * celda de origen baja, la de destino sube, el movimiento sigue siendo uno.
 *
 * @aitri-trace FR-ID: FR-2405, US-ID: US-2405, AC-ID: AC-2416, TC-ID: TC-CIC-047e
 */
export function reassignMovementPeriod(state: LedgerState, movementId: string, period: PeriodKey): LedgerState {
  const i = state.movements.findIndex((m) => m.id === movementId);
  if (i < 0 || !isPeriodKey(period)) return state;
  const mv = state.movements[i]!;
  if (mv.period === period) return state;
  const actuals: CellMap = { ...state.actuals };
  for (const { leafId, delta } of movementDeltas(mv)) {
    addCell(actuals, leafId, mv.period, -delta);
    if (actuals[leafId]![mv.period] === 0) delete actuals[leafId]![mv.period];
    addCell(actuals, leafId, period, delta);
  }
  const movements = state.movements.slice();
  movements[i] = { ...mv, period };
  return { ...state, actuals, movements };
}

// ── Reubicación (FR-2404, FR-2408, FR-2410) ─────────────────────────────────────────────────────

export type RelocationRule = "keys_in_calendar" | "period_matches_date" | "sums" | "leaf_sums" | "reserve_floor" | "negative_cell";
export interface RelocationBlocked {
  blocked: "closed_period" | "relocation_invariant";
  detail: { rule?: RelocationRule; ids?: string[]; leafId?: string; period?: PeriodKey };
}
export interface RelocationSummary {
  cellsMoved: number;
  /** Movimientos reasignados a su ciclo: todos los que llevan fecha, más los sin fecha que cambian de clave (AC-2409: «27 movimientos cambian de ciclo»). */
  movementsMoved: number;
  /** De esos, cuántos cambian de COLUMNA (de clave): el matiz que la previsualización añade. */
  movementsKeyChanged: number;
  /** Celdas de dato sin día que juntan dos o más meses con monto; al volver, las que se separan (FR-2403). */
  mergedCells: number;
  cellsSumBefore: number;
  cellsSumAfter: number;
  movementsSumBefore: number;
  movementsSumAfter: number;
  identical: boolean;
  historyStart: PeriodKey | null;
  restoreStartMonth: PeriodKey | null;
}
export type RelocationResult = { state: LedgerState; summary: RelocationSummary } | RelocationBlocked;

function sumMap(m: CellMap): number {
  let t = 0;
  for (const cells of Object.values(m)) for (const v of Object.values(cells ?? {})) t += v ?? 0;
  return t;
}
function sumByLeaf(m: CellMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [leaf, cells] of Object.entries(m)) { let t = 0; for (const v of Object.values(cells ?? {})) t += v ?? 0; out[leaf] = t; }
  return out;
}
function oldestDatedMovement(state: LedgerState): string | null {
  let oldest: string | null = null;
  for (const m of state.movements) if (m.date && (oldest === null || dayOf(m.date) < oldest)) oldest = dayOf(m.date);
  return oldest;
}
function oldestKey(state: LedgerState): PeriodKey | null {
  let oldest: PeriodKey | null = null;
  const consider = (p: string) => { if (isPeriodKey(p) && (oldest === null || comparePeriods(p, oldest) < 0)) oldest = p; };
  for (const map of [state.budgets, state.actuals]) for (const cells of Object.values(map ?? {})) for (const [p, v] of Object.entries(cells ?? {})) if ((v ?? 0) !== 0) consider(p);
  for (const m of state.movements) consider(m.period);
  for (const byP of Object.values(state.cellNotes ?? {})) for (const [p, n] of Object.entries(byP ?? {})) if ((n?.length ?? 0) > 0) consider(p);
  return oldest;
}

/**
 * La regla del dato SIN DÍA (celdas, notas, movimientos sin fecha, frontera de cierre) al cambiar
 * de calendario. Una sola regla para las tres direcciones:
 *  - mes → ciclos: la clave M va al ciclo que ABRE el pago de M (nombrado M+1);
 *  - ciclos → mes: la clave K va al mes calendario en que EMPIEZA su ciclo;
 *  - ciclos → ciclos: K se conserva por NOMBRE si sigue existiendo; si desapareció, va al ciclo
 *    que contiene la fecha en que empezaba el ciclo viejo (hallazgo 5 de la revisión).
 *
 * @aitri-trace FR-ID: FR-2404, US-ID: US-2404, AC-ID: AC-2412, TC-ID: TC-CIC-030h, TC-CIC-031e
 * @aitri-trace FR-ID: FR-2408, US-ID: US-2408, AC-ID: AC-2437, TC-ID: TC-CIC-077e, TC-CIC-149e, TC-CIC-150e
 * @aitri-trace FR-ID: FR-2410, US-ID: US-2410, AC-ID: AC-2434, TC-ID: TC-CIC-091e, TC-CIC-094e
 */
export function mapDaylessKey(from: Calendar, to: Calendar, key: PeriodKey): PeriodKey {
  if (from.mode === "month" && to.mode === "cycle") {
    const v = activeCycleVersions(to.config)[0]!;
    // El pago del mes K bajo la PRIMERA versión: es el ancla que abre el ciclo «K+1».
    const pay = anchorDateOf(monthOf(key), v.anchorDay as number, v.eomPolicy as EndOfMonthPolicy);
    try { return to.periodForDate(pay); } catch { return addMonths(monthOf(key), 1); }
  }
  if (from.mode === "cycle" && to.mode === "month") {
    const r = from.rangeOf(key);
    return r ? periodOf(Number(r.start.slice(0, 4)), Number(r.start.slice(5, 7))) : monthOf(key);
  }
  if (from.mode === "cycle" && to.mode === "cycle") {
    if (to.rangeOf(key)) return key;
    const r = from.rangeOf(key);
    if (r) { try { return to.periodForDate(r.start); } catch { /* fuera de tabla: cae abajo */ } }
    return monthOf(key);
  }
  return key;
}

// ── El dato sin día sigue al ejecutado de su rubro (re-derivación 2026-09-10) ───────────────────

/**
 * El contexto con el que se decide dónde va un dato SIN DÍA (FR-2404, FR-2410, ADR-07): una sola pasada
 * por los movimientos fechados, atribuidos por `movementDeltas` (FLAG-7). `cycleOf(mv)`: al activar, el
 * ciclo del calendario destino que contiene su fecha; al volver, su `period` vigente — así cuenta el
 * ingreso que el usuario contó en el ciclo que abre (FR-2406).
 */
export interface PlacementContext {
  readonly cycleCal: Calendar;
  readonly direction: "activate" | "return";
  /** hoja → mes de la fecha → ciclo → Σ montos (caso 1 al activar). */
  readonly byMonth: ReadonlyMap<string, ReadonlyMap<PeriodKey, ReadonlyMap<PeriodKey, number>>>;
  /** hoja → ciclo → mes de la fecha → Σ montos (caso 1 al volver). */
  readonly byCycle: ReadonlyMap<string, ReadonlyMap<PeriodKey, ReadonlyMap<PeriodKey, number>>>;
  /** hoja → Σ de lo que cobra desde el día de pago y Σ del resto (caso 2). */
  readonly habit: ReadonlyMap<string, { late: number; early: number }>;
}
type Nested = Map<string, Map<PeriodKey, Map<PeriodKey, number>>>;
function bump(m: Nested, a: string, b: PeriodKey, c: PeriodKey, v: number): void {
  let l1 = m.get(a);
  if (!l1) { l1 = new Map(); m.set(a, l1); }
  let l2 = l1.get(b);
  if (!l2) { l2 = new Map(); l1.set(b, l2); }
  l2.set(c, (l2.get(c) ?? 0) + v);
}

/**
 * @aitri-trace FR-ID: FR-2404, US-ID: US-2404, AC-ID: AC-2412, TC-ID: TC-CIC-030h, TC-CIC-031e, TC-CIC-173e, TC-CIC-174e
 * @aitri-trace FR-ID: FR-2410, US-ID: US-2410, AC-ID: AC-2434, TC-ID: TC-CIC-091e
 */
export function placementContext(state: LedgerState, cycleCal: Calendar, direction: "activate" | "return"): PlacementContext {
  const byMonth: Nested = new Map();
  const byCycle: Nested = new Map();
  const habit = new Map<string, { late: number; early: number }>();
  for (const mv of state.movements) {
    if (!mv.date) continue;
    const day = dayOf(mv.date);
    if (!isIsoDate(day)) continue;
    let cyc: PeriodKey;
    if (direction === "activate") {
      try { cyc = cycleCal.periodForDate(day); } catch { continue; }
    } else {
      cyc = mv.period;
    }
    const month = day.slice(0, 7);
    const late = comparePeriods(monthOf(cyc), month) > 0;
    for (const { leafId, delta } of movementDeltas(mv)) {
      const amount = Math.abs(delta);
      bump(byMonth, leafId, month, cyc, amount);
      bump(byCycle, leafId, cyc, month, amount);
      const h = habit.get(leafId) ?? { late: 0, early: 0 };
      if (late) h.late += amount; else h.early += amount;
      habit.set(leafId, h);
    }
  }
  return { cycleCal, direction, byMonth, byCycle, habit };
}

/** La clave con la mayor suma; empate → la más antigua. `null` si no hay ninguna. */
function argmaxOldest(m: ReadonlyMap<PeriodKey, number> | undefined): PeriodKey | null {
  if (!m || m.size === 0) return null;
  let best: PeriodKey | null = null;
  let bestV = -Infinity;
  for (const [k, v] of m) {
    if (v > bestV || (v === bestV && best !== null && comparePeriods(k, best) < 0)) { best = k; bestV = v; }
  }
  return best;
}
/** El ciclo que lleva el nombre del mes M. */
function sameNameCycle(cal: Calendar, month: PeriodKey): PeriodKey {
  if (cal.rangeOf(month)) return month;
  try { return cal.periodForDate(`${monthOf(month)}-01`); } catch { return month; }
}
/** El hilo del movimiento en la regla: la hoja cuyo Ejecutado cambia, o su destino si solo es journal. */
function leafOfMovement(mv: Movement): string {
  return movementDeltas(mv)[0]?.leafId ?? mv.target;
}
function monthHasData(state: LedgerState, month: PeriodKey): boolean {
  for (const map of [state.budgets, state.actuals]) for (const cells of Object.values(map)) if ((cells?.[month] ?? 0) !== 0) return true;
  for (const mv of state.movements) if (mv.period === month || (mv.date && dayOf(mv.date).slice(0, 7) === month)) return true;
  for (const byP of Object.values(state.cellNotes ?? {})) if ((byP?.[month]?.length ?? 0) > 0) return true;
  return false;
}

/**
 * FR-2404. Dónde va, al activar, un dato sin día de la hoja en el mes M: (1) al ciclo con la mayor suma
 * de sus movimientos fechados en M (empate: el más antiguo); (2) si no hay, la costumbre de la hoja —
 * si lo que cobra desde el día de pago supera al resto, el ciclo que abre el pago de M; si no, el del
 * mismo nombre —; (3) sin historia, el ciclo del mismo nombre.
 *
 * @aitri-trace FR-ID: FR-2404, US-ID: US-2404, AC-ID: AC-2441, TC-ID: TC-CIC-173e, TC-CIC-174e, TC-CIC-172e
 */
export function placeDateless(ctx: PlacementContext, leafId: string, month: PeriodKey): PeriodKey {
  const m = monthOf(month);
  const case1 = argmaxOldest(ctx.byMonth.get(leafId)?.get(m));
  if (case1 !== null) return case1;
  const h = ctx.habit.get(leafId);
  if (h && h.late + h.early > 0 && h.late > h.early) return mapDaylessKey(MONTH_CALENDAR, ctx.cycleCal, m);
  return sameNameCycle(ctx.cycleCal, m);
}

/**
 * FR-2410. Los mismos tres casos al revés, SOLO para lo que no tiene memoria (creado ya en ciclos): (1) al
 * mes con la mayor suma de los movimientos de la hoja cuyo `period` es esa clave; (2) costumbre: si cobra
 * desde el día de pago, al mes en que empieza el ciclo; si no, al mes de su clave; (3) al mes de su
 * clave sin sufijo — también para una clave de transición.
 *
 * @aitri-trace FR-ID: FR-2410, US-ID: US-2410, AC-ID: AC-2434, TC-ID: TC-CIC-091e, TC-CIC-094e
 */
export function returnDateless(ctx: PlacementContext, leafId: string, cycleKey: PeriodKey): PeriodKey {
  const case1 = argmaxOldest(ctx.byCycle.get(leafId)?.get(cycleKey));
  if (case1 !== null) return case1;
  const h = ctx.habit.get(leafId);
  if (h && h.late + h.early > 0 && h.late > h.early) {
    const r = ctx.cycleCal.rangeOf(cycleKey);
    return r ? r.start.slice(0, 7) : monthPrev(monthOf(cycleKey));
  }
  return monthOf(cycleKey);
}

/**
 * FR-2410. Devuelve las partes de una celda con memoria cuando su valor actual ya no es la suma de ellas:
 * la diferencia va al mes MÁS RECIENTE; una reducción mayor de lo que ese mes puede ceder sigue hacia
 * atrás. `floorOf(mes)` es lo mínimo que puede quedar en esa parte: 0 en el Presupuestado; en el Ejecutado,
 * menos los movimientos que vuelven a ese mes, para que la celda reconstruida no quede negativa. `null`
 * si ni el mes más antiguo lo absorbe.
 *
 * @aitri-trace FR-ID: FR-2410, US-ID: US-2410, AC-ID: AC-2442, TC-ID: TC-CIC-179e, TC-CIC-181e, TC-CIC-182e
 */
export function restoreParts(
  value: number, parts: ReadonlyArray<{ month: PeriodKey; amount: number }>, floorOf: (month: PeriodKey) => number = () => 0,
): Array<{ month: PeriodKey; amount: number }> | null {
  if (parts.length === 0) return null;
  const out = [...parts].sort((a, b) => comparePeriods(a.month, b.month)).map((p) => ({ ...p }));
  let d = value - out.reduce((a, p) => a + p.amount, 0);
  if (d >= 0) { out[out.length - 1]!.amount += d; return out; }
  for (let i = out.length - 1; i >= 0 && d < 0; i--) {
    const p = out[i]!;
    const can = p.amount - floorOf(p.month);
    if (can <= 0) continue;
    const take = Math.min(can, -d);
    p.amount -= take;
    d += take;
  }
  return d < 0 ? null : out;
}

/**
 * La reubicación pura (ADR-05/ADR-06/ADR-07). (1) Descompone cada celda de Ejecutado en residuo tecleado
 * + Σ aportes de movimientos; (2) mueve cada movimiento con fecha por su fecha y cada dato sin día —
 * Presupuestado, residuo, movimiento sin fecha, nota — por la regla de su rubro: al activar con
 * `placeDateless` y anotando su mes en `next.origins`; al volver por su memoria (`restoreParts` si la
 * celda se editó) o, sin memoria, con `returnDateless`; al cambiar de día por nombre; (3) recompone.
 * Conserva las celdas en 0 que existían. Devuelve el estado nuevo y el resumen, o el bloqueo si una
 * invariante no se cumple. NUNCA muta el estado de entrada.
 *
 * @aitri-trace FR-ID: FR-2404, US-ID: US-2404, AC-ID: AC-2412, TC-ID: TC-CIC-030h, TC-CIC-035h, TC-CIC-036e, TC-CIC-172e, TC-CIC-175f
 * @aitri-trace FR-ID: FR-2404, US-ID: US-2404, AC-ID: AC-2439, TC-ID: TC-CIC-034e
 * @aitri-trace FR-ID: FR-2410, US-ID: US-2410, AC-ID: AC-2433, TC-ID: TC-CIC-093e, TC-CIC-180e, TC-CIC-183e, TC-CIC-184f
 */
export function relocate(
  state: LedgerState, from: Calendar, to: Calendar, todayISO: string, restore?: { restoreStartMonth: PeriodKey | null }
): RelocationResult {
  const closure = closureOf(state);
  if (to.mode === "month" && closure.closedThrough !== null) {
    return { blocked: "closed_period", detail: { period: closure.closedThrough } };
  }
  const activating = from.mode === "month" && to.mode === "cycle";
  const returning = from.mode === "cycle" && to.mode === "month";
  const map = (k: PeriodKey) => mapDaylessKey(from, to, k);
  const ctx = activating ? placementContext(state, to, "activate") : returning ? placementContext(state, from, "return") : null;
  const memory: OriginPart[] = returning ? (state.origins ?? []) : [];
  const origins: OriginPart[] = [];
  const keepZero = new Set<string>();
  const zeroKey = (plane: "b" | "a", leaf: string, p: PeriodKey) => `${plane}|${leaf}|${p}`;
  const memoryOf = (subject: OriginPart["subject"], ref: string, period: PeriodKey) =>
    memory.filter((o) => o.subject === subject && o.ref === ref && o.period === period);
  const negative = (leafId: string, period: PeriodKey): RelocationBlocked =>
    ({ blocked: "relocation_invariant", detail: { rule: "negative_cell", leafId, period } });

  // (1) residuos
  const deltas: CellMap = {};
  for (const mv of state.movements) for (const { leafId, delta } of movementDeltas(mv)) addCell(deltas, leafId, mv.period, delta);
  const residuo: CellMap = {};
  for (const [leaf, cells] of Object.entries(state.actuals)) {
    for (const [p, v] of Object.entries(cells ?? {})) addCell(residuo, leaf, p, (v ?? 0) - (deltas[leaf]?.[p] ?? 0));
  }
  for (const [leaf, cells] of Object.entries(deltas)) {
    for (const p of Object.keys(cells ?? {})) if (residuo[leaf]?.[p] === undefined) addCell(residuo, leaf, p, -(deltas[leaf]![p] ?? 0));
  }

  // (2a) movimientos: con fecha por su fecha; sin fecha por la regla del dato sin día
  let movementsMoved = 0;
  let movementsKeyChanged = 0;
  const movements: Movement[] = state.movements.map((mv) => {
    let k: PeriodKey;
    if (mv.date) {
      // Un ingreso que el usuario contó en el ciclo que abre (FR-2406) conserva esa decisión si la
      // ventana sigue existiendo en el calendario nuevo; si no, va por su fecha.
      const keptOpening = from.mode === "cycle" && mv.type === "income" && proposeOpeningCycle(from, mv.type, mv.date) === mv.period;
      const proposed = keptOpening ? proposeOpeningCycle(to, mv.type, mv.date) : null;
      k = proposed ?? to.periodForDate(mv.date);
    } else if (activating) {
      k = placeDateless(ctx!, leafOfMovement(mv), mv.period);
      origins.push({ subject: "movement", ref: mv.id, period: k, originPeriod: monthOf(mv.period), amount: 0 });
    } else if (returning) {
      const mem = memory.find((o) => o.subject === "movement" && o.ref === mv.id);
      k = mem ? mem.originPeriod : returnDateless(ctx!, leafOfMovement(mv), mv.period);
    } else {
      k = map(mv.period);
    }
    if (k !== mv.period) movementsKeyChanged++;
    if (mv.date || k !== mv.period) movementsMoved++;
    return k === mv.period ? mv : { ...mv, period: k };
  });
  const destDeltas: CellMap = {};
  for (const mv of movements) for (const { leafId, delta } of movementDeltas(mv)) addCell(destDeltas, leafId, mv.period, delta);

  // (2b) Presupuestado
  let cellsMoved = 0;
  let splitCells = 0;
  const budgets: CellMap = {};
  for (const [leaf, cells] of Object.entries(state.budgets)) {
    for (const [p, v] of Object.entries(cells ?? {})) {
      if (v === undefined) continue;
      const parts = returning ? memoryOf("budget", leaf, p) : [];
      if (parts.length > 0) {
        const restored = restoreParts(v, parts.map((o) => ({ month: o.originPeriod, amount: o.amount })));
        if (!restored) return negative(leaf, p);
        if (v !== 0 && restored.some((x) => x.month !== p)) cellsMoved++;
        if (restored.filter((x) => x.amount !== 0).length > 1) splitCells++;
        for (const x of restored) { addCell(budgets, leaf, x.month, x.amount); keepZero.add(zeroKey("b", leaf, x.month)); }
        continue;
      }
      const k = activating ? placeDateless(ctx!, leaf, p) : returning ? returnDateless(ctx!, leaf, p) : map(p);
      if (k !== p && v !== 0) cellsMoved++;
      addCell(budgets, leaf, k, v);
      if (v === 0) keepZero.add(zeroKey("b", leaf, k));
      if (activating) origins.push({ subject: "budget", ref: leaf, period: k, originPeriod: monthOf(p), amount: v });
    }
  }

  // (2c) residuos del Ejecutado
  const actuals: CellMap = {};
  for (const [leaf, cells] of Object.entries(residuo)) {
    for (const [p, r] of Object.entries(cells ?? {})) {
      if (r === undefined) continue;
      const existed = state.actuals[leaf]?.[p] !== undefined;
      const value = state.actuals[leaf]?.[p] ?? 0;
      const parts = returning && existed ? memoryOf("actual", leaf, p) : [];
      if (parts.length > 0) {
        const restored = restoreParts(r, parts.map((o) => ({ month: o.originPeriod, amount: o.amount })), (m) => -(destDeltas[leaf]?.[m] ?? 0));
        if (!restored) return negative(leaf, p);
        if (value !== 0 && restored.some((x) => x.month !== p)) cellsMoved++;
        if (restored.filter((x) => x.amount !== 0).length > 1) splitCells++;
        for (const x of restored) { addCell(actuals, leaf, x.month, x.amount); keepZero.add(zeroKey("a", leaf, x.month)); }
        continue;
      }
      const k = activating ? placeDateless(ctx!, leaf, p) : returning ? returnDateless(ctx!, leaf, p) : map(p);
      if (k !== p && value !== 0) cellsMoved++;
      addCell(actuals, leaf, k, r);
      // Solo se conserva en 0 lo que YA valía 0: una celda que valía por sus movimientos y los ve irse no deja un 0.
      if (existed && value === 0) keepZero.add(zeroKey("a", leaf, k));
      if (activating && existed) origins.push({ subject: "actual", ref: leaf, period: k, originPeriod: monthOf(p), amount: r });
    }
  }
  // (3) recomponer
  for (const mv of movements) for (const { leafId, delta } of movementDeltas(mv)) addCell(actuals, leafId, mv.period, delta);
  // limpiar SOLO los ceros que la resta creó: una celda en 0 que existía se conserva (AC-2433)
  for (const [plane, m] of [["b", budgets], ["a", actuals]] as const) {
    for (const [leaf, cells] of Object.entries(m)) {
      for (const [p, v] of Object.entries(cells ?? {})) if (v === 0 && !keepZero.has(zeroKey(plane, leaf, p))) delete m[leaf]![p];
      if (Object.keys(m[leaf] ?? {}).length === 0) delete m[leaf];
    }
  }

  // notas de celda
  const cellNotes: LedgerState["cellNotes"] = {};
  for (const [leaf, byP] of Object.entries(state.cellNotes ?? {})) {
    for (const [p, notes] of Object.entries(byP ?? {})) {
      if (!notes || notes.length === 0) continue;
      for (const n of notes) {
        let k: PeriodKey;
        if (activating) {
          k = placeDateless(ctx!, leaf, p);
          origins.push({ subject: "note", ref: n.id, period: k, originPeriod: monthOf(p), amount: 0 });
        } else if (returning) {
          const mem = memory.find((o) => o.subject === "note" && o.ref === n.id);
          k = mem ? mem.originPeriod : returnDateless(ctx!, leaf, p);
        } else {
          k = map(p);
        }
        cellNotes[leaf] = { ...(cellNotes[leaf] ?? {}) };
        cellNotes[leaf]![k] = [...(cellNotes[leaf]![k] ?? []), n];
      }
    }
  }
  for (const byP of Object.values(cellNotes)) {
    for (const [k, list] of Object.entries(byP ?? {})) byP![k] = [...(list ?? [])].sort((x, y) => x.createdAt - y.createdAt || x.id.localeCompare(y.id));
  }

  const closureNext = closure.closedThrough === null ? undefined : {
    closedThrough: map(closure.closedThrough),
    reopened: closure.reopened === null ? null : map(closure.reopened),
    ...(closure.reopenBaseline ? { reopenBaseline: closure.reopenBaseline } : {}),
  };

  let mergedCells = splitCells;
  if (activating) {
    const groups = new Map<string, Set<PeriodKey>>();
    for (const o of origins) {
      if ((o.subject !== "budget" && o.subject !== "actual") || o.amount === 0) continue;
      const g = `${o.subject}|${o.ref}|${o.period}`;
      const set = groups.get(g) ?? new Set<PeriodKey>();
      set.add(o.originPeriod);
      groups.set(g, set);
    }
    mergedCells = [...groups.values()].filter((x) => x.size > 1).length;
  }

  // startMonth
  const declared = normalizeStartMonth(state.startMonth);
  let startMonth: PeriodKey | null = declared === null ? null : map(declared);
  let restoreStartMonth: PeriodKey | null = declared;
  const draft: LedgerState = { ...state, budgets, actuals, movements, cellNotes };
  if (activating) {
    const oldestDate = oldestDatedMovement(state);
    if (declared === null) {
      if (oldestDate !== null) startMonth = to.periodForDate(oldestDate);
    } else {
      // FR-2404: el más antiguo entre la clave más antigua con datos tras mover, el ciclo del movimiento
      // fechado más antiguo y, si el mes declarado no tenía ningún dato, el ciclo que abre su pago.
      const candidates: PeriodKey[] = [];
      const oldest = oldestKey(draft);
      if (oldest !== null) candidates.push(oldest);
      if (oldestDate !== null) candidates.push(to.periodForDate(oldestDate));
      if (!monthHasData(state, declared) || candidates.length === 0) candidates.push(map(declared));
      startMonth = candidates.sort(comparePeriods)[0]!;
    }
  } else if (returning) {
    const candidate = restore ? restore.restoreStartMonth : null;
    const oldest = oldestKey(draft);
    // AC-2446: un ledger que no tenía mes de inicio declarado vuelve sin él.
    if (restore && candidate === null) startMonth = null;
    else if (candidate !== null && (oldest === null || comparePeriods(oldest, candidate) >= 0)) startMonth = candidate;
    else if (oldest !== null && startMonth !== null && comparePeriods(oldest, startMonth) < 0) startMonth = oldest;
    restoreStartMonth = null;
  } else if (to.mode === "cycle") {
    const oldest = oldestKey(draft);
    if (oldest !== null && startMonth !== null && comparePeriods(oldest, startMonth) < 0) startMonth = oldest;
  }

  const { startMonth: _prevStart, origins: _prevOrigins, ...rest } = state;
  void _prevStart; void _prevOrigins;
  const next: LedgerState = {
    ...rest,
    budgets,
    actuals,
    movements,
    cellNotes,
    ...(closureNext ? { closure: closureNext } : {}),
    ...(startMonth !== null ? { startMonth } : state.startMonth === null ? { startMonth: null } : {}),
    ...(activating ? { origins } : !returning && state.origins ? { origins: state.origins.map((o) => ({ ...o, period: map(o.period) })) } : {}),
  };
  const summary: RelocationSummary = {
    cellsMoved,
    movementsMoved,
    movementsKeyChanged,
    mergedCells,
    cellsSumBefore: sumMap(state.budgets) + sumMap(state.actuals),
    cellsSumAfter: sumMap(budgets) + sumMap(actuals),
    movementsSumBefore: state.movements.reduce((a, m) => a + m.amount, 0),
    movementsSumAfter: movements.reduce((a, m) => a + m.amount, 0),
    identical: false,
    historyStart: startMonth,
    restoreStartMonth,
  };
  void todayISO;
  summary.identical = summary.cellsSumBefore === summary.cellsSumAfter && summary.movementsSumBefore === summary.movementsSumAfter;
  const inv = checkRelocationInvariants(state, next, to);
  if (!inv.ok) return { blocked: "relocation_invariant", detail: inv.detail };
  return { state: next, summary };
}

/**
 * Las invariantes (i)–(v) del TRD sobre un estado reubicado. (i) sumas por mapa y de movimientos;
 * (ii) suma por hoja; (iii) toda clave pertenece al calendario; (iv) todo movimiento con fecha
 * cumple `isValidMovementPeriod`; (v) ninguna alcancía queda en negativo en ningún periodo; y
 * ninguna celda queda negativa (la base lo prohíbe: `amount_cell_amount_ck`).
 *
 * @aitri-trace FR-ID: FR-2404, US-ID: US-2404, AC-ID: AC-2412, TC-ID: TC-CIC-033e, TC-CIC-120f, TC-CIC-170f
 */
export function checkRelocationInvariants(
  before: LedgerState, after: LedgerState, cal: Calendar
): { ok: true } | { ok: false; detail: RelocationBlocked["detail"] } {
  // (i)
  if (sumMap(before.budgets) !== sumMap(after.budgets) || sumMap(before.actuals) !== sumMap(after.actuals)) {
    return { ok: false, detail: { rule: "sums" } };
  }
  const mb = before.movements.reduce((a, m) => a + m.amount, 0);
  const ma = after.movements.reduce((a, m) => a + m.amount, 0);
  if (mb !== ma || before.movements.length !== after.movements.length) return { ok: false, detail: { rule: "sums" } };
  // (ii)
  for (const [mapB, mapA] of [[before.budgets, after.budgets], [before.actuals, after.actuals]] as const) {
    const sb = sumByLeaf(mapB);
    const sa = sumByLeaf(mapA);
    for (const leaf of new Set([...Object.keys(sb), ...Object.keys(sa)])) {
      if ((sb[leaf] ?? 0) !== (sa[leaf] ?? 0)) return { ok: false, detail: { rule: "leaf_sums", leafId: leaf } };
    }
  }
  // celdas negativas
  for (const m of [after.budgets, after.actuals]) for (const [leaf, cells] of Object.entries(m)) {
    for (const [p, v] of Object.entries(cells ?? {})) if ((v ?? 0) < 0) return { ok: false, detail: { rule: "negative_cell", leafId: leaf, period: p } };
  }
  // (iii)
  const keysUsed = new Set<PeriodKey>();
  for (const m of [after.budgets, after.actuals]) for (const cells of Object.values(m)) for (const p of Object.keys(cells ?? {})) keysUsed.add(p);
  for (const mv of after.movements) keysUsed.add(mv.period);
  for (const byP of Object.values(after.cellNotes ?? {})) for (const p of Object.keys(byP ?? {})) keysUsed.add(p);
  if (keysUsed.size > 0) {
    const sorted = [...keysUsed].sort(comparePeriods);
    const allowed = new Set(cal.keys(monthOf(sorted[0]!), monthOf(sorted[sorted.length - 1]!)));
    const bad = sorted.filter((k) => !allowed.has(k));
    if (bad.length > 0) {
      const ids = after.movements.filter((m) => bad.includes(m.period)).map((m) => m.id);
      return { ok: false, detail: { rule: "keys_in_calendar", ids, period: bad[0] } };
    }
  }
  // (iv)
  const badIds = after.movements.filter((m) => m.date && !isValidMovementPeriod(cal, m)).map((m) => m.id);
  if (badIds.length > 0) return { ok: false, detail: { rule: "period_matches_date", ids: badIds } };
  // (v) piso de reservas por periodo
  const reserveLeaves = new Set<string>();
  for (const mv of after.movements) if (mv.type === "transfer") { if (mv.from && !isAvailable(mv.from)) reserveLeaves.add(mv.from); if (mv.to && !isAvailable(mv.to)) reserveLeaves.add(mv.to); }
  for (const n of after.nodes) if (n.type === "transfer" && (after.actuals[n.id] || after.budgets[n.id])) reserveLeaves.add(n.id);
  if (reserveLeaves.size > 0 && keysUsed.size > 0) {
    const sorted = [...keysUsed].sort(comparePeriods);
    const periods = cal.keys(monthOf(sorted[0]!), monthOf(sorted[sorted.length - 1]!));
    for (const leaf of reserveLeaves) {
      for (const p of periods) {
        if (resolvedBalance(after, leaf, p, "actual", periods) < 0) return { ok: false, detail: { rule: "reserve_floor", leafId: leaf, period: p } };
      }
    }
  }
  return { ok: true };
}

// ── Versiones (FR-2401, FR-2408, FR-2410) ───────────────────────────────────────────────────────

export type CycleTarget =
  | { mode: "month" }
  | { mode: "cycle"; anchorDay: number; eomPolicy: EndOfMonthPolicy; firstPayDate?: string };

export type PlanResult =
  | { cfg: CycleConfig; version: CycleVersion; change: "activate" | "version" | "deactivate"; lastPay: string | null }
  | { blocked: "first_pay_required" | "first_pay_invalid" | "no_change"; detail?: { lastPay?: string } };

/** El último pago bajo la versión vigente estrictamente anterior a `before` (definición del TRD). */
export function lastPayBefore(current: CycleVersion, before: string, bounds: { from: PeriodKey; to: PeriodKey }): string | null {
  const months = periodRange(addMonths(monthOf(bounds.from), -2), addMonths(monthOf(bounds.to), 2));
  let last: string | null = null;
  for (const m of months) {
    const d = anchorDateOf(m, current.anchorDay as number, current.eomPolicy as EndOfMonthPolicy);
    if (current.firstPay !== null && d < current.firstPay) continue;
    if (d < before && (last === null || d > last)) last = d;
  }
  return last;
}

/**
 * Planifica un cambio de configuración (FR-2401 activar, FR-2408 cambiar el día, FR-2410 volver).
 * No escribe: devuelve la configuración con la versión añadida, o el bloqueo.
 *
 * @aitri-trace FR-ID: FR-2408, US-ID: US-2408, AC-ID: AC-2427, TC-ID: TC-CIC-075f, TC-CIC-078f, TC-CIC-151e
 * @aitri-trace FR-ID: FR-2401, US-ID: US-2401, AC-ID: AC-2402, TC-ID: TC-CIC-002h
 */
export function planVersionChange(
  cfg: CycleConfig, target: CycleTarget, ctx: { todayISO: string; closedEnd: string | null; restoreStartMonth: PeriodKey | null; bounds: { from: PeriodKey; to: PeriodKey } }
): PlanResult {
  const current = normalizeCycleConfig(cfg);
  const seq = (current.versions[current.versions.length - 1]?.seq ?? 0) + 1;
  const createdAt = `${ctx.todayISO}T00:00:00.000Z`;
  if (target.mode === "month") {
    if (current.mode === "month") return { blocked: "no_change" };
    const version: CycleVersion = { seq, mode: "month", anchorDay: null, eomPolicy: null, effectiveFrom: ctx.todayISO, firstPay: null, restoreStartMonth: null, createdAt };
    return { cfg: { mode: "month", versions: [...current.versions, version] }, version, change: "deactivate", lastPay: null };
  }
  if (!isAnchorDay(target.anchorDay) || !isEomPolicy(target.eomPolicy)) return { blocked: "first_pay_invalid" };
  if (current.mode === "month") {
    const version: CycleVersion = {
      seq, mode: "cycle", anchorDay: target.anchorDay, eomPolicy: target.eomPolicy, effectiveFrom: ctx.todayISO,
      firstPay: null, restoreStartMonth: ctx.restoreStartMonth, createdAt,
    };
    return { cfg: { mode: "cycle", versions: [...current.versions, version] }, version, change: "activate", lastPay: null };
  }
  const vigente = activeCycleVersions(current)[activeCycleVersions(current).length - 1]!;
  if (vigente.anchorDay === target.anchorDay && vigente.eomPolicy === target.eomPolicy) return { blocked: "no_change" };
  if (!target.firstPayDate) return { blocked: "first_pay_required" };
  if (!isIsoDate(target.firstPayDate)) return { blocked: "first_pay_invalid" };
  const lastPay = lastPayBefore(vigente, target.firstPayDate, ctx.bounds);
  // Para el mensaje: el último pago que YA OCURRIÓ (≤ hoy), que es el que el usuario reconoce.
  const lastPaid = lastPayBefore(vigente, addDays(ctx.todayISO, 1), ctx.bounds) ?? lastPay ?? undefined;
  if (lastPay === null) return { blocked: "first_pay_invalid", detail: lastPaid ? { lastPay: lastPaid } : undefined };
  // El primer pago tiene que ser una fecha de pago del día nuevo: el ancla de su mes (o la del
  // mes anterior desplazada al día 1, con «shift»).
  const m = periodOf(Number(target.firstPayDate.slice(0, 4)), Number(target.firstPayDate.slice(5, 7)));
  const esAncla = anchorDateOf(m, target.anchorDay, target.eomPolicy) === target.firstPayDate
    || anchorDateOf(addMonths(m, -1), target.anchorDay, target.eomPolicy) === target.firstPayDate;
  if (!esAncla) return { blocked: "first_pay_invalid", detail: { lastPay: lastPaid ?? lastPay } };
  if (ctx.closedEnd !== null && target.firstPayDate <= ctx.closedEnd) return { blocked: "first_pay_invalid", detail: { lastPay: lastPaid ?? lastPay } };
  const version: CycleVersion = {
    seq, mode: "cycle", anchorDay: target.anchorDay, eomPolicy: target.eomPolicy, effectiveFrom: target.firstPayDate,
    firstPay: target.firstPayDate, restoreStartMonth: vigente.restoreStartMonth, createdAt,
  };
  return { cfg: { mode: "cycle", versions: [...current.versions, version] }, version, change: "version", lastPay };
}

/** La versión de activación vigente (la última «cycle» con `firstPay` null), para la vuelta a mes. */
export function activationVersion(cfg: CycleConfig): CycleVersion | null {
  const vs = activeCycleVersions(normalizeCycleConfig(cfg));
  return vs.length > 0 ? vs[0]! : null;
}

/** Los `n` ciclos desde el que contiene hoy, para la previsualización (FR-2403). */
export function upcomingCycles(cal: Calendar, todayISO: string, n = PREVIEW_CYCLES): Array<CycleEntry & { label: string; current: boolean }> {
  if (cal.mode !== "cycle") {
    const p = periodFromDate(todayISO) ?? todayISO.slice(0, 7);
    return periodRange(p, addMonths(p, n - 1)).map((k, i) => ({ key: k, start: `${k}-01`, end: dateOf(k, daysInMonth(k)), transition: false, label: k, current: i === 0 }));
  }
  const all = cal.entries();
  const i = all.findIndex((e) => e.start <= todayISO && todayISO <= e.end);
  const from = i < 0 ? 0 : i;
  return all.slice(from, from + n).map((e, j) => ({ ...e, label: e.key, current: j === 0 && i >= 0 }));
}

/** Cotas de mes generosas para construir un calendario alrededor de un estado. */
export function boundsFor(state: LedgerState, todayISO: string, horizonYears = 2): { from: PeriodKey; to: PeriodKey } {
  const today = periodFromDate(todayISO) ?? todayISO.slice(0, 7);
  const declared = normalizeStartMonth(state.startMonth);
  const oldest = oldestKey(state);
  let from = today;
  for (const c of [declared, oldest]) if (c && comparePeriods(monthOf(c), from) < 0) from = monthOf(c);
  const to = periodOf(periodYear(today) + horizonYears, 12);
  return { from: addMonths(from, -1), to };
}
export { isCycleKey };
