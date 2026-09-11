/**
 * Feature ciclos — EP-04: gates estructurales, sin base de datos.
 * TCs: NFR-2401 (100h, 102e) · NFR-2409 (129h) · NFR-2411 (135h, 136e, 137f)
 *
 * Lo que un test de comportamiento no ve: que el modo mes siga siendo byte a byte el de antes, que
 * nadie vuelva a sumar meses a mano fuera de los módulos que conocen el calendario, y que los
 * ficheros de la feature caigan de verdad bajo los runners que acreditan sus TCs.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MONTH_CALENDAR, NO_CYCLES, buildCalendar, planVersionChange, relocate } from "@/domain/cycles";
import { periodRange } from "@/domain/periods";
import { activeKeys, activeRange } from "@/domain/range";
import { computeBalanceSeries } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { rollupActual, rollupBudget } from "@/domain/rollup";
import type { LedgerState } from "@/domain/types";
import { currentPeriodFor } from "@/lib/date";
import { estadoGrande, estadoReal } from "../fixtures/ciclos";
import { mejorTiempo, SALTAR_SI_INSTRUMENTADO } from "../helpers/perf";

const ROOT = process.cwd();

/** `path.matchesGlob` (Node ≥ 22): el proyecto no declara micromatch y no se importa una dependencia transitiva. */
const casa = (file: string, glob: string): boolean =>
  (path as unknown as { matchesGlob(p: string, g: string): boolean }).matchesGlob(file, glob);

