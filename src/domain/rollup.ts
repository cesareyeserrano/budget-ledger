// @aitri-trace domain:rollup — FR-004: Presupuestado agrega hojas; Ejecutado agrega el subárbol.
import type { LedgerState, PeriodKey, NodeType } from "./types";
import { isLeaf, leafDescendants, subtreeIds, findNode } from "./tree";

/** Presupuestado de un nodo en un periodo = suma de sus hojas descendientes. */
export function rollupBudget(state: LedgerState, nodeId: string, period: PeriodKey): number {
  const node = findNode(state.nodes, nodeId);
  if (!node) return 0;
  const leaves = isLeaf(node, state.nodes) ? [nodeId] : leafDescendants(state.nodes, nodeId);
  return leaves.reduce((sum, id) => sum + (state.budgets[id]?.[period] ?? 0), 0);
}

/** Ejecutado de un nodo en un periodo = suma de todo su subárbol (incluye montos directos en categoría-hoja). */
export function rollupActual(state: LedgerState, nodeId: string, period: PeriodKey): number {
  const node = findNode(state.nodes, nodeId);
  if (!node) return 0;
  const ids = isLeaf(node, state.nodes) ? [nodeId] : subtreeIds(state.nodes, nodeId);
  return ids.reduce((sum, id) => sum + (state.actuals[id]?.[period] ?? 0), 0);
}

/**
 * Totales de un tipo (Presupuestado por hojas del tipo; Ejecutado por todo nodo del tipo).
 *
 * `periods` es OBLIGATORIO desde multi-anio (FR-1901): antes caía por defecto en los doce meses de
 * un año implícito. Ahora el alcance lo decide el llamador, que es quien conoce el rango activo.
 */
export function typeTotals(
  state: LedgerState,
  type: NodeType,
  periods: readonly PeriodKey[]
): { budget: number; actual: number } {
  const leaves = state.nodes.filter((n) => n.type === type && isLeaf(n, state.nodes)).map((n) => n.id);
  const all = state.nodes.filter((n) => n.type === type).map((n) => n.id);
  let budget = 0;
  let actual = 0;
  for (const m of periods) {
    for (const id of leaves) budget += state.budgets[id]?.[m] ?? 0;
    for (const id of all) actual += state.actuals[id]?.[m] ?? 0;
  }
  return { budget, actual };
}

/** Presupuestado y Ejecutado de una celda de la grilla. */
export type RollupCell = { budget: number; actual: number };

/**
 * Todos los roll-ups de la grilla en UNA pasada (BL-009): por nodo y por periodo, y los totales por tipo.
 *
 * Por qué existe: la grilla llamaba a `rollupBudget`/`rollupActual` celda a celda, y cada llamada
 * vuelve a escanear la lista de nodos para encontrar hijos y hojas — el mismo recorrido del árbol
 * repetido nodos × periodos veces. Aquí el índice hijos-por-padre se arma una vez y cada nodo se
 * suma a partir de sus hijos ya sumados.
 *
 * Contrato: cada valor es IDÉNTICO al de las funciones de arriba (tests/domain/rollup-table.test.ts
 * lo comprueba celda a celda). Los montos son enteros (cellAmountSchema), así que el orden de la
 * suma no cambia el resultado. Si los datos traen un ciclo de padres —solo posible con datos
 * corruptos— se delega en las funciones de arriba, cuyo corte de ciclos depende del nodo de partida.
 *
 * Un nodo o periodo que no está en la tabla vale 0, igual que en `rollupBudget`/`rollupActual`.
 */
export function rollupTable(
  state: LedgerState,
  periods: readonly PeriodKey[]
): {
  cell: (nodeId: string, period: PeriodKey) => RollupCell;
  type: (type: NodeType, period: PeriodKey) => RollupCell;
} {
  const { nodes, budgets, actuals } = state;
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId === null || n.parentId === undefined) continue;
    const list = kids.get(n.parentId);
    if (list) list.push(n.id);
    else kids.set(n.parentId, [n.id]);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasCycle = nodes.some((n) => {
    const seen = new Set<string>();
    let cur: string | null | undefined = n.id;
    while (cur) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = byId.get(cur)?.parentId;
    }
    return false;
  });

  const zero: RollupCell = { budget: 0, actual: 0 };
  const cells = new Map<string, Map<PeriodKey, RollupCell>>();

  if (hasCycle) {
    for (const n of nodes) {
      const row = new Map<PeriodKey, RollupCell>();
      for (const m of periods) row.set(m, { budget: rollupBudget(state, n.id, m), actual: rollupActual(state, n.id, m) });
      cells.set(n.id, row);
    }
  } else {
    // Subtotales «de subárbol»: `leafSum` suma las hojas sin hijos (lo que agrega `leafDescendants`)
    // y `treeSum` suma el nodo y todo lo que cuelga (lo que agrega `subtreeIds`).
    const leafSum = new Map<string, number[]>();
    const treeSum = new Map<string, number[]>();
    const walk = (id: string) => {
      if (treeSum.has(id)) return;
      const children = kids.get(id) ?? [];
      const leaf = periods.map((m) => (children.length === 0 ? budgets[id]?.[m] ?? 0 : 0));
      const tree = periods.map((m) => actuals[id]?.[m] ?? 0);
      for (const c of children) {
        walk(c);
        const cl = leafSum.get(c)!;
        const ct = treeSum.get(c)!;
        for (let i = 0; i < periods.length; i++) {
          leaf[i] += cl[i];
          tree[i] += ct[i];
        }
      }
      leafSum.set(id, leaf);
      treeSum.set(id, tree);
    };
    for (const n of nodes) {
      walk(n.id);
      // Una hoja (`isLeaf`) se reporta con su propio valor aunque tenga hijos —una subcategoría
      // siempre es hoja—, igual que en `rollupBudget`/`rollupActual`.
      const own = isLeaf(n, nodes) && (kids.get(n.id)?.length ?? 0) > 0;
      const l = leafSum.get(n.id)!;
      const t = treeSum.get(n.id)!;
      const row = new Map<PeriodKey, RollupCell>();
      periods.forEach((m, i) =>
        row.set(m, own ? { budget: budgets[n.id]?.[m] ?? 0, actual: actuals[n.id]?.[m] ?? 0 } : { budget: l[i], actual: t[i] })
      );
      cells.set(n.id, row);
    }
  }

  // Totales por tipo, con la misma regla que `typeTotals`: Presupuestado por hojas, Ejecutado por todo nodo.
  const types = new Map<NodeType, Map<PeriodKey, RollupCell>>();
  for (const t of ["expense", "income", "transfer"] as NodeType[]) {
    const row = new Map<PeriodKey, RollupCell>(periods.map((m) => [m, { budget: 0, actual: 0 }]));
    types.set(t, row);
  }
  for (const n of nodes) {
    const row = types.get(n.type);
    if (!row) continue;
    const leaf = !kids.has(n.id) || n.level === "sub";
    for (const m of periods) {
      const acc = row.get(m)!;
      if (leaf) acc.budget += budgets[n.id]?.[m] ?? 0;
      acc.actual += actuals[n.id]?.[m] ?? 0;
    }
  }

  return {
    cell: (nodeId, period) => cells.get(nodeId)?.get(period) ?? zero,
    type: (type, period) => types.get(type)?.get(period) ?? zero,
  };
}
