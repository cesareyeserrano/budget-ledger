/**
 * BG-021 — el dinero tiene tope superior.
 *
 * Antes de este arreglo `amountSchema` era `.int().gte(1)` y NADA MAS: aceptaba 1e21 y hasta
 * `Number.MAX_VALUE`, porque zod los da por enteros. La columna es `bigint` en Postgres (techo
 * ~9.22e18), asi que lo grande terminaba en un 500 del servidor, y lo que caia entre 2^53 y ese
 * techo se guardaba EN SILENCIO con otro valor: por encima de 2^53 JavaScript deja de representar
 * los enteros de forma exacta.
 *
 * La frontera elegida no es arbitraria ni de producto: es exactamente donde la representacion deja
 * de ser exacta.
 */
import { describe, it, expect } from "vitest";
import { amountSchema, cellAmountSchema, parseAmount, MONTO_MAX } from "@/domain/validation";
import { setLeafAmount, addMovement } from "@/domain/mutations";
import { buildSeed } from "@/domain/seed";
import { P, P0 } from "../helpers/periods";

describe("BG-021 · el monto tiene techo", () => {
  it("el tope ES la frontera de la representacion exacta, no un numero inventado", () => {
    expect(MONTO_MAX).toBe(Number.MAX_SAFE_INTEGER);
    // Justo por encima, JS ya miente: dos valores distintos son el mismo numero.
    expect(2 ** 53 + 1).toBe(2 ** 53);
    expect(Number.isSafeInteger(MONTO_MAX)).toBe(true);
    expect(Number.isSafeInteger(MONTO_MAX + 1)).toBe(false);
  });

  it("rechaza lo que antes aceptaba en silencio", () => {
    for (const malo of [1e21, Number.MAX_VALUE, 2 ** 53, MONTO_MAX + 1]) {
      expect(amountSchema.safeParse(malo).success, `${malo} deberia rechazarse`).toBe(false);
      expect(cellAmountSchema.safeParse(malo).success, `${malo} deberia rechazarse`).toBe(false);
    }
    expect(parseAmount("1e21")).toBeNull();
    expect(amountSchema.safeParse(Infinity).success).toBe(false);
    expect(amountSchema.safeParse(NaN).success).toBe(false);
  });

  it("acepta el tope exacto y todo lo razonable por debajo", () => {
    expect(amountSchema.safeParse(MONTO_MAX).success).toBe(true);
    expect(amountSchema.safeParse(36_480_200).success).toBe(true); // una cifra real de usuario
    expect(cellAmountSchema.safeParse(0).success).toBe(true);      // la celda vacia SI es valida
    expect(amountSchema.safeParse(0).success).toBe(false);         // un movimiento de 0 NO
    expect(cellAmountSchema.safeParse(-1).success).toBe(false);
  });

  it("la grilla RECORTA en vez de guardar otro numero: la edicion del usuario no se pierde", () => {
    const s = buildSeed("u", P0);
    const hoja = "s-comida-mercado";
    const next = setLeafAmount(s, hoja, P0, "budget", 1e21, P);
    // Ni 1e21 ni un valor corrompido: exactamente el tope.
    expect(next.budgets[hoja]![P0]).toBe(MONTO_MAX);
    expect(Number.isSafeInteger(next.budgets[hoja]![P0]!)).toBe(true);
  });

  it("el registro de movimientos rechaza el monto imposible en vez de aceptarlo", () => {
    const s = buildSeed("u", P0);
    const antes = s.movements.length;
    const next = addMovement(s, { type: "expense", catId: "c-vivienda", amount: 1e21, period: P0 }, P);
    expect(next.movements).toHaveLength(antes); // no se registro nada
  });
});
