// @vitest-environment jsdom
/**
 * BG-073 — una sesión caducada se detecta también en las acciones que esperan al servidor.
 *
 * El repositorio marcaba el 401, pero solo la cola de guardado y la recarga llamaban a
 * `onSessionExpired`. Declarar la apertura, cerrar o reabrir un mes y cambiar de modo mostraban un
 * error genérico para siempre, sin volver nunca al acceso, y con las finanzas en pantalla.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { LedgerState } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Servidor que acepta hasta que `caducar()` hace que TODO responda 401. */
function stubServer() {
  let revision = 0;
  let stored: LedgerState | null = null;
  let caducada = false;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    const u = String(url);
    if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if (caducada) return new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 });
    if ((req?.method ?? "GET") === "PUT" && u.endsWith("/api/v1/ledger")) {
      revision += 1; stored = (JSON.parse(String(req!.body)) as { state: LedgerState }).state;
      return new Response(JSON.stringify({ revision }), { status: 200 });
    }
    if (stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision, state: stored }), { status: 200 });
  }));
  return { caducar: () => { caducada = true; } };
}

async function setup() {
  const api = stubServer();
  vi.resetModules();
  const store = (await import("@/state/store")).useLedgerStore;
  await store.getState().hydrate();
  const cur = store.getState().activePeriods()[0]!;
  store.getState().setLeafAmount("c-vivienda", cur, "budget", 4_321);
  await delay(30);
  api.caducar();
  return { store, cur };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

describe("BG-073 · sesión caducada en las acciones que esperan al servidor", () => {
  const acciones: Array<[string, (s: Awaited<ReturnType<typeof setup>>) => Promise<unknown>]> = [
    ["declarar la apertura", ({ store, cur }) => store.getState().setStart(cur, 1_000)],
    ["cerrar el mes", ({ store }) => store.getState().closeMonth()],
    ["reabrir el mes", ({ store }) => store.getState().reopenMonth()],
    ["cambiar de modo", ({ store }) => store.getState().applyPeriodMode({ mode: "cycle", anchorDay: 21 } as never)],
    ["previsualizar el modo", ({ store }) => store.getState().previewPeriodMode({ mode: "cycle", anchorDay: 21 } as never)],
  ];
  for (const [nombre, accion] of acciones) {
    it(`${nombre}: vuelve al acceso y no deja las finanzas en pantalla`, async () => {
      const s = await setup();
      await accion(s);
      expect(s.store.getState().sessionExpired).toBe(true);
      expect(s.store.getState().hydrated).toBe(false);
      expect(s.store.getState().data.budgets["c-vivienda"]?.[s.cur]).toBeUndefined();
    });
  }
});
