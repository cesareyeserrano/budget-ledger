// @aitri-trace domain:adjust — feature diario-de-celda (FR-2503, FR-2504): la fecha que se propone
// y el AJUSTE que nace de teclear un total en la celda.
//
// Módulo:       src/domain/adjust.ts
// Propósito:    Dominio puro. `proposedDate`/`isDateInPeriod` deciden qué fecha ofrece y acepta una
//               celda; `adjustCell` convierte «tecleé 120.000» en un movimiento por la DIFERENCIA
//               con lo que ya suman sus movimientos. Nada aquí escribe ni conoce la UI.
// Dependencias: ./types, ./periods, ./tree, ./detail (movementSum), ./cycles (Calendar).

import type { Calendar } from "./cycles";
import { monthOf } from "./periods";
import type { LedgerState, Movement, PeriodKey } from "./types";
import { findNode, isLeaf } from "./tree";
import { movementSum } from "./detail";
import { uid, nextSeq } from "./ids";

/**
 * Copia del estado con lo que esta función MUTA clonado en profundidad.
 *
 * Mismo criterio que el `clone` de `mutations.ts` (que es privado de ese módulo): se propaga el
 * estado con spread —así un campo nuevo viaja solo, sin que nadie tenga que acordarse de añadirlo—
 * y se clonan en profundidad las partes que se tocan. `adjust` escribe en `actuals` y en
 * `movements`; el resto viaja por referencia a propósito, porque no se modifica.
 */
function clone(state: LedgerState): LedgerState {
  return {
    ...state,
    actuals: structuredClone(state.actuals),
    movements: state.movements.map((m) => ({ ...m })),
  };
}

/** Nota con la que nace un ajuste — el usuario la ve en el Detalle y puede cambiarla luego. */
export const AJUSTE_NOTE = "Ajuste manual";

/** La hora que se le pone a una fecha propuesta que NO es «ahora»: mediodía, lejos de los bordes. */
const MEDIODIA = "T12:00";

