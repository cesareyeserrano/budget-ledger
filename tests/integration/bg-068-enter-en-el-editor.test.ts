// @vitest-environment jsdom
/**
 * BG-068 — elegir la categoría con Enter en el editor de movimientos ya no guarda la anterior.
 *
 * El contenedor del editor confirmaba con cualquier Enter. La lista de categorías (un Select de Radix)
 * vive en un portal y React propaga los eventos a través de los portales, así que el Enter que elegía
 * una opción llegaba también al contenedor: guardaba con la categoría de antes y cerraba el editor.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

const p2 = (n: number) => String(n).padStart(2, "0");
const hoy = new Date();
const MES = `${hoy.getFullYear()}-${p2(hoy.getMonth() + 1)}` as PeriodKey;
const DIA = `${MES}-${p2(Math.min(hoy.getDate(), 28))}T10:00`;

const NODES: LedgerNode[] = [
  { id: "g", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Esenciales", icon: null, order: 0 },
  { id: "c", ownerId: "local", type: "expense", level: "category", parentId: "g", name: "Comida", icon: null, order: 1 },
  { id: "s1", ownerId: "local", type: "expense", level: "sub", parentId: "c", name: "Mercado", icon: null, order: 2 },
  { id: "s2", ownerId: "local", type: "expense", level: "sub", parentId: "c", name: "Restaurantes", icon: null, order: 3 },
];
const MV: Movement = {
  id: "m1", ownerId: "local", type: "expense", catId: "c", subId: "s1", target: "s1",
  amount: 30_000, period: MES, createdAt: 1, date: DIA,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = vi.fn();
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

async function montar() {
  vi.resetModules();
  const { useLedgerStore } = await import("@/state/store");
  const data = { ownerId: "local", nodes: NODES, budgets: {}, actuals: { s1: { [MES]: 30_000 } }, movements: [MV] } as LedgerState;
  useLedgerStore.setState({ data, hydrated: true });
  const { MovementEditor } = await import("@/components/MovementEditor");
  const onDone = vi.fn();
  render(React.createElement(MovementEditor, { movement: MV, month: MES, onDone }));
  return { useLedgerStore, onDone };
}

describe("BG-068 · el Enter de la lista de categorías no confirma el editor", () => {
  it("elegir otra categoría con el teclado la cambia y deja el editor abierto; Enter en el monto guarda la nueva", async () => {
    const { useLedgerStore, onDone } = await montar();
    const trigger = screen.getByTestId("edit-category");
    trigger.focus();
    await act(async () => { fireEvent.keyDown(trigger, { key: "Enter" }); });
    expect(onDone).not.toHaveBeenCalled(); // abrir la lista no confirma

    const opcion = await screen.findByRole("option", { name: "Restaurantes" });
    opcion.focus();
    await act(async () => { fireEvent.keyDown(opcion, { key: "Enter" }); });
    expect(onDone).not.toHaveBeenCalled(); // elegir la opción tampoco
    expect(useLedgerStore.getState().data.movements[0]!.target).toBe("s1"); // aún sin guardar

    const monto = screen.getByLabelText("Monto");
    await act(async () => { fireEvent.keyDown(monto, { key: "Enter" }); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(useLedgerStore.getState().data.movements[0]!.target).toBe("s2");
  });

  it("Enter en el monto sigue confirmando, y Escape sigue cancelando", async () => {
    const { onDone } = await montar();
    const monto = screen.getByLabelText("Monto");
    await act(async () => { fireEvent.keyDown(monto, { key: "Escape" }); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
