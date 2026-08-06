"use client";
// @aitri-trace components:ReserveCells — feature transferencias (modelo v4, 2026-07-29): celdas
// transfer = APORTES del mes con validación techo/piso, fila «Retiros» operable desde la grilla
// (destino fijo Disponible en v1), marca «!» del plan y observaciones por celda.
//
// Módulo:       src/components/ReserveCells.tsx
// Propósito:    La superficie de Reservas en la grilla. La celda se edita como cualquier flujo
//               (corregir el aporte del mes — jamás genera retiros); el bloqueo del dominio no
//               puede pasar desapercibido (franja inline, el editor no se cierra). Los retiros
//               son explícitos: la fila «Retiros» pregunta de cuál alcancía sacar y envía a
//               Disponible, con toast + Deshacer.
// Dependencias: @/state/store, @/domain (reserve), ./reserveText, ./format, ./gridLayout, ./ui/popover.

import { useRef, useState } from "react";
import { useLedgerStore } from "@/state/store";
import type { MonthKey } from "@/domain/types";
import { MONTHS, monthLabel } from "@/domain/months";
import {
  cellObservations,
  CELL_NOTE_MAX,
  findNode,
  isAvailable,
  plannedRetiroLimit,
  reserveLeafIds,
  reserveRetiros,
  resolvedBalance,
  validateReserveWrite,
  type LedgerState,
  type Plane,
} from "@/domain";
import { budgetState, type BudgetState } from "@/domain/budgetState";
import { blockMessage } from "./reserveText";
import { cellNum, money } from "./format";
import { CELL_W } from "./gridLayout";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Trash2 } from "lucide-react";

/** Marca de forma del aviso de plan: canal no cromático PROPIO — ≠ ›/›› y ≠ ‹‹ (WCAG 1.4.1). */
const PLAN_WARN_GLYPH = "!";

// ── Celda transfer (aporte del mes) ────────────────────────────────────────────────────────────

/**
 * Celda de una hoja transfer: pinta el APORTE de ese mes (flujo, como Ingresos/Gastos). En Pres.,
 * la marca «!» + ámbar avisa que la suma de aportes planeados del mes supera su margen — avisa,
 * jamás bloquea. El punto de observaciones aflora las notas del mes.
 */
export function ReserveLeafCell(props: {
  leafId: string;
  month: MonthKey;
  plane: Plane;
  sep?: boolean;
  highlight?: boolean;
  planWarnMonths: Partial<Record<MonthKey, number>>;
  onStart: () => void;
}) {
  const data = useLedgerStore((s) => s.data);
  const map = props.plane === "budget" ? data.budgets : data.actuals;
  const value = map[props.leafId]?.[props.month] ?? 0;
  const planWarn = props.plane === "budget" && props.planWarnMonths[props.month] !== undefined && value > 0;

  // Las observaciones del mes (notas de operaciones De→A + manuales) afloran en la celda Ejec.
  const observations = props.plane === "actual" ? cellObservations(data, props.leafId, props.month) : [];

  const color = planWarn
    ? "var(--state-warning)"
    : props.plane === "budget"
      ? "var(--fg-secondary)"
      : value
        ? "var(--accent-light)"
        : "var(--fg-secondary)";
  const title = planWarn
    ? `Este plan supera tu margen de ${monthLabel(props.month).toLowerCase()}`
    : observations.length > 0
      ? observations.slice(0, 3).map((o) => o.text).join(" · ") + (observations.length > 3 ? ` · +${observations.length - 3} más` : "")
      : undefined;

  return (
    <div
      onClick={props.onStart}
      data-testid="cell-leaf"
      {...(planWarn ? { "data-plan-warn": "true" } : {})}
      title={title}
      className={cn(CELL_W, "relative flex items-center justify-end min-h-[34px] px-3 tabular border-b border-border whitespace-nowrap cursor-text", props.sep && "border-l-2 border-l-border-strong")}
      style={{ color, background: props.highlight ? "color-mix(in srgb, var(--accent) 6%, var(--bg))" : "var(--bg)" }}
    >
      {observations.length > 0 && (
        <span
          data-testid="note-dot"
          aria-hidden="true"
          className="absolute right-[3px] top-[3px] h-[4px] w-[4px] rounded-full"
          style={{ background: "var(--fg-muted)" }}
        />
      )}
      {planWarn ? (
        <span aria-hidden="true" className="flex-none mr-1 text-caption leading-none">
          {PLAN_WARN_GLYPH}
        </span>
      ) : null}
      {cellNum(value)}
    </div>
  );
}

