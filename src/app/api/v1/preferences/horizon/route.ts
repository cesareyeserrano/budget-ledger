// @aitri-trace FR-ID: FR-1907, US-ID: US-1907, AC-ID: AC-1919, TC-ID: TC-MAN-060h, TC-MAN-064f
/**
 * Module: app/api/v1/preferences/horizon/route
 * Purpose: El horizonte de planeación del usuario (12 o 24 meses). GET → { horizon }; PUT
 *   { horizon } → 200 { horizon }.
 *
 *   Vive en la CUENTA y no en el navegador (ADR-06, y decisión del usuario 2026-09-02: «sería una
 *   preferencia que se guarde en base de datos, no localStorage»), así que viaja entre
 *   dispositivos. NO forma parte del snapshot del ledger: cambiarlo no toca `ledger.revision`, que
 *   es lo que FR-1907 exige — una preferencia no puede hacer que el guardado de otro dispositivo
 *   choque por conflicto de revisión.
 * Dependencies: @/server/http, @/server/data/preferencesRepo, @/server/schemas
 */
import { json, withApi } from "@/server/http";
import { getHorizon, setHorizon } from "@/server/data/preferencesRepo";
import { horizonPutSchema, type HorizonPutBody } from "@/server/schemas";

const getHandler = withApi({ auth: "required" }, async ({ userId }) => {
  return json({ horizon: await getHorizon(userId) });
});

const putHandler = withApi<HorizonPutBody>(
  { auth: "required", schema: horizonPutSchema, mutation: true },
  async ({ userId, body }) => {
    // El esquema ya rechazó cualquier valor fuera de {12, 24} con 400 antes de llegar aquí.
    return json({ horizon: await setHorizon(userId, body.horizon) });
  }
);

export const GET = (req: Request): Promise<Response> => getHandler(req);
export const PUT = (req: Request): Promise<Response> => putHandler(req);
