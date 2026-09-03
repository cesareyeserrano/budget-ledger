// @aitri-trace FR-ID: FR-2002, US-ID: US-2002, AC-ID: AC-2005, TC-ID: TC-CDM-010h
/**
 * Module: app/api/v1/closure/route
 * Purpose: Mueve la frontera del cierre del usuario autenticado (feature cierre-de-mes).
 *   POST → cierra el mes cerrable · DELETE → reabre el último cerrado. Ambos bajo el mismo lock
 *   optimista por `revision` que el resto del ledger (ADR-06): 200, 409 si stale, 422 si la
 *   operación no es legal. Aislado por el ownerId de la SESIÓN — un ownerId en el cuerpo se ignora.
 *
 *   El cuerpo NO lleva el periodo: cuál se cierra lo decide el servidor. Un cierre fuera de orden
 *   no es expresable en este protocolo (FR-2002).
 * Dependencies: @/server/http, @/server/data/ledgerRepo, @/server/schemas, @/lib/date
 */
import { HTTP, json, withApi } from "@/server/http";
import { closeMonthFor, reopenMonthFor } from "@/server/data/ledgerRepo";
import { closurePostSchema, type ClosurePostBody } from "@/server/schemas";
import { syncHub } from "@/server/sync";
import { currentPeriod } from "@/lib/date";

/** 422 con el motivo que el dominio dio. Nunca se inventa uno: se propaga el que decidió la regla. */
function rejected(reason: "not_closable" | "nothing_closed" | "already_reopened"): Response {
  const code = reason === "not_closable" ? "not_closable" : "not_reopenable";
  const detail = reason === "not_closable" ? { closable: null } : { reason };
  return json({ error: { code, detail } }, HTTP.UNPROCESSABLE);
}

const postHandler = withApi<ClosurePostBody>(
  { auth: "required", schema: closurePostSchema, mutation: true },
  async ({ userId, body }) => {
    // El reloj entra por el BORDE (ADR-02): el dominio no lo lee, se le pasa.
    const res = await closeMonthFor(userId, body.baseRevision, currentPeriod());
    if (!res.ok && "conflict" in res) {
      return json({ error: { code: "revision_conflict" }, revision: res.revision }, HTTP.CONFLICT);
    }
    if (!res.ok) return rejected(res.rejected);
    syncHub.publish(userId, { revision: res.revision }); // los demás dispositivos, al día (FR-511)
    return json({ revision: res.revision, closure: res.closure });
  }
);

const deleteHandler = withApi<ClosurePostBody>(
  { auth: "required", schema: closurePostSchema, mutation: true },
  async ({ userId, body }) => {
    const res = await reopenMonthFor(userId, body.baseRevision);
    if (!res.ok && "conflict" in res) {
      return json({ error: { code: "revision_conflict" }, revision: res.revision }, HTTP.CONFLICT);
    }
    if (!res.ok) return rejected(res.rejected);
    syncHub.publish(userId, { revision: res.revision });
    return json({ revision: res.revision, closure: res.closure });
  }
);

export const POST = (req: Request): Promise<Response> => postHandler(req);
export const DELETE = (req: Request): Promise<Response> => deleteHandler(req);
