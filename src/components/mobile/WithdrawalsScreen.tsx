"use client";
// @aitri-trace components:mobile:WithdrawalsScreen — feature presupuesto-movil (FR-3110).
//
// Módulo:       src/components/mobile/WithdrawalsScreen.tsx
// Propósito:    Ver, corregir y borrar los retiros del periodo. Sacar plata NO se hace aquí: se hace
//               desde Registrar → Reserva (decisión del usuario). Corregir y borrar usan la misma
//               acción de escritorio (`editReserveOp`; 0 elimina).
// Dependencias: @/state/store, @/domain, ../cycleText, ../format, ../reserveText, ./amountDraft,
//               ./DetailHeader, ./screenStack, ./tone, ./withdrawalRows.

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { cellGlyph, cellTone } from "@/domain/budgetState";
import { formatDay, reserveRetiros } from "@/domain";
import type { PeriodKey } from "@/domain/types";
import { useCalendar, useLedgerStore } from "@/state/store";
import { cycleLabel } from "../cycleText";
import { cellNum, money } from "../format";
import { blockMessage } from "../reserveText";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { amountDraftState } from "./amountDraft";
import { DetailHeader } from "./DetailHeader";
import { ClosedNotice } from "./PeriodBar";
import { REGISTRAR, replaceScreen } from "./screenStack";
import { toneColor } from "./tone";
import { withdrawalRows, type WithdrawalRow } from "./withdrawalRows";

const ICON_BUTTON =
  "flex h-(--control-md) w-(--control-md) flex-none items-center justify-center rounded-(--radius-sm) text-fg-secondary";
const CARD = "elevated-sm min-w-0 rounded-(--radius-md) border border-border bg-card p-3";

/**
 * Una operación de la lista, con su corrección en el sitio y su confirmación de borrado.
 *
 * @param row Operación.
 * @param editable false en un periodo cerrado: sin lápiz ni papelera.
 * @param onAmount Aplica un monto nuevo (0 elimina) y devuelve el motivo si se rechaza.
 */
function OpRow({ row, editable, onAmount }: { row: WithdrawalRow; editable: boolean; onAmount: (amount: number) => string | null }) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const draft = amountDraftState(raw);

  // El periodo se cerró con la corrección o la confirmación abiertas: se retiran (FR-3112).
  useEffect(() => {
    if (!editable) setMode("view");
  }, [editable]);

  const apply = (amount: number) => {
    if (!editable) return;
    const rejection = onAmount(amount);
    setError(rejection);
    if (!rejection) setMode("view");
  };

  return (
    <li data-testid="mb-retiro-row" data-op-id={row.id} data-retiro={row.countsAsRetiro} className="border-b border-border py-2">
      <div className="flex min-h-[52px] items-center gap-2">
        <div className="min-w-0 flex-1">
          <div data-testid="mb-retiro-ends" className="label truncate font-normal text-fg">{row.from} → {row.to}</div>
          <div className="caption truncate text-fg-muted">
            {[row.date ? formatDay(row.date) : null, row.note].filter(Boolean).join(" · ") || "Sin nota"}
          </div>
        </div>
        <span data-testid="mb-retiro-amount" className="tabular label flex-none">{cellNum(row.amount)}</span>
        {editable && mode === "view" && (
          <>
            <button
              type="button"
              data-testid="mb-retiro-edit"
              aria-label={`Corregir el retiro de ${money(row.amount)}`}
              className={ICON_BUTTON}
              onClick={() => { setRaw(String(row.amount)); setError(null); setMode("edit"); }}
            >
              <Pencil size={18} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              data-testid="mb-retiro-delete"
              aria-label={`Borrar el retiro de ${money(row.amount)}`}
              className={`${ICON_BUTTON} -mr-2`}
              onClick={() => { setError(null); setMode("confirm"); }}
            >
              <Trash2 size={18} strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>

      {mode === "edit" && (
        <div data-testid="mb-retiro-editing" className="mt-1 flex items-center gap-2">
          <Input
            autoFocus
            inputMode="numeric"
            aria-label="Monto del retiro"
            aria-invalid={!!draft.error || !!error || undefined}
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !draft.disabled && draft.value !== null) apply(draft.value);
              if (e.key === "Escape") setMode("view");
            }}
            className="tabular h-(--control-lg) min-w-0 flex-1"
          />
          <Button
            type="button"
            data-testid="mb-retiro-save"
            className="h-(--control-lg)"
            disabled={draft.disabled}
            onClick={() => { if (draft.value !== null) apply(draft.value); }}
          >
            Guardar
          </Button>
          <Button type="button" variant="ghost" data-testid="mb-retiro-cancel" className="h-(--control-lg)" onClick={() => { setError(null); setMode("view"); }}>
            Cancelar
          </Button>
        </div>
      )}

      {mode === "confirm" && (
        <div data-testid="mb-confirm-delete" role="alertdialog" aria-label="Confirmar borrado" className="mt-1 rounded-(--radius-md) border border-border-strong bg-card p-3">
          <p className="label font-normal text-fg">¿Borrar este retiro de {money(row.amount)}?</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" data-testid="mb-confirm-no" className="h-(--control-lg)" onClick={() => setMode("view")}>
              Cancelar
            </Button>
            <Button
              type="button"
              data-testid="mb-confirm-yes"
              className="h-(--control-lg)"
              style={{ background: "var(--alert-strong)", borderColor: "var(--alert-strong)", color: "var(--on-accent)" }}
              onClick={() => apply(0)}
            >
              Borrar
            </Button>
          </div>
        </div>
      )}

      {(error || (mode === "edit" && draft.error)) && (
        <p data-testid="mb-retiro-error" role="alert" className="caption mt-1" style={{ color: "var(--alert-strong)" }}>
          {error ?? draft.error}
        </p>
      )}
    </li>
  );
}

