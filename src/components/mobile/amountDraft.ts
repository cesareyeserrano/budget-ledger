// @aitri-trace components:mobile:amountDraft — feature presupuesto-movil (FR-3105, FR-3109).
//
// Módulo:       src/components/mobile/amountDraft.ts
// Propósito:    Decide qué se puede hacer con lo escrito en el campo de una cifra: guardarlo, o por
//               qué no. No valida reglas de negocio —eso es del dominio—, solo que el texto sea un
//               monto entero en pesos.
// Dependencias: @/lib/money.

import { amountInputError, parsePesos } from "@/lib/money";

/** Máximo de dígitos de un monto, el mismo del campo del registro. */
const MAX_DIGITS = 15;
const TOO_LONG_MSG = "Ese monto es demasiado grande.";

/** Lo que el campo de monto permite con el texto actual. */
export interface AmountDraftState {
  /** El botón «Guardar» debe estar deshabilitado. */
  disabled: boolean;
  /** Mensaje para mostrar bajo el campo, o null. */
  error: string | null;
  /** El monto interpretado; null si no se puede guardar. */
  value: number | null;
}

/**
 * Estado del campo de monto según lo escrito.
 *
 * El VACÍO deshabilita sin mensaje: `amountInputError` lo da por válido y `parsePesos("")` es 0, así
 * que sin esta regla un campo vacío guardaría un cero que nadie escribió. Para poner cero hay que
 * escribir 0.
 *
 * @param raw Texto del campo.
 * @param opts `allowZero`: si 0 es un valor guardable (por defecto sí).
 * @returns Si se puede guardar, con qué valor, o el mensaje que lo impide.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3105, US-ID: US-3105, AC-ID: AC-3114, TC-ID: TC-PMV-044e, TC-PMV-042f
 */
export function amountDraftState(raw: string, opts: { allowZero?: boolean } = {}): AmountDraftState {
  const text = raw.trim();
  if (text === "") return { disabled: true, error: null, value: null };
  const error = amountInputError(text);
  if (error) return { disabled: true, error, value: null };
  const value = parsePesos(text);
  // Más dígitos de los que caben en un entero seguro: se dice, no se recorta en silencio.
  if (text.replace(/[^\d]/g, "").length > MAX_DIGITS || !Number.isSafeInteger(value) || value < 0) {
    return { disabled: true, error: TOO_LONG_MSG, value: null };
  }
  if (value === 0 && opts.allowZero === false) return { disabled: true, error: null, value: null };
  return { disabled: false, error: null, value };
}
