// @vitest-environment jsdom
/**
 * BG-081 (h), revisión adversarial — la puesta al día de una reconexión no borra lo que no se guardó.
 *
 * Un guardado que falla por red deja en pantalla una edición que el servidor no tiene, y ya fuera de
 * la cola. La reconexión del sync llega justo después del corte y pide una puesta al día: recargar en
 * ese momento borraba la edición en silencio, con el aviso diciendo «tus datos en pantalla siguen
 * intactos». Ahora la reconexión REINTENTA el guardado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LedgerState, PeriodKey } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** El servidor de mentira: se le puede cortar la red, o hacer lentos sus PUT. */
const api = { revision: 0, stored: null as LedgerState | null, sinRed: false, putLentoMs: 0, gets: 0, puts: [] as string[] };

beforeEach(() => {
  Object.assign(api, { revision: 0, stored: null, sinRed: false, putLentoMs: 0, gets: 0, puts: [] });
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    const u = String(url);
    if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if ((req?.method ?? "GET") === "PUT") {
      if (api.sinRed) { api.puts.push("red"); throw new TypeError("Failed to fetch"); }
      const b = JSON.parse(String(req!.body)) as { baseRevision: number; state: LedgerState };
      if (api.putLentoMs) await delay(api.putLentoMs);
      if (b.baseRevision !== api.revision) { api.puts.push("409"); return new Response(JSON.stringify({ error: { code: "revision_conflict" }, revision: api.revision }), { status: 409 }); }
      api.revision += 1; api.stored = b.state; api.puts.push("200");
      return new Response(JSON.stringify({ revision: api.revision }), { status: 200 });
    }
    api.gets += 1;
    if (api.sinRed) throw new TypeError("Failed to fetch");
    if (api.stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision: api.revision, state: api.stored }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function hidratado() {
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  await delay(20);
  const cur = store.getState().activePeriods()[0]! as PeriodKey;
  return { store, cur };
}
const presupuesto = (s: LedgerState | null, id: string, p: PeriodKey) => s?.budgets[id]?.[p];

describe("BG-081 (h) · reconectar tras un guardado que falló", () => {
  it("la edición que no llegó sigue en pantalla y la reconexión la guarda", async () => {
    const { store, cur } = await hidratado();
    api.sinRed = true;
    store.getState().setLeafAmount("c-transporte", cur, "budget", 555);
    await delay(30);
    expect(store.getState().storageError).toBe("network");
    expect(presupuesto(api.stored, "c-transporte", cur)).toBeUndefined();

    api.sinRed = false;
    await store.getState().resync(true); // lo que pide el cliente del sync al reabrir el stream
    await delay(30);
    expect(presupuesto(store.getState().data, "c-transporte", cur)).toBe(555);
    expect(presupuesto(api.stored, "c-transporte", cur)).toBe(555);
    expect(store.getState().storageError).toBeNull();
  });

  it("lo mismo si lo que llega es un evento de otro dispositivo, y si la red sigue caída", async () => {
    const { store, cur } = await hidratado();
    api.sinRed = true;
    store.getState().setLeafAmount("c-transporte", cur, "budget", 555);
    await delay(30);

    await store.getState().resync(true); // la red sigue caída: el reintento también falla
    await delay(30);
    expect(presupuesto(store.getState().data, "c-transporte", cur)).toBe(555);
    expect(store.getState().storageError).toBe("network");

    api.sinRed = false;
    await store.getState().resync(); // un evento `revision` corriente
    await delay(30);
    expect(presupuesto(store.getState().data, "c-transporte", cur)).toBe(555);
    expect(presupuesto(api.stored, "c-transporte", cur)).toBe(555);
  });

  it("si otro dispositivo escribió durante el corte, el reintento converge AVISANDO, no en silencio", async () => {
    const { store, cur } = await hidratado();
    api.sinRed = true;
    store.getState().setLeafAmount("c-transporte", cur, "budget", 555);
    await delay(30);
    // El otro dispositivo guarda mientras este no tiene red.
    api.stored = { ...api.stored!, budgets: { ...api.stored!.budgets, "c-vivienda": { [cur]: 900 } } };
    api.revision += 1;

    api.sinRed = false;
    await store.getState().resync(true);
    await delay(60);
    expect(presupuesto(store.getState().data, "c-vivienda", cur)).toBe(900);
    expect(store.getState().toast).toBe("Otro dispositivo guardó cambios: se recargó la versión del servidor.");
  });

  it("sin nada pendiente, la reconexión sí trae lo que otro dispositivo guardó durante el corte", async () => {
    const { store, cur } = await hidratado();
    api.stored = { ...api.stored!, budgets: { ...api.stored!.budgets, "c-vivienda": { [cur]: 900 } } };
    api.revision += 1;
    await store.getState().resync(true);
    expect(presupuesto(store.getState().data, "c-vivienda", cur)).toBe(900);
  });

  it("con un guardado en vuelo, la puesta al día se debe y corre al terminar la cola", async () => {
    const { store, cur } = await hidratado();
    api.putLentoMs = 80;
    store.getState().setLeafAmount("c-transporte", cur, "budget", 555);
    await delay(10);
    const getsAntes = api.gets;
    await store.getState().resync(true); // el stream reabre con el PUT todavía viajando
    expect(api.gets).toBe(getsAntes);    // no se recarga encima de un guardado en vuelo…
    await delay(150);
    expect(api.gets).toBe(getsAntes + 1); // …pero no se olvida
    expect(presupuesto(store.getState().data, "c-transporte", cur)).toBe(555);

    // Un evento corriente que se salta por un guardado en vuelo NO deja nada debido (era el propio eco).
    store.getState().setLeafAmount("c-transporte", cur, "budget", 600);
    await delay(10);
    await store.getState().resync();
    await delay(150);
    expect(api.gets).toBe(getsAntes + 1);
  });
});
