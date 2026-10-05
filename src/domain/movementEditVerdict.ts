// @aitri-trace domain:movementEditVerdict — features diario-de-celda (FR-2505) y presupuesto-movil (FR-3107), ADR-03.
//
// Módulo:       src/domain/movementEditVerdict.ts
// Propósito:    El ENSAYO de una edición en curso: qué se guardaría, qué lo impide y a qué periodo
//               pasaría el movimiento. Vivía dentro de `MovementEditor` (escritorio); se extrajo, sin
//               cambiar una sola regla, para que la pantalla de edición del teléfono decida con la
//               MISMA función. No es una validación paralela: corre la mutación real del dominio.
// Dependencias: ./adjust, ./closure, ./cycles, ./reserve (CELL_NOTE_MAX), ../lib/money.

import { amountInputError, parsePesos } from "../lib/money";
import {
  deleteMovement, editMovement,
  type DeleteMovementResult, type EditResult, type MovementPatch, type NegativeCell,
} from "./adjust";
import { isClosed } from "./closure";
import type { Calendar } from "./cycles";
import { CELL_NOTE_MAX } from "./reserve";
import type { LedgerState, Movement, PeriodKey } from "./types";

/** Lo que el usuario tiene escrito en el formulario, tal cual, sin interpretar. */
export interface MovementDraft {
  /** Texto del campo de monto. Un ajuste admite un «-» inicial. */
  amount: string;
  note: string;
  /** «YYYY-MM-DDTHH:mm». */
  date: string;
  /** Id de la hoja destino. */
  target: string;
}

/** Motivos de rechazo del ensayo que NO son una celda negativa. */
type OtherReject = Exclude<
  Extract<EditResult | DeleteMovementResult, { rejected: string }>["rejected"],
  "negative_cell"
>;

interface VerdictBase {
  /** Monto ya interpretado, con su signo. */
  amount: number;
  /** Mensaje de monto no entero, o null. */
  amountError: string | null;
  noteTooLong: boolean;
  /** El cambio que se enviaría a `editMovement`. */
  patch: MovementPatch;
  /** Primera celda que quedaría por debajo de cero, si el ensayo se rechaza por eso. */
  negative: NegativeCell | null;
  /** Otro motivo de rechazo del ensayo, o null. */
  otherReject: OtherReject | null;
  /** Periodo al que corresponde la fecha escrita; null si no cae en ninguno. */
  targetPeriod: PeriodKey | null;
  /** Periodo al que PASARÍA el movimiento si cambia; null si se queda donde está. */
  movesTo: PeriodKey | null;
  /** El periodo de destino está cerrado. */
  targetClosed: boolean;
  /** El cambio se puede guardar tal como está. */
  canSave: boolean;
}

/** Veredicto de una edición en curso. */
export type EditVerdict = VerdictBase &
  (
    | { kind: "invalid"; reason: "amount" | "note" | "closed_target"; dry: null }
    | { kind: "delete"; dry: DeleteMovementResult }
    | { kind: "edit"; dry: EditResult }
  );

/**
 * Ensaya una edición y dice qué pasaría.
 *
 * Con el monto en 0 el ensayo es el del BORRADO —la misma función de la papelera—, para que las dos
 * vías den el mismo veredicto (FR-2505: cero elimina). El destino cerrado se comprueba aquí porque
 * `editMovement` es dominio puro y no conoce la frontera de cierre (FR-2507).
 *
 * «Sin cambios» NO forma parte del veredicto: escritorio no tiene esa regla. Quien la necesite la
 * calcula comparando el borrador con los valores iniciales.
 *
 * @param state Estado del ledger.
 * @param movement Movimiento que se edita.
 * @param draft Lo escrito en el formulario.
 * @param cal Calendario vigente (mes o ciclo).
 * @param periods Periodos activos.
 * @returns El veredicto; `canSave` resume si el botón principal debe estar habilitado.
 * @throws Nunca. Una fecha que no cae en ningún periodo deja `targetPeriod` en null.
 *
 * @aitri-trace FR-ID: FR-3107, US-ID: US-3107, AC-ID: AC-3119, TC-ID: TC-PMV-065h, TC-PMV-066f, TC-PMV-067e
 */
export function movementEditVerdict(
  state: LedgerState, movement: Movement, draft: MovementDraft, cal: Calendar, periods: readonly PeriodKey[]
): EditVerdict {
  const isAdjustment = movement.kind === "adjustment";
  // BG-076 (FR-207): un monto que no es entero en pesos se rechaza con su mensaje. El «−» inicial de
  // un ajuste sigue siendo válido: es el único movimiento que puede ser negativo (FR-2504).
  const sign = isAdjustment && draft.amount.startsWith("-") ? -1 : 1;
  const amountError = amountInputError(isAdjustment ? draft.amount.replace(/^-/, "") : draft.amount);
  const amount = sign * parsePesos(draft.amount);
  const noteTooLong = draft.note.length > CELL_NOTE_MAX;
  const erase = draft.amount !== "" && amount === 0;
  const amountOk =
    draft.amount !== "" && !amountError && Number.isInteger(amount) && (erase || (isAdjustment ? amount !== 0 : amount >= 1));

  const patch: MovementPatch = {
    amount,
    note: draft.note.trim() === "" ? null : draft.note,
    date: draft.date,
    ...(draft.target !== movement.target ? { catId: draft.target } : {}),
  };

  const dry = amountOk && !noteTooLong
    ? (erase ? deleteMovement(state, movement.id) : editMovement(state, movement.id, patch, cal, periods))
    : null;
  const rejected = dry && "rejected" in dry ? dry : null;
  const negative = rejected && rejected.rejected === "negative_cell" ? rejected.cells[0] : null;
  const otherReject = rejected && rejected.rejected !== "negative_cell" ? rejected.rejected : null;

  let targetPeriod: PeriodKey | null = null;
  try {
    targetPeriod = cal.periodForDate(draft.date);
  } catch {
    targetPeriod = null;
  }
  const changesPeriod = targetPeriod !== null && targetPeriod !== movement.period;
  const targetClosed = targetPeriod !== null && changesPeriod && isClosed(state.closure, targetPeriod);
  const canSave = amountOk && !noteTooLong && !targetClosed && dry !== null && !("rejected" in dry);

  const base: VerdictBase = {
    amount, amountError, noteTooLong, patch, negative, otherReject, targetPeriod,
    movesTo: changesPeriod ? targetPeriod : null, targetClosed, canSave,
  };
  if (!amountOk) return { ...base, kind: "invalid", reason: "amount", dry: null };
  if (noteTooLong) return { ...base, kind: "invalid", reason: "note", dry: null };
  if (targetClosed) return { ...base, kind: "invalid", reason: "closed_target", dry: null };
  return erase
    ? { ...base, kind: "delete", dry: dry as DeleteMovementResult }
    : { ...base, kind: "edit", dry: dry as EditResult };
}
