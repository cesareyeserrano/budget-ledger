// @aitri-trace domain:mutations — FR-001/002/006/015: registrar, CRUD, borrado (bloquea si hay datos), reparent.
// Todas las funciones son PURAS: reciben estado y devuelven estado nuevo (o un resultado tipado).
import type { LedgerNode, LedgerState, MonthKey, Movement, NodeLevel, NodeType } from "./types";
import { childrenOf, findNode, isAncestor, isLeaf, subtreeIds } from "./tree";
import { parseAmount, nodeNameSchema } from "./validation";

/**
 * Genera un id único para movimientos/nodos. `crypto.randomUUID()` SOLO existe en secure contexts
 * (HTTPS o localhost); servida por HTTP en una IP de LAN no lo está, y ahí lanzaría (BG-004). Por eso
 * degrada: getRandomValues sí está disponible sobre HTTP, y como último recurso un id no-cripto
 * (suficiente para un app single-user local — la unicidad, no la impredecibilidad, es lo que importa).
 */
function uid(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // versión 4
    b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  /** Feature stack-upgrade-theme (ADR-03): fecha ISO de captura; el registro móvil la envía y
   *  deriva `month` de ella. Opcional para no romper llamadores existentes (grilla/panel). */
  date?: string;
  /** Nota opcional del registro móvil (se normaliza: trim, ≤280, vacío→null). */
  note?: string | null;
}

/** Nota: trim; vacío→null; recorte duro a 280 (FR-211). */
export function normalizeNote(note: string | null | undefined): string | null {
  if (note == null) return null;
  const trimmed = note.trim();
  return trimmed === "" ? null : trimmed.slice(0, 280);
}

/** El botón Guardar está habilitado solo con monto válido (>=1) y categoría seleccionada. */
export function canSave(input: { amount: number | string; catId: string | null }): boolean {
  return parseAmount(input.amount) !== null && !!input.catId;
}

/**
 * Suma el monto al Ejecutado de la hoja destino (target = subId ?? catId). Rechaza montos
 * inválidos. Delta aditivo: persiste `date`/`note` cuando el registro móvil los envía; el
 * `month` de agregación lo aporta el llamador (derivado de `date`) — semántica de roll-ups intacta.
 *
 * @aitri-trace FR-ID: FR-212, US-ID: US-212, AC-ID: AC-215, TC-ID: TC-SUT-241h
 */
