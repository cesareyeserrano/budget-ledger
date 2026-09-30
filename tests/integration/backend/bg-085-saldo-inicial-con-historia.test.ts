/**
 * BG-085 — con un dato anterior al inicio, el saldo inicial vuelve a poder editarse.
 *
 * `saveStartFor` rechazaba con 422 would_orphan cualquier guardado mientras hubiera un dato antes
 * del inicio declarado, aunque el mes no se moviera. Ahora solo cuenta lo que el cambio saca del
 * historial; mover el inicio adelante sobre meses con datos sigue bloqueado (FR-2206).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildSeed } from "@/domain";
import { isLeaf } from "@/domain/tree";
import { loadLedger, saveLedger, saveStartFor } from "@/server/data/ledgerRepo";
import { truncateAll, closeTestDb, createTestUser } from "./helpers/db";
import { celdaCuadrada } from "../../helpers/cuadre";
import type { LedgerState, PeriodKey } from "@/domain/types";

const A = "user-bg085";
const JUN: PeriodKey = "2026-06";
const JUL: PeriodKey = "2026-07";

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene ninguna hoja de gasto");
  return h.id;
}

/** Inicio declarado en julio y, después, gastos cuadrados en `meses` (FR-1906 deja registrar antes). */
async function inicioJulioCon(meses: PeriodKey[]): Promise<void> {
  const seed = buildSeed(A, JUN);
  const sembrado = await saveLedger(A, { ...seed, budgets: {}, actuals: {}, movements: [] }, 0);
  if (!sembrado.ok) throw new Error("no se pudo sembrar");
  const declarado = await saveStartFor(A, (await loadLedger(A))!.revision, JUL, 1_000);
  expect(declarado.ok).toBe(true);
  let { state, revision } = (await loadLedger(A))!;
  for (const p of meses) state = celdaCuadrada(state, hojaDeGasto(state), p, 100);
  const res = await saveLedger(A, state, revision);
  if (!res.ok) throw new Error(`no se pudo guardar: ${JSON.stringify(res)}`);
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "bg085@test.local");
});
afterAll(async () => { await closeTestDb(); });

describe("BG-085 — la historia anterior al inicio no bloquea el saldo inicial", () => {
  it("con un gasto en junio y el inicio en julio, cambiar el saldo de julio se acepta", async () => {
    await inicioJulioCon([JUN]);
    const antes = (await loadLedger(A))!;

    const res = await saveStartFor(A, antes.revision, JUL, 2_000);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, startMonth: JUL, openingBalance: 2_000 });
    expect((await loadLedger(A))!.state.openingBalance).toBe(2_000);
  });

  it("mover el inicio a agosto con gastos en junio y julio se rechaza nombrando SOLO julio", async () => {
    await inicioJulioCon([JUN, JUL]);
    const antes = (await loadLedger(A))!;

    const res = await saveStartFor(A, antes.revision, "2026-08", 1_000);
    expect(res).toMatchObject({ ok: false, rejected: "would_orphan", periods: [JUL] });
    const despues = (await loadLedger(A))!;
    expect(despues.state.startMonth).toBe(JUL);
    expect(despues.revision).toBe(antes.revision);
  });
});
