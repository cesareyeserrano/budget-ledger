"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeType } from "@/domain/types";
import { useLedgerStore } from "@/state/store";
import { AVAILABLE_ID, applyReserveOp, isAvailable, labelOfEnd, maxWithdrawal, reserveHeadroom } from "@/domain/reserve";
import { parsePesos } from "@/lib/money";
import { nowForInput, periodKeyFromDate } from "@/lib/date";
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
  const periods = useLedgerStore((s) => s.activePeriods)();
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
  const month = periodKeyFromDate(date);

  // FR-1005: la guía de estado bajo el monto — el límite visible MIENTRAS se teclea (H1/H5).
  const isReserve = type === "transfer";
  const reserveLimit = useMemo(() => {
    if (!isReserve || !ends.from) return null;
    // FR-1808/AC-1834 — el CUPO que queda, no el margen bruto: bajo la regla de consumo bruto el
    // margen promete plata que el dominio va a rechazar (en el enero del usuario: margen 1.000,
    // cupo 0). El número mostrado es exactamente el que el rechazo usa como límite.
    if (isAvailable(ends.from)) return { label: "Cupo del mes", value: reserveHeadroom(data, month, periods) };
    // Sacar o mover DESDE una alcancía: el tope es lo extraíble viendo la serie completa, no el
    // saldo del mes — un retiro posterior ya pudo usar esa plata (auditoría 2026-09-01).
    return { label: "Máx.", value: maxWithdrawal(data, ends.from, month, periods) };
  }, [isReserve, ends.from, data, month, periods]);
  const overLimit = reserveLimit !== null && amount > reserveLimit.value;

  const saveEnabled = isReserve
    ? amount > 0 && !!ends.from && !!ends.to && !overLimit
    : amount > 0;

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
      <NoteField value={note} onChange={setNote} />

      <SaveButton type={type} disabled={!saveEnabled} onClick={onSave} />
    </div>
  );
}
