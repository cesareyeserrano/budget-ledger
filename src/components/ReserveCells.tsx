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
import { useLedgerStore, useActivePeriods, useCalendar } from "@/state/store";
import { cycleLabel } from "./cycleText";
import type { PeriodKey, Movement } from "@/domain/types";
import { periodMonthLabel, periodLabel } from "@/domain/periods";
import {
  cellObservations,
  CELL_NOTE_MAX,
  findNode,
  isAvailable,
  plannedRetiroLimit,
  cellHeadroom,
  maxWithdrawal,
  carryUsageText,
  monthCarryUsage,
  monthReserveOps,
  reserveLeafIds,
  reserveRetiros,
  resolvedBalance,
  plannedRetiroRows,
  validateReserveWrite,
  type PlannedRetiroRow,
  type LedgerState,
  type Plane,
} from "@/domain";
import { budgetState, type BudgetState } from "@/domain/budgetState";
import { blockMessage } from "./reserveText";
import { cellNum, money } from "./format";
import { CELL_W } from "./gridLayout";
import { FOCUS_RING, cellAriaLabel, cellButtonProps } from "./gridKeyboard";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { CellDetail } from "./CellDetail";


// ── Celda transfer (aporte del mes) ────────────────────────────────────────────────────────────

/**
 * Celda de una hoja transfer: pinta el APORTE de ese mes (flujo, como Ingresos/Gastos). El punto de
 * observaciones aflora las notas del mes.
 *
 * FR-2905 (carril-de-presupuesto): la celda Pres. ya no lleva el aviso ámbar «!». El plan bloquea
 * como lo real (FR-2904) y un mes del plan que ya se pasaba se marca en el encabezado del mes, igual
 * que en Ejecutado — un solo sistema de aviso para los dos planos.
 *
 * @aitri-trace FR-ID: FR-2905, US-ID: US-2905, AC-ID: AC-2918, TC-ID: TC-CDP-042f
 */
export function ReserveLeafCell(props: {
  leafId: string;
  /** Nombre del bolsillo, para el nombre accesible de la celda (BG-069). */
  nodeName: string;
  month: PeriodKey;
  plane: Plane;
  sep?: boolean;
  highlight?: boolean;
  onStart: () => void;
}) {
  const data = useLedgerStore((s) => s.data);
  const periods = useActivePeriods();
  const cal = useCalendar();
  const map = props.plane === "budget" ? data.budgets : data.actuals;
  // saldo-de-bolsillo (NFR-3005, decisión del usuario del 2026-09-27): la celda es lo APORTADO ese mes.
  // Nada de la grilla arrastra; lo acumulado vive en el Balance.
  const value = map[props.leafId]?.[props.month] ?? 0;

  // Los COMENTARIOS escritos en la celda afloran en la celda Ejec., como en cualquier otra (BG-084):
  // la nota de un movimiento va con su movimiento, y se lee al abrir el Detalle — el de un aporte en
  // esta celda, el de un retiro en «Retiros del mes». Antes el punto también se encendía con la nota
  // de un retiro, y su título la mostraba junto al aporte del mes como si lo describiera.
  const observations = props.plane === "actual"
    ? cellObservations(data, props.leafId, props.month, periods).filter((o) => o.source === "manual")
    : [];
  // FR-1804 — y la automática, si esta celda aportó en un mes que se completó del saldo anterior.
  const carry =
    props.plane === "actual" && value > 0 ? monthCarryUsage(data, props.month, "actual", periods) : null;

  const color = props.plane === "budget"
    ? "var(--fg-secondary)"
    : value
      ? "var(--accent-light)"
      : "var(--fg-secondary)";
  const title = carry
    ? carryUsageText(carry, money)
    : observations.length > 0
      ? observations.slice(0, 3).map((o) => o.text).join(" · ") + (observations.length > 3 ? ` · +${observations.length - 3} más` : "")
      : undefined;

  return (
    <div
      onClick={props.onStart}
      // BG-069: alcanzable con Tab y abierta con Enter, igual que la celda de gasto e ingreso.
      {...cellButtonProps(cellAriaLabel(props.nodeName, props.plane, cycleLabel(cal, props.month), cellNum(value)), props.onStart)}
      data-testid="cell-leaf"
      // Los mismos atributos que emite `Cell` para gasto e ingreso (BudgetGrid): sin ellos una celda
      // de bolsillo solo se podía localizar contando columnas, y el Detalle —que ahora vive también
      // aquí (FR-2501)— no tenía forma estable de señalarla. Aditivo: nada los consumía antes.
      data-cell={props.leafId}
      data-month={props.month}
      data-plane={props.plane}
      title={title}
      className={cn(CELL_W, "relative flex items-center justify-end min-h-[34px] px-3 tabular border-b border-border whitespace-nowrap cursor-text", FOCUS_RING, "focus-visible:ring-inset", props.sep && "border-l-2 border-l-border-strong")}
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
      {cellNum(value)}
    </div>
  );
}

