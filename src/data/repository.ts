// @aitri-trace data:repository — FR-011/FR-014: persistencia tras interfaz (punto de swap a Supabase). NFR-003: recuperación segura.
// Feature transferencias: en modo localStorage el DUEÑO de las migraciones de formato es este
// repositorio — migra al cargar, una sola vez, con la clave como marca de versión.
import type { LedgerNode, LedgerState } from "@/domain/types";
import { LEGACY_BUDGET_KEYS, STORAGE_KEYS } from "@/domain/types";
import { persistedBudgetSchema, persistedNodesSchema } from "@/domain/validation";
import { migrateStateV3toV4 } from "@/domain/migrate";

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
  save(ownerId: string, state: LedgerState): Promise<boolean>;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Persistencia v1 en localStorage. Valida con Zod al cargar; ante corrupción devuelve null (→ semilla). */
export class LocalStorageRepository implements LedgerRepository {
  constructor(private storage: StorageLike) {}

  async load(ownerId: string): Promise<LedgerState | null> {
    const nodesRaw = this.storage.getItem(STORAGE_KEYS.nodes);
    // La clave vigente primero; si no existe, los formatos viejos se leen UNA vez para migrar.
    const budgetRaw =
      this.storage.getItem(STORAGE_KEYS.budget) ??
      this.storage.getItem(LEGACY_BUDGET_KEYS.v3) ??
      this.storage.getItem(LEGACY_BUDGET_KEYS.v2);
    if (!nodesRaw || !budgetRaw) return null;

    const nodesParsed = safeParseJson(nodesRaw, persistedNodesSchema);
    const budgetParsed = safeParseJson(budgetRaw, persistedBudgetSchema);
    if (!nodesParsed || !budgetParsed) return null; // corrupto/no conforme → recupera a semilla

    const nodes = stripLegacyUnassigned(nodesParsed.nodes);
    const loaded: LedgerState = {
      ownerId,
      nodes,
      budgets: budgetParsed.budgets,
      actuals: budgetParsed.actuals,
      movements: budgetParsed.movements,
      ...("cellNotes" in budgetParsed && budgetParsed.cellNotes ? { cellNotes: budgetParsed.cellNotes } : {}),
    };

    if (budgetParsed.version !== 4) {
      // Migración one-shot al modelo v4 (celdas = aportes; retiros en el journal):
      // · v2 → identidad de celdas (ya eran aportes); solo cambia la marca.
      // · v3 → se deshace el acumulado (deltas) y los deltas negativos pasan al journal como
      //   retiros. Se re-persiste en la clave nueva y se eliminan las viejas: la MARCA (la
      //   clave) garantiza la idempotencia — una segunda carga jamás re-convierte.
      const state = budgetParsed.version === 3 ? migrateStateV3toV4(loaded) : loaded;
      if (await this.save(ownerId, state)) {
        this.storage.removeItem(LEGACY_BUDGET_KEYS.v2);
        this.storage.removeItem(LEGACY_BUDGET_KEYS.v3);
      }
      return state;
    }

    return loaded;
  }

  async save(ownerId: string, state: LedgerState): Promise<boolean> {
    try {
      this.storage.setItem(
        STORAGE_KEYS.nodes,
        JSON.stringify({ version: 1, ownerId, nodes: state.nodes })
      );
      this.storage.setItem(
        STORAGE_KEYS.budget,
        JSON.stringify({
          version: 4,
          budgets: state.budgets,
          actuals: state.actuals,
          movements: state.movements,
          ...(state.cellNotes ? { cellNotes: state.cellNotes } : {}),
        })
      );
      return true;
    } catch (err) {
      // p. ej. QuotaExceededError: no propagar un crash; el estado en memoria sigue válido.
      // Devuelve false para que la UI muestre un aviso no bloqueante (StorageBanner, FR-212).
      console.warn("[ledger] no se pudo persistir en localStorage:", err);
      return false;
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
