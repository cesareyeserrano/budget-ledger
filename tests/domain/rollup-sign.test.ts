import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain";
import { rollupActual, rollupBudget } from "@/domain/rollup";
import { setLeafAmount } from "@/domain/mutations";
import { signOf, varianceOf } from "@/domain/sign";
import { leafDescendants } from "@/domain/tree";
import { P, P0 } from "../helpers/periods";

describe("FR-004 roll-up", () => {
  // @aitri-tc TC-004h
  it("TC-004h: Ejecutado de categoría = suma de sus subcategorías", () => {
    let s = buildSeed("local", P0);
    // 'Comida' tiene 3 subs: mercado/restaurantes/cafe → fijar actuals mar 100/200/300
    s = setLeafAmount(s, "s-comida-mercado", "2026-03", "actual", 100, P);
    s = setLeafAmount(s, "s-comida-restaurantes", "2026-03", "actual", 200, P);
    s = setLeafAmount(s, "s-comida-cafe", "2026-03", "actual", 300, P);
    expect(rollupActual(s, "c-comida", "2026-03")).toBe(600);
    // sube al grupo Esenciales
    expect(rollupActual(s, "g-esenciales", "2026-03")).toBeGreaterThanOrEqual(600);
  });

  // @aitri-tc TC-004e
  it("TC-004e: Ejecutado directo en categoría-hoja se cuenta en el grupo", () => {
    let s = buildSeed("local", P0);
    // 'Transporte' es categoría-hoja
    s = setLeafAmount(s, "c-transporte", "2026-04", "actual", 120000, P);
    const groupActual = rollupActual(s, "g-esenciales", "2026-04");
    expect(groupActual).toBeGreaterThanOrEqual(120000);
  });

  // @aitri-tc TC-004f
  it("TC-004f: Presupuestado del padre === suma de hojas (invariante, sin setter de padre)", () => {
    let s = buildSeed("local", P0);
    s = setLeafAmount(s, "s-comida-mercado", "2026-01", "budget", 500, P);
    s = setLeafAmount(s, "s-comida-restaurantes", "2026-01", "budget", 300, P);
    s = setLeafAmount(s, "s-comida-cafe", "2026-01", "budget", 200, P);
    const leaves = leafDescendants(s.nodes, "c-comida");
    const sum = leaves.reduce((a, id) => a + (s.budgets[id]?.["2026-01"] ?? 0), 0);
    expect(rollupBudget(s, "c-comida", "2026-01")).toBe(sum);
    // editar un padre (no hoja) no altera nada (no hay distribución)
    const before = JSON.stringify(s.budgets);
    const s2 = setLeafAmount(s, "c-comida", "2026-01", "budget", 9999, P);
    expect(JSON.stringify(s2.budgets)).toBe(before);
  });
});

describe("FR-008 signo y varianza", () => {
  // @aitri-tc TC-008h
  it("TC-008h: Gasto Ejec>Pres → 'over'", () => {
    expect(varianceOf("expense", 100000, 130000)).toBe("over");
    expect(signOf("expense")).toBe("−");
  });

  // @aitri-tc TC-008e
  it("TC-008e: Ingreso >= pres → favorable; < pres → under", () => {
    expect(varianceOf("income", 100000, 100000)).toBe("favorable");
    expect(varianceOf("income", 100000, 80000)).toBe("under");
    expect(signOf("income")).toBe("+");
  });

  // @aitri-tc TC-008f
  it("TC-008f: Transferencia siempre neutral", () => {
    expect(varianceOf("transfer", 100000, 500000)).toBe("neutral");
    expect(varianceOf("transfer", 500000, 100000)).toBe("neutral");
    expect(signOf("transfer")).toBe("↔");
  });
});
