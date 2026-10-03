#!/usr/bin/env node
// @aitri-trace FR-ID: FR-512, US-ID: US-512, AC-ID: AC-512c, TC-ID: TC-BE-076f
/**
 * Module: scripts/check-env
 * Purpose: Comprobación del entorno. JS puro, sin runtime de TS, para poder correr dentro de la
 *   imagen. Si falta una variable requerida, aborta con exit 1 nombrando la variable (NFR-510) —
 *   nunca se arranca con un default silencioso atado a un host.
 *
 *   QUIÉN LO EJECUTA: el smoke del backend (scripts/smoke-backend.sh, antes de migrar) y las pruebas
 *   (tests/integration/backend/config.test.ts). La imagen NO lo corre al arrancar: no tiene
 *   entrypoint y su CMD es `node server.js`. Quien arranca de verdad sin una variable es detenido por
 *   src/server/env.ts en la primera petición. Para comprobarlo a mano antes de un despliegue:
 *   `docker compose run --rm app node scripts/check-env.mjs`.
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

// SMTP (FR-1311): mismo criterio que Google — su ausencia NO aborta el arranque (NFR-510), solo se
// avisa, y el flujo de recuperación queda no disponible. Se avisa en TODOS los entornos, no solo en
// producción: un dev que no entiende por qué no llega el correo merece verlo en el arranque.
const SMTP_VARS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"];
const smtpPresent = SMTP_VARS.filter((n) => process.env[n]);
if (smtpPresent.length === 0) {
  console.warn("[boot] Aviso: recuperación de contraseña deshabilitada (sin configuración SMTP).");
} else if (smtpPresent.length < SMTP_VARS.length) {
  const faltan = SMTP_VARS.filter((n) => !process.env[n]);
  console.warn(
    `[boot] Aviso: configuración SMTP INCOMPLETA (faltan ${faltan.join(", ")}); la recuperación de contraseña queda deshabilitada.`
  );
}

console.log("[boot] Variables de entorno requeridas presentes.");
