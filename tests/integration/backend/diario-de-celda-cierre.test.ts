/**
 * Feature diario-de-celda — EP-04: el CIERRE bloqueado por descuadres, contra Postgres real.
 * TCs: FR-2512 (214e, 215f, 216f).
 *
 * Es la capa donde la regla es AUTORIDAD. Lo que el botón impide es ergonomía; lo que se prueba aquí
 * es que una petición directa —otra pestaña, un script, un cliente viejo— tampoco cierra un mes con
 * celdas sin cuadrar, y que la reapertura sigue libre.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildSeed } from "@/domain";
import { isLeaf } from "@/domain/tree";
import { closeMonthFor, loadLedger, reopenMonthFor, saveLedger } from "@/server/data/ledgerRepo";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";
import type { LedgerState, Movement, PeriodKey } from "@/domain/types";

const A = "user-ddc-cierre";
/** El ledger arranca en agosto; septiembre es el mes en curso, así que agosto es lo cerrable. */
const AGO: PeriodKey = "2026-08";
const SEP: PeriodKey = "2026-09";

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene hoja de gasto");
  return h.id;
}
function otraHoja(s: LedgerState, distintaDe: string): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes) && n.id !== distintaDe);
  if (!h) throw new Error("la semilla no tiene una segunda hoja de gasto");
  return h.id;
}

function gasto(id: string, target: string, amount: number, period: PeriodKey, createdAt: number): Movement {
  return {
    id, ownerId: A, type: "expense", catId: target, subId: null, target, amount, period,
    createdAt, date: `${period}-05T12:00`,
  };
}

/** Siembra CUADRADA: el servidor no admite crear un descuadre, así que la base siempre nace sana. */
async function sembrar(
  movimientos: (hoja: string) => Movement[], celdas: (hoja: string) => LedgerState["actuals"]
): Promise<{ state: LedgerState; revision: number; hoja: string }> {
  const seed = buildSeed(A, AGO);
  const hoja = hojaDeGasto(seed);
  const r = await saveLedger(A, { ...seed, actuals: celdas(hoja), movements: movimientos(hoja) }, 0);
  if (!r.ok) throw new Error(`no se pudo sembrar: ${JSON.stringify(r)}`);
  const l = (await loadLedger(A))!;
  return { state: l.state, revision: l.revision, hoja };
}

/**
 * Descuadra una celda POR SQL DIRECTO.
 *
 * Tiene que ser por debajo: el propio servidor rechaza una escritura que descuadre (NFR-2502), que
 * es justo la regla hermana. Para probar que el CIERRE detecta un descuadre preexistente hay que
 * poder sembrarlo, y esta es la única vía. Mismo precedente que `tests/e2e/helpers/descuadre.ts`.
 */
