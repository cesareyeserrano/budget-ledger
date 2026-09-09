/**
 * Feature servidor-fuente-unica — TCs unitarios y de gate estático (entorno node).
 *
 * Dos grupos:
 *   · contrato: qué sobrevive al retiro del repositorio de localStorage (FR-1105/FR-1106) y qué
 *     hace el store cuando no hay `window` (SSR, FR-1101).
 *   · gates: el guion `no-legacy-mode.sh` y las condiciones de arranque sin el flag retirado
 *     (NFR-1107/NFR-1108). Se ejercitan EJECUTÁNDOLOS, incluido el caso en que deben fallar —
 *     un gate que nunca se vio fallar no protege nada.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync, readFileSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { InMemoryRepository } from "../helpers/inMemoryRepository";
import { buildSeed } from "@/domain";
import { P0 } from "../helpers/periods";

const ROOT = path.resolve(__dirname, "../..");
const GATE = path.join(ROOT, "scripts/no-legacy-mode.sh");

/**
 * Ejecuta el gate sobre una raíz y devuelve su exit code (0 = limpio, 1 = reapareció lo retirado).
 * Sin argumento mira el checkout real, que es lo que interesa comprobar de verdad.
 */
function runGate(raiz?: string): { code: number; out: string } {
  const r = spawnSync(GATE, raiz ? [raiz] : [], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const temporales: string[] = [];
const arbolesTemp: string[] = [];

/**
 * BG-035 — ÁRBOL PROPIO PARA LAS SONDAS. Plantarlas en el checkout compartido era un defecto real,
 * no una incomodidad: `aitri verify-run` corre unit.sh Y coverage.sh, o sea la MISMA suite dos veces
 * sobre el mismo árbol, así que la corrida que plantaba `src/__probe_legacy__.ts` envenenaba a la
 * que estaba afirmando que src/ seguía limpio. Medido el 2026-09-09: runner exit 1 con 876/877 en
 * verde y este TC como único rojo. Es la familia de BG-033, que ya lo arregló así para secret-scan.
 *
 * El árbol lleva un src/ con un fichero limpio porque el gate aborta con exit 2 si no existe src/.
 */
function arbolSonda(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-no-legacy-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src/limpio.ts"), "export const ok = true;\n");
  arbolesTemp.push(dir);
  return dir;
}

function tempFile(rel: string, content: string, base: string = ROOT): string {
  const abs = path.join(base, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  temporales.push(abs);
  return abs;
}

afterEach(() => {
  while (temporales.length) rmSync(temporales.pop()!, { force: true });
  while (arbolesTemp.length) rmSync(arbolesTemp.pop()!, { recursive: true, force: true });
});

describe("FR-1101 — construcción del repositorio en SSR", () => {
  it("TC-SFU-101e: en SSR (sin window) la construcción del repositorio devuelve null sin lanzar", async () => {
    // @aitri-tc TC-SFU-101e
    // Este archivo corre en entorno node: no hay `window`, que es exactamente el escenario SSR.
    expect(typeof globalThis.window).toBe("undefined");

    let fetchLlamado = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { fetchLlamado += 1; return new Response(null, { status: 204 }); }) as typeof fetch;
    try {
      const { useLedgerStore } = await import("@/state/store");
      // El import no lanzó y el estado es utilizable.
      expect(useLedgerStore.getState().data.nodes.length).toBeGreaterThan(0);

      await useLedgerStore.getState().hydrate();
      // Marca hidratado para no bloquear el render, y sin emitir ninguna petición.
      expect(useLedgerStore.getState().hydrated).toBe(true);
      expect(fetchLlamado).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("FR-1105 / FR-1106 — el contrato sobrevive al retiro de la implementación local", () => {
  it("TC-SFU-105h: el contrato LedgerRepository sobrevive al retiro de la implementación local", async () => {
    // @aitri-tc TC-SFU-105h
    const mod = await import("@/data/repository");
    const exports = Object.keys(mod);

    // La interfaz es de tipos: no deja export en runtime, y el módulo carga sin lanzar.
    expect(mod).toBeDefined();
    // Lo retirado ya no se exporta por ningún nombre.
    expect(exports).not.toContain("LocalStorageRepository");
    expect(exports).not.toContain("stripLegacyUnassigned");
    expect(exports).not.toContain("LEGACY_BUDGET_KEYS");

    // Y lo que el FR exige CONSERVAR sigue vivo en sus módulos: la conversión v3→v4 no se retiró
    // (ADR-04 corregido), solo desapareció su llamador de localStorage.
    const migrate = await import("@/domain/migrate");
    expect(typeof migrate.migrateStateV3toV4).toBe("function");
    const types = await import("@/domain/types");
    expect(types.STORAGE_KEYS.nodes).toBe("ledger.nodes.v1");
  });

  it("TC-SFU-106e: el fake InMemoryRepository satisface el mismo contrato que el real", async () => {
    // @aitri-tc TC-SFU-106e
    const repo = new InMemoryRepository();
    const estado = buildSeed("local", P0);
    estado.budgets["c-ahorros"] = { ...estado.budgets["c-ahorros"], "2026-06": 25000 };

    expect(await repo.save("local", estado)).toBe(true);
    const leido = await repo.load("local");
    expect(leido!.budgets["c-ahorros"]!["2026-06"]).toBe(25000);

    // Aislamiento por owner: un owner desconocido devuelve null, igual que un 204 del servidor.
    expect(await repo.load("otro")).toBeNull();

    // Copia profunda: mutar lo devuelto no altera lo "persistido" (si no, un test se engañaría solo).
    leido!.budgets["c-ahorros"]!["2026-06"] = 1;
    expect((await repo.load("local"))!.budgets["c-ahorros"]!["2026-06"]).toBe(25000);
  });
});

describe("NFR-1104 — la cobertura previa no se retiró", () => {
  it("TC-SFU-204f: ningún test de la suite existente se retira sin estar declarado", async () => {
    // @aitri-tc TC-SFU-204f
    // Tras corregir ADR-04, el diseño NO declara ningún archivo de test retirado: los cuatro que
    // se apoyaban en LocalStorageRepository se RE-APUNTAN (a ServerRepository o al fake). Este TC
    // comprueba que siguen existiendo y con contenido — un borrado silencioso lo tumba.
    const reapuntados = [
      "tests/integration/persistence.test.ts",
      "tests/integration/reserve-migration.test.ts",
      "tests/integration/feature-stack.test.ts",
      "tests/integration/backend/repo-sync.test.ts",
    ];
    for (const rel of reapuntados) {
      const abs = path.join(ROOT, rel);
      expect(existsSync(abs), `${rel} fue retirado sin declararlo`).toBe(true);
      const src = readFileSync(abs, "utf8");
      expect(src.length, `${rel} quedó vacío`).toBeGreaterThan(200);
      // Re-apuntados de verdad: ninguno sigue importando la clase retirada.
      expect(src).not.toMatch(/from ["']@\/data\/localStorageRepository["']/);
    }

    // El diseño sigue sin declarar retiradas: si alguien retira un archivo, debe declararlo aquí.
    const trd = readFileSync(path.join(ROOT, "aitri/features/servidor-fuente-unica/spec/02_SYSTEM_DESIGN.md"), "utf8");
    expect(trd).toContain("ADR-04");
  });
});

describe("NFR-1107 — gate estático no-legacy-mode", () => {
  it("TC-SFU-207h: el gate no-legacy-mode pasa cuando el código está limpio", () => {
    // @aitri-tc TC-SFU-207h
    const { code, out } = runGate();
    expect(code, out).toBe(0);
    expect(out).toMatch(/src\/ limpio/);
  });

  it("TC-SFU-207e: el gate ignora tests y documentación, solo mira src/", () => {
    // @aitri-tc TC-SFU-207e
    // Mencionar los nombres retirados fuera de src/ es legítimo (explicar QUÉ se retiró); hacerlo
    // fallar sería un falso positivo que obligaría a borrar la explicación para pasar el gate.
    const raiz = arbolSonda();
    tempFile("tests/__probe_legacy__.ts", "export const x = 'LocalStorageRepository';\n", raiz);
    tempFile("docs/__probe_legacy__.md", "El flag SERVER_MODE se retiró en esta feature.\n", raiz);

    const { code, out } = runGate(raiz);
    expect(code, out).toBe(0);
  });

  it("TC-SFU-207f: el gate falla si alguien reintroduce el flag en src/", () => {
    // @aitri-tc TC-SFU-207f
    // El gate se prueba FALLANDO: si no falla aquí, no protege nada.
    const raiz = arbolSonda();
    tempFile("src/__probe_legacy__.ts", "export const SERVER_MODE = true;\n", raiz);

    const { code, out } = runGate(raiz);
    expect(code).toBe(1);
    expect(out).toMatch(/reapareció el modo retirado/);
    expect(out).toContain("__probe_legacy__.ts");
  });
});

describe("NFR-1108 — arranque y CI sin el flag retirado", () => {
  it("TC-SFU-208h: la suite e2e arranca sin definir NEXT_PUBLIC_LEDGER_SERVER_MODE", () => {
    // @aitri-tc TC-SFU-208h
    // El arranque real de la suite se prueba en cada corrida e2e; lo que este TC blinda es que su
    // preparación dejó de inyectar el flag — reintroducirlo ahí resucitaría el modo por la puerta
    // de atrás sin tocar src/, que es justo el punto ciego del gate anterior.
    // Se busca la ASIGNACIÓN, no la mención: los comentarios que explican qué se retiró son
    // deseables, y prohibirlos obligaría a borrar la explicación para pasar el test.
    const asignacion = /NEXT_PUBLIC_LEDGER_SERVER_MODE\s*[:=]\s*["'`]/;
    for (const rel of ["tests/e2e/helpers/globalSetup.ts", "tests/e2e-backend/helpers/globalSetup.ts"]) {
      const abs = path.join(ROOT, rel);
      if (!existsSync(abs)) continue;
      expect(readFileSync(abs, "utf8"), `${rel} sigue inyectando el flag retirado`).not.toMatch(asignacion);
    }
    expect(process.env.NEXT_PUBLIC_LEDGER_SERVER_MODE).toBeUndefined();
  });

  it("TC-SFU-208e: la app arranca sin la variable en el entorno de ejecución", () => {
    // @aitri-tc TC-SFU-208e
    // El validador de entorno del proyecto es quien decide si falta algo para arrancar: se ejecuta
    // con DATABASE_URL y BETTER_AUTH_* presentes y SIN el flag, y debe dar exit 0.
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://u:p@localhost:5432/db",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "x".repeat(32),
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    };
    delete (env as Record<string, string | undefined>).NEXT_PUBLIC_LEDGER_SERVER_MODE;

    const r = spawnSync("node", ["scripts/check-env.mjs"], { cwd: ROOT, encoding: "utf8", env });
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);

    // Y ninguna configuración de DESPLIEGUE la sigue fijando. El Dockerfile es el punto ciego que
    // de verdad importa: el gate no-legacy-mode solo mira src/, así que un `ENV ...=true` ahí
    // resucitaba el flag en cada imagen construida sin que nada lo detectara.
    const asignacion = /NEXT_PUBLIC_LEDGER_SERVER_MODE\s*[:=]\s*\S/;
    for (const rel of ["Dockerfile", "docker-compose.yml", "docker-compose.dev.yml", ".env.example"]) {
      const abs = path.join(ROOT, rel);
      if (!existsSync(abs)) continue;
      expect(readFileSync(abs, "utf8"), `${rel} sigue fijando el flag retirado`).not.toMatch(asignacion);
    }
  });

  // Cinturón anti-recursión: este es el ÚNICO test que aún lanza el runner del proyecto, y lo hace
  // sobre UN fichero que no es este, así que hoy no puede reentrar. La marca existe para el día en
  // que alguien amplíe ese alcance: la corrida anidada la hereda y el test se salta en vez de
  // lanzar otra suite. Una prueba que relanza la suite en la que vive costó una máquina entera
  // (feature reglas-en-el-servidor, 2026-09-03).
  it.skipIf(!!process.env.VITEST_NESTED)("TC-SFU-208f: un test roto sigue haciendo fallar el job con exit code distinto de 0", { timeout: 120_000 }, () => {
    // @aitri-tc TC-SFU-208f
    // Un pipeline que no puede fallar no verifica nada. Se corre un test que falla a propósito con
    // el MISMO runner del proyecto y se exige exit ≠ 0.
    // BG-035 — LA SONDA VA EN SU PROPIA RAÍZ, no en tests/unit/. Plantar aquí un test que falla a
    // propósito dentro del glob del proyecto `app` era una bomba de relojería bajo concurrencia:
    // verify-run corre unit.sh y coverage.sh a la vez, y si la segunda recolectaba mientras esta
    // sonda existía, se llevaba un rojo llamado "sonda: debe fallar" sin ninguna relación con el
    // código. Con `--root` vitest recolecta SOLO dentro del árbol temporal; la sonda no usa alias
    // ni helpers del proyecto, así que no necesita su configuración.
    const raiz = mkdtempSync(path.join(os.tmpdir(), "ledger-probe-failing-"));
    arbolesTemp.push(raiz);
    tempFile("sonda.test.ts", 'import { it, expect } from "vitest";\nit("sonda: debe fallar", () => { expect(1).toBe(2); });\n', raiz);

    const r = spawnSync("npx", ["vitest", "run", "--root", raiz], {
      cwd: ROOT, encoding: "utf8", env: { ...process.env, CI: "true", VITEST_NESTED: "1" },
    });
    expect(r.status).not.toBe(0);

    // Y el job de CI no neutraliza ese fallo con continue-on-error.
    const ci = path.join(ROOT, ".github/workflows/ci.yml");
    if (existsSync(ci)) expect(readFileSync(ci, "utf8")).not.toContain("continue-on-error");
  });
});
