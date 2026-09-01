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
//               ./gridLayout (la geometría compartida con BudgetGrid), @/lib/utils (cn),
//               ./exceptionColor (la regla de color, ADR-01), ./balanceRows (la tabla de
//               filas y sus invariantes de cascada, ADR-04).

import { Component, Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Scale, ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { useLedgerStore } from "@/state/store";
import { MONTHS, monthLabel } from "@/domain/months";
import { computeBalanceSeries, type MonthBalance, type Plane } from "@/domain/balance";
import { reserveAportes, reserveRetiros, monthIssues, type MonthIssue } from "@/domain/reserve";
import { PlannedWithdrawCell, WithdrawCell } from "./ReserveCells";
import { cellNum, money } from "./format";
import { exceptionColor } from "./exceptionColor";
import { ROWS, BLOCKS, RETIROS_ROW, indentFor, type RowSpec } from "./balanceRows";
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

/**
 * Ancho a partir del cual el paso de sangría se reduce (FR-1402).
 *
 * INCLUSIVO en 1024: el spec fija «a 1024 px el paso baja a 12», así que la consulta es
 * `max-width: 1024px` y no `1023.98px`. Arrancó exclusiva y el TC-BJE-004e lo cazó midiendo 62 px
 * donde el spec pedía 50. Es la misma trampa que registró TC-REC-055e con `max-[760px]` de Tailwind
 * v4, que compila a `width < 760px`: el límite se lee como inclusivo y se implementa como exclusivo.
 */
const NARROW_QUERY = "(max-width: 1024px)";

/**
 * ¿Estamos por debajo de 1024 px? Decide el paso de sangría de la columna de etiquetas.
 *
 * Arranca en `false` porque en el servidor no hay `matchMedia`: el primer render usa el paso de
 * escritorio y el efecto lo corrige de inmediato. Es seguro — la sangría es presentación pura, así
 * que un frame con el paso ancho no cambia ninguna cifra ni ningún estado.
 *
 * @returns `true` si el viewport está por debajo del punto de ruptura.
 *
 * @aitri-trace FR-ID: FR-1402, US-ID: US-1402, AC-ID: AC-1402b, TC-ID: TC-BJE-004e
 */
function useNarrowIndent(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

/** Clases del borde superior que separa cada resultado de sus insumos. */
const RULE: Record<NonNullable<RowSpec["rule"]>, string> = {
  soft: "border-t border-t-border",
  strong: "border-t border-t-border-strong",
};

/**
 * Color de una cifra del balance según su fila y su signo.
 *
 * El color es ESCASO a propósito (principio heredado de budget-state-color): el rojo señala lo que
 * quedó negativo y TODO LO DEMÁS es neutro. Un color en cada cifra positiva sería ruido permanente
 * y dejaría de significar algo.
 *
 * balance-jerarquia FR-1403: esa frase estaba escrita aquí desde el principio, y la línea siguiente
 * la incumplía —`if (spec.tone === "result") return "var(--favorable)"`— pintando de verde las tres
 * filas de resultado en las doce columnas: 72 celdas verdes con un balance sano, medido a 1920px el
 * 2026-08-24. El verde había dejado de ser señal para ser el fondo del módulo, y el único dato que
 * sí exigía atención competía contra él. Ahora la regla vive en `exceptionColor` y se aplica de
 * verdad; los resultados se distinguen por PESO y SANGRÍA, no por color.
 *
 * @param spec Fila a la que pertenece la celda.
 * @param value Valor de la celda.
 * @returns La variable CSS del color, lista para `style`.
 *
 * @aitri-trace FR-ID: FR-1403, US-ID: US-1403, AC-ID: AC-1403a, TC-ID: TC-BJE-005h, TC-BJE-006h, TC-BJE-005f
 */
function balanceColor(spec: RowSpec, value: number): string {
  // La excepción manda: si está en rojo, se ve, sea cual sea la fila.
  if (spec.alarms && value < 0) return exceptionColor(value, { alarms: true });
  // Un SUMANDO es contexto: atenuado, para que los resultados destaquen sin gastar color.
  // refinamiento-ui FR-1201: el reservado dejaba de ser azul por ser del tipo `transfer` — eso era
  // identidad, no estado. Ahora se distingue por su fila, su rótulo y su signo, como el resto.
  if (spec.tone !== "result") return "var(--fg-secondary)";
  // Un RESULTADO sano: neutro pleno. Destaca sobre el sumando por contraste y peso, no por hue.
  return exceptionColor(value, { alarms: spec.alarms });
}

/** Aportes y retiros BRUTOS del mes por plano — las dos filas de un solo signo del bloque 2. */
type ReserveFlows = Record<MonthKey, Record<Plane, { aportes: number; retiros: number }>>;

/**
 * Desdoble del movimiento de reservas por mes y plano: `aportes` (subidas de saldo) y `retiros`
 * (bajadas), ambos ≥ 0 siempre — el neto que usa el dominio es `aportes − retiros`.
 *
 * FR-1810 v3 los vuelve a necesitar: el Balance publica las dos cifras BRUTAS en filas separadas.
 * Netearlas ahorraría una fila y produciría «− Reservas del mes: −500» en un mes que sólo
 * retira, que es doble negación.
 *
 * @param data Estado del ledger.
 * @returns Los dos componentes por mes y plano.
 *
 * @aitri-trace FR-ID: FR-1810, US-ID: US-1810, AC-ID: AC-1840, TC-ID: TC-TDF-101h
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
 * Valor a pintar en una celda: el campo homónimo del balance, o la cifra bruta que la fila declara.
 *
 * FR-1810 — la columna se lee como DOS CUENTAS encadenadas, cada una cerrando a la vista:
 *
 *     Ingresos − Gastos                                        = Resultado del mes
 *     Venía + Resultado − Guardado + Sacado                     = Saldo disponible
 *     Saldo disponible + Saldo reservado                           = Saldo total
 *
 * La segunda es la fórmula que el propio usuario enunció, y es idéntica por construcción a la que
 * el dominio ya calculaba: `prevAvailable + flow − (aportes − retiros) = available`. Por eso la
 * reestructuración no puede mover un peso — sólo cambia dónde se parte la misma resta (ADR-09).
 *
 * @param m Las cifras del mes en un plano.
 * @param key Fila a leer.
 * @param flows Aportes y retiros BRUTOS del mes en ese plano.
 * @returns El valor a pintar en la celda.
 *
 * @aitri-trace FR-ID: FR-1810, US-ID: US-1810, AC-ID: AC-1839, TC-ID: TC-TDF-100h, TC-TDF-102e
 */
function cellValue(m: MonthBalance, key: RowSpec["key"], flows: { aportes: number; retiros: number }): number {
  if (key === "monthResult" || key === "monthResultCarry") return m.flow;
  if (key === "toReserves") return flows.aportes;
  if (key === "toWithdrawals") return flows.retiros;
  // `retiros` no es una fila del Balance (vive en el segmento de Reservas, ADR-09) y nunca llega.
  if (key === "retiros") return 0;
  return m[key];
}

/**
 * Una celda del balance: cifra tabular, alineada a la derecha, sobre la superficie hundida.
 *
 * Convención de signo (decisión del usuario): los positivos NO llevan `+` — un número sin signo es
 * positivo. Solo el negativo se marca, y con tres canales a la vez (color, signo y forma).
 */
function BalanceCell({ spec, value, sep, rule, active }: { spec: RowSpec; value: number; sep?: boolean; rule?: RowSpec["rule"]; active?: boolean }) {
  const negative = value < 0;
  // FR-1810 — la alarma es una propiedad DECLARADA de cada fila, no una decisión de esta celda.
  // Solo «Disponible» y «Saldo total» la llevan: ahí un negativo es una deuda real. En «Quedó
  // disponible» el negativo es información («tu bolsillo bajó porque guardaste de más»), y pintarlo
  // como deuda era justo el defecto que este FR corrige.
  const showMark = negative && spec.alarms;
  // FR-1810 — un RESULTADO que vale 0 se pinta «0», no con el guion de vacío: en «Disponible»,
  // «Resultado del mes» y «Saldo total» el cero es la respuesta a la pregunta de la fila, no
  // la ausencia de dato. El usuario leyó ese guion como «sin datos» cuando decía «te quedaste sin
  // plata disponible». Las filas de INSUMO conservan el guion, que ahí sí significa «nada que
  // mostrar».
  const ceroExplicito = value === 0 && spec.tone === "result";
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
      style={{
        // FR-1404: una celda SIN DATO se pinta neutra, nunca con el color de su fila. `cellNum`
        // resuelve `!n → "—"`, así que la comprobación de contenido va ANTES que la de color: de
        // otro modo el guion hereda el tono de la fila y la pantalla acaba gastando su canal más
        // fuerte en la AUSENCIA de información. Es el mismo patrón que la grilla ya aplica
        // (BudgetGrid.tsx, refinamiento-ui FR-1202); aquí se replica, no se redefine.
        //
        // El resaltado del mes activo se pinta AQUÍ y no en el contenedor: la celda lleva
        // `bg-sunken`, que taparía cualquier fondo del padre (AC-1828).
        background: active ? "color-mix(in srgb, var(--accent) 8%, var(--bg-sunken))" : undefined,
        // En la columna del MES ACTIVO el guion sube a `--fg-secondary`. Medido: `--fg-muted` sobre
        // el fondo hundido ya está en 4,68:1, así que el tinte del resaltado —sea cual sea su
        // porcentaje— lo hunde por debajo de AA (4,01:1 al 8%). Elevarlo lo deja en 5,60:1: la
        // columna que el usuario está mirando se lee MEJOR, no peor. Es la razón por la que este
        // módulo no seguía el resaltado; con esto ya puede (FR-1805/AC-1828).
        color: !value
          ? ceroExplicito
            ? "var(--fg-secondary)" // DATO, no ausencia: se lee — pero un cero repetido en diez
              // meses sin actividad no debe pesar como una cifra con contenido, así que se queda un
              // escalón por debajo del negro pleno de los resultados con valor.
            : active
              ? "var(--fg-secondary)"
              : "var(--fg-muted)"
          : balanceColor(spec, value),
        fontWeight: spec.weight,
      }}
    >
      {negative ? MINUS : ""}
      {ceroExplicito ? "0" : cellNum(Math.abs(value))}
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
 * balance-jerarquia FR-1403: esta celda usaba `var(--success-strong)` —alias de `--favorable`—, así
 * que PLEGAR el módulo hacía REAPARECER el verde que la fila acababa de perder. Era la misma cifra
 * pintada de verde por una segunda puerta, y es la superficie que la primera redacción de los FR
 * pasó por alto: sólo existe estando plegado, así que no salía en ninguna captura del módulo. La
 * encontró la auditoría de uniformidad del 2026-08-25.
 *
 * @aitri-trace FR-ID: FR-1403, US-ID: US-1403, AC-ID: AC-1403a, TC-ID: TC-BJE-006e, TC-BJE-006f, TC-BJE-011e
 */
function HeaderTotalCell({ value, sep, active }: { value: number; sep?: boolean; active?: boolean }) {
  const negative = value < 0;
  return (
    <div
      data-testid="balance-header-cell"
      className={cn(
        CELL_W,
        "flex items-center justify-end min-h-[34px] px-3 tabular border-b border-border border-t border-t-border-strong whitespace-nowrap bg-sunken cursor-default",
        sep && "border-l-2 border-l-border-strong"
      )}
      style={{
        // Mismo trato que `BalanceCell`: sin dato → neutro atenuado; con dato → la regla única.
        // Plegar debe RESUMIR, no perder la señal: un total negativo conserva aquí sus tres
        // canales (color, signo y glifo), igual que desplegado.
        background: active ? "color-mix(in srgb, var(--accent) 8%, var(--bg-sunken))" : undefined,
        // Plegado RESUME la fila «Saldo disponible», que pinta su cero explícito — resumirla con el
        // guion de «sin datos» contradecía a la fila que resume (auditoría 2026-09-01).
        color: !value ? "var(--fg-secondary)" : exceptionColor(value, { alarms: true }),
        fontWeight: 600,
      }}
    >
      {negative ? MINUS : ""}
      {value === 0 ? "0" : cellNum(Math.abs(value))}
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
function BalanceRows({ highlightMonth }: { highlightMonth: MonthKey | null }) {
  const data = useLedgerStore((s) => s.data);
  // Plegado en dos niveles, como la grilla: el módulo entero y, dentro, sus INSUMOS. Plegar los
  // insumos deja las tres cifras de resultado — la vista compacta de "cuánto tengo". No se
  // persiste, igual que el plegado de la grilla.
  const [open, setOpen] = useState(true);
  const [tailOpen, setTailOpen] = useState(true);
  // El chevron vive en "Disponible" y pliega lo que tiene DEBAJO —Saldo reservado y Saldo total—,
  // que es lo que hace cualquier control de árbol. Plegado deja la cuenta terminando en "cuánto
  // puedo gastar", que es la lectura compacta útil.
  const TAIL_FROM = ROWS.findIndex((r) => r.key === "available") + 1;
  // ADR-09: «Retiros del mes» ya no está en ROWS (vive en el segmento de Reservas), así que aquí no
  // queda nada que filtrar — la tabla se renderiza tal cual la declara `balanceRows`.
  const visible = open ? (tailOpen ? ROWS : ROWS.slice(0, TAIL_FROM)) : [];
  // FR-1402: por debajo de 1024 px el paso de sangría baja a 12 px — con 16 la etiqueta más larga
  // del nivel más profundo se trunca. Se resuelve en JS y no con una media query en CSS para que la
  // fórmula tenga UN SOLO domicilio (`indentFor`); duplicarla en la hoja de estilos es exactamente
  // el patrón de tres copias divergentes que esta feature vino a eliminar.
  const narrow = useNarrowIndent();

  // El módulo NO sigue el resaltado del mes filtrado: su superficie es uniformemente la hundida.
  // Es deliberado — el tinte del filtro oscurece la celda hasta #e4e4e6 en tema claro, donde los
  // colores del balance pierden contraste AA (medido), y el spec no lo pide para este módulo.

  // El patrón del repo (DesktopShell/BudgetGrid): derivar con useMemo sobre las porciones del
  // estado, NO con un selector de store — Zustand v5 no memoiza selectores y devolver un objeto
  // nuevo por llamada dispararía el "getSnapshot should be cached".
  const series = useMemo(() => computeBalanceSeries(data), [data]);
  const flows = useMemo(() => computeReserveFlows(data), [data]);

  return (
    <div data-testid="balance-module">
      {/* El corte de bloque lo da ahora la SEPARACIÓN ENTRE TARJETAS de la grilla (FR-1805): el
          Balance es uno de los tres bloques y su tarjeta ya lo separa del de Reservas. El
          separador propio de 32px que había aquí dejaba una franja vacía DENTRO de la tarjeta. */}
      <div className="flex">
        {/* Encabezado de MÓDULO PAR de GASTOS/INGRESOS/TRANSFERENCIAS: misma estructura (hueco de
            chevron + ícono + rótulo en mayúsculas), mismo peso y mismo cuerpo. Antes usaba la
            utilidad `eyebrow` (pequeña y atenuada), que lo hacía leer como un pie de página en vez
            de como uno de los cuatro bloques de la grilla. El color es `--fg` y no un color de tipo
            a propósito: Balance pesa igual que los otros, pero NO es un tipo de movimiento. */}
        <div
          data-testid="balance-header"
          // La tarjeta del Balance empieza (y, plegada, también termina) en esta fila: las
          // esquinas se declaran aquí porque el envoltorio del módulo hace que los selectores
          // first/last-child de la tarjeta no lleguen a las celdas.
          className={cn(
            STICKY_BASE,
            LABEL_W,
            "bg-sunken border-b border-border border-t border-t-border-strong pl-3.5 pr-2.5 gap-2 font-semibold rounded-tl-(--radius-md)",
            visible.length === 0 && "rounded-bl-(--radius-md)"
          )}
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
            // Feature `resumen-plegado`, FR-1501: plegado, el encabezado resume con el SALDO
            // DISPONIBLE, no con el Saldo total. REVOCA en este punto a FR-909 de la feature
            // `balance` («plegado el encabezado SIGUE mostrando el Saldo total»); el resto de
            // FR-909 —los dos niveles de plegado, el chevron interno, el estado local no
            // persistido, los cuatro bloques como pares— sigue vigente. El porqué: el Saldo total
            // INCLUYE el reservado, plata ya apartada en alcancías que no se va a gastar, así que
            // resumía «cuánto tengo» cuando la pregunta que motiva plegar es «cuánto puedo
            // gastar». Además alinea los dos niveles de plegado: el chevron interno ya cortaba la
            // escalera justo en «Saldo disponible». Decisión del usuario, 2026-08-25 (BL-029),
            // ratificada el 2026-08-27. Cada celda usa el disponible de SU plano.
            <div key={m.k} className="flex" data-month={m.k} data-active={highlightMonth === m.k || undefined}>
              <HeaderTotalCell value={series[m.k].budget.available} sep active={highlightMonth === m.k} />
              <HeaderTotalCell value={series[m.k].actual.available} active={highlightMonth === m.k} />
            </div>
          )
        )}
      </div>

      {visible.map((spec, idx) => {
        const op = spec.op;
        const rule = spec.rule;
        // FR-1810 — el micro-rótulo del bloque va sobre su PRIMERA fila. Es lo que impide que ocho
        // filas de nombres parecidos se lean como una lista plana: cada bloque dice qué pregunta
        // contesta antes de que el ojo llegue a las cifras.
        const abreBloque = idx === 0 || visible[idx - 1].block !== spec.block;
        const rotulo = BLOCKS.find((b) => b.key === spec.block)!.label;
        return (
        <Fragment key={spec.key}>
        {abreBloque ? (
          <div className="flex" data-testid="balance-block" data-block={spec.block} aria-hidden="true">
            <div
              className={cn(STICKY_BASE, LABEL_W, "bg-sunken pr-2.5 pt-2.5 pb-0.5 eyebrow")}
              style={{ paddingLeft: indentFor(0, narrow), color: "var(--fg-muted)" }}
            >
              {rotulo}
            </div>
            {MONTHS.map((m) => (
              <div key={m.k} className="flex" data-month={m.k}>
                <div className={cn(CELL_W, "bg-sunken border-l-2 border-l-border-strong")}
                     style={{ background: highlightMonth === m.k ? "color-mix(in srgb, var(--accent) 8%, var(--bg-sunken))" : undefined }} />
                <div className={cn(CELL_W, "bg-sunken")}
                     style={{ background: highlightMonth === m.k ? "color-mix(in srgb, var(--accent) 8%, var(--bg-sunken))" : undefined }} />
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex" data-testid="balance-row" data-row={spec.key}>
          <div
            data-testid="balance-label"
            className={cn(
              STICKY_BASE,
              LABEL_W,
              "bg-sunken border-b border-border pr-2.5",
              rule && RULE[rule],
              spec.bottomLine && "label",
              // La última fila visible cierra la tarjeta — sea «Saldo total» o, con la cola
              // plegada, «Disponible».
              idx === visible.length - 1 && "rounded-bl-(--radius-md)"
            )}
            style={{
              // FR-1402: la SANGRÍA es el canal que transporta la jerarquía. El `pl-3.5` fijo que
              // había aquí dejaba las ocho etiquetas en el mismo margen, así que nada anidaba nada
              // —y por eso subir pesos o engrosar reglas (que ya existían desde 5a05a17) no
              // resolvió BL-025. El valor sale de `indentFor`, único domicilio de la fórmula, que
              // es la MISMA del árbol de la grilla: `14 + nivel * 16` (BudgetGrid.tsx).
              paddingLeft: indentFor(spec.level, narrow),
              color: spec.tone === "result" ? "var(--fg)" : "var(--fg-secondary)",
              fontWeight: spec.weight,
            }}
          >
            {/* Chevron solo en «Disponible», que pliega los saldos que tiene debajo. En el resto es
                un hueco INVISIBLE, no ausente: así los rótulos siguen alineados (mismo recurso que
                usa NodeRow en la grilla). */}
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
            {/* El signo se lee junto al rótulo («más Ingresos», «se fue a Reservas del mes»),
                así que NO va aria-hidden: es parte de la cuenta, no decoración.
                Los cuatro signos son de ancho tabular, así que caben en la caja de 10px y las diez
                etiquetas quedan alineadas. (La v2 necesitaba un `→` que NO cabía y desalineaba su
                rótulo; con la v3 ese signo desapareció junto con el desglose que lo motivaba.) */}
            <span className="w-2.5 flex-none text-center tabular" style={{ color: "var(--fg-secondary)", fontWeight: 400 }}>
              {op}
            </span>
            <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{spec.label}</span>
          </div>
          {MONTHS.map((m) => (
            <div key={m.k} className="flex" data-month={m.k} data-active={highlightMonth === m.k || undefined}>
              <BalanceCell spec={spec} value={cellValue(series[m.k].budget, spec.key, flows[m.k].budget)} sep rule={rule} active={highlightMonth === m.k} />
              <BalanceCell spec={spec} value={cellValue(series[m.k].actual, spec.key, flows[m.k].actual)} rule={rule} active={highlightMonth === m.k} />
            </div>
          ))}
        </div>
        </Fragment>
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
export function BalanceModule({ highlightMonth }: { highlightMonth?: MonthKey | null }) {
  return (
    <BalanceBoundary>
      <BalanceRows highlightMonth={highlightMonth ?? null} />
      <TechoBanner />
    </BalanceBoundary>
  );
}

/**
 * Franja de detalle del techo roto (FR-1606).
 *
 * La marca del encabezado de mes avisa DONDE se trabaja; esta franja explica QUÉ pasó y qué
 * consecuencia tiene. Hasta ahora la única señal de que las reservas superaban lo disponible era un
 * «Saldo disponible» negativo al pie — que es exactamente lo que el usuario no vio, mientras la app
 * le rechazaba toda escritura sin decirle por qué.
 *
 * No ofrece corrección automática a propósito: cuál de los dos lados está mal —la reserva o el
 * ingreso— solo lo sabe el usuario. Y no bloquea nada: bajar un ingreso mal tecleado se sigue
 * permitiendo; lo que deja de ser es silencioso.
 *
 * `role="status"` — se anuncia sin robar el foco a quien está tecleando.
 *
 * @aitri-trace FR-ID: FR-1606, US-ID: US-1606, AC-ID: AC-1616, TC-ID: TC-CPR-037h
 */
function TechoBanner() {
  const data = useLedgerStore((s) => s.data);
  const hydrated = useLedgerStore((s) => s.hydrated);
  const breaches = useMemo<readonly MonthIssue[]>(() => (hydrated ? monthIssues(data) : []), [data, hydrated]);
  if (breaches.length === 0) return null;
  return (
    <div
      data-testid="techo-banner"
      role="status"
      className="flex flex-col gap-1 mx-3 my-2 px-3 py-2 rounded-(--radius-sm) border text-caption"
      style={{ borderColor: "var(--alert-strong)", background: "var(--bg-card)", boxShadow: "var(--shadow-md)", color: "var(--fg)" }}
    >
      {breaches.map((b) => (
        <div key={b.month} className="flex items-start gap-2" data-month={b.month}>
          <span className="flex-none mt-[1px]" style={{ color: "var(--alert-strong)" }} aria-hidden="true">
            <TriangleAlert size={14} />
          </span>
          <span>
            <strong>{monthLabel(b.month)}:</strong> reservas <span className="tabular">{money(b.excess)}</span> por
            encima del margen del mes — los meses siguientes quedan sin margen.
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * La fila «Retiros del mes», montada en el segmento de RESERVAS de la grilla (FR-1805).
 *
 * Vive aquí y no en `BudgetGrid` porque su layout es el de una fila del Balance —sangría, rótulo
 * sticky, par de celdas Pres./Ejec.— y duplicarlo allí las haría divergir. Su spec es `RETIROS_ROW`,
 * declarada FUERA de `ROWS`: esta fila es la puerta OPERABLE; su reflejo de solo lectura en el
 * Balance es la fila «Retiros de reservas» (FR-1810 v3 · ADR-09, que revoca ADR-07 en este punto).
 *
 * Es la puerta para SACAR: Pres. edita el retiro planeado, Ejec. abre el mini-form de sacar y
 * corregir. Al mudarla junto a los bolsillos resuelve BL-019 —«no me resulta amigable operar desde
 * el pie del Balance»— sin necesidad del botón por fila que esta feature retira.
 *
 * @aitri-trace FR-ID: FR-1805, US-ID: US-1805, AC-ID: AC-1818, TC-ID: TC-TDF-041h
 */
export function RetirosRow({ highlightMonth }: { highlightMonth: MonthKey | null }) {
  const spec = RETIROS_ROW;
  const narrow = useNarrowIndent();
  return (
    <div className="flex" data-testid="balance-row" data-row="retiros">
      <div
        data-testid="balance-label"
        // Esta fila CIERRA la tarjeta de Reservas (FR-1805): su rótulo redondea la esquina.
        className={cn(STICKY_BASE, LABEL_W, "bg-sunken border-b border-border pr-2.5 rounded-bl-(--radius-md)")}
        style={{
          paddingLeft: indentFor(spec.level, narrow),
          color: "var(--fg-secondary)",
          fontWeight: spec.weight,
        }}
      >
        <span className="w-3.5 flex-none" aria-hidden="true" />
        <span className="w-2.5 flex-none text-center tabular" style={{ color: "var(--fg-secondary)", fontWeight: 400 }}>
          {spec.op}
        </span>
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{spec.label}</span>
      </div>
      {MONTHS.map((m) => (
        <div key={m.k} className="flex" data-month={m.k} data-active={highlightMonth === m.k || undefined}
             style={highlightMonth === m.k ? { background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}>
          <PlannedWithdrawCell month={m.k} sep />
          <WithdrawCell month={m.k} />
        </div>
      ))}
    </div>
  );
}
