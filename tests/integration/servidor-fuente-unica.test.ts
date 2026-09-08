// @vitest-environment jsdom
/**
 * Feature servidor-fuente-unica — TCs de integración que corren en jsdom contra un stub de la API.
 *
 * Cubren el lado CLIENTE de la feature: que el store construye el repositorio de servidor sin
 * ninguna rama por modo (FR-1101), que ningún flujo de datos del usuario vuelve a localStorage
 * (FR-1103/FR-1104), que la limpieza del espacio ledger.* es quirúrgica (NFR-1101) y que un 409
 * converge por resync (NFR-1103).
 *
 * El store es un singleton de módulo: cada test lo re-importa con vi.resetModules() DESPUÉS de
 * stubbear fetch/localStorage, para que makeRepo() capture el entorno del test y no el del anterior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LedgerState } from "@/domain/types";
import { STORAGE_KEYS } from "@/domain/types";
// NFR-2303 (semilla-intacta): estas pruebas necesitan un ledger CON celdas para operar; su
// intención nunca fue verificar que la semilla traiga dinero. Desde FR-2301 la siembra del
// producto sale vacía, así que componen la semilla poblada de siempre con este helper.
import { buildSeedConMontos as buildSeed } from "../helpers/seedConMontos";
import { P0 } from "../helpers/periods";

const MERCADO = "s-comida-mercado";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Call = { url: string; init?: RequestInit };

/** Stub de la API: el PUT acepta y sube revisión; el GET devuelve lo último guardado. */
function stubApi(initial: LedgerState | null = null) {
  let stored = initial;
  let revision = initial ? 1 : 0;
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (init?.method === "PUT") {
      stored = (JSON.parse(String(init.body)) as { state: LedgerState }).state;
      revision += 1;
      return new Response(JSON.stringify({ revision }), { status: 200 });
    }
    if (stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision, state: stored }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    puts: () => calls.filter((c) => c.init?.method === "PUT"),
    lastPutState: () => {
      const puts = calls.filter((c) => c.init?.method === "PUT");
      const last = puts[puts.length - 1];
      return last ? (JSON.parse(String(last.init!.body)) as { state: LedgerState }).state : null;
    },
    get stored() {
      return stored;
    },
  };
}

/** Espía sobre localStorage que registra cada clave escrita/borrada sin romper el almacén real. */
function spyStorage() {
  const written: string[] = [];
  const removed: string[] = [];
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    written.push(k);
    Storage.prototype.getItem.call(this, k); // no-op de lectura; el valor se guarda abajo
    Object.defineProperty(this, k, { value: v, configurable: true, writable: true });
  });
  const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation((k: string) => {
    removed.push(k);
  });
  return { written, removed, restore: () => { setItem.mockRestore(); removeItem.mockRestore(); } };
}

async function freshStore() {
  vi.resetModules();
  return (await import("@/state/store")).useLedgerStore;
}

