import { describe, it, expect, vi, afterEach } from "vitest";

// Feature ux-consistency — FR-312 SUPERSEDE el default 'Año' de grid-ux (FR-106): el período por
// defecto pasa a ser el MES EN CURSO (reloj). TC-206e se actualiza a la nueva conducta.
// La cobertura completa de FR-312 vive en TC-UXC-312h/e/f (unit + e2e) — aquí no se duplican ids.

async function freshStorePeriod() {
  vi.resetModules();
  const { useLedgerStore } = await import("@/state/store");
  return useLedgerStore.getState().period;
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("FR-312 período por defecto = mes en curso", () => {
  it("TC-206e: el período inicial del store es el mes en curso (no 'Año')", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8)); // julio
    const period = await freshStorePeriod();
    expect(period.mode).toBe("month");
    expect(period).toEqual({ mode: "month", month: "jul" });
  });

});
