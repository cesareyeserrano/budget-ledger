// @aitri-trace FR-ID: FR-501, US-ID: US-501, AC-ID: AC-501a, TC-ID: TC-BE-001h
/**
 * Module: app/api/auth/[...all]/route
 * Purpose: Monta la superficie de Better Auth en /api/auth/* (sign-up, sign-in, sign-out,
 *   get-session, callbacks OAuth). Delega en el handler de Better Auth (server-side).
 * Dependencies: better-auth/next-js, @/server/auth
 */
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

export const { GET, POST } = toNextJsHandler(auth);
