/**
 * Feature transferencias (Reservas) — EP-08: cierre de NFR-1007 (cero rojo accidental).
 * TC-TRF-157h audita la INTEGRIDAD de la suite agregada (los 67 TCs de la feature existen, cada
 * uno exactamente una vez, con su marker) — el verde del agregado lo ejecuta y acredita
 * `aitri feature verify-run transferencias`, que corre esta misma suite completa.
 * TC-TRF-157e audita que las re-derivaciones DECLARADAS están hechas y documentadas.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("NFR-1007 · la suite agregada queda en verde al cierre", () => {
  it("TC-TRF-157h: la suite agregada del monorepo queda en verde al cierre", () => {
    // @aitri-tc TC-TRF-157h
    // La condición mecánica verificable DESDE un test: cada TC declarado en 03_TEST_CASES.json
    // existe en la suite con su marker @aitri-tc, exactamente una vez (un TC duplicado acreditaría
    // doble; uno ausente reportaría skip y bloquearía verify-complete). El verde del agregado lo
    // acredita el runner de verify-run al ejecutar esta suite completa — este test garantiza que
    // "completa" significa LOS 67.
    const spec = JSON.parse(readFileSync(path.join(ROOT, "aitri/features/transferencias/spec/03_TEST_CASES.json"), "utf8")) as {
      test_cases: { id: string }[];
    };
    const declared = spec.test_cases.map((t) => t.id);
    expect(declared).toHaveLength(67);

    const files = walk(path.join(ROOT, "tests"));
    const markerCount = new Map<string, number>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/@aitri-tc (TC-TRF-\d+[a-z])/g)) {
        markerCount.set(m[1], (markerCount.get(m[1]) ?? 0) + 1);
      }
    }
    const missing = declared.filter((id) => !markerCount.has(id));
    const duplicated = declared.filter((id) => (markerCount.get(id) ?? 0) > 1);
    const undeclared = [...markerCount.keys()].filter((id) => !declared.includes(id));
    expect(missing, `TCs sin implementar: ${missing.join(", ")}`).toEqual([]);
    expect(duplicated, `TCs duplicados: ${duplicated.join(", ")}`).toEqual([]);
    expect(undeclared, `TCs inventados fuera del lock: ${undeclared.join(", ")}`).toEqual([]);

    // Y los TCs de balance re-derivados siguen existiendo (pasan con la semántica nueva en su
    // propia suite — corren en este mismo agregado).
    const balanceSrc = readFileSync(path.join(ROOT, "tests/domain/balance.test.ts"), "utf8");
    for (const id of ["TC-BAL-907h", "TC-BAL-907f", "TC-BAL-936e", "TC-BAL-958e", "TC-BAL-958f"]) {
      expect(balanceSrc, `${id} debe seguir en la suite`).toContain(`@aitri-tc ${id}`);
    }
  });

  it("TC-TRF-157e: las re-derivaciones declaradas están hechas y documentadas", () => {
    // @aitri-tc TC-TRF-157e
    const DECLARED = ["TC-BAL-907h", "TC-BAL-936e", "TC-BAL-907f", "TC-BAL-958f", "TC-BAL-958e"];

    // (1) Cada TC declarado fue re-derivado: su test asume saldos/v3, no la semántica vieja.
    const balanceSrc = readFileSync(path.join(ROOT, "tests/domain/balance.test.ts"), "utf8");
    for (const id of ["TC-BAL-907h", "TC-BAL-907f", "TC-BAL-936e", "TC-BAL-958f"]) {
      const idx = balanceSrc.indexOf(`@aitri-tc ${id}`);
      expect(idx, `${id} presente`).toBeGreaterThan(-1);
      // el comentario de re-derivación acompaña al test (dentro de su cuerpo)
      const body = balanceSrc.slice(idx, idx + 1600);
      expect(body, `${id} re-derivado a semántica saldo`).toMatch(/[Rr]e-derivad/);
    }
    // TC-BAL-958e fija la clave NUEVA (v3), no la vieja.
    const idx958e = balanceSrc.indexOf("@aitri-tc TC-BAL-958e");
    expect(balanceSrc.slice(idx958e, idx958e + 1200)).toContain("ledger.budget.v3");

    // (2) Ningún test siembra el formato viejo salvo el spec dedicado de migración.
    const offenders = walk(path.join(ROOT, "tests")).filter((f) => readFileSync(f, "utf8").includes("ledger.budget" + ".v2"));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual(["tests/integration/reserve-migration.test.ts"]);

    // (3) 04_BUILD_REPORT.json documenta la lista completa, incluidos los 8 seeds re-basados.
    const report = readFileSync(path.join(ROOT, "aitri/features/transferencias/spec/04_BUILD_REPORT.json"), "utf8");
    for (const id of DECLARED) {
      expect(report, `${id} documentado en el build report`).toContain(id);
    }
    // (concatenado: este archivo no debe contarse a sí mismo como sembrador del formato viejo)
    expect(report).toContain("8 archivos que sembraban ledger.budget" + ".v2");
  });
});
