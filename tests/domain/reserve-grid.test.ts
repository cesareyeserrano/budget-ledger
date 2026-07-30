/**
 * Feature transferencias (Reservas) — EP-04 (capa de dominio de la grilla).
 * FR-1003 (editar la celda = operar el saldo: A→B por dos ediciones, preview de efectos derivados)
 * y FR-1008 (el plan AVISA y GUARDA; los planos no se contaminan; el delta ancla al real previo).
 */
import { describe, it, expect } from "vitest";
import {
  applyReserveCellEdit,
  planTechoMonths,
  reserveDelta,
  resolvedBalance,
  resolvedTypeTotal,
  validateReserveWrite,
} from "@/domain/reserve";
import type { AmountMap, LedgerNode, LedgerState, MonthKey, NodeType } from "@/domain/types";

interface LeafSpec {
  id: string;
  type: NodeType;
  budget?: Partial<Record<MonthKey, number>>;
  actual?: Partial<Record<MonthKey, number>>;
}

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
    nodes.push({ id: l.id, ownerId: "local", type: l.type, level: "category", parentId: `g-${l.type}`, name: l.id, icon: null, order: i });
    if (l.budget) budgets[l.id] = { ...l.budget };
    if (l.actual) actuals[l.id] = { ...l.actual };
  });
  return { ownerId: "local", nodes, budgets, actuals, movements: [] };
}

describe("FR-1003 · editar la celda = operar el saldo", () => {
  it("TC-TRF-203e: A→B por dos ediciones con margen 0: bajar primero pasa, subir primero bloquea", () => {
    // @aitri-tc TC-TRF-203e
    // margen del mes = 0: el ingreso de enero financió los saldos iniciales y no queda nada.
    const base = makeState([
      { id: "c-ingreso", type: "income", actual: { ene: 1_000_000 } },
      { id: "c-viaje", type: "transfer", actual: { ene: 200_000 } },
      { id: "c-fondo", type: "transfer", actual: { ene: 800_000 } },
    ]);
    const totalBefore = resolvedTypeTotal(base, "may", "actual");

    // Secuencia 1: bajar Viaje primero (el retiro financia el aporte).
    const down = applyReserveCellEdit(base, { leafId: "c-viaje", month: "may", plane: "actual", newBalance: 100_000 });
    expect("state" in down).toBe(true);
    if (!("state" in down)) return;
    const up = applyReserveCellEdit(down.state, { leafId: "c-fondo", month: "may", plane: "actual", newBalance: 900_000 });
    expect("state" in up).toBe(true);
    if (!("state" in up)) return;
    expect(resolvedTypeTotal(up.state, "may", "actual")).toBe(totalBefore); // Σ saldos idéntico
    expect(up.state.movements).toHaveLength(2); // dos movimientos honestos en el journal (9.8)

    // Secuencia 2 (estado fresco): subir Fondo primero — el techo global bloquea con limit=0.
    const upFirst = applyReserveCellEdit(base, { leafId: "c-fondo", month: "may", plane: "actual", newBalance: 900_000 });
    expect("rejected" in upFirst).toBe(true);
    if (!("rejected" in upFirst) || upFirst.rejected === "invalid_target") return;
    expect(upFirst.rejected.ok).toBe(false);
    if (upFirst.rejected.ok) return;
    expect(upFirst.rejected.rule).toBe("techo");
    expect(upFirst.rejected.limit).toBe(0);
    // ningún estado intermedio inválido persiste: el estado base quedó intacto
    expect(resolvedBalance(base, "c-fondo", "may", "actual")).toBe(800_000);
  });

  it("TC-TRF-303e: editar julio con agosto explícito produce la preview del delta derivado nombrando el mes", () => {
    // @aitri-tc TC-TRF-303e
    const s = makeState([
      { id: "c-ingreso", type: "income", actual: { jul: 300_000 } },
      { id: "c-viaje", type: "transfer", actual: { jul: 200_000, ago: 200_000 } }, // delta de ago = 0
    ]);

    const verdict = validateReserveWrite(s, { leafId: "c-viaje", month: "jul", plane: "actual", newBalance: 150_000 });

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    // La UI puede decir "esto convierte agosto en un aporte de 50.000" ANTES de aplicar.
    expect(verdict.derived).toEqual([{ leafId: "c-viaje", month: "ago", delta: 50_000 }]);
    // Sin confirmación no se aplica nada: validate no muta.
    expect(s.actuals["c-viaje"]).toEqual({ jul: 200_000, ago: 200_000 });
  });
});

describe("FR-1008 · el plano Pres. planea saldos y solo AVISA", () => {
  it("TC-TRF-108h: el plan que viola el techo AVISA y GUARDA", () => {
    // @aitri-tc TC-TRF-108h
    // Sin ingresos planeados, el margen planeado de marzo es 0: cualquier aporte del plan lo supera.
    const s = makeState([{ id: "c-viaje", type: "transfer" }]);

    const verdict = validateReserveWrite(s, { leafId: "c-viaje", month: "mar", plane: "budget", newBalance: 100_000 });
    expect(verdict.ok).toBe(true); // ninguna edición de Pres. se bloquea
    if (!verdict.ok) return;
    expect(verdict.warnings.some((w) => w.month === "mar" && w.rule === "techo")).toBe(true);

    const applied = applyReserveCellEdit(s, { leafId: "c-viaje", month: "mar", plane: "budget", newBalance: 100_000 });
    expect("state" in applied).toBe(true);
    if (!("state" in applied)) return;
    expect(applied.state.budgets["c-viaje"].mar).toBe(100_000); // el valor SE GUARDA
    expect(applied.movement).toBeNull(); // el plan no journaliza
    // Y el estado del plan marca el mes para la celda (la marca «!» + ámbar de la grilla).
    expect(planTechoMonths(applied.state).mar).toBeDefined();
  });

  it("TC-TRF-108f: los planos no se contaminan y el delta del plan ancla al real previo", () => {
    // @aitri-tc TC-TRF-108f
    const s = makeState([
      { id: "c-ingreso", type: "income", actual: { jul: 300_000 } },
      { id: "c-viaje", type: "transfer", actual: { jul: 200_000 }, budget: { ene: 50_000 } },
    ]);

    // Editar el PLAN no toca el Ejecutado…
    const plan = applyReserveCellEdit(s, { leafId: "c-viaje", month: "ago", plane: "budget", newBalance: 250_000 });
    if (!("state" in plan)) throw new Error("el plan jamás bloquea");
    expect(plan.state.actuals["c-viaje"]).toEqual({ jul: 200_000 });
    // …y el delta del plan de agosto ancla al saldo REAL de julio (ADR-03): 250.000 − 200.000.
    expect(reserveDelta(plan.state, "ago", "budget")).toBe(50_000);

    // Editar el Ejecutado no toca el plan.
    const real = applyReserveCellEdit(plan.state, { leafId: "c-viaje", month: "sep", plane: "actual", newBalance: 150_000 });
    if (!("state" in real)) throw new Error("retiro válido rechazado");
    expect(real.state.budgets["c-viaje"]).toEqual({ ene: 50_000, ago: 250_000 });
  });
});
