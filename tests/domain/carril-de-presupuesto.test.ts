/**
 * Feature carril-de-presupuesto — Presupuestado y Ejecutado calculan igual, cada uno en su carril.
 *
 * Módulo:       tests/domain/carril-de-presupuesto.test.ts
 * Propósito:    Casos de dominio de FR-2901..FR-2904 y de las regresiones NFR-2901..NFR-2908.
 * Dependencias: src/domain/balance.ts, reserve.ts, guard.ts, closure.ts, cycles.ts, mutations.ts;
 *               fixtures tests/fixtures/carril-base.json y carril-desvio.json.
 *
 * LA REGLA (usuario, 2026-09-27): «el presupuesto y el ejecutado deberían tener el mismo
 * comportamiento, para poder hacer una simulación real y una comparación real». Cada mes Pres. abre con
 * el cierre Pres. del mes anterior (antes abría con el cierre REAL, ADR-03 de balance) y las reglas de
 * reservas bloquean en Pres. igual que en Ejec. (antes el plan solo avisaba, FR-1008).
 *
 * Las capturas de los fixtures se tomaron sobre 795ca8a, con el código ANTERIOR al cambio: son la prueba
 * de que la columna Ejec. no se mueve.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeBalanceSeries, type MonthBalance } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import {
  AVAILABLE_ID as D,
  RETIROS_PLAN_ID,
  applyReserveCellEdit,
  applyReserveOp,
  cellHeadroom,
  monthCarryUsage,
  monthIssues,
  setPlannedRetiro,
  validateReserveWrite,
} from "@/domain/reserve";
import { worsenedBy } from "@/domain/guard";
import { downstreamImpact } from "@/domain/closure";
import { buildCalendar } from "@/domain/cycles";
import { setLeafAmount } from "@/domain/mutations";
import { periodRange } from "@/domain/periods";
import type { AmountMap, CycleConfig, CycleVersion, LedgerNode, LedgerState, PeriodKey } from "@/domain/types";
import { P } from "../helpers/periods";

// ── Estado ───────────────────────────────────────────────────────────────────────────────────────

const ENE = "2026-01" as PeriodKey;
const SEP = "2026-09" as PeriodKey;
const OCT = "2026-10" as PeriodKey;
const NOV = "2026-11" as PeriodKey;
const DIC = "2026-12" as PeriodKey;
const ENE27 = "2027-01" as PeriodKey;

const nodo = (id: string, type: LedgerNode["type"], level: LedgerNode["level"], parentId: string | null, order: number): LedgerNode =>
  ({ id, ownerId: "l", type, level, parentId, name: id, icon: null, order });

const NODES: LedgerNode[] = [
  nodo("g-i", "income", "group", null, 0), nodo("ing", "income", "category", "g-i", 1),
  nodo("g-e", "expense", "group", null, 2), nodo("gas", "expense", "category", "g-e", 3),
  nodo("g-t", "transfer", "group", null, 4), nodo("A", "transfer", "category", "g-t", 5),
];

/** Un ledger con los mapas dados. Las celdas de ingreso y gasto se leen como celdas (el techo no mira el journal). */
function ledger(budgets: AmountMap = {}, actuals: AmountMap = {}, extra: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "l", nodes: NODES, budgets, actuals, movements: [], ...extra } as LedgerState;
}

/** Octubre: el plan deja 500 (ingreso 1.000, gasto 500) y lo real 400 (ingreso 1.000, gasto 600). */
function octubreDivergente(): LedgerState {
  return ledger({ ing: { [OCT]: 1000 }, gas: { [OCT]: 500 } }, { ing: { [OCT]: 1000 }, gas: { [OCT]: 600 } });
}

const conBudget = (s: LedgerState, leaf: string, p: PeriodKey, v: number): LedgerState =>
  ({ ...s, budgets: { ...s.budgets, [leaf]: { ...(s.budgets[leaf] ?? {}), [p]: v } } });
