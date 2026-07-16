// @aitri-trace FR-ID: FR-508, US-ID: US-508, AC-ID: AC-508a, TC-ID: TC-BE-014h
/**
 * Module: app/api/v1/ledger/route
 * Purpose: Snapshot del ledger del usuario autenticado. GET → { revision, state } o 204 si nunca
 *   persistió (el cliente siembra, FR-513). PUT → replace transaccional con lock optimista por
 *   revision (ADR-06/FR-508): 200 { revision } o 409 si stale. Aislado por ownerId de la sesión.
 * Dependencies: @/server/http, @/server/data/ledgerRepo, @/server/schemas
 */
import { HTTP, json, withApi } from "@/server/http";
import { loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { ledgerPutSchema, type LedgerPutBody } from "@/server/schemas";
import { syncHub } from "@/server/sync";

const getHandler = withApi({ auth: "required" }, async ({ userId }) => {
  const loaded = await loadLedger(userId);
  if (!loaded) return new Response(null, { status: HTTP.NO_CONTENT });
  return json({ revision: loaded.revision, state: loaded.state });
});

const putHandler = withApi<LedgerPutBody>(
  { auth: "required", schema: ledgerPutSchema, mutation: true },
  async ({ userId, body }) => {
    // El ownerId del payload se IGNORA: saveLedger fija el de la sesión.
    const res = await saveLedger(userId, body.state, body.baseRevision);
    if (!res.ok) return json({ error: { code: "revision_conflict" }, revision: res.revision }, HTTP.CONFLICT);
    // Notifica a los demás dispositivos del MISMO usuario (FR-511).
    syncHub.publish(userId, { revision: res.revision });
    return json({ revision: res.revision });
  }
);

// Firmas exactas que `next build` espera para una ruta estática (un solo argumento).
export const GET = (req: Request): Promise<Response> => getHandler(req);
export const PUT = (req: Request): Promise<Response> => putHandler(req);
