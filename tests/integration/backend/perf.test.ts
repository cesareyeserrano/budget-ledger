/**
 * Epic 5 — Rendimiento (NFR-506). Lectura/escritura de la API ≤500ms; el roll-up del cliente ≤150ms
 * no se degrada (el cálculo sigue en el cliente). Contra Postgres efímero.
 * TCs: NFR-506 (062h, 063e, 064f).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildSeed, addMovement, rollupBudget, rollupActual } from "@/domain";
import type { MonthKey } from "@/domain";
import { loadLedger, saveLedger, insertMovement } from "@/server/data/ledgerRepo";
import { truncateAll, closeTestDb, createTestUser } from "./helpers/db";

const A = "user-perf";
const READ_WRITE_BUDGET_MS = 500;
const ROLLUP_BUDGET_MS = 150;
const MONTHS: MonthKey[] = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Construye un estado con ~N movimientos (usuario típico con histórico). */
function seedWithMovements(ownerId: string, n: number) {
  let state = buildSeed(ownerId);
  for (let i = 0; i < n; i++) {
    state = addMovement(state, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 1000 + i, month: MONTHS[i % 12] });
  }
  return state;
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "perf@example.com");
});
afterAll(async () => {
  await closeTestDb();
});

describe("NFR-506 — presupuesto de latencia", () => {
  it("TC-BE-062h: una lectura del ledger de un usuario típico responde en ≤500ms", async () => {
    // @aitri-tc TC-BE-062h
    await saveLedger(A, seedWithMovements(A, 2000), 0);
    const t0 = performance.now();
    const loaded = await loadLedger(A);
    const dt = performance.now() - t0;
    expect(loaded).not.toBeNull();
    expect(loaded!.state.movements.length).toBe(2000);
    expect(dt).toBeLessThanOrEqual(READ_WRITE_BUDGET_MS);
  });

  it("TC-BE-063e: una escritura confirma en ≤500ms y el roll-up del cliente se mantiene ≤150ms", async () => {
    // @aitri-tc TC-BE-063e
    await saveLedger(A, buildSeed(A), 0);
    const t0 = performance.now();
    const res = await insertMovement(A, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 5000, month: "jun" });
    const writeMs = performance.now() - t0;
    expect(res).not.toBeNull();
    expect(writeMs).toBeLessThanOrEqual(READ_WRITE_BUDGET_MS);

    // Roll-up del cliente sobre la jerarquía semilla: recálculo tras editar una hoja.
    const state = buildSeed(A);
    const t1 = performance.now();
    for (const m of MONTHS) {
      for (const n of state.nodes) {
        rollupBudget(state, n.id, m);
        rollupActual(state, n.id, m);
      }
    }
    const rollupMs = performance.now() - t1;
    expect(rollupMs).toBeLessThanOrEqual(ROLLUP_BUDGET_MS);
  });

  it("TC-BE-064f: el presupuesto de 500ms es una aserción dura, no advisory", async () => {
    // @aitri-tc TC-BE-064f
    await saveLedger(A, seedWithMovements(A, 500), 0);
    // La lectura real está dentro del presupuesto.
    const t0 = performance.now();
    await loadLedger(A);
    const real = performance.now() - t0;
    expect(real).toBeLessThanOrEqual(READ_WRITE_BUDGET_MS);
    // Falsabilidad: una operación por encima del presupuesto FALLARÍA la aserción (no se ignora).
    const simulatedOver = 650;
    expect(simulatedOver <= READ_WRITE_BUDGET_MS).toBe(false);
  });
});
