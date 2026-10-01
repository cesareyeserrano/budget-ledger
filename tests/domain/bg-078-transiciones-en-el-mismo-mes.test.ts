/**
 * BG-078 (b) — dos cambios de día de pago en el mismo mes no repiten la clave de transición.
 *
 * Un mes tiene dos claves: la suya («2026-10») y la de transición («2026-10t»). Pasar del día 21 al 25
 * y, ese mismo mes, del 25 al 28 deja DOS tramos de transición que terminan en octubre, y los dos
 * recibían «2026-10t»: dos columnas con la misma clave, y una fecha del primer tramo resolvía a una
 * clave cuyo rango era el del segundo. Ahora los dos tramos son una sola transición.
 */
import { describe, it, expect } from "vitest";
import { buildCalendar, planVersionChange } from "@/domain/cycles";
import type { CycleConfig, CycleVersion, PeriodKey } from "@/domain/types";

const BOUNDS = { from: "2026-01" as PeriodKey, to: "2027-12" as PeriodKey };
const v = (seq: number, anchorDay: number, firstPay: string | null): CycleVersion => ({
  seq, mode: "cycle", anchorDay, eomPolicy: "last_day", effectiveFrom: firstPay ?? "2026-01-01", firstPay,
  restoreStartMonth: firstPay === null ? "2026-01" : null, createdAt: `${firstPay ?? "2026-01-01"}T00:00:00.000Z`,
});
/** Día 21 → día 25 (primer pago 25-oct) → día 28 (primer pago 28-oct). */
const TRES: CycleConfig = { mode: "cycle", versions: [v(1, 21, null), v(2, 25, "2026-10-25"), v(3, 28, "2026-10-28")] };
const UNA: CycleConfig = { mode: "cycle", versions: [v(1, 21, null), v(2, 25, "2026-10-25")] };

const dias = (desde: string, hasta: string): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${hasta}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

describe("BG-078 (b) · dos transiciones en el mismo mes", () => {
  it("BG-078b: quedan fundidas en una sola transición, del 21 al 27 de octubre", () => {
    const cal = buildCalendar(TRES, BOUNDS);
    expect(cal.rangeOf("2026-10t" as PeriodKey)).toEqual({ start: "2026-10-21", end: "2026-10-27" });
    expect(cal.isTransition("2026-10t" as PeriodKey)).toBe(true);
    expect(cal.rangeOf("2026-10" as PeriodKey)).toEqual({ start: "2026-09-21", end: "2026-10-20" });
    expect(cal.rangeOf("2026-11" as PeriodKey)).toEqual({ start: "2026-10-28", end: "2026-11-27" });
  });

  it("BG-078b: ninguna clave se repite y cada ciclo empieza donde termina el anterior", () => {
    const cal = buildCalendar(TRES, BOUNDS);
    const claves = cal.keys("2026-01" as PeriodKey, "2027-12" as PeriodKey);
    expect(new Set(claves).size).toBe(claves.length);
    const entradas = cal.entries();
    for (let i = 1; i < entradas.length; i++) {
      const finAnterior = new Date(Date.parse(`${entradas[i - 1]!.end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      expect(entradas[i]!.start, entradas[i]!.key).toBe(finAnterior);
      expect(cal.prev(entradas[i]!.key), entradas[i]!.key).not.toBe(entradas[i]!.key);
    }
  });

  it("BG-078b: toda fecha resuelve a una clave cuyo rango la contiene", () => {
    const cal = buildCalendar(TRES, BOUNDS);
    for (const dia of dias("2026-09-01", "2026-12-31")) {
      const r = cal.rangeOf(cal.periodForDate(`${dia}T12:00`))!;
      expect(r.start <= dia && dia <= r.end, dia).toBe(true);
    }
    expect(cal.periodForDate("2026-10-22T12:00")).toBe("2026-10t");
    expect(cal.periodForDate("2026-10-26T12:00")).toBe("2026-10t");
  });

  it("BG-078b: con un solo cambio de día el calendario es el de siempre (control)", () => {
    const cal = buildCalendar(UNA, BOUNDS);
    expect(cal.rangeOf("2026-10t" as PeriodKey)).toEqual({ start: "2026-10-21", end: "2026-10-24" });
    expect(cal.rangeOf("2026-11" as PeriodKey)).toEqual({ start: "2026-10-25", end: "2026-11-24" });
  });

  it("BG-078b: si la primera transición ya está CERRADA, el segundo cambio no puede estirarla", () => {
    const ctx = { todayISO: "2026-10-26", restoreStartMonth: null, bounds: BOUNDS };
    const destino = { mode: "cycle", anchorDay: 28, eomPolicy: "last_day", firstPayDate: "2026-10-28" } as const;
    // Cerrado hasta el 24 de octubre (el fin de la transición 21–24): fundir le añadiría 25–27.
    expect(planVersionChange(UNA, destino, { ...ctx, closedEnd: "2026-10-24" })).toMatchObject({ blocked: "first_pay_invalid" });
    // Cerrado solo hasta el 20: la transición sigue abierta y el cambio se acepta.
    expect(planVersionChange(UNA, destino, { ...ctx, closedEnd: "2026-10-20" })).toMatchObject({ change: "version" });
    expect(planVersionChange(UNA, destino, { ...ctx, closedEnd: null })).toMatchObject({ change: "version" });
  });
});
