// @vitest-environment jsdom
/**
 * BG-081 (e), (f) y (g) — «Tu historia» en Configuración, el aviso de cierre y el historial.
 *
 * (e) Tras un rechazo por meses huérfanos los dos botones quedaban apagados y el aviso no se podía
 *     quitar; y un mes de inicio fuera de los tres años ofrecidos dejaba el selector de año en blanco.
 * (f) El aviso de meses sin cerrar nombraba un ciclo de transición por su mes —el del ciclo de al
 *     lado, ya cerrado— mientras el botón decía «Transición».
 * (g) El historial de cierres solo se pedía al abrir el panel: cerrar o reabrir con el panel abierto
 *     no lo actualizaba.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";
import { buildSeed } from "@/domain";
import type { CycleConfig, LedgerState, PeriodKey } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lo que guarda el servidor de mentira: el estado, y los eventos de cierre que devuelve. */
let servidor: LedgerState;
let eventos: Array<{ period: string; action: "close" | "reopen"; at: string }>;
let pedidosDeHistorial: number;

beforeEach(() => {
  eventos = [];
  pedidosDeHistorial = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    const u = String(url);
    const method = req?.method ?? "GET";
    if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if (u.endsWith("/api/v1/closure/events")) {
      pedidosDeHistorial += 1;
      return new Response(JSON.stringify({ events: eventos }), { status: 200 });
    }
    if (u.endsWith("/api/v1/closure") && method === "POST") {
      servidor = { ...servidor, closure: { closedThrough: "2026-09" as PeriodKey, reopened: null } };
      eventos = [{ period: "2026-09", action: "close", at: "2026-10-05T15:00:00.000Z" }, ...eventos];
      return new Response(JSON.stringify({ revision: 2, closure: servidor.closure }), { status: 200 });
    }
    return new Response(JSON.stringify({ revision: 1, state: servidor }), { status: 200 });
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => {
  cleanup(); vi.useRealTimers();
  for (const m of ["@/components/ui/select", "@/components/auth/LoginGate", "next/navigation", "next-themes", "@/components/PeriodModeSection", "@/components/HorizonSelect", "@/components/Toaster"]) vi.doUnmock(m);
  vi.unstubAllGlobals(); vi.resetModules();
});

/** El 5 de octubre de 2026: septiembre ya terminó, así que hay algo que cerrar. */
function el5DeOctubre() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
}

// ── (e) Configuración ─────────────────────────────────────────────────────────────────────────

async function configuracion(startMonth: string, openingBalance: number) {
  servidor = { ...buildSeed("local", startMonth as PeriodKey), startMonth: startMonth as PeriodKey, openingBalance } as LedgerState;
  vi.resetModules();
  // El Select de Radix no abre su lista en jsdom: un <select> nativo con el mismo contrato.
  vi.doMock("@/components/ui/select", () => ({
    Select: (p: { value: string; disabled?: boolean; onValueChange: (v: string) => void; children: React.ReactNode }) =>
      React.createElement("select", { "data-testid": "select-nativo", value: p.value, disabled: p.disabled, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => p.onValueChange(e.target.value) }, p.children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: (p: { children: React.ReactNode }) => React.createElement(React.Fragment, null, p.children),
    SelectItem: (p: { value: string; children: React.ReactNode }) => React.createElement("option", { value: p.value }, p.children),
  }));
  vi.doMock("@/components/auth/LoginGate", () => ({ LoginGate: (p: { children: React.ReactNode }) => React.createElement(React.Fragment, null, p.children) }));
  vi.doMock("next/navigation", () => ({ useRouter: () => ({ push() {} }) }));
  vi.doMock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme() {} }) }));
  vi.doMock("@/components/PeriodModeSection", () => ({ PeriodModeSection: () => null }));
  vi.doMock("@/components/HorizonSelect", () => ({ HorizonSelect: () => null }));
  vi.doMock("@/components/Toaster", () => ({ Toaster: () => null }));
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  const Pagina = (await import("@/app/configuracion/page")).default;
  await act(async () => { render(React.createElement(Pagina)); await delay(0); });
  const [mes, anio] = screen.getAllByTestId("select-nativo") as HTMLSelectElement[];
  return { store, mes: mes!, anio: anio! };
}

