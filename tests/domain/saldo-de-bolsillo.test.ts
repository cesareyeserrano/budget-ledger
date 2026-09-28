/**
 * Feature saldo-de-bolsillo — la celda de un bolsillo dice lo ahorrado y escribir encima es «ahora tengo esto».
 *
 * Módulo:       tests/domain/saldo-de-bolsillo.test.ts
 * Propósito:    Casos de dominio de FR-3001..FR-3006 y FR-3008, y de las regresiones NFR-3001..NFR-3006.
 * Dependencias: src/domain/reserve.ts, balance.ts, mutations.ts, guard.ts, adjust.ts, cycles.ts;
 *               fixtures tests/fixtures/sdb-base.json y sdb-legado.json.
 *
 * LA REGLA (usuario, 2026-09-27): «debería ser lo que tengo ahorrado cada mes en ese rubro»; escribir un
 * número encima anota la diferencia; y el plan «igual que ejecutado (real)», con cada retiro planeado en su
 * bolsillo. Las capturas de los fixtures se tomaron sobre 434a89b, con el código ANTERIOR.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AVAILABLE_ID as D,
  CELDA_NOTE,
  RETIROS_PLAN_ID,
  applyReserveOp,
  cellTargetMax,
  convertPlannedRetiros,
  plannedRetiroKey,
  reserveCellTarget,
  reserveRetiros,
  resolvedBalance,
  resolvedSeries,
} from "@/domain/reserve";
import { computeBalanceSeries, type MonthBalance } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { worsenedBy } from "@/domain/guard";
import { adjustCell, proposedDate } from "@/domain/adjust";
import { buildCalendar, isValidMovementPeriod, MONTH_CALENDAR } from "@/domain/cycles";
import { createNode, deleteBlockReason, deleteNode } from "@/domain/mutations";
import { periodRange } from "@/domain/periods";
import type { AmountMap, CycleConfig, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

const ENE = "2026-01" as PeriodKey;
const FEB = "2026-02" as PeriodKey;
const MAR = "2026-03" as PeriodKey;
const JUL = "2026-07" as PeriodKey;
const AGO = "2026-08" as PeriodKey;
const SEP = "2026-09" as PeriodKey;
const OCT = "2026-10" as PeriodKey;
const NOV = "2026-11" as PeriodKey;
const DIC = "2026-12" as PeriodKey;
const P = periodRange("2026-01", "2026-12");

const nodo = (id: string, type: LedgerNode["type"], level: LedgerNode["level"], parentId: string | null, order: number): LedgerNode =>
  ({ id, ownerId: "l", type, level, parentId, name: id, icon: null, order });
const NODES: LedgerNode[] = [
  nodo("g-i", "income", "group", null, 0), nodo("ing", "income", "category", "g-i", 1),
  nodo("g-e", "expense", "group", null, 2), nodo("gas", "expense", "category", "g-e", 3),
  nodo("g-t", "transfer", "group", null, 4), nodo("A", "transfer", "category", "g-t", 5),
  nodo("B", "transfer", "category", "g-t", 6),
];

function ledger(budgets: AmountMap = {}, actuals: AmountMap = {}, extra: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "l", nodes: NODES, budgets, actuals, movements: [], ...extra } as LedgerState;
}
function op(s: LedgerState, from: string, to: string, period: PeriodKey, amount: number): LedgerState {
  const r = applyReserveOp(s, { from, to, period, amount, date: `${period}-15T10:00` }, P);
  if (!("state" in r)) return expect.fail(`rechazada: ${JSON.stringify(r.rejected)}`);
  return r.state;
}
function ok<T extends object>(r: T): { state: LedgerState; created: Movement | null } {
  if ("rejected" in r) return expect.fail(`rechazada: ${JSON.stringify((r as { rejected: unknown }).rejected)}`);
  return r as unknown as { state: LedgerState; created: Movement | null };
}
const conIngreso = (p: PeriodKey, v: number, plane: "budget" | "actual" = "actual"): AmountMap => ({ ing: { [p]: v } });

/** A con saldo 1.000.000 en septiembre (y 200.000 disponibles). */
const septiembreMillon = () => op(ledger({}, conIngreso(SEP, 1_200_000)), D, "A", SEP, 1_000_000);

