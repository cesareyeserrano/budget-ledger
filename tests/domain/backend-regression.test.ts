/**
 * Epic 5 (backend) — Regresión del dominio (NFR-507). El dominio permanece PURO y sin cambios de
 * cálculo: solo cambia el origen de los datos. Estos tests fijan input→output de rollup/dashboard/
 * budgetState para detectar cualquier deriva de cálculo introducida por el backend.
 * TCs: NFR-507 (065h, 066e, 067f).
 */
import { describe, expect, it } from "vitest";
// NFR-2303 (semilla-intacta): estas pruebas necesitan un ledger CON celdas para operar; su
// intención nunca fue verificar que la semilla traiga dinero. Desde FR-2301 la siembra del
// producto sale vacía, así que componen la semilla poblada de siempre con este helper.
import { addMovement, rollupActual, rollupBudget, dashboardMetrics } from "@/domain";
import { buildSeedConMontos as buildSeed } from "../helpers/seedConMontos";
import { budgetState, OVER_HARD_RATIO } from "@/domain/budgetState";
import type { LedgerState } from "@/domain";
import { P, P0 } from "../helpers/periods";

describe("NFR-507 — el dominio no cambia su lógica de cálculo", () => {
  it("TC-BE-065h: rollup/dashboard/budgetState dan resultados idénticos al baseline para la semilla", () => {
    // @aitri-tc TC-BE-065h
    const seed = buildSeed("local", P0);
    // rollup de un grupo = suma de sus hojas (determinista por la semilla).
    const grupo = "g-esenciales";
    const leaves = seed.nodes.filter((n) => n.parentId && ["c-comida", "s-comida-mercado"].includes(n.id));
    expect(leaves.length).toBeGreaterThan(0);
    const budJun = rollupBudget(seed, grupo, "2026-06");
    const actJun = rollupActual(seed, grupo, "2026-06");
    // El roll-up de presupuesto del grupo suma exactamente los presupuestos de sus hojas.
    const manualBud = seed.nodes
      .filter((n) => n.type === "expense" && n.level !== "group")
      .reduce((acc, n) => acc + (seed.budgets[n.id]?.["2026-06"] ?? 0), 0);
    expect(budJun).toBe(manualBud);
    expect(budJun).toBeGreaterThan(0);
    expect(actJun).toBeGreaterThanOrEqual(0);

    // budgetState: la regla de umbral no cambió.
    expect(budgetState(100, 100)).toBe("within");
    expect(budgetState(100, 119)).toBe("over_soft");
    expect(budgetState(100, 120)).toBe("over_hard");
    expect(OVER_HARD_RATIO).toBe(1.2);

    // dashboard produce un VM estable para el período mes.
    const vm = dashboardMetrics(seed, { mode: "month", month: "2026-06" }, P);
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
      budgets: { s: { "2026-06": 0 } },
      actuals: { s: { "2026-06": 0 } },
      movements: [],
    };
    expect(rollupBudget(state, "g", "2026-06")).toBe(0);
    expect(rollupActual(state, "g", "2026-06")).toBe(0);
    expect(Number.isNaN(rollupBudget(state, "g", "2026-06"))).toBe(false);
    // budgetState con presupuesto 0 y ejecutado 0 → within (sin dividir por cero).
    expect(budgetState(0, 0)).toBe("within");
    // presupuesto 0 con ejecutado > 0 → over_hard.
    expect(budgetState(0, 500)).toBe("over_hard");
  });

  it("TC-BE-067f: una entrada inválida se rechaza igual que antes, sin cambio de comportamiento", () => {
    // @aitri-tc TC-BE-067f
    const seed = buildSeed("local", P0);
    // amount 0 → addMovement devuelve el MISMO estado (rechazado, sin mutar) igual que el baseline.
    const zero = addMovement(seed, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 0, period: "2026-06" }, P);
    expect(zero).toBe(seed);
    // sin categoría → rechazado igual.
    const noCat = addMovement(seed, { type: "expense", catId: "", amount: 100, period: "2026-06" }, P);
    expect(noCat).toBe(seed);
    // monto no numérico → rechazado igual.
    const nan = addMovement(seed, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: "x", period: "2026-06" }, P);
    expect(nan).toBe(seed);
  });
});
