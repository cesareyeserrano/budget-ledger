// @aitri-trace domain:types — modelo de datos del dominio (verificado contra el prototipo Ledger offline)

/** 3 tipos FIJOS: eje de signo (D-1). No editables. */
export type NodeType = "expense" | "income" | "transfer";

/** 3 niveles editables bajo cada tipo. */
export type NodeLevel = "group" | "category" | "sub";

/**
 * El periodo del ledger vive en `./periods` (FR-1901): "YYYY-MM". Se re-exporta desde aquí porque
 * `types.ts` es la puerta del modelo y medio proyecto lo importa de aquí.
 *
 * Antes de multi-anio esto era `PeriodKey`: doce literales de un año implícito.
 */
export type { PeriodKey } from "./periods";
import type { PeriodKey as PeriodKeyT } from "./periods";

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

/** Mapa nodeId -> { PeriodKey -> monto COP entero >= 0 }. Solo para hojas. */
export type AmountMap = Record<string, Partial<Record<PeriodKeyT, number>>>;

export interface Movement {
  id: string;
  ownerId: string;
  type: NodeType;
  catId: string;
  subId: string | null;
  /** = subId ?? catId. La hoja destino: SIEMPRE debe resolver un nodo existente (cero huérfanos). */
  target: string;
  amount: number; // entero >= 1
  period: PeriodKeyT;
  createdAt: number;
  /** Delta aditivo (feature stack-upgrade-theme, ADR-03): fecha de captura ISO del registro
   *  móvil ("YYYY-MM-DDTHH:mm"). El `period` se DERIVA de aquí. Opcional: los movimientos
   *  previos no lo tienen y siguen siendo válidos (sin migración). */
  date?: string;
  /** Nota opcional (≤280, trim, vacío→null). Ausente en movimientos previos. */
  note?: string | null;
  /** Delta aditivo (feature transferencias, ADR-02): extremo ORIGEN de una operación de reserva
   *  De→A — id de hoja transfer o el sentinel "@disponible". Los movimientos previos no lo
   *  tienen y siguen siendo válidos. El sentinel JAMÁS aparece en `target`. */
  from?: string;
  /** Extremo DESTINO de una operación de reserva (hoja transfer o "@disponible"). */
  to?: string;
}

/** Observación manual de una celda (FR-1012). Texto ≤ 280; id/createdAt como los movimientos. */
export interface CellNote {
  id: string;
  createdAt: number;
  text: string;
}

/** Mapa nodeId → mes → observaciones manuales de esa celda (feature transferencias, FR-1012). */
export type CellNotesMap = Record<string, Partial<Record<PeriodKeyT, CellNote[]>>>;

/**
 * El estado de cierre del ledger (feature cierre-de-mes, FR-2001).
 *
 * La frontera es un ESCALAR, no una marca por mes, y eso es la decisión (ADR-11): con una sola
 * frontera un estado NO CONTIGUO —marzo cerrado y febrero abierto— es INDECIBLE, en vez de ser un
 * invariante que hay que vigilar en cada escritura. Un invariante que no se puede expresar es el
 * único que no se rompe.
 */
export interface Closure {
  /** Todo periodo ≤ este valor está cerrado. null = nada cerrado. */
  closedThrough: PeriodKeyT | null;
  /**
   * El mes actualmente reabierto, o null. Cuando no es null vale siempre
   * `addMonths(closedThrough, 1)`. Es el guardia de «uno a la vez» que impide caminar hacia atrás
   * reabriendo mes tras mes (FR-2005, ADR-13), y a la vez el dato que la interfaz necesita para
   * decir QUÉ mes está reabierto.
   */
  reopened: PeriodKeyT | null;
}

export interface LedgerState {
  ownerId: string;
  nodes: LedgerNode[];
  budgets: AmountMap;
  actuals: AmountMap;
  movements: Movement[];
  /** Delta aditivo (FR-1012): ausente en estados previos — cargan y operan sin él. */
  cellNotes?: CellNotesMap;
  /** Delta aditivo (FR-2001): ausente ≡ nada cerrado. Un ledger previo carga y opera sin él. */
  closure?: Closure;
}

export const STORAGE_KEYS = {
  nodes: "ledger.nodes.v1",
  // Feature transferencias (modelo v4, decisión del usuario 2026-07-29): celdas transfer =
  // APORTES del mes; retiros en el journal. La clave ES la marca de versión (idempotencia por
  // marca, nunca por heurística).
  budget: "ledger.budget.v4",
} as const;

// LEGACY_BUDGET_KEYS (ledger.budget.v2/v3) se retiró con el almacén de localStorage
// (feature servidor-fuente-unica, FR-1104): eran claves de ESE almacén. La CONVERSIÓN v3→v4
// sigue viva en domain/migrate.ts, marcada por la columna `dataVersion` en Postgres.
