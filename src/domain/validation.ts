// @aitri-trace domain:validation — NFR-004: validación en el borde (monto entero >=1; nombres 1..60) y esquemas de persistencia.
import { z } from "zod";

export const MONTH_KEY = z.enum([
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
]);

/** Monto de un movimiento: entero >= 1 COP. Rechaza no-numéricos, negativos y 0. */
export const amountSchema = z
  .number({ invalid_type_error: "El monto debe ser numérico" })
  .int("El monto debe ser un entero")
  .gte(1, "El monto debe ser mayor a 0");

/** Valida una entrada de monto que puede venir como string del input. Devuelve null si es inválida. */
export function parseAmount(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
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
const amountMapSchema = z.record(z.string(), z.record(MONTH_KEY, z.number().int().gte(0)));

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
  month: MONTH_KEY,
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
  z.record(MONTH_KEY, z.array(z.object({ id: z.string(), createdAt: z.number(), text: z.string().max(280) })))
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