const conActual = (s: LedgerState, leaf: string, p: PeriodKey, v: number): LedgerState =>
  ({ ...s, actuals: { ...s.actuals, [leaf]: { ...(s.actuals[leaf] ?? {}), [p]: v } } });

function estado<T extends object>(r: T): LedgerState {
  if ("rejected" in r) return expect.fail(`rechazada: ${JSON.stringify((r as { rejected: unknown }).rejected)}`);
  return (r as unknown as { state: LedgerState }).state;
}

/** Generador determinista (LCG de Numerical Recipes): la misma semilla da la misma secuencia. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

const PLANO: (keyof MonthBalance)[] = ["prevAvailable", "prevReserved", "income", "expense", "flow", "reserved", "available", "reservedBalance", "total"];

// ── FR-2901 · el Balance Pres. arrastra su propio saldo ──────────────────────────────────────────

describe("FR-2901 — carril propio del Balance Pres.", () => {
  it("TC-CDP-001h: noviembre Pres. abre con el cierre Pres. de octubre", () => {
    // @aitri-tc TC-CDP-001h
    const s = computeBalanceSeries(octubreDivergente(), [OCT, NOV]);
    expect(s[OCT].budget.available).toBe(500);
    expect(s[OCT].actual.available).toBe(400);
    // Con la regla vieja (ADR-03) los dos planos abrían en el cierre real: 400 y 400.
    expect(s[NOV].budget.prevAvailable).toBe(500);
    expect(s[NOV].actual.prevAvailable).toBe(400);
  });

  it("TC-CDP-002h: doce meses de plan sin ejecución acumulan en su carril", () => {
    // @aitri-tc TC-CDP-002h
    const per = periodRange("2027-01", "2027-12");
    const b: AmountMap = { ing: {}, gas: {}, A: {} };
    for (const p of per) { b.ing[p] = 1000; b.gas[p] = 600; b.A[p] = 100; }
    const s = computeBalanceSeries(ledger(b), per);
    const dic = s["2027-12"].budget;
    // La regla vieja daba 300 y 100: cada mes arrancaba en el real, que es 0.
    expect(dic.available).toBe(3600);
    expect(dic.reservedBalance).toBe(1200);
    expect(dic.total).toBe(4800);
  });

  it("TC-CDP-003e: escala de producción — 36 periodos y 40 hojas conservan el total del plan", () => {
    // @aitri-tc TC-CDP-003e
    const per = periodRange("2026-01", "2028-12");
    const rnd = lcg(41);
    const nodes: LedgerNode[] = [
      nodo("g-i", "income", "group", null, 0), nodo("g-e", "expense", "group", null, 1), nodo("g-t", "transfer", "group", null, 2),
    ];
    const leaves: { id: string; type: LedgerNode["type"]; parent: string }[] = [];
    for (let i = 0; i < 20; i++) leaves.push({ id: `e${i}`, type: "expense", parent: "g-e" });
    for (let i = 0; i < 10; i++) leaves.push({ id: `i${i}`, type: "income", parent: "g-i" });
    for (let i = 0; i < 10; i++) leaves.push({ id: `t${i}`, type: "transfer", parent: "g-t" });
    leaves.forEach((l, k) => nodes.push(nodo(l.id, l.type, "category", l.parent, 3 + k)));
    const budgets: AmountMap = {};
    const actuals: AmountMap = {};
    for (const l of leaves) {
      budgets[l.id] = {};
      actuals[l.id] = {};
      for (const p of per) {
        budgets[l.id][p] = Math.floor(rnd() * 1000);
        actuals[l.id][p] = Math.floor(rnd() * 1000);
      }
    }
    const state = { ownerId: "l", nodes, budgets, actuals, movements: [], startMonth: per[0], openingBalance: 5000 } as LedgerState;
    const s = computeBalanceSeries(state, per, openingCarry(state, per));
    expect(s[per[0]].budget.prevAvailable).toBe(5000);
    for (let i = 1; i < per.length; i++) {
      for (const plane of ["budget", "actual"] as const) {
        const a = s[per[i - 1]][plane];
        const b = s[per[i]][plane];
        expect(Number.isNaN(b.total)).toBe(false);
        expect(b.total).toBe(a.total + b.flow);
        expect(b.prevAvailable).toBe(a.available);
        expect(b.prevReserved).toBe(a.reservedBalance);
      }
    }
  });

  it("TC-CDP-004f: lo real no entra al carril del plan", () => {
    // @aitri-tc TC-CDP-004f
    const per = [OCT, NOV, DIC];
    const a = octubreDivergente();
    const b = conActual(a, "gas", OCT, 900); // octubre real 300 peor
    const sa = computeBalanceSeries(a, per);
    const sb = computeBalanceSeries(b, per);
    for (const p of [NOV, DIC]) expect(sb[p].budget).toEqual(sa[p].budget);
    expect(sa[NOV].actual.prevAvailable - sb[NOV].actual.prevAvailable).toBe(300);
  });
});

// ── FR-2902 · el mismo punto de partida ──────────────────────────────────────────────────────────

describe("FR-2902 — el primer mes abre los dos carriles en el mismo punto", () => {
  const inicio = (extra: Partial<LedgerState> = {}) => ledger({}, {}, { startMonth: SEP, openingBalance: 2000, ...extra });

  it("TC-CDP-010h: el saldo inicial abre los dos carriles", () => {
    // @aitri-tc TC-CDP-010h
    const st = inicio();
    const s = computeBalanceSeries(st, [SEP, OCT], openingCarry(st, [SEP, OCT]));
    expect(s[SEP].budget.prevAvailable).toBe(2000);
    expect(s[SEP].actual.prevAvailable).toBe(2000);
  });

  it("TC-CDP-011e: sin saldo inicial los dos carriles abren en 0", () => {
    // @aitri-tc TC-CDP-011e
    const st = ledger({}, {}, { startMonth: null, openingBalance: null });
    const s = computeBalanceSeries(st, [SEP, OCT], openingCarry(st, [SEP, OCT]));
    expect(s[SEP].budget.prevAvailable).toBe(0);
    expect(s[SEP].actual.prevAvailable).toBe(0);
    expect(Number.isNaN(s[OCT].budget.available)).toBe(false);
  });

  it("TC-CDP-012f: el saldo inicial no se vuelve a sumar", () => {
    // @aitri-tc TC-CDP-012f
    const st = inicio({ budgets: { ing: { [SEP]: 500 } }, actuals: { gas: { [SEP]: 200 } } });
    const s = computeBalanceSeries(st, [SEP, OCT], openingCarry(st, [SEP, OCT]));
    expect(s[OCT].budget.prevAvailable).toBe(2500);
    expect(s[OCT].actual.prevAvailable).toBe(1800);
  });

  it("TC-CDP-013e: el barrido del plan arranca en el saldo inicial", () => {
    // @aitri-tc TC-CDP-013e
    expect(cellHeadroom(inicio(), "A", SEP, "budget", [SEP, OCT])).toBe(2000);
  });
});

// ── FR-2903 · lo que el plan deriva de su arrastre ───────────────────────────────────────────────

describe("FR-2903 — el plan deriva de su propio carril", () => {
  it("TC-CDP-020h: el Máx. Pres. de noviembre sale del carril del plan", () => {
    // @aitri-tc TC-CDP-020h
    // Con el arrastre real daría 400.
    expect(cellHeadroom(octubreDivergente(), "A", NOV, "budget", [OCT, NOV])).toBe(500);
  });

  it("TC-CDP-021h: la observación del plan nombra el saldo del plan", () => {
    // @aitri-tc TC-CDP-021h
    const s = conBudget(conBudget(octubreDivergente(), "ing", NOV, 200), "A", NOV, 700);
    expect(monthCarryUsage(s, NOV, "budget", [OCT, NOV])).toEqual({ reservado: 700, delSaldoAnterior: 500, mesAnterior: OCT });
  });

  it("TC-CDP-022f: sin reservas del plan no hay observación ni marca; con exceso, sí", () => {
    // @aitri-tc TC-CDP-022f
    const sin = octubreDivergente();
    expect(monthCarryUsage(sin, NOV, "budget", [OCT, NOV])).toBeNull();
    expect(monthIssues(sin, [OCT, NOV]).filter((i) => i.period === NOV)).toEqual([]);
    // Contraste: el mismo noviembre reservando 800 sobre 500 del plan sí trae el problema del plan.
    const con = conBudget(sin, "A", NOV, 800);
    expect(monthIssues(con, [OCT, NOV])).toContainEqual({ kind: "techo_plan", period: NOV, margin: 500, excess: 300 });
  });

  it("TC-CDP-023e: el Máx. Pres. mira la cadena — un mes posterior del plan lo acota", () => {
    // @aitri-tc TC-CDP-023e
    const s = ledger({ ing: { [OCT]: 1000 }, gas: { [NOV]: 800 } });
    // Con la regla vieja solo miraba octubre: 1.000.
    expect(cellHeadroom(s, "A", OCT, "budget", [OCT, NOV])).toBe(200);
  });

  it("TC-CDP-024e: propiedad a escala — el Máx. Pres. es exacto", () => {
    // @aitri-tc TC-CDP-024e
    const per = periodRange("2026-01", "2028-12");
    const rnd = lcg(7);
    const bolsillos = Array.from({ length: 10 }, (_, k) => `B${k}`);
    const nodes: LedgerNode[] = [
      ...NODES.filter((n) => n.type !== "transfer"),
      nodo("g-t", "transfer", "group", null, 4),
      ...bolsillos.map((id, k) => nodo(id, "transfer", "category", "g-t", 5 + k)),
    ];
    const ing: Record<string, number> = {};
    const gas: Record<string, number> = {};
    for (const p of per) { ing[p] = 500 + Math.floor(rnd() * 1500); gas[p] = Math.floor(rnd() * 1500); }
    let st = { ownerId: "l", nodes, budgets: { ing, gas }, actuals: {}, movements: [] } as LedgerState;
    let aceptadas = 0;
    for (let n = 0; n < 2000; n++) {
      const leafId = bolsillos[Math.floor(rnd() * bolsillos.length)];
      const period = per[Math.floor(rnd() * per.length)];
      const m = cellHeadroom(st, leafId, period, "budget", per);
      expect(validateReserveWrite(st, { leafId, period, plane: "budget", newAmount: m }, per).ok).toBe(true);
      expect(validateReserveWrite(st, { leafId, period, plane: "budget", newAmount: m + 1 }, per).ok).toBe(false);
      // Avanza el estado con una escritura aceptable para que el plan se vaya llenando.
      const nuevo = Math.floor(rnd() * (m + 1));
      const r = applyReserveCellEdit(st, { leafId, period, plane: "budget", newAmount: nuevo }, per);
      if ("state" in r) { st = r.state; aceptadas++; }
    }
    expect(aceptadas).toBeGreaterThan(1000);
  });
});

// ── FR-2904 · el plan bloquea ────────────────────────────────────────────────────────────────────

describe("FR-2904 — las reglas de reservas bloquean en Pres.", () => {
  const PER = [OCT, NOV, DIC];
  const legado = () => conBudget(octubreDivergente(), "A", NOV, 800);

  it("TC-CDP-030h: una reserva del plan que cabe se guarda", () => {
    // @aitri-tc TC-CDP-030h
    const r = applyReserveCellEdit(octubreDivergente(), { leafId: "A", period: NOV, plane: "budget", newAmount: 500 }, PER);
    expect(estado(r).budgets.A[NOV]).toBe(500);
  });

  it("TC-CDP-031f: una reserva del plan que no cabe se rechaza", () => {
    // @aitri-tc TC-CDP-031f
    const s = octubreDivergente();
    const r = applyReserveCellEdit(s, { leafId: "A", period: NOV, plane: "budget", newAmount: 501 }, PER);
    expect(r).toEqual({ rejected: { ok: false, rule: "techo", period: NOV, leafId: undefined, limit: 500 } });
    expect(s.budgets.A).toBeUndefined();
  });

  it("TC-CDP-032e: bajar un plan legado que ya se pasaba se acepta", () => {
    // @aitri-tc TC-CDP-032e
    const s = legado();
    const r = applyReserveCellEdit(s, { leafId: "A", period: NOV, plane: "budget", newAmount: 700 }, PER);
    const nuevo = estado(r);
    expect(nuevo.budgets.A[NOV]).toBe(700);
    expect(monthIssues(nuevo, PER)).toContainEqual({ kind: "techo_plan", period: NOV, margin: 500, excess: 200 });
  });

  it("TC-CDP-033f: subir un plan legado que ya se pasaba se rechaza", () => {
    // @aitri-tc TC-CDP-033f
    const s = legado();
    const r = applyReserveCellEdit(s, { leafId: "A", period: NOV, plane: "budget", newAmount: 900 }, PER);
    expect(r).toMatchObject({ rejected: { ok: false, rule: "techo", period: NOV } });
    expect(s.budgets.A[NOV]).toBe(800);
  });

  it("TC-CDP-034e: un plan legado no bloquea gastos de otro mes", () => {
    // @aitri-tc TC-CDP-034e
    const per = [OCT, NOV, DIC, ENE27];
    const prev = legado();
    const next = setLeafAmount(prev, "gas", ENE27, "budget", 300, per);
    expect(next.budgets.gas[ENE27]).toBe(300);
    expect(worsenedBy(prev, next, per)).toEqual([]);
  });

  it("TC-CDP-035f: el déficit del plan bloquea nombrando el mes", () => {
    // @aitri-tc TC-CDP-035f
    const s = ledger({ ing: { [OCT]: 1000 }, gas: { [DIC]: 900 } });
    const r = applyReserveCellEdit(s, { leafId: "A", period: OCT, plane: "budget", newAmount: 200 }, PER);
    expect(r).toEqual({ rejected: { ok: false, rule: "deficit", period: DIC, leafId: undefined, limit: 100 } });
  });

  it("TC-CDP-036e: escribir el mismo valor no es escritura", () => {
    // @aitri-tc TC-CDP-036e
    const s = conBudget(octubreDivergente(), "A", NOV, 500);
    const r = applyReserveCellEdit(s, { leafId: "A", period: NOV, plane: "budget", newAmount: 500 }, PER);
    expect(r).toEqual({ state: s, warnings: [], noop: true });
  });
});

// ── NFR-2901 · la columna Ejec. del Balance no cambia ────────────────────────────────────────────

interface Captura { capturedOn: string; periods: PeriodKey[]; state: LedgerState; actual: Record<string, MonthBalance>; impact: unknown[] }
const captura = (nombre: string): Captura =>
  JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures", nombre), "utf8")) as Captura;
const serieEjec = (c: Captura, state = c.state) => {
  const s = computeBalanceSeries(state, c.periods, openingCarry(state, c.periods));
  return Object.fromEntries(c.periods.map((p) => [p, s[p].actual]));
};

describe("NFR-2901 — la columna Ejec. del Balance no cambia", () => {
  it("TC-CDP-101h: la serie Ejec. es idéntica a la capturada antes del cambio", () => {
    // @aitri-tc TC-CDP-101h
    const c = captura("carril-base.json");
    expect(c.capturedOn).toBe("795ca8a");
    const hoy = serieEjec(c);
    for (const p of c.periods) for (const k of PLANO) expect(hoy[p][k], `${p}.${k}`).toBe(c.actual[p][k]);
  });

  it("TC-CDP-102e: un mes peor que el plan no altera Ejec. respecto de la captura", () => {
    // @aitri-tc TC-CDP-102e
    const c = captura("carril-desvio.json");
    expect(serieEjec(c)).toEqual(c.actual);
  });

  it("TC-CDP-103f: tocar solo el plan no mueve ninguna cifra Ejec.", () => {
    // @aitri-tc TC-CDP-103f
    const c = captura("carril-base.json");
    let b = c.state;
    for (const leaf of ["A", "B", "C"]) for (const p of c.periods) b = conBudget(b, leaf, p, (b.budgets[leaf]?.[p] ?? 0) + 100);
    const sa = computeBalanceSeries(c.state, c.periods, openingCarry(c.state, c.periods));
    const sb = computeBalanceSeries(b, c.periods, openingCarry(b, c.periods));
    expect(c.periods.map((p) => sb[p].actual)).toEqual(c.periods.map((p) => sa[p].actual));
    expect(c.periods.map((p) => sb[p].budget)).not.toEqual(c.periods.map((p) => sa[p].budget));
  });
});

// ── NFR-2902 · las reglas de Ejec. no cambian ────────────────────────────────────────────────────

describe("NFR-2902 — las reglas de Ejecutado aceptan y rechazan lo mismo", () => {
  /** Enero: ingreso 1.000, 1.000 reservados en A y un retiro de 500 (escenario de retirar-para-gastar). */
  function eneroConRetiro(): LedgerState {
    let s = ledger({}, { ing: { [ENE]: 1000 } });
    s = estado(applyReserveOp(s, { from: D, to: "A", period: ENE, amount: 1000, date: "2026-01-10" }, P));
    return estado(applyReserveOp(s, { from: "A", to: D, period: ENE, amount: 500, date: "2026-01-20" }, P));
  }

  it("TC-CDP-111h: Ejec. acepta exactamente su límite", () => {
    // @aitri-tc TC-CDP-111h
    const s = eneroConRetiro();
    expect(cellHeadroom(s, "A", ENE, "actual", P)).toBe(1500);
    const r = applyReserveCellEdit(s, { leafId: "A", period: ENE, plane: "actual", newAmount: 1500 }, P);
    expect(estado(r).actuals.A[ENE]).toBe(1500);
  });

  it("TC-CDP-112f: Ejec. rechaza su límite + 1", () => {
    // @aitri-tc TC-CDP-112f
    const r = applyReserveCellEdit(eneroConRetiro(), { leafId: "A", period: ENE, plane: "actual", newAmount: 1501 }, P);
    expect(r).toEqual({ rejected: { ok: false, rule: "techo", period: ENE, leafId: undefined, limit: 500 } });
  });

  it("TC-CDP-113e: el piso de Ejec. no cambia", () => {
    // @aitri-tc TC-CDP-113e
    const s = estado(applyReserveOp(ledger({}, { ing: { [ENE]: 1000 } }), { from: D, to: "A", period: ENE, amount: 300 }, P));
    const r = applyReserveOp(s, { from: "A", to: D, period: ENE, amount: 301 }, P);
    expect(r).toEqual({ rejected: { ok: false, rule: "piso", period: ENE, leafId: "A", limit: 300 } });
  });
});

