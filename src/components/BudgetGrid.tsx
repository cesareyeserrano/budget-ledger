"use client";
import { useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { ChevronRight, ChevronDown, Pencil, Trash2, Plus, Check, X, ArrowDown, ArrowUp, ArrowLeftRight } from "lucide-react";
import { useLedgerStore } from "@/state/store";
import type { LedgerNode, MonthKey, NodeLevel, NodeType } from "@/domain/types";
import { MONTHS } from "@/domain/months";
import { rollupBudget, rollupActual, typeTotals } from "@/domain/rollup";
import { isLeaf, childrenOf } from "@/domain/tree";
import { canDeleteNode } from "@/domain/mutations";
import { cellNum, typeColorVar } from "./format";
import { NodeIcon, CATEGORY_ICONS } from "./NodeIcon";
import { cn } from "@/lib/utils";
import { readCatWidth, writeCatWidth, clampCatWidth } from "@/lib/gridWidth";

const TYPE_ORDER: { id: NodeType; label: string; Icon: typeof ArrowDown }[] = [
  { id: "expense", label: "GASTOS", Icon: ArrowDown },
  { id: "income", label: "INGRESOS", Icon: ArrowUp },
  { id: "transfer", label: "TRANSFERENCIAS", Icon: ArrowLeftRight },
];

// Ancho de la columna categoría vía CSS var --cat-w (FR-104, redimensionable); sub-celda de mes 108px, alto de fila 37px.
const LABEL_W = "w-[var(--cat-w)]";
const CELL_W = "w-[108px]";
const STICKY_BASE = "sticky left-0 z-[2] flex items-center gap-2 flex-none border-r border-border-strong min-h-[34px]";

interface Adder { level: NodeLevel; parentId: string | null; type: NodeType }
interface Row { node: LedgerNode | null; type: NodeType; depth: number; leaf: boolean; expandable: boolean }

/** Color del Ejecutado por tipo/varianza (regla del prototipo). */
function ejecColor(type: NodeType, b: number, e: number): string {
  if (!e) return "var(--fg-secondary)";
  if (type === "expense") return e > b ? "var(--error)" : "var(--fg)";
  if (type === "income") return e >= b ? "var(--success)" : "var(--warning)";
  return "var(--accent-light)";
}

export function BudgetGrid() {
  const data = useLedgerStore((s) => s.data);
  const setLeafAmount = useLedgerStore((s) => s.setLeafAmount);
  const deleteNode = useLedgerStore((s) => s.deleteNode);
  const renameNode = useLedgerStore((s) => s.renameNode);
  const createNode = useLedgerStore((s) => s.createNode);
  const setNodeIcon = useLedgerStore((s) => s.setNodeIcon);
  const moveNode = useLedgerStore((s) => s.moveNode);
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
    if (kind === "category" || kind === "group") moveNode(String(ev.active.id), { kind: kind as "category" | "group", id });
  }
  const dragNode = dragId ? data.nodes.find((n) => n.id === dragId) ?? null : null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={endDrag}>
      <div className="lx-scroll overflow-auto flex-1 px-6" data-testid="budget-grid" style={{ ["--cat-w" as string]: `${catW}px` } as React.CSSProperties}>
        <div className="w-max min-w-full text-[0.74rem]">
          {/* Encabezados sticky */}
          <div className="sticky top-0 z-[3] flex">
            <div className={cn(STICKY_BASE, LABEL_W, "items-end h-[76px] pl-3.5 pr-2.5 pb-2.5 bg-elevated border-b border-border-strong font-semibold tracking-[0.06em] text-fg-secondary text-[0.62rem]")}>CATEGORÍA
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
                  <div key={m.k} className={cn(CELL_W, "flex items-center justify-center h-[38px] px-2 text-[0.76rem] font-medium bg-elevated border-b border-border border-l-2 border-l-border-strong")} style={{ width: 216, color: highlightMonth === m.k ? "var(--accent-light)" : "var(--fg)" }}>{m.label}</div>
                ))}
              </div>
              <div className="flex">
                {MONTHS.map((m) => (
                  <div key={m.k} className="flex">
                    <div className={cn(CELL_W, "flex items-center justify-end h-[38px] px-3 text-[0.6rem] tracking-[0.04em] text-fg-muted bg-elevated border-b border-border-strong border-l-2 border-l-border-strong")}>Pres.</div>
                    <div className={cn(CELL_W, "flex items-center justify-end h-[38px] px-3 text-[0.6rem] tracking-[0.04em] text-fg-muted bg-elevated border-b border-border-strong")}>Ejec.</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {rows.map((row) => {
            if (row.node === null) { const t = TYPE_ORDER.find((x) => x.id === row.type)!; return <TypeTotalRow key={`t-${row.type}`} type={row.type} label={t.label} Icon={t.Icon} highlightMonth={highlightMonth} isExpanded={expanded[`type:${row.type}`] !== false} onToggle={() => toggle(`type:${row.type}`)} onAddGroup={() => onAddGroup(row.type)} />; }
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

function TypeTotalRow({ type, label, Icon, highlightMonth, isExpanded, onToggle, onAddGroup }: { type: NodeType; label: string; Icon: typeof ArrowDown; highlightMonth: MonthKey | null; isExpanded: boolean; onToggle: () => void; onAddGroup: () => void }) {
  const data = useLedgerStore((s) => s.data);
  const color = typeColorVar(type);
  const [hover, setHover] = useState(false);
  return (
    <div className="flex" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className={cn(STICKY_BASE, LABEL_W, "bg-elevated border-b border-border pl-3.5 pr-2.5 gap-2 font-bold")} style={{ color }}>
        <button aria-label="Colapsar tipo" onClick={onToggle} className="inline-flex w-3.5 flex-none cursor-pointer" style={{ color }}>{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
        <Icon size={15} color={color} /><span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
        {/* "+" para agregar un GRUPO de este tipo (el adder de grupo vive en el hover del tipo) */}
        {hover && (
          <button aria-label="Agregar grupo" onClick={onAddGroup} className="inline-flex p-[3px] rounded-md flex-none cursor-pointer bg-transparent border-0" style={{ color }}><Plus size={14} /></button>
        )}
      </div>
      {MONTHS.map((m) => {
        const t = typeTotals(data, type, [m.k]);
        return (
          <div key={m.k} className="flex">
            <Cell value={t.budget} sep bold color={color} bg="bg-elevated" highlight={highlightMonth === m.k} />
            <Cell value={t.actual} bold color={color} bg="bg-elevated" highlight={highlightMonth === m.k} />
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
  const [pickingIcon, setPickingIcon] = useState(false); // selector de ícono de categoría (clic en el ícono)

  useEffect(() => { if (naming) setNameVal(node.name); }, [naming, node.name]);

  const draggable = useDraggable({ id: node.id, disabled: node.level === "group" || node.system });
  const dropId = node.level === "group" ? `group:${node.id}` : node.level === "category" ? `category:${node.id}` : null;
  const droppable = useDroppable({ id: dropId ?? `noop:${node.id}` });
  const canDrag = node.level !== "group" && !node.system;
  const bWeight = node.level === "group" ? 500 : 400;

  return (
    <div className="flex flex-col" style={{ opacity: draggable.isDragging ? 0.4 : 1 }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} ref={dropId ? droppable.setNodeRef : undefined}>
      <div className="flex">
        <div
          ref={draggable.setNodeRef}
          {...(canDrag ? draggable.listeners : {})}
          {...(canDrag ? draggable.attributes : {})}
          className={cn(STICKY_BASE, LABEL_W, "border-b border-border py-1.5 pr-2.5", canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
          style={{
            paddingLeft: 14 + row.depth * 16,
            background: droppable.isOver && dropId ? "color-mix(in srgb, var(--accent) 18%, var(--bg))" : "var(--bg)",
            boxShadow: droppable.isOver && dropId ? "inset 0 0 0 1.5px var(--accent)" : undefined,
          }}
        >
          <button aria-label="Expandir" onClick={props.onToggle} className={cn("inline-flex w-3.5 flex-none text-fg-muted", row.expandable ? "visible cursor-pointer" : "invisible")}>{props.isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
          {(node.level === "category" || node.level === "group") && !node.system ? (
            <button aria-label="Cambiar ícono" title="Cambiar ícono" onClick={() => setPickingIcon((p) => !p)} className={cn("inline-flex flex-none cursor-pointer bg-transparent border-0 p-0 rounded", pickingIcon && "ring-1 ring-accent")}>
              <NodeIcon name={node.icon} level={node.level} size={15} color={typeColorVar(node.type)} />
            </button>
          ) : (
            <span className="inline-flex flex-none"><NodeIcon name={node.icon} level={node.level} size={node.level === "sub" ? 13 : 15} color={node.level === "sub" ? "var(--fg-muted)" : typeColorVar(node.type)} /></span>
          )}
          {naming ? (
            <input autoFocus aria-label="Nombre" value={nameVal} onChange={(e) => setNameVal(e.target.value)} onBlur={() => props.commitName(nameVal)} onKeyDown={(e) => { if (e.key === "Enter") props.commitName(nameVal); if (e.key === "Escape") props.commitName(node.name); }} className="flex-1 min-w-0 bg-card border border-accent rounded-md text-fg px-2 py-1 text-[0.8rem] outline-none" />
          ) : (
            <span onClick={props.onToggle} className={cn("flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap", row.expandable && "cursor-pointer")}>{node.name}</span>
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
              <EditableCell editing={props.editing?.id === node.id && props.editing.mk === m.k && props.editing.field === "actual"} value={act} color={ejecColor(node.type, bud, act)} leaf={row.leaf} highlight={props.highlightMonth === m.k} editVal={props.editVal} onStart={() => row.leaf && props.startEdit(m.k, "actual", act)} setEditVal={props.setEditVal} commit={props.commitEdit} cancel={props.cancelEdit} />
            </div>
          );
        })}
      </div>

      {(naming || pickingIcon) && (node.level === "category" || node.level === "group") && !node.system && (
        <div className="sticky left-0 flex gap-1.5 flex-wrap py-2 bg-bg" style={{ width: 260, paddingLeft: 14 + row.depth * 16 + 22 }}>
          {(node.level === "group" ? ["folder", ...CATEGORY_ICONS] : CATEGORY_ICONS).map((ic) => (
            <button key={ic} aria-label={`Ícono ${ic}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { props.setIcon(ic); setPickingIcon(false); }} className={cn("inline-flex p-[5px] rounded-md cursor-pointer border", node.icon === ic ? "border-accent text-accent-light" : "border-border bg-card text-fg-secondary")} style={node.icon === ic ? { background: "color-mix(in srgb, var(--accent) 16%, transparent)" } : undefined}>
              <NodeIcon name={ic} level="category" size={15} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EditableCell(props: { editing: boolean; value: number; sep?: boolean; muted?: boolean; color?: string; weight?: number; leaf: boolean; highlight?: boolean; editVal: string; onStart: () => void; setEditVal: (v: string) => void; commit: () => void; cancel: () => void }) {
  if (props.editing) {
    return (
      <div className={cn(CELL_W, "py-1 px-2", props.sep && "border-l-2 border-l-border-strong")} style={{ background: props.highlight ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined }}>
        <input autoFocus aria-label="Editar valor" value={props.editVal} onChange={(e) => props.setEditVal(e.target.value.replace(/[^0-9]/g, ""))} onBlur={props.commit} onKeyDown={(e) => { if (e.key === "Enter") props.commit(); if (e.key === "Escape") props.cancel(); }} className="w-full bg-elevated border border-accent rounded-md text-fg text-[0.74rem] text-right px-1.5 py-1 outline-none" />
      </div>
    );
  }
  return <Cell value={props.value} sep={props.sep} muted={props.muted} color={props.color} weight={props.weight} highlight={props.highlight} onClick={props.leaf ? props.onStart : undefined} clickable={props.leaf} />;
}

function Cell({ value, sep, muted, color, weight, bold, highlight, bg, onClick, clickable }: { value: number; sep?: boolean; muted?: boolean; color?: string; weight?: number; bold?: boolean; highlight?: boolean; bg?: string; onClick?: () => void; clickable?: boolean }) {
  return (
    <div
      onClick={onClick}
      data-testid={clickable ? "cell-leaf" : "cell-parent"}
      className={cn(CELL_W, "flex items-center justify-end min-h-[34px] px-3 tabular-nums border-b border-border whitespace-nowrap", sep && "border-l-2 border-l-border-strong", bg, clickable ? "cursor-text" : "cursor-default")}
      style={{ color: color ?? (muted ? "var(--fg-secondary)" : "var(--fg)"), fontWeight: bold ? 700 : weight ?? 400, background: highlight && !bg ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined }}
    >
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
