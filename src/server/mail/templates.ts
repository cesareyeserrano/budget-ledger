// @aitri-trace FR-ID: FR-1305, US-ID: US-1305, AC-ID: AC-1305a, TC-ID: TC-REC-022e
/**
 * Module: server/mail/templates
 * Purpose: Contenido del correo de recuperación (superficie C-1 del UX spec). Vive separado del
 *   transporte porque el CUERPO es contrato de UX, no lógica de red: cambiarlo no debe obligar a
 *   tocar el cliente SMTP, y probarlo no debe exigir levantar uno.
 *
 *   TEXTO PLANO a propósito (ADR-05): sin HTML de diseño, sin imágenes, sin píxel de seguimiento.
 *   Se renderiza igual en todos los clientes de correo, no puede romperse, y el no_go_zone excluye
 *   explícitamente la plantilla enriquecida. La URL va también como texto literal para los clientes
 *   que no construyen el enlace.
 * Dependencies: ninguna
 */
import "server-only";

/** Minutos de vigencia del enlace. Debe coincidir con RESET_TOKEN_TTL_SECONDS de server/auth. */
const TTL_MINUTES = 30;

export interface ResetMessage {
  subject: string;
  text: string;
}

/**
 * Construye el asunto y el cuerpo del correo de recuperación.
 *
 * @param url URL absoluta que lleva a la pantalla de contraseña nueva, con el secreto incluido.
 * @param name Nombre del titular, si la cuenta lo tiene. Sin él NO se inventa un saludo genérico:
 *   un "Hola usuario" de relleno es peor que ningún saludo.
 * @returns El asunto y el cuerpo en texto plano listos para enviar.
 * @throws No lanza.
 */
export function resetLinkText(url: string, name?: string): ResetMessage {
  const saludo = name ? `Hola ${name}:\n\n` : "";
  return {
    subject: "Recupera el acceso a Ledger",
    text:
      `${saludo}Recibimos una solicitud para crear una contraseña nueva en tu cuenta de Ledger.\n\n` +
      `Abre este enlace para elegirla:\n\n` +
      `${url}\n\n` +
      `El enlace caduca en ${TTL_MINUTES} minutos y solo se puede usar una vez.\n\n` +
      `Si no pediste esto, ignora este mensaje: tu contraseña no ha cambiado.\n`,
  };
}
