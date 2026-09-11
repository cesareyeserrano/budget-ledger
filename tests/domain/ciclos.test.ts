/**
 * Feature ciclos — EP-01: el dominio puro (src/domain/cycles.ts y los módulos que toca).
 * TCs: FR-2401 (006f) · FR-2402 (010h…019e) · FR-2404 (030h…041e, 148e, 170f, 172e…175f) · FR-2405 (046e,047e,053h) ·
 *      FR-2406 (055e,057f,059e) · FR-2407 (066e,070f,071e) · FR-2408 (073h,076e,077e,080e,149e,150e,151e,155e) ·
 *      FR-2408 (178e) · FR-2409 (083e,085e,086e,087e) · FR-2410 (091e,093e,094e,179e…184f) · NFR-2402 (103h,104e,105f) ·
 *      NFR-2403 (106h,107e,108f) · NFR-2404 (109h,110e) · NFR-2405 (112h) · NFR-2407 (118h,119e,120f,121e)
 *
 * Todo es aritmética sobre LedgerState y fechas civiles: sin DOM, sin BD, sin reloj (hoy entra como
 * argumento). Los valores esperados están en 03_TEST_CASES.json; aquí no se inventa ninguno.
 */
import { describe, it, expect } from "vitest";
import {
  buildCalendar, MONTH_CALENDAR, InvalidCycleConfig, relocate, movementDeltas, reassignMovementPeriod,
  proposeOpeningCycle, isValidMovementPeriod, planVersionChange, checkRelocationInvariants, addDays,
  daysBetween, anchorDateOf, NO_CYCLES, type Calendar,
} from "@/domain/cycles";
import {
  addMonths, comparePeriods, isPeriodKey, periodYear, periodMonth, periodRange,
} from "@/domain/periods";
import { activeRange, activeBounds, activeKeys } from "@/domain/range";
import {
  closeMonth, reopenMonth, closureOf, isClosed, nextClosable, nextReopenable, normalizeClosure,
  checkClosureNeighbors, closedPeriodsViolated,
} from "@/domain/closure";
import { computeBalanceSeries, ZERO_CARRY } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { addMovement } from "@/domain/mutations";
import { applyReserveOp, resolvedBalance, AVAILABLE_ID } from "@/domain/reserve";
import { currentPeriodFor } from "@/lib/date";
import { cyclesTargetSchema } from "@/server/schemas";
import type { CycleConfig, CycleVersion, LedgerState, Movement, PeriodKey } from "@/domain/types";
import {
  estadoSyn, estadoReal, mv, mvTransfer, resetSeq, celdasPorPeriodo, sumaMapa, sumaMovimientos,
} from "../fixtures/ciclos";
import { estadoUsuario, hojaPorNombre as U } from "../fixtures/ciclos-usuario";
import { CRONOMETRO_FIABLE, mejorTiempo } from "../helpers/perf";

// ── Utilidades del fichero ───────────────────────────────────────────────────────────────────────
const BOUNDS = { from: "2026-06", to: "2028-12" } as const;
const HOY = "2026-09-10";
function version(over: Partial<CycleVersion> = {}): CycleVersion {
  return { seq: 1, mode: "cycle", anchorDay: 21, eomPolicy: "last_day", effectiveFrom: HOY, firstPay: null, restoreStartMonth: "2026-08", createdAt: `${HOY}T00:00:00.000Z`, ...over };
}
const CFG21: CycleConfig = { mode: "cycle", versions: [version()] };
function cfg21to(day: number, firstPay: string, policy: "last_day" | "shift" = "last_day"): CycleConfig {
  return { mode: "cycle", versions: [version(), version({ seq: 2, anchorDay: day, eomPolicy: policy, effectiveFrom: firstPay, firstPay })] };
}
const CAL21 = buildCalendar(CFG21, BOUNDS);
function keysDe(s: LedgerState, cal: Calendar, hoy = HOY, h: 1 | 2 = 2) { return activeKeys(s, cal, currentPeriodFor(cal, hoy), h); }
function todasLasClaves(s: LedgerState): PeriodKey[] {
  const out = new Set<PeriodKey>();
  for (const m of [s.budgets, s.actuals]) for (const c of Object.values(m)) for (const p of Object.keys(c ?? {})) out.add(p);
  for (const m of s.movements) out.add(m.period);
  for (const byP of Object.values(s.cellNotes ?? {})) for (const p of Object.keys(byP ?? {})) out.add(p);
  return [...out].sort(comparePeriods);
}
function ok(r: ReturnType<typeof relocate>): Extract<ReturnType<typeof relocate>, { state: LedgerState }> {
  if ("blocked" in r) throw new Error(`reubicación bloqueada: ${r.blocked} ${JSON.stringify(r.detail)}`);
  return r;
}

/** Celdas (incluidas las que valen 0) de un estado. */
function celdas(st: LedgerState): number { return [st.budgets, st.actuals].reduce((a, m) => a + Object.values(m).reduce((b, c) => b + Object.keys(c ?? {}).length, 0), 0); }
function ceros(st: LedgerState): number { return [st.budgets, st.actuals].reduce((a, m) => a + Object.values(m).reduce((b, c) => b + Object.values(c ?? {}).filter((v) => v === 0).length, 0), 0); }
function partes(st: LedgerState, subject: "budget" | "actual", ref: string) {
  return (st.origins ?? []).filter((o) => o.subject === subject && o.ref === ref)
    .map(({ period, originPeriod, amount }) => ({ period, originPeriod, amount }))
    .sort((a, b) => comparePeriods(a.originPeriod, b.originPeriod));
}
function conCelda(st: LedgerState, plano: "budgets" | "actuals", hoja: string, periodo: PeriodKey, valor: number | undefined): LedgerState {
  const celdasHoja = { ...(st[plano][hoja] ?? {}) };
  if (valor === undefined) delete celdasHoja[periodo]; else celdasHoja[periodo] = valor;
  return { ...st, [plano]: { ...st[plano], [hoja]: celdasHoja } };
}

describe("FR-2401 — el borde del modo", () => {
  it("TC-CIC-006f: cyclesTargetSchema rechaza 'abc', vacío, 21.5 y 0 y acepta 1 y 31", () => {
    // @aitri-tc TC-CIC-006f
    for (const x of ["abc", "", 21.5, 0, 32, null]) {
      const r = cyclesTargetSchema.safeParse({ mode: "cycle", anchorDay: x, eomPolicy: "last_day" });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "anchorDay")).toBe(true);
    }
    for (const x of [1, 31]) expect(cyclesTargetSchema.safeParse({ mode: "cycle", anchorDay: x, eomPolicy: "last_day" }).success).toBe(true);
  });
});

