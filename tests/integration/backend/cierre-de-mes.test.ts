/**
 * Feature cierre-de-mes — la persistencia y EL GUARDIA contra un Postgres real (testcontainers).
 * TCs: FR-2001 (010h,011e,013f) · FR-2002 (022f,023f) · FR-2003 (030h,031f,032f,033f,034f,035f,036e,037e,038e,039f) ·
 *      FR-2004 (040h,042f) · FR-2005 (050h,052f,054f,055h,056f) · FR-2007 (071h,072f) · FR-2008 (081h) ·
 *      NFR-2005 (240f,241f,242f,243h) · NFR-2007 (260h,261f,262e) · NFR-2008 (270h,271f,272e)
 *
 * Es la capa donde el cierre es AUTORIDAD: lo que el navegador impide es ergonomía, lo que se
 * prueba aquí es el contrato (ADR-12).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildSeed, setLeafAmount } from "@/domain";
import { isLeaf } from "@/domain/tree";
import {
  loadLedger, saveLedger, insertMovement, closeMonthFor, reopenMonthFor, getClosureEvents,
} from "@/server/data/ledgerRepo";
import { closurePostSchema } from "@/server/schemas";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";
import type { LedgerState, PeriodKey } from "@/domain/types";

const A = "user-cdm";
const B = "user-cdm-b";
/** El estado arranca en 2026-06, así que junio, julio y agosto están terminados si hoy es 2026-09. */
const INICIO: PeriodKey = "2026-06";
const AHORA: PeriodKey = "2026-09";

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene ninguna hoja de gasto");
  return h.id;
}

/** Siembra un ledger y devuelve su estado y revisión. */
async function sembrar(owner = A): Promise<{ state: LedgerState; revision: number }> {
  const seed = buildSeed(owner, INICIO);
  const res = await saveLedger(owner, seed, 0);
  if (!res.ok) throw new Error("no se pudo sembrar");
  const loaded = await loadLedger(owner);
  if (!loaded) throw new Error("no se pudo cargar");
  return { state: loaded.state, revision: loaded.revision };
}

/** Cierra `n` meses seguidos desde el principio del historial. */
async function cerrar(n: number, owner = A): Promise<{ state: LedgerState; revision: number }> {
  let rev = (await loadLedger(owner))!.revision;
  for (let i = 0; i < n; i++) {
    const r = await closeMonthFor(owner, rev, AHORA);
    if (!r.ok) throw new Error(`no se pudo cerrar el mes ${i + 1}: ${JSON.stringify(r)}`);
    rev = r.revision;
  }
  const loaded = await loadLedger(owner);
  return { state: loaded!.state, revision: loaded!.revision };
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "cierre@example.com");
  await createTestUser(B, "cierre-b@example.com");
});
afterAll(async () => { await closeTestDb(); });

