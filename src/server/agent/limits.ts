/**
 * Module: server/agent/limits
 * Purpose: Las cotas de la superficie para agentes en un solo sitio (FR-3406, NFR-3411): cuántas
 *   peticiones admite un token por ventana, cuántos intentos con token inválido se toleran y cuánto
 *   puede pesar un cuerpo. Sin números sueltos en el envoltorio.
 * Dependencies: ninguna
 */

/** Ventana deslizante de los tres cubos, en segundos. */
export const AGENT_WINDOW_SECONDS = 60;
/** Escrituras (POST/PATCH/DELETE) por token y ventana. */
export const AGENT_WRITES_PER_WINDOW = 30;
/** Lecturas (GET) por token y ventana. */
export const AGENT_READS_PER_WINDOW = 120;
/** Intentos con token inválido por origen y ventana (anti fuerza bruta). */
export const AGENT_BAD_TOKENS_PER_WINDOW = 20;
/** Bytes de cuerpo que la superficie acepta leer; por encima → 413. */
export const AGENT_MAX_BODY_BYTES = 16 * 1024;
/** Cada cuánto se reescribe como mucho `last_used_at` de un token, en segundos (FR-3402). */
export const AGENT_LAST_USED_EVERY_SECONDS = 60;
/** Origen del cubo de tokens inválidos cuando no hay una IP fiable (sin proxy de confianza). */
export const AGENT_BAD_BUCKET_GLOBAL = "global";

/** Clave del cubo de escrituras de un token. */
export function writeBucket(tokenId: string): string {
  return `agent:w:${tokenId}`;
}
/** Clave del cubo de lecturas de un token. */
export function readBucket(tokenId: string): string {
  return `agent:r:${tokenId}`;
}
/** Clave del cubo de intentos con token inválido de un origen. */
export function badBucket(origin: string): string {
  return `agent:bad:${origin}`;
}
