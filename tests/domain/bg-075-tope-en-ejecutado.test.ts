/**
 * BG-075 — el total tecleado en una celda Ejec. tiene el mismo tope que el resto del dinero.
 *
 * `setLeafAmount` recorta en `MONTO_MAX` desde BG-021, pero las celdas Ejec. de gasto e ingreso
 * pasaron a `adjustCell` con FR-2504 y esa función solo acotaba por abajo. Una cifra de 17 dígitos o
 * más creaba un ajuste fuera del rango exacto de JavaScript, el servidor respondía 422 y el guardado
 * entero se perdía.
 */
import { describe, it, expect } from "vitest";
import { adjustCell, movementSum } from "@/domain";
import { MONTO_MAX } from "@/domain/validation";
import type { LedgerNode, LedgerState, Movement } from "@/domain/types";
import { P, M } from "../helpers/periods";

const SEP = M.sep;
const FECHA = "2026-09-10T12:00";

const NODES: LedgerNode[] = [
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Esenciales", icon: null, order: 0 },
  { id: "c-taxi", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Taxi", icon: null, order: 1 },
];

function estado(over: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "local", nodes: NODES, budgets: {}, actuals: {}, movements: [], ...over };
}

function movimiento(id: string, amount: number, kind?: "adjustment"): Movement {
  return {
    id, ownerId: "local", type: "expense", catId: "c-taxi", subId: null, target: "c-taxi",
    amount, period: SEP, createdAt: 1, date: FECHA, ...(kind ? { kind } : {}),
  };
}

describe("BG-075 · el total de una celda Ejec. se acota por arriba", () => {
  it("BG-075a: una cifra de 21 dígitos queda en el tope, y el ajuste es un entero exacto", () => {
    const r = adjustCell(estado(), "c-taxi", SEP, 1e20, FECHA, P);
    if (!("state" in r)) throw new Error(`se rechazó: ${r.rejected}`);
    expect(r.state.actuals["c-taxi"]![SEP]).toBe(MONTO_MAX);
    expect(r.created?.amount).toBe(MONTO_MAX);
    expect(Number.isSafeInteger(r.created!.amount)).toBe(true);
    // La celda sigue valiendo lo que suman sus movimientos (FR-2511).
    expect(movementSum(r.state, "c-taxi", SEP)).toBe(MONTO_MAX);
  });

  it("BG-075b: con movimientos previos, el ajuste es la diferencia hasta el tope", () => {
    const base = estado({ actuals: { "c-taxi": { [SEP]: 40_000 } }, movements: [movimiento("m1", 40_000)] });
    const r = adjustCell(base, "c-taxi", SEP, 2 ** 60, FECHA, P);
    if (!("state" in r)) throw new Error(`se rechazó: ${r.rejected}`);
    expect(r.state.actuals["c-taxi"]![SEP]).toBe(MONTO_MAX);
    expect(r.created?.amount).toBe(MONTO_MAX - 40_000);
  });

  it("BG-075c: el tope exacto y una cifra corriente pasan sin recorte", () => {
    const tope = adjustCell(estado(), "c-taxi", SEP, MONTO_MAX, FECHA, P);
    expect("state" in tope && tope.state.actuals["c-taxi"]![SEP]).toBe(MONTO_MAX);
    const normal = adjustCell(estado(), "c-taxi", SEP, 120_000, FECHA, P);
    expect("state" in normal && normal.state.actuals["c-taxi"]![SEP]).toBe(120_000);
    expect("state" in normal && normal.created?.amount).toBe(120_000);
  });

  it("BG-075d: si la diferencia no cabe en un movimiento, se rechaza y el estado no cambia", () => {
    // Una celda que ya venía con suma negativa: llegar al tope pediría un ajuste mayor que el tope.
    const base = estado({ actuals: { "c-taxi": { [SEP]: -5 } }, movements: [movimiento("a1", -5, "adjustment")] });
    const r = adjustCell(base, "c-taxi", SEP, 1e20, FECHA, P);
    expect(r).toEqual({ rejected: "invalid_value" });
    expect(base.actuals["c-taxi"]![SEP]).toBe(-5);
    expect(base.movements).toHaveLength(1);
  });
});
