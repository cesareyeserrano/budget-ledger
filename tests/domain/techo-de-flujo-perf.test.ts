/**
 * Feature techo-de-flujo — NFR-1807 (Performance): «derivar el techo, los saldos y los errores de
 * los doce meses no empeora el coste medido vigente».
 *
 * POR QUÉ ESTE FICHERO EXISTE APARTE. Los tres casos que verifican este requisito (TC-TDF-261h,
 * TC-TDF-262e, TC-TDF-263f) se declararon en la fase 3 y nunca se implementaron: la feature cerró
 * 5/5 contándolos como «saltados», así que NFR-1807 llegó al sello sin UNA sola prueba real
 * (BG-001 de la feature, verificado el 2026-09-04). Van en su propio fichero por la misma razón
 * que `reserve-perf.test.ts` y `rollup-perf.test.ts`: un escenario grande que no se quiere
 * reconstruir en cada caso del fichero de dominio.
 *
 * QUÉ SE MIDE, Y CON QUÉ. Dos instrumentos distintos, a propósito:
 *   · el CRONÓMETRO para el guardarraíl de 150 ms (TC-TDF-261h), que solo se afirma cuando el
 *     reloj de pared significa algo — bajo instrumentación de cobertura lo que mide es el coste de
 *     contar ramas, no el del algoritmo (BG-026, `tests/helpers/perf.ts`);
 *   · los CONTADORES de barridos para la memoización (TC-TDF-262e, TC-TDF-263f), que cuentan
 *     PASADAS y no milisegundos y por tanto siguen siendo ciertos bajo cobertura. La propiedad que
 *     de verdad protege el rendimiento aquí es «no barrer doce meses de más», y esa se afirma
 *     SIEMPRE, en toda corrida.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  AVAILABLE_ID,
  __resetReservePerfCounters,
  __reservePerfCounters,
  applyReserveOp,
  cellHeadroom,
  monthCarryUsage,
  monthIssues,
  reserveHeadroom,
  resolvedSeries,
} from "@/domain/reserve";
import { computeBalanceSeries } from "@/domain/balance";
import { setLeafAmount } from "@/domain/mutations";
import { P, P as MONTH_KEYS } from "../helpers/periods";
import type { AmountMap, LedgerNode, LedgerState, PeriodKey, NodeType } from "@/domain/types";
import { CRONOMETRO_FIABLE } from "../helpers/perf";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────

interface LeafSpec { id: string; type: NodeType; actual?: Partial<Record<PeriodKey, number>> }

function makeState(leaves: LeafSpec[]): LedgerState {
  const nodes: LedgerNode[] = [];
  const budgets: AmountMap = {};
  const actuals: AmountMap = {};
  const seen = new Set<NodeType>();
  leaves.forEach((l, i) => {
    if (!seen.has(l.type)) {
      seen.add(l.type);
      nodes.push({ id: `g-${l.type}`, ownerId: "local", type: l.type, level: "group", parentId: null, name: `Grupo ${l.type}`, icon: null, order: 0 });
    }
    nodes.push({ id: l.id, ownerId: "local", type: l.type, level: "category", parentId: `g-${l.type}`, name: l.id, icon: null, order: i + 1 });
    if (l.actual) actuals[l.id] = { ...l.actual };
  });
  return { ownerId: "local", nodes, budgets, actuals, movements: [] };
}

/** Los OCHO bolsillos del escenario del guardarraíl. */
const POCKETS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** Base con un ingreso, un gasto y dos bolsillos — el mismo molde del fichero de dominio. */
function base(actualIngreso: Partial<Record<PeriodKey, number>> = {}): LedgerState {
  return makeState([
    { id: "c-ingreso", type: "income", actual: actualIngreso },
    { id: "c-gasto", type: "expense" },
    { id: "A", type: "transfer" },
    { id: "B", type: "transfer" },
  ]);
}

