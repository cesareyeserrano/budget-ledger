/**
 * Feature transferencias · modelo v4 — FR-1008 (el plan de aportes avisa sin bloquear) y
 * FR-1015 (retiros planeados con techo lógico).
 */
import { describe, it, expect } from "vitest";
import { applyReserveCellEdit, plannedRetiroLimit, planTechoMonths, RETIROS_PLAN_ID, reserveRetiros, setPlannedRetiro, validateReserveWrite } from "@/domain/reserve";
import type { AmountMap, LedgerNode, LedgerState, PeriodKey, NodeType } from "@/domain/types";
import { P } from "../helpers/periods";

interface LeafSpec { id: string; type: NodeType; budget?: Partial<Record<PeriodKey, number>>; actual?: Partial<Record<PeriodKey, number>> }
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

    const verdict = validateReserveWrite(s, { leafId: "c-viaje", period: "2026-03", plane: "budget", newAmount: 100_000 }, P);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.warnings.some((w) => w.period === "2026-03" && w.rule === "techo")).toBe(true);

    const applied = applyReserveCellEdit(s, { leafId: "c-viaje", period: "2026-03", plane: "budget", newAmount: 100_000 }, P);
    if (!("state" in applied)) throw new Error("el plan jamás bloquea aportes");
    expect(applied.state.budgets["c-viaje"]["2026-03"]).toBe(100_000);
    expect(planTechoMonths(applied.state, P)["2026-03"]).toBeDefined(); // la marca «!» de la celda
  });

  it("TC-TRF4-008f: los planos no se contaminan", () => {
    // @aitri-tc TC-TRF4-008f
    const s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-07": 300_000 } }, { id: "c-viaje", type: "transfer", actual: { "2026-07": 200_000 }, budget: { "2026-01": 50_000 } }]);
    const plan = applyReserveCellEdit(s, { leafId: "c-viaje", period: "2026-08", plane: "budget", newAmount: 80_000 }, P);
    if (!("state" in plan)) throw new Error("plan rechazado");
    expect(plan.state.actuals["c-viaje"]).toEqual({ "2026-07": 200_000 });
    const real = applyReserveCellEdit(plan.state, { leafId: "c-viaje", period: "2026-09", plane: "actual", newAmount: 10_000 }, P);
    if (!("state" in real)) throw new Error("edición real rechazada");
    expect(real.state.budgets["c-viaje"]).toEqual({ "2026-01": 50_000, "2026-08": 80_000 });
  });
});

describe("FR-1015 · retiros planeados con techo lógico", () => {
  it("TC-TRF4-015h: el retiro planeado respeta el techo lógico acumulativo del plan", () => {
    // @aitri-tc TC-TRF4-015h
    const s = makeState([{ id: "c-viaje", type: "transfer", budget: { "2026-01": 100_000, "2026-02": 100_000 } }]);
    expect(plannedRetiroLimit(s, "2026-02", P)).toBe(200_000);

    const over = setPlannedRetiro(s, "2026-02", 250_000, P);
    expect(over).toEqual({ rejected: { limit: 200_000 } });

    const ok = setPlannedRetiro(s, "2026-02", 150_000, P);
    if (!("state" in ok)) throw new Error("retiro planeado válido rechazado");
    expect(reserveRetiros(ok.state, "2026-02", "budget")).toBe(150_000);
    expect(plannedRetiroLimit(ok.state, "2026-03", P)).toBe(50_000); // acumulativo
  });

  it("TC-TRF4-015f: planear un retiro sobre el límite rechaza sin mutar", () => {
    // @aitri-tc TC-TRF4-015f
    const s = makeState([{ id: "c-viaje", type: "transfer", budget: { "2026-01": 200_000 } }]);
    const frozen = JSON.parse(JSON.stringify(s));

    expect("rejected" in setPlannedRetiro(s, "2026-03", 200_001, P)).toBe(true);
    const invalid1 = setPlannedRetiro(s, "2026-03", -5, P);
    const invalid2 = setPlannedRetiro(s, "2026-03", Number("nope"), P);
    expect("state" in invalid1 && invalid1.state === s).toBe(true); // no-op
    expect("state" in invalid2 && invalid2.state === s).toBe(true);
    expect(s).toEqual(frozen);
    expect(s.budgets[RETIROS_PLAN_ID]).toBeUndefined();
  });
});
