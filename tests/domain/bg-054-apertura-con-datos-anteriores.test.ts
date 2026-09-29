/**
 * BG-054 — un dato anterior al mes de inicio ya no borra el saldo inicial.
 *
 * FR-1906 (multi-anio) permite registrar en un periodo anterior al rango, que se estira hacia atrás
 * para incluirlo. Pero la apertura solo entraba si la serie empezaba EXACTAMENTE en el mes de inicio
 * (`openingCarry`), así que al estirarse el saldo inicial dejaba de contarse, sin aviso.
 *
 * Decisión del usuario (2026-09-29): el mes de inicio abre SIEMPRE en el saldo declarado. Lo anterior
 * se muestra como historia, pero no cambia ninguna cifra desde el inicio. Se comprueba en las dos
 * derivaciones que usan la apertura: la serie del Balance y el techo de reservas.
 */
import { describe, it, expect } from "vitest";
import { computeBalanceSeries } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { AVAILABLE_ID as D, applyReserveOp, reserveHeadroom } from "@/domain/reserve";
import { periodRange } from "@/domain/periods";
import type { LedgerNode, LedgerState, PeriodKey } from "@/domain/types";

const ENE = "2026-01" as PeriodKey;
const JUN = "2026-06" as PeriodKey;
const JUL = "2026-07" as PeriodKey;
const SEP = "2026-09" as PeriodKey;
const nodo = (id: string, type: LedgerNode["type"], level: LedgerNode["level"], parentId: string | null, order: number): LedgerNode =>
  ({ id, ownerId: "l", type, level, parentId, name: id, icon: null, order });
const NODES: LedgerNode[] = [
  nodo("g-e", "expense", "group", null, 0), nodo("gas", "expense", "category", "g-e", 1),
  nodo("g-t", "transfer", "group", null, 2), nodo("A", "transfer", "category", "g-t", 3),
];

/** Inicio declarado en junio con 1.000.000; opcionalmente, un gasto de 10.000 registrado en enero. */
function ledger(conGastoEnEnero: boolean): LedgerState {
  return {
    ownerId: "l", nodes: NODES, budgets: {}, movements: [],
    actuals: conGastoEnEnero ? { gas: { [ENE]: 10_000 } } : {},
    startMonth: JUN, openingBalance: 1_000_000,
  } as LedgerState;
}

const DESDE_ENERO = periodRange("2026-01", "2026-12");
const DESDE_JUNIO = periodRange("2026-06", "2026-12");

describe("BG-054 · el mes de inicio abre en el saldo declarado aunque haya datos anteriores", () => {
  it("la serie del Balance: junio abre en 1.000.000 y enero queda como historia", () => {
    const s = ledger(true);
    const serie = computeBalanceSeries(s, DESDE_ENERO, openingCarry(s, DESDE_ENERO));
    expect(serie[ENE].actual.available).toBe(-10_000); // la historia anterior se ve tal cual
    expect(serie[JUN].actual.prevAvailable).toBe(1_000_000);
    expect(serie[JUN].budget.prevAvailable).toBe(1_000_000);
    expect(serie[SEP].actual.available).toBe(1_000_000);
  });

  it("desde junio las cifras son las mismas que sin el dato anterior", () => {
    const con = ledger(true);
    const sin = ledger(false);
    const serieCon = computeBalanceSeries(con, DESDE_ENERO, openingCarry(con, DESDE_ENERO));
    const serieSin = computeBalanceSeries(sin, DESDE_JUNIO, openingCarry(sin, DESDE_JUNIO));
    for (const p of DESDE_JUNIO) {
      expect(serieCon[p], p).toEqual(serieSin[p]);
    }
  });

  it("el techo de reservas también abre en el saldo declarado", () => {
    const s = ledger(true);
    expect(reserveHeadroom(s, JUL, DESDE_ENERO)).toBe(reserveHeadroom(ledger(false), JUL, DESDE_JUNIO));
    const r = applyReserveOp(s, { from: D, to: "A", period: JUL, amount: 500_000, date: "2026-07-10T10:00" }, DESDE_ENERO);
    expect("state" in r, JSON.stringify(r)).toBe(true);
  });

  it("sin saldo declarado nada cambia: el rango arranca en enero en cero, como antes", () => {
    const s = { ...ledger(true), openingBalance: null } as LedgerState;
    const serie = computeBalanceSeries(s, DESDE_ENERO, openingCarry(s, DESDE_ENERO));
    expect(serie[JUN].actual.prevAvailable).toBe(-10_000);
    expect(serie[SEP].actual.available).toBe(-10_000);
  });
});