describe("FR-2402 — el calendario", () => {
  it("TC-CIC-010h: Día 21: «Septiembre 2026» = 2026-08-21..2026-09-20 y 24 meses contiguos", () => {
    // @aitri-tc TC-CIC-010h
    const cal = buildCalendar(CFG21, { from: "2026-08", to: "2028-08" });
    expect(cal.rangeOf("2026-09")).toEqual({ start: "2026-08-21", end: "2026-09-20" });
    expect(cal.rangeOf("2026-10")).toEqual({ start: "2026-09-21", end: "2026-10-20" });
    const keys = cal.keys("2026-08", "2028-08");
    expect(keys.length).toBe(25);
    for (let i = 0; i + 1 < keys.length; i++) expect(addDays(cal.rangeOf(keys[i]!)!.end, 1)).toBe(cal.rangeOf(keys[i + 1]!)!.start);
  });
  it("TC-CIC-011e: Día 31 con «último día del mes»: marzo empieza el 28-feb (2027) y el 29-feb (2028)", () => {
    // @aitri-tc TC-CIC-011e
    const cal = buildCalendar({ mode: "cycle", versions: [version({ anchorDay: 31 })] }, { from: "2027-01", to: "2028-06" });
    expect(cal.rangeOf("2027-03")!.start).toBe("2027-02-28");
    expect(cal.rangeOf("2028-03")!.start).toBe("2028-02-29");
    expect(cal.rangeOf("2027-02")).toEqual({ start: "2027-01-31", end: "2027-02-27" });
    const keys = cal.keys("2027-01", "2028-06");
    for (let i = 0; i + 1 < keys.length; i++) expect(addDays(cal.rangeOf(keys[i]!)!.end, 1)).toBe(cal.rangeOf(keys[i + 1]!)!.start);
  });
  it("TC-CIC-012e: Día 30 con «desplazar»: febrero abre el 1-mar y el anterior termina el 28-feb", () => {
    // @aitri-tc TC-CIC-012e
    const cal = buildCalendar({ mode: "cycle", versions: [version({ anchorDay: 30, eomPolicy: "shift" })] }, { from: "2027-01", to: "2027-06" });
    expect(cal.rangeOf("2027-03")!.start).toBe("2027-03-01");
    expect(cal.rangeOf("2027-02")).toEqual({ start: "2027-01-30", end: "2027-02-28" });
    expect(cal.rangeOf("2027-04")).toEqual({ start: "2027-03-30", end: "2027-04-29" });
  });
  it("TC-CIC-013f: Día 0 no genera calendario y el anterior queda intacto", () => {
    // @aitri-tc TC-CIC-013f
    const calPrev = buildCalendar(CFG21, BOUNDS);
    expect(() => buildCalendar({ mode: "cycle", versions: [version({ anchorDay: 0 })] }, BOUNDS)).toThrow(InvalidCycleConfig);
    expect(() => buildCalendar({ mode: "cycle", versions: [version({ anchorDay: 0 })] }, BOUNDS)).toThrow(/anchorDay/);
    expect(calPrev.keys("2026-08", "2026-12")).toEqual(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
  });
  it("TC-CIC-014e: Propiedad: duración en [28,31], ninguna fecha en dos ciclos, día 1 = meses calendario", () => {
    // @aitri-tc TC-CIC-014e
    const dias: string[] = [];
    for (let d = "2026-01-01"; d <= "2028-12-31"; d = addDays(d, 1)) dias.push(d);
    for (const policy of ["last_day", "shift"] as const) {
      for (let day = 1; day <= 31; day++) {
        const cal = buildCalendar({ mode: "cycle", versions: [version({ anchorDay: day, eomPolicy: policy })] }, { from: "2026-01", to: "2028-12" });
        for (const k of cal.keys("2026-02", "2028-11")) {
          const r = cal.rangeOf(k)!;
          const len = daysBetween(r.start, r.end) + 1;
          expect(len, `${policy} día ${day} clave ${k}`).toBeGreaterThanOrEqual(28);
          expect(len).toBeLessThanOrEqual(31);
        }
        for (let i = 0; i < dias.length; i += 7) {
          const d = dias[i]!;
          const k = cal.periodForDate(d);
          const r = cal.rangeOf(k)!;
          expect(r.start <= d && d <= r.end).toBe(true);
          const cuantas = cal.keys("2025-12", "2029-02").filter((x) => { const q = cal.rangeOf(x)!; return q.start <= d && d <= q.end; }).length;
          expect(cuantas).toBe(1);
        }
      }
    }
    const cal1 = buildCalendar({ mode: "cycle", versions: [version({ anchorDay: 1 })] }, { from: "2026-01", to: "2026-12" });
    expect(cal1.rangeOf("2026-03")).toEqual({ start: "2026-03-01", end: "2026-03-31" });
  });
  it("TC-CIC-015e: Bisiesto: el 29-feb solo existe en 2028; día 29 «último día» febrero de 2027 abre el 28", () => {
    // @aitri-tc TC-CIC-015e
    const cal = buildCalendar({ mode: "cycle", versions: [version({ anchorDay: 29 })] }, { from: "2027-01", to: "2028-04" });
    expect(cal.rangeOf("2027-03")!.start).toBe("2027-02-28");
    expect(cal.rangeOf("2028-03")!.start).toBe("2028-02-29");
    expect(cal.entries().some((e) => e.start === "2027-02-29")).toBe(false);
  });
  it("TC-CIC-016e: keys() entre dos versiones incluye la clave de transición en su posición", () => {
    // @aitri-tc TC-CIC-016e
    const cal = buildCalendar(cfg21to(30, "2026-10-30"), BOUNDS);
    expect(cal.keys("2026-09", "2026-12")).toEqual(["2026-09", "2026-10", "2026-10t", "2026-11", "2026-12"]);
    expect(cal.isTransition("2026-10t")).toBe(true);
    expect(cal.next("2026-10")).toBe("2026-10t");
    expect(cal.prev("2026-11")).toBe("2026-10t");
  });
  it("TC-CIC-017f: effectiveFrom no ISO se rechaza en dominio y en el borde", () => {
    // @aitri-tc TC-CIC-017f
    expect(() => buildCalendar({ mode: "cycle", versions: [version({ effectiveFrom: "2026-13-40" })] }, BOUNDS)).toThrow(InvalidCycleConfig);
    const r = cyclesTargetSchema.safeParse({ mode: "cycle", anchorDay: 21, eomPolicy: "last_day", firstPayDate: "2026-13-40" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === "firstPayDate")).toBe(true);
  });
  it("TC-CIC-018e: periodForDate en las cuatro fronteras del 21", () => {
    // @aitri-tc TC-CIC-018e
    expect(["2026-08-20", "2026-08-21", "2026-09-20", "2026-09-21"].map((d) => CAL21.periodForDate(d))).toEqual(["2026-08", "2026-09", "2026-09", "2026-10"]);
  });
  it("TC-CIC-019e: Volumen: 36 meses × 3 versiones en <5ms y 10.000 periodForDate en <50ms", () => {
    // @aitri-tc TC-CIC-019e
    const cfg: CycleConfig = { mode: "cycle", versions: [version(), version({ seq: 2, anchorDay: 30, effectiveFrom: "2026-10-30", firstPay: "2026-10-30" }), version({ seq: 3, anchorDay: 5, effectiveFrom: "2027-03-05", firstPay: "2027-03-05" })] };
    const bounds = { from: "2026-06", to: "2029-05" };
    const tBuild = mejorTiempo(() => buildCalendar(cfg, bounds), 5);
    const cal = buildCalendar(cfg, bounds);
    const keys = new Set(cal.keys("2026-06", "2029-05"));
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const fechas = Array.from({ length: 10_000 }, () => addDays("2026-07-01", Math.floor(rnd() * 1000)));
    const tLookup = mejorTiempo(() => { for (const d of fechas) cal.periodForDate(d); }, 3);
    for (const d of fechas.slice(0, 200)) expect(keys.has(cal.periodForDate(d))).toBe(true);
    if (CRONOMETRO_FIABLE) { expect(tBuild).toBeLessThan(5); expect(tLookup).toBeLessThan(50); }
  });
});

describe("FR-2404 — activar reubica", () => {
  it("TC-CIC-030h: relocate sobre F-USER: presupuesto y ejecutado de cada rubro juntos en Septiembre, solo el Salario en Octubre, sumas idénticas", () => {
    // @aitri-tc TC-CIC-030h
    const s = estadoUsuario();
    expect(celdas(s)).toBe(50);
    expect(ceros(s)).toBe(5);
    expect(s.movements.length).toBe(27);
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    const hojas = [...new Set([...Object.keys(s.budgets), ...Object.keys(s.actuals)])];
    expect(hojas.length).toBe(19);
    for (const h of hojas) expect(r.state.budgets[h]?.["2026-09"] ?? 0, h).toBe(r.state.actuals[h]?.["2026-09"] ?? 0);
    expect(r.state.budgets[U("Agua")]!["2026-09"]).toBe(226_300);
    expect(r.state.budgets[U("Hipoteca")]!["2026-09"]).toBe(1_318_200);
    expect(r.state.budgets[U("Restaurantes")]!["2026-09"]).toBe(849_100);
    expect(r.state.actuals[U("Ahorros")]!["2026-09"]).toBe(35_062_400);
    const salario = Object.fromEntries(Object.entries(r.state.budgets[U("Salario")] ?? {}).filter(([, v]) => v !== 0));
    expect(salario).toEqual({ "2026-09": 8_450_000, "2026-10": 8_450_000 });
    for (const m of [r.state.budgets, r.state.actuals]) for (const c of Object.values(m)) expect(c?.["2026-08"] ?? 0).toBe(0);
    expect(r.state.movements.every((m) => m.period === "2026-09")).toBe(true);
    expect(r.state.startMonth).toBe("2026-09");
    expect(r.state.openingBalance).toBe(32_180_000);
    expect(sumaMapa(r.state.budgets)).toBe(sumaMapa(s.budgets));
    expect(sumaMapa(r.state.actuals)).toBe(sumaMapa(s.actuals));
    expect(sumaMovimientos(r.state)).toBe(sumaMovimientos(s));
    expect(ceros(r.state)).toBe(5);
    expect(r.summary).toMatchObject({ cellsMoved: 15, movementsKeyChanged: 10, mergedCells: 3, identical: true });
  });
  it("TC-CIC-031e: caso 1 y movimiento sin fecha: el presupuesto va al ciclo con la mayor suma y el sin fecha sigue la costumbre de su rubro", () => {
    // @aitri-tc TC-CIC-031e
    resetSeq();
    const g30 = mv("expense", "c-comida", 30, "2026-09-05", "2026-09");
    const g70 = mv("expense", "c-comida", 70, "2026-09-25", "2026-09");
    const t1 = mv("expense", "c-transporte", 5_000, "2026-08-05", "2026-08");
    const t2: Movement = { ...mv("expense", "c-transporte", 10_000, "2026-09-05", "2026-09") };
    delete (t2 as { date?: string }).date;
    const s = estadoSyn({
      movements: [g30, g70, t1, t2],
      budgets: { "c-comida": { "2026-09": 100 } },
      actuals: { "c-comida": { "2026-09": 100 }, "c-transporte": { "2026-08": 5_000, "2026-09": 10_000 } },
    });
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(r.state.budgets["c-comida"]).toEqual({ "2026-10": 100 });
    expect(r.state.actuals["c-comida"]).toEqual({ "2026-09": 30, "2026-10": 70 });
    expect(r.state.movements.find((m) => m.id === t2.id)!.period).toBe("2026-09");
    expect(r.state.actuals["c-transporte"]).toEqual({ "2026-08": 5_000, "2026-09": 10_000 });
  });
  it("TC-CIC-033e: toda clave pertenece a calendar.keys y ningún movimiento aparece en dos ciclos", () => {
    // @aitri-tc TC-CIC-033e
    const r = ok(relocate(estadoReal(), MONTH_CALENDAR, CAL21, HOY));
    const keys = new Set(CAL21.keys(BOUNDS.from, BOUNDS.to));
    for (const k of todasLasClaves(r.state)) { expect(keys.has(k)).toBe(true); expect(k.endsWith("t")).toBe(false); }
    const porId = new Map<string, Set<PeriodKey>>();
    for (const m of r.state.movements) { if (!porId.has(m.id)) porId.set(m.id, new Set()); porId.get(m.id)!.add(m.period); }
    expect(porId.size).toBe(27);
    for (const ps of porId.values()) expect(ps.size).toBe(1);
  });
  it("TC-CIC-034e: el movimiento fechado más antiguo ancla el inicio: 2026-08-15 abre «Agosto»", () => {
    // @aitri-tc TC-CIC-034e
    resetSeq();
    const g = mv("expense", "c-comida", 12_000, "2026-08-15", "2026-08");
    const s = estadoSyn({ startMonth: "2026-08", openingBalance: 500_000, movements: [g], actuals: { "c-comida": { "2026-08": 12_000 } } });
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(r.state.startMonth).toBe("2026-08");
    expect(CAL21.rangeOf("2026-08")).toEqual({ start: "2026-07-21", end: "2026-08-20" });
    const keys = keysDe(r.state, CAL21);
    const series = computeBalanceSeries(r.state, keys, openingCarry(r.state, keys));
    expect(series["2026-08"]!.actual.prevAvailable).toBe(500_000);
    expect(series["2026-09"]!.actual.prevAvailable).toBe(500_000 - 12_000);
    expect(r.summary.restoreStartMonth).toBe("2026-08");
  });
  it("TC-CIC-035h: descomposición exacta con la regla nueva: el residuo tecleado sigue a la mayoría de su mes y cada movimiento a su fecha", () => {
    // @aitri-tc TC-CIC-035h
    resetSeq();
    const g70 = mv("expense", "c-comida", 70_000, "2026-09-05", "2026-09");
    const g30 = mv("expense", "c-comida", 30_000, "2026-09-25", "2026-09");
    const s = estadoSyn({ movements: [g70, g30], actuals: { "c-comida": { "2026-09": 400_000 } }, budgets: { "c-comida": { "2026-09": 500_000 } } });
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(r.state.actuals["c-comida"]).toEqual({ "2026-09": 370_000, "2026-10": 30_000 });
    expect(r.state.budgets["c-comida"]).toEqual({ "2026-09": 500_000 });
    expect(r.state.movements.map((m) => m.period)).toEqual(["2026-09", "2026-10"]);
    expect(partes(r.state, "actual", "c-comida")).toEqual([{ period: "2026-09", originPeriod: "2026-09", amount: 300_000 }]);
  });
  it("TC-CIC-036e: residuo negativo con la regla nueva: cae en el ciclo de sus movimientos, la celda queda positiva y la memoria guarda el residuo con signo", () => {
    // @aitri-tc TC-CIC-036e
    resetSeq();
    const g = mv("expense", "c-comida", 80_000, "2026-09-05", "2026-09");
    const s = estadoSyn({ movements: [g], actuals: { "c-comida": { "2026-09": 50_000 } } });
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(r.state.actuals["c-comida"]).toEqual({ "2026-09": 50_000 });
    expect(sumaMapa(r.state.actuals)).toBe(50_000);
    expect(r.summary.identical).toBe(true);
    expect(partes(r.state, "actual", "c-comida")).toEqual([{ period: "2026-09", originPeriod: "2026-09", amount: -30_000 }]);
  });
  it("TC-CIC-038e: un mes cerrado se desplaza con las celdas: closedThrough 2026-08 pasa a 2026-09", () => {
    // @aitri-tc TC-CIC-038e
    const s = estadoSyn({ closure: { closedThrough: "2026-08", reopened: null }, budgets: { "c-comida": { "2026-08": 1 } } });
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(r.state.closure).toEqual({ closedThrough: "2026-09", reopened: null });
    expect(isClosed(closureOf(r.state), "2026-09")).toBe(true);
    expect(isClosed(closureOf(r.state), "2026-10")).toBe(false);
  });
  it("TC-CIC-040e: las notas de celda siguen al presupuesto de su rubro y recuerdan su mes", () => {
    // @aitri-tc TC-CIC-040e
    resetSeq();
    const g = mv("expense", "c-comida", 1_000, "2026-08-25", "2026-08");
    const s = estadoSyn({ movements: [g], actuals: { "c-comida": { "2026-08": 1_000 } }, cellNotes: { "c-comida": { "2026-09": [{ id: "n1", createdAt: 1, text: "arroz" }] } } });
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(r.state.cellNotes).toEqual({ "c-comida": { "2026-10": [{ id: "n1", createdAt: 1, text: "arroz" }] } });
    expect(r.state.origins).toContainEqual({ subject: "note", ref: "n1", period: "2026-10", originPeriod: "2026-09", amount: 0 });
  });
  it("TC-CIC-041e: los movimientos de reserva conservan sus deltas: saldo derivado idéntico", () => {
    // @aitri-tc TC-CIC-041e
    resetSeq();
    const aporte = mvTransfer(AVAILABLE_ID, "c-alcancia", 50_000, "2026-08-25", "2026-08");
    const retiro = mvTransfer("c-alcancia", AVAILABLE_ID, 30_000, "2026-09-03", "2026-09");
    const s = estadoSyn({ movements: [aporte, retiro], actuals: { "c-alcancia": { "2026-08": 250_000 } } });
    const keysAntes = MONTH_CALENDAR.keys("2026-08", "2026-12");
    expect(resolvedBalance(s, "c-alcancia", "2026-12", "actual", keysAntes)).toBe(220_000);
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    const keysDespues = CAL21.keys("2026-08", "2026-12");
    expect(resolvedBalance(r.state, "c-alcancia", "2026-12", "actual", keysDespues)).toBe(220_000);
    expect(sumaMapa({ "c-alcancia": s.actuals["c-alcancia"]! })).toBe(250_000);
    expect(sumaMapa({ "c-alcancia": r.state.actuals["c-alcancia"]! })).toBe(250_000);
    expect(r.state.movements.every((m) => m.period === "2026-09")).toBe(true);
  });
  it("TC-CIC-148e: movementDeltas reproduce actuals; retiro y mover no escriben celda", () => {
    // @aitri-tc TC-CIC-148e
    resetSeq();
    const periods = MONTH_CALENDAR.keys("2026-08", "2026-12");
    let s = estadoSyn();
    const registrados: Movement[] = [];
    for (let i = 0; i < 10; i++) {
      s = addMovement(s, { type: "income", catId: "c-salario", amount: 1_000_000, period: "2026-09", date: `2026-09-0${(i % 8) + 1}T12:00` }, periods);
      registrados.push(s.movements[0]!);
      s = addMovement(s, { type: "expense", catId: "c-comida", amount: 20_000 + i, period: "2026-10", date: `2026-10-1${i % 9}T12:00` }, periods);
      registrados.push(s.movements[0]!);
    }
    for (let i = 0; i < 10; i++) {
      const a = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-alcancia", period: "2026-09", amount: 30_000, date: "2026-09-10T12:00" }, periods);
      expect("state" in a, "aporte aceptado").toBe(true);
      if ("state" in a) { s = a.state; registrados.push(a.movement); }
    }
    for (let i = 0; i < 5; i++) {
      const w = applyReserveOp(s, { from: "c-alcancia", to: AVAILABLE_ID, period: "2026-10", amount: 10_000, date: "2026-10-05T12:00" }, periods);
      expect("state" in w, "retiro aceptado").toBe(true);
      if ("state" in w) { s = w.state; registrados.push(w.movement); }
      const m = applyReserveOp(s, { from: "c-alcancia", to: "c-alcancia2", period: "2026-11", amount: 5_000, date: "2026-11-05T12:00" }, periods);
      expect("state" in m, "mover aceptado").toBe(true);
      if ("state" in m) { s = m.state; registrados.push(m.movement); }
    }
    expect(registrados.length).toBe(40);
    const suma: Record<string, Record<string, number>> = {};
    for (const m of registrados) for (const { leafId, delta } of movementDeltas(m)) { suma[leafId] = suma[leafId] ?? {}; suma[leafId]![m.period] = (suma[leafId]![m.period] ?? 0) + delta; }
    expect(suma).toEqual(s.actuals);
    for (const m of registrados) {
      const d = movementDeltas(m);
      if (m.type === "transfer" && m.from !== AVAILABLE_ID) expect(d).toEqual([]);
      else if (m.type === "transfer") expect(d).toEqual([{ leafId: m.to, delta: m.amount }]);
      else expect(d).toEqual([{ leafId: m.target, delta: m.amount }]);
    }
  });
  it("TC-CIC-170f: el residuo tecleado sigue al aporte fechado y el retiro anterior queda sin fondos: reserve_floor", () => {
    // @aitri-tc TC-CIC-170f
    resetSeq();
    const aporte = mvTransfer(AVAILABLE_ID, "c-alcancia", 10_000, "2026-08-25", "2026-08");
    const retiro = mvTransfer("c-alcancia", AVAILABLE_ID, 60_000, "2026-08-15", "2026-08");
    const s = estadoSyn({ movements: [aporte, retiro], actuals: { "c-alcancia": { "2026-08": 110_000 } } });
    const r = relocate(s, MONTH_CALENDAR, CAL21, HOY);
    expect(r).toMatchObject({ blocked: "relocation_invariant", detail: { rule: "reserve_floor", leafId: "c-alcancia", period: "2026-08" } });
    expect(s.actuals["c-alcancia"]).toEqual({ "2026-08": 110_000 });
    expect(s.movements.map((m) => m.period)).toEqual(["2026-08", "2026-08"]);
  });
  it("TC-CIC-172e: fusión con memoria sobre F-USER: Restaurantes suma agosto y septiembre y la memoria del Presupuestado recuerda cada parte", () => {
    // @aitri-tc TC-CIC-172e
    const r = ok(relocate(estadoUsuario(), MONTH_CALENDAR, CAL21, HOY));
    const rest = U("Restaurantes");
    expect(r.state.budgets[rest]!["2026-09"]).toBe(849_100);
    expect(partes(r.state, "budget", rest)).toEqual([
      { period: "2026-09", originPeriod: "2026-08", amount: 336_700 },
      { period: "2026-09", originPeriod: "2026-09", amount: 512_400 },
    ]);
    expect(partes(r.state, "actual", rest).map((p) => p.amount)).toEqual([0, 0]);
    expect(partes(r.state, "budget", U("Agua"))).toEqual([{ period: "2026-09", originPeriod: "2026-09", amount: 226_300 }]);
    expect(r.summary.mergedCells).toBe(3);
    expect((r.state.origins ?? []).length).toBe(50);
  });
  it("TC-CIC-173e: caso 2 y caso 3: sin movimientos en el mes decide la costumbre del rubro; sin historia todo queda en el ciclo del mismo nombre", () => {
    // @aitri-tc TC-CIC-173e
    resetSeq();
    const salario = mv("income", "c-salario", 1_000, "2026-08-21", "2026-08");
    const comida = mv("expense", "c-comida", 3_000, "2026-09-02", "2026-09");
    const s = estadoSyn({
      movements: [salario, comida],
      budgets: { "c-salario": { "2026-10": 8_450_000 }, "c-comida": { "2026-10": 50_000 }, "c-alcancia": { "2026-09": 200_000 } },
      actuals: { "c-salario": { "2026-08": 1_000 }, "c-comida": { "2026-09": 3_000 }, "c-alcancia": { "2026-09": 200_000 } },
    });
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(r.state.budgets["c-salario"]).toEqual({ "2026-11": 8_450_000 });
    expect(r.state.budgets["c-comida"]).toEqual({ "2026-10": 50_000 });
    expect(r.state.budgets["c-alcancia"]).toEqual({ "2026-09": 200_000 });
    expect(r.state.actuals["c-alcancia"]).toEqual({ "2026-09": 200_000 });
  });
  it("TC-CIC-174e: empate en el caso 1: con 50 y 50 a ambos lados del día de pago el presupuesto va al ciclo más antiguo", () => {
    // @aitri-tc TC-CIC-174e
    resetSeq();
    const a = mv("expense", "c-comida", 50, "2026-09-05", "2026-09");
    const b = mv("expense", "c-comida", 50, "2026-09-25", "2026-09");
    const s = estadoSyn({ movements: [a, b], budgets: { "c-comida": { "2026-09": 100 } }, actuals: { "c-comida": { "2026-09": 100 } } });
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(r.state.budgets["c-comida"]).toEqual({ "2026-09": 100 });
    expect(r.state.actuals["c-comida"]).toEqual({ "2026-09": 50, "2026-10": 50 });
  });
  it("TC-CIC-175f: un Ejecutado tecleado por debajo de sus movimientos en dos meses bloquea la activación con negative_cell", () => {
    // @aitri-tc TC-CIC-175f
    resetSeq();
    const ago = mv("expense", "c-comida", 100, "2026-08-25", "2026-08");
    const sep1 = mv("expense", "c-comida", 30, "2026-09-05", "2026-09");
    const sep2 = mv("expense", "c-comida", 20, "2026-09-25", "2026-09");
    const oct = mv("expense", "c-comida", 100, "2026-10-05", "2026-10");
    const s = estadoSyn({ movements: [ago, sep1, sep2, oct], actuals: { "c-comida": { "2026-08": 0, "2026-09": 0, "2026-10": 100 } } });
    const r = relocate(s, MONTH_CALENDAR, CAL21, HOY);
    expect(r).toMatchObject({ blocked: "relocation_invariant", detail: { rule: "negative_cell", leafId: "c-comida", period: "2026-09" } });
    expect(s.actuals["c-comida"]).toEqual({ "2026-08": 0, "2026-09": 0, "2026-10": 100 });
  });
});

describe("FR-2405 — asignación por fecha", () => {
  it("TC-CIC-046e: 2026-10-21 abre Noviembre y 2026-10-20 sigue en Octubre", () => {
    // @aitri-tc TC-CIC-046e
    expect(isValidMovementPeriod(CAL21, { type: "expense", date: "2026-10-21T09:00", period: "2026-11" })).toBe(true);
    expect(isValidMovementPeriod(CAL21, { type: "expense", date: "2026-10-20T23:59", period: "2026-10" })).toBe(true);
    expect(isValidMovementPeriod(CAL21, { type: "expense", date: "2026-10-21T09:00", period: "2026-10" })).toBe(false);
    expect(CAL21.periodForDate("2026-10-21")).toBe("2026-11");
  });
  it("TC-CIC-047e: reassignMovementPeriod mueve el aporte sin duplicar", () => {
    // @aitri-tc TC-CIC-047e
    resetSeq();
    const g = mv("expense", "c-comida", 12_000, "2026-10-05", "2026-10");
    const s = estadoSyn({ movements: [g], actuals: { "c-comida": { "2026-10": 12_000 } } });
    const r = reassignMovementPeriod(s, g.id, "2026-11");
    expect(r.actuals["c-comida"]).not.toHaveProperty("2026-10");
    expect(r.actuals["c-comida"]!["2026-11"]).toBe(12_000);
    expect(r.movements.filter((m) => m.id === g.id)).toHaveLength(1);
    expect(r.movements[0]!.period).toBe("2026-11");
    expect(sumaMapa(r.actuals)).toBe(sumaMapa(s.actuals));
  });
  it("TC-CIC-053h: un reembolso es un ingreso positivo en el ciclo de su fecha", () => {
    // @aitri-tc TC-CIC-053h
    const keys = CAL21.keys("2026-08", "2027-01");
    const s = addMovement(estadoSyn(), { type: "income", catId: "c-reembolsos", amount: 45_000, period: CAL21.periodForDate("2026-11-03"), date: "2026-11-03T12:00" }, keys);
    expect(s.movements[0]).toMatchObject({ period: "2026-11", amount: 45_000 });
    expect(s.actuals["c-reembolsos"]!["2026-11"]).toBe(45_000);
    const s2 = addMovement(s, { type: "income", catId: "c-reembolsos", amount: -45_000, period: "2026-11", date: "2026-11-03T12:00" }, keys);
    expect(s2).toBe(s);
  });
});

describe("FR-2406 — el ingreso adelantado", () => {
  it("TC-CIC-055e: sin propuesta para un ingreso a 4 días ni para un gasto en la ventana", () => {
    // @aitri-tc TC-CIC-055e
    expect(proposeOpeningCycle(CAL21, "income", "2026-11-17T12:00")).toBeNull();
    expect(proposeOpeningCycle(CAL21, "expense", "2026-11-20T12:00")).toBeNull();
  });
  it("TC-CIC-057f: en modo mes nunca hay propuesta", () => {
    // @aitri-tc TC-CIC-057f
    for (const d of ["2026-11-20", "2026-11-30", "2026-12-01"]) expect(proposeOpeningCycle(MONTH_CALENDAR, "income", d)).toBeNull();
  });
  it("TC-CIC-059e: ventana exacta: 3 días antes propone, 4 no, el propio día de pago no", () => {
    // @aitri-tc TC-CIC-059e
    expect(["2026-11-18", "2026-11-17", "2026-11-21", "2026-11-20"].map((d) => proposeOpeningCycle(CAL21, "income", d))).toEqual(["2026-12", null, null, "2026-12"]);
  });
});

describe("FR-2407 — nombre y rango", () => {
  it("TC-CIC-066e: rangeLabel: formato único, cruce de año y null en modo mes", () => {
    // @aitri-tc TC-CIC-066e
    expect(CAL21.rangeLabel("2026-09")).toBe("21 ago – 20 sep");
    expect(CAL21.rangeLabel("2027-01")).toBe("21 dic – 20 ene");
    expect(MONTH_CALENDAR.rangeLabel("2026-09")).toBeNull();
  });
  it("TC-CIC-070f: una clave desconocida degrada: rangeOf y rangeLabel null, sin lanzar", () => {
    // @aitri-tc TC-CIC-070f
    expect(CAL21.rangeOf("2031-05")).toBeNull();
    expect(CAL21.rangeLabel("2031-05")).toBeNull();
    expect(() => CAL21.isTransition("2031-05")).not.toThrow();
  });
  it("TC-CIC-071e: currentPeriodFor: 2026-09-10 → Septiembre; 2026-09-21 → Octubre; modo mes igual", () => {
    // @aitri-tc TC-CIC-071e
    expect(currentPeriodFor(CAL21, "2026-09-10")).toBe("2026-09");
    expect(currentPeriodFor(CAL21, "2026-09-21")).toBe("2026-10");
    expect(currentPeriodFor(MONTH_CALENDAR, "2026-09-21")).toBe("2026-09");
  });
});

describe("FR-2408 — cambiar el día de pago", () => {
  const CTX = { todayISO: "2026-10-01", closedEnd: null, restoreStartMonth: "2026-08", bounds: BOUNDS };
  function plan(day: number, firstPayDate: string | undefined, cfg: CycleConfig = CFG21, ctx = CTX) {
    return planVersionChange(cfg, { mode: "cycle", anchorDay: day, eomPolicy: "last_day", firstPayDate }, ctx);
  }
  it("TC-CIC-073h: 21→30 con primer pago 30-oct: Transición 21–29 oct, Noviembre 30 oct–29 nov, previos intactos", () => {
    // @aitri-tc TC-CIC-073h
    const p = plan(30, "2026-10-30");
    expect("cfg" in p).toBe(true);
    if (!("cfg" in p)) return;
    expect(p.lastPay).toBe("2026-10-21");
    const cal = buildCalendar(p.cfg, BOUNDS);
    expect(cal.rangeOf("2026-10t")).toEqual({ start: "2026-10-21", end: "2026-10-29" });
    expect(daysBetween("2026-10-21", "2026-10-29") + 1).toBe(9);
    expect(cal.isTransition("2026-10t")).toBe(true);
    expect(cal.rangeOf("2026-11")).toEqual({ start: "2026-10-30", end: "2026-11-29" });
    for (const k of CAL21.keys("2026-06", "2026-10")) expect(cal.rangeOf(k)).toEqual(CAL21.rangeOf(k));
  });
  it("TC-CIC-076e: los balances anteriores son idénticos uno a uno y no hay huecos en la frontera", () => {
    // @aitri-tc TC-CIC-076e
    resetSeq();
    const fechas = ["2026-08-25", "2026-09-02", "2026-09-15", "2026-09-25", "2026-10-05", "2026-10-15", "2026-10-25", "2026-11-05", "2026-11-15", "2026-11-25", "2026-12-05", "2026-12-15"];
    let s = estadoSyn();
    fechas.forEach((d, i) => { const m = i % 3 === 0 ? mv("income", "c-salario", 500_000, d, CAL21.periodForDate(d)) : mv("expense", "c-comida", 40_000 + i, d, CAL21.periodForDate(d)); s = { ...s, movements: [...s.movements, m] }; });
    for (const m of s.movements) for (const { leafId, delta } of movementDeltas(m)) { s.actuals[leafId] = { ...(s.actuals[leafId] ?? {}) }; s.actuals[leafId]![m.period] = (s.actuals[leafId]![m.period] ?? 0) + delta; }
    const antes = computeBalanceSeries(s, CAL21.keys("2026-08", "2027-01"), ZERO_CARRY);
    const p = plan(30, "2026-10-30");
    if (!("cfg" in p)) throw new Error("bloqueado");
    const cal30 = buildCalendar(p.cfg, BOUNDS);
    const r = ok(relocate(s, CAL21, cal30, "2026-10-01"));
    const keys = cal30.keys("2026-08", "2027-01");
    const despues = computeBalanceSeries(r.state, keys, ZERO_CARRY);
    for (const k of ["2026-09", "2026-10"]) expect(despues[k]).toEqual(antes[k]);
    expect(keys).toContain("2026-10t");
    for (let i = 0; i + 1 < keys.length; i++) expect(addDays(cal30.rangeOf(keys[i]!)!.end, 1)).toBe(cal30.rangeOf(keys[i + 1]!)!.start);
  });
  it("TC-CIC-077e: dato sin día al cambiar de versión: la celda de Noviembre se queda, el gasto del 25-oct va a la transición", () => {
    // @aitri-tc TC-CIC-077e
    resetSeq();
    const g = mv("expense", "c-comida", 40_000, "2026-10-25", "2026-11");
    const s = estadoSyn({ budgets: { "c-comida": { "2026-11": 700_000 } }, actuals: { "c-comida": { "2026-11": 40_000 } }, movements: [g] });
    const cal30 = buildCalendar(cfg21to(30, "2026-10-30"), BOUNDS);
    const r = ok(relocate(s, CAL21, cal30, "2026-10-01"));
    expect(r.state.budgets["c-comida"]!["2026-11"]).toBe(700_000);
    expect(r.state.movements[0]!.period).toBe("2026-10t");
    expect(r.state.actuals["c-comida"]!["2026-10t"]).toBe(40_000);
    expect(Object.keys(r.state.budgets["c-comida"]!)).not.toContain("2026-10t");
    expect(sumaMapa(r.state.budgets)).toBe(700_000);
    expect(sumaMapa(r.state.actuals)).toBe(40_000);
  });
  it("TC-CIC-080e: la clave de transición ordena entre sus meses, pasa isPeriodKey y addMonths la rechaza", () => {
    // @aitri-tc TC-CIC-080e
    expect(comparePeriods("2026-10", "2026-10t")).toBeLessThan(0);
    expect(comparePeriods("2026-10t", "2026-11")).toBeLessThan(0);
    expect(isPeriodKey("2026-10t")).toBe(true);
    expect(periodYear("2026-10t")).toBe(2026);
    expect(periodMonth("2026-10t")).toBe(10);
    expect(() => addMonths("2026-10t", 1)).toThrow();
  });
  it("TC-CIC-149e: 21→5: las celdas de «Noviembre» se quedan en 2026-11, que pasa a ser la transición", () => {
    // @aitri-tc TC-CIC-149e
    const s = estadoSyn({ budgets: { "c-comida": { "2026-11": 300_000 } } });
    const p = plan(5, "2026-11-05");
    if (!("cfg" in p)) throw new Error("bloqueado");
    const cal5 = buildCalendar(p.cfg, BOUNDS);
    expect(cal5.isTransition("2026-11")).toBe(true);
    expect(cal5.rangeOf("2026-11")).toEqual({ start: "2026-10-21", end: "2026-11-04" });
    expect(cal5.rangeOf("2026-12")).toEqual({ start: "2026-11-05", end: "2026-12-04" });
    expect(cal5.rangeOf("2026-11t")).toBeNull();
    const r = ok(relocate(s, CAL21, cal5, "2026-10-01"));
    expect(r.state.budgets["c-comida"]!["2026-11"]).toBe(300_000);
    expect(sumaMapa(r.state.budgets)).toBe(300_000);
  });
  it("TC-CIC-150e: transición larga (primer pago 5-dic): el 21-nov sigue siendo pago viejo, la transición es 21 nov–4 dic y ninguna clave desaparece", () => {
    // @aitri-tc TC-CIC-150e
    // NOTA DE BUILD: el TC aprobado suponía que la transición arrancaba el 21-oct y noviembre
    // desaparecía. Contradice la definición de `lastPay` del propio TRD (último ancla de la versión
    // vigente ESTRICTAMENTE anterior al primer pago nuevo): con primer pago el 5-dic, el 21-nov sigue
    // siendo un pago del esquema viejo, así que «Noviembre» (21 oct–20 nov) existe y la transición es
    // 21 nov–4 dic, nombrada «2026-12». Ningún mes pierde su clave; se prueba lo que el modelo hace.
    resetSeq();
    const g = mv("expense", "c-comida", 9_000, "2026-11-15", "2026-12");
    const s = estadoSyn({ budgets: { "c-comida": { "2026-11": 300_000 } }, actuals: { "c-comida": { "2026-12": 9_000 } }, movements: [g] });
    const p = plan(5, "2026-12-05");
    if (!("cfg" in p)) throw new Error("bloqueado");
    expect(p.lastPay).toBe("2026-11-21");
    const cal = buildCalendar(p.cfg, BOUNDS);
    expect(cal.keys("2026-10", "2027-01")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
    expect(cal.isTransition("2026-12")).toBe(true);
    expect(cal.rangeOf("2026-12")).toEqual({ start: "2026-11-21", end: "2026-12-04" });
    expect(cal.rangeOf("2027-01")).toEqual({ start: "2026-12-05", end: "2027-01-04" });
    const r = ok(relocate(s, CAL21, cal, "2026-10-01"));
    expect(r.state.budgets["c-comida"]!["2026-11"]).toBe(300_000);
    expect(r.state.movements[0]!.period).toBe("2026-11");
    for (const k of todasLasClaves(r.state)) expect(cal.rangeOf(k)).not.toBeNull();
    expect(r.state.origins).toEqual(s.origins);
  });
  it("TC-CIC-151e: lastPay es el último ancla estrictamente anterior a firstPayDate", () => {
    // @aitri-tc TC-CIC-151e
    const a = plan(5, "2026-11-05");
    const b = plan(25, "2026-10-25");
    const c = plan(21, "2026-10-21", { mode: "cycle", versions: [version({ anchorDay: 20 })] });
    expect("cfg" in a && a.lastPay).toBe("2026-10-21");
    expect("cfg" in b && b.lastPay).toBe("2026-10-21");
    if ("cfg" in a) expect(buildCalendar(a.cfg, BOUNDS).rangeOf("2026-11")).toEqual({ start: "2026-10-21", end: "2026-11-04" });
    if ("cfg" in b) expect(buildCalendar(b.cfg, BOUNDS).rangeOf("2026-10t")).toEqual({ start: "2026-10-21", end: "2026-10-24" });
    // Con la versión vigente en día 21, un primer pago el 21-oct no es posterior al último pago (21-oct).
    const d = plan(30, "2026-10-21");
    expect(d).toMatchObject({ blocked: "first_pay_invalid" });
    expect("cfg" in c).toBe(true);
  });
  it("TC-CIC-155e: un movimiento fechado 2026-11-25 pasa de Diciembre a Noviembre al cambiar 21→30", () => {
    // @aitri-tc TC-CIC-155e
    resetSeq();
    const g = mv("expense", "c-comida", 9_000, "2026-11-25", "2026-12");
    const s = estadoSyn({ actuals: { "c-comida": { "2026-12": 9_000 } }, movements: [g] });
    const cal30 = buildCalendar(cfg21to(30, "2026-10-30"), BOUNDS);
    const r = ok(relocate(s, CAL21, cal30, "2026-10-01"));
    expect(r.state.movements[0]!.period).toBe("2026-11");
    expect(r.state.actuals["c-comida"]!["2026-11"]).toBe(9_000);
    expect(r.state.actuals["c-comida"]).not.toHaveProperty("2026-12");
  });
  it("TC-CIC-178e: propiedad: ningún cambio de día de pago hace desaparecer una clave", () => {
    // @aitri-tc TC-CIC-178e
    const bounds = { from: "2025-10", to: "2027-06" } as const;
    const policies = ["last_day", "shift"] as const;
    let casos = 0;
    const desaparecidas: string[] = [];
    for (let a = 1; a <= 31; a++) for (const pa of policies) {
      const p1 = planVersionChange(NO_CYCLES, { mode: "cycle", anchorDay: a, eomPolicy: pa }, { todayISO: "2026-01-15", closedEnd: null, restoreStartMonth: null, bounds });
      if (!("cfg" in p1)) continue;
      const cal1 = buildCalendar(p1.cfg, bounds);
      const viejas = cal1.keys("2026-01", "2026-12").filter((k) => !k.endsWith("t")).filter((k) => { const r = cal1.rangeOf(k)!; return r.end >= "2026-01-01" && r.start <= "2026-12-01"; });
      for (let b = 1; b <= 31; b++) for (const pb of policies) for (const mes of ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]) {
        if (a === b && pa === pb) continue;
        const p2 = planVersionChange(p1.cfg, { mode: "cycle", anchorDay: b, eomPolicy: pb, firstPayDate: anchorDateOf(mes, b, pb) }, { todayISO: "2026-01-20", closedEnd: null, restoreStartMonth: null, bounds });
        if (!("cfg" in p2)) continue;
        casos++;
        const nuevas = new Set(buildCalendar(p2.cfg, bounds).keys("2026-01", "2026-12"));
        for (const k of viejas) if (!nuevas.has(k)) desaparecidas.push(`${a}/${pa}→${b}/${pb} ${mes}: ${k}`);
      }
    }
    expect(casos).toBe(18_910);
    expect(desaparecidas).toEqual([]);
    const ida = ok(relocate(estadoSyn({ budgets: { "c-comida": { "2026-09": 100, "2026-11": 700 } } }), MONTH_CALENDAR, CAL21, HOY));
    const dia = ok(relocate(ida.state, CAL21, buildCalendar(cfg21to(30, "2026-10-30"), BOUNDS), "2026-10-01"));
    expect(Object.keys(dia.state.budgets["c-comida"]!).sort()).toEqual(Object.keys(ida.state.budgets["c-comida"]!).sort());
    expect(dia.state.origins).toEqual(ida.state.origins);
  }, 60_000);
});

describe("FR-2409 — cierre sobre la frontera del ciclo", () => {
  it("TC-CIC-083e: el 2026-09-10 Septiembre es cerrable y Octubre no", () => {
    // @aitri-tc TC-CIC-083e
    let s = estadoSyn({ budgets: { "c-comida": { "2026-09": 1 } } });
    const keys = keysDe(s, CAL21);
    const hoy = currentPeriodFor(CAL21, "2026-09-10");
    expect(nextClosable(s, hoy, keys)).toBe("2026-09");
    const c1 = closeMonth(s, hoy, keys);
    expect(c1.ok).toBe(true);
    if (c1.ok) s = { ...s, closure: c1.closure };
    expect(nextClosable(s, hoy, keys)).toBeNull();
    expect(closeMonth(s, hoy, keys)).toEqual({ ok: false, reason: "not_closable" });
  });
  it("TC-CIC-085e: el sobrante de Diciembre abre Enero del año siguiente con el mismo valor", () => {
    // @aitri-tc TC-CIC-085e
    const s = estadoSyn({ actuals: { "c-salario": { "2026-12": 1_000_000 }, "c-comida": { "2026-12": 400_000 } } });
    const series = computeBalanceSeries(s, CAL21.keys("2026-12", "2027-01"), ZERO_CARRY);
    expect(series["2026-12"]!.actual.available).toBe(600_000);
    expect(series["2027-01"]!.actual.prevAvailable).toBe(600_000);
  });
  it("TC-CIC-086e: reabrir con transición: closedThrough 2026-11 retrocede a 2026-10t y reabre 2026-11", () => {
    // @aitri-tc TC-CIC-086e
    const cal = buildCalendar(cfg21to(30, "2026-10-30"), BOUNDS);
    const keys = cal.keys("2026-08", "2027-03");
    expect(keys).toContain("2026-10t");
    const s = estadoSyn({ closure: { closedThrough: "2026-11", reopened: null }, budgets: { "c-comida": { "2026-09": 1 } } });
    const r = reopenMonth(s, keys, cal.prev);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.closure.closedThrough).toBe("2026-10t");
    expect(r.closure.reopened).toBe("2026-11");
    expect(r.closure.reopenBaseline).toBeDefined();
    expect(nextReopenable(r.closure)).toBeNull();
  });
  it("TC-CIC-087e: normalizeClosure con sufijo no lanza ni descarta; checkClosureNeighbors degrada un vecino falso", () => {
    // @aitri-tc TC-CIC-087e
    const cal = buildCalendar(cfg21to(30, "2026-10-30"), BOUNDS);
    const raw = { closedThrough: "2026-10t", reopened: "2026-11", reopenBaseline: { available: 1, reservedBalance: 0 } };
    const c = normalizeClosure(raw);
    expect(c.reopened).toBe("2026-11");
    expect(c.reopenBaseline).toEqual({ available: 1, reservedBalance: 0 });
    expect(checkClosureNeighbors(c, cal.next)).toEqual(c);
    const falso = checkClosureNeighbors({ closedThrough: "2026-10t", reopened: "2026-12" }, cal.next);
    expect(falso).toEqual({ closedThrough: "2026-10t", reopened: null });
    expect(falso.reopenBaseline).toBeUndefined();
  });
});

