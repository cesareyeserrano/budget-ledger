#!/usr/bin/env node
// @aitri-trace FR-ID: FR-512, US-ID: US-512, AC-ID: AC-512c, TC-ID: TC-BE-076f
/**
 * Module: scripts/check-env
 * Purpose: Gate de arranque (contenedor / CI). JS puro, sin runtime de TS, para poder correr como
 *   primer paso del entrypoint del contenedor y en el smoke. Si falta una variable requerida, aborta
 *   con exit 1 nombrando la variable (NFR-510) — nunca arranca con un default silencioso atado a un host.
 * Dependencies: ninguna (Node core)
 *
 * La lista REQUIRED debe coincidir con REQUIRED_ENV de src/server/env.ts (verificado por env.test.ts).
 */
const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"];

const missing = REQUIRED.filter((name) => {
  const v = process.env[name];
  return v === undefined || v === "";
});

if (missing.length > 0) {
  for (const name of missing) {
    console.error(`[boot] Falta la variable de entorno requerida: ${name}`);
  }
  process.exit(1);
}

// Google OAuth (FR-502): su ausencia NO aborta el arranque (portabilidad, NFR-510) — solo se avisa;
// el botón de Google se deshabilita y opera email+contraseña.
if (process.env.NODE_ENV === "production") {
  const googleMissing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((n) => !process.env[n]);
  if (googleMissing.length > 0) {
    console.warn(`[boot] Aviso: Google OAuth deshabilitado (faltan ${googleMissing.join(", ")}); solo email+contraseña.`);
  }
}

console.log("[boot] Variables de entorno requeridas presentes.");
