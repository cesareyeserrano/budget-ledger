// @aitri-trace FR-ID: FR-505, US-ID: US-505, AC-ID: AC-505b, TC-ID: TC-BE-018f
/**
 * Module: app/api/v1/movements/[id]/route
 * Purpose: Un movimiento por id, SOLO del usuario autenticado (FR-505). GET → 200 { movement }; 404
 *   indistinguible si es de otro o no existe (AC-505b). Desde la feature diario-de-celda el journal
 *   deja de ser inmutable: PATCH edita monto, nota, fecha y categoría (FR-2505) y DELETE borra
 *   (FR-2506). Las dos rechazan lo MISMO que el PUT del ledger y en el mismo orden (ADR-02).
 * Dependencies: @/server/http, @/server/data/ledgerRepo, @/server/schemas, @/server/sync
 */
import { HTTP, apiError, json, withApi } from "@/server/http";
import { getMovement, removeMovement, updateMovement, type MovementWriteResult } from "@/server/data/ledgerRepo";
import { movementPatchSchema, type MovementPatchInput } from "@/server/schemas";
import { syncHub } from "@/server/sync";

const getHandler = withApi({ auth: "required" }, async ({ userId, params }) => {
  const mv = await getMovement(userId, params.id);
  if (!mv) return apiError("not_found", "No encontrado", HTTP.NOT_FOUND);
  return json({ movement: mv });
});

/**
 * Traduce el rechazo del repositorio a la respuesta del contrato. Una sola función para las dos
 * rutas: si PATCH y DELETE tradujeran por separado acabarían divergiendo, y TC-DDC-326e exige justo
 * lo contrario — que las dos puertas contesten igual a la misma situación.
 *
 * Recibe SOLO el rechazo (nunca el éxito): así el llamador estrecha con `if (!res.ok)` y no queda
 * una rama imposible que el verificador de tipos exija y nadie pueda ejecutar.
 *
 * @returns La respuesta de error del contrato.
 */
function errorDe(res: Exclude<MovementWriteResult, { ok: true }>): Response {
  // 404 indistinguible: ni existe, ni es suyo. No se filtra cuál de las dos (NFR-2501, AC-505b).
  if ("notFound" in res) return apiError("not_found", "No encontrado", HTTP.NOT_FOUND);
  if ("closedViolation" in res) {
    return json({ error: { code: "closed_period_violation", detail: { periods: res.periods } } }, HTTP.UNPROCESSABLE);
  }
  if ("negativeCell" in res) {
    return json({ error: { code: "negative_cell", detail: { cells: res.cells } } }, HTTP.UNPROCESSABLE);
  }
  if ("cellMismatch" in res) {
    return json({ error: { code: "cell_movement_mismatch", detail: res.cells } }, HTTP.UNPROCESSABLE);
  }
  if ("domainViolation" in res) {
    return json({ error: { code: "domain_rule_violation", detail: { violations: res.violations } } }, HTTP.UNPROCESSABLE);
  }
  // Un bolsillo no se edita por aquí: sus operaciones De→A tienen techo y piso propios (NFR-2503).
  if (res.rejected === "unsupported_type") {
    return apiError("unsupported_type", "Un bolsillo no se edita desde aquí", HTTP.UNPROCESSABLE);
  }
  if (res.rejected === "invalid_target") {
    return apiError("invalid_target", "Categoría destino inválida", HTTP.UNPROCESSABLE);
  }
  if (res.rejected === "period_mismatch") {
    return json({ error: { code: "period_mismatch", detail: { ids: [] } } }, HTTP.UNPROCESSABLE);
  }
  // El monto no respeta el `kind` GUARDADO (manual <1, ajuste = 0). El borde no podía saberlo —el
  // kind no viaja en el cuerpo—, así que el 422 se emite aquí y NUNCA llega al CHECK de la base:
  // un payload malo es un 422, jamás un 500 (TC-DDC-312f).
  return apiError("invalid_payload", "Monto inválido para este movimiento", HTTP.UNPROCESSABLE);
}

const patchHandler = withApi<MovementPatchInput>(
  { auth: "required", mutation: true, schema: movementPatchSchema },
  async ({ userId, params, body }) => {
    const res = await updateMovement(userId, params.id, body);
    if (!res.ok) return errorDe(res);
    syncHub.publish(userId, { revision: res.revision }); // los demás dispositivos se enteran (FR-511)
    return json({ movement: res.movement, revision: res.revision });
  }
);

const deleteHandler = withApi(
  { auth: "required", mutation: true },
  async ({ userId, params }) => {
    const res = await removeMovement(userId, params.id);
    if (!res.ok) return errorDe(res);
    syncHub.publish(userId, { revision: res.revision });
    return json({ revision: res.revision });
  }
);

// Ruta dinámica: Next 15 pasa { params: Promise<{ id: string }> } como segundo argumento.
type Ctx = { params: Promise<{ id: string }> };
export const GET = (req: Request, ctx: Ctx): Promise<Response> => getHandler(req, ctx);
export const PATCH = (req: Request, ctx: Ctx): Promise<Response> => patchHandler(req, ctx);
export const DELETE = (req: Request, ctx: Ctx): Promise<Response> => deleteHandler(req, ctx);
