/**
 * BG-076 / FR-207 — un monto que no es un entero en pesos se rechaza; no se funde en los dígitos.
 *
 * Los campos borraban todo lo que no fuera dígito: «1500,50» se convertía en 150.050, cien veces la
 * cifra, sin aviso.
 */
import { describe, it, expect } from "vitest";
import { amountChars, amountInputError, parsePesos, MONTO_ENTERO_MSG } from "@/lib/money";

describe("amountInputError", () => {
  it("acepta enteros y miles con punto bien agrupados", () => {
    for (const ok of ["", "0", "1500", "1500000", "1.500", "1.500.000", "15.000.000"]) expect(amountInputError(ok), ok).toBeNull();
  });
  it("rechaza la coma, el punto que no agrupa miles y el signo, con el mensaje de FR-207", () => {
    for (const mal of ["1500,50", "12,5", "12.5", "1.50", "1.5000", "1500.", "-500", "1.500,00"]) {
      expect(amountInputError(mal), mal).toBe(MONTO_ENTERO_MSG);
    }
  });
});

describe("el campo conserva lo que hay que juzgar", () => {
  it("amountChars deja dígitos, punto, coma y menos; quita letras", () => {
    expect(amountChars("$ 1.500,50 COP")).toBe("1.500,50");
    expect(amountChars("-500")).toBe("-500");
  });
  it("«1.500.000» se lee como 1.500.000, no como 1,5", () => {
    expect(parsePesos("1.500.000")).toBe(1_500_000);
  });
});

// BL-063: aquí se probaba `validateAmountInput`, que seguía sin llamar nadie y se retiró. Lo que
// usa el producto —`amountInputError` y `parsePesos`— está cubierto arriba.