describe("FR-2410 — volver a mes", () => {
  it("TC-CIC-091e: datos creados en ciclos, sin memoria, vuelven por la costumbre de su rubro; el movimiento por su fecha", () => {
    // @aitri-tc TC-CIC-091e
    resetSeq();
    const salario = mv("income", "c-salario", 1_000, "2026-08-21", "2026-09");
    const comida = mv("expense", "c-comida", 2_000, "2026-09-02", "2026-09");
    const gasto = mv("expense", "c-transporte", 7_000, "2026-09-05", "2026-09");
    const s = estadoSyn({
      cycles: CFG21,
      budgets: { "c-salario": { "2026-10": 90_000 }, "c-comida": { "2026-10": 50_000 } },
      actuals: { "c-salario": { "2026-09": 1_000 }, "c-comida": { "2026-09": 2_000 }, "c-transporte": { "2026-09": 7_000 } },
      movements: [salario, comida, gasto],
    });
    const r = ok(relocate(s, CAL21, MONTH_CALENDAR, "2026-10-01"));
    expect(r.state.budgets["c-salario"]).toEqual({ "2026-09": 90_000 });
    expect(r.state.budgets["c-comida"]).toEqual({ "2026-10": 50_000 });
    expect(r.state.movements.find((m) => m.id === gasto.id)!.period).toBe("2026-09");
    expect(sumaMapa(r.state.budgets)).toBe(140_000);
    expect(sumaMapa(r.state.actuals)).toBe(10_000);
  });
  it("TC-CIC-093e: restoreStartMonth: activar y volver devuelve 2026-08; con un dato de julio, 2026-07", () => {
    // @aitri-tc TC-CIC-093e
    resetSeq();
    const g = mv("expense", "c-comida", 12_000, "2026-08-15", "2026-08");
    const s = estadoSyn({ startMonth: "2026-08", openingBalance: 500_000, movements: [g], actuals: { "c-comida": { "2026-08": 12_000 } } });
    const ida = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(ida.state.startMonth).toBe("2026-08");
    const vuelta = ok(relocate(ida.state, CAL21, MONTH_CALENDAR, HOY, { restoreStartMonth: ida.summary.restoreStartMonth }));
    expect(vuelta.state.startMonth).toBe("2026-08");
    const g2 = mv("expense", "c-comida", 1_000, "2026-07-25", "2026-08");
    const conJulio: LedgerState = { ...ida.state, movements: [...ida.state.movements, g2], actuals: { "c-comida": { ...ida.state.actuals["c-comida"], "2026-08": (ida.state.actuals["c-comida"]!["2026-08"] ?? 0) + 1_000 } } };
    const vuelta2 = ok(relocate(conJulio, CAL21, MONTH_CALENDAR, HOY, { restoreStartMonth: "2026-08" }));
    expect(vuelta2.state.startMonth).toBe("2026-07");
  });
  it("TC-CIC-094e: al volver, lo creado en ciclos sin memoria en una transición va al mes de su clave sin sufijo", () => {
    // @aitri-tc TC-CIC-094e
    const cal30 = buildCalendar(cfg21to(30, "2026-10-30"), BOUNDS);
    const s = estadoSyn({ budgets: { "c-comida": { "2026-10": 100_000, "2026-10t": 20_000, "2026-11": 5_000 } } });
    const r = ok(relocate(s, cal30, MONTH_CALENDAR, "2026-11-15"));
    expect(r.state.budgets["c-comida"]).toEqual({ "2026-10": 120_000, "2026-11": 5_000 });
    expect(todasLasClaves(r.state).some((k) => k.endsWith("t"))).toBe(false);
    expect(sumaMapa(r.state.budgets)).toBe(125_000);
  });
  it("TC-CIC-179e: Presupuestado fusionado y editado: la diferencia va al mes más reciente", () => {
    // @aitri-tc TC-CIC-179e
    const ida = ok(relocate(estadoUsuario(), MONTH_CALENDAR, CAL21, HOY));
    const rest = U("Restaurantes");
    for (const [editado, sep] of [[900_000, 563_300], [800_000, 463_300]] as const) {
      const st = conCelda(ida.state, "budgets", rest, "2026-09", editado);
      const r = ok(relocate(st, CAL21, MONTH_CALENDAR, "2026-10-01", { restoreStartMonth: ida.summary.restoreStartMonth }));
      expect(r.state.budgets[rest]).toEqual({ "2026-08": 336_700, "2026-09": sep });
      expect(sumaMapa({ x: r.state.budgets[rest] })).toBe(editado);
    }
  });
  it("TC-CIC-180e: la memoria no es solo para fusiones: un presupuesto sin fusión vuelve a su mes aunque la mayoría de su ciclo sea de otro mes", () => {
    // @aitri-tc TC-CIC-180e
    resetSeq();
    const ago = mv("expense", "c-comida", 300, "2026-08-25", "2026-08");
    const sep = mv("expense", "c-comida", 100, "2026-09-03", "2026-09");
    const s = estadoSyn({ movements: [ago, sep], budgets: { "c-comida": { "2026-09": 100 } }, actuals: { "c-comida": { "2026-08": 300, "2026-09": 100 } } });
    const ida = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(ida.state.budgets["c-comida"]).toEqual({ "2026-09": 100 });
    expect(partes(ida.state, "budget", "c-comida")).toEqual([{ period: "2026-09", originPeriod: "2026-09", amount: 100 }]);
    const vuelta = ok(relocate(ida.state, CAL21, MONTH_CALENDAR, HOY, { restoreStartMonth: ida.summary.restoreStartMonth }));
    expect(vuelta.state.budgets["c-comida"]).toEqual({ "2026-09": 100 });
  });
  it("TC-CIC-181e: reducción mayor que la parte más reciente y celda en 0: ningún mes queda negativo", () => {
    // @aitri-tc TC-CIC-181e
    const ida = ok(relocate(estadoUsuario(), MONTH_CALENDAR, CAL21, HOY));
    const rest = U("Restaurantes");
    for (const [editado, esperado] of [[300_000, { "2026-08": 300_000, "2026-09": 0 }], [0, { "2026-08": 0, "2026-09": 0 }]] as const) {
      const r = ok(relocate(conCelda(ida.state, "budgets", rest, "2026-09", editado), CAL21, MONTH_CALENDAR, "2026-10-01", { restoreStartMonth: ida.summary.restoreStartMonth }));
      expect(r.state.budgets[rest]).toEqual(esperado);
    }
  });
  it("TC-CIC-182e: Ejecutado fusionado y editado: el límite es la celda reconstruida, no la parte", () => {
    // @aitri-tc TC-CIC-182e
    const ida = ok(relocate(estadoUsuario(), MONTH_CALENDAR, CAL21, HOY));
    const rest = U("Restaurantes");
    expect(ida.state.actuals[rest]!["2026-09"]).toBe(849_100);
    const r = ok(relocate(conCelda(ida.state, "actuals", rest, "2026-09", 300_000), CAL21, MONTH_CALENDAR, "2026-10-01", { restoreStartMonth: ida.summary.restoreStartMonth }));
    expect(r.state.actuals[rest]).toEqual({ "2026-08": 300_000, "2026-09": 0 });
    for (const c of Object.values(r.state.actuals)) for (const v of Object.values(c ?? {})) expect(v).toBeGreaterThanOrEqual(0);
  });
  it("TC-CIC-183e: un ledger sin mes de inicio declarado vuelve sin mes de inicio", () => {
    // @aitri-tc TC-CIC-183e
    resetSeq();
    const g = mv("expense", "c-comida", 100, "2026-09-05", "2026-09");
    const s = estadoSyn({ movements: [g], budgets: { "c-comida": { "2026-09": 100 } }, actuals: { "c-comida": { "2026-09": 100 } } });
    const ida = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    expect(ida.summary.restoreStartMonth).toBeNull();
    const vuelta = ok(relocate(ida.state, CAL21, MONTH_CALENDAR, HOY, { restoreStartMonth: ida.summary.restoreStartMonth }));
    expect(vuelta.state.startMonth).toBeUndefined();
  });
  it("TC-CIC-184f: una parte de memoria cuya celda el usuario borró no recrea nada al volver", () => {
    // @aitri-tc TC-CIC-184f
    const ida = ok(relocate(estadoUsuario(), MONTH_CALENDAR, CAL21, HOY));
    const agua = U("Agua");
    const sinCelda = conCelda(ida.state, "budgets", agua, "2026-09", undefined);
    const r = ok(relocate(sinCelda, CAL21, MONTH_CALENDAR, "2026-10-01", { restoreStartMonth: ida.summary.restoreStartMonth }));
    expect(r.state.budgets[agua]?.["2026-09"]).toBeUndefined();
    expect(r.state.budgets[agua]?.["2026-08"]).toBeUndefined();
    expect(sumaMapa(r.state.budgets)).toBe(sumaMapa(sinCelda.budgets));
  });
});

