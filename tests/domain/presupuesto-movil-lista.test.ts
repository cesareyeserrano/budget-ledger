// Feature presupuesto-movil — la lista de un periodo (periodView). Prefijo TC-PMV-*.
//
// Lo que estas pruebas fijan: que el view-model del teléfono ordena como la grilla y que NINGUNA
// cifra suya difiere de la tabla de roll-ups que lee escritorio. La pantalla solo pinta lo que sale
// de aquí, así que una divergencia en este punto sería una cifra distinta en el teléfono.
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { budgetState } from "@/domain/budgetState";
import { computeBalanceSeries } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { periodView, progressOf, type PeriodRow } from "@/domain/periodView";
import { periodRange } from "@/domain/periods";
import { RETIROS_PLAN_ID } from "@/domain/reserve";
import { rollupTable, typeTotals } from "@/domain/rollup";
import type { LedgerNode, LedgerState, NodeType, PeriodKey } from "@/domain/types";
import { M as MES, P0 } from "../helpers/periods";
import { CRONOMETRO_FIABLE, mejorDe } from "../helpers/perf";
import { PMV, pmvBase } from "../fixtures/pmv-base";

const M = MES.mar;
const PREV = MES.feb;
const base = (): LedgerState => ({ ...buildSeed("local", P0), ...pmvBase(M, PREV) });

const flat = (rows: PeriodRow[]): PeriodRow[] => rows.flatMap((r) => [r, ...flat(r.children)]);
const section = (state: LedgerState, type: NodeType, period: PeriodKey = M) =>
  periodView(state, period).sections.find((s) => s.type === type)!;

/** Generador determinista (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCALE_PERIODS = periodRange("2025-01", "2027-12");

/** 3 tipos × 4 grupos × 5 categorías × 4 subcategorías = 312 nodos, con montos en 36 periodos. */
function scaleState(): LedgerState {
  const r = rng(42);
  const nodes: LedgerNode[] = [];
  const mk = (id: string, type: NodeType, level: LedgerNode["level"], parentId: string | null, order: number) =>
    nodes.push({ id, ownerId: "local", type, level, parentId, name: id, icon: null, order });
  (["income", "expense", "transfer"] as NodeType[]).forEach((type) => {
    for (let g = 0; g < 4; g++) {
      const gid = `${type}-g${g}`;
      mk(gid, type, "group", null, 4 - g);
      for (let c = 0; c < 5; c++) {
        const cid = `${gid}-c${c}`;
        mk(cid, type, "category", gid, 5 - c);
        for (let s = 0; s < 4; s++) mk(`${cid}-s${s}`, type, "sub", cid, s);
      }
    }
  });
  const budgets: LedgerState["budgets"] = {};
  const actuals: LedgerState["actuals"] = {};
  for (const n of nodes) {
    if (n.level !== "sub") continue;
    for (const p of SCALE_PERIODS) {
      if (r() < 0.8) (budgets[n.id] ??= {})[p] = Math.floor(r() * 999_999_999);
      if (r() < 0.8) (actuals[n.id] ??= {})[p] = Math.floor(r() * 999_999_999);
    }
  }
  return { ...buildSeed("local", P0), nodes, budgets, actuals, movements: [] };
}

