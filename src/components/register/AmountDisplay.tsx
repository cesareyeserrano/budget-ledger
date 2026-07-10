"use client";

import type { NodeType } from "@/domain/types";
import { signOf } from "@/domain/sign";
import { formatCOP } from "@/lib/money";
import { typeColorVar } from "@/components/format";

/** Máximo de dígitos del monto (dentro del rango seguro de enteros JS). */
export const MAX_AMOUNT_DIGITS = 15;

/**
 * Tamaño de fuente del monto según la longitud del texto formateado: cifras largas se
 * reducen en vez de desbordar el contenedor (FR-207).
 */
export function fontSizeForDisplay(display: string): string {
  const len = display.length || 2; // "$0" placeholder → 2
  if (len <= 8) return "3.5rem";
  if (len <= 10) return "2.75rem";
  if (len <= 13) return "2.25rem";
  return "1.75rem";
}

interface Props {
  amount: number;
  type: NodeType;
  onDigits: (raw: string) => void;
  error?: boolean;
}

/**
 * Monto protagonista EDITABLE: el número grande ES el <input> (inputMode='numeric', teclado
 * nativo). Signo a la izquierda y caret en el color del tipo activo; formato COP en vivo.
 *
 * @aitri-trace FR-ID: FR-207, US-ID: US-207, AC-ID: AC-207, TC-ID: TC-SUT-220h
 */
export function AmountDisplay({ amount, type, onDigits, error = false }: Props) {
  const color = typeColorVar(type);
  const display = amount > 0 ? formatCOP(amount) : "";
  const fontSize = fontSizeForDisplay(display || "$0");

  return (
    <div className="flex flex-col items-center gap-2">
      <div data-testid="amount-display" className="flex w-full items-center justify-center gap-1" style={{ color }}>
        <span
          data-testid="amount-sign"
          className="flex shrink-0 items-center font-medium"
          style={{ fontSize, lineHeight: 1 }}
          aria-hidden
        >
          {signOf(type)}
        </span>
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label="Monto en pesos"
          data-testid="amount-input"
          value={display}
          onChange={(e) => onDigits(e.target.value.replace(/[^\d]/g, "").slice(0, MAX_AMOUNT_DIGITS))}
          placeholder="$0"
          className="tabular min-w-0 flex-1 bg-transparent text-center font-medium outline-none placeholder:opacity-40"
          style={{ fontSize, lineHeight: 1, color, caretColor: color }}
        />
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--error)" }} role="alert">
          Escribe un monto mayor que 0.
        </p>
      )}
    </div>
  );
}
