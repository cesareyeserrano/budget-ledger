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
    //
    // BL-024 — este TC EJECUTABA `npm audit` contra la red desde la suite unitaria. Bajo la carga
    // del e2e en paralelo llegó a tardar 287 s y agotó el timeout del gate `coverage`, que salió
    // en error siendo required: un test unitario tumbaba un gate por una llamada de red. Peor aún,
    // ponía la suite a merced de lo que el registro de npm publicara esa noche — rojo un lunes por
    // la mañana sin que nadie hubiera tocado el código.
    //
    // Lo que este TC afirma NO se relaja, se coloca donde corresponde. NFR-513 pide que exista un
    // gate SCA automatizado, y eso es una propiedad del CONTRATO: que el gate esté declarado,
    // cableado y sea bloqueante. Se comprueba aquí, en milisegundos y sin red. La EJECUCIÓN real
    // del audit sigue ocurriendo en cada verify-run, en scripts/security-config.sh, que es un
    // quality_gate required — de hecho fue ese camino el que cazó GHSA-2v37-7h3g-55p8 (nanoid).
    //
    // La versión anterior era además más débil de lo que parecía: afirmaba que el árbol está
    // limpio HOY, no que el gate funcione. Un gate desconectado seguía pasando mientras no hubiera
    // vulnerabilidades; ahora un gate desconectado falla aquí.
    const yml = ci();
    expect(yml).toMatch(/npm audit --audit-level=high/);

    // el script del gate contiene de verdad la invocación — el CI no apunta a un cascarón
    const gate = readFileSync(path.join(ROOT, "scripts", "security-config.sh"), "utf8");
    expect(gate).toMatch(/npm audit --audit-level=high/);

    // y está declarado como gate BLOQUEANTE, que es lo que hace que una vuln detenga el despliegue
    const build = JSON.parse(readFileSync(path.join(ROOT, "aitri/product/spec/04_BUILD_REPORT.json"), "utf8"));
    const sca = build.quality_gates.find((g: { name: string }) => g.name === "security-config");
    expect(sca, "el gate security-config no está declarado en 04_BUILD_REPORT.json").toBeDefined();
    expect(sca.required).toBe(true);
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
    //
    // BL-027 — este TC EJECUTABA `npm run typecheck` y `npm run lint` como subprocesos. Medido:
    // 21.191 ms, el 96 % del tiempo de todo este fichero. Y es DUPLICACIÓN pura: los dos están
    // declarados como quality_gates required, así que verify-run ya los corre y ya bloquea el
    // despliegue si fallan. Ejecutarlos otra vez aquí no añadía ninguna señal.
    //
    // El coste no era sólo tiempo. Bajo la carga del e2e, estos subprocesos se ahogan y el worker
    // de vitest pierde el RPC («Timeout calling onTaskUpdate»), de modo que un gate required salía
    // rojo por contención de CPU y no por el código. Peor: cuando Aitri mata el runner por timeout,
    // los workers quedan HUÉRFANOS y siguen consumiendo la máquina — el 2026-08-13 cinco de ellos
    // llevaban 11 horas vivos y dejaron el equipo inutilizable. El bucle se alimenta solo: tests
    // lentos → timeout → huérfanos → máquina más lenta → más timeouts.
    //
    // Se comprueba el CONTRATO, que es lo que este TC significa de verdad: que ambas verificaciones
    // estén cableadas como gates bloqueantes. La ejecución vive donde corresponde.
    //
    // NOTA: TC-BE-055f SÍ conserva su subproceso a propósito. Cuesta 566 ms y es lo único que
    // demuestra que un test en rojo tumba el runner; eso no lo cubre ningún gate.
    const build = JSON.parse(readFileSync(path.join(ROOT, "aitri/product/spec/04_BUILD_REPORT.json"), "utf8"));
    const gates: { name: string; command: string; required?: boolean }[] = build.quality_gates;

    for (const name of ["typecheck", "lint"]) {
      const gate = gates.find((g) => g.name === name);
      expect(gate, `el gate ${name} no está declarado en 04_BUILD_REPORT.json`).toBeDefined();
      expect(gate!.required, `el gate ${name} no es bloqueante`).toBe(true);
    }

    // y los scripts que esos gates invocan existen de verdad — el gate no apunta a un comando fantasma
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.typecheck).toBeTruthy();
    expect(pkg.scripts.lint).toBeTruthy();
  });

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
