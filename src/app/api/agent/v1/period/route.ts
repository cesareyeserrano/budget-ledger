/**
 * Module: app/api/agent/v1/period/route
 * Purpose: GET ?date=YYYY-MM-DD → el periodo que el calendario de la cuenta asigna a esa fecha, su
 *   rango y si está cerrado (FR-3417).
 * Dependencies: @/server/agent/http, @/server/agent/responses, @/server/data/agentRepo
 */
import { agentNotFound, withAgent } from "@/server/agent/http";
import { readError } from "@/server/agent/responses";
import { json } from "@/server/http";
import { agentPeriodOf } from "@/server/data/agentRepo";

// @aitri-trace FR-ID: FR-3417, US-ID: US-3417, AC-ID: AC-3417a, TC-ID: TC-AGT-170h, TC-AGT-172f
const getHandler = withAgent({}, async ({ ownerId, req }) => {
  const periodo = await agentPeriodOf(ownerId, new URL(req.url).searchParams.get("date"));
  return typeof periodo === "string" ? readError(periodo) : json(periodo);
});

export const GET = (req: Request): Promise<Response> => getHandler(req);
// Lo que esta ruta no ofrece también pasa por la envoltura: apagada o por un proxy, 404 como todo.
export const POST = (req: Request): Promise<Response> => agentNotFound(req);
export const PUT = (req: Request): Promise<Response> => agentNotFound(req);
export const PATCH = (req: Request): Promise<Response> => agentNotFound(req);
export const DELETE = (req: Request): Promise<Response> => agentNotFound(req);
export const OPTIONS = (req: Request): Promise<Response> => agentNotFound(req);
