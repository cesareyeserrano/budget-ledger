// @aitri-trace FR-ID: FR-512, US-ID: US-512, AC-ID: AC-512c, TC-ID: TC-BE-042f
/**
 * Module: server/env
 * Purpose: Configuración por entorno (12-factor) con validación fail-fast. Ninguna ruta ni valor de
 *   host se hardcodea: todo sale de process.env y se valida al arrancar. Un valor requerido faltante
 *   ABORTA el boot nombrando la variable (NFR-510), nunca cae a un default silencioso atado a un host.
 * Dependencies: zod
 *
 * Nota: la lista de variables REQUERIDAS aquí debe mantenerse en sincronía con `scripts/check-env.mjs`
 *   (el gate de arranque del contenedor/CI, JS puro sin runtime de TS). El test estructural
 *   `env.test.ts` afirma que ambas listas coinciden.
 */
import { z } from "zod";

/** Nombres de las variables SIEMPRE requeridas (en cualquier entorno). */
export const REQUIRED_ENV = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const;

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL es requerida"),
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET es requerida"),
  BETTER_AUTH_URL: z.string().url("BETTER_AUTH_URL debe ser una URL válida"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Opcionales: Google OAuth. En producción se exigen (FR-502 es MUST); en dev/test el botón se
  // deshabilita si faltan. La regla condicional se aplica en superRefine.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Orígenes permitidos para CORS (NFR-512). Coma-separado. Por defecto solo el propio origen.
  LEDGER_ALLOWED_ORIGINS: z.string().optional(),
});

export type Env = z.infer<typeof baseSchema> & { allowedOrigins: string[]; googleEnabled: boolean };

/**
 * Valida y normaliza el entorno.
 * @param source objeto de variables de entorno (por defecto process.env)
 * @returns el entorno validado y normalizado
 * @throws Error con el nombre de la(s) variable(s) faltante(s)/ inválida(s) si la validación falla
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = baseSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Configuración de entorno inválida — ${detail}`);
  }
  const env = parsed.data;
  // Google OAuth (FR-502): habilitado solo si AMBAS credenciales están presentes. Su ausencia NO
  // aborta el arranque ni el build — el artefacto debe ser portable (NFR-510: build env-agnóstico,
  // deploy once/run anywhere). Sin credenciales, el botón de Google se deshabilita (AuthForm) y solo
  // opera email+contraseña; proveerlas es una decisión de despliegue, verificada operacionalmente.
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const allowedOrigins = env.LEDGER_ALLOWED_ORIGINS
    ? env.LEDGER_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : [new URL(env.BETTER_AUTH_URL).origin];
  return { ...env, allowedOrigins, googleEnabled };
}

let cached: Env | null = null;

/** Entorno validado y memorizado. La primera llamada valida; un fallo aborta explícitamente. */
export function env(): Env {
  if (!cached) cached = parseEnv();
  return cached;
}
