"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeType } from "@/domain/types";
import { useLedgerStore } from "@/state/store";
import { parsePesos } from "@/lib/money";
import { nowForInput, monthKeyFromDate } from "@/lib/date";
import { AmountDisplay } from "./AmountDisplay";
import { TypeToggle } from "./TypeToggle";
import { CategoryRow, type LeafSelection } from "./CategoryRow";
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
 * @aitri-trace FR-ID: FR-207, US-ID: US-207, AC-ID: AC-207, TC-ID: TC-SUT-220h
 */
export function Register() {
  const nodes = useLedgerStore((s) => s.data.nodes);
  const add = useLedgerStore((s) => s.addMovement);

  const [type, setType] = useState<NodeType>("expense");
  const [rawAmount, setRawAmount] = useState("");
  const [sel, setSel] = useState<LeafSelection | null>(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [confirm, setConfirm] = useState<{ amount: number; type: NodeType } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDate(nowForInput());
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const amount = useMemo(() => parsePesos(rawAmount), [rawAmount]);
  const saveEnabled = amount > 0;

  /** Cambiar de tipo conserva el monto pero deselecciona la categoría (FR-208/FR-209). */
  function onChangeType(t: NodeType) {
    setType(t);
    setSel(null);
  }

  function resetForNext() {
    setRawAmount("");
    setSel(null);
    setNote("");
    setDate(nowForInput());
    setShowErrors(false);
  }

  function onSave() {
    if (amount <= 0 || sel === null) {
      setShowErrors(true);
      return;
    }
    const ok = add({
      type,
      catId: sel.catId,
      subId: sel.subId,
      amount,
      month: monthKeyFromDate(date),
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
      {confirm && <ConfirmOverlay amount={confirm.amount} type={confirm.type} />}

      <TypeToggle value={type} onChange={onChangeType} />

      <AmountDisplay amount={amount} type={type} onDigits={setRawAmount} error={showErrors && amount <= 0} />

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

      <DateTimeField value={date} onChange={setDate} />
      <NoteField value={note} onChange={setNote} />

      <SaveButton type={type} disabled={!saveEnabled} onClick={onSave} />
    </div>
  );
}
