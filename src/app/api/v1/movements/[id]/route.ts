// @aitri-trace FR-ID: FR-505, US-ID: US-505, AC-ID: AC-505b, TC-ID: TC-BE-018f
/**
 * Module: app/api/v1/movements/[id]/route
 * Purpose: Movimiento por id, SOLO del usuario autenticado (FR-505). GET → 200 { movement } si es del
 *   usuario, 404 indistinguible si es de otro o no existe (sin filtrar existencia, AC-505b). En v1 los
 *   movimientos son un journal inmutable: PATCH/DELETE → 404 (no se inventa dominio; propio o ajeno,
 *   nada se altera, AC-505c).
 * Dependencies: @/server/http, @/server/data/ledgerRepo
 */
import { HTTP, apiError, json, withApi } from "@/server/http";
import { getMovement } from "@/server/data/ledgerRepo";

const getHandler = withApi({ auth: "required" }, async ({ userId, params }) => {
  const mv = await getMovement(userId, params.id);
  if (!mv) return apiError("not_found", "No encontrado", HTTP.NOT_FOUND);
  return json({ movement: mv });
});

// En v1 el producto no tiene editar/borrar movimiento. 404 propio o ajeno: nada se altera (AC-505c).
const unsupported = withApi({ auth: "required", mutation: true }, async () =>
  apiError("unsupported_operation", "Operación no soportada en v1", HTTP.NOT_FOUND)
);

// Ruta dinámica: Next 15 pasa { params: Promise<{ id: string }> } como segundo argumento.
type Ctx = { params: Promise<{ id: string }> };
export const GET = (req: Request, ctx: Ctx): Promise<Response> => getHandler(req, ctx);
export const PATCH = (req: Request, ctx: Ctx): Promise<Response> => unsupported(req, ctx);
export const DELETE = (req: Request, ctx: Ctx): Promise<Response> => unsupported(req, ctx);
