// @aitri-trace FR-ID: FR-503, US-ID: US-503, AC-ID: AC-503a, TC-ID: TC-BE-010h
/**
 * Module: lib/authClient
 * Purpose: Cliente de Better Auth para el navegador (useSession, signIn, signUp, signOut). Same-origin
 *   por defecto (no baseURL). Solo se usa en modo servidor (SERVER_MODE); en modo localStorage la app
 *   nunca lo invoca.
 * Dependencies: better-auth/react
 */
"use client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
export const { useSession, signIn, signUp, signOut } = authClient;