// ══ FR-2001 · el cierre persiste ════════════════════════════════════════════════════════════════
describe("FR-2001 · el cierre forma parte del ledger", () => {
  it("TC-CDM-010h: cerrado un mes, sobrevive a la recarga", async () => {
    // @aitri-tc TC-CDM-010h
    const { revision } = await sembrar();
    const r = await closeMonthFor(A, revision, AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.closure).toEqual({ closedThrough: INICIO, reopened: null });
    expect(r.revision).toBe(revision + 1);

    const recargado = await loadLedger(A);
    expect(recargado!.state.closure).toEqual({ closedThrough: INICIO, reopened: null });
  });

  it("TC-CDM-011e: el cierre sube revision y deja stale al cliente viejo", async () => {
    // @aitri-tc TC-CDM-011e
    const { state, revision } = await sembrar();
    const r = await closeMonthFor(A, revision, AHORA);
    expect(r.ok).toBe(true);
    // El cliente B guarda con la revisión ANTERIOR al cierre.
    const save = await saveLedger(A, state, revision);
    expect(save.ok).toBe(false);
    expect(save).toMatchObject({ conflict: true, revision: revision + 1 });
    expect((await loadLedger(A))!.state.closure!.closedThrough).toBe(INICIO);
  });

  it("TC-CDM-013f: un closed_through corrupto degrada a «nada cerrado», sin romper la carga", async () => {
    // @aitri-tc TC-CDM-013f
    await sembrar();
    // Se salta el CHECK a propósito para simular un dato escrito antes de la migración.
    await testDb().execute(sql`ALTER TABLE ledger DROP CONSTRAINT ledger_closed_through_ck`);
    await testDb().execute(sql`UPDATE ledger SET closed_through = '2026-13' WHERE owner_id = ${A}`);
    const loaded = await loadLedger(A);
    expect(loaded).not.toBeNull();
    expect(loaded!.state.closure).toEqual({ closedThrough: null, reopened: null });
    // Limpiar ANTES de restaurar: con la fila corrupta puesta, el CHECK no se puede volver a
    // crear y la prueba dejaría la base rota para todas las siguientes.
    await testDb().execute(sql`UPDATE ledger SET closed_through = NULL WHERE owner_id = ${A}`);
    await testDb().execute(sql`ALTER TABLE ledger ADD CONSTRAINT ledger_closed_through_ck
      CHECK (closed_through IS NULL OR closed_through ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')`);
  });
});

// ══ FR-2002 / FR-2008 · qué se puede cerrar ═════════════════════════════════════════════════════
describe("FR-2002 · el cierre es secuencial y no es negociable desde el cliente", () => {
  it("TC-CDM-022f: el protocolo NO admite proponer qué mes cerrar", async () => {
    // @aitri-tc TC-CDM-022f
    // El esquema es .strict(): un `period` en el cuerpo se rechaza ANTES de llegar al repositorio.
    const conPeriodo = closurePostSchema.safeParse({ baseRevision: 1, period: "2026-09" });
    expect(conPeriodo.success).toBe(false);

    // Y aunque se colara, el repositorio deriva el mes él mismo: cierra JUNIO, no septiembre.
    const { revision } = await sembrar();
    const r = await closeMonthFor(A, revision, AHORA);
    expect(r.ok && r.closure.closedThrough).toBe(INICIO);
  });

  it("TC-CDM-023f: sin mes cerrable, se rechaza sin tocar revision ni frontera", async () => {
    // @aitri-tc TC-CDM-023f
    await sembrar();
    const { revision } = await cerrar(4); // junio, julio, agosto y el mes en curso
    const antes = await loadLedger(A);
    const r = await closeMonthFor(A, revision, AHORA);
    expect(r).toEqual({ ok: false, rejected: "not_closable" });
    const despues = await loadLedger(A);
    expect(despues!.revision).toBe(antes!.revision);
    expect(despues!.state.closure).toEqual(antes!.state.closure);
  });

  it("TC-CDM-081h: el mes en curso es cerrable y queda inmediatamente reabrible", async () => {
    // @aitri-tc TC-CDM-081h
    await sembrar();
    const { state, revision } = await cerrar(4);
    expect(state.closure!.closedThrough).toBe(AHORA);
    const r = await reopenMonthFor(A, revision);
    expect(r.ok && r.closure.reopened).toBe(AHORA);
  });
});

