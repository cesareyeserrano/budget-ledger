/**
 * Feature semilla-intacta — FR-2301 / FR-2302 / NFR-2302 / NFR-2303.
 *
 * Lo que se vigila aquí es una promesa de FORMA, no de valor: `buildSeed` debe devolver los mapas
 * de montos SIN UNA SOLA CLAVE. Devolverlos poblados de ceros satisfaría la lectura ingenua del
 * requisito —no se ve dinero— y rompería FR-2302 en silencio, porque `OpeningCard` decide si
 * aparece contando claves, no mirando valores. Ese es el riesgo número uno de la feature (RISK-2302
 * en 02_SYSTEM_DESIGN.md) y por eso TC-SIN-003f replica literalmente esa expresión.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildSeed, genBudget } from "@/domain/seed";
import { isLeaf } from "@/domain/tree";
import { addMonths } from "@/domain/periods";
import { shouldShowOpeningCard } from "@/components/OpeningCard";
import { buildSeedConMontos } from "../helpers/seedConMontos";
import { P0 } from "../helpers/periods";

describe("FR-2301 · la semilla del primer arranque no trae montos", () => {
  it("TC-SIN-001h: buildSeed devuelve budgets y actuals sin una sola clave", () => {
    // @aitri-tc TC-SIN-001h
    const s = buildSeed("u-test", P0);
    expect(Object.keys(s.budgets)).toHaveLength(0);
    expect(Object.keys(s.actuals)).toHaveLength(0);
    expect(s.movements).toHaveLength(0);
  });

  it("TC-SIN-002e: ninguna hoja tiene monto en ninguno de los doce meses del rango", () => {
    // @aitri-tc TC-SIN-002e
    const s = buildSeed("u-test", P0);
    const hojas = s.nodes.filter((n) => isLeaf(n, s.nodes));
    // Si el barrido fuera vacío por accidente, la prueba no probaría nada: se exige que haya hojas.
    expect(hojas).toHaveLength(8);

    let lecturas = 0;
    for (const hoja of hojas) {
      for (let i = 0; i < 12; i++) {
        const m = addMonths(P0, i);
        expect(s.budgets[hoja.id]?.[m]).toBeUndefined();
        expect(s.actuals[hoja.id]?.[m]).toBeUndefined();
        lecturas += 2;
      }
    }
    expect(lecturas).toBe(8 * 12 * 2);
  });

  it("TC-SIN-003f: la trampa del mapa con ceros — hasData sobre la semilla real es false", () => {
    // @aitri-tc TC-SIN-003f
    const s = buildSeed("u-test", P0);
    // La MISMA expresión que OpeningCard.tsx usa para decidir si se muestra. Si alguien rellenara
    // los mapas con claves a valor 0, esto seguiría siendo true y la tarjeta no aparecería jamás.
    const hasData =
      Object.keys(s.budgets ?? {}).length > 0 ||
      Object.keys(s.actuals ?? {}).length > 0 ||
      (s.movements?.length ?? 0) > 0;
    expect(hasData).toBe(false);
    expect(shouldShowOpeningCard(hasData, null, null)).toBe(true);
  });
});

describe("FR-2302 · el predicado de la tarjeta no cambia", () => {
  it("TC-SIN-011e: shouldShowOpeningCard conserva su tabla de verdad completa", () => {
    // @aitri-tc TC-SIN-011e
    expect(shouldShowOpeningCard(false, null, null)).toBe(true);
    expect(shouldShowOpeningCard(true, null, null)).toBe(false);
    expect(shouldShowOpeningCard(false, "2026-06", null)).toBe(false);
    expect(shouldShowOpeningCard(false, null, 0)).toBe(false);
    expect(shouldShowOpeningCard(false, null, 3_000_000)).toBe(false);
    expect(shouldShowOpeningCard(true, "2026-06", 3_000_000)).toBe(false);
  });
});

describe("NFR-2302 · la jerarquía sembrada sigue intacta", () => {
  it("TC-SIN-030h: la jerarquía es idéntica campo a campo a la de antes del cambio", () => {
    // @aitri-tc TC-SIN-030h
    // Fixture CONGELADO del comportamiento anterior: si la feature tocara la estructura —que es lo
    // que el usuario compró que NO pasaría— esto se pone rojo. Un recuento no bastaría: dejaría
    // pasar un cambio de nombres o de orden.
    const s = buildSeed("u-test", P0);
    const firma = s.nodes.map((n) => `${n.id}|${n.name}|${n.type}|${n.level}|${n.parentId}|${n.order}`);

    expect(firma).toContain("g-esenciales|Esenciales|expense|group|null|0");
    expect(firma).toContain("g-trabajo|Trabajo|income|group|null|7");
    expect(firma).toContain("g-ahorro|Ahorro|transfer|group|null|10");
    expect(firma).toContain("s-comida-mercado|Mercado|expense|sub|c-comida|2");
    expect(s.nodes).toHaveLength(12);
    expect(firma.filter((f) => f.startsWith("c-comida|"))).toHaveLength(1);
    expect(firma.some((f) => f.startsWith("s-comida-mercado|"))).toBe(true);
    // orden estrictamente creciente y sin huecos, que es el contrato de `order`
    expect(s.nodes.map((n) => n.order)).toEqual(s.nodes.map((_, i) => i));
    // cada nodo no raíz apunta a un padre que existe
    const ids = new Set(s.nodes.map((n) => n.id));
    for (const n of s.nodes) if (n.parentId !== null) expect(ids.has(n.parentId)).toBe(true);
  });

  it("TC-SIN-031e: la siembra sigue siendo determinista entre llamadas", () => {
    // @aitri-tc TC-SIN-031e
    const a = buildSeed("u-test", P0);
    const b = buildSeed("u-test", P0);
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(Object.keys(a.budgets)).toHaveLength(0);
    expect(Object.keys(b.actuals)).toHaveLength(0);
  });
});

describe("NFR-2303 · la migración de las pruebas no hace trampas", () => {
  it("TC-SIN-040h: el helper restituye la semilla con montos anterior", () => {
    // @aitri-tc TC-SIN-040h
    const conMontos = buildSeedConMontos("u-test", P0);
    const base = buildSeed("u-test", P0);
    const referencia = genBudget(base.nodes, P0);

    expect(JSON.stringify(conMontos.nodes)).toBe(JSON.stringify(base.nodes));
    expect(JSON.stringify(conMontos.budgets)).toBe(JSON.stringify(referencia.budgets));
    expect(JSON.stringify(conMontos.actuals)).toBe(JSON.stringify(referencia.actuals));
    // y de verdad trae celdas: una entrada por hoja con sus doce meses
    const hojas = base.nodes.filter((n) => isLeaf(n, base.nodes));
    expect(Object.keys(conMontos.budgets)).toHaveLength(hojas.length);
    expect(Object.keys(conMontos.budgets[hojas[0]!.id]!)).toHaveLength(12);
  });

  it("TC-SIN-041e: el helper no muta la semilla base que compone", () => {
    // @aitri-tc TC-SIN-041e
    const base = buildSeed("u-test", P0);
    expect(Object.keys(base.budgets)).toHaveLength(0);
    buildSeedConMontos("u-test", P0);
    // la instancia previa sigue vacía: el helper compuso un objeto nuevo
    expect(Object.keys(base.budgets)).toHaveLength(0);
    expect(Object.keys(base.actuals)).toHaveLength(0);
  });

  it("TC-SIN-042f: genBudget sobrevive intacta y sigue produciendo los mismos montos", () => {
    // @aitri-tc TC-SIN-042f
    // Si alguien MUTILA genBudget en vez de solo dejar de llamarla, este caso lo caza.
    const base = buildSeed("u-test", P0);
    const { budgets, actuals } = genBudget(base.nodes, P0);
    const hojas = base.nodes.filter((n) => isLeaf(n, base.nodes));

    expect(Object.keys(budgets)).toHaveLength(hojas.length);
    const h = "s-comida-mercado";
    expect(budgets[h]![P0]).toBeGreaterThan(0);
    // el eje arranca en el periodo pedido, no en un enero fijo
    expect(Object.keys(budgets[h]!)[0]).toBe(P0);
    // los meses proyectados del final del tramo traen ejecutado exactamente 0
    const meses = Object.keys(actuals[h]!);
    expect(actuals[h]![meses[meses.length - 1]!]).toBe(0);
    // y sigue siendo determinista
    expect(JSON.stringify(genBudget(base.nodes, P0))).toBe(JSON.stringify({ budgets, actuals }));
  });
});

describe("NFR-2303 · el gate contra la trampa silenciosa", () => {
  it("TC-SIN-043f: la migración no introduce ningún marcador de salto en la suite", () => {
    // @aitri-tc TC-SIN-043f
    // La tentación al migrar 24 ficheros es aflojar una aserción o marcar un `skip`. NFR-2303 lo
    // prohíbe, y esto lo hace mecánico: la línea base de esta feature es CERO marcadores de salto
    // en todo el árbol de pruebas. `it.skipIf(...)` queda excluido a propósito — es la guarda de
    // cronómetro que ya existía (BG-026/BG-030) y se evalúa en tiempo de ejecución, no desactiva
    // una prueba a mano.
    const ficheros = execSync("git ls-files 'tests/**/*.ts' 'tests/**/*.tsx'", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    expect(ficheros.length).toBeGreaterThan(50);

    const culpables: string[] = [];
    for (const f of ficheros) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\b(?:it|test|describe)\.(skip|todo)\s*\(/g)) {
        culpables.push(`${f}: .${m[1]}(`);
      }
    }
    expect(culpables).toEqual([]);
  });
});
