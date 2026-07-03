// @aitri-trace domain:mutations — FR-001/002/003/006/015: registrar, CRUD, borrado→"Sin asignar", reparent.
// Todas las funciones son PURAS: reciben estado y devuelven estado nuevo (o un resultado tipado).
import type { LedgerNode, LedgerState, MonthKey, Movement, NodeLevel, NodeType } from "./types";
import { UNASSIGNED_NAME } from "./types";
import { childrenOf, findNode, isAncestor, isLeaf, subtreeIds } from "./tree";
import { parseAmount, nodeNameSchema } from "./validation";

function uid(): string {
  return globalThis.crypto.randomUUID();
}

function clone(state: LedgerState): LedgerState {
  return {
    ownerId: state.ownerId,
    nodes: state.nodes.map((n) => ({ ...n })),
    budgets: structuredClone(state.budgets),
    actuals: structuredClone(state.actuals),
    movements: state.movements.map((m) => ({ ...m })),
  };
}

// ── FR-001: registrar movimiento ────────────────────────────────────────────
export interface NewMovement {
  type: NodeType;
  catId: string;
  subId?: string | null;
  amount: number | string;
  month: MonthKey;
}

/** El botón Guardar está habilitado solo con monto válido (>=1) y categoría seleccionada. */
export function canSave(input: { amount: number | string; catId: string | null }): boolean {
  return parseAmount(input.amount) !== null && !!input.catId;
}

/** Suma el monto al Ejecutado de la hoja destino (target = subId ?? catId). Rechaza montos inválidos. */
export function addMovement(state: LedgerState, input: NewMovement): LedgerState {
  const amount = parseAmount(input.amount);
  if (amount === null || !input.catId) return state; // negativo: no altera el estado
  const target = input.subId ?? input.catId;
  const next = clone(state);
  const mv: Movement = {
    id: uid(), ownerId: state.ownerId, type: input.type,
    catId: input.catId, subId: input.subId ?? null, target,
    amount, month: input.month, createdAt: nextSeq(),
  };
  next.movements.unshift(mv);
  next.actuals[target] = { ...(next.actuals[target] ?? {}) };
  next.actuals[target][input.month] = (next.actuals[target][input.month] ?? 0) + amount;
  return next;
}

// createdAt monotónico e inyectable (evita Date.now() no determinista en tests).
let _seq = 0;
function nextSeq(): number {
  _seq += 1;
  return _seq;
}
export function __resetSeq(): void {
  _seq = 0;
}

// ── FR-002: CRUD de categorías ───────────────────────────────────────────────
export interface NewNode {
  level: NodeLevel;
  parentId: string | null;
  type: NodeType;
  name: string;
  icon?: string | null;
}

const DEFAULT_NAME: Record<NodeLevel, string> = {
  group: "Nuevo grupo",
  category: "Nueva categoría",
  sub: "Nueva subcategoría",
};

export function createNode(state: LedgerState, input: NewNode): LedgerState {
  // Validar la forma de la jerarquía (grupo→categoría→subcategoría) y el tipo del padre.
  const parent = input.parentId ? findNode(state.nodes, input.parentId) : null;
  if (input.level === "group") {
    if (input.parentId !== null) return state;
  } else if (input.level === "category") {
    if (!parent || parent.level !== "group" || parent.type !== input.type) return state;
  } else {
    // sub: el padre debe ser una categoría del mismo tipo
    if (!parent || parent.level !== "category" || parent.type !== input.type) return state;
  }
  const next = clone(state);
  const id = uid();
  const node: LedgerNode = {
    id, ownerId: state.ownerId, type: input.type, level: input.level,
    parentId: input.parentId, name: input.name || DEFAULT_NAME[input.level],
    icon: input.level === "sub" ? null : input.icon ?? (input.level === "group" ? "folder" : "tag"),
    order: next.nodes.length,
  };
  next.nodes.push(node);
  if (input.level === "category" || input.level === "sub") {
    next.budgets[id] = next.budgets[id] ?? {};
    next.actuals[id] = next.actuals[id] ?? {};
  }
  // Al crear la 1ª subcategoría de una categoría-hoja, trasladar sus montos a la nueva sub (los totales no caen).
  if (input.level === "sub" && input.parentId) {
    const priorSubs = state.nodes.filter((n) => n.parentId === input.parentId && n.level === "sub");
    const hadAmounts = state.budgets[input.parentId] || state.actuals[input.parentId];
    if (priorSubs.length === 0 && hadAmounts) {
      next.budgets[id] = { ...(state.budgets[input.parentId] ?? {}) };
      next.actuals[id] = { ...(state.actuals[input.parentId] ?? {}) };
      delete next.budgets[input.parentId];
      delete next.actuals[input.parentId];
    }
  }
  return next;
}

