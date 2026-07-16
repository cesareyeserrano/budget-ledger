// @aitri-trace FR-ID: FR-501, US-ID: US-501, AC-ID: AC-501a, TC-ID: TC-BE-001h
/**
 * Module: app/api/auth/[...all]/route
 * Purpose: Monta la superficie de Better Auth en /api/auth/* (sign-up, sign-in, sign-out,
 *   get-session, callbacks OAuth). Usa getAuth() (perezoso) para no exigir env en `next build`.
 * Dependencies: @/server/auth
 */
import { getAuth } from "@/server/auth";

export const GET = (req: Request): Promise<Response> => getAuth().handler(req);
export const POST = (req: Request): Promise<Response> => getAuth().handler(req);
