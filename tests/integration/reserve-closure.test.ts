// @vitest-environment jsdom
/**
 * Feature transferencias · modelo v4 — NFR-1007: la suite re-derivada está completa (biyección
 * spec↔tests) y los formatos viejos viven solo en el spec de migración.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TESTS = path.join(ROOT, "tests");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("NFR-1007 · cierre de la suite re-derivada", () => {
  it("TC-TRF4-157h: cada TC del spec aparece exactamente una vez en la suite", () => {
    // @aitri-tc TC-TRF4-157h
    const spec = JSON.parse(readFileSync(path.join(ROOT, "aitri/features/transferencias/spec/03_TEST_CASES.json"), "utf8"));
    const specIds: string[] = spec.test_cases.map((t: { id: string }) => t.id);
    expect(specIds.length).toBeGreaterThanOrEqual(60);

    const markerCount = new Map<string, number>();
    for (const file of walk(TESTS)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/@aitri-tc (TC-TRF4-\d+[hef])/g)) {
        markerCount.set(m[1], (markerCount.get(m[1]) ?? 0) + 1);
      }
    }
    const missing = specIds.filter((id) => !markerCount.has(id));
    const dupes = specIds.filter((id) => (markerCount.get(id) ?? 0) > 1);
    expect(missing, `sin test: ${missing.join(", ")}`).toEqual([]);
    expect(dupes, `duplicados: ${dupes.join(", ")}`).toEqual([]);
    // El build report documenta la re-derivación v3→v4.
    const report = readFileSync(path.join(ROOT, "aitri/features/transferencias/spec/04_BUILD_REPORT.json"), "utf8");
    expect(report).toMatch(/TC-TRF4|re-deriv/i);
  });

  it("TC-TRF4-157e: los formatos viejos solo se siembran en el spec de migración", () => {
    // @aitri-tc TC-TRF4-157e
    const allowed = path.join(TESTS, "integration", "reserve-migration.test.ts");
    const offenders: string[] = [];
    for (const file of walk(TESTS)) {
      if (file === allowed) continue;
      const src = readFileSync(file, "utf8");
      if (src.includes("ledger.budget" + ".v2") || src.includes("ledger.budget" + ".v3") || /version:\s*3\s*,\s*budgets/.test(src)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("TC-TRF4-157f: no hay marcadores TC-TRF4 fuera del spec ni tests sin marcador válido", () => {
    // @aitri-tc TC-TRF4-157f
    const spec = JSON.parse(readFileSync(path.join(ROOT, "aitri/features/transferencias/spec/03_TEST_CASES.json"), "utf8"));
    const specIds = new Set<string>(spec.test_cases.map((t: { id: string }) => t.id));
    const strays: string[] = [];
    for (const file of walk(TESTS)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/@aitri-tc (TC-TRF4-[\w]+)/g)) {
        if (!specIds.has(m[1])) strays.push(`${path.relative(ROOT, file)}: ${m[1]}`);
      }
    }
    expect(strays, `marcadores huérfanos: ${strays.join(", ")}`).toEqual([]);
  });
});
