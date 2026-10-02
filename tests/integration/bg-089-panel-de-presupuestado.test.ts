// @vitest-environment jsdom
/**
 * BG-089 — el panel de la celda de Presupuestado muestra solo SUS comentarios.
 *
 * Las dos celdas del mes montaban el mismo Detalle: la de Presupuestado listaba los movimientos del
 * Ejecutado, ofrecía «Añadir movimiento» y mostraba los comentarios de la otra celda. Ahora cada una
 * tiene los suyos, y la marca de «tiene comentarios» se enciende en la celda donde se escribieron.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";
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

/** La grilla con Vivienda: 900.000 presupuestados, un gasto de 300.000 y un comentario en Ejecutado. */
async function grilla() {
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  const cur = store.getState().activePeriods()[0]! as PeriodKey;
  store.getState().setLeafAmount("c-vivienda", cur, "budget", 900_000);
  expect(store.getState().addMovementInCell({ leafId: "c-vivienda", period: cur, amount: 300_000, date: `${cur.slice(0, 7)}-05T12:00`, note: "Arriendo" })).toBe(true);
  expect(store.getState().addCellNote("c-vivienda", cur, "Se dañó la nevera")).toBe(true);
  const { BudgetGrid } = await import("@/components/BudgetGrid");
  await act(async () => { render(React.createElement(BudgetGrid)); await delay(0); });
  const celda = (plane: "budget" | "actual") => document.querySelector<HTMLElement>(`[data-cell="c-vivienda"][data-month="${cur}"][data-plane="${plane}"]`)!;
  const abrir = async (plane: "budget" | "actual") => { await act(async () => { fireEvent.click(celda(plane)); await delay(0); }); };
  const cerrar = async () => { await act(async () => { fireEvent.click(screen.getByTestId("cell-cancel")); await delay(0); }); };
  const filas = () => screen.queryAllByTestId("detail-row").map((el) => `${el.getAttribute("data-kind")}:${el.textContent}`);
  return { store, cur, celda, abrir, cerrar, filas };
}

describe("BG-089 · el panel de cada celda", () => {
  it("BG-089: la celda de Presupuestado no muestra el comentario ni el movimiento del Ejecutado", async () => {
    const { abrir, filas } = await grilla();
    await abrir("budget");
    expect(filas()).toEqual([]);
    expect(screen.getByTestId("cell-notes-empty").textContent).toBe("Sin comentarios");
    // Ni la línea de añadir movimiento ni su atajo: aquí solo se comenta.
    expect(screen.queryByTestId("comment-reveal")).toBeNull();
    expect(screen.queryByLabelText("Monto")).toBeNull();
    expect(screen.getByLabelText("Añadir comentario")).toBeTruthy();
  });

  it("BG-089: la de Ejecutado sigue mostrando su movimiento y su comentario", async () => {
    const { abrir, filas } = await grilla();
    await abrir("actual");
    const f = filas();
    expect(f).toHaveLength(2);
    expect(f.some((x) => x.startsWith("movement:") && x.includes("Arriendo"))).toBe(true);
    expect(f.some((x) => x.startsWith("comment:") && x.includes("Se dañó la nevera"))).toBe(true);
  });

  it("BG-089: un comentario escrito en Presupuestado queda en esa celda, con su marca, y no pasa a Ejecutado", async () => {
    const { store, cur, celda, abrir, cerrar, filas } = await grilla();
    expect(celda("actual").querySelector('[data-testid="note-dot"]')).not.toBeNull();
    expect(celda("budget").querySelector('[data-testid="note-dot"]')).toBeNull();

    await abrir("budget");
    fireEvent.change(screen.getByLabelText("Añadir comentario"), { target: { value: "Sube el arriendo en enero" } });
    await act(async () => { fireEvent.click(screen.getByTestId("cell-note-add")); await delay(0); });
    expect(filas()).toEqual([expect.stringContaining("Sube el arriendo en enero")]);
    await cerrar();

    expect(celda("budget").querySelector('[data-testid="note-dot"]')).not.toBeNull();
    const notas = store.getState().data.cellNotes!["c-vivienda"]![cur]!;
    expect(notas.map((n) => [n.text, n.plane])).toEqual([["Se dañó la nevera", undefined], ["Sube el arriendo en enero", "budget"]]);

    await abrir("actual");
    expect(filas().some((x) => x.includes("Sube el arriendo en enero"))).toBe(false);
    expect(filas().some((x) => x.includes("Se dañó la nevera"))).toBe(true);
  });
});
