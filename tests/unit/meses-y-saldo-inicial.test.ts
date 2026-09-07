/**
 * Feature meses-y-saldo-inicial — el CONTRATO de datos del borde.
 * TCs: FR-2207 (063e)
 *
 * Unitario de verdad: no toca base, no monta DOM. Es una aserción sobre el esquema Zod, que es el
 * sitio donde esta feature podía perder los dos valores en silencio.
 */
import { describe, it, expect } from "vitest";
import { ledgerStateSchema } from "@/server/schemas";

describe("FR-2207 — el contrato de datos transporta la apertura", () => {
  const base = {
    ownerId: "u",
    nodes: [],
    budgets: {},
    actuals: {},
    movements: [],
  };

  it("TC-MSI-063e: Los campos SOBREVIVEN al parseo de ledgerStateSchema", () => {
    // @aitri-tc TC-MSI-063e
    // Zod DESCARTA por defecto las claves que no declara, y este mismo esquema valida la respuesta
    // que `ServerRepository.load()` parsea. Si `startMonth`/`openingBalance` no estuvieran
    // declarados, los dos valores viajarían correctos desde el servidor y desaparecerían aquí,
    // sin ningún error a la vista: la grilla abriría en cero por mucho que la base dijera otra
    // cosa. Es literalmente la trampa que `schemas.ts` ya documenta para `closure` y `cellNotes`.
    const parsed = ledgerStateSchema.parse({
      ...base,
      startMonth: "2026-06",
      openingBalance: 3_000_000,
    });
    expect(parsed.startMonth).toBe("2026-06");
    expect(parsed.openingBalance).toBe(3_000_000);

    // Y los dos son OPCIONALES: un cliente anterior a la feature no los envía y sigue validando.
    const sinCampos = ledgerStateSchema.parse(base);
    expect(sinCampos.startMonth).toBeUndefined();
    expect(sinCampos.openingBalance).toBeUndefined();

    // `null` es un valor legítimo y también sobrevive (es «no declarado» explícito).
    const conNulls = ledgerStateSchema.parse({ ...base, startMonth: null, openingBalance: null });
    expect(conNulls.startMonth).toBeNull();
    expect(conNulls.openingBalance).toBeNull();

    // Un mes con formato inválido invalida el snapshot entero, no se cuela como null.
    expect(ledgerStateSchema.safeParse({ ...base, startMonth: "2026-13" }).success).toBe(false);
    // Un saldo negativo tampoco.
    expect(
      ledgerStateSchema.safeParse({ ...base, startMonth: "2026-06", openingBalance: -1 }).success
    ).toBe(false);
  });
});
