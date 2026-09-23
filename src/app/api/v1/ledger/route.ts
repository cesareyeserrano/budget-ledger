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
    // Feature cierre-de-mes (FR-2003): la escritura tocaba cifras de un mes cerrado. 422 y no 409
    // porque no es un conflicto de versiones — reintentar con la revisión buena no lo arregla.
    if (!res.ok && "closedViolation" in res) {
      return json(
        { error: { code: "closed_period_violation", detail: { periods: res.periods } } },
        HTTP.UNPROCESSABLE
      );
    }
    // Feature reglas-en-el-servidor (FR-2101): la escritura dejaba algún mes peor de lo que
    // estaba. 422 y no 409 por el mismo motivo que el anterior: reintentar no lo arregla, hay que
    // cambiar QUÉ se escribe. El detalle viaja entero para que la interfaz pueda decir qué arreglar
    // primero (FR-2102) — sin el periodo y sin el límite, el mensaje sería mudo.
    if (!res.ok && "periodMismatch" in res) {
      // Feature ciclos (FR-2405, RV-01/RV-02): claves fuera del calendario o periodo incoherente con la fecha.
      return json({ error: { code: "period_mismatch", detail: { ids: res.ids } } }, HTTP.UNPROCESSABLE);
    }
    if (!res.ok && "domainViolation" in res) {
      return json(
        { error: { code: "domain_rule_violation", detail: { violations: res.violations } } },
        HTTP.UNPROCESSABLE
      );
    }
    // Feature diario-de-celda (NFR-2502): la escritura descuadraba una celda que antes cuadraba con
    // la suma de sus movimientos. 422 por el mismo motivo que los anteriores —reintentar no lo
    // arregla— y el detalle nombra la celda y las dos cifras, que es lo que el cliente necesita para
    // decir qué pasó sin volver a preguntar.
    if (!res.ok && "cellMismatch" in res) {
      return json(
        { error: { code: "cell_movement_mismatch", detail: res.cells } },
        HTTP.UNPROCESSABLE
      );
    }
    if (!res.ok) return json({ error: { code: "revision_conflict" }, revision: res.revision }, HTTP.CONFLICT);
    // Notifica a los demás dispositivos del MISMO usuario (FR-511).
    syncHub.publish(userId, { revision: res.revision });
    return json({ revision: res.revision });
  }
);

// Firmas exactas que `next build` espera para una ruta estática (un solo argumento).
export const GET = (req: Request): Promise<Response> => getHandler(req);
export const PUT = (req: Request): Promise<Response> => putHandler(req);
