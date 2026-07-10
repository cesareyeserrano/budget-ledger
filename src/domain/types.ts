// @aitri-trace domain:types — modelo de datos del dominio (verificado contra el prototipo Ledger offline)

/** 3 tipos FIJOS: eje de signo (D-1). No editables. */
export type NodeType = "expense" | "income" | "transfer";

/** 3 niveles editables bajo cada tipo. */
export type NodeLevel = "group" | "category" | "sub";

export type MonthKey =
  | "ene" | "feb" | "mar" | "abr" | "may" | "jun"
  | "jul" | "ago" | "sep" | "oct" | "nov" | "dic";

/** Nodo de la jerarquía. Solo las HOJAS almacenan montos (budgets/actuals). */
export interface LedgerNode {
  id: string;
  ownerId: string; // FR-014 andamiaje multiusuario; default "local" en v1
  type: NodeType;
  level: NodeLevel;
  parentId: string | null; // null solo para grupos raíz bajo un tipo
  name: string;
  icon: string | null;
  /** true = gestionado por el sistema (la categoría "Sin asignar" de cada grupo): no renombrable/borrable. */
  system?: boolean;
  order: number;
}

/** Mapa nodeId -> { MonthKey -> monto COP entero >= 0 }. Solo para hojas. */
export type AmountMap = Record<string, Partial<Record<MonthKey, number>>>;

export interface Movement {
  id: string;
  ownerId: string;
  type: NodeType;
  catId: string;
  subId: string | null;
  /** = subId ?? catId. La hoja destino: SIEMPRE debe resolver un nodo existente (cero huérfanos). */
  target: string;
  amount: number; // entero >= 1
  month: MonthKey;
  createdAt: number;
  /** Delta aditivo (feature stack-upgrade-theme, ADR-03): fecha de captura ISO del registro
   *  móvil ("YYYY-MM-DDTHH:mm"). El `month` se DERIVA de aquí. Opcional: los movimientos
   *  previos no lo tienen y siguen siendo válidos (sin migración). */
  date?: string;
  /** Nota opcional (≤280, trim, vacío→null). Ausente en movimientos previos. */
  note?: string | null;
}

export interface LedgerState {
  ownerId: string;
  nodes: LedgerNode[];
  budgets: AmountMap;
  actuals: AmountMap;
  movements: Movement[];
}

export const STORAGE_KEYS = {
  nodes: "ledger.nodes.v1",
  budget: "ledger.budget.v2",
} as const;

/** Nombre de la categoría del sistema que recibe categorías borradas (una por tipo). */
export const UNASSIGNED_NAME = "Sin asignar";
