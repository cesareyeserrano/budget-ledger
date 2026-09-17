/**
 * Feature diario-de-celda — EP-03: editar y borrar contra un Postgres real (testcontainers).
 * TCs: FR-2505 (091f, 095h) · FR-2506 (114e, 117f, 122f, 123f) · NFR-2501 (301h, 302f, 303f, 312f) ·
 *      FR-2504 (077e)
 *
 * Es la capa donde las dos vías nuevas son AUTORIDAD. Lo que el navegador impide es ergonomía; lo
 * que se prueba aquí es el contrato: que el servidor recalcula la celda ÉL MISMO (el cliente nunca
 * manda cifras de celda), que un movimiento ajeno es indistinguible de uno inexistente, y que el
 * cierre gana a cualquier consecuencia del cambio.
 *
 * PENDIENTES DECLARADOS, no olvidados: TC-DDC-308f (bolsillos) y TC-DDC-328e (el orden completo
 * dueño → tipo → cierre) necesitan sembrar una operación De→A que respete techo y piso; se añaden
 * cuando esa siembra esté resuelta, no con un atajo que pase por casualidad.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildSeed } from "@/domain";
import { isLeaf } from "@/domain/tree";

import {
  closeMonthFor, loadLedger, removeMovement, saveLedger, updateMovement,
} from "@/server/data/ledgerRepo";
import { ledgerPutSchema } from "@/server/schemas";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";
import type { LedgerState, Movement, PeriodKey } from "@/domain/types";

const A = "user-ddc-ed";
const B = "user-ddc-ed-b";
/** El ledger arranca en agosto; septiembre es el mes en curso, así que agosto es lo cerrable. */
const AGO: PeriodKey = "2026-08";
const SEP: PeriodKey = "2026-09";

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene hoja de gasto");
  return h.id;
}

/** Segunda hoja de gasto, para las pruebas que mueven un movimiento de una celda a otra. */
function otraHojaDeGasto(s: LedgerState, distintaDe: string): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes) && n.id !== distintaDe);
  if (!h) throw new Error("la semilla no tiene una segunda hoja de gasto");
  return h.id;
}

function gasto(
  owner: string, id: string, target: string, amount: number, period: PeriodKey, createdAt: number,
  extra: Partial<Movement> = {}
): Movement {
  return {
    id, ownerId: owner, type: "expense", catId: target, subId: null, target, amount, period,
    createdAt, date: `${period}-05T12:00`, ...extra,
  };
}

/**
 * Siembra el ledger de `owner` con una celda CUADRADA en `period`.
 *
 * Cuadrada a propósito: desde NFR-2502 el servidor rechaza una escritura que descuadre una celda, y
 * una siembra con Ejecutado sin movimientos ni siquiera entraría.
 */
async function sembrar(
  owner: string, movimientos: (hoja: string) => Movement[], celdas: (hoja: string) => LedgerState["actuals"]
): Promise<{ state: LedgerState; revision: number; hoja: string }> {
  const seed = buildSeed(owner, AGO);
  const hoja = hojaDeGasto(seed);
  const inicial: LedgerState = { ...seed, actuals: celdas(hoja), movements: movimientos(hoja) };
  const r = await saveLedger(owner, inicial, 0);
  if (!r.ok) throw new Error(`no se pudo sembrar ${owner}: ${JSON.stringify(r)}`);
  const l = (await loadLedger(owner))!;
  return { state: l.state, revision: l.revision, hoja };
}

/** Lo simple: una hoja con 100.000 en SEPTIEMBRE respaldados por un movimiento. */
async function sembrarSimple(owner = A) {
  return sembrar(
    owner,
    (hoja) => [gasto(owner, `m-base-${owner}`, hoja, 100_000, SEP, 1, { note: "Base" })],
    (hoja) => ({ [hoja]: { [SEP]: 100_000 } })
  );
}

