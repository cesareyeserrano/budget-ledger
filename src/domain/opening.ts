// @aitri-trace domain:opening — FR-2201/FR-2202/FR-2206: la apertura declarada del historial.
//
// Módulo:       src/domain/opening.ts
// Propósito:    Derivar el MES DE INICIO y el SALDO INICIAL que el usuario declara, y decidir
//               cuándo esa apertura entra en una serie de saldos. Es la ÚNICA derivación de la
//               apertura del proyecto (ADR-03 del TRD): la consumen tanto el Balance como
//               `closingCarry` de `closure.ts`, y dos derivaciones se separarían.
// Dependencias: ./types, ./periods, ./balance (ZERO_CARRY).
//
// POR QUÉ UNA SOLA DERIVACIÓN. `computeBalanceSeries(state, periods, opening)` acepta la apertura
// desde FR-2010, pero tiene VARIOS llamadores que arrancan una serie en la cabeza del rango: la UI
// del Balance y `closingCarry`, que es lo que el cierre FOTOGRAFÍA al reabrir un mes. Si cada uno
// calculara su apertura por su cuenta, el saldo que el cierre guarda dejaría de ser el que el
// Balance muestra — y lo haría EN SILENCIO, porque las dos cifras seguirían siendo coherentes
// consigo mismas. Es FLAG-1 del TRD, y por eso la apertura se deriva aquí y en ningún otro sitio.
//
// PURO Y SIN RELOJ (ADR-02): ninguna función de este módulo lee la fecha.

import type { Carry, LedgerState, PeriodKey } from "./types";
import { comparePeriods, isPeriodKey } from "./periods";
import { ZERO_CARRY } from "./balance";

/**
 * El mes de inicio declarado de un estado, o `null` si no hay ninguno válido.
 *
 * Tolerante a basura por el mismo motivo que `oldestPeriodWithData` ignora las claves inválidas:
 * el rango NUNCA puede empezar en un periodo mal formado, porque toda la aritmética posterior lo
 * daría por bueno. Un valor corrupto se comporta como «no declarado», que es el estado seguro.
 *
 * @param v Cualquier valor — típicamente `state.startMonth`, que puede venir de la base o de la red.
 * @returns El `PeriodKey` si es válido; `null` en cualquier otro caso.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2201, US-ID: US-2201, AC-ID: AC-2202, TC-ID: TC-MSI-002f
 */
export function normalizeStartMonth(v: unknown): PeriodKey | null {
  return isPeriodKey(v) ? v : null;
}

/**
 * El saldo inicial declarado, ya normalizado, o `null` si no hay ninguno utilizable.
 *
 * Rechaza negativos y no finitos en vez de propagarlos: un `NaN` que entrara aquí contaminaría
 * TODA la serie hacia adelante, porque el arrastre encadena mes a mes. El borde HTTP ya los
 * rechaza (`startPutSchema`) y la columna lleva su `CHECK`; esto es la tercera defensa, la que
 * actúa si un estado corrupto llega igualmente al dominio.
 *
 * @param v Típicamente `state.openingBalance`.
 * @returns Un entero ≥ 0, o `null`.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2202, US-ID: US-2202, AC-ID: AC-2204, TC-ID: TC-MSI-014f
 */
export function normalizeOpeningBalance(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

/**
 * La apertura con la que debe abrir una serie de saldos.
 *
 * Devuelve el carry declarado **si y solo si** la serie arranca EXACTAMENTE en el mes de inicio.
 * En cualquier otro caso devuelve `ZERO_CARRY`, que es el comportamiento de hoy.
 *
 * Esa guarda es deliberada (riesgo R2 del TRD). `computeBalanceSeries` solo sabe abrir en
 * `periods[0]`, así que si el rango empezara en un mes anterior al declarado —posible únicamente
 * con un dato previo que FR-2206 impide crear desde la interfaz— aplicar ahí la apertura la
 * pondría en el mes equivocado. Ante la duda se degrada a «como hoy», nunca a una cifra inventada.
 *
 * El `reservedBalance` es siempre 0: el saldo inicial es UN número y las alcancías arrancan vacías
 * (decisión del usuario, 2026-09-01). Quien ya tuviera dinero apartado lo declara dentro del total
 * y lo reserva después — las reservas salen de DISPONIBLE, no del resultado del mes.
 *
 * @param state  El estado del ledger.
 * @param periods La lista de periodos de la serie, en orden ascendente.
 * @returns El carry declarado, o `ZERO_CARRY`.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2202, US-ID: US-2202, AC-ID: AC-2204, TC-ID: TC-MSI-010h, TC-MSI-016e
 */
export function openingCarry(state: LedgerState, periods: readonly PeriodKey[]): Carry {
  const start = normalizeStartMonth(state.startMonth);
  if (start === null || periods.length === 0) return ZERO_CARRY;
  if (periods[0] !== start) return ZERO_CARRY;
  const amount = normalizeOpeningBalance(state.openingBalance);
  if (amount === null) return ZERO_CARRY;
  return { available: amount, reservedBalance: 0 };
}

/**
 * Los periodos CON DATOS que quedarían fuera del historial si el mes de inicio se moviera a
 * `candidate`. Lista vacía ⇒ el movimiento es legal (FR-2206).
 *
 * Cuentan las MISMAS CUATRO FUENTES que `oldestPeriodWithData`: un presupuesto, un ejecutado, un
 * movimiento y una observación de celda. Que coincidan no es economía de código: si divergieran,
 * un mes con solo una observación sería visible para el rango e invisible para el bloqueo, y se
 * perdería en silencio — que es exactamente lo que este requisito existe para impedir.
 *
 * Mover el inicio hacia ATRÁS nunca produce huérfanos: solo amplía la historia. Esta función lo
 * refleja sin caso especial, porque no habrá ningún periodo anterior al candidato.
 *
 * @param state     El estado del ledger.
 * @param candidate El mes de inicio propuesto.
 * @returns Los periodos con datos anteriores a `candidate`, en orden ascendente y sin repetir.
 * @throws Nunca. Un `candidate` inválido devuelve `[]` (no hay nada que proteger de un mes que no existe).
 *
 * @aitri-trace FR-ID: FR-2206, US-ID: US-2206, AC-ID: AC-2216, TC-ID: TC-MSI-050f, TC-MSI-055e
 */
export function orphanedByStart(state: LedgerState, candidate: PeriodKey): PeriodKey[] {
  if (!isPeriodKey(candidate)) return [];
  const out = new Set<PeriodKey>();
  const consider = (p: string) => {
    if (!isPeriodKey(p)) return;
    if (comparePeriods(p, candidate) < 0) out.add(p);
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
  return [...out].sort(comparePeriods);
}