// ── Editor de celda transfer ───────────────────────────────────────────────────────────────────

/**
 * Editor de una celda transfer: corrige el APORTE del mes. En BLOQUEO (techo del mes, o piso: el
 * cambio dejaría en rojo retiros ya operados) el editor NO se cierra — franja inline con el
 * mensaje y el valor seleccionado («corrige o Escape»). Igual en los dos planos desde FR-2905: el
 * plan muestra su «Máx.» y rechaza como lo real (antes escribía siempre y solo avisaba).
 *
 * @aitri-trace FR-ID: FR-2905, US-ID: US-2905, AC-ID: AC-2916, TC-ID: TC-CDP-040h, TC-CDP-041h, TC-CDP-043h, TC-CDP-044e, TC-CDP-050e
 */
export function ReserveCellEditor(props: {
  leafId: string;
  month: PeriodKey;
  plane: Plane;
  sep?: boolean;
  highlight?: boolean;
  /** Mes cerrado (FR-2003): el editor abre SOLO con observaciones, sin campo de importe (NFR-3004). */
  closed?: boolean;
  onClose: () => void;
}) {
  const data = useLedgerStore((s) => s.data);
  const periods = useActivePeriods();
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
  // FR-2905: en los dos planos, cada uno con su carril (FR-2903).
  const headroom = cellHeadroom(data, leafId, month, plane, periods);
  const [block, setBlock] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // BG-069: en un mes cerrado no hay campo que tome el foco. Abierta con el teclado, la celda se
  // desmontaba con el foco dentro y el Escape nunca llegaba a este contenedor: el panel quedaba
  // abierto sin salida. Mismo arreglo que ya tenía la celda de gasto e ingreso (EditableCell).
  useEffect(() => { if (props.closed) rootRef.current?.focus(); }, [props.closed]);

  // ¿Se pasa? Se evalúa MIENTRAS teclea, no al confirmar: la señal llega antes del rechazo. Compara
  // el TOTAL tecleado contra el total admitido — no el incremento, que es lo que hacía antes.
  const excede = Math.max(0, Math.round(Number(val) || 0)) > headroom;

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
    const verdict = validateReserveWrite(data, { leafId, period: month, plane, newAmount: value }, periods);
    if (!verdict.ok) {
      fail(
        blockMessage(data, verdict, {
          editedMonth: month,
          attempted: value - current,
          // El mismo TOTAL que el indicador «Máx.» muestra: un solo número para el mismo límite.
          maxTotal: headroom,
        })
      );
      return;
    }
    applyReserveEdit(leafId, month, plane, value);
    props.onClose();
  }

  // NFR-3004 (saldo-de-bolsillo): en un mes cerrado no se ofrece escribir el aporte —el servidor lo
  // rechazaría— pero las observaciones siguen abiertas (FR-2004), igual que en gasto e ingreso.
  if (props.closed) {
    return (
      <div ref={rootRef} tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") props.onClose(); }}
        onBlur={(e) => { if (!rootRef.current?.contains(e.relatedTarget as Node)) props.onClose(); }}
        className={cn(CELL_W, "relative py-1 px-2 outline-none", props.sep && "border-l-2 border-l-border-strong")}>
        <span data-testid="closed-value" className="tabular text-caption text-fg-secondary flex justify-end px-1.5 py-1">{cellNum(current)}</span>
        <div className="absolute left-0 top-full z-20 min-w-[230px]">
          {plane === "actual" && <CellDetail leafId={leafId} month={month} />}
        </div>
      </div>
    );
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
        <span
          data-testid="reserve-max"
          title={`El máximo que admite esta celda en ${periodLabel(month).toLowerCase()}`}
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
        {/* FR-2501/FR-2508: el panel de la celda de bolsillo es el MISMO Detalle que el de gasto e
            ingreso — el aviso automático, los aportes del mes como movimientos y lo escrito en la
            celda como su diferencia (BG-084). La regla de edición del valor del bolsillo no cambia
            (NFR-2503). */}
        {!block && plane === "actual" && <CellDetail leafId={leafId} month={month} />}
      </div>
    </div>
  );
}