async function descuadrar(nodeId: string, period: PeriodKey, amount: number): Promise<void> {
  await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                             VALUES (${A}, ${nodeId}, ${period}, 'actual', ${amount})
                             ON CONFLICT (owner_id, node_id, period, kind) DO UPDATE SET amount = ${amount}`);
}

const cerrado = async (): Promise<string | null> => {
  const r = await testDb().execute(sql`SELECT closed_through FROM ledger WHERE owner_id = ${A}`);
  return ([...r][0] as { closed_through: string | null }).closed_through;
};

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "ddc-cierre@example.com");
});
afterAll(async () => { await closeTestDb(); });

describe("FR-2512 — un mes con celdas descuadradas no se cierra", () => {
  it("TC-DDC-215f: el cierre responde unbalanced_cells con las celdas nombradas y no cierra nada", async () => {
    // @aitri-tc TC-DDC-215f
    const { state, revision, hoja } = await sembrar(
      (h) => [gasto("m-ago", h, 80_000, AGO, 1)],
      (h) => ({ [h]: { [AGO]: 80_000 } })
    );
    const taxi = otraHoja(state, hoja);
    await descuadrar(taxi, AGO, 45_000); // 45.000 sin un solo movimiento detrás

    const res = await closeMonthFor(A, revision, SEP);
    expect(res).toMatchObject({ ok: false, rejected: "unbalanced_cells", period: AGO });
    // El estrechamiento se hace por PRESENCIA de la propiedad, no por su valor: la rama de conflicto
    // de revisión no tiene `rejected` en absoluto, así que leerla sobre la unión no compila.
    if (res.ok || !("rejected" in res) || res.rejected !== "unbalanced_cells") return;
    // NOMBRADA: el usuario tiene que saber a cuál ir, no solo que algo falla.
    expect(res.cells.map((c) => c.nodeId)).toEqual([taxi]);
    expect(res.cells[0].name).toBeTruthy();

    // Y no dejó rastro: ni frontera, ni revisión, ni evento de cierre.
    expect(await cerrado()).toBeNull();
    expect((await loadLedger(A))!.revision).toBe(revision);
    const eventos = await testDb().execute(sql`SELECT count(*)::int AS n FROM closure_event WHERE owner_id = ${A}`);
    expect(([...eventos][0] as { n: number }).n).toBe(0);
  });

  it("TC-DDC-214e: un descuadre en un mes POSTERIOR no impide cerrar el que toca", async () => {
    // @aitri-tc TC-DDC-214e
    // La regla es sobre el mes que se cierra. Uno posterior sigue abierto y editable: bloquear por
    // él sería castigar al usuario por algo que todavía puede arreglar.
    const { state, revision, hoja } = await sembrar(
      (h) => [gasto("m-ago", h, 80_000, AGO, 1)],
      (h) => ({ [h]: { [AGO]: 80_000 } })
    );
    const taxi = otraHoja(state, hoja);
    await descuadrar(taxi, SEP, 30_000); // el descuadre vive en SEPTIEMBRE, no en agosto

    const res = await closeMonthFor(A, revision, SEP);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await cerrado()).toBe(AGO);
  });

  it("TC-DDC-216f: reabrir NO se bloquea por descuadres", async () => {
    // @aitri-tc TC-DDC-216f
    // La reapertura es la única vía que le queda al usuario para arreglar un descuadre de un mes ya
    // cerrado. Bloquearla por el propio descuadre lo dejaría encerrado sin salida.
    const { state, revision, hoja } = await sembrar(
      (h) => [gasto("m-ago", h, 80_000, AGO, 1)],
      (h) => ({ [h]: { [AGO]: 80_000 } })
    );
    const cierre = await closeMonthFor(A, revision, SEP);
    expect(cierre.ok, JSON.stringify(cierre)).toBe(true);
    if (!cierre.ok) return;

    // Ahora se descuadra una celda DENTRO del mes ya cerrado.
    const taxi = otraHoja(state, hoja);
    await descuadrar(taxi, AGO, 45_000);

    const r = await reopenMonthFor(A, cierre.revision);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.closure.reopened).toBe(AGO);
    // Y queda su rastro, como cualquier reapertura (FR-2011).
    const eventos = await testDb().execute(
      sql`SELECT count(*)::int AS n FROM closure_event WHERE owner_id = ${A} AND action = 'reopen'`
    );
    expect(([...eventos][0] as { n: number }).n).toBe(1);
  });

  it("cuadrar la celda desbloquea el cierre", async () => {
    // La otra mitad de TC-DDC-215f: la regla no es una pared, es una condición que el usuario puede
    // cumplir. Si cuadrar no desbloqueara, el mes quedaría inservible para siempre.
    const { state, revision, hoja } = await sembrar(
      (h) => [gasto("m-ago", h, 80_000, AGO, 1)],
      (h) => ({ [h]: { [AGO]: 80_000 } })
    );
    const taxi = otraHoja(state, hoja);
    await descuadrar(taxi, AGO, 45_000);
    expect(await closeMonthFor(A, revision, SEP)).toMatchObject({ rejected: "unbalanced_cells" });

    // Se cuadra poniendo la celda en 0 (sus movimientos suman 0): la vía del producto es teclear su
    // valor, y aquí basta con dejarla como sus movimientos dicen.
    await descuadrar(taxi, AGO, 0);
    const res = await closeMonthFor(A, (await loadLedger(A))!.revision, SEP);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await cerrado()).toBe(AGO);
  });
});
