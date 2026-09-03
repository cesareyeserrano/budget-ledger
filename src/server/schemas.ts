// @aitri-trace FR-ID: FR-507, US-ID: US-507, AC-ID: AC-507c, TC-ID: TC-BE-026f
/**
 * Module: server/schemas
 * Purpose: Esquemas Zod del BORDE de la API (FR-507). Reutilizan las reglas del dominio compartido
 *   (PERIOD_KEY, amountSchema) para que el contrato de datos sea UNO solo cliente/servidor (evita
 *   deriva). Un payload que no valida se rechaza 400/422 ANTES de abrir cualquier transacción.
 * Dependencies: zod, @/domain (PERIOD_KEY, amountSchema)
 */
import { z } from "zod";
import { PERIOD_KEY, amountSchema } from "@/domain";

const nodeType = z.enum(["expense", "income", "transfer"]);

/** Input de un movimiento nuevo (POST /api/v1/movements). amount entero >= 1 (regla del dominio). */
export const movementInputSchema = z.object({
  type: nodeType,
  catId: z.string().min(1),
  subId: z.string().nullable().optional(),
  amount: amountSchema,
  period: PERIOD_KEY,
  date: z.string().optional(),
  note: z.string().nullable().optional(),
  // Feature transferencias (FR-1004/FR-1010): extremos De→A de una operación de reserva (hoja
  // transfer o el sentinel "@disponible"). Acotados como `target`; ignorados para expense/income.
  from: z.string().min(1).max(64).optional(),
  to: z.string().min(1).max(64).optional(),
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

const apiAmountMap = z.record(z.string(), z.record(PERIOD_KEY, z.number().int().gte(0)));

const apiMovementSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: nodeType,
  catId: z.string(),
  subId: z.string().nullable(),
  target: z.string(),
  amount: z.number().int().gte(1),
  period: PERIOD_KEY,
  createdAt: z.number(),
  date: z.string().optional(),
  note: z.string().nullable().optional(),
  // FR-1010: sin estos campos el PUT snapshot haría strip silencioso de los extremos De→A.
  from: z.string().optional(),
  to: z.string().optional(),
});

/** Observaciones por celda (FR-1012): nodeId → mes → notas manuales (texto ≤280, como `note`). */
const apiCellNotes = z.record(
  z.string(),
  z.record(PERIOD_KEY, z.array(z.object({ id: z.string(), createdAt: z.number(), text: z.string().min(1).max(280) })))
);

/** Estado completo del ledger para el snapshot PUT. */
export const ledgerStateSchema = z.object({
  ownerId: z.string(),
  nodes: z.array(apiNodeSchema),
  budgets: apiAmountMap,
  actuals: apiAmountMap,
  movements: z.array(apiMovementSchema),
  // FR-1010/FR-1012: opcional — un cliente pre-feature no lo envía; sin este campo el PUT haría
  // strip silencioso de las observaciones.
  cellNotes: apiCellNotes.optional(),
});

/** Cuerpo de PUT /api/v1/ledger: estado completo + revisión base para el lock optimista. */
export const ledgerPutSchema = z.object({
  baseRevision: z.number().int().gte(0),
  state: ledgerStateSchema,
});
export type LedgerPutBody = z.infer<typeof ledgerPutSchema>;

/**
 * Cuerpo del PUT del horizonte (FR-1907). Solo 1 o 2 AÑOS: cualquier otro valor es 400 antes de
 * tocar la base — el CHECK de la columna queda como última defensa, no como la única.
 */
export const horizonPutSchema = z.object({
  horizon: z.union([z.literal(1), z.literal(2)], {
    errorMap: () => ({ message: "El horizonte debe ser 1 o 2 años" }),
  }),
});
export type HorizonPutBody = z.infer<typeof horizonPutSchema>;
