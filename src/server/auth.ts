// @aitri-trace FR-ID: FR-501, US-ID: US-501, AC-ID: AC-501a, TC-ID: TC-BE-001h
/**
 * Module: server/auth
 * Purpose: Configuración de Better Auth (ADR-03) — email+contraseña (hash argon2id, NFR-501) Y Google
 *   OAuth (conditional), sesiones en BD (ADR-04, logout invalida de verdad), cookies HttpOnly/Secure/
 *   SameSite (NFR-512), rate limiting del login contra fuerza bruta (NFR-512). Sin secretos en el
 *   código: todo desde env(). server-only: nunca al bundle del cliente.
 * Dependencies: better-auth, better-auth/adapters/drizzle, @node-rs/argon2, ./db/client, ./db/schema,
 *   ./env, ./resetTokens, ./mail/mailer
 */
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { db } from "./db/client";
import { account, session, user, verification } from "./db/schema";
import { env } from "./env";
import { revokePrevious } from "./resetTokens";
import { sendResetLink } from "./mail/mailer";

// Algorithm.Argon2id = 2 (el enum de @node-rs/argon2 es const enum: incompatible con isolatedModules).
const ARGON2ID = 2;
// Parámetros OWASP para argon2id (NFR-501): m=19 MiB, t=2, p=1.
const ARGON2_OPTS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 días
const SESSION_UPDATE_SECONDS = 60 * 60 * 24; // renovación deslizante diaria
const LOGIN_WINDOW_SECONDS = 60;
const LOGIN_MAX_ATTEMPTS = 5; // NFR-512: tras 5 intentos, el 6º se limita (429)
const SIGNUP_MAX_ATTEMPTS = 10; // RQ-SEC-004: acota la creación masiva de cuentas por IP
// FR-1311/NFR-1303: mismo mecanismo y mismo valor que el login. NO es una defensa nueva (el
// no_go_zone excluye captcha, backoff y telemetría): es la regla que el producto ya usa, aplicada
// al endpoint nuevo para que no quede como el único sin límite.
const RESET_MAX_ATTEMPTS = 5;

// FR-1304: vigencia del secreto de recuperación. 30 minutos — decenas de minutos, no días.
// Debe coincidir con TTL_MINUTES de server/mail/templates (el correo lo anuncia al usuario).
export const RESET_TOKEN_TTL_SECONDS = 1_800;

/** Ruta de la pantalla de contraseña nueva (P-3 del UX spec). El correo apunta aquí. */
export const RESET_CALLBACK_PATH = "/recuperar";

// El rate limit se puede desactivar SOLO en el harness e2e (todo el tráfico viene de 127.0.0.1, y el
// limitador por IP haría flaky los tests en serie). En producción queda SIEMPRE activo (NFR-512); el
// funcionamiento del rate limit se verifica en la suite de integración (TC-BE-081f).
const RATE_LIMIT_DISABLED = process.env.LEDGER_RATE_LIMIT_DISABLED === "true";

