/**
 * Feature transferencias · modelo v4 — FR-1011: reestructurar el árbol conserva los saldos
 * DERIVADOS (los movimientos de reserva siguen a las celdas).
 */
import { describe, it, expect } from "vitest";
import { AVAILABLE_ID, applyReserveOp, resolvedBalance } from "@/domain/reserve";
import { moveNode } from "@/domain/mutations";
import { MONTH_KEYS } from "@/domain/months";
import { resolvedYearByMonth } from "../helpers/totals";
import type { AmountMap, LedgerNode, LedgerState, MonthKey } from "@/domain/types";

function makeState(): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-i", ownerId: "local", type: "income", level: "group", parentId: null, name: "T", icon: null, order: 0 },
    { id: "c-sal", ownerId: "local", type: "income", level: "category", parentId: "g-i", name: "Salario", icon: null, order: 1 },
    { id: "g-a", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro A", icon: null, order: 2 },
    { id: "c-alcancia", ownerId: "local", type: "transfer", level: "category", parentId: "g-a", name: "Alcancía", icon: null, order: 3 },
    { id: "g-b", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro B", icon: null, order: 4 },
    { id: "c-dest", ownerId: "local", type: "transfer", level: "category", parentId: "g-b", name: "Destino", icon: null, order: 5 },
  ];
  const budgets: AmountMap = {};
  const actuals: AmountMap = { "c-sal": { ene: 1_000_000 } };
  return { ownerId: "local", nodes, budgets, actuals, movements: [] };
}

/** Alcancía con aportes Y retiros — la fixture donde el journal importa. */
function seeded(): LedgerState {
  let s = makeState();
  const g = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-alcancia", month: "feb", amount: 300_000 });
  if (!("state" in g)) throw new Error("guardar rechazado");
  s = g.state;
  const r = applyReserveOp(s, { from: "c-alcancia", to: AVAILABLE_ID, month: "sep", amount: 120_000 });
  if (!("state" in r)) throw new Error("sacar rechazado");
  const d = applyReserveOp(r.state, { from: AVAILABLE_ID, to: "c-dest", month: "may", amount: 50_000 });
  if (!("state" in d)) throw new Error("guardar destino rechazado");
  return d.state;
}

describe("FR-1011 · reestructurar conserva los saldos derivados", () => {
  it("TC-TRF4-011h: reparent + promote + demote conservan Σ derivado en los 12 meses", () => {
    // @aitri-tc TC-TRF4-011h
    const s0 = seeded();
    const before = resolvedYearByMonth(s0, "actual");

    const r1 = moveNode(s0, "c-alcancia", { kind: "category", id: "c-dest" }); // reparent (fusión FR-604)
    if (!("state" in r1)) throw new Error("reparent rechazado");
    expect(resolvedYearByMonth(r1.state, "actual")).toEqual(before);

    const r2 = moveNode(r1.state, "c-alcancia", { kind: "root", type: "transfer" }); // promote
    if (!("state" in r2)) throw new Error("promote rechazado");
    expect(resolvedYearByMonth(r2.state, "actual")).toEqual(before);

    const r3 = moveNode(r2.state, "c-alcancia", { kind: "group", id: "g-a" }); // demote a grupo
    if (!("state" in r3)) throw new Error("demote rechazado");
    expect(resolvedYearByMonth(r3.state, "actual")).toEqual(before);
  });

  it("TC-TRF4-011e: el helper de conservación cubre el invariante y una cadena de reestructuras lo mantiene", () => {
    // @aitri-tc TC-TRF4-011e
    const s0 = seeded();
    const before = resolvedYearByMonth(s0, "actual");
    // el helper ES la aserción del invariante: serie por mes de saldos derivados del tipo
    expect(before.sep).toBe(300_000 - 120_000 + 50_000);
    let s = s0;
    for (const step of [
      () => moveNode(s, "c-alcancia", { kind: "category", id: "c-dest" }),
      () => moveNode(s, "c-alcancia", { kind: "root", type: "transfer" }),
      () => moveNode(s, "c-dest", { kind: "group", id: "g-a" }),
    ]) {
      const r = step();
      if (!("state" in r)) throw new Error("paso rechazado");
      s = r.state;
      expect(resolvedYearByMonth(s, "actual")).toEqual(before);
    }
  });

  it("TC-TRF4-011f: el invariante detecta la fusión corrupta (celdas sin journal re-apuntado)", () => {
    // @aitri-tc TC-TRF4-011f
    const s0 = seeded();
    const before = resolvedYearByMonth(s0, "actual");

    // El bug adversarial reconstruido a mano: las celdas se trasladan pero el retiro queda
    // desanclado (from apuntando a un id que ya no es la hoja) — el saldo "renace" sin su retiro.
    const corrupt: LedgerState = {
      ...s0,
      movements: s0.movements.map((m) => (m.from === "c-alcancia" ? { ...m, from: "c-fantasma" } : m)),
    };
    const after = resolvedYearByMonth(corrupt, "actual");
    expect(after.sep).toBe(350_000); // la fuga: el retiro de 120.000 desapareció
    expect(after).not.toEqual(before); // el invariante la DETECTA

    // …y el camino real de moveNode la mantiene idéntica (el test que falla si alguien lo rompe).
    const real = moveNode(s0, "c-alcancia", { kind: "category", id: "c-dest" });
    if (!("state" in real)) throw new Error("reparent rechazado");
    expect(resolvedYearByMonth(real.state, "actual")).toEqual(before);
  });
});
