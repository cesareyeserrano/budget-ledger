/**
 * Module: app/api/v1/ledger/cycles/route
 * Purpose: PUT — aplica un cambio de periodo (feature ciclos, FR-2401/FR-2404/FR-2408/FR-2410).
 *   Sesión obligatoria, Zod, Origin (withApi). Rechazos de regla → 422 con el MISMO código que la
 *   previsualización; 409 si la revisión quedó atrás; tras 200 publica por SSE (FR-511).
 * Dependencies: @/server/http, @/server/data/cyclesRepo, @/server/schemas, @/server/sync, @/server/clock
 */
import { HTTP, json, withApi } from "@/server/http";
import { applyCyclesFor } from "@/server/data/cyclesRepo";
import { cyclesPutSchema, type CyclesPutBody } from "@/server/schemas";
import { syncHub } from "@/server/sync";
import { serverToday } from "@/server/clock";

/** @aitri-trace FR-ID: FR-2404, US-ID: US-2404, AC-ID: AC-2412, TC-ID: TC-CIC-037h, TC-CIC-039f, TC-CIC-127h */
const putHandler = withApi<CyclesPutBody>(
  { auth: "required", schema: cyclesPutSchema, mutation: true },
  async ({ userId, body, req }) => {
    const res = await applyCyclesFor(userId, body.baseRevision, body.target, serverToday(req));
    if (!res.ok && "conflict" in res) {
      return json({ error: { code: "revision_conflict" }, revision: res.revision }, HTTP.CONFLICT);
    }
    if (!res.ok) return json({ error: { code: res.blocked, detail: res.detail ?? {} } }, HTTP.UNPROCESSABLE);
    syncHub.publish(userId, { revision: res.value.revision });
    return json({ revision: res.value.revision, cycles: res.value.cycles, summary: res.value.summary });
  }
);
export const PUT = (req: Request): Promise<Response> => putHandler(req);
