// @vitest-environment jsdom
/**
 * BG-067 — declarar la apertura o cambiar de modo ya no deja la puerta abierta a pisar a otro dispositivo.
 *
 * Un 409 en esas dos escrituras dejaba en el repositorio la revisión del servidor SIN sus datos, y el
 * store no recargaba: la edición siguiente salía con la revisión nueva sobre datos viejos, el servidor
 * la aceptaba y lo que había guardado el otro dispositivo se perdía sin aviso. Ahora se converge.
 *
 * Y la carrera inversa: la tarjeta de arranque declara la apertura en cuanto se teclea la primera
 * celda. Si la declaración llegaba antes que el guardado de esa celda, era el guardado el que recibía
 * el 409 y la cifra tecleada se descartaba con un falso «otro dispositivo». Ahora espera a la cola.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { LedgerState } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Api {
  revision: number;
  stored: LedgerState | null;
  putLatencyMs: number;
  statuses: Array<{ path: string; status: number }>;
}

function stubServer(): Api {
  const api: Api = { revision: 0, stored: null, putLatencyMs: 0, statuses: [] };
  const conflicto = (path: string) => {
    api.statuses.push({ path, status: 409 });
    return new Response(JSON.stringify({ error: { code: "revision_conflict" }, revision: api.revision }), { status: 409 });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, req?: RequestInit) => {
      const u = String(url);
      const method = req?.method ?? "GET";
      if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
      if (method === "PUT" && u.endsWith("/api/v1/ledger/start")) {
        const b = JSON.parse(String(req!.body)) as { baseRevision: number; startMonth: string; openingBalance: number | null };
        if (b.baseRevision !== api.revision) return conflicto("start");
        api.revision += 1;
        api.stored = { ...api.stored!, startMonth: b.startMonth, openingBalance: b.openingBalance } as LedgerState;
        api.statuses.push({ path: "start", status: 200 });
        return new Response(JSON.stringify({ revision: api.revision, startMonth: b.startMonth, openingBalance: b.openingBalance }), { status: 200 });
      }
      if (method === "PUT" && u.endsWith("/api/v1/ledger/cycles")) {
        const b = JSON.parse(String(req!.body)) as { baseRevision: number };
        if (b.baseRevision !== api.revision) return conflicto("cycles");
        api.revision += 1;
        api.statuses.push({ path: "cycles", status: 200 });
        return new Response(JSON.stringify({ revision: api.revision }), { status: 200 });
      }
      if (method === "PUT") {
        const b = JSON.parse(String(req!.body)) as { baseRevision: number; state: LedgerState };
        if (api.putLatencyMs) await delay(api.putLatencyMs);
        if (b.baseRevision !== api.revision) return conflicto("ledger");
        api.revision += 1;
        // El servidor ignora lo que el cliente diga de la apertura: solo la mueve /ledger/start.
        api.stored = { ...b.state, startMonth: api.stored?.startMonth, openingBalance: api.stored?.openingBalance } as LedgerState;
        api.statuses.push({ path: "ledger", status: 200 });
        return new Response(JSON.stringify({ revision: api.revision }), { status: 200 });
      }
      if (api.stored === null) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ revision: api.revision, state: api.stored }), { status: 200 });
    })
  );
  return api;
}

async function setup() {
  const api = stubServer();
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  const cur = store.getState().activePeriods()[0]!;
  store.getState().setLeafAmount("c-vivienda", cur, "budget", 100);
  await delay(30);
  return { api, store, cur };
}

/** Otro dispositivo escribe: sube la revisión y deja su cifra en el servidor. */
function escrituraAjena(api: Api, cur: string) {
  const ajeno: LedgerState = JSON.parse(JSON.stringify(api.stored));
  ajeno.budgets["c-salario"] = { [cur]: 7_000 };
  api.stored = ajeno;
  api.revision += 1;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

describe("BG-067 · conflictos al declarar la apertura o cambiar de modo", () => {
  it("un 409 al declarar la apertura converge: la edición siguiente no pisa lo del otro dispositivo", async () => {
    const { api, store, cur } = await setup();
    escrituraAjena(api, cur);

    const r = await store.getState().setStart(cur, 1_000);
    expect(r.ok).toBe(false);
    expect(store.getState().data.budgets["c-salario"]?.[cur]).toBe(7_000); // trajo lo ajeno

    store.getState().setLeafAmount("c-vivienda", cur, "budget", 200);
    await delay(40);
    expect(api.stored!.budgets["c-salario"]?.[cur]).toBe(7_000);
    expect(api.stored!.budgets["c-vivienda"]?.[cur]).toBe(200);
  });

  it("un 409 al cambiar de modo converge y avisa", async () => {
    const { api, store, cur } = await setup();
    escrituraAjena(api, cur);

    const r = await store.getState().applyPeriodMode({ mode: "cycle", anchorDay: 21 } as never);
    expect(r.ok).toBe(false);
    expect(store.getState().data.budgets["c-salario"]?.[cur]).toBe(7_000);
    expect(store.getState().toast).toMatch(/Otro dispositivo/);

    store.getState().setLeafAmount("c-vivienda", cur, "budget", 200);
    await delay(40);
    expect(api.stored!.budgets["c-salario"]?.[cur]).toBe(7_000);
  });

  it("teclear una celda y declarar la apertura a la vez: se guardan las dos, sin conflicto", async () => {
    const { api, store, cur } = await setup();
    api.putLatencyMs = 30;
    const desde = api.statuses.length;

    store.getState().setLeafAmount("c-transporte", cur, "budget", 555); // el PUT viaja 30 ms
    const r = await store.getState().setStart(cur, 0); // la tarjeta declara en seguida
    await delay(60);

    expect(r.ok).toBe(true);
    expect(api.statuses.slice(desde).map((x) => x.status)).not.toContain(409);
    expect(api.stored!.budgets["c-transporte"]?.[cur]).toBe(555);
    expect(api.stored!.startMonth).toBe(cur);
    expect(store.getState().toast).toBe(null);
  });
});
