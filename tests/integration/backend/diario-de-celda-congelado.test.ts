/**
 * Feature diario-de-celda — EP-04: un mes CERRADO congela también las vías nuevas, por su puerta real.
 * TCs: FR-2507 (135f, 136f) · NFR-2507 (381h, 382e, 383f).
 *
 * EP-03 ya probó que el dominio rechaza escribir en un mes cerrado. Lo que falta —y es un fallo
 * distinto— es que ninguna de las puertas HTTP deje pasar por un camino lateral. Los dos casos que
 * más fácilmente se escapan son los que NO tocan una cifra: cambiar solo la NOTA o solo la FECHA
 * dentro del mismo mes. Un guardia que compare únicamente importes los deja entrar, el mes cerrado
 * cambia bajo los pies del usuario y ninguna cifra lo delata. Por eso van aquí, uno por vía.
 *
 * Todo pasa por los handlers en proceso y con sesión real: el borde es parte de lo que se prueba.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { buildSeed, isLeaf } from "@/domain";
import { PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as closurePOST, DELETE as closureDELETE } from "@/app/api/v1/closure/route";
import { PATCH as movPATCH, DELETE as movDELETE } from "@/app/api/v1/movements/[id]/route";
import type { LedgerState, Movement, PeriodKey } from "@/domain/types";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
/** El ledger arranca en agosto; con «hoy» en septiembre, agosto es el mes que toca cerrar. */
const AGO: PeriodKey = "2026-08";
const HOY = "2026-09-10";

let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor((++ipCounter) / 250)}.${ipCounter % 250}`;

async function newUser(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { cookie, userId };
}

function req(url: string, init: { method?: string; cookie?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
/** El segundo argumento que Next pasa a una ruta dinámica. */
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene hoja de gasto");
  return h.id;
}
function otraHojaDeGasto(s: LedgerState, distintaDe: string): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes) && n.id !== distintaDe);
  if (!h) throw new Error("la semilla no tiene una segunda hoja de gasto");
  return h.id;
}

/**
 * Siembra agosto CUADRADO: 7.000 en la celda, respaldados por el movimiento K «Pan».
 *
 * Cuadrada porque el servidor rechaza una escritura que descuadre (NFR-2502): una siembra con
 * Ejecutado sin movimientos ni siquiera entraría por esta vía. La que debe nacer descuadrada
 * (TC-DDC-383f) se siembra por SQL directo, más abajo.
 */
async function sembrarAgosto(userId: string): Promise<{ hoja: string; state: LedgerState; revision: number }> {
  const seed = buildSeed(userId, AGO);
  const hoja = hojaDeGasto(seed);
  const k: Movement = {
    id: `K-${userId}`, ownerId: userId, type: "expense", catId: hoja, subId: null, target: hoja,
    amount: 7_000, period: AGO, createdAt: 1, date: `${AGO}-10T12:00`, note: "Pan",
  };
  const r = await saveLedger(userId, { ...seed, actuals: { [hoja]: { [AGO]: 7_000 } }, movements: [k] }, 0);
  if (!r.ok) throw new Error(`no se pudo sembrar: ${JSON.stringify(r)}`);
  const l = (await loadLedger(userId))!;
  return { hoja, state: l.state, revision: l.revision };
}

/** Cierra agosto por la puerta real y devuelve la revisión resultante. */
async function cerrarAgosto(cookie: string, baseRevision: number): Promise<number> {
  const res = await closurePOST(req("/api/v1/closure", { method: "POST", cookie, body: { baseRevision } }));
  const cuerpo = await res.json();
  expect(res.status, JSON.stringify(cuerpo)).toBe(200);
  return cuerpo.revision as number;
}

/** El movimiento K tal y como está EN LA BASE, no en la respuesta de nadie. */
async function kEnBd(userId: string, id: string): Promise<Movement | undefined> {
  return (await loadLedger(userId))!.state.movements.find((m) => m.id === id);
}
async function numeroDeMovimientos(userId: string): Promise<number> {
  const r = await testDb().execute(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${userId}`);
  return ([...r][0] as { n: number }).n;
}
async function celda(userId: string, nodeId: string, period: PeriodKey): Promise<number | null> {
  const r = await testDb().execute(
    sql`SELECT amount FROM amount_cell WHERE owner_id = ${userId} AND node_id = ${nodeId}
        AND period = ${period} AND kind = 'actual'`
  );
  const fila = [...r][0] as { amount: string | number } | undefined;
  return fila === undefined ? null : Number(fila.amount);
}

/** Un PUT del ledger completo, con el estado ya modificado por el caso. */
const putLedger = (cookie: string, baseRevision: number, state: LedgerState) =>
  ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, body: { baseRevision, state } }));