// ══ FR-2003 · EL GUARDIA ════════════════════════════════════════════════════════════════════════
describe("FR-2003 · ninguna operación altera una cifra de un mes cerrado", () => {
  it("TC-CDM-030h: PROPIEDAD — el mes cerrado sobrevive intacto a trastear el abierto", async () => {
    // @aitri-tc TC-CDM-030h
    await sembrar();
    const { state } = await cerrar(1); // junio cerrado
    const hoja = hojaDeGasto(state);

    const foto = async () => {
      const db = testDb();
      const cells = await db.execute(sql`SELECT node_id, kind, amount FROM amount_cell
                                         WHERE owner_id = ${A} AND period = ${INICIO}
                                         ORDER BY node_id, kind`);
      const movs = await db.execute(sql`SELECT id, amount, target FROM movement
                                        WHERE owner_id = ${A} AND period = ${INICIO} ORDER BY id`);
      return JSON.stringify({ cells: [...cells], movs: [...movs] });
    };
    const antes = await foto();
    // ANTI-VACUIDAD, y no es paranoia: la primera versión de esta prueba leía `.rows` —que con
    // postgres.js es undefined— y comparaba undefined con undefined, así que pasaba SIN MIRAR
    // NADA. Una prueba de propiedad que no comprueba que su foto tiene contenido es exactamente
    // el fallo falso que esta feature existe para evitar.
    expect(JSON.parse(antes).cells.length).toBeGreaterThan(0);

    // Batería completa sobre el mes ABIERTO. Cada paso recarga para llevar la revisión buena.
    for (const [campo, valor] of [["budget", 900_000], ["actual", 500_000]] as const) {
      const l = (await loadLedger(A))!;
      const next = setLeafAmount(l.state, hoja, AHORA, campo, valor, [AHORA]);
      expect((await saveLedger(A, next, l.revision)).ok).toBe(true);
    }
    const l = (await loadLedger(A))!;
    const mv = await insertMovement(A, {
      type: "expense", catId: hoja, subId: null, amount: 123_456, period: AHORA,
    } as Parameters<typeof insertMovement>[1]);
    expect(mv).not.toBeNull();
    expect(l.revision).toBeGreaterThan(0);

    expect(await foto()).toBe(antes);
  });

  it("TC-CDM-031f + TC-CDM-032f: editar presupuesto o ejecutado de un mes cerrado se rechaza", async () => {
    // @aitri-tc TC-CDM-031f
    await sembrar();
    const { state, revision } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    const original = state.budgets[hoja]?.[INICIO] ?? 0;

    for (const campo of ["budget", "actual"] as const) {
      const l = (await loadLedger(A))!;
      const next = setLeafAmount(l.state, hoja, INICIO, campo, 999_000, [INICIO, AHORA]);
      const res = await saveLedger(A, next, l.revision);
      expect(res.ok).toBe(false);
      expect(res).toMatchObject({ closedViolation: true, periods: [INICIO] });
    }
    expect((await loadLedger(A))!.state.budgets[hoja]?.[INICIO] ?? 0).toBe(original);
  });

  it("TC-CDM-032f: el ejecutado de un mes cerrado queda intacto tras el rechazo", async () => {
    // @aitri-tc TC-CDM-032f
    await sembrar();
    const { state } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    const original = state.actuals[hoja]?.[INICIO] ?? 0;
    const l = (await loadLedger(A))!;
    const next = setLeafAmount(l.state, hoja, INICIO, "actual", 1, [INICIO, AHORA]);
    expect((await saveLedger(A, next, l.revision)).ok).toBe(false);
    expect((await loadLedger(A))!.state.actuals[hoja]?.[INICIO] ?? 0).toBe(original);
  });

  it("TC-CDM-033f: registrar un movimiento en un mes cerrado se rechaza y no inserta nada", async () => {
    // @aitri-tc TC-CDM-033f
    await sembrar();
    const { state } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    const res = await insertMovement(A, {
      type: "expense", catId: hoja, subId: null, amount: 50_000, period: INICIO,
    } as Parameters<typeof insertMovement>[1]);
    expect(res).toEqual({ closedViolation: true });
    const filas = await testDb().execute(sql`SELECT count(*)::int AS n FROM movement
                                             WHERE owner_id = ${A} AND period = ${INICIO}`);
    expect(([...filas][0] as { n: number }).n).toBe(0);
  });

  it("TC-CDM-034f: borrar un movimiento de un mes cerrado se rechaza", async () => {
    // @aitri-tc TC-CDM-034f
    await sembrar();
    const l0 = (await loadLedger(A))!;
    const hoja = hojaDeGasto(l0.state);
    const ins = await insertMovement(A, {
      type: "expense", catId: hoja, subId: null, amount: 80_000, period: INICIO,
    } as Parameters<typeof insertMovement>[1]);
    expect(ins).not.toBeNull();
    await cerrar(1);

    const l = (await loadLedger(A))!;
    const sinEl = { ...l.state, movements: l.state.movements.filter((m) => m.period !== INICIO) };
    const res = await saveLedger(A, sinEl, l.revision);
    expect(res).toMatchObject({ closedViolation: true, periods: [INICIO] });
    const filas = await testDb().execute(sql`SELECT count(*)::int AS n FROM movement
                                             WHERE owner_id = ${A} AND period = ${INICIO}`);
    expect(([...filas][0] as { n: number }).n).toBe(1);
  });

  it("TC-CDM-035f: aportar en un mes cerrado se rechaza y el reservado no cambia", async () => {
    // @aitri-tc TC-CDM-035f
    await sembrar();
    const { state } = await cerrar(1);
    const bolsillo = state.nodes.find((n) => n.type === "transfer" && isLeaf(n, state.nodes));
    expect(bolsillo).toBeDefined();
    const original = state.budgets[bolsillo!.id]?.[INICIO] ?? 0;
    const l = (await loadLedger(A))!;
    const next = setLeafAmount(l.state, bolsillo!.id, INICIO, "budget", original + 50_000, [INICIO, AHORA]);
    expect((await saveLedger(A, next, l.revision)).ok).toBe(false);
    expect((await loadLedger(A))!.state.budgets[bolsillo!.id]?.[INICIO] ?? 0).toBe(original);
  });

  it("TC-CDM-036e: mover un movimiento HACIA un mes cerrado se rechaza", async () => {
    // @aitri-tc TC-CDM-036e
    await sembrar();
    const l0 = (await loadLedger(A))!;
    const hoja = hojaDeGasto(l0.state);
    await insertMovement(A, {
      type: "expense", catId: hoja, subId: null, amount: 60_000, period: AHORA,
    } as Parameters<typeof insertMovement>[1]);
    await cerrar(1);
    const l = (await loadLedger(A))!;
    const movido = {
      ...l.state,
      movements: l.state.movements.map((m) => (m.period === AHORA ? { ...m, period: INICIO } : m)),
    };
    expect(await saveLedger(A, movido, l.revision)).toMatchObject({ closedViolation: true });
    expect((await loadLedger(A))!.state.movements.every((m) => m.period !== INICIO)).toBe(true);
  });

  it("TC-CDM-037e: editar el mes ABIERTO se acepta con normalidad", async () => {
    // @aitri-tc TC-CDM-037e
    await sembrar();
    const { state } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    const l = (await loadLedger(A))!;
    const next = setLeafAmount(l.state, hoja, AHORA, "budget", 350_000, [AHORA]);
    const res = await saveLedger(A, next, l.revision);
    expect(res).toEqual({ ok: true, revision: l.revision + 1 });
    expect((await loadLedger(A))!.state.budgets[hoja]?.[AHORA]).toBe(350_000);
  });

  it("TC-CDM-038e: manda la frontera PERSISTIDA, no la que traiga el cliente", async () => {
    // @aitri-tc TC-CDM-038e
    await sembrar();
    const { state } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    const l = (await loadLedger(A))!;
    // El atacante se baja la frontera EN EL MISMO snapshot con el que edita el mes cerrado.
    const trampa: LedgerState = {
      ...setLeafAmount(l.state, hoja, INICIO, "budget", 999_000, [INICIO, AHORA]),
      closure: { closedThrough: null, reopened: null },
    };
    expect(await saveLedger(A, trampa, l.revision)).toMatchObject({ closedViolation: true });
    // Y la frontera sigue donde estaba: el PUT del ledger nunca la mueve.
    expect((await loadLedger(A))!.state.closure!.closedThrough).toBe(INICIO);
  });

  it("TC-CDM-039f: una escritura rechazada no deja rastro parcial", async () => {
    // @aitri-tc TC-CDM-039f
    await sembrar();
    const { state } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    const l = (await loadLedger(A))!;
    const legalAntes = l.state.budgets[hoja]?.[AHORA] ?? 0;
    // Cambia A LA VEZ una celda legal del mes abierto y una ilegal del cerrado.
    const mixto = setLeafAmount(
      setLeafAmount(l.state, hoja, AHORA, "budget", 777_000, [AHORA]),
      hoja, INICIO, "budget", 999_000, [INICIO, AHORA]
    );
    expect(await saveLedger(A, mixto, l.revision)).toMatchObject({ closedViolation: true });
    const despues = (await loadLedger(A))!;
    expect(despues.revision).toBe(l.revision);
    expect(despues.state.budgets[hoja]?.[AHORA] ?? 0).toBe(legalAntes); // la LEGAL tampoco se escribió
  });
});

