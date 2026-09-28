/**
 * Feature saldo-de-bolsillo — el retiro PLANEADO tiene alcancía y se anota como uno real.
 *
 * Módulo:       tests/domain/saldo-de-bolsillo.test.ts
 * Propósito:    Casos de dominio de FR-3001..FR-3004, FR-3006 y FR-3008, y de las regresiones NFR-3001..NFR-3006.
 * Dependencias: src/domain/reserve.ts, balance.ts, mutations.ts, guard.ts, adjust.ts;
 *               src/components/reserveText.ts (el texto del rechazo);
 *               fixtures tests/fixtures/sdb-base.json y sdb-legado.json.
 *
 * LA REGLA (usuario, 2026-09-27): «Todo de reservas, ingresos, egresos muestra lo del mes o ciclo… En balance,
 * lo disponible, es donde se arrastra» y «el mismo formulario que tiene retiros del mes en ejecutado va en
 * presupuestado». La celda de un bolsillo sigue siendo el aporte del mes; el retiro planeado sale de una
 * alcancía. Las capturas de los fixtures se tomaron sobre 434a89b, con el código ANTERIOR.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AVAILABLE_ID as D,
  RETIROS_PLAN_ID,
  applyReserveCellEdit,
  applyReserveOp,
  cellHeadroom,
  convertPlannedRetiros,
  editPlannedRetiro,
  maxWithdrawal,
  planRetiro,
  plannedRetiroKey,
  plannedRetiroRows,
  reserveLeafIds,
  reserveRetiros,
  resolvedBalance,
  resolvedSeries,
  type ReserveVerdict,
} from "@/domain/reserve";
import { computeBalanceSeries, type MonthBalance } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { worsenedBy } from "@/domain/guard";
import { adjustCell } from "@/domain/adjust";
import { deleteNode, moveNode } from "@/domain/mutations";
import { periodRange } from "@/domain/periods";
import { blockMessage } from "@/components/reserveText";
import type { AmountMap, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

const ENE = "2026-01" as PeriodKey;
const MAR = "2026-03" as PeriodKey;
const ABR = "2026-04" as PeriodKey;
const JUN = "2026-06" as PeriodKey;
const JUL = "2026-07" as PeriodKey;
const OCT = "2026-10" as PeriodKey;
const DIC = "2026-12" as PeriodKey;
const P = periodRange("2026-01", "2026-12");

const nodo = (id: string, type: LedgerNode["type"], level: LedgerNode["level"], parentId: string | null, order: number, name = id): LedgerNode =>
  ({ id, ownerId: "l", type, level, parentId, name, icon: null, order });
const NODES: LedgerNode[] = [
  nodo("g-i", "income", "group", null, 0), nodo("ing", "income", "category", "g-i", 1),
  nodo("g-e", "expense", "group", null, 2), nodo("gas", "expense", "category", "g-e", 3, "Mercado"),
  nodo("g-t", "transfer", "group", null, 4, "Ahorro"), nodo("A", "transfer", "category", "g-t", 5, "Viaje"),
  nodo("B", "transfer", "category", "g-t", 6, "Carro"),
];

function ledger(budgets: AmountMap = {}, actuals: AmountMap = {}, extra: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "l", nodes: NODES, budgets, actuals, movements: [], ...extra } as LedgerState;
}
function op(s: LedgerState, from: string, to: string, period: PeriodKey, amount: number): LedgerState {
  const r = applyReserveOp(s, { from, to, period, amount, date: `${period}-15T10:00` }, P);
  if (!("state" in r)) return expect.fail(`rechazada: ${JSON.stringify(r.rejected)}`);
  return r.state;
}
function ok<T extends object>(r: T): LedgerState {
  if ("rejected" in r) return expect.fail(`rechazada: ${JSON.stringify((r as { rejected: unknown }).rejected)}`);
  return (r as unknown as { state: LedgerState }).state;
}
/** El veredicto de bloqueo de un rechazo (falla si no lo es). */
function bloqueo(r: object): Extract<ReserveVerdict, { ok: false }> {
  if (!("rejected" in r)) return expect.fail("se esperaba un rechazo");
  const v = (r as { rejected: unknown }).rejected;
  if (typeof v !== "object" || v === null || (v as { ok: boolean }).ok) return expect.fail(`rechazo sin veredicto: ${JSON.stringify(v)}`);
  return v as Extract<ReserveVerdict, { ok: false }>;
}

