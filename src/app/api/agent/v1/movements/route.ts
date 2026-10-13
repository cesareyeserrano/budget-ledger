/**
 * Module: app/api/agent/v1/movements/route
 * Purpose: GET → los movimientos de un periodo de la cuenta del token, o uno solo por su referencia
 *   de origen (FR-3416).
 * Dependencies: @/server/agent/http, @/server/agent/responses, @/server/data/agentRepo, @/server/clock
 */
import { withAgent } from "@/server/agent/http";
import { readError } from "@/server/agent/responses";
import { json } from "@/server/http";
import { serverToday } from "@/server/clock";
import { agentMovementByRef, agentMovements } from "@/server/data/agentRepo";

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

export const GET = (req: Request): Promise<Response> => getHandler(req);