/**
 * Pantalla «Retiros del mes».
 *
 * @param period Periodo mostrado.
 * @param closed Si está cerrado: se ve la lista, sin acciones (FR-3112).
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3110, US-ID: US-3110, AC-ID: AC-3127, TC-ID: TC-PMV-090h, TC-PMV-096e
 * @aitri-trace FR-ID: FR-3110, US-ID: US-3110, AC-ID: AC-3128, TC-ID: TC-PMV-091h, TC-PMV-092e, TC-PMV-093f
 * @aitri-trace FR-ID: FR-3110, US-ID: US-3110, AC-ID: AC-3129, TC-ID: TC-PMV-094f
 */
export function WithdrawalsScreen({ period, closed }: { period: PeriodKey; closed: boolean }) {
  const data = useLedgerStore((s) => s.data);
  const cal = useCalendar();
  const editReserveOp = useLedgerStore((s) => s.editReserveOp);
  const showToast = useLedgerStore((s) => s.showToast);
  const rows = useMemo(() => withdrawalRows(data, period), [data, period]);
  const planned = reserveRetiros(data, period, "budget");
  const actual = reserveRetiros(data, period, "actual");
  const glyph = cellGlyph("expense", planned, actual);
  const label = cycleLabel(cal, period);

  const change = (row: WithdrawalRow) => (amount: number): string | null => {
    if (amount === row.amount) return null;
    const r = editReserveOp(row.id, amount);
    if (r.ok) {
      showToast(amount === 0 ? "Retiro borrado" : "Retiro corregido");
      return null;
    }
    // Mismo texto que la fila de escritorio. `ok: true` no llega aquí, pero el tipo lo admite.
    return r.rejected === "invalid_target" || r.rejected.ok
      ? "Ese monto no es válido."
      : blockMessage(data, r.rejected, { editedMonth: period });
  };

  return (
    <div data-testid="mb-retiros">
      <DetailHeader title="Retiros del mes" context={`Reservas · ${label}`} />
      {closed && <ClosedNotice period={period} />}
      <div className="my-3 grid grid-cols-2 gap-3">
        <div data-testid="mb-amount-card-budget" className={CARD}>
          <div className="eyebrow">Pres.</div>
          <div data-testid="mb-amount-value" className="tabular display mt-1.5 whitespace-nowrap">{cellNum(planned)}</div>
        </div>
        <div data-testid="mb-amount-card-actual" className={CARD}>
          <div className="eyebrow">Ejec.</div>
          <div
            data-testid="mb-amount-value"
            className="tabular display mt-1.5 whitespace-nowrap"
            style={{ color: toneColor(cellTone("expense", planned, actual)) }}
          >
            {actual ? `${glyph ? `${glyph} ` : ""}${cellNum(actual)}` : "—"}
          </div>
        </div>
      </div>

      <h2 className="eyebrow mb-1">Operaciones de este mes</h2>
      {rows.length === 0 ? (
        <div data-testid="mb-retiros-empty" className="py-4">
          <p className="label font-normal text-fg-secondary">
            Sin operaciones este mes. Para sacar de una alcancía, usa Registrar → Reserva.
          </p>
          <Button type="button" data-testid="mb-go-register" className="mt-3 h-(--control-md)" onClick={() => replaceScreen(REGISTRAR)}>
            Ir a Registrar
          </Button>
        </div>
      ) : (
        <>
          <ul className="m-0 list-none p-0">
            {rows.map((r) => <OpRow key={r.id} row={r} editable={!closed} onAmount={change(r)} />)}
          </ul>
          <p className="caption mt-3 text-fg-muted">Para sacar de una alcancía, usa Registrar → Reserva.</p>
        </>
      )}
    </div>
  );
}
