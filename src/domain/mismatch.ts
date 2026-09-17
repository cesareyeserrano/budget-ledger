// @aitri-trace domain:mismatch — feature diario-de-celda (NFR-2502, FR-2511, FR-2512).
//
// Módulo:       src/domain/mismatch.ts
// Propósito:    El CUADRE de una celda: si su valor coincide con lo que suman sus movimientos, qué
//               celdas no cuadran y cuáles de ellas impiden cerrar un periodo. Selector puro — no
//               escribe, no conoce la UI y no lanza.
// Dependencias: ./types, ./tree. NINGUNA más, y eso es deliberado.
//
// POR QUÉ UN MÓDULO PROPIO. Vivía en `detail.ts`, por cohesión: son la misma idea vista desde la
// celda. Pero `detail` importa de `reserve` (las observaciones de bolsillo), y desde FR-2511
// `reserve` necesita los descuadres para componer los problemas del mes — eso cerraba un ciclo de
// imports. Sacarlo a una HOJA del grafo lo rompe por construcción: los dos lados pueden importarlo
// y él no importa a nadie. Los consumidores no cambian: todos entran por el barril `@/domain`.

import type { LedgerState, PeriodKey } from "./types";
import { findNode, isLeaf } from "./tree";
// SOLO EL TIPO, y la dirección importa: `reserve` no importa este módulo (TC-TRF4-154e fija su lista
// de imports), así que esta flecha no cierra ningún ciclo.
import type { MonthIssue } from "./reserve";

type PeriodScope = readonly PeriodKey[];

/** Una celda descuadrada: lo que GUARDA y lo que suman sus movimientos. */
export interface CellMismatch {
  nodeId: string;
  name: string;
  period: PeriodKey;
  cell: number;
  sum: number;
}

/**
 * Las celdas DESCUADRADAS: su valor no coincide con la suma de sus movimientos (FR-2511).
 *
 * Solo hojas de gasto e ingreso, y solo el plano Ejecutado: los bolsillos y el Presupuestado nunca
 * están descuadrados por definición. Una pasada sobre los movimientos y otra sobre las celdas — no
 * un recorrido por celda, que sería cuadrático sobre el estado de producción.
 *
 * @returns Una entrada por celda descuadrada, con el valor guardado y lo que suman sus movimientos.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2511, US-ID: US-2511, AC-ID: AC-2511a, TC-ID: TC-DDC-067e, TC-DDC-191h, TC-DDC-200e
 */
export function cellMismatches(state: LedgerState, periods: PeriodScope): CellMismatch[] {
  const enRango = new Set(periods);
  const sumas = new Map<string, number>();
  for (const m of state.movements) {
    if (m.type === "transfer" || !enRango.has(m.period)) continue;
    const k = `${m.target} ${m.period}`;
    sumas.set(k, (sumas.get(k) ?? 0) + m.amount);
  }

  const out: CellMismatch[] = [];
  const vistos = new Set<string>();
  for (const [nodeId, meses] of Object.entries(state.actuals)) {
    const node = findNode(state.nodes, nodeId);
    if (!node || node.type === "transfer" || !isLeaf(node, state.nodes)) continue;
    for (const [period, cell] of Object.entries(meses)) {
      if (!enRango.has(period as PeriodKey)) continue;
      const k = `${nodeId} ${period}`;
      vistos.add(k);
      const sum = sumas.get(k) ?? 0;
      if ((cell ?? 0) !== sum) out.push({ nodeId, name: node.name, period: period as PeriodKey, cell: cell ?? 0, sum });
    }
  }
  // Una celda SIN valor guardado pero CON movimientos también está descuadrada: el par existe en el
  // journal y no en `actuals`, y recorrer solo las celdas lo dejaría invisible.
  for (const [k, sum] of sumas) {
    if (vistos.has(k) || sum === 0) continue;
    const [nodeId, period] = k.split(" ") as [string, PeriodKey];
    const node = findNode(state.nodes, nodeId);
    if (!node || node.type === "transfer" || !isLeaf(node, state.nodes)) continue;
    out.push({ nodeId, name: node.name, period, cell: 0, sum });
  }
  return out;
}

/**
 * Los descuadres que una escritura EMPEORA: celdas que antes cuadraban y después no (NFR-2502).
 *
 * El criterio es RELATIVO a propósito, igual que el de las reglas de reservas: un descuadre que ya
 * existía no bloquea operaciones sobre OTRAS celdas — si no, un dato viejo torcido dejaría el libro
 * entero en solo lectura. Solo se juzga lo que la escritura toca.
 *
 * @param prev Estado persistido antes de la escritura.
 * @param next Estado propuesto.
 * @param periods Rango activo.
 * @returns Una entrada por celda que la escritura descuadró; `[]` si no empeoró ninguna.
 * @throws Nunca.
 *
 * @aitri-trace NFR-ID: NFR-2502, TC-ID: TC-DDC-321h, TC-DDC-323f, TC-DDC-324f
 */
export function worsenedCellMismatches(
  prev: LedgerState, next: LedgerState, periods: PeriodScope
): { nodeId: string; period: PeriodKey; cell: number; sum: number }[] {
  const antes = new Set(cellMismatches(prev, periods).map((m) => `${m.nodeId} ${m.period}`));
  return cellMismatches(next, periods)
    .filter((m) => !antes.has(`${m.nodeId} ${m.period}`))
    .map(({ nodeId, period, cell, sum }) => ({ nodeId, period, cell, sum }));
}