// ─────────────────────────────── NFR-2401 ───────────────────────────────
describe("NFR-2401 — el modo mes no cambia", () => {
  it("TC-CIC-100h: MONTH_CALENDAR reproduce periodRange y la serie de balance es byte a byte la de antes", () => {
    // @aitri-tc TC-CIC-100h
    const golden = JSON.parse(readFileSync(path.join(ROOT, "tests/fixtures/ciclos-golden-month.json"), "utf8")) as {
      capturedBefore: string; currentPeriod: string; horizon: 2; keys: string[]; series: unknown;
    };
    // El golden se calculó con el código del commit previo a la feature (activeRange + computeBalanceSeries).
    expect(golden.capturedBefore).toContain("81b2caa");
    expect(MONTH_CALENDAR.keys("2026-08", "2028-12")).toEqual(periodRange("2026-08", "2028-12"));

    const s = estadoReal();
    const keys = activeKeys(s, MONTH_CALENDAR, golden.currentPeriod, golden.horizon);
    expect(keys).toEqual(golden.keys);
    expect(keys).toEqual(activeRange(s, golden.currentPeriod, golden.horizon));
    const series = computeBalanceSeries(s, keys, openingCarry(s, keys));
    expect(JSON.stringify(series)).toBe(JSON.stringify(golden.series));
  });

  const ALLOWLIST = new Set(["src/lib/date.ts", "src/domain/periods.ts", "src/domain/range.ts", "src/domain/cycles.ts", "src/domain/seed.ts"]);
  const LLAMADA = /\b(currentPeriod|periodRange|addMonths)\(/;
  const esComentario = (linea: string) => /^\s*(\/\/|\*|\/\*)/.test(linea);
  function fuentes(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...fuentes(f));
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(f);
    }
    return out;
  }
  /** Llamadas a la aritmética mensual fuera de la allowlist, como «ruta:línea: código». */
  function fueraDeAllowlist(root: string): string[] {
    const hits: string[] = [];
    for (const f of fuentes(path.join(root, "src"))) {
      const rel = path.relative(root, f).split(path.sep).join("/");
      if (ALLOWLIST.has(rel)) continue;
      readFileSync(f, "utf8").split("\n").forEach((linea, i) => {
        if (!esComentario(linea) && LLAMADA.test(linea)) hits.push(`${rel}:${i + 1}: ${linea.trim()}`);
      });
    }
    return hits;
  }

  it("TC-CIC-102e: gate estático — currentPeriod(, periodRange( y addMonths( no aparecen fuera de la allowlist", () => {
    // @aitri-tc TC-CIC-102e
    expect(fueraDeAllowlist(ROOT)).toEqual([]);

    // La sonda: el gate tiene que FALLAR cuando alguien vuelve a sumar meses a mano.
    const tmp = mkdtempSync(path.join(os.tmpdir(), "ciclos-gate-"));
    try {
      mkdirSync(path.join(tmp, "src/components"), { recursive: true });
      writeFileSync(path.join(tmp, "src/components/Sonda.tsx"), [
        "// currentPeriod() en un comentario no cuenta",
        " * addMonths(p, 1) tampoco en un bloque de documentación",
        "export const hoy = currentPeriod();",
        "export const ok = currentPeriodFor(cal);",
      ].join("\n"));
      mkdirSync(path.join(tmp, "src/domain"), { recursive: true });
      writeFileSync(path.join(tmp, "src/domain/periods.ts"), "export const x = addMonths('2026-01', 1);\n");
      expect(fueraDeAllowlist(tmp)).toEqual(["src/components/Sonda.tsx:3: export const hoy = currentPeriod();"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────── NFR-2411 ───────────────────────────────
describe("NFR-2411 — los tests de la feature los recogen los runners declarados", () => {
  /** Proyectos de vitest.config.ts leídos del fuente (sin ejecutarlo): nombre, include y exclude. */
  function proyectosVitest(): Array<{ name: string; include: string[]; exclude: string[] }> {
    const src = readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    const lista = (s?: string) => (s ?? "").match(/"([^"]+)"/g)?.map((x) => x.slice(1, -1)) ?? [];
    const out: Array<{ name: string; include: string[]; exclude: string[] }> = [];
    const re = /name:\s*"([\w-]+)"[\s\S]*?include:\s*\[([^\]]*)\](?:\s*,\s*exclude:\s*\[([^\]]*)\])?/g;
    for (const m of src.matchAll(re)) out.push({ name: m[1]!, include: lista(m[2]), exclude: lista(m[3]) });
    return out;
  }
  const recogeVitest = (file: string) =>
    proyectosVitest().some((p) => p.include.some((g) => casa(file, g)) && !p.exclude.some((g) => casa(file, g)));
  function recogePlaywright(file: string): boolean {
    const src = readFileSync(path.join(ROOT, "playwright.config.ts"), "utf8");
    const dir = path.posix.normalize(src.match(/testDir:\s*"([^"]+)"/)![1]!);
    const match = new RegExp(src.match(/testMatch:\s*\/(.+)\/,/)![1]!);
    return file.startsWith(`${dir}/`) && match.test(file);
  }

  it("TC-CIC-135h: los ficheros de prueba de la feature caen bajo los globs de vitest y playwright", () => {
    // @aitri-tc TC-CIC-135h
    // Guarda contra una lectura rota del config: si el regex dejara de ver los proyectos, todo «casaría» en falso.
    expect(proyectosVitest().map((p) => p.name)).toEqual(["app", "backend"]);
    expect(recogeVitest("tests/domain/ciclos.test.ts")).toBe(true);
    expect(recogeVitest("tests/unit/ciclos-gates.test.ts")).toBe(true);
    expect(recogeVitest("tests/integration/backend/ciclos.test.ts")).toBe(true);
    expect(recogePlaywright("tests/e2e/ciclos.spec.ts")).toBe(true);
  });

  it("TC-CIC-136e: npm run test:e2e sigue apuntando a ./e2e.sh y no existe un runner aparte para ciclos", () => {
    // @aitri-tc TC-CIC-136e
    const scripts = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["test:e2e"]).toBe("./e2e.sh");
    expect(Object.entries(scripts).filter(([k, v]) => /ciclos/i.test(k) || /ciclos/i.test(v))).toEqual([]);
  });

  it("TC-CIC-137f: un fichero fuera de los globs NO es recogido — sería un TC invisible para verify-run", () => {
    // @aitri-tc TC-CIC-137f
    expect(recogeVitest("tests/ciclos/extra.test.ts")).toBe(false);
    expect(recogePlaywright("tests/ciclos/extra.test.ts")).toBe(false);
  });
});

// ─────────────────────────────── NFR-2409 ───────────────────────────────
describe("NFR-2409 — el recómputo en ciclos no se degrada", () => {
  // Su único contenido es un guardarraíl de tiempo: bajo instrumentación se salta entero (BG-026).
  it.skipIf(SALTAR_SI_INSTRUMENTADO)("TC-CIC-129h: el recómputo completo en modo ciclos se mantiene bajo 150 ms", () => {
    // @aitri-tc TC-CIC-129h
    // NOTA DE BUILD: tests/fixtures/perf-reference no existe. El escenario es F-BIG (5000 celdas, 2000
    // movimientos) —más pesado que el de referencia— reubicado a ciclos día 21 por el camino de producción
    // (planVersionChange + relocate). Mejor-de-5 en vez de mediana de 10: convención del proyecto para
    // cronómetros bajo carga (BG-030, tests/helpers/perf.ts).
    const hoy = "2026-09-10";
    const bounds = { from: "2026-08", to: "2029-07" };
    const plan = planVersionChange(NO_CYCLES, { mode: "cycle", anchorDay: 21, eomPolicy: "last_day" },
      { todayISO: hoy, closedEnd: null, restoreStartMonth: "2026-08", bounds });
    if ("blocked" in plan) throw new Error(`plan bloqueado: ${plan.blocked}`);
    const cal = buildCalendar(plan.cfg, bounds);
    const r = relocate(estadoGrande(5000, 2000), MONTH_CALENDAR, cal, hoy);
    if ("blocked" in r) throw new Error(`reubicación bloqueada: ${r.blocked}`);
    const st: LedgerState = { ...r.state, cycles: plan.cfg };

    const keys = cal.keys("2026-08", "2029-07").slice(0, 36);
    expect(keys).toHaveLength(36);
    const now = currentPeriodFor(cal, hoy);
    expect(now).toBe("2026-09");

    const ms = mejorTiempo(() => {
      activeKeys(st, cal, now, 2);
      computeBalanceSeries(st, keys, openingCarry(st, keys));
      for (const n of st.nodes) for (const k of keys) { rollupBudget(st, n.id, k); rollupActual(st, n.id, k); }
    });
    expect(ms, `recómputo en ciclos (36 claves, ${st.nodes.length} nodos) en ${ms.toFixed(1)}ms`).toBeLessThan(150);
  });
});
