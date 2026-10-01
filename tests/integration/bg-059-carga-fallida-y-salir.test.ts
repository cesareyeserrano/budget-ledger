// @vitest-environment jsdom
/**
 * BG-059 — si la primera carga falla no se pinta la semilla vacía, y salir borra lo que hay en memoria.
 *
 * `hydrate` marcaba `hydrated` ante un 5xx o una red caída sin señalar nada, así que el shell pintaba
 * la semilla: las categorías del usuario con todas las cifras vacías y ningún aviso. Y `Salir`
 * cerraba la sesión sin limpiar el store: si otra cuenta entraba en la misma pestaña y su carga
 * fallaba, se pintaban las cifras de la anterior.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { LedgerState } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Servidor cuyo GET del ledger se puede tumbar (500) o levantar a voluntad. */
function stubServer() {
  let revision = 0;
  let stored: LedgerState | null = null;
  let caido = false;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    const u = String(url);
    if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if (caido) return new Response(JSON.stringify({ error: { code: "internal" } }), { status: 500 });
    if ((req?.method ?? "GET") === "PUT" && u.endsWith("/api/v1/ledger")) {
      revision += 1; stored = (JSON.parse(String(req!.body)) as { state: LedgerState }).state;
      return new Response(JSON.stringify({ revision }), { status: 200 });
    }
    if (stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision, state: stored }), { status: 200 });
  }));
  return { caer: () => { caido = true; }, levantar: () => { caido = false; } };
}

async function nuevoStore() {
  vi.resetModules();
  return (await import("@/state/store")).useLedgerStore;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

describe("BG-059 · la primera carga que falla", () => {
  it("no marca hidratado: señala el fallo, y el reintento carga los datos", async () => {
    const api = stubServer();
    // Primero hay datos guardados en el servidor.
    let store = await nuevoStore();
    await store.getState().hydrate();
    const cur = store.getState().activePeriods()[0]!;
    store.getState().setLeafAmount("c-vivienda", cur, "budget", 4_321);
    await delay(30);

    // Una pestaña NUEVA abre con el servidor caído.
    api.caer();
    store = await nuevoStore();
    await store.getState().hydrate();
    expect(store.getState().loadFailed).toBe(true);
    expect(store.getState().hydrated).toBe(false);

    // Reintentar con el servidor de vuelta trae las cifras de verdad.
    api.levantar();
    await store.getState().hydrate();
    expect(store.getState().loadFailed).toBe(false);
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().data.budgets["c-vivienda"]?.[cur]).toBe(4_321);
  });

  it("control: una recarga POSTERIOR que falla conserva lo que hay en pantalla", async () => {
    const api = stubServer();
    const store = await nuevoStore();
    await store.getState().hydrate();
    const cur = store.getState().activePeriods()[0]!;
    store.getState().setLeafAmount("c-vivienda", cur, "budget", 4_321);
    await delay(30);

    api.caer();
    await store.getState().hydrate();
    expect(store.getState().loadFailed).toBe(false);
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().data.budgets["c-vivienda"]?.[cur]).toBe(4_321);
  });

  it("la pantalla de error dice qué pasó y «Reintentar» vuelve a cargar", async () => {
    const { LoadError } = await import("@/components/auth/LoadError");
    const reintentar = vi.fn();
    render(React.createElement(LoadError, { onRetry: reintentar }));
    expect(screen.getByRole("alert").textContent).toContain("No pudimos cargar tus datos");
    fireEvent.click(screen.getByTestId("load-retry"));
    expect(reintentar).toHaveBeenCalledTimes(1);
  });
});

describe("BG-059 · salir borra lo que hay en memoria", () => {
  it("tras clearForLogout no queda ninguna cifra de la cuenta anterior", async () => {
    stubServer();
    const store = await nuevoStore();
    await store.getState().hydrate();
    const cur = store.getState().activePeriods()[0]!;
    store.getState().setLeafAmount("c-vivienda", cur, "budget", 4_321);
    await delay(30);
    expect(store.getState().data.budgets["c-vivienda"]?.[cur]).toBe(4_321);

    store.getState().clearForLogout();
    expect(store.getState().hydrated).toBe(false);
    expect(store.getState().data.budgets["c-vivienda"]?.[cur]).toBeUndefined();
  });

  it("el botón Salir limpia el store después de cerrar la sesión", async () => {
    stubServer();
    vi.resetModules();
    const signOut = vi.fn(async () => undefined);
    vi.doMock("@/lib/authClient", () => ({ signOut }));
    const store = (await import("@/state/store")).useLedgerStore;
    const limpiar = vi.spyOn(store.getState(), "clearForLogout");
    const { LogoutButton } = await import("@/components/auth/LogoutButton");
    render(React.createElement(LogoutButton));
    fireEvent.click(screen.getByTestId("logout"));
    await delay(10);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(limpiar).toHaveBeenCalledTimes(1);
  });
});
