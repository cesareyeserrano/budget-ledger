// @aitri-trace FR-ID: FR-501, US-ID: US-501, AC-ID: AC-501a, TC-ID: TC-BE-001h
/**
 * Module: server/auth
 * Purpose: Configuración de Better Auth (ADR-03) — email+contraseña (hash argon2id, NFR-501) Y Google
 *   OAuth (conditional), sesiones en BD (ADR-04, logout invalida de verdad), cookies HttpOnly/Secure/
 *   SameSite (NFR-512), rate limiting del login contra fuerza bruta (NFR-512). Sin secretos en el
 *   código: todo desde env(). server-only: nunca al bundle del cliente.
 * Dependencies: better-auth, better-auth/adapters/drizzle, @node-rs/argon2, ./db/client, ./db/schema, ./env
 */
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { db } from "./db/client";
import { account, session, user, verification } from "./db/schema";
import { env } from "./env";

const e = env();

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

// El rate limit se puede desactivar SOLO en el harness e2e (todo el tráfico viene de 127.0.0.1, y el
// limitador por IP haría flaky los tests en serie). En producción queda SIEMPRE activo (NFR-512); el
// funcionamiento del rate limit se verifica en la suite de integración (TC-BE-081f).
const RATE_LIMIT_DISABLED = process.env.LEDGER_RATE_LIMIT_DISABLED === "true";

export const auth = betterAuth({
  baseURL: e.BETTER_AUTH_URL,
  secret: e.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    // Hash argon2id explícito (Better Auth usa scrypt por defecto; NFR-501 exige argon2/bcrypt).
    password: {
      hash: (password: string) => argon2Hash(password, ARGON2_OPTS),
      verify: ({ hash, password }: { hash: string; password: string }) =>
        argon2Verify(hash, password),
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
    // IP para el rate-limit por origen (NFR-512): confía en x-forwarded-for del reverse proxy.
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
  // Rate limit del login (NFR-512): global suave + regla estricta en /sign-in/email.
  rateLimit: {
    enabled: !RATE_LIMIT_DISABLED,
    window: LOGIN_WINDOW_SECONDS,
    max: 100,
    customRules: {
      "/sign-in/email": { window: LOGIN_WINDOW_SECONDS, max: LOGIN_MAX_ATTEMPTS },
      "/sign-up/email": { window: LOGIN_WINDOW_SECONDS, max: SIGNUP_MAX_ATTEMPTS },
    },
  },
  trustedOrigins: e.allowedOrigins,
});

export type Auth = typeof auth;
