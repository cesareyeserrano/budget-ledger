/**
 * Module: app/api/v1/ledger/cycles/preview/route
 * Purpose: POST — previsualiza un cambio de periodo sin escribir (feature ciclos, FR-2403). Misma
 *   función pura que el apply (ADR-04): lo que se ve es lo que se hace. Un bloqueo responde 422 con
 *   el mismo código que el apply.
 * Dependencies: @/server/http, @/server/data/cyclesRepo, @/server/schemas, @/server/clock
 */
import { HTTP, json, withApi } from "@/server/http";
import { previewCyclesFor } from "@/server/data/cyclesRepo";
import { cyclesPreviewSchema, type CyclesPreviewBody } from "@/server/schemas";
import { serverToday } from "@/server/clock";

/** @aitri-trace FR-ID: FR-2403, US-ID: US-2403, AC-ID: AC-2409, TC-ID: TC-CIC-024h, TC-CIC-028f, TC-CIC-171f */
const postHandler = withApi<CyclesPreviewBody>(
  { auth: "required", schema: cyclesPreviewSchema, mutation: true },
  async ({ userId, body, req }) => {
    const res = await previewCyclesFor(userId, body.target, serverToday(req));
    if (!res.ok && "conflict" in res) {
      return json({ error: { code: "revision_conflict" }, revision: res.revision }, HTTP.CONFLICT);
    }
    if (!res.ok) return json({ error: { code: res.blocked, detail: res.detail ?? {} } }, HTTP.UNPROCESSABLE);
    return json({ cycles: res.value.cycles, relocation: res.value.relocation });
  }
);
export const POST = (req: Request): Promise<Response> => postHandler(req);
