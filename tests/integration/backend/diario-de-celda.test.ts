/**
 * Feature diario-de-celda — EP-02: el ajuste contra un Postgres real (testcontainers).
 * TCs: FR-2502 (024e) · FR-2503 (049f) · FR-2504 (071e, 072f, 073f)
 *
 * Es la capa donde el `kind` y su signo son AUTORIDAD. Lo que el navegador impide es ergonomía; lo
 * que se prueba aquí es el contrato: que un ajuste negativo se guarda, sobrevive a la ida y vuelta
 * del snapshot y a la reubicación de ciclos, y que ni el CHECK de la migración ni el esquema del PUT
 * dejan entrar lo que no debe.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildSeed } from "@/domain";
import { isLeaf } from "@/domain/tree";
import { loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { applyCyclesFor } from "@/server/data/cyclesRepo";
import { ledgerPutSchema } from "@/server/schemas";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";
import type { LedgerState, Movement, PeriodKey } from "@/domain/types";

const A = "user-ddc";
const SEP: PeriodKey = "2026-09";
const HOY = "2026-09-14";

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene hoja de gasto");
  return h.id;
}

/** Un movimiento manual de gasto contra esa hoja. */
function gasto(id: string, target: string, amount: number, createdAt: number, note?: string): Movement {
  return {
    id, ownerId: A, type: "expense", catId: target, subId: null, target, amount,
    period: SEP, createdAt, date: "2026-09-05T12:00", ...(note ? { note } : {}),
  };
}

/** Siembra: la hoja de gasto con 100.000 respaldados por un movimiento. Devuelve estado y revisión. */
async function sembrar(): Promise<{ state: LedgerState; revision: number; hoja: string }> {
  const seed = buildSeed(A, SEP);
  const hoja = hojaDeGasto(seed);
  const inicial: LedgerState = {
    ...seed,
    actuals: { [hoja]: { [SEP]: 100_000 } },
    movements: [gasto("m-base", hoja, 100_000, 1)],
  };
  const r = await saveLedger(A, inicial, 0);
  if (!r.ok) throw new Error(`no se pudo sembrar: ${JSON.stringify(r)}`);
  const l = (await loadLedger(A))!;
  return { state: l.state, revision: l.revision, hoja };
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "ddc@example.com");
});
afterAll(async () => { await closeTestDb(); });

describe("FR-2502 — el movimiento añadido llega a Postgres", () => {
  it("TC-DDC-024e: el PUT lo guarda con kind 'manual' y el GET lo devuelve", async () => {
    // @aitri-tc TC-DDC-024e
    const { state, revision, hoja } = await sembrar();

    const conNuevo: LedgerState = {
      ...state,
      actuals: { ...state.actuals, [hoja]: { [SEP]: 130_000 } },
      movements: [...state.movements, gasto("m-almuerzo", hoja, 30_000, 2, "Almuerzo")],
    };
    const r = await saveLedger(A, conNuevo, revision);

    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.revision).toBe(revision + 1);

    const filas = [...(await testDb().execute(
      sql`SELECT kind, amount FROM movement WHERE owner_id = ${A} AND note = 'Almuerzo'`))] as { kind: string; amount: number }[];
    expect(filas).toHaveLength(1);
    expect(filas[0]!.kind).toBe("manual"); // un movimiento del usuario NO es un ajuste
    expect(Number(filas[0]!.amount)).toBe(30_000);

    const celda = [...(await testDb().execute(
      sql`SELECT amount FROM amount_cell WHERE owner_id = ${A} AND node_id = ${hoja} AND period = ${SEP} AND kind = 'actual'`))][0] as { amount: number };
    expect(Number(celda.amount)).toBe(130_000);

    // Y un repositorio nuevo lo lee: el dato está en la base, no en memoria.
    const leido = (await loadLedger(A))!;
    expect(leido.state.movements.some((m) => m.note === "Almuerzo" && m.amount === 30_000)).toBe(true);
  });
});