// El campo de comentario de una celda vive ahora en `CellNoteInput` y el panel entero en
// `CellDetail` (feature diario-de-celda, FR-2508): esta sección era el panel completo —título,
// aviso automático, lista y campo— y se repartió en esas dos piezas.

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

/** Los textos del formulario por plano: el mismo formulario, dicho para sacar o para planear (FR-3001). */
const WITHDRAW_TEXT: Record<Plane, { title: string; save: string; list: string; empty: string; trigger: string }> = {
  actual: {
    title: "Sacar en",
    save: "Sacar",
    list: "Operaciones de este mes",
    empty: "Sin operaciones este mes",
    trigger: "Sacar de una alcancía hacia Disponible (o corregir un retiro)",
  },
  budget: {
    title: "Planear sacar en",
    save: "Planear",
    list: "Retiros planeados de este mes",
    empty: "Sin retiros planeados este mes",
    trigger: "Planear sacar de una alcancía (o corregir un retiro planeado)",
  },
};

/**
 * Celda de la fila «Retiros del mes», en los dos planos, y el formulario que abre.
 *
 * Ejec.: muestra la Σ del mes graduada contra lo planeado (›/›› + ámbar/rojo al pasarse, misma regla
 * que los gastos) y abre el mini-form: origen en lista desplegable con todas las alcancías y la lista de
 * operaciones del mes, corregibles.
 *
 * Pres. (saldo-de-bolsillo, FR-3001): «el mismo formulario que tiene retiros del mes en ejecutado va en
 * presupuestado» (usuario, 2026-09-27). Mismos controles, teclas y testids; cambian los textos, el saldo
 * que se lee (el del plan), la acción (planear, no sacar) y la lista (retiros planeados por alcancía, con
 * sus notas). Un mes cerrado no abre el formulario del plan (NFR-3004). Conserva la marca ámbar de un
 * retiro planeado legado sin respaldo (BG-020).
 *
 * @aitri-trace FR-ID: FR-3001, US-ID: US-3001, AC-ID: AC-3001, TC-ID: TC-SDB-001h, TC-SDB-002h, TC-SDB-003f, TC-SDB-004f, TC-SDB-005e
 * @aitri-trace FR-ID: FR-3004, US-ID: US-3004, AC-ID: AC-3012, TC-ID: TC-SDB-040h, TC-SDB-041e
 */
