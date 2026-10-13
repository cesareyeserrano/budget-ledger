/**
 * Module: server/agent/responses
 * Purpose: La traducción ÚNICA de los rechazos del repositorio del agente a su respuesta HTTP. Si
 *   cada ruta tradujera por su cuenta, dos operaciones acabarían contestando distinto a la misma
 *   situación. La lista completa de códigos vive en ./codes (la documenta docs/agent-api.md).
 * Dependencies: ../http, ../data/agentRepo, ./codes
 */
import "server-only";
import { HTTP, apiError, json } from "../http";
import type { AgentInsertEarly, AgentReadError } from "../data/agentRepo";
import { toAgentMovement } from "../data/agentRepo";
import type { InsertMovementResult, MovementWriteResult } from "../data/ledgerRepo";
import type { LedgerNode } from "@/domain";

export { AGENT_ERROR_CODES, type AgentErrorCode } from "./codes";

/**
 * Respuesta de una lectura que no se pudo atender.
 * @param error el motivo que devolvió el repositorio
 * @returns la respuesta de error del contrato
 */
export function readError(error: AgentReadError): Response {
  if (error === "invalid_period") return apiError("invalid_period", "Periodo inválido: se espera YYYY-MM", HTTP.BAD_REQUEST);
  if (error === "invalid_date") return apiError("invalid_date", "Fecha inválida: se espera YYYY-MM-DD", HTTP.BAD_REQUEST);
  // Sin libro, o el nodo / la referencia no existen en ESTA cuenta: el mismo 404, sin decir cuál.
  return apiError("not_found", "No encontrado", HTTP.NOT_FOUND);
}

const invalidTarget = (): Response => apiError("invalid_target", "Destino inválido", HTTP.UNPROCESSABLE);
const notFound = (): Response => apiError("not_found", "No encontrado", HTTP.NOT_FOUND);

/**
 * Respuesta de un registro que NO se escribió. El éxito lo arma la ruta (necesita publicar la
 * revisión); aquí solo llegan los rechazos y las salidas tempranas.
 * @param result lo que devolvió el repositorio, sin la rama de éxito
 * @param nodes nodos de la cuenta, para nombrar la hoja del movimiento existente
 * @returns la respuesta del contrato
 * @aitri-trace FR-ID: FR-3408, US-ID: US-3408, AC-ID: AC-3408b, TC-ID: TC-AGT-083f, TC-AGT-084f, TC-AGT-092f, TC-AGT-103f
 */
export function insertRejection(
  result: Exclude<InsertMovementResult, { movement: unknown }> | { early: AgentInsertEarly },
  nodes: LedgerNode[]
): Response {
  if (result === null) return apiError("invalid_payload", "Movimiento inválido", HTTP.UNPROCESSABLE);
  if ("early" in result) {
    const e = result.early;
    if (e.kind === "existing") return json({ movement: toAgentMovement(e.movement, nodes), revision: e.revision });
    if (e.kind === "conflict") {
      return json(
        { error: { code: "reference_conflict", message: "Esa referencia ya registró otro movimiento", detail: { movement: toAgentMovement(e.movement, nodes) } } },
        HTTP.CONFLICT
      );
    }
    return e.kind === "invalid_date" ? readError("invalid_date") : invalidTarget();
  }
  if ("noLedger" in result) return notFound();
  if ("invalidTarget" in result) return invalidTarget();
  if ("closedViolation" in result) return apiError("closed_period_violation", "El periodo está cerrado", HTTP.UNPROCESSABLE);
  // El periodo lo deriva el servidor: si aun así no cuadra, la fecha no tiene periodo válido.
  if ("periodMismatch" in result) return readError("invalid_date");
  return json({ error: { code: "domain_rule_violation", detail: { violations: result.violations } } }, HTTP.UNPROCESSABLE);
}

/**
 * Respuesta de una corrección o de un deshacer que NO se aplicó. Una sola función para las dos
 * rutas: las dos contestan igual a la misma situación.
 * @param res el rechazo del repositorio
 * @returns la respuesta del contrato
 * @aitri-trace FR-ID: FR-3411, US-ID: US-3411, AC-ID: AC-3411b, TC-ID: TC-AGT-112f, TC-AGT-113f, TC-AGT-115f, TC-AGT-127f
 */
export function writeRejection(res: Exclude<MovementWriteResult, { ok: true }>): Response {
  if ("notFound" in res) return notFound();
  if ("closedViolation" in res) {
    return json({ error: { code: "closed_period_violation", detail: { periods: res.periods } } }, HTTP.UNPROCESSABLE);
  }
  if ("negativeCell" in res) return json({ error: { code: "negative_cell", detail: { cells: res.cells } } }, HTTP.UNPROCESSABLE);
  if ("cellMismatch" in res) return json({ error: { code: "cell_movement_mismatch", detail: res.cells } }, HTTP.UNPROCESSABLE);
  if ("domainViolation" in res) {
    return json({ error: { code: "domain_rule_violation", detail: { violations: res.violations } } }, HTTP.UNPROCESSABLE);
  }
  if (res.rejected === "unsupported_type") {
    return apiError("unsupported_type", "Una operación de bolsillo no se corrige: se deshace y se registra de nuevo", HTTP.UNPROCESSABLE);
  }
  if (res.rejected === "cell_already_changed") {
    return apiError("cell_already_changed", "La celda del aporte ya se cambió en la app", HTTP.UNPROCESSABLE);
  }
  if (res.rejected === "invalid_target") return invalidTarget();
  if (res.rejected === "period_mismatch") return readError("invalid_date");
  return apiError("invalid_payload", "Monto inválido para este movimiento", HTTP.UNPROCESSABLE);
}
