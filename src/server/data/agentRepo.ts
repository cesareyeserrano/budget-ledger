/**
 * Module: server/data/agentRepo
 * Purpose: Las operaciones de la puerta para agentes sobre el libro (feature tony-ledger). No trae
 *   reglas propias: cada una carga el estado del dueño y llama a las MISMAS funciones del dominio y
 *   del repositorio que usa la app, para que el agente y la pantalla no puedan dar dos respuestas
 *   distintas a la misma pregunta.
 * Dependencies: ./ledgerRepo, @/domain
 */
import "server-only";
import { loadLedger } from "./ledgerRepo";
import { isLeaf } from "@/domain/tree";
import type { NodeLevel, NodeType } from "@/domain";

/** Un nodo del árbol tal como lo ve el agente. */
export interface AgentNode {
  id: string;
  name: string;
  type: NodeType;
  level: NodeLevel;
  parentId: string | null;
  /** true si se puede registrar sobre él (misma regla que la app). */
  leaf: boolean;
}

/**
 * El árbol vigente de la cuenta: tipos, grupos, categorías, subcategorías y bolsillos (FR-3407).
 * El agente clasifica contra esto; no tiene catálogo propio y no puede cambiarlo.
 * @param ownerId la cuenta del token
 * @returns el árbol y la revisión del libro, o null si la cuenta aún no guardó su libro
 * @throws si la base no responde
 * @aitri-trace FR-ID: FR-3407, US-ID: US-3407, AC-ID: AC-3407a, TC-ID: TC-AGT-070h, TC-AGT-073f, TC-AGT-074e
 */
export async function agentTree(ownerId: string): Promise<{ revision: number; nodes: AgentNode[] } | null> {
  const loaded = await loadLedger(ownerId);
  if (!loaded) return null;
  const { nodes } = loaded.state;
  return {
    revision: loaded.revision,
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      level: n.level,
      parentId: n.parentId,
      leaf: isLeaf(n, nodes),
    })),
  };
}