/**
 * Las celdas que impiden CERRAR ese periodo (FR-2512).
 *
 * Solo las de ESE periodo: un descuadre en un mes posterior no bloquea el cierre del que toca — el
 * usuario aún puede arreglarlo, y bloquear por algo que todavía es editable sería encerrarle.
 *
 * @param state Estado del ledger.
 * @param period Periodo que se pretende cerrar.
 * @param periods Rango activo.
 * @returns Las celdas descuadradas de ese periodo, con su nombre para poder nombrarlas.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2512, US-ID: US-2512, AC-ID: AC-2512a, TC-ID: TC-DDC-212h, TC-DDC-214e
 */
export function closeBlockers(
  state: LedgerState, period: PeriodKey, periods: PeriodScope
): { nodeId: string; name: string }[] {
  return cellMismatches(state, periods)
    .filter((m) => m.period === period)
    .map(({ nodeId, name }) => ({ nodeId, name }));
}

/** Cuántos nombres se enumeran antes de resumir con «y N más» (UX spec § F9). */
const NOMBRES_VISIBLES = 3;

/**
 * Los descuadres del rango, como PROBLEMAS DEL MES (FR-2511).
 *
 * Comparte la forma de `MonthIssue` con los problemas de reserva —mismo `kind` discriminado— para
 * que la marca del encabezado y la franja del Balance los pinten sin distinguir de dónde vienen.
 *
 * POR QUÉ NO LOS COMPONE `monthIssues`. Esa fue la primera versión y hubo que retirarla: obligaba a
 * `reserve` a importar este módulo, y eso choca con TC-TRF4-154e —que fija qué puede importar ese
 * fichero— y arrastraba a tocar los datos de prueba de tres features vecinas, que a su vez tienen
 * guardias contra justamente eso. Las superficies juntan las dos listas; es una línea en cada una.
 *
 * @param state Estado del ledger.
 * @param periods Rango activo.
 * @returns Una entrada por mes con al menos una celda descuadrada; `[]` si todo cuadra.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2511, US-ID: US-2511, AC-ID: AC-2511a, TC-ID: TC-DDC-191h, TC-DDC-195e, TC-DDC-196f
 */
export function mismatchIssues(state: LedgerState, periods: PeriodScope): MonthIssue[] {
  const porPeriodo = new Map<PeriodKey, { nodeId: string; name: string }[]>();
  for (const m of cellMismatches(state, periods)) {
    const lista = porPeriodo.get(m.period) ?? [];
    lista.push({ nodeId: m.nodeId, name: m.name });
    porPeriodo.set(m.period, lista);
  }
  // En orden de calendario, como `monthIssues`: las dos listas se concatenan y el resultado tiene
  // que leerse de principio a fin sin saltos de mes.
  const out: MonthIssue[] = [];
  for (const p of periods) {
    const cells = porPeriodo.get(p);
    if (cells && cells.length > 0) out.push({ kind: "descuadre", period: p, cells });
  }
  return out;
}

/**
 * Los nombres de las celdas descuadradas, resumidos (FR-2511).
 *
 * Hasta tres nombres y luego «y N más»: una lista completa de doce nombres en la franja del Balance
 * dejaría de leerse: el usuario necesita saber por dónde empezar, no el inventario entero.
 *
 * @param cells Celdas descuadradas del mes.
 * @returns «Restaurantes, Taxi» · «Restaurantes, Taxi, Mercado y 2 más» · «» si no hay ninguna.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2511, US-ID: US-2511, AC-ID: AC-2511a, TC-ID: TC-DDC-192h, TC-DDC-194e
 */
export function mismatchNamesText(cells: readonly { name: string }[]): string {
  if (cells.length === 0) return "";
  const nombres = cells.slice(0, NOMBRES_VISIBLES).map((c) => c.name);
  const resto = cells.length - nombres.length;
  return resto > 0 ? `${nombres.join(", ")} y ${resto} más` : nombres.join(", ");
}

/**
 * El motivo por el que no se puede cerrar, tal como lo lee el usuario (FR-2512).
 *
 * Vive en el dominio y no en el control para que el texto del botón y el de su `title` no puedan
 * discrepar — el mismo criterio que `monthIssueText`: una sola fuente, no dos que se parecen.
 *
 * Nombra las celdas en vez de contarlas a secas: «no se puede cerrar» sin decir cuál manda al
 * usuario a buscarlas una por una.
 *
 * @param cells Las celdas que bloquean (de `closeBlockers`).
 * @returns El motivo, o cadena vacía si no hay ninguna.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2512, US-ID: US-2512, AC-ID: AC-2512a, TC-ID: TC-DDC-211h, TC-DDC-218e
 */
export function closeBlockerText(cells: readonly { name: string }[]): string {
  if (cells.length === 0) return "";
  const nombres = cells.slice(0, NOMBRES_VISIBLES).map((c) => c.name);
  const resto = cells.length - nombres.length;
  const lista = resto > 0 ? `${nombres.join(", ")} y ${resto} más` : nombres.join(", ");
  return cells.length === 1
    ? `No se puede cerrar: 1 celda no cuadra (${lista})`
    : `No se puede cerrar: ${cells.length} celdas no cuadran (${lista})`;
}