/** Viaje (A) con 300 planeados en marzo; salario 1.000. */
const viaje300 = (extra: AmountMap = {}) => ledger({ ing: { [MAR]: 1000 }, A: { [MAR]: 300 }, ...extra });

// ── FR-3001 ──────────────────────────────────────────────────────────────────────────────────────

describe("FR-3001 — el «Máx.» del formulario Pres.", () => {
  it("TC-SDB-006e: el Máx. del plan mira los meses posteriores", () => {
    // @aitri-tc TC-SDB-006e
    const s = viaje300({ [plannedRetiroKey("A")]: { [JUN]: 250 } });
    expect(maxWithdrawal(s, "A", MAR, P, "budget")).toBe(50);
    expect(maxWithdrawal(s, "A", JUL, P, "budget")).toBe(50);
    expect(maxWithdrawal(s, "A", MAR, P, "actual")).toBe(0); // el plano real no ve el plan
  });
});

// ── FR-3002 ──────────────────────────────────────────────────────────────────────────────────────

describe("FR-3002 — cada retiro planeado sale de una alcancía y respeta las reglas", () => {
  it("TC-SDB-010h: planear 100 de Viaje en marzo lo guarda en su alcancía", () => {
    // @aitri-tc TC-SDB-010h
    const s = viaje300();
    const next = ok(planRetiro(s, { leafId: "A", period: MAR, amount: 100 }, P));
    expect(next.budgets[plannedRetiroKey("A")]).toEqual({ [MAR]: 100 });
    expect(resolvedBalance(next, "A", MAR, "budget", P)).toBe(200);
    expect(next.budgets.A).toEqual({ [MAR]: 300 });
    expect(next.movements).toEqual([]);
  });

  it("TC-SDB-011f: planear 301 se rechaza con «Viaje» solo tiene $300", () => {
    // @aitri-tc TC-SDB-011f
    const s = viaje300();
    const antes = structuredClone(s.budgets);
    const v = bloqueo(planRetiro(s, { leafId: "A", period: MAR, amount: 301 }, P));
    expect(v).toEqual({ ok: false, rule: "piso", period: MAR, leafId: "A", limit: 300 });
    expect(blockMessage(s, v, { editedMonth: MAR })).toContain("«Viaje» solo tiene $300");
    expect(s.budgets).toEqual(antes);
  });

  it("TC-SDB-012e: planear exactamente 300 se acepta y deja 0", () => {
    // @aitri-tc TC-SDB-012e
    const next = ok(planRetiro(viaje300(), { leafId: "A", period: MAR, amount: 300 }, P));
    expect(next.budgets[plannedRetiroKey("A")][MAR]).toBe(300);
    expect(resolvedBalance(next, "A", MAR, "budget", P)).toBe(0);
  });

  it("TC-SDB-013f: un retiro planeado posterior hace rechazar el de marzo nombrando junio", () => {
    // @aitri-tc TC-SDB-013f
    const s = viaje300({ [plannedRetiroKey("A")]: { [JUN]: 250 } });
    const v = bloqueo(planRetiro(s, { leafId: "A", period: MAR, amount: 100 }, P));
    expect(v).toMatchObject({ rule: "piso", period: JUN, leafId: "A" });
    expect(blockMessage(s, v, { editedMonth: MAR })).toContain("junio");
    expect(s.budgets[plannedRetiroKey("A")]).toEqual({ [JUN]: 250 });
  });

  it("TC-SDB-014h: planear dos veces en la misma alcancía y mes suma", () => {
    // @aitri-tc TC-SDB-014h
    const s = viaje300({ [plannedRetiroKey("A")]: { [MAR]: 100 } });
    const next = ok(planRetiro(s, { leafId: "A", period: MAR, amount: 50 }, P));
    expect(next.budgets[plannedRetiroKey("A")]).toEqual({ [MAR]: 150 });
  });

  it("TC-SDB-015h: la nota «pasajes» se guarda con el retiro", () => {
    // @aitri-tc TC-SDB-015h
    const next = ok(planRetiro(viaje300(), { leafId: "A", period: MAR, amount: 100, note: "pasajes", day: "2026-03-10" }, P));
    const notas = next.cellNotes?.[plannedRetiroKey("A")]?.[MAR] ?? [];
    expect(notas).toHaveLength(1);
    expect(notas[0]).toMatchObject({ text: "pasajes", date: "2026-03-10" });
    expect(typeof notas[0].id).toBe("string");
    expect(plannedRetiroRows(next, MAR)).toEqual([{ leafId: "A", amount: 100, notes: ["pasajes"] }]);
  });

  it("TC-SDB-016f: una nota de 281 caracteres se rechaza sin guardar nada", () => {
    // @aitri-tc TC-SDB-016f
    const s = viaje300();
    expect(planRetiro(s, { leafId: "A", period: MAR, amount: 100, note: "x".repeat(281) }, P)).toEqual({ rejected: "invalid_note" });
    expect(s.budgets[plannedRetiroKey("A")]).toBeUndefined();
    const sinNota = ok(planRetiro(s, { leafId: "A", period: MAR, amount: 100, note: "   " }, P));
    expect(sinNota.budgets[plannedRetiroKey("A")]).toEqual({ [MAR]: 100 });
    expect(sinNota.cellNotes?.[plannedRetiroKey("A")]).toBeUndefined();
  });

  it("TC-SDB-017f: entradas imposibles se rechazan como invalid_target", () => {
    // @aitri-tc TC-SDB-017f
    const s = viaje300();
    const antes = structuredClone({ b: s.budgets, n: s.cellNotes });
    for (const amount of [0, -5, 1.5]) {
      expect(planRetiro(s, { leafId: "A", period: MAR, amount }, P), String(amount)).toEqual({ rejected: "invalid_target" });
    }
    expect(planRetiro(s, { leafId: "gas", period: MAR, amount: 100 }, P)).toEqual({ rejected: "invalid_target" });
    expect(planRetiro(s, { leafId: "A", period: "2031-01" as PeriodKey, amount: 100 }, P)).toEqual({ rejected: "invalid_target" });
    expect({ b: s.budgets, n: s.cellNotes }).toEqual(antes);
  });

  it("TC-SDB-018e: escala — 500 retiros planeados nunca dejan una alcancía del plan en negativo", () => {
    // @aitri-tc TC-SDB-018e
    const per = periodRange("2026-01", "2028-12");
    let x = 7;
    const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
    const bols = Array.from({ length: 10 }, (_, k) => `B${k}`);
    const nodes = [nodo("g-i", "income", "group", null, 0), nodo("ing", "income", "category", "g-i", 1), nodo("g-t", "transfer", "group", null, 2),
      ...bols.map((id, k) => nodo(id, "transfer", "category", "g-t", 3 + k))];
    const budgets: AmountMap = { ing: {} };
    for (const p of per) budgets.ing[p] = 100_000;
    for (const id of bols) {
      budgets[id] = {};
      for (const p of per) if (rnd() < 0.4) budgets[id][p] = 1 + Math.floor(rnd() * 2500);
    }
    let s = { ownerId: "l", nodes, budgets, actuals: {}, movements: [] } as LedgerState;
    let aceptados = 0;
    let suma = 0;
    for (let n = 0; n < 500; n++) {
      const leafId = bols[Math.floor(rnd() * bols.length)];
      const period = per[Math.floor(rnd() * per.length)];
      const amount = 1 + Math.floor(rnd() * 3000);
      const r = planRetiro(s, { leafId, period, amount }, per);
      if ("state" in r) { s = r.state; aceptados++; suma += amount; }
      else expect(r.rejected).toMatchObject({ ok: false, rule: "piso" }); // un rechazo nunca muta: `s` sigue siendo el mismo
    }
    expect(aceptados).toBeGreaterThan(0);
    let puntos = 0;
    for (const id of bols) {
      for (const v of resolvedSeries(s, id, "budget", per)) { expect(v).toBeGreaterThanOrEqual(0); puntos++; }
    }
    expect(puntos).toBe(360);
    expect(per.reduce((acc, p) => acc + reserveRetiros(s, p, "budget"), 0)).toBe(suma);
  });

  it("TC-SDB-020e: fusionar una alcancía mueve su retiro planeado y sus notas", () => {
    // @aitri-tc TC-SDB-020e
    let s = ledger({ ing: { [MAR]: 1000 }, A: { [MAR]: 300 }, B: { [MAR]: 200 }, [plannedRetiroKey("B")]: { [MAR]: 50 } });
    s = ok(planRetiro(s, { leafId: "A", period: MAR, amount: 100, note: "pasajes" }, P));
    // B entra bajo A (categoría-hoja con montos): los datos de A se trasladan a B por repointMovements.
    const r = moveNode(s, "B", { kind: "category", id: "A" });
    const next = ok(r);
    expect(next.budgets[plannedRetiroKey("B")]).toEqual({ [MAR]: 150 });
    expect(next.cellNotes?.[plannedRetiroKey("B")]?.[MAR]?.map((n) => n.text)).toEqual(["pasajes"]);
    expect(next.budgets[plannedRetiroKey("A")]).toBeUndefined();
    expect(next.cellNotes?.[plannedRetiroKey("A")]).toBeUndefined();
  });

  it("TC-SDB-021f: borrar una alcancía con retiro planeado se bloquea", () => {
    // @aitri-tc TC-SDB-021f
    const s = ledger({ [plannedRetiroKey("A")]: { [MAR]: 100 } });
    expect(deleteNode(s, "A", P)).toEqual({ blocked: "has_data" });
  });
});

