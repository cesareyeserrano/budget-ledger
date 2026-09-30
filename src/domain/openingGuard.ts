// @aitri-trace domain:openingGuard — FR-2205 (BG-065): la apertura no puede mover la cifra de un mes cerrado.
//
// Módulo:       src/domain/openingGuard.ts
// Propósito:    Decidir si declarar o cambiar la apertura (mes de inicio + saldo inicial) toca un mes
//               cerrado. La usan el servidor, que es la autoridad (NFR-2205), y Configuración, que
//               bloquea el campo antes de dejar teclear. Una sola derivación para las dos, o la
//               pantalla dejaría editar lo que el servidor rechaza.
// Dependencias: ./types, ./periods, ./closure, ./opening, ./range.
// Desde BG-085 también decide qué datos deja fuera un cambio de inicio (FR-2206).
//
// POR QUÉ UN MÓDULO APARTE: la regla necesita a la vez `isClosed` (closure), `normalizeStartMonth`
// (opening) y `oldestPeriodWithData` (range), y `range` ya importa a los otros dos. Ponerla en
// cualquiera de ellos cerraría un ciclo de imports.
//
// PURO Y SIN RELOJ (ADR-02).

import type { Closure, LedgerState, PeriodKey } from "./types";
import { comparePeriods, isPeriodKey } from "./periods";
import { isClosed } from "./closure";
import { normalizeStartMonth, orphanedByStart } from "./opening";
import { oldestPeriodWithData } from "./range";

/**
 * El mes donde la apertura está HOY: el declarado o, si no hay ninguno, el primero con datos.
 *
 * Sin mes declarado la serie arranca en el dato más antiguo con arrastre cero (FR-2201, «se comporta
 * exactamente como hoy»). Declarar por primera vez pone una apertura ahí, así que para el cierre ese
 * mes ES el inicio vigente, aunque nadie lo haya declarado.
 *
 * @param state El estado del ledger, con `startMonth` si lo hay.
 * @returns El mes de inicio efectivo, o `null` si no hay declaración ni datos.
 * @throws Nunca.
 */
export function effectiveStartMonth(state: LedgerState): PeriodKey | null {
  return normalizeStartMonth(state.startMonth) ?? oldestPeriodWithData(state);
}

/**
 * BG-065 — el mes CERRADO que impide llevar la apertura a `candidate`, o `null` si nada lo impide.
 *
 * Cambiar la apertura recalcula la serie desde el mes donde se aplica (FR-2205). Por eso importan
 * los dos extremos:
 *   - el inicio VIGENTE, porque de él cuelgan hoy las cifras. Antes solo se miraba el declarado, y
 *     sin declaración la regla no corría: con meses cerrados, declarar por primera vez movía sus
 *     saldos.
 *   - el inicio PROPUESTO, porque ahí empezará a contar. Con datos anteriores al inicio (FR-1906)
 *     esos meses pueden estar cerrados, y mover el inicio hacia uno de ellos también movería sus
 *     saldos.
 * El cierre es un prefijo (todo hasta `closedThrough`), así que si ninguno de los dos extremos está
 * cerrado, ningún mes cerrado queda afectado: los anteriores al inicio son historia (BG-054).
 *
 * Se juzga aunque el monto no cambie: es la misma disciplina que ya se aplicaba al mes declarado, y
 * la vía para cambiarlo es la de siempre, reabrir el mes.
 *
 * @param state     El estado del ledger, con `startMonth` si lo hay.
 * @param closure   El cierre vigente (el del servidor, nunca el que afirme la petición).
 * @param candidate El mes de inicio propuesto.
 * @returns El vigente si está cerrado; si no, el propuesto si está cerrado; si no, `null`.
 * @throws Nunca.
 */
export function closedStartBlocker(
  state: LedgerState,
  closure: Closure | undefined,
  candidate: PeriodKey
): PeriodKey | null {
  const vigente = effectiveStartMonth(state);
  if (vigente !== null && isClosed(closure, vigente)) return vigente;
  if (isPeriodKey(candidate) && isClosed(closure, candidate)) return candidate;
  return null;
}

/**
 * BG-085 — los meses con datos que llevar el inicio a `candidate` SACARÍA del historial (FR-2206).
 *
 * `orphanedByStart` cuenta todo dato anterior a `candidate`. Eso incluye los que ya estaban antes
 * del inicio vigente: FR-1906 deja registrar ahí y BG-054 los muestra como historia. Con uno solo,
 * el saldo inicial dejaba de poder editarse aunque el mes no se moviera, porque volver a guardar el
 * mismo inicio «huerfanaba» un dato que ya estaba fuera. FR-2206 habla de lo que el MOVIMIENTO deja
 * fuera, así que aquí solo cuentan los datos desde el inicio vigente.
 *
 * Sin mes declarado el inicio efectivo es el primer mes con datos, así que el filtro no quita nada
 * y el resultado es el de siempre.
 *
 * @param state     El estado del ledger, con `startMonth` si lo hay.
 * @param candidate El mes de inicio propuesto.
 * @returns Los periodos con datos entre el inicio vigente (incluido) y `candidate` (excluido), en
 *   orden ascendente. Vacío ⇒ el cambio no deja nada fuera.
 * @throws Nunca.
 */
export function newlyOrphanedByStart(state: LedgerState, candidate: PeriodKey): PeriodKey[] {
  const vigente = effectiveStartMonth(state);
  const antes = orphanedByStart(state, candidate);
  return vigente === null ? antes : antes.filter((p) => comparePeriods(p, vigente) >= 0);
}
