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

/** FR-207: el mensaje exacto para un monto que no es un entero en pesos. */
export const MONTO_ENTERO_MSG = "El monto debe ser un valor entero en pesos.";

/** «1.500.000»: miles con punto, bien agrupados. En es-CO el punto separa miles, no decimales. */
const MILES_RE = /^\d{1,3}(\.\d{3})+$/;

/**
 * BG-076 — lo que un campo de monto deja escribir: dígitos y los signos que hay que JUZGAR (punto,
 * coma, menos). Antes cada campo borraba todo lo que no fuera dígito, y «1500,50» se convertía en
 * 150.050 —cien veces la cifra— sin ningún aviso. Las letras siguen sin entrar.
 */
export function amountChars(raw: string): string {
  return (raw ?? "").replace(/[^\d.,-]/g, "");
}

/**
 * BG-076 / FR-207 — `null` si `raw` es un entero en pesos: solo dígitos, o miles con punto bien
 * agrupados («1.500.000»). Si no —coma, un punto que no agrupa miles («12.5»), un signo menos—, el
 * mensaje de FR-207. Vacío no es error aquí: cada campo decide si un monto vacío vale.
 */
export function amountInputError(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (s === "" || /^\d+$/.test(s) || MILES_RE.test(s)) return null;
  return MONTO_ENTERO_MSG;
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
  // BG-076: «1.500.000» es un entero con sus miles, no un decimal; «12,5» y «12.5» sí se rechazan.
  const error = amountInputError(input);
  if (error) return { ok: false, message: error };
  const amount = parsePesos(input);
  if (amount <= 0) return { ok: false, message: "Escribe un monto mayor que 0." };
  return { ok: true, amount };
}
