/**
 * BG-081 (h) — el sync en vivo sobrevive a una reconexión fallida y se pone al día al volver.
 *
 * `EventSource` reintenta solo ante una caída de red, pero si el reintento recibe algo que no es un
 * stream (el 502 del proxy mientras la app reinicia, un 401) el navegador lo deja en CLOSED y no lo
 * vuelve a intentar. El cliente no escuchaba `error`, así que el sync moría para el resto de la sesión;
 * y tampoco escuchaba `open`, así que lo publicado durante el corte no se recuperaba.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncClient } from "@/data/syncClient";

/** Un EventSource de mentira: guarda sus oyentes y deja disparar los eventos a mano. */
class FakeEventSource {
  static instancias: FakeEventSource[] = [];
  readyState = 0; // CONNECTING
  cerrado = false;
  private oyentes = new Map<string, Array<(ev: unknown) => void>>();
  constructor(public url: string, public init?: { withCredentials?: boolean }) { FakeEventSource.instancias.push(this); }
  addEventListener(tipo: string, fn: (ev: unknown) => void) { this.oyentes.set(tipo, [...(this.oyentes.get(tipo) ?? []), fn]); }
  close() { this.cerrado = true; this.readyState = 2; }
  emitir(tipo: string, ev: unknown = {}) { for (const fn of this.oyentes.get(tipo) ?? []) fn(ev); }
  abrir() { this.readyState = 1; this.emitir("open"); }
  /** Caída de red: el navegador pasa a CONNECTING y reintenta por su cuenta. */
  caerRed() { this.readyState = 0; this.emitir("error"); }
  /** El reintento recibió algo que no es un stream: CLOSED, y el navegador no insiste. */
  morir() { this.readyState = 2; this.emitir("error"); }
}

const ultima = () => FakeEventSource.instancias[FakeEventSource.instancias.length - 1]!;

beforeEach(() => {
  FakeEventSource.instancias = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("BG-081 (h) · reconexión del sync en vivo", () => {
  it("BG-081h: la primera apertura no pide puesta al día, y un evento `revision` avisa", () => {
    const onRevision = vi.fn();
    const ponerseAlDia = vi.fn();
    const c = new SyncClient(onRevision, "", ponerseAlDia);
    c.start();
    ultima().abrir();
    expect(ponerseAlDia).not.toHaveBeenCalled();
    expect(ultima().url).toBe("/api/v1/sync/stream");
    expect(ultima().init).toEqual({ withCredentials: true });

    ultima().emitir("revision", { data: JSON.stringify({ revision: 7 }) });
    expect(onRevision).toHaveBeenCalledWith(7);
    ultima().emitir("revision", { data: "esto no es JSON" });
    expect(onRevision).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("BG-081h: tras una caída de red, al reabrir el navegador se pide una puesta al día", () => {
    const ponerseAlDia = vi.fn();
    const c = new SyncClient(vi.fn(), "", ponerseAlDia);
    c.start();
    ultima().abrir();
    ultima().caerRed();
    expect(ponerseAlDia).not.toHaveBeenCalled(); // todavía está reintentando
    expect(FakeEventSource.instancias).toHaveLength(1);

    ultima().abrir();
    expect(ponerseAlDia).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("BG-081h: si el navegador da el stream por cerrado, se reabre solo y con espera creciente", () => {
    const ponerseAlDia = vi.fn();
    const c = new SyncClient(vi.fn(), "", ponerseAlDia);
    c.start();
    ultima().abrir();

    ultima().morir();
    expect(ponerseAlDia).toHaveBeenCalledTimes(1); // se pone al día en el momento del corte
    expect(FakeEventSource.instancias).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instancias).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instancias).toHaveLength(2);

    // El segundo intento también muere: la espera se dobla (2 s), y así hasta el tope de 30 s.
    ultima().morir();
    vi.advanceTimersByTime(1999);
    expect(FakeEventSource.instancias).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instancias).toHaveLength(3);
    for (let i = 0; i < 6; i++) { ultima().morir(); vi.advanceTimersByTime(30_000); }
    expect(FakeEventSource.instancias).toHaveLength(9);
    ultima().morir();
    vi.advanceTimersByTime(29_999);
    expect(FakeEventSource.instancias).toHaveLength(9);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instancias).toHaveLength(10);

    // Al abrir por fin, la espera vuelve a 1 s y se pide la puesta al día de lo perdido.
    const antes = ponerseAlDia.mock.calls.length;
    ultima().abrir();
    expect(ponerseAlDia).toHaveBeenCalledTimes(antes + 1);
    ultima().morir();
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instancias).toHaveLength(11);
    c.stop();
  });

  it("BG-081h: `stop()` cancela la reapertura pendiente", () => {
    const c = new SyncClient(vi.fn(), "", vi.fn());
    c.start();
    ultima().abrir();
    ultima().morir();
    c.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instancias).toHaveLength(1);
  });

  it("BG-081h: si la puesta al día descubre la sesión muerta y detiene el cliente, no se reabre", () => {
    let c: SyncClient | null = null;
    c = new SyncClient(vi.fn(), "", () => c?.stop());
    c.start();
    ultima().abrir();
    ultima().morir();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instancias).toHaveLength(1);
  });
});
