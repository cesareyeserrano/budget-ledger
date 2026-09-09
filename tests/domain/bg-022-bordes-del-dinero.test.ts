/**
 * BG-022 — los bordes menores del dinero, endurecidos.
 *
 * MEDIDO el 2026-09-09 antes del arreglo:
 *   parseAmount("0x10") = 16     ← el usuario escribió diez y se guardaban dieciséis
 *   parseAmount("1e3")  = 1000
 *   setPlannedRetiro con mes inválido / negativo / NaN → devolvía {state} SIN avisar, y el store
 *   respondía ok:true: la interfaz creía haber guardado algo que nunca se guardó.
 */
import { describe, it, expect } from "vitest";
import { parseAmount, MONTO_MAX } from "@/domain/validation";
import { setPlannedRetiro } from "@/domain/reserve";
import { buildSeed } from "@/domain/seed";
import { P, P0 } from "../helpers/periods";

describe("BG-022 · parseAmount no interpreta, valida", () => {
  it("rechaza las notaciones que nadie teclea en un campo de pesos", () => {
    expect(parseAmount("0x10")).toBeNull();  // daba 16
    expect(parseAmount("1e3")).toBeNull();   // daba 1000
    expect(parseAmount("0b101")).toBeNull();
    expect(parseAmount("0o17")).toBeNull();
    expect(parseAmount("Infinity")).toBeNull();
  });

  it("sigue aceptando lo que una persona SÍ escribe", () => {
    expect(parseAmount("36480200")).toBe(36_480_200);
    expect(parseAmount(" 12 ")).toBe(12);     // espacios alrededor: tolerados
    expect(parseAmount("+5")).toBe(5);
    expect(parseAmount(1000)).toBe(1000);     // número, no cadena
    expect(parseAmount(String(MONTO_MAX))).toBe(MONTO_MAX);
  });

  it("sigue rechazando lo que ya rechazaba (sin regresión)", () => {
    for (const malo of ["", "  ", "abc", "1,000", "12.7", "-5", "0", "1 000"]) {
      expect(parseAmount(malo), `${JSON.stringify(malo)} no debe pasar`).toBeNull();
    }
  });
});

describe("BG-022 · setPlannedRetiro avisa en vez de tragarse la entrada", () => {
  const s = () => buildSeed("u", P0);

  it("un mes fuera del rango se rechaza, no se ignora", () => {
    const r = setPlannedRetiro(s(), "9999-99", 100, P);
    expect("invalid" in r).toBe(true);
    expect("state" in r).toBe(false);
  });

  it("un valor negativo o no numérico se rechaza", () => {
    expect("invalid" in setPlannedRetiro(s(), P0, -5, P)).toBe(true);
    expect("invalid" in setPlannedRetiro(s(), P0, NaN, P)).toBe(true);
    expect("invalid" in setPlannedRetiro(s(), P0, Infinity, P)).toBe(true);
  });

  it("una entrada VÁLIDA sigue devolviendo estado (sin regresión)", () => {
    const r = setPlannedRetiro(s(), P0, 0, P); // cero es legítimo: «no planeo retirar»
    expect("state" in r).toBe(true);
  });
});
