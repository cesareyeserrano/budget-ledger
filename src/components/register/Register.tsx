"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeType } from "@/domain/types";
import { useLedgerStore, useActivePeriods, useCalendar } from "@/state/store";
import { AVAILABLE_ID, applyReserveOp, isAvailable, labelOfEnd, maxWithdrawal, reserveHeadroom } from "@/domain/reserve";
import { parsePesos } from "@/lib/money";
import { nowForInput, periodKeyFromDate } from "@/lib/date";
import { proposeOpeningCycle } from "@/domain/cycles";
import { periodMonthLabel, monthOf } from "@/domain/periods";
import { Info } from "lucide-react";
import { cycleLabel } from "../cycleText";
import { money } from "@/components/format";
import { blockMessage } from "@/components/reserveText";
import { AmountDisplay } from "./AmountDisplay";
import { TypeToggle } from "./TypeToggle";
import { CategoryRow, type LeafSelection } from "./CategoryRow";
import { ReserveRow, type ReserveEnds } from "./ReserveRow";
import { DateTimeField } from "./DateTimeField";
import { NoteField } from "./NoteField";
import { SaveButton } from "./SaveButton";
import { ConfirmOverlay } from "./ConfirmOverlay";

const CONFIRM_MS = 2000;

/**
 * Orquestador del registro móvil rediseñado (reemplaza MovementForm en ≤760px). Compone monto,
 * tipo (color propagado), categorías de la jerarquía, fecha, nota, guardado y overlay. GUARDA con
 * la semántica de datos existente (suma a Ejecutado + roll-ups); el `month` se deriva de la fecha.
 *
 * Feature transferencias (FR-1005): el tipo Reserva reemplaza el selector de categorías por las
 * filas De→A (saldos visibles, máximo/margen junto al monto, De=A imposible), guarda vía la
 * operación atómica del dominio (modelo v4: guardar suma el aporte a la celda del mes y
 * journaliza; sacar solo journaliza).
 *
 * @aitri-trace FR-ID: FR-207, US-ID: US-207, AC-ID: AC-207, TC-ID: TC-SUT-220h
 * @aitri-trace FR-ID: FR-1005, US-ID: US-1005, AC-ID: AC-1005, TC-ID: TC-TRF-105h, TC-TRF-205h
 */