describe("BG-081 (e) · «Tu historia» tras un rechazo", () => {
  it("BG-081e: tras el rechazo por meses huérfanos, Descartar sigue vivo y quita el aviso", async () => {
    const { store, mes } = await configuracion("2026-08", 500);
    store.setState({ setStart: (async () => ({ ok: false, reason: "would_orphan", periods: ["2026-08", "2026-09"] })) as never });

    fireEvent.change(mes, { target: { value: "10" } });
    await act(async () => { fireEvent.click(screen.getByTestId("config-save")); await delay(10); });
    expect(screen.getByTestId("config-blocked").textContent).toContain("dejarías fuera 2 meses con datos");
    expect(mes.value).toBe("8"); // el selector vuelve al mes vigente

    const descartar = screen.getByTestId("config-start-discard") as HTMLButtonElement;
    expect(descartar.disabled).toBe(false);
    fireEvent.click(descartar);
    expect(screen.queryByTestId("config-blocked")).toBeNull();
    expect(descartar.disabled).toBe(true); // ya no queda nada que deshacer
  });

  it("BG-081e: elegir otro mes después del rechazo también quita el aviso", async () => {
    const { store, mes } = await configuracion("2026-08", 500);
    store.setState({ setStart: (async () => ({ ok: false, reason: "would_orphan", periods: ["2026-08"] })) as never });
    fireEvent.change(mes, { target: { value: "9" } });
    await act(async () => { fireEvent.click(screen.getByTestId("config-save")); await delay(10); });
    expect(screen.getByTestId("config-blocked")).toBeTruthy();

    fireEvent.change(mes, { target: { value: "7" } });
    expect(screen.queryByTestId("config-blocked")).toBeNull();
  });

  it("BG-081e: con un saldo inválido no se puede guardar, pero Descartar lo devuelve al vigente", async () => {
    await configuracion("2026-08", 500);
    const saldo = screen.getByTestId("config-opening") as HTMLInputElement;
    fireEvent.change(saldo, { target: { value: "1500,50" } });
    expect((screen.getByTestId("config-save") as HTMLButtonElement).disabled).toBe(true);

    const descartar = screen.getByTestId("config-start-discard") as HTMLButtonElement;
    expect(descartar.disabled).toBe(false);
    fireEvent.click(descartar);
    expect(saldo.value).toBe("500");
  });

  it("BG-081e: un inicio de hace muchos años aparece en el selector de año, y se puede volver a él", async () => {
    const { anio } = await configuracion("2019-05", 500);
    const opciones = () => Array.from(anio.options).map((o) => o.value);
    expect(opciones()).toContain("2019");
    expect(anio.value).toBe("2019");

    const otro = opciones().find((v) => v !== "2019")!;
    fireEvent.change(anio, { target: { value: otro } });
    expect(anio.value).toBe(otro);
    expect(opciones()).toContain("2019");
  });
});

// ── (f) y (g) Cierre ──────────────────────────────────────────────────────────────────────────

