// @vitest-environment jsdom
/**
 * Feature tony-ledger · EP-04 — la etiqueta del agente en el Detalle de la celda (FR-3414).
 *
 * Módulo:       tests/integration/tony-ledger-etiqueta.test.ts
 * Propósito:    El libro llega del servidor con un movimiento marcado y otro sin marcar; el cliente lo
 *               valida con su esquema, lo guarda en el store y el Detalle pinta la etiqueta SOLO en
 *               el marcado. Cubre el camino entero del dato en el navegador, sin base de datos.
 * Dependencias: el store real, BudgetGrid real, un `fetch` simulado que hace de servidor.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, screen, fireEvent, within } from "@testing-library/react";
import type { LedgerState, PeriodKey } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = { revision: 0, stored: null as LedgerState | null };

beforeEach(() => {
  api.revision = 0; api.stored = null;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    if (String(url).includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if ((req?.method ?? "GET") === "PUT") {
      api.revision += 1; api.stored = (JSON.parse(String(req!.body)) as { state: LedgerState }).state;
      return new Response(JSON.stringify({ revision: api.revision }), { status: 200 });
    }
    if (api.stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision: api.revision, state: api.stored }), { status: 200 });
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("FR-3414 — la app muestra qué movimientos registró el agente", () => {
  it("TC-AGT-144h: la fila se pinta con el nombre que trae el movimiento y lo expone a lectores de pantalla", async () => {
    // @aitri-tc TC-AGT-144h
    // 1) Un libro con dos gastos en Vivienda, guardado «en el servidor».
    vi.resetModules();
    const primero = (await import("@/state/store")).useLedgerStore;
    await primero.getState().hydrate();
    const cur = primero.getState().activePeriods()[0]! as PeriodKey;
    const dia = `${cur.slice(0, 7)}-05T12:00`;
    expect(primero.getState().addMovementInCell({ leafId: "c-vivienda", period: cur, amount: 50_000, date: dia, note: "Del agente" })).toBe(true);
    expect(primero.getState().addMovementInCell({ leafId: "c-vivienda", period: cur, amount: 80_000, date: dia, note: "A mano" })).toBe(true);
    for (let i = 0; i < 50 && (api.stored?.movements.length ?? 0) < 2; i++) await act(async () => { await delay(20); });
    expect(api.stored?.movements).toHaveLength(2);

    // 2) El servidor marca UNO como registrado por un agente (es él quien pone la marca).
    api.stored = {
      ...api.stored!,
      movements: api.stored!.movements.map((m) =>
        m.note === "Del agente" ? { ...m, origin: { ref: "L300", agentId: "agt_1", agentName: "Agent-L" } } : m),
    };
    cleanup();

    // 3) Un navegador nuevo carga ese libro: pasa por la validación del cliente y llega al Detalle.
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const cargados = store.getState().data.movements;
    expect(cargados.find((m) => m.note === "Del agente")?.origin).toEqual({ ref: "L300", agentId: "agt_1", agentName: "Agent-L" });
    expect(cargados.find((m) => m.note === "A mano")).not.toHaveProperty("origin");

    const { BudgetGrid } = await import("@/components/BudgetGrid");
    await act(async () => { render(React.createElement(BudgetGrid)); await delay(0); });
    const celda = document.querySelector<HTMLElement>(`[data-cell="c-vivienda"][data-month="${cur}"][data-plane="actual"]`)!;
    await act(async () => { fireEvent.click(celda); await delay(0); });

    const filas = screen.getAllByTestId("detail-row").filter((f) => f.getAttribute("data-kind") === "movement");
    expect(filas).toHaveLength(2);
    const etiquetas = screen.getAllByTestId("agent-tag");
    expect(etiquetas).toHaveLength(1);
    expect(etiquetas[0].textContent).toBe("Agent-L");
    expect(etiquetas[0].getAttribute("aria-label")).toBe("Registrado por Agent-L");
    expect(etiquetas[0].getAttribute("title")).toBe("Agent-L");

    const delAgente = filas.find((f) => f.textContent?.includes("Del agente"))!;
    const aMano = filas.find((f) => f.textContent?.includes("A mano"))!;
    expect(within(delAgente).getByTestId("agent-tag").textContent).toBe("Agent-L");
    expect(within(aMano).queryByTestId("agent-tag")).toBeNull();
  });
});
