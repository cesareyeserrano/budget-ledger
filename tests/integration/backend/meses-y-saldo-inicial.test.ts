/**
 * Feature meses-y-saldo-inicial — EP-02: la persistencia y LAS DOS REGLAS DE SERVIDOR.
 * TCs: FR-2205 (041f,043h) · FR-2206 (051f,052e) · FR-2207 (060h,061f,062e,064e) ·
 *      NFR-2205 (090f,091f,092h,093e)
 *
 * Es la capa donde la apertura es AUTORIDAD. Lo que el navegador impide es ergonomía; lo que se
 * prueba aquí es el contrato — la lección de BG-002, donde la regla de dominio vivía solo en el
 * cliente y el servidor aceptaba cualquier cosa.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildSeed } from "@/domain";
import { isLeaf } from "@/domain/tree";
import { loadLedger, saveLedger, saveStartFor, closeMonthFor } from "@/server/data/ledgerRepo";
import { setLeafAmount } from "@/domain";
import { activeRange } from "@/domain/range";
import { startPutSchema } from "@/server/schemas";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";
import type { LedgerState, PeriodKey } from "@/domain/types";

const A = "user-msi";
const B = "user-msi-b";
const INICIO: PeriodKey = "2026-06";
const AHORA: PeriodKey = "2026-09";

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene ninguna hoja de gasto");
  return h.id;
}

/** Siembra un ledger VACÍO de montos: cada prueba pone los datos de su escenario. */
async function sembrar(owner = A): Promise<{ state: LedgerState; revision: number }> {
  const seed = buildSeed(owner, INICIO);
  const limpio: LedgerState = { ...seed, budgets: {}, actuals: {}, movements: [] };
  const res = await saveLedger(owner, limpio, 0);
  if (!res.ok) throw new Error("no se pudo sembrar");
  const loaded = await loadLedger(owner);
  if (!loaded) throw new Error("no se pudo cargar");
  return { state: loaded.state, revision: loaded.revision };
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "msi-a@test.local");
  await createTestUser(B, "msi-b@test.local");
});
afterAll(async () => { await closeTestDb(); });

describe("FR-2207 — la apertura persiste como parte del ledger", () => {
  it("TC-MSI-060h: Los dos valores vuelven idénticos desde una conexión nueva", async () => {
    // @aitri-tc TC-MSI-060h
    const { revision } = await sembrar();
    const res = await saveStartFor(A, revision, INICIO, 3_000_000);
    expect(res.ok).toBe(true);

    // Una lectura NUEVA, no la que ya teníamos en memoria.
    const releido = await loadLedger(A);
    expect(releido?.state.startMonth).toBe("2026-06");
    expect(releido?.state.openingBalance).toBe(3_000_000);
  });

  it("TC-MSI-061f: Una revisión obsoleta se rechaza sin pisar los valores", async () => {
    // @aitri-tc TC-MSI-061f
    const { revision } = await sembrar();
    const ok = await saveStartFor(A, revision, INICIO, 3_000_000);
    expect(ok.ok).toBe(true);
    const vigente = (await loadLedger(A))!.revision;

    // Segunda pestaña con la revisión ANTERIOR.
    const stale = await saveStartFor(A, revision, INICIO, 9_999_999);
    expect(stale.ok).toBe(false);
    expect(stale).toMatchObject({ conflict: true, revision: vigente });

    const releido = await loadLedger(A);
    expect(releido?.state.openingBalance).toBe(3_000_000);
    expect(releido?.revision).toBe(vigente);
  });

  it("TC-MSI-062e: Un ledger existente sin las columnas carga sin error", async () => {
    // @aitri-tc TC-MSI-062e
    await sembrar();
    // Una fila anterior a la migración 0006: ambas columnas NULL.
    await testDb().execute(
      sql`UPDATE "ledger" SET "start_month" = NULL, "opening_balance" = NULL WHERE "owner_id" = ${A}`
    );
    const cargado = await loadLedger(A);
    expect(cargado).not.toBeNull();
    expect(cargado!.state.startMonth).toBeNull();
    expect(cargado!.state.openingBalance).toBeNull();
    expect(cargado!.state.nodes.length).toBeGreaterThan(0);
  });

  it("TC-MSI-064e: Borrar el ledger se lleva la declaración", async () => {
    // @aitri-tc TC-MSI-064e
    const { revision } = await sembrar();
    await saveStartFor(A, revision, INICIO, 3_000_000);
    expect((await loadLedger(A))?.state.openingBalance).toBe(3_000_000);

    await testDb().execute(sql`DELETE FROM "ledger" WHERE "owner_id" = ${A}`);

    // Sin fila no hay declaración: es el estado del primer día, y la tarjeta vuelve a preguntar.
    const cargado = await loadLedger(A);
    expect(cargado).toBeNull();
  });
});

