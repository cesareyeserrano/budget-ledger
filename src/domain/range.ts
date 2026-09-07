// @aitri-trace domain:range — FR-1906: qué periodos existen para el usuario.
//
// Módulo:       src/domain/range.ts
// Propósito:    Derivar el RANGO ACTIVO de periodos: del más antiguo con datos hasta el fin del
//               horizonte. Es la lista que reciben `computeBalanceSeries` y `reserve.ts`, y la que
//               la grilla pinta como columnas — UNA sola lista para las tres cosas, que es lo que
//               garantiza que la columna que el usuario ve sea la que el techo evalúa.
// Dependencias: ./types, ./periods.
//
// PURO Y SIN RELOJ (ADR-02): `currentPeriod` es un PARÁMETRO. El reloj vive en `src/lib/date.ts`.

import type { LedgerState, PeriodKey } from "./types";
import { comparePeriods, isPeriodKey, periodOf, periodRange, periodYear } from "./periods";
import { normalizeClosure } from "./closure";
import { normalizeStartMonth } from "./opening";

/**
 * Los dos horizontes que el usuario puede elegir, en AÑOS COMPLETOS (FR-1904). No hay más.
 *
 * Eran 12 y 24 MESES, y eso partía el último año por la mitad: desde septiembre de 2026, veinticuatro
 * meses terminan en agosto de 2028 y la grilla mostraba 2028 a medias sin ninguna razón. Decisión
 * del usuario (2026-09-02): «más que 24 meses la regla es dos años».
 *
 * Consecuencia aceptada: la ventana rueda una vez al AÑO, no cada mes. Con «2 años» el último
 * periodo se queda en diciembre de 2028 hasta que entre 2027 — la vista es más estable, pero deja
 * de avanzar mensualmente.
 */
export const HORIZONS = [1, 2] as const;
export type Horizon = (typeof HORIZONS)[number];

/** El horizonte por defecto cuando no hay preferencia guardada o la guardada es inválida. */
export const DEFAULT_HORIZON: Horizon = 2;

/** Normaliza un valor cualquiera a un horizonte válido. Nunca lanza; nunca devuelve otra cosa. */
export function normalizeHorizon(v: unknown): Horizon {
  return (HORIZONS as readonly number[]).includes(v as number) ? (v as Horizon) : DEFAULT_HORIZON;
}

/**
 * El periodo más antiguo con DATOS del usuario, o `null` si no tiene ninguno.
 *
 * Cuentan las cuatro fuentes, no solo los montos: un presupuesto, un ejecutado, un movimiento y una
 * observación de celda. La observación cuenta a propósito — es texto que el usuario escribió, y
 * dejarla fuera del rango sería perderla de vista.
 *
 * Las claves basura (de un estado corrupto o de un formato viejo) se IGNORAN: el rango nunca puede
 * empezar en un periodo inválido, porque toda la aritmética posterior lo daría por bueno.
 *
 * @aitri-trace FR-ID: FR-1906, US-ID: US-1906, AC-ID: AC-1916, TC-ID: TC-MAN-053e, TC-MAN-054f
 */
export function oldestPeriodWithData(state: LedgerState): PeriodKey | null {
  let oldest: PeriodKey | null = null;
  const consider = (p: string) => {
    if (!isPeriodKey(p)) return;
    if (oldest === null || comparePeriods(p, oldest) < 0) oldest = p;
  };
  for (const map of [state.budgets, state.actuals]) {
    for (const cells of Object.values(map ?? {})) {
      for (const [p, v] of Object.entries(cells ?? {})) if ((v ?? 0) !== 0) consider(p);
    }
  }
  for (const mv of state.movements ?? []) consider(mv.period);
  for (const byPeriod of Object.values(state.cellNotes ?? {})) {
    for (const [p, notes] of Object.entries(byPeriod ?? {})) if ((notes?.length ?? 0) > 0) consider(p);
  }
  return oldest;
}

