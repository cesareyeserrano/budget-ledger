/**
 * Module: app/api/agent/v1/movements/[key]/route
 * Purpose: Un movimiento registrado por un agente, señalado por su id o por `ref:` + su referencia
 *   de origen. PATCH → corrige monto, fecha, nota u hoja de un gasto o ingreso (FR-3411).
 *   DELETE → lo deshace, incluidas las operaciones de bolsillo (FR-3412). Lo registrado a mano no
 *   existe para estas dos rutas: 404.
 * Dependencies: @/server/agent/http, @/server/agent/responses, @/server/agent/schemas,
 *   @/server/data/agentRepo, @/server/sync
 */
import { agentNotFound, withAgent } from "@/server/agent/http";
import { writeRejection } from "@/server/agent/responses";
import { agentPatchSchema, type AgentPatchInput } from "@/server/agent/schemas";
import { json } from "@/server/http";
import { syncHub } from "@/server/sync";
import { agentUndo, agentUpdate, toAgentMovement } from "@/server/data/agentRepo";

// @aitri-trace FR-ID: FR-3411, US-ID: US-3411, AC-ID: AC-3411a, TC-ID: TC-AGT-110h, TC-AGT-112f, TC-AGT-117e
const patchHandler = withAgent<AgentPatchInput>({ schema: agentPatchSchema }, async ({ ownerId, params, body }) => {
  const { result, nodes } = await agentUpdate(ownerId, params.key, body);
  if (!result.ok) return writeRejection(result);
  syncHub.publish(ownerId, { revision: result.revision });
  return json({ movement: toAgentMovement(result.movement, nodes), revision: result.revision });
});

// @aitri-trace FR-ID: FR-3412, US-ID: US-3412, AC-ID: AC-3412a, TC-ID: TC-AGT-120h, TC-AGT-121h, TC-AGT-123f
const deleteHandler = withAgent({}, async ({ ownerId, params }) => {
  const { result } = await agentUndo(ownerId, params.key);
  if (!result.ok) return writeRejection(result);
  syncHub.publish(ownerId, { revision: result.revision });
  return json({ revision: result.revision });
});

// Ruta dinámica: Next 15 pasa { params: Promise<{ key: string }> } como segundo argumento.
type Ctx = { params: Promise<{ key: string }> };
export const PATCH = (req: Request, ctx: Ctx): Promise<Response> => patchHandler(req, ctx);
export const DELETE = (req: Request, ctx: Ctx): Promise<Response> => deleteHandler(req, ctx);
// Lo que esta ruta no ofrece también pasa por la envoltura: apagada o por un proxy, 404 como todo.
export const GET = (req: Request, ctx: Ctx): Promise<Response> => agentNotFound(req, ctx);
export const POST = (req: Request, ctx: Ctx): Promise<Response> => agentNotFound(req, ctx);
export const PUT = (req: Request, ctx: Ctx): Promise<Response> => agentNotFound(req, ctx);
export const OPTIONS = (req: Request, ctx: Ctx): Promise<Response> => agentNotFound(req, ctx);
