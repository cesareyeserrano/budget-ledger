// @aitri-trace domain:mutations — FR-001/002/006/015: registrar, CRUD, borrado (bloquea si hay datos), reparent.
// Todas las funciones son PURAS: reciben estado y devuelven estado nuevo (o un resultado tipado).
import type { LedgerNode, LedgerState, MonthKey, Movement, NodeLevel, NodeType } from "./types";
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

// ── Borrado (sin "Sin asignar" — decisión del usuario: se retiró hasta redefinirla) ─────────
/**
 * ¿El nodo tiene DATOS (historial) — movimientos registrados o ejecutado (actuals > 0) en su
 * subárbol? El seed genera actuals sin `movements`, así que ambos cuentan como datos.
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

export type DeleteBlock = "group_not_empty" | "has_data";
export type DeleteResult = { state: LedgerState } | { blocked: DeleteBlock };

/**
 * ¿Se puede borrar este nodo? (para gatear el ícono 🗑 en la UI — no mostrar borrar si no aplica)
 * - system: no.
 * - grupo: solo si NO tiene categorías.
 * - categoría/sub: solo si NO tiene datos (movimientos/ejecutado) — se debe vaciar primero.
 */
export function canDeleteNode(state: LedgerState, id: string): boolean {
  const node = findNode(state.nodes, id);
  if (!node || node.system) return false;
  if (node.level === "group") return childrenOf(state.nodes, id).length === 0;
  return !nodeHasHistory(state, id);
}

export function deleteNode(state: LedgerState, id: string): DeleteResult {
  const node = findNode(state.nodes, id);
  if (!node || node.system) return { state };

  if (node.level === "group") {
    if (childrenOf(state.nodes, id).length > 0) return { blocked: "group_not_empty" };
    const next = clone(state);
    next.nodes = next.nodes.filter((n) => n.id !== id);
    return { state: next };
  }

  // categoría o sub CON datos → bloqueado (hay que vaciarla primero; cero pérdida silenciosa)
  if (nodeHasHistory(state, id)) return { blocked: "has_data" };

  // sin datos → borrado directo del subárbol y sus montos
  const ids = new Set(subtreeIds(state.nodes, id));
  const next = clone(state);
  next.nodes = next.nodes.filter((n) => !ids.has(n.id));
  for (const nid of ids) {
    delete next.budgets[nid];
    delete next.actuals[nid];
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
