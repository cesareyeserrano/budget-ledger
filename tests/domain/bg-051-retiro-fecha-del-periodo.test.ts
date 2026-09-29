/**
 * BG-051 — el retiro desde la grilla nace con una fecha DENTRO de la columna en que se hizo.
 *
 * Antes se sellaba con `new Date().toISOString()`: el momento presente y en UTC. En una columna que
 * no es el mes en curso la fecha caía fuera de su periodo, y en la columna del mes en curso también
 * a partir de las 19:00 del último día (UTC-5). El servidor rechaza el snapshot entero con 422
 * `period_mismatch` (`periodMismatches`, ledgerRepo.ts) y desde ahí no se guardaba nada más.
 *
 * Se ejercita el STORE, como en diario-de-celda-store: lo que se protege es que la acción use la
 * misma fecha propuesta que el resto de la celda (`proposedDate`), no el dominio puro.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { isValidMovementPeriod, MONTH_CALENDAR } from "@/domain/cycles";
import type { LedgerNode, LedgerState, PeriodKey } from "@/domain";

const JUN = "2026-06" as PeriodKey;
const SEP = "2026-09" as PeriodKey;

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sal", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Sueldo", icon: null, order: 1 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 2 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 3 },
];

/** Ingreso de 1.000.000 y aporte de 500.000 al bolsillo en junio y en septiembre. */
function estado(): LedgerState {
  return {
    ownerId: "local", nodes: NODES, movements: [], budgets: {},
    actuals: {
      "c-sal": { [JUN]: 1_000_000, [SEP]: 1_000_000 },
      "c-viaje": { [JUN]: 500_000, [SEP]: 500_000 },
    },
    startMonth: JUN,
  } as LedgerState;
}

async function storeAt(now: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.resetModules();
  const { useLedgerStore } = await import("@/state/store");
  useLedgerStore.setState({ data: estado() });
  return useLedgerStore;
}

afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

describe("BG-051 · la fecha del retiro pertenece a la columna", () => {
  it("un retiro en una columna pasada lleva una fecha de ese periodo (último día a mediodía)", async () => {
    const s = await storeAt(new Date(2026, 8, 28, 10, 0)); // 28-sep, hora local
    const r = s.getState().applyReserveWithdrawal("c-viaje", JUN, 100_000);
    expect("movement" in r, JSON.stringify(r)).toBe(true);
    const mv = (r as { movement: { period: PeriodKey; date?: string; type: "transfer" } }).movement;
    expect(mv.period).toBe(JUN);
    expect(mv.date).toBe("2026-06-30T12:00");
    expect(isValidMovementPeriod(MONTH_CALENDAR, mv)).toBe(true);
  });

  it("un retiro en la columna en curso a las 19:30 del último día conserva el día local", async () => {
    const s = await storeAt(new Date(2026, 8, 30, 19, 30)); // 30-sep 19:30, hora local
    const r = s.getState().applyReserveWithdrawal("c-viaje", SEP, 100_000);
    expect("movement" in r, JSON.stringify(r)).toBe(true);
    const mv = (r as { movement: { period: PeriodKey; date?: string; type: "transfer" } }).movement;
    expect(mv.period).toBe(SEP);
    expect(mv.date).toBe("2026-09-30T19:30");
    expect(isValidMovementPeriod(MONTH_CALENDAR, mv)).toBe(true);
  });
});
