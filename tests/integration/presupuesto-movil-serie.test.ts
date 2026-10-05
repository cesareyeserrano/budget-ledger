// @vitest-environment jsdom
/**
 * Feature presupuesto-movil — NFR-3107: cambiar de periodo no recalcula la serie del Balance.
 *
 * En su propio archivo porque sustituye el módulo del Balance por un espía. Se afirma TRABAJO HECHO
 * (cuántas veces se calcula la serie), no tiempo: la serie recorre todo el rango activo, y hacerlo en
 * cada cambio de periodo sería el coste que el requisito prohíbe.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, within } from "@testing-library/react";
import type { LedgerState, PeriodKey } from "@/domain/types";
import { PMV, pmvBase } from "../fixtures/pmv-base";

vi.mock("@/domain/balance", async (original) => {
  const real = await original<typeof import("@/domain/balance")>();
  return { ...real, computeBalanceSeries: vi.fn(real.computeBalanceSeries) };
});

const p2 = (n: number) => String(n).padStart(2, "0");
const hoy = new Date();
const mesRelativo = (atras: number): PeriodKey => {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - atras, 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}` as PeriodKey;
};
const M = mesRelativo(1);
const PREV = mesRelativo(2);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ revision: 1 }), { status: 200, headers: { "content-type": "application/json" } })));
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.history.replaceState(null, "", "/?v=p");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("presupuesto-movil · la serie del Balance se calcula una vez por estado", () => {
  it("TC-PMV-169e: cinco cambios de periodo no la recalculan; una edición, sí", async () => {
    // @aitri-tc TC-PMV-169e
    const balance = await import("@/domain/balance");
    const espia = vi.mocked(balance.computeBalanceSeries);
    const { useLedgerStore } = await import("@/state/store");
    const data = { ownerId: "local", ...pmvBase(M, PREV) } as LedgerState;
    useLedgerStore.setState({ data, hydrated: true, period: { mode: "month", month: M } });
    const { MobileBudget } = await import("@/components/mobile/MobileBudget");
    render(React.createElement(MobileBudget, { active: true, detail: null }));

    const alMontar = espia.mock.calls.length;
    expect(alMontar).toBe(1);

    const periodos = useLedgerStore.getState().activePeriods();
    for (const p of [PREV, M, periodos[periodos.length - 1], periodos[3] ?? M, M]) {
      await act(async () => { useLedgerStore.getState().setPeriod({ mode: "month", month: p }); });
    }
    expect(screen.getByTestId("mb-period-label").textContent).toBeTruthy();
    expect(espia.mock.calls.length, "cambiar de periodo no recalcula la serie").toBe(alMontar);

    // Una edición cambia el estado: ahí sí toca recalcular, y la vista usa la serie nueva.
    await act(async () => { useLedgerStore.getState().setLeafAmount(PMV.mercado, M, "budget", 1200); });
    expect(espia.mock.calls.length).toBe(alMontar + 1);
    const vivienda = screen.getAllByTestId("mb-row").find((r) => within(r).getByTestId("mb-row-name").textContent === "Vivienda")!;
    expect(within(vivienda).getByTestId("mb-row-budget").textContent).toBe("de 1.800");
  });
});
