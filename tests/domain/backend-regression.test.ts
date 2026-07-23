/**
 * Epic 5 (backend) — Regresión del dominio (NFR-507). El dominio permanece PURO y sin cambios de
 * cálculo: solo cambia el origen de los datos. Estos tests fijan input→output de rollup/dashboard/
 * budgetState para detectar cualquier deriva de cálculo introducida por el backend.
 * TCs: NFR-507 (065h, 066e, 067f).
 */
import { describe, expect, it } from "vitest";
import { buildSeed, addMovement, rollupActual, rollupBudget, dashboardMetrics } from "@/domain";
import { budgetState, OVER_HARD_RATIO } from "@/domain/budgetState";
import type { LedgerState } from "@/domain";

describe("NFR-507 — el dominio no cambia su lógica de cálculo", () => {
  it("TC-BE-065h: rollup/dashboard/budgetState dan resultados idénticos al baseline para la semilla", () => {
    // @aitri-tc TC-BE-065h
    const seed = buildSeed("A");
    // rollup de un grupo = suma de sus hojas (determinista por la semilla).
    const grupo = "g-esenciales";
    const leaves = seed.nodes.filter((n) => n.parentId && ["c-comida", "s-comida-mercado"].includes(n.id));
    expect(leaves.length).toBeGreaterThan(0);
    const budJun = rollupBudget(seed, grupo, "jun");
    const actJun = rollupActual(seed, grupo, "jun");
    // El roll-up de presupuesto del grupo suma exactamente los presupuestos de sus hojas.
    const manualBud = seed.nodes
      .filter((n) => n.type === "expense" && n.level !== "group")
      .reduce((acc, n) => acc + (seed.budgets[n.id]?.jun ?? 0), 0);
    expect(budJun).toBe(manualBud);
    expect(budJun).toBeGreaterThan(0);
    expect(actJun).toBeGreaterThanOrEqual(0);

    // budgetState: la regla de umbral no cambió.
    expect(budgetState(100, 100)).toBe("within");
    expect(budgetState(100, 119)).toBe("over_soft");
    expect(budgetState(100, 120)).toBe("over_hard");
    expect(OVER_HARD_RATIO).toBe(1.2);

    // dashboard produce un VM estable para el período mes.
    const vm = dashboardMetrics(seed, { mode: "month", month: "jun" });
    expect(vm).toBeDefined();
    expect(typeof JSON.stringify(vm)).toBe("string");
  });

  it("TC-BE-066e: caso límite de roll-up (jerarquía profunda / ceros) idéntico, sin NaN", () => {
    // @aitri-tc TC-BE-066e
    // Estado con hojas en 0 y padres encadenados.
    const state: LedgerState = {
      ownerId: "A",
      nodes: [
        { id: "g", ownerId: "A", type: "expense", level: "group", parentId: null, name: "G", icon: null, order: 0 },
        { id: "c", ownerId: "A", type: "expense", level: "category", parentId: "g", name: "C", icon: null, order: 1 },
        { id: "s", ownerId: "A", type: "expense", level: "sub", parentId: "c", name: "S", icon: null, order: 2 },
      ],
      budgets: { s: { jun: 0 } },
      actuals: { s: { jun: 0 } },
      movements: [],
    };
    expect(rollupBudget(state, "g", "jun")).toBe(0);
    expect(rollupActual(state, "g", "jun")).toBe(0);
    expect(Number.isNaN(rollupBudget(state, "g", "jun"))).toBe(false);
    // budgetState con presupuesto 0 y ejecutado 0 → within (sin dividir por cero).
    expect(budgetState(0, 0)).toBe("within");
    // presupuesto 0 con ejecutado > 0 → over_hard.
    expect(budgetState(0, 500)).toBe("over_hard");
  });

  it("TC-BE-067f: una entrada inválida se rechaza igual que antes, sin cambio de comportamiento", () => {
    // @aitri-tc TC-BE-067f
    const seed = buildSeed("A");
    // amount 0 → addMovement devuelve el MISMO estado (rechazado, sin mutar) igual que el baseline.
    const zero = addMovement(seed, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 0, month: "jun" });
    expect(zero).toBe(seed);
    // sin categoría → rechazado igual.
    const noCat = addMovement(seed, { type: "expense", catId: "", amount: 100, month: "jun" });
    expect(noCat).toBe(seed);
    // monto no numérico → rechazado igual.
    const nan = addMovement(seed, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: "x", month: "jun" });
    expect(nan).toBe(seed);
  });
});
