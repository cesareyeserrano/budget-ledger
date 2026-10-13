/**
 * Module: server/agent/responses
 * Purpose: La traducción ÚNICA de los rechazos del repositorio del agente a su respuesta HTTP. Si
 *   cada ruta tradujera por su cuenta, dos operaciones acabarían contestando distinto a la misma
 *   situación. También exporta la lista completa de códigos, que es lo que documenta
 *   docs/agent-api.md (FR-3419).
 * Dependencies: ../http, ../data/agentRepo
 */
import "server-only";
import { HTTP, apiError } from "../http";
import type { AgentReadError } from "../data/agentRepo";

/** Todos los códigos de rechazo que la superficie del agente puede emitir. */
export const AGENT_ERROR_CODES = [
  "unauthorized", "not_found", "rate_limited", "payload_too_large", "invalid_payload", "invalid_target",
  "invalid_period", "invalid_date", "closed_period_violation", "domain_rule_violation", "reference_conflict",
  "unsupported_type", "negative_cell", "cell_movement_mismatch", "cell_already_changed", "internal_error",
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

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
