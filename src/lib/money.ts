/**
 * Parseo y formato de dinero en COP — pesos enteros, sin centavos (FR-207/FR-011 parent).
 */

const COP_FORMAT = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Convierte la entrada del usuario (solo dígitos) a un entero de pesos COP. Descarta
 * cualquier carácter no numérico; recorta a 15 dígitos (rango seguro de enteros JS).
 *
 * @aitri-trace FR-ID: FR-207, US-ID: US-207, AC-ID: AC-207, TC-ID: TC-SUT-220h
 */
export function parsePesos(input: string): number {
  const digits = (input ?? "").replace(/[^\d]/g, "").slice(0, 15);
  if (digits === "") return 0;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * True si la entrada contiene un separador decimal (no permitido en COP).
 * @aitri-trace FR-ID: FR-207, US-ID: US-207, AC-ID: AC-207, TC-ID: TC-SUT-223f
 */
export function hasDecimalSeparator(input: string): boolean {
  return /[.,]/.test(input ?? "");
}

/**
 * Formatea un entero de pesos como COP es-CO: '$', miles con '.', sin decimales, sin espacio.
 * @aitri-trace FR-ID: FR-207, US-ID: US-207, AC-ID: AC-207, TC-ID: TC-SUT-220h
 */
export function formatCOP(amount: number): string {
  return COP_FORMAT.format(amount).replace(/\s/g, "");
}

export type AmountValidation = { ok: true; amount: number } | { ok: false; message: string };

/**
 * Valida la entrada de monto (FR-207). Rechaza separadores decimales (COP sin centavos) con el
 * mensaje exacto, y montos ≤0. La entrada del registro ya restringe a dígitos en el teclado, así
 * que esta es la barrera defensiva/verificable de la regla.
 *
 * @aitri-trace FR-ID: FR-207, US-ID: US-207, AC-ID: AC-207, TC-ID: TC-SUT-222f
 */
export function validateAmountInput(input: string): AmountValidation {
  if (hasDecimalSeparator(input)) {
    return { ok: false, message: "El monto debe ser un valor entero en pesos." };
  }
  const amount = parsePesos(input);
  if (amount <= 0) return { ok: false, message: "Escribe un monto mayor que 0." };
  return { ok: true, amount };
}
