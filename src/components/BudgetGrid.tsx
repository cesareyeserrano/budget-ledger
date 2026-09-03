"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { ChevronRight, ChevronDown, Pencil, Trash2, Plus, Check, X, ArrowLeft, ArrowRight, ArrowRightLeft, TriangleAlert, Info, Lock } from "lucide-react";
import { useLedgerStore, useActivePeriods, useVisiblePeriods, useClosure, useClosureStatus } from "@/state/store";
import type { LedgerNode, LedgerState, PeriodKey, NodeLevel, NodeType } from "@/domain/types";
import { periodMonthLabel, isYearStart, periodYear } from "@/domain/periods";
import { isClosed } from "@/domain/closure";
import { rollupBudget, rollupActual, typeTotals } from "@/domain/rollup";
import { budgetState, cellTone, cellGlyph, type BudgetState, type CellTone } from "@/domain/budgetState";
import { isLeaf, childrenOf } from "@/domain/tree";
import { canDeleteNode } from "@/domain/mutations";
import { planTechoMonths, monthIssues, monthCarryUsage, type MonthIssue } from "@/domain/reserve";
import { CellNotesSection, ReserveCellEditor, ReserveLeafCell } from "./ReserveCells";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cellNum, money } from "./format";
import { NodeIcon } from "./NodeIcon";
import { IconPicker } from "./IconPicker";
import { BalanceModule, RetirosRow } from "./BalanceModule";
import { LABEL_W, CELL_W, STICKY_BASE } from "./gridLayout";
import { cn } from "@/lib/utils";
import { readCatWidth, writeCatWidth, clampCatWidth } from "@/lib/gridWidth";

/**
 * Orden de los bloques: sigue el CAMINO DE LA PLATA — entra, sale, se aparta — y refleja el orden
 * de la propia cuenta del balance (`Ingreso − Gasto`). Antes empezaba por GASTOS.
 *
 * "RESERVAS" en vez de "TRANSFERENCIAS": es la palabra que el módulo de balance ya usa ("Reservas
 * del mes", "Saldo reservado"), así que la grilla y el balance hablan igual. El tipo del dominio
 * sigue siendo `transfer` — cambia el rótulo, no el modelo.
 */
// refinamiento-ui FR-1202: glifos LATERALES (decisión del usuario sobre el comparador visual).
// ← entra · → sale · ⇄ va y vuelve. Son el canal que distingue los bloques ahora que el color
// de identidad se retiró: la forma carga lo que antes cargaba el hue.
/**
 * Tarjeta de un bloque de la grilla (FR-1805): fondo, borde y esquinas propias.
 *
 * SIN `overflow-hidden`, aunque recortaría las esquinas: un ancestro con overflow crea un contexto
 * de scroll nuevo y ROMPE el `position: sticky` de la columna de rótulos, que se va con el scroll
 * horizontal y desaparece de la vista (verificado con una captura). Las esquinas se redondean sobre
 * las filas extremas, que da el mismo efecto sin tocar el sticky.
 */
const SEGMENT = [
  "rounded-(--radius-md) border border-border bg-card shadow-[var(--shadow-sm)]",
  // Las esquinas de las CELDAS del rincón no se pueden cazar con selectores first/last-child:
  // cada tipo de fila anida distinto (TypeTotalRow es plano, NodeRow lleva un envoltorio flex-col
  // y el Balance va entero dentro de su propio div), así que el selector acertaba solo a veces —
  // la esquina salía redonda con GASTOS plegado y cuadrada al desplegarlo. El redondeo lo declara
  // ahora cada fila sobre su celda de rótulo (prop `roundBottom` / clase directa), que es quien
  // sabe si es la última de su tarjeta.
].join(" ");

const TYPE_ORDER: { id: NodeType; label: string; Icon: typeof ArrowLeft }[] = [
  { id: "income", label: "INGRESOS", Icon: ArrowLeft },
  { id: "expense", label: "GASTOS", Icon: ArrowRight },
  { id: "transfer", label: "RESERVAS", Icon: ArrowRightLeft },
];

// La geometría (ancho de la columna categoría vía --cat-w, sub-celda de mes de 108px, base sticky)
// vive en ./gridLayout porque el módulo de Balance la comparte para alinear sus columnas.

interface Adder { level: NodeLevel; parentId: string | null; type: NodeType }
interface Row { node: LedgerNode | null; type: NodeType; depth: number; leaf: boolean; expandable: boolean }

/**
 * Color y glifo del estado de sobre-consumo. Ambos se indexan por el MISMO BudgetState (ADR-02):
 * mientras se lean de estas dos tablas, el canal redundante de WCAG 1.4.1 no puede contradecir al
 * color, porque no hay una segunda condición que mantener en sincronía.
 */
const STATE_COLOR: Record<BudgetState, string> = {
  within: "var(--fg)",
  over_soft: "var(--alert-soft)",
  over_hard: "var(--alert-strong)",
};
const STATE_GLYPH: Record<BudgetState, "" | "›" | "››"> = {
  within: "",
  over_soft: "›",
  over_hard: "››",
};

/**
 * Marca de forma del estado: el canal NO cromático de WCAG 1.4.1 (ámbar y rojo son un par
 * rojo-verde, indistinguible para ≈1 de cada 12 hombres).
 *
 * @param state Estado de consumo del presupuesto.
 * @returns El glifo a dibujar antes del monto; cadena vacía cuando no hay desvío.
 *
 * @aitri-trace FR-ID: FR-402, US-ID: US-402, AC-ID: AC-402, TC-ID: TC-BSC-402h, TC-BSC-453f
 */
function stateGlyph(state: BudgetState): "" | "›" | "››" {
  return STATE_GLYPH[state];
}

/**
 * Color del Ejecutado. En GASTO ya no indica el tipo: gradúa la GRAVEDAD del sobre-consumo
 * (neutro ≤100 % · ámbar >100 % y <120 % · rojo ≥120 %). Ingreso y Transferencia conservan
 * intacta su semántica anterior (NFR-402).
 *
 * @param type Tipo del nodo. Solo `expense` consulta el estado de presupuesto.
 * @param b Presupuesto del mes.
 * @param e Ejecutado del mes. 0 conserva el em-dash atenuado.
 * @returns La variable CSS del color, lista para `style`.
 *
 * @aitri-trace FR-ID: FR-401, US-ID: US-401, AC-ID: AC-401, TC-ID: TC-BSC-402h, TC-BSC-452h, TC-BSC-452e
 */
