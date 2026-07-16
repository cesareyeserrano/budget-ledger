// @aitri-trace FR-ID: FR-507, US-ID: US-507, AC-ID: AC-507c, TC-ID: TC-BE-026f
/**
 * Module: server/schemas
 * Purpose: Esquemas Zod del BORDE de la API (FR-507). Reutilizan las reglas del dominio compartido
 *   (MONTH_KEY, amountSchema) para que el contrato de datos sea UNO solo cliente/servidor (evita
 *   deriva). Un payload que no valida se rechaza 400/422 ANTES de abrir cualquier transacción.
 * Dependencies: zod, @/domain (MONTH_KEY, amountSchema)
 */
import { z } from "zod";
import { MONTH_KEY, amountSchema } from "@/domain";

const nodeType = z.enum(["expense", "income", "transfer"]);

/** Input de un movimiento nuevo (POST /api/v1/movements). amount entero >= 1 (regla del dominio). */
export const movementInputSchema = z.object({
  type: nodeType,
  catId: z.string().min(1),
  subId: z.string().nullable().optional(),
  amount: amountSchema,
  month: MONTH_KEY,
  date: z.string().optional(),
  note: z.string().nullable().optional(),
});
export type MovementInput = z.infer<typeof movementInputSchema>;

const apiNodeSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: nodeType,
  level: z.enum(["group", "category", "sub"]),
  parentId: z.string().nullable(),
  name: z.string(),
  icon: z.string().nullable(),
  system: z.boolean().optional(),
  order: z.number().int(),
});

const apiAmountMap = z.record(z.string(), z.record(MONTH_KEY, z.number().int().gte(0)));

const apiMovementSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: nodeType,
  catId: z.string(),
  subId: z.string().nullable(),
  target: z.string(),
  amount: z.number().int().gte(1),
  month: MONTH_KEY,
  createdAt: z.number(),
  date: z.string().optional(),
  note: z.string().nullable().optional(),
});

/** Estado completo del ledger para el snapshot PUT. */
export const ledgerStateSchema = z.object({
  ownerId: z.string(),
  nodes: z.array(apiNodeSchema),
  budgets: apiAmountMap,
  actuals: apiAmountMap,
  movements: z.array(apiMovementSchema),
});

/** Cuerpo de PUT /api/v1/ledger: estado completo + revisión base para el lock optimista. */
export const ledgerPutSchema = z.object({
  baseRevision: z.number().int().gte(0),
  state: ledgerStateSchema,
});
export type LedgerPutBody = z.infer<typeof ledgerPutSchema>;
