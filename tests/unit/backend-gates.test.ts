/**
 * Epic 5 (backend) — CI/CD + gates de seguridad + regresión de suite (estructural, sin BD).
 * TCs: NFR-503 (053h,054e,055f) · NFR-513 (084h,085e,086f) · NFR-509 (071h,072e,073f).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildSeed, rollupBudget } from "@/domain";

const ROOT = process.cwd();
const ci = () => readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** Corre un comando; devuelve el exit code (0 si ok). */
function runExit(cmd: string, args: string[], cwd = ROOT): number {
  try {
    execFileSync(cmd, args, { cwd, stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

describe("NFR-503 — CI corre la suite completa en push a main", () => {
  it("TC-BE-053h: el workflow existe, se dispara en push a main y corre unit + e2e", () => {
    // @aitri-tc TC-BE-053h
    expect(existsSync(path.join(ROOT, ".github/workflows/ci.yml"))).toBe(true);
    const yml = ci();
    expect(yml).toMatch(/on:/);
    expect(yml).toMatch(/push:/);
    expect(yml).toMatch(/branches:\s*\[main\]/);
    expect(yml).toMatch(/test:run/); // unit + integration
    expect(yml).toMatch(/test:e2e|playwright test/); // e2e
  });

  it("TC-BE-054e: el workflow incluye explícitamente el runner Playwright e2e", () => {
    // @aitri-tc TC-BE-054e
    const yml = ci();
    expect(yml).toMatch(/playwright install/);
    // Corre tanto el e2e existente (modo localStorage) como el del backend (modo servidor).
    expect(yml).toMatch(/test:e2e/);
    expect(yml).toMatch(/playwright\.backend\.config\.ts/);
  });

  it("TC-BE-055f: un test que falla hace fallar el runner (exit ≠ 0)", () => {
    // @aitri-tc TC-BE-055f
    // Vitest corre en un dir temporal aislado con un test que falla → exit ≠ 0.
    const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-fail-"));
    try {
      writeFileSync(path.join(dir, "vitest.config.ts"), `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["*.test.ts"] } });\n`);
      writeFileSync(path.join(dir, "broken.test.ts"), `import { it, expect } from "vitest";\nit("falla a propósito", () => { expect(1).toBe(2); });\n`);
      const code = runExit("npx", ["vitest", "run", "--root", dir, "--config", path.join(dir, "vitest.config.ts")], dir);
      expect(code).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("NFR-513 — gates de seguridad automatizados", () => {
  it("TC-BE-084h: el CI ejecuta un gate SCA (npm audit) que falla ante vuln alta/crítica", () => {
    // @aitri-tc TC-BE-084h
    const yml = ci();
    expect(yml).toMatch(/npm audit --audit-level=high/);
    // El gate SCA pasa hoy (sin vulns high/critical); fallaría (exit≠0) si apareciera una.
    expect(runExit("npm", ["audit", "--audit-level=high"])).toBe(0);
  });

  it("TC-BE-085e: el gate de secretos detecta un secreto plantado y pasa el árbol limpio", () => {
    // @aitri-tc TC-BE-085e
    expect(runExit("bash", ["scripts/secret-scan.sh"])).toBe(0); // árbol limpio → pasa
    const planted = path.join(ROOT, "src", "__planted_secret_test.ts");
    try {
      writeFileSync(planted, `const k = "AKIAIOSFODNN7EXAMPLE"; export default k;\n`);
      expect(runExit("bash", ["scripts/secret-scan.sh"])).not.toBe(0); // secreto → falla
    } finally {
      rmSync(planted, { force: true });
    }
  });

  it("TC-BE-086f: el workflow declara AMBOS gates de seguridad y se dispara en push a main", () => {
    // @aitri-tc TC-BE-086f
    const yml = ci();
    expect(yml).toMatch(/npm audit --audit-level=high/); // SCA
    expect(yml).toMatch(/secret-scan\.sh/); // secretos
    expect(yml).toMatch(/push:/);
    expect(yml).toMatch(/branches:\s*\[main\]/);
  });
});

describe("NFR-509 — la suite y las verificaciones estáticas permanecen verdes", () => {
  it("TC-BE-071h: las suites de las features previas siguen presentes en el runner", () => {
    // @aitri-tc TC-BE-071h
    // El runner incluye los tests de root + features previas (verify-run los corre a todos en verde).
    for (const f of [
      "tests/domain/budget-state.test.ts",
      "tests/e2e/grid-ux.spec.ts",
      "tests/e2e/budget-state-color.spec.ts",
      "tests/e2e/ux-consistency.spec.ts",
      "tests/e2e/feature-stack.spec.ts",
    ]) {
      expect(existsSync(path.join(ROOT, f))).toBe(true);
    }
    const vitestCfg = readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    expect(vitestCfg).toMatch(/tests\/domain\/\*\*/);
  });

  it("TC-BE-072e: typecheck y lint terminan con exit 0", () => {
    // @aitri-tc TC-BE-072e
    expect(runExit("npm", ["run", "typecheck"])).toBe(0);
    expect(runExit("npm", ["run", "lint"])).toBe(0);
  }, 60_000);

  it("TC-BE-073f: la suite es falsable — el cálculo del dominio es sensible a su entrada", () => {
    // @aitri-tc TC-BE-073f
    // Una mutación del cálculo cambiaría el resultado: rollup es sensible a los datos, así que un TC
    // que fija su salida fallaría si el cálculo se rompiera (no es un pase vacío).
    const seed = buildSeed("A");
    const real = rollupBudget(seed, "g-esenciales", "jun");
    const mutated = { ...seed, budgets: { ...seed.budgets } };
    // Alterar el presupuesto de una hoja del grupo cambia el roll-up (prueba de sensibilidad).
    const leaf = seed.nodes.find((n) => n.type === "expense" && n.level !== "group" && seed.budgets[n.id]?.jun)!;
    mutated.budgets[leaf.id] = { ...seed.budgets[leaf.id], jun: (seed.budgets[leaf.id]!.jun ?? 0) + 12345 };
    expect(rollupBudget(mutated, "g-esenciales", "jun")).toBe(real + 12345);
    expect(rollupBudget(mutated, "g-esenciales", "jun")).not.toBe(real);
  });
});