describe("NFR-2402 — cierre-de-mes intacto", () => {
  it("TC-CIC-103h: en modo mes, closeMonth y reopenMonth con vecindad por defecto producen exactamente lo de hoy", () => {
    // @aitri-tc TC-CIC-103h
    const range = periodRange("2026-06", "2026-12");
    let s = estadoSyn({ budgets: { "c-comida": { "2026-06": 1 } } });
    const cerrados: PeriodKey[] = [];
    for (let i = 0; i < 4; i++) { const r = closeMonth(s, "2026-09", range); expect(r.ok).toBe(true); if (r.ok) { s = { ...s, closure: r.closure }; cerrados.push(r.closure.closedThrough!); } }
    expect(cerrados).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(closeMonth(s, "2026-09", range)).toEqual({ ok: false, reason: "not_closable" });
    const r1 = reopenMonth(s, range);
    expect(r1.ok).toBe(true);
    if (r1.ok) { expect(r1.closure.closedThrough).toBe("2026-08"); expect(r1.closure.reopened).toBe("2026-09"); s = { ...s, closure: r1.closure }; }
    expect(reopenMonth(s, range)).toEqual({ ok: false, reason: "already_reopened" });
  });
  it("TC-CIC-104e: en ciclos los mismos escenarios producen los mismos rechazos y rastros", () => {
    // @aitri-tc TC-CIC-104e
    const keys = CAL21.keys("2026-06", "2026-12");
    const hoy = currentPeriodFor(CAL21, "2026-09-10");
    let s = estadoSyn({ budgets: { "c-comida": { "2026-06": 1 } } });
    const cerrados: PeriodKey[] = [];
    for (let i = 0; i < 4; i++) { const r = closeMonth(s, hoy, keys); expect(r.ok).toBe(true); if (r.ok) { s = { ...s, closure: r.closure }; cerrados.push(r.closed); } }
    expect(cerrados).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(closeMonth(s, hoy, keys)).toEqual({ ok: false, reason: "not_closable" });
    const r1 = reopenMonth(s, keys, CAL21.prev);
    expect(r1.ok).toBe(true);
    if (r1.ok) s = { ...s, closure: r1.closure };
    expect(reopenMonth(s, keys, CAL21.prev)).toEqual({ ok: false, reason: "already_reopened" });
    for (const k of cerrados) expect(CAL21.rangeOf(k)).not.toBeNull();
  });
  it("TC-CIC-105f: una cifra de un periodo cerrado sigue inmutable en ambos modos", () => {
    // @aitri-tc TC-CIC-105f
    for (const cycles of [undefined, CFG21]) {
      const prev = estadoSyn({ ...(cycles ? { cycles } : {}), closure: { closedThrough: "2026-09", reopened: null }, budgets: { "c-comida": { "2026-09": 100, "2026-10": 100 } } });
      const next1 = { ...prev, budgets: { "c-comida": { "2026-09": 200, "2026-10": 100 } } };
      const next2 = { ...prev, budgets: { "c-comida": { "2026-09": 100, "2026-10": 200 } } };
      expect(closedPeriodsViolated(prev, next1)).toEqual(["2026-09"]);
      expect(closedPeriodsViolated(prev, next2)).toEqual([]);
    }
  });
});