// Inicialización PEREZOSA: env() se llama en el primer uso, NO al importar — así `next build` (que
// importa las rutas de auth para recolectar page data) no exige las envs en build (NFR-510).
function buildAuth() {
  const e = env();
  return betterAuth({
  baseURL: e.BETTER_AUTH_URL,
  secret: e.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    // Hash argon2id explícito (Better Auth usa scrypt por defecto; NFR-501 exige argon2/bcrypt).
    // El flujo de recuperación atraviesa ESTE mismo hasher: por eso NFR-1302 se cumple por
    // construcción, no por disciplina — no existe un segundo camino de hashing.
    password: {
      hash: (password: string) => argon2Hash(password, ARGON2_OPTS),
      verify: ({ hash, password }: { hash: string; password: string }) =>
        argon2Verify(hash, password),
    },
    // ── Recuperación de contraseña (feature recuperar-acceso) ──────────────────────────────
    // FR-1304: el secreto caduca a los 30 min (por defecto la librería da 1 h).
    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
    // FR-1309: al fijar la contraseña se borran TODAS las sesiones de la cuenta, para que un acceso
    // obtenido antes del cambio no sobreviva a la recuperación.
    revokeSessionsOnPasswordReset: true,
    /**
     * Gancho de entrega. Better Auth lo invoca DESPUÉS de insertar la fila del secreto, que es
     * justo lo que hace posible invalidar aquí la anterior (FR-1304, ADR-02).
     *
     * AVISO IMPORTANTE: si esta función lanza, la excepción NO llega al llamante — Better Auth la
     * captura y la descarta (runInBackgroundOrAwait, create-context.mjs:214), devolviendo 200 como
     * si todo hubiera ido bien. Por eso FR-1310 NO se apoya en este camino: la fachada
     * /api/v1/recovery/request sondea el transporte ANTES de delegar (TRF-01, ADR-04).
     */
    sendResetPassword: async ({
      user,
      url,
      token,
    }: {
      user: { id: string; email: string; name?: string };
      url: string;
      token: string;
    }) => {
      // Primero invalidar los anteriores: si el envío falla, no queremos dejar vivo un enlace viejo
      // además del nuevo. Un fallo aquí se registra y NO detiene el envío (dos enlaces vivos
      // degrada; quedarse sin ninguno bloquea).
      try {
        const revoked = await revokePrevious(user.id, token);
        if (revoked > 0) console.log(`[auth] recuperación: ${revoked} enlace(s) anterior(es) invalidado(s)`);
      } catch (err) {
        console.error(`[auth] no se pudo invalidar el enlace anterior: ${String(err)}`);
      }
      await sendResetLink(user.email, url, user.name);
    },
  },
  socialProviders: e.googleEnabled
    ? { google: { clientId: e.GOOGLE_CLIENT_ID!, clientSecret: e.GOOGLE_CLIENT_SECRET! } }
    : {},
  session: {
    expiresIn: SESSION_TTL_SECONDS,
    updateAge: SESSION_UPDATE_SECONDS,
  },
  advanced: {
    // Cookies de sesión endurecidas (NFR-512). Secure solo en producción (dev/test corre en http).
    defaultCookieAttributes: {
      httpOnly: true,
      secure: e.NODE_ENV === "production",
      sameSite: "lax",
    },
    // IP para el rate-limit por origen (NFR-512). BG-013: la confianza en x-forwarded-for es ahora
    // CONDICIONAL. Antes era incondicional, así que un despliegue sin reverse proxy —o con uno que
    // anexa en vez de reemplazar— dejaba que el cliente rotara el header y estrenara bucket en cada
    // intento: el límite de 5/60s existía y no limitaba nada. Sin `LEDGER_TRUST_PROXY=true` no se
    // declara ninguna cabecera y Better Auth cae a la IP de la conexión, que el cliente no elige.
    ...(e.trustProxy ? { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } } : {}),
  },
  // Rate limit del login (NFR-512): global suave + regla estricta en /sign-in/email.
  rateLimit: {
    enabled: !RATE_LIMIT_DISABLED,
    window: LOGIN_WINDOW_SECONDS,
    max: 100,
    customRules: {
      "/sign-in/email": { window: LOGIN_WINDOW_SECONDS, max: LOGIN_MAX_ATTEMPTS },
      "/sign-up/email": { window: LOGIN_WINDOW_SECONDS, max: SIGNUP_MAX_ATTEMPTS },
      "/request-password-reset": { window: LOGIN_WINDOW_SECONDS, max: RESET_MAX_ATTEMPTS },
    },
  },
  trustedOrigins: e.allowedOrigins,
  });
}

let _auth: ReturnType<typeof buildAuth> | undefined;

/** Instancia de Better Auth, construida una sola vez en el primer uso (runtime, no build). */
export function getAuth(): ReturnType<typeof buildAuth> {
  if (!_auth) _auth = buildAuth();
  return _auth;
}

export type Auth = ReturnType<typeof getAuth>;
