// Feature presupuesto-movil — lo que el Balance pinta (balanceView) y las operaciones de reserva del
// periodo (withdrawalRows). Prefijo TC-PMV-*.
//
// Las tres funciones de `balanceView` que valor, color y cero vivían como privadas en el módulo de
// escritorio. Aquí se fijan por su RESULTADO, contra series capturadas con el código anterior: si la
// mudanza hubiera cambiado una cifra o un color, estas pruebas caen.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeBalanceSeries, type BalanceSeries, type MonthBalance } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { reserveAportes, reserveRetiros } from "@/domain/reserve";
import { buildSeed } from "@/domain/seed";
import type { LedgerState, PeriodKey } from "@/domain/types";
import { ROWS, type RowKey } from "@/components/balanceRows";
import { balanceColor, balanceRowValue, balanceSummary, reserveFlows, zeroIsAnswer } from "@/components/balanceView";
import { withdrawalRows } from "@/components/mobile/withdrawalRows";
import { M as MES, P, P0 } from "../helpers/periods";
import { PMV, PMV_MOV, pmvBase } from "../fixtures/pmv-base";

const M = MES.mar;
const PREV = MES.feb;
const base = (): LedgerState => ({ ...buildSeed("local", P0), ...pmvBase(M, PREV) });
const serieDe = (s: LedgerState, periods: readonly PeriodKey[] = P) => computeBalanceSeries(s, periods, openingCarry(s, periods));
const fila = (key: RowKey) => ROWS.find((r) => r.key === key)!;
const lee = <T,>(nombre: string): T => JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures", nombre), "utf8")) as T;

/** Qué campo de la serie pinta cada fila que NO es un flujo bruto de reservas. */
const CAMPO: Partial<Record<RowKey, keyof MonthBalance>> = {
  income: "income", expense: "expense", monthResult: "flow", monthResultCarry: "flow",
  prevAvailable: "prevAvailable", available: "available", reservedBalance: "reservedBalance", total: "total",
};

/** Compara cada fila del Balance contra una serie capturada, y comprueba que la cuenta cierra. */
function comparar(state: LedgerState, periods: PeriodKey[], capturada: (p: PeriodKey, plane: "budget" | "actual") => MonthBalance | null): number {
  const series = serieDe(state, periods);
  const flows = reserveFlows(state, periods);
  let comparadas = 0;
  for (const p of periods) {
    for (const plane of ["budget", "actual"] as const) {
      const esperado = capturada(p, plane);
      if (!esperado) continue;
      for (const spec of ROWS) {
        const v = balanceRowValue(series[p][plane], spec.key, flows[p][plane]);
        const campo = CAMPO[spec.key];
        if (campo) expect(v, `${p} · ${plane} · ${spec.key}`).toBe(esperado[campo]);
        else if (spec.key === "toReserves") expect(v, `${p} · ${plane} · aportes`).toBe(reserveAportes(state, p, plane));
        else expect(v, `${p} · ${plane} · retiros`).toBe(reserveRetiros(state, p, plane));
        comparadas++;
      }
      // La cuenta del bloque del medio cierra con las cifras que salen de las filas.
      const f = flows[p][plane];
      expect(esperado.prevAvailable + esperado.flow - f.aportes + f.retiros, `${p} · ${plane} · cierre`).toBe(esperado.available);
    }
  }
  return comparadas;
}

