// @vitest-environment jsdom
/**
 * BG-081 (a) y (b) — la sección «Periodo del presupuesto» de Configuración.
 *
 * (a) Cambiar la política de fin de mes quitaba la previsualización pero dejaba el error con su botón
 *     «Reintentar», y ese reintento aplicaba la política ANTERIOR sin previsualización a la vista —
 *     justo lo que NFR-2412 prohíbe.
 * (b) Con ciclos activos, cualquier recarga del servidor (un evento del sync, un 409) reiniciaba el
 *     formulario mientras el usuario tecleaba, aunque lo vigente no hubiera cambiado.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";
import { buildSeed } from "@/domain";
import type { CycleConfig, LedgerState, PeriodKey } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const version = (seq: number, anchorDay: number) => ({
  seq, mode: "cycle" as const, anchorDay, eomPolicy: "last_day" as const, effectiveFrom: "2026-08-21", firstPay: null,
  restoreStartMonth: "2026-08", createdAt: "2026-08-21T00:00:00.000Z",
});
const ciclos = (...versions: ReturnType<typeof version>[]) => ({ mode: "cycle", versions }) as unknown as CycleConfig;

/** Lo que devuelve GET /api/v1/ledger; cada prueba lo cambia para simular lo que hay en el servidor. */
let servidor: LedgerState;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    if (String(url).includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ revision: 1, state: servidor }), { status: 200 });
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  // El Select de Radix no abre su lista en jsdom: se cambia por un <select> nativo con el mismo contrato.
  vi.doMock("@/components/ui/select", () => ({
    Select: (p: { value: string; disabled?: boolean; onValueChange: (v: string) => void; children: React.ReactNode }) =>
      React.createElement("select", { "data-testid": "eom-nativo", value: p.value, disabled: p.disabled, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => p.onValueChange(e.target.value) }, p.children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: (p: { children: React.ReactNode }) => React.createElement(React.Fragment, null, p.children),
    SelectItem: (p: { value: string; children: React.ReactNode }) => React.createElement("option", { value: p.value }, p.children),
  }));
});
afterEach(() => { cleanup(); vi.doUnmock("@/components/ui/select"); vi.unstubAllGlobals(); vi.resetModules(); });

async function montar() {
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  const { PeriodModeSection } = await import("@/components/PeriodModeSection");
  render(React.createElement(PeriodModeSection));
  return store;
}

describe("BG-081 (a) · cambiar la política de fin de mes retira el reintento", () => {
  it("BG-081a: tras un fallo al aplicar, cambiar la política quita el error y no deja aplicar la anterior", async () => {
    servidor = buildSeed("local", "2026-08" as PeriodKey);
    const store = await montar();
    const aplicar = vi.fn(async () => ({ ok: false as const, code: "server_error" }));
    store.setState({
      previewPeriodMode: async () => ({
        ok: true as const,
        cycles: [{ key: "2026-09" as PeriodKey, label: "Septiembre 2026", start: "2026-08-31", end: "2026-09-29", transition: false, current: true }],
        relocation: { cellsMoved: 0, movementsKeyChanged: 0, mergedCells: 0, identical: true, note: "" },
      }),
      applyPeriodMode: aplicar,
    } as never);

    fireEvent.click(screen.getByTestId("config-period-cycle"));
    fireEvent.change(screen.getByTestId("config-anchor-day"), { target: { value: "31" } });
    await act(async () => { fireEvent.click(screen.getByTestId("config-preview")); await delay(10); });
    await act(async () => { fireEvent.click(screen.getByTestId("config-confirm")); await delay(10); });
    expect(aplicar).toHaveBeenCalledTimes(1);
    expect(aplicar.mock.calls[0]).toEqual([{ mode: "cycle", anchorDay: 31, eomPolicy: "last_day" }]);
    expect(screen.getByTestId("config-error").textContent).toContain("Reintentar");

    fireEvent.change(screen.getByTestId("eom-nativo"), { target: { value: "shift" } });
    expect(screen.queryByTestId("cycle-preview")).toBeNull();
    expect(screen.queryByTestId("config-error")).toBeNull();
    expect(screen.queryByText("Reintentar")).toBeNull();
    expect(aplicar).toHaveBeenCalledTimes(1);

    // La política nueva solo se aplica pasando otra vez por la previsualización.
    await act(async () => { fireEvent.click(screen.getByTestId("config-preview")); await delay(10); });
    await act(async () => { fireEvent.click(screen.getByTestId("config-confirm")); await delay(10); });
    expect(aplicar).toHaveBeenCalledTimes(2);
    expect(aplicar.mock.calls[1]).toEqual([{ mode: "cycle", anchorDay: 31, eomPolicy: "shift" }]);
  });
});

