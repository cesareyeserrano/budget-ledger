/**
 * Module: components/AgentTag
 * Purpose: La etiqueta «lo registró un agente» de una fila de movimiento (feature tony-ledger,
 *   FR-3414). Muestra el NOMBRE del token que lo registró, en texto —no un color ni un ícono solo—,
 *   para que el dueño distinga de un vistazo lo que escribió el agente de lo que registró él.
 *   Un movimiento manual no tiene origen y no pinta nada: la fila queda exactamente como antes.
 *   La usan el Detalle de la celda (escritorio) y la pantalla de la hoja (teléfono).
 * Dependencies: @/domain (tipo Movement)
 */
import type { Movement } from "@/domain";

/**
 * @param movement el movimiento de la fila
 * @param className clases de tipografía de la fila que la aloja (cada pantalla tiene su escala)
 * @returns la etiqueta con el nombre del agente, o `null` si el movimiento se registró a mano
 */
export function AgentTag({ movement, className = "" }: { movement: Movement; className?: string }) {
  const nombre = movement.origin?.agentName;
  if (!nombre) return null;
  return (
    <span
      data-testid="agent-tag"
      // El nombre completo queda a un gesto cuando la etiqueta se recorta (hasta 60 caracteres).
      title={nombre}
      aria-label={`Registrado por ${nombre}`}
      // `inline-block`: el recorte con elipsis y el ancho máximo no aplican a un elemento en línea.
      className={`inline-block flex-none max-w-[96px] truncate rounded-(--radius-xs) border px-1 leading-snug ${className}`}
      style={{ color: "var(--fg-secondary)", borderColor: "var(--border-strong)" }}
    >
      {nombre}
    </span>
  );
}
