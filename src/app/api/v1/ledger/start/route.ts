// @aitri-trace FR-ID: FR-2207, US-ID: US-2207, AC-ID: AC-2219, TC-ID: TC-MSI-041f, TC-MSI-051f, TC-MSI-061f, TC-MSI-090f
/**
 * Module: app/api/v1/ledger/start/route
 * Purpose: Declara la APERTURA del historial del usuario autenticado — mes de inicio y saldo
 *   inicial — en una sola escritura (feature meses-y-saldo-inicial, FR-2201/FR-2202/FR-2207).
 *   Bajo el mismo lock optimista por `revision` que el resto del ledger (ADR-01): 200, 409 si la
 *   revisión está obsoleta, 422 si una regla de dominio lo impide. Aislado por el ownerId de la
 *   SESIÓN — un ownerId en el cuerpo se ignora.
 *
 *   POR QUÉ ES UN ENDPOINT PROPIO Y NO EL PUT DEL SNAPSHOT (ADR-02): las dos reglas que aplica
 *   —mes cerrado (FR-2205) y huérfanos (FR-2206)— son invariantes de dominio, y NFR-2205 exige que
 *   se evalúen en el servidor. BG-002 documenta lo que pasa cuando no: «PUT /api/v1/ledger acepta
 *   cualquier snapshot sin validar los invariantes del dominio: la regla vive SOLO en el navegador».
 * Dependencies: @/server/http, @/server/data/ledgerRepo, @/server/schemas, @/server/sync
 */
import { HTTP, json, withApi } from "@/server/http";
import { saveStartFor } from "@/server/data/ledgerRepo";
import { startPutSchema, type StartPutBody } from "@/server/schemas";
import { syncHub } from "@/server/sync";
import type { PeriodKey } from "@/domain/types";

/**
 * 422 con el motivo que dio el dominio. Nunca se inventa uno: se propaga el que decidió la regla.
 *
 * `would_orphan` lleva los periodos concretos porque el mensaje que FR-2206 exige tiene que nombrar
 * CUÁNTOS meses con datos quedarían fuera — un «no se puede» sin el daño concreto no es un mensaje
 * de error, es un muro.
 */
function rejected(reason: "month_closed" | "would_orphan", periods?: readonly PeriodKey[]): Response {
  const detail = reason === "would_orphan" ? { periods: periods ?? [] } : {};
  return json({ error: { code: reason, detail } }, HTTP.UNPROCESSABLE);
}

const putHandler = withApi<StartPutBody>(
  { auth: "required", schema: startPutSchema, mutation: true },
  async ({ userId, body }) => {
    const res = await saveStartFor(userId, body.baseRevision, body.startMonth, body.openingBalance);
    if (!res.ok && "conflict" in res) {
      return json({ error: { code: "revision_conflict" }, revision: res.revision }, HTTP.CONFLICT);
    }
    if (!res.ok) {
      return rejected(res.rejected, "periods" in res ? res.periods : undefined);
    }
    syncHub.publish(userId, { revision: res.revision }); // los demás dispositivos, al día (FR-511)
    return json({ revision: res.revision, startMonth: res.startMonth, openingBalance: res.openingBalance });
  }
);

// Firma exacta que `next build` espera para una ruta estática (un solo argumento).
export const PUT = (req: Request): Promise<Response> => putHandler(req);
