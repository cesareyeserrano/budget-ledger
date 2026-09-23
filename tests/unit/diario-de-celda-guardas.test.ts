/**
 * Feature diario-de-celda — EP-04: las guardas ESTÁTICAS del epic.
 * TCs: NFR-2509 (401h, 402e, 403f) · NFR-2507 (384e).
 *
 * Dos familias distintas, las dos sin BD y sin navegador:
 *
 * 1. CI (NFR-2509). La feature declara que NO añade infraestructura: se apoya en el workflow que ya
 *    existe. Una promesa así solo vale si algo la comprueba — si mañana alguien restringe los
 *    disparadores o saca un runner, los ficheros de esta feature dejarían de correr en CI en
 *    silencio y el único síntoma sería un verde falso.
 *
 * 2. Ancla (NFR-2507). `diario-de-celda` tocó los FIXTURES de `cierre-de-mes` (el cuadre relativo
 *    del PUT rechaza las siembras con Ejecutado sin movimientos). La regla que el usuario fijó el
 *    2026-09-15 es que se ajusta el fixture y JAMÁS el resultado esperado; TC-DDC-384e es quien la
 *    hace cumplir, comparando contra el commit anterior a construir esta feature.
 *
 * El ancla es FIJA a propósito: contra «lo que había hace un rato» la guarda sería una tautología.
 * Por eso el repo se mergea sin squash (un rebase reescribiría el ancla y rompería esto en main).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();
const WORKFLOWS = ".github/workflows";

/** HEAD de develop antes del primer epic de esta feature (TC-DDC-384e, TC-DDC-403f). */
const ANCLA = "400f96b";

/**
 * Glob → RegExp, acotado a la sintaxis que USAN los dos configs (`**‍/` y `*`).
 *
 * Se hace a mano y no con picomatch porque ese paquete solo está aquí de forma transitiva y sin
 * tipos: importarlo rompería `npm run typecheck`. A cambio, cualquier sintaxis que no esté cubierta
 * (`?`, `{a,b}`, `[abc]`, `!`) LANZA en vez de devolver un falso negativo silencioso — si un día el
 * config estrena un patrón más rico, este test se cae y avisa, que es justo lo que debe pasar.
 */
function globAPatron(glob: string): RegExp {
  if (/[?{}[\]!]/.test(glob)) throw new Error(`glob con sintaxis no soportada por esta guarda: ${glob}`);
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith("**/", i)) { re += "(?:[^/]+/)*"; i += 2; continue; }
    if (glob.startsWith("**", i)) { re += ".*"; i += 1; continue; }
    const c = glob[i];
    if (c === "*") { re += "[^/]*"; continue; }
    re += c.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
const casaAlgun = (ruta: string, globs: string[]) => globs.some((g) => globAPatron(g).test(ruta));

interface PasoDeWorkflow { name?: string; run?: string; uses?: string }
interface JobDeWorkflow { steps?: PasoDeWorkflow[] }
interface Workflow {
  on?: { push?: { branches?: string[] }; pull_request?: { branches?: string[] } };
  true?: { push?: { branches?: string[] }; pull_request?: { branches?: string[] } };
  jobs?: Record<string, JobDeWorkflow>;
}

function workflowParseado(): Workflow {
  return parseYaml(readFileSync(path.join(ROOT, WORKFLOWS, "ci.yml"), "utf8")) as Workflow;
}
/** `on:` es booleano en YAML 1.1 y cadena en 1.2; se aceptan las dos lecturas para no atarse al parser. */
const disparadores = (w: Workflow) => w.on ?? w.true ?? {};
const pasos = (w: Workflow) => Object.values(w.jobs ?? {}).flatMap((j) => j.steps ?? []);

const ficherosEnWorkflows = (tree: string[]) => tree.map((f) => path.basename(f)).sort();

