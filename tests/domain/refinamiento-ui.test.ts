import { describe, it, expect } from "vitest";
import { cellTone, cellGlyph, budgetState } from "@/domain/budgetState";

/**
 * refinamiento-ui — el color deja de clasificar y pasa a señalar sólo excepción.
 *
 * Estas reglas vivían dentro de BudgetGrid, así que ningún test podía alcanzarlas sin montar el
 * componente. Al moverlas al dominio se verifican aquí, que es donde el proyecto verifica todo lo
 * demás que es puro.
 */

describe("FR-1201 — el color señala excepción, nunca categoría", () => {
  // @aitri-tc TC-RUI-001h
  it("TC-RUI-001h: el rol de la celda sale del ESTADO, no del tipo", () => {
    // Gasto sobre-consumido al 133 % → alerta grave
    expect(cellTone("expense", 300000, 400000)).toBe("alert-strong");
    // Gasto al 108 % → alerta leve
    expect(cellTone("expense", 300000, 324000)).toBe("alert-soft");
    // Gasto dentro del plan → neutro: la grilla no dice nada porque no hay nada que decir
    expect(cellTone("expense", 300000, 200000)).toBe("neutral");
    // Ingreso por encima de su plan → favorable (regla propia del tipo, no identidad)
    expect(cellTone("income", 100000, 120000)).toBe("favorable");

    // Ningún rol es una identidad de tipo: el conjunto de roles posibles no contiene "expense",
    // "income" ni "transfer" — ésa es la propiedad que la feature instala.
    const roles = new Set([
      cellTone("expense", 300000, 400000),
      cellTone("income", 100000, 120000),
      cellTone("transfer", 100000, 100000),
    ]);
    for (const r of roles) expect(["neutral", "muted", "favorable", "alert-soft", "alert-strong"]).toContain(r);
  });

  // @aitri-tc TC-RUI-001e
  it("TC-RUI-001e: la reserva pierde su hue de identidad y queda neutra", () => {
    // Antes: la reserva se pintaba con el azul de su TIPO aunque no expresara ningún desvío.
    expect(cellTone("transfer", 200000, 200000)).toBe("neutral");
    expect(cellTone("transfer", 0, 500000)).toBe("neutral");
    // Y el ingreso por debajo de su plan usa el rol de alerta leve, no un verde/ámbar de tipo.
    expect(cellTone("income", 100000, 80000)).toBe("alert-soft");
    // Sin ejecutado, la celda recede: es el "sin dato", no una categoría.
    expect(cellTone("expense", 300000, 0)).toBe("muted");
    expect(cellTone("income", 300000, 0)).toBe("muted");
    expect(cellTone("transfer", 300000, 0)).toBe("muted");
  });
});

