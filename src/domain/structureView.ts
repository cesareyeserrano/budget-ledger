// @aitri-trace domain:structureView — feature gestion-movil (FR-3201, FR-3206), ADR-02.
//
// Módulo:       src/domain/structureView.ts
// Propósito:    Lo que las pantallas de gestión del teléfono necesitan LEER de la estructura: el árbol
//               completo por tipo y los destinos posibles de un «Mover a…». No escribe ni decide
//               reglas: el orden sale de `tree` y la validez de cada destino de ensayar `moveNode`.
// Dependencias: ./tree, ./mutations (moveNode, solo como ensayo), ./types.

import { closedPeriodsViolated } from "./closure";
import { createNode, deleteNode, moveNode, type MoveDest } from "./mutations";
import { TYPE_ORDER, findNode, orderedChildren, orderedGroups, subtreeIds } from "./tree";
import type { LedgerNode, LedgerState, NodeLevel, NodeType, PeriodKey } from "./types";

/** Una fila del árbol de Organizar. `depth` es la sangría: 0 grupo, 1 categoría, 2 subcategoría. */
export interface OrganizeRow {
  id: string;
  name: string;
  icon: string | null;
  level: NodeLevel;
  depth: 0 | 1 | 2;
  system: boolean;
}

/** Un grupo con todo su subárbol aplanado en preorden (`rows[0]` es el propio grupo). */
export interface OrganizeGroup {
  group: OrganizeRow;
  rows: OrganizeRow[];
}

/** Una sección por tipo, en el orden de escritorio. */
export interface OrganizeSection {
  type: NodeType;
  groups: OrganizeGroup[];
}

const DEPTH: Record<NodeLevel, 0 | 1 | 2> = { group: 0, category: 1, sub: 2 };

const toRow = (n: LedgerNode): OrganizeRow => ({
  id: n.id, name: n.name, icon: n.icon, level: n.level, depth: DEPTH[n.level], system: !!n.system,
});

/**
 * El árbol completo de la estructura, por tipo y en el orden en que lo muestra escritorio.
 *
 * @param state Estado del ledger.
 * @returns Tres secciones (ingresos, gastos, reservas); cada grupo con su subárbol en preorden.
 * @throws Nunca. Un ciclo en datos corruptos se corta: cada nodo sale una sola vez.
 *
 * @aitri-trace FR-ID: FR-3201, US-ID: US-3201, AC-ID: AC-3201, TC-ID: TC-GMV-006e
 */
export function organizeTree(state: LedgerState): OrganizeSection[] {
  const { nodes } = state;
  return TYPE_ORDER.map((type) => ({
    type,
    groups: orderedGroups(nodes, type).map((g) => {
      const rows: OrganizeRow[] = [];
      const seen = new Set<string>();
      const walk = (n: LedgerNode) => {
        if (seen.has(n.id)) return;
        seen.add(n.id);
        rows.push(toRow(n));
        orderedChildren(nodes, n.id).forEach(walk);
      };
      walk(g);
      return { group: rows[0], rows };
    }),
  }));
}

/** En qué se convierte el elemento movido según el destino. */
export type MoveOutcome = "group" | "category" | "sub";

/** Un destino de «Mover a…». */
export interface MoveOption {
  /** Lo que se pasa a `moveNode`. */
  dest: MoveDest;
  /** Id del nodo destino; `null` para la raíz del tipo. */
  nodeId: string | null;
  /** Nombre del destino; vacío para la raíz (la pantalla pone el del tipo). */
  name: string;
  icon: string | null;
  level: NodeLevel;
  depth: 0 | 1;
  becomes: MoveOutcome;
  /**
   * `ok`: se puede; `current`: ya está ahí; `overflow`: no cabe (algún descendiente caería bajo
   * subcategoría); `closed`: el dominio lo aceptaría, pero trasladaría cifras de un periodo cerrado y
   * el servidor lo rechazaría (BG-002).
   */
  status: "ok" | "current" | "overflow" | "closed";
  /** El destino es una hoja con montos o movimientos propios, que pasarán al elemento movido (FR-604). */
  carries: boolean;
}

/** Los destinos de un elemento. `toRoot` es null si ya es un grupo o no existe. */
export interface MoveDestinations {
  toRoot: MoveOption | null;
  options: MoveOption[];
}

const NO_DESTINATIONS: MoveDestinations = { toRoot: null, options: [] };

/**
 * Si un nodo SIN hijos guarda cifras o movimientos propios: los que el primer hijo que reciba se llevará.
 *
 * @param state Estado del ledger.
 * @param id Nodo destino.
 * @returns true si es hoja y tiene alguna celda distinta de cero o algún movimiento que lo señale.
 * @throws Nunca.
 */
function ownsFigures(state: LedgerState, id: string): boolean {
  if (state.nodes.some((n) => n.parentId === id)) return false;
  const some = (m: LedgerState["budgets"]) => Object.values(m[id] ?? {}).some((v) => (v ?? 0) !== 0);
  return some(state.budgets) || some(state.actuals) || state.movements.some((m) => m.target === id);
}

