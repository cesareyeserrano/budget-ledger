// @vitest-environment jsdom
/**
 * BG-052 — una recarga desde el servidor que ya está en vuelo no pisa lo que el usuario teclea.
 *
 * El defecto: `resync()` solo miraba si había un guardado pendiente AL EMPEZAR. Si el usuario
 * confirmaba una celda mientras el GET viajaba —y cada guardado propio dispara uno, por el eco del
 * sync en vivo—, el GET volvía con el estado anterior, `set({ data })` lo pintaba encima y la
 * edición desaparecía de la pantalla; la siguiente la borraba también del servidor. Además `load()`
 * adoptaba la revisión del snapshot aunque llegara vieja.
 *
 * El contrato nuevo: una recarga cuyo resultado llega después de un cambio local se DESCARTA, datos
 * y revisión. Si el cambio del servidor era de otro dispositivo, el guardado siguiente recibe 409 y
 * el conflicto se resuelve como siempre: se recarga y se avisa.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { LedgerState } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Api {
  revision: number;
  stored: LedgerState | null;
  getLatencyMs: number;
  putLatencyMs: number;
  puts: Array<{ baseRevision: number; status: number }>;
}

function stubServer(): Api {
  const api: Api = { revision: 0, stored: null, getLatencyMs: 0, putLatencyMs: 0, puts: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, req?: RequestInit) => {
      const u = String(url);
      if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
      if ((req?.method ?? "GET") === "PUT") {
        const body = JSON.parse(String(req!.body)) as { baseRevision: number; state: LedgerState };
        if (api.putLatencyMs) await delay(api.putLatencyMs);
        if (body.baseRevision !== api.revision) {
          api.puts.push({ baseRevision: body.baseRevision, status: 409 });
          return new Response(JSON.stringify({ error: { code: "revision_conflict" }, revision: api.revision }), { status: 409 });
        }
        api.revision += 1;
        api.stored = body.state;
        api.puts.push({ baseRevision: body.baseRevision, status: 200 });
        return new Response(JSON.stringify({ revision: api.revision }), { status: 200 });
      }
      // El snapshot se toma cuando LLEGA la petición; la latencia es la respuesta volviendo.
      const snapshot = api.stored === null ? null : JSON.stringify({ revision: api.revision, state: api.stored });
      if (api.getLatencyMs) await delay(api.getLatencyMs);
      if (snapshot === null) return new Response(null, { status: 204 });
      return new Response(snapshot, { status: 200 });
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
  expect(api.stored!.budgets["c-vivienda"]?.[cur]).toBe(100);
  return { api, store, cur };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

describe("BG-052 · una recarga en vuelo no pisa la edición local", () => {
  it("el PUT responde antes que el GET: la edición sigue en pantalla y la siguiente se guarda sin conflicto", async () => {
    const { api, store, cur } = await setup();
    api.getLatencyMs = 60;
    const resync = store.getState().resync(); // nada en vuelo: sale un GET
    await delay(10);
    store.getState().setLeafAmount("c-transporte", cur, "budget", 555); // tecleado mientras viaja
    await resync;
    await delay(20);
    expect(api.stored!.budgets["c-transporte"]?.[cur]).toBe(555);
    expect(store.getState().data.budgets["c-transporte"]?.[cur]).toBe(555);

    api.getLatencyMs = 0;
    store.getState().setLeafAmount("c-vivienda", cur, "budget", 200);
    await delay(40);
    expect(api.puts.at(-1)!.status).toBe(200);
    expect(api.puts.some((p) => p.status === 409)).toBe(false);
    expect(store.getState().toast).toBe(null);
    expect(api.stored!.budgets["c-vivienda"]?.[cur]).toBe(200);
    expect(api.stored!.budgets["c-transporte"]?.[cur]).toBe(555);
  });

  it("el GET responde antes que un PUT lento: la siguiente edición no borra la anterior del servidor", async () => {
    const { api, store, cur } = await setup();
    api.getLatencyMs = 60;
    api.putLatencyMs = 100;
    const resync = store.getState().resync();
    await delay(10);
    store.getState().setLeafAmount("c-transporte", cur, "budget", 555);
    await resync;
    expect(store.getState().data.budgets["c-transporte"]?.[cur]).toBe(555);
    await delay(120);

    api.getLatencyMs = 0; api.putLatencyMs = 0;
    store.getState().setLeafAmount("c-vivienda", cur, "budget", 200);
    await delay(40);
    expect(api.puts.at(-1)!.status).toBe(200);
    expect(api.stored!.budgets["c-transporte"]?.[cur]).toBe(555);
    expect(api.stored!.budgets["c-vivienda"]?.[cur]).toBe(200);
    expect(store.getState().storageError).toBe(null);
  });

  it("control: sin cambio local, la recarga sí trae lo que escribió otro dispositivo", async () => {
    const { api, store, cur } = await setup();
    const ajeno: LedgerState = JSON.parse(JSON.stringify(api.stored));
    ajeno.budgets["c-salario"] = { [cur]: 7_000 };
    api.stored = ajeno;
    api.revision += 1;

    await store.getState().resync();
    expect(store.getState().data.budgets["c-salario"]?.[cur]).toBe(7_000);

    store.getState().setLeafAmount("c-vivienda", cur, "budget", 300);
    await delay(40);
    expect(api.puts.at(-1)!.status).toBe(200); // adoptó la revisión nueva: nada de conflicto
    expect(api.stored!.budgets["c-salario"]?.[cur]).toBe(7_000);
  });

  it("otro dispositivo escribió y el usuario edita durante la recarga: no se pisa en silencio, hay 409 y aviso", async () => {
    const { api, store, cur } = await setup();
    const ajeno: LedgerState = JSON.parse(JSON.stringify(api.stored));
    ajeno.budgets["c-salario"] = { [cur]: 7_000 };
    api.stored = ajeno;
    api.revision += 1;
    api.getLatencyMs = 60;

    const resync = store.getState().resync();
    await delay(10);
    store.getState().setLeafAmount("c-transporte", cur, "budget", 555);
    await resync;
    api.getLatencyMs = 0;
    await delay(60);

    // La escritura ajena no se borró del servidor: el guardado local salió con la revisión que
    // este dispositivo conocía, recibió 409 y el conflicto se resolvió avisando.
    expect(api.puts.some((p) => p.status === 409)).toBe(true);
    expect(api.stored!.budgets["c-salario"]?.[cur]).toBe(7_000);
    expect(store.getState().toast).toMatch(/Otro dispositivo/);
    expect(store.getState().data.budgets["c-salario"]?.[cur]).toBe(7_000);
  });
});