// ── FR-3003 ──────────────────────────────────────────────────────────────────────────────────────

describe("FR-3003 — los retiros planeados se corrigen desde la lista", () => {
  const con100 = () => viaje300({ [plannedRetiroKey("A")]: { [MAR]: 100 } });

  it("TC-SDB-030h: cambiar el retiro planeado de 100 a 60", () => {
    // @aitri-tc TC-SDB-030h
    const next = ok(editPlannedRetiro(con100(), "A", MAR, 60, P));
    expect(next.budgets[plannedRetiroKey("A")]).toEqual({ [MAR]: 60 });
    expect(resolvedBalance(next, "A", MAR, "budget", P)).toBe(240);
  });

  it("TC-SDB-031h: poner 0 elimina el retiro y sus notas", () => {
    // @aitri-tc TC-SDB-031h
    const s = ok(planRetiro(viaje300(), { leafId: "A", period: MAR, amount: 100, note: "pasajes" }, P));
    const next = ok(editPlannedRetiro(s, "A", MAR, 0, P));
    expect(next.budgets[plannedRetiroKey("A")]?.[MAR]).toBeUndefined();
    expect(next.cellNotes?.[plannedRetiroKey("A")]?.[MAR]).toBeUndefined();
    expect(plannedRetiroRows(next, MAR)).toEqual([]);
  });

  it("TC-SDB-032f: subirlo por encima de lo planeado se rechaza con el tope real", () => {
    // @aitri-tc TC-SDB-032f
    const s = con100();
    const v = bloqueo(editPlannedRetiro(s, "A", MAR, 301, P));
    expect(v).toEqual({ ok: false, rule: "piso", period: MAR, leafId: "A", limit: 300 });
    expect(s.budgets[plannedRetiroKey("A")]).toEqual({ [MAR]: 100 });
  });

  it("TC-SDB-033e: subirlo justo al tope se acepta", () => {
    // @aitri-tc TC-SDB-033e
    const next = ok(editPlannedRetiro(con100(), "A", MAR, 300, P));
    expect(next.budgets[plannedRetiroKey("A")]).toEqual({ [MAR]: 300 });
    expect(resolvedBalance(next, "A", MAR, "budget", P)).toBe(0);
  });

  it("TC-SDB-034h: dos retiros con nota se ven en una línea con las notas unidas", () => {
    // @aitri-tc TC-SDB-034h
    let s = ledger({ ing: { [MAR]: 1000 }, A: { [MAR]: 500 } });
    s = ok(planRetiro(s, { leafId: "A", period: MAR, amount: 100, note: "pasajes" }, P));
    s = ok(planRetiro(s, { leafId: "A", period: MAR, amount: 50, note: "hotel" }, P));
    expect(plannedRetiroRows(s, MAR)).toEqual([{ leafId: "A", amount: 150, notes: ["pasajes", "hotel"] }]);
  });

  it("TC-SDB-035f: montos imposibles al corregir se rechazan", () => {
    // @aitri-tc TC-SDB-035f
    const s = con100();
    expect(editPlannedRetiro(s, "A", MAR, -1, P)).toEqual({ rejected: "invalid_target" });
    expect(editPlannedRetiro(s, "A", MAR, 2.5, P)).toEqual({ rejected: "invalid_target" });
    expect(editPlannedRetiro(s, "gas", MAR, 50, P)).toEqual({ rejected: "invalid_target" });
    expect(s.budgets[plannedRetiroKey("A")]).toEqual({ [MAR]: 100 });
  });
});

