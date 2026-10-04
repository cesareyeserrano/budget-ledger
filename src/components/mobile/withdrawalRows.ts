// @aitri-trace components:mobile:withdrawalRows — feature presupuesto-movil (FR-3110).
//
// Módulo:       src/components/mobile/withdrawalRows.ts
// Propósito:    Las operaciones de reserva de un periodo, listas para pintar: de dónde a dónde, cuánto
//               y si cuentan como retiro. Es la misma lista que muestra la celda de retiros de
//               escritorio (`monthReserveOps`), que incluye los movimientos ENTRE alcancías.
// Dependencias: @/domain (monthReserveOps, labelOfEnd, isAvailable).

import { isAvailable, labelOfEnd, monthReserveOps } from "@/domain";
import type { LedgerState, PeriodKey } from "@/domain/types";

/** Una operación de reserva del periodo. */
export interface WithdrawalRow {
  id: string;
  /** Nombre de la alcancía de origen. */
  from: string;
  /** «Disponible», o el nombre de la alcancía de destino. */
  to: string;
  amount: number;
  note: string | null;
  date: string | null;
  /** true si va a Disponible: solo ésas suman a la cifra «Retiros del mes». */
  countsAsRetiro: boolean;
}

/**
 * Las operaciones de reserva de un periodo, en orden de journal.
 *
 * @param state Estado del ledger.
 * @param period Periodo.
 * @returns Una fila por operación; vacía si no hubo ninguna.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3110, US-ID: US-3110, AC-ID: AC-3127, TC-ID: TC-PMV-095e, TC-PMV-090h
 */
export function withdrawalRows(state: LedgerState, period: PeriodKey): WithdrawalRow[] {
  return monthReserveOps(state, period).map((m) => ({
    id: m.id,
    from: labelOfEnd(state, m.from),
    to: labelOfEnd(state, m.to),
    amount: m.amount,
    note: m.note ?? null,
    date: m.date ?? null,
    countsAsRetiro: isAvailable(m.to),
  }));
}