// ══ FR-2004 · las notas siguen editables ════════════════════════════════════════════════════════
describe("FR-2004 · las observaciones no se congelan", () => {
  it("TC-CDM-040h: escribir una observación en un mes cerrado se acepta y persiste", async () => {
    // @aitri-tc TC-CDM-040h
    await sembrar();
    const { state } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    const l = (await loadLedger(A))!;
    const conNota: LedgerState = {
      ...l.state,
      cellNotes: { [hoja]: { [INICIO]: [{ id: "n1", text: "error detectado en septiembre", createdAt: 1 }] } },
    };
    expect(await saveLedger(A, conNota, l.revision)).toEqual({ ok: true, revision: l.revision + 1 });
    expect((await loadLedger(A))!.state.cellNotes?.[hoja]?.[INICIO]?.[0]?.text)
      .toBe("error detectado en septiembre");
  });

  it("TC-CDM-042f: una nota legal NO exime a la cifra que viaja con ella", async () => {
    // @aitri-tc TC-CDM-042f
    await sembrar();
    const { state } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    const original = state.budgets[hoja]?.[INICIO] ?? 0;
    const l = (await loadLedger(A))!;
    const trampa: LedgerState = {
      ...setLeafAmount(l.state, hoja, INICIO, "budget", 999_000, [INICIO, AHORA]),
      cellNotes: { [hoja]: { [INICIO]: [{ id: "n1", text: "coartada", createdAt: 1 }] } },
    };
    expect(await saveLedger(A, trampa, l.revision)).toMatchObject({ closedViolation: true });
    const despues = (await loadLedger(A))!;
    expect(despues.state.budgets[hoja]?.[INICIO] ?? 0).toBe(original);
    expect(despues.state.cellNotes?.[hoja]?.[INICIO] ?? []).toHaveLength(0); // ni la nota entró
  });
});

