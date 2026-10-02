/**
 * Detector de pruebas apagadas, compartido por los cuatro suelos de la suite (TC-MAN-202f,
 * TC-CDM-201f, TC-RES-201f, TC-SIN-043f).
 *
 * Cada suelo traía su propia expresión regular y ninguna veía un salto CONDICIONAL: con la forma
 * `skipIf` y un `true` dentro se apagaba una prueba sin que nadie lo notara, igual que con `runIf` y
 * un `false`, o con `fixme` (BL-073). Uno de ellos, además, contaba cada llamada a `runExit(` como
 * si fuera un `xit(`, por no llevar frontera de palabra.
 *
 * Un salto condicional SÍ es legítimo en dos casos, y solo esos se admiten:
 *   · la guarda de cronómetro (`SALTAR_SI_INSTRUMENTADO`, tests/helpers/perf.ts): bajo cobertura el
 *     reloj mide el coste de instrumentar, no el del algoritmo;
 *   · la guarda de anidamiento (`VITEST_NESTED`): la prueba que lanza un vitest hijo no se relanza
 *     dentro de ese hijo.
 * Cualquier otra condición es una prueba apagada mientras no se demuestre lo contrario aquí.
 *
 * Los nombres de los marcadores se COMPONEN en vez de escribirse enteros: escritos tal cual, este
 * fichero —y cualquiera que lo cite— se acusaría a sí mismo.
 */
import { readFileSync, globSync } from "node:fs";

const SUJETO = "(?:describe|it|test)";
/** `it.skip`, `describe.only`, `test.todo`, `test.fixme`… con o sin modificadores encadenados. */
const INCONDICIONAL = new RegExp(`\\b${SUJETO}(?:\\.\\w+)*\\.(?:${["skip", "only", "todo", "fixme"].join("|")})\\b`);
/** Las formas con x delante, con frontera de palabra: `runExit(` no es una de ellas. */
const CON_X = new RegExp(`\\b(?:${["xit", "xdescribe", "xtest"].join("|")})\\s*\\(`);
/** El salto condicional y la condición que lleva dentro. */
const CONDICIONAL = new RegExp(`\\.(?:${["skipIf", "runIf"].join("|")})\\(\\s*([^)]*)`);
const CONDICIONES_ADMITIDAS = [/^SALTAR_SI_INSTRUMENTADO$/, /^!!process\.env\.VITEST_NESTED$/];

/** Las líneas (1-indexadas) de un fuente que apagan una prueba. Los comentarios no cuentan. */
export function lineasApagadas(src: string): number[] {
  const out: number[] = [];
  src.split("\n").forEach((linea, i) => {
    const t = linea.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    const cond = linea.match(CONDICIONAL);
    const condicionMala = cond !== null && !CONDICIONES_ADMITIDAS.some((ok) => ok.test(cond[1]!.trim()));
    if (INCONDICIONAL.test(linea) || CON_X.test(linea) || condicionMala) out.push(i + 1);
  });
  return out;
}

/** Todas las pruebas apagadas del árbol, como `fichero:línea  texto`. Vacío = ninguna. */
export function pruebasApagadas(): string[] {
  const ficheros = globSync("tests/**/*.{test,spec}.ts?(x)");
  if (ficheros.length < 50) throw new Error(`el detector solo ve ${ficheros.length} ficheros de prueba: ¿cambió el cwd?`);
  return ficheros.flatMap((f) => {
    const src = readFileSync(f, "utf8");
    const lineas = src.split("\n");
    return lineasApagadas(src).map((n) => `${f}:${n}  ${lineas[n - 1]!.trim().slice(0, 80)}`);
  });
}
