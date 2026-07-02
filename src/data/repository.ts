// @aitri-trace data:repository — FR-011/FR-014: persistencia tras interfaz (punto de swap a Supabase). NFR-003: recuperación segura.
import type { LedgerState } from "@/domain/types";
import { STORAGE_KEYS } from "@/domain/types";
import { persistedBudgetSchema, persistedNodesSchema } from "@/domain/validation";

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
      nodes: nodesParsed.nodes,
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