// ── NFR-2903 · saldo inicial ─────────────────────────────────────────────────────────────────────

describe("NFR-2903 — el saldo inicial abre el primer mes, una sola vez", () => {
  it("TC-CDP-121h: el techo Ejec. del primer mes arranca en el saldo inicial", () => {
    // @aitri-tc TC-CDP-121h
    const s = ledger({}, {}, { startMonth: SEP, openingBalance: 2000 });
    expect(cellHeadroom(s, "A", SEP, "actual", [SEP, OCT])).toBe(2000);
  });

  it("TC-CDP-122e: el saldo inicial aparece una sola vez en 24 meses", () => {
    // @aitri-tc TC-CDP-122e
    const per = periodRange("2026-09", "2028-08");
    const s = ledger({}, {}, { startMonth: per[0], openingBalance: 2000 });
    const serie = computeBalanceSeries(s, per, openingCarry(s, per));
    for (const p of per) {
      expect(serie[p].budget.available).toBe(2000);
      expect(serie[p].actual.available).toBe(2000);
    }
  });

  it("TC-CDP-123f: un saldo inicial corrupto se trata como no declarado", () => {
    // @aitri-tc TC-CDP-123f
    // La fila de la base se normaliza en el dominio (normalizeOpeningBalance, la misma que usa openingFromRow).
    const s = ledger({}, {}, { startMonth: SEP, openingBalance: -5 });
    const serie = computeBalanceSeries(s, [SEP, OCT], openingCarry(s, [SEP, OCT]));
    expect(serie[SEP].budget.prevAvailable).toBe(0);
    expect(serie[SEP].actual.prevAvailable).toBe(0);
    expect(Number.isNaN(serie[OCT].budget.available)).toBe(false);
  });
});