/** Afirma 422 con el código dado y devuelve el cuerpo, para que el caso siga afirmando sobre él. */
async function esperar422(res: Response, code: string): Promise<{ error: { code: string; detail?: unknown } }> {
  const cuerpo = await res.json();
  expect(res.status, JSON.stringify(cuerpo)).toBe(422);
  expect(cuerpo.error.code).toBe(code);
  return cuerpo;
}

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = HOY;
});
afterEach(() => { delete process.env.LEDGER_TODAY; });
afterAll(async () => { await closeTestDb(); });

describe("FR-2507 — un periodo cerrado congela las vías nuevas, también las que no tocan cifras", () => {
  /** @aitri-trace FR-ID: FR-2507, US-ID: US-2507, AC-ID: AC-2507a, TC-ID: TC-DDC-135f */
  it("TC-DDC-135f: un PATCH que SOLO cambia la nota de un movimiento de un mes cerrado se rechaza", async () => {
    // @aitri-tc TC-DDC-135f
    const a = await newUser("congelado-nota@example.com");
    const { state } = await sembrarAgosto(a.userId);
    const k = state.movements[0].id;
    const revision = await cerrarAgosto(a.cookie, (await loadLedger(a.userId))!.revision);

    // Ni una cifra cambia en esta petición: es exactamente el caso que un guardia por importes deja pasar.
    const res = await movPATCH(
      req(`/api/v1/movements/${k}`, { method: "PATCH", cookie: a.cookie, body: { note: "Pan integral" } }), ctx(k)
    );
    const cuerpo = await esperar422(res, "closed_period_violation");
    expect((cuerpo.error.detail as { periods: string[] }).periods).toContain(AGO);

    // La nota sigue siendo la de antes EN LA BASE, y la revisión no se movió.
    expect((await kEnBd(a.userId, k))!.note).toBe("Pan");
    expect((await loadLedger(a.userId))!.revision).toBe(revision);
  });

  /** @aitri-trace FR-ID: FR-2505, US-ID: US-2505, AC-ID: AC-2505e, TC-ID: TC-DDC-127f */
  it("TC-DDC-127f: en un mes cerrado, editar el monto a 0 se rechaza — el cierre gana sobre el borrado", async () => {
    // @aitri-tc TC-DDC-127f
    // Desde FR-2505 el 0 ELIMINA, y eso lo convierte en una vía de borrado más. El cierre tiene que
    // ganarle igual que le gana a la papelera: si no, quedaría una puerta trasera para vaciar un mes
    // cerrado escribiendo un cero en vez de pulsar un icono.
    const a = await newUser("congelado-cero@example.com");
    const { state } = await sembrarAgosto(a.userId);
    const k = state.movements[0].id;
    const revision = await cerrarAgosto(a.cookie, (await loadLedger(a.userId))!.revision);
    const movimientosAntes = await numeroDeMovimientos(a.userId);

    const cuerpo = await esperar422(
      await movPATCH(req(`/api/v1/movements/${k}`, { method: "PATCH", cookie: a.cookie, body: { amount: 0 } }), ctx(k)),
      "closed_period_violation"
    );
    expect((cuerpo.error.detail as { periods: string[] }).periods).toContain(AGO);

    // El movimiento sigue ahí, entero, y nada se escribió.
    const kFinal = (await kEnBd(a.userId, k))!;
    expect(kFinal.amount).toBe(7_000);
    expect(await numeroDeMovimientos(a.userId)).toBe(movimientosAntes);
    expect((await loadLedger(a.userId))!.revision).toBe(revision);
  });

  /** @aitri-trace FR-ID: FR-2507, US-ID: US-2507, AC-ID: AC-2507a, TC-ID: TC-DDC-136f */
  it("TC-DDC-136f: los tres PUT sobre un mes cerrado —nota, fecha y ajuste nuevo— se rechazan", async () => {
    // @aitri-tc TC-DDC-136f
    const a = await newUser("congelado-put@example.com");
    const { hoja, state } = await sembrarAgosto(a.userId);
    const k = state.movements[0].id;
    const revision = await cerrarAgosto(a.cookie, (await loadLedger(a.userId))!.revision);
    const base = (await loadLedger(a.userId))!.state;
    const movimientosAntes = await numeroDeMovimientos(a.userId);

    const conMovimientos = (movements: Movement[], actuals = base.actuals): LedgerState =>
      ({ ...base, movements, actuals });
    const otro = (cambio: Partial<Movement>): Movement[] =>
      base.movements.map((m) => (m.id === k ? { ...m, ...cambio } : m));

    // (a) solo la nota. (b) solo la fecha, DENTRO del mismo mes —así ni el periodo del movimiento
    // cambia: si el guardia mirase únicamente `period`, este pasaría—. (c) un ajuste nuevo, que sí
    // mueve la cifra de la celda.
    const ajuste: Movement = {
      id: `adj-${a.userId}`, ownerId: a.userId, type: "expense", catId: hoja, subId: null, target: hoja,
      amount: 500, period: AGO, createdAt: 2, date: `${AGO}-12T12:00`, note: "Ajuste manual",
      kind: "adjustment",
    };
    const casos: [string, LedgerState][] = [
      ["nota", conMovimientos(otro({ note: "Pan integral" }))],
      ["fecha", conMovimientos(otro({ date: `${AGO}-11T12:00` }))],
      ["ajuste", conMovimientos([...base.movements, ajuste], { ...base.actuals, [hoja]: { ...base.actuals[hoja], [AGO]: 7_500 } })],
    ];
    for (const [nombre, estado] of casos) {
      const cuerpo = await esperar422(await putLedger(a.cookie, revision, estado), "closed_period_violation");
      expect((cuerpo.error.detail as { periods: string[] }).periods, nombre).toContain(AGO);
    }

    // Y NADA se escribió: ni el movimiento, ni el número de filas, ni la revisión.
    const kFinal = (await kEnBd(a.userId, k))!;
    expect(kFinal.note).toBe("Pan");
    expect(kFinal.date).toBe(`${AGO}-10T12:00`);
    expect(kFinal.amount).toBe(7_000);
    expect(await numeroDeMovimientos(a.userId)).toBe(movimientosAntes);
    expect((await loadLedger(a.userId))!.revision).toBe(revision);
  });
});

