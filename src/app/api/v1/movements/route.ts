// @aitri-trace FR-ID: FR-507, US-ID: US-507, AC-ID: AC-507a, TC-ID: TC-BE-024h
/**
 * Module: app/api/v1/movements/route
 * Purpose: Colección de movimientos del usuario autenticado bajo contrato versionado /api/v1
 *   (FR-507). GET → lista SOLO del ownerId de la sesión (opcional ?month). POST → inserta ejecutando
 *   la mutación pura compartida del dominio; 201 { movement, revision } o 422 si el input es inválido.
 * Dependencies: @/server/http, @/server/data/ledgerRepo, @/server/schemas, @/domain
 */
import { HTTP, apiError, json, withApi } from "@/server/http";
import { getMovements, insertMovement } from "@/server/data/ledgerRepo";
import { movementInputSchema, type MovementInput } from "@/server/schemas";
import { syncHub } from "@/server/sync";
import type { MonthKey } from "@/domain";

const MONTHS = new Set(["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]);

const getHandler = withApi({ auth: "required" }, async ({ userId, req }) => {
  const monthParam = new URL(req.url).searchParams.get("month");
  const month = monthParam && MONTHS.has(monthParam) ? (monthParam as MonthKey) : undefined;
  // El ownerId sale de la sesión (userId); un ?ownerId= en el query se ignora por completo.
  const movements = await getMovements(userId, month);
  return json({ movements });
});

const postHandler = withApi<MovementInput>(
  { auth: "required", schema: movementInputSchema, mutation: true },
  async ({ userId, body }) => {
    const result = await insertMovement(userId, body);
    if (!result) return apiError("invalid_movement", "Movimiento inválido", HTTP.UNPROCESSABLE);
    syncHub.publish(userId, { revision: result.revision }); // notifica a los demás dispositivos (FR-511)
    return json({ movement: result.movement, revision: result.revision }, HTTP.CREATED);
  }
);

export const GET = (req: Request): Promise<Response> => getHandler(req);
export const POST = (req: Request): Promise<Response> => postHandler(req);