// ── FR-3001 ──────────────────────────────────────────────────────────────────────────────────────

describe("FR-3001 — la celda Ejec. muestra lo ahorrado", () => {
  it("TC-SDB-001h: meter, sacar y volver a meter en el mismo mes deja el saldo real", () => {
    // @aitri-tc TC-SDB-001h
    let s = ledger({}, conIngreso(SEP, 2_000_000));
    s = op(op(op(s, D, "A", SEP, 1_000_000), "A", D, SEP, 500_000), D, "A", SEP, 500_000);
    expect(resolvedBalance(s, "A", SEP, "actual", P)).toBe(1_000_000);
    expect(s.actuals.A[SEP]).toBe(1_500_000); // la celda de aportes sigue guardando lo metido
  });

  it("TC-SDB-002h: la fila acumula mes a mes y resta el retiro", () => {
    // @aitri-tc TC-SDB-002h
    let s = ledger({}, { ing: { [JUL]: 600_000, [AGO]: 400_000 } });
    s = op(op(op(s, D, "A", JUL, 600_000), D, "A", AGO, 400_000), "A", D, SEP, 300_000);
    const serie = resolvedSeries(s, "A", "actual", [JUL, AGO, SEP]);
    expect([...serie]).toEqual([600_000, 1_000_000, 700_000]);
  });

  it("TC-SDB-006e: escala — el saldo es entradas menos salidas en 2.000 operaciones", () => {
    // @aitri-tc TC-SDB-006e
    const per = periodRange("2026-01", "2028-12");
    let x = 11;
    const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
    const bols = Array.from({ length: 10 }, (_, k) => `B${k}`);
    const nodes = [nodo("g-i", "income", "group", null, 0), nodo("ing", "income", "category", "g-i", 1), nodo("g-t", "transfer", "group", null, 2),
      ...bols.map((id, k) => nodo(id, "transfer", "category", "g-t", 3 + k))];
    const ing: Record<string, number> = {};
    for (const p of per) ing[p] = 100_000;
    let s = { ownerId: "l", nodes, budgets: {}, actuals: { ing }, movements: [] } as LedgerState;
    for (let n = 0; n < 2000; n++) {
      const period = per[Math.floor(rnd() * per.length)];
      const a = bols[Math.floor(rnd() * bols.length)];
      const b = bols[Math.floor(rnd() * bols.length)];
      const kind = rnd();
      const amount = 1 + Math.floor(rnd() * 5000);
      const o = kind < 0.5 ? { from: D, to: a } : kind < 0.8 ? { from: a, to: D } : { from: a, to: b };
      const r = applyReserveOp(s, { ...o, period, amount, date: `${period}-10T10:00` }, per);
      if ("state" in r) s = r.state;
    }
    let coinciden = 0;
    for (const id of bols) {
      let acc = 0;
      per.forEach((p) => {
        acc += s.actuals[id]?.[p] ?? 0;
        for (const m of s.movements) {
          if (m.period !== p || m.type !== "transfer") continue;
          if (m.from === id && m.to !== id) acc -= m.amount;
          if (m.to === id && m.from !== D && m.from !== id) acc += m.amount;
        }
        expect(resolvedBalance(s, id, p, "actual", per)).toBe(acc);
        expect(acc).toBeGreaterThanOrEqual(0);
        coinciden++;
      });
    }
    expect(coinciden).toBe(360);
  });
});

// ── FR-3002 ──────────────────────────────────────────────────────────────────────────────────────

