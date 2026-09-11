// Feature multi-anio — FR-1901/1903/1904/1906/1908/1909/1910 y sus NFR de regresión.
// Todo es aritmética pura sobre LedgerState, así que se ataca sin DOM con valores concretos.
// Prefijo TC-MAN-* .
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  isPeriodKey, comparePeriods, addMonths, periodRange, periodFromDate, periodOf,
  periodYear, periodMonth, isYearStart, monthsBetween,
} from "@/domain/periods";
import { activeRange, oldestPeriodWithData, newestPeriodWithData, normalizeHorizon, DEFAULT_HORIZON } from "@/domain/range";
import { computeBalanceSeries, balanceAt } from "@/domain/balance";
import { typeTotals } from "@/domain/rollup";
import {
  reserveHeadroom, availableMargin, plannedRetiroLimit, reserveAportes, reserveRetiros,
  reserveDelta, monthCarryUsage, monthIssues, maxWithdrawal, cellHeadroom, resolvedSeries,
  applyReserveOp, applyReserveCellEdit, RETIROS_PLAN_ID,
  __reservePerfCounters, __resetReservePerfCounters,
} from "@/domain/reserve";
// NFR-2303 (semilla-intacta): TC-MAN-090h/091e/092f verifican el ANCLAJE del eje de meses al
// periodo de arranque (FR-1910/FR-1906). Desde FR-2301 la siembra del producto sale sin celdas,
// así que ya no hay eje que anclar en ella: el anclaje lo sigue haciendo `genBudget`, y estas
// pruebas lo ejercitan componiendo la semilla poblada. Sus aserciones no se tocaron.
import { buildSeedConMontos as buildSeed } from "../helpers/seedConMontos";
import type { AmountMap, LedgerNode, LedgerState, PeriodKey } from "@/domain/types";
import { P, P0, P2, REF_YEAR } from "../helpers/periods";
import { CRONOMETRO_FIABLE, SALTAR_SI_INSTRUMENTADO, mejorDe, mejorTiempo, razonMediana } from "../helpers/perf";

// ── El MISMO estado explícito con el que se capturó la línea base ──────────────────────────────
function estadoRef(periods: readonly PeriodKey[] = P): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-inc", ownerId: "u", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
    { id: "c-sueldo", ownerId: "u", type: "income", level: "category", parentId: "g-inc", name: "Sueldo", icon: null, order: 1 },
    { id: "g-exp", ownerId: "u", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
    { id: "c-mercado", ownerId: "u", type: "expense", level: "category", parentId: "g-exp", name: "Mercado", icon: null, order: 3 },
    { id: "g-trf", ownerId: "u", type: "transfer", level: "group", parentId: null, name: "Bolsillos", icon: null, order: 4 },
    { id: "c-ahorro", ownerId: "u", type: "transfer", level: "category", parentId: "g-trf", name: "Ahorro", icon: null, order: 5 },
  ];
  const budgets: AmountMap = { "c-sueldo": {}, "c-mercado": {}, "c-ahorro": {} };
  const actuals: AmountMap = { "c-sueldo": {}, "c-mercado": {}, "c-ahorro": {} };
  periods.forEach((m, i) => {
    budgets["c-sueldo"][m] = 1_000_000 + i * 50_000;
    actuals["c-sueldo"][m] = 1_000_000 + i * 40_000;
    budgets["c-mercado"][m] = 300_000 + i * 10_000;
    actuals["c-mercado"][m] = 320_000 + i * 12_000;
    budgets["c-ahorro"][m] = 100_000 + i * 25_000;
    actuals["c-ahorro"][m] = 100_000 + i * 25_000;
  });
  let s: LedgerState = { ownerId: "u", nodes, budgets, actuals, movements: [] };
  for (const [idx, amount] of [[4, 40_000], [8, 75_000]] as const) {
    const r = applyReserveOp(s, { from: "c-ahorro", to: "@disponible", period: periods[idx], amount }, periods);
    if ("state" in r) s = r.state;
  }
  return s;
}

