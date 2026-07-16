// @aitri-trace FR-ID: FR-503, US-ID: US-503, AC-ID: AC-503a, TC-ID: TC-BE-010h
/**
 * Module: server/session
 * Purpose: Resolución de la identidad del usuario a partir de la sesión (FR-503). Sin sesión válida,
 *   NO se asume ningún usuario (jamás un default como "local"). Es la única fuente del ownerId para
 *   la capa de datos — el ownerId nunca sale del payload (FR-505).
 * Dependencies: better-auth (auth.api.getSession), ./auth
 */
import "server-only";
import { auth } from "./auth";

export interface SessionUser {
  userId: string;
}

/**
 * Resuelve el usuario autenticado desde las cabeceras del request.
 * @param headers cabeceras del request (contienen la cookie de sesión)
 * @returns { userId } si la sesión es válida; null si no hay sesión / está expirada / manipulada
 */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const result = await auth.api.getSession({ headers });
  const id = result?.user?.id;
  if (!id) return null;
  return { userId: id };
}