describe("FR-3002 — escribir en la celda Ejec. es «ahora tengo esto»", () => {
  it("TC-SDB-010h: bajar la celda crea un retiro fechado con nota", () => {
    // @aitri-tc TC-SDB-010h
    const s = septiembreMillon();
    const r = ok(reserveCellTarget(s, { leafId: "A", period: SEP, plane: "actual", target: 800_000, date: "2026-09-27T10:00" }, P));
    expect(r.created).toMatchObject({ from: "A", to: D, amount: 200_000, date: "2026-09-27T10:00", note: CELDA_NOTE, period: SEP });
    expect(r.created?.kind).toBeUndefined();
    expect(resolvedBalance(r.state, "A", SEP, "actual", P)).toBe(800_000);
    const disp = (st: LedgerState) => computeBalanceSeries(st, P)[SEP].actual.available;
    expect(disp(r.state) - disp(s)).toBe(200_000);
  });

  it("TC-SDB-011h: subir la celda crea un aporte", () => {
    // @aitri-tc TC-SDB-011h
    const r = ok(reserveCellTarget(septiembreMillon(), { leafId: "A", period: SEP, plane: "actual", target: 1_200_000, date: "2026-09-27T10:00" }, P));
    expect(r.created).toMatchObject({ from: D, to: "A", amount: 200_000 });
    expect(resolvedBalance(r.state, "A", SEP, "actual", P)).toBe(1_200_000);
  });

  it("TC-SDB-012f: subir por encima del cupo se rechaza", () => {
    // @aitri-tc TC-SDB-012f
    const s = septiembreMillon();
    const r = reserveCellTarget(s, { leafId: "A", period: SEP, plane: "actual", target: 1_200_001, date: "2026-09-27T10:00" }, P);
    expect(r).toMatchObject({ rejected: { ok: false, rule: "techo", period: SEP } });
    expect(s.movements).toHaveLength(1);
  });

  it("TC-SDB-013e: el mismo saldo no crea nada", () => {
    // @aitri-tc TC-SDB-013e
    const s = septiembreMillon();
    const r = ok(reserveCellTarget(s, { leafId: "A", period: SEP, plane: "actual", target: 1_000_000 }, P));
    expect(r.created).toBeNull();
    expect(r.state).toBe(s);
  });

  it("TC-SDB-014f: bajar un mes que un retiro posterior necesita se rechaza", () => {
    // @aitri-tc TC-SDB-014f
    let s = op(ledger({}, conIngreso(JUL, 1_000_000)), D, "A", JUL, 1_000_000);
    s = op(s, "A", D, SEP, 700_000);
    const r = reserveCellTarget(s, { leafId: "A", period: JUL, plane: "actual", target: 500_000, date: "2026-07-31T12:00" }, P);
    expect(r).toMatchObject({ rejected: { ok: false, rule: "piso", period: SEP, leafId: "A" } });
  });

  it("TC-SDB-015e: la fecha que propone la celda fuera del mes en curso", () => {
    // @aitri-tc TC-SDB-015e
    const fecha = proposedDate(MONTH_CALENDAR, JUL, new Date("2026-09-27T10:00:00"));
    expect(fecha).toBe("2026-07-31T12:00");
    const s = op(ledger({}, conIngreso(JUL, 1_000_000)), D, "A", JUL, 1_000_000);
    const r = ok(reserveCellTarget(s, { leafId: "A", period: JUL, plane: "actual", target: 900_000, date: fecha }, P));
    expect(r.created).toMatchObject({ date: "2026-07-31T12:00", period: JUL });
  });
});

// ── FR-3003 / FR-3004 ────────────────────────────────────────────────────────────────────────────

describe("FR-3003 — la celda Pres. muestra lo que el plan tendría", () => {
  const plan = (extra: AmountMap = {}) => ledger({ ing: { [ENE]: 5000, [FEB]: 5000 }, A: { [ENE]: 600, [FEB]: 400 }, ...extra });

  it("TC-SDB-020h: el plan acumula aportes planeados", () => {
    // @aitri-tc TC-SDB-020h
    expect([...resolvedSeries(plan(), "A", "budget", [ENE, FEB])]).toEqual([600, 1000]);
  });

  it("TC-SDB-021h: un retiro planeado del bolsillo lo resta", () => {
    // @aitri-tc TC-SDB-021h
    expect([...resolvedSeries(plan({ [plannedRetiroKey("A")]: { [FEB]: 300 } }), "A", "budget", [ENE, FEB])]).toEqual([600, 700]);
  });

  it("TC-SDB-022f: un retiro planeado de otro bolsillo no lo toca", () => {
    // @aitri-tc TC-SDB-022f
    const s = plan({ B: { [FEB]: 500 }, [plannedRetiroKey("B")]: { [FEB]: 300 } });
    expect([...resolvedSeries(s, "A", "budget", [ENE, FEB])]).toEqual([600, 1000]);
    expect([...resolvedSeries(s, "B", "budget", [ENE, FEB])]).toEqual([0, 200]);
  });
});