/** Espera a que se drene la cola de escrituras del store (un save en vuelo + coalescencia). */
async function settled(getPuts: () => unknown[], atLeast = 1) {
  await vi.waitFor(() => expect(getPuts().length).toBeGreaterThanOrEqual(atLeast));
  await delay(20);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FR-1101 — punto único de construcción del repositorio", () => {
  it("TC-SFU-101h: el store construye un ServerRepository y sus escrituras salen por la API", async () => {
    // @aitri-tc TC-SFU-101h
    const api = stubApi();
    const spy = spyStorage();
    const store = await freshStore();

    store.getState().setLeafAmount(MERCADO, "2026-01", "budget", 250000);
    await settled(api.puts);

    expect(api.puts()).toHaveLength(1);
    expect(api.puts()[0]!.url).toContain("/api/v1/ledger");
    expect(api.lastPutState()!.budgets[MERCADO]!["2026-01"]).toBe(250000);
    // Cero escrituras de datos financieros en localStorage.
    expect(spy.written.filter((k) => k.startsWith("ledger."))).toEqual([]);
    spy.restore();
  });

  it("TC-SFU-101f: ninguna variable de entorno reactiva un repositorio de localStorage", async () => {
    // @aitri-tc TC-SFU-101f
    // El flag ya no existe: definirlo en 'false' —el valor que ANTES forzaba el modo local— no
    // puede cambiar nada, porque ningún código lo lee.
    vi.stubEnv("NEXT_PUBLIC_LEDGER_SERVER_MODE", "false");
    const api = stubApi();
    const spy = spyStorage();
    const store = await freshStore();

    const ok = store.getState().addMovement({ type: "expense", catId: "c-vivienda", amount: 15000, period: "2026-01" });
    expect(ok).toBe(true);
    await settled(api.puts);

    expect(api.lastPutState()!.movements.some((m) => m.amount === 15000)).toBe(true);
    expect(spy.written.filter((k) => k.startsWith("ledger."))).toEqual([]);
    spy.restore();
    vi.unstubAllEnvs();
  });

  it("TC-SFU-106f: romper la construcción del repositorio hace fallar su test (hoy no falla)", async () => {
    // @aitri-tc TC-SFU-106f
    // La rotura se simula donde de verdad ocurriría: sin `window`, makeRepo() devuelve null. Un
    // store sin repositorio NO debe emitir escrituras — y eso es exactamente lo que el TC detecta.
    // (El pass falso que se elimina: TC-BE-027h construía makeRepo() de un módulo que producción
    // nunca invocaba, así que romper el punto real de construcción lo dejaba en verde.)
    const api = stubApi();
    const store = await freshStore();

    // Con repo vivo la escritura sale…
    store.getState().setLeafAmount(MERCADO, "2026-07", "budget", 55000);
    await settled(api.puts);
    const conRepo = api.puts().length;
    expect(conRepo).toBeGreaterThan(0);

    // …y con la construcción rota (SSR: sin window) no sale ninguna.
    const { window: realWindow } = globalThis as unknown as { window: unknown };
    vi.stubGlobal("window", undefined);
    const apiRoto = stubApi();
    const storeRoto = await freshStore();
    storeRoto.getState().setLeafAmount(MERCADO, "2026-07", "budget", 55000);
    await delay(30);
    expect(apiRoto.puts()).toHaveLength(0);
    vi.stubGlobal("window", realWindow);
  });
});

describe("FR-1103 / FR-1104 — Postgres única fuente; localStorage solo preferencias", () => {
  it("TC-SFU-103e: si el guardado falla por red, avisa y NO cae de vuelta a localStorage", async () => {
    // @aitri-tc TC-SFU-103e
    const spy = spyStorage();
    const store = await freshStore();
    // Hidratar primero con la API sana, luego tumbar la red solo para el PUT.
    const api = stubApi(buildSeed("local", P0));
    await store.getState().hydrate();
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ revision: 1, state: api.stored }), { status: 200 });
    }));

    store.getState().setLeafAmount(MERCADO, "2026-02", "actual", 64000);

    // El fallo se avisa (banner) en vez de quedar en silencio, y no lanza.
    await vi.waitFor(() => expect(store.getState().storageError).toBe("network"));
    // El estado en memoria conserva lo que el usuario escribió…
    expect(store.getState().data.actuals[MERCADO]!["2026-02"]).toBe(64000);
    // …y no hubo ningún respaldo a localStorage.
    expect(spy.written.filter((k) => k.startsWith("ledger."))).toEqual([]);
    spy.restore();
  });

  it("TC-SFU-103f: ningún flujo de datos del usuario escribe una clave ledger.* en localStorage", async () => {
    // @aitri-tc TC-SFU-103f
    const api = stubApi();
    const spy = spyStorage();
    const store = await freshStore();

    const s = store.getState();
    const nuevoId = s.createNode({ type: "expense", level: "category", parentId: "g-esenciales", name: "Ocio", icon: "tag" });
    expect(nuevoId).not.toBeNull();
    s.setLeafAmount(nuevoId!, "2026-03", "budget", 80000);
    expect(s.addMovement({ type: "expense", catId: "c-vivienda", amount: 12000, period: "2026-03" })).toBe(true);
    const reserva = s.applyReserveEdit("c-ahorros", "2026-03", "budget", 30000);
    expect("rejected" in reserva).toBe(false);

    await settled(api.puts, 1);

    // Los 4 flujos llegaron al servidor…
    const final = api.lastPutState()!;
    expect(final.nodes.some((n) => n.name === "Ocio")).toBe(true);
    expect(final.movements.some((m) => m.amount === 12000)).toBe(true);
    // …y ninguno tocó el espacio ledger.* del navegador.
    expect(spy.written.filter((k) => k.startsWith("ledger."))).toEqual([]);
    spy.restore();
  });

  it("TC-SFU-104e: con localStorage inutilizable los datos del usuario siguen guardándose", async () => {
    // @aitri-tc TC-SFU-104e
    const api = stubApi(buildSeed("local", P0));
    const revienta = () => { throw new DOMException("QuotaExceededError", "QuotaExceededError"); };
    vi.stubGlobal("localStorage", { setItem: revienta, removeItem: revienta, getItem: () => null, clear: () => {}, key: () => null, length: 0 });
    const store = await freshStore();

    await store.getState().hydrate(); // la limpieza de ledger.* lanza y debe quedar absorbida
    expect(store.getState().hydrated).toBe(true);

    store.getState().setLeafAmount(MERCADO, "2026-04", "budget", 175000);
    await settled(api.puts);

    expect(api.lastPutState()!.budgets[MERCADO]!["2026-04"]).toBe(175000);
  });

  it("TC-SFU-104f: la limpieza borra restos ledger.* preexistentes al hidratar", async () => {
    // @aitri-tc TC-SFU-104f
    stubApi(buildSeed("local", P0));
    localStorage.setItem(STORAGE_KEYS.nodes, '[{"id":"viejo"}]');
    localStorage.setItem(STORAGE_KEYS.budget, '{"viejo":{"2026-01":1}}');
    localStorage.setItem("theme", "dark");
    const store = await freshStore();

    await store.getState().hydrate();

    expect(localStorage.getItem(STORAGE_KEYS.nodes)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.budget)).toBeNull();
    // La preferencia del dispositivo sobrevive: la limpieza es quirúrgica.
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});

