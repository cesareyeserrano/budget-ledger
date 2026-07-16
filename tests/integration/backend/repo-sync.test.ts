/**
 * Epic 4 (core) — ServerRepository + SSE Hub. Partes testeables en proceso (sin navegador).
 * TCs: FR-508 (027h, 028e, 029f) · FR-511 (039e). El resto de FR-508..513 se cubre en e2e.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerRepository } from "@/data/serverRepository";
import { makeRepo } from "@/data/makeRepo";
import { syncHub, type SyncConnection, type SyncEvent } from "@/server/sync";
import { buildSeed, addMovement } from "@/domain";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FR-508 — ServerRepository (impl de servidor de LedgerRepository)", () => {
  it("TC-BE-027h: makeRepo autenticado devuelve la impl de servidor; guardar y re-hidratar muestra el movimiento", async () => {
    // @aitri-tc TC-BE-027h
    const repo = makeRepo({ authenticated: true });
    expect(repo).toBeInstanceOf(ServerRepository);

    const state = addMovement(buildSeed("A"), { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 5000, month: "jun" });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return new Response(JSON.stringify({ revision: 1 }), { status: 200 });
      return new Response(JSON.stringify({ revision: 1, state }), { status: 200 }); // GET re-hidrata
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await repo!.save("A", state)).toBe(true);
    const reloaded = await repo!.load("A");
    expect(reloaded!.movements.some((m) => m.amount === 5000)).toBe(true);
  });

  it("TC-BE-028e: las escrituras van al servidor (PUT /api/v1/ledger), nunca a localStorage", async () => {
    // @aitri-tc TC-BE-028e
    const repo = new ServerRepository();
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem, getItem: vi.fn(), removeItem: vi.fn() });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ revision: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await repo.save("A", buildSeed("A"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v1/ledger");
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("include");
    // Nunca escribe llaves financieras en localStorage.
    for (const call of setItem.mock.calls) expect(String(call[0])).not.toMatch(/ledger\.(nodes|budget)/);
  });

  it("TC-BE-029f: un fallo de red en save() devuelve false y no corrompe el estado local", async () => {
    // @aitri-tc TC-BE-029f
    const repo = new ServerRepository();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const state = buildSeed("A");
    const snapshot = JSON.stringify(state);

    const ok = await repo.save("A", state); // no debe lanzar
    expect(ok).toBe(false);
    expect(JSON.stringify(state)).toBe(snapshot); // el estado en memoria intacto
  });

  it("TC-BE-029f-conflict: un 409 marca conflicto y devuelve false (el caller re-hidrata)", async () => {
    // conflicto stale: cubre la rama 409 de save (last-write-wins informado, ADR-06)
    const repo = new ServerRepository();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ revision: 7 }), { status: 409 })));
    expect(await repo.save("A", buildSeed("A"))).toBe(false);
    expect(repo.conflicted).toBe(true);
    expect(repo.currentRevision).toBe(7);
  });
});

describe("FR-511 — SSE Hub enruta por userId", () => {
  it("TC-BE-039e: publish() entrega solo a las conexiones del mismo userId", () => {
    // @aitri-tc TC-BE-039e
    const mk = () => {
      const received: SyncEvent[] = [];
      const conn: SyncConnection = { send: (e) => received.push(e) };
      return { conn, received };
    };
    const a1 = mk();
    const a2 = mk();
    const b1 = mk();
    const unsubA1 = syncHub.subscribe("A", a1.conn);
    const unsubA2 = syncHub.subscribe("A", a2.conn);
    const unsubB1 = syncHub.subscribe("B", b1.conn);
    try {
      syncHub.publish("A", { revision: 12 });
      expect(a1.received).toEqual([{ revision: 12 }]);
      expect(a2.received).toEqual([{ revision: 12 }]);
      expect(b1.received).toEqual([]); // B no recibe el evento de A
    } finally {
      unsubA1();
      unsubA2();
      unsubB1();
    }
  });

  it("TC-BE-038e-hub: publish a cero conexiones (dispositivo cerrado) es no-op, sin error", () => {
    // rama AC-511c: publicar sin conexiones no lanza
    expect(() => syncHub.publish("sin-conexiones", { revision: 1 })).not.toThrow();
  });
});
