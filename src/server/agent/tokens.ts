/**
 * Module: server/agent/tokens
 * Purpose: El token de un agente (FR-3401, FR-3402, FR-3403, ADR-02). Un secreto opaco de 256 bits
 *   que se muestra una vez y del que el servidor solo guarda su hash SHA-256. Aquí vive su formato,
 *   su análisis desde la cabecera `Authorization` y su resolución contra la base: de «anónimo» a
 *   «esta cuenta». No hay caché: la revocación vale en la siguiente petición.
 * Dependencies: node:crypto, drizzle-orm, ../db/client, ../db/schema, ./limits
 */
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { agentToken } from "../db/schema";
import { AGENT_LAST_USED_EVERY_SECONDS } from "./limits";

/** Prefijo fijo que identifica un token de agente de T-Ledger. */
export const TOKEN_PREFIX = "tla_";
/** Bytes al azar del secreto: 32 bytes = 256 bits (43 caracteres en base64url). */
export const TOKEN_BYTES = 32;
/** Formato exacto de un token. Lo comparte el escáner de secretos (scripts/secret-scan.sh). */
export const TOKEN_PATTERN = /^tla_[A-Za-z0-9_-]{43}$/;
/** Prefijo del identificador público de un token (el que se lista, se registra y se revoca). */
export const TOKEN_ID_PREFIX = "agt_";

const BEARER = "Bearer ";

/** A quién representa un token ya resuelto. */
export interface ResolvedToken {
  tokenId: string;
  ownerId: string;
  name: string;
}

/**
 * Genera un token nuevo.
 * @returns el token en claro — el llamador lo muestra UNA vez y guarda solo `hashToken(token)`
 * @aitri-trace FR-ID: FR-3401, US-ID: US-3401, AC-ID: AC-3401a, TC-ID: TC-AGT-014h
 */
export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Hash con el que se guarda y se busca un token. SHA-256 sin sal: el secreto ya tiene 256 bits de
 * entropía, así que no hay diccionario que recorrer.
 * @param token el token en claro
 * @returns hex de 64 caracteres
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Extrae el token de la cabecera `Authorization`. Solo acepta el formato EXACTO `Bearer tla_…`:
 * cualquier otra cosa —otro esquema, espacios de más, longitud distinta— es «sin token».
 * @param header valor de la cabecera, o null si no vino
 * @returns el token, o null
 * @aitri-trace FR-ID: FR-3401, US-ID: US-3401, AC-ID: AC-3401c, TC-ID: TC-AGT-015f
 */
export function parseToken(header: string | null | undefined): string | null {
  if (!header || !header.startsWith(BEARER)) return null;
  const token = header.slice(BEARER.length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

/**
 * Resuelve un token contra la base: existe y no está revocado → la cuenta que lo creó.
 *
 * Se busca por el hash (índice único) y se compara otra vez con `timingSafeEqual`, de modo que el
 * veredicto no dependa de cuántos caracteres coincidan. `last_used_at` se reescribe como mucho una
 * vez por minuto: saber si el agente está vivo no justifica una escritura por petición.
 *
 * @param token el token en claro, ya con formato válido
 * @returns la identidad del token, o null si no existe o está revocado
 * @throws si la base no responde (el envoltorio lo traduce a 500, nunca a acceso)
 * @aitri-trace FR-ID: FR-3403, US-ID: US-3403, AC-ID: AC-3403a, TC-ID: TC-AGT-030h, TC-AGT-031f, TC-AGT-025f, TC-AGT-024e
 */
export async function resolveToken(token: string): Promise<ResolvedToken | null> {
  const hash = hashToken(token);
  const [row] = await db
    .select({ id: agentToken.id, ownerId: agentToken.ownerId, name: agentToken.name, tokenHash: agentToken.tokenHash })
    .from(agentToken)
    .where(and(eq(agentToken.tokenHash, hash), isNull(agentToken.revokedAt)));
  if (!row) return null;
  if (!timingSafeEqual(Buffer.from(row.tokenHash, "hex"), Buffer.from(hash, "hex"))) return null;

  await db
    .update(agentToken)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(agentToken.id, row.id),
        sql`(${agentToken.lastUsedAt} IS NULL OR ${agentToken.lastUsedAt} < now() - make_interval(secs => ${AGENT_LAST_USED_EVERY_SECONDS}))`
      )
    );
  return { tokenId: row.id, ownerId: row.ownerId, name: row.name };
}