/** «YYYY-MM-DDTHH:mm» a partir de un Date, en hora LOCAL (la que el usuario ve en su reloj). */
function isoMinute(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** El último día del mes de una clave («2026-02» → «2026-02-28»), sin depender de la zona horaria. */
function lastDayOfMonth(period: PeriodKey): string {
  const m = monthOf(period);
  const year = Number(m.slice(0, 4));
  const month = Number(m.slice(5, 7));
  const dias = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${m}-${String(dias).padStart(2, "0")}`;
}

/** El rango de fechas de un periodo: el del ciclo, o el mes completo en modo mes a mes. */
function rangeOfPeriod(cal: Calendar, period: PeriodKey): { start: string; end: string } {
  const r = cal.rangeOf(period);
  if (r) return r;
  const m = monthOf(period);
  return { start: `${m}-01`, end: lastDayOfMonth(period) };
}

/**
 * La fecha que la celda propone para un movimiento nuevo (FR-2503).
 *
 * Es HOY cuando hoy cae dentro del mes o ciclo de esa celda — el caso normal, y por eso el botón
 * dice «Hoy». Si no cae (se está editando un periodo pasado o futuro), propone su ÚLTIMO día a las
 * 12:00: una fecha real dentro del periodo, lejos de los bordes de medianoche.
 *
 * @param cal Calendario del dueño (mes a mes o ciclos).
 * @param period Periodo de la celda.
 * @param now El reloj, inyectado: el dominio nunca lo pregunta por su cuenta (ADR-02 del TRD raíz).
 * @returns Fecha «YYYY-MM-DDTHH:mm» siempre dentro del periodo.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2503, US-ID: US-2503, AC-ID: AC-2503a, TC-ID: TC-DDC-041h, TC-DDC-043e, TC-DDC-045e
 */
export function proposedDate(cal: Calendar, period: PeriodKey, now: Date): string {
  const hoy = isoMinute(now);
  return isDateInPeriod(cal, period, hoy) ? hoy : `${rangeOfPeriod(cal, period).end}${MEDIODIA}`;
}

/**
 * ¿Esa fecha pertenece al mes o ciclo de la celda? (FR-2503)
 *
 * Compara solo el DÍA: las horas no deciden a qué ciclo pertenece un movimiento, y comparar la
 * cadena completa haría que «2026-09-20T23:59» cayera fuera de un ciclo que termina el 20.
 *
 * @throws Nunca — una fecha con forma inválida devuelve `false`.
 *
 * @aitri-trace FR-ID: FR-2503, US-ID: US-2503, AC-ID: AC-2503b, TC-ID: TC-DDC-045e, TC-DDC-048f
 */
export function isDateInPeriod(cal: Calendar, period: PeriodKey, date: string): boolean {
  const day = typeof date === "string" ? date.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const { start, end } = rangeOfPeriod(cal, period);
  return start <= day && day <= end;
}

/** Lo que `adjustCell` devuelve: el estado nuevo y el ajuste creado (o `null` si no hizo falta). */
export type AdjustResult =
  | { state: LedgerState; created: Movement | null }
  | { rejected: "not_leaf" | "transfer" | "invalid_value" };

/**
 * Teclear un total en la celda de Ejecutado: crea un AJUSTE por la diferencia (FR-2504).
 *
 * La celda queda exactamente en el valor tecleado, y el movimiento nuevo es la diferencia con lo
 * que ya suman sus movimientos. Si el valor YA coincide con esa suma no se crea nada: la celda
 * estaba cuadrada (o se acaba de cuadrar tecleando la suma de sus movimientos, TC-DDC-076e).
 *
 * El ajuste es el ÚNICO movimiento que admite monto negativo, y solo en gasto o ingreso: es lo que
 * permite bajar una celda sin borrar movimientos reales. La celda nunca queda por debajo de 0
 * porque el valor se acota antes de entrar.
 *
 * @param state Estado del ledger.
 * @param leafId Hoja de la celda.
 * @param period Periodo de la celda.
 * @param value Total tecleado (entero ≥ 0; se acota).
 * @param date Fecha del ajuste — normalmente `proposedDate(...)`.
 * @param periods Rango activo.
 * @returns El estado nuevo y el ajuste creado, o el motivo del rechazo.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2504, US-ID: US-2504, AC-ID: AC-2504a, TC-ID: TC-DDC-061h, TC-DDC-063e, TC-DDC-065e, TC-DDC-066e
 */
export function adjustCell(
  state: LedgerState, leafId: string, period: PeriodKey, value: number, date: string, periods: readonly PeriodKey[]
): AdjustResult {
  const node = findNode(state.nodes, leafId);
  if (!node || !isLeaf(node, state.nodes)) return { rejected: "not_leaf" };
  if (node.type === "transfer") return { rejected: "transfer" }; // los bolsillos tienen su regla (NFR-2503)
  if (!Number.isFinite(value) || !periods.includes(period)) return { rejected: "invalid_value" };

  const objetivo = Math.max(0, Math.round(value));
  const suma = movementSum(state, leafId, period);
  const diff = objetivo - suma;

  const next = clone(state);
  next.actuals[leafId] = { ...(next.actuals[leafId] ?? {}) };
  next.actuals[leafId][period] = objetivo;

  // diff = 0 — la celda ya vale lo tecleado: no se fabrica un movimiento de cero. Es el caso que
  // CUADRA una celda descuadrada tecleando la suma de sus movimientos (AC-2511b).
  if (diff === 0) return { state: next, created: null };

  const created: Movement = {
    id: uid(), ownerId: state.ownerId, type: node.type,
    catId: node.parentId && node.level === "sub" ? node.parentId : leafId,
    subId: node.level === "sub" ? leafId : null,
    target: leafId,
    amount: diff, period, createdAt: nextSeq(),
    date, note: AJUSTE_NOTE, kind: "adjustment",
  };
  next.movements = [created, ...next.movements];
  return { state: next, created };
}