describe("FR-1203 — la marca no cromática de gravedad", () => {
  // @aitri-tc TC-RUI-003i
  it("TC-RUI-003i: INVARIANTE — toda celda coloreada lleva marca no cromática", () => {
    // Es la propiedad que WCAG 1.4.1 exige y que la unificación de tokens estuvo a punto de romper.
    // Se barre el espacio completo: tres tipos × ratios alrededor de los dos umbrales.
    for (const type of ["expense", "income", "transfer"] as const) {
      for (let pct = 0; pct <= 200; pct += 5) {
        const b = 1000;
        const e = Math.round((b * pct) / 100);
        const coloreada = ["favorable", "alert-soft", "alert-strong"].includes(cellTone(type, b, e));
        const conMarca = cellGlyph(type, b, e) !== "";
        // Un verde «favorable» es la excepción sana y no necesita marca: no pide acción.
        if (coloreada && cellTone(type, b, e) !== "favorable") {
          expect(conMarca, `${type} al ${pct}%: coloreada sin marca`).toBe(true);
        }
      }
    }
  });

  // @aitri-tc TC-RUI-003h
  it("TC-RUI-003h: el glifo corresponde al umbral", () => {
    expect(cellGlyph("expense", 100, 132)).toBe("››"); // ≥120 %
    expect(cellGlyph("expense", 100, 108)).toBe("›"); // >100 % y <120 %
    expect(cellGlyph("expense", 100, 95)).toBe(""); // dentro del plan
    expect(cellGlyph("expense", 100, 100)).toBe(""); // el 100 % exacto sigue dentro
  });

  // @aitri-tc TC-RUI-003e
  it("TC-RUI-003e: color y glifo salen de la MISMA evaluación de estado", () => {
    // El invariante de ADR-02: no existe ninguna entrada donde uno indique desvío y el otro no.
    // Se barre alrededor de los dos umbrales, que es donde una desincronización aparecería.
    for (let pct = 80; pct <= 150; pct += 1) {
      const b = 1000;
      const e = Math.round((b * pct) / 100);
      const tone = cellTone("expense", b, e);
      const glyph = cellGlyph("expense", b, e);
      const st = budgetState(b, e);

      const toneSaysDeviation = tone === "alert-soft" || tone === "alert-strong";
      const glyphSaysDeviation = glyph !== "";
      expect(toneSaysDeviation, `ratio ${pct}%: tono ${tone} vs glifo "${glyph}"`).toBe(glyphSaysDeviation);

      // Y ambos coinciden con el estado del dominio, no sólo entre sí.
      if (st === "over_hard") expect([tone, glyph]).toEqual(["alert-strong", "››"]);
      if (st === "over_soft") expect([tone, glyph]).toEqual(["alert-soft", "›"]);
      if (st === "within" && e > 0) expect([tone, glyph]).toEqual(["neutral", ""]);
    }
  });

  // @aitri-tc TC-RUI-003f
  it("TC-RUI-003f: un ingreso por encima de su plan no lleva marca", () => {
    // Superar un ingreso planeado es BUENO: marcarlo sería decir que algo va mal.
    expect(cellGlyph("income", 100000, 250000)).toBe("");
    // Pero quedarse CORTO sí es una excepción leve, y al unificar los tokens pasó a compartir el
    // ámbar con el sobre-consumo. Sin marca quedaba una celda coloreada sin canal no cromático:
    // el defecto que TC-BSC-453f detectó. «‹» = te quedaste corto, espejo de «›» = te pasaste.
    expect(cellGlyph("income", 100000, 50000)).toBe("‹");
    // La reserva tampoco expresa desvío.
    expect(cellGlyph("transfer", 100000, 500000)).toBe("");
    // Ni una celda sin ejecutado, sea del tipo que sea.
    expect(cellGlyph("expense", 100000, 0)).toBe("");
  });
});

describe("NFR-1205 — el rediseño no añade trabajo de render", () => {
  // @aitri-tc TC-RUI-105h
  it("TC-RUI-105h: resolver el rol de una celda es O(1) y no toca el estado", () => {
    // cellTone/cellGlyph son puras y no reciben el LedgerState: no pueden recorrer el árbol,
    // que es la propiedad que garantiza que el guardrail de ≤150 ms no se degrada por celda.
    expect(cellTone.length).toBe(3);
    expect(cellGlyph.length).toBe(3);
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) cellTone("expense", 1000, i % 2000);
    expect(performance.now() - t0).toBeLessThan(150);
  });

  // @aitri-tc TC-RUI-105e
  it("TC-RUI-105e: el rol es estable — la misma entrada da siempre la misma salida", () => {
    for (let i = 0; i < 200; i++) {
      expect(cellTone("expense", 1000, 1500)).toBe("alert-strong");
      expect(cellGlyph("expense", 1000, 1500)).toBe("››");
    }
  });

  // @aitri-tc TC-RUI-105f
  it("TC-RUI-105f: entradas degeneradas no producen NaN, Infinity ni excepción", () => {
    for (const [b, e] of [[0, 0], [0, 100], [100, 0], [-5, -5], [Number.MAX_SAFE_INTEGER, 1]] as const) {
      expect(() => cellTone("expense", b, e)).not.toThrow();
      expect(() => cellGlyph("expense", b, e)).not.toThrow();
      expect(typeof cellTone("expense", b, e)).toBe("string");
    }
    // Presupuesto 0 con ejecutado > 0 es el caso más grave, sin dividir por cero.
    expect(cellTone("expense", 0, 100)).toBe("alert-strong");
  });
});
