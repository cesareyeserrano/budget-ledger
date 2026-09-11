// @vitest-environment jsdom
/**
 * BG-012 — ServerRepository debe VALIDAR el cuerpo de la respuesta, no castearlo.
 *
 * `LedgerRepository` promete "Nunca lanza por datos corruptos" y ServerRepository es la única
 * implementación viva desde que se retiró la de localStorage. Antes hacía
 * `await res.json() as { revision, state }`, que no comprueba nada: un JSON malformado lanzaba en
 * medio de hydrate() y uno con la forma equivocada entraba entero al store.
 *
 * La parte que más importa NO es que devuelva null, sino que el caller no siembre encima: un 204 es
 * "usuario nuevo, siembra"; un cuerpo ilegible es "no sé qué hay ahí arriba". Confundirlos convierte
 * un bug del servidor en pérdida de datos del usuario.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServerRepository } from "@/data/serverRepository";
import { buildSeed } from "@/domain";
import { P0 } from "../helpers/periods";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Responde 200 al GET del ledger con el cuerpo crudo que se le pase. */
function stubGet(body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") return new Response(JSON.stringify({ revision: 1 }), { status: 200 });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    })
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BG-012 — load() valida la respuesta y degrada sin lanzar", () => {
  const casos: Array<[string, string]> = [
    ["no es JSON en absoluto", "<html>502 Bad Gateway</html>"],
    ["JSON válido con forma equivocada", JSON.stringify({ hola: "mundo" })],
    ["falta el campo state", JSON.stringify({ revision: 3 })],
    ["state no es un objeto de ledger", JSON.stringify({ revision: 3, state: { nodes: "no soy un array" } })],
    ["revision no es un número", JSON.stringify({ revision: "tres", state: buildSeed("local", P0) })],
    ["un movimiento con mes inexistente", JSON.stringify({ revision: 3, state: { ...buildSeed("local", P0), movements: [{ id: "m1", ownerId: "local", type: "expense", catId: "c-comida", subId: null, target: "c-comida", amount: 100, period: "trecebre", createdAt: 1 }] } })],
    ["un monto negativo (viola el piso del dominio)", JSON.stringify({ revision: 3, state: { ...buildSeed("local", P0), budgets: { "s-comida-mercado": { "2026-01": -5 } } } })],
  ];

  for (const [nombre, cuerpo] of casos) {
    it(`${nombre} → devuelve null, marca malformed y NO lanza`, async () => {
      stubGet(cuerpo);
      const repo = new ServerRepository();
      await expect(repo.load()).resolves.toBeNull();
      expect(repo.malformed).toBe(true);
    });
  }

  it("una respuesta que SÍ cumple el contrato carga y deja malformed en false", async () => {
    const state = buildSeed("local", P0);
    stubGet(JSON.stringify({ revision: 7, state }));
    const repo = new ServerRepository();
    const cargado = await repo.load();
    expect(cargado).not.toBeNull();
    expect(cargado!.nodes.length).toBe(state.nodes.length);
    expect(repo.malformed).toBe(false);
    expect(repo.currentRevision).toBe(7);
  });

  it("un cuerpo ilegible NO pisa la revisión conocida (evita un 409 autoinfligido)", async () => {
    const repo = new ServerRepository();
    stubGet(JSON.stringify({ revision: 9, state: buildSeed("local", P0) }));
    await repo.load();
    expect(repo.currentRevision).toBe(9);

    stubGet("no soy json");
    await repo.load();
    expect(repo.currentRevision).toBe(9); // la última buena conocida sigue en pie
  });
});

describe("BG-012 — el store no siembra encima de una respuesta ilegible", () => {
  it("hydrate() con cuerpo corrupto: cero PUT, aviso 'malformed' y la app hidratada", async () => {
    vi.resetModules();
    const puts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === "PUT") {
          puts.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ revision: 1 }), { status: 200 });
        }
        return new Response(JSON.stringify({ revision: 2, state: { forma: "equivocada" } }), { status: 200 });
      })
    );
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    await delay(40);

    // Lo esencial: no se escribió NADA. Con el bug, hydrate() leía null como "usuario nuevo" y
    // guardaba buildSeed encima de los datos reales del servidor.
    expect(puts).toHaveLength(0);
    expect(store.getState().storageError).toBe("malformed");
    expect(store.getState().hydrated).toBe(true); // no deja la app colgada en el spinner
  });

  it("un 204 legítimo SÍ siembra y persiste (el caso que no hay que romper)", async () => {
    vi.resetModules();
    const puts: unknown[] = [];
    let sembrado = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === "PUT") {
          puts.push(JSON.parse(String(init.body)));
          sembrado = true;
          return new Response(JSON.stringify({ revision: 1 }), { status: 200 });
        }
        if (!sembrado) return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ revision: 1, state: buildSeed("local", P0) }), { status: 200 });
      })
    );
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    await delay(40);

    expect(puts).toHaveLength(1); // sembró exactamente una vez
    expect(store.getState().storageError).toBeNull();
  });

  it("un resync con cuerpo corrupto conserva el estado en pantalla y avisa", async () => {
    vi.resetModules();
    let corrupto = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === "PUT") return new Response(JSON.stringify({ revision: 1 }), { status: 200 });
        if (corrupto) return new Response("{{{", { status: 200 });
        return new Response(JSON.stringify({ revision: 1, state: buildSeed("local", P0) }), { status: 200 });
      })
    );
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const antes = store.getState().data;
    expect(antes.nodes.length).toBeGreaterThan(0);

    corrupto = true;
    await store.getState().resync();
    await delay(20);

    expect(store.getState().data).toBe(antes); // misma referencia: no se tocó nada
    expect(store.getState().storageError).toBe("malformed");
  });
});
