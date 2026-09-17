/**
 * Feature diario-de-celda — EP-03: la paridad con `reglas-en-el-servidor`.
 * TCs: NFR-2505 (364e).
 *
 * Esta feature añade DOS vías de escritura nuevas (PATCH y DELETE) que pasan por las mismas reglas
 * de reserva que el PUT. La tentación, cuando una regla estorba, es relajar el caso que la vigila —
 * y eso no se nota en ninguna corrida: los tests siguen verdes porque ya no piden lo mismo.
 *
 * La guarda compara contra un ANCLA fija: el estado de la rama ANTES de construir esta feature. Un
 * ancla móvil («lo que había hace un rato») convertiría la comprobación en una tautología.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/**
 * `400f96b` — el HEAD de develop justo antes del primer epic de diario-de-celda (`2ed00e7`).
 *
 * OJO al mantenerlo: este repo solo admite merge commits precisamente porque varias pruebas
 * comparan contra commits ancla; un squash o un rebase reescribiría el sha y esto se caería en main
 * sin que nada más lo delatara.
 */
const ANCLA = "400f96b";
const RUTA = "aitri/features/reglas-en-el-servidor/spec/03_TEST_CASES.json";

interface TestCase { id: string; [k: string]: unknown }

function enElAncla(): TestCase[] {
  const raw = execFileSync("git", ["show", `${ANCLA}:${RUTA}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return (JSON.parse(raw) as { test_cases: TestCase[] }).test_cases;
}

function ahora(): TestCase[] {
  return (JSON.parse(readFileSync(path.join(ROOT, RUTA), "utf8")) as { test_cases: TestCase[] }).test_cases;
}

describe("NFR-2505 · las reglas de reserva no se relajan para dejar pasar lo nuevo", () => {
  it("TC-DDC-364e: los TCs de reglas-en-el-servidor no cambian", () => {
    // @aitri-tc TC-DDC-364e
    const antes = enElAncla();
    const despues = ahora();

    // ANTI-VACUIDAD: si el ancla devolviera una lista vacía, la comparación pasaría sin mirar nada.
    expect(antes.length).toBeGreaterThan(0);

    // Ni un caso más, ni uno menos, ni renombrado…
    expect(despues.map((t) => t.id)).toEqual(antes.map((t) => t.id));
    // …y ninguno con un solo campo distinto: ni el texto, ni lo que espera, ni su prioridad.
    expect(despues).toEqual(antes);
  });
});