describe("presupuesto-movil · lo que el Balance pinta", () => {
  it("TC-PMV-104e: el resumen y las filas del Balance salen de la serie, cifra por cifra", () => {
    // @aitri-tc TC-PMV-104e
    const s = base();
    const series = serieDe(s);
    expect(balanceSummary(series, M)).toEqual({
      resultado: { actual: 3000, budget: 2600 },
      disponible: { actual: 5550, budget: 4900 },
      reservado: { actual: 600, budget: 800 },
      total: { actual: 6150, budget: 5700 },
    });
    const flows = reserveFlows(s, [M])[M];
    const real = (k: RowKey) => balanceRowValue(series[M].actual, k, flows.actual);
    const plan = (k: RowKey) => balanceRowValue(series[M].budget, k, flows.budget);
    expect(ROWS.map((r) => real(r.key))).toEqual([5000, 2000, 3000, 2850, 3000, 500, 200, 5550, 600, 6150]);
    expect(ROWS.map((r) => plan(r.key))).toEqual([5000, 2400, 2600, 2800, 2600, 500, 0, 4900, 800, 5700]);
    // Un periodo que no está en la serie no rompe: da ceros.
    expect(balanceSummary(series, "2031-01")).toEqual({
      resultado: { actual: 0, budget: 0 }, disponible: { actual: 0, budget: 0 },
      reservado: { actual: 0, budget: 0 }, total: { actual: 0, budget: 0 },
    });
  });

  it("TC-PMV-105f: el color y el cero siguen la regla de escritorio: alerta solo en fila de alarma negativa", () => {
    // @aitri-tc TC-PMV-105f
    expect(balanceColor(fila("available"), -1)).toBe("var(--alert-strong)");
    expect(balanceColor(fila("total"), -1)).toBe("var(--alert-strong)");
    expect(balanceColor(fila("prevAvailable"), -1)).toBe("var(--alert-strong)");
    // «Resultado del mes» no alarma: un mes en pérdida es información, no una deuda.
    expect(balanceColor(fila("monthResult"), -1)).toBe("var(--fg)");
    expect(balanceColor(fila("available"), 1)).toBe("var(--fg)");
    // Un sumando es contexto: atenuado, sea cual sea su signo.
    expect(balanceColor(fila("income"), 5)).toBe("var(--fg-secondary)");
    expect(balanceColor(fila("toReserves"), 5)).toBe("var(--fg-secondary)");
    expect(balanceColor(fila("reservedBalance"), 5)).toBe("var(--fg-secondary)");
    // Ninguna cifra sana va en verde.
    for (const r of ROWS) expect(balanceColor(r, 100), r.key).not.toContain("favorable");

    expect(zeroIsAnswer(fila("total"), 0)).toBe(true);
    expect(zeroIsAnswer(fila("available"), 0)).toBe(true);
    expect(zeroIsAnswer(fila("monthResult"), 0)).toBe(true);
    expect(zeroIsAnswer(fila("income"), 0)).toBe(false);
    expect(zeroIsAnswer(fila("toWithdrawals"), 0)).toBe(false);
    expect(zeroIsAnswer(fila("total"), 5)).toBe(false);
  });

  it("TC-PMV-165h: cada fila del Balance coincide con las series capturadas antes de mudar las funciones", () => {
    // @aitri-tc TC-PMV-165h
    interface Sdb { capturedOn: string; periods: PeriodKey[]; state: LedgerState; series: BalanceSeries }
    const sdb = lee<Sdb>("sdb-base.json");
    expect(sdb.capturedOn).toBe("434a89b");
    expect(comparar(sdb.state, sdb.periods, (p, plane) => sdb.series[p][plane])).toBe(6 * 2 * ROWS.length);

    interface Carril { capturedOn: string; periods: PeriodKey[]; state: LedgerState; actual: Record<PeriodKey, MonthBalance> }
    const carril = lee<Carril>("carril-base.json");
    expect(carril.capturedOn).toBe("795ca8a");
    expect(comparar(carril.state, carril.periods, (p, plane) => (plane === "actual" ? carril.actual[p] : null))).toBe(6 * ROWS.length);

    interface Rpg { periodos: PeriodKey[]; ledgers: Record<string, LedgerState>; available: Record<string, number[]> }
    const rpg = lee<Rpg>("retirar-para-gastar-balance-base.json");
    let disponibles = 0;
    for (const [k, s] of Object.entries(rpg.ledgers)) {
      const series = serieDe(s, rpg.periodos);
      const flows = reserveFlows(s, rpg.periodos);
      expect(rpg.periodos.map((p) => balanceRowValue(series[p].actual, "available", flows[p].actual)), k).toEqual(rpg.available[k]);
      disponibles += rpg.periodos.length;
    }
    expect(disponibles).toBe(36);
  });

  it("TC-PMV-166e: reserveFlows da los aportes y los retiros brutos, por plano", () => {
    // @aitri-tc TC-PMV-166e
    const flows = reserveFlows(base(), [PREV, M]);
    expect(flows[PREV]).toEqual({ budget: { aportes: 300, retiros: 0 }, actual: { aportes: 300, retiros: 0 } });
    expect(flows[M]).toEqual({ budget: { aportes: 500, retiros: 0 }, actual: { aportes: 500, retiros: 200 } });
    // Brutos, no netos: un mes que solo retira no da un aporte negativo.
    const soloRetira = base();
    soloRetira.actuals[PMV.viaje] = { [PREV]: 300 };
    expect(reserveFlows(soloRetira, [M])[M].actual).toEqual({ aportes: 0, retiros: 200 });
    expect(Object.keys(reserveFlows(base(), []))).toEqual([]);
  });
});

describe("presupuesto-movil · las operaciones de reserva del periodo", () => {
  it("TC-PMV-095e: un movimiento entre alcancías se lista con sus dos extremos y no cuenta como retiro", () => {
    // @aitri-tc TC-PMV-095e
    const s = base();
    s.nodes.push({ id: "c-carro", ownerId: "local", type: "transfer", level: "category", parentId: PMV.ahorro, name: "Carro", icon: null, order: 1 });
    s.movements.push({
      id: "mv-mover", ownerId: "local", type: "transfer", catId: "c-carro", subId: null, target: "c-carro",
      amount: 100, period: M, createdAt: 99, date: `${M}-18T10:00`, from: PMV.viaje, to: "c-carro",
    });

    const rows = withdrawalRows(s, M);
    expect(rows.map(({ id, from, to, amount, countsAsRetiro }) => ({ id, from, to, amount, countsAsRetiro }))).toEqual([
      { id: PMV_MOV.retiro, from: "Viaje", to: "Disponible", amount: 200, countsAsRetiro: true },
      { id: "mv-mover", from: "Viaje", to: "Carro", amount: 100, countsAsRetiro: false },
    ]);
    expect(rows[0].note).toBe("Tiquetes");
    // La cifra «Retiros del mes» suma solo lo que fue a Disponible.
    expect(reserveRetiros(s, M, "actual")).toBe(200);
    expect(rows.filter((r) => r.countsAsRetiro).reduce((a, r) => a + r.amount, 0)).toBe(200);
    // Otro periodo no trae las operaciones de éste.
    expect(withdrawalRows(s, PREV)).toEqual([]);
  });
});