export function canRename(node: LedgerNode): boolean {
  return !node.system;
}
export function canDelete(node: LedgerNode): boolean {
  return !node.system;
}

export function setNodeIcon(state: LedgerState, id: string, icon: string): LedgerState {
  const node = findNode(state.nodes, id);
  if (!node || node.system) return state;
  const next = clone(state);
  findNode(next.nodes, id)!.icon = icon;
  return next;
}

export function renameNode(state: LedgerState, id: string, name: string): LedgerState {
  const node = findNode(state.nodes, id);
  if (!node || !canRename(node)) return state;
  const parsed = nodeNameSchema.safeParse(name);
  if (!parsed.success) return state; // nombre vacío/ inválido: se conserva el previo
  const next = clone(state);
  const target = findNode(next.nodes, id)!;
  target.name = parsed.data;
  return next;
}

// ── FR-003: borrado → subcategoría de "Sin asignar" (por grupo) ────────────────
function unassignedCatId(groupId: string) {
  return `unassigned-${groupId}`;
}

/** Resuelve el grupo que contiene a un nodo (categoría → su grupo; sub → grupo de su categoría). */
function groupIdOf(nodes: LedgerNode[], node: LedgerNode): string | null {
  if (node.level === "group") return node.id;
  if (node.level === "category") return node.parentId;
  const cat = node.parentId ? findNode(nodes, node.parentId) : null; // sub → categoría → grupo
  return cat ? cat.parentId : null;
}

/** Crea perezosamente la categoría "Sin asignar" DEL GRUPO si no existe. Muta `next` in place. */
function ensureUnassigned(next: LedgerState, groupId: string): string {
  const group = findNode(next.nodes, groupId);
  const catId = unassignedCatId(groupId);
  if (group && !findNode(next.nodes, catId)) {
    next.nodes.push({
      id: catId, ownerId: next.ownerId, type: group.type, level: "category",
      parentId: groupId, name: UNASSIGNED_NAME, icon: "inbox", system: true, order: next.nodes.length,
    });
  }
  return catId;
}

/** ¿La categoría "Sin asignar" del grupo debe mostrarse? Solo si existe y tiene contenido. */
export function isUnassignedVisible(nodes: LedgerNode[], groupId: string): boolean {
  const catId = unassignedCatId(groupId);
  const node = findNode(nodes, catId);
  if (!node) return false;
  return childrenOf(nodes, catId).length > 0;
}

/**
 * FR-003: ¿el nodo tiene HISTORIAL que preservar al borrar? Es historial si registró
 * movimientos O si tiene ejecutado (actuals > 0) en su subárbol. El seed genera actuals
 * sin `movements`, así que mirar solo `movements` haría desaparecer datos semilla con
 * ejecutado al borrar (BG-003); el ejecutado también cuenta como historial a conservar.
 */
function nodeHasHistory(state: LedgerState, nodeId: string): boolean {
  const ids = new Set(subtreeIds(state.nodes, nodeId));
  if (state.movements.some((m) => ids.has(m.target))) return true;
  for (const id of ids) {
    const a = state.actuals[id];
    if (a && Object.values(a).some((v) => v > 0)) return true;
  }
  return false;
}

export type DeleteResult = { state: LedgerState } | { blocked: "group_not_empty" };

