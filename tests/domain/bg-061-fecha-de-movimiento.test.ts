/**
 * BG-061 — la fecha de un movimiento tiene que ser un día que existe, con hora opcional.
 */
import { describe, it, expect } from "vitest";
import { isMovementDate } from "@/domain/validation";

describe("isMovementDate", () => {
  it("acepta los formatos que la app escribe", () => {
    for (const ok of ["2026-09-10", "2026-09-10T12:00", "2026-09-10T12:00:30", "2026-09-10T17:00:00.000Z", "2026-09-21T10:00:00-05:00", "2028-02-29T09:00"]) {
      expect(isMovementDate(ok), ok).toBe(true);
    }
  });
  it("rechaza días que no existen, horas imposibles y texto colado", () => {
    for (const mal of ["2026-09-31", "2026-09-99", "2026-02-29T09:00", "2026-09-05 almuerzo", "2026-09-10T25:00", "2026-09", "", "2026-09-10T12:00 "]) {
      expect(isMovementDate(mal), mal).toBe(false);
    }
  });
});