export function addMovement(state: LedgerState, input: NewMovement): LedgerState {
  const amount = parseAmount(input.amount);
  if (amount === null || !input.catId) return state; // negativo: no altera el estado
  const target = input.subId ?? input.catId;
  const next = clone(state);
  const mv: Movement = {
    id: uid(), ownerId: state.ownerId, type: input.type,
    catId: input.catId, subId: input.subId ?? null, target,
    amount, month: input.month, createdAt: nextSeq(),
    ...(input.date ? { date: input.date } : {}),
    ...(input.note !== undefined ? { note: normalizeNote(input.note) } : {}),
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
  // Todo nodo puede almacenar montos como hoja (grupo-hoja incluido, FR-603); se inicializan perezosos.
  next.budgets[id] = next.budgets[id] ?? {};
  next.actuals[id] = next.actuals[id] ?? {};
  // FR-604 (y FR-002): al agregar el PRIMER hijo a una hoja con montos propios (categoría-hoja → 1ª sub,
  // o grupo-hoja → 1ª categoría), trasladar sus montos al nuevo hijo — el padre pasa a calculado, el total no cae.
  if (input.parentId) {
    const parentHadNoChildren = !state.nodes.some((n) => n.parentId === input.parentId);
    const parentHadAmounts = state.budgets[input.parentId] || state.actuals[input.parentId];
    if (parentHadNoChildren && parentHadAmounts) {
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
 * ¿El nodo tiene DATOS vigentes — ejecutado (actuals > 0) en algún mes de su subárbol?
 * BG-006: la señal es el ejecutado VIGENTE, no el journal de movimientos. Los movimientos
 * siempre suman a actuals al registrarse; si el usuario luego vació las celdas (todo en 0),
 * el nodo está efectivamente vacío y debe poder borrarse. Antes, cualquier movimiento
 * histórico bloqueaba el borrado para siempre (el journal es inmutable — no hay forma de
 * quitarlo), dejando subcategorías imposibles de eliminar aun vaciadas.
 */
function nodeHasHistory(state: LedgerState, nodeId: string): boolean {
  const ids = new Set(subtreeIds(state.nodes, nodeId));
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
 * - categoría/sub: solo si NO tiene ejecutado vigente — se debe vaciar primero (BG-006).
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

  // sin datos → borrado directo del subárbol, sus montos y sus movimientos históricos
  // (BG-006: sin esto quedarían movimientos huérfanos apuntando a nodos inexistentes en Recientes)
  const ids = new Set(subtreeIds(state.nodes, id));
  const next = clone(state);
  next.nodes = next.nodes.filter((n) => !ids.has(n.id));
  next.movements = next.movements.filter((m) => !ids.has(m.target));
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

// ── FR-015 / FR-601: reubicar (reparent) y promover por arrastrar-y-soltar ─────
export type MoveResult = { state: LedgerState } | { rejected: "cross_type" | "invalid_target" };

/** Destino de un move: dentro de una categoría (→sub), dentro de un grupo (→categoría),
 *  o sobre la fila de un TIPO = promover a grupo (FR-601). */
export type MoveDest =
  | { kind: "category"; id: string }
  | { kind: "group"; id: string }
  | { kind: "root"; type: NodeType };

/** Suma dos mapas mensuales (no pierde ninguno de los dos). */
function mergeMonthMap(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined
): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [m, v] of Object.entries(b ?? {})) out[m] = (out[m] ?? 0) + v;
  return out;
}

export function moveNode(state: LedgerState, id: string, dest: MoveDest): MoveResult {
  const node = findNode(state.nodes, id);
  if (!node || node.system) return { rejected: "invalid_target" };
  if (node.level === "group") return { rejected: "invalid_target" }; // los grupos no se arrastran

  // FR-601 — promover a GRUPO (soltar sobre la fila de un tipo).
  if (dest.kind === "root") {
    if (node.type !== dest.type) return { rejected: "cross_type" };
    const next = clone(state);
    const moved = findNode(next.nodes, id)!;
    // los hijos directos ascienden un nivel: las subs pasan a categorías del nuevo grupo.
    for (const child of childrenOf(state.nodes, id)) {
      findNode(next.nodes, child.id)!.level = "category";
    }
    moved.level = "group";
    moved.parentId = null;
    moved.icon = moved.icon ?? "folder"; // grupo sin ícono → folder (las subs traen icon:null)
    // El nodo conserva sus montos como grupo-hoja (FR-603/604); si tenía hijos, viven en las hojas que ascendieron.
    return { state: next };
  }

  // dest category/group → reparent dentro de un contenedor existente (comportamiento previo, NFR-604).
  const destNode = findNode(state.nodes, dest.id);
  if (!destNode || destNode.system) return { rejected: "invalid_target" };
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

  // dest.kind === 'group' → el nodo pasa a ser categoría del grupo.
  if (destNode.level !== "group") return { rejected: "invalid_target" };
  const groupWasChildlessLeaf = !state.nodes.some((n) => n.parentId === dest.id);
  const groupHadAmounts = state.budgets[dest.id] || state.actuals[dest.id];
  const next = clone(state);
  const moved = findNode(next.nodes, id)!;
  moved.level = "category";
  moved.parentId = dest.id;
  // FR-604 — el grupo-hoja gana su PRIMER hijo → traslada sus montos al hijo (suma, no pierde los del hijo).
  if (groupWasChildlessLeaf && groupHadAmounts) {
    next.budgets[id] = mergeMonthMap(state.budgets[dest.id], state.budgets[id]);
    next.actuals[id] = mergeMonthMap(state.actuals[dest.id], state.actuals[id]);
    delete next.budgets[dest.id];
    delete next.actuals[dest.id];
  }
  return { state: next };
}
