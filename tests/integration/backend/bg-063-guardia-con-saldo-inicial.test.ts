/**
 * BG-063 — el guardia de reservas del servidor juzga los estados CON el saldo inicial guardado.
 *
 * `loadStateInTx` no adjunta el mes de inicio ni el saldo inicial, así que el guardia comparaba un
 * estado guardado SIN apertura contra el que mandara la petición, con la apertura que ésta dijera:
 *   1. el guardado parecía ya excedido, y una escritura que de verdad pasa el techo no se veía peor;
 *   2. una apertura inventada en el cuerpo pasaba el techo (luego se descartaba al guardar);
 *   3. en POST /movements ningún lado la llevaba: un aporte pagado con el saldo inicial se rechazaba.
 * Además el rango juzgado arrancaba en el primer mes con datos, no en el mes de inicio, así que con
 * el inicio antes de los datos la apertura no entraba nunca. Es el mismo rango que usa el cierre.
 *
 * Cada rechazo lleva al lado su control aceptado: una regla que lo rechazara todo pasaría igual.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildSeed } from "@/domain";
import { isLeaf } from "@/domain/tree";
import { loadLedger, saveLedger, saveStartFor, insertMovement } from "@/server/data/ledgerRepo";
import { AVAILABLE_ID } from "@/domain/reserve";
import { truncateAll, closeTestDb, createTestUser } from "./helpers/db";
import type { LedgerState, PeriodKey } from "@/domain/types";

const A = "user-bg063";
const AGO: PeriodKey = "2026-08";
const SEP: PeriodKey = "2026-09";
const APERTURA = 1_000;

function bolsillo(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "transfer" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene ningún bolsillo");
  return h.id;
}

/** Ledger vacío de montos; con `inicio`, declara ese mes con APERTURA y ningún ingreso. */
async function sembrar(inicio: PeriodKey | null): Promise<void> {
  const seed = buildSeed(A, SEP);
  const res = await saveLedger(A, { ...seed, budgets: {}, actuals: {}, movements: [] }, 0);
  if (!res.ok) throw new Error("no se pudo sembrar");
  if (inicio) {
    const d = await saveStartFor(A, (await loadLedger(A))!.revision, inicio, APERTURA);
    expect(d.ok).toBe(true);
  }
}

/** Guarda por PUT el ledger vigente con el aporte de septiembre del bolsillo en `monto`. */
async function aportarPorPut(monto: number, sobre: Partial<LedgerState> = {}) {
  const { state, revision } = (await loadLedger(A))!;
  const b = bolsillo(state);
  const next: LedgerState = { ...state, ...sobre, actuals: { ...state.actuals, [b]: { ...(state.actuals[b] ?? {}), [SEP]: monto } } };
  return saveLedger(A, next, revision);
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "bg063@test.local");
});
afterAll(async () => { await closeTestDb(); });

describe("BG-063 — POST /movements cuenta el saldo inicial", () => {
  it("un aporte pagado con el saldo inicial (sin ingresos) se acepta", async () => {
    await sembrar(SEP);
    const b = bolsillo((await loadLedger(A))!.state);
    const r = await insertMovement(A, { type: "transfer", catId: b, from: AVAILABLE_ID, to: b, period: SEP, amount: "500" } as never);
    expect(r, JSON.stringify(r)).not.toBeNull();
    expect(r && "movement" in r).toBe(true);
  });

  it("control: sin saldo inicial, el mismo aporte se rechaza", async () => {
    await sembrar(null);
    const b = bolsillo((await loadLedger(A))!.state);
    const r = await insertMovement(A, { type: "transfer", catId: b, from: AVAILABLE_ID, to: b, period: SEP, amount: "500" } as never);
    expect(r === null || (r !== null && "domainViolation" in r)).toBe(true);
  });

  it("con el inicio ANTES del primer dato, la apertura también cuenta", async () => {
    // Inicio en agosto, el aporte en septiembre: el rango juzgado tiene que arrancar en agosto.
    await sembrar(AGO);
    const b = bolsillo((await loadLedger(A))!.state);
    const r = await insertMovement(A, { type: "transfer", catId: b, from: AVAILABLE_ID, to: b, period: SEP, amount: "500" } as never);
    expect(r && "movement" in r, JSON.stringify(r)).toBe(true);
  });
});

describe("BG-063 — PUT /ledger juzga con la apertura guardada, no con la del cuerpo", () => {
  it("pasar el techo de la apertura se rechaza; quedarse justo en él se acepta", async () => {
    await sembrar(SEP);
    expect((await aportarPorPut(800)).ok).toBe(true);

    const excede = await aportarPorPut(1_500);
    expect(excede, JSON.stringify(excede)).toMatchObject({ ok: false, domainViolation: true });

    const justo = await aportarPorPut(APERTURA);
    expect(justo, JSON.stringify(justo)).toMatchObject({ ok: true });
  });

  it("una apertura inventada en el cuerpo no da cupo", async () => {
    await sembrar(null);
    const inventada = await aportarPorPut(900_000, { startMonth: SEP, openingBalance: 900_000 });
    expect(inventada, JSON.stringify(inventada)).toMatchObject({ ok: false, domainViolation: true });
    // Y la apertura del cuerpo no se guardó.
    expect((await loadLedger(A))!.state.openingBalance ?? null).toBeNull();
  });
});
