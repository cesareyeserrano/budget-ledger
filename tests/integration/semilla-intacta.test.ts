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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => localStorage.clear());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

/** Servidor simulado con revisión creciente, para poder afirmar que NO se escribió. */
function stubApi(initial: LedgerState | null, revisionInicial = 0) {
  let stored = initial === null ? null : JSON.stringify(initial);
  let revision = revisionInicial;
  let puts = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (!u.endsWith("/api/v1/ledger")) return new Response("{}", { status: 404 }); // preferencias, sync…
    if ((init?.method ?? "GET") === "PUT") {
      puts += 1;
      stored = JSON.stringify((JSON.parse(String(init!.body)) as { state: LedgerState }).state);
      revision += 1;
      return new Response(JSON.stringify({ revision }), { status: 200 });
    }
    if (stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision, state: JSON.parse(stored) }), { status: 200 });
  }));
  return { escrituras: () => puts, revision: () => revision, guardado: () => stored };
}

/**
 * Abrir la app: el `hydrate()` REAL del store, que es quien decide si siembra (FR-513).
 *
 * BL-063: aquí había una función `primerArranque` que reescribía esa decisión dentro de la prueba
 * («si load() devuelve null, sembrar y guardar») y las pruebas medían ESA copia; el store no se
 * llamaba nunca. Si el producto empezara a re-sembrar una cuenta con libro, seguían en verde.
 */
async function abrirLaApp() {
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  await delay(50); // un guardado que no debía ocurrir tendría tiempo de salir
  expect(store.getState().hydrated).toBe(true);
  return store.getState().data;
}

describe("FR-2301 · lo que se persiste en el primer arranque", () => {
  it("TC-SIN-004h: el snapshot persistido llega vacío y vuelve vacío desde una lectura nueva", async () => {
    // @aitri-tc TC-SIN-004h
    const api = stubApi(null);
    await abrirLaApp();

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
    const api = stubApi(previo, 7);
    const antes = api.guardado();

    const estado = await abrirLaApp();

    // En pantalla, lo del servidor…
    expect(estado.budgets).toEqual(previo.budgets);
    expect(estado.actuals).toEqual(previo.actuals);
    expect(estado.movements).toHaveLength(previo.movements.length);
    expect(estado.budgets["s-comida-mercado"]!["2026-01"]).toBe(120_000);
    // …y en el servidor, ni un byte distinto ni una escritura.
    expect(api.guardado()).toBe(antes);
    expect(api.escrituras()).toBe(0);
    expect(api.revision()).toBe(7);
  });

  it("TC-SIN-021e: una cuenta que borró todos sus montos tampoco se re-siembra", async () => {
    // @aitri-tc TC-SIN-021e
    // La condición es el 204, NO la ausencia de montos: un usuario que vació su libro a mano
    // tiene tanto derecho a que no se lo rellenen como uno que lo tiene lleno. Para distinguir «lo
    // que guardó» de «una semilla nueva», su libro tiene SOLO dos nodos, no los doce de la semilla.
    const semilla = buildSeed("local", P0);
    const vaciado: LedgerState = { ...semilla, nodes: semilla.nodes.filter((n) => n.id === "g-esenciales" || n.id === "c-vivienda") };
    expect(vaciado.nodes).toHaveLength(2);
    const api = stubApi(vaciado, 12);
    const antes = api.guardado();

    const estado = await abrirLaApp();

    expect(estado.nodes.map((n) => n.id).sort()).toEqual(["c-vivienda", "g-esenciales"]);
    expect(Object.keys(estado.budgets)).toHaveLength(0);
    expect(api.guardado()).toBe(antes);
    expect(api.escrituras()).toBe(0);
    expect(api.revision()).toBe(12);
  });

  it("TC-SIN-022f: sin libro persistido SÍ se siembra — la condición sigue colgando del 204", async () => {
    // @aitri-tc TC-SIN-022f
    const api = stubApi(null, 0);
    const estado = await abrirLaApp();

    expect(estado.nodes).toHaveLength(12);
    expect(Object.keys(estado.budgets)).toHaveLength(0);
    expect(Object.keys(estado.actuals)).toHaveLength(0);
    expect(api.escrituras()).toBe(1);
    expect(api.revision()).toBe(1);
    // lo que quedó guardado es esa semilla sin montos
    const guardado = JSON.parse(api.guardado()!) as LedgerState;
    expect(guardado.nodes).toHaveLength(12);
    expect(Object.keys(guardado.budgets)).toHaveLength(0);
    expect(guardado.movements).toHaveLength(0);
  });
});
