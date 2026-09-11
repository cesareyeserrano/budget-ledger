// @aitri-trace FR-ID: FR-1305, US-ID: US-1305, AC-ID: AC-1305a, TC-ID: TC-REC-021h
/**
 * Module: tests/integration/backend/helpers/mailpit
 * Purpose: Lee el buzón REAL de Mailpit (el contenedor efímero del globalSetup) por su API HTTP.
 *   Existe para que los tests de envío afirmen sobre el mensaje ENTREGADO —destinatario, asunto,
 *   cuerpo, enlace, ausencia de copia oculta— y no sobre "se llamó a sendMail": un doble de
 *   nodemailer habría pasado los mismos tests con el transporte roto.
 * Dependencies: ninguna (fetch de Node)
 */

const api = (): string => process.env.MAILPIT_API!;

export interface DeliveredMessage {
  ID: string;
  To: { Address: string }[];
  Cc: { Address: string }[] | null;
  Bcc: { Address: string }[] | null;
  Subject: string;
}

/** Vacía el buzón. Llamar en beforeEach: los tests cuentan mensajes, no toleran residuos. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${api()}/api/v1/messages`, { method: "DELETE" });
}

/** Número de mensajes en el buzón. */
export async function messageCount(): Promise<number> {
  const res = await fetch(`${api()}/api/v1/messages`);
  const body = (await res.json()) as { messages_count: number };
  return body.messages_count;
}

/** Los mensajes del buzón, del más reciente al más antiguo. */
export async function listMessages(): Promise<DeliveredMessage[]> {
  const res = await fetch(`${api()}/api/v1/messages`);
  const body = (await res.json()) as { messages: DeliveredMessage[] };
  return body.messages ?? [];
}

/**
 * Espera a que el buzón alcance `n` mensajes y los devuelve.
 *
 * @param n Número esperado de mensajes.
 * @param timeoutMs Tiempo máximo de espera.
 * @returns Los mensajes entregados.
 * @throws Error si no llegan `n` mensajes dentro del plazo (con el conteo real, para diagnosticar).
 */
export async function waitForMessages(n: number, timeoutMs = 5_000): Promise<DeliveredMessage[]> {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    count = await messageCount();
    if (count >= n) return listMessages();
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Se esperaban ${n} mensajes en Mailpit; hay ${count}`);
}

/** Cuerpo en texto plano de un mensaje entregado. */
export async function messageText(id: string): Promise<string> {
  const res = await fetch(`${api()}/api/v1/message/${id}`);
  const body = (await res.json()) as { Text: string };
  return body.Text;
}

/**
 * Extrae del cuerpo la URL de recuperación y el token que porta.
 *
 * @param text Cuerpo en texto plano del mensaje.
 * @returns La URL completa y el token de 24 caracteres, o null si el cuerpo no los contiene.
 * @throws No lanza.
 */
export function extractResetLink(text: string): { url: string; token: string } | null {
  const m = text.match(/https?:\/\/\S+/);
  if (!m) return null;
  const url = m[0];
  const t = url.match(/reset-password\/([A-Za-z0-9]{24})/) ?? url.match(/token=([A-Za-z0-9]{24})/);
  return t ? { url, token: t[1] } : null;
}