describe("BG-081 (b) · una recarga sin cambios no reinicia el formulario", () => {
  it("BG-081b: lo tecleado sobrevive a una recarga que trae lo mismo", async () => {
    servidor = { ...buildSeed("local", "2026-08" as PeriodKey), cycles: ciclos(version(1, 21)) } as LedgerState;
    const store = await montar();
    const dia = () => (screen.getByTestId("config-anchor-day") as HTMLInputElement).value;
    expect(dia()).toBe("21");

    fireEvent.change(screen.getByTestId("config-anchor-day"), { target: { value: "15" } });
    fireEvent.change(screen.getByTestId("config-first-pay"), { target: { value: "2026-10-15" } });
    const antes = store.getState().data.cycles;
    await act(async () => { await store.getState().resync(); await delay(10); });

    expect(store.getState().data.cycles).not.toBe(antes); // la recarga sí ocurrió: es otro objeto
    expect(dia()).toBe("15");
    expect((screen.getByTestId("config-first-pay") as HTMLInputElement).value).toBe("2026-10-15");
  });

  it("BG-081b: si otro dispositivo cambió el día de pago, el formulario sí pasa a reflejarlo", async () => {
    servidor = { ...buildSeed("local", "2026-08" as PeriodKey), cycles: ciclos(version(1, 21)) } as LedgerState;
    const store = await montar();
    fireEvent.change(screen.getByTestId("config-anchor-day"), { target: { value: "15" } });

    servidor = { ...servidor, cycles: ciclos(version(1, 21), version(2, 25)) } as LedgerState;
    await act(async () => { await store.getState().resync(); await delay(10); });

    expect((screen.getByTestId("config-anchor-day") as HTMLInputElement).value).toBe("25");
    expect(screen.queryByTestId("config-first-pay")).toBeNull();
  });
});

describe("BG-081 · revisión adversarial del formulario de periodo", () => {
  const PREVIEW = {
    ok: true as const,
    cycles: [{ key: "2026-09" as PeriodKey, label: "Septiembre 2026", start: "2026-08-25", end: "2026-09-24", transition: false, current: true }],
    relocation: { cellsMoved: 3, movementsKeyChanged: 5, mergedCells: 0, identical: true, note: "" },
  };

  it("si los datos cambian por debajo, la previsualización se retira y lo tecleado se queda", async () => {
    servidor = { ...buildSeed("local", "2026-08" as PeriodKey), cycles: ciclos(version(1, 21)) } as LedgerState;
    const store = await montar();
    store.setState({ previewPeriodMode: async () => PREVIEW } as never);
    fireEvent.change(screen.getByTestId("config-anchor-day"), { target: { value: "25" } });
    fireEvent.change(screen.getByTestId("config-first-pay"), { target: { value: "2026-10-25" } });
    await act(async () => { fireEvent.click(screen.getByTestId("config-preview")); await delay(10); });
    expect(screen.getByTestId("config-confirm")).toBeTruthy();

    // Otro dispositivo escribe una celda: misma versión de ciclos, otros datos.
    servidor = { ...servidor, budgets: { "c-vivienda": { "2026-10": 900_000 } } } as LedgerState;
    await act(async () => { await store.getState().resync(); await delay(10); });
    expect(screen.queryByTestId("cycle-preview")).toBeNull();
    expect(screen.queryByTestId("config-confirm")).toBeNull();
    expect((screen.getByTestId("config-anchor-day") as HTMLInputElement).value).toBe("25");
    expect((screen.getByTestId("config-first-pay") as HTMLInputElement).value).toBe("2026-10-25");
  });

  it("cuando otro dispositivo cambia el día de pago, el aviso del intento anterior no se queda colgado", async () => {
    servidor = { ...buildSeed("local", "2026-08" as PeriodKey), cycles: ciclos(version(1, 21)) } as LedgerState;
    const store = await montar();
    store.setState({ previewPeriodMode: async () => ({ ok: false as const, code: "first_pay_invalid", detail: { lastPay: "2026-09-21" } }) } as never);
    fireEvent.change(screen.getByTestId("config-anchor-day"), { target: { value: "25" } });
    fireEvent.change(screen.getByTestId("config-first-pay"), { target: { value: "2026-09-25" } });
    await act(async () => { fireEvent.click(screen.getByTestId("config-preview")); await delay(10); });
    expect(screen.getByTestId("config-error").textContent).toContain("El primer pago nuevo");

    servidor = { ...servidor, cycles: ciclos(version(1, 21), version(2, 28)) } as LedgerState;
    await act(async () => { await store.getState().resync(); await delay(10); });
    expect((screen.getByTestId("config-anchor-day") as HTMLInputElement).value).toBe("28");
    expect(screen.queryByTestId("config-error")).toBeNull();
  });
});

