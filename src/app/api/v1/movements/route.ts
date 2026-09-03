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
import type { PeriodKey } from "@/domain";
import { PERIOD_KEY } from "@/domain/validation";

// NFR-1908 — el periodo se valida en el SERVIDOR. Antes bastaba con pertenecer a un conjunto de
// doce; ahora el dominio de valores es abierto, así que la comprobación se delega al MISMO esquema
// que valida el cuerpo del POST: una sola definición del formato, no dos que puedan divergir.
function parsePeriodParam(raw: string | null): PeriodKey | undefined {
  if (raw === null) return undefined;
  const res = PERIOD_KEY.safeParse(raw);
  return res.success ? (res.data as PeriodKey) : undefined;
}

const getHandler = withApi({ auth: "required" }, async ({ userId, req }) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get("period") ?? url.searchParams.get("month");
  if (raw !== null && parsePeriodParam(raw) === undefined) {
    return apiError("invalid_period", "Periodo inválido: se espera YYYY-MM", HTTP.BAD_REQUEST);
  }
  const month = parsePeriodParam(raw);
  // El ownerId sale de la sesión (userId); un ?ownerId= en el query se ignora por completo.
  const movements = await getMovements(userId, month);
  return json({ movements });
});

const postHandler = withApi<MovementInput>(
  { auth: "required", schema: movementInputSchema, mutation: true },
  async ({ userId, body }) => {
    const result = await insertMovement(userId, body);
    if (!result) return apiError("invalid_movement", "Movimiento inválido", HTTP.UNPROCESSABLE);
    // Feature cierre-de-mes (FR-2003): el mes destino está cerrado. Segunda vía de escritura, y
    // por eso se comprueba aquí además de en saveLedger — insertMovement no pasa por él.
    if ("closedViolation" in result) {
      return apiError("closed_period_violation", "El mes está cerrado", HTTP.UNPROCESSABLE);
    }
    syncHub.publish(userId, { revision: result.revision }); // notifica a los demás dispositivos (FR-511)
    return json({ movement: result.movement, revision: result.revision }, HTTP.CREATED);
  }
);

export const GET = (req: Request): Promise<Response> => getHandler(req);
export const POST = (req: Request): Promise<Response> => postHandler(req);
