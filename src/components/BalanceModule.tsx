"use client";
// @aitri-trace components:BalanceModule — FR-905/906/908 y FR-1009 (feature transferencias): el
// módulo de Balance al pie de la grilla, con Reservas/Retiros del mes como filas de un solo signo.
//
// Módulo:       src/components/BalanceModule.tsx
// Propósito:    Pintar las seis cifras del balance por mes y plano. Es una superficie de SOLO
//               LECTURA: ninguna de sus celdas es editable, y no escribe en el store — todo se
//               deriva de `computeBalanceSeries` sobre los montos que el usuario ya tecleó arriba.
// Dependencias: lucide-react (el ícono del encabezado), @/state/store (el estado del ledger),
//               @/domain/balance (el cálculo puro),
//               @/domain/months (el orden de las columnas), ./format (cellNum),
//               ./gridLayout (la geometría compartida con BudgetGrid), @/lib/utils (cn).

import { Component, useMemo, useState, type ReactNode } from "react";
import { Scale, ChevronDown, ChevronRight } from "lucide-react";
import { useLedgerStore } from "@/state/store";
import { MONTHS } from "@/domain/months";
import { computeBalanceSeries, type MonthBalance, type Plane } from "@/domain/balance";
import { reserveAportes, reserveRetiros } from "@/domain/reserve";
import { PlannedWithdrawCell, WithdrawCell } from "./ReserveCells";
import { cellNum } from "./format";
import { LABEL_W, CELL_W, STICKY_BASE } from "./gridLayout";
import { cn } from "@/lib/utils";
import type { LedgerState, MonthKey } from "@/domain/types";

/**
 * Marca de forma del saldo negativo. Es el canal NO cromático de WCAG 1.4.1: verde y rojo son un
 * par indistinguible para ≈1 de cada 12 hombres, así que el signo y esta marca dicen "estás en
 * rojo" sin depender del color. Deliberadamente DISTINTA de la marca de sobre-consumo de la
 * grilla (`›`/`››`), que significa otra cosa (NFR-903).
 */
const NEGATIVE_MARK = "‹‹";

/** El signo menos tipográfico (U+2212), no el guion del teclado: alinea con las cifras tabulares. */
const MINUS = "−";

/** Cómo se comporta cada una de las siete filas: es la tabla que gobierna color, peso y alarma. */
interface RowSpec {
  /** Clave estable para los tests y para `data-row`. `reserved` pinta SOLO los aportes del mes y
   *  `retiros` las bajadas — dos filas de un solo signo (FR-1009). `monthAvailable` es lo que el
   *  MES dejó disponible (flujo − aportes + retiros), sin el arrastre — la cuenta que el usuario
   *  hacía mentalmente (observación 2026-07-29). */
  key: keyof Pick<MonthBalance, "prevAvailable" | "flow" | "reserved" | "available" | "reservedBalance" | "total"> | "retiros" | "monthAvailable";
  label: string;
  /**
   * Signo que encabeza la fila. Es lo que convierte la columna en una CUENTA CORRIDA legible de
   * arriba abajo, en vez de seis cifras sueltas cuyo encadenamiento hay que adivinar. En particular
   * hace VISIBLE que las reservas se restan de lo disponible: la plata que va a la alcancía se ve
   * salir, con su signo, en vez de quedar escondida dentro de otra cifra.
   */
  op: "" | "+" | "−" | "=";
  /** `result` se colorea por signo (verde/rojo); `reserve` va en azul; `input` queda neutro. */
  tone: "input" | "result" | "reserve";
  /** La fila puede levantar la alarma de negativo (color de error + signo + marca). */
  alarms: boolean;
  weight: number;
  /** Regla horizontal ANTES de la fila: cierra el bloque de insumos y anuncia el resultado. */
  rule?: "soft" | "strong";
  /** Fila del bottom-line: cuerpo mayor, además de su regla fuerte. */
  bottomLine?: boolean;
}

/**
 * Las seis filas, en el orden del spec. Las tres primeras son insumos/contexto (atenuados) y las
 * tres últimas son los resultados (destacados) — la jerarquía visual es lo que hace legible el
 * módulo de un vistazo.
 */
