"use client";
// @aitri-trace components:mobile:MovementEditScreen — feature presupuesto-movil (FR-3107, FR-3108), ADR-03.
//
// Módulo:       src/components/mobile/MovementEditScreen.tsx
// Propósito:    Editar o borrar un movimiento desde el teléfono. Es el formulario de Registrar —las
//               mismas piezas— con los datos cargados. Qué se puede guardar lo decide
//               `movementEditVerdict`, la misma función que usa el editor de escritorio.
// Dependencias: @/state/store, @/domain (movementEditVerdict, catSubOf, findNode), ../register/*,
//               ../cycleText, ../format, ./DetailHeader, ./screenStack.

import { useMemo, useState } from "react";
import { CalendarClock, TriangleAlert } from "lucide-react";
import { catSubOf, findNode, firstDayOf, formatDay, movementEditVerdict, periodLabel } from "@/domain";
import type { LedgerNode, Movement } from "@/domain/types";
import { signOf } from "@/domain/sign";
import { useActivePeriods, useCalendar, useLedgerStore, type MovementEditOutcome } from "@/state/store";
import { withRange } from "../cycleText";
import { money, textoBorradoNegativo } from "../format";
import { AmountDisplay } from "../register/AmountDisplay";
import { CategoryRow, type LeafSelection } from "../register/CategoryRow";
import { DateTimeField } from "../register/DateTimeField";
import { NoteField } from "../register/NoteField";
import { SaveButton } from "../register/SaveButton";
import { Button } from "../ui/button";
import { DetailHeader } from "./DetailHeader";
import { goBack } from "./screenStack";

const TYPE_LABEL: Record<Movement["type"], string> = { expense: "Gasto", income: "Ingreso", transfer: "Reserva" };
const TYPE_NOUN: Record<Movement["type"], string> = { expense: "gasto", income: "ingreso", transfer: "movimiento" };
const NOON = "T12:00";

/** Texto de un rechazo que no es celda negativa, igual que en el editor de escritorio. */
const REJECT_TEXT: Record<string, string> = {
  period_mismatch: "Esa fecha no cae en ningún mes abierto.",
  invalid_target: "Esa categoría no admite este movimiento.",
  closed: "Ese mes está cerrado.",
};
const REJECT_DEFAULT = "Ese monto no es válido para este movimiento.";

/** El motivo de un resultado fallido de las acciones del store, listo para mostrar. */
function outcomeText(o: Exclude<MovementEditOutcome, { ok: true }>, deleting: boolean): string {
  if (o.reason === "negative_cell") {
    const cell = o.cells[0];
    return deleting ? textoBorradoNegativo(cell.value) : `No se puede: la celda quedaría en ${money(cell.value)}.`;
  }
  return REJECT_TEXT[o.reason] ?? REJECT_DEFAULT;
}

/**
 * Pantalla de edición de un movimiento.
 *
 * @param movement Movimiento que se edita.
 * @param leaf Hoja a la que pertenece hoy (para la línea de contexto).
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3107, US-ID: US-3107, AC-ID: AC-3119, TC-ID: TC-PMV-060h, TC-PMV-063f, TC-PMV-068e
 * @aitri-trace FR-ID: FR-3107, US-ID: US-3107, AC-ID: AC-3120, TC-ID: TC-PMV-061e
 * @aitri-trace FR-ID: FR-3107, US-ID: US-3107, AC-ID: AC-3121, TC-ID: TC-PMV-062f
 * @aitri-trace FR-ID: FR-3107, US-ID: US-3107, AC-ID: AC-3122, TC-ID: TC-PMV-064e
 * @aitri-trace FR-ID: FR-3108, US-ID: US-3108, AC-ID: AC-3123, TC-ID: TC-PMV-070h, TC-PMV-072f, TC-PMV-073e
 * @aitri-trace FR-ID: FR-3108, US-ID: US-3108, AC-ID: AC-3124, TC-ID: TC-PMV-071f
 */