// ── NFR-2904 · cierre ────────────────────────────────────────────────────────────────────────────

describe("NFR-2904 — el cierre de mes no cambia", () => {
  it("TC-CDP-133e: el impacto de reabrir no cambia en Ejec.", () => {
    // @aitri-tc TC-CDP-133e
    const c = captura("carril-base.json");
    expect(c.impact.length).toBeGreaterThan(0);
    expect(downstreamImpact(c.state, c.periods)).toEqual(c.impact);
  });
});

// ── NFR-2905 · ciclos ────────────────────────────────────────────────────────────────────────────

describe("NFR-2905 — en ciclos el plan encadena por la lista de periodos", () => {
  const HOY = "2026-09-10";
  const version = (over: Partial<CycleVersion> = {}): CycleVersion =>
    ({ seq: 1, mode: "cycle", anchorDay: 21, eomPolicy: "last_day", effectiveFrom: HOY, firstPay: null, restoreStartMonth: "2026-08", createdAt: `${HOY}T00:00:00.000Z`, ...over });
  const BOUNDS = { from: "2026-06", to: "2028-12" } as const;

  it("TC-CDP-141h: en ciclos el plan encadena por la lista de periodos", () => {
    // @aitri-tc TC-CDP-141h
    const cfg: CycleConfig = { mode: "cycle", versions: [version()] };
    const per = buildCalendar(cfg, BOUNDS).keys("2026-09", "2026-12");
    const ing: Record<string, number> = {};
    for (const p of per) ing[p] = 100;
    const s = computeBalanceSeries(ledger({ ing }, {}, { cycles: cfg }), per);
    for (let i = 1; i < per.length; i++) expect(s[per[i]].budget.prevAvailable).toBe(s[per[i - 1]].budget.available);
    expect(s[per[per.length - 1]].budget.available).toBe(100 * per.length);
  });

  it("TC-CDP-142e: la transición de ciclo arrastra como cualquier periodo", () => {
    // @aitri-tc TC-CDP-142e
    const cfg: CycleConfig = { mode: "cycle", versions: [version(), version({ seq: 2, anchorDay: 30, effectiveFrom: "2026-10-30", firstPay: "2026-10-30" })] };
    const per = buildCalendar(cfg, BOUNDS).keys("2026-09", "2026-12");
    expect(per).toContain("2026-10t");
    const s = computeBalanceSeries(ledger({ ing: { "2026-10t": 50 } }, {}, { cycles: cfg }), per);
    expect(s["2026-10t"].budget.available).toBe(50);
    expect(s["2026-11"].budget.prevAvailable).toBe(50);
  });

  it("TC-CDP-143f: en ciclos el plan no toma el cierre real", () => {
    // @aitri-tc TC-CDP-143f
    const cfg: CycleConfig = { mode: "cycle", versions: [version()] };
    const per = buildCalendar(cfg, BOUNDS).keys("2026-09", "2026-12");
    const s = computeBalanceSeries(ledger({ ing: { [SEP]: 1000 } }, { ing: { [SEP]: 700 } }, { cycles: cfg }), per);
    expect(s[per[1]].budget.prevAvailable - s[per[1]].actual.prevAvailable).toBe(300);
  });
});