// ══ FR-2005 · reapertura ════════════════════════════════════════════════════════════════════════
describe("FR-2005 · reapertura del último mes cerrado", () => {
  it("TC-CDM-050h: reabrir devuelve la edición de ese mes", async () => {
    // @aitri-tc TC-CDM-050h
    await sembrar();
    const { state, revision } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    const r = await reopenMonthFor(A, revision);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.closure).toEqual({ closedThrough: "2026-05", reopened: INICIO });

    const l = (await loadLedger(A))!;
    const next = setLeafAmount(l.state, hoja, INICIO, "budget", 350_000, [INICIO, AHORA]);
    expect((await saveLedger(A, next, l.revision)).ok).toBe(true);
    expect((await loadLedger(A))!.state.budgets[hoja]?.[INICIO]).toBe(350_000);
  });

  it("TC-CDM-052f: con un mes ya reabierto, reabrir otro se rechaza", async () => {
    // @aitri-tc TC-CDM-052f
    await sembrar();
    const { revision } = await cerrar(2);
    const r1 = await reopenMonthFor(A, revision);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const antes = await loadLedger(A);
    const r2 = await reopenMonthFor(A, r1.revision);
    expect(r2).toEqual({ ok: false, rejected: "already_reopened" });
    const despues = await loadLedger(A);
    expect(despues!.state.closure).toEqual(antes!.state.closure);
    expect(despues!.revision).toBe(antes!.revision);
  });

  it("TC-CDM-054f: sin nada cerrado no hay nada que reabrir", async () => {
    // @aitri-tc TC-CDM-054f
    const { revision } = await sembrar();
    expect(await reopenMonthFor(A, revision)).toEqual({ ok: false, rejected: "nothing_closed" });
    expect((await loadLedger(A))!.revision).toBe(revision);
  });

  it("TC-CDM-055h: el rastro de la reapertura sobrevive a volver a cerrar", async () => {
    // @aitri-tc TC-CDM-055h
    await sembrar();
    const { revision } = await cerrar(1);
    const r = await reopenMonthFor(A, revision);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = await closeMonthFor(A, r.revision, AHORA);
    expect(c.ok).toBe(true);

    const eventos = await getClosureEvents(A);
    expect(eventos.map((e) => `${e.action}:${e.period}`))
      .toEqual([`close:${INICIO}`, `reopen:${INICIO}`, `close:${INICIO}`].reverse());
    for (const e of eventos) expect(Date.parse(e.at)).not.toBeNaN();
  });

  it("TC-CDM-056f: no existe un cierre sin rastro — todo va en la misma transacción", async () => {
    // @aitri-tc TC-CDM-056f
    await sembrar();
    const { revision } = await cerrar(1);
    // Se rompe el INSERT del rastro: el CHECK de `action` deja de admitir 'reopen'.
    const db = testDb();
    await db.execute(sql`ALTER TABLE closure_event DROP CONSTRAINT closure_event_action_ck`);
    await db.execute(sql`ALTER TABLE closure_event ADD CONSTRAINT closure_event_action_ck CHECK (action = 'close')`);
    const antes = await loadLedger(A);
    await expect(reopenMonthFor(A, revision)).rejects.toThrow();
    const despues = await loadLedger(A);
    // La frontera NO se movió y el rastro no ganó filas: rollback completo.
    expect(despues!.state.closure).toEqual(antes!.state.closure);
    expect(despues!.revision).toBe(antes!.revision);
    expect((await getClosureEvents(A)).filter((e) => e.action === "reopen")).toHaveLength(0);
    await db.execute(sql`ALTER TABLE closure_event DROP CONSTRAINT closure_event_action_ck`);
    await db.execute(sql`ALTER TABLE closure_event ADD CONSTRAINT closure_event_action_ck
                         CHECK (action in ('close','reopen'))`);
  });
});

