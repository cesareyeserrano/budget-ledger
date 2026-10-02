// @vitest-environment jsdom
/**
 * BL-065 — las acciones del store que ninguna prueba ejecutaba.
 *
 * El store (src/state/store.ts) estaba fuera de la medición de cobertura, y es donde la auditoría del
 * 28-sep encontró tres de sus defectos altos. Al medirlo salieron sin una sola ejecución: renombrar
 * un nodo, cambiarle el icono, borrar un movimiento, el horizonte, el retiro planeado y dos de las
 * tres ramas de «rechazo definitivo» de la cola de guardado. Aquí se ejercitan contra un stub de la
 * API, comprobando lo que LLEGA al servidor y lo que queda en pantalla, no que la función se llamó.
 *
 * El store es un singleton de módulo: cada prueba lo re-importa tras stubbear fetch.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { LedgerState, Movement } from "@/domain/types";
import { buildSeedConMontos as buildSeed } from "../helpers/seedConMontos";
import { P0 } from "../helpers/periods";

const MERCADO = "s-comida-mercado";
type Rechazo = { status: number; body: unknown };

/** Stub de la API. `rechazarProximoPut` hace que el siguiente PUT del ledger falle con ese cuerpo. */
function stubApi(inicial: LedgerState) {
  let guardado = inicial;
  let revision = 1;
  let rechazo: Rechazo | null = null;
  const llamadas: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    llamadas.push({ url: String(url), method, body });
    if (String(url).includes("/preferences/horizon")) return new Response(JSON.stringify({ horizon: body?.horizon ?? 2 }), { status: 200 });
    if (method === "PUT") {
      if (rechazo) {
        const r = rechazo;
        rechazo = null;
        return new Response(JSON.stringify(r.body), { status: r.status });
      }
      guardado = (body as { state: LedgerState }).state;
      revision += 1;
      return new Response(JSON.stringify({ revision }), { status: 200 });
    }
    return new Response(JSON.stringify({ revision, state: guardado }), { status: 200 });
  }));
  return {
    llamadas,
    rechazarProximoPut: (r: Rechazo) => { rechazo = r; },
    putsDelLedger: () => llamadas.filter((c) => c.method === "PUT" && c.url.endsWith("/api/v1/ledger")),
    get guardado() { return guardado; },
  };
}

async function storeHidratado(inicial: LedgerState) {
  const api = stubApi(inicial);
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  return { api, store };
}

