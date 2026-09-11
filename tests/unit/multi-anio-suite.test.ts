// Feature multi-anio — NFR-1901: adaptar la suite NO es desactivarla.
// TC: TC-MAN-202f
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

describe("NFR-1901 · ninguna prueba quedó desactivada al migrar", () => {
  it("TC-MAN-202f: no existe ni un `skip`, `only` o `todo` en toda la suite", () => {
    // La migración tocó 43 ficheros de prueba. La tentación al adaptar en masa es marcar como
    // saltada la que estorba, y eso deja la suite verde mintiendo. Se comprueba mecánicamente.
    const ficheros = globSync("tests/**/*.{test,spec}.ts?(x)");
    expect(ficheros.length).toBeGreaterThan(50);

    const ofensas: string[] = [];
    for (const f of ficheros) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((linea, i) => {
        const t = linea.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return; // comentarios no cuentan
        // `describe.skip`, `it.skip`, `test.skip`, `.only`, `.todo` y las formas con `xit`/`xdescribe`
        if (/\b(describe|it|test)\.(skip|only|todo)\b/.test(linea) || /\b(xit|xdescribe|xtest)\s*\(/.test(linea)) {
          ofensas.push(`${f}:${i + 1}  ${linea.trim().slice(0, 80)}`);
        }
      });
    }
    expect(ofensas, `pruebas desactivadas:\n${ofensas.join("\n")}`).toEqual([]);
  });
});
