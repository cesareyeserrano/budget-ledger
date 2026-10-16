/**
 * Module: server/agent/codes
 * Purpose: La lista completa de códigos de rechazo que la puerta para agentes puede emitir. Vive
 *   sola, sin dependencias, porque es lo que el contrato documenta (docs/agent-api.md, FR-3419) y
 *   una prueba comprueba que el documento los nombra todos.
 * Dependencies: ninguna
 */

/** Todos los códigos de rechazo de /api/agent/v1. */
export const AGENT_ERROR_CODES = [
  "unauthorized", "not_found", "rate_limited", "payload_too_large", "invalid_payload", "invalid_target",
  "invalid_period", "invalid_date", "closed_period_violation", "domain_rule_violation", "reference_conflict",
  "unsupported_type", "negative_cell", "cell_movement_mismatch", "cell_already_changed", "internal_error",
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];
