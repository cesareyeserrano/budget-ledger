"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { ChevronRight, ChevronDown, Pencil, Trash2, Plus, Check, X, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useLedgerStore } from "@/state/store";
import type { LedgerNode, MonthKey, NodeLevel, NodeType } from "@/domain/types";
import { MONTHS } from "@/domain/months";
import { rollupBudget, rollupActual, typeTotals } from "@/domain/rollup";
import { budgetState, type BudgetState } from "@/domain/budgetState";
import { isLeaf, childrenOf } from "@/domain/tree";
import { canDeleteNode } from "@/domain/mutations";
import { cellNum, typeColorVar } from "./format";
import { NodeIcon } from "./NodeIcon";
import { IconPicker } from "./IconPicker";
import { cn } from "@/lib/utils";
import { readCatWidth, writeCatWidth, clampCatWidth } from "@/lib/gridWidth";

const TYPE_ORDER: { id: NodeType; label: string; Icon: typeof ArrowDown }[] = [
  { id: "expense", label: "GASTOS", Icon: ArrowDown },
  { id: "income", label: "INGRESOS", Icon: ArrowUp },
  { id: "transfer", label: "TRANSFERENCIAS", Icon: ArrowUpDown },
];

// Ancho de la columna categoría vía CSS var --cat-w (FR-104, redimensionable); sub-celda de mes 108px, alto de fila 37px.
const LABEL_W = "w-[var(--cat-w)]";
const CELL_W = "w-[108px]";
const STICKY_BASE = "sticky left-0 z-[2] flex items-center gap-2 flex-none border-r border-border-strong min-h-[34px]";

interface Adder { level: NodeLevel; parentId: string | null; type: NodeType }
interface Row { node: LedgerNode | null; type: NodeType; depth: number; leaf: boolean; expandable: boolean }

/**
 * Color y glifo del estado de sobre-consumo. Ambos se indexan por el MISMO BudgetState (ADR-02):
 * mientras se lean de estas dos tablas, el canal redundante de WCAG 1.4.1 no puede contradecir al
 * color, porque no hay una segunda condición que mantener en sincronía.
 */