/** Token de cada rol semántico. La regla vive en el dominio (cellTone); aquí solo se resuelve. */
const TONE_TOKEN: Record<CellTone, string> = {
  neutral: "var(--fg)",
  muted: "var(--fg-secondary)",
  favorable: "var(--favorable)",
  "alert-soft": "var(--alert-soft)",
  "alert-strong": "var(--alert-strong)",
};

/**
 * La clave del código de estado, colgada del propio glifo.
 *
 * Vivía en una franja fija al pie de la grilla (FR-403 de budget-state-color). Ocupaba 35 px
 * permanentes para explicar un vocabulario de tres símbolos que se aprende la primera vez, así que
 * la explicación se acerca a lo que explica: se lee posándose sobre la marca, y sólo quien la
 * necesita paga por ella. El canal no cromático de WCAG 1.4.1 NO cambia — sigue siendo el glifo.
 */
const GLYPH_TITLE: Record<string, string> = {
  "›": "Te pasaste poco: por encima de lo planeado, menos del 120 %",
  "››": "Te pasaste mucho: 120 % de lo planeado o más",
  "‹": "Te quedaste corto: por debajo de lo planeado",
};

function ejecColor(type: NodeType, b: number, e: number): string {
  return TONE_TOKEN[cellTone(type, b, e)];
}

/**
 * Glifo del Ejecutado. Deriva del mismo `budgetState(b, e)` que el color, con las mismas entradas:
 * solo los GASTOS con ejecutado > 0 pueden llevar marca (NFR-402 — un Ingreso que supera su
 * presupuesto es BUENO y no lleva ninguna).
 *
 * @param type Tipo del nodo.
 * @param b Presupuesto del mes.
 * @param e Ejecutado del mes.
 * @returns El glifo, o cadena vacía cuando la celda no expresa desvío.
 *
 * @aitri-trace FR-ID: FR-402, US-ID: US-402, AC-ID: AC-402, TC-ID: TC-BSC-402e, TC-BSC-402f, TC-BSC-452f
 */
function ejecGlyph(type: NodeType, b: number, e: number): "" | "‹" | "›" | "››" {
  return cellGlyph(type, b, e);
}