describe("FR-3004 — escribir en la celda Pres. planea aporte o retiro del bolsillo", () => {
  const plan = () => ledger({ ing: { [ENE]: 1000, [FEB]: 200 }, A: { [ENE]: 600, [FEB]: 400 } });

  it("TC-SDB-030h: bajar la celda Pres. planea un retiro del bolsillo", () => {
    // @aitri-tc TC-SDB-030h
    const r = ok(reserveCellTarget(plan(), { leafId: "A", period: FEB, plane: "budget", target: 700 }, P));
    expect(r.state.budgets[plannedRetiroKey("A")][FEB]).toBe(300);
    expect(r.state.budgets[RETIROS_PLAN_ID]).toBeUndefined();
    expect(resolvedBalance(r.state, "A", FEB, "budget", P)).toBe(700);
  });

  it("TC-SDB-031h: subir la celda Pres. planea un aporte", () => {
    // @aitri-tc TC-SDB-031h
    const s = plan();
    expect(cellTargetMax(s, "A", FEB, "budget", P)).toBe(1200);
    const r = ok(reserveCellTarget(s, { leafId: "A", period: FEB, plane: "budget", target: 1200 }, P));
    expect(r.state.budgets.A[FEB]).toBe(600);
  });

  it("TC-SDB-032f: subir el plan por encima del cupo se rechaza", () => {
    // @aitri-tc TC-SDB-032f
    const r = reserveCellTarget(plan(), { leafId: "A", period: FEB, plane: "budget", target: 1201 }, P);
    expect(r).toMatchObject({ rejected: { ok: false, rule: "techo" } });
  });

  it("TC-SDB-033f: un retiro planeado que deja un mes posterior en negativo se rechaza", () => {
    // @aitri-tc TC-SDB-033f
    const s = ledger({ ing: { [ENE]: 1000 }, A: { [ENE]: 1000 }, [plannedRetiroKey("A")]: { [MAR]: 800 } });
    const r = reserveCellTarget(s, { leafId: "A", period: ENE, plane: "budget", target: 500 }, P);
    expect(r).toMatchObject({ rejected: { ok: false, rule: "piso", period: MAR, leafId: "A" } });
  });

  it("TC-SDB-034e: el bolsillo que gana su primer hijo le pasa su retiro planeado", () => {
    // @aitri-tc TC-SDB-034e
    const s = ledger({ ing: { [ENE]: 1000 }, A: { [ENE]: 500 }, [plannedRetiroKey("A")]: { [FEB]: 300 } });
    const next = createNode(s, { level: "sub", parentId: "A", type: "transfer", name: "Hija" });
    const hija = next.nodes.find((n) => n.name === "Hija")!;
    expect(next.budgets[plannedRetiroKey(hija.id)][FEB]).toBe(300);
    expect(next.budgets[plannedRetiroKey("A")]).toBeUndefined();
    expect(resolvedBalance(next, hija.id, FEB, "budget", P)).toBe(200);
  });

  it("TC-SDB-035e: borrar un bolsillo con retiro planeado se bloquea", () => {
    // @aitri-tc TC-SDB-035e
    const s = ledger({ [plannedRetiroKey("B")]: { [FEB]: 300 } });
    expect(deleteBlockReason(s, "B", P)).toBe("has_data");
    expect(deleteNode(s, "B", P)).toEqual({ blocked: "has_data" });
  });
});

// ── FR-3005 / FR-3006 ────────────────────────────────────────────────────────────────────────────