// ── NFR-2907 · retiro planeado ───────────────────────────────────────────────────────────────────

describe("NFR-2907 — el retiro planeado conserva su regla", () => {
  const per = [SEP, OCT, NOV, DIC];
  const plan = () => ledger({ ing: { [SEP]: 5000 }, A: { [SEP]: 300, [NOV]: 300 } });

  it("TC-CDP-161h: planear un retiro dentro de lo reservado se acepta", () => {
    // @aitri-tc TC-CDP-161h
    const r = setPlannedRetiro(plan(), NOV, 600, per);
    expect("state" in r && r.state.budgets[RETIROS_PLAN_ID][NOV]).toBe(600);
  });

  it("TC-CDP-162f: planear un retiro de más se rechaza con su límite", () => {
    // @aitri-tc TC-CDP-162f
    const s = plan();
    expect(setPlannedRetiro(s, NOV, 601, per)).toEqual({ rejected: { limit: 600 } });
    expect(s.budgets[RETIROS_PLAN_ID]).toBeUndefined();
  });

  it("TC-CDP-163e: el retiro planeado huérfano se sigue marcando", () => {
    // @aitri-tc TC-CDP-163e
    const s = ledger({ ing: { [NOV]: 5000 }, A: { [NOV]: 100 }, [RETIROS_PLAN_ID]: { [NOV]: 500 } });
    expect(monthIssues(s, per)).toContainEqual({ kind: "retiro_planeado", period: NOV, margin: 100, excess: 400 });
  });
});

