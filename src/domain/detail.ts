// @aitri-trace domain:detail — feature diario-de-celda (FR-2501, FR-2508): QUÉ forma una celda.
//
// Módulo:       src/domain/detail.ts
// Propósito:    El Detalle de una celda: los movimientos que la componen y los comentarios que la
//               acompañan, en un orden estable. Selector PURO — no escribe, no consulta la red y no
//               conoce la UI. La pantalla (CellDetail) solo lo pinta.
// Dependencias: ./types, ./periods, ./reserve (observaciones y aviso de arrastre de bolsillos).

import type { CellNote, LedgerState, Movement, NodeType, PeriodKey } from "./types";
import { monthOf, periodLabel } from "./periods";
import { cellObservations, monthCarryUsage } from "./reserve";
import { findNode, isLeaf } from "./tree";

type PeriodScope = readonly PeriodKey[];

/**
 * Una línea del Detalle. Las cuatro formas se pintan con la MISMA anatomía (UX spec, FR-2508);
 * lo que cambia es el ícono, y solo los movimientos llevan monto.
 */
export type DetailEntry =
  | { kind: "auto"; text: string }
  | { kind: "reserveNote"; text: string; createdAt: number }
  | { kind: "movement" | "adjustment"; movement: Movement }
  | { kind: "comment"; note: CellNote };

/**
 * Lo que suman los movimientos de una celda de gasto o ingreso (FR-2504, FR-2511).
 *
 * Es la otra mitad del cuadre: la celda GUARDA su valor (ADR-01) y esto dice cuánto respaldan sus
 * movimientos. Los de reserva nunca cuentan — una celda de bolsillo no se cuadra así (NFR-2503).
 *
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2504, US-ID: US-2504, AC-ID: AC-2504a, TC-ID: TC-DDC-061h, TC-DDC-075e
 */
export function movementSum(state: LedgerState, leafId: string, period: PeriodKey): number {
  let total = 0;
  for (const m of state.movements) {
    if (m.type !== "transfer" && m.target === leafId && m.period === period) total += m.amount;
  }
  return total;
}

/** Fecha con la que ordena un movimiento: la suya, o el primer día del periodo si no la tiene. */
function sortDate(m: Movement, period: PeriodKey): string {
  return m.date ?? firstDayOf(period);
}

/**
 * El primer día del periodo en formato ISO de minuto. Es la fecha que se le atribuye a un
 * movimiento SIN `date` (los anteriores a stack-upgrade-theme): no se inventa una fecha real, se
 * usa la única que el dato garantiza — que cayó en ese periodo (FR-2501, TC-DDC-010e).
 *
 * En modo ciclos la clave puede llevar el sufijo de transición; `monthOf` la reduce a su mes.
 */
export function firstDayOf(period: PeriodKey): string {
  return `${monthOf(period)}-01T00:00`;
}

/** Miles con punto y el signo delante, como `money()` de la UI (es-CO). */
function cop(n: number): string {
  return n < 0 ? `−$${Math.abs(n).toLocaleString("es-CO")}` : `$${n.toLocaleString("es-CO")}`;
}

/**
 * Cómo se MUESTRA el monto de una línea (UX spec § regla de signo y color).
 *
 * El signo visible es el del TIPO por el del monto guardado: en un gasto, 50.000 se ve «−50.000» y
 * un ajuste de −10.000 se ve «+10.000», porque le QUITA gasto a la celda (como una devolución).
 * `addsToCell` dice si esa línea suma al total de la celda — la UI lo usa para el color, de modo que
 * un «+10.000» dentro de un gasto no se lea como un ingreso.
 *
 * @param type Tipo de la hoja: `expense` resta a la vista, `income` suma.
 * @param amount Monto GUARDADO, con su signo (un ajuste puede ser negativo, FR-2504).
 * @returns Signo a pintar, valor absoluto y si la línea suma al total de la celda.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2501, US-ID: US-2501, AC-ID: AC-2501a, TC-ID: TC-DDC-008e, TC-DDC-009e
 */
export function displayAmount(
  type: NodeType, amount: number
): { sign: "+" | "−"; abs: number; addsToCell: boolean } {
  const addsToCell = amount > 0;
  const positiveForType = type === "expense" ? !addsToCell : addsToCell;
  return { sign: positiveForType ? "+" : "−", abs: Math.abs(amount), addsToCell };
}

/**
 * Las líneas que forman una celda, en el orden en que se leen: el aviso automático de arrastre (solo
 * bolsillos), después los movimientos del periodo por fecha y, a igual fecha, por orden de creación,
 * y al final los comentarios por antigüedad.
 *
 * Una hoja `transfer` no tiene movimientos propios en el Detalle: sus operaciones De→A se leen como
 * notas (`reserveNote`), exactamente como hasta ahora (NFR-2503). Los movimientos `transfer` nunca
 * forman parte de una celda de gasto o ingreso.
 *
 * @param state Estado del ledger.
 * @param leafId Hoja cuya celda se abre.
 * @param period Periodo de la celda (mes o ciclo).
 * @param periods Rango activo, para el aviso de arrastre.
 * @returns Las entradas del Detalle; `[]` si la hoja no existe o la celda está vacía.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2501, US-ID: US-2501, AC-ID: AC-2501a, TC-ID: TC-DDC-002h, TC-DDC-004f, TC-DDC-159e
 */
export function cellDetail(
  state: LedgerState, leafId: string, period: PeriodKey, periods: PeriodScope
): DetailEntry[] {
  const node = findNode(state.nodes, leafId);
  if (!node) return [];
  const entries: DetailEntry[] = [];

  if (node.type === "transfer") {
    // El aviso de arrastre es del mes, no de la celda: solo aparece si ESTA alcancía aportó (la
    // misma guarda que ya aplicaba la sección de observaciones, auditoría 2026-09-01).
    const aporto = (state.actuals[leafId]?.[period] ?? 0) > 0;
    const carry = aporto ? monthCarryUsage(state, period, "actual", periods) : null;
    if (carry) {
      entries.push({
        kind: "auto",
        text:
          `De los ${cop(carry.reservado)} reservados este mes, ${cop(carry.delSaldoAnterior)} ` +
          `salieron del saldo de ${periodLabel(carry.mesAnterior).toLowerCase()}.`,
      });
    }
    for (const o of cellObservations(state, leafId, period, periods)) {
      if (o.source === "manual") continue; // los manuales entran abajo, como comentarios
      entries.push({ kind: "reserveNote", text: o.text, createdAt: o.createdAt });
    }
  } else {
    const propios = state.movements
      .filter((m) => m.type !== "transfer" && m.target === leafId && m.period === period)
      .sort((a, b) => {
        const byDate = sortDate(a, period).localeCompare(sortDate(b, period));
        return byDate !== 0 ? byDate : a.createdAt - b.createdAt;
      });
    for (const m of propios) {
      entries.push({ kind: m.kind === "adjustment" ? "adjustment" : "movement", movement: m });
    }
  }

  const comentarios = [...(state.cellNotes?.[leafId]?.[period] ?? [])].sort((a, b) => a.createdAt - b.createdAt);
  for (const note of comentarios) entries.push({ kind: "comment", note });

  return entries;
}
