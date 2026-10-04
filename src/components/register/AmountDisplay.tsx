"use client";

import type { NodeType } from "@/domain/types";
import { signOf } from "@/domain/sign";
import { useState } from "react";
import { formatCOP, MONTO_ENTERO_MSG } from "@/lib/money";
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
  /**
   * Admite montos NEGATIVOS (presupuesto-movil FR-3107): solo un ajuste puede serlo. Muestra el «−»
   * delante de la cifra y acepta teclearlo al inicio; `onDigits` recibe entonces «-» + dígitos.
   * Apagado, el campo se comporta como siempre: el registro nunca lo enciende.
   */
  signed?: boolean;
  /** Con `signed`: lo tecleado empieza por «−» aunque aún no haya dígitos (un «−0» numérico no existe). */
  negative?: boolean;
  /** Id de prueba del campo. Por defecto el del registro. */
  testId?: string;
  /**
   * ESTRICTO (presupuesto-movil FR-3107): cualquier carácter que no sea parte de un monto —una letra,
   * por ejemplo— se señala con el mensaje de monto entero en vez de descartarse en silencio. Al
   * EDITAR, «3a0» no puede convertirse en 30 sin que el usuario lo vea. Apagado, como siempre.
   */
  strict?: boolean;
  /** Avisa cuando lo tecleado deja de ser (o vuelve a ser) un monto válido, para deshabilitar el guardado. */
  onInvalidChange?: (invalid: boolean) => void;
}

/**
 * Monto protagonista EDITABLE: el número grande ES el <input> (inputMode='numeric', teclado
 * nativo). Signo a la izquierda y caret en el color del tipo activo; formato COP en vivo.
 *
 * @aitri-trace FR-ID: FR-207, US-ID: US-207, AC-ID: AC-207, TC-ID: TC-SUT-220h
 */
export function AmountDisplay({
  amount, type, onDigits, error = false, signed = false, negative = false, testId = "amount-input", strict = false, onInvalidChange,
}: Props) {
  const [noEntero, setNoEnteroState] = useState(false);
  const setNoEntero = (v: boolean) => {
    setNoEnteroState(v);
    onInvalidChange?.(v);
  };
  const color = typeColorVar(type);
  const display = signed
    ? `${negative || amount < 0 ? "−" : ""}${amount !== 0 ? formatCOP(Math.abs(amount)) : ""}`
    : amount > 0 ? formatCOP(amount) : "";
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
          {signed ? "" : signOf(type)}
        </span>
        <input
          inputMode="numeric"
          pattern={signed ? undefined : "[0-9]*"}
          aria-label="Monto en pesos"
          data-testid={testId}
          value={display}
          onChange={(e) => {
            // BG-076 (FR-207): una coma o un signo no se funden en los dígitos («1500,50» → 150.050).
            // El campo muestra la cifra con sus puntos de miles, así que el punto no se puede juzgar aquí.
            if (strict && /[^\d.$\s]/.test(signed ? e.target.value.replace(/[-−]/g, "") : e.target.value)) { setNoEntero(true); return; }
            if (signed) {
              if (/,/.test(e.target.value)) { setNoEntero(true); return; }
              setNoEntero(false);
              // El cursor suele estar al FINAL, así que un «−» vale en cualquier posición y ALTERNA el
              // signo: el campo ya muestra uno si es negativo, y teclear otro lo quita.
              const menos = (e.target.value.match(/[-−]/g) ?? []).length;
              onDigits((menos % 2 === 1 ? "-" : "") + e.target.value.replace(/[^\d]/g, "").slice(0, MAX_AMOUNT_DIGITS));
              return;
            }
            if (/[,-]/.test(e.target.value)) { setNoEntero(true); return; }
            setNoEntero(false);
            onDigits(e.target.value.replace(/[^\d]/g, "").slice(0, MAX_AMOUNT_DIGITS));
          }}
          // En modo estricto el aviso bloquea el guardado, y el campo sigue mostrando el último monto
          // válido: al salir del campo el aviso se retira, o quedaría bloqueado sin nada que corregir.
          onBlur={strict ? () => { if (noEntero) setNoEntero(false); } : undefined}
          placeholder="$0"
          className="tabular min-w-0 flex-1 bg-transparent text-center font-medium outline-none placeholder:opacity-40"
          style={{ fontSize, lineHeight: 1, color, caretColor: color }}
        />
      </div>
      {noEntero && (
        <p data-testid="amount-error" className="text-sm" style={{ color: "var(--error)" }} role="alert">{MONTO_ENTERO_MSG}</p>
      )}
      {error && !noEntero && (
        <p className="text-sm" style={{ color: "var(--error)" }} role="alert">
          Escribe un monto mayor que 0.
        </p>
      )}
    </div>
  );
}
