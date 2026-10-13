/**
 * Module: app/api/agent/v1/tree/route
 * Purpose: GET → el árbol vigente de la cuenta del token (FR-3407). Solo lectura: bajo esta ruta
 *   no existe ningún método que cree, renombre, mueva o borre nodos.
 * Dependencies: @/server/agent/http, @/server/http, @/server/data/agentRepo
 */
import { withAgent } from "@/server/agent/http";
import { HTTP, apiError, json } from "@/server/http";
import { agentTree } from "@/server/data/agentRepo";

// @aitri-trace FR-ID: FR-3407, US-ID: US-3407, AC-ID: AC-3407a, TC-ID: TC-AGT-070h, TC-AGT-072f
const getHandler = withAgent({}, async ({ ownerId }) => {
  const tree = await agentTree(ownerId);
  if (!tree) return apiError("not_found", "No encontrado", HTTP.NOT_FOUND);
  return json(tree);
});

export const GET = (req: Request): Promise<Response> => getHandler(req);
