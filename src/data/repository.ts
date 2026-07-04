// @aitri-trace data:repository — FR-011/FR-014: persistencia tras interfaz (punto de swap a Supabase). NFR-003: recuperación segura.
import type { LedgerNode, LedgerState } from "@/domain/types";
import { STORAGE_KEYS } from "@/domain/types";
import { persistedBudgetSchema, persistedNodesSchema } from "@/domain/validation";

/**
 * Migración: se retiró la categoría "Sin asignar" (nodos system). Datos guardados en versiones
 * anteriores pueden contener nodos "Sin asignar" con hijos (categorías que se movieron ahí al borrar).
 * Los promovemos de vuelta a categorías reales de su grupo y eliminamos el nodo system — cero pérdida.
 */
function stripLegacyUnassigned(nodes: LedgerNode[]): LedgerNode[] {
  const legacy = nodes.filter((n) => n.system);
  if (legacy.length === 0) return nodes;
  const legacyById = new Map(legacy.map((n) => [n.id, n]));
  return nodes
    .filter((n) => !legacyById.has(n.id)) // quitar los nodos 'Sin asignar'
    .map((n) => {
      const parent = n.parentId ? legacyById.get(n.parentId) : undefined;
      // un hijo de 'Sin asignar' vuelve a ser categoría del grupo (parentId del 'Sin asignar' = grupo)
      return parent ? { ...n, parentId: parent.parentId, level: "category" as const } : n;
    });
}

export interface LedgerRepository {
  /** Devuelve null si no hay datos válidos (el caller usa buildSeed). Nunca lanza por datos corruptos. */
  load(ownerId: string): Promise<LedgerState | null>;
  save(ownerId: string, state: LedgerState): Promise<void>;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Persistencia v1 en localStorage. Valida con Zod al cargar; ante corrupción devuelve null (→ semilla). */
export class LocalStorageRepository implements LedgerRepository {
  constructor(private storage: StorageLike) {}

  async load(ownerId: string): Promise<LedgerState | null> {
    const nodesRaw = this.storage.getItem(STORAGE_KEYS.nodes);
    const budgetRaw = this.storage.getItem(STORAGE_KEYS.budget);
    if (!nodesRaw || !budgetRaw) return null;

    const nodesParsed = safeParseJson(nodesRaw, persistedNodesSchema);
    const budgetParsed = safeParseJson(budgetRaw, persistedBudgetSchema);
    if (!nodesParsed || !budgetParsed) return null; // corrupto/no conforme → recupera a semilla

    return {
      ownerId,
      nodes: stripLegacyUnassigned(nodesParsed.nodes),
      budgets: budgetParsed.budgets,
      actuals: budgetParsed.actuals,
      movements: budgetParsed.movements,
    };
  }

  async save(ownerId: string, state: LedgerState): Promise<void> {
    try {
      this.storage.setItem(
        STORAGE_KEYS.nodes,
        JSON.stringify({ version: 1, ownerId, nodes: state.nodes })
      );
      this.storage.setItem(
        STORAGE_KEYS.budget,
        JSON.stringify({ version: 2, budgets: state.budgets, actuals: state.actuals, movements: state.movements })
      );
    } catch (err) {
      // p. ej. QuotaExceededError: no propagar un crash; el estado en memoria sigue válido.
      console.warn("[ledger] no se pudo persistir en localStorage:", err);
    }
  }
}

function safeParseJson<T>(raw: string, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }): T | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null; // JSON inválido
  }
  const res = schema.safeParse(json);
  return res.success ? res.data : null;
}