// ── Editor de celda transfer ───────────────────────────────────────────────────────────────────

/**
 * Editor de una celda transfer: corrige el APORTE del mes. En BLOQUEO (techo del mes, o piso: el
 * cambio dejaría en rojo retiros ya operados) el editor NO se cierra — franja inline con el
 * mensaje y el valor seleccionado («corrige o Escape»). En Pres. escribe siempre (el plan avisa).
 */
export function ReserveCellEditor(props: {
  leafId: string;
  month: MonthKey;
  plane: Plane;
  sep?: boolean;
  highlight?: boolean;
  onClose: () => void;
}) {
  const data = useLedgerStore((s) => s.data);
  const applyReserveEdit = useLedgerStore((s) => s.applyReserveEdit);
  const { leafId, month, plane } = props;

  const map = plane === "budget" ? data.budgets : data.actuals;
  const current = map[leafId]?.[month] ?? 0;
  const [val, setVal] = useState(String(current || 0));
  const [block, setBlock] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /** Bloqueo: el editor queda abierto con el valor rechazado seleccionado («corrige o Escape»). */
  function fail(msg: string) {
    setBlock(msg);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function commit() {
    const value = Math.max(0, Math.round(Number(val) || 0));
    if (value === current) {
      props.onClose(); // sin cambio: no-op
      return;
    }
    const verdict = validateReserveWrite(data, { leafId, month, plane, newAmount: value });
    if (!verdict.ok) {
      fail(blockMessage(data, verdict, { editedMonth: month, attempted: value - current }));
      return;
    }
    applyReserveEdit(leafId, month, plane, value);
    props.onClose();
  }

  return (
    <div ref={rootRef} className={cn(CELL_W, "relative py-1 px-2", props.sep && "border-l-2 border-l-border-strong")} style={{ background: props.highlight ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined }}>
      <input
        ref={inputRef}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Editar valor"
        value={val}
        onChange={(e) => {
          setVal(e.target.value.replace(/[^0-9]/g, ""));
          setBlock(null);
        }}
        onBlur={(e) => {
          // El foco que se queda DENTRO del editor (observaciones) no comitea la celda.
          if (rootRef.current?.contains(e.relatedTarget as Node)) return;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") props.onClose(); // restaura el valor previo: nada se persistió
        }}
        className="tabular w-full bg-elevated border border-accent rounded-(--radius-sm) text-fg text-caption text-right px-1.5 py-1 outline-none"
      />

      <div className="absolute left-0 top-full z-20 flex flex-col items-start gap-1 min-w-[230px]">
        {block && (
          <div
            data-testid="reserve-block"
            role="alert"
            className="rounded-(--radius-sm) border px-2.5 py-1.5 text-[12px]"
            style={{ borderColor: "var(--error)", color: "var(--error)", background: "var(--bg-card)", boxShadow: "var(--shadow-md)" }}
          >
            {block}
          </div>
        )}
        {!block && plane === "actual" && (
          <div
            className="rounded-(--radius-sm) border border-border px-2.5 py-1.5 flex flex-col gap-1.5 min-w-[230px]"
            style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-md)" }}
          >
            <CellNotesSection leafId={leafId} month={month} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Observaciones por celda ────────────────────────────────────────────────────────────────────

/**
 * Sección «Observaciones» del editor: las notas de las operaciones De→A del mes llegan solas
 * (derivadas del journal) y se pueden añadir manuales (≤280, contador en --error al exceder).
 */
function CellNotesSection({ leafId, month }: { leafId: string; month: MonthKey }) {
  const data = useLedgerStore((s) => s.data);
  const addNote = useLedgerStore((s) => s.addCellNote);
  const [draft, setDraft] = useState("");
  const observations = cellObservations(data, leafId, month);
  const over = draft.length > CELL_NOTE_MAX;
  const canAdd = draft.trim().length > 0 && !over;

  return (
    <div data-testid="cell-notes" className="flex flex-col gap-1 text-[12px]">
      <span className="font-medium" style={{ color: "var(--fg-secondary)" }}>Observaciones</span>
      {observations.length === 0 ? (
        <span data-testid="cell-notes-empty" style={{ color: "var(--fg-muted)" }}>Sin observaciones este mes</span>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {observations.map((o, i) => (
            <li key={`${o.createdAt}-${i}`} data-testid="cell-note" className="break-words" style={{ color: "var(--fg)" }}>
              {o.text}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          aria-label="Añadir observación"
          value={draft}
          placeholder="Añadir observación"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation(); // el Enter de la nota no comitea la celda
            if (e.key === "Enter" && canAdd && addNote(leafId, month, draft)) setDraft("");
          }}
          className="w-full bg-elevated border border-border rounded-(--radius-sm) text-fg px-1.5 py-1 outline-none focus:border-accent"
        />
        <span data-testid="cell-note-counter" className="flex-none tabular" style={{ color: over ? "var(--error)" : "var(--fg-muted)" }}>
          {draft.length}/{CELL_NOTE_MAX}
        </span>
        <button
          data-testid="cell-note-add"
          disabled={!canAdd}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (addNote(leafId, month, draft)) setDraft("");
          }}
          className="flex-none cursor-pointer border-0 bg-transparent p-0 font-semibold disabled:cursor-default disabled:opacity-50"
          style={{ color: "var(--fg)" }}
        >
          Añadir
        </button>
      </div>
    </div>
  );
}

// ── Fila «Retiros» (operar desde la grilla) ────────────────────────────────────────────────────

/** Rótulo jerárquico de una alcancía: «Grupo · Categoría · Sub» (aplana el camino completo). */
function leafPathLabel(data: LedgerState, leafId: string): string {
  const parts: string[] = [];
  let cur = findNode(data.nodes, leafId);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? findNode(data.nodes, cur.parentId) : undefined;
  }
  return parts.join(" · ");
}

// Sobre-retiro (observación 1, 2026-07-29): el retiro ejecutado se gradúa contra el planeado con
// la MISMA regla de los gastos (budgetState) — neutro ≤100 %, ámbar >100 %, rojo ≥120 % o sin plan.
const RETIRO_STATE_COLOR: Record<BudgetState, string> = {
  within: "var(--type-transfer)",
  over_soft: "var(--state-warning)",
  over_hard: "var(--state-over)",
};
const RETIRO_STATE_GLYPH: Record<BudgetState, "" | "›" | "››"> = {
  within: "",
  over_soft: "›",
  over_hard: "››",
};

/**
 * Celda Pres. de la fila «Retiros del mes» (Balance): el retiro PLANEADO. Rechaza planear más de
 * lo que el propio plan habrá reservado hasta ese mes («Solo hay $X reservados en tu plan») —
 * franja inline, el editor no se cierra (observación 2, 2026-07-29).
 */
export function PlannedWithdrawCell({ month, sep }: { month: MonthKey; sep?: boolean }) {
  const data = useLedgerStore((s) => s.data);
  const setPlanned = useLedgerStore((s) => s.setPlannedRetiro);
  const value = reserveRetiros(data, month, "budget");
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [block, setBlock] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    const res = setPlanned(month, Math.max(0, Math.round(Number(val) || 0)));
    if (!res.ok) {
      setBlock(`Solo hay ${money(res.limit)} reservados en tu plan hasta ${monthLabel(month).toLowerCase()}`);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return;
    }
    setBlock(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className={cn(CELL_W, "relative py-1 px-2 bg-sunken border-b border-border", sep && "border-l-2 border-l-border-strong")}>
        <input
          ref={inputRef}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Retiro planeado"
          value={val}
          onChange={(e) => {
            setVal(e.target.value.replace(/[^0-9]/g, ""));
            setBlock(null);
          }}
          onBlur={() => {
            if (!block) commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setBlock(null);
              setEditing(false);
            }
          }}
          className="tabular w-full bg-elevated border border-accent rounded-(--radius-sm) text-fg text-caption text-right px-1.5 py-1 outline-none"
        />
        {block && (
          <div
            data-testid="planned-withdraw-block"
            role="alert"
            className="absolute left-0 top-full z-20 min-w-[230px] rounded-(--radius-sm) border px-2.5 py-1.5 text-[12px]"
            style={{ borderColor: "var(--error)", color: "var(--error)", background: "var(--bg-card)", boxShadow: "var(--shadow-md)" }}
          >
            {block}
          </div>
        )}
      </div>
    );
  }
  // Estado auto-sanador (hallazgo adversarial 7): si DESPUÉS de planear el retiro bajaron los
  // aportes del plan, la celda se marca sola — ámbar + «!», sin bloquear (es el plan).
  const uncovered = value > 0 && value > plannedRetiroLimit(data, month);
  return (
    <div
      data-testid="planned-withdraw-cell"
      data-month={month}
      {...(uncovered ? { "data-plan-warn": "true" } : {})}
      title={
        uncovered
          ? `Tu plan de aportes ya no cubre este retiro (hay ${money(plannedRetiroLimit(data, month))} reservados hasta ${monthLabel(month).toLowerCase()})`
          : "Retiro planeado del mes (haz clic para editar)"
      }
      onClick={() => {
        setVal(String(value || 0));
        setEditing(true);
      }}
      className={cn(CELL_W, "flex items-center justify-end min-h-[34px] px-3 tabular border-b border-border whitespace-nowrap cursor-text bg-sunken", sep && "border-l-2 border-l-border-strong")}
      style={{ color: uncovered ? "var(--state-warning)" : "var(--fg-secondary)" }}
    >
      {uncovered && <span aria-hidden="true" className="flex-none mr-1 text-caption leading-none">!</span>}
      {cellNum(value)}
    </div>
  );
}

/**
 * Celda Ejec. de la fila «Retiros del mes» (Balance): muestra la Σ del mes graduada contra el
 * retiro planeado (›/›› + ámbar/rojo al pasarse — misma regla que los gastos) y abre el mini-form
 * al clic: origen en lista desplegable con todas las alcancías y eliminación de retiros (corrección).
 */
export function WithdrawCell({ month, sep }: { month: MonthKey; sep?: boolean }) {
  const data = useLedgerStore((s) => s.data);
  const withdraw = useLedgerStore((s) => s.applyReserveWithdrawal);
  const removeWithdrawal = useLedgerStore((s) => s.removeReserveWithdrawal);
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const leaves = reserveLeafIds(data);
  const parsed = Math.round(Number(amount) || 0);
  const saldo = fromId ? resolvedBalance(data, fromId, month, "actual") : null;
  const canSave = fromId !== "" && parsed > 0 && (saldo === null || parsed <= saldo);

  // Sobre-retiro: ejecutado vs planeado, misma graduación que los gastos (observación 1).
  const total = reserveRetiros(data, month, "actual");
  const planned = reserveRetiros(data, month, "budget");
  const overState = budgetState(planned, total);

  // Los retiros YA operados este mes — con eliminación para corregir un error (observación 4).
  const monthRetiros = data.movements.filter(
    (m) => m.type === "transfer" && m.month === month && m.from && !isAvailable(m.from) && isAvailable(m.to)
  );

  function reset() {
    setFromId("");
    setAmount("");
    setError(null);
  }

  function save() {
    if (!fromId || parsed <= 0) return;
    const res = withdraw(fromId, month, parsed);
    if ("rejected" in res) {
      setError(
        res.rejected === "invalid_target" || res.rejected.ok
          ? "Operación inválida"
          : blockMessage(data, res.rejected, { editedMonth: month })
      );
      return;
    }
    setOpen(false);
    reset();
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <PopoverTrigger asChild>
        <button
          data-testid="withdraw-cell"
          data-month={month}
          {...(total > 0 && overState !== "within" ? { "data-over": overState } : {})}
          title="Sacar de una alcancía hacia Disponible (o corregir un retiro)"
          className={cn(CELL_W, "flex items-center justify-end min-h-[34px] px-3 tabular border-b border-border whitespace-nowrap cursor-pointer bg-sunken border-t-0 border-x-0", sep && "border-l-2 border-l-border-strong")}
          style={{ color: total ? RETIRO_STATE_COLOR[overState] : "var(--fg-secondary)" }}
        >
          {/* Canal no cromático (WCAG 1.4.1): mismo glifo ›/›› de los gastos al retirar de más. */}
          {total > 0 && RETIRO_STATE_GLYPH[overState] ? (
            <span aria-hidden="true" className="flex-none mr-1 text-caption leading-none">{RETIRO_STATE_GLYPH[overState]}</span>
          ) : null}
          {cellNum(total)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-3 flex flex-col gap-2 text-[12px]" align="end">
        <span className="font-medium" style={{ color: "var(--fg)" }}>
          Sacar en {monthLabel(month).toLowerCase()} → Disponible
        </span>

        {/* Origen: lista desplegable con TODAS las alcancías (jerarquía aplanada) y su saldo. */}
        <select
          aria-label="Sacar de"
          data-testid="withdraw-source"
          value={fromId}
          onChange={(e) => { setFromId(e.target.value); setError(null); }}
          className="w-full bg-elevated border border-border rounded-(--radius-sm) text-fg px-1.5 py-1.5 outline-none focus:border-accent"
        >
          <option value="" disabled>
            {leaves.length === 0 ? "No tienes alcancías" : "Elige de dónde sacar…"}
          </option>
          {leaves.map((id) => (
            <option key={id} value={id}>
              {leafPathLabel(data, id)} — {money(resolvedBalance(data, id, month, "actual"))}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <input
            aria-label="Monto a sacar"
            data-testid="withdraw-amount"
            value={amount}
            placeholder="$0"
            onChange={(e) => { setAmount(e.target.value.replace(/[^0-9]/g, "")); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) save(); }}
            className="tabular w-full bg-elevated border border-border rounded-(--radius-sm) text-fg text-right px-1.5 py-1 outline-none focus:border-accent"
          />
          {fromId !== "" && saldo !== null && (
            <span className="flex-none tabular" style={{ color: parsed > saldo ? "var(--error)" : "var(--fg-muted)" }}>
              Máx. {money(saldo)}
            </span>
          )}
        </div>
        {error && (
          <span role="alert" data-testid="withdraw-error" style={{ color: "var(--error)" }}>{error}</span>
        )}
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={() => { setOpen(false); reset(); }} className="cursor-pointer border-0 bg-transparent p-0" style={{ color: "var(--fg-secondary)" }}>
            Cancelar
          </button>
          <button
            data-testid="withdraw-save"
            disabled={!canSave}
            onClick={save}
            className="cursor-pointer border-0 bg-transparent p-0 font-semibold disabled:cursor-default disabled:opacity-50"
            style={{ color: "var(--fg)" }}
          >
            Sacar
          </button>
        </div>

        {/* Retiros del mes ya operados: eliminar = corregir (el saldo se restaura solo). */}
        {monthRetiros.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-2" data-testid="withdraw-history">
            <span className="font-medium" style={{ color: "var(--fg-secondary)" }}>Retiros de este mes</span>
            <ul className="flex flex-col gap-0.5">
              {monthRetiros.map((mv) => (
                <li key={mv.id} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: "var(--fg)" }}>
                    {leafPathLabel(data, mv.from!)} — <span className="tabular">{money(mv.amount)}</span>
                    {mv.note ? <span style={{ color: "var(--fg-muted)" }}> · {mv.note}</span> : null}
                  </span>
                  <button
                    aria-label="Eliminar retiro"
                    data-testid={`withdraw-delete-${mv.id}`}
                    title="Eliminar este retiro (corrige el error; el saldo de la alcancía se restaura)"
                    onClick={() => removeWithdrawal(mv.id)}
                    className="flex-none cursor-pointer border-0 bg-transparent p-[3px] rounded-md text-fg-muted hover:text-fg"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