describe("FR-2205 — el saldo inicial solo se edita con su mes abierto", () => {
  it("TC-MSI-041f: Con el mes de inicio cerrado, el servidor rechaza la edición", async () => {
    // @aitri-tc TC-MSI-041f
    // El escenario REAL de FR-2205: el usuario declaró junio, transcribió junio, y luego lo cerró.
    // Con datos en junio, `serverScope` lo incluye y `closeMonthFor` avanza la frontera hasta ahí.
    // (Sin datos, `serverScope` arranca en el mes en curso: no conoce el mes declarado, porque se
    // deriva de `oldestPeriodWithData`, no de `activeRange`. Se documenta como interacción conocida.)
    const { state, revision } = await sembrar();
    const rango = activeRange(state, AHORA, 2);
    const conDatos = setLeafAmount(state, hojaDeGasto(state), INICIO, "actual", 40_000, rango);
    const guardado = await saveLedger(A, conDatos, revision);
    expect(guardado.ok).toBe(true);

    const declarado = await saveStartFor(A, (await loadLedger(A))!.revision, INICIO, 3_000_000);
    expect(declarado.ok).toBe(true);

    const cerrado = await closeMonthFor(A, (await loadLedger(A))!.revision, AHORA);
    expect(cerrado.ok).toBe(true);
    const trasCierre = (await loadLedger(A))!;
    expect(trasCierre.state.closure?.closedThrough).toBe(INICIO);

    const res = await saveStartFor(A, trasCierre.revision, INICIO, 9_000_000);
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ rejected: "month_closed" });

    // Ni el valor ni la revisión se movieron.
    const releido = (await loadLedger(A))!;
    expect(releido.state.openingBalance).toBe(3_000_000);
    expect(releido.revision).toBe(trasCierre.revision);
  });

  it("TC-MSI-043h: Con el mes de inicio abierto, la edición se acepta y sube revision en 1", async () => {
    // @aitri-tc TC-MSI-043h
    const { revision } = await sembrar();
    await saveStartFor(A, revision, INICIO, 3_000_000);
    const antes = (await loadLedger(A))!;

    const res = await saveStartFor(A, antes.revision, INICIO, 4_000_000);
    expect(res.ok).toBe(true);

    const despues = (await loadLedger(A))!;
    expect(despues.state.openingBalance).toBe(4_000_000);
    expect(despues.revision).toBe(antes.revision + 1);
  });
});

describe("FR-2206 — mover el inicio adelante no puede dejar datos huérfanos", () => {
  /** Pone un ejecutado concreto en septiembre y en octubre. */
  async function conDatosSepOct(): Promise<number> {
    const { state, revision } = await sembrar();
    const hoja = hojaDeGasto(state);
    const rango = activeRange(state, AHORA, 2);
    let s = setLeafAmount(state, hoja, "2026-09", "actual", 80_000, rango);
    s = setLeafAmount(s, hoja, "2026-10", "actual", 12_000, rango);
    const res = await saveLedger(A, s, revision);
    if (!res.ok) throw new Error("no se pudo guardar el escenario");
    return (await loadLedger(A))!.revision;
  }

  it("TC-MSI-051f: El servidor rechaza el movimiento y nombra los meses", async () => {
    // @aitri-tc TC-MSI-051f
    const rev = await conDatosSepOct();
    const declarado = await saveStartFor(A, rev, "2026-09", 500_000);
    expect(declarado.ok).toBe(true);

    const res = await saveStartFor(A, (await loadLedger(A))!.revision, "2026-11", 500_000);
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ rejected: "would_orphan" });
    expect("periods" in res ? res.periods : []).toEqual(["2026-09", "2026-10"]);
  });

  it("TC-MSI-052e: El rechazo deja el estado exactamente igual", async () => {
    // @aitri-tc TC-MSI-052e
    const rev = await conDatosSepOct();
    await saveStartFor(A, rev, "2026-09", 500_000);
    const antes = (await loadLedger(A))!;

    const res = await saveStartFor(A, antes.revision, "2026-11", 500_000);
    expect(res.ok).toBe(false);

    const despues = (await loadLedger(A))!;
    expect(despues.state.startMonth).toBe("2026-09");
    expect(despues.state.openingBalance).toBe(500_000);
    expect(despues.revision).toBe(antes.revision);
    // Y las celdas que el movimiento habría huerfanado siguen ahí, con su monto.
    expect(JSON.stringify(despues.state.actuals)).toBe(JSON.stringify(antes.state.actuals));
  });
});

