// @aitri-trace FR-ID: FR-1305, US-ID: US-1305, AC-ID: AC-1305a, TC-ID: TC-REC-021h
/**
 * Module: server/mail/mailer
 * Purpose: ÚNICO punto de salida SMTP del producto (feature recuperar-acceso, FR-1305/FR-1310/FR-1311).
 *   Aísla el efecto de red: el resto del sistema no conoce nodemailer, así que sustituir el
 *   transporte no toca el flujo. Expone tres operaciones y nada más — isConfigured (¿el despliegue
 *   tiene correo?), probe (¿responde ahora?) y sendResetLink (envía).
 *
 *   server-only: el mismo blindaje que server/auth.ts. Importarlo desde un componente de cliente
 *   rompe la COMPILACIÓN, no la producción — y con ello el cliente conserva sus cero peticiones
 *   externas (NFR-1304, TC-104e / TC-UXC-354h).
 *
 *   POR QUÉ EXISTE probe(): Better Auth envuelve el gancho de envío en try/catch y DESCARTA la
 *   excepción (runInBackgroundOrAwait, create-context.mjs:214), así que un SMTP caído devolvería
 *   200 "enviado" sin que nada fallara (TRF-01). La fachada sondea ANTES de delegar, y antes
 *   también de mirar si la cuenta existe: así el aviso de fallo no revela cuentas (ADR-04).
 * Dependencies: nodemailer, ../env, ./templates
 */
import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";
import { resetLinkText } from "./templates";

/**
 * Timeouts explícitos (TRF-03). Sin ellos, un SMTP que acepta la conexión y luego calla dejaría la
 * petición HTTP abierta hasta el timeout del runtime, con el usuario mirando "Enviando…".
 */
const CONNECTION_TIMEOUT_MS = 5_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;

/**
 * Vigencia del resultado de la sonda. verify() abre conexión y hace handshake (50–300 ms): pagarlo
 * en cada solicitud sería absurdo, y no cachearlo nada tampoco detecta una caída antes. 30 s es el
 * punto donde una ráfaga no paga el coste y una caída se nota en la siguiente solicitud.
 */
const PROBE_CACHE_MS = 30_000;

let transporter: Transporter | undefined;
let probeCache: { ok: boolean; at: number } | undefined;

/**
 * ¿Este despliegue tiene el correo configurado?
 *
 * @returns true si las cinco variables SMTP están presentes y válidas.
 * @throws Error si la configuración de entorno es inválida (p. ej. SMTP_PORT no numérico).
 */
export function isConfigured(): boolean {
  return env().smtpEnabled;
}

/**
 * Transporte SMTP, construido perezosamente y memorizado.
 *
 * Perezoso a propósito: env() se resuelve en el primer uso, nunca al importar, para que `next build`
 * no exija variables de despliegue en tiempo de build (NFR-510).
 *
 * @returns El transporte de nodemailer listo para enviar.
 * @throws Error si se invoca sin configuración SMTP (llamar a isConfigured() antes).
 */
function getTransporter(): Transporter {
  if (transporter) return transporter;
  const e = env();
  if (!e.smtpEnabled) throw new Error("SMTP no configurado en este despliegue");
  const port = Number(e.SMTP_PORT);
  transporter = nodemailer.createTransport({
    host: e.SMTP_HOST!,
    port,
    // 465 es TLS implícito; 587 y 1025 usan STARTTLS o van en claro (Mailpit en desarrollo).
    secure: port === 465,
    auth: { user: e.SMTP_USER!, pass: e.SMTP_PASSWORD! },
    // Sin pool: el pool solo se activa con `pool: true`, y aquí no compensa — mantendría sockets
    // abiertos sin ganancia con un volumen de unidades al mes.
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  return transporter;
}

/**
 * Comprueba que el servidor SMTP responde, con el resultado cacheado PROBE_CACHE_MS.
 *
 * Es la pieza que hace alcanzable FR-1310: la fachada la consulta ANTES de buscar la cuenta, así
 * que su veredicto depende de la red y del despliegue, jamás de si una dirección existe.
 *
 * @returns true si el transporte responde; false si no hay configuración o la verificación falla.
 * @throws No lanza — un fallo se traduce a false y se registra.
 */
export async function probe(): Promise<boolean> {
  if (!isConfigured()) return false;
  const now = Date.now();
  if (probeCache && now - probeCache.at < PROBE_CACHE_MS) return probeCache.ok;
  let ok = false;
  try {
    await getTransporter().verify();
    ok = true;
  } catch (err) {
    // El motivo técnico va al log del servidor y nunca a la respuesta (FR-1310, NFR-1307).
    console.error(`[mail] sonda del transporte fallida: ${describeError(err)}`);
  }
  probeCache = { ok, at: now };
  return ok;
}

/**
 * Envía el correo con el enlace de recuperación a UNA dirección.
 *
 * @param to Dirección registrada de la cuenta. Único destinatario: sin copia ni copia oculta.
 * @param url URL absoluta con el secreto, ya construida por Better Auth.
 * @param name Nombre del titular, si lo hay.
 * @returns Promesa que resuelve cuando el servidor SMTP acepta el mensaje.
 * @throws Error si el envío falla (transporte caído, credenciales rechazadas, timeout).
 */
export async function sendResetLink(to: string, url: string, name?: string): Promise<void> {
  const e = env();
  const { subject, text } = resetLinkText(url, name);
  await getTransporter().sendMail({ from: e.SMTP_FROM!, to, subject, text });
}

/**
 * Reduce un error desconocido a una cadena corta apta para el log.
 *
 * @param err El valor capturado en el catch.
 * @returns Código y mensaje del error, o su representación textual.
 * @throws No lanza.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code ? `${code} ${err.message}` : err.message;
  }
  return String(err);
}

/** Descarta transporte y sonda memorizados. Solo para tests que cambian el entorno SMTP. */
export function __resetMailerForTests(): void {
  transporter = undefined;
  probeCache = undefined;
}
