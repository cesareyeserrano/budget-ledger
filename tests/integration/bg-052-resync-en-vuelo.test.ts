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
  /** Status con que responder el PRÓXIMO GET o PUT del ledger (0 = normal). */
  failNextGet: number;
  failNextPut: number;
  /** Lo que el servidor escribe al aplicar un cambio de modo (simula la reubicación). */
  onCycles?: (s: LedgerState) => void;
  puts: Array<{ baseRevision: number; status: number }>;
}

function stubServer(): Api {
  const api: Api = { revision: 0, stored: null, getLatencyMs: 0, putLatencyMs: 0, failNextGet: 0, failNextPut: 0, puts: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, req?: RequestInit) => {
      const u = String(url);
      if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
      if (u.includes("/ledger/cycles") && (req?.method ?? "GET") === "PUT") {
        api.revision += 1;
        api.onCycles?.(api.stored!);
        return new Response(JSON.stringify({ revision: api.revision }), { status: 200 });
      }
      if ((req?.method ?? "GET") === "PUT") {
        const body = JSON.parse(String(req!.body)) as { baseRevision: number; state: LedgerState };
        if (api.putLatencyMs) await delay(api.putLatencyMs);
        if (api.failNextPut) {
          const st = api.failNextPut; api.failNextPut = 0;
          api.puts.push({ baseRevision: body.baseRevision, status: st });
          return new Response("{}", { status: st });
        }
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
      const falla = api.failNextGet; api.failNextGet = 0;
      if (api.getLatencyMs) await delay(api.getLatencyMs);
      if (falla) return new Response("{}", { status: falla });
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

  // ── Revisión adversarial (2026-09-29) ─────────────────────────────────────────────────────────

  it("conflicto con edición durante la recarga de convergencia: el servidor gana, avisando, y no se pisa lo ajeno", async () => {
    const { api, store, cur } = await setup();
    const ajeno: LedgerState = JSON.parse(JSON.stringify(api.stored));
    ajeno.budgets["c-salario"] = { [cur]: 7_000 };
    api.stored = ajeno;
    api.revision += 1;

    const desde = api.puts.length;
    api.getLatencyMs = 60; // la recarga de convergencia tarda
    store.getState().setLeafAmount("c-vivienda", cur, "budget", 150); // → 409
    await delay(30);
    store.getState().setLeafAmount("c-transporte", cur, "budget", 200); // mientras viaja la recarga
    await delay(120);
    api.getLatencyMs = 0;
    await delay(40);

    expect(api.stored!.budgets["c-salario"]?.[cur]).toBe(7_000);
    // Después del arranque solo hubo el 409: ningún guardado con datos viejos llegó a aceptarse.
    expect(api.puts.slice(desde).map((p) => p.status)).toEqual([409]);
    expect(store.getState().data.budgets["c-salario"]?.[cur]).toBe(7_000);
    expect(store.getState().toast).toMatch(/Otro dispositivo/);
  });

  it("tras un conflicto cuya recarga falló, un fallo de red posterior se avisa como fallo de red", async () => {
    const { api, store, cur } = await setup();
    const ajeno: LedgerState = JSON.parse(JSON.stringify(api.stored));
    ajeno.budgets["c-salario"] = { [cur]: 7_000 };
    api.stored = ajeno;
    api.revision += 1;

    api.failNextGet = 503; // la recarga del conflicto no llega
    store.getState().setLeafAmount("c-vivienda", cur, "budget", 150); // → 409
    await delay(40);
    await delay(2_100); // se va el aviso del conflicto

    api.failNextPut = 500;
    store.getState().setLeafAmount("c-transporte", cur, "budget", 300);
    await delay(40);
    // BG-088: el fallo de red NO se trata como otro conflicto (ni aviso de «otro dispositivo» ni
    // edición descartada), que es lo que esta prueba vigila. Lo que cambió es el aviso fijo: con la
    // recarga del conflicto todavía debida, el que vale es el suyo —lo de pantalla se va a descartar
    // cuando esa recarga llegue—, no el de «tus datos siguen intactos, reintenta».
    expect(store.getState().storageError).toBe("conflict");
    expect(store.getState().toast).toBe(null);
    expect(store.getState().data.budgets["c-transporte"]?.[cur]).toBe(300); // la edición sigue en pantalla
  });

  it("una edición hecha tras cambiar de modo, antes de recargar, no pisa lo que el servidor reescribió", async () => {
    const { api, store, cur } = await setup();
    api.onCycles = (s) => { s.budgets["c-salario"] = { [cur]: 7_000 }; }; // la reubicación del servidor
    api.getLatencyMs = 60;
    const aplicar = store.getState().applyPeriodMode({ mode: "cycle", anchorDay: 21 } as never);
    await delay(20);
    store.getState().setLeafAmount("c-vivienda", cur, "budget", 150); // antes de que vuelva la recarga
    await aplicar;
    api.getLatencyMs = 0;
    await delay(60);

    expect(api.stored!.budgets["c-salario"]?.[cur]).toBe(7_000);
    expect(store.getState().data.budgets["c-salario"]?.[cur]).toBe(7_000);
  });
});