// ── NFR-2908 · ingresos y gastos sin vigilancia ──────────────────────────────────────────────────

describe("NFR-2908 — ingresos y gastos siguen sin vigilancia de reservas", () => {
  const per = [OCT, NOV, DIC];

  it("TC-CDP-171h: bajar un ingreso del plan que deja el mes negativo se acepta", () => {
    // @aitri-tc TC-CDP-171h
    const prev = ledger({ ing: { [NOV]: 1000 }, A: { [NOV]: 800 } });
    const next = setLeafAmount(prev, "ing", NOV, "budget", 100, per);
    expect(next.budgets.ing[NOV]).toBe(100);
    expect(worsenedBy(prev, next, per)).toEqual([]);
  });

  it("TC-CDP-172e: lo mismo en Ejec.", () => {
    // @aitri-tc TC-CDP-172e
    const prev = ledger({}, { ing: { [NOV]: 1000 }, A: { [NOV]: 800 } });
    const next = setLeafAmount(prev, "ing", NOV, "actual", 100, per);
    expect(next.actuals.ing[NOV]).toBe(100);
    expect(worsenedBy(prev, next, per)).toEqual([]);
  });

  it("TC-CDP-173f: en ese mes negativo, subir la reserva del plan sí se rechaza", () => {
    // @aitri-tc TC-CDP-173f
    const prev = ledger({ ing: { [NOV]: 1000 }, A: { [NOV]: 800 } });
    const negativo = setLeafAmount(prev, "ing", NOV, "budget", 100, per);
    const r = applyReserveCellEdit(negativo, { leafId: "A", period: NOV, plane: "budget", newAmount: 900 }, per);
    expect(r).toMatchObject({ rejected: { ok: false, period: NOV } });
    const regla = "rejected" in r && typeof r.rejected === "object" && !r.rejected.ok ? r.rejected.rule : null;
    expect(["techo", "deficit"]).toContain(regla);
  });
});
