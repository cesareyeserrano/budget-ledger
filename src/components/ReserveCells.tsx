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

import { useEffect, useRef, useState } from "react";
import { useLedgerStore } from "@/state/store";
import type { MonthKey, Movement } from "@/domain/types";
import { MONTHS, monthLabel } from "@/domain/months";
import {
  cellObservations,
  CELL_NOTE_MAX,
  findNode,
  isAvailable,
  plannedRetiroLimit,
  cellHeadroom,
  maxWithdrawal,
  monthCarryUsage,
  monthReserveOps,
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
import { Info } from "lucide-react";


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
  // FR-1804 — y la automática, si esta celda aportó en un mes que se completó del saldo anterior.
  const carry =
    props.plane === "actual" && value > 0 ? monthCarryUsage(data, props.month, "actual") : null;

  const color = planWarn
    ? "var(--state-warning)"
    : props.plane === "budget"
      ? "var(--fg-secondary)"
      : value
        ? "var(--accent-light)"
        : "var(--fg-secondary)";
  const title = planWarn
    ? `Este plan supera tu margen de ${monthLabel(props.month).toLowerCase()}`
    : carry
      ? `De los ${money(carry.reservado)} reservados este mes, ${money(carry.delSaldoAnterior)} salieron del saldo de ${monthLabel(carry.mesAnterior).toLowerCase()}.`
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
      {(observations.length > 0 || carry) && (
        <span
          data-testid="note-dot"
          aria-hidden="true"
          className="absolute right-[2px] top-[2px] h-[7px] w-[7px] rounded-full border"
          style={{ background: "var(--alert-soft)", borderColor: "var(--bg)" }}
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
  // FR-1808: el TOTAL máximo que esta celda admite, visible antes de teclear.
  //
  // Es `cellHeadroom`, no `reserveHeadroom`: aquel devuelve el INCREMENTO que aún cabe en el mes, y
  // la celda contiene un TOTAL. Una celda que vale 1.000 en un mes con el cupo agotado admite
  // perfectamente que se la baje a 800; mostrarle «Máx. 0» y pintarla en rojo sería mentirle sobre
  // una escritura válida (TC-TDF-072f).
  const headroom = plane === "actual" ? cellHeadroom(data, leafId, month, plane) : null;
  const [block, setBlock] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ¿Se pasa? Se evalúa MIENTRAS teclea, no al confirmar: la señal llega antes del rechazo. Compara
  // el TOTAL tecleado contra el total admitido — no el incremento, que es lo que hacía antes.
  const excede = headroom !== null && Math.max(0, Math.round(Number(val) || 0)) > headroom;

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
      fail(
        blockMessage(data, verdict, {
          editedMonth: month,
          attempted: value - current,
          // El mismo TOTAL que el indicador «Máx.» muestra: un solo número para el mismo límite.
          ...(headroom !== null ? { maxTotal: headroom } : {}),
        })
      );
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
        className="tabular w-full min-w-0 bg-elevated border border-accent rounded-(--radius-sm) text-fg text-caption text-right px-1.5 py-1 outline-none"
      />

      {/* FR-1808 — el «Máx.» FUERA del flujo horizontal: la celda mide 108px y con las cifras reales
          del usuario («Máx. 10.200.000») el input se quedaba sin sitio para escribir. Va absolute
          bajo el input, donde ya vive el mensaje de rechazo, así que no consume ancho ni desplaza
          las celdas vecinas (AC-1833). Forma elegida por el usuario sobre una comparación
          renderizada a escala real. */}
      <div className="absolute left-0 top-full z-20 flex flex-col items-start gap-1 min-w-[230px]">
        {headroom !== null && (
          <span
            data-testid="reserve-max"
            title={`El máximo que admite esta celda en ${monthLabel(month).toLowerCase()}`}
            className="tabular text-caption leading-none whitespace-nowrap rounded-(--radius-sm) border px-1.5 py-1"
            style={{
              color: excede ? "var(--alert-strong)" : "var(--fg-muted)",
              borderColor: excede ? "var(--alert-strong)" : "var(--border)",
              background: "var(--bg-elevated)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            Máx. {money(headroom)}
          </span>
        )}
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
/**
 * Las observaciones de una celda: las existentes y el campo para añadir una.
 *
 * Exportada desde FR-1809: hasta esta feature solo vivía en las celdas de bolsillos, y el usuario
 * pidió que TODAS las celdas admitan observación. La consume también el editor de celdas de gasto e
 * ingreso de `BudgetGrid`, en vez de duplicarla allí y dejar que las dos copias divergan.
 */
export function CellNotesSection({ leafId, month }: { leafId: string; month: MonthKey }) {
  const data = useLedgerStore((s) => s.data);
  const addNote = useLedgerStore((s) => s.addCellNote);
  const [draft, setDraft] = useState("");
  const observations = cellObservations(data, leafId, month);
  // FR-1804 — la observación AUTOMÁTICA del mes, en la celda donde se reservó (que es donde el
  // usuario la busca). Se muestra solo si ESTA celda es un BOLSILLO y aportó ese mes: con FR-1809
  // esta sección vive también en celdas de gasto e ingreso, y sin la guarda de tipo la nota de
  // reservas aparecía al editar un GASTO cualquiera (auditoría 2026-09-01) — «de los $600
  // reservados…» en una celda que no reservó nada.
  const esBolsillo = findNode(data.nodes, leafId)?.type === "transfer";
  const aporto = esBolsillo && (data.actuals[leafId]?.[month] ?? 0) > 0;
  const carry = aporto ? monthCarryUsage(data, month, "actual") : null;
  const over = draft.length > CELL_NOTE_MAX;
  const canAdd = draft.trim().length > 0 && !over;

  return (
    <div data-testid="cell-notes" className="flex flex-col gap-1 text-[12px]">
      <span className="font-medium" style={{ color: "var(--fg-secondary)" }}>Observaciones</span>
      {carry ? (
        <div data-testid="carry-note" className="flex items-start gap-1.5 rounded-(--radius-xs) px-1.5 py-1" style={{ background: "color-mix(in srgb, var(--alert-soft) 8%, transparent)" }}>
          <Info size={12} className="flex-none mt-[2px]" style={{ color: "var(--alert-soft)" }} aria-hidden="true" />
          <span style={{ color: "var(--fg)" }}>
            De los <span className="tabular">{money(carry.reservado)}</span> reservados este mes,{" "}
            <span className="tabular">{money(carry.delSaldoAnterior)}</span> salieron del saldo de{" "}
            {monthLabel(carry.mesAnterior).toLowerCase()}.
          </span>
        </div>
      ) : null}
      {observations.length === 0 && !carry ? (
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
export function WithdrawCell({
  month,
  sep,
}: {
  month: MonthKey;
  sep?: boolean;
}) {
  const data = useLedgerStore((s) => s.data);
  const withdraw = useLedgerStore((s) => s.applyReserveWithdrawal);
  const removeWithdrawal = useLedgerStore((s) => s.removeReserveWithdrawal);
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const leaves = reserveLeafIds(data);
  const parsed = Math.round(Number(amount) || 0);
  // El tope NO es el saldo del mes: si un mes posterior ya retiró de esa misma plata, el saldo
  // sobreestima (auditoría 2026-09-01: mostraba Máx. $1.000 donde solo cabían $200). `maxWithdrawal`
  // mira la serie completa — la misma cuenta que el dominio va a validar.
  const saldo = fromId ? maxWithdrawal(data, fromId, month) : null;
  const canSave = fromId !== "" && parsed > 0 && (saldo === null || parsed <= saldo);

  // Sobre-retiro: ejecutado vs planeado, misma graduación que los gastos (observación 1).
  const total = reserveRetiros(data, month, "actual");
  const planned = reserveRetiros(data, month, "budget");
  const overState = budgetState(planned, total);

  // Las operaciones del mes ya registradas — retiros Y MOVERES (FR-1609). El mover se identifica
  // por sus DOS extremos; antes ni siquiera se listaba, así que quedaba atrapado sin forma de
  // corregirlo desde la interfaz.
  const monthOps = monthReserveOps(data, month);

  function reset() {
    setFromId("");
    setAmount("");
    setNote("");
    setError(null);
  }

  function save() {
    if (!fromId || parsed <= 0) return;
    const res = withdraw(fromId, month, parsed, note.trim() === "" ? null : note.trim());
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
          {`Sacar en ${monthLabel(month).toLowerCase()} → Disponible`}
        </span>

        {/* Origen: el desplegable con todas las alcancías y su saldo. La puerta con origen ya
            resuelto se retiró con el botón de la fila (FR-1807): la fila «Retiros del mes» vive
            ahora en el segmento de Reservas, junto a los bolsillos, que es lo que resolvía BL-019. */}
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
        {/* FR-1608 — el «¿para qué?». El dominio ya aceptaba la nota y la UI la descartaba: sin ella,
            ahorrar para algo y pagarlo son dos actos que la app no relaciona. Opcional siempre. */}
        <input
          aria-label="¿Para qué? (opcional)"
          data-testid="withdraw-note"
          value={note}
          maxLength={CELL_NOTE_MAX}
          placeholder="¿Para qué? (opcional)"
          onChange={(e) => setNote(e.target.value)}
          className="w-full bg-elevated border border-border rounded-(--radius-sm) text-fg px-1.5 py-1 outline-none focus:border-accent"
          style={{ color: "var(--fg)" }}
        />
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

        {/* Operaciones del mes: eliminar = corregir (el saldo se restaura por construcción). Desde
            FR-1609 la lista incluye los MOVERES, que antes no aparecían — y por eso no había forma
            de deshacer uno equivocado salvo hacer el mover inverso a mano. */}
        {monthOps.length > 0 ? (
          <div className="flex flex-col gap-1 border-t border-border pt-2" data-testid="withdraw-history">
            <span className="font-medium" style={{ color: "var(--fg-secondary)" }}>Operaciones de este mes</span>
            <ul className="flex flex-col gap-0.5">
              {monthOps.map((mv) => (
                <OpRow key={mv.id} mv={mv} />
              ))}
            </ul>
          </div>
        ) : (
          <div className="border-t border-border pt-2" data-testid="withdraw-history-empty" style={{ color: "var(--fg-muted)" }}>
            Sin operaciones este mes
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}




/**
 * Una operación del mes en la lista de corrección, con su MONTO EDITABLE (FR-1802).
 *
 * Sustituye al botón de borrar: teclear un monto nuevo corrige la operación —conservando su fecha y
 * su identidad— y teclear 0 la elimina. Es la vía que la regla del techo hace necesaria: con el
 * cupo del mes agotado, devolver plata al bolsillo registrando un aporte nuevo se rechazaría, y
 * además inflaría la celda de reservas. Palabras del usuario: «si retiré 500, pero ahora de esos
 * 500 quiero volver a guardar 200, debería poder editar los 500 a 300».
 *
 * Un rechazo NO se traga: devuelve el campo a su valor previo y muestra el motivo nombrando el mes
 * que quedaría sin respaldo — la corrección es justamente la puerta por la que el usuario se
 * encerró antes de esta feature (FR-1803).
 *
 * @aitri-trace FR-ID: FR-1802, US-ID: US-1802, AC-ID: AC-1805, TC-ID: TC-TDF-091h, TC-TDF-092e
 */
function OpRow({ mv }: { mv: Movement }) {
  const data = useLedgerStore((s) => s.data);
  const editOp = useLedgerStore((s) => s.editReserveOp);
  const esMover = !isAvailable(mv.to);
  const [val, setVal] = useState(String(mv.amount));
  const [error, setError] = useState<string | null>(null);

  // El monto vigente manda: si otra superficie lo cambió, el campo lo sigue.
  useEffect(() => { setVal(String(mv.amount)); setError(null); }, [mv.amount]);

  function commit() {
    const n = Math.max(0, Math.round(Number(val) || 0));
    if (n === mv.amount) return;
    const res = editOp(mv.id, n);
    if (res.ok) { setError(null); return; }
    setVal(String(mv.amount)); // el rechazo no muta: el campo vuelve a lo que había
    // `ok: true` no es alcanzable aquí (el store solo devuelve el veredicto cuando bloqueó), pero
    // el tipo lo admite, así que se estrecha en vez de castear.
    const v = res.rejected;
    setError(
      v === "invalid_target" || v.ok
        ? "Ese monto no es válido."
        : blockMessage(data, v, { editedMonth: mv.month })
    );
  }

  return (
    <li className="flex flex-col gap-0.5" data-testid={esMover ? "op-mover" : "op-retiro"}>
      <div className="flex items-center gap-2">
        {/* La fecha del movimiento (los creados antes de FR-1802 pueden no tenerla: hueco, no "hoy"). */}
        <span className="flex-none tabular w-[38px]" style={{ color: "var(--fg-muted)" }}>
          {mv.date ? `${mv.date.slice(8, 10)}/${mv.date.slice(5, 7)}` : "—"}
        </span>
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: "var(--fg)" }}>
          {leafPathLabel(data, mv.from!)} → {esMover ? leafPathLabel(data, mv.to!) : "Disponible"}
          {mv.note ? <span style={{ color: "var(--fg-muted)" }}> · {mv.note}</span> : null}
        </span>
        <input
          aria-label={`Monto de ${esMover ? "el movimiento" : "el retiro"} de ${leafPathLabel(data, mv.from!)}`}
          data-testid={`op-amount-${mv.id}`}
          value={val}
          inputMode="numeric"
          onChange={(e) => { setVal(e.target.value.replace(/[^0-9]/g, "")); setError(null); }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.currentTarget.blur(); }
            if (e.key === "Escape") { setVal(String(mv.amount)); setError(null); e.currentTarget.blur(); }
          }}
          className="flex-none w-24 tabular text-right bg-card border border-border rounded-(--radius-xs) text-fg px-1.5 py-0.5 outline-none focus:border-accent"
        />
      </div>
      {error ? (
        <span role="alert" data-testid={`op-error-${mv.id}`} className="pl-1" style={{ color: "var(--alert-strong)" }}>
          {error}
        </span>
      ) : null}
    </li>
  );
}