describe("FR-3005 — la fila de retiros planeados es la suma", () => {
  it("TC-SDB-043e: reserveRetiros del plan suma las filas por bolsillo", () => {
    // @aitri-tc TC-SDB-043e
    const s = ledger({ [plannedRetiroKey("A")]: { [MAR]: 100 }, [plannedRetiroKey("B")]: { [MAR]: 50 } });
    expect(reserveRetiros(s, MAR, "budget")).toBe(150);
    expect(reserveRetiros(ledger(), MAR, "budget")).toBe(0);
  });
});

describe("FR-3006 — los retiros planeados sin bolsillo se reparten solos", () => {
  it("TC-SDB-050h: el retiro viejo va entero al bolsillo con más plan", () => {
    // @aitri-tc TC-SDB-050h
    const s = ledger({ ing: { [SEP]: 50_000_000 }, A: { [SEP]: 43_728_582 }, B: { [OCT]: 1_000_000 }, [RETIROS_PLAN_ID]: { [OCT]: 10_000_000 } });
    const r = convertPlannedRetiros(s, P);
    expect(r.converted).toBe(true);
    expect(r.state.budgets[plannedRetiroKey("A")]).toEqual({ [OCT]: 10_000_000 });
    expect(r.state.budgets[plannedRetiroKey("B")]).toBeUndefined();
    expect(r.state.budgets[RETIROS_PLAN_ID]).toBeUndefined();
  });

  it("TC-SDB-051h: si no alcanza, reparte", () => {
    // @aitri-tc TC-SDB-051h
    const s = ledger({ ing: { [MAR]: 5000 }, A: { [MAR]: 1000 }, B: { [MAR]: 800 }, [RETIROS_PLAN_ID]: { [MAR]: 1500 } });
    const r = convertPlannedRetiros(s, P);
    expect(r.state.budgets[plannedRetiroKey("A")]).toEqual({ [MAR]: 1000 });
    expect(r.state.budgets[plannedRetiroKey("B")]).toEqual({ [MAR]: 500 });
  });

  it("TC-SDB-052e: la conversión no mueve el Balance del plan", () => {
    // @aitri-tc TC-SDB-052e
    const c = captura("sdb-legado.json");
    const antes = computeBalanceSeries(c.state, c.periods, openingCarry(c.state, c.periods));
    const conv = convertPlannedRetiros(c.state, c.periods);
    expect(conv.converted).toBe(true);
    const despues = computeBalanceSeries(conv.state, c.periods, openingCarry(conv.state, c.periods));
    for (const p of c.periods) {
      expect(despues[p].budget.reserved, p).toBe(antes[p].budget.reserved);
      expect(despues[p].budget.reservedBalance, p).toBe(antes[p].budget.reservedBalance);
    }
  });

  it("TC-SDB-056f: sin bolsillos, el retiro viejo se conserva", () => {
    // @aitri-tc TC-SDB-056f
    const s = { ownerId: "l", nodes: NODES.filter((n) => n.type !== "transfer"), budgets: { [RETIROS_PLAN_ID]: { [MAR]: 300 } }, actuals: {}, movements: [] } as LedgerState;
    const r = convertPlannedRetiros(s, P);
    expect(r.converted).toBe(false);
    expect(r.state).toBe(s);
    expect(reserveRetiros(r.state, MAR, "budget")).toBe(300);
  });
});

// ── FR-3008 ──────────────────────────────────────────────────────────────────────────────────────

describe("FR-3008 — el guardia ve las filas por bolsillo", () => {
  it("TC-SDB-072e: el guardia ve un cambio solo en la fila del bolsillo", () => {
    // @aitri-tc TC-SDB-072e
    const prev = ledger({ ing: { [OCT]: 1000 }, A: { [OCT]: 500 } });
    const next = { ...prev, budgets: { ...prev.budgets, [plannedRetiroKey("A")]: { [OCT]: 600 } } };
    const v = worsenedBy(prev, next, P);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: "piso", leafId: "A" });
  });
});

// ── NFR-3001 ─────────────────────────────────────────────────────────────────────────────────────

interface Captura { capturedOn: string; periods: PeriodKey[]; state: LedgerState; series: Record<string, { budget: MonthBalance; actual: MonthBalance }> }
function captura(nombre: string): Captura {
  return JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures", nombre), "utf8")) as Captura;
}

