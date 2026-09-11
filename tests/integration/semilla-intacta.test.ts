// @vitest-environment jsdom
/**
 * Feature semilla-intacta — FR-2301 / NFR-2301 sobre el camino REAL de persistencia.
 *
 * Lo que el dominio no puede afirmar: que lo que se PERSISTE en el primer arranque llega vacío, y
 * que una cuenta que ya tiene libro no se re-siembra. La condición de siembra es el 204 y nada más
 * (FR-013 de la raíz, FR-513 de backend) — ni la ausencia de montos ni ninguna otra heurística.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ServerRepository } from "@/data/serverRepository";
import { buildSeed } from "@/domain";
import { buildSeedConMontos } from "../helpers/seedConMontos";
import type { LedgerState } from "@/domain/types";
import { P0 } from "../helpers/periods";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

/** API simulada con revisión creciente, para poder afirmar que NO se escribió. */
function stubApi(initial: LedgerState | null, revisionInicial = 0) {
  let stored = initial;
  let revision = revisionInicial;
  let puts = 0;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts += 1;
      stored = JSON.parse(String(init.body)).state;
      revision += 1;
      return new Response(JSON.stringify({ revision }), { status: 200 });
    }
    if (stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision, state: stored }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { escrituras: () => puts, revision: () => revision };
}

/** Lo que hace el borde de la app: si el servidor no trae libro, siembra y persiste (FR-513). */
async function primerArranque(repo: ServerRepository): Promise<LedgerState> {
  const cargado = await repo.load();
  if (cargado !== null) return cargado;
  const semilla = buildSeed("local", P0);
  await repo.save("local", semilla);
  return semilla;
}

describe("FR-2301 · lo que se persiste en el primer arranque", () => {
  it("TC-SIN-004h: el snapshot persistido llega vacío y vuelve vacío desde una lectura nueva", async () => {
    // @aitri-tc TC-SIN-004h
    const api = stubApi(null);
    await primerArranque(new ServerRepository());

    // Una lectura NUEVA, no la que ya teníamos en memoria.
    const releido = await new ServerRepository().load();
    expect(releido).not.toBeNull();
    expect(Object.keys(releido!.budgets)).toHaveLength(0);
    expect(Object.keys(releido!.actuals)).toHaveLength(0);
    expect(releido!.movements).toHaveLength(0);
    expect(releido!.nodes).toHaveLength(12);
    expect(api.escrituras()).toBe(1);
  });
});

describe("NFR-2301 · las cuentas existentes no se tocan", () => {
  it("TC-SIN-020h: una cuenta con libro persistido no cambia ni un byte", async () => {
    // @aitri-tc TC-SIN-020h
    const previo = buildSeedConMontos("local", P0);
    previo.budgets["s-comida-mercado"]!["2026-01"] = 120_000;
    previo.actuals["s-comida-mercado"]!["2026-01"] = 98_000;
    const antes = JSON.stringify(previo);
    const api = stubApi(previo, 7);

    const estado = await primerArranque(new ServerRepository());

    expect(JSON.stringify(estado)).toBe(antes);
    expect(estado.budgets["s-comida-mercado"]!["2026-01"]).toBe(120_000);
    expect(estado.actuals["s-comida-mercado"]!["2026-01"]).toBe(98_000);
    expect(api.escrituras()).toBe(0);
    expect(api.revision()).toBe(7);
  });

  it("TC-SIN-021e: una cuenta que borró todos sus montos tampoco se re-siembra", async () => {
    // @aitri-tc TC-SIN-021e
    // La condición es el 204, NO la ausencia de montos: un usuario que vació su libro a mano
    // tiene tanto derecho a que no se lo rellenen como uno que lo tiene lleno.
    const vaciado: LedgerState = { ...buildSeed("local", P0), nodes: buildSeed("local", P0).nodes };
    const api = stubApi(vaciado, 12);

    const estado = await primerArranque(new ServerRepository());

    expect(Object.keys(estado.budgets)).toHaveLength(0);
    expect(api.escrituras()).toBe(0);
    expect(api.revision()).toBe(12);
  });

  it("TC-SIN-022f: sin libro persistido SÍ se siembra — la condición sigue colgando del 204", async () => {
    // @aitri-tc TC-SIN-022f
    const api = stubApi(null, 0);
    const estado = await primerArranque(new ServerRepository());

    expect(estado.nodes).toHaveLength(12);
    expect(Object.keys(estado.budgets)).toHaveLength(0);
    expect(api.escrituras()).toBe(1);
    expect(api.revision()).toBe(1);
  });
});
