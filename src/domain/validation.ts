// @aitri-trace domain:validation — NFR-004: validación en el borde (monto entero >=1; nombres 1..60) y esquemas de persistencia.
import { z } from "zod";

/**
 * El periodo del ledger en el borde: "YYYY-MM" (FR-1901, NFR-1908).
 *
 * Antes era un `z.enum` de doce literales, y ESA era la defensa real: un periodo inventado no
 * pasaba. Al abrir el dominio de valores esa defensa se debilita, así que aquí se reconstruye en
 * tres capas, en este orden:
 *   1. longitud máxima 7 — corta una cadena de 1.000 caracteres antes de llegar a la regex;
 *   2. formato exacto — cuatro dígitos, guion, mes 01–12 (rechaza "2026-13" y "2026-00");
 *   3. año dentro de [2000, 2100] — rechaza "0000-01" y años absurdos que el CHECK de la base sí
 *      aceptaría y que inflarían el rango activo y, con él, el coste de todo el cálculo.
 *
 * El CHECK de Postgres queda como ÚLTIMA defensa, no como la única.
 */
export const PERIOD_MIN_YEAR = 2000;
export const PERIOD_MAX_YEAR = 2100;
export const PERIOD_KEY = z
  .string()
  .max(7, "Periodo demasiado largo")
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Periodo inválido: se espera YYYY-MM")
  .refine((p) => {
    const y = Number(p.slice(0, 4));
    return y >= PERIOD_MIN_YEAR && y <= PERIOD_MAX_YEAR;
  }, `El año debe estar entre ${PERIOD_MIN_YEAR} y ${PERIOD_MAX_YEAR}`);

/**
 * TOPE SUPERIOR DEL DINERO (BG-021). Es `Number.MAX_SAFE_INTEGER`, y la frontera no es arbitraria:
 * es EXACTAMENTE donde JavaScript deja de representar los enteros de forma exacta. Por encima,
 * `2**53 + 1 === 2**53` es `true`, así que un peso se pierde ANTES de que ninguna validación llegue
 * a verlo — no hay defensa posible más arriba, solo la ilusión de haber guardado lo que el usuario
 * escribió.
 *
 * Medido el 2026-09-08, antes del arreglo: el esquema aceptaba `1e21` y hasta `Number.MAX_VALUE`
 * (1.79e308), porque `z.number().int()` los da por enteros. La columna es `bigint` en Postgres, cuyo
 * techo es ~9.22e18, así que todo eso terminaba en un 500 del servidor — y lo que caía entre 2^53 y
 * ese techo se guardaba en silencio con otro valor.
 *
 * NO es un límite de producto: 9.007.199.254.740.991 COP no es una cifra que nadie vaya a teclear.
 * Es la frontera de la CORRECCIÓN. Si algún día se quiere un tope de producto más bajo y explicable
 * al usuario, es otra decisión y va por encima de esta.
 */
export const MONTO_MAX = Number.MAX_SAFE_INTEGER;

const MSG_MAX = `El monto no puede superar ${MONTO_MAX.toLocaleString("es-CO")}`;

/** Monto de un movimiento: entero entre 1 y MONTO_MAX. Rechaza no-numéricos, negativos y 0. */
export const amountSchema = z
  .number({ invalid_type_error: "El monto debe ser numérico" })
  .finite("El monto debe ser un número finito")
  .int("El monto debe ser un entero")
  .gte(1, "El monto debe ser mayor a 0")
  .lte(MONTO_MAX, MSG_MAX);

/**
 * Monto de una CELDA o del saldo inicial: entero entre 0 y MONTO_MAX. El cero es legítimo aquí
 * —una celda vacía, «empiezo desde cero»— y por eso no comparte esquema con el movimiento, que
 * exige >= 1.
 */
export const cellAmountSchema = z
  .number({ invalid_type_error: "El monto debe ser numérico" })
  .finite("El monto debe ser un número finito")
  .int("El monto debe ser un entero")
  .gte(0, "El monto no puede ser negativo")
  .lte(MONTO_MAX, MSG_MAX);

/**
 * Un monto tecleado: solo DÍGITOS, con espacios alrededor y un signo `+` opcional tolerados.
 *
 * BG-022 — `Number()` a secas entiende notaciones que nadie teclea en un campo de dinero y que
 * significan otra cosa: `"0x10"` daba **16** (el usuario escribió diez) y `"1e3"` daba **1000**.
 * El monto quedaba guardado con un número distinto del que la persona creyó escribir, en silencio.
 * Se rechaza en vez de interpretar: un campo de pesos no es una calculadora de literales.
 */
const MONTO_TECLEADO = /^\+?\d+$/;