describe("NFR-2507 — el cierre de mes sigue íntegro con las vías que estrena la feature", () => {
  /** @aitri-trace FR-ID: NFR-2507, US-ID: US-2507, AC-ID: AC-2507a, TC-ID: TC-DDC-381h */
  it("TC-DDC-381h: cerrar agosto congela sus cifras ante PATCH, DELETE y PUT", async () => {
    // @aitri-tc TC-DDC-381h
    const a = await newUser("congelado-tres@example.com");
    const { hoja, state } = await sembrarAgosto(a.userId);
    const k = state.movements[0].id;

    // El cierre entra por su puerta y responde 200: si esto fallara, lo de abajo no probaría nada.
    const revision = await cerrarAgosto(a.cookie, (await loadLedger(a.userId))!.revision);
    const celdaAntes = await celda(a.userId, hoja, AGO);
    expect(celdaAntes).toBe(7_000);

    // Las tres vías de escritura de la feature, cada una por su ruta.
    await esperar422(
      await movPATCH(req(`/api/v1/movements/${k}`, { method: "PATCH", cookie: a.cookie, body: { amount: 1 } }), ctx(k)),
      "closed_period_violation"
    );
    await esperar422(
      await movDELETE(req(`/api/v1/movements/${k}`, { method: "DELETE", cookie: a.cookie }), ctx(k)),
      "closed_period_violation"
    );
    const base = (await loadLedger(a.userId))!.state;
    const ajuste: Movement = {
      id: `adj-${a.userId}`, ownerId: a.userId, type: "expense", catId: hoja, subId: null, target: hoja,
      amount: 500, period: AGO, createdAt: 2, date: `${AGO}-12T12:00`, note: "Ajuste manual",
      kind: "adjustment",
    };
    await esperar422(
      await putLedger(a.cookie, revision, {
        ...base,
        movements: [...base.movements, ajuste],
        actuals: { ...base.actuals, [hoja]: { ...base.actuals[hoja], [AGO]: 7_500 } },
      }),
      "closed_period_violation"
    );

    // Las cifras de agosto están donde estaban: el movimiento intacto y la celda sin mover.
    expect((await kEnBd(a.userId, k))!.amount).toBe(7_000);
    expect(await celda(a.userId, hoja, AGO)).toBe(celdaAntes);
    expect((await loadLedger(a.userId))!.revision).toBe(revision);
  });

  /** @aitri-trace FR-ID: NFR-2507, US-ID: US-2507, AC-ID: AC-2507a, TC-ID: TC-DDC-382e */
  it("TC-DDC-382e: reabrir el último mes cerrado sigue dejando rastro", async () => {
    // @aitri-tc TC-DDC-382e
    const a = await newUser("congelado-reabrir@example.com");
    await sembrarAgosto(a.userId);
    const revision = await cerrarAgosto(a.cookie, (await loadLedger(a.userId))!.revision);

    const rastroAntes = await testDb().execute(
      sql`SELECT count(*)::int AS n FROM closure_event WHERE owner_id = ${a.userId} AND action = 'reopen'`
    );
    expect(([...rastroAntes][0] as { n: number }).n).toBe(0);

    const res = await closureDELETE(
      req("/api/v1/closure", { method: "DELETE", cookie: a.cookie, body: { baseRevision: revision } })
    );
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);

    // El rastro gana UNA fila, con la acción de reapertura y el periodo que se reabrió.
    const rastro = await testDb().execute(
      sql`SELECT action, period FROM closure_event WHERE owner_id = ${a.userId} AND action = 'reopen'`
    );
    const filas = [...rastro] as { action: string; period: string }[];
    expect(filas).toHaveLength(1);
    expect(filas[0].period).toBe(AGO);
  });

  /** @aitri-trace FR-ID: NFR-2507, US-ID: US-2507, AC-ID: AC-2507a, TC-ID: TC-DDC-383f */
  it("TC-DDC-383f: una siembra con Ejecutado sin movimientos no se puede cerrar; la misma cuadrada sí", async () => {
    // @aitri-tc TC-DDC-383f
    // Esta es LA REGLA que obligó a revisar los fixtures de `cierre-de-mes` (NFR-2507): un escenario
    // que ponía cifras de Ejecutado a mano ya no es cerrable. Se ajusta el fixture —se le añaden sus
    // movimientos— y nunca el resultado esperado. Aquí se fija esa frontera con las dos mitades.
    const a = await newUser("siembra-descuadrada@example.com");
    const b = await newUser("siembra-cuadrada@example.com");

    // A: agosto con una celda de 30.000 y CERO movimientos. Tiene que entrar por SQL directo, porque
    // el propio servidor rechaza una escritura que descuadre (mismo precedente que e2e/helpers/descuadre.ts).
    const { hoja: hojaA, state: stateA } = await sembrarAgosto(a.userId);
    const restaurantes = otraHojaDeGasto(stateA, hojaA);
    await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                               VALUES (${a.userId}, ${restaurantes}, ${AGO}, 'actual', 30000)
                               ON CONFLICT (owner_id, node_id, period, kind) DO UPDATE SET amount = 30000`);

    const resA = await closurePOST(
      req("/api/v1/closure", { method: "POST", cookie: a.cookie, body: { baseRevision: (await loadLedger(a.userId))!.revision } })
    );
    const cuerpoA = await esperar422(resA, "unbalanced_cells");
    const detalle = cuerpoA.error.detail as { period: string; cells: { nodeId: string; name: string }[] };
    expect(detalle.period).toBe(AGO);
    // NOMBRADA: el rechazo dice cuál celda, no solo que algo falla.
    expect(detalle.cells.map((c) => c.nodeId)).toEqual([restaurantes]);
    expect(detalle.cells[0].name).toBeTruthy();
    // Y agosto sigue abierto.
    const frontera = await testDb().execute(sql`SELECT closed_through FROM ledger WHERE owner_id = ${a.userId}`);
    expect(([...frontera][0] as { closed_through: string | null }).closed_through).toBeNull();

    // B: la MISMA cifra, esta vez respaldada por su movimiento. Cierra.
    const { hoja: hojaB, state: stateB } = await sembrarAgosto(b.userId);
    const restaurantesB = otraHojaDeGasto(stateB, hojaB);
    const baseB = (await loadLedger(b.userId))!;
    const mvB: Movement = {
      id: `rest-${b.userId}`, ownerId: b.userId, type: "expense", catId: restaurantesB, subId: null,
      target: restaurantesB, amount: 30_000, period: AGO, createdAt: 3, date: `${AGO}-15T12:00`, note: "Cena",
    };
    const guardado = await saveLedger(b.userId, {
      ...baseB.state,
      movements: [...baseB.state.movements, mvB],
      actuals: { ...baseB.state.actuals, [restaurantesB]: { ...(baseB.state.actuals[restaurantesB] ?? {}), [AGO]: 30_000 } },
    }, baseB.revision);
    expect(guardado.ok, JSON.stringify(guardado)).toBe(true);

    const resB = await closurePOST(
      req("/api/v1/closure", { method: "POST", cookie: b.cookie, body: { baseRevision: (await loadLedger(b.userId))!.revision } })
    );
    expect(resB.status, JSON.stringify(await resB.clone().json())).toBe(200);
    const fronteraB = await testDb().execute(sql`SELECT closed_through FROM ledger WHERE owner_id = ${b.userId}`);
    expect(([...fronteraB][0] as { closed_through: string | null }).closed_through).toBe(AGO);
  });
});
