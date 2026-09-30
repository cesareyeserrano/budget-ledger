// @vitest-environment jsdom
/**
 * BG-070 — el registro suelta la categoría elegida cuando deja de ser un destino válido.
 *
 * Con el formulario abierto, la categoría elegida puede desaparecer (se borra en la grilla de al
 * lado, o llega la versión de otro dispositivo) o dejar de ser hoja (gana su primera subcategoría).
 * El formulario seguía guardando sobre ella. El dominio ya lo rechaza (bg-070-destino-vigente), pero
 * en silencio: aquí se comprueba que el usuario vea «Elige una categoría» y que no se guarde nada.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";
import type { LedgerState } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = { revision: 0, stored: null as LedgerState | null };

beforeEach(() => {
  api.revision = 0; api.stored = null;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    const u = String(url);
    const method = req?.method ?? "GET";
    if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if (method === "PUT") {
      const b = JSON.parse(String(req!.body)) as { baseRevision: number; state: LedgerState };
      if (b.baseRevision !== api.revision) return new Response(JSON.stringify({ revision: api.revision }), { status: 409 });
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

/** Registro montado con 25.000 tecleados y «Vivienda» (categoría-hoja de gasto) elegida. */
async function registroConVivienda() {
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  const { Register } = await import("@/components/register/Register");
  render(React.createElement(Register));
  fireEvent.change(screen.getByTestId("amount-input"), { target: { value: "25000" } });
  fireEvent.click(screen.getByTestId("category-c-vivienda"));
  expect(screen.getByTestId("category-c-vivienda").getAttribute("aria-pressed")).toBe("true");
  return store;
}

describe("BG-070 · el registro y una categoría que deja de ser destino", () => {
  it("BG-070e: si la categoría se borra, guardar pide elegir otra y no registra nada", async () => {
    const store = await registroConVivienda();
    await act(async () => {
      expect(store.getState().deleteNode("c-vivienda")).toBe("ok");
      await delay(20);
    });
    expect(screen.queryByTestId("category-c-vivienda")).toBeNull();

    fireEvent.click(screen.getByTestId("save-button"));
    expect(screen.getByText("Elige una categoría.")).toBeTruthy();
    expect(store.getState().data.movements).toHaveLength(0);
    expect(screen.queryByTestId("confirm-overlay")).toBeNull();
  });

  it("BG-070f: si la categoría gana su primera subcategoría, guardar pide elegir y no escribe sobre el padre", async () => {
    const store = await registroConVivienda();
    await act(async () => {
      store.getState().createNode({ level: "sub", parentId: "c-vivienda", type: "expense", name: "Arriendo" });
      await delay(20);
    });
    expect(screen.getByTestId("category-c-vivienda").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByTestId("save-button"));
    expect(screen.getByText("Elige una categoría.")).toBeTruthy();
    expect(store.getState().data.movements).toHaveLength(0);
    expect(store.getState().data.actuals["c-vivienda"]).toBeUndefined();
  });

  it("BG-070j: si la sub elegida se mueve a otra categoría, guardar pide elegir y no usa el padre viejo", async () => {
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const { Register } = await import("@/components/register/Register");
    render(React.createElement(Register));
    fireEvent.change(screen.getByTestId("amount-input"), { target: { value: "25000" } });
    fireEvent.click(screen.getByTestId("category-c-comida"));
    fireEvent.click(screen.getByTestId("sub-s-comida-cafe"));
    expect(screen.getByTestId("sub-s-comida-cafe").getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      expect(store.getState().moveNode("s-comida-cafe", { kind: "category", id: "c-transporte" })).toBe("ok");
      await delay(20);
    });

    fireEvent.click(screen.getByTestId("save-button"));
    expect(screen.getByText("Elige una categoría.")).toBeTruthy();
    expect(store.getState().data.movements).toHaveLength(0);
  });

  it("BG-070g: sin cambios en el árbol, la misma categoría se guarda como siempre", async () => {
    const store = await registroConVivienda();
    fireEvent.click(screen.getByTestId("save-button"));
    expect(screen.queryByText("Elige una categoría.")).toBeNull();
    expect(store.getState().data.movements).toHaveLength(1);
    expect(store.getState().data.movements[0]).toMatchObject({ target: "c-vivienda", amount: 25_000 });
  });
});
