// @vitest-environment jsdom
/**
 * BG-010 — el store debe SEMBRAR el suelo de la secuencia al adoptar datos de la fuente de verdad.
 *
 * El test de dominio (tests/domain/seq-monotonic.test.ts) prueba que `seedSeqFrom` funciona; este
 * prueba lo otro, que es donde vivía el defecto: que `hydrate()` y el resync lo LLAMAN. Sin este
 * cableado el helper sería correcto y el bug seguiría en pie.
 *
 * Mismo patrón que write-serialization.test.ts: el store es un singleton de módulo, así que cada
 * test re-importa con vi.resetModules() y stubbea fetch ANTES del import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LedgerState } from "@/domain/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sirve un estado ya persistido (como si lo hubiera dejado una sesión anterior). */
function stubApiServing(state: LedgerState) {
  let stored: LedgerState = state;
  let serverRevision = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { baseRevision: number; state: LedgerState };
        serverRevision += 1;
        stored = body.state;
        return new Response(JSON.stringify({ revision: serverRevision }), { status: 200 });
      }
      return new Response(JSON.stringify({ revision: serverRevision, state: stored }), { status: 200 });
    })
  );
  return {
    get stored() {
      return stored;
    },
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BG-010 — el store siembra la secuencia al cargar", () => {
  it("tras hydrate(), el movimiento nuevo supera al createdAt más alto ya persistido", async () => {
    vi.resetModules();
    const { buildSeed, addMovement, __resetSeq } = await import("@/domain");

    // Sesión ANTERIOR: deja tres movimientos persistidos (createdAt 1..3).
    __resetSeq();
    let previo = buildSeed("local");
    for (const amount of [10_000, 20_000, 30_000]) {
      previo = addMovement(previo, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount, month: "jun" });
    }
    const maxPersistido = Math.max(...previo.movements.map((m) => m.createdAt));
    expect(maxPersistido).toBeGreaterThan(0);

    // Sesión NUEVA: proceso limpio (la secuencia vuelve a 0) que carga esos datos del servidor.
    const api = stubApiServing(previo);
    __resetSeq();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(true);

    store.getState().addMovement({ type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 40_000, month: "jun" });
    await delay(40);

    const nuevo = store.getState().data.movements[0];
    expect(nuevo.amount).toBe(40_000);
    // Sin la siembra nacería con createdAt 1 y se ordenaría DETRÁS de los tres anteriores.
    expect(nuevo.createdAt).toBeGreaterThan(maxPersistido);

    // El orden que sirve GET /api/v1/movements (createdAt descendente) pone el nuevo primero.
    const desc = [...api.stored.movements].sort((a, b) => b.createdAt - a.createdAt);
    expect(desc[0].amount).toBe(40_000);
  });

  it("tras un resync que trae escrituras ajenas, la próxima mutación local no reutiliza sus createdAt", async () => {
    vi.resetModules();
    const { buildSeed, addMovement, __resetSeq } = await import("@/domain");

    __resetSeq();
    const store0 = buildSeed("local");
    const api = stubApiServing(store0);
    __resetSeq();
    const store = (await import("@/state/store")).useLedgerStore;
    await store.getState().hydrate();

    // OTRO dispositivo escribe con createdAt altos y el servidor pasa a servir eso.
    __resetSeq();
    let ajeno = buildSeed("local");
    for (let i = 0; i < 9; i++) {
      ajeno = addMovement(ajeno, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 1_000 * (i + 1), month: "jun" });
    }
    const maxAjeno = Math.max(...ajeno.movements.map((m) => m.createdAt));
    stubApiServing(ajeno);

    await store.getState().resync();
    expect(store.getState().data.movements.length).toBe(ajeno.movements.length);

    store.getState().addMovement({ type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 99_000, month: "jun" });
    await delay(40);

    const nuevo = store.getState().data.movements[0];
    expect(nuevo.amount).toBe(99_000);
    expect(nuevo.createdAt).toBeGreaterThan(maxAjeno);
    // Y nadie comparte createdAt: la colisión sería el mismo desorden por otra vía.
    const ids = store.getState().data.movements.map((m) => m.createdAt);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