describe("NFR-2403 — multi-anio intacto", () => {
  it("TC-CIC-106h: activeRange conserva firma y resultado para un estado sin ciclos", () => {
    // @aitri-tc TC-CIC-106h
    const s = estadoReal();
    const r = activeRange(s, "2026-09", 2);
    expect(r).toEqual(periodRange("2026-08", "2028-12"));
    expect(r.length).toBe(29);
    expect(activeBounds(s, "2026-09", 2)).toEqual({ from: "2026-08", to: "2028-12" });
  });
  it("TC-CIC-107e: activeKeys en ciclos va del ciclo más antiguo con datos al fin del horizonte, contiguo", () => {
    // @aitri-tc TC-CIC-107e
    const s = estadoSyn({ cycles: CFG21, budgets: { "c-comida": { "2026-09": 1 } } });
    const keys = activeKeys(s, CAL21, "2026-09", 1);
    expect(keys[0]).toBe("2026-09");
    expect(keys[keys.length - 1]).toBe("2027-12");
    for (let i = 0; i + 1 < keys.length; i++) expect(CAL21.next(keys[i]!)).toBe(keys[i + 1]);
  });
  it("TC-CIC-108f: activeBounds con una cota de transición la reduce a su mes y no lanza", () => {
    // @aitri-tc TC-CIC-108f
    const cfg = cfg21to(30, "2026-10-30");
    const cal = buildCalendar(cfg, BOUNDS);
    const s = estadoSyn({ cycles: cfg, closure: { closedThrough: "2026-10t", reopened: null }, budgets: { "c-comida": { "2026-10t": 5 } } });
    expect(() => activeBounds(s, "2026-11", 1)).not.toThrow();
    expect(activeBounds(s, "2026-11", 1)!.from).toBe("2026-10");
    const keys = activeKeys(s, cal, "2026-11", 1);
    expect(keys.indexOf("2026-10t")).toBe(keys.indexOf("2026-10") + 1);
  });
});

