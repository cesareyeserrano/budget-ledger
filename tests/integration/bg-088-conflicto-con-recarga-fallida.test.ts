// @vitest-environment jsdom
/**
 * BG-088 — tras un conflicto, si la recarga falla, la siguiente edición no pisa al otro dispositivo.
 *
 * Un 409 hacía que el repositorio adoptara la revisión del servidor en el acto, antes de tener sus
 * datos, y el store avisaba «se recargó la versión del servidor» sin mirar si la recarga había
 * llegado. Si el GET fallaba, el siguiente guardado salía con la revisión nueva sobre datos viejos,
 * el servidor lo aceptaba y lo que había guardado el otro dispositivo se perdía sin aviso.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LedgerState, PeriodKey } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * El servidor de mentira, con revisión optimista real. `getFalla` hace responder 500 a las lecturas;
 * `getBasura` las hace responder un cuerpo ilegible; `puerta` retiene la RESPUESTA de la siguiente
 * lectura (la foto se toma al pedirla, como haría el servidor, y llega cuando la puerta se abre).
 */
const api = {
  revision: 0, stored: null as LedgerState | null, getFalla: false, getBasura: false,
  puerta: null as Promise<void> | null, log: [] as string[],
};

beforeEach(() => {
  Object.assign(api, { revision: 0, stored: null, getFalla: false, getBasura: false, puerta: null, log: [] });
  const conflicto = (ruta: string) => {
    api.log.push(`${ruta} 409`);
    return new Response(JSON.stringify({ error: { code: "revision_conflict" }, revision: api.revision }), { status: 409 });
  };
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    const u = String(url);
    const method = req?.method ?? "GET";
    if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if (method === "PUT" && u.endsWith("/api/v1/ledger/start")) {
      const b = JSON.parse(String(req!.body)) as { baseRevision: number; startMonth: string; openingBalance: number | null };
      // Sin ledger guardado el servidor real también responde 409 (no hay fila que actualizar).
      if (api.stored === null || b.baseRevision !== api.revision) return conflicto("start");
      api.revision += 1;
      api.stored = { ...api.stored!, startMonth: b.startMonth as PeriodKey, openingBalance: b.openingBalance };
      api.log.push("start 200");
      return new Response(JSON.stringify({ revision: api.revision, startMonth: b.startMonth, openingBalance: b.openingBalance }), { status: 200 });
    }
    if (u.endsWith("/api/v1/closure")) {
      const b = JSON.parse(String(req!.body)) as { baseRevision: number };
      if (b.baseRevision !== api.revision) return conflicto("closure");
      throw new Error("la prueba no espera un cierre aceptado");
    }
    if (method === "PUT") {
      const b = JSON.parse(String(req!.body)) as { baseRevision: number; state: LedgerState };
      if (b.baseRevision !== api.revision) return conflicto("ledger");
      api.revision += 1; api.stored = b.state; api.log.push("ledger 200");
      return new Response(JSON.stringify({ revision: api.revision }), { status: 200 });
    }
    const falla = api.getFalla;
    const foto = api.getBasura ? "esto no es un ledger" : api.stored === null ? null : JSON.stringify({ revision: api.revision, state: api.stored });
    const puerta = api.puerta;
    api.puerta = null;
    if (puerta) { api.log.push("get retenido"); await puerta; }
    if (falla) { api.log.push("get 500"); return new Response("{}", { status: 500 }); }
    if (foto === null) { api.log.push("get 204"); return new Response(null, { status: 204 }); }
    api.log.push("get 200");
    return new Response(foto, { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function hidratado() {
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  await delay(20);
  const cur = store.getState().activePeriods()[0]! as PeriodKey;
  store.getState().setLeafAmount("c-vivienda", cur, "budget", 100);
  await delay(30);
  api.log.length = 0;
  return { store, cur };
}
/** El otro dispositivo guarda 999 en Vivienda sin que este se entere (no hay evento del sync). */
function escribeElOtro(cur: PeriodKey) {
  api.stored = { ...api.stored!, budgets: { ...api.stored!.budgets, "c-vivienda": { [cur]: 999 } } };
  api.revision += 1;
}
const presupuesto = (s: LedgerState | null, id: string, p: PeriodKey) => s?.budgets[id]?.[p];
const SE_RECARGO = "Otro dispositivo guardó cambios: se recargó la versión del servidor.";
const NO_SE_PUDO = "Otro dispositivo guardó cambios, pero no se pudo recargar su versión.";

describe("BG-088 · un conflicto cuya recarga falla", () => {
  it("al guardar una celda: el aviso no dice «se recargó», y la edición siguiente no pisa al otro", async () => {
    const { store, cur } = await hidratado();
    escribeElOtro(cur);
    api.getFalla = true;

    store.getState().setLeafAmount("c-transporte", cur, "budget", 200); // 409, y la recarga falla
    await delay(40);
    expect(api.log).toEqual(["ledger 409", "get 500"]);
    expect(store.getState().toast).toBe(NO_SE_PUDO);
    expect(store.getState().storageError).toBe("conflict"); // el aviso fijo, con su propio texto

    store.getState().setLeafAmount("c-salario", cur, "budget", 300); // antes: PUT aceptado sobre datos viejos
    await delay(40);
    // El guardado SÍ salió —la prueba no pasa porque no se intentó— y el servidor lo rechazó otra vez.
    expect(api.log).toEqual(["ledger 409", "get 500", "ledger 409", "get 500"]);
    expect(presupuesto(api.stored, "c-vivienda", cur)).toBe(999); // lo del otro dispositivo sigue ahí
    expect(presupuesto(api.stored, "c-salario", cur)).toBeUndefined();
  });

  it("cuando la lectura vuelve, el guardado siguiente converge y entonces sí avisa que se recargó", async () => {
    const { store, cur } = await hidratado();
    escribeElOtro(cur);
    api.getFalla = true;
    store.getState().setLeafAmount("c-transporte", cur, "budget", 200);
    await delay(40);

    api.getFalla = false;
    store.getState().setLeafAmount("c-salario", cur, "budget", 300);
    await delay(40);
    expect(store.getState().toast).toBe(SE_RECARGO);
    expect(store.getState().storageError).toBeNull();
    expect(presupuesto(store.getState().data, "c-vivienda", cur)).toBe(999);
    expect(presupuesto(api.stored, "c-vivienda", cur)).toBe(999);

    // Y a partir de ahí se guarda con normalidad, sobre la versión del servidor.
    store.getState().setLeafAmount("c-salario", cur, "budget", 300);
    await delay(40);
    expect(presupuesto(api.stored, "c-salario", cur)).toBe(300);
    expect(presupuesto(api.stored, "c-vivienda", cur)).toBe(999);
  });

  it("la recarga que quedó debida también la hace el sync en vivo, sin esperar a otra edición", async () => {
    const { store, cur } = await hidratado();
    escribeElOtro(cur);
    api.getFalla = true;
    store.getState().setLeafAmount("c-transporte", cur, "budget", 200);
    await delay(40);

    expect(store.getState().toast).toBe(NO_SE_PUDO);

    api.getFalla = false;
    await store.getState().resync(true); // el stream reabre
    expect(store.getState().toast).toBe(SE_RECARGO);
    expect(presupuesto(store.getState().data, "c-vivienda", cur)).toBe(999);
    expect(presupuesto(store.getState().data, "c-transporte", cur)).toBeUndefined(); // la edición perdedora, avisada
    expect(store.getState().storageError).toBeNull();
  });

  it("al declarar la apertura: lo mismo — sin recarga no hay «se recargó» ni guardado encima", async () => {
    const { store, cur } = await hidratado();
    escribeElOtro(cur);
    api.getFalla = true;

    const r = await store.getState().setStart(cur, 5_000);
    expect(r).toMatchObject({ ok: false, reason: "revision_conflict" });
    expect(store.getState().toast).toBe(NO_SE_PUDO);

    store.getState().setLeafAmount("c-salario", cur, "budget", 300);
    await delay(40);
    expect(api.log).toContain("ledger 409"); // el guardado salió, y el servidor lo rechazó
    expect(api.log.filter((l) => l.endsWith(" 200") && !l.startsWith("get"))).toEqual([]);
    expect(presupuesto(api.stored, "c-vivienda", cur)).toBe(999);
  });

  it("al cerrar el mes: lo mismo", async () => {
    const { store, cur } = await hidratado();
    escribeElOtro(cur);
    api.getFalla = true;

    await store.getState().closeMonth();
    expect(api.log).toEqual(["closure 409", "get 500"]);
    expect(store.getState().toast).toBe(NO_SE_PUDO);

    store.getState().setLeafAmount("c-salario", cur, "budget", 300);
    await delay(40);
    expect(api.log).toContain("ledger 409"); // el guardado salió, y el servidor lo rechazó
    expect(presupuesto(api.stored, "c-vivienda", cur)).toBe(999);
    expect(presupuesto(api.stored, "c-salario", cur)).toBeUndefined();
  });

  it("con la recarga funcionando, un conflicto sigue convergiendo y avisando como siempre (control)", async () => {
    const { store, cur } = await hidratado();
    escribeElOtro(cur);
    store.getState().setLeafAmount("c-transporte", cur, "budget", 200);
    await delay(40);
    expect(api.log).toEqual(["ledger 409", "get 200"]);
    expect(store.getState().toast).toBe(SE_RECARGO);
    expect(presupuesto(store.getState().data, "c-vivienda", cur)).toBe(999);
    expect(store.getState().storageError).toBeNull();
  });
});

describe("BG-088 · revisión adversarial: la recarga debida no se cruza con nada", () => {
  /** Conflicto con la recarga fallida: queda en pantalla el estado perdedor y la recarga, debida. */
  async function conRecargaDebida() {
    const { store, cur } = await hidratado();
    escribeElOtro(cur);
    api.getFalla = true;
    store.getState().setLeafAmount("c-transporte", cur, "budget", 200);
    await delay(40);
    api.getFalla = false;
    api.log.length = 0;
    return { store, cur };
  }
  const abrir = () => { let abrirla = () => {}; api.puerta = new Promise<void>((r) => { abrirla = r; }); return () => abrirla(); };

  it("mientras la recarga viaja no sale ningún guardado, y lo tecleado entonces se descarta avisando", async () => {
    const { store, cur } = await conRecargaDebida();
    const soltar = abrir();
    const recarga = store.getState().resync();        // un evento del sync: la recarga debida sale…
    await delay(20);
    store.getState().setLeafAmount("c-salario", cur, "budget", 300); // …y el usuario teclea mientras viaja
    await delay(30);
    expect(api.log).toEqual(["get retenido"]);          // ningún PUT se cruzó con ella

    soltar();
    await recarga;
    await delay(40);
    expect(store.getState().toast).toBe(SE_RECARGO);
    expect(presupuesto(store.getState().data, "c-vivienda", cur)).toBe(999);
    expect(presupuesto(store.getState().data, "c-salario", cur)).toBeUndefined();
    expect(api.log.filter((l) => l.startsWith("ledger"))).toEqual([]);
    expect(presupuesto(api.stored, "c-vivienda", cur)).toBe(999);

    // Lo siguiente que se teclea ya se guarda, sobre la versión del servidor.
    store.getState().setLeafAmount("c-freelance", cur, "budget", 400);
    await delay(40);
    expect(presupuesto(api.stored, "c-freelance", cur)).toBe(400);
    expect(presupuesto(api.stored, "c-vivienda", cur)).toBe(999);
  });

  it("dos recargas debidas a la vez no se pisan: la que falla tarde no deshace a la que llegó", async () => {
    const { store, cur } = await conRecargaDebida();
    api.getFalla = true;                                // la primera lectura va a fallar…
    const soltar = abrir();                             // …pero tarde
    const primera = store.getState().resync(true);      // el stream se cae
    await delay(10);
    api.getFalla = false;
    const segunda = store.getState().resync(true);      // el stream reabre
    await delay(10);
    soltar();
    await Promise.all([primera, segunda]);
    await delay(40);

    expect(store.getState().toast).toBe(SE_RECARGO);
    expect(store.getState().storageError).toBeNull();
    expect(presupuesto(store.getState().data, "c-vivienda", cur)).toBe(999);
    // Y no quedó nada debido: una edición nueva se guarda, y una reconexión no se la lleva.
    store.getState().setLeafAmount("c-freelance", cur, "budget", 400);
    await delay(40);
    await store.getState().resync(true);
    expect(presupuesto(store.getState().data, "c-freelance", cur)).toBe(400);
    expect(presupuesto(api.stored, "c-freelance", cur)).toBe(400);
  });

  it("si la recarga llega por otra vía (volver de otra página), también avisa y apaga el aviso fijo", async () => {
    const { store, cur } = await conRecargaDebida();
    expect(store.getState().storageError).toBe("conflict");
    await store.getState().hydrate();                   // lo que hace cada página al montarse
    expect(presupuesto(store.getState().data, "c-vivienda", cur)).toBe(999);
    expect(presupuesto(store.getState().data, "c-transporte", cur)).toBeUndefined();
    expect(store.getState().toast).toBe(SE_RECARGO);
    expect(store.getState().storageError).toBeNull();
  });

  it("una lectura lenta del sync no pisa lo que se guardó mientras viajaba (control)", async () => {
    const { store, cur } = await hidratado();
    const soltar = abrir();
    const vieja = store.getState().resync();            // una lectura que tardará (foto de ahora)
    await delay(10);
    api.puerta = null;
    store.getState().setLeafAmount("c-salario", cur, "budget", 300);
    await delay(40);                                    // guardada: el cliente ya va por delante
    store.getState().setLeafAmount("c-salario", cur, "budget", 300); // sin cambio: no toca `data`
    soltar();
    await vieja;
    expect(presupuesto(store.getState().data, "c-salario", cur)).toBe(300);
    store.getState().setLeafAmount("c-freelance", cur, "budget", 400);
    await delay(40);
    expect(presupuesto(api.stored, "c-salario", cur)).toBe(300);
    expect(presupuesto(api.stored, "c-freelance", cur)).toBe(400);
  });

  it("salir de la sesión con la recarga del conflicto en vuelo no deja avisos para quien entre después", async () => {
    const { store, cur } = await hidratado();
    escribeElOtro(cur);
    api.getFalla = true;
    const soltar = abrir();
    store.getState().setLeafAmount("c-transporte", cur, "budget", 200); // 409, y su recarga queda en vuelo
    await delay(30);
    store.getState().clearForLogout();
    soltar();
    await delay(40);
    expect(store.getState().toast).toBeNull();
    expect(store.getState().storageError).toBeNull();
  });

  it("si lo que llega tras el conflicto es ilegible, el aviso fijo es el de «no edites», no el de conflicto", async () => {
    const { store, cur } = await hidratado();
    escribeElOtro(cur);
    api.getBasura = true;
    store.getState().setLeafAmount("c-transporte", cur, "budget", 200);
    await delay(40);
    expect(store.getState().storageError).toBe("malformed");
    expect(store.getState().toast).toBe(NO_SE_PUDO);
  });

  it("un usuario nuevo cuya siembra no llegó: el 409 no culpa a otro dispositivo, y el ledger se siembra", async () => {
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    // La siembra del primer arranque falla: el servidor se queda sin ledger.
    const real = globalThis.fetch;
    let cortar = true;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
      if (cortar && (req?.method ?? "GET") === "PUT") throw new TypeError("Failed to fetch");
      return real(url as RequestInfo, req);
    }));
    await store.getState().hydrate();
    await delay(20);
    cortar = false;
    expect(api.stored).toBeNull();
    const cur = store.getState().activePeriods()[0]! as PeriodKey;

    const r = await store.getState().setStart(cur, 5_000);
    await delay(60);
    expect(r).toMatchObject({ ok: false, reason: "revision_conflict", recargado: false });
    expect(store.getState().toast).toBeNull();           // nadie más escribió nada
    expect(store.getState().storageError).toBeNull();
    expect(api.stored).not.toBeNull();                   // la siembra, por fin, llegó
    expect(await store.getState().setStart(cur, 5_000)).toEqual({ ok: true });
    await store.getState().resync();
    expect(store.getState().toast).not.toBe(SE_RECARGO);
  });
});

