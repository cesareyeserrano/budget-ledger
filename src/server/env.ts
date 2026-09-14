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
  // SMTP para el envío del enlace de recuperación (feature recuperar-acceso, FR-1311). TODAS
  // opcionales a propósito: su ausencia NO aborta el arranque, igual que Google (NFR-510, artefacto
  // portable). Sin ellas la app opera con normalidad y solo el flujo de recuperación se declara no
  // disponible (503). Ninguna lleva prefijo NEXT_PUBLIC_: son credenciales de servidor.
  SMTP_HOST: z.string().optional(),
  // Se valida como numérico SI está presente: un puerto no numérico aborta el arranque nombrando la
  // variable, en vez de caer a un default silencioso (FR-1311, TC-REC-050f).
  SMTP_PORT: z
    .string()
    .regex(/^\d+$/, "SMTP_PORT debe ser un número de puerto")
    .refine((v) => Number(v) >= 1 && Number(v) <= 65535, "SMTP_PORT debe estar entre 1 y 65535")
    .optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // ¿Hay delante un reverse proxy que SANEA X-Forwarded-For? (BG-013 / RQ-SEC-003.) Solo si se
  // declara "true" se llavea el rate-limit por ese header. Por defecto NO se confía: un cliente
  // puede enviar el header que quiera, y rotarlo daba un bucket nuevo por intento — el límite de
  // 5/60s en /sign-in/email quedaba eludido sin dejar rastro. DEPLOYMENT.md documenta el nginx
  // correcto (`proxy_set_header X-Forwarded-For $remote_addr`), pero un documento no es una
  // protección: quien despliegue sin proxy, o con `$proxy_add_x_forwarded_for`, tenía el
  // anti-fuerza-bruta apagado y nada se lo decía. Ahora hay que afirmarlo explícitamente.
  LEDGER_TRUST_PROXY: z.string().optional(),
  // Feature ciclos (FLAG-2): zona horaria en la que el servidor decide «hoy» (IANA).
  LEDGER_TZ: z.string().optional(),
  // SOLO PRUEBAS (ignoradas en production): fijar «hoy» y forzar un fallo a mitad de transacción.
  LEDGER_TEST_OVERRIDES: z.string().optional(),
  LEDGER_TODAY: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  LEDGER_NOW: z.string().optional(),
  LEDGER_TEST_FAIL_AFTER: z.enum(["first_insert"]).optional(),
});

export type Env = z.infer<typeof baseSchema> & {
  allowedOrigins: string[];
  /** Feature ciclos: zona horaria del «hoy» del servidor. Por defecto America/Bogota. */
  tz: string;
  googleEnabled: boolean;
  /** true solo si LEDGER_TRUST_PROXY === "true". Cualquier otro valor (o su ausencia) es false. */
  trustProxy: boolean;
  /**
   * true solo si las CINCO variables SMTP están presentes. Misma regla que googleEnabled: una
   * configuración a medias no habilita nada — enviar con host pero sin remitente falla en el peor
   * momento (cuando alguien ya está bloqueado fuera), así que se decide al arrancar.
   */
  smtpEnabled: boolean;
};

/**
 * Valida y normaliza el entorno.
 * @param source objeto de variables de entorno (por defecto process.env)
 * @returns el entorno validado y normalizado
 * @throws Error con el nombre de la(s) variable(s) faltante(s)/ inválida(s) si la validación falla
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  // BG-038: una variable definida pero VACÍA cuenta como ausente, el mismo criterio que ya aplica
  // scripts/check-env.mjs. docker-compose.yml pasa las opcionales como `${VAR:-}`, así que sin correo
  // configurado SMTP_PORT llegaba como "" y su regex la rechazaba: la app respondía 500 en todas las
  // rutas, /health incluido. Una requerida vacía sigue abortando, nombrando la variable.
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const parsed = baseSchema.safeParse(present);
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
  // Comparación estricta contra "true": un valor tipo "1", "yes" o "TRUE" NO habilita la confianza.
  // Confiar en el header por un typo de configuración es exactamente el fallo que esto evita, y
  // fallar hacia el lado seguro (rate-limit por IP de conexión) nunca deja a nadie desprotegido.
  const trustProxy = env.LEDGER_TRUST_PROXY === "true";
  // FR-1311: las cinco o ninguna. Parcial cuenta como no configurado, y el flujo se declara no
  // disponible en vez de fallar a mitad de un envío.
  const smtpEnabled = Boolean(
    env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM
  );
  return { ...env,
    tz: env.LEDGER_TZ || "America/Bogota", allowedOrigins, googleEnabled, trustProxy, smtpEnabled };
}

let cached: Env | null = null;

/** Entorno validado y memorizado. La primera llamada valida; un fallo aborta explícitamente. */
export function env(): Env {
  if (!cached) cached = parseEnv();
  return cached;
}

/**
 * Descarta el entorno memorizado. SOLO para tests que necesitan ejercer dos configuraciones
 * distintas en el mismo proceso (p. ej. con y sin SMTP, FR-1311). En producción nunca se llama:
 * el entorno de un proceso no cambia mientras vive.
 */
export function __resetEnvForTests(): void {
  cached = null;
}