describe("NFR-2404 — transferencias intacta", () => {
  it("TC-CIC-109h: techo y piso rechazan igual en mes y en ciclos para los mismos movimientos", () => {
    // @aitri-tc TC-CIC-109h
    // NOTA DE BUILD: el TC nombra los códigos como 'floor'/'ceiling'; el dominio los llama «piso» y
    // «techo» desde la feature transferencias (reserve.ts:44). Se asserta el nombre real.
    for (const keys of [MONTH_CALENDAR.keys("2026-08", "2026-12"), CAL21.keys("2026-08", "2026-12")]) {
      const s = estadoSyn({ actuals: { "c-alcancia": { "2026-08": 100_000 } } });
      const retiro = applyReserveOp(s, { from: "c-alcancia", to: AVAILABLE_ID, period: "2026-12", amount: 150_000 }, keys);
      expect(retiro).toMatchObject({ rejected: { ok: false, rule: "piso", period: "2026-12", limit: 100_000 } });
      const reserva = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-alcancia", period: "2026-08", amount: 50_000 }, keys);
      expect(reserva).toMatchObject({ rejected: { ok: false, rule: "techo" } });
    }
  });
  it("TC-CIC-110e: el saldo derivado de cada alcancía al final del último periodo es idéntico entre modos", () => {
    // @aitri-tc TC-CIC-110e
    resetSeq();
    const movements: Movement[] = [];
    const fechas = ["2026-08-21", "2026-08-25", "2026-09-01", "2026-09-10", "2026-09-19", "2026-09-22", "2026-10-03", "2026-10-15", "2026-10-21", "2026-11-02", "2026-11-11", "2026-11-19", "2026-11-25", "2026-12-01", "2026-12-04", "2026-12-08", "2026-12-10", "2026-09-30", "2026-10-30", "2026-11-30"];
    fechas.forEach((d, i) => {
      const p = MONTH_CALENDAR.periodForDate(d);
      if (i < 12) movements.push(mvTransfer(AVAILABLE_ID, i % 2 ? "c-alcancia" : "c-alcancia2", 10_000 * (i + 1), d, p));
      else movements.push(mvTransfer(i % 2 ? "c-alcancia" : "c-alcancia2", AVAILABLE_ID, 5_000, d, p));
    });
    const actuals: LedgerState["actuals"] = {};
    for (const m of movements) for (const { leafId, delta } of movementDeltas(m)) { actuals[leafId] = { ...(actuals[leafId] ?? {}) }; actuals[leafId]![m.period] = (actuals[leafId]![m.period] ?? 0) + delta; }
    const s = estadoSyn({ movements, actuals });
    const kA = MONTH_CALENDAR.keys("2026-08", "2027-01");
    const r = ok(relocate(s, MONTH_CALENDAR, CAL21, HOY));
    const kB = CAL21.keys("2026-08", "2027-01");
    for (const leaf of ["c-alcancia", "c-alcancia2"]) {
      expect(resolvedBalance(r.state, leaf, "2027-01", "actual", kB)).toBe(resolvedBalance(s, leaf, "2027-01", "actual", kA));
    }
  });
});

