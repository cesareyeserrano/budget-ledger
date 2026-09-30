// @vitest-environment jsdom
/**
 * BG-072 — crear una categoría no responde la tarjeta de arranque.
 *
 * La tarjeta se da por respondida en cuanto el usuario tiene DATOS (FR-2203, estado 4) y entonces
 * declara «este mes, saldo 0». Contaba CLAVES de los mapas de montos, y `createNode` crea un mapa
 * vacío para cada nodo nuevo: crear una categoría antes de contestar declaraba el inicio sin que el
 * usuario hubiera tecleado una sola cifra. Una categoría es estructura; el dato es la cifra.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import type { LedgerState } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const api = { revision: 0, stored: null as LedgerState | null, starts: 0 };

beforeEach(() => {
  api.revision = 0; api.stored = null; api.starts = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    const u = String(url);
    const method = req?.method ?? "GET";
    if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if (method === "PUT" && u.endsWith("/api/v1/ledger/start")) {
      api.starts += 1;
      const b = JSON.parse(String(req!.body)) as { baseRevision: number; startMonth: string; openingBalance: number | null };
      if (b.baseRevision !== api.revision) return new Response(JSON.stringify({ revision: api.revision }), { status: 409 });
      api.revision += 1;
      api.stored = { ...api.stored!, startMonth: b.startMonth, openingBalance: b.openingBalance } as LedgerState;
      return new Response(JSON.stringify({ revision: api.revision, startMonth: b.startMonth, openingBalance: b.openingBalance }), { status: 200 });
    }
    if (method === "PUT") {
      const b = JSON.parse(String(req!.body)) as { baseRevision: number; state: LedgerState };
      if (b.baseRevision !== api.revision) return new Response(JSON.stringify({ revision: api.revision }), { status: 409 });
      api.revision += 1;
      api.stored = { ...b.state, startMonth: api.stored?.startMonth, openingBalance: api.stored?.openingBalance } as LedgerState;
      return new Response(JSON.stringify({ revision: api.revision }), { status: 200 });
    }
    if (api.stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision: api.revision, state: api.stored }), { status: 200 });
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

async function montar() {
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate(); // usuario nuevo: siembra vacía y guarda
  const { OpeningCard } = await import("@/components/OpeningCard");
  const { container } = render(React.createElement(OpeningCard));
  return { store, container };
}

describe("BG-072 · la tarjeta de arranque y una categoría nueva", () => {
  it("BG-072a: crear una categoría deja la tarjeta en pantalla y no declara el inicio", async () => {
    const { store, container } = await montar();
    expect(container.innerHTML).not.toBe(""); // la tarjeta está: usuario nuevo sin declarar

    await act(async () => {
      const id = store.getState().createNode({ level: "category", parentId: "g-esenciales", type: "expense", name: "Mascotas" });
      expect(id).not.toBeNull();
      await delay(150);
    });

    expect(api.starts).toBe(0);
    expect(store.getState().data.startMonth ?? null).toBeNull();
    expect(store.getState().data.openingBalance ?? null).toBeNull();
    expect(container.innerHTML).not.toBe("");
  });

  it("BG-072b: la primera cifra sí la responde — el estado 4 de FR-2203 sigue vivo", async () => {
    const { store, container } = await montar();
    const cur = store.getState().activePeriods()[0]!;

    await act(async () => {
      store.getState().createNode({ level: "category", parentId: "g-esenciales", type: "expense", name: "Mascotas" });
      store.getState().setLeafAmount("c-vivienda", cur, "budget", 100);
      await delay(150);
    });

    expect(api.starts).toBe(1);
    expect(store.getState().data.openingBalance).toBe(0);
    expect(screen.queryByText("¿Cuánto tienes hoy?")).toBeNull();
    expect(container.innerHTML).toBe("");
  });
});
