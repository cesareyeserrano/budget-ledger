/**
 * BG-061 — cambiar a ciclos no responde 500 por una fecha que el calendario no sabe ubicar.
 *
 * Los esquemas aceptaban cualquier cadena como fecha y en modo mes el periodo solo lee siete
 * caracteres: «2026-09-31» pasaba por septiembre y se guardaba. Después `relocate` llamaba a
 * `periodForDate` sin guarda sobre un calendario construido solo hasta el año en curso más dos, y
 * lanzaba: la ruta lo convertía en 500 sin decir qué movimiento era. Lo mismo con una fecha válida
 * pero lejana (2030).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildSeed } from "@/domain";
import { isLeaf } from "@/domain/tree";
import { loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { applyCyclesFor, previewCyclesFor } from "@/server/data/cyclesRepo";
import { movementInputSchema, ledgerPutSchema } from "@/server/schemas";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";
import { celdaCuadrada } from "../../helpers/cuadre";
import type { LedgerState, PeriodKey } from "@/domain/types";

const A = "user-bg061";
const SEP: PeriodKey = "2026-09";
const HOY = "2026-09-10";
const CICLOS = { mode: "cycle" as const, anchorDay: 21, eomPolicy: "last_day" as const };

function gasto(s: LedgerState): string {
  return s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes))!.id;
}

/** Un ledger con UN gasto cuadrado en `period`, fechado en `fecha`. */
async function conGasto(period: PeriodKey, fecha: string): Promise<string> {
  const seed = buildSeed(A, SEP);
  const s0: LedgerState = { ...seed, budgets: {}, actuals: {}, movements: [] };
  const s = celdaCuadrada(s0, gasto(s0), period, 5_000);
  const conFecha = { ...s, movements: s.movements.map((m) => ({ ...m, date: fecha })) };
  const r = await saveLedger(A, conFecha, 0);
  if (!r.ok) throw new Error(`no se pudo sembrar: ${JSON.stringify(r)}`);
  return conFecha.movements[0]!.id;
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "bg061@test.local");
});
afterAll(async () => { await closeTestDb(); });

describe("BG-061 — el borde rechaza fechas que no existen", () => {
  it("POST /movements y PUT /ledger rechazan «2026-09-31»; aceptan «2026-09-30T12:00»", () => {
    const base = { type: "expense", catId: "c", amount: 100, period: SEP };
    expect(movementInputSchema.safeParse({ ...base, date: "2026-09-31" }).success).toBe(false);
    expect(movementInputSchema.safeParse({ ...base, date: "2026-09-05 almuerzo" }).success).toBe(false);
    expect(movementInputSchema.safeParse({ ...base, date: "2026-09-30T12:00" }).success).toBe(true);

    const mv = { id: "m", ownerId: "o", type: "expense", catId: "c", subId: null, target: "c", amount: 100, period: SEP, createdAt: 1 };
    const snap = (date: string) => ({ baseRevision: 0, state: { ownerId: "o", nodes: [], budgets: {}, actuals: {}, movements: [{ ...mv, date }] } });
    expect(ledgerPutSchema.safeParse(snap("2026-09-31")).success).toBe(false);
    expect(ledgerPutSchema.safeParse(snap("2026-09-30T12:00")).success).toBe(true);
  });
});

describe("BG-061 — el cambio de periodo ubica o nombra cada fecha", () => {
  it("un gasto fechado en 2030 no impide activar ciclos", async () => {
    await conGasto("2030-06", "2030-06-10T09:00");
    const r = await applyCyclesFor(A, (await loadLedger(A))!.revision, CICLOS, HOY);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("una fecha inexistente ya guardada responde 422 nombrando el movimiento, no 500", async () => {
    const id = await conGasto(SEP, "2026-09-10T12:00");
    // Un dato viejo, anterior a la validación del borde: se escribe directo en la base.
    await testDb().execute(sql`UPDATE movement SET date = '2026-09-31T12:00' WHERE owner_id = ${A} AND id = ${id}`);

    const p = await previewCyclesFor(A, CICLOS, HOY);
    expect(p).toMatchObject({ ok: false, blocked: "relocation_invariant", detail: { rule: "unplaceable_date", ids: [id] } });
    const r = await applyCyclesFor(A, (await loadLedger(A))!.revision, CICLOS, HOY);
    expect(r).toMatchObject({ ok: false, blocked: "relocation_invariant", detail: { rule: "unplaceable_date", ids: [id] } });
  });

  it("control: con fechas válidas, activar ciclos funciona", async () => {
    await conGasto(SEP, "2026-09-10T12:00");
    const r = await applyCyclesFor(A, (await loadLedger(A))!.revision, CICLOS, HOY);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});