function op(s: LedgerState, from: string, to: string, period: PeriodKey, amount: number): LedgerState {
  const r = applyReserveOp(s, { from, to, period, amount }, P);
  if (!("state" in r)) throw new Error(`operación rechazada (${from}→${to} ${period} ${amount}): ${JSON.stringify(r.rejected)}`);
  return r.state;
}

/**
 * El escenario declarado del guardarraíl: 8 bolsillos, 12 meses, 500 movimientos.
 *
 * La mezcla es la real —aportes, retiros y moveres entre bolsillos—, no 500 aportes iguales: el
 * coste que NFR-1807 protege es el del barrido encadenado, y el mover y el retiro son justo las
 * operaciones que lo encadenan. Cada mes empieza dotando los ocho bolsillos para que los retiros y
 * moveres posteriores tengan saldo de donde salir (si no, los rechazaría el piso, no el techo).
 */
function makeBigState(): LedgerState {
  const ingreso: Partial<Record<PeriodKey, number>> = {};
  for (const m of MONTH_KEYS) ingreso[m] = 1_000_000; // holgura de sobra: aquí no se mide el techo
  let s = makeState([
    { id: "c-ingreso", type: "income", actual: ingreso },
    { id: "c-gasto", type: "expense" },
    ...POCKETS.map((id) => ({ id, type: "transfer" as NodeType })),
  ]);

  let n = 0;
  for (const m of MONTH_KEYS) {
    for (const id of POCKETS) {            // 8 aportes: dotar el mes
      if (n >= 500) break;
      s = op(s, AVAILABLE_ID, id, m, 500);
      n++;
    }
    for (let k = 0; k < 34 && n < 500; k++) {
      const i = k % POCKETS.length;
      if (k % 3 === 2) s = op(s, POCKETS[i], POCKETS[(i + 1) % POCKETS.length], m, 10); // mover
      else if (k % 3 === 1) s = op(s, POCKETS[i], AVAILABLE_ID, m, 20);                 // retiro
      else s = op(s, AVAILABLE_ID, POCKETS[i], m, 200);                                 // aporte
      n++;
    }
  }
  if (s.movements.length !== 500) throw new Error(`el escenario debe tener 500 movimientos, tiene ${s.movements.length}`);
  return s;
}

beforeEach(() => {
  __resetReservePerfCounters();
});

// ── NFR-1807 · el coste de derivar los doce meses ──────────────────────────────────────────────

