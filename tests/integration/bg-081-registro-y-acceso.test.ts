// @vitest-environment jsdom
/**
 * BG-081 (c) y (d) — el registro móvil y la pantalla de acceso.
 *
 * (c) Con la confirmación en pantalla el botón Guardar seguía activo. La ventana anti doble-tap del
 *     store dura 600 ms y la confirmación 2 s, así que un segundo Guardar pasados 600 ms —el botón
 *     conserva el foco y la confirmación solo tapa el puntero— creaba un movimiento duplicado.
 * (d) El error de «Iniciar sesión» seguía a la vista al pasar a «Crear cuenta», y al revés.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";
import type { LedgerState } from "@/domain/types";

const api = { revision: 0, stored: null as LedgerState | null };

beforeEach(() => {
  api.revision = 0; api.stored = null;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, req?: RequestInit) => {
    const u = String(url);
    const method = req?.method ?? "GET";
    if (u.includes("/preferences/horizon")) return new Response("{}", { status: 404 });
    if (method === "PUT") {
      const b = JSON.parse(String(req!.body)) as { baseRevision: number; state: LedgerState };
      if (b.baseRevision !== api.revision) return new Response(JSON.stringify({ revision: api.revision }), { status: 409 });
      api.revision += 1;
      api.stored = b.state;
      return new Response(JSON.stringify({ revision: api.revision }), { status: 200 });
    }
    if (api.stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision: api.revision, state: api.stored }), { status: 200 });
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.doUnmock("@/lib/authClient"); vi.unstubAllGlobals(); vi.resetModules(); });

describe("BG-081 (c) · el registro mientras la confirmación está en pantalla", () => {
  it("BG-081c: un segundo Guardar pasada la ventana del doble-tap no crea otro movimiento", async () => {
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const { Register } = await import("@/components/register/Register");
    render(React.createElement(Register));
    fireEvent.change(screen.getByTestId("amount-input"), { target: { value: "25000" } });
    fireEvent.click(screen.getByTestId("category-c-vivienda"));

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const guardar = screen.getByTestId("save-button") as HTMLButtonElement;
    fireEvent.click(guardar);
    expect(store.getState().data.movements).toHaveLength(1);
    expect(screen.getByTestId("confirm-overlay")).toBeTruthy();
    expect(guardar.disabled).toBe(true);

    // 700 ms después: la ventana de 600 ms del store ya pasó y la confirmación sigue en pantalla.
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.getByTestId("confirm-overlay")).toBeTruthy();
    fireEvent.click(guardar);
    expect(store.getState().data.movements).toHaveLength(1);

    // Al irse la confirmación el formulario queda limpio y el botón vuelve a depender del monto.
    act(() => { vi.advanceTimersByTime(1400); });
    expect(screen.queryByTestId("confirm-overlay")).toBeNull();
    expect((screen.getByTestId("amount-input") as HTMLInputElement).value).toBe("");
  });

  it("BG-081c: lo tecleado para el siguiente movimiento no lo borra un temporizador viejo", async () => {
    vi.resetModules();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    const { Register } = await import("@/components/register/Register");
    render(React.createElement(Register));
    fireEvent.change(screen.getByTestId("amount-input"), { target: { value: "25000" } });
    fireEvent.click(screen.getByTestId("category-c-vivienda"));

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const guardar = screen.getByTestId("save-button");
    fireEvent.click(guardar);
    act(() => { vi.advanceTimersByTime(700); });
    fireEvent.click(guardar);
    act(() => { vi.advanceTimersByTime(1400); }); // se va la confirmación del primer guardado

    fireEvent.change(screen.getByTestId("amount-input"), { target: { value: "999" } });
    act(() => { vi.advanceTimersByTime(900); }); // aquí vencía el temporizador del segundo guardado
    expect((screen.getByTestId("amount-input") as HTMLInputElement).value).not.toBe("");
    expect(store.getState().data.movements).toHaveLength(1);
  });
});

describe("BG-081 (d) · el error de acceso no sobrevive al cambio de formulario", () => {
  async function formulario(respuesta: { error: unknown }) {
    vi.resetModules();
    vi.doMock("@/lib/authClient", () => ({
      signIn: { email: vi.fn(async () => respuesta), social: vi.fn() },
      signUp: { email: vi.fn(async () => respuesta) },
    }));
    const { AuthForm } = await import("@/components/auth/AuthForm");
    render(React.createElement(AuthForm));
    fireEvent.change(screen.getByTestId("auth-email"), { target: { value: "alguien@example.com" } });
    fireEvent.change(screen.getByTestId("auth-password"), { target: { value: "una-clave" } });
  }
  const enviar = async () => {
    await act(async () => { fireEvent.submit(screen.getByTestId("auth-form")); await Promise.resolve(); });
  };

  it("BG-081d: de «Iniciar sesión» a «Crear cuenta», el error anterior desaparece", async () => {
    await formulario({ error: { status: 401 } });
    await enviar();
    expect(screen.getByTestId("auth-error").textContent).toBe("Credenciales inválidas");

    fireEvent.click(screen.getByTestId("auth-toggle"));
    expect(screen.getByRole("heading").textContent).toBe("Crear cuenta");
    expect(screen.queryByTestId("auth-error")).toBeNull();
    expect(screen.getByTestId("auth-email").getAttribute("aria-invalid")).toBe("false");
  });

  it("BG-081d: una contraseña corta al registrarse dice su motivo; otro fallo conserva el mensaje de siempre", async () => {
    await formulario({ error: { status: 400, code: "PASSWORD_TOO_SHORT" } });
    fireEvent.click(screen.getByTestId("auth-toggle"));
    fireEvent.change(screen.getByTestId("auth-password"), { target: { value: "corta" } });
    await enviar();
    expect(screen.getByTestId("auth-error").textContent).toBe("La contraseña es demasiado corta. Usa al menos 8 caracteres.");
    // El aviso es de la contraseña: el correo no se marca como inválido.
    expect(screen.getByTestId("auth-email").getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByTestId("auth-password").getAttribute("aria-invalid")).toBe("true");
    cleanup();

    await formulario({ error: { status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" } });
    fireEvent.click(screen.getByTestId("auth-toggle"));
    await enviar();
    expect(screen.getByTestId("auth-error").textContent).toBe("No se pudo crear la cuenta");
    cleanup();

    // En «Iniciar sesión» una contraseña corta sigue siendo, sin más, credenciales inválidas.
    await formulario({ error: { status: 400, code: "PASSWORD_TOO_SHORT" } });
    fireEvent.change(screen.getByTestId("auth-password"), { target: { value: "corta" } });
    await enviar();
    expect(screen.getByTestId("auth-error").textContent).toBe("Credenciales inválidas");
  });

  it("BG-081d: si se cambia de formulario con el envío en vuelo, su error ya no aparece en el otro", async () => {
    let responder: (v: { error: unknown }) => void = () => {};
    vi.resetModules();
    vi.doMock("@/lib/authClient", () => ({
      signIn: { email: vi.fn(() => new Promise((r) => { responder = r; })), social: vi.fn() },
      signUp: { email: vi.fn() },
    }));
    const { AuthForm } = await import("@/components/auth/AuthForm");
    render(React.createElement(AuthForm));
    fireEvent.change(screen.getByTestId("auth-email"), { target: { value: "alguien@example.com" } });
    fireEvent.change(screen.getByTestId("auth-password"), { target: { value: "una-clave" } });
    await act(async () => { fireEvent.submit(screen.getByTestId("auth-form")); await Promise.resolve(); });

    fireEvent.click(screen.getByTestId("auth-toggle")); // el usuario se pasa a «Crear cuenta» sin esperar
    await act(async () => { responder({ error: { status: 401 } }); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("heading").textContent).toBe("Crear cuenta");
    expect(screen.queryByTestId("auth-error")).toBeNull();
    expect((screen.getByTestId("auth-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("BG-081d: de «Crear cuenta» a «Iniciar sesión», también", async () => {
    await formulario({ error: { status: 422 } });
    fireEvent.click(screen.getByTestId("auth-toggle"));
    await enviar();
    expect(screen.getByTestId("auth-error").textContent).toBe("No se pudo crear la cuenta");

    fireEvent.click(screen.getByTestId("auth-toggle"));
    expect(screen.getByRole("heading").textContent).toBe("Iniciar sesión");
    expect(screen.queryByTestId("auth-error")).toBeNull();
  });
});