export function MovementEditScreen({ movement, leaf }: { movement: Movement; leaf: LedgerNode }) {
  const data = useLedgerStore((s) => s.data);
  const periods = useActivePeriods();
  const cal = useCalendar();
  const editMovement = useLedgerStore((s) => s.editMovement);
  const deleteMovement = useLedgerStore((s) => s.deleteMovement);
  const showToast = useLedgerStore((s) => s.showToast);

  const isAdjustment = movement.kind === "adjustment";
  // El borrador arranca como en escritorio: un movimiento sin fecha toma el primer día de su periodo.
  const initial = useMemo(() => {
    const target = findNode(data.nodes, movement.target);
    return {
      amount: String(movement.amount),
      note: movement.note ?? "",
      date: movement.date ?? `${firstDayOf(movement.period).slice(0, 10)}${NOON}`,
      sel: target ? catSubOf(target) : { catId: movement.catId, subId: movement.subId },
    };
    // Solo al abrir: el borrador no se reinicia cuando el estado cambia por otra pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movement.id]);
  const [amountText, setAmountText] = useState(initial.amount);
  const [note, setNote] = useState(initial.note);
  const [date, setDate] = useState(initial.date);
  const [sel, setSel] = useState<LeafSelection>(initial.sel);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Lo tecleado no es un monto (una letra, una coma): el campo lo dice y no se puede guardar.
  const [amountInvalid, setAmountInvalid] = useState(false);

  const target = sel.subId ?? sel.catId;
  const verdict = movementEditVerdict(data, movement, { amount: amountText, note, date, target }, cal, periods);
  const erase = amountText !== "" && verdict.amount === 0;
  const unchanged =
    amountText === initial.amount && note === initial.note && date === initial.date &&
    target === (initial.sel.subId ?? initial.sel.catId);
  const canSubmit = verdict.canSave && !unchanged && !amountInvalid;

  const done = (message: string) => {
    showToast(message);
    goBack();
  };
  const submit = () => {
    if (!canSubmit) return;
    const r = editMovement(movement.id, verdict.patch);
    if (!r.ok) {
      setFailure(outcomeText(r, erase));
      return;
    }
    done(erase ? "Movimiento borrado" : "Movimiento actualizado");
  };
  const remove = () => {
    const r = deleteMovement(movement.id);
    if (!r.ok) {
      setConfirming(false);
      setFailure(outcomeText(r, true));
      return;
    }
    done("Movimiento borrado");
  };
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setFailure(null);
    set(v);
  };

  const dryMessage = verdict.negative
    ? (erase
        ? textoBorradoNegativo(verdict.negative.value)
        : `No se puede: ${findNode(data.nodes, verdict.negative.nodeId)?.name ?? "la celda"} quedaría en ${money(verdict.negative.value)}, y ninguna celda puede quedar por debajo de 0.`)
    : verdict.otherReject
      ? (REJECT_TEXT[verdict.otherReject] ?? REJECT_DEFAULT)
      : null;
  const amountNumber = verdict.amount;

  return (
    <div data-testid="mb-edit-form">
      <DetailHeader title="Editar movimiento" context={`${leaf.name} · ${periodLabel(movement.period)}`} />
      <div className="flex flex-col gap-5 pt-2">
        <span
          data-testid="mb-edit-type"
          // En NEUTRO: fuera de las piezas del registro el color no clasifica por tipo (refinamiento-ui
          // FR-1201). El tipo lo dicen el signo y la palabra; el color del tipo lo llevan el monto y la
          // categoría de abajo, que son las piezas del registro.
          className="inline-flex items-center gap-1.5 self-start rounded-full border border-border-strong px-3 py-1 text-caption font-semibold text-fg-secondary"
        >
          {signOf(movement.type)} {isAdjustment ? "Ajuste" : TYPE_LABEL[movement.type]}
        </span>

        <AmountDisplay
          amount={amountNumber}
          type={movement.type}
          signed={isAdjustment}
          negative={isAdjustment && amountText.startsWith("-")}
          testId="mb-edit-amount"
          strict
          onInvalidChange={setAmountInvalid}
          onDigits={touch(setAmountText)}
        />

        {isAdjustment && (
          // El teclado numérico del teléfono no trae «−»: el signo de un ajuste se cambia con este botón.
          <Button
            type="button"
            data-testid="mb-edit-sign"
            className="-mt-2 h-(--control-md) self-center"
            onClick={() => touch(setAmountText)(amountText.startsWith("-") ? amountText.slice(1) : `-${amountText}`)}
          >
            Cambiar signo (±)
          </Button>
        )}

        <div data-testid="mb-edit-category">
          <CategoryRow type={movement.type} nodes={data.nodes} value={sel} onChange={touch(setSel)} />
        </div>

        <div data-testid="mb-edit-date">
          <DateTimeField value={date} onChange={touch(setDate)} />
          {verdict.movesTo && !verdict.targetClosed && (
            <p data-testid="mb-edit-moves" className="caption mt-1.5 flex items-center gap-1.5" style={{ color: "var(--alert-soft)" }}>
              <CalendarClock size={14} strokeWidth={1.5} className="flex-none" aria-hidden />
              Pasará a {withRange(cal, verdict.movesTo)}
            </p>
          )}
          {verdict.targetClosed && verdict.targetPeriod && (
            <p data-testid="mb-edit-closed" role="alert" className="caption mt-1.5 flex items-start gap-1.5" style={{ color: "var(--alert-strong)" }}>
              <TriangleAlert size={14} strokeWidth={1.5} className="mt-0.5 flex-none" aria-hidden />
              {periodLabel(verdict.targetPeriod)} está cerrado. Para cambiar sus movimientos, reábrelo desde el cierre de mes.
            </p>
          )}
        </div>

        <NoteField id="mb-edit-note" testId="mb-edit-note" value={note} onChange={touch(setNote)} />

        <div className="flex flex-col gap-2.5">
          <SaveButton
            type={movement.type}
            disabled={!canSubmit}
            onClick={submit}
            label={erase ? "Borrar movimiento" : "Guardar cambios"}
            testId="mb-edit-save"
          />
          {(verdict.amountError || dryMessage || failure) && (
            <p data-testid="mb-edit-error" role="alert" className="caption flex items-start gap-1.5" style={{ color: "var(--alert-strong)" }}>
              <TriangleAlert size={14} strokeWidth={1.5} className="mt-0.5 flex-none" aria-hidden />
              {failure ?? verdict.amountError ?? dryMessage}
            </p>
          )}

          {!confirming && (
            <Button type="button" variant="ghost" data-testid="mb-edit-cancel" className="h-(--control-lg) w-full" onClick={goBack}>
              Cancelar
            </Button>
          )}
          {!erase && !confirming && (
            <Button
              type="button"
              data-testid="mb-edit-delete"
              className="h-(--control-lg) w-full"
              style={{ color: "var(--alert-strong)", borderColor: "var(--alert-strong)" }}
              onClick={() => { setFailure(null); setConfirming(true); }}
            >
              Borrar movimiento
            </Button>
          )}
          {confirming && (
            <div data-testid="mb-confirm-delete" role="alertdialog" aria-label="Confirmar borrado" className="rounded-(--radius-md) border border-border-strong bg-card p-3">
              <p className="label font-normal text-fg">
                ¿Borrar este {TYPE_NOUN[movement.type]} de {money(movement.amount)} del {formatDay(movement.date ?? firstDayOf(movement.period))}?
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button type="button" variant="ghost" data-testid="mb-confirm-no" className="h-(--control-lg)" onClick={() => setConfirming(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  data-testid="mb-confirm-yes"
                  className="h-(--control-lg)"
                  style={{ background: "var(--alert-strong)", borderColor: "var(--alert-strong)", color: "var(--on-accent)" }}
                  onClick={remove}
                >
                  Borrar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
