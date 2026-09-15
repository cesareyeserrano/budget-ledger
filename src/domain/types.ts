// @aitri-trace domain:types — modelo de datos del dominio (verificado contra el prototipo Ledger offline)

/** 3 tipos FIJOS: eje de signo (D-1). No editables. */
export type NodeType = "expense" | "income" | "transfer";

// ── Feature ciclos (FR-2401/FR-2402/FR-2408, ADR-01/ADR-03) ─────────────────────────────────────
/** El eje del presupuesto: mes calendario (hoy, por defecto) o ciclo de pago. */
export type PeriodMode = "month" | "cycle";
/** Qué hacer cuando el día de pago no existe en el mes (29, 30, 31). */
export type EndOfMonthPolicy = "last_day" | "shift";
/**
 * Una versión de la configuración de ciclos. Append-only: cambiar es INSERTAR (RF-07/RF-08). La
 * última fila por `seq` es la vigente; `mode:"month"` es la vuelta a mes a mes (fila de historial).
 */
export interface CycleVersion {
  seq: number;
  mode: PeriodMode;
  anchorDay: number | null;
  eomPolicy: EndOfMonthPolicy | null;
  /** "YYYY-MM-DD": día en que la versión entró en vigor (lo que Configuración muestra). */
  effectiveFrom: string;
  /** "YYYY-MM-DD": primer pago bajo la versión (RF-09a). null en la primera activación y en "month". */
  firstPay: string | null;
  /** `startMonth` antes de activar; lo usa la vuelta a mes (FR-2410). */
  restoreStartMonth: string | null;
  createdAt: string;
}
export interface CycleConfig {
  mode: PeriodMode;
  versions: CycleVersion[];
}

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
  /** Delta aditivo (feature diario-de-celda, FR-2504): `adjustment` marca el movimiento que nace
   *  de teclear un valor en la celda — el ÚNICO que admite monto negativo, y solo en gasto o
   *  ingreso. Ausente ≡ `manual`, así que los movimientos previos siguen siendo válidos. El campo
   *  es inmutable: un ajuste no se convierte en manual ni al revés. */
  kind?: "adjustment";
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
/**
 * Lo que un mes le pasa al siguiente dentro de su propio plano: dos componentes que no se mezclan.
 * Vive aquí y no en `balance.ts` porque `Closure` lo necesita para su línea de base (FR-2010) y
 * `types.ts` no puede importar de `balance.ts` sin cerrar un ciclo.
 */
export interface Carry {
  available: number;
  reservedBalance: number;
}

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
  /**
   * FR-2010. El saldo con el que CERRABA el mes reabierto en el instante de reabrirlo — el
   * referente de «valor anterior» cuando se enumera el impacto aguas abajo.
   *
   * Presente si y solo si `reopened` no es null; se borra al volver a cerrar. Se persiste (dos
   * columnas, no un snapshot) para que el marco de referencia siga siendo «cómo estaba cuando lo
   * reabrí» después de recargar la página o cambiar de dispositivo, y para que cinco correcciones
   * seguidas muestren el efecto NETO y no cinco deltas sueltos (ADR-15).
   */
  reopenBaseline?: Carry;
}

/**
 * FR-2010. Una fila del impacto: un mes posterior al reabierto cuyas cifras se movieron.
 *
 * `brokenByThisEdit` distingue «lo rompiste tú» de «ya venía roto»: solo es true si el mes pasó de
 * estar cubierto a no estarlo. Un mes que ya arrastraba déficit antes de la reapertura no se le
 * imputa a la corrección (TC-CDM-102f).
 */
export interface ImpactRow {
  period: PeriodKeyT;
  availableBefore: number;
  availableAfter: number;
  brokenByThisEdit: boolean;
}

/**
 * Feature ciclos, re-derivación del 2026-09-10 (FR-2404, FR-2410, ADR-07). Una parte de la memoria de
 * origen: de qué mes calendario vino un dato sin día que la activación movió. `amount` es la parte de
 * la celda (con signo solo en «actual», que guarda residuos, ADR-06); 0 en «movement» y «note».
 */
export interface OriginPart {
  subject: "budget" | "actual" | "movement" | "note";
  /** id de hoja (budget/actual), de movimiento o de nota. */
  ref: string;
  /** Clave donde vive HOY. */
  period: PeriodKeyT;
  /** Mes calendario del que vino (sin sufijo). */
  originPeriod: PeriodKeyT;
  amount: number;
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
  /**
   * FR-2201. El mes en que el usuario declara que EMPIEZA su historia. Delta aditivo: ausente o
   * `null` ≡ no declarado, y entonces todo se comporta exactamente como antes de esta feature.
   *
   * No se deduce del dato más antiguo. Anclar la apertura en «el primer mes con datos» la haría
   * FLOTAR: teclear algo en un mes anterior la mudaría de sitio en silencio y recalcularía toda la
   * serie. El mes declarado es el ancla estable.
   */
  startMonth?: PeriodKeyT | null;
  /**
   * FR-2202. Lo que el usuario ya tenía el día que empezó, en pesos enteros ≥ 0. Delta aditivo:
   * ausente o `null` ≡ no declarado ≡ abre en 0, byte a byte como hoy.
   *
   * NO es un ingreso: no entra en «Resultado del mes», que es justo la cifra que se falsearía si
   * se metiera como tal. Ocupa la casilla del «Saldo del mes anterior» del mes de inicio.
   */
  openingBalance?: number | null;
  /**
   * Feature ciclos (FR-2401, ADR-03). La configuración de ciclos, de SOLO LECTURA en el snapshot:
   * la escribe únicamente `PUT /api/v1/ledger/cycles`. Ausente ≡ modo mes ≡ hoy, byte a byte.
   */
  cycles?: CycleConfig;
  /**
   * Feature ciclos, re-derivación del 2026-09-10 (ADR-07). La memoria de origen de lo que la activación
   * movió. SOLO servidor (tabla relocation_origin): `GET /ledger` no la expone y `PUT /ledger` la ignora.
   */
  origins?: OriginPart[];
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