describe("NFR-1807 · derivar techo, saldos y errores de los doce meses no empeora el coste", () => {
  // @aitri-tc TC-TDF-261h
  it("TC-TDF-261h: el guardarraíl sigue bajo 150ms con las series nuevas (8 bolsillos, 500 movimientos)", () => {
    const s = makeBigState(); // fuera del cronómetro: construir no es derivar

    // El recómputo COMPLETO que hace un render de la grilla: la cascada del balance, el cupo y el
    // desglose del arrastre de los doce meses, la serie de cada bolsillo y el barrido de errores.
    const t0 = performance.now();
    const series = computeBalanceSeries(s, P);
    const cupos: number[] = [];
    for (const m of MONTH_KEYS) {
      cupos.push(reserveHeadroom(s, m, P));
      monthCarryUsage(s, m, "actual", P);
      for (const id of POCKETS) resolvedSeries(s, id, "actual", P);
    }
    const issues = monthIssues(s, P);
    const elapsed = performance.now() - t0;

    // Que el recómputo haya derivado algo de verdad — un guardarraíl sobre trabajo vacío no mide
    // nada. Estas aserciones se afirman SIEMPRE, también bajo cobertura.
    expect(s.movements).toHaveLength(500);
    expect(cupos).toHaveLength(12);
    expect(cupos.every((c) => c > 0)).toBe(true);            // con 1.000.000/mes queda cupo de sobra
    expect(issues).toEqual([]);                              // el escenario es válido: nada que marcar
    expect(series["2026-12"].actual.reservedBalance).toBeGreaterThan(0);
    // Y el reservado del cierre cuadra al peso con la suma de los ocho bolsillos.
    const suma = POCKETS.reduce((acc, id) => acc + resolvedSeries(s, id, "actual", P)[11], 0);
    expect(series["2026-12"].actual.reservedBalance).toBe(suma);

    // Guardarraíl de tiempo: no se afirma bajo instrumentación de cobertura (BG-026).
    if (CRONOMETRO_FIABLE) {
      expect(elapsed, `recómputo completo en ${elapsed.toFixed(1)}ms`).toBeLessThan(150);
    }
  });

  // @aitri-tc TC-TDF-262e
  it("TC-TDF-262e: 24 lecturas cuestan ≤2 barridos — publicar tres series cuesta lo mismo que una", () => {
    const s = makeBigState();
    __resetReservePerfCounters(); // construir el escenario barrió: aquí se cuentan solo las lecturas

    // Las 24 lecturas: los doce meses en los DOS planos. La memoización de `techoScan` es por
    // (journal, mapa del plano, ámbito, plano), así que el techo del año entero debe salir de un
    // barrido por plano — dos en total, no veinticuatro.
    const ejecutado: number[] = [];
    const presupuestado: number[] = [];
    for (const m of MONTH_KEYS) ejecutado.push(cellHeadroom(s, "A", m, "actual", P));
    for (const m of MONTH_KEYS) presupuestado.push(cellHeadroom(s, "A", m, "budget", P));

    expect(ejecutado).toHaveLength(12);
    expect(presupuestado).toHaveLength(12);
    expect(ejecutado.every((v) => v > 0)).toBe(true); // lecturas reales, no ceros de un atajo
    expect(__reservePerfCounters().techoScans).toBeLessThanOrEqual(2);

    // «Publicar tres series cuesta lo mismo que una»: el cupo, el desglose del arrastre y el
    // barrido de errores son tres salidas públicas distintas del MISMO barrido del plano Ejecutado.
    // Consultarlas las tres no puede añadir ni una pasada más.
    const trasLasLecturas = __reservePerfCounters().techoScans;
    for (const m of MONTH_KEYS) {
      reserveHeadroom(s, m, P);
      monthCarryUsage(s, m, "actual", P);
    }
    monthIssues(s, P);
    expect(__reservePerfCounters().techoScans).toBe(trasLasLecturas);
  });

  // @aitri-tc TC-TDF-263f
  it("TC-TDF-263f: una mutación invalida la memoización — el cupo nunca se sirve obsoleto", () => {
    let s = base({ "2026-01": 500 });

    // Leer y memoizar.
    expect(reserveHeadroom(s, "2026-01", P)).toBe(500);
    const trasElPrimero = __reservePerfCounters().techoScans;
    expect(trasElPrimero).toBe(1);
    expect(reserveHeadroom(s, "2026-01", P)).toBe(500);
    expect(__reservePerfCounters().techoScans).toBe(trasElPrimero); // la relectura no vuelve a barrer

    // Mutar: el ingreso de enero sube de 500 a 600.
    s = setLeafAmount(s, "c-ingreso", "2026-01", "actual", 600, P);

    // Re-leer: el cupo refleja el cambio. Si el caché sirviera lo memoizado, aquí saldría 500 y la
    // celda aceptaría 100 menos de lo que el mes admite de verdad.
    expect(reserveHeadroom(s, "2026-01", P)).toBe(600);
    expect(__reservePerfCounters().techoScans).toBe(trasElPrimero + 1); // barrió de nuevo, una vez

    // Y el estado nuevo también memoiza: la segunda lectura del valor nuevo no barre.
    expect(reserveHeadroom(s, "2026-01", P)).toBe(600);
    expect(__reservePerfCounters().techoScans).toBe(trasElPrimero + 1);
  });
});
