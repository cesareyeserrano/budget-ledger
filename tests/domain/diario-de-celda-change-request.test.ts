/**
 * Feature diario-de-celda — EP-02: el change request sobre `transferencias`, acotado.
 *
 * FR-2509 renombra conceptos en toda la app, y eso obligó a tocar DOS TCs ya aprobados de otra
 * feature. Esta prueba es la guarda de ese acuerdo: que el cambio se quedó donde se dijo y no se
 * coló ningún otro retoque en specs ajenos — ni en `transferencias` fuera de esos dos, ni en
 * `techo-de-flujo`, cuyo spec no debía cambiar en absoluto.
 *
 * Compara contra un ANCLA fija (el commit anterior a construir esta feature), no contra «lo que
 * había hace un rato»: un ancla móvil convertiría la guarda en una tautología.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/**
 * El commit ANTERIOR al change request (`e4542a6`), que es el que tocó los dos TCs.
 *
 * No vale el commit anterior al primer epic (`400f96b`): para entonces el change request ya estaba
 * aplicado, así que el diff salía vacío y la guarda no guardaba nada. A esta altura TC-TRF4-012e
 * todavía se titula «Celda sin observaciones…», que es el texto de antes del renombre.
 */
const ANCLA = "4618427";

/** Campos donde el change request SÍ podía tocar: son el texto del caso, no su identidad. */
const CAMPOS_DE_TEXTO = ["title", "given", "when", "then", "expected_result"];

interface TestCase { id: string; [k: string]: unknown }

function specEnAncla(ruta: string): { test_cases: TestCase[] } {
  const raw = execFileSync("git", ["show", `${ANCLA}:${ruta}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(raw) as { test_cases: TestCase[] };
}
function specActual(ruta: string): { test_cases: TestCase[] } {
  return JSON.parse(execFileSync("cat", [path.join(ROOT, ruta)], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }) ) as { test_cases: TestCase[] };
}

/** Los ids de los TCs que difieren entre dos versiones del mismo spec, y en qué campos. */
function diferencias(antes: TestCase[], ahora: TestCase[]): Map<string, string[]> {
  const porId = new Map(antes.map((t) => [t.id, t] as const));
  const out = new Map<string, string[]>();
  for (const t of ahora) {
    const previo = porId.get(t.id);
    if (!previo) continue;
    const campos = [...new Set([...Object.keys(previo), ...Object.keys(t)])]
      .filter((k) => JSON.stringify(previo[k]) !== JSON.stringify(t[k]));
    if (campos.length > 0) out.set(t.id, campos);
  }
  return out;
}

describe("NFR-2503 · el change request se quedó donde se acordó", () => {
  it("TC-DDC-345e: solo TC-TRF4-012e y 012h cambian en transferencias, y nada en techo-de-flujo", () => {
    // @aitri-tc TC-DDC-345e
    const RUTA_TRF = "aitri/features/transferencias/spec/03_TEST_CASES.json";
    const antes = specEnAncla(RUTA_TRF).test_cases;
    const ahora = specActual(RUTA_TRF).test_cases;

    // Los ids son los mismos: no se creó, borró ni renombró ningún caso.
    expect(ahora.map((t) => t.id)).toEqual(antes.map((t) => t.id));

    const cambios = diferencias(antes, ahora);
    expect([...cambios.keys()].sort()).toEqual(["TC-TRF4-012e", "TC-TRF4-012h"]);
    for (const [id, campos] of cambios) {
      expect(campos.every((c) => CAMPOS_DE_TEXTO.includes(c)), `${id} cambió en ${campos.join(",")}`).toBe(true);
    }

    // techo-de-flujo no cambia NADA: su ajuste vivió solo en el código de su e2e (la etiqueta del
    // campo), nunca en su spec.
    const RUTA_TDF = "aitri/features/techo-de-flujo/spec/03_TEST_CASES.json";
    expect(specActual(RUTA_TDF)).toEqual(specEnAncla(RUTA_TDF));
  });
});
