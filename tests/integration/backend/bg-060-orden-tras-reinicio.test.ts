/**
 * BG-060 — un movimiento creado por la API tras reiniciar el servidor nace DESPUÉS de los guardados.
 *
 * `insertMovement` usa `addMovement`, y por tanto `nextSeq()`: un contador del PROCESO que el
 * servidor no sembraba. Tras un reinicio arrancaba en 0, el movimiento nuevo nacía con `createdAt`
 * 1 y `GET /api/v1/movements`, que ordena por `createdAt` descendente, lo ponía al FINAL, detrás de
 * movimientos anteriores. Es BG-010, que solo se había arreglado en el cliente.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildSeed } from "@/domain";
import { isLeaf } from "@/domain/tree";
import { __resetSeq } from "@/domain/ids";
import { getMovements, insertMovement, loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { truncateAll, closeTestDb, createTestUser } from "./helpers/db";
import { celdaCuadrada } from "../../helpers/cuadre";
import type { LedgerState, PeriodKey } from "@/domain/types";

const A = "user-bg060";
const SEP: PeriodKey = "2026-09";

function hoja(s: LedgerState, tipo: "income" | "expense"): string {
  return s.nodes.find((n) => n.type === tipo && isLeaf(n, s.nodes))!.id;
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "bg060@test.local");
});
afterAll(async () => { await closeTestDb(); });

describe("BG-060 — la secuencia de createdAt sobrevive a un reinicio del servidor", () => {
  it("el movimiento nuevo tiene un createdAt mayor que los guardados y sale primero", async () => {
    // Un ledger con un gasto guardado con un createdAt alto (sesiones anteriores).
    const seed = buildSeed(A, SEP);
    const s0: LedgerState = { ...seed, budgets: {}, actuals: {}, movements: [] };
    const conGasto = celdaCuadrada(s0, hoja(s0, "expense"), SEP, 5_000);
    const guardado = { ...conGasto, movements: conGasto.movements.map((m) => ({ ...m, createdAt: 500 })) };
    expect((await saveLedger(A, guardado, 0)).ok).toBe(true);

    // «Reinicio»: el contador del proceso vuelve a 0.
    __resetSeq();

    const { state } = (await loadLedger(A))!;
    const r = await insertMovement(A, { type: "income", catId: hoja(state, "income"), period: SEP, amount: "1000", date: `${SEP}-10T12:00` });
    expect(r && "movement" in r, JSON.stringify(r)).toBe(true);
    const nuevo = (r as { movement: { id: string; createdAt: number } }).movement;
    expect(nuevo.createdAt).toBeGreaterThan(500);

    const lista = await getMovements(A);
    expect(lista[0]!.id).toBe(nuevo.id);
  });
});
