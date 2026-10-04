// Feature presupuesto-movil — la regla del campo de monto de las tarjetas (amountDraftState).
//
// El campo decide si lo escrito se puede guardar; las reglas de negocio son del dominio. El caso que
// más importa es el VACÍO: sin esta regla guardaría un cero que nadie escribió.
import { describe, it, expect } from "vitest";
import { amountDraftState } from "@/components/mobile/amountDraft";
import { MONTO_ENTERO_MSG } from "@/lib/money";

describe("presupuesto-movil · campo de monto", () => {
  it("TC-PMV-044e: el vacío y lo que no es un monto deshabilitan; el cero y los límites valen", () => {
    // @aitri-tc TC-PMV-044e
    expect(amountDraftState("")).toEqual({ disabled: true, error: null, value: null });
    expect(amountDraftState("   ")).toEqual({ disabled: true, error: null, value: null });
    expect(amountDraftState("0")).toEqual({ disabled: false, error: null, value: 0 });
    expect(amountDraftState("1")).toEqual({ disabled: false, error: null, value: 1 });
    expect(amountDraftState("999999999")).toEqual({ disabled: false, error: null, value: 999_999_999 });
    expect(amountDraftState("1.500.000")).toEqual({ disabled: false, error: null, value: 1_500_000 });
    expect(amountDraftState("-5")).toEqual({ disabled: true, error: MONTO_ENTERO_MSG, value: null });
    expect(amountDraftState("1e3")).toEqual({ disabled: true, error: MONTO_ENTERO_MSG, value: null });
    expect(amountDraftState("abc")).toEqual({ disabled: true, error: MONTO_ENTERO_MSG, value: null });
    expect(amountDraftState("12,5")).toEqual({ disabled: true, error: MONTO_ENTERO_MSG, value: null });
    expect(amountDraftState("12.5")).toEqual({ disabled: true, error: MONTO_ENTERO_MSG, value: null });
    // Más dígitos de los que caben: se dice, no se recorta en silencio a quince.
    expect(amountDraftState("1234567890123456")).toEqual({ disabled: true, error: "Ese monto es demasiado grande.", value: null });
    expect(amountDraftState("999999999999999")).toEqual({ disabled: false, error: null, value: 999_999_999_999_999 });
    // Donde el cero no es un valor guardable, deshabilita sin acusar un error.
    expect(amountDraftState("0", { allowZero: false })).toEqual({ disabled: true, error: null, value: null });
    expect(amountDraftState("7", { allowZero: false })).toEqual({ disabled: false, error: null, value: 7 });
  });
});