/** Cuántas filas de movimiento tiene ese owner. */
async function filasDe(owner: string): Promise<number> {
  const r = await testDb().execute(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${owner}`);
  return ([...r][0] as { n: number }).n;
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "ddc-ed@example.com");
  await createTestUser(B, "ddc-ed-b@example.com");
});
afterAll(async () => { await closeTestDb(); });

// ── FR-2505 · editar ─────────────────────────────────────────────────────────────────────────────

describe("FR-2505 — el PATCH contra Postgres", () => {
  it("TC-DDC-095h: un PATCH válido devuelve el movimiento y recalcula la celda EN EL SERVIDOR", async () => {
    // @aitri-tc TC-DDC-095h
    const { hoja, revision } = await sembrarSimple();

    const res = await updateMovement(A, `m-base-${A}`, { amount: 30_000, note: "Almuerzo" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.revision).toBe(revision + 1);
    expect(res.movement.amount).toBe(30_000);
    expect(res.movement.note).toBe("Almuerzo");

    // La celda la recalcula el SERVIDOR: nadie le mandó la cifra nueva, y sin embargo bajó 70.000.
    const fin = (await loadLedger(A))!;
    expect(fin.state.actuals[hoja]?.[SEP]).toBe(30_000);
    const filas = [...(await testDb().execute(
      sql`SELECT amount, note FROM movement WHERE owner_id = ${A} AND id = ${`m-base-${A}`}`
    ))] as { amount: number; note: string | null }[];
    expect(filas).toHaveLength(1);
    expect(Number(filas[0].amount)).toBe(30_000);
    expect(filas[0].note).toBe("Almuerzo");
  });

  it("TC-DDC-091f: un PATCH sobre un movimiento de un periodo cerrado responde closed_period_violation", async () => {
    // @aitri-tc TC-DDC-091f
    // El movimiento vive en AGOSTO, que se cierra: a partir de ahí su cifra es historia.
    const { revision } = await sembrar(
      A,
      (hoja) => [gasto(A, "m-ago", hoja, 80_000, AGO, 1)],
      (hoja) => ({ [hoja]: { [AGO]: 80_000 } })
    );
    const c = await closeMonthFor(A, revision, SEP);
    expect(c.ok, JSON.stringify(c)).toBe(true);

    const res = await updateMovement(A, "m-ago", { amount: 10_000 });
    expect(res).toMatchObject({ ok: false, closedViolation: true, periods: [AGO] });
    // Y la cifra del mes cerrado no se movió ni un peso.
    const filas = [...(await testDb().execute(
      sql`SELECT amount FROM movement WHERE owner_id = ${A} AND id = 'm-ago'`
    ))] as { amount: number }[];
    expect(Number(filas[0].amount)).toBe(80_000);
  });

  it("TC-DDC-302f: A edita un movimiento de B — 404 y el de B queda intacto", async () => {
    // @aitri-tc TC-DDC-302f
    await sembrarSimple(A);
    await sembrarSimple(B);

    // Indistinguible de un id que no existe: el 404 no filtra que el movimiento SÍ existe, en otra
    // cuenta. Es la diferencia entre «no encontrado» y «no es tuyo», y la segunda es una fuga.
    const res = await updateMovement(A, `m-base-${B}`, { amount: 1 });
    expect(res).toEqual({ ok: false, notFound: true });

    const deB = (await loadLedger(B))!;
    expect(deB.state.movements.find((m) => m.id === `m-base-${B}`)!.amount).toBe(100_000);
    expect(deB.revision).toBe(1); // ni siquiera le subió la revisión
  });

  it("TC-DDC-312f: un monto que no respeta el kind se rechaza — nunca un 500", async () => {
    // @aitri-tc TC-DDC-312f
    const { hoja } = await sembrarSimple();
    // Un movimiento MANUAL no admite 0 ni negativo: esa licencia es solo del ajuste (FR-2504).
    expect(await updateMovement(A, `m-base-${A}`, { amount: 0 })).toEqual({ ok: false, rejected: "invalid_amount" });
    expect(await updateMovement(A, `m-base-${A}`, { amount: -5_000 })).toEqual({ ok: false, rejected: "invalid_amount" });
    // El rechazo llega ANTES del CHECK de la base: la celda y la revisión siguen donde estaban.
    const fin = (await loadLedger(A))!;
    expect(fin.state.actuals[hoja]?.[SEP]).toBe(100_000);
    expect(fin.revision).toBe(1);
  });

  it("TC-DDC-077e: kind y signo sobreviven a un PATCH del ajuste y al cierre del mes", async () => {
    // @aitri-tc TC-DDC-077e
    // Celda de 90.000 = un gasto de 100.000 menos un ajuste de −10.000, todo en AGOSTO.
    const { revision } = await sembrar(
      A,
      (hoja) => [
        gasto(A, "m-ago", hoja, 100_000, AGO, 1),
        gasto(A, "a-ago", hoja, -10_000, AGO, 2, { kind: "adjustment", note: "Ajuste manual" }),
      ],
      (hoja) => ({ [hoja]: { [AGO]: 90_000 } })
    );

    // Cambiarle la NOTA no toca ni el kind ni el signo.
    const res = await updateMovement(A, "a-ago", { note: "Devolución del restaurante" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.movement.kind).toBe("adjustment");
    expect(res.movement.amount).toBe(-10_000);

    // Y sobreviven al CIERRE, que reescribe el ledger entero al recargarlo.
    const c = await closeMonthFor(A, res.revision, SEP);
    expect(c.ok, JSON.stringify(c)).toBe(true);
    const fin = (await loadLedger(A))!;
    const a = fin.state.movements.find((m) => m.id === "a-ago")!;
    expect(a.kind).toBe("adjustment");
    expect(a.amount).toBe(-10_000);
  });

  it("cambiar la categoría MUEVE también la cifra, y las dos celdas quedan cuadradas", async () => {
    // La versión anterior de esta prueba esperaba un rechazo por descuadre y estaba EQUIVOCADA:
    // editar no reescribe solo el movimiento, mueve su cifra con él (FR-2505). El origen queda en 0
    // con cero movimientos y el destino en 100.000 con el suyo: las dos cuadran y la escritura
    // entra, que es justo lo que el requisito pide. Es el TC-DDC-084e del dominio, aquí contra
    // Postgres — donde se ve que las DOS celdas se persisten, no solo la de destino.
    const { state, hoja } = await sembrarSimple();
    const otra = otraHojaDeGasto(state, hoja);

    const res = await updateMovement(A, `m-base-${A}`, { catId: otra });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.movement.target).toBe(otra);

    const fin = (await loadLedger(A))!;
    expect(fin.state.actuals[hoja]?.[SEP]).toBe(0);        // el origen se vació
    expect(fin.state.actuals[otra]?.[SEP]).toBe(100_000);  // y el destino lo recibió
    // Y existe UNA sola vez: mover no duplica.
    expect(fin.state.movements.filter((m) => m.id === `m-base-${A}`)).toHaveLength(1);
  });
});

// ── FR-2506 · borrar ─────────────────────────────────────────────────────────────────────────────

describe("FR-2506 — el DELETE contra Postgres", () => {
  it("TC-DDC-114e: borra la fila en Postgres y recalcula la celda", async () => {
    // @aitri-tc TC-DDC-114e
    // Dos movimientos de 50.000: se borra uno y la celda tiene que quedar respaldada por el otro.
    const { revision, hoja } = await sembrar(
      A,
      (h) => [gasto(A, "m1", h, 50_000, SEP, 1), gasto(A, "m2", h, 50_000, SEP, 2)],
      (h) => ({ [h]: { [SEP]: 100_000 } })
    );
    const antes = await filasDe(A);

    const res = await removeMovement(A, "m1");
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.revision).toBe(revision + 1);

    expect(await filasDe(A)).toBe(antes - 1);
    const fin = (await loadLedger(A))!;
    expect(fin.state.movements.map((m) => m.id)).toEqual(["m2"]);
    expect(fin.state.actuals[hoja]?.[SEP]).toBe(50_000);
  });

  it("TC-DDC-117f: borrar un movimiento de un periodo cerrado se rechaza", async () => {
    // @aitri-tc TC-DDC-117f
    const { revision } = await sembrar(
      A,
      (h) => [gasto(A, "m-ago", h, 80_000, AGO, 1)],
      (h) => ({ [h]: { [AGO]: 80_000 } })
    );
    expect((await closeMonthFor(A, revision, SEP)).ok).toBe(true);
    const antes = await filasDe(A);

    expect(await removeMovement(A, "m-ago")).toMatchObject({ ok: false, closedViolation: true, periods: [AGO] });
    expect(await filasDe(A)).toBe(antes); // no se fue ninguna fila
  });

  it("TC-DDC-122f: un DELETE que dejaría la celda negativa se rechaza", async () => {
    // @aitri-tc TC-DDC-122f
    // Celda en 0 = gasto de 100.000 + ajuste de −100.000. Quitar el GASTO la dejaría en −100.000.
    const { hoja } = await sembrar(
      A,
      (h) => [
        gasto(A, "b", h, 100_000, SEP, 1),
        gasto(A, "a", h, -100_000, SEP, 2, { kind: "adjustment", note: "Ajuste manual" }),
      ],
      (h) => ({ [h]: { [SEP]: 0 } })
    );

    const res = await removeMovement(A, "b");
    expect(res).toMatchObject({ ok: false, negativeCell: true });
    if (res.ok || !("negativeCell" in res)) return;
    expect(res.cells).toEqual([{ nodeId: hoja, period: SEP, value: -100_000 }]);

    // Y el inverso SÍ se permite: borrar el ajuste deshace la corrección y la celda sube.
    const ok = await removeMovement(A, "a");
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect((await loadLedger(A))!.state.actuals[hoja]?.[SEP]).toBe(100_000);
  });

  it("TC-DDC-123f: un segundo DELETE del mismo id responde 404", async () => {
    // @aitri-tc TC-DDC-123f
    const { hoja } = await sembrar(
      A,
      (h) => [gasto(A, "m1", h, 50_000, SEP, 1), gasto(A, "m2", h, 50_000, SEP, 2)],
      (h) => ({ [h]: { [SEP]: 100_000 } })
    );
    expect((await removeMovement(A, "m1")).ok).toBe(true);
    // El segundo no es un error del servidor ni un borrado fantasma: sencillamente ya no está.
    expect(await removeMovement(A, "m1")).toEqual({ ok: false, notFound: true });
    const fin = (await loadLedger(A))!;
    expect(fin.revision).toBe(2); // el rechazo NO subió la revisión
    expect(fin.state.actuals[hoja]?.[SEP]).toBe(50_000);
  });

  it("TC-DDC-303f: A borra un movimiento de B — 404 y la fila de B sigue", async () => {
    // @aitri-tc TC-DDC-303f
    await sembrarSimple(A);
    await sembrarSimple(B);
    const antesB = await filasDe(B);

    expect(await removeMovement(A, `m-base-${B}`)).toEqual({ ok: false, notFound: true });
    expect(await filasDe(B)).toBe(antesB);
  });

  it("TC-DDC-094f: celda negativa — negative_cell por PATCH, invalid_payload por PUT", async () => {
    // @aitri-tc TC-DDC-094f
    // Las dos puertas paran lo mismo, pero NO en el mismo sitio, y eso es una decisión, no un
    // descuido: el PATCH razona sobre el movimiento (sabe cuál baja y cuánto) y el PUT recibe un
    // snapshot con una cifra imposible, que su esquema rechaza antes de mirar nada.
    const { hoja } = await sembrar(
      A,
      (h) => [gasto(A, "m", h, 50_000, SEP, 1), gasto(A, "a", h, -40_000, SEP, 2, { kind: "adjustment", note: "Ajuste manual" })],
      (h) => ({ [h]: { [SEP]: 10_000 } })
    );

    const porPatch = await updateMovement(A, "m", { amount: 30_000 });
    expect(porPatch).toMatchObject({ ok: false, negativeCell: true });

    const l = (await loadLedger(A))!;
    const negativo = { ...l.state, actuals: { ...l.state.actuals, [hoja]: { [SEP]: -10_000 } } };
    expect(ledgerPutSchema.safeParse({ baseRevision: l.revision, state: negativo }).success).toBe(false);

    // Y ninguna de las dos escribió: la celda sigue en 10.000.
    expect((await loadLedger(A))!.state.actuals[hoja]?.[SEP]).toBe(10_000);
  });

  it("TC-DDC-322e: con una celda ya descuadrada, guardar OTRA celda se acepta", async () => {
    // @aitri-tc TC-DDC-322e
    // El criterio es relativo: un descuadre que ya venía no puede dejar el libro en solo lectura.
    const { state, hoja } = await sembrarSimple();
    const taxi = otraHojaDeGasto(state, hoja);
    // Se descuadra por SQL directo: el propio servidor no admite crear el descuadre (esa es la
    // regla), así que para probar que TOLERA uno preexistente hay que sembrarlo por debajo.
    await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                               VALUES (${A}, ${taxi}, ${SEP}, 'actual', 45000)
                               ON CONFLICT (owner_id, node_id, period, kind) DO UPDATE SET amount = 45000`);

    const l = (await loadLedger(A))!;
    expect(l.state.actuals[taxi]?.[SEP]).toBe(45_000); // descuadrada: 45.000 sin un solo movimiento

    // Editar la OTRA celda entra con normalidad…
    const r = await updateMovement(A, `m-base-${A}`, { amount: 30_000 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // …y el descuadre viejo sigue exactamente igual: nadie lo tocó ni lo usó de excusa.
    expect((await loadLedger(A))!.state.actuals[taxi]?.[SEP]).toBe(45_000);
  });

  it("TC-DDC-323f: un PUT que descuadra una celda que cuadraba se rechaza con cell/sum exactos", async () => {
    // @aitri-tc TC-DDC-323f
    const { hoja } = await sembrarSimple();
    const l = (await loadLedger(A))!;
    const descuadrado = { ...l.state, actuals: { ...l.state.actuals, [hoja]: { [SEP]: 120_000 } } };

    const r = await saveLedger(A, descuadrado, l.revision);
    expect(r).toMatchObject({ ok: false, cellMismatch: true });
    if (r.ok || !("cellMismatch" in r)) return;
    // El detalle dice QUÉ no cuadra, no solo que algo no cuadra: la celda y lo que suman los suyos.
    expect(r.cells).toEqual([{ nodeId: hoja, period: SEP, cell: 120_000, sum: 100_000 }]);
    expect((await loadLedger(A))!.state.actuals[hoja]?.[SEP]).toBe(100_000);
  });

  it("TC-DDC-326e: las dos puertas rechazan igual lo cerrado, y difieren donde está declarado", async () => {
    // @aitri-tc TC-DDC-326e
    const { revision } = await sembrar(
      A,
      (h) => [gasto(A, "k", h, 80_000, AGO, 1)],
      (h) => ({ [h]: { [AGO]: 80_000 } })
    );
    expect((await closeMonthFor(A, revision, SEP)).ok).toBe(true);

    // Mes cerrado: MISMO veredicto por las dos puertas (ADR-02).
    const porPatch = await updateMovement(A, "k", { amount: 10_000 });
    expect(porPatch).toMatchObject({ ok: false, closedViolation: true });

    const l = (await loadLedger(A))!;
    const editado = { ...l.state, movements: l.state.movements.map((m) => (m.id === "k" ? { ...m, amount: 10_000 } : m)) };
    expect(await saveLedger(A, editado, l.revision)).toMatchObject({ ok: false, closedViolation: true });
  });

  it("TC-DDC-327e: cuando un PUT rompe dos reglas, gana la primera del orden", async () => {
    // @aitri-tc TC-DDC-327e
    // El orden importa porque el mensaje que ve el usuario nombra la causa PRIMERA. Si ganara la
    // última, le mandaríamos a arreglar algo que no desbloquea nada.
    const { revision } = await sembrar(
      A,
      (h) => [gasto(A, "k", h, 80_000, AGO, 1), gasto(A, "m", h, 100_000, SEP, 2)],
      (h) => ({ [h]: { [AGO]: 80_000, [SEP]: 100_000 } })
    );
    expect((await closeMonthFor(A, revision, SEP)).ok).toBe(true);
    const l = (await loadLedger(A))!;
    const hoja = hojaDeGasto(l.state);

    // 1º la REVISIÓN: con una base vieja no se mira nada más.
    expect(await saveLedger(A, l.state, l.revision - 1)).toMatchObject({ ok: false, conflict: true });

    // 2º la FECHA contra su periodo: antes que el cierre.
    const fechaMala = { ...l.state, movements: l.state.movements.map((m) => (m.id === "m" ? { ...m, date: "2026-12-05T12:00" } : m)) };
    expect(await saveLedger(A, fechaMala, l.revision)).toMatchObject({ ok: false, periodMismatch: true });

    // 3º el CIERRE: antes que el cuadre. El snapshot rompe las dos a la vez.
    const cerradoYDescuadrado = {
      ...l.state,
      actuals: { ...l.state.actuals, [hoja]: { [AGO]: 1_000, [SEP]: 999_000 } },
    };
    expect(await saveLedger(A, cerradoYDescuadrado, l.revision)).toMatchObject({ ok: false, closedViolation: true });

    // 4º el CUADRE, cuando ya no queda ninguna anterior que romper.
    const soloDescuadrado = { ...l.state, actuals: { ...l.state.actuals, [hoja]: { [AGO]: 80_000, [SEP]: 999_000 } } };
    expect(await saveLedger(A, soloDescuadrado, l.revision)).toMatchObject({ ok: false, cellMismatch: true });
  });

  it("TC-DDC-328e: el orden de los rechazos — dueño, luego tipo, luego cierre", async () => {
    // @aitri-tc TC-DDC-328e
    // Cada paso del orden se comprueba con un caso que rompe DOS reglas a la vez: si ganara la
    // segunda, el usuario recibiría un mensaje que no le desbloquea nada.
    const seed = buildSeed(A, AGO);
    const bolsillo = seed.nodes.find((n) => n.type === "transfer" && isLeaf(n, seed.nodes))!;
    const ingreso = seed.nodes.find((n) => n.type === "income" && isLeaf(n, seed.nodes))!;
    const hoja = hojaDeGasto(seed);
    const estado: LedgerState = {
      ...seed,
      actuals: { [ingreso.id]: { [AGO]: 3_000_000 }, [bolsillo.id]: { [AGO]: 50_000 }, [hoja]: { [AGO]: 0 } },
      movements: [
        { id: "ing", ownerId: A, type: "income", catId: ingreso.id, subId: null, target: ingreso.id, amount: 3_000_000, period: AGO, createdAt: 1, date: `${AGO}-01T12:00` },
        { id: "aporte", ownerId: A, type: "transfer", catId: bolsillo.id, subId: null, target: bolsillo.id, amount: 50_000, period: AGO, createdAt: 2, date: `${AGO}-02T12:00`, from: "@disponible", to: bolsillo.id },
        { id: "ta", ownerId: A, type: "transfer", catId: bolsillo.id, subId: null, target: bolsillo.id, amount: 5_000, period: AGO, createdAt: 3, date: `${AGO}-03T12:00`, from: bolsillo.id, to: "@disponible" },
        // La celda de K vale 0 porque un ajuste la anuló: borrarlo la dejaría en −7.000.
        gasto(A, "k", hoja, 7_000, AGO, 4),
        gasto(A, "k-aj", hoja, -7_000, AGO, 5, { kind: "adjustment", note: "Ajuste manual" }),
      ],
    };
    const puesto = await saveLedger(A, estado, 0);
    expect(puesto.ok, JSON.stringify(puesto)).toBe(true);
    await sembrarSimple(B);

    // Agosto cerrado: a partir de aquí TODO lo de A está además en un mes cerrado.
    const l0 = (await loadLedger(A))!;
    expect((await closeMonthFor(A, l0.revision, SEP)).ok).toBe(true);

    // 1º DUEÑO: el movimiento de B no existe para A — ni siquiera se mira que sea suyo o de qué tipo.
    expect(await updateMovement(A, `m-base-${B}`, { amount: 1 })).toEqual({ ok: false, notFound: true });

    // 2º TIPO, antes que el cierre: es un bolsillo Y está en un mes cerrado, y gana el tipo. Reabrir
    // el mes no le serviría de nada, así que decirle «está cerrado» sería mandarle a perder el tiempo.
    expect(await updateMovement(A, "ta", { amount: 1_000 })).toEqual({ ok: false, rejected: "unsupported_type" });

    // 3º CIERRE, antes que la celda negativa: borrar K la dejaría en −7.000, pero lo que le bloquea
    // primero es que el mes está cerrado.
    expect(await removeMovement(A, "k")).toMatchObject({ ok: false, closedViolation: true });
  });

  it("TC-DDC-361h: una edición que respeta techo y piso se acepta", async () => {
    // @aitri-tc TC-DDC-361h
    const seed = buildSeed(A, SEP);
    const bolsillo = seed.nodes.find((n) => n.type === "transfer" && isLeaf(n, seed.nodes))!;
    const ingreso = seed.nodes.find((n) => n.type === "income" && isLeaf(n, seed.nodes))!;
    const hoja = hojaDeGasto(seed);
    const estado: LedgerState = {
      ...seed,
      actuals: { [ingreso.id]: { [SEP]: 3_000_000 }, [bolsillo.id]: { [SEP]: 500_000 }, [hoja]: { [SEP]: 50_000 } },
      movements: [
        { id: "ing", ownerId: A, type: "income", catId: ingreso.id, subId: null, target: ingreso.id, amount: 3_000_000, period: SEP, createdAt: 1, date: `${SEP}-01T12:00` },
        { id: "aporte", ownerId: A, type: "transfer", catId: bolsillo.id, subId: null, target: bolsillo.id, amount: 500_000, period: SEP, createdAt: 2, date: `${SEP}-02T12:00`, from: "@disponible", to: bolsillo.id },
        gasto(A, "a1", hoja, 50_000, SEP, 3),
      ],
    };
    expect((await saveLedger(A, estado, 0)).ok).toBe(true);

    // Bajar el gasto no toca ni el techo ni el piso: entra sin fricción.
    const r = await updateMovement(A, "a1", { amount: 40_000 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await loadLedger(A))!.state.actuals[hoja]?.[SEP]).toBe(40_000);
  });

  it("TC-DDC-362f: un PUT que edita un movimiento y a la vez rompe el piso de un bolsillo se rechaza entero", async () => {
    // @aitri-tc TC-DDC-362f
    // La escritura es ATÓMICA: no se guarda «la parte buena». Si se aceptara la edición del gasto y
    // se descartara el destrozo del bolsillo, el usuario acabaría con la mitad de lo que pidió y sin
    // nada que se lo dijera.
    const seed = buildSeed(A, SEP);
    const bolsillo = seed.nodes.find((n) => n.type === "transfer" && isLeaf(n, seed.nodes))!;
    const ingreso = seed.nodes.find((n) => n.type === "income" && isLeaf(n, seed.nodes))!;
    const hoja = hojaDeGasto(seed);
    const estado: LedgerState = {
      ...seed,
      actuals: { [ingreso.id]: { [SEP]: 3_000_000 }, [bolsillo.id]: { [SEP]: 20_000 }, [hoja]: { [SEP]: 50_000 } },
      movements: [
        { id: "ing", ownerId: A, type: "income", catId: ingreso.id, subId: null, target: ingreso.id, amount: 3_000_000, period: SEP, createdAt: 1, date: `${SEP}-01T12:00` },
        { id: "aporte", ownerId: A, type: "transfer", catId: bolsillo.id, subId: null, target: bolsillo.id, amount: 20_000, period: SEP, createdAt: 2, date: `${SEP}-02T12:00`, from: "@disponible", to: bolsillo.id },
        { id: "retiro", ownerId: A, type: "transfer", catId: bolsillo.id, subId: null, target: bolsillo.id, amount: 15_000, period: SEP, createdAt: 3, date: `${SEP}-03T12:00`, from: bolsillo.id, to: "@disponible" },
        gasto(A, "a1", hoja, 50_000, SEP, 4),
      ],
    };
    expect((await saveLedger(A, estado, 0)).ok).toBe(true);
    const l = (await loadLedger(A))!;

    // Un solo snapshot con las DOS cosas: baja el gasto (legal) y deja el bolsillo por debajo de lo
    // que ya se retiró de él (ilegal).
    const mixto: LedgerState = {
      ...l.state,
      actuals: { ...l.state.actuals, [bolsillo.id]: { [SEP]: 0 }, [hoja]: { [SEP]: 40_000 } },
      movements: l.state.movements.map((m) => (m.id === "a1" ? { ...m, amount: 40_000 } : m)),
    };
    expect(await saveLedger(A, mixto, l.revision)).toMatchObject({ ok: false, domainViolation: true });

    // NINGUNA de las dos entró, ni siquiera la legal.
    const fin = (await loadLedger(A))!;
    expect(fin.revision).toBe(l.revision);
    expect(fin.state.actuals[hoja]?.[SEP]).toBe(50_000);
    expect(fin.state.actuals[bolsillo.id]?.[SEP]).toBe(20_000);
  });

  it("TC-DDC-363e: bajar un ingreso por PATCH no se juzga con las reglas de reservas (paridad BL-051)", async () => {
    // @aitri-tc TC-DDC-363e
    // PARIDAD DECLARADA, no descuido: el PUT vigente tampoco juzga esto, y esta feature no cambia la
    // regla — solo añade una puerta más. Si algún día se decide apretar, se aprietan las DOS a la
    // vez y este caso se re-deriva; mientras tanto, divergir en silencio sería peor que la laguna.
    const seed = buildSeed(A, SEP);
    const bolsillo = seed.nodes.find((n) => n.type === "transfer" && isLeaf(n, seed.nodes))!;
    const ingreso = seed.nodes.find((n) => n.type === "income" && isLeaf(n, seed.nodes))!;
    const estado: LedgerState = {
      ...seed,
      actuals: { [ingreso.id]: { [SEP]: 3_000_000 }, [bolsillo.id]: { [SEP]: 2_800_000 } },
      movements: [
        { id: "i1", ownerId: A, type: "income", catId: ingreso.id, subId: null, target: ingreso.id, amount: 3_000_000, period: SEP, createdAt: 1, date: `${SEP}-01T12:00` },
        { id: "aporte", ownerId: A, type: "transfer", catId: bolsillo.id, subId: null, target: bolsillo.id, amount: 2_800_000, period: SEP, createdAt: 2, date: `${SEP}-02T12:00`, from: "@disponible", to: bolsillo.id },
      ],
    };
    expect((await saveLedger(A, estado, 0)).ok).toBe(true);

    // Baja el ingreso muy por debajo de lo ya reservado. Se ACEPTA.
    const r = await updateMovement(A, "i1", { amount: 1_000_000 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await loadLedger(A))!.state.actuals[ingreso.id]?.[SEP]).toBe(1_000_000);
  });

  it("TC-DDC-301h: el dueño edita y borra los SUYOS sin fricción", async () => {
    // @aitri-tc TC-DDC-301h
    const { hoja } = await sembrar(
      A,
      (h) => [gasto(A, "m1", h, 60_000, SEP, 1), gasto(A, "m2", h, 40_000, SEP, 2)],
      (h) => ({ [h]: { [SEP]: 100_000 } })
    );
    const editado = await updateMovement(A, "m1", { amount: 20_000 });
    expect(editado.ok, JSON.stringify(editado)).toBe(true);
    const borrado = await removeMovement(A, "m2");
    expect(borrado.ok, JSON.stringify(borrado)).toBe(true);

    const fin = (await loadLedger(A))!;
    expect(fin.state.actuals[hoja]?.[SEP]).toBe(20_000);
    expect(fin.state.movements.map((m) => m.id)).toEqual(["m1"]);
  });
});
