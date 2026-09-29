// @vitest-environment jsdom
/**
 * BG-056 — en la lista de retiros ejecutados, Escape cancela lo tecleado en vez de guardarlo.
 *
 * `OpRow` hacía blur() al pulsar Escape, y el blur confirmaba el valor que el campo todavía tenía: el
 * retiro quedaba con la cifra que el usuario quería descartar, y teclear 0 + Escape lo BORRABA. La fila
 * del plan (`PlanRow`) ya tenía una guarda para esto; ahora las dos se comportan igual.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { LedgerState } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  let revision = 0;
  let stored: LedgerState | null = null;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    if (String(url).includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if ((req?.method ?? "GET") === "PUT") {
      revision += 1; stored = (JSON.parse(String(req!.body)) as { state: LedgerState }).state;
      return new Response(JSON.stringify({ revision }), { status: 200 });
    }
    if (stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision, state: stored }), { status: 200 });
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

/** Ingreso de 1.000.000, aporte de 500.000 a Ahorros y un retiro de 100.000, todos en el mes en curso. */
async function conRetiro() {
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  const cur = store.getState().activePeriods()[0]!;
  store.getState().setLeafAmount("c-salario", cur, "actual", 1_000_000);
  store.getState().applyReserveEdit("c-ahorros", cur, "actual", 500_000);
  const w = store.getState().applyReserveWithdrawal("c-ahorros", cur, 100_000);
  if ("rejected" in w) throw new Error("preparación: retiro rechazado");
  await delay(30);
  const { WithdrawCell } = await import("@/components/ReserveCells");
  render(React.createElement(WithdrawCell, { month: cur, plane: "actual" }));
  fireEvent.click(screen.getByTestId("withdraw-cell"));
  const input = (await screen.findByTestId(`op-amount-${w.movement.id}`)) as HTMLInputElement;
  return { store, mvId: w.movement.id, input };
}

async function teclearYEscape(input: HTMLInputElement, valor: string) {
  input.focus();
  fireEvent.change(input, { target: { value: valor } });
  fireEvent.keyDown(input, { key: "Escape" });
  await act(async () => { await delay(20); });
}

describe("BG-056 · Escape en la lista de retiros ejecutados", () => {
  it("teclear otra cifra y pulsar Escape deja el retiro como estaba", async () => {
    const { store, mvId, input } = await conRetiro();
    await teclearYEscape(input, "40000");
    expect(store.getState().data.movements.find((m) => m.id === mvId)?.amount).toBe(100_000);
    expect(input.value).toBe("100000");
  });

  it("teclear 0 y pulsar Escape NO borra el retiro", async () => {
    const { store, mvId, input } = await conRetiro();
    await teclearYEscape(input, "0");
    expect(store.getState().data.movements.find((m) => m.id === mvId)).toBeDefined();
  });

  it("Enter sigue confirmando la cifra nueva", async () => {
    const { store, mvId, input } = await conRetiro();
    input.focus();
    fireEvent.change(input, { target: { value: "40000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => { await delay(20); });
    expect(store.getState().data.movements.find((m) => m.id === mvId)?.amount).toBe(40_000);
  });
});
