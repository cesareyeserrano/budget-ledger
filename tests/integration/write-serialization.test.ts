// @vitest-environment jsdom
/**
 * BL-010 — serialización de escrituras al servidor (store → ServerRepository).
 *
 * El defecto: persist() disparaba un PUT por mutación sin esperar; dos ediciones rápidas salían
 * con la misma baseRevision, la segunda recibía 409 y el resync sobrescribía en silencio lo que
 * el usuario acababa de teclear. Estos tests fijan el contrato nuevo:
 *   · un solo save en vuelo, con coalescencia del último snapshot
 *   · cada PUT sale con la revisión que devolvió el anterior (cero 409 auto-infligidos)
 *   · un 409 genuino (otra sesión) converge al servidor Y avisa con un toast — nunca en silencio
 *
 * Nota: el store es un singleton de módulo; cada test re-importa con vi.resetModules() y stubbea
 * fetch ANTES del import para que makeRepo() capture el entorno correcto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LedgerState } from "@/domain/types";
import { P, P0 } from "../helpers/periods";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PutRecord = { baseRevision: number; state: LedgerState };

function stubApi(opts: { putLatencyMs?: number; forceConflictOnce?: boolean } = {}) {
  let serverRevision = 0;
  let stored: LedgerState | null = null;
  let inFlight = 0;
  const stats = { puts: [] as PutRecord[], maxInFlight: 0, conflicts: 0, gets: 0 };
  let pendingConflict = opts.forceConflictOnce ?? false;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") {
        inFlight += 1;
        stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
        await delay(opts.putLatencyMs ?? 15);
        inFlight -= 1;
        const body = JSON.parse(String(init.body)) as PutRecord;
        stats.puts.push(body);
        if (pendingConflict || body.baseRevision !== serverRevision) {
          pendingConflict = false;
          stats.conflicts += 1;
          return new Response(JSON.stringify({ revision: serverRevision }), { status: 409 });
        }
        serverRevision += 1;
        stored = body.state;
        return new Response(JSON.stringify({ revision: serverRevision }), { status: 200 });
      }
      stats.gets += 1;
      if (stored === null) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ revision: serverRevision, state: stored }), { status: 200 });
    })
  );

  return {
    stats,
    /** Simula que OTRA sesión escribió: sube la revisión y fija el estado del servidor. */
    foreignWrite(state: LedgerState) {
      serverRevision += 1;
      stored = state;
    },
    get stored() {
      return stored;
    },
  };
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/state/store");
  return mod.useLedgerStore;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BL-010 escrituras serializadas", () => {
  it("dos mutaciones rápidas → PUTs secuenciales encadenando revisión, sin 409", async () => {
    const api = stubApi({ putLatencyMs: 20 });
    const store = await freshStore();
    const s = store.getState();

    // Dos ediciones en el mismo tick: antes salían en paralelo con la misma baseRevision.
    s.setLeafAmount("s-comida-mercado", "2026-01", "budget", 111);
    s.setLeafAmount("s-comida-mercado", "2026-02", "budget", 222);

    await vi.waitFor(() => expect(api.stats.puts.length).toBeGreaterThanOrEqual(2));
    await delay(40); // drenar por completo

    expect(api.stats.maxInFlight).toBe(1); // nunca dos saves en vuelo
    expect(api.stats.conflicts).toBe(0); // cero 409 auto-infligidos
    // El segundo PUT salió con la revisión que devolvió el primero.
    expect(api.stats.puts[1]!.baseRevision).toBe(1);
    // El servidor terminó con AMBAS ediciones (la coalescencia no perdió la primera).
    expect(api.stored!.budgets["s-comida-mercado"]!["2026-01"]).toBe(111);
    expect(api.stored!.budgets["s-comida-mercado"]!["2026-02"]).toBe(222);
  });

  it("ráfaga de mutaciones → coalescencia: menos PUTs que mutaciones, estado final completo", async () => {
    const api = stubApi({ putLatencyMs: 25 });
    const store = await freshStore();
    const s = store.getState();

    for (let i = 1; i <= 6; i++) s.setLeafAmount("s-comida-mercado", "2026-01", "budget", i * 100);

    await delay(150);
    expect(api.stats.maxInFlight).toBe(1);
    expect(api.stats.conflicts).toBe(0);
    expect(api.stats.puts.length).toBeLessThan(6); // los snapshots intermedios se coalescen
    expect(api.stored!.budgets["s-comida-mercado"]!["2026-01"]).toBe(600); // el último gana
  });

  it("409 genuino (otra sesión) → converge al servidor Y avisa con toast, nunca en silencio", async () => {
    const api = stubApi({ putLatencyMs: 5, forceConflictOnce: true });
    const store = await freshStore();

    // Estado que "la otra sesión" dejó en el servidor (lo que el GET del resync devolverá).
    const { buildSeed } = await import("@/domain");
    const { setLeafAmount } = await import("@/domain/mutations");
    const foreign = setLeafAmount(buildSeed("local", P0), "s-comida-mercado", "2026-03", "budget", 999, P);
    api.foreignWrite(foreign);

    store.getState().setLeafAmount("s-comida-mercado", "2026-01", "budget", 111);

    await vi.waitFor(() => expect(api.stats.gets).toBeGreaterThanOrEqual(1)); // hubo resync
    await vi.waitFor(() => {
      const st = store.getState();
      // Convergió al estado del servidor (ADR-06: last-write-wins informado)…
      expect(st.data.budgets["s-comida-mercado"]?.["2026-03"]).toBe(999);
      // …y el descarte NO fue silencioso (BL-010).
      expect(st.toast).toMatch(/Otro dispositivo/);
    });
  });
});