const ROWS: RowSpec[] = [
  { key: "prevAvailable", label: "Saldo mes anterior", op: "", tone: "input", alarms: true, weight: 400 },
  { key: "flow", label: "Flujo del mes", op: "+", tone: "input", alarms: false, weight: 400 },
  { key: "reserved", label: "Reservas del mes", op: "−", tone: "input", alarms: false, weight: 400 },
  // FR-1009 · la idea original del usuario: los retiros como fila propia (operados; en Pres., el
  // retiro planeado). Siempre presente (0 en meses sin retiros) para no mover el layout.
  { key: "retiros", label: "Retiros del mes", op: "+", tone: "reserve", alarms: false, weight: 400 },
  // Lo que el MES dejó disponible (sin arrastre): flujo − aportes + retiros. Evita la cuenta mental.
  { key: "monthAvailable", label: "Disponible del mes", op: "=", tone: "result", alarms: true, weight: 600, rule: "soft" },
  { key: "available", label: "Saldo disponible", op: "=", tone: "result", alarms: true, weight: 600, rule: "soft" },
  { key: "reservedBalance", label: "Saldo reservado", op: "+", tone: "reserve", alarms: false, weight: 600 },
  { key: "total", label: "Saldo total", op: "=", tone: "result", alarms: true, weight: 600, rule: "strong", bottomLine: true },
];

/** Clases del borde superior que separa cada resultado de sus insumos. */
const RULE: Record<NonNullable<RowSpec["rule"]>, string> = {
  soft: "border-t border-t-border",
  strong: "border-t border-t-border-strong",
};

/**
 * Color de una cifra del balance según su fila y su signo.
 *
 * El color es ESCASO a propósito (principio heredado de budget-state-color): el verde se reserva a
 * los dos resultados sanos, el rojo a lo que puede quedar negativo, el azul liga el reservado al
 * tipo Transferencia, y todo lo demás queda neutro. Un verde en cada insumo positivo sería ruido
 * permanente y dejaría de significar algo.
 *
 * @param spec Fila a la que pertenece la celda.
 * @param value Valor de la celda.
 * @returns La variable CSS del color, lista para `style`.
 *
 * @aitri-trace FR-ID: FR-905, US-ID: US-905, AC-ID: AC-905, TC-ID: TC-BAL-935h, TC-BAL-935f, TC-BAL-956e
 */
function balanceColor(spec: RowSpec, value: number): string {
  if (spec.alarms && value < 0) return "var(--alert-strong)";
  // refinamiento-ui FR-1201: el reservado dejaba de ser azul por ser del tipo `transfer` — eso era
  // identidad, no estado. Ahora se distingue por su fila, su rótulo y su signo, como el resto.
  if (spec.tone === "reserve") return "var(--fg-secondary)";
  if (spec.tone === "result") return "var(--favorable)";
  return "var(--fg-secondary)";
}

/** Aportes y retiros del mes por plano — el desdoble de `reserved` en dos filas de un solo signo. */
type ReserveFlows = Record<MonthKey, Record<Plane, { aportes: number; retiros: number }>>;

/**
 * Desdoble del movimiento de reservas por mes y plano (FR-1009): `aportes` (subidas de saldo) y
 * `retiros` (bajadas), ambos ≥ 0 siempre — el neto `reserved` = aportes − retiros.
 *
 * @param data Estado del ledger.
 * @returns Los dos componentes por mes y plano.
 *
 * @aitri-trace FR-ID: FR-1009, US-ID: US-1009, AC-ID: AC-1009, TC-ID: TC-TRF-109h, TC-TRF-109e
 */
function computeReserveFlows(data: LedgerState): ReserveFlows {
  const out = {} as ReserveFlows;
  for (const m of MONTHS) {
    out[m.k] = {
      budget: { aportes: reserveAportes(data, m.k, "budget"), retiros: reserveRetiros(data, m.k, "budget") },
      actual: { aportes: reserveAportes(data, m.k, "actual"), retiros: reserveRetiros(data, m.k, "actual") },
    };
  }
  return out;
}

