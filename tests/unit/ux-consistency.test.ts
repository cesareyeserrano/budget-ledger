import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSeed, addMovement, rollupActual, typeTotals } from "@/domain";

// Feature ux-consistency — TCs de lógica (node): mes en curso (FR-312), regresión de dominio (NFR-305)
// y bootstrap del estado (NFR-306). Los TCs visuales/UX viven en tests/e2e/ux-consistency.spec.ts.

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

async function freshStorePeriod() {
  vi.resetModules();
  const { useLedgerStore } = await import("@/state/store");
  return useLedgerStore.getState().period;
}

describe("FR-312 — arrancar en el mes en curso", () => {
  it("TC-UXC-312h: el period por defecto del store es { mode:'month', month: <mes del reloj> }", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8)); // julio (getMonth()===6)
    const period = await freshStorePeriod();
    expect(period.mode).toBe("month");
    expect(period).toEqual({ mode: "month", month: "jul" });
  });

  it("TC-UXC-312f: el default sigue al reloj (marzo→'mar') y nunca fija enero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15)); // marzo (getMonth()===2)
    const period = await freshStorePeriod();
    expect(period.mode === "month" && period.month).toBe("mar");
    expect(period).not.toEqual({ mode: "year" });
    expect(period.mode === "month" && period.month).not.toBe("ene");
  });
});

describe("NFR-305 — regresión de dominio (suite verde)", () => {
  it("TC-UXC-355f: guardar un movimiento suma a Ejecutado y a los roll-ups del periodo", () => {
    const seed = buildSeed("local");
    const next = addMovement(seed, { type: "expense", catId: "c-vivienda", subId: null, amount: 50000, month: "jul" });
    // addMovement devuelve un estado NUEVO (no la misma referencia) cuando el input es válido
    expect(next).not.toBe(seed);
    expect(rollupActual(next, "c-vivienda", "jul")).toBe(50000);
    // el roll-up por tipo del mes incluye el ejecutado nuevo
    expect(typeTotals(next, "expense", ["jul"]).actual).toBeGreaterThanOrEqual(50000);
  });
});

describe("NFR-306 — bootstrap del estado (la app monta)", () => {
  it("TC-UXC-356e: el store inicializa con datos semilla y un periodo válido, sin hidratar aún", async () => {
    vi.resetModules();
    const { useLedgerStore } = await import("@/state/store");
    const s = useLedgerStore.getState();
    expect(s.data.nodes.length).toBeGreaterThan(0);
    expect(s.hydrated).toBe(false);
    expect(["month", "year"]).toContain(s.period.mode);
  });
});