describe("FR-1102 — una sesión que muere devuelve al login sin dejar datos en pantalla", () => {
  /** API que sirve un ledger con datos y luego responde 401 a todo (sesión revocada/expirada). */
  function stubSesionQueMuere(state: LedgerState) {
    let viva = true;
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      if (!viva) return new Response("Unauthorized", { status: 401 });
      if (init?.method === "PUT") return new Response(JSON.stringify({ revision: 2 }), { status: 200 });
      return new Response(JSON.stringify({ revision: 1, state }), { status: 200 });
    }));
    return { matar: () => { viva = false; } };
  }

  it("TC-SFU-102e-store: un 401 al guardar descarta los datos en memoria y marca la sesión caída", async () => {
    // @aitri-tc TC-SFU-102e
    // Contraparte en proceso del e2e: lo que el navegador observa (volver al login) depende de que
    // el store distinga el 401 de un fallo de red. Antes ambos acababan en el banner "no pudimos
    // guardar" y la app seguía mostrando las finanzas de una sesión ya muerta.
    const servidor = buildSeed("local", P0);
    servidor.budgets[MERCADO]!["2026-01"] = 424_242;
    const sesion = stubSesionQueMuere(servidor);
    const store = await freshStore();

    await store.getState().hydrate();
    expect(store.getState().data.budgets[MERCADO]!["2026-01"]).toBe(424_242);

    sesion.matar();
    store.getState().setLeafAmount(MERCADO, "2026-01", "budget", 1000);

    await vi.waitFor(() => expect(store.getState().sessionExpired).toBe(true));
    // El dato del usuario ya no está en memoria: no queda nada que un render pueda pintar.
    // NFR-2303 (semilla-intacta): tras matar la sesión el store vuelve a la semilla, que desde
    // FR-2301 no trae celdas — así que la celda ya no EXISTE, que es MÁS fuerte que "vale otra
    // cosa". Se conserva la aserción original y se añade la ausencia; solo se encadena opcional
    // para no reventar al indexar un mapa vacío.
    expect(store.getState().data.budgets[MERCADO]?.["2026-01"]).not.toBe(424_242);
    expect(store.getState().data.budgets[MERCADO]?.["2026-01"]).toBeUndefined();
    expect(store.getState().hydrated).toBe(false);
    // Y NO se confundió con un fallo de red (que solo habría mostrado el banner).
    expect(store.getState().storageError).toBeNull();
  });

  it("TC-SFU-102e-resync: un 401 en el sync en vivo también devuelve al login", async () => {
    // @aitri-tc TC-SFU-102e
    const servidor = buildSeed("local", P0);
    servidor.budgets[MERCADO]!["2026-01"] = 313_131;
    const sesion = stubSesionQueMuere(servidor);
    const store = await freshStore();
    await store.getState().hydrate();

    sesion.matar();
    await store.getState().resync(); // lo que dispara el evento SSE

    expect(store.getState().sessionExpired).toBe(true);
    // NFR-2303 (semilla-intacta): tras matar la sesión el store vuelve a la semilla, que desde
    // FR-2301 no trae celdas — así que la celda ya no EXISTE, que es MÁS fuerte que "vale otra
    // cosa". Se conserva la aserción original y se añade la ausencia; solo se encadena opcional
    // para no reventar al indexar un mapa vacío.
    expect(store.getState().data.budgets[MERCADO]?.["2026-01"]).not.toBe(313_131);
    expect(store.getState().data.budgets[MERCADO]?.["2026-01"]).toBeUndefined();
  });

  it("TC-SFU-102e-relogin: entrar de nuevo cierra el episodio y vuelve a hidratar", async () => {
    // @aitri-tc TC-SFU-102e
    const servidor = buildSeed("local", P0);
    servidor.budgets[MERCADO]!["2026-01"] = 555_000;
    const sesion = stubSesionQueMuere(servidor);
    const store = await freshStore();
    await store.getState().hydrate();
    sesion.matar();
    await store.getState().resync();
    expect(store.getState().sessionExpired).toBe(true);

    // Login válido: la API vuelve a responder y el store debe poder rehidratar.
    stubApi(servidor);
    store.getState().clearSessionExpired();
    expect(store.getState().sessionExpired).toBe(false);
    await store.getState().hydrate();

    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().data.budgets[MERCADO]!["2026-01"]).toBe(555_000);
  });
});

