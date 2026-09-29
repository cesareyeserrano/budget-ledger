// @vitest-environment jsdom
/**
 * BG-066 — con ciclos activos, la app abre en el ciclo EN CURSO, no en el que ya terminó.
 *
 * El filtro se inicializaba con el mes calendario al crear el store y nadie lo volvía a derivar al
 * cargar. Un ciclo se nombra por el mes en que TERMINA: con día de pago 21, el 28 de septiembre el
 * ciclo en curso es «2026-10» (21-sep a 20-oct), pero la app abría en «2026-09» (21-ago a 20-sep).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSeed } from "@/domain";
import type { CycleConfig, LedgerState, PeriodKey } from "@/domain/types";

const CICLOS_21: CycleConfig = {
  mode: "cycle",
  versions: [{
    seq: 1, mode: "cycle", anchorDay: 21, eomPolicy: "last_day", effectiveFrom: "2026-08-21", firstPay: null,
    restoreStartMonth: "2026-08", createdAt: "2026-08-21T00:00:00.000Z",
  }],
} as CycleConfig;

function stub(estado: () => LedgerState, alAplicar?: () => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, req?: RequestInit) => {
      const u = String(url);
      if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
      if (u.endsWith("/api/v1/ledger/cycles") && req?.method === "PUT") {
        alAplicar?.();
        return new Response(JSON.stringify({ revision: 2 }), { status: 200 });
      }
      return new Response(JSON.stringify({ revision: 1, state: estado() }), { status: 200 });
    })
  );
}

async function storeAl28DeSeptiembre() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 28, 10, 0));
  vi.resetModules();
  return (await import("@/state/store")).useLedgerStore;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("BG-066 · el filtro arranca en el periodo en curso del calendario cargado", () => {
  it("con ciclos de día 21, el 28 de septiembre abre en el ciclo «2026-10»", async () => {
    const conCiclos = { ...buildSeed("local", "2026-08" as PeriodKey), cycles: CICLOS_21 } as LedgerState;
    stub(() => conCiclos);
    const store = await storeAl28DeSeptiembre();
    await store.getState().hydrate();
    expect(store.getState().period).toEqual({ mode: "month", month: "2026-10" });
  });

  it("en modo mes sigue abriendo en el mes en curso", async () => {
    const mes = buildSeed("local", "2026-08" as PeriodKey);
    stub(() => mes);
    const store = await storeAl28DeSeptiembre();
    await store.getState().hydrate();
    expect(store.getState().period).toEqual({ mode: "month", month: "2026-09" });
  });

  it("al pasar a ciclos, el filtro salta al ciclo en curso del calendario nuevo", async () => {
    let actual: LedgerState = buildSeed("local", "2026-08" as PeriodKey);
    stub(() => actual, () => { actual = { ...actual, cycles: CICLOS_21 } as LedgerState; });
    const store = await storeAl28DeSeptiembre();
    await store.getState().hydrate();
    expect(store.getState().period).toEqual({ mode: "month", month: "2026-09" });

    const r = await store.getState().applyPeriodMode({ mode: "cycle", anchorDay: 21 } as never);
    expect(r.ok).toBe(true);
    expect(store.getState().period).toEqual({ mode: "month", month: "2026-10" });
  });
});
