// @vitest-environment jsdom
/**
 * BG-080 — defectos menores de cliente.
 *
 * (b) «Deshacer» tras un retiro restauraba la foto del estado ANTERIOR al retiro. Si otro dispositivo
 *     había escrito dentro de los seis segundos y el sync en vivo recargaba este, deshacer borraba esa
 *     escritura, aquí y en el servidor.
 * (c) El borde que señala un ajuste recién nacido no se apagaba nunca.
 * (d) En una celda descuadrada, Enter la cuadraba y el botón «Guardar» solo cerraba.
 * (e) Un aviso se identificaba por su texto: dos retiros iguales a cinco segundos hacían que el
 *     temporizador del primero quitara el aviso del segundo, con su «Deshacer».
 * (g) El título de la tarjeta de ejecución del Dashboard decía siempre «2026».
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";
import { cellMismatches } from "@/domain";
import type { LedgerState, PeriodKey } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** El servidor de mentira: guarda el último snapshot y rechaza con 409 una base vieja. */
const api = { revision: 0, stored: null as LedgerState | null };

beforeEach(() => {
  api.revision = 0; api.stored = null;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    const u = String(url);
    if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if ((req?.method ?? "GET") === "PUT") {
      const b = JSON.parse(String(req!.body)) as { baseRevision: number; state: LedgerState };
      if (b.baseRevision !== api.revision) return new Response(JSON.stringify({ error: { code: "revision_conflict" }, revision: api.revision }), { status: 409 });
      api.revision += 1;
      api.stored = b.state;
      return new Response(JSON.stringify({ revision: api.revision }), { status: 200 });
    }
    if (api.stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision: api.revision, state: api.stored }), { status: 200 });
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

/** Store hidratado con un ingreso de 1.000.000 y 500.000 aportados a Ahorros en el mes en curso. */
async function conAhorros() {
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  const cur = store.getState().activePeriods()[0]!;
  store.getState().setLeafAmount("c-salario", cur, "actual", 1_000_000);
  store.getState().applyReserveEdit("c-ahorros", cur, "actual", 500_000);
  await delay(30);
  return { store, cur };
}
const retiros = (s: LedgerState) => s.movements.filter((m) => m.from === "c-ahorros" && m.to === "@disponible");

describe("BG-080 (b) · deshacer un retiro no borra lo que escribió otro dispositivo", () => {
  it("BG-080b: tras una recarga del sync con una escritura ajena, deshacer quita solo el retiro", async () => {
    const { store, cur } = await conAhorros();
    const r = store.getState().applyReserveWithdrawal("c-ahorros", cur, 100_000);
    if ("rejected" in r) throw new Error("preparación: retiro rechazado");
    await delay(30);
    expect(retiros(api.stored!)).toHaveLength(1);

    // Otro dispositivo presupuesta 777.000 en Vivienda; el sync en vivo recarga este.
    api.stored = { ...api.stored!, budgets: { ...api.stored!.budgets, "c-vivienda": { [cur]: 777_000 } } };
    api.revision += 1;
    await store.getState().resync();
    expect(store.getState().data.budgets["c-vivienda"]?.[cur]).toBe(777_000);
    expect(store.getState().toastUndo).toBe(true);

    store.getState().undoLastReserveOp();
    await delay(30);
    expect(retiros(store.getState().data)).toHaveLength(0);
    expect(store.getState().data.budgets["c-vivienda"]?.[cur]).toBe(777_000);
    // Y en el servidor: la escritura ajena sigue, el retiro no.
    expect(api.stored!.budgets["c-vivienda"]?.[cur]).toBe(777_000);
    expect(retiros(api.stored!)).toHaveLength(0);
    expect(store.getState().toast).toBeNull();
  });

  it("BG-080b: sin escrituras ajenas, deshacer deja el libro como antes del retiro", async () => {
    const { store, cur } = await conAhorros();
    const antes = JSON.stringify(store.getState().data);
    const r = store.getState().applyReserveWithdrawal("c-ahorros", cur, 100_000, "Para regalos");
    if ("rejected" in r) throw new Error("preparación: retiro rechazado");
    await delay(30);
    await store.getState().resync(); // el eco de la propia escritura no cierra la ventana (BG-011)

    store.getState().undoLastReserveOp();
    await delay(30);
    expect(JSON.stringify(store.getState().data)).toBe(antes);
    expect(JSON.stringify(api.stored)).toBe(antes);
  });

  it("BG-080b: si después del retiro se editó algo aquí, deshacer ya no hace nada", async () => {
    const { store, cur } = await conAhorros();
    store.getState().applyReserveWithdrawal("c-ahorros", cur, 100_000);
    store.getState().setLeafAmount("c-vivienda", cur, "budget", 50_000);
    store.getState().undoLastReserveOp();
    expect(retiros(store.getState().data)).toHaveLength(1);
  });
});