/**
 * Los destinos de «Mover a…» para un elemento: la raíz de su tipo y los grupos y categorías del MISMO
 * tipo, sin el propio elemento ni sus descendientes.
 *
 * El filtro previo solo quita ruido; quien decide si un destino vale es `moveNode`, ensayado sin
 * escribir. Así la lista no puede discrepar de lo que la acción aceptará (ADR-02).
 *
 * @param state Estado del ledger.
 * @param id Elemento a mover.
 * @returns La opción de convertir en grupo y la lista de destinos, en el orden de escritorio.
 * @throws Nunca. Un id inexistente o de un nodo del sistema devuelve la lista vacía.
 *
 * @aitri-trace FR-ID: FR-3206, US-ID: US-3206, AC-ID: AC-3220, TC-ID: TC-GMV-064f, TC-GMV-066e, TC-GMV-067e
 * @aitri-trace FR-ID: FR-3206, US-ID: US-3206, AC-ID: AC-3221, TC-ID: BG-002
 */
export function moveDestinations(state: LedgerState, id: string): MoveDestinations {
  const node = findNode(state.nodes, id);
  if (!node || node.system) return NO_DESTINATIONS;
  const own = new Set(subtreeIds(state.nodes, id));

  const option = (target: LedgerNode | null, dest: MoveDest, becomes: MoveOutcome): MoveOption | null => {
    const res = moveNode(state, id, dest);
    let status: MoveOption["status"];
    if ("rejected" in res) {
      if (res.rejected !== "would_overflow") return null;
      status = "overflow";
    } else if (target !== null && node.parentId === target.id) {
      // El propio padre: el dominio lo acepta y devuelve el mismo árbol.
      status = "current";
    } else {
      // BG-002: el mismo guardia que corre el servidor. Si el traslado al primer hijo movería cifras de
      // un periodo cerrado, el PUT recibiría 422: no se ofrece como válido.
      status = closedPeriodsViolated(state, res.state).length > 0 ? "closed" : "ok";
    }
    return {
      dest, nodeId: target?.id ?? null, name: target?.name ?? "", icon: target?.icon ?? null,
      level: target?.level ?? "group", depth: target?.level === "category" ? 1 : 0, becomes, status,
      carries: target !== null && ownsFigures(state, target.id),
    };
  };

  const toRoot = node.level === "group" ? null : option(null, { kind: "root", type: node.type }, "group");
  const options: MoveOption[] = [];
  for (const g of orderedGroups(state.nodes, node.type)) {
    if (own.has(g.id)) continue;
    const og = option(g, { kind: "group", id: g.id }, "category");
    if (og) options.push(og);
    for (const c of orderedChildren(state.nodes, g.id)) {
      if (own.has(c.id) || c.level !== "category") continue;
      const oc = option(c, { kind: "category", id: c.id }, "sub");
      if (oc) options.push(oc);
    }
  }
  return { toRoot, options };
}

/**
 * Si crear el primer hijo de un elemento movería cifras de un periodo cerrado (BG-002).
 *
 * Ensaya el alta con la acción de dominio y pasa el resultado por el mismo guardia que corre el
 * servidor: si daría 422, el teléfono lo dice antes de crear en vez de anunciar un alta que se deshace.
 * Se llama al abrir la pantalla de alta, nunca al pintar la lista del periodo.
 *
 * @param state Estado del ledger.
 * @param parentId Elemento dentro del cual se crearía.
 * @returns true si el alta tocaría un periodo cerrado; false si no, o si el padre no existe o no admite hijos.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3202, US-ID: US-3202, AC-ID: AC-3206, TC-ID: BG-002
 */
export function createTouchesClosed(state: LedgerState, parentId: string): boolean {
  const parent = findNode(state.nodes, parentId);
  if (!parent || parent.level === "sub") return false;
  const trial = createNode(state, { level: parent.level === "group" ? "category" : "sub", parentId, type: parent.type, name: "·" });
  return trial !== state && closedPeriodsViolated(state, trial).length > 0;
}

/**
 * Si borrar un elemento que el dominio permite borrar tocaría movimientos de un periodo cerrado (BG-002).
 *
 * @param state Estado del ledger.
 * @param id Elemento a borrar.
 * @param periods Periodos activos, los mismos que usa `deleteBlockReason`.
 * @returns true si el borrado se aceptaría en el dominio pero el servidor lo rechazaría por el cierre.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3205, US-ID: US-3205, AC-ID: AC-3215, TC-ID: BG-002
 */
export function deleteTouchesClosed(state: LedgerState, id: string, periods: readonly PeriodKey[]): boolean {
  const trial = deleteNode(state, id, periods);
  return "state" in trial && closedPeriodsViolated(state, trial.state).length > 0;
}