export function Register() {
  const data = useLedgerStore((s) => s.data);
  const periods = useActivePeriods();
  const nodes = data.nodes;
  const add = useLedgerStore((s) => s.addMovement);

  const [type, setType] = useState<NodeType>("expense");
  const [rawAmount, setRawAmount] = useState("");
  const [sel, setSel] = useState<LeafSelection | null>(null);
  const [ends, setEnds] = useState<ReserveEnds>({ from: null, to: null });
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ amount: number; type: NodeType; summary?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDate(nowForInput());
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const amount = useMemo(() => parsePesos(rawAmount), [rawAmount]);
  // Feature ciclos (FR-2405/FR-2406): el periodo sale del calendario vigente (en mes es el de siempre).
  // Un ingreso dentro de la ventana del pago adelantado recibe la PROPUESTA de contarse en el ciclo
  // que abre; el defecto es quedarse en el de su fecha, y solo si el usuario acepta cambia.
  const cal = useCalendar();
  const derivedPeriod = useMemo(() => { try { return cal.periodForDate(date); } catch { return null; } }, [cal, date]);
  const proposal = useMemo(() => (derivedPeriod && type === "income" ? proposeOpeningCycle(cal, "income", date) : null), [cal, derivedPeriod, type, date]);
  const [countInOpening, setCountInOpening] = useState(false);
  useEffect(() => { setCountInOpening(false); }, [proposal]);
  const month = proposal && countInOpening ? proposal : (derivedPeriod ?? periodKeyFromDate(date));
  const outOfRange = cal.mode === "cycle" && (derivedPeriod === null || !periods.includes(month));

  // FR-1005: la guía de estado bajo el monto — el límite visible MIENTRAS se teclea (H1/H5).
  const isReserve = type === "transfer";
  const reserveLimit = useMemo(() => {
    if (!isReserve || !ends.from) return null;
    // FR-1808/AC-1834 — el CUPO que queda, no el margen del mes: el margen no descuenta lo ya
    // reservado y prometería plata que el dominio va a rechazar. El número mostrado es exactamente
    // el que el rechazo usa como límite (FR-2803).
    if (isAvailable(ends.from)) return { label: "Cupo del mes", value: reserveHeadroom(data, month, periods) };
    // Sacar o mover DESDE una alcancía: el tope es lo extraíble viendo la serie completa, no el
    // saldo del mes — un retiro posterior ya pudo usar esa plata (auditoría 2026-09-01).
    return { label: "Máx.", value: maxWithdrawal(data, ends.from, month, periods) };
  }, [isReserve, ends.from, data, month, periods]);
  const overLimit = reserveLimit !== null && amount > reserveLimit.value;

  const saveEnabled = !outOfRange && (isReserve
    ? amount > 0 && !!ends.from && !!ends.to && !overLimit
    : amount > 0);

  /** Cambiar de tipo conserva el monto pero deselecciona la categoría/los extremos (FR-208/209). */
  function onChangeType(t: NodeType) {
    setType(t);
    setSel(null);
    setEnds({ from: null, to: null });
    setRuleError(null);
  }

  function resetForNext() {
    setRawAmount("");
    setSel(null);
    setEnds({ from: null, to: null });
    setNote("");
    setDate(nowForInput());
    setShowErrors(false);
    setRuleError(null);
  }

  function saveReserve() {
    const { from, to } = ends;
    if (amount <= 0 || !from || !to) {
      setShowErrors(true);
      return;
    }
    // La operación del registro: mismo dominio, mismo veredicto que la grilla (NFR-1004).
    const dry = applyReserveOp(data, { from, to, period: month, amount, date, note }, periods);
    if ("rejected" in dry) {
      // Carrera contra la guía (el estado cambió bajo los pies): el mensaje de la regla, bajo el monto.
      if (dry.rejected === "invalid_target") setRuleError("Operación inválida — revisa origen y destino");
      else if (!dry.rejected.ok) setRuleError(blockMessage(data, dry.rejected, { editedMonth: month, attempted: amount }));
      return;
    }
    const targetLeaf = isAvailable(to) ? from : to;
    const ok = add({ type: "transfer", catId: targetLeaf, amount, period: month, date, note, from, to });
    if (!ok) return; // doble-tap: sin overlay
    setConfirm({ amount, type, summary: `${money(amount)} · ${labelOfEnd(data, from)} → ${labelOfEnd(data, to)}` });
    timer.current = setTimeout(() => {
      setConfirm(null);
      resetForNext();
    }, CONFIRM_MS);
  }

  function onSave() {
    if (isReserve) {
      saveReserve();
      return;
    }
    if (amount <= 0 || sel === null) {
      setShowErrors(true);
      return;
    }
    const ok = add({
      type,
      catId: sel.catId,
      subId: sel.subId,
      amount,
      period: month,
      date,
      note,
    });
    if (!ok) return; // doble-tap o inválido: sin overlay
    setConfirm({ amount, type });
    timer.current = setTimeout(() => {
      setConfirm(null);
      resetForNext();
    }, CONFIRM_MS);
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[480px] flex-col gap-6" style={{ animation: "mvScreenIn 0.26s ease" }}>
      {confirm && <ConfirmOverlay amount={confirm.amount} type={confirm.type} summary={confirm.summary} />}


      <TypeToggle value={type} onChange={onChangeType} />

      <AmountDisplay amount={amount} type={type} onDigits={setRawAmount} error={showErrors && amount <= 0} />

      {/* FR-1005: la guía de estado bajo el monto — pasa a --error cuando el monto la excede (H9). */}
      {isReserve && reserveLimit && (
        <p data-testid="reserve-guide" className="tabular -mt-4 text-sm" style={{ color: overLimit ? "var(--error)" : "var(--fg-secondary)" }} role={overLimit ? "alert" : undefined}>
          {reserveLimit.label}: {money(reserveLimit.value)}
        </p>
      )}
      {isReserve && ruleError && (
        <p data-testid="reserve-rule-error" className="-mt-4 text-sm" role="alert" style={{ color: "var(--error)" }}>
          {ruleError}
        </p>
      )}

      {isReserve ? (
        <ReserveRow data={data} month={month} value={ends} onChange={(e) => { setEnds(e); setRuleError(null); }} error={showErrors && (!ends.from || !ends.to)} />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <span className="text-sm font-medium text-fg-secondary">Categoría</span>
          <CategoryRow
            type={type}
            nodes={nodes}
            value={sel}
            onChange={setSel}
            error={showErrors && sel === null}
          />
        </div>
      )}

      <DateTimeField value={date} onChange={setDate} />
      {cal.mode === "cycle" && (
        <p data-testid="register-cycle" className={outOfRange ? "caption text-(--alert-strong)" : "caption text-fg-secondary"}>
          {outOfRange ? "Fuera del rango de tu presupuesto" : <><span className="text-fg-muted">Ciclo</span> · {cycleLabel(cal, month).replace(/ \d{4}$/, "")} · {cal.rangeLabel(month)}</>}
        </p>
      )}
      {proposal && !outOfRange && (
        <div data-testid="opening-proposal" className="flex flex-col gap-2 rounded-(--radius-sm) border border-border-strong p-3">
          <p className="caption flex items-start gap-2 text-fg-secondary">
            <Info size={14} data-icon="info" className="mt-0.5 shrink-0" aria-hidden />
            <span>Este ingreso cae {proposalDays(cal, date, proposal)} antes de tu día de pago ({anchorDayOf(cal)}). ¿Es el salario que abre {periodMonthLabel(monthOf(proposal))}?</span>
          </p>
          <div role="radiogroup" aria-label="Ciclo del ingreso" className="flex flex-col gap-1 sm:inline-flex sm:flex-row sm:overflow-hidden sm:rounded-(--radius-sm) sm:border sm:border-border">
            <button type="button" role="radio" aria-checked={!countInOpening} data-testid="proposal-keep" onClick={() => setCountInOpening(false)}
              className={`h-(--control-md) rounded-(--radius-sm) border border-border px-3 label sm:rounded-none sm:border-0 ${!countInOpening ? "bg-card-hover text-fg" : "text-fg-secondary"}`}>
              Mantener en {periodMonthLabel(monthOf(derivedPeriod ?? month))}
            </button>
            <button type="button" role="radio" aria-checked={countInOpening} data-testid="proposal-accept" onClick={() => setCountInOpening(true)}
              className={`h-(--control-md) rounded-(--radius-sm) border border-border px-3 label sm:rounded-none sm:border-0 ${countInOpening ? "bg-card-hover text-fg" : "text-fg-secondary"}`}>
              Contar en {periodMonthLabel(monthOf(proposal))} · {cal.rangeLabel(proposal)}
            </button>
          </div>
        </div>
      )}
      <NoteField value={note} onChange={setNote} />

      <SaveButton type={type} disabled={!saveEnabled} onClick={onSave} />
    </div>
  );
}

/** «1 día» / «3 días» entre la fecha del ingreso y el inicio del ciclo propuesto (FR-2406). */
function proposalDays(cal: ReturnType<typeof useCalendar>, iso: string, proposal: string): string {
  const start = cal.rangeOf(proposal)?.start;
  if (!start) return "";
  const n = Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  return `${n} ${n === 1 ? "día" : "días"}`;
}
/** El día de pago vigente, para el texto de la propuesta. */
function anchorDayOf(cal: ReturnType<typeof useCalendar>): number | string {
  const vs = cal.config.versions.filter((v) => v.mode === "cycle");
  return vs[vs.length - 1]?.anchorDay ?? "";
}