describe("BG-080 (e) · el aviso de un retiro dura lo suyo aunque haya otro igual antes", () => {
  it("BG-080e: dos retiros idénticos a cinco segundos — el segundo conserva su «Deshacer» seis segundos", async () => {
    const { store, cur } = await conAhorros();
    vi.useFakeTimers();
    store.getState().applyReserveWithdrawal("c-ahorros", cur, 100_000);
    const texto = store.getState().toast;
    expect(texto).toContain("Sacaste");

    vi.advanceTimersByTime(5_000);
    store.getState().applyReserveWithdrawal("c-ahorros", cur, 100_000);
    expect(store.getState().toast).toBe(texto); // mismo texto: es el caso que fallaba

    vi.advanceTimersByTime(1_100); // vence el temporizador del PRIMERO
    expect(store.getState().toast).toBe(texto);
    expect(store.getState().toastUndo).toBe(true);

    vi.advanceTimersByTime(5_000); // y ahora sí el del segundo
    expect(store.getState().toast).toBeNull();
    expect(store.getState().toastUndo).toBe(false);
  });

  it("BG-080e: lo mismo con un aviso corriente repetido", async () => {
    const { store } = await conAhorros();
    vi.useFakeTimers();
    store.getState().showToast("Guardado");
    vi.advanceTimersByTime(1_500);
    store.getState().showToast("Guardado");
    vi.advanceTimersByTime(600);
    expect(store.getState().toast).toBe("Guardado");
    vi.advanceTimersByTime(1_500);
    expect(store.getState().toast).toBeNull();
  });
});

describe("BG-080 (c) · el resaltado de un ajuste recién nacido se apaga", () => {
  it("BG-080c: el borde aparece al nacer el ajuste y desaparece a los dos segundos", async () => {
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const cur = store.getState().activePeriods()[0]!;
    const { CellDetail } = await import("@/components/CellDetail");
    render(React.createElement(CellDetail, { leafId: "c-vivienda", month: cur }));

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => { store.getState().setLeafAmount("c-vivienda", cur, "actual", 120_000); });
    const fila = () => screen.getAllByTestId("detail-row").find((el) => el.getAttribute("data-kind") === "adjustment")!;
    expect(fila().style.border).toBe("1px solid var(--accent)");

    act(() => { vi.advanceTimersByTime(1_900); });
    expect(fila().style.border).toBe("1px solid var(--accent)");
    act(() => { vi.advanceTimersByTime(200); });
    expect(fila().style.border).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("BG-080 (d) · «Guardar» hace lo mismo que Enter", () => {
  /** La grilla con la celda Ejec. de Vivienda en 45.000 y SIN movimientos: descuadrada. */
  async function celdaDescuadradaAbierta() {
    vi.resetModules();
    Element.prototype.scrollTo = () => {};
    Element.prototype.scrollIntoView = () => {};
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const cur = store.getState().activePeriods()[0]!;
    const d = store.getState().data;
    store.setState({ data: { ...d, actuals: { ...d.actuals, "c-vivienda": { [cur]: 45_000 } } } });
    expect(cellMismatches(store.getState().data, store.getState().activePeriods())).toHaveLength(1);
    const { BudgetGrid } = await import("@/components/BudgetGrid");
    await act(async () => { render(React.createElement(BudgetGrid)); await delay(0); });
    const celda = document.querySelector<HTMLElement>(`[data-cell="c-vivienda"][data-month="${cur}"][data-plane="actual"]`)!;
    await act(async () => { fireEvent.click(celda); await delay(0); });
    return { store, cur };
  }
  const ajustes = (s: LedgerState) => s.movements.filter((m) => m.kind === "adjustment");

  it("BG-080d: «Guardar» sin teclear cuadra la celda con un ajuste, como Enter", async () => {
    const { store, cur } = await celdaDescuadradaAbierta();
    await act(async () => { fireEvent.click(screen.getByTestId("cell-save")); await delay(0); });
    expect(ajustes(store.getState().data)).toHaveLength(1);
    expect(ajustes(store.getState().data)[0]).toMatchObject({ target: "c-vivienda", period: cur, amount: 45_000 });
    expect(store.getState().data.actuals["c-vivienda"]?.[cur]).toBe(45_000);
    expect(cellMismatches(store.getState().data, store.getState().activePeriods())).toHaveLength(0);
  });

  it("BG-080d: Enter hace exactamente eso mismo (control)", async () => {
    const { store } = await celdaDescuadradaAbierta();
    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Editar valor"), { key: "Enter" }); await delay(0); });
    expect(ajustes(store.getState().data)).toHaveLength(1);
    expect(cellMismatches(store.getState().data, store.getState().activePeriods())).toHaveLength(0);
  });

  it("BG-080d: «Cancelar» sigue sin escribir nada", async () => {
    const { store } = await celdaDescuadradaAbierta();
    await act(async () => { fireEvent.click(screen.getByTestId("cell-cancel")); await delay(0); });
    expect(ajustes(store.getState().data)).toHaveLength(0);
    expect(cellMismatches(store.getState().data, store.getState().activePeriods())).toHaveLength(1);
  });
});

describe("BG-080 (g) · el título del Dashboard dice el año que pinta", () => {
  async function dashboard() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const { Dashboard } = await import("@/components/Dashboard");
    render(React.createElement(Dashboard));
    return store;
  }
  const titulo = () => screen.getByText(/^Ejecución mensual · /).textContent;

  it("BG-080g: con el filtro en el año 2027, el título dice 2027", async () => {
    const store = await dashboard();
    act(() => { store.getState().setPeriod({ mode: "year", year: 2027 }); });
    expect(titulo()).toBe("Ejecución mensual · 2027");
  });

  it("BG-080g: con el filtro en un mes, la gráfica cubre todo el rango y el título lo dice", async () => {
    const store = await dashboard();
    const p = store.getState().activePeriods();
    act(() => { store.getState().setPeriod({ mode: "month", month: p[0]! as PeriodKey }); });
    expect(titulo()).toBe(`Ejecución mensual · ${p[0]!.slice(0, 4)}–${p[p.length - 1]!.slice(0, 4)}`);
  });
});