/**
 * Valor a pintar en una celda: el campo homónimo de la fila, sin componer nada.
 *
 * En particular, "Saldo mes anterior" muestra el DISPONIBLE arrastrado, no la suma de los dos
 * componentes. La cuenta corrida del módulo se lee en pantalla (FR-1009, un solo signo por fila):
 *   Saldo disponible = Saldo mes anterior + Flujo del mes − Reservas del mes + Retiros del mes
 *   Saldo total      = Saldo disponible   + Saldo reservado
 * "Reservas del mes" pinta SOLO los aportes y "Retiros del mes" solo las bajadas — jamás un
 * "− Reservas −50" de doble negativo. El neto sigue viviendo en la aritmética (reserved).
 *
 * @param m Las cifras del mes en un plano.
 * @param key Fila a leer.
 * @param flows Aportes/retiros del mes en el plano (desdoble de `reserved`).
 * @returns El valor a pintar en la celda.
 *
 * @aitri-trace FR-ID: FR-1009, US-ID: US-1009, AC-ID: AC-1009, TC-ID: TC-TRF-109h
 */
function cellValue(m: MonthBalance, key: RowSpec["key"], flows: { aportes: number; retiros: number }): number {
  if (key === "reserved") return flows.aportes;
  if (key === "retiros") return flows.retiros;
  if (key === "monthAvailable") return m.flow - m.reserved; // reserved es neto: flujo − aportes + retiros
  return m[key];
}

/**
 * Una celda del balance: cifra tabular, alineada a la derecha, sobre la superficie hundida.
 *
 * Convención de signo (decisión del usuario): los positivos NO llevan `+` — un número sin signo es
 * positivo. Solo el negativo se marca, y con tres canales a la vez (color, signo y forma).
 */
function BalanceCell({ spec, value, sep, rule }: { spec: RowSpec; value: number; sep?: boolean; rule?: RowSpec["rule"] }) {
  const negative = value < 0;
  const showMark = negative && spec.alarms;
  return (
    <div
      data-testid="balance-cell"
      className={cn(
        CELL_W,
        "flex items-center justify-end min-h-[34px] px-3 tabular border-b border-border whitespace-nowrap bg-sunken cursor-default",
        sep && "border-l-2 border-l-border-strong",
        rule && RULE[rule],
        spec.bottomLine && "label"
      )}
      style={{ color: balanceColor(spec, value), fontWeight: spec.weight }}
    >
      {negative ? MINUS : ""}
      {cellNum(Math.abs(value))}
      {/* Canal redundante de WCAG 1.4.1: aria-hidden porque el signo ya porta el dato. */}
      {showMark ? <span aria-hidden="true" className="flex-none ml-1 leading-none">{NEGATIVE_MARK}</span> : null}
    </div>
  );
}

/**
 * Celda del encabezado con el Saldo total del mes. Solo se pinta cuando el módulo está PLEGADO:
 * un bloque plegado tiene que seguir diciendo su bottom-line, igual que una fila de tipo plegada
 * sigue mostrando su total. Plegar debe RESUMIR, no borrar.
 *
 * @param value Saldo total del mes en ese plano.
 * @param sep La celda abre un mes (lleva el filete divisor de columna).
 * @returns La celda del encabezado.
 *
 * @aitri-trace FR-ID: FR-905, US-ID: US-905, AC-ID: AC-905, TC-ID: TC-BAL-935h
 */
function HeaderTotalCell({ value, sep }: { value: number; sep?: boolean }) {
  const negative = value < 0;
  return (
    <div
      data-testid="balance-header-cell"
      className={cn(
        CELL_W,
        "flex items-center justify-end min-h-[34px] px-3 tabular border-b border-border border-t border-t-border-strong whitespace-nowrap bg-sunken cursor-default",
        sep && "border-l-2 border-l-border-strong"
      )}
      style={{ color: negative ? "var(--error-strong)" : "var(--success-strong)", fontWeight: 600 }}
    >
      {negative ? MINUS : ""}
      {cellNum(Math.abs(value))}
      {negative ? <span aria-hidden="true" className="flex-none ml-1 leading-none">{NEGATIVE_MARK}</span> : null}
    </div>
  );
}

/**
 * El módulo de Balance: seis filas de solo lectura al pie de la grilla, alineadas con sus columnas.
 *
 * FR-908 (recálculo en vivo) no necesita código propio: el `useMemo` depende de las tres porciones
 * del store que alimentan el cálculo, y toda mutación reemplaza `data` por un objeto nuevo, así que
 * editar una celda, registrar un movimiento o reestructurar la jerarquía recomputa la serie y
 * repinta — incluido el arrastre hacia los meses siguientes.
 *
 * @returns El subárbol del módulo, o `null` si el store aún no tiene datos.
 * @throws Nunca. `computeBalanceSeries` es total: una celda ausente resuelve 0.
 *
 * @aitri-trace FR-ID: FR-908, US-ID: US-908, AC-ID: AC-908, TC-ID: TC-BAL-908h, TC-BAL-951e, TC-BAL-956h
 */
