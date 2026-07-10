import { describe, it, expect } from "vitest";
import { budgetState, OVER_HARD_RATIO, type BudgetState } from "@/domain/budgetState";

// Feature budget-state-color — FR-401. La regla de umbral es aritmética pura, así que se ataca sin
// DOM en sus valores frontera exactos y en sus casos degenerados. El 120 % se DERIVA de
// OVER_HARD_RATIO en vez de escribirse a mano: si alguien mueve el umbral, estos tests lo delatan.
// Prefijo TC-BSC-*.

const STATES: BudgetState[] = ["within", "over_soft", "over_hard"];

describe("FR-401 · budgetState", () => {
  it("TC-BSC-401h: dentro del presupuesto (incluido el 100% exacto) el estado es 'within'", () => {
    // @aitri-tc TC-BSC-401h
    expect(budgetState(200_000, 120_000)).toBe("within"); // 60 %
    expect(budgetState(200_000, 200_000)).toBe("within"); // 100 % exacto — NO es ámbar
    // el 100 % es el ÚLTIMO valor neutro: un peso más ya es un desvío
    expect(budgetState(200_000, 200_001)).toBe("over_soft");
  });

  it("TC-BSC-401e: valores frontera exactos del umbral: 100 / 101 / 119 / 120 / 121 %", () => {
    // @aitri-tc TC-BSC-401e
    const B = 100_000; // el ejecutado en pesos coincide con el porcentaje × 1000
    const overHard = B * OVER_HARD_RATIO; // 120 000 — derivado, no escrito a mano

    expect(budgetState(B, 89_000)).toBe("within");
    expect(budgetState(B, 100_000)).toBe("within");
    expect(budgetState(B, 100_001)).toBe("over_soft");
    expect(budgetState(B, 119_000)).toBe("over_soft");
    expect(budgetState(B, overHard)).toBe("over_hard"); // 120 % — PRIMER valor rojo
    expect(budgetState(B, 121_000)).toBe("over_hard");

    // el rojo empieza exactamente en el umbral: un peso menos sigue siendo ámbar
    expect(budgetState(B, overHard - 1)).toBe("over_soft");
    expect(overHard).toBe(120_000);
  });

  it("TC-BSC-401f: casos degenerados: presupuesto 0, ejecutado 0 y negativos no producen NaN ni Infinity", () => {
    // @aitri-tc TC-BSC-401f
    expect(budgetState(0, 50_000)).toBe("over_hard"); // sin presupuesto y con gasto → el estado más grave
    expect(budgetState(0, 0)).toBe("within"); // 0/0 no es un desvío
    expect(budgetState(200_000, 0)).toBe("within"); // el em-dash atenuado lo resuelve la UI
    expect(budgetState(-100, 50)).toBe("over_hard"); // presupuesto negativo: el dominio no lo produce, la función lo soporta
    expect(budgetState(100, -50)).toBe("within"); // ejecutado negativo: sin consumo

    // ninguna llamada devuelve un valor fuera del enum, ni lanza
    for (const [b, a] of [[0, 50_000], [0, 0], [200_000, 0], [-100, 50], [100, -50], [-1, -1]]) {
      expect(() => budgetState(b, a)).not.toThrow();
      expect(STATES).toContain(budgetState(b, a));
    }
  });

  it("TC-BSC-411e: volumen de producción: 6.000 derivaciones (500 nodos × 12 meses) sin degradación ni NaN", () => {
    // @aitri-tc TC-BSC-411e
    // LCG determinista: mismo dataset en cada corrida, sin Math.random.
    let seed = 20260709;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000;

    const pairs: [number, number][] = [];
    for (let node = 0; node < 500; node++) {
      for (let month = 0; month < 12; month++) {
        // uno de cada siete nodos no tiene presupuesto: el caso que dividiría por cero
        const budget = node % 7 === 0 ? 0 : Math.round(next() * 900_000) + 10_000;
        pairs.push([budget, Math.round(next() * 1_400_000)]);
      }
    }
    expect(pairs).toHaveLength(6_000);

    const t0 = performance.now();
    const results = pairs.map(([b, a]) => budgetState(b, a));
    const elapsed = performance.now() - t0;

    expect(results).toHaveLength(6_000);
    expect(results.every((r) => STATES.includes(r))).toBe(true);
    expect(results.some((r) => r === "over_hard")).toBe(true); // el dataset ejerce los tres caminos
    expect(results.some((r) => r === "within")).toBe(true);
    expect(elapsed).toBeLessThan(50); // es una división por celda: la grilla lo hace en cada render
  });
});
