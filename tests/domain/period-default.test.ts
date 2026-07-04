import { describe, it, expect } from "vitest";
import { useLedgerStore } from "@/state/store";

// Feature grid-ux — FR-106: el período por defecto muestra datos ejecutados (no un mes proyectado en $0).

describe("FR-106 período por defecto", () => {
  it("TC-206e: el período inicial del store es {mode:'year'}", () => {
    const { period } = useLedgerStore.getState();
    expect(period.mode).toBe("year");
  });
});
