/**
 * Module: components/AgentTag
 * Purpose: La marca «lo registró un agente» de una fila de movimiento (feature tony-ledger,
 *   FR-3414; BL-096). Es un ícono de bot: ocupa poco y no se confunde con la nota de la fila. El
 *   NOMBRE del token que lo registró no se pierde: va como texto para lectores de pantalla, como
 *   título al pasar el cursor, y a la vista al tocar el ícono (en el teléfono no hay cursor).
 *   Un movimiento manual no tiene origen y no pinta nada: la fila queda exactamente como antes.
 *   La usan el Detalle de la celda (escritorio) y la pantalla de la hoja (teléfono).
 * Dependencies: @/domain (tipo Movement), lucide-react
 */
"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import type { Movement } from "@/domain";

/**
 * @param movement el movimiento de la fila
 * @param className clases de tipografía de la fila que la aloja (cada pantalla tiene su escala)
 * @returns la marca del agente, o `null` si el movimiento se registró a mano
 */
export function AgentTag({ movement, className = "" }: { movement: Movement; className?: string }) {
  const [abierta, setAbierta] = useState(false);
  const nombre = movement.origin?.agentName;
  if (!nombre) return null;
  return (
    <button
      type="button"
      data-testid="agent-tag"
      data-open={abierta ? "true" : "false"}
      title={nombre}
      aria-label={`Registrado por ${nombre}`}
      aria-expanded={abierta}
      onClick={(e) => { e.stopPropagation(); setAbierta((v) => !v); }}
      // `leading-tight`: abierta o cerrada, la marca no pasa de la altura de la línea de texto de
      // la fila, así que una fila del agente mide lo mismo que una manual (TC-AGT-140h).
      // Abierta, el nombre se recorta con elipsis (hasta 60 caracteres) y no ensancha la fila.
      className={`inline-flex flex-none items-center gap-1 leading-tight ${abierta ? "max-w-[96px] rounded-(--radius-xs) border px-1" : ""} ${className}`}
      style={{ color: "var(--fg-secondary)", borderColor: "var(--border-strong)" }}
    >
      <Bot size={14} strokeWidth={1.5} className="flex-none" aria-hidden="true" />
      <span data-testid="agent-tag-name" className={abierta ? "min-w-0 truncate" : "sr-only"}>{nombre}</span>
    </button>
  );
}
