/**
 * Module: app/api/agent/v1/movements/route
 * Purpose: GET → los movimientos de un periodo de la cuenta del token, o uno solo por su referencia
 *   de origen (FR-3416). POST → registra un gasto, un ingreso o una operación de bolsillo con las
 *   mismas reglas que el registro manual; la referencia de origen lo hace idempotente (FR-3408,
 *   FR-3409, FR-3410). 201 si lo creó, 200 si ya existía igual.
 * Dependencies: @/server/agent/http, @/server/agent/responses, @/server/agent/schemas,
 *   @/server/data/agentRepo, @/server/clock, @/server/sync
 */
import { agentNotFound, withAgent } from "@/server/agent/http";
import { insertRejection, readError } from "@/server/agent/responses";
import { agentMovementSchema, type AgentMovementInput } from "@/server/agent/schemas";
import { HTTP, json } from "@/server/http";
import { serverToday } from "@/server/clock";
import { syncHub } from "@/server/sync";
import { agentInsert, agentMovementByRef, agentMovements, toAgentMovement } from "@/server/data/agentRepo";

// @aitri-trace FR-ID: FR-3416, US-ID: US-3416, AC-ID: AC-3416a, TC-ID: TC-AGT-160h, TC-AGT-161h, TC-AGT-162f
const getHandler = withAgent({}, async ({ ownerId, req }) => {
  const q = new URL(req.url).searchParams;
  const ref = q.get("ref");
  if (ref !== null) {
    const uno = await agentMovementByRef(ownerId, ref);
    return typeof uno === "string" ? readError(uno) : json({ movement: uno });
  }
  const lista = await agentMovements(ownerId, q.get("period"), q.get("node"), serverToday(req));
  return typeof lista === "string" ? readError(lista) : json(lista);
});

// @aitri-trace FR-ID: FR-3408, US-ID: US-3408, AC-ID: AC-3408a, TC-ID: TC-AGT-080h, TC-AGT-090h, TC-AGT-100h
// @aitri-trace FR-ID: FR-3418, US-ID: US-3418, AC-ID: AC-3418a, TC-ID: TC-AGT-181h, TC-AGT-183f, TC-AGT-184e
const postHandler = withAgent<AgentMovementInput>({ schema: agentMovementSchema }, async ({ ownerId, tokenId, tokenName, body }) => {
  const { result, nodes } = await agentInsert(ownerId, { tokenId, tokenName }, body);
  if (result === null || !("movement" in result)) return insertRejection(result, nodes);
  // El mismo aviso que publica el navegador: las pestañas abiertas del dueño se actualizan solas.
  syncHub.publish(ownerId, { revision: result.revision });
  return json({ movement: toAgentMovement(result.movement, nodes), revision: result.revision }, HTTP.CREATED);
});

export const GET = (req: Request): Promise<Response> => getHandler(req);
export const POST = (req: Request): Promise<Response> => postHandler(req);
// Lo que esta ruta no ofrece también pasa por la envoltura: apagada o por un proxy, 404 como todo.
export const PUT = (req: Request): Promise<Response> => agentNotFound(req);
export const PATCH = (req: Request): Promise<Response> => agentNotFound(req);
export const DELETE = (req: Request): Promise<Response> => agentNotFound(req);
export const OPTIONS = (req: Request): Promise<Response> => agentNotFound(req);