export function WithdrawCell({
  month,
  sep,
  plane = "actual",
  closed = false,
}: {
  month: PeriodKey;
  sep?: boolean;
  plane?: Plane;
  /** Mes cerrado. Solo lo usa el plano Pres.: el formulario del plan no abre (NFR-3004). */
  closed?: boolean;
}) {
  const data = useLedgerStore((s) => s.data);
  const periods = useActivePeriods();
  const withdraw = useLedgerStore((s) => s.applyReserveWithdrawal);
  const planWithdrawal = useLedgerStore((s) => s.planWithdrawal);
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isPlan = plane === "budget";
  const txt = WITHDRAW_TEXT[plane];

  const leaves = reserveLeafIds(data);
  const parsed = Math.round(Number(amount) || 0);
  // El tope NO es el saldo del mes: si un mes posterior ya retiró de esa misma plata, el saldo
  // sobreestima (auditoría 2026-09-01: mostraba Máx. $1.000 donde solo cabían $200). `maxWithdrawal`
  // mira la serie completa — la misma cuenta que el dominio va a validar. En el plan, la del plan.
  const saldo = fromId ? maxWithdrawal(data, fromId, month, periods, plane) : null;
  const canSave = fromId !== "" && parsed > 0 && (saldo === null || parsed <= saldo);

  // Sobre-retiro: ejecutado vs planeado, misma graduación que los gastos (observación 1).
  const total = reserveRetiros(data, month, "actual");
  const planned = reserveRetiros(data, month, "budget");
  const overState = budgetState(planned, total);
  // Estado auto-sanador del plan (hallazgo adversarial 7, BG-020): si el plan de aportes ya no cubre la
  // suma de retiros planeados —solo posible con un ledger legado—, la celda se marca sola, sin bloquear.
  const uncovered = isPlan && planned > 0 && planned > plannedRetiroLimit(data, month, periods);

  // Las operaciones del mes ya registradas — retiros Y MOVERES (FR-1609). El mover se identifica
  // por sus DOS extremos; antes ni siquiera se listaba, así que quedaba atrapado sin forma de
  // corregirlo desde la interfaz.
  const monthOps = isPlan ? [] : monthReserveOps(data, month);
  // Pres.: una línea por alcancía con su retiro planeado del mes y sus notas (FR-3003).
  const planRows = isPlan ? plannedRetiroRows(data, month) : [];
  const hayLista = isPlan ? planRows.length > 0 : monthOps.length > 0;

  // Confirmación EN LÍNEA de la eliminación (FR-1802 · UX_SPEC §«Teclear 0»). Vive en el
  // contenedor y no en la fila porque la fila DESAPARECE al eliminarse: un aviso montado dentro de
  // ella se desmontaría con ella y no llegaría a verse nunca.
  //
  // Es en línea y no un diálogo a propósito: el diálogo modal de confirmación es justo lo que esta
  // feature retira. Teclear 0 ya es un acto deliberado, y la operación es reversible registrándola
  // de nuevo — pedir permiso encima sería la fricción que H3 (control y libertad) desaconseja.
  const [opEliminada, setOpEliminada] = useState(false);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (avisoTimer.current) clearTimeout(avisoTimer.current); }, []);

  /** Muestra «Operación eliminada» y lo desvanece. Reiniciable: dos borrados seguidos no lo cortan. */
  function avisarEliminada() {
    setOpEliminada(true);
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setOpEliminada(false), 2600);
  }

  function reset() {
    setFromId("");
    setAmount("");
    setNote("");
    setError(null);
  }

  function save() {
    if (!fromId || parsed <= 0) return;
    const nota = note.trim() === "" ? null : note.trim();
    const res = isPlan ? planWithdrawal(fromId, month, parsed, nota) : withdraw(fromId, month, parsed, nota);
    if ("rejected" in res) {
      const v = res.rejected;
      setError(typeof v === "string" || v.ok ? "Operación inválida" : blockMessage(data, v, { editedMonth: month }));
      return;
    }
    setOpen(false);
    reset();
  }

  const triggerClass = cn(CELL_W, "flex items-center justify-end min-h-[34px] px-3 tabular border-b border-border whitespace-nowrap bg-sunken border-t-0 border-x-0", sep && "border-l-2 border-l-border-strong");

  // Pres. de un mes cerrado: la suma se ve, el formulario no abre (NFR-3004, FR-2003).
  if (isPlan && closed) {
    return (
      <div data-testid="planned-withdraw-cell" data-month={month} data-closed="true" title="Mes cerrado"
        className={cn(triggerClass, "cursor-default")} style={{ color: "var(--fg-secondary)" }}>
        {cellNum(planned)}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <PopoverTrigger asChild>
        {isPlan ? (
          <button
            data-testid="planned-withdraw-cell"
            data-month={month}
            {...(uncovered ? { "data-plan-warn": "true" } : {})}
            title={
              uncovered
                ? `Tu plan de aportes ya no cubre estos retiros (hay ${money(plannedRetiroLimit(data, month, periods))} reservados hasta ${periodLabel(month).toLowerCase()})`
                : txt.trigger
            }
            className={cn(triggerClass, "cursor-pointer")}
            style={{ color: uncovered ? "var(--state-warning)" : "var(--fg-secondary)" }}
          >
            {uncovered && <span aria-hidden="true" className="flex-none mr-1 text-caption leading-none">!</span>}
            {cellNum(planned)}
          </button>
        ) : (
          <button
            data-testid="withdraw-cell"
            data-month={month}
            {...(total > 0 && overState !== "within" ? { "data-over": overState } : {})}
            title={txt.trigger}
            className={cn(triggerClass, "cursor-pointer")}
            style={{ color: total ? RETIRO_STATE_COLOR[overState] : "var(--fg-secondary)" }}
          >
            {/* Canal no cromático (WCAG 1.4.1): mismo glifo ›/›› de los gastos al retirar de más. */}
            {total > 0 && RETIRO_STATE_GLYPH[overState] ? (
              <span aria-hidden="true" className="flex-none mr-1 text-caption leading-none">{RETIRO_STATE_GLYPH[overState]}</span>
            ) : null}
            {cellNum(total)}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent data-testid="withdraw-popover" className="w-96 p-3 flex flex-col gap-2 text-[12px]" align="end">
        <span data-testid="withdraw-title" className="font-medium" style={{ color: "var(--fg)" }}>
          {`${txt.title} ${periodLabel(month).toLowerCase()} → Disponible`}
        </span>

        {/* Origen: el desplegable con todas las alcancías y su saldo —el del plan en Pres.—. La puerta
            con origen ya resuelto se retiró con el botón de la fila (FR-1807): la fila «Retiros del mes»
            vive ahora en el segmento de Reservas, junto a los bolsillos, que es lo que resolvía BL-019. */}
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
              {leafPathLabel(data, id)} — {money(resolvedBalance(data, id, month, plane, periods))}
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
            <span data-testid="withdraw-max" className="flex-none tabular" style={{ color: parsed > saldo ? "var(--error)" : "var(--fg-muted)" }}>
              Máx. {money(saldo)}
            </span>
          )}
        </div>
        {/* FR-1608 — el «¿para qué?». El dominio ya aceptaba la nota y la UI la descartaba: sin ella,
            ahorrar para algo y pagarlo son dos actos que la app no relaciona. Opcional siempre. En el
            plan se guarda como observación del retiro planeado (FR-3002). */}
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
            {txt.save}
          </button>
        </div>

        {/* Operaciones del mes: eliminar = corregir (el saldo se restaura por construcción). Desde
            FR-1609 la lista incluye los MOVERES, que antes no aparecían — y por eso no había forma
            de deshacer uno equivocado salvo hacer el mover inverso a mano. */}
        {/* El aviso va FUERA del bloque de la lista: al eliminar la última operación la lista se
            sustituye por su estado vacío, y un aviso dentro de ella se iría con el bloque.
            La transición la anula `prefers-reduced-motion` en globals.css. */}
        {opEliminada ? (
          <span
            role="status"
            data-testid="op-deleted-notice"
            className="pl-1 transition-opacity duration-300"
            style={{ color: "var(--fg-secondary)" }}
          >
            Operación eliminada
          </span>
        ) : null}

        {hayLista ? (
          <div className="flex flex-col gap-1 border-t border-border pt-2" data-testid="withdraw-history">
            <span className="font-medium" style={{ color: "var(--fg-secondary)" }}>{txt.list}</span>
            <ul className="flex flex-col gap-0.5">
              {isPlan
                ? planRows.map((row) => <PlanRow key={row.leafId} row={row} month={month} onEliminada={avisarEliminada} />)
                : monthOps.map((mv) => <OpRow key={mv.id} mv={mv} onEliminada={avisarEliminada} />)}
            </ul>
          </div>
        ) : (
          <div className="border-t border-border pt-2" data-testid="withdraw-history-empty" style={{ color: "var(--fg-muted)" }}>
            {txt.empty}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Una línea de la lista del formulario Pres.: el retiro planeado de una alcancía en el mes, con sus
 * notas y el MONTO EDITABLE (FR-3003). Misma interacción que `OpRow`: Enter o salir del campo confirma,
 * Escape revierte y 0 elimina (con sus notas). Un rechazo devuelve el campo a su valor y dice por qué.
 *
 * @aitri-trace FR-ID: FR-3003, US-ID: US-3003, AC-ID: AC-3009, TC-ID: TC-SDB-036h, TC-SDB-037f, TC-SDB-038e, TC-SDB-039e
 */
function PlanRow({ row, month, onEliminada }: { row: PlannedRetiroRow; month: PeriodKey; onEliminada: () => void }) {
  const data = useLedgerStore((s) => s.data);
  const edit = useLedgerStore((s) => s.editPlannedWithdrawal);
  const [val, setVal] = useState(String(row.amount));
  const [error, setError] = useState<string | null>(null);
  // Escape revierte y sale del campo; el blur que eso dispara no debe confirmar lo tecleado (el estado
  // `val` todavía no se ha actualizado cuando corre).
  const cancelado = useRef(false);

  // El monto vigente manda: si otra superficie lo cambió, el campo lo sigue.
  useEffect(() => { setVal(String(row.amount)); setError(null); }, [row.amount]);

  function commit() {
    if (cancelado.current) { cancelado.current = false; return; }
    const n = Math.max(0, Math.round(Number(val) || 0));
    if (n === row.amount) return;
    const res = edit(row.leafId, month, n);
    if (res.ok) {
      setError(null);
      if (n === 0) onEliminada();
      return;
    }
    setVal(String(row.amount)); // el rechazo no muta: el campo vuelve a lo que había
    const v = res.rejected;
    setError(typeof v === "string" || v.ok ? "Ese monto no es válido." : blockMessage(data, v, { editedMonth: month }));
  }

  return (
    <li className="flex flex-col gap-0.5" data-testid={`op-plan-${row.leafId}`}>
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: "var(--fg)" }}>
          {leafPathLabel(data, row.leafId)}
          {row.notes.length > 0 ? <span style={{ color: "var(--fg-muted)" }}> · {row.notes.join(" · ")}</span> : null}
        </span>
        <input
          aria-label={`Monto del retiro planeado de ${leafPathLabel(data, row.leafId)}`}
          data-testid={`op-plan-amount-${row.leafId}`}
          value={val}
          inputMode="numeric"
          onChange={(e) => { setVal(e.target.value.replace(/[^0-9]/g, "")); setError(null); }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.currentTarget.blur(); }
            if (e.key === "Escape") { cancelado.current = true; setVal(String(row.amount)); setError(null); e.currentTarget.blur(); }
          }}
          className="flex-none w-24 tabular text-right bg-card border border-border rounded-(--radius-xs) text-fg px-1.5 py-0.5 outline-none focus:border-accent"
        />
      </div>
      {error ? (
        <span role="alert" data-testid={`op-error-plan-${row.leafId}`} className="pl-1" style={{ color: "var(--alert-strong)" }}>
          {error}
        </span>
      ) : null}
    </li>
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
function OpRow({ mv, onEliminada }: { mv: Movement; onEliminada: () => void }) {
  const data = useLedgerStore((s) => s.data);
  const periods = useActivePeriods();
  const editOp = useLedgerStore((s) => s.editReserveOp);
  const esMover = !isAvailable(mv.to);
  const [val, setVal] = useState(String(mv.amount));
  const [error, setError] = useState<string | null>(null);
  // BG-056: Escape revierte y sale del campo; el blur que eso dispara no debe confirmar lo tecleado (el
  // estado `val` todavía no se ha actualizado cuando corre). Es la misma guarda que ya tenía `PlanRow`:
  // sin ella, Escape guardaba la cifra que se quería descartar, y 0 + Escape borraba el retiro.
  const cancelado = useRef(false);

  // El monto vigente manda: si otra superficie lo cambió, el campo lo sigue.
  useEffect(() => { setVal(String(mv.amount)); setError(null); }, [mv.amount]);

  function commit() {
    if (cancelado.current) { cancelado.current = false; return; }
    const n = Math.max(0, Math.round(Number(val) || 0));
    if (n === mv.amount) return;
    const res = editOp(mv.id, n);
    if (res.ok) {
      setError(null);
      // 0 = eliminar: la fila se desmonta, así que el aviso lo levanta el contenedor.
      if (n === 0) onEliminada();
      return;
    }
    setVal(String(mv.amount)); // el rechazo no muta: el campo vuelve a lo que había
    // `ok: true` no es alcanzable aquí (el store solo devuelve el veredicto cuando bloqueó), pero
    // el tipo lo admite, así que se estrecha en vez de castear.
    const v = res.rejected;
    setError(
      v === "invalid_target" || v.ok
        ? "Ese monto no es válido."
        : blockMessage(data, v, { editedMonth: mv.period })
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
            if (e.key === "Escape") { cancelado.current = true; setVal(String(mv.amount)); setError(null); e.currentTarget.blur(); }
          }}
          className="flex-none w-24 tabular text-right bg-card border border-border rounded-(--radius-xs) text-fg px-1.5 py-0.5 outline-none focus:border-accent"
        />
      </div>
      {/* BG-084: la nota va ENTERA en su propia línea. Desde que la celda del bolsillo dejó de mostrar
          la nota de un retiro, esta lista es el único sitio donde se lee, y en la línea del rótulo
          se cortaba con «…» sin forma de leerla completa. */}
      {mv.note ? (
        <span data-testid={`op-note-${mv.id}`} className="pl-[46px] break-words" style={{ color: "var(--fg-muted)" }}>
          {mv.note}
        </span>
      ) : null}
      {error ? (
        <span role="alert" data-testid={`op-error-${mv.id}`} className="pl-1" style={{ color: "var(--alert-strong)" }}>
          {error}
        </span>
      ) : null}
    </li>
  );
}
