// @vitest-environment jsdom
/**
 * BG-067 (revisión adversarial) — la tarjeta de arranque no pisa una apertura declarada en otro dispositivo.
 *
 * La tarjeta declara «este mes, saldo 0» en cuanto se teclea la primera cifra, y reintenta ante un 409.
 * El reintento salía con los mismos argumentos aunque la recarga del conflicto ya hubiera traído la
 * apertura que otro dispositivo acababa de declarar: la reemplazaba por «este mes, saldo 0».
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { LedgerState } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const api = { revision: 0, stored: null as LedgerState | null };

beforeEach(() => {
  api.revision = 0; api.stored = null;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    const u = String(url);
    const method = req?.method ?? "GET";
    if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if (method === "PUT" && u.endsWith("/api/v1/ledger/start")) {
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

describe("BG-067 · la tarjeta de arranque y una apertura ajena", () => {
  it("si otro dispositivo ya declaró la apertura, la primera cifra de este no la reemplaza", async () => {
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate(); // usuario nuevo: siembra y guarda
    const { OpeningCard } = await import("@/components/OpeningCard");
    render(React.createElement(OpeningCard));
    const cur = store.getState().activePeriods()[0]!;

    // Otro dispositivo declara junio con 500.
    api.stored = { ...api.stored!, startMonth: "2026-06", openingBalance: 500 } as LedgerState;
    api.revision += 1;

    // Este teclea su primera cifra: la tarjeta intenta declarar «este mes, saldo 0».
    await act(async () => {
      store.getState().setLeafAmount("c-vivienda", cur, "budget", 100);
      await delay(150);
    });

    expect(api.stored!.startMonth).toBe("2026-06");
    expect(api.stored!.openingBalance).toBe(500);
    expect(store.getState().data.startMonth).toBe("2026-06");
  });
});