/**
 * El rango activo: del periodo más antiguo con datos (o el actual, si no hay ninguno) hasta el fin
 * del horizonte rodante.
 *
 * El horizonte se cuenta en AÑOS COMPLETOS: con 2 y hoy en "2026-09", el último periodo es
 * "2028-12" — no "2028-08". Rueda al cambiar de AÑO, no de mes (FR-1904).
 *
 * Si el usuario tiene datos MÁS ALLÁ del horizonte, el rango los incluye igual: el horizonte
 * decide cuánto futuro VACÍO se ofrece para planear, nunca recorta lo que ya existe. Un dato fuera
 * del rango sería un dato que el arrastre no encadena y que el usuario no puede ver ni corregir.
 *
 * Y por el MISMO argumento hacia atrás (ADR-14): el rango llega hasta la frontera del cierre aunque
 * ese periodo esté vacío. Un mes cerrado fuera del rango es un mes que el usuario no puede ver ni
 * —tras reabrirlo— corregir.
 *
 * @aitri-trace FR-ID: FR-1904, US-ID: US-1904, AC-ID: AC-1910, TC-ID: TC-MAN-030h, TC-MAN-050h
 */
export function activeRange(
  state: LedgerState,
  currentPeriod: PeriodKey,
  horizon: Horizon = DEFAULT_HORIZON
): PeriodKey[] {
  if (!isPeriodKey(currentPeriod)) return [];
  const h = normalizeHorizon(horizon);
  const oldest = oldestPeriodWithData(state);
  // La FRONTERA DEL CIERRE ancla igual que un dato (ADR-14, arreglo de BG-001). Un mes que el
  // usuario CERRÓ es un periodo que existe, tenga cifras o no: si se queda fuera del rango, reabrirlo
  // no devuelve ninguna celda y la única acción que la app ofrece para corregir el pasado no produce
  // efecto visible. Es la misma regla que este módulo ya aplica al otro extremo con `newest`.
  //
  // Se normaliza ANTES de anclar: una frontera basura no puede fijar el inicio del rango, porque
  // toda la aritmética posterior la daría por buena.
  const boundary = normalizeClosure(state.closure).closedThrough;

  // El MES DE INICIO declarado es el TERCER ancla (FR-2201, ADR-04 del TRD). Se AÑADE a los dos
  // existentes, no los sustituye (NFR-2203): fija el SUELO del historial, y un dato o una frontera
  // anteriores lo extienden igualmente hacia atrás.
  //
  // Por qué suelo y no recorte: recortar cumpliría al pie de la letra «no se muestran meses
  // anteriores», pero un dato previo quedaría invisible E INCORREGIBLE — el mismo argumento con el
  // que ADR-14 hizo anclar la frontera del cierre. Ese estado es además inalcanzable desde la
  // interfaz, porque FR-2206 bloquea el movimiento que lo crearía; así que la opción elegida solo
  // se comporta distinto en un estado que no debería existir, y ahí falla del lado seguro.
  //
  // Sin mes declarado, `declared` es null y la expresión se reduce TÉRMINO A TÉRMINO a la anterior.
  const declared = normalizeStartMonth(state.startMonth);
  const base = declared ?? currentPeriod;
  const anchors = [oldest, boundary].filter(
    (p): p is PeriodKey => !!p && comparePeriods(p, base) < 0
  );
  const from = anchors.length > 0
    ? anchors.reduce((a, b) => (comparePeriods(a, b) <= 0 ? a : b))
    : base;

  // Hasta DICIEMBRE del último año del horizonte: años completos, no una cuenta de meses.
  const horizonEnd = periodOf(periodYear(currentPeriod) + h, 12);
  // Lo que ya existe manda sobre la ventana: si hay un dato en 2030 y el horizonte llega a 2028,
  // el rango llega a 2030. El horizonte ofrece futuro vacío; no esconde pasado ni futuro escrito.
  const newest = newestPeriodWithData(state);
  const to = newest && comparePeriods(newest, horizonEnd) > 0 ? newest : horizonEnd;

  return periodRange(from, to);
}

/** El periodo más RECIENTE con datos, o `null`. Simétrico de `oldestPeriodWithData`. */
export function newestPeriodWithData(state: LedgerState): PeriodKey | null {
  let newest: PeriodKey | null = null;
  const consider = (p: string) => {
    if (!isPeriodKey(p)) return;
    if (newest === null || comparePeriods(p, newest) > 0) newest = p;
  };
  for (const map of [state.budgets, state.actuals]) {
    for (const cells of Object.values(map ?? {})) {
      for (const [p, v] of Object.entries(cells ?? {})) if ((v ?? 0) !== 0) consider(p);
    }
  }
  for (const mv of state.movements ?? []) consider(mv.period);
  for (const byPeriod of Object.values(state.cellNotes ?? {})) {
    for (const [p, notes] of Object.entries(byPeriod ?? {})) if ((notes?.length ?? 0) > 0) consider(p);
  }
  return newest;
}