describe("NFR-1101 — las preferencias del dispositivo siguen en localStorage", () => {
  it("TC-SFU-201f: la limpieza de ledger.* no borra las claves de preferencias", async () => {
    // @aitri-tc TC-SFU-201f
    stubApi(buildSeed("local", P0));
    localStorage.setItem("theme", "dark");
    localStorage.setItem("ledger-col-width", "320");
    localStorage.setItem(STORAGE_KEYS.nodes, '[{"id":"viejo"}]');
    const store = await freshStore();

    await store.getState().hydrate();

    expect(localStorage.getItem(STORAGE_KEYS.nodes)).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("ledger-col-width")).toBe("320");
  });
});

describe("NFR-1103 — conflicto por revisión: 409 → resync → convergencia", () => {
  /** API que responde 409 al primer PUT y sirve un GET con el estado "de la otra sesión". */
  function stubConflict(serverState: LedgerState) {
    const calls: Call[] = [];
    let yaConflictuo = false;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (init?.method === "PUT") {
        if (!yaConflictuo) {
          yaConflictuo = true;
          return new Response(JSON.stringify({ revision: 9 }), { status: 409 });
        }
        return new Response(JSON.stringify({ revision: 10 }), { status: 200 });
      }
      return new Response(JSON.stringify({ revision: 9, state: serverState }), { status: 200 });
    }));
    return {
      calls,
      puts: () => calls.filter((c) => c.init?.method === "PUT"),
      gets: () => calls.filter((c) => (c.init?.method ?? "GET") === "GET"),
    };
  }

  it("TC-SFU-203h: un 409 stale dispara resync y el estado converge", async () => {
    // @aitri-tc TC-SFU-203h
    const servidor = buildSeed("local", P0);
    servidor.budgets[MERCADO]!["2026-08"] = 99000; // lo que escribió la OTRA sesión
    const api = stubConflict(servidor);
    const store = await freshStore();

    store.getState().setLeafAmount(MERCADO, "2026-08", "budget", 15000);

    // El PUT recibe 409 → el store re-hidrata y converge al valor del servidor, no al local.
    await vi.waitFor(() => expect(store.getState().data.budgets[MERCADO]!["2026-08"]).toBe(99000));
    expect(store.getState().data.budgets[MERCADO]!["2026-08"]).not.toBe(15000);
    // Y el descarte no fue silencioso (BL-010).
    expect(store.getState().toast).toMatch(/Otro dispositivo/);
  });

  it("TC-SFU-203f: si se pierde el resync tras 409, el estado queda divergente y el test lo detecta", async () => {
    // @aitri-tc TC-SFU-203f
    // Blinda RISK-1: lo que hace converger es la petición de recarga que sigue al 409. Este test
    // cuenta esa petición — si alguien retira el resync, el GET desaparece y el estado se queda en
    // el valor local, y ambas aserciones caen.
    const servidor = buildSeed("local", P0);
    servidor.budgets[MERCADO]!["2026-08"] = 99000;
    const api = stubConflict(servidor);
    const store = await freshStore();

    const getsAntes = api.gets().length;
    store.getState().setLeafAmount(MERCADO, "2026-08", "budget", 15000);

    await vi.waitFor(() => expect(api.puts().length).toBeGreaterThanOrEqual(1));
    // Tras el 409 hay UNA recarga desde la fuente de verdad…
    await vi.waitFor(() => expect(api.gets().length).toBeGreaterThan(getsAntes));
    // …y el estado quedó convergido, no divergente.
    await vi.waitFor(() => expect(store.getState().data.budgets[MERCADO]!["2026-08"]).toBe(99000));
  });
});