function BalanceRows() {
  const data = useLedgerStore((s) => s.data);
  // Plegado en dos niveles, como la grilla: el módulo entero y, dentro, sus INSUMOS. Plegar los
  // insumos deja las tres cifras de resultado — la vista compacta de "cuánto tengo". No se
  // persiste, igual que el plegado de la grilla.
  const [open, setOpen] = useState(true);
  const [tailOpen, setTailOpen] = useState(true);
  // El chevron vive en "Saldo disponible" y pliega lo que tiene DEBAJO —Saldo reservado y Saldo
  // total—, que es lo que hace cualquier control de árbol. Plegado deja la cuenta terminando en
  // "cuánto puedo gastar", que es la lectura compacta útil.
  const TAIL_FROM = ROWS.findIndex((r) => r.key === "available") + 1;
  const visible = open ? (tailOpen ? ROWS : ROWS.slice(0, TAIL_FROM)) : [];

  // El módulo NO sigue el resaltado del mes filtrado: su superficie es uniformemente la hundida.
  // Es deliberado — el tinte del filtro oscurece la celda hasta #e4e4e6 en tema claro, donde los
  // colores del balance pierden contraste AA (medido), y el spec no lo pide para este módulo.

  // El patrón del repo (DesktopShell/BudgetGrid): derivar con useMemo sobre las porciones del
  // estado, NO con un selector de store — Zustand v5 no memoiza selectores y devolver un objeto
  // nuevo por llamada dispararía el "getSnapshot should be cached".
  const series = useMemo(() => computeBalanceSeries(data), [data]);
  const reserveFlows = useMemo(() => computeReserveFlows(data), [data]);

  return (
    <div data-testid="balance-module">
      {/* Corte de BLOQUE, no de fila. Es aire VACÍO —sin fondo ni línea— para que la grilla de los
          tres tipos termine ahí y el balance se lea como una tabla aparte. Un separador con línea
          (como el de Transferencias) se lee como "un renglón saltado" dentro de la misma tabla;
          el vacío rompe la continuidad de la superficie, que es lo que separa dos bloques. */}
      <div data-testid="balance-separator" aria-hidden="true" className="h-8" />
      <div className="flex">
        {/* Encabezado de MÓDULO PAR de GASTOS/INGRESOS/TRANSFERENCIAS: misma estructura (hueco de
            chevron + ícono + rótulo en mayúsculas), mismo peso y mismo cuerpo. Antes usaba la
            utilidad `eyebrow` (pequeña y atenuada), que lo hacía leer como un pie de página en vez
            de como uno de los cuatro bloques de la grilla. El color es `--fg` y no un color de tipo
            a propósito: Balance pesa igual que los otros, pero NO es un tipo de movimiento. */}
        <div
          data-testid="balance-header"
          className={cn(STICKY_BASE, LABEL_W, "bg-sunken border-b border-border border-t border-t-border-strong pl-3.5 pr-2.5 gap-2 font-semibold")}
          style={{ color: "var(--fg)" }}
        >
          <button
            aria-label={open ? "Colapsar balance" : "Expandir balance"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex w-3.5 flex-none cursor-pointer bg-transparent border-0 p-0"
            style={{ color: "var(--fg)" }}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <Scale size={15} color="var(--fg)" aria-hidden="true" />
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">BALANCE</span>
        </div>
        {MONTHS.map((m) =>
          open ? (
            <div key={m.k} className="flex">
              <div className={cn(CELL_W, "min-h-[34px] bg-sunken border-b border-border border-t border-t-border-strong border-l-2 border-l-border-strong")} />
              <div className={cn(CELL_W, "min-h-[34px] bg-sunken border-b border-border border-t border-t-border-strong")} />
            </div>
          ) : (
            <div key={m.k} className="flex">
              <HeaderTotalCell value={series[m.k].budget.total} sep />
              <HeaderTotalCell value={series[m.k].actual.total} />
            </div>
          )
        )}
      </div>

      {visible.map((spec) => {
        const op = spec.op;
        const rule = spec.rule;
        return (
        <div className="flex" data-testid="balance-row" data-row={spec.key} key={spec.key}>
          <div
            data-testid="balance-label"
            className={cn(
              STICKY_BASE,
              LABEL_W,
              "bg-sunken border-b border-border pl-3.5 pr-2.5",
              rule && RULE[rule],
              spec.bottomLine && "label"
            )}
            style={{
              color: spec.tone === "reserve" ? "var(--fg-secondary)" : spec.tone === "result" ? "var(--fg)" : "var(--fg-secondary)",
              fontWeight: spec.weight,
            }}
          >
            {/* Chevron solo en "Saldo disponible", que pliega los tres insumos de los que sale.
                En el resto es un hueco INVISIBLE, no ausente: así los rótulos siguen alineados
                (mismo recurso que usa NodeRow en la grilla). */}
            {spec.key === "available" ? (
              <button
                aria-label={tailOpen ? "Colapsar saldos" : "Expandir saldos"}
                aria-expanded={tailOpen}
                onClick={() => setTailOpen((v) => !v)}
                className="inline-flex w-3.5 flex-none cursor-pointer bg-transparent border-0 p-0 text-fg-muted"
              >
                {tailOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            ) : (
              <span className="w-3.5 flex-none" aria-hidden="true" />
            )}
            {/* El signo se lee junto al rótulo ("más Flujo del mes"), así que NO va aria-hidden:
                es parte de la cuenta, no decoración. */}
            <span className="w-2.5 flex-none text-center tabular" style={{ color: "var(--fg-secondary)", fontWeight: 400 }}>
              {op}
            </span>
            <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{spec.label}</span>
          </div>
          {MONTHS.map((m) =>
            spec.key === "retiros" ? (
              // La fila «Retiros del mes» es OPERABLE (unificación 2026-07-29): Pres. edita el
              // retiro planeado; Ejec. abre el mini-form de sacar/corregir y gradúa el sobre-retiro.
              <div key={m.k} className="flex">
                <PlannedWithdrawCell month={m.k} sep />
                <WithdrawCell month={m.k} />
              </div>
            ) : (
              <div key={m.k} className="flex">
                <BalanceCell spec={spec} value={cellValue(series[m.k].budget, spec.key, reserveFlows[m.k].budget)} sep rule={rule} />
                <BalanceCell spec={spec} value={cellValue(series[m.k].actual, spec.key, reserveFlows[m.k].actual)} rule={rule} />
              </div>
            )
          )}
        </div>
        );
      })}
    </div>
  );
}

/**
 * Contención del blast radius del módulo (02_SYSTEM_DESIGN, componente crítico #1): si el cálculo
 * del balance lanzara por un defecto, cae SOLO este subárbol y la grilla —con sus datos y su
 * edición— sigue operativa.
 *
 * No es el manejo de un error esperado: `computeBalanceSeries` es total (una celda ausente resuelve
 * 0, un nodo mal referenciado también) y no hay entrada de usuario que lo dispare. Es una red de
 * seguridad, y por eso no tiene TC propio — ningún camino del producto llega aquí.
 *
 * @aitri-trace FR-ID: FR-908, US-ID: US-908, AC-ID: AC-908, TC-ID: TC-BAL-908h
 */
class BalanceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // No se silencia: sin esta traza, un fallo del balance desaparecería sin dejar rastro.
    console.error("BalanceModule: el cálculo del balance falló", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div data-testid="balance-module">
        <div className="flex">
          <div
            data-testid="balance-error"
            className={cn(STICKY_BASE, LABEL_W, "bg-sunken border-b border-border border-t border-t-border-strong pl-3.5 pr-2.5 caption")}
            style={{ color: "var(--error-strong)" }}
          >
            No se pudo calcular el balance
          </div>
        </div>
      </div>
    );
  }
}

/**
 * El módulo de Balance, con su red de contención. Es el punto de entrada que monta `BudgetGrid`.
 *
 * @returns El módulo de balance aislado en su propio límite de error.
 *
 * @aitri-trace FR-ID: FR-905, US-ID: US-905, AC-ID: AC-905, TC-ID: TC-BAL-935h, TC-BAL-956h
 */
export function BalanceModule() {
  return (
    <BalanceBoundary>
      <BalanceRows />
    </BalanceBoundary>
  );
}
