// @aitri-trace FR-ID: FR-2005, US-ID: US-2005, AC-ID: AC-2018, TC-ID: TC-CDM-055h
// @aitri-trace FR-ID: FR-2011, US-ID: US-2011, AC-ID: AC-2035, TC-ID: TC-CDM-110h, TC-CDM-113f
/**
 * Module: app/api/v1/closure/events/route
 * Purpose: El RASTRO de cierres y reaperturas del usuario autenticado (FR-2005). Solo lectura.
 *   Es auditoría, no fuente de verdad: lo que el sistema PERMITE lo decide `ledger.reopened_period`,
 *   no este historial — así que se puede leer o purgar sin alterar el comportamiento (ADR-13).
 *   Desde FR-2011 es además lo que alimenta el historial que el usuario consulta en pantalla.
 * Dependencies: @/server/http, @/server/data/ledgerRepo
 */
import { json, withApi } from "@/server/http";
import { getClosureEvents } from "@/server/data/ledgerRepo";

const getHandler = withApi({ auth: "required" }, async ({ userId }) => {
  // `truncated` viaja tal cual: el panel pinta una nota al pie en vez de fingir que ahí acaba la
  // historia (FR-2011, TC-CDM-116e).
  return json(await getClosureEvents(userId));
});

export const GET = (req: Request): Promise<Response> => getHandler(req);