const STATE_COLOR: Record<BudgetState, string> = {
  within: "var(--fg)",
  over_soft: "var(--state-warning)",
  over_hard: "var(--state-over)",
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
function ejecColor(type: NodeType, b: number, e: number): string {
  if (!e) return "var(--fg-secondary)";
  if (type === "expense") return STATE_COLOR[budgetState(b, e)];
  if (type === "income") return e >= b ? "var(--success)" : "var(--warning)";
  return "var(--accent-light)";
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
function ejecGlyph(type: NodeType, b: number, e: number): "" | "›" | "››" {
  if (!e || type !== "expense") return "";
  return stateGlyph(budgetState(b, e));
}

export function BudgetGrid() {
  const data = useLedgerStore((s) => s.data);
  const setLeafAmount = useLedgerStore((s) => s.setLeafAmount);
  const deleteNode = useLedgerStore((s) => s.deleteNode);
  const renameNode = useLedgerStore((s) => s.renameNode);
  const createNode = useLedgerStore((s) => s.createNode);
  const setNodeIcon = useLedgerStore((s) => s.setNodeIcon);
  const moveNode = useLedgerStore((s) => s.moveNode);
  const showToast = useLedgerStore((s) => s.showToast);
  const period = useLedgerStore((s) => s.period);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => initialExpanded(data.nodes));
  const [editing, setEditing] = useState<{ id: string; mk: MonthKey; field: "budget" | "actual" } | null>(null);
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
  const highlightMonth = period.mode === "month" ? period.month : null;

  // BG-007: al montar, posicionar el scroll horizontal en el mes resaltado (el estado ya arranca
  // en el mes en curso, pero el contenedor iniciaba en scrollLeft=0 → siempre se veía enero).
  // Cada mes ocupa 216px (dos celdas CELL_W de 108px); la columna de categoría es sticky.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlightMonth || !scrollRef.current) return;
    const idx = MONTHS.findIndex((m) => m.k === highlightMonth);
    if (idx > 0) scrollRef.current.scrollLeft = idx * 216;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // solo al montar: después el usuario controla el scroll libremente

  function toggle(id: string) { setExpanded((e) => ({ ...e, [id]: !e[id] })); }
  function commitEdit() {
    if (!editing) return;
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

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={endDrag}>
      <div ref={scrollRef} className="lx-scroll overflow-auto flex-1" data-testid="budget-grid" style={{ ["--cat-w" as string]: `${catW}px` } as React.CSSProperties}>
        <div className="w-max min-w-full text-[0.74rem]">
          {/* Encabezados sticky */}
          <div className="sticky top-0 z-[3] flex">
            <div className={cn(STICKY_BASE, LABEL_W, "items-end h-[76px] pl-3.5 pr-2.5 pb-2.5 bg-sunken border-b border-border-strong eyebrow")}>CATEGORÍA
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
              <div className="flex">
                {MONTHS.map((m) => (
                  <div key={m.k} className={cn(CELL_W, "flex items-center justify-center h-[38px] px-2 label bg-sunken border-b border-border border-l-2 border-l-border-strong")} style={{ width: 216, color: highlightMonth === m.k ? "var(--accent-light)" : "var(--fg)" }}>{m.label}</div>
                ))}
              </div>
              <div className="flex">
                {MONTHS.map((m) => (
                  <div key={m.k} className="flex">
                    <div className={cn(CELL_W, "flex items-center justify-end h-[38px] px-3 caption text-fg-muted bg-sunken border-b border-border-strong border-l-2 border-l-border-strong")}>Pres.</div>
                    <div className={cn(CELL_W, "flex items-center justify-end h-[38px] px-3 caption text-fg-muted bg-sunken border-b border-border-strong")}>Ejec.</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {rows.map((row) => {
            if (row.node === null) { const t = TYPE_ORDER.find((x) => x.id === row.type)!; return <TypeTotalRow key={`t-${row.type}`} type={row.type} label={t.label} Icon={t.Icon} highlightMonth={highlightMonth} activeType={dragNode?.type ?? null} isExpanded={expanded[`type:${row.type}`] !== false} onToggle={() => toggle(`type:${row.type}`)} onAddGroup={() => onAddGroup(row.type)} />; }
            return (
              <NodeRow
                key={row.node.id}
                row={row}
                editing={editing}
                editVal={editVal}
                naming={namingId === row.node.id}
                highlightMonth={highlightMonth}
                onToggle={() => toggle(row.node!.id)}
                isExpanded={!!expanded[row.node.id]}
                startEdit={(mk, field, cur) => { setEditing({ id: row.node!.id, mk, field }); setEditVal(String(cur || 0)); }}
                setEditVal={setEditVal}
                commitEdit={commitEdit}
                cancelEdit={() => setEditing(null)}
                startNaming={() => setNamingId(row.node!.id)}
                commitName={(name) => { renameNode(row.node!.id, name); setNamingId(null); }}
                setIcon={(icon) => setNodeIcon(row.node!.id, icon)}
                onDelete={() => deleteNode(row.node!.id)}
                onAddChild={() => onAddChild(row.node!)}
              />
            );
          })}
        </div>
      </div>
      {/* FR-015: preview flotante del nodo en arrastre (feedback claro de "estoy moviendo esto") */}
      <DragOverlay dropAnimation={null}>
        {dragNode ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-accent shadow-lg text-[0.8rem] text-fg cursor-grabbing" style={{ boxShadow: "var(--shadow-lg)" }}>
            <NodeIcon name={dragNode.icon} level={dragNode.level} size={14} color={dragNode.level === "sub" ? "var(--fg-muted)" : typeColorVar(dragNode.type)} />
            {dragNode.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function TypeTotalRow({ type, label, Icon, highlightMonth, activeType, isExpanded, onToggle, onAddGroup }: { type: NodeType; label: string; Icon: typeof ArrowDown; highlightMonth: MonthKey | null; activeType: NodeType | null; isExpanded: boolean; onToggle: () => void; onAddGroup: () => void }) {
  const data = useLedgerStore((s) => s.data);
  const color = typeColorVar(type);
  const [hover, setHover] = useState(false);
  // FR-601: la fila de tipo es destino de promoción a grupo. Solo el tipo COMPATIBLE con el nodo
  // arrastrado muestra la afordancia (prevención de error / cross-type, H5).
  const droppable = useDroppable({ id: `root:${type}` });
  const showDrop = droppable.isOver && activeType === type;
  return (
    <div className="flex" data-testid="type-total-row" data-type={type} ref={droppable.setNodeRef} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* FR-404/ADR-04: la fila de total por tipo NO es editable, así que migra de la capa elevada a
          la hundida. Efecto buscado: su rojo de identidad de tipo deja de confundirse con el rojo de
          sobre-consumo de una celda de datos. */}
      <div data-testid="row-label" className={cn(STICKY_BASE, LABEL_W, "bg-sunken border-b border-border pl-3.5 pr-2.5 gap-2 font-semibold")} style={{ color, boxShadow: showDrop ? "inset 0 0 0 2px var(--accent)" : undefined }}>
        <button aria-label="Colapsar tipo" onClick={onToggle} className="inline-flex w-3.5 flex-none cursor-pointer" style={{ color }}>{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
        <Icon size={15} color={color} /><span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
        {/* Afordancia de destino de promoción (solo durante un arrastre compatible) */}
        {showDrop && <span data-testid="promote-hint" className="flex-none caption" style={{ color: "var(--accent-light)" }}>Soltar para crear grupo</span>}
        {/* "+" para agregar un GRUPO de este tipo (el adder de grupo vive en el hover del tipo) */}
        {hover && !showDrop && (
          <button aria-label="Agregar grupo" onClick={onAddGroup} className="inline-flex p-[3px] rounded-md flex-none cursor-pointer bg-transparent border-0" style={{ color }}><Plus size={14} /></button>
        )}
      </div>
      {MONTHS.map((m) => {
        const t = typeTotals(data, type, [m.k]);
        return (
          <div key={m.k} className="flex">
            {/* La fila de total conserva el color de identidad del tipo y NUNCA lleva glifo (FR-402). */}
            <Cell value={t.budget} sep bold color={color} sunken highlight={highlightMonth === m.k} />
            <Cell value={t.actual} bold color={color} sunken highlight={highlightMonth === m.k} />
          </div>
        );
      })}
    </div>
  );
}

function NodeRow(props: {
  row: Row;
  editing: { id: string; mk: MonthKey; field: "budget" | "actual" } | null;
  editVal: string;
  naming: boolean;
  highlightMonth: MonthKey | null;
  isExpanded: boolean;
  onToggle: () => void;
  startEdit: (mk: MonthKey, field: "budget" | "actual", cur: number) => void;
  setEditVal: (v: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
  startNaming: () => void;
  commitName: (name: string) => void;
  setIcon: (icon: string) => void;
  onDelete: () => void;
  onAddChild: () => void;
}) {
  const { row, naming } = props;
  const node = row.node!;
  const data = useLedgerStore((s) => s.data);
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
          className={cn(STICKY_BASE, LABEL_W, "border-b border-border py-1.5 pr-2.5", canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
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
              color={typeColorVar(node.type)}
              trigger={
                <button aria-label="Cambiar ícono" title="Cambiar ícono" className="inline-flex flex-none cursor-pointer bg-transparent border-0 p-0 rounded-(--radius-sm) outline-none focus-visible:ring-1 focus-visible:ring-accent data-[state=open]:ring-1 data-[state=open]:ring-accent">
                  <NodeIcon name={node.icon} level={node.level} size={15} color={typeColorVar(node.type)} />
                </button>
              }
            />
          ) : (
            <span className="inline-flex flex-none"><NodeIcon name={node.icon} level={node.level} size={node.level === "sub" ? 13 : 15} color={node.level === "sub" ? "var(--fg-muted)" : typeColorVar(node.type)} /></span>
          )}
          {naming ? (
            <input autoFocus aria-label="Nombre" value={nameVal} onChange={(e) => setNameVal(e.target.value)} onBlur={() => props.commitName(nameVal)} onKeyDown={(e) => { if (e.key === "Enter") props.commitName(nameVal); if (e.key === "Escape") props.commitName(node.name); }} className="flex-1 min-w-0 bg-card border border-accent rounded-md text-fg px-2 py-1 text-[0.8rem] outline-none" />
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
              {canDeleteNode(data, node.id) && (
                <button aria-label="Borrar" onClick={() => setConfirmDel(true)} className="inline-flex p-[3px] rounded-md text-fg-muted hover:text-fg cursor-pointer bg-transparent border-0"><Trash2 size={13} /></button>
              )}
            </span>
          )}
        </div>

        {MONTHS.map((m) => {
          const bud = rollupBudget(data, node.id, m.k);
          const act = rollupActual(data, node.id, m.k);
          return (
            <div key={m.k} className="flex">
              <EditableCell editing={props.editing?.id === node.id && props.editing.mk === m.k && props.editing.field === "budget"} value={bud} sep muted weight={bWeight} leaf={row.leaf} highlight={props.highlightMonth === m.k} editVal={props.editVal} onStart={() => row.leaf && props.startEdit(m.k, "budget", bud)} setEditVal={props.setEditVal} commit={props.commitEdit} cancel={props.cancelEdit} />
              <EditableCell editing={props.editing?.id === node.id && props.editing.mk === m.k && props.editing.field === "actual"} value={act} color={ejecColor(node.type, bud, act)} glyph={ejecGlyph(node.type, bud, act)} leaf={row.leaf} highlight={props.highlightMonth === m.k} editVal={props.editVal} onStart={() => row.leaf && props.startEdit(m.k, "actual", act)} setEditVal={props.setEditVal} commit={props.commitEdit} cancel={props.cancelEdit} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditableCell(props: { editing: boolean; value: number; sep?: boolean; muted?: boolean; color?: string; weight?: number; leaf: boolean; highlight?: boolean; glyph?: string; editVal: string; onStart: () => void; setEditVal: (v: string) => void; commit: () => void; cancel: () => void }) {
  if (props.editing) {
    return (
      <div className={cn(CELL_W, "py-1 px-2", props.sep && "border-l-2 border-l-border-strong")} style={{ background: props.highlight ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined }}>
        <input autoFocus aria-label="Editar valor" value={props.editVal} onChange={(e) => props.setEditVal(e.target.value.replace(/[^0-9]/g, ""))} onBlur={props.commit} onKeyDown={(e) => { if (e.key === "Enter") props.commit(); if (e.key === "Escape") props.cancel(); }} className="tabular w-full bg-elevated border border-accent rounded-(--radius-sm) text-fg text-[0.74rem] text-right px-1.5 py-1 outline-none" />
      </div>
    );
  }
  // FR-404: la fila NO editable (!leaf) lleva la superficie hundida — el MISMO predicado que gobierna
  // la edición, así la afordancia no puede desalinearse del comportamiento (ADR-05).
  return <Cell value={props.value} sep={props.sep} muted={props.muted} color={props.color} weight={props.weight} highlight={props.highlight} sunken={!props.leaf} glyph={props.glyph} onClick={props.leaf ? props.onStart : undefined} clickable={props.leaf} />;
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

function Cell({ value, sep, muted, color, weight, bold, highlight, sunken, glyph, onClick, clickable }: { value: number; sep?: boolean; muted?: boolean; color?: string; weight?: number; bold?: boolean; highlight?: boolean; sunken?: boolean; glyph?: string; onClick?: () => void; clickable?: boolean }) {
  return (
    <div
      onClick={onClick}
      data-testid={clickable ? "cell-leaf" : "cell-parent"}
      className={cn(CELL_W, "flex items-center justify-end min-h-[34px] px-3 tabular border-b border-border whitespace-nowrap", sep && "border-l-2 border-l-border-strong", clickable ? "cursor-text" : "cursor-default")}
      style={{ color: color ?? (muted ? "var(--fg-secondary)" : "var(--fg)"), fontWeight: bold ? 500 : weight ?? 400, background: cellSurface(sunken, highlight) }}
    >
      {/* Canal redundante de WCAG 1.4.1 (FR-402): aria-hidden porque el dato ya lo portan el monto
          y el Pres. adyacente. flex-none para que nunca empuje al monto fuera de la celda. */}
      {glyph ? <span aria-hidden="true" className="flex-none mr-1 text-[0.75rem] leading-none">{glyph}</span> : null}
      {cellNum(value)}
    </div>
  );
}

function initialExpanded(nodes: LedgerNode[]): Record<string, boolean> {
  const e: Record<string, boolean> = {};
  for (const t of TYPE_ORDER) e[`type:${t.id}`] = true;
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
