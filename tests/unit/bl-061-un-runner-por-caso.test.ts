/**
 * BL-061 — un caso de prueba lo acredita UN solo runner.
 *
 * `aitri verify-run` acredita por id: lee la salida de vitest y la de Playwright, saca el id del
 * título de cada prueba y, si las dos salidas traen el mismo, se queda con la de vitest. Quince ids
 * vivían en los dos sitios, y catorce de ellos son casos que su plan declara e2e: si la prueba de
 * navegador fallaba, el caso seguía en verde por la unitaria, que comprueba otra cosa (la cifra del
 * dominio, no lo que se ve en pantalla).
 *
 * El arreglo fue quitar el id del título de la prueba que el plan NO declara («apoyo TDF-050h: …»).
 * Sigue corriendo y sigue tumbando la suite si falla; lo que deja de hacer es acreditar un caso que
 * no es el suyo. Esta guarda impide que la colisión vuelva.
 *
 * Lee los títulos como texto porque lo que vigila es una propiedad del árbol de pruebas, no un
 * comportamiento del producto. Lo que NO ve: un título armado en ejecución (`it.each`, plantillas).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

// La gramática de ids de Aitri (lib/tc-id.js, `extractTCId`), copiada tal cual: un sufijo como
// `-unit` o `-e2e` NO hace un id distinto — `TC-606f-unit` se lee `TC-606f`.
const ID = /(?<![A-Za-z0-9])[Tt][Cc]((?:[-_][A-Za-z][A-Za-z0-9]*)*)[-_](\d+)([A-Za-z0-9]*)(?![A-Za-z0-9])/;
const TITULO = /^\s*(?:it|test)(?:\.[a-zA-Z]+)*\(\s*([`"'])(.*?)\1/gm;

function archivos(dir: string, sufijos: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return archivos(p, sufijos);
    return sufijos.some((s) => e.name.endsWith(s)) ? [p] : [];
  });
}

/** id canónico → archivos cuyos títulos lo llevan. */
function idsEnTitulos(sufijos: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of archivos(path.join(ROOT, "tests"), sufijos)) {
    for (const m of readFileSync(f, "utf8").matchAll(TITULO)) {
      const id = m[2].match(ID);
      if (!id) continue;
      const canonico = `TC${id[1].replace(/_/g, "-").toUpperCase()}-${id[2]}${id[3]}`;
      out.set(canonico, [...(out.get(canonico) ?? []), path.relative(ROOT, f)]);
    }
  }
  return out;
}

describe("BL-061 · un caso, un runner", () => {
  const vitest = idsEnTitulos([".test.ts", ".test.tsx"]);
  const playwright = idsEnTitulos([".spec.ts"]);

  it("BL-061: la guarda ve los títulos de los dos runners (si no viera nada, pasaría en falso)", () => {
    expect(vitest.size).toBeGreaterThan(1000);
    expect(playwright.size).toBeGreaterThan(500);
  });

  it("BL-061: ningún id de caso está a la vez en un título de vitest y en uno de Playwright", () => {
    const repetidos = [...vitest.keys()]
      .filter((id) => playwright.has(id))
      .map((id) => `${id}: ${vitest.get(id)![0]} y ${playwright.get(id)![0]}`);
    expect(repetidos, "quita el id del título de la prueba que el plan no declara («apoyo …»)").toEqual([]);
  });

  // El id va fuera del título a propósito: con él dentro, esta misma prueba sería una colisión.
  it("BL-061: un sufijo como «-unit» no esquiva la guarda, y «apoyo …» no se lee como id", () => {
    expect("TC-606f-unit: algo".match(ID)![0]).toBe("TC-606f");
    expect("apoyo TDF-050h: algo".match(ID)).toBeNull();
  });
});
