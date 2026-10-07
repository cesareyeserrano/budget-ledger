// @aitri-trace domain:structureView — feature gestion-movil (FR-3201, FR-3206), ADR-02.
//
// Módulo:       src/domain/structureView.ts
// Propósito:    Lo que las pantallas de gestión del teléfono necesitan LEER de la estructura: el árbol
//               completo por tipo y los destinos posibles de un «Mover a…». No escribe ni decide
//               reglas: el orden sale de `tree` y la validez de cada destino de ensayar `moveNode`.
// Dependencias: ./tree, ./mutations (moveNode, solo como ensayo), ./types.

import { moveNode, type MoveDest } from "./mutations";
import { TYPE_ORDER, findNode, orderedChildren, orderedGroups, subtreeIds } from "./tree";
import type { LedgerNode, LedgerState, NodeLevel, NodeType } from "./types";

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
  /** `ok`: se puede; `current`: ya está ahí; `overflow`: no cabe (algún descendiente caería bajo subcategoría). */
  status: "ok" | "current" | "overflow";
}

/** Los destinos de un elemento. `toRoot` es null si ya es un grupo o no existe. */
export interface MoveDestinations {
  toRoot: MoveOption | null;
  options: MoveOption[];
}

const NO_DESTINATIONS: MoveDestinations = { toRoot: null, options: [] };

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
    } else {
      // El propio padre: el dominio lo acepta y devuelve el mismo árbol.
      status = target !== null && node.parentId === target.id ? "current" : "ok";
    }
    return {
      dest, nodeId: target?.id ?? null, name: target?.name ?? "", icon: target?.icon ?? null,
      level: target?.level ?? "group", depth: target?.level === "category" ? 1 : 0, becomes, status,
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