/** Valida una entrada de monto que puede venir como string del input. Devuelve null si es inválida. */
export function parseAmount(raw: unknown): number | null {
  let n: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!MONTO_TECLEADO.test(t)) return null; // BG-022: ni hexadecimal ni notación científica
    n = Number(t);
  }
  const res = amountSchema.safeParse(n);
  return res.success ? res.data : null;
}

export const nodeNameSchema = z.string().trim().min(1, "El nombre no puede estar vacío").max(60);

/**
 * Nota de movimiento u observación: trim; vacío→null; recorte duro a 280 (FR-211).
 * Vive aquí (borde de validación) para que mutations y reserve la compartan sin ciclos.
 *
 * @param note Texto crudo del input (puede ser null/undefined).
 * @returns La nota normalizada o null si queda vacía.
 * @throws Nunca.
 */
export function normalizeNote(note: string | null | undefined): string | null {
  if (note == null) return null;
  const trimmed = note.trim();
  return trimmed === "" ? null : trimmed.slice(0, 280);
}

const nodeSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: z.enum(["expense", "income", "transfer"]),
  level: z.enum(["group", "category", "sub"]),
  parentId: z.string().nullable(),
  name: z.string(),
  icon: z.string().nullable(),
  system: z.boolean().optional(),
  order: z.number(),
});

// Enteros ≥ 0, como el CHECK de la BD y el schema del API: un blob local manipulado con montos
// negativos debe caer a semilla (NFR-003), no cargar un estado que viola el piso (hallazgo adv. 6).
const amountMapSchema = z.record(z.string(), z.record(PERIOD_KEY, z.number().int().gte(0)));

export const persistedNodesSchema = z.object({
  version: z.literal(1),
  ownerId: z.string(),
  nodes: z.array(nodeSchema),
});

const movementSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: z.enum(["expense", "income", "transfer"]),
  catId: z.string(),
  subId: z.string().nullable(),
  target: z.string(),
  amount: z.number(),
  period: PERIOD_KEY,
  createdAt: z.number(),
  // Delta aditivo (feature stack-upgrade-theme): opcionales para que sobrevivan a la recarga
  // y para no invalidar movimientos previos que no los tienen.
  date: z.string().optional(),
  note: z.string().nullable().optional(),
  // Delta aditivo (feature transferencias, FR-1010): extremos De→A de una operación de reserva.
  // Sin ellos el schema haría strip silencioso — la pérdida de datos que la 5-capa evita.
  from: z.string().optional(),
  to: z.string().optional(),
});

/** Formato VIEJO (aportes mensuales en celdas transfer). Se acepta SOLO para migrar una vez. */
export const persistedBudgetV2Schema = z.object({
  version: z.literal(2),
  budgets: amountMapSchema,
  actuals: amountMapSchema,
  movements: z.array(movementSchema),
});
export type PersistedBudgetV2 = z.infer<typeof persistedBudgetV2Schema>;

/** Observaciones por celda (FR-1012): nodeId → mes → lista de notas manuales. */
export const cellNotesSchema = z.record(
  z.string(),
  z.record(PERIOD_KEY, z.array(z.object({ id: z.string(), createdAt: z.number(), text: z.string().max(280) })))
);

/** Formato intermedio v3 (saldos con arrastre — revertido). Se acepta SOLO para migrar a v4. */
export const persistedBudgetV3Schema = z.object({
  version: z.literal(3),
  budgets: amountMapSchema,
  actuals: amountMapSchema,
  movements: z.array(movementSchema),
  cellNotes: cellNotesSchema.optional(),
});
export type PersistedBudgetV3 = z.infer<typeof persistedBudgetV3Schema>;

/**
 * Formato VIGENTE (modelo v4, decisión del usuario 2026-07-29): celdas transfer = APORTES del
 * mes (flujo); los retiros viven en el journal (movimientos con from/to). Un AmountMap es bytes
 * idénticos como aportes o como saldos — la MARCA de versión (clave/campo) es lo único que
 * distingue los formatos; sin ella cada carga re-convertiría (corrupción a la segunda).
 */
export const persistedBudgetV4Schema = z.object({
  version: z.literal(4),
  budgets: amountMapSchema,
  actuals: amountMapSchema,
  movements: z.array(movementSchema),
  cellNotes: cellNotesSchema.optional(),
});
export type PersistedBudgetV4 = z.infer<typeof persistedBudgetV4Schema>;

/** Unión discriminada v2|v3|v4: la carga decide por la marca, jamás por el contenido. */
export const persistedBudgetSchema = z.discriminatedUnion("version", [
  persistedBudgetV2Schema,
  persistedBudgetV3Schema,
  persistedBudgetV4Schema,
]);