/** La semilla poblada con UN movimiento de gasto en Mercado, y su celda cuadrada con él. */
function conMovimiento(extra: Partial<LedgerState> = {}): LedgerState {
  const s = buildSeed("local", P0);
  const mov: Movement = {
    id: "m-1", ownerId: "local", type: "expense", catId: "c-comida", subId: MERCADO, target: MERCADO,
    amount: 1_000, period: P0, createdAt: 1,
  } as Movement;
  return {
    ...s,
    actuals: { ...s.actuals, [MERCADO]: { ...s.actuals[MERCADO], [P0]: (s.actuals[MERCADO]?.[P0] ?? 0) + 1_000 } },
    movements: [...s.movements, mov],
    ...extra,
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("BL-065 · renombrar y cambiar el icono llegan al servidor", () => {
  it("BL-065: el nombre nuevo queda en pantalla y es el que viaja en el PUT", async () => {
    const { api, store } = await storeHidratado(buildSeed("local", P0));
    store.getState().renameNode(MERCADO, "Supermercado");
    expect(store.getState().data.nodes.find((n) => n.id === MERCADO)!.name).toBe("Supermercado");
    await vi.waitFor(() => expect(api.guardado.nodes.find((n) => n.id === MERCADO)!.name).toBe("Supermercado"));
  });

  it("BL-065: el icono nuevo viaja en el PUT, y los demás nodos no cambian", async () => {
    const inicial = buildSeed("local", P0);
    const { api, store } = await storeHidratado(inicial);
    store.getState().setNodeIcon(MERCADO, "shopping-cart");
    await vi.waitFor(() => expect(api.guardado.nodes.find((n) => n.id === MERCADO)!.icon).toBe("shopping-cart"));
    const otros = (s: LedgerState) => s.nodes.filter((n) => n.id !== MERCADO);
    expect(otros(api.guardado)).toEqual(otros(inicial));
  });
});

describe("BL-065 · borrar un movimiento desde el store", () => {
  it("BL-065: un id que no existe se rechaza sin guardar nada", async () => {
    const { api, store } = await storeHidratado(conMovimiento());
    expect(store.getState().deleteMovement("no-existe")).toEqual({ ok: false, reason: "not_found" });
    expect(api.putsDelLedger()).toHaveLength(0);
  });

  it("BL-065: borrar un movimiento lo quita, baja su celda y eso es lo que se guarda", async () => {
    const inicial = conMovimiento();
    const { api, store } = await storeHidratado(inicial);
    expect(store.getState().deleteMovement("m-1")).toEqual({ ok: true });
    expect(store.getState().data.movements.some((m) => m.id === "m-1")).toBe(false);
    expect(store.getState().data.actuals[MERCADO]?.[P0] ?? 0).toBe((inicial.actuals[MERCADO]![P0] ?? 0) - 1_000);
    await vi.waitFor(() => expect(api.guardado.movements.some((m) => m.id === "m-1")).toBe(false));
  });

  it("BL-065: en un mes cerrado no se borra y no se guarda", async () => {
    const { api, store } = await storeHidratado(conMovimiento({ closure: { closedThrough: P0, reopened: null } }));
    expect(store.getState().deleteMovement("m-1")).toEqual({ ok: false, reason: "closed" });
    expect(store.getState().data.movements.some((m) => m.id === "m-1")).toBe(true);
    expect(api.putsDelLedger()).toHaveLength(0);
  });
});

describe("BL-065 · un rechazo definitivo del servidor converge y lo dice", () => {
  const casos = [
    {
      nombre: "un mes cerrado",
      rechazo: { status: 422, body: { error: { code: "closed_period_violation", detail: { periods: [P0] } } } },
      aviso: "Ese mes está cerrado: el cambio no se guardó.",
    },
    {
      nombre: "una celda que no cuadra con sus movimientos",
      rechazo: { status: 422, body: { error: { code: "cell_movement_mismatch", detail: [{ nodeId: MERCADO, period: P0 }] } } },
      aviso: "Esa celda no cuadra con sus movimientos: el cambio no se guardó.",
    },
  ];
  for (const caso of casos) {
    it(`BL-065: ${caso.nombre} — vuelve a lo del servidor, avisa y no reintenta`, async () => {
      const inicial = buildSeed("local", P0);
      const antes = inicial.budgets[MERCADO]![P0];
      const { api, store } = await storeHidratado(inicial);

      api.rechazarProximoPut(caso.rechazo);
      store.getState().setLeafAmount(MERCADO, P0, "budget", 987_654);
      expect(store.getState().data.budgets[MERCADO]![P0]).toBe(987_654); // optimista

      await vi.waitFor(() => expect(store.getState().toast).toBe(caso.aviso));
      // Converge: en pantalla vuelve a estar lo que el servidor tiene, no lo rechazado.
      expect(store.getState().data.budgets[MERCADO]![P0]).toBe(antes);
      expect(api.guardado.budgets[MERCADO]![P0]).toBe(antes);
      // Y no queda reintentando: un solo PUT, el rechazado. No hay banner de «no se pudo guardar».
      expect(api.putsDelLedger()).toHaveLength(1);
      expect(store.getState().storageError).toBeNull();
    });
  }
});

describe("BL-065 · el horizonte es una preferencia de la cuenta", () => {
  it("BL-065: cambiarlo hace un PUT propio y no toca el snapshot del ledger", async () => {
    const { api, store } = await storeHidratado(buildSeed("local", P0));
    const otro = store.getState().horizon === 1 ? 2 : 1;
    store.getState().setHorizon(otro);
    expect(store.getState().horizon).toBe(otro);
    const alHorizonte = () => api.llamadas.filter((c) => c.url.includes("/preferences/horizon") && c.method === "PUT");
    expect(alHorizonte()).toHaveLength(1);
    expect(alHorizonte()[0]!.body).toEqual({ horizon: otro });
    expect(api.putsDelLedger()).toHaveLength(0);

    // El mismo valor otra vez no pide nada.
    store.getState().setHorizon(otro);
    expect(alHorizonte()).toHaveLength(1);
  });
});