describe("NFR-2509 — la feature corre en el CI que ya existe, sin añadir infraestructura", () => {
  /** @aitri-trace FR-ID: NFR-2509, US-ID: US-2501, AC-ID: AC-2501a, TC-ID: TC-DDC-401h */
  it("TC-DDC-401h: el workflow dispara en push a main y en PR a las tres ramas, y corre vitest y Playwright", () => {
    // @aitri-tc TC-DDC-401h
    const w = workflowParseado();
    const on = disparadores(w);

    // (1) push a main.
    expect(on.push?.branches).toContain("main");

    // (2) PR a las tres ramas del modelo (develop → staging → main).
    for (const rama of ["develop", "staging", "main"]) {
      expect(on.pull_request?.branches).toContain(rama);
    }

    // (3) un paso corre vitest: unit + integración.
    const comandos = pasos(w).map((p) => p.run ?? "");
    expect(comandos.some((c) => /npm run test:run\b/.test(c))).toBe(true);

    // (4) otro paso corre Playwright. Que sean DOS pasos distintos importa: si el e2e viviera dentro
    // del mismo `run` que vitest, un fallo de vitest cortaría la corrida y el e2e nunca se ejecutaría.
    const pasoVitest = comandos.findIndex((c) => /npm run test:run\b/.test(c));
    const pasoE2e = comandos.findIndex((c) => /playwright test/.test(c));
    expect(pasoE2e).toBeGreaterThanOrEqual(0);
    expect(pasoE2e).not.toBe(pasoVitest);

    // Y ninguno de los dos se enmascara con `|| true`, que los dejaría verdes siempre.
    expect(comandos[pasoVitest]).not.toMatch(/\|\|\s*true/);
    expect(comandos[pasoE2e]).not.toMatch(/\|\|\s*true/);
  });

  /** @aitri-trace FR-ID: NFR-2509, US-ID: US-2501, AC-ID: AC-2501a, TC-ID: TC-DDC-402e */
  it("TC-DDC-402e: los ficheros de prueba de la feature caen bajo los globs que el CI ya ejecuta", () => {
    // @aitri-tc TC-DDC-402e
    const vitestCfg = readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    const playwrightCfg = readFileSync(path.join(ROOT, "playwright.config.ts"), "utf8");

    // Los `include` de los dos proyectos de Vitest, leídos del config y no escritos a mano aquí:
    // copiarlos sería medir esta prueba contra sí misma.
    const includes = [...vitestCfg.matchAll(/include:\s*\[([^\]]+)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((s) => s[1]));
    expect(includes.length).toBeGreaterThan(0);

    const testDir = /testDir:\s*"\.\/([^"]+)"/.exec(playwrightCfg)?.[1];
    const testMatch = /testMatch:\s*\/(.+?)\/[gimsuy]*,/.exec(playwrightCfg)?.[1];
    expect(testDir).toBe("tests/e2e");
    expect(testMatch).toBeTruthy();
    const casaPlaywright = (ruta: string) =>
      ruta.startsWith(`${testDir}/`) && new RegExp(testMatch as string).test(ruta);

    // Los tres ficheros que NFR-2509 nombra. Es resolución de PATRONES contra rutas: vale como
    // contrato aunque el fichero de dominio viva hoy repartido en varios (ver el barrido de abajo).
    const nombrados = [
      "tests/domain/diario-de-celda.test.ts",
      "tests/integration/backend/diario-de-celda.test.ts",
      "tests/e2e/diario-de-celda.spec.ts",
    ];
    for (const ruta of nombrados) {
      expect(casaAlgun(ruta, includes) || casaPlaywright(ruta), `sin cubrir: ${ruta}`).toBe(true);
    }

    // Y el barrido de lo que la feature tiene DE VERDAD en disco, que es lo que puede quedarse fuera:
    // el dominio se partió en nueve ficheros y ninguno está en la lista de arriba.
    const reales = [
      ...readdirSync(path.join(ROOT, "tests/domain")).map((f) => `tests/domain/${f}`),
      ...readdirSync(path.join(ROOT, "tests/unit")).map((f) => `tests/unit/${f}`),
      ...readdirSync(path.join(ROOT, "tests/integration/backend")).map((f) => `tests/integration/backend/${f}`),
      ...readdirSync(path.join(ROOT, "tests/e2e")).map((f) => `tests/e2e/${f}`),
    ].filter((f) => /diario-de-celda/.test(f));
    expect(reales.length).toBeGreaterThanOrEqual(3);
    for (const ruta of reales) {
      expect(casaAlgun(ruta, includes) || casaPlaywright(ruta), `sin cubrir: ${ruta}`).toBe(true);
    }
  });

  /** @aitri-trace FR-ID: NFR-2509, US-ID: US-2501, AC-ID: AC-2501a, TC-ID: TC-DDC-403f */
  it("TC-DDC-403f: la feature no añade ningún workflow", () => {
    // @aitri-tc TC-DDC-403f
    const ahora = ficherosEnWorkflows(readdirSync(path.join(ROOT, WORKFLOWS)));
    expect(ahora.filter((f) => /diario|celda/i.test(f))).toEqual([]);

    // La lista completa es la misma que al empezar la feature: ni añadidos ni retirados.
    const enElAncla = ficherosEnWorkflows(
      execFileSync("git", ["ls-tree", "--name-only", ANCLA, `${WORKFLOWS}/`], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .filter(Boolean),
    );
    expect(enElAncla.length).toBeGreaterThan(0);
    expect(ahora).toEqual(enElAncla);
  });
});

interface CasoDePrueba { id: string; then?: string; expected_result?: string }
const SPEC_CIERRE = "aitri/features/cierre-de-mes/spec/03_TEST_CASES.json";

function casosEn(texto: string): CasoDePrueba[] {
  return (JSON.parse(texto) as { test_cases: CasoDePrueba[] }).test_cases;
}

describe("NFR-2507 — tocar los fixtures de cierre-de-mes no toca sus resultados esperados", () => {
  /** @aitri-trace FR-ID: NFR-2507, US-ID: US-2507, AC-ID: AC-2507a, TC-ID: TC-DDC-384e */
  it("TC-DDC-384e: cierre-de-mes conserva id, then y expected_result de todos sus TCs", () => {
    // @aitri-tc TC-DDC-384e
    const antes = casosEn(
      execFileSync("git", ["show", `${ANCLA}:${SPEC_CIERRE}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }),
    );
    const ahora = casosEn(readFileSync(path.join(ROOT, SPEC_CIERRE), "utf8"));

    // Que el ancla traiga casos de verdad: si el `git show` devolviera una lista vacía, todas las
    // comparaciones de abajo pasarían sin comparar nada.
    expect(antes.length).toBeGreaterThan(0);
    expect(ahora.map((c) => c.id).sort()).toEqual(antes.map((c) => c.id).sort());

    const previo = new Map(antes.map((c) => [c.id, c] as const));
    const diferencias = ahora
      .filter((c) => {
        const p = previo.get(c.id);
        return p?.then !== c.then || p?.expected_result !== c.expected_result;
      })
      .map((c) => c.id);
    expect(diferencias).toEqual([]);
  });
});