// ══ FR-2007 · el futuro sigue editable ══════════════════════════════════════════════════════════
describe("FR-2007 · el futuro planeado no se congela", () => {
  it("TC-CDM-071h: se edita el horizonte entero con un mes cerrado detrás", async () => {
    // @aitri-tc TC-CDM-071h
    await sembrar();
    const { state } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    for (const p of ["2026-10", "2027-06", "2028-12"] as PeriodKey[]) {
      const l = (await loadLedger(A))!;
      const next = setLeafAmount(l.state, hoja, p, "budget", 111_000, [p]);
      expect(await saveLedger(A, next, l.revision)).toEqual({ ok: true, revision: l.revision + 1 });
    }
    const fin = (await loadLedger(A))!;
    for (const p of ["2026-10", "2027-06", "2028-12"] as PeriodKey[]) {
      expect(fin.state.budgets[hoja]?.[p]).toBe(111_000);
    }
  });

  it("TC-CDM-072f: editar el futuro no altera ni una cifra del mes cerrado", async () => {
    // @aitri-tc TC-CDM-072f
    await sembrar();
    const { state } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    const db = testDb();
    const foto = async () => JSON.stringify(
      [...(await db.execute(sql`SELECT node_id, kind, amount FROM amount_cell
                            WHERE owner_id = ${A} AND period = ${INICIO} ORDER BY node_id, kind`))]
    );
    const antes = await foto();
    const l = (await loadLedger(A))!;
    const next = setLeafAmount(l.state, hoja, "2026-11", "budget", 900_000, ["2026-11"]);
    expect((await saveLedger(A, next, l.revision)).ok).toBe(true);
    expect(await foto()).toBe(antes);
  });
});

