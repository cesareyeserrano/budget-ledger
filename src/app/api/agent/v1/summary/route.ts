/**
 * Module: app/api/agent/v1/summary/route
 * Purpose: GET → el resumen de un periodo calculado en el servidor con las funciones de la
 *   pantalla (FR-3415). Sin `period`, el vigente.
 * Dependencies: @/server/agent/http, @/server/agent/responses, @/server/data/agentRepo, @/server/clock
 */
import { withAgent } from "@/server/agent/http";
import { readError } from "@/server/agent/responses";
import { json } from "@/server/http";
import { serverToday } from "@/server/clock";
import { agentSummary } from "@/server/data/agentRepo";

// @aitri-trace FR-ID: FR-3415, US-ID: US-3415, AC-ID: AC-3415a, TC-ID: TC-AGT-150h, TC-AGT-152e, TC-AGT-153f
const getHandler = withAgent({}, async ({ ownerId, req }) => {
  const resumen = await agentSummary(ownerId, new URL(req.url).searchParams.get("period"), serverToday(req));
  return typeof resumen === "string" ? readError(resumen) : json(resumen);
});

export const GET = (req: Request): Promise<Response> => getHandler(req);
