/**
 * Module: server/agent/schemas
 * Purpose: Los esquemas Zod de entrada de la puerta para agentes (NFR-3411). ESTRICTOS: un campo de
 *   más es un cliente que cree estar mandando algo que no existe —un periodo, un ownerId— y es
 *   mejor un 422 que un silencio. Reutilizan los validadores del dominio (monto, fecha) para que el
 *   agente y la app no puedan divergir en qué es un dato válido.
 * Dependencies: zod, @/domain/validation
 */
import { z } from "zod";
import { MOVEMENT_DATE, amountSchema } from "@/domain/validation";

/** Longitud máxima de un id de nodo o de un extremo De→A. */
export const AGENT_ID_MAX = 64;
/** Longitud máxima de la referencia de origen (FR-3409). */
export const AGENT_REF_MAX = 128;
/** Longitud máxima de la nota de un movimiento. */
export const AGENT_NOTE_MAX = 280;
/** Prefijo con el que una ruta señala «por referencia» en vez de por id: /movements/ref:L300. */
export const REF_KEY_PREFIX = "ref:";

const nodeId = z.string().min(1).max(AGENT_ID_MAX);
const ref = z.string().min(1).max(AGENT_REF_MAX);
const note = z.string().max(AGENT_NOTE_MAX).nullable().optional();

/** Registrar un gasto o un ingreso. El periodo NO viaja: lo deriva el servidor de la fecha. */
const gastoOIngreso = z
  .object({ type: z.enum(["expense", "income"]), target: nodeId, amount: amountSchema, date: MOVEMENT_DATE, note, ref })
  .strict();

/** Registrar una operación de bolsillo: reservar, sacar o mover (extremos De→A). */
const bolsillo = z
  .object({ type: z.literal("transfer"), from: nodeId, to: nodeId, amount: amountSchema, date: MOVEMENT_DATE, note, ref })
  .strict();

/**
 * Cuerpo de POST /api/agent/v1/movements.
 * @aitri-trace FR-ID: FR-3408, US-ID: US-3408, AC-ID: AC-3408c, TC-ID: TC-AGT-085f, TC-AGT-036f, TC-AGT-094f
 */
export const agentMovementSchema = z.union([gastoOIngreso, bolsillo]);
export type AgentMovementInput = z.infer<typeof agentMovementSchema>;

/**
 * Cuerpo de PATCH /api/agent/v1/movements/{key}: al menos un campo, y solo estos cuatro. Ni el
 * periodo ni la referencia se pueden cambiar.
 * @aitri-trace FR-ID: FR-3411, US-ID: US-3411, AC-ID: AC-3411c, TC-ID: TC-AGT-116f
 */
export const agentPatchSchema = z
  .object({ amount: amountSchema.optional(), date: MOVEMENT_DATE.optional(), note, target: nodeId.optional() })
  .strict()
  .refine((p) => Object.keys(p).length > 0, "Nada que cambiar");
export type AgentPatchInput = z.infer<typeof agentPatchSchema>;