// ══ NFR-2005 · el servidor es la autoridad ══════════════════════════════════════════════════════
describe("NFR-2005 · seguridad del cierre", () => {
  it("TC-CDM-240f: el rechazo NO depende del navegador: se decide en el repositorio", async () => {
    // @aitri-tc TC-CDM-240f
    await sembrar();
    const { state } = await cerrar(1);
    const hoja = hojaDeGasto(state);
    // Snapshot construido a mano, sin pasar por ninguna mutación del cliente.
    const l = (await loadLedger(A))!;
    const aMano: LedgerState = {
      ...l.state,
      budgets: { ...l.state.budgets, [hoja]: { ...l.state.budgets[hoja], [INICIO]: 424_242 } },
    };
    expect(await saveLedger(A, aMano, l.revision)).toMatchObject({ closedViolation: true });
    expect((await loadLedger(A))!.state.budgets[hoja]?.[INICIO]).not.toBe(424_242);
  });

  it("TC-CDM-241f: el esquema del cuerpo solo admite baseRevision", async () => {
    // @aitri-tc TC-CDM-241f
    expect(closurePostSchema.safeParse({ baseRevision: 0 }).success).toBe(true);
    for (const malo of [{}, { baseRevision: -1 }, { baseRevision: "1" }, { baseRevision: 1, ownerId: "u2" },
                        { baseRevision: 1, period: "2026-08" }, { baseRevision: 1.5 }]) {
      expect(closurePostSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it("TC-CDM-242f: el cierre de un usuario no toca el ledger de otro", async () => {
    // @aitri-tc TC-CDM-242f
    const { revision } = await sembrar(A);
    await sembrar(B);
    expect((await closeMonthFor(A, revision, AHORA)).ok).toBe(true);
    expect((await loadLedger(B))!.state.closure).toEqual({ closedThrough: null, reopened: null });
    expect(await getClosureEvents(B)).toHaveLength(0);
  });

  it("TC-CDM-243h: el guardia corre dentro del lock — no hay ventana entre validar y escribir", async () => {
    // @aitri-tc TC-CDM-243h
    await sembrar();
    const l = (await loadLedger(A))!;
    const hoja = hojaDeGasto(l.state);
    const edicion = setLeafAmount(l.state, hoja, INICIO, "budget", 555_000, [INICIO, AHORA]);
    // Las dos salen con la MISMA baseRevision: una gana, la otra no puede colarse detrás.
    const [cierre, escritura] = await Promise.all([
      closeMonthFor(A, l.revision, AHORA),
      saveLedger(A, edicion, l.revision),
    ]);
    expect([cierre.ok, escritura.ok].filter(Boolean)).toHaveLength(1);
    const fin = (await loadLedger(A))!;
    // Si ganó el cierre, junio quedó cerrado y su celda NO tiene el valor de la edición.
    if (fin.state.closure?.closedThrough === INICIO) {
      expect(fin.state.budgets[hoja]?.[INICIO]).not.toBe(555_000);
    }
  });
});

// ══ NFR-2007 · persistencia ═════════════════════════════════════════════════════════════════════
describe("NFR-2007 · la persistencia no pierde nada", () => {
  it("TC-CDM-260h: ida y vuelta completa con cierres, reapertura y rastro", async () => {
    // @aitri-tc TC-CDM-260h
    await sembrar();
    const { revision } = await cerrar(3);
    const r = await reopenMonthFor(A, revision);
    expect(r.ok).toBe(true);
    const antes = await loadLedger(A);
    const guardado = await saveLedger(A, antes!.state, antes!.revision);
    expect(guardado.ok).toBe(true);
    const despues = await loadLedger(A);
    expect(despues!.state.closure).toEqual(antes!.state.closure);
    expect(despues!.state.budgets).toEqual(antes!.state.budgets);
    expect(despues!.state.actuals).toEqual(antes!.state.actuals);
    expect(await getClosureEvents(A)).toHaveLength(4);
  });

  it("TC-CDM-261f: el lock optimista sigue rechazando al cliente viejo", async () => {
    // @aitri-tc TC-CDM-261f
    const { state, revision } = await sembrar();
    expect(await saveLedger(A, state, revision - 1)).toMatchObject({ conflict: true });
  });

  it("TC-CDM-262e: un ledger anterior a la migración carga sin cierre y opera igual", async () => {
    // @aitri-tc TC-CDM-262e
    await sembrar();
    await testDb().execute(sql`UPDATE ledger SET closed_through = NULL, reopened_period = NULL
                               WHERE owner_id = ${A}`);
    const l = (await loadLedger(A))!;
    expect(l.state.closure).toEqual({ closedThrough: null, reopened: null });
    const hoja = hojaDeGasto(l.state);
    const next = setLeafAmount(l.state, hoja, INICIO, "budget", 123_000, [INICIO, AHORA]);
    expect((await saveLedger(A, next, l.revision)).ok).toBe(true); // nada congelado
  });
});

// ══ NFR-2008 · la migración ═════════════════════════════════════════════════════════════════════
describe("NFR-2008 · la migración 0004", () => {
  it("TC-CDM-270h: las columnas, los CHECKs, la tabla del rastro y su índice existen", async () => {
    // @aitri-tc TC-CDM-270h
    const db = testDb();
    const cols = await db.execute(sql`SELECT column_name, is_nullable FROM information_schema.columns
                                      WHERE table_name = 'ledger'
                                        AND column_name IN ('closed_through','reopened_period')`);
    expect([...cols]).toHaveLength(2);
    for (const r of [...cols] as { is_nullable: string }[]) expect(r.is_nullable).toBe("YES");

    const cks = await db.execute(sql`SELECT conname FROM pg_constraint
                                     WHERE conname IN ('ledger_closed_through_ck','ledger_reopened_period_ck',
                                                       'ledger_reopened_needs_boundary_ck',
                                                       'closure_event_action_ck','closure_event_period_ck')`);
    expect([...cks]).toHaveLength(5);

    const idx = await db.execute(sql`SELECT indexname FROM pg_indexes
                                     WHERE indexname = 'closure_event_owner_at_idx'`);
    expect([...idx]).toHaveLength(1);
  });

  it("TC-CDM-271f: el CHECK de la frontera rechaza un periodo inválido escrito a mano", async () => {
    // @aitri-tc TC-CDM-271f
    await sembrar();
    for (const malo of ["2026-13", "26-08", "2026-00", "marzo"]) {
      await expect(
        testDb().execute(sql`UPDATE ledger SET closed_through = ${malo} WHERE owner_id = ${A}`)
      ).rejects.toThrow();
    }
    expect((await loadLedger(A))!.state.closure!.closedThrough).toBeNull();
  });

  it("TC-CDM-272e: no se puede marcar un mes reabierto sin frontera", async () => {
    // @aitri-tc TC-CDM-272e
    await sembrar();
    await expect(
      testDb().execute(sql`UPDATE ledger SET reopened_period = '2026-08', closed_through = NULL
                           WHERE owner_id = ${A}`)
    ).rejects.toThrow();
  });
});