describe("presupuesto-movil · la lista de un periodo", () => {
  it("TC-PMV-025h: periodView ordena como la grilla y trae el roll-up y el avance de cada fila", () => {
    // @aitri-tc TC-PMV-025h
    const view = periodView(base(), M);
    expect(view.sections.map((s) => s.type)).toEqual(["income", "expense", "transfer"]);

    const gastos = view.sections[1];
    expect(gastos.groups.map((g) => g.name)).toEqual(["Vivienda", "Transporte", "Estilo de vida"]);
    const vivienda = gastos.groups[0];
    expect(vivienda).toMatchObject({ budget: 1600, actual: 1300, progress: 0.8125, leaf: false, level: 0 });
    expect(vivienda.children.map((c) => c.name)).toEqual(["Mercado", "Servicios", "Administración"]);
    expect(vivienda.children[1]).toMatchObject({ budget: 500, actual: 550, tone: "alert-soft", glyph: "›", progress: 1, level: 1 });
    expect(vivienda.children[0]).toMatchObject({ budget: 1000, actual: 600, tone: "neutral", glyph: "", progress: 0.6, leaf: true });
    expect(gastos.groups[1]).toMatchObject({ name: "Transporte", leaf: true, budget: 800, actual: 700 });
    expect(gastos).toMatchObject({ budget: 2400, actual: 2000 });
    expect(view.closed).toBe(false);
  });

  it("TC-PMV-026f: sin presupuesto y con gasto la barra va llena y el tono es grave; sin nada, vacía", () => {
    // @aitri-tc TC-PMV-026f
    const state = base();
    state.nodes.push({ id: "c-gym", ownerId: "local", type: "expense", level: "category", parentId: PMV.estilo, name: "Gym", icon: null, order: 1 });
    state.actuals["c-gym"] = { [M]: 90 };
    const estilo = section(state, "expense").groups.find((g) => g.id === PMV.estilo)!;
    const gym = estilo.children.find((c) => c.id === "c-gym")!;
    const cine = estilo.children.find((c) => c.id === PMV.cine)!;
    expect(gym).toMatchObject({ budget: 0, actual: 90, tone: "alert-strong", glyph: "››", progress: 1 });
    expect(cine).toMatchObject({ budget: 0, actual: 0, tone: "muted", glyph: "", progress: 0 });
    for (const row of flat(periodView(state, M).sections.flatMap((s) => s.groups))) {
      expect(Number.isFinite(row.progress), row.name).toBe(true);
      expect(row.progress).toBeGreaterThanOrEqual(0);
      expect(row.progress).toBeLessThanOrEqual(1);
    }
    expect(progressOf(0, 0)).toBe(0);
    expect(progressOf(100, 250)).toBe(1);
    expect(progressOf(200, 50)).toBe(0.25);
  });

  it("TC-PMV-027e: la sección de reservas termina con «Retiros del mes», con lo real, lo planeado y su tono", () => {
    // @aitri-tc TC-PMV-027e
    const reservas = section(base(), "transfer");
    expect(reservas.groups.map((g) => g.name)).toEqual(["Ahorro", "Retiros del mes"]);
    const retiros = reservas.groups[reservas.groups.length - 1];
    expect(retiros).toMatchObject({ id: RETIROS_PLAN_ID, actual: 200, budget: 0, leaf: true, children: [] });
    // Sacar 200 sin haberlo planeado es un sobre-consumo grave, la misma graduación de escritorio.
    expect(budgetState(0, 200)).toBe("over_hard");
    expect(retiros.tone).toBe("alert-strong");
    // La alcancía muestra lo aportado en el periodo, no el saldo acumulado (300 de antes + 500).
    expect(reservas.groups[0].children[0]).toMatchObject({ name: "Viaje", actual: 500, budget: 500 });
    // Los retiros no entran en el total de la sección: ese total es lo aportado.
    expect(reservas).toMatchObject({ budget: 500, actual: 500 });
  });

  it("TC-PMV-033f: periodView no diverge de rollupTable ni de typeTotals en un solo peso, a escala", () => {
    // @aitri-tc TC-PMV-033f
    const state = scaleState();
    expect(state.nodes).toHaveLength(312);
    let compared = 0;
    for (const p of SCALE_PERIODS) {
      const table = rollupTable(state, [p]);
      const view = periodView(state, p);
      for (const s of view.sections) {
        expect({ budget: s.budget, actual: s.actual }, `${s.type} · ${p}`).toEqual(typeTotals(state, s.type, [p]));
        const rows = flat(s.groups).filter((r) => r.id !== RETIROS_PLAN_ID);
        for (const row of rows) {
          expect({ budget: row.budget, actual: row.actual }, `${row.id} · ${p}`).toEqual(table.cell(row.id, p));
          compared++;
        }
      }
      // Ningún nodo se queda fuera de la lista ni aparece dos veces.
      const ids = view.sections.flatMap((s) => flat(s.groups)).map((r) => r.id).filter((id) => id !== RETIROS_PLAN_ID);
      expect(new Set(ids).size).toBe(312);
      expect(ids).toHaveLength(312);
    }
    expect(compared).toBe(312 * 36);
    // El orden sigue el campo `order`, no el de inserción: los grupos se crearon con order descendente.
    expect(section(state, "expense", SCALE_PERIODS[0]).groups.map((g) => g.id))
      .toEqual(["expense-g3", "expense-g2", "expense-g1", "expense-g0"]);
  });

  it("TC-PMV-170f: la lista y la serie del Balance de un libro grande caben en 150 ms", () => {
    // @aitri-tc TC-PMV-170f
    const state = scaleState();
    const p = SCALE_PERIODS[20];
    const run = () => {
      const view = periodView(state, p);
      const series = computeBalanceSeries(state, SCALE_PERIODS, openingCarry(state, SCALE_PERIODS));
      return { view, series };
    };
    // El trabajo se afirma SIEMPRE: aunque el reloj no sea fiable, la corrida tiene que producir
    // la lista completa y la serie de los 36 periodos.
    const { view, series } = run();
    expect(view.sections.flatMap((s) => flat(s.groups))).toHaveLength(313);
    expect(Object.keys(series)).toHaveLength(36);
    // El presupuesto de tiempo solo donde el cronómetro mide el algoritmo y no la instrumentación.
    if (CRONOMETRO_FIABLE) {
      const ms = mejorDe(() => {
        const t0 = performance.now();
        run();
        return performance.now() - t0;
      });
      expect(ms).toBeLessThanOrEqual(150);
    }
  });
});
