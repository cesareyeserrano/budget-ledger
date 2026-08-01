// @aitri-trace domain:mutations — FR-001/002/006/015: registrar, CRUD, borrado (bloquea si hay datos), reparent.
// Todas las funciones son PURAS: reciben estado y devuelven estado nuevo (o un resultado tipado).
import type { LedgerNode, LedgerState, MonthKey, Movement, NodeLevel, NodeType } from "./types";
import { childrenOf, findNode, isAncestor, isLeaf, leafDescendants, subtreeDepth, subtreeIds } from "./tree";
import { parseAmount, nodeNameSchema, normalizeNote } from "./validation";
import { uid, nextSeq, __resetSeq, seedSeq, seedSeqFrom } from "./ids";
import { AVAILABLE_ID, applyReserveCellEdit, applyReserveOp } from "./reserve";

// Compat: estos símbolos vivieron aquí; ahora los comparten reserve/ids sin ciclo de imports.
export { normalizeNote, __resetSeq, seedSeq, seedSeqFrom };

function clone(state: LedgerState): LedgerState {
  return {
    ownerId: state.ownerId,
    nodes: state.nodes.map((n) => ({ ...n })),
    budgets: structuredClone(state.budgets),
    actuals: structuredClone(state.actuals),
    movements: state.movements.map((m) => ({ ...m })),
    // FR-1012: las observaciones sobreviven cualquier mutación (delta aditivo del estado).
    ...(state.cellNotes ? { cellNotes: structuredClone(state.cellNotes) } : {}),
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
  /** Feature transferencias (ADR-05): extremos De→A explícitos para type "transfer". Sin ellos,
   *  la delegación asume guardar: Disponible→target. Ignorados para expense/income (NFR-1002). */
  from?: string;
  to?: string;
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
 * Feature transferencias (modelo v4): para type "transfer" DELEGA en applyReserveOp — guardar
 * suma el aporte a la celda del mes Y journaliza con from/to; sacar solo journaliza; ambos
 * validan techo/piso. Un rechazo del dominio devuelve el estado intacto (mismo contrato que un
 * monto inválido). expense/income conservan su camino byte a byte (NFR-1002).
 *
 * @aitri-trace FR-ID: FR-212, US-ID: US-212, AC-ID: AC-215, TC-ID: TC-SUT-241h
 * @aitri-trace FR-ID: FR-1004, US-ID: US-1004, AC-ID: AC-1004b, TC-ID: TC-TRF-104e, TC-TRF-152h
 */
export function addMovement(state: LedgerState, input: NewMovement): LedgerState {
  const amount = parseAmount(input.amount);
  if (amount === null || !input.catId) return state; // negativo: no altera el estado
  const target = input.subId ?? input.catId;
  if (input.type === "transfer") {
    const result = applyReserveOp(state, {
      from: input.from ?? AVAILABLE_ID,
      to: input.to ?? target,
      month: input.month,
      amount,
      ...(input.date ? { date: input.date } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    return "state" in result ? result.state : state;
  }
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
      // Los movimientos de reserva siguen a las celdas — sin esto el saldo del hijo renace
      // sin sus retiros (saldo fantasma, hallazgo adversarial 1).
      if (input.type === "transfer") repointReserveMovements(next, input.parentId, id);
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
 * ¿El nodo tiene DATOS vigentes — presupuestado O ejecutado (>0) en algún mes de su subárbol?
 * BG-001: "con valores" es cualquier monto visible en la grilla, sea Presupuestado o Ejecutado;
 * ambos bloquean el borrado (hay que vaciar TODAS las celdas primero). Cero pérdida silenciosa.
 * BG-006: la señal es el monto VIGENTE en las celdas, no el journal de movimientos. Los movimientos
 * siempre suman a actuals al registrarse; si el usuario luego vació las celdas (todo en 0),
 * el nodo está efectivamente vacío y debe poder borrarse. Antes, cualquier movimiento
 * histórico bloqueaba el borrado para siempre (el journal es inmutable — no hay forma de
 * quitarlo), dejando subcategorías imposibles de eliminar aun vaciadas.
 */
function nodeHasData(state: LedgerState, nodeId: string): boolean {
  const ids = new Set(subtreeIds(state.nodes, nodeId));
  for (const id of ids) {
    const b = state.budgets[id];
    if (b && Object.values(b).some((v) => v > 0)) return true;
    const a = state.actuals[id];
    if (a && Object.values(a).some((v) => v > 0)) return true;
  }
  return false;
}

export type DeleteBlock = "has_children" | "has_data";
export type DeleteResult = { state: LedgerState } | { blocked: DeleteBlock };

/**
 * ¿Se puede borrar este nodo? (para gatear el ícono 🗑 en la UI — no mostrar borrar si no aplica)
 * - system: no.
 * - cualquier nodo CON HIJOS (grupo con categorías, o categoría con subcategorías): no —
 *   hay que mover/borrar los hijos primero (BG-002). Un padre nunca se borra con hijos, tenga
 *   o no valores propios; para eliminarlo debe quedar sin hijos Y sin valores.
 * - cualquier nodo con valores vigentes (presupuestado o ejecutado): no — se debe vaciar
 *   primero (BG-001/BG-006). Aplica a TODOS los niveles: grupo-hoja (que también almacena
 *   montos, FR-603), categoría y subcategoría.
 */
export function canDeleteNode(state: LedgerState, id: string): boolean {
  const node = findNode(state.nodes, id);
  if (!node || node.system) return false;
  if (childrenOf(state.nodes, id).length > 0) return false;
  return !nodeHasData(state, id);
}

export function deleteNode(state: LedgerState, id: string): DeleteResult {
  const node = findNode(state.nodes, id);
  if (!node || node.system) return { state };

  // cualquier nodo CON HIJOS (grupo con categorías, o categoría con subcategorías) →
  // bloqueado hasta mover/borrar sus hijos (FR-110/BG-002); un padre no se borra con hijos
  if (childrenOf(state.nodes, id).length > 0) {
    return { blocked: "has_children" };
  }

  // cualquier nodo CON valores (presupuestado o ejecutado; grupo-hoja, categoría o sub) →
  // bloqueado (hay que vaciarlo primero; cero pérdida silenciosa — BG-001/BG-006)
  if (nodeHasData(state, id)) return { blocked: "has_data" };

  // sin datos → borrado directo del subárbol, sus montos y sus movimientos históricos
  // (BG-006: sin esto quedarían movimientos huérfanos apuntando a nodos inexistentes en Recientes)
  // Feature transferencias: un movimiento de reserva referencia la alcancía por from O to. Si el
  // DESTINO de un mover A→B se borra pero A sigue viva, el retiro de A debe SOBREVIVIR — borrarlo
  // resucitaría el saldo de A sin operación alguna (hallazgo adversarial 3). Ese movimiento se
  // convierte en retiro a Disponible (la plata salió de A; el destino dejó de existir).
  const ids = new Set(subtreeIds(state.nodes, id));
  const next = clone(state);
  next.nodes = next.nodes.filter((n) => !ids.has(n.id));
  next.movements = next.movements.flatMap((m) => {
    const refsDeleted = ids.has(m.target) || (m.from ? ids.has(m.from) : false) || (m.to ? ids.has(m.to) : false);
    if (!refsDeleted) return [m];
    const fromAlive = m.type === "transfer" && m.from && !ids.has(m.from) && findNode(next.nodes, m.from);
    if (fromAlive) {
      const fromNode = findNode(next.nodes, m.from!)!;
      return [{
        ...m,
        to: AVAILABLE_ID,
        target: m.from!,
        catId: fromNode.level === "sub" ? fromNode.parentId! : m.from!,
        subId: fromNode.level === "sub" ? m.from! : null,
      }];
    }
    return [];
  });
  for (const nid of ids) {
    delete next.budgets[nid];
    delete next.actuals[nid];
  }
  return { state: next };
}

// ── FR-006 / D-3: edición de celda-hoja (sin distribución a padres) ───────────
/**
 * Escribe el valor de una celda-hoja. Para hojas TRANSFER delega en el camino de reserva (modelo
 * v4): el valor tecleado es el APORTE de ese mes — corregir la celda jamás genera retiros ni
 * journal; techo/piso en cadena validan y un rechazo devuelve el estado intacto (la UI rica usa
 * applyReserveCellEdit directamente para leer el veredicto). expense/income: camino intacto.
 *
 * @aitri-trace FR-ID: FR-1003, US-ID: US-1003, AC-ID: AC-1003, TC-ID: TC-TRF-203e
 */
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
  if (node.type === "transfer") {
    const result = applyReserveCellEdit(state, { leafId, month, plane: kind, newAmount: v });
    return "rejected" in result ? state : result.state;
  }
  const next = clone(state);
  const store = kind === "budget" ? next.budgets : next.actuals;
  store[leafId] = { ...(store[leafId] ?? {}) };
  store[leafId][month] = v;
  return next;
}

// ── FR-015 / FR-601 / FR-702: reubicar (reparent), promover y DEGRADAR por drag-drop ─────
/** Destino de un move: dentro de una categoría (→sub), dentro de un grupo (→categoría),
 *  o sobre la fila de un TIPO = promover a grupo (FR-601). */
export type MoveDest =
  | { kind: "category"; id: string }
  | { kind: "group"; id: string }
  | { kind: "root"; type: NodeType };

// Feature demote-node: +'would_overflow' — la degradación desbordaría el techo de 3 niveles (FR-703).
export type MoveResult =
  | { state: LedgerState }
  | { rejected: "cross_type" | "invalid_target" | "would_overflow" };

// ── Seam de política de desborde (NFR-701) ─────────────────────────────────────
// El manejo del desborde vive detrás de una estrategia ENCHUFABLE, no incrustado en moveNode.
// Hoy la única política provista es `blockPolicy` (rechaza sin tocar el estado, cero pérdida de
// datos). Una política futura (reasignar el desborde a la zona de no-asignados, aplanar) se
// registra como una estrategia nueva y se pasa a `moveNode` — SIN reescribir el algoritmo de
// cabida ni de re-nivelado (evita el mega-refactor; ADR-02). Punto de extensión: el parámetro
// `overflow` de `moveNode`, default `blockPolicy`.
export type OverflowCtx = {
  state: LedgerState;
  nodeId: string;
  dest: MoveDest;
  /** Niveles que baja el subárbol (destDepth − depth(node)); >0 en toda degradación. */
  delta: number;
};
export type OverflowDecision =
  | { kind: "block" } // rechaza; el estado no cambia
  | { kind: "resolve"; state: LedgerState }; // política futura: produce un estado ya resuelto
export type OverflowPolicy = (ctx: OverflowCtx) => OverflowDecision;

/** Única política provista hoy: bloquea el desborde sin mutar el estado. */
export const blockPolicy: OverflowPolicy = () => ({ kind: "block" });

// Nivel = profundidad. Techo del árbol: grupo(0) > categoría(1) > subcategoría(2).
const MAX_DEPTH = 2;
const DEPTH_LEVELS: NodeLevel[] = ["group", "category", "sub"];
const depthOf = (n: LedgerNode): number => DEPTH_LEVELS.indexOf(n.level);
const levelAtDepth = (d: number): NodeLevel => DEPTH_LEVELS[d];

/** Suma dos mapas mensuales (no pierde ninguno de los dos). Correcto para FLUJOS (expense/income). */
function mergeMonthMap(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined
): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [m, v] of Object.entries(b ?? {})) out[m] = (out[m] ?? 0) + v;
  return out;
}

/** Modelo v4 (2026-07-29): las celdas transfer volvieron a ser FLUJOS (aportes del mes), así que
 *  la fusión por suma de celdas es correcta para los TRES tipos — el despacho por tipo se
 *  conserva como costura por si un tipo vuelve a cambiar de semántica. */
function mergeMonthMapForType(
  _type: NodeType,
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined
): Record<string, number> {
  return mergeMonthMap(a, b);
}

/**
 * Cuando el traslado FR-604 mueve las CELDAS de una hoja transfer a otro nodo, sus movimientos de
 * reserva del journal deben SEGUIR a las celdas (hallazgos adversariales 1-2, 2026-07-29): si los
 * retiros quedan apuntando al nodo cedente, el saldo derivado del receptor renace completo —
 * saldo fantasma del que se puede volver a sacar (se fabrica plata). Re-apunta from/to/target.
 */
function repointReserveMovements(next: LedgerState, cedingId: string, receivingId: string): void {
  const receiver = findNode(next.nodes, receivingId);
  const catId = receiver && receiver.level === "sub" ? receiver.parentId! : receivingId;
  const subId = receiver && receiver.level === "sub" ? receivingId : null;
  next.movements = next.movements.map((m) => {
    if (m.type !== "transfer" || (m.from !== cedingId && m.to !== cedingId && m.target !== cedingId)) return m;
    const nm = { ...m };
    if (nm.from === cedingId) nm.from = receivingId;
    if (nm.to === cedingId) nm.to = receivingId;
    if (nm.target === cedingId) {
      nm.target = receivingId;
      nm.catId = catId;
      nm.subId = subId;
    }
    return nm;
  });
}

/**
 * Reubica/promueve/DEGRADA un nodo. Grupos como origen degradan bajando su subárbol por un delta
 * fijo si cabe en el techo de 3 niveles; si desborda, delega al seam de política (default: bloquear).
 *
 * @aitri-trace FR-ID: FR-702, US-ID: US-702, AC-ID: AC-702a, TC-ID: TC-702h
 * @aitri-trace FR-ID: FR-703, US-ID: US-703, AC-ID: AC-703a, TC-ID: TC-703h
 * @aitri-trace FR-ID: NFR-701, US-ID: US-703, AC-ID: AC-703a, TC-ID: TC-751h
 */
export function moveNode(
  state: LedgerState,
  id: string,
  dest: MoveDest,
  overflow: OverflowPolicy = blockPolicy // ◄── SEAM (NFR-701): default block; una política futura se enchufa aquí
): MoveResult {
  const node = findNode(state.nodes, id);
  if (!node || node.system) return { rejected: "invalid_target" };

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

  // ── Feature demote-node (FR-702/703, NFR-701): DEGRADAR un grupo ──────────────
  // Solo el origen GRUPO toma este camino nuevo (cabida + re-nivelado + seam). sub/categoría
  // siguen por las ramas existentes de abajo, intactas — el aplanado categoría→categoría es una
  // resolución de desborde propia que NO se debe romper (NFR-703, ADR-03).
  if (node.level === "group") {
    // destDepth = profundidad que ocupará el nodo movido: grupo→categoría(1), categoría→sub(2).
    const destDepth = dest.kind === "group" ? 1 : 2;
    const destLevelOk = dest.kind === "group" ? destNode.level === "group" : destNode.level === "category";
    if (!destLevelOk) return { rejected: "invalid_target" };
    const delta = destDepth; // depth(group)=0 → delta = destDepth − 0
    // Cabida: el descendiente más profundo no puede caer bajo el techo (nivel 2 = subcategoría).
    if (destDepth + subtreeDepth(state.nodes, id) > MAX_DEPTH) {
      // Desborde → delega al SEAM. blockPolicy (default) rechaza sin mutar; una política futura resuelve.
      const decision = overflow({ state, nodeId: id, dest, delta });
      return decision.kind === "block" ? { rejected: "would_overflow" } : { state: decision.state };
    }
    // Cabe → re-nivela TODO el subárbol por el mismo delta; los descendientes conservan su
    // parentId (estructura relativa intacta). Ids de nodo y de movimiento se preservan → cero huérfanos.
    const next = clone(state);
    for (const nid of subtreeIds(state.nodes, id)) {
      const depth = depthOf(findNode(state.nodes, nid)!);
      findNode(next.nodes, nid)!.level = levelAtDepth(depth + delta);
    }
    findNode(next.nodes, id)!.parentId = dest.id;
    // FR-604 — el destino (grupo o categoría) que era HOJA con montos gana su primer hijo (el subárbol
    // movido) → deja de ser hoja. Sus montos se trasladan a una HOJA del subárbol entrante; si no, el
    // roll-up de Presupuestado (que agrega solo hojas) los perdería en silencio, rompiendo padre==Σhojas.
    // El target es el nodo movido si quedó hoja, o su primera hoja descendiente (nunca el nodo interno).
    const destWasChildlessLeaf = !state.nodes.some((n) => n.parentId === dest.id);
    const destHadAmounts = state.budgets[dest.id] || state.actuals[dest.id];
    if (destWasChildlessLeaf && destHadAmounts) {
      const movedNode = findNode(next.nodes, id)!;
      const target = isLeaf(movedNode, next.nodes) ? id : leafDescendants(next.nodes, id)[0] ?? id;
      next.budgets[target] = mergeMonthMapForType(node.type, state.budgets[dest.id], next.budgets[target]);
      next.actuals[target] = mergeMonthMapForType(node.type, state.actuals[dest.id], next.actuals[target]);
      delete next.budgets[dest.id];
      delete next.actuals[dest.id];
      // Los movimientos de reserva del destino cedente siguen a sus celdas (hallazgo adversarial 2).
      if (node.type === "transfer") repointReserveMovements(next, dest.id, target);
    }
    return { state: next };
  }

  if (dest.kind === "category") {
    if (destNode.level !== "category") return { rejected: "invalid_target" };
    // FR-604 — se leen ANTES de mutar: la categoría destino puede ser una HOJA con montos propios
    // que está a punto de ganar su primer hijo (BG-009).
    const catWasChildlessLeaf = !state.nodes.some((n) => n.parentId === dest.id);
    const catHadAmounts = state.budgets[dest.id] || state.actuals[dest.id];
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
    // FR-604 / BG-009 — la categoría-hoja destino deja de ser hoja al recibir este nodo. Como el
    // roll-up de Presupuestado agrega SOLO hojas, sus montos propios desaparecerían de todos los
    // totales (grupo, tipo, KPIs, Balance) quedando huérfanos en el mapa. Se trasladan al nodo
    // movido, que aquí siempre queda hoja (pasa a 'sub' y sus antiguos hijos se aplanaron al
    // destino). Es la MISMA regla que ya aplican createNode y las otras dos ramas de moveNode.
    if (catWasChildlessLeaf && catHadAmounts) {
      next.budgets[id] = mergeMonthMapForType(node.type, state.budgets[dest.id], state.budgets[id]);
      next.actuals[id] = mergeMonthMapForType(node.type, state.actuals[dest.id], state.actuals[id]);
      delete next.budgets[dest.id];
      delete next.actuals[dest.id];
      // Los movimientos de reserva del destino cedente siguen a sus celdas (hallazgo adversarial 2).
      if (node.type === "transfer") repointReserveMovements(next, dest.id, id);
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
    next.budgets[id] = mergeMonthMapForType(node.type, state.budgets[dest.id], state.budgets[id]);
    next.actuals[id] = mergeMonthMapForType(node.type, state.actuals[dest.id], state.actuals[id]);
    delete next.budgets[dest.id];
    delete next.actuals[dest.id];
    // Los movimientos de reserva del grupo-hoja cedente siguen a sus celdas (hallazgo adversarial 2).
    if (node.type === "transfer") repointReserveMovements(next, dest.id, id);
  }
  return { state: next };
}
