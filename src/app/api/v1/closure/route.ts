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
import { serverToday } from "@/server/clock";

/** 422 con el motivo que el dominio dio. Nunca se inventa uno: se propaga el que decidió la regla. */
function rejected(reason: "not_closable" | "nothing_closed" | "already_reopened"): Response {
  const code = reason === "not_closable" ? "not_closable" : "not_reopenable";
  const detail = reason === "not_closable" ? { closable: null } : { reason };
  return json({ error: { code, detail } }, HTTP.UNPROCESSABLE);
}

/**
 * 422 del cierre bloqueado por celdas descuadradas (FR-2512).
 *
 * Las celdas viajan NOMBRADAS: el control las repite en su motivo, y un rechazo que solo dijera
 * «no se puede» obligaría al usuario a recorrer el mes buscando cuál falla.
 */
function unbalanced(period: string, cells: { nodeId: string; name: string }[]): Response {
  return json({ error: { code: "unbalanced_cells", detail: { period, cells } } }, HTTP.UNPROCESSABLE);
}

const postHandler = withApi<ClosurePostBody>(
  { auth: "required", schema: closurePostSchema, mutation: true },
  async ({ userId, body, req }) => {
    // El reloj entra por el BORDE (ADR-02): el dominio no lo lee, se le pasa.
    // Feature ciclos (FR-2409, FLAG-2): «hoy» lo decide el servidor en LEDGER_TZ; el periodo en curso
    // sale del calendario del dueño dentro de closeMonthFor.
    const res = await closeMonthFor(userId, body.baseRevision, serverToday(req));
    if (!res.ok && "conflict" in res) {
      return json({ error: { code: "revision_conflict" }, revision: res.revision }, HTTP.CONFLICT);
    }
    if (!res.ok && res.rejected === "unbalanced_cells") return unbalanced(res.period, res.cells);
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
    // `unbalanced_cells` es un motivo del CIERRE y solo del cierre (FR-2512, TC-DDC-216f): reabrir
    // no se bloquea por descuadres, porque la reapertura es la única vía que le queda al usuario
    // para arreglarlos. Como `ClosureResult` es el tipo compartido por las dos operaciones, aquí se
    // descarta explícitamente en vez de ensanchar `rejected` con un caso que nunca va a llegar.
    if (!res.ok && res.rejected === "unbalanced_cells") return unbalanced(res.period, res.cells);
    if (!res.ok) return rejected(res.rejected);
    syncHub.publish(userId, { revision: res.revision });
    return json({ revision: res.revision, closure: res.closure });
  }
);

export const POST = (req: Request): Promise<Response> => postHandler(req);
export const DELETE = (req: Request): Promise<Response> => deleteHandler(req);
