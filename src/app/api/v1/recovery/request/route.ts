// @aitri-trace FR-ID: FR-1310, US-ID: US-1310, AC-ID: AC-1310a, TC-ID: TC-REC-044h
/**
 * Module: app/api/v1/recovery/request/route
 * Purpose: Fachada del paso 1 de la recuperación (FR-1302/FR-1303/FR-1310/FR-1311). Sin sesión, por
 *   definición: quien la usa no puede entrar.
 *
 *   POR QUÉ EXISTE EN VEZ DE LLAMAR AL ENDPOINT DE BETTER AUTH DIRECTAMENTE (ADR-04, TRF-01):
 *   la librería envuelve el gancho de envío en try/catch y DESCARTA la excepción
 *   (runInBackgroundOrAwait, create-context.mjs:214). Con el SMTP caído responde 200 "enviado" y el
 *   usuario espera para siempre un correo que nunca salió — FR-1310 quedaría cumplido sobre el papel
 *   y roto en la práctica, con la suite en verde porque nadie prueba con el correo apagado.
 *
 *   EL ORDEN DE EVALUACIÓN ES LA PARTE QUE IMPORTA:
 *     1. formato            → 400   no toca la base de datos
 *     2. ¿hay config SMTP?  → 503   propiedad del despliegue, no de la cuenta
 *     3. ¿responde el SMTP? → 502   propiedad de la red, no de la cuenta
 *     4. delegar            → 200   aquí, y solo aquí, se mira si la cuenta existe
 *   Los pasos 2 y 3 se deciden SIN haber consultado nunca la cuenta, así que sus respuestas no
 *   pueden revelar su existencia. Invertir el orden convertiría el aviso de fallo en la fuga de
 *   enumeración que FR-1303 prohíbe.
 * Dependencies: zod, @/server/http, @/server/auth, @/server/mail/mailer, @/server/env,
 *   @/server/rateLimit (BG-015)
 */
import "server-only";
import { z } from "zod";
import { HTTP, json, withApi } from "@/server/http";
import { getAuth, RESET_CALLBACK_PATH } from "@/server/auth";
import { isConfigured, probe } from "@/server/mail/mailer";
import { env } from "@/server/env";
import { allow, clientIp } from "@/server/rateLimit";

const requestSchema = z.object({ email: z.string().email() });

/**
 * Límite del endpoint (NFR-1303, BG-015): el MISMO mecanismo y el MISMO valor que el login —
 * 5 intentos por minuto. No es una defensa nueva: el no_go_zone de la feature excluye captcha,
 * backoff y telemetría. Es la regla que el producto ya usa, aplicada por fin donde se declaraba.
 */
const RESET_MAX_PER_MIN = 5;
const RESET_WINDOW_SECONDS = 60;

/**
 * Cuerpo de acuse. Es deliberadamente mínimo: cuanto menos diga, menos puede filtrar. Idéntico
 * exista o no la cuenta (FR-1303) — los tests lo comparan byte a byte.
 */
const ACK = { ok: true } as const;

/**
 * Solicita el envío del enlace de recuperación.
 *
 * El esquema NO se pasa a withApi a propósito: su fallo de validación devuelve 422, y el contrato
 * de esta ruta declara 400 con un código propio. La validación va dentro para controlar la forma.
 *
 * @returns 200 {ok:true} · 400 INVALID_EMAIL · 429 TOO_MANY_REQUESTS · 502 SEND_FAILED · 503 RECOVERY_UNAVAILABLE
 */
const postHandler = withApi({ auth: "public", mutation: true }, async ({ req }) => {
  const raw = await req.json().catch(() => undefined);
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "INVALID_EMAIL" }, HTTP.BAD_REQUEST);

  // Paso 1.5 — BG-015: el límite va AQUÍ, antes de sondear el SMTP y mucho antes de mirar la
  // cuenta. NFR-1303 declaraba este endpoint acotado a 5/min, pero la regla vivía en
  // `rateLimit.customRules` de Better Auth, que sólo alcanza a su router HTTP: esta fachada llama a
  // `getAuth().api.*` y lo esquivaba. Medido: 12 peticiones → 12 correos, cero 429.
  //
  // DOS dimensiones, y las dos hacen falta:
  //   · por IP    — la que declara el NFR; sólo disponible detrás de un proxy de confianza (BG-013).
  //   · por EMAIL — la que protege de verdad la cuota del proveedor, y la única que funciona sin
  //                 proxy. Se cuenta con el correo TAL COMO LLEGA, exista o no la cuenta: hacerlo
  //                 sólo para las que existen convertiría el 429 en la fuga de enumeración que
  //                 FR-1303 prohíbe.
  const ip = clientIp(req, env().trustProxy);
  const excedido =
    (ip !== undefined && !allow(`recovery:ip:${ip}`, RESET_MAX_PER_MIN, RESET_WINDOW_SECONDS)) ||
    !allow(`recovery:email:${parsed.data.email.toLowerCase()}`, RESET_MAX_PER_MIN, RESET_WINDOW_SECONDS);
  if (excedido) return json({ error: "TOO_MANY_REQUESTS" }, HTTP.TOO_MANY);

  // Paso 2 y 3 ANTES de mirar la cuenta: su veredicto depende del despliegue y de la red.
  if (!isConfigured()) return json({ error: "RECOVERY_UNAVAILABLE" }, HTTP.SERVICE_UNAVAILABLE);
  if (!(await probe())) return json({ error: "SEND_FAILED" }, HTTP.BAD_GATEWAY);

  // Paso 4: Better Auth decide si emite y envía. Devuelve el mismo cuerpo exista o no la cuenta, y
  // simula la generación del token y la búsqueda cuando no existe, para igualar también el tiempo.
  await getAuth().api.requestPasswordReset({
    body: {
      email: parsed.data.email,
      redirectTo: `${env().BETTER_AUTH_URL}${RESET_CALLBACK_PATH}`,
    },
  });

  return json(ACK, HTTP.OK);
});

// El segundo argumento de withApi es opcional, y `next build` exige que el export case EXACTO con
// su RouteContext. Se envuelve, igual que hacen /health y el resto de rutas del proyecto.
export const POST = (req: Request): Promise<Response> => postHandler(req);