describe("BG-081 (f) · el aviso nombra el periodo como el botón", () => {
  it("BG-081f: con un ciclo de transición por cerrar, el aviso dice «Transición» y habla de ciclos", async () => {
    el5DeOctubre();
    // Día de pago 21, cambiado a 30 con primer pago el 30 de agosto: entre los dos queda la transición.
    const cycles = {
      mode: "cycle",
      versions: [
        { seq: 1, mode: "cycle", anchorDay: 21, eomPolicy: "last_day", effectiveFrom: "2026-06-21", firstPay: null, restoreStartMonth: "2026-06", createdAt: "2026-06-21T00:00:00.000Z" },
        { seq: 2, mode: "cycle", anchorDay: 30, eomPolicy: "last_day", effectiveFrom: "2026-08-30", firstPay: "2026-08-30", restoreStartMonth: null, createdAt: "2026-08-30T00:00:00.000Z" },
      ],
    } as unknown as CycleConfig;
    servidor = { ...buildSeed("local", "2026-07" as PeriodKey), cycles, closure: { closedThrough: "2026-08" as PeriodKey, reopened: null } } as LedgerState;
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const { ClosureBanner } = await import("@/components/ClosureBanner");
    const { ClosureControl } = await import("@/components/ClosureControl");
    render(React.createElement("div", null, React.createElement(ClosureBanner), React.createElement(ClosureControl)));

    // El escenario es el que se quiere: lo siguiente que se puede cerrar es una transición.
    expect(screen.getByTestId("closure-control").getAttribute("data-closable")).toMatch(/t$/);
    const aviso = screen.getByTestId("closure-banner");
    expect(aviso.textContent).toContain("El siguiente que puedes cerrar es Transición.");
    expect(aviso.textContent).not.toContain("Agosto");
    expect(aviso.textContent).toMatch(/ciclos? terminados? sin cerrar/);
    expect(aviso.getAttribute("title")).toMatch(/^Transición · /);
    expect(screen.getByText(/Cerrar Transición/)).toBeTruthy();
  });

  it("BG-081f: en modo mes el aviso no cambia", async () => {
    el5DeOctubre();
    servidor = { ...buildSeed("local", "2026-07" as PeriodKey), closure: { closedThrough: "2026-08" as PeriodKey, reopened: null } } as LedgerState;
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const { ClosureBanner } = await import("@/components/ClosureBanner");
    render(React.createElement(ClosureBanner));
    const aviso = screen.getByTestId("closure-banner");
    expect(aviso.textContent).toBe("Tienes 1 mes terminado sin cerrar. El siguiente que puedes cerrar es Septiembre 2026.");
    expect(aviso.getAttribute("title")).toBeNull();
  });
});

describe("BG-081 (g) · el historial abierto se actualiza", () => {
  async function panelAbierto() {
    el5DeOctubre();
    servidor = { ...buildSeed("local", "2026-07" as PeriodKey), closure: { closedThrough: "2026-08" as PeriodKey, reopened: null } } as LedgerState;
    eventos = [{ period: "2026-08", action: "close", at: "2026-09-02T15:00:00.000Z" }];
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const { ClosureHistoryPanel } = await import("@/components/ClosureHistoryPanel");
    render(React.createElement(ClosureHistoryPanel));
    return store;
  }
  const filas = () => screen.queryAllByTestId("closure-history-row").map((li) => `${li.getAttribute("data-period")}:${li.getAttribute("data-action")}`);

  it("BG-081g: cerrar un mes con el panel abierto añade su fila sin reabrir el panel", async () => {
    const store = await panelAbierto();
    await act(async () => { fireEvent.click(screen.getByTestId("closure-history-toggle")); await delay(10); });
    expect(filas()).toEqual(["2026-08:close"]);
    expect(pedidosDeHistorial).toBe(1);

    await act(async () => { await store.getState().closeMonth(); await delay(10); });
    expect(filas()).toEqual(["2026-09:close", "2026-08:close"]);
    expect(pedidosDeHistorial).toBe(2);
  });

  it("BG-081g: un cierre hecho en otro dispositivo llega con la recarga del sync", async () => {
    const store = await panelAbierto();
    await act(async () => { fireEvent.click(screen.getByTestId("closure-history-toggle")); await delay(10); });

    servidor = { ...servidor, closure: { closedThrough: "2026-09" as PeriodKey, reopened: null } };
    eventos = [{ period: "2026-09", action: "close", at: "2026-10-05T15:00:00.000Z" }, ...eventos];
    await act(async () => { await store.getState().resync(); await delay(10); });
    expect(filas()).toEqual(["2026-09:close", "2026-08:close"]);
  });

  it("BG-081g: editar una celda con el panel abierto no vuelve a pedir el historial, y cerrado no pide nada", async () => {
    const store = await panelAbierto();
    await act(async () => { await store.getState().closeMonth(); await delay(10); });
    expect(pedidosDeHistorial).toBe(0); // panel cerrado

    await act(async () => { fireEvent.click(screen.getByTestId("closure-history-toggle")); await delay(10); });
    expect(pedidosDeHistorial).toBe(1);
    await act(async () => { store.getState().setLeafAmount("c-vivienda", "2026-10" as PeriodKey, "budget", 900_000); await delay(10); });
    expect(pedidosDeHistorial).toBe(1);
  });
});