// ── FR-3004 ──────────────────────────────────────────────────────────────────────────────────────

describe("FR-3004 — la celda Pres. de «Retiros del mes» suma", () => {
  it("TC-SDB-042h: reserveRetiros del plan suma todas las filas", () => {
    // @aitri-tc TC-SDB-042h
    const s = ledger({ [plannedRetiroKey("A")]: { [MAR]: 100 }, [plannedRetiroKey("B")]: { [MAR]: 50 }, [RETIROS_PLAN_ID]: { [MAR]: 7 } });
    expect(reserveRetiros(s, MAR, "budget")).toBe(157);
  });

  it("TC-SDB-043f: ni otro mes ni un retiro real cuentan en la suma del plan", () => {
    // @aitri-tc TC-SDB-043f
    let s = ledger({ [plannedRetiroKey("A")]: { [MAR]: 100 } }, { ing: { [ABR]: 1000 } });
    s = op(op(s, D, "A", ABR, 500), "A", D, ABR, 80);
    expect(reserveRetiros(s, ABR, "budget")).toBe(0);
    expect(reserveRetiros(s, ABR, "actual")).toBe(80);
  });
});

// ── FR-3006 ──────────────────────────────────────────────────────────────────────────────────────

describe("FR-3006 — los retiros planeados sin alcancía se reparten solos", () => {
  it("TC-SDB-050h: el retiro viejo va entero a la alcancía con más plan", () => {
    // @aitri-tc TC-SDB-050h
    const s = ledger({ ing: { [JUL]: 50_000_000 }, A: { [JUL]: 43_728_582 }, B: { [OCT]: 1_000_000 }, [RETIROS_PLAN_ID]: { [OCT]: 10_000_000 } });
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

  it("TC-SDB-056f: sin alcancías, el retiro viejo se conserva", () => {
    // @aitri-tc TC-SDB-056f
    const s = { ownerId: "l", nodes: NODES.filter((n) => n.type !== "transfer"), budgets: { [RETIROS_PLAN_ID]: { [MAR]: 300 } }, actuals: {}, movements: [] } as LedgerState;
    const r = convertPlannedRetiros(s, P);
    expect(r.converted).toBe(false);
    expect(r.state).toBe(s);
    expect(reserveRetiros(r.state, MAR, "budget")).toBe(300);
  });
});

// ── FR-3008 ──────────────────────────────────────────────────────────────────────────────────────

describe("FR-3008 — el guardia ve las filas por alcancía", () => {
  it("TC-SDB-072e: el guardia ve un cambio solo en la fila de la alcancía", () => {
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

  it("TC-SDB-103f: planear y eliminar deja el Balance como estaba", () => {
    // @aitri-tc TC-SDB-103f
    const c = captura("sdb-base.json");
    const base = convertPlannedRetiros(c.state, c.periods).state;
    const conPlan = c.periods.flatMap((p) => reserveLeafIds(base).filter((id) => resolvedBalance(base, id, p, "budget", c.periods) >= 100).map((id) => ({ id, p })));
    expect(conPlan.length, "el fixture necesita una alcancía con plan").toBeGreaterThan(0);
    const { id, p } = conPlan[0];
    const antes = computeBalanceSeries(base, c.periods, openingCarry(base, c.periods));
    const planeado = ok(planRetiro(base, { leafId: id, period: p, amount: 100 }, c.periods));
    expect(computeBalanceSeries(planeado, c.periods, openingCarry(planeado, c.periods))).not.toEqual(antes);
    const eliminado = ok(editPlannedRetiro(planeado, id, p, 0, c.periods));
    expect(computeBalanceSeries(eliminado, c.periods, openingCarry(eliminado, c.periods))).toEqual(antes);
  });
});

// ── NFR-3002 / NFR-3003 ──────────────────────────────────────────────────────────────────────────

describe("NFR-3002 — el registro de reservas no cambia", () => {
  const conIngreso = (v: number): AmountMap => ({ ing: { [ENE]: v } });

  it("TC-SDB-111h: meter desde el registro sigue igual", () => {
    // @aitri-tc TC-SDB-111h
    const s = op(ledger({}, conIngreso(1000)), D, "A", ENE, 400);
    expect(resolvedBalance(s, "A", ENE, "actual", P)).toBe(400);
    expect(s.actuals.A[ENE]).toBe(400);
  });

  it("TC-SDB-112e: mover entre alcancías sigue igual", () => {
    // @aitri-tc TC-SDB-112e
    const s = op(op(ledger({}, conIngreso(1000)), D, "A", ENE, 500), "A", "B", ENE, 200);
    expect(resolvedBalance(s, "A", ENE, "actual", P)).toBe(300);
    expect(resolvedBalance(s, "B", ENE, "actual", P)).toBe(200);
  });

  it("TC-SDB-113f: sacar de más desde el registro se rechaza igual", () => {
    // @aitri-tc TC-SDB-113f
    const s = op(ledger({}, conIngreso(1000)), D, "A", ENE, 300);
    expect(applyReserveOp(s, { from: "A", to: D, period: ENE, amount: 301 }, P)).toEqual({ rejected: { ok: false, rule: "piso", period: ENE, leafId: "A", limit: 300 } });
  });
});

describe("NFR-3003 — las reglas no cambian", () => {
  const enero = () => ledger({}, { ing: { [ENE]: 1000 }, A: { [ENE]: 500 } });

  it("TC-SDB-121h: el techo acepta su límite exacto", () => {
    // @aitri-tc TC-SDB-121h
    const s = enero();
    expect(cellHeadroom(s, "A", ENE, "actual", P)).toBe(1000);
    const r = applyReserveCellEdit(s, { leafId: "A", period: ENE, plane: "actual", newAmount: 1000 }, P);
    expect(ok(r).actuals.A[ENE]).toBe(1000);
  });

  it("TC-SDB-122f: un peso más se rechaza", () => {
    // @aitri-tc TC-SDB-122f
    const r = applyReserveCellEdit(enero(), { leafId: "A", period: ENE, plane: "actual", newAmount: 1001 }, P);
    expect(bloqueo(r)).toMatchObject({ rule: "techo", period: ENE });
  });

  it("TC-SDB-123e: el déficit sigue bloqueando", () => {
    // @aitri-tc TC-SDB-123e
    const s = ledger({}, { ing: { [OCT]: 1000 }, gas: { [DIC]: 900 } });
    const r = applyReserveCellEdit(s, { leafId: "A", period: OCT, plane: "actual", newAmount: 200 }, P);
    expect(bloqueo(r)).toMatchObject({ rule: "deficit", period: DIC });
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

  it("TC-SDB-153f: un bolsillo nunca recibe un ajuste", () => {
    // @aitri-tc TC-SDB-153f
    const s = ledger({}, { ing: { [MAR]: 2000 }, A: { [MAR]: 1000 } });
    expect(adjustCell(s, "A", MAR, 800, "2026-03-20T10:00", P)).toEqual({ rejected: "transfer" });
    const next = ok(applyReserveCellEdit(s, { leafId: "A", period: MAR, plane: "actual", newAmount: 800 }, P));
    expect(next.actuals.A[MAR]).toBe(800);
    expect(next.movements).toHaveLength(s.movements.length);
  });
});
