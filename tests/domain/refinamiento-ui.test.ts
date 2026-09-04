import { describe, it, expect } from "vitest";
import { cellTone, cellGlyph, budgetState } from "@/domain/budgetState";
import { buildSeed, rollupBudget, rollupActual, childrenOf, leafDescendants, subtreeIds, subtreeDepth, findNode } from "@/domain";
import { P as MONTH_KEYS, P0 } from "../helpers/periods";
import { CRONOMETRO_FIABLE } from "../helpers/perf";

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

/**
 * NFR-1201 — la feature es PRESENTACIÓN. El acuerdo explícito con el usuario es que no se toca
 * cálculo, dominio ni modelo de datos. Estos tres TCs son el cinturón: si un cambio visual se
 * filtrara al dominio, aquí se ve, y no en una revisión visual meses después.
 */
describe("NFR-1201 — regresión: el dominio queda intacto", () => {
  // @aitri-tc TC-RUI-101h
  it("TC-RUI-101h: la semilla conserva su forma y sus totales", () => {
    const s = buildSeed("local", P0);
    // La estructura sembrada no cambió con el rediseño: tres bloques, y cada uno sus categorías.
    const groups = s.nodes.filter((n) => n.level === "group");
    expect(groups.map((g) => g.name).sort()).toEqual(["Ahorro", "Esenciales", "Trabajo"]);
    expect(new Set(groups.map((g) => g.type))).toEqual(new Set(["expense", "income", "transfer"]));

    // Comida conserva sus tres subcategorías, que es el único nodo de profundidad 3 de la semilla.
    const comida = s.nodes.find((n) => n.name === "Comida")!;
    expect(childrenOf(s.nodes, comida.id).map((c) => c.name).sort()).toEqual(["Café", "Mercado", "Restaurantes"]);

    // El roll-up de un padre sigue siendo la suma de sus hojas — la regla de cálculo del producto.
    // budgets es Record<nodeId, Partial<Record<PeriodKey, number>>>: anidado, no una clave compuesta.
    const month = MONTH_KEYS[0];
    const suma = leafDescendants(s.nodes, comida.id)
      .reduce((acc, id) => acc + (s.budgets[id]?.[month] ?? 0), 0);
    expect(suma, "la semilla debe presupuestar Comida").toBeGreaterThan(0);
    expect(rollupBudget(s, comida.id, month)).toBe(suma);
  });

  // @aitri-tc TC-RUI-101e
  it("TC-RUI-101e: los casos borde del dominio siguen resolviendo igual", () => {
    const s = buildSeed("local", P0);
    // Nodo inexistente: no lanza, devuelve el neutro del dominio.
    expect(findNode(s.nodes, "no-existe")).toBeUndefined();
    expect(childrenOf(s.nodes, "no-existe")).toEqual([]);
    expect(leafDescendants(s.nodes, "no-existe")).toEqual([]);

    // Una hoja es su propio descendiente-hoja, y su subárbol mide 0 (0 = hoja, 1 = tiene hijos).
    const vivienda = s.nodes.find((n) => n.name === "Vivienda")!;
    expect(leafDescendants(s.nodes, vivienda.id)).toEqual([vivienda.id]);
    expect(subtreeDepth(s.nodes, vivienda.id)).toBe(0);
    // Comida sí tiene hijos: el otro extremo del mismo contrato, que es la pieza de "cabida" de FR-702.
    expect(subtreeDepth(s.nodes, s.nodes.find((n) => n.name === "Comida")!.id)).toBe(1);

    // El umbral de estado no se movió con la unificación de tokens: sigue en 100 % y 120 % exactos.
    expect(budgetState(1000, 1000)).toBe("within");
    expect(budgetState(1000, 1001)).toBe("over_soft");
    expect(budgetState(1000, 1200)).toBe("over_hard");
  });

  // @aitri-tc TC-RUI-101f
  it("TC-RUI-101f: ningún invariante estructural se rompe — cero huérfanos y totales cuadrados", () => {
    const s = buildSeed("local", P0);
    const ids = new Set(s.nodes.map((n) => n.id));

    // Cero huérfanos: todo parentId apunta a un nodo que existe.
    const huerfanos = s.nodes.filter((n) => n.parentId !== null && !ids.has(n.parentId));
    expect(huerfanos.map((n) => n.name)).toEqual([]);

    // Un hijo nunca cambia de tipo respecto de su padre: el tipo se hereda por el árbol.
    for (const n of s.nodes) {
      if (n.parentId) expect(findNode(s.nodes, n.parentId)!.type).toBe(n.type);
    }

    // Totales cuadrados en los DOCE meses. Presupuestado agrega HOJAS y Ejecutado agrega el
    // SUBÁRBOL completo (una categoría-hoja puede llevar monto directo): son dos reglas distintas
    // y el test las mide por separado, que es justo donde una regresión se escondería.
    let comprobados = 0;
    for (const m of MONTH_KEYS) {
      for (const g of s.nodes.filter((n) => n.level === "group")) {
        const sumaB = leafDescendants(s.nodes, g.id).reduce((a, id) => a + (s.budgets[id]?.[m] ?? 0), 0);
        const sumaA = subtreeIds(s.nodes, g.id).reduce((a, id) => a + (s.actuals[id]?.[m] ?? 0), 0);
        expect(rollupBudget(s, g.id, m), `${g.name} presupuesto ${m}`).toBe(sumaB);
        expect(rollupActual(s, g.id, m), `${g.name} ejecutado ${m}`).toBe(sumaA);
        if (sumaB > 0) comprobados++;
      }
    }
    // El guardián del guardián: si la semilla dejara de sembrar montos, lo de arriba compararía
    // ceros contra ceros y pasaría sin verificar nada.
    expect(comprobados, "ningún grupo tenía presupuesto: el test estaría pasando en vacío").toBeGreaterThan(0);
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
    // Guardarrail de tiempo: no se afirma bajo instrumentación de cobertura (BG-026).
    if (CRONOMETRO_FIABLE) expect(performance.now() - t0).toBeLessThan(150);
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
