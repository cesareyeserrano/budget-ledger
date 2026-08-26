/**
 * Module: tests/e2e/helpers/mailbox
 * Purpose: Lee el buzón de Mailpit desde los specs e2e. El contenedor lo arranca el globalSetup y su
 *   URL viaja a los workers por process.env (y, como respaldo, por el STATE_FILE que ya se escribe).
 *
 *   Existe para que el recorrido end-to-end use el correo REAL como lo usaría el titular: se solicita
 *   en la UI, se abre el buzón, se pulsa el enlace. Sin esto habría que inventarse el token, y el
 *   caso dejaría de probar justamente lo que más importa — que el enlace que LLEGA funciona.
 * Dependencies: ./globalSetup
 */
import { readFileSync, existsSync } from "node:fs";
import { STATE_FILE } from "./globalSetup";

/** URL base de la API HTTP de Mailpit. */
export function mailpitApi(): string {
  if (process.env.MAILPIT_API) return process.env.MAILPIT_API;
  if (existsSync(STATE_FILE)) {
    const { mailpitApi: url } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { mailpitApi?: string };
    if (url) return url;
  }
  throw new Error("MAILPIT_API no definida — ¿arrancó el globalSetup el contenedor de correo?");
}

/** Vacía el buzón. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${mailpitApi()}/api/v1/messages`, { method: "DELETE" });
}

/** Número de mensajes en el buzón. */
export async function messageCount(): Promise<number> {
  const res = await fetch(`${mailpitApi()}/api/v1/messages`);
  return ((await res.json()) as { messages_count: number }).messages_count;
}

/**
 * Espera al correo dirigido a una dirección y devuelve el enlace de recuperación que porta.
 *
 * @param to Dirección destinataria esperada.
 * @param timeoutMs Plazo máximo de espera.
 * @returns La URL del enlace recibido.
 * @throws Error si no llega el correo, o si su cuerpo no contiene un enlace.
 */
export async function waitForResetLink(to: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${mailpitApi()}/api/v1/messages`);
    const { messages } = (await res.json()) as {
      messages: { ID: string; To: { Address: string }[] }[];
    };
    const mio = (messages ?? []).find((m) => m.To.some((t) => t.Address === to));
    if (mio) {
      const detalle = await fetch(`${mailpitApi()}/api/v1/message/${mio.ID}`);
      const { Text } = (await detalle.json()) as { Text: string };
      const m = Text.match(/https?:\/\/\S+/);
      if (!m) throw new Error(`el correo a ${to} no contiene ningún enlace`);
      return m[0];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no llegó ningún correo a ${to} en ${timeoutMs}ms`);
}