export function deleteNode(state: LedgerState, id: string): DeleteResult {
  const node = findNode(state.nodes, id);
  if (!node || node.system) return { state };

  if (node.level === "group") {
    if (childrenOf(state.nodes, id).length > 0) return { blocked: "group_not_empty" };
    const next = clone(state);
    next.nodes = next.nodes.filter((n) => n.id !== id);
    return { state: next };
  }

  // category o sub
  if (!nodeHasHistory(state, id)) {
    // borrado directo: elimina el subárbol y sus montos
    const ids = new Set(subtreeIds(state.nodes, id));
    const next = clone(state);
    next.nodes = next.nodes.filter((n) => !ids.has(n.id));
    for (const nid of ids) {
      delete next.budgets[nid];
      delete next.actuals[nid];
    }
    return { state: next };
  }

  // con historial (movimientos o ejecutado) → convertir en subcategoría de "Sin asignar" del grupo (cero huérfanos)
  const groupId = groupIdOf(state.nodes, node);
  if (!groupId) return { state };
  const next = clone(state);
  const unId = ensureUnassigned(next, groupId);
  const target = findNode(next.nodes, id)!;
  const formerChildren = childrenOf(state.nodes, id); // subs a aplanar
  target.level = "sub";
  target.parentId = unId;
  target.icon = null;
  for (const child of formerChildren) {
    const c = findNode(next.nodes, child.id)!;
    c.parentId = unId; // aplanar como hermanos dentro de "Sin asignar"
    c.level = "sub";
  }
  return { state: next };
}

// ── FR-006 / D-3: edición de celda-hoja (sin distribución a padres) ───────────
export function setLeafAmount(
  state: LedgerState,
  leafId: string,
  month: MonthKey,
  kind: "budget" | "actual",
  value: number
): LedgerState {
  const node = findNode(state.nodes, leafId);
  if (!node || !isLeaf(node, state.nodes)) return state; // los padres no son editables (roll-up)
  const v = Math.max(0, Math.round(Number(value) || 0));
  const next = clone(state);
  const store = kind === "budget" ? next.budgets : next.actuals;
  store[leafId] = { ...(store[leafId] ?? {}) };
  store[leafId][month] = v;
  return next;
}

// ── FR-015: reubicar (reparent) por arrastrar-y-soltar ────────────────────────
export type MoveResult = { state: LedgerState } | { rejected: "cross_type" | "invalid_target" };

export function moveNode(
  state: LedgerState,
  id: string,
  dest: { kind: "category" | "group"; id: string }
): MoveResult {
  const node = findNode(state.nodes, id);
  const destNode = findNode(state.nodes, dest.id);
  if (!node || !destNode) return { rejected: "invalid_target" };
  // "Sin asignar" (system) no se mueve ni se puede usar como destino: es catch-all gestionado.
  if (node.system || destNode.system) return { rejected: "invalid_target" };
  if (node.level === "group") return { rejected: "invalid_target" }; // no se mueven grupos/tipos
  if (node.type !== destNode.type) return { rejected: "cross_type" };
  if (id === dest.id || isAncestor(state.nodes, id, dest.id)) return { rejected: "invalid_target" };

  if (dest.kind === "category") {
    if (destNode.level !== "category") return { rejected: "invalid_target" };
    const next = clone(state);
    const moved = findNode(next.nodes, id)!;
    const formerChildren = childrenOf(state.nodes, id);
    moved.level = "sub";
    moved.parentId = dest.id;
    for (const child of formerChildren) {
      const c = findNode(next.nodes, child.id)!;
      c.parentId = dest.id; // aplanar subs al nuevo padre
      c.level = "sub";
    }
    return { state: next };
  }

  // dest.kind === 'group' → promover a categoría nueva del grupo
  if (destNode.level !== "group") return { rejected: "invalid_target" };
  const next = clone(state);
  const moved = findNode(next.nodes, id)!;
  moved.level = "category";
  moved.parentId = dest.id;
  return { state: next };
}
