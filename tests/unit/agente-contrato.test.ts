/**
 * Feature tony-ledger · EP-05 — Contrato y despliegue.
 *
 * Módulo:       tests/unit/agente-contrato.test.ts
 * Propósito:    Que el documento del contrato describa lo que el servidor hace de verdad —las siete
 *               operaciones y todos los códigos de rechazo— y no contenga secretos (FR-3419), y que
 *               las pruebas de la feature vivan donde el CI ya mira (NFR-3413).
 * Dependencias: el sistema de archivos del repositorio y `git ls-files`; ninguna base de datos.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AGENT_ERROR_CODES } from "@/server/agent/codes";

const ROOT = process.cwd();
const leer = (ruta: string): string => readFileSync(path.join(ROOT, ruta), "utf8");
const versionados = (): string[] =>
  execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

/** El formato de un token, armado por partes para que ESTE archivo no contenga uno. */
const TOKEN = new RegExp("tla_" + "[A-Za-z0-9_-]{43}");

/** Las siete operaciones del contrato, como las titula el documento. */
const OPERACIONES = [
  "`GET /tree`", "`GET /movements`", "`POST /movements`", "`PATCH /movements/{key}`",
  "`DELETE /movements/{key}`", "`GET /summary`", "`GET /period`",
];

describe("FR-3419 — el contrato documentado", () => {
  it("TC-AGT-190h: la documentación describe las siete operaciones", () => {
    // @aitri-tc TC-AGT-190h
    const doc = leer("docs/agent-api.md");
    const secciones = doc.split(/^### /m).slice(1);
    for (const op of OPERACIONES) {
      const seccion = secciones.find((s) => s.startsWith(`${OPERACIONES.indexOf(op) + 1}. ${op}`));
      expect(seccion, `falta la sección de ${op}`).toBeDefined();
      // Cada operación trae al menos un bloque de ejemplo en JSON.
      expect(seccion!.includes("```json"), `${op} no trae ejemplo`).toBe(true);
    }
    expect(secciones.filter((s) => /^\d\. `/.test(s))).toHaveLength(7);
    // POST enseña la petición de un gasto y la de una operación de bolsillo.
    const post = secciones.find((s) => s.startsWith("3. `POST /movements`"))!;
    expect(post).toContain('"type": "expense"');
    expect(post).toContain('"type": "transfer"');
    // Y explica cómo crear, listar y revocar un token, y cómo encender la puerta.
    for (const pieza of ["agent-token.mjs create", "agent-token.mjs list", "agent-token.mjs revoke", "LEDGER_AGENT_API", "LEDGER_AGENT_SOURCES"]) {
      expect(doc, pieza).toContain(pieza);
    }
    // Cada cifra del resumen, con el nombre que le da la app.
    for (const cifra of ["Presupuestado", "Ejecutado", "Disponible", "Saldo reservado", "Saldo de bolsillo", "`remaining`"]) {
      expect(doc, cifra).toContain(cifra);
    }
  });

  it("TC-AGT-191f: ningún token con formato válido en la documentación ni en los ejemplos", () => {
    // @aitri-tc TC-AGT-191f
    const archivos = versionados().filter((f) =>
      /^(docs|scripts|src|aitri)\//.test(f) || /^[^/]+\.(md|yml|yaml|example|json|sh|mjs)$/.test(f) || f === ".env.example");
    expect(archivos.length).toBeGreaterThan(100);
    expect(archivos).toContain("docs/agent-api.md");
    const conToken = archivos.filter((f) => existsSync(path.join(ROOT, f)) && !f.endsWith("package-lock.json") && TOKEN.test(leer(f)));
    expect(conToken).toEqual([]);
    // El detector sí detecta: un token armado aquí mismo casa con el patrón.
    expect(TOKEN.test("tla_" + "A".repeat(43))).toBe(true);
    expect(TOKEN.test("tla_" + "A".repeat(42))).toBe(false);
  });

  it("TC-AGT-192e: todos los códigos de rechazo que el servidor emite están documentados", () => {
    // @aitri-tc TC-AGT-192e
    const doc = leer("docs/agent-api.md");
    expect(AGENT_ERROR_CODES).toHaveLength(16);
    const tabla = doc.slice(doc.indexOf("## Errors"));
    const faltan = AGENT_ERROR_CODES.filter((c) => !tabla.includes(`| \`${c}\` |`));
    expect(faltan).toEqual([]);
    // Y al revés: el documento no promete un código que el servidor no conoce.
    const documentados = [...tabla.matchAll(/^\| `([a-z_]+)` \| \d{3} \|/gm)].map((m) => m[1]);
    expect(documentados.sort()).toEqual([...AGENT_ERROR_CODES].sort());
    // Cada código que aparece en el código fuente de la superficie está en la lista.
    const fuente = ["src/server/agent/http.ts", "src/server/agent/responses.ts"].map(leer).join("\n");
    const emitidos = new Set([...fuente.matchAll(/(?:apiError\(|code: )"([a-z_]+)"/g)].map((m) => m[1]));
    expect(emitidos.size).toBeGreaterThan(10);
    for (const c of emitidos) expect(AGENT_ERROR_CODES as readonly string[], c).toContain(c);
  });
});

describe("NFR-3413 — el CI corre las pruebas de la feature", () => {
  const archivosConTc = (): string[] =>
    versionados().filter((f) => /^tests\/.*\.(test|spec)\.tsx?$/.test(f) && /(it|test)\("TC-AGT-\d+[hef]/.test(leer(f)));

  it("TC-AGT-260h: el CI ejecuta la suite completa en push y en pull request", () => {
    // @aitri-tc TC-AGT-260h
    const ci = leer(".github/workflows/ci.yml");
    expect(ci).toMatch(/^on:\n(?:.*\n)*?  push:\n    branches: \[main\]/m);
    expect(ci).toMatch(/^  pull_request:\n    branches: \[main, staging, develop\]/m);
    // Las tres corridas que acreditan los casos de esta feature: vitest, e2e y e2e de backend.
    expect(ci).toMatch(/run: npm run test:run\b/);
    expect(ci).toMatch(/npm run test:e2e\b/);
    expect(ci).toMatch(/run: npx playwright test --config playwright\.backend\.config\.ts/);
    const pkg = JSON.parse(leer("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:run"]).toBe("vitest run");
    expect(pkg.scripts["test:e2e"]).toBe("./e2e.sh");
  });

  it("TC-AGT-263e: las pruebas de la feature viven donde los runners ya miran", () => {
    // @aitri-tc TC-AGT-263e
    const archivos = archivosConTc();
    expect(archivos.length).toBeGreaterThanOrEqual(10);
    // Lo que recoge cada runner, tal como lo declaran vitest.config.ts y playwright.config.ts.
    const vitest = /^tests\/(domain|unit|integration)\/.+\.test\.ts$/;
    const playwright = /^tests\/e2e\/[^/]+\.spec\.ts$/;
    const fuera = archivos.filter((f) => !vitest.test(f) && !playwright.test(f));
    expect(fuera).toEqual([]);
    const cfg = leer("vitest.config.ts");
    for (const patron of ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/integration/backend/**/*.test.ts"]) {
      expect(cfg, patron).toContain(patron);
    }
    expect(leer("playwright.config.ts")).toContain('testDir: "./tests/e2e"');
    // Los 172 casos del plan tienen su prueba, cada uno en un solo sitio.
    const plan = JSON.parse(leer("aitri/features/tony-ledger/spec/03_TEST_CASES.json")) as { test_cases: { id: string }[] };
    const escritos = archivos.flatMap((f) => [...leer(f).matchAll(/(?:it|test)\("(TC-AGT-\d+[hef])/g)].map((m) => m[1]!));
    expect(new Set(escritos).size).toBe(escritos.length);
    expect([...escritos].sort()).toEqual(plan.test_cases.map((t) => t.id).sort());
  });

  it("TC-AGT-264f: no hay un comando de pruebas aparte que el CI no llame", () => {
    // @aitri-tc TC-AGT-264f
    const pkg = JSON.parse(leer("package.json")) as { scripts: Record<string, string> };
    const ci = leer(".github/workflows/ci.yml");
    const deAgente = Object.entries(pkg.scripts).filter(([nombre, cmd]) =>
      /agent|agente|tony/i.test(`${nombre} ${cmd}`) && /vitest|playwright|test/.test(cmd));
    const sinLlamar = deAgente.filter(([nombre]) => !ci.includes(`npm run ${nombre}`));
    expect(sinLlamar).toEqual([]);
    // Tampoco una configuración de runner propia para la feature.
    expect(versionados().filter((f) => /^(vitest|playwright)\..*(agent|agente|tony).*\.ts$/i.test(f))).toEqual([]);
  });
});
