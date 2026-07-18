// @aitri-trace domain:tree — navegación de la jerarquía (verificado contra `isLeaf`/`leafDescendants`/`subtreeIds` del prototipo)
import type { LedgerNode } from "./types";

export function childrenOf(nodes: LedgerNode[], id: string): LedgerNode[] {
  return nodes.filter((n) => n.parentId === id);
}

export function findNode(nodes: LedgerNode[], id: string): LedgerNode | undefined {
  return nodes.find((n) => n.id === id);
}

/**
 * sub siempre es hoja; category es hoja si no tiene hijos; group es hoja si no tiene hijos.
 * FR-603 (promote-to-group): un grupo SIN hijos es hoja editable (su presupuesto/ejecutado se
 * capturan directo); al ganar su primer hijo deja de ser hoja y pasa a total calculado.
 */
export function isLeaf(node: LedgerNode, nodes: LedgerNode[]): boolean {
  if (node.level === "sub") return true;
  return !nodes.some((n) => n.parentId === node.id);
}

/** Ids de las hojas descendientes (para roll-up de Presupuestado). Robusto ante ciclos (visited-set). */
export function leafDescendants(nodes: LedgerNode[], nodeId: string): string[] {
  const out: string[] = [];
  const self = findNode(nodes, nodeId);
  if (!self) return out;
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return; // corta ciclos en datos corruptos
    seen.add(id);
    const kids = childrenOf(nodes, id);
    if (kids.length === 0) {
      const node = findNode(nodes, id);
      if (node && isLeaf(node, nodes)) out.push(id);
      return;
    }
    kids.forEach((k) => walk(k.id));
  };
  walk(nodeId);
  return out;
}

/** Ids de todo el subárbol incluyendo el propio nodo (para roll-up de Ejecutado). Robusto ante ciclos. */
export function subtreeIds(nodes: LedgerNode[], nodeId: string): string[] {
  const out: string[] = [nodeId];
  const seen = new Set<string>([nodeId]);
  const walk = (id: string) => {
    childrenOf(nodes, id).forEach((k) => {
      if (seen.has(k.id)) return; // corta ciclos
      seen.add(k.id);
      out.push(k.id);
      walk(k.id);
    });
  };
  walk(nodeId);
  return out;
}

/**
 * Profundidad del subárbol bajo un nodo: 0 = hoja, 1 = tiene hijos, 2 = tiene nietos.
 * Es la pieza de "cabida" de la degradación (FR-702): un movimiento cabe si
 * `profundidadDestino + subtreeDepth(node) ≤ 2` (techo grupo>categoría>subcategoría).
 * Reutiliza `childrenOf`; robusto ante ciclos (visited-set).
 */
export function subtreeDepth(nodes: LedgerNode[], nodeId: string): number {
  const seen = new Set<string>();
  const walk = (id: string): number => {
    if (seen.has(id)) return 0; // corta ciclos en datos corruptos
    seen.add(id);
    const kids = childrenOf(nodes, id);
    if (kids.length === 0) return 0;
    return 1 + Math.max(...kids.map((k) => walk(k.id)));
  };
  return walk(nodeId);
}

/** ¿`ancestorId` es ancestro (o igual) de `nodeId`? Robusto ante ciclos. */
export function isAncestor(nodes: LedgerNode[], ancestorId: string, nodeId: string): boolean {
  const seen = new Set<string>();
  let cur: LedgerNode | undefined = findNode(nodes, nodeId);
  while (cur && !seen.has(cur.id)) {
    if (cur.id === ancestorId) return true;
    seen.add(cur.id);
    cur = cur.parentId ? findNode(nodes, cur.parentId) : undefined;
  }
  return false;
}
