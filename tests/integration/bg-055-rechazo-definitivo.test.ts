// @vitest-environment jsdom
/**
 * BG-055 — un rechazo DEFINITIVO del servidor ya no se muestra como fallo de red ni envenena la sesión.
 *
 * `PUT /api/v1/ledger` responde 422 con varios códigos. El cliente solo reconocía el mes cerrado y la
 * celda descuadrada; `period_mismatch` y `domain_rule_violation` caían en «no se pudo guardar» (red),
 * el estado rechazado se quedaba en memoria y cada guardado posterior volvía a fallar igual, hasta
 * recargar. Ahora se tratan como los otros dos: se converge al servidor y se dice por qué.
 *
 * `invalid_payload` NO cambia: TC-FDC-029f fija su manejo vigente (aviso de red y la edición en
 * pantalla). Y el aviso de red se apaga cuando un guardado posterior sale bien.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { LedgerState } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Api {
  revision: number;
  stored: LedgerState | null;
  /** Respuesta del PRÓXIMO PUT del ledger: un status, o un 422 con este código. */
  nextPut: { status: number; code?: string } | null;
  puts: Array<{ baseRevision: number; status: number }>;
}

function stubServer(): Api {
  const api: Api = { revision: 0, stored: null, nextPut: null, puts: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, req?: RequestInit) => {
      const u = String(url);
      if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
      if ((req?.method ?? "GET") === "PUT") {
        const body = JSON.parse(String(req!.body)) as { baseRevision: number; state: LedgerState };
        if (api.nextPut) {
          const { status, code } = api.nextPut; api.nextPut = null;
          api.puts.push({ baseRevision: body.baseRevision, status });
          return new Response(JSON.stringify(code ? { error: { code, detail: {} } } : {}), { status });
        }
        if (body.baseRevision !== api.revision) {
          api.puts.push({ baseRevision: body.baseRevision, status: 409 });
          return new Response(JSON.stringify({ revision: api.revision }), { status: 409 });
        }
        api.revision += 1;
        api.stored = body.state;
        api.puts.push({ baseRevision: body.baseRevision, status: 200 });
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

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

describe("BG-055 · rechazos definitivos del servidor", () => {
  for (const [code, motivo] of [
    ["period_mismatch", /fecha/i],
    ["domain_rule_violation", /reserv/i],
  ] as const) {
    it(`${code}: converge al servidor, dice por qué y el guardado siguiente no queda envenenado`, async () => {
      const { api, store, cur } = await setup();
      api.nextPut = { status: 422, code };
      store.getState().setLeafAmount("c-transporte", cur, "budget", 555);
      await delay(40);

      expect(store.getState().storageError).toBe(null);
      expect(store.getState().toast).toMatch(motivo);
      expect(store.getState().data.budgets["c-transporte"]?.[cur]).toBeUndefined(); // volvió a lo del servidor

      store.getState().setLeafAmount("c-vivienda", cur, "budget", 200);
      await delay(40);
      expect(api.puts.at(-1)!.status).toBe(200);
      expect(api.stored!.budgets["c-vivienda"]?.[cur]).toBe(200);
    });
  }

  it("invalid_payload conserva su manejo vigente (caso FDC-029f): aviso de red y la edición en pantalla", async () => {
    const { api, store, cur } = await setup();
    api.nextPut = { status: 422, code: "invalid_payload" };
    store.getState().setLeafAmount("c-transporte", cur, "budget", 555);
    await delay(40);
    expect(store.getState().storageError).toBe("network");
    expect(store.getState().data.budgets["c-transporte"]?.[cur]).toBe(555);
  });

  it("el aviso de red se apaga cuando un guardado posterior sale bien", async () => {
    const { api, store, cur } = await setup();
    api.nextPut = { status: 500 };
    store.getState().setLeafAmount("c-transporte", cur, "budget", 555);
    await delay(40);
    expect(store.getState().storageError).toBe("network");

    store.getState().setLeafAmount("c-vivienda", cur, "budget", 200);
    await delay(40);
    expect(api.puts.at(-1)!.status).toBe(200);
    expect(store.getState().storageError).toBe(null);
    expect(api.stored!.budgets["c-transporte"]?.[cur]).toBe(555); // el snapshot bueno lleva también lo anterior
  });
});
