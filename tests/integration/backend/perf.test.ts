/**
 * Epic 5 — Rendimiento (NFR-506). Lectura/escritura de la API ≤500ms; el roll-up del cliente ≤150ms
 * no se degrada (el cálculo sigue en el cliente). Contra Postgres efímero.
 * TCs: NFR-506 (062h, 063e, 064f).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildSeed, addMovement, rollupBudget, rollupActual } from "@/domain";
import { setLeafAmount } from "@/domain/mutations";
import type { PeriodKey } from "@/domain";
import { loadLedger, saveLedger, insertMovement } from "@/server/data/ledgerRepo";
import { sql } from "drizzle-orm";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";
import { P, P0 } from "../../helpers/periods";
import { buildSeedConMontos } from "../../helpers/seedConMontos";

const A = "user-perf";
const READ_WRITE_BUDGET_MS = 500;
const ROLLUP_BUDGET_MS = 150;
const MONTHS: PeriodKey[] = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];

/** Milisegundos que tarda una operación contra la base. */
async function medir(op: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await op();
  return performance.now() - t0;
}

/** El presupuesto de latencia de lectura y escritura (NFR-506): falla si se excede. */
function exigirPresupuesto(ms: number): void {
  expect(ms, `${ms.toFixed(0)} ms contra un presupuesto de ${READ_WRITE_BUDGET_MS} ms`).toBeLessThanOrEqual(READ_WRITE_BUDGET_MS);
}

/** Construye un estado con ~N movimientos (usuario típico con histórico). */
function seedWithMovements(ownerId: string, n: number) {
  let state = buildSeed(ownerId, P0);
  for (let i = 0; i < n; i++) {
    state = addMovement(state, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 1000 + i, period: MONTHS[i % 12] }, P);
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
    let loaded: Awaited<ReturnType<typeof loadLedger>> = null;
    const dt = await medir(async () => { loaded = await loadLedger(A); });
    expect(loaded).not.toBeNull();
    expect(loaded!.state.movements.length).toBe(2000);
    exigirPresupuesto(dt);
  });

  it("TC-BE-063e: una escritura confirma en ≤500ms y el roll-up del cliente se mantiene ≤150ms", async () => {
    // @aitri-tc TC-BE-063e
    await saveLedger(A, buildSeed(A, P0), 0);
    const t0 = performance.now();
    const res = await insertMovement(A, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 5000, period: "2026-06" });
    const writeMs = performance.now() - t0;
    expect(res).not.toBeNull();
    expect(writeMs).toBeLessThanOrEqual(READ_WRITE_BUDGET_MS);

    // Roll-up del cliente sobre la jerarquía semilla: recálculo tras editar una hoja.
    // BL-062: la semilla del producto no trae montos (FR-2301) y esto cronometraba sumar ceros. Se
    // mide sobre la semilla poblada y se exige que lo sumado sea dinero.
    const state = setLeafAmount(buildSeedConMontos(A, P0), "s-comida-mercado", "2026-06", "actual", 5000, P);
    let presupuestado = 0;
    let ejecutado = 0;
    const t1 = performance.now();
    for (const m of MONTHS) {
      for (const n of state.nodes) {
        presupuestado += rollupBudget(state, n.id, m);
        ejecutado += rollupActual(state, n.id, m);
      }
    }
    const rollupMs = performance.now() - t1;
    expect(presupuestado).toBeGreaterThan(0);
    expect(ejecutado).toBeGreaterThan(0);
    // la edición de la hoja llegó hasta su grupo
    expect(rollupActual(state, "s-comida-mercado", "2026-06")).toBe(5000);
    expect(rollupActual(state, "g-esenciales", "2026-06")).toBeGreaterThan(5000);
    expect(rollupMs).toBeLessThanOrEqual(ROLLUP_BUDGET_MS);
  });

  it("TC-BE-064f: el presupuesto de 500ms es una aserción dura, no advisory", async () => {
    // @aitri-tc TC-BE-064f
    // BL-063: afirmaba `650 <= 500` sobre una constante; no medía nada. Ahora la MISMA función que
    // hace cumplir el presupuesto en TC-BE-062h recibe una operación real que lo excede —una consulta
    // que tarda 600 ms en la base— y tiene que fallar; y con una lectura real dentro del presupuesto, no.
    await saveLedger(A, seedWithMovements(A, 500), 0);
    const real = await medir(() => loadLedger(A));
    expect(() => exigirPresupuesto(real)).not.toThrow();

    const lenta = await medir(() => testDb().execute(sql`SELECT pg_sleep(0.6)`));
    expect(lenta).toBeGreaterThan(READ_WRITE_BUDGET_MS);
    expect(() => exigirPresupuesto(lenta)).toThrow();
  });
});
