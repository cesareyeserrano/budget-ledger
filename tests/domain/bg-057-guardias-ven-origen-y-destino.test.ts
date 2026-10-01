/**
 * BG-057 — los guardias del servidor ven el ORIGEN y el DESTINO de un traslado entre bolsillos.
 *
 * `diffMovements` (cierre) y la firma de `touchesReserves` (reservas) comparaban monto, target,
 * catId, subId, tipo, nota, fecha y kind, pero no `from` ni `to`. En un traslado `target` es el
 * destino, así que reescribir el ORIGEN cambia dos saldos y ninguno de los dos guardias lo veía: un
 * bolsillo podía quedar en negativo dentro de un mes cerrado.
 *
 * Cada caso lleva su control: el mismo traslado sin tocar no se marca.
 */
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { isLeaf } from "@/domain/tree";
import { applyReserveOp } from "@/domain/reserve";
import { closedPeriodsViolated } from "@/domain/closure";
import { worsenedBy } from "@/domain/guard";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

const ENE: PeriodKey = "2026-01";

/** Tres bolsillos: A con 300 de aporte, B y C vacíos, y un traslado de 200 de A a B en enero. */
function escenario(): { state: LedgerState; traslado: Movement } {
  const seed = buildSeed("u", ENE);
  const grupo = seed.nodes.find((n) => n.type === "transfer" && !isLeaf(n, seed.nodes))!;
  const bolsillo = (id: string, order: number): LedgerNode =>
    ({ id, ownerId: "u", type: "transfer", level: "category", parentId: grupo.id, name: id, icon: null, order });
  const ing = seed.nodes.find((n) => n.type === "income" && isLeaf(n, seed.nodes))!.id;
  const base: LedgerState = {
    ...seed,
    nodes: [...seed.nodes, bolsillo("b-a", 900), bolsillo("b-b", 901), bolsillo("b-c", 902)],
    budgets: {},
    actuals: { [ing]: { [ENE]: 1_000 }, "b-a": { [ENE]: 300 } },
    movements: [],
  };
  const r = applyReserveOp(base, { from: "b-a", to: "b-b", period: ENE, amount: 200 }, [ENE]);
  if (!("state" in r)) throw new Error(`el traslado del escenario no se pudo hacer: ${JSON.stringify(r)}`);
  const traslado = r.state.movements.find((m) => m.type === "transfer" && m.from === "b-a" && m.to === "b-b");
  if (!traslado) throw new Error("el escenario no dejó el traslado A→B");
  return { state: r.state, traslado };
}

/** El mismo estado con el traslado reescrito por `cambio`. */
function reescrito(st: LedgerState, id: string, cambio: Partial<Movement>): LedgerState {
  return { ...st, movements: st.movements.map((m) => (m.id === id ? { ...m, ...cambio } : m)) };
}

describe("BG-057 — el guardia de cierre ve origen y destino", () => {
  it("cambiar el ORIGEN de un traslado en un mes cerrado se marca", () => {
    const { state, traslado } = escenario();
    const cerrado = { ...state, closure: { closedThrough: ENE, reopened: null } };
    expect(closedPeriodsViolated(cerrado, reescrito(state, traslado.id, { from: "b-c" }))).toEqual([ENE]);
  });

  it("cambiar el DESTINO (`to`) se marca aunque `target` no cambie", () => {
    const { state, traslado } = escenario();
    const cerrado = { ...state, closure: { closedThrough: ENE, reopened: null } };
    expect(closedPeriodsViolated(cerrado, reescrito(state, traslado.id, { to: "b-c" }))).toEqual([ENE]);
  });

  it("control: el mismo traslado sin tocar no se marca", () => {
    const { state } = escenario();
    const cerrado = { ...state, closure: { closedThrough: ENE, reopened: null } };
    expect(closedPeriodsViolated(cerrado, { ...state, movements: state.movements.map((m) => ({ ...m })) })).toEqual([]);
  });
});

describe("BG-057 — el guardia de reservas ve origen y destino", () => {
  it("sacar el traslado de un bolsillo vacío (C) lo deja en negativo y se rechaza", () => {
    const { state, traslado } = escenario();
    const v = worsenedBy(state, reescrito(state, traslado.id, { from: "b-c" }), [ENE]);
    expect(v).toHaveLength(1);
    expect(v[0]!.period).toBe(ENE);
  });

  it("control: el mismo estado sin tocar no tiene violaciones", () => {
    const { state } = escenario();
    expect(worsenedBy(state, { ...state, movements: state.movements.map((m) => ({ ...m })) }, [ENE])).toEqual([]);
  });
});