describe("NFR-3001 — el Balance no cambia", () => {
  it("TC-SDB-101h: el Balance es idéntico al capturado antes del cambio", () => {
    // @aitri-tc TC-SDB-101h
    const c = captura("sdb-base.json");
    expect(c.capturedOn).toBe("434a89b");
    const s = computeBalanceSeries(c.state, c.periods, openingCarry(c.state, c.periods));
    for (const p of c.periods) expect(s[p], p).toEqual(c.series[p]);
  });

  it("TC-SDB-102e: con retiros planeados viejos, el Balance del plan no cambia tras convertir", () => {
    // @aitri-tc TC-SDB-102e
    const c = captura("sdb-legado.json");
    const conv = convertPlannedRetiros(c.state, c.periods).state;
    const s = computeBalanceSeries(conv, c.periods, openingCarry(conv, c.periods));
    for (const p of c.periods) expect(s[p], p).toEqual(c.series[p]);
  });

  it("TC-SDB-103f: escribir en la celda y registrar la misma operación dan el mismo Balance", () => {
    // @aitri-tc TC-SDB-103f
    const s = septiembreMillon();
    const porCelda = ok(reserveCellTarget(s, { leafId: "A", period: SEP, plane: "actual", target: 800_000, date: "2026-09-15T10:00" }, P)).state;
    const porRegistro = op(s, "A", D, SEP, 200_000);
    expect(computeBalanceSeries(porCelda, P)).toEqual(computeBalanceSeries(porRegistro, P));
  });
});

// ── NFR-3002 / NFR-3003 ──────────────────────────────────────────────────────────────────────────

describe("NFR-3002 — el registro de reservas no cambia", () => {
  it("TC-SDB-111h: meter desde el registro sigue igual", () => {
    // @aitri-tc TC-SDB-111h
    const s = op(ledger({}, conIngreso(ENE, 1000)), D, "A", ENE, 400);
    expect(resolvedBalance(s, "A", ENE, "actual", P)).toBe(400);
    expect(s.actuals.A[ENE]).toBe(400);
  });

  it("TC-SDB-112e: mover entre bolsillos sigue igual", () => {
    // @aitri-tc TC-SDB-112e
    const s = op(op(ledger({}, conIngreso(ENE, 1000)), D, "A", ENE, 500), "A", "B", ENE, 200);
    expect(resolvedBalance(s, "A", ENE, "actual", P)).toBe(300);
    expect(resolvedBalance(s, "B", ENE, "actual", P)).toBe(200);
  });

  it("TC-SDB-113f: sacar de más desde el registro se rechaza igual", () => {
    // @aitri-tc TC-SDB-113f
    const s = op(ledger({}, conIngreso(ENE, 1000)), D, "A", ENE, 300);
    expect(applyReserveOp(s, { from: "A", to: D, period: ENE, amount: 301 }, P)).toEqual({ rejected: { ok: false, rule: "piso", period: ENE, leafId: "A", limit: 300 } });
  });
});

describe("NFR-3003 — las reglas no cambian", () => {
  const eneroConRetiro = () => op(op(ledger({}, conIngreso(ENE, 1000)), D, "A", ENE, 1000), "A", D, ENE, 500);

  it("TC-SDB-121h: el techo acepta su límite exacto", () => {
    // @aitri-tc TC-SDB-121h
    const s = eneroConRetiro();
    expect(cellTargetMax(s, "A", ENE, "actual", P)).toBe(1000);
    ok(reserveCellTarget(s, { leafId: "A", period: ENE, plane: "actual", target: 1000, date: "2026-01-20T10:00" }, P));
  });

  it("TC-SDB-122f: un peso más se rechaza", () => {
    // @aitri-tc TC-SDB-122f
    const r = reserveCellTarget(eneroConRetiro(), { leafId: "A", period: ENE, plane: "actual", target: 1001, date: "2026-01-20T10:00" }, P);
    expect(r).toMatchObject({ rejected: { ok: false, rule: "techo" } });
  });

  it("TC-SDB-123e: el déficit sigue bloqueando", () => {
    // @aitri-tc TC-SDB-123e
    const s = ledger({}, { ing: { [OCT]: 1000 }, gas: { [DIC]: 900 } });
    const r = reserveCellTarget(s, { leafId: "A", period: OCT, plane: "actual", target: 200, date: "2026-10-10T10:00" }, P);
    expect(r).toMatchObject({ rejected: { ok: false, rule: "deficit", period: DIC } });
  });
});

