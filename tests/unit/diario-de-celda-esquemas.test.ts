/**
 * Feature diario-de-celda — EP-03: los esquemas del BORDE.
 * TCs: NFR-2501 (309f, 310e).
 *
 * Es la primera puerta: lo que estos esquemas rechazan no llega a abrir una transacción, y lo que
 * NORMALIZAN entra ya limpio a la base. Se prueban aparte del resto porque su fallo es distinto —
 * un esquema flojo no rompe ninguna prueba de comportamiento, simplemente deja pasar basura.
 */
import { describe, it, expect } from "vitest";
import { apiMovementSchema, movementPatchSchema } from "@/server/schemas";
import { MONTO_MAX } from "@/domain";

describe("NFR-2501 · movementPatchSchema", () => {
  it("TC-DDC-309f: rechaza cuerpos malformados y normaliza la nota", () => {
    // @aitri-tc TC-DDC-309f
    // SEIS que no entran. Cada uno cierra una puerta distinta:
    const malos: [string, unknown][] = [
      ["cuerpo vacío", {}],                                   // no es una edición: nada que cambiar
      ["campo desconocido", { amount: 1, sorpresa: true }],    // .strict(): un campo de más es un cliente confundido
      ["monto decimal", { amount: 1.5 }],                      // el dinero es entero en todo el producto
      ["monto por encima del tope", { amount: MONTO_MAX + 1 }],// el bigint de Postgres tiene fondo
      ["nota de 281", { note: "x".repeat(281) }],              // el tope es 280, y se rechaza sin recortar
      ["fecha vacía", { date: "" }],                           // una fecha vacía no es «sin fecha»
    ];
    for (const [que, body] of malos) {
      expect(movementPatchSchema.safeParse(body).success, que).toBe(false);
    }

    // DOS que entran y salen NORMALIZADAS: la nota se recorta, y una nota en blanco es «sin nota»,
    // no una cadena vacía — si no, el Detalle pintaría una fila con texto invisible.
    const recortada = movementPatchSchema.safeParse({ note: "  Café de la tarde  " });
    expect(recortada.success).toBe(true);
    expect(recortada.success && recortada.data.note).toBe("Café de la tarde");

    const enBlanco = movementPatchSchema.safeParse({ note: "   " });
    expect(enBlanco.success).toBe(true);
    expect(enBlanco.success && enBlanco.data.note).toBeNull();
  });
});

describe("NFR-2501 · apiMovementSchema", () => {
  it("TC-DDC-310e: el ajuste negativo es válido; el manual negativo y el ajuste de bolsillo, no", () => {
    // @aitri-tc TC-DDC-310e
    const base = {
      id: "m1", ownerId: "u1", catId: "c-rest", subId: null, target: "c-rest",
      period: "2026-09", createdAt: 1,
    };
    const casos = [
      // Un ajuste NEGATIVO de gasto: válido, y es lo que permite bajar una celda sin borrar nada.
      { ...base, type: "expense", amount: -10_000, kind: "adjustment" as const },
      // Un movimiento manual negativo: NO. La licencia del signo es solo del ajuste (FR-2504).
      { ...base, type: "expense", amount: -10_000 },
      // Un ajuste en un BOLSILLO: NO. Sus celdas son aportes con techo y piso propios (NFR-2503).
      { ...base, type: "transfer", amount: -10_000, kind: "adjustment" as const },
      // Un ajuste de CERO: NO. «No hacer nada» no se guarda como un movimiento.
      { ...base, type: "expense", amount: 0, kind: "adjustment" as const },
    ];
    expect(casos.map((c) => apiMovementSchema.safeParse(c).success)).toEqual([true, false, false, false]);
  });
});
