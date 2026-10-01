/**
 * BG-065 — declarar o mover la apertura no puede cambiar el saldo de un mes cerrado.
 *
 * `saveStartFor` solo miraba el mes de inicio DECLARADO. Sin declaración la regla no corría: con
 * junio cerrado y nada declarado, declarar mayo con un saldo inicial se aceptaba y ese saldo movía
 * el de junio, que el usuario ya había dado por bueno. Tampoco miraba el mes PROPUESTO: con datos
 * anteriores al inicio (FR-1906) y esos meses cerrados, mover el inicio hacia uno de ellos también
 * movía sus saldos.
 *
 * Cada rechazo lleva al lado un control que se ACEPTA: sin él, una regla que lo rechazara todo
 * pasaría estas pruebas igual.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildSeed } from "@/domain";
import { isLeaf } from "@/domain/tree";
import { closeMonthFor, loadLedger, saveLedger, saveStartFor } from "@/server/data/ledgerRepo";
import { truncateAll, closeTestDb, createTestUser } from "./helpers/db";
import { celdaCuadrada } from "../../helpers/cuadre";
import type { LedgerState, PeriodKey } from "@/domain/types";

const A = "user-bg065";
const JUN: PeriodKey = "2026-06";
const AHORA: PeriodKey = "2026-09";

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene ninguna hoja de gasto");
  return h.id;
}

/** Ledger sin montos ni apertura declarada. */
async function sembrar(): Promise<number> {
  const seed = buildSeed(A, JUN);
  const res = await saveLedger(A, { ...seed, budgets: {}, actuals: {}, movements: [] }, 0);
  if (!res.ok) throw new Error("no se pudo sembrar");
  return (await loadLedger(A))!.revision;
}

/** Pone un gasto cuadrado en junio (así junio entra en el alcance del servidor y se puede cerrar). */
async function gastoEnJunio(): Promise<void> {
  const { state, revision } = (await loadLedger(A))!;
  const res = await saveLedger(A, celdaCuadrada(state, hojaDeGasto(state), JUN, 40_000), revision);
  if (!res.ok) throw new Error(`no se pudo guardar junio: ${JSON.stringify(res)}`);
}

async function cerrarJunio(): Promise<void> {
  const res = await closeMonthFor(A, (await loadLedger(A))!.revision, AHORA);
  if (!res.ok) throw new Error(`no se pudo cerrar: ${JSON.stringify(res)}`);
  expect((await loadLedger(A))!.state.closure?.closedThrough).toBe(JUN);
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "bg065@test.local");
});
afterAll(async () => { await closeTestDb(); });

describe("BG-065 — sin mes declarado, el inicio que cuenta es el primero con datos", () => {
  it("con junio cerrado y nada declarado, declarar mayo se rechaza nombrando junio y no cambia nada", async () => {
    await sembrar();
    await gastoEnJunio();
    await cerrarJunio();
    const antes = (await loadLedger(A))!;
    expect(antes.state.startMonth ?? null).toBeNull();

    const res = await saveStartFor(A, antes.revision, "2026-05", 3_000_000);
    expect(res).toMatchObject({ ok: false, rejected: "month_closed", period: JUN });

    // Declarar junio mismo tampoco: es el inicio efectivo y está cerrado.
    const enJunio = await saveStartFor(A, antes.revision, JUN, 3_000_000);
    expect(enJunio).toMatchObject({ ok: false, rejected: "month_closed", period: JUN });

    const despues = (await loadLedger(A))!;
    expect(despues.state.startMonth ?? null).toBeNull();
    expect(despues.state.openingBalance ?? null).toBeNull();
    expect(despues.revision).toBe(antes.revision);
  });

  it("control: con junio ABIERTO, la misma declaración se acepta", async () => {
    await sembrar();
    await gastoEnJunio();
    const antes = (await loadLedger(A))!;

    const res = await saveStartFor(A, antes.revision, "2026-05", 3_000_000);
    expect(res).toMatchObject({ ok: true, startMonth: "2026-05", openingBalance: 3_000_000 });
  });
});

describe("BG-065 — el inicio propuesto tampoco puede estar cerrado", () => {
  /** Inicio declarado en julio y un gasto ANTERIOR en junio (FR-1906 lo permite). */
  async function inicioJulioConGastoEnJunio(): Promise<void> {
    const rev = await sembrar();
    const declarado = await saveStartFor(A, rev, "2026-07", 1_000_000);
    expect(declarado.ok).toBe(true);
    await gastoEnJunio();
  }

  it("mover el inicio de julio (abierto) a junio (cerrado) se rechaza nombrando junio", async () => {
    await inicioJulioConGastoEnJunio();
    await cerrarJunio();
    const antes = (await loadLedger(A))!;

    const res = await saveStartFor(A, antes.revision, JUN, 1_000_000);
    expect(res).toMatchObject({ ok: false, rejected: "month_closed", period: JUN });

    const despues = (await loadLedger(A))!;
    expect(despues.state.startMonth).toBe("2026-07");
    expect(despues.state.openingBalance).toBe(1_000_000);
    expect(despues.revision).toBe(antes.revision);
  });

  it("control: con junio ABIERTO, mover el inicio a junio se acepta", async () => {
    await inicioJulioConGastoEnJunio();
    const antes = (await loadLedger(A))!;

    const res = await saveStartFor(A, antes.revision, JUN, 1_000_000);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, startMonth: JUN, openingBalance: 1_000_000 });
  });
});