describe("NFR-2205 — la apertura es dato del usuario y se valida en el servidor", () => {
  it("TC-MSI-090f: El esquema del endpoint rechaza un cuerpo sin los campos obligatorios", () => {
    // @aitri-tc TC-MSI-090f
    // La ruta declara `auth: "required"`, así que sin sesión `withApi` responde 401 antes de llegar
    // aquí. Lo que se afirma en esta capa es que el CONTRATO no admite un cuerpo incompleto: nada
    // llega al dominio sin baseRevision ni startMonth.
    expect(startPutSchema.safeParse({}).success).toBe(false);
    expect(startPutSchema.safeParse({ baseRevision: 0 }).success).toBe(false);
    expect(startPutSchema.safeParse({ baseRevision: 0, startMonth: "2026-06" }).success).toBe(false);
    expect(
      startPutSchema.safeParse({ baseRevision: 0, startMonth: "2026-06", openingBalance: null }).success
    ).toBe(true);
  });

  it("TC-MSI-091f: Un usuario no puede escribir la apertura de otro", async () => {
    // @aitri-tc TC-MSI-091f
    const a = await sembrar(A);
    const b = await sembrar(B);
    await saveStartFor(B, b.revision, INICIO, 7_000_000);
    const antesB = (await loadLedger(B))!;

    // A escribe la suya. El ownerId sale de la sesión, así que A NO puede alcanzar la fila de B.
    const res = await saveStartFor(A, a.revision, INICIO, 1_000_000);
    expect(res.ok).toBe(true);

    expect((await loadLedger(A))!.state.openingBalance).toBe(1_000_000);
    const despuesB = (await loadLedger(B))!;
    expect(despuesB.state.openingBalance).toBe(7_000_000);
    expect(despuesB.revision).toBe(antesB.revision);
  });

  it("TC-MSI-092h: El monto se valida en el borde antes de tocar el dominio", () => {
    // @aitri-tc TC-MSI-092h
    const negativo = startPutSchema.safeParse({ baseRevision: 3, startMonth: "2026-06", openingBalance: -1 });
    expect(negativo.success).toBe(false);
    const decimal = startPutSchema.safeParse({ baseRevision: 3, startMonth: "2026-06", openingBalance: 1.5 });
    expect(decimal.success).toBe(false);
    const mesMalo = startPutSchema.safeParse({ baseRevision: 3, startMonth: "2026-13", openingBalance: 0 });
    expect(mesMalo.success).toBe(false);
    const bueno = startPutSchema.safeParse({ baseRevision: 3, startMonth: "2026-06", openingBalance: 0 });
    expect(bueno.success).toBe(true);
  });

  it("TC-MSI-093e: El CHECK de la base es la última defensa del monto", async () => {
    // @aitri-tc TC-MSI-093e
    const { revision } = await sembrar();
    await saveStartFor(A, revision, INICIO, 3_000_000);

    // Saltándose la aplicación por completo: SQL directo contra la fila.
    await expect(
      testDb().execute(sql`UPDATE "ledger" SET "opening_balance" = -5 WHERE "owner_id" = ${A}`)
    ).rejects.toThrow();
    expect((await loadLedger(A))!.state.openingBalance).toBe(3_000_000);

    // Y un saldo sin mes al que aplicarse tampoco es un estado posible.
    await expect(
      testDb().execute(
        sql`UPDATE "ledger" SET "start_month" = NULL, "opening_balance" = 100 WHERE "owner_id" = ${A}`
      )
    ).rejects.toThrow();
  });
});