export function BudgetGrid() {
  const data = useLedgerStore((s) => s.data);
  const hydrated = useLedgerStore((s) => s.hydrated);
  const setLeafAmount = useLedgerStore((s) => s.setLeafAmount);
  const deleteNode = useLedgerStore((s) => s.deleteNode);
  const renameNode = useLedgerStore((s) => s.renameNode);
  const createNode = useLedgerStore((s) => s.createNode);
  const setNodeIcon = useLedgerStore((s) => s.setNodeIcon);
  const moveNode = useLedgerStore((s) => s.moveNode);
  const showToast = useLedgerStore((s) => s.showToast);
  const period = useLedgerStore((s) => s.period);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => initialExpanded(data.nodes));
  const [editing, setEditing] = useState<{ id: string; mk: PeriodKey; field: "budget" | "actual" } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [namingId, setNamingId] = useState<string | null>(null);
  const [catW, setCatW] = useState<number>(() => readCatWidth()); // FR-104: ancho persistido de la columna categoría
  const [dragId, setDragId] = useState<string | null>(null); // FR-015: nodo en arrastre (para el DragOverlay)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // FR-104: arrastre de la manija (Pointer Events propios, aislados del dnd de nodos).
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = catW;
    const onMove = (ev: PointerEvent) => setCatW(clampCatWidth(startW + (ev.clientX - startX)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      setCatW((w) => { writeCatWidth(w); return w; });
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const rows = useMemo(() => buildRows(data.nodes, expanded), [data.nodes, expanded]);
  // FR-1805 — la grilla se lee en TRES bloques: Ingresos+Gastos · Reservas · Balance. Se separan
  // en VERTICAL dentro del MISMO contenedor de scroll (ADR-04), así que los doce meses siguen
  // siendo un solo riel de columnas alineadas y con un solo scroll: enero de Gastos y enero de
  // Reservas caen en la misma columna por construcción, sin nada que sincronizar.
  const segmentoFlujo = useMemo(() => rows.filter((r) => r.type !== "transfer"), [rows]);
  const segmentoReservas = useMemo(() => rows.filter((r) => r.type === "transfer"), [rows]);
  const highlightMonth = period.mode === "month" ? period.month : null;
  // FR-1008: meses del plan que superan su techo — estado del PLAN (no de una edición); las celdas
  // Pres. de hojas que aportan en esos meses llevan «!» + ámbar.
  // DOS listas, a propósito (ver el store): `scope` es el alcance del CÁLCULO —no lo toca el
  // filtro, o el arrastre de enero saldría de cero— y `periods` son las columnas que se PINTAN.
  const scope = useActivePeriods();
  const periods = useVisiblePeriods();
  const planWarnMonths = useMemo(() => planTechoMonths(data, scope), [data, scope]);
  // FR-2009: qué columnas están cerradas. Set memoizado por (periodos × frontera) para no
  // recalcular la pertenencia en cada render de cada cabecera.
  const closure = useClosure();
  const { reopenable } = useClosureStatus();
  const cerrados = useMemo(
    () => new Set(periods.filter((p) => isClosed(closure, p))),
    [periods, closure]
  );

  // Tramos contiguos por año, para la banda del encabezado. Con un rango que arranca a mitad de
  // año el primer tramo tiene menos de doce meses — y ESE es justo el que se quedaba sin etiqueta
  // cuando la marca colgaba de enero.
  const yearBands = useMemo(() => {
    const out: { year: number; count: number }[] = [];
    for (const p of periods) {
      const y = periodYear(p);
      const last = out[out.length - 1];
      if (last && last.year === y) last.count += 1;
      else out.push({ year: y, count: 1 });
    }
    return out;
  }, [periods]);


  // BG-007: al montar, posicionar el scroll horizontal en el mes resaltado (el estado ya arranca
  // en el mes en curso, pero el contenedor iniciaba en scrollLeft=0 → siempre se veía enero).
  // Cada mes ocupa 216px (dos celdas CELL_W de 108px); la columna de categoría es sticky.
  const scrollRef = useRef<HTMLDivElement>(null);
  const yaPosicionado = useRef(false);
  useEffect(() => {
    if (!highlightMonth || !scrollRef.current) return;
    const idx = periods.indexOf(highlightMonth);
    if (idx < 0) return; // el mes elegido no está entre las columnas visibles

    // Elegir un mes lo trae al frente. Antes esto solo corría al MONTAR (BG-007), lo que bastaba
    // con doce columnas fijas: el mes buscado siempre estaba a un vistazo. Con un rango de dos
    // años puede quedar veinte columnas fuera de pantalla, así que elegirlo sin desplazarse no
    // hacía nada visible.
    //
    // El primer posicionamiento es INSTANTÁNEO y solo los posteriores se animan. Con `smooth`
    // también al montar, la animación seguía viva mientras el usuario ya estaba usando la rueda y
    // se COMÍA ese primer gesto (medido: la grilla se quedaba en scrollTop 0 y solo respondía tras
    // ~1,5s). Además, al abrir la página no hay nada que comunicar con un movimiento: la columna
    // simplemente tiene que estar donde toca.
    scrollRef.current.scrollTo({
      left: idx * 216,
      behavior: yaPosicionado.current ? "smooth" : "auto",
    });
    yaPosicionado.current = true;
  }, [highlightMonth, periods]);

  // FR-1606: los meses cuyas reservas superan el margen. UNA derivación por render — el selector
  // está memoizado en el dominio, así que las doce columnas leen un mapa ya calculado.
  const breachByMonth = useMemo(() => {
    const out: Partial<Record<PeriodKey, MonthIssue>> = {};
    if (!hydrated) return out; // durante la hidratación no se pinta: un falso positivo sería peor
    for (const b of monthIssues(data, scope)) out[b.period] = b;
    return out;
  }, [data, hydrated, scope]);

  function toggle(id: string) { setExpanded((e) => ({ ...e, [id]: !e[id] })); }
  function commitEdit() {
    if (!editing) return;
    // FR-2003: en un mes cerrado el editor se abrió en modo SOLO OBSERVACIONES —no hay campo de
    // importe— así que aquí no hay nada que comitear. Cerrar sin escribir es la única salida
    // correcta: el servidor rechazaría igual, pero mandar la escritura provocaría un resync
    // innecesario y un aviso confuso.
    if (cerrados.has(editing.mk)) { setEditing(null); return; }
    // Las hojas transfer no pasan por aquí: su editor (ReserveCellEditor) comitea vía el camino de
    // reserva del dominio (FR-1003) — este commit es el de flujo (expense/income).
    setLeafAmount(editing.id, editing.mk, editing.field, Math.max(0, Math.round(Number(editVal) || 0)));
    setEditing(null);
  }
  function onAdd(a: Adder) {
    const id = createNode({ level: a.level, parentId: a.parentId, type: a.type, name: "" });
    if (!id) return;
    if (a.parentId) setExpanded((e) => ({ ...e, [a.parentId!]: true }));
    // al agregar un grupo, expandir su TIPO para que el nuevo grupo se vea aunque el tipo estuviera colapsado
    if (a.level === "group") setExpanded((e) => ({ ...e, [`type:${a.type}`]: true }));
    setNamingId(id);
  }
  // FR-102: "+" inline en hover. Tipo → agrega grupo; grupo → categoría; categoría → subcategoría.
  function onAddChild(node: LedgerNode) {
    onAdd({ level: node.level === "group" ? "category" : "sub", parentId: node.id, type: node.type });
  }
  function onAddGroup(type: NodeType) {
    onAdd({ level: "group", parentId: null, type });
  }
  function onDragStart(ev: DragStartEvent) {
    setDragId(String(ev.active.id));
    document.body.style.cursor = "grabbing";
  }
  function endDrag() {
    setDragId(null);
    document.body.style.cursor = "";
  }
  function onDragEnd(ev: DragEndEvent) {
    endDrag();
    const over = ev.over;
    if (!over) return;
    const [kind, id] = String(over.id).split(":");
    if (kind === "category" || kind === "group") {
      // FR-703: degradar un grupo que desbordaría el techo de 3 niveles se bloquea con aviso.
      const res = moveNode(String(ev.active.id), { kind: kind as "category" | "group", id });
      if (res === "would_overflow") showToast("Vacía o mueve las subcategorías primero");
    } else if (kind === "root") moveNode(String(ev.active.id), { kind: "root", type: id as NodeType }); // FR-601: promover a grupo
  }
  const dragNode = dragId ? data.nodes.find((n) => n.id === dragId) ?? null : null;

  /** Render de una fila del árbol — compartido por los dos segmentos de la grilla.
   *  `isLast` = última fila de SU tarjeta: su rótulo redondea la esquina inferior izquierda. */
  function renderRow(row: Row, i: number, isLast: boolean) {
    if (row.node === null) {
      const t = TYPE_ORDER.find((x) => x.id === row.type)!;
      // FR-904/banda: filete fuerte al inicio de cada bloque de tipo. El primero de cada segmento
      // no lo lleva: el encabezado sticky (segmento 1) o la separación (segmento 2) ya cierran.
      return (
        <Fragment key={`t-${row.type}`}>
          <TypeTotalRow
            type={row.type}
            label={t.label}
            Icon={t.Icon}
            highlightMonth={highlightMonth}
            activeType={dragNode?.type ?? null}
            isExpanded={expanded[`type:${row.type}`] !== false}
            onToggle={() => toggle(`type:${row.type}`)}
            onAddGroup={() => onAddGroup(row.type)}
            bandTop={i > 0}
            roundTop={i === 0}
            roundBottom={isLast}
          />
        </Fragment>
      );
    }
    return (
      <NodeRow
        key={row.node.id}
        roundBottom={isLast}
        row={row}
        editing={editing}
        closedPeriods={cerrados}
        editVal={editVal}
        naming={namingId === row.node.id}
        highlightMonth={highlightMonth}
        onToggle={() => toggle(row.node!.id)}
        isExpanded={!!expanded[row.node.id]}
        startEdit={(mk, field, cur) => {
          // FR-2003/FR-2009 — UN solo punto: aquí pasan las dos celdas editables (presupuesto y
          // ejecutado), así que basta con esto para que ninguna de un mes cerrado abra edición.
          // Es ERGONOMÍA, no garantía: la autoridad sigue estando en el servidor (ADR-12). Y la
          // salida se NOMBRA — un rechazo que no dice qué hacer manda al usuario a probar cosas.
          if (cerrados.has(mk)) {
            // NO se corta el camino: se abre el editor en modo SOLO OBSERVACIONES. Cortarlo dejaba
            // las notas inalcanzables —el panel de observaciones vive DENTRO de este editor— y las
            // notas son la única salida que le queda a un error demasiado viejo para reabrirse
            // (FR-2004). Bloquear la celda entera habría convertido esa decisión en letra muerta.
            showToast(
              mk === reopenable
                ? `${periodMonthLabel(mk)} está cerrado: su cifra no se edita. Puedes reabrirlo para corregirlo, o dejar una observación.`
                : `${periodMonthLabel(mk)} está cerrado y no es el último cerrado, así que no se puede reabrir. Puedes dejar una observación en la celda.`
            );
            setEditing({ id: row.node!.id, mk, field }); setEditVal(String(cur || 0));
            return;
          }
          setEditing({ id: row.node!.id, mk, field }); setEditVal(String(cur || 0));
        }}
        setEditVal={setEditVal}
        commitEdit={commitEdit}
        cancelEdit={() => setEditing(null)}
        startNaming={() => setNamingId(row.node!.id)}
        commitName={(name) => { renameNode(row.node!.id, name); setNamingId(null); }}
        setIcon={(icon) => setNodeIcon(row.node!.id, icon)}
        onDelete={() => deleteNode(row.node!.id)}
        onAddChild={() => onAddChild(row.node!)}
        planWarnMonths={planWarnMonths}
      />
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={endDrag}>
      <div ref={scrollRef} className="lx-scroll overflow-auto flex-1" data-testid="budget-grid" style={{ ["--cat-w" as string]: `${catW}px` } as React.CSSProperties}>
        <div className="w-max min-w-full text-caption">
          {/* Encabezados sticky */}
          <div className="sticky top-0 z-[3] flex">
            <div className={cn(STICKY_BASE, LABEL_W, "items-end h-[98px] pl-3.5 pr-2.5 pb-2.5 bg-sunken border-b border-border-strong eyebrow")}>CATEGORÍA
              {/* FR-104: manija de resize (la celda sticky ya es containing block para el absolute) */}
              <span
                onPointerDown={startResize}
                role="separator"
                aria-label="Redimensionar columna de categorías"
                aria-orientation="vertical"
                title="Arrastra para ampliar la columna"
                className="group absolute right-0 top-0 bottom-0 w-2.5 flex justify-end cursor-col-resize"
              >
                {/* línea visible siempre (afordancia), acento en hover/arrastre */}
                <span className="w-[2px] h-full bg-border-hover group-hover:bg-accent transition-colors" />
              </span>
            </div>
            <div className="flex flex-col">
              {/* FR-1905 — BANDA DE AÑO. En una tira continua el nombre del mes no basta: dos
                  «Marzo» separados por doce columnas son indistinguibles. La marca no puede colgar
                  de enero, porque un rango que arranca en septiembre no tiene enero hasta el año
                  siguiente y el primer tramo se quedaría sin etiqueta. El rótulo va pegado al borde
                  izquierdo de su tramo (sticky) para seguir visible mientras se scrollea dentro de
                  un año largo. */}
              <div className="flex" data-testid="year-band">
                {yearBands.map((b) => (
                  <div
                    key={b.year}
                    data-year={b.year}
                    style={{ width: b.count * 216 }}
                    className="h-[22px] flex items-center bg-sunken border-b border-border border-l-2 border-l-fg-muted overflow-hidden"
                  >
                    {/* Sin `style={{color}}`: la clase `.eyebrow` fija el color del sistema y
                        pisarlo rompe NFR de consistencia (TC-UXC-306h exige que TODOS los eyebrow
                        resuelvan al mismo color; el año no es una excepción). */}
                    <span className="sticky left-0 px-2 eyebrow tabular">{b.year}</span>
                  </div>
                ))}
              </div>
              <div className="flex">
                {periods.map((m) => {
                  const active = highlightMonth === m;
                  // El mes activo DESTACA por peso + color pleno; los inactivos recéden en gris
                  // secundario. (Antes usaba --accent-light = gris, que en el tema neutro dejaba el
                  // activo MÁS apagado que los demás — al revés de lo buscado.)
                  return (
                    <div
                      key={m}
                      className={cn(CELL_W, "flex items-center justify-center gap-1 h-[38px] px-2 label bg-sunken border-b border-border border-l-2", active && "font-semibold",
                        // FR-1905: el cambio de año se MARCA. Sin esto, dos «Mar» separados por
                        // doce columnas son indistinguibles en una tira continua.
                        isYearStart(m) ? "border-l-fg-muted" : "border-l-border-strong")}
                      style={{ width: 216, color: active ? "var(--fg)" : "var(--fg-secondary)" }}
                      data-month-head={m}
                      data-year-start={isYearStart(m) || undefined}
                      data-closed={cerrados.has(m) ? "true" : "false"}
                      title={
                        cerrados.has(m)
                          ? `${periodMonthLabel(m)} de ${periodYear(m)} — mes cerrado: sus cifras no se editan`
                          : `${periodMonthLabel(m)} de ${periodYear(m)}`
                      }
                    >
                      {/* FR-2009: la señal de «cerrado» NO puede ser solo el color — en escala de
                          grises tiene que seguir leyéndose (WCAG 1.4.1). El candado es ese segundo
                          canal, igual que el glifo lo es para el código de estado. */}
                      {cerrados.has(m) ? (
                        <span
                          data-testid="closed-mark"
                          data-month={m}
                          title={`${periodMonthLabel(m)} está cerrado`}
                          aria-label={`${periodMonthLabel(m)} está cerrado`}
                          className="flex-none inline-flex"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          <Lock size={12} aria-hidden="true" />
                        </span>
                      ) : null}
                      {breachByMonth[m] ? (
                        <span
                          data-testid="techo-mark"
                          data-month={m}
                          title={`${periodMonthLabel(m)}: reservas ${money(breachByMonth[m]!.excess)} por encima del margen del mes`}
                          aria-label={`${periodMonthLabel(m)}: reservas ${money(breachByMonth[m]!.excess)} por encima del margen del mes`}
                          className="flex-none inline-flex"
                          style={{ color: "var(--alert-strong)" }}
                        >
                          <TriangleAlert size={13} aria-hidden="true" />
                        </span>
                      ) : null}
                      {periodMonthLabel(m)}
                    </div>
                  );
                })}
              </div>
              <div className="flex">
                {periods.map((m) => (
                  <div key={m} className="flex">
                    <div className={cn(CELL_W, "flex items-center justify-end h-[38px] px-3 caption text-fg-muted bg-sunken border-b border-border-strong border-l-2 border-l-border-strong")}>Pres.</div>
                    <div className={cn(CELL_W, "flex items-center justify-end h-[38px] px-3 caption text-fg-muted bg-sunken border-b border-border-strong")}>Ejec.</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Los TRES bloques ─────────────────────────────────────────────────────────
              Cada uno es una TARJETA —fondo, borde y esquinas redondeadas— separada de la
              siguiente por --spacing-6. Viven dentro del MISMO contenedor de scroll (ADR-04), así
              que los doce meses siguen siendo un solo riel alineado: la tarjeta hereda el ancho del
              contenido (`w-max`), no el del viewport, y por eso su borde derecho acompaña al scroll.
              La separación es ESPACIO y forma, nunca color de categoría (regla de refinamiento-ui
              FR-1201: el color codifica estado). */}
          <div className={SEGMENT}>
            {segmentoFlujo.map((row, i, arr) => renderRow(row, i, i === arr.length - 1))}
          </div>

          <div aria-hidden="true" style={{ height: "var(--spacing-6, 24px)" }} />

          <div className={SEGMENT}>
            {/* Ninguna fila del árbol es la última aquí: cierra la fila «Retiros del mes». */}
            {segmentoReservas.map((row, i) => renderRow(row, i, false))}
            {/* FR-1805: la puerta para SACAR, al final del bloque y junto a los bolsillos. */}
            <RetirosRow highlightMonth={highlightMonth} />
          </div>

          <div aria-hidden="true" style={{ height: "var(--spacing-6, 24px)" }} />

          {/* El Balance va DENTRO del contenedor de scroll para compartir la rejilla de columnas y
              la columna de rótulos sticky (FR-905/906/907/908). Recibe el mes activo para que el
              sombreado atraviese los tres bloques (AC-1828): hoy no lo tenía. */}
          <div className={SEGMENT}>
            <BalanceModule highlightMonth={highlightMonth} />
          </div>
        </div>
      </div>
      {/* FR-015: preview flotante del nodo en arrastre (feedback claro de "estoy moviendo esto") */}
      <DragOverlay dropAnimation={null}>
        {dragNode ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-accent shadow-lg text-label text-fg cursor-grabbing" style={{ boxShadow: "var(--shadow-lg)" }}>
            <NodeIcon name={dragNode.icon} level={dragNode.level} size={14} color={dragNode.level === "sub" ? "var(--fg-muted)" : "var(--fg-secondary)"} />
            {dragNode.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}


function TypeTotalRow({ type, label, Icon, highlightMonth, activeType, isExpanded, onToggle, onAddGroup, bandTop, roundTop, roundBottom }: { type: NodeType; label: string; Icon: typeof ArrowLeft; highlightMonth: PeriodKey | null; activeType: NodeType | null; isExpanded: boolean; onToggle: () => void; onAddGroup: () => void; bandTop?: boolean; roundTop?: boolean; roundBottom?: boolean }) {
  // Esta fila solo PINTA: una celda por columna visible. Usaba `activePeriods` y pintaba 32
  // celdas bajo un encabezado de 12 con el filtro en Año — celdas sin mes encima.
  const periods = useVisiblePeriods();
  const data = useLedgerStore((s) => s.data);
  // refinamiento-ui FR-1202: el bloque se distingue por GLIFO y PESO, no por color. El usuario
  // rechazó el hue de estructura al verlo ("prefiero blancos, color neutro"), así que la grilla
  // queda con cero color de identidad y el canal cromático se libera para el estado.
  const color = "var(--fg)";
  const [hover, setHover] = useState(false);
  // FR-601: la fila de tipo es destino de promoción a grupo. Solo el tipo COMPATIBLE con el nodo
  // arrastrado muestra la afordancia (prevención de error / cross-type, H5).
  const droppable = useDroppable({ id: `root:${type}` });
  const showDrop = droppable.isOver && activeType === type;
  return (
    <div className={cn("flex", bandTop && "border-t border-t-border-strong")} data-testid="type-total-row" data-type={type} ref={droppable.setNodeRef} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* FR-404/ADR-04: la fila de total por tipo NO es editable, así que migra de la capa elevada a
          la hundida. Efecto buscado: su rojo de identidad de tipo deja de confundirse con el rojo de
          sobre-consumo de una celda de datos. */}
      <div data-testid="row-label" className={cn(STICKY_BASE, LABEL_W, "bg-sunken border-b border-border pl-3.5 pr-2.5 gap-2 font-semibold", roundTop && "rounded-tl-(--radius-md)", roundBottom && "rounded-bl-(--radius-md)")} style={{ color, boxShadow: showDrop ? "inset 0 0 0 2px var(--accent)" : undefined }}>
        <button aria-label="Colapsar tipo" onClick={onToggle} className="inline-flex w-3.5 flex-none cursor-pointer" style={{ color }}>{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
        <Icon size={15} color={color} />
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
        <span className="flex-1 min-w-0" />
        {/* Afordancia de destino de promoción (solo durante un arrastre compatible) */}
        {showDrop && <span data-testid="promote-hint" className="flex-none caption" style={{ color: "var(--accent-light)" }}>Soltar para crear grupo</span>}
        {/* "+" para agregar un GRUPO de este tipo (el adder de grupo vive en el hover del tipo) */}
        {hover && !showDrop && (
          <button aria-label="Agregar grupo" onClick={onAddGroup} className="inline-flex p-[3px] rounded-md flex-none cursor-pointer bg-transparent border-0" style={{ color }}><Plus size={14} /></button>
        )}
      </div>
      {periods.map((m) => {
        // Modelo v4: los TRES tipos totalizan por celdas del mes (planes y ejecuciones — decisión
        // del usuario 2026-07-29). El acumulado de reservas vive en el Balance (Saldo reservado).
        const t = typeTotals(data, type, [m]);
        return (
          <div key={m} className="flex">
            {/* La fila de total conserva el color de identidad del tipo y NUNCA lleva glifo (FR-402). */}
            <Cell value={t.budget} sep bold color={color} sunken highlight={highlightMonth === m} />
            <Cell value={t.actual} bold color={color} sunken highlight={highlightMonth === m} />
          </div>
        );
      })}
    </div>
  );
}



/** Nº de observaciones de una celda — el indicador que la marca (FR-1809). */
function useNotesOf(data: LedgerState) {
  return (nodeId: string, month: PeriodKey) => (data.cellNotes?.[nodeId]?.[month] ?? []).length;
}

function NodeRow(props: {
  row: Row;
  editing: { id: string; mk: PeriodKey; field: "budget" | "actual" } | null;
  /** Periodos CERRADOS visibles (FR-2009). Se pasa ya calculado: la fila no consulta el store. */
  closedPeriods: Set<PeriodKey>;
  editVal: string;
  naming: boolean;
  highlightMonth: PeriodKey | null;
  isExpanded: boolean;
  onToggle: () => void;
  startEdit: (mk: PeriodKey, field: "budget" | "actual", cur: number) => void;
  setEditVal: (v: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
  startNaming: () => void;
  commitName: (name: string) => void;
  setIcon: (icon: string) => void;
  onDelete: () => void;
  onAddChild: () => void;
  planWarnMonths: Partial<Record<PeriodKey, number>>;
  /** Última fila de su tarjeta: el rótulo redondea la esquina inferior izquierda. */
  roundBottom?: boolean;
}) {
  // Pinta por columna visible; `scope` es para las reglas que miran TODO el rango.
  const periods = useVisiblePeriods();
  const scope = useActivePeriods();
  const { row, naming } = props;
  const node = row.node!;
  const data = useLedgerStore((s) => s.data);
  const notesOf = useNotesOf(data);
  const [hover, setHover] = useState(false);
  const [nameVal, setNameVal] = useState(node.name);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => { if (naming) setNameVal(node.name); }, [naming, node.name]);

  // Feature demote-node (FR-701): los grupos se vuelven arrastrables (para bajarlos de nivel);
  // solo los nodos del sistema quedan fijos.
  const draggable = useDraggable({ id: node.id, disabled: node.system });
  const dropId = node.level === "group" ? `group:${node.id}` : node.level === "category" ? `category:${node.id}` : null;
  const droppable = useDroppable({ id: dropId ?? `noop:${node.id}` });
  const canDrag = !node.system;
  const bWeight = node.level === "group" ? 500 : 400;
  // FR-404: superficie de la fila. El realce de drop se mezcla SOBRE ella (una categoría hoja es
  // lienzo, un grupo es estructura), no sobre el lienzo en ambos casos.
  const rowSurface = row.leaf ? "var(--bg)" : "var(--bg-sunken)";

  return (
    <div className="flex flex-col" data-testid="node-row" data-level={node.level} data-leaf={String(row.leaf)} style={{ opacity: draggable.isDragging ? 0.4 : 1 }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} ref={dropId ? droppable.setNodeRef : undefined}>
      <div className="flex">
        <div
          ref={draggable.setNodeRef}
          {...(canDrag ? draggable.listeners : {})}
          {...(canDrag ? draggable.attributes : {})}
          data-testid="row-label"
          className={cn(STICKY_BASE, LABEL_W, "border-b border-border py-1.5 pr-2.5", canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-default", props.roundBottom && "rounded-bl-(--radius-md)")}
          style={{
            paddingLeft: 14 + row.depth * 16,
            // FR-404: la columna fija comparte la superficie de la fila — la estructura se distingue
            // del dato editable en TODA la fila, no solo en las celdas de mes.
            background: droppable.isOver && dropId ? `color-mix(in srgb, var(--accent) 18%, ${rowSurface})` : rowSurface,
            boxShadow: droppable.isOver && dropId ? "inset 0 0 0 1.5px var(--accent)" : undefined,
          }}
        >
          <button aria-label="Expandir" onClick={props.onToggle} className={cn("inline-flex w-3.5 flex-none text-fg-muted", row.expandable ? "visible cursor-pointer" : "invisible")}>{props.isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
          {(node.level === "category" || node.level === "group") && !node.system ? (
            // FR-309/310: selector de iconos rico en un Popover shadcn (≥40 Lucide, buscable)
            <IconPicker
              value={node.icon}
              onChange={(icon) => props.setIcon(icon)}
              color="var(--fg-secondary)"
              trigger={
                <button aria-label="Cambiar ícono" title="Cambiar ícono" className="inline-flex flex-none cursor-pointer bg-transparent border-0 p-0 rounded-(--radius-sm) outline-none focus-visible:ring-1 focus-visible:ring-accent data-[state=open]:ring-1 data-[state=open]:ring-accent">
                  <NodeIcon name={node.icon} level={node.level} size={15} color="var(--fg-secondary)" />
                </button>
              }
            />
          ) : (
            <span className="inline-flex flex-none"><NodeIcon name={node.icon} level={node.level} size={node.level === "sub" ? 13 : 15} color={node.level === "sub" ? "var(--fg-muted)" : "var(--fg-secondary)"} /></span>
          )}
          {naming ? (
            <input autoFocus aria-label="Nombre" value={nameVal} onChange={(e) => setNameVal(e.target.value)} onBlur={() => props.commitName(nameVal)} onKeyDown={(e) => { if (e.key === "Enter") props.commitName(nameVal); if (e.key === "Escape") props.commitName(node.name); }} className="flex-1 min-w-0 bg-card border border-accent rounded-md text-fg px-2 py-1 text-label outline-none" />
          ) : (
            <span onClick={props.onToggle} className={cn("flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap", row.expandable && !canDrag && "cursor-pointer")}>{node.name}</span>
          )}
          {confirmDel && !node.system && (
            <span className="flex gap-1 flex-none">
              <button aria-label="Confirmar borrado" onClick={() => { props.onDelete(); setConfirmDel(false); }} className="inline-flex p-[3px] rounded-md text-error cursor-pointer bg-transparent border-0"><Check size={14} /></button>
              <button aria-label="Cancelar borrado" onClick={() => setConfirmDel(false)} className="inline-flex p-[3px] rounded-md text-fg-muted cursor-pointer bg-transparent border-0"><X size={14} /></button>
            </span>
          )}
          {hover && !node.system && !naming && !confirmDel && (
            <span className="flex gap-px flex-none">
              {(node.level === "group" || node.level === "category") && (
                <button aria-label={node.level === "group" ? "Agregar categoría" : "Agregar subcategoría"} onClick={props.onAddChild} className="inline-flex p-[3px] rounded-md text-fg-muted hover:text-fg cursor-pointer bg-transparent border-0"><Plus size={13} /></button>
              )}
              <button aria-label="Renombrar" onClick={props.startNaming} className="inline-flex p-[3px] rounded-md text-fg-muted hover:text-fg cursor-pointer bg-transparent border-0"><Pencil size={13} /></button>
              {/* #4: solo mostrar borrar si el nodo es realmente borrable (grupo vacío; categoría/sub sin datos) */}
              {canDeleteNode(data, node.id, scope) && (
                <button aria-label="Borrar" onClick={() => setConfirmDel(true)} className="inline-flex p-[3px] rounded-md text-fg-muted hover:text-fg cursor-pointer bg-transparent border-0"><Trash2 size={13} /></button>
              )}
            </span>
          )}
        </div>

        {periods.map((m) => {
          // Modelo v4: la celda transfer es el APORTE del mes (flujo). Solo la HOJA usa el editor
          // de reserva (franja de validación + observaciones); los padres agregan como siempre.
          if (node.type === "transfer" && row.leaf) {
            const editingB = props.editing?.id === node.id && props.editing.mk === m && props.editing.field === "budget";
            const editingA = props.editing?.id === node.id && props.editing.mk === m && props.editing.field === "actual";
            return (
              <div key={m} className="flex">
                {editingB ? (
                  <ReserveCellEditor leafId={node.id} month={m} plane="budget" sep highlight={props.highlightMonth === m} onClose={props.cancelEdit} />
                ) : (
                  <ReserveLeafCell leafId={node.id} month={m} plane="budget" sep highlight={props.highlightMonth === m} planWarnMonths={props.planWarnMonths} onStart={() => props.startEdit(m, "budget", 0)} />
                )}
                {editingA ? (
                  <ReserveCellEditor leafId={node.id} month={m} plane="actual" highlight={props.highlightMonth === m} onClose={props.cancelEdit} />
                ) : (
                  <ReserveLeafCell leafId={node.id} month={m} plane="actual" highlight={props.highlightMonth === m} planWarnMonths={props.planWarnMonths} onStart={() => props.startEdit(m, "actual", 0)} />
                )}
              </div>
            );
          }
          const bud = rollupBudget(data, node.id, m);
          const act = rollupActual(data, node.id, m);
          return (
            <div key={m} className="flex">
              <EditableCell editing={props.editing?.id === node.id && props.editing.mk === m && props.editing.field === "budget"} value={bud} sep muted weight={bWeight} leaf={row.leaf} highlight={props.highlightMonth === m} editVal={props.editVal} nodeId={row.leaf ? node.id : undefined} month={m} plane="budget" closed={props.closedPeriods.has(m)} onStart={() => row.leaf && props.startEdit(m, "budget", bud)} setEditVal={props.setEditVal} commit={props.commitEdit} cancel={props.cancelEdit} />
              <EditableCell editing={props.editing?.id === node.id && props.editing.mk === m && props.editing.field === "actual"} value={act} color={ejecColor(node.type, bud, act)} glyph={ejecGlyph(node.type, bud, act)} leaf={row.leaf} highlight={props.highlightMonth === m} editVal={props.editVal} nodeId={row.leaf ? node.id : undefined} month={m} plane="actual" closed={props.closedPeriods.has(m)} notes={notesOf(node.id, m)} onStart={() => row.leaf && props.startEdit(m, "actual", act)} setEditVal={props.setEditVal} commit={props.commitEdit} cancel={props.cancelEdit} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditableCell(props: { editing: boolean; value: number; sep?: boolean; muted?: boolean; color?: string; weight?: number; leaf: boolean; highlight?: boolean; glyph?: string; editVal: string; nodeId?: string; month?: PeriodKey; plane?: "budget" | "actual"; notes?: number; closed?: boolean; onStart: () => void; setEditVal: (v: string) => void; commit: () => void; cancel: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  // El foco tiene que entrar en el contenedor cuando NO hay input que lo tome (mes cerrado), o la
  // tecla Escape se queda en el body y el panel no se cierra nunca.
  const abiertoCerrado = props.editing && props.closed;
  useEffect(() => { if (abiertoCerrado) rootRef.current?.focus(); }, [abiertoCerrado]);
  if (props.editing) {
    return (
      <div
        ref={rootRef}
        // El Escape se atiende en el CONTENEDOR y no solo en el input del valor: el editor incluye
        // el panel de observaciones (FR-1809), y desde su campo la tecla nunca alcanzaba al input
        // hermano — el editor quedaba abierto sin salida por teclado, contra el «Esc cierra sin
        // guardar» que declara el UX spec para esa sección.
        onKeyDown={(e) => { if (e.key === "Escape") props.cancel(); }}
        // En modo SOLO OBSERVACIONES no hay campo de importe, así que nadie tomaba el foco: la
        // tecla Escape no alcanzaba este contenedor y el panel se quedaba abierto sin salida. El
        // contenedor se hace enfocable y se cierra al perder el foco, igual que hacía el input.
        {...(props.closed ? { tabIndex: -1 } : {})}
        onBlur={props.closed ? (e) => {
          if (rootRef.current?.contains(e.relatedTarget as Node)) return;
          props.cancel();
        } : undefined}
        className={cn(CELL_W, "relative py-1 px-2 outline-none", props.sep && "border-l-2 border-l-border-strong")}
        style={{ background: props.highlight ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined }}
      >
        {/* FR-2003/FR-2004/AC-2013: en un mes cerrado la CIFRA se pinta como texto y no como
            campo, y debajo sigue el panel de observaciones. La celda dice las dos cosas a la vez
            —esto no se toca, esto sí— sin que el usuario tenga que probar. */}
        {props.closed ? (
          <div
            data-testid="closed-value"
            aria-label="Valor de un mes cerrado, no editable"
            className="tabular w-full text-fg-secondary text-caption text-right px-1.5 py-1"
          >
            {props.editVal}
          </div>
        ) : (
        <input
          autoFocus
          aria-label="Editar valor"
          value={props.editVal}
          onChange={(e) => props.setEditVal(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={(e) => {
            // El foco que se queda DENTRO del editor (las observaciones) no comitea la celda —
            // mismo patrón que ya usa el editor de bolsillos.
            if (rootRef.current?.contains(e.relatedTarget as Node)) return;
            props.commit();
          }}
          onKeyDown={(e) => { if (e.key === "Enter") props.commit(); if (e.key === "Escape") props.cancel(); }}
          className="tabular w-full bg-elevated border border-accent rounded-(--radius-sm) text-fg text-caption text-right px-1.5 py-1 outline-none"
        />
        )}
        {/* FR-1809: cualquier celda admite observación, no solo las de bolsillos. */}
        {props.nodeId && props.month && (
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[230px] rounded-(--radius-sm) border border-border bg-elevated p-2" style={{ boxShadow: "var(--shadow-md)" }}>
            <CellNotesSection leafId={props.nodeId} month={props.month} />
          </div>
        )}
      </div>
    );
  }
  // FR-404: la fila NO editable (!leaf) lleva la superficie hundida — el MISMO predicado que gobierna
  // la edición, así la afordancia no puede desalinearse del comportamiento (ADR-05).
  return <Cell value={props.value} sep={props.sep} muted={props.muted} color={props.color} weight={props.weight} highlight={props.highlight} sunken={!props.leaf} glyph={props.glyph} notes={props.notes} nodeId={props.nodeId} month={props.month} plane={props.plane} closed={props.closed} onClick={props.leaf ? props.onStart : undefined} clickable={props.leaf} />;
}

/**
 * Superficie de una celda. El tinte del mes resaltado se compone SOBRE el fondo de la fila, no
 * sobre el lienzo: por eso la celda resaltada de una fila hundida es #e4e4e6 — la superficie más
 * oscura de la grilla en claro, y la que fija el peor caso de AA (NFR-403).
 *
 * @param sunken La fila NO es editable (estructura).
 * @param highlight La celda pertenece al mes del filtro.
 * @returns El valor de `background` para el `style` de la celda.
 *
 * @aitri-trace FR-ID: FR-404, US-ID: US-404, AC-ID: AC-404, TC-ID: TC-BSC-404h, TC-BSC-453e
 */
function cellSurface(sunken: boolean | undefined, highlight: boolean | undefined): string {
  const base = sunken ? "var(--bg-sunken)" : "var(--bg)";
  return highlight ? `color-mix(in srgb, var(--accent) 6%, ${base})` : base;
}

function Cell({ value, sep, muted, color, weight, bold, highlight, sunken, glyph, notes, carryNote, onClick, clickable, nodeId, month, plane, closed }: { value: number; sep?: boolean; muted?: boolean; color?: string; weight?: number; bold?: boolean; highlight?: boolean; sunken?: boolean; glyph?: string; notes?: number; carryNote?: string; onClick?: () => void; clickable?: boolean; nodeId?: string; month?: PeriodKey; plane?: "budget" | "actual"; closed?: boolean }) {
  // FR-2009/AC-2013: la celda de un mes cerrado se distingue como no editable SIN que el usuario
  // tenga que probar — `data-closed` y un cursor que deja de decir «aquí se escribe».
  //
  // `data-plane`: las dos celdas de un mes comparten `data-cell` y `data-month`, así que sin él son
  // indistinguibles desde fuera. Importa más de lo que parece — solo la cadena EJECUTADA arrastra
  // al mes siguiente, así que «editar el plan» y «editar lo ejecutado» tienen consecuencias
  // distintas aguas abajo (FR-2010).
  return (
    <div
      onClick={onClick}
      data-testid={clickable ? "cell-leaf" : "cell-parent"}
      {...(nodeId ? { "data-cell": nodeId } : {})}
      {...(month ? { "data-month": month } : {})}
      {...(plane ? { "data-plane": plane } : {})}
      {...(closed ? { "data-closed": "true" } : {})}
      title={carryNote}
      {...(carryNote ? { "data-carry-note": carryNote } : {})}
      className={cn(CELL_W, "relative flex items-center justify-end min-h-[34px] px-3 tabular border-b border-border whitespace-nowrap", sep && "border-l-2 border-l-border-strong", clickable && !closed ? "cursor-text" : "cursor-default")}
      style={{
        // refinamiento-ui FR-1202: un valor 0 se pinta como "—" y significa «aquí no hay nada».
        // Antes heredaba el color del tipo, así que la pantalla llegaba a tener ~30 guiones rojos,
        // verdes y azules gastando el canal más fuerte en la AUSENCIA de información.
        color: !value ? "var(--fg-muted)" : (color ?? (muted ? "var(--fg-secondary)" : "var(--fg)")),
        fontWeight: bold ? 500 : weight ?? 400,
        background: cellSurface(sunken, highlight),
      }}
    >
      {/* Canal redundante de WCAG 1.4.1 (FR-402): aria-hidden porque el dato ya lo portan el monto
          y el Pres. adyacente. flex-none para que nunca empuje al monto fuera de la celda. */}
      {/* FR-1809: la celda con observaciones lo dice con un marcador. En ÁMBAR y no en gris, y con
          más cuerpo que el punto de 4px que había: el usuario pidió «algún elemento más visible».
          Sin observaciones no hay marca — la grilla no gana ruido donde no hay nada anotado. */}
      {notes ? (
        <span
          data-testid="note-dot"
          aria-hidden="true"
          className="absolute right-[2px] top-[2px] h-[7px] w-[7px] rounded-full border"
          style={{ background: "var(--alert-soft)", borderColor: "var(--bg)" }}
        />
      ) : null}
      {glyph ? <span data-testid="cell-glyph" aria-hidden="true" title={GLYPH_TITLE[glyph]} className="flex-none mr-1 text-caption leading-none">{glyph}</span> : null}
      {cellNum(value)}
    </div>
  );
}

function initialExpanded(nodes: LedgerNode[]): Record<string, boolean> {
  const e: Record<string, boolean> = {};
  for (const t of TYPE_ORDER) e[`type:${t.id}`] = true;
  // Todos los grupos arrancan ABIERTOS, incluidos los de bolsillos.
  //
  // Durante EP-02 los de tipo `transfer` se hicieron arrancar PLEGADOS leyendo AC-1820 como un
  // mandato. No lo es: dice «CON los grupos de bolsillos plegados, la fila Retiros del mes sigue
  // visible» — una condición sobre el estado plegado, que la fila cumple por estar al final del
  // segmento, se pliegue o no. Arrancar plegado escondía TODOS los bolsillos del usuario nada más
  // abrir la app (una decisión de producto que nadie pidió) y dejaba sin encontrar sus filas a dos
  // e2e vigentes de la feature `transferencias`. Revertido: el plegado lo decide el usuario.
  for (const n of nodes) if (n.level === "group") e[n.id] = true;
  return e;
}

function buildRows(nodes: LedgerNode[], expanded: Record<string, boolean>): Row[] {
  const rows: Row[] = [];
  for (const { id: type } of TYPE_ORDER) {
    const groups = nodes.filter((n) => n.type === type && n.level === "group").sort((a, b) => a.order - b.order);
    rows.push({ node: null, type, depth: 0, leaf: false, expandable: false });
    if (expanded[`type:${type}`] === false) continue; // tipo colapsado: no mostrar sus grupos
    for (const g of groups) {
      pushNode(rows, nodes, g, type, 1, expanded);
    }
  }
  return rows;
}

// Sin filas adder: agregar es por el "+" en hover de cada nivel
// (tipo → grupo, grupo → categoría, categoría → subcategoría).
function pushNode(rows: Row[], nodes: LedgerNode[], node: LedgerNode, type: NodeType, depth: number, expanded: Record<string, boolean>) {
  const kids = childrenOf(nodes, node.id).sort((a, b) => a.order - b.order);
  const leaf = isLeaf(node, nodes);
  rows.push({ node, type, depth, leaf, expandable: kids.length > 0 });
  if (kids.length > 0 && expanded[node.id]) {
    for (const k of kids) pushNode(rows, nodes, k, type, depth + 1, expanded);
  }
}