// ── NFR-3005 · ciclos ────────────────────────────────────────────────────────────────────────────

describe("NFR-3005 — en ciclos la operación nace en su ciclo", () => {
  const HOY = "2026-09-10";
  const cfg: CycleConfig = { mode: "cycle", versions: [{ seq: 1, mode: "cycle", anchorDay: 21, eomPolicy: "last_day", effectiveFrom: HOY, firstPay: null, restoreStartMonth: "2026-08", createdAt: `${HOY}T00:00:00.000Z` }] };
  const cal = buildCalendar(cfg, { from: "2026-06", to: "2028-12" });

  it("TC-SDB-141h: en ciclos la operación creada cae en su ciclo", () => {
    // @aitri-tc TC-SDB-141h
    const per = cal.keys("2026-09", "2026-12");
    const fecha = proposedDate(cal, OCT, new Date("2026-09-27T10:00:00"));
    expect(fecha.startsWith("2026-09-27")).toBe(true);
    let s = ledger({}, { ing: { [OCT]: 1000 } }, { cycles: cfg });
    const r = applyReserveOp(s, { from: D, to: "A", period: OCT, amount: 500, date: "2026-09-25T10:00" }, per);
    s = "state" in r ? r.state : expect.fail("aporte rechazado");
    const c = ok(reserveCellTarget(s, { leafId: "A", period: OCT, plane: "actual", target: 300, date: fecha }, per));
    expect(c.created).toMatchObject({ period: OCT, date: fecha });
    expect(isValidMovementPeriod(cal, { type: "transfer", period: OCT, date: fecha })).toBe(true);
  });

  it("TC-SDB-142e: fuera del ciclo en curso propone el último día del ciclo", () => {
    // @aitri-tc TC-SDB-142e
    expect(proposedDate(cal, DIC, new Date("2026-09-27T10:00:00"))).toBe("2026-12-20T12:00");
  });
});

// ── NFR-3006 · gasto e ingreso ───────────────────────────────────────────────────────────────────

describe("NFR-3006 — gasto e ingreso siguen con su ajuste", () => {
  const mv = (target: string, type: "income" | "expense", amount: number, period: PeriodKey): Movement =>
    ({ id: `m-${target}-${amount}`, ownerId: "l", type, catId: target, subId: null, target, amount, period, createdAt: 1, date: `${period}-05T10:00` });

  it("TC-SDB-151h: la celda de gasto sigue creando su ajuste", () => {
    // @aitri-tc TC-SDB-151h
    const s = ledger({}, { gas: { [MAR]: 100 } }, { movements: [mv("gas", "expense", 100, MAR)] });
    const r = adjustCell(s, "gas", MAR, 150, "2026-03-20T12:00", P);
    expect("created" in r && r.created).toMatchObject({ kind: "adjustment", amount: 50 });
  });

  it("TC-SDB-152e: lo mismo en ingreso", () => {
    // @aitri-tc TC-SDB-152e
    const s = ledger({}, { ing: { [MAR]: 1000 } }, { movements: [mv("ing", "income", 1000, MAR)] });
    const r = adjustCell(s, "ing", MAR, 900, "2026-03-20T12:00", P);
    expect("created" in r && r.created).toMatchObject({ kind: "adjustment", amount: -100 });
  });

  it("TC-SDB-153f: un bolsillo nunca recibe kind 'adjustment'", () => {
    // @aitri-tc TC-SDB-153f
    const s = septiembreMillon();
    const r = ok(reserveCellTarget(s, { leafId: "A", period: SEP, plane: "actual", target: 800_000, date: "2026-09-20T10:00" }, P));
    expect(r.created?.kind).toBeUndefined();
    expect(adjustCell(s, "A", SEP, 800_000, "2026-09-20T10:00", P)).toEqual({ rejected: "transfer" });
  });
});