const BASE = JSON.parse(readFileSync("tests/fixtures/multi-anio-baseline.json", "utf8")) as {
  meses: string[];
  balance: Record<string, { budget: Record<string, number>; actual: Record<string, number> }>;
  rollups: Record<string, Record<string, { budget: number; actual: number }>>;
  reservas: Record<string, Record<string, number | null | { reservado: number; delSaldoAnterior: number; mesAnterior: string }>>;
  serieAhorroActual: number[];
  serieAhorroBudget: number[];
  issues: unknown[];
  retirosPlan: Record<string, number>;
};
/** El mes viejo que corresponde al periodo nuevo en la misma posición. */
const viejo = (i: number) => BASE.meses[i];

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("FR-1901 · el periodo es año y mes", () => {
  it("TC-MAN-001h: dos marzos de años distintos conviven sin pisarse", () => {
    const cells: Record<PeriodKey, number> = {};
    cells["2026-03"] = 1000;
    cells["2027-03"] = 500;
    expect(cells["2026-03"]).toBe(1000);
    expect(cells["2027-03"]).toBe(500);
    expect(Object.keys(cells)).toHaveLength(2);
  });

  it("TC-MAN-002e: ordenar como texto da el orden cronológico cruzando el año", () => {
    const desordenado = ["2026-01", "2025-12", "2025-11"];
    expect([...desordenado].sort()).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect([...desordenado].sort(comparePeriods)).toEqual(["2025-11", "2025-12", "2026-01"]);
    // y el orden por texto coincide con el aritmético, que es lo que lo hace fiable
    expect(monthsBetween("2025-11", "2026-01")).toBe(2);
    expect(monthsBetween("2026-01", "2025-11")).toBe(-2);
  });

  it("TC-MAN-003f: cuatro claves malformadas se rechazan sin mutar el estado", () => {
    const s = estadoRef();
    const antes = JSON.parse(JSON.stringify(s));
    for (const mala of ["2026-13", "26-03", "marzo", ""]) {
      expect(isPeriodKey(mala)).toBe(false);
      const r = applyReserveCellEdit(s, { leafId: "c-ahorro", period: mala, plane: "actual", newAmount: 999 }, P);
      expect("rejected" in r).toBe(true);
    }
    expect(s).toEqual(antes);
  });

  it("TC-MAN-004e: los bordes del mes se aceptan y se rechazan exactamente", () => {
    expect(isPeriodKey("2026-01")).toBe(true);
    expect(isPeriodKey("2026-12")).toBe(true);
    expect(isPeriodKey("2026-00")).toBe(false);
    expect(isPeriodKey("2026-13")).toBe(false);
    // y el resto de formas que un campo de texto puede traer
    expect(isPeriodKey(null)).toBe(false);
    expect(isPeriodKey(202601)).toBe(false);
    expect(isPeriodKey("2026-3")).toBe(false);
    expect(isPeriodKey("2026-013")).toBe(false);
    expect(periodOf(2026, 3)).toBe("2026-03");
    expect(periodYear("2026-03")).toBe(2026);
    expect(periodMonth("2026-03")).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("FR-1903 · el arrastre cruza el borde de año", () => {
  /** Estado mínimo con un ingreso en un periodo dado. */
  function conIngreso(pares: Array<[PeriodKey, number]>): LedgerState {
    const nodes: LedgerNode[] = [
      { id: "g", ownerId: "u", type: "income", level: "group", parentId: null, name: "G", icon: null, order: 0 },
      { id: "c", ownerId: "u", type: "income", level: "category", parentId: "g", name: "C", icon: null, order: 1 },
    ];
    const actuals: AmountMap = { c: {} };
    for (const [p, v] of pares) actuals.c[p] = v;
    return { ownerId: "u", nodes, budgets: { c: {} }, actuals, movements: [] };
  }

  it("TC-MAN-020h: el disponible de dic-2026 abre ene-2027", () => {
    const s = conIngreso([["2026-12", 500]]);
    const serie = computeBalanceSeries(s, ["2026-11", "2026-12", "2027-01"]);
    expect(serie["2026-12"].actual.available).toBe(500);
    expect(serie["2027-01"].actual.prevAvailable).toBe(500);
    expect(serie["2027-01"].actual.prevAvailable).not.toBe(0);
  });

  it("TC-MAN-021h: lo reservado también cruza el borde de año", () => {
    const nodes: LedgerNode[] = [
      { id: "gi", ownerId: "u", type: "income", level: "group", parentId: null, name: "GI", icon: null, order: 0 },
      { id: "ci", ownerId: "u", type: "income", level: "category", parentId: "gi", name: "CI", icon: null, order: 1 },
      { id: "gt", ownerId: "u", type: "transfer", level: "group", parentId: null, name: "GT", icon: null, order: 2 },
      { id: "ct", ownerId: "u", type: "transfer", level: "category", parentId: "gt", name: "CT", icon: null, order: 3 },
    ];
    const s: LedgerState = {
      ownerId: "u", nodes, movements: [],
      budgets: { ci: {}, ct: {} },
      actuals: { ci: { "2026-12": 1000 }, ct: { "2026-12": 300 } },
    };
    const serie = computeBalanceSeries(s, ["2026-12", "2027-01"]);
    expect(serie["2026-12"].actual.reservedBalance).toBe(300);
    expect(serie["2027-01"].actual.prevReserved).toBe(300);
  });

  it("TC-MAN-022e: solo el primer periodo del rango abre en cero", () => {
    const s = conIngreso([["2025-04", 900]]);
    const rango = periodRange("2025-04", "2027-02");
    const serie = computeBalanceSeries(s, rango);
    expect(serie["2025-04"].actual.prevAvailable).toBe(0);
    // ningún enero posterior abre en cero por el hecho de ser enero
    expect(serie["2026-01"].actual.prevAvailable).toBe(900);
    expect(serie["2027-01"].actual.prevAvailable).toBe(900);
    expect(serie["2026-01"].actual.prevAvailable).toBe(serie["2025-12"].actual.available);
    expect(serie["2027-01"].actual.prevAvailable).toBe(serie["2026-12"].actual.available);
  });

  it("TC-MAN-023e: un cambio en 2026-11 se propaga hasta 2027-02", () => {
    const rango = periodRange("2026-10", "2027-02");
    const antes = computeBalanceSeries(conIngreso([["2026-11", 1000]]), rango);
    const despues = computeBalanceSeries(conIngreso([["2026-11", 2000]]), rango);
    for (const p of ["2026-11", "2026-12", "2027-01", "2027-02"]) {
      expect(despues[p].actual.available - antes[p].actual.available).toBe(1000);
    }
  });

  it("TC-MAN-024f: la conservación se mantiene en el paso dic→ene, al peso", () => {
    const s = estadoRef(P2.slice(0, 12)); // datos en 2026; el rango llega a 2027
    const serie = computeBalanceSeries(s, P2);
    for (const p of P2) {
      const b = serie[p];
      expect(b.actual.available + b.actual.reservedBalance).toBe(b.actual.total);
      expect(b.budget.available + b.budget.reservedBalance).toBe(b.budget.total);
    }
    // y el borde concreto encadena
    expect(serie["2027-01"].actual.prevAvailable).toBe(serie["2026-12"].actual.available);
    expect(serie["2027-01"].actual.prevReserved).toBe(serie["2026-12"].actual.reservedBalance);
  });

  it("TC-MAN-025e: un rango vacío devuelve una serie vacía sin lanzar", () => {
    const s = estadoRef();
    expect(() => computeBalanceSeries(s, [])).not.toThrow();
    expect(computeBalanceSeries(s, [])).toEqual({});
    // y el acceso a un periodo ausente da ceros, no undefined (RISK-02 del TRD)
    const serie = computeBalanceSeries(s, P);
    expect(balanceAt(serie, "2099-01").actual.available).toBe(0);
    expect(balanceAt(serie, "2099-01").budget.total).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("FR-1904 · horizonte configurable y rodante", () => {
  const vacio: LedgerState = { ownerId: "u", nodes: [], budgets: {}, actuals: {}, movements: [] };

  it("TC-MAN-030h: horizonte de 2 años desde 2026-09 termina en DICIEMBRE de 2028", () => {
    const r = activeRange(vacio, "2026-09", 2);
    expect(r[0]).toBe("2026-09");
    // Diciembre, no agosto: el horizonte son años COMPLETOS. Con una cuenta de 24 meses el último
    // año salía partido por la mitad, que es lo que el usuario señaló el 2026-09-02.
    expect(r[r.length - 1]).toBe("2028-12");
    expect(r).toHaveLength(28); // sep–dic de 2026 (4) + 2027 (12) + 2028 (12)
  });

  it("TC-MAN-031h: horizonte de 1 año desde 2026-09 termina en DICIEMBRE de 2027", () => {
    const r = activeRange(vacio, "2026-09", 1);
    expect(r[r.length - 1]).toBe("2027-12");
    expect(r).toHaveLength(16); // sep–dic de 2026 (4) + 2027 (12)
    // y ningún año queda a medias: el último periodo de cada año del rango es diciembre
    expect(r.filter((p) => p.endsWith("-12"))).toEqual(["2026-12", "2027-12"]);
  });

  it("TC-MAN-032e: la ventana rueda al cambiar de AÑO, no de mes", () => {
    // Dentro del mismo año el final NO se mueve: la vista es estable mes a mes.
    expect(activeRange(vacio, "2026-09", 2).at(-1)).toBe("2028-12");
    expect(activeRange(vacio, "2026-10", 2).at(-1)).toBe("2028-12");
    expect(activeRange(vacio, "2026-12", 2).at(-1)).toBe("2028-12");
    // al entrar el año siguiente, la ventana avanza un año entero de golpe
    expect(activeRange(vacio, "2027-01", 2).at(-1)).toBe("2029-12");
  });

  it("TC-MAN-033e: bajar el horizonte no borra datos fuera de la ventana", () => {
    const s: LedgerState = {
      ownerId: "u", nodes: [], movements: [], actuals: {},
      budgets: { hoja: { "2028-05": 7000 } },
    };
    const a24 = activeRange(s, "2026-09", 2);
    const a12 = activeRange(s, "2026-09", 1);
    const v24 = activeRange(s, "2026-09", 2);
    expect(s.budgets.hoja["2028-05"]).toBe(7000);   // el dato sigue ahí
    expect(a24).toEqual(v24);                        // el rango vuelve idéntico
    // y con 12 el rango NO recorta el dato: lo que existe manda sobre la ventana
    expect(a12).toContain("2028-05");
  });

  it("TC-MAN-034f: un horizonte fuera de {12,24} cae a 24", () => {
    for (const malo of [0, -5, 18, 24, "muchos", null, undefined, NaN]) {
      expect(normalizeHorizon(malo)).toBe(DEFAULT_HORIZON);
      const r = activeRange(vacio, "2026-09", malo as never);
      expect(r.at(-1)).toBe("2028-12"); // cae al defecto de 2 años
    }
    // y un periodo en curso inválido no produce un rango infinito
    expect(activeRange(vacio, "2026-13", 2)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("FR-1906 · el rango visible", () => {
  const conDato = (p: PeriodKey): LedgerState => ({
    ownerId: "u", nodes: [], movements: [], actuals: {}, budgets: { h: { [p]: 5000 } },
  });

  it("TC-MAN-050h: va del dato más antiguo al fin del horizonte", () => {
    const r = activeRange(conDato("2025-04"), "2026-09", 2);
    expect(r[0]).toBe("2025-04");
    expect(r.at(-1)).toBe("2028-12");
    // contiguo y ordenado: sin huecos
    for (let i = 1; i < r.length; i++) expect(monthsBetween(r[i - 1], r[i])).toBe(1);
  });

  it("TC-MAN-051h: un usuario sin datos ve el mes en curso más su horizonte", () => {
    const vacio: LedgerState = { ownerId: "u", nodes: [], budgets: {}, actuals: {}, movements: [] };
    const r = activeRange(vacio, "2026-09", 2);
    expect(r[0]).toBe("2026-09");
    expect(r.at(-1)).toBe("2028-12");
    expect(oldestPeriodWithData(vacio)).toBeNull();
  });

  it("TC-MAN-052e: registrar en un periodo anterior extiende el rango hacia atrás", () => {
    expect(activeRange(conDato("2025-04"), "2026-09", 2)[0]).toBe("2025-04");
    expect(activeRange(conDato("2024-11"), "2026-09", 2)[0]).toBe("2024-11");
  });

  it("TC-MAN-053e: las cuatro fuentes de dato cuentan para fijar el inicio", () => {
    const base = { ownerId: "u", nodes: [], budgets: {}, actuals: {}, movements: [] };
    const casos: LedgerState[] = [
      { ...base, budgets: { h: { "2025-02": 1 } } },
      { ...base, actuals: { h: { "2025-02": 1 } } },
      { ...base, movements: [{ id: "m", ownerId: "u", type: "expense", catId: "c", subId: null, target: "c", amount: 1, period: "2025-02", createdAt: 1 }] },
      { ...base, cellNotes: { h: { "2025-02": [{ id: "n", createdAt: 1, text: "x" }] } } },
    ];
    for (const s of casos) expect(oldestPeriodWithData(s)).toBe("2025-02");
  });

  it("TC-MAN-054f: una clave basura no corrompe el inicio del rango", () => {
    const s: LedgerState = {
      ownerId: "u", nodes: [], actuals: {}, movements: [],
      budgets: { h: { marzo: 1000, "2025-06": 2000 } as never },
    };
    expect(oldestPeriodWithData(s)).toBe("2025-06");
    expect(activeRange(s, "2026-09", 2)[0]).toBe("2025-06");
    // un cero tampoco cuenta como dato: una celda vacía no puede fijar el inicio de la historia
    const conCero: LedgerState = { ...s, budgets: { h: { "2020-01": 0, "2025-06": 2000 } } };
    expect(oldestPeriodWithData(conCero)).toBe("2025-06");
    expect(newestPeriodWithData(conCero)).toBe("2025-06");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("FR-1908 · el periodo del registro", () => {
  it("TC-MAN-070h: la fecha 2027-03-14 deriva el periodo 2027-03", () => {
    expect(periodFromDate("2027-03-14T10:30")).toBe("2027-03");
    expect(periodFromDate("2027-03-14")).toBe("2027-03");
    expect(periodFromDate("2026-03-14T10:30")).toBe("2026-03");
    expect(periodFromDate("basura")).toBeNull();
    expect(periodFromDate("2027-13-01")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("FR-1909 · reservas sobre la lista de periodos", () => {
  it("TC-MAN-080h: con doce meses el techo da lo mismo que antes de migrar", () => {
    const s = estadoRef();
    P.forEach((p, i) => {
      expect(reserveHeadroom(s, p, P)).toBe(BASE.reservas[viejo(i)].reserveHeadroom);
      expect(availableMargin(s, p, P)).toBe(BASE.reservas[viejo(i)].availableMargin);
    });
  });

  it("TC-MAN-081h: un aporte en 2026-11 se propaga a las series de 2027-01 y 2027-02", () => {
    const nodes: LedgerNode[] = [
      { id: "gt", ownerId: "u", type: "transfer", level: "group", parentId: null, name: "GT", icon: null, order: 0 },
      { id: "ct", ownerId: "u", type: "transfer", level: "category", parentId: "gt", name: "CT", icon: null, order: 1 },
    ];
    const s: LedgerState = { ownerId: "u", nodes, movements: [], budgets: { ct: {} }, actuals: { ct: { "2026-11": 800 } } };
    const rango = periodRange("2026-10", "2027-02");
    const serie = resolvedSeries(s, "ct", "actual", rango);
    expect(serie[rango.indexOf("2026-10")]).toBe(0);
    expect(serie[rango.indexOf("2026-11")]).toBe(800);
    expect(serie[rango.indexOf("2027-01")]).toBe(800); // cruzó el año
    expect(serie[rango.indexOf("2027-02")]).toBe(800);
  });

  it("TC-MAN-082e: ampliar el horizonte sin datos nuevos no mueve el techo", () => {
    const s = estadoRef();
    const corto = P;                                   // 2026 entero
    const largo = periodRange("2026-01", "2027-12");    // dos años, el segundo vacío
    for (const p of P) {
      expect(reserveHeadroom(s, p, largo)).toBe(reserveHeadroom(s, p, corto));
      expect(maxWithdrawal(s, "c-ahorro", p, largo)).toBe(maxWithdrawal(s, "c-ahorro", p, corto));
    }
  });

  it("TC-MAN-083f: un periodo fuera del rango se rechaza en vez de operar con índice −1", () => {
    const s = estadoRef();
    expect(reserveHeadroom(s, "2030-05", P)).toBe(0);
    expect(maxWithdrawal(s, "c-ahorro", "2030-05", P)).toBe(0);
    expect(availableMargin(s, "2030-05", P)).toBe(0);
    expect(cellHeadroom(s, "c-ahorro", "2030-05", "actual", P)).toBe(0);
    expect(plannedRetiroLimit(s, "2030-05", P)).toBe(0);
    expect(monthCarryUsage(s, "2030-05", "actual", P)).toBeNull();
    // el último periodo del rango SÍ opera: la guarda rechaza lo ausente, no lo del borde
    expect(reserveHeadroom(s, P[11], P)).toBe(BASE.reservas[viejo(11)].reserveHeadroom);
  });

  it("TC-MAN-084e: el recálculo con el rango máximo cabe en 150ms", () => {
    const cinco = periodRange(`${REF_YEAR}-01`, `${REF_YEAR + 4}-12`);
    const s = estadoRef(cinco.slice(0, 12));
    __resetReservePerfCounters();
    // BG-030: mejor-de-5, no un cronómetro suelto. El mínimo es la pasada que menos CPU tuvo que
    // compartir, y por tanto la que mide el algoritmo y no la ráfaga que le tocó.
    const ms = mejorTiempo(() => {
      computeBalanceSeries(s, cinco);
      for (const p of cinco) reserveHeadroom(s, p, cinco);
      monthIssues(s, cinco);
    });
    // Guardarrail de tiempo: no se afirma bajo instrumentación de cobertura (BG-026).
    if (CRONOMETRO_FIABLE) expect(ms, `ruta completa en ${ms.toFixed(1)}ms`).toBeLessThanOrEqual(150);
    expect(cinco).toHaveLength(60);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("FR-1910 · la siembra no fabrica pasado", () => {
  it("TC-MAN-090h: un usuario nuevo de 2026-09 no recibe celdas anteriores", () => {
    const s = buildSeed("local", "2026-09");
    const claves = [
      ...Object.values(s.budgets).flatMap((c) => Object.keys(c ?? {})),
      ...Object.values(s.actuals).flatMap((c) => Object.keys(c ?? {})),
    ];
    expect(claves.length).toBeGreaterThan(0);
    for (const k of claves) {
      expect(isPeriodKey(k)).toBe(true);
      expect(comparePeriods(k, "2026-09")).toBeGreaterThanOrEqual(0);
    }
  });

  it("TC-MAN-091e: el rango de un usuario recién creado no arranca en enero", () => {
    const s = buildSeed("local", "2026-09");
    const r = activeRange(s, "2026-09", 2);
    expect(r[0]).toBe("2026-09");
    expect(r[0]).not.toBe("2026-01");
    expect(oldestPeriodWithData(s)).toBe("2026-09");
  });

  it("TC-MAN-092f: no queda ningún registro de doce claves de mes fijas en la siembra", () => {
    const src = readFileSync("src/domain/seed.ts", "utf8");
    expect(src).not.toMatch(/\bene\s*:/);
    expect(src).not.toMatch(/["']ene["']/);
    expect(src).not.toContain("MONTH_KEYS");
    // y la siembra de dos usuarios en meses distintos produce ejes distintos
    const a = Object.keys(buildSeed("a", "2026-09").budgets["c-salario"] ?? {});
    const b = Object.keys(buildSeed("b", "2027-02").budgets["c-salario"] ?? {});
    expect(a[0]).toBe("2026-09");
    expect(b[0]).toBe("2027-02");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("NFR-1902 · el arrastre dentro de un año no cambia", () => {
  it("TC-MAN-210h: un año completo da los mismos números que antes de migrar", () => {
    const serie = computeBalanceSeries(estadoRef(), P);
    P.forEach((p, i) => {
      const ref = BASE.balance[viejo(i)];
      for (const plano of ["budget", "actual"] as const) {
        for (const campo of ["prevAvailable", "prevReserved", "income", "expense", "flow", "reserved", "available", "reservedBalance", "total"] as const) {
          expect(`${p}.${plano}.${campo}=${serie[p][plano][campo]}`)
            .toBe(`${p}.${plano}.${campo}=${ref[plano][campo]}`);
        }
      }
    });
  });

  it("TC-MAN-211e: el plano Presupuestado sigue sin arrastrar su propio cierre", () => {
    const serie = computeBalanceSeries(estadoRef(), P);
    for (let i = 1; i < P.length; i++) {
      // ambos planos abren en el cierre REAL del mes previo (ADR-03 de balance)
      expect(serie[P[i]].budget.prevAvailable).toBe(serie[P[i - 1]].actual.available);
      expect(serie[P[i]].actual.prevAvailable).toBe(serie[P[i - 1]].actual.available);
    }
  });

  it("TC-MAN-212f: una discrepancia de un peso hace fallar la comparación", () => {
    const serie = computeBalanceSeries(estadoRef(), P);
    const alterada = JSON.parse(JSON.stringify(serie));
    alterada[P[5]].actual.available += 1;
    expect(alterada[P[5]].actual.available).not.toBe(serie[P[5]].actual.available);
    expect(() => expect(alterada[P[5]].actual.available).toBe(BASE.balance[viejo(5)].actual.available)).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("NFR-1903 · el techo y las reservas conservan su veredicto", () => {
  it("TC-MAN-220h: las funciones auditadas dan lo mismo que antes de migrar", () => {
    const s = estadoRef();
    P.forEach((p, i) => {
      const ref = BASE.reservas[viejo(i)];
      expect(reserveHeadroom(s, p, P)).toBe(ref.reserveHeadroom);
      expect(availableMargin(s, p, P)).toBe(ref.availableMargin);
      expect(plannedRetiroLimit(s, p, P)).toBe(ref.plannedRetiroLimit);
      expect(reserveAportes(s, p, "actual")).toBe(ref.aportesActual);
      expect(reserveAportes(s, p, "budget")).toBe(ref.aportesBudget);
      expect(reserveRetiros(s, p, "actual")).toBe(ref.retirosActual);
      expect(reserveDelta(s, p, "actual")).toBe(ref.deltaActual);
      expect(maxWithdrawal(s, "c-ahorro", p, P)).toBe(ref.maxWithdrawal);
      expect(cellHeadroom(s, "c-ahorro", p, "actual", P)).toBe(ref.cellHeadroomActual);
    });
  });

  it("TC-MAN-221e: las series resueltas y el plan de retiros no cambian", () => {
    const s = estadoRef();
    expect([...resolvedSeries(s, "c-ahorro", "actual", P)]).toEqual(BASE.serieAhorroActual);
    expect([...resolvedSeries(s, "c-ahorro", "budget", P)]).toEqual(BASE.serieAhorroBudget);
    const plan = s.budgets[RETIROS_PLAN_ID] ?? {};
    const planViejo = Object.fromEntries(
      Object.entries(BASE.retirosPlan).map(([m, v]) => [P[BASE.meses.indexOf(m)], v]));
    expect(plan).toEqual(planViejo);
  });

  it("TC-MAN-222f: la explicación del arrastre nombra el periodo correcto y no cambia de cifra", () => {
    const s = estadoRef();
    P.forEach((p, i) => {
      const ref = BASE.reservas[viejo(i)].carryActual as { reservado: number; delSaldoAnterior: number; mesAnterior: string } | null;
      const got = monthCarryUsage(s, p, "actual", P);
      if (ref === null) { expect(got).toBeNull(); return; }
      expect(got).not.toBeNull();
      expect(got!.reservado).toBe(ref.reservado);
      expect(got!.delSaldoAnterior).toBe(ref.delSaldoAnterior);
      // el mes que nombra es el ANTERIOR del rango, ahora con año
      expect(got!.mesAnterior).toBe(P[BASE.meses.indexOf(ref.mesAnterior)]);
    });
    expect(monthIssues(s, P)).toHaveLength(BASE.issues.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("NFR-1904 · los roll-ups no cambian", () => {
  it("TC-MAN-230h: cada tipo suma lo mismo que antes, en los doce periodos", () => {
    const s = estadoRef();
    P.forEach((p, i) => {
      for (const tipo of ["income", "expense", "transfer"] as const) {
        expect(typeTotals(s, tipo, [p])).toEqual(BASE.rollups[viejo(i)][tipo]);
      }
    });
  });

  it("TC-MAN-231e: un periodo del rango sin datos suma cero, no indefinido", () => {
    const s = estadoRef();
    const t = typeTotals(s, "income", ["2027-07"]);
    expect(t.budget).toBe(0);
    expect(t.actual).toBe(0);
    expect(Number.isNaN(t.actual)).toBe(false);
  });

  it("TC-MAN-232f: los montos de un año no se filtran al roll-up de otro", () => {
    const s = estadoRef();
    expect(typeTotals(s, "income", ["2026-03"]).actual).toBeGreaterThan(0);
    expect(typeTotals(s, "income", ["2027-03"]).actual).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("NFR-1907 · el coste no se degrada", () => {
  // Su ÚNICO contenido es un guardarraíl de tiempo, así que bajo instrumentación se salta
  // ENTERA: mejor verla saltada que verde sin haber afirmado nada (BG-026).
  it.skipIf(SALTAR_SI_INSTRUMENTADO)("TC-MAN-260h: el recómputo con cinco años cabe en 150ms", () => {
    const cinco = periodRange(`${REF_YEAR}-01`, `${REF_YEAR + 4}-12`);
    const s = estadoRef(cinco.slice(0, 12));
    // BG-030: mejor-de-5 (ver tests/helpers/perf.ts).
    const ms = mejorTiempo(() => computeBalanceSeries(s, cinco));
    expect(ms, `recómputo de cinco años en ${ms.toFixed(1)}ms`).toBeLessThanOrEqual(150);
  });

  it("TC-MAN-261f: el número de recómputos de serie por operación no sube", () => {
    const s = estadoRef();
    __resetReservePerfCounters();
    for (const p of P) reserveHeadroom(s, p, P);
    const doce = __reservePerfCounters().seriesComputes;
    const cinco = periodRange(`${REF_YEAR}-01`, `${REF_YEAR + 4}-12`);
    __resetReservePerfCounters();
    for (const p of cinco) reserveHeadroom(s, p, cinco);
    const sesenta = __reservePerfCounters().seriesComputes;
    // el barrido se memoiza por (estado, rango): ampliar el rango no multiplica las pasadas
    expect(sesenta).toBeLessThanOrEqual(doce + 1);
  });

  // Su ÚNICO contenido es un guardarraíl de tiempo, así que bajo instrumentación se salta
  // ENTERA: mejor verla saltada que verde sin haber afirmado nada (BG-026).
  it.skipIf(SALTAR_SI_INSTRUMENTADO)("TC-MAN-262e: el coste POR PERIODO no crece — el barrido es lineal, no cuadrático", () => {
    // BG-002 (de esta feature): la razón es la MEDIANA DE 9 PARES alternos (`razonMediana`), no el
    // cociente de dos mejor-de-5 medidos en bloque. Con BG-030 cada lado se medía por separado, y
    // cuando una racha lenta duraba un bloque ENTERO el mínimo no la salvaba: la razón llegó a 2,68
    // bajo diez procesos quemando CPU y tumbó el verify-run del 2026-09-11. Con pares adyacentes los
    // dos lados comparten la racha. Medido: máximo 1,45 en las mismas condiciones, y sobre un trabajo
    // cuadrático sintético sigue dando ~×14. Cifras y porqué en tests/helpers/perf.ts.
    // Se mide el coste por periodo con repeticiones, no un cronómetro suelto: una medición única
    // reporta el calentamiento del JIT y no el algoritmo (medido: 4,66ms en la primera pasada de
    // 84 periodos frente a 0,128ms cuando está caliente — un factor 36 que no es del código).
    const medir = (n: number, reps: number) => {
      const r = periodRange(`${REF_YEAR}-01`, addMonths(`${REF_YEAR}-01`, n - 1));
      const s = estadoRef(r.slice(0, 12));
      const t0 = performance.now();
      for (let k = 0; k < reps; k++) computeBalanceSeries(s, r);
      return (performance.now() - t0) / reps / n; // coste POR PERIODO
    };
    medir(12, 30); medir(168, 10); // calentar antes de medir

    // Si fuera cuadrático, el coste por periodo crecería con n (×14 al pasar de 12 a 168).
    // El tope se QUEDA en ×2 (lo bajó BG-030 desde ×3): la mediana de pares es más estable que el
    // mejor-de-5 en bloque, así que no hace falta ensancharlo para dejar de dar falsos rojos.
    const razon = razonMediana(() => medir(12, 50), () => medir(168, 30));
    expect(razon, `coste por periodo ×${razon.toFixed(2)} al pasar de 12 a 168`).toBeLessThanOrEqual(2);
    // y el total con 14 años sigue muy por debajo del tope de la NFR (presupuesto absoluto: mejor-de-5)
    const c168 = mejorDe(() => medir(168, 30));
    expect(c168 * 168).toBeLessThanOrEqual(150);
  });
});

describe("periodos · aritmética de bordes", () => {
  it("addMonths cruza el año en los dos sentidos", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-09", 24)).toBe("2028-09");
    expect(addMonths("2026-09", 0)).toBe("2026-09");
  });
  it("periodRange invertido devuelve vacío, nunca un rango al revés", () => {
    expect(periodRange("2027-01", "2026-01")).toEqual([]);
    expect(periodRange("2026-01", "2026-01")).toEqual(["2026-01"]);
    expect(periodRange("basura", "2026-01")).toEqual([]);
  });
  it("isYearStart marca enero y solo enero", () => {
    expect(isYearStart("2026-01")).toBe(true);
    expect(isYearStart("2027-01")).toBe(true);
    expect(isYearStart("2026-02")).toBe(false);
    expect(isYearStart("2026-12")).toBe(false);
  });
});

expect(P0).toBe(`${REF_YEAR}-01`);