describe("NFR-2405 — saldo inicial intacto", () => {
  it("TC-CIC-112h: tras activar, «Saldo del mes anterior» del primer ciclo muestra el saldo inicial y ninguna otra lo repite", () => {
    // @aitri-tc TC-CIC-112h
    const r = ok(relocate(estadoUsuario(), MONTH_CALENDAR, CAL21, HOY));
    expect(r.state.startMonth).toBe("2026-09");
    const keys = keysDe(r.state, CAL21);
    expect(keys[0]).toBe("2026-09");
    const series = computeBalanceSeries(r.state, keys, openingCarry(r.state, keys));
    expect(series["2026-09"]!.actual.prevAvailable).toBe(32_180_000);
    for (let i = 1; i < keys.length; i++) expect(series[keys[i]!]!.actual.prevAvailable).toBe(series[keys[i - 1]!]!.actual.available);
    expect(openingCarry(r.state, keys.slice(1))).toEqual(ZERO_CARRY);
  });
});

describe("NFR-2407 — invariantes del modelo", () => {
  function cincuenta(): LedgerState {
    resetSeq();
    const movements: Movement[] = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 50; i++) {
      const d = addDays("2026-08-21", Math.floor(rnd() * 180));
      const p = CAL21.periodForDate(d);
      movements.push(i % 4 === 0 ? mv("income", "c-salario", 100_000 + i, d, p) : mv("expense", "c-comida", 10_000 + i, d, p));
    }
    const actuals: LedgerState["actuals"] = {};
    for (const m of movements) for (const { leafId, delta } of movementDeltas(m)) { actuals[leafId] = { ...(actuals[leafId] ?? {}) }; actuals[leafId]![m.period] = (actuals[leafId]![m.period] ?? 0) + delta; }
    return estadoSyn({ cycles: CFG21, movements, actuals });
  }
  it("TC-CIC-118h: suma de balances por ciclo = ingresos − gastos del rango calculados de forma independiente", () => {
    // @aitri-tc TC-CIC-118h
    const s = cincuenta();
    const keys = CAL21.keys("2026-08", "2027-03");
    const series = computeBalanceSeries(s, keys, ZERO_CARRY);
    const porCiclo = keys.reduce((a, k) => a + (series[k]!.actual.income - series[k]!.actual.expense), 0);
    const independiente = s.movements.reduce((a, m) => a + (m.type === "income" ? m.amount : -m.amount), 0);
    expect(porCiclo).toBe(independiente);
    expect(new Set(s.movements.map((m) => m.period)).size).toBeGreaterThanOrEqual(6);
  });
  it("TC-CIC-119e: un cambio de día no altera ningún balance anterior a su vigencia", () => {
    // @aitri-tc TC-CIC-119e
    const s = cincuenta();
    const antes = computeBalanceSeries(s, CAL21.keys("2026-08", "2027-03"), ZERO_CARRY);
    const cal30 = buildCalendar(cfg21to(30, "2026-12-30"), BOUNDS);
    const r = ok(relocate(s, CAL21, cal30, "2026-12-01"));
    const despues = computeBalanceSeries(r.state, cal30.keys("2026-08", "2027-03"), ZERO_CARRY);
    for (const k of CAL21.keys("2026-08", "2026-11")) expect(despues[k]).toEqual(antes[k]);
  });
  it("TC-CIC-120f: una violación construida hace fallar la verificación de invariantes", () => {
    // @aitri-tc TC-CIC-120f
    const r = ok(relocate(estadoReal(), MONTH_CALENDAR, CAL21, HOY));
    const roto: LedgerState = { ...r.state, movements: r.state.movements.map((m, i) => (i === 0 ? { ...m, period: "2027-13" } : m)) };
    const v = checkRelocationInvariants(r.state, roto, CAL21);
    expect(v.ok).toBe(false);
    if (!v.ok) { expect(v.detail.rule).toBe("keys_in_calendar"); expect(v.detail.ids).toEqual([roto.movements[0]!.id]); }
  });
  it("TC-CIC-121e: contigüidad RV-03/RV-06 sobre 200 configuraciones aleatorias con hasta 3 versiones", () => {
    // @aitri-tc TC-CIC-121e
    let seed = 2026;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    for (let n = 0; n < 200; n++) {
      const versions: CycleVersion[] = [version({ anchorDay: 1 + Math.floor(rnd() * 31), eomPolicy: pick(["last_day", "shift"]) })];
      const cuantas = 1 + Math.floor(rnd() * 3);
      let cfg: CycleConfig = { mode: "cycle", versions };
      let mes = "2026-10";
      for (let v = 2; v <= cuantas; v++) {
        const day = 1 + Math.floor(rnd() * 31);
        const policy = pick(["last_day", "shift"] as const);
        mes = addMonths(mes, 1 + Math.floor(rnd() * 3));
        const first = buildCalendar({ mode: "cycle", versions: [version({ anchorDay: day, eomPolicy: policy })] }, { from: mes, to: mes }).rangeOf(addMonths(mes, 1))!.start;
        const p = planVersionChange(cfg, { mode: "cycle", anchorDay: day, eomPolicy: policy, firstPayDate: first }, { todayISO: "2026-10-01", closedEnd: null, restoreStartMonth: null, bounds: { from: "2026-06", to: "2029-06" } });
        if ("cfg" in p) cfg = p.cfg;
      }
      const cal = buildCalendar(cfg, { from: "2026-06", to: "2028-12" });
      const keys = cal.keys("2026-07", "2028-11");
      for (let i = 0; i + 1 < keys.length; i++) {
        const a = cal.rangeOf(keys[i]!)!;
        const b = cal.rangeOf(keys[i + 1]!)!;
        expect(addDays(a.end, 1), `config ${n} ${keys[i]}→${keys[i + 1]}`).toBe(b.start);
        expect(daysBetween(a.start, a.end)).toBeGreaterThanOrEqual(0);
      }
      for (let i = 0; i < 20; i++) {
        const d = addDays("2026-08-01", Math.floor(rnd() * 800));
        const k = cal.periodForDate(d);
        const r = cal.rangeOf(k)!;
        expect(r.start <= d && d <= r.end).toBe(true);
      }
    }
  });
});
