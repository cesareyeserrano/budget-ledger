/**
 * Feature transferencias · modelo v4 — FR-1008 (el plan de aportes avisa sin bloquear) y
 * FR-1015 (retiros planeados con techo lógico).
 */
import { describe, it, expect } from "vitest";
import { applyReserveCellEdit, plannedRetiroLimit, planTechoMonths, RETIROS_PLAN_ID, reserveRetiros, setPlannedRetiro, validateReserveWrite } from "@/domain/reserve";
import type { AmountMap, LedgerNode, LedgerState, MonthKey, NodeType } from "@/domain/types";

interface LeafSpec { id: string; type: NodeType; budget?: Partial<Record<MonthKey, number>>; actual?: Partial<Record<MonthKey, number>> }
function makeState(leaves: LeafSpec[]): LedgerState {
  const nodes: LedgerNode[] = []; const budgets: AmountMap = {}; const actuals: AmountMap = {}; const seen = new Set<NodeType>();
  leaves.forEach((l, i) => {
    if (!seen.has(l.type)) { seen.add(l.type); nodes.push({ id: `g-${l.type}`, ownerId: "local", type: l.type, level: "group", parentId: null, name: `Grupo ${l.type}`, icon: null, order: 0 }); }
    nodes.push({ id: l.id, ownerId: "local", type: l.type, level: "category", parentId: `g-${l.type}`, name: l.id, icon: null, order: i });
    if (l.budget) budgets[l.id] = { ...l.budget };
    if (l.actual) actuals[l.id] = { ...l.actual };
  });
  return { ownerId: "local", nodes, budgets, actuals, movements: [] };
}

describe("FR-1008 · el plan de aportes AVISA sin bloquear", () => {
  it("TC-TRF4-008h: el aporte planeado que viola el techo AVISA y GUARDA", () => {
    // @aitri-tc TC-TRF4-008h
    const s = makeState([{ id: "c-viaje", type: "transfer" }]);

    const verdict = validateReserveWrite(s, { leafId: "c-viaje", month: "mar", plane: "budget", newAmount: 100_000 });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.warnings.some((w) => w.month === "mar" && w.rule === "techo")).toBe(true);

    const applied = applyReserveCellEdit(s, { leafId: "c-viaje", month: "mar", plane: "budget", newAmount: 100_000 });
    if (!("state" in applied)) throw new Error("el plan jamás bloquea aportes");
    expect(applied.state.budgets["c-viaje"].mar).toBe(100_000);
    expect(planTechoMonths(applied.state).mar).toBeDefined(); // la marca «!» de la celda
  });

  it("TC-TRF4-008f: los planos no se contaminan", () => {
    // @aitri-tc TC-TRF4-008f
    const s = makeState([{ id: "c-ingreso", type: "income", actual: { jul: 300_000 } }, { id: "c-viaje", type: "transfer", actual: { jul: 200_000 }, budget: { ene: 50_000 } }]);
    const plan = applyReserveCellEdit(s, { leafId: "c-viaje", month: "ago", plane: "budget", newAmount: 80_000 });
    if (!("state" in plan)) throw new Error("plan rechazado");
    expect(plan.state.actuals["c-viaje"]).toEqual({ jul: 200_000 });
    const real = applyReserveCellEdit(plan.state, { leafId: "c-viaje", month: "sep", plane: "actual", newAmount: 10_000 });
    if (!("state" in real)) throw new Error("edición real rechazada");
    expect(real.state.budgets["c-viaje"]).toEqual({ ene: 50_000, ago: 80_000 });
  });
});

describe("FR-1015 · retiros planeados con techo lógico", () => {
  it("TC-TRF4-015h: el retiro planeado respeta el techo lógico acumulativo del plan", () => {
    // @aitri-tc TC-TRF4-015h
    const s = makeState([{ id: "c-viaje", type: "transfer", budget: { ene: 100_000, feb: 100_000 } }]);
    expect(plannedRetiroLimit(s, "feb")).toBe(200_000);

    const over = setPlannedRetiro(s, "feb", 250_000);
    expect(over).toEqual({ rejected: { limit: 200_000 } });

    const ok = setPlannedRetiro(s, "feb", 150_000);
    if (!("state" in ok)) throw new Error("retiro planeado válido rechazado");
    expect(reserveRetiros(ok.state, "feb", "budget")).toBe(150_000);
    expect(plannedRetiroLimit(ok.state, "mar")).toBe(50_000); // acumulativo
  });

  it("TC-TRF4-015f: planear un retiro sobre el límite rechaza sin mutar", () => {
    // @aitri-tc TC-TRF4-015f
    const s = makeState([{ id: "c-viaje", type: "transfer", budget: { ene: 200_000 } }]);
    const frozen = JSON.parse(JSON.stringify(s));

    expect("rejected" in setPlannedRetiro(s, "mar", 200_001)).toBe(true);
    const invalid1 = setPlannedRetiro(s, "mar", -5);
    const invalid2 = setPlannedRetiro(s, "mar", Number("nope"));
    expect("state" in invalid1 && invalid1.state === s).toBe(true); // no-op
    expect("state" in invalid2 && invalid2.state === s).toBe(true);
    expect(s).toEqual(frozen);
    expect(s.budgets[RETIROS_PLAN_ID]).toBeUndefined();
  });
});
