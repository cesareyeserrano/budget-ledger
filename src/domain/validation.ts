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

const amountMapSchema = z.record(z.string(), z.record(MONTH_KEY, z.number()));

export const persistedNodesSchema = z.object({
  version: z.literal(1),
  ownerId: z.string(),
  nodes: z.array(nodeSchema),
});

export const persistedBudgetSchema = z.object({
  version: z.literal(2),
  budgets: amountMapSchema,
  actuals: amountMapSchema,
  movements: z.array(
    z.object({
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
    })
  ),
});