describe("FR-2503 — la fecha tiene que caer en el periodo de la celda", () => {
  it("TC-DDC-049f: el servidor rechaza un movimiento fechado fuera de su periodo", async () => {
    // @aitri-tc TC-DDC-049f
    const { state, revision, hoja } = await sembrar();
    // Modo mes a mes: el 1 de octubre no pertenece a «Septiembre».
    const fuera: Movement = { ...gasto("m-fuera", hoja, 5_000, 3), date: "2026-10-01T12:00" };
    const conFuera: LedgerState = {
      ...state,
      actuals: { ...state.actuals, [hoja]: { [SEP]: 105_000 } },
      movements: [...state.movements, fuera],
    };

    const r = await saveLedger(A, conFuera, revision);

    expect(r.ok).toBe(false);
    if (r.ok || !("periodMismatch" in r)) throw new Error(`se esperaba period_mismatch: ${JSON.stringify(r)}`);
    expect(r.ids).toContain("m-fuera");

    // Ni la revisión ni la base se movieron.
    const l = (await loadLedger(A))!;
    expect(l.revision).toBe(revision);
    expect(l.state.movements.some((m) => m.id === "m-fuera")).toBe(false);
  });
});

describe("FR-2504 — el ajuste negativo sobrevive a la base", () => {
  it("TC-DDC-071e: kind y signo aguantan guardar → leer → guardar y el paso a ciclos", async () => {
    // @aitri-tc TC-DDC-071e
    const { state, revision, hoja } = await sembrar();
    const ajuste: Movement = { ...gasto("m-ajuste", hoja, -10_000, 2, "Ajuste manual"), kind: "adjustment" };
    const conAjuste: LedgerState = {
      ...state,
      actuals: { ...state.actuals, [hoja]: { [SEP]: 90_000 } },
      movements: [...state.movements, ajuste],
    };

    const r1 = await saveLedger(A, conAjuste, revision);
    expect(r1.ok, JSON.stringify(r1)).toBe(true);

    // (1) Tras el primer GET.
    const l1 = (await loadLedger(A))!;
    const a1 = l1.state.movements.find((m) => m.id === "m-ajuste")!;
    expect(a1.kind).toBe("adjustment");
    expect(a1.amount).toBe(-10_000);

    // (2) Volver a guardar lo leído SIN cambios no debe perder el kind — el snapshot se borra y se
    // reinserta entero en cada PUT, que es justo donde se perdía.
    const r2 = await saveLedger(A, l1.state, l1.revision);
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
    const l2 = (await loadLedger(A))!;
    const a2 = l2.state.movements.find((m) => m.id === "m-ajuste")!;
    expect(a2.kind).toBe("adjustment");
    expect(a2.amount).toBe(-10_000);

    // (3) Y la reubicación de ciclos tampoco: reescribe el snapshot por su cuenta.
    const c = await applyCyclesFor(A, l2.revision, { mode: "cycle", anchorDay: 21, eomPolicy: "last_day" }, HOY);
    expect(c.ok, JSON.stringify(c)).toBe(true);

    const fila = [...(await testDb().execute(
      sql`SELECT kind, amount FROM movement WHERE owner_id = ${A} AND id = 'm-ajuste'`))][0] as { kind: string; amount: number };
    expect(fila.kind).toBe("adjustment");
    expect(Number(fila.amount)).toBe(-10_000);
  });

  it("TC-DDC-072f: el CHECK de la migración 0009 rechaza los montos inválidos", async () => {
    // @aitri-tc TC-DDC-072f
    const { hoja } = await sembrar();
    const db = testDb();
    const insertar = (id: string, kind: string, amount: number, type = "expense") =>
      db.execute(sql`INSERT INTO movement (owner_id, id, type, cat_id, sub_id, target, amount, period, created_at, kind)
                     VALUES (${A}, ${id}, ${type}, ${hoja}, NULL, ${hoja}, ${amount}, ${SEP}, 99, ${kind})`);

    // Los cuatro que la base NO debe aceptar.
    await expect(insertar("x1", "manual", -1)).rejects.toThrow();            // manual negativo
    await expect(insertar("x2", "adjustment", 0)).rejects.toThrow();          // ajuste de cero
    await expect(insertar("x3", "adjustment", -5, "transfer")).rejects.toThrow(); // ajuste de bolsillo
    await expect(insertar("x4", "otro", 5)).rejects.toThrow();                // kind inventado

    // Y el que sí: un ajuste negativo de gasto.
    await expect(insertar("x5", "adjustment", -5)).resolves.toBeDefined();
    const fila = [...(await db.execute(
      sql`SELECT kind, amount FROM movement WHERE owner_id = ${A} AND id = 'x5'`))][0] as { kind: string; amount: number };
    expect(fila.kind).toBe("adjustment");
    expect(Number(fila.amount)).toBe(-5);
  });

  it("TC-DDC-073f: el PUT rechaza un negativo sin kind y un ajuste de bolsillo", async () => {
    // @aitri-tc TC-DDC-073f
    //
    // Se ejerce el ESQUEMA DEL BORDE, que es donde vive el `422 invalid_payload` que pide el TC:
    // `withApi({ schema: ledgerPutSchema })` valida ANTES de abrir transacción, y el repositorio
    // confía en que eso ya pasó (ADR-04). Llamar aquí a `saveLedger` con un payload inválido probaba
    // otra cosa —que la base lo frena por el CHECK— y dejaba sin cubrir la puerta que el TC nombra.
    const { state, revision, hoja } = await sembrar();
    const antes = [...(await testDb().execute(
      sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${A}`))][0] as { n: number };

    // (a) Un gasto de −5 SIN kind: sin `kind` la regla es la de siempre, monto >= 1.
    const sinKind: LedgerState = { ...state, movements: [...state.movements, gasto("m-neg", hoja, -5, 3)] };
    const r1 = ledgerPutSchema.safeParse({ baseRevision: revision, state: sinKind });
    expect(r1.success, "un negativo sin kind no puede entrar").toBe(false);

    // (b) Un bolsillo con kind 'adjustment': las reservas tienen su propia regla (NFR-2503).
    const bolsillo = state.nodes.find((n) => n.type === "transfer" && isLeaf(n, state.nodes))!;
    const ajusteBolsillo: Movement = {
      id: "m-res", ownerId: A, type: "transfer", catId: bolsillo.id, subId: null, target: bolsillo.id,
      amount: 5_000, period: SEP, createdAt: 4, kind: "adjustment",
    };
    const r2 = ledgerPutSchema.safeParse({
      baseRevision: revision, state: { ...state, movements: [...state.movements, ajusteBolsillo] },
    });
    expect(r2.success, "un bolsillo no admite ajustes").toBe(false);

    // Y el ajuste legítimo de un gasto SÍ entra: sin esto, lo anterior pasaría con un esquema que
    // rechazara todo.
    const ajusteValido: Movement = { ...gasto("m-aj", hoja, -10_000, 5, "Ajuste manual"), kind: "adjustment" };
    const ok = ledgerPutSchema.safeParse({
      baseRevision: revision,
      state: { ...state, actuals: { ...state.actuals, [hoja]: { [SEP]: 90_000 } }, movements: [...state.movements, ajusteValido] },
    });
    expect(ok.success, "un ajuste negativo de gasto es válido").toBe(true);

    // Ni la revisión ni el número de filas se movieron: nada de esto llegó a la base.
    const l = (await loadLedger(A))!;
    expect(l.revision).toBe(revision);
    const despues = [...(await testDb().execute(
      sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${A}`))][0] as { n: number };
    expect(despues.n).toBe(antes.n);
  });
});
