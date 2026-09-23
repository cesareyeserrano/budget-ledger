/**
 * Feature cierre-coherente — EP-01: el mes que el botón NOMBRA es el que el servidor CIERRA.
 * TCs: FR-2701 (001h, 002e, 003e, 004f, 005f) · FR-2702 (020h, 021h, 022e, 023f) ·
 *      FR-2703 (040h, 041e, 042f) · NFR-2701 (060h, 061e, 062f) · NFR-2702 (070h, 071e, 072f) ·
 *      NFR-2703 (080h, 081e, 082f) · NFR-2704 (090h, 091e, 092f) · NFR-2705 (100h, 101e, 102f) ·
 *      NFR-2706 (110f, 111h, 112e).
 *
 * Los casos de rango (001h..005f, 040h..042f, 061e) son PUROS y podrían vivir en tests/domain, pero
 * `closureScope` está en `ledgerRepo`, que importa `server-only` y el cliente de la base: solo el proyecto
 * `backend` de vitest resuelve esos imports. Por eso viven aquí, con su tipo real en 03_TEST_CASES.json.
 *
 * Los de cierre leen `closed_through` EN LA BASE y no en la respuesta de la ruta: el riesgo alto del TRD es
 * que el arreglo quede INERTE por no llevar `start_month` al estado del cierre, y ese fallo dejaría verde
 * cualquier test que se conforme con el dominio.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { closureScope, serverScope, loadLedger, saveLedger, saveStartFor } from "@/server/data/ledgerRepo";
import { activeBounds } from "@/domain/range";
import { periodRange } from "@/domain/periods";
import { nextClosable } from "@/domain/closure";
import { buildSeed, isLeaf } from "@/domain";
import { PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as closurePOST, DELETE as closureDELETE } from "@/app/api/v1/closure/route";
import { PATCH as movPATCH, DELETE as movDELETE } from "@/app/api/v1/movements/[id]/route";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
const JUL: PeriodKey = "2026-07";
const AGO: PeriodKey = "2026-08";
const SEP: PeriodKey = "2026-09";
const HOY = "2026-10-05";

let ipCounter = 0;
const nextIp = () => `10.13.${Math.floor((++ipCounter) / 250)}.${ipCounter % 250}`;

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
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// ── Estados en memoria para los casos de rango ───────────────────────────────────────────────────

const NODES: LedgerNode[] = [
  { id: "g", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 0 },
  { id: "c", ownerId: "local", type: "expense", level: "category", parentId: "g", name: "Mercado", icon: null, order: 0 },
];

/** Un estado con el mes de inicio declarado y un movimiento en el periodo dado. */
function estado(startMonth: string | null, periodoConDato: PeriodKey | null): LedgerState {
  const movimientos: Movement[] = periodoConDato
    ? [{ id: "m", ownerId: "local", type: "expense", catId: "c", subId: null, target: "c", amount: 7_000,
         period: periodoConDato, createdAt: 1, date: `${periodoConDato}-10T12:00` }]
    : [];
  return {
    ownerId: "local", nodes: NODES, budgets: {},
    actuals: periodoConDato ? { c: { [periodoConDato]: 7_000 } } : {},
    movements: movimientos,
    ...(startMonth !== null ? { startMonth } : {}),
  } as unknown as LedgerState;
}

/** El mes que propondría el BOTÓN (cliente) y el que decidiría el SERVIDOR, sobre el mismo estado. */
function mesesPropuestos(state: LedgerState, hoy: PeriodKey): { cliente: PeriodKey | null; servidor: PeriodKey | null } {
  const b = activeBounds(state, hoy);
  const rangoCliente = b ? periodRange(b.from, b.to) : [];
  return {
    cliente: nextClosable(state, hoy, rangoCliente),
    servidor: nextClosable(state, hoy, closureScope(state, hoy)),
  };
}

// ── Helpers de base ──────────────────────────────────────────────────────────────────────────────

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene hoja de gasto");
  return h.id;
}

/**
 * Siembra una cuenta con su mes de inicio DECLARADO por la vía real (`saveStartFor`) y, si se pide, una
 * celda cuadrada en `periodoConDato` (el servidor rechaza una escritura que descuadre, NFR-2502).
 */
async function sembrar(
  userId: string, startMonth: PeriodKey, periodoConDato: PeriodKey | null
): Promise<{ hoja: string; revision: number }> {
  const seed = buildSeed(userId, periodoConDato ?? startMonth);
  const hoja = hojaDeGasto(seed);
  const movimientos: Movement[] = periodoConDato
    ? [{ id: `m-${userId}`, ownerId: userId, type: "expense", catId: hoja, subId: null, target: hoja,
         amount: 7_000, period: periodoConDato, createdAt: 1, date: `${periodoConDato}-10T12:00`, note: "Pan" }]
    : [];
  const r = await saveLedger(userId, {
    ...seed,
    actuals: periodoConDato ? { [hoja]: { [periodoConDato]: 7_000 } } : {},
    movements: movimientos,
  }, 0);
  if (!r.ok) throw new Error(`no se pudo sembrar: ${JSON.stringify(r)}`);
  const start = await saveStartFor(userId, (await loadLedger(userId))!.revision, startMonth, null);
  if (!("ok" in start) || !start.ok) throw new Error(`no se pudo declarar el inicio: ${JSON.stringify(start)}`);
  return { hoja, revision: (await loadLedger(userId))!.revision };
}

const cerrar = (cookie: string, baseRevision: number) =>
  closurePOST(req("/api/v1/closure", { method: "POST", cookie, body: { baseRevision } }));
const reabrir = (cookie: string, baseRevision: number) =>
  closureDELETE(req("/api/v1/closure", { method: "DELETE", cookie, body: { baseRevision } }));
const putLedger = (cookie: string, baseRevision: number, state: LedgerState) =>
  ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, body: { baseRevision, state } }));

/** `closed_through` y `reopened_period` tal y como están EN LA BASE. */
async function cierreEnBd(userId: string): Promise<{ closed: string | null; reopened: string | null }> {
  const r = await testDb().execute(
    sql`SELECT closed_through, reopened_period FROM ledger WHERE owner_id = ${userId}`);
  const fila = [...r][0] as { closed_through: string | null; reopened_period: string | null };
  return { closed: fila.closed_through, reopened: fila.reopened_period };
}
async function revisionDe(userId: string): Promise<number> {
  return (await loadLedger(userId))!.revision;
}
/** Cierra `n` veces seguidas, encadenando revisiones, y devuelve el closed_through tras cada una. */
async function cerrarVeces(cookie: string, userId: string, n: number): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (let i = 0; i < n; i += 1) {
    const res = await cerrar(cookie, await revisionDe(userId));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    out.push((await cierreEnBd(userId)).closed);
  }
  return out;
}

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = HOY;
});
afterAll(async () => {
  delete process.env.LEDGER_TODAY;
  await closeTestDb();
});

describe("FR-2701 — el rango del cierre ancla en el mes de inicio declarado", () => {
  /** @aitri-trace FR-ID: FR-2701, US-ID: US-2701, AC-ID: AC-2701a, TC-ID: TC-CCO-001h */
  it("TC-CCO-001h: closureScope ancla en el mes de inicio declarado", () => {
    // @aitri-tc TC-CCO-001h
    const rango = closureScope(estado(JUL, SEP), "2026-10");
    expect(rango[0]).toBe(JUL);
    expect(rango).toContain(AGO);
    expect(rango).toContain(SEP);
    // Continuo, sin huecos, hasta el mes en curso.
    expect(rango.slice(0, 4)).toEqual([JUL, AGO, SEP, "2026-10"]);
  });

  /** @aitri-trace FR-ID: FR-2701, US-ID: US-2701, AC-ID: AC-2701b, TC-ID: TC-CCO-002e */
  it("TC-CCO-002e: inicio declarado igual al primer dato — el rango no cambia", () => {
    // @aitri-tc TC-CCO-002e
    const s = estado(SEP, SEP);
    expect(closureScope(s, "2026-10")).toEqual(serverScope(s, "2026-10"));
    expect(closureScope(s, "2026-10")[0]).toBe(SEP);
  });

  /** @aitri-trace FR-ID: FR-2701, US-ID: US-2701, AC-ID: AC-2701a, TC-ID: TC-CCO-003e */
  it("TC-CCO-003e: un dato anterior al inicio declarado extiende el rango hacia atrás", () => {
    // @aitri-tc TC-CCO-003e
    expect(closureScope(estado(JUL, "2026-05"), "2026-10")[0]).toBe("2026-05");
  });

  /** @aitri-trace FR-ID: FR-2701, US-ID: US-2701, AC-ID: AC-2701c, TC-ID: TC-CCO-004f */
  it("TC-CCO-004f: sin inicio declarado, o con uno inválido, no se inventa ningún mes", () => {
    // @aitri-tc TC-CCO-004f
    for (const malo of [null, "2026-13"]) {
      const s = estado(malo, SEP);
      expect(closureScope(s, "2026-10"), `startMonth=${malo}`).toEqual(serverScope(s, "2026-10"));
      expect(closureScope(s, "2026-10")[0]).toBe(SEP);
    }
  });

  /** @aitri-trace FR-ID: FR-2701, US-ID: US-2701, AC-ID: AC-2701b, TC-ID: TC-CCO-005f */
  it("TC-CCO-005f: serverScope NO cambia — las escrituras siguen juzgando el mismo rango", () => {
    // @aitri-tc TC-CCO-005f
    const rango = serverScope(estado(JUL, SEP), "2026-10");
    expect(rango[0]).toBe(SEP);
    expect(rango).not.toContain(JUL);
    expect(rango).not.toContain(AGO);
  });
});

describe("FR-2702 — cerrar avanza mes a mes desde el inicio declarado", () => {
  /** @aitri-trace FR-ID: FR-2702, US-ID: US-2702, AC-ID: AC-2702a, TC-ID: TC-CCO-020h */
  it("TC-CCO-020h: la primera petición cierra el mes de inicio, y solo ese", async () => {
    // @aitri-tc TC-CCO-020h
    const a = await newUser("cco-primero@example.com");
    const { hoja } = await sembrar(a.userId, JUL, SEP);

    const res = await cerrar(a.cookie, await revisionDe(a.userId));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect((await cierreEnBd(a.userId)).closed).toBe(JUL);

    // Agosto sigue ABIERTO: se puede escribir en él.
    const l = (await loadLedger(a.userId))!;
    const conAgosto: LedgerState = { ...l.state, budgets: { ...l.state.budgets, [hoja]: { [AGO]: 5_000 } } };
    const put = await putLedger(a.cookie, l.revision, conAgosto);
    expect(put.status, JSON.stringify(await put.clone().json())).toBe(200);
  });

  /** @aitri-trace FR-ID: FR-2702, US-ID: US-2702, AC-ID: AC-2702b, TC-ID: TC-CCO-021h */
  it("TC-CCO-021h: tres peticiones cierran julio, agosto y septiembre en ese orden", async () => {
    // @aitri-tc TC-CCO-021h
    const a = await newUser("cco-tres@example.com");
    await sembrar(a.userId, JUL, SEP);
    expect(await cerrarVeces(a.cookie, a.userId, 3)).toEqual([JUL, AGO, SEP]);
  });

  /** @aitri-trace FR-ID: FR-2702, US-ID: US-2702, AC-ID: AC-2702c, TC-ID: TC-CCO-022e */
  it("TC-CCO-022e: un mes vacío anterior al primer dato se cierra igual", async () => {
    // @aitri-tc TC-CCO-022e
    const a = await newUser("cco-vacio@example.com");
    await sembrar(a.userId, JUL, SEP);
    const vacio = [...(await testDb().execute(sql`
      SELECT (SELECT count(*)::int FROM amount_cell WHERE owner_id = ${a.userId} AND period = ${JUL}) AS celdas,
             (SELECT count(*)::int FROM movement   WHERE owner_id = ${a.userId} AND period = ${JUL}) AS movs`))][0] as
      { celdas: number; movs: number };
    expect(vacio).toEqual({ celdas: 0, movs: 0 });

    expect((await cerrar(a.cookie, await revisionDe(a.userId))).status).toBe(200);
    expect((await cierreEnBd(a.userId)).closed).toBe(JUL);
  });

  /** @aitri-trace FR-ID: FR-2702, US-ID: US-2702, AC-ID: AC-2702a, TC-ID: TC-CCO-023f */
  it("TC-CCO-023f: un mes objetivo posterior al mes en curso se rechaza", async () => {
    // @aitri-tc TC-CCO-023f
    const a = await newUser("cco-futuro@example.com");
    await sembrar(a.userId, "2026-11", null);
    const revision = await revisionDe(a.userId);

    const res = await cerrar(a.cookie, revision);
    const cuerpo = await res.json();
    expect(res.status, JSON.stringify(cuerpo)).toBe(422);
    expect(cuerpo.error.code).toBe("not_closable");
    expect((await cierreEnBd(a.userId)).closed).toBeNull();
    expect(await revisionDe(a.userId)).toBe(revision);
  });
});

describe("FR-2703 — el mes que el botón nombra es el que el servidor cierra", () => {
  /** @aitri-trace FR-ID: FR-2703, US-ID: US-2703, AC-ID: AC-2703a, TC-ID: TC-CCO-040h */
  it("TC-CCO-040h: cliente y servidor proponen el mismo mes", () => {
    // @aitri-tc TC-CCO-040h
    const { cliente, servidor } = mesesPropuestos(estado(JUL, SEP), "2026-10");
    expect(cliente).toBe(JUL);
    expect(servidor).toBe(JUL);
  });

  /** @aitri-trace FR-ID: FR-2703, US-ID: US-2703, AC-ID: AC-2703a, TC-ID: TC-CCO-041e */
  it("TC-CCO-041e: tras cada cierre las dos capas coinciden en el siguiente mes", () => {
    // @aitri-tc TC-CCO-041e
    const base = estado(JUL, SEP);
    const conCierre = (closedThrough: PeriodKey): LedgerState =>
      ({ ...base, closure: { closedThrough, reopened: null } }) as unknown as LedgerState;

    const trasJulio = mesesPropuestos(conCierre(JUL), "2026-10");
    expect([trasJulio.cliente, trasJulio.servidor]).toEqual([AGO, AGO]);
    const trasAgosto = mesesPropuestos(conCierre(AGO), "2026-10");
    expect([trasAgosto.cliente, trasAgosto.servidor]).toEqual([SEP, SEP]);
  });

  /** @aitri-trace FR-ID: FR-2703, US-ID: US-2703, AC-ID: AC-2703a, TC-ID: TC-CCO-042f */
  it("TC-CCO-042f: ninguna combinación de inicio y primer dato los hace diferir", () => {
    // @aitri-tc TC-CCO-042f
    const combinaciones: [string | null, PeriodKey | null][] = [
      [JUL, SEP], [SEP, SEP], [JUL, "2026-05"], [null, SEP], ["2026-01", "2026-12"], [SEP, null],
    ];
    for (const [inicio, dato] of combinaciones) {
      const { cliente, servidor } = mesesPropuestos(estado(inicio, dato), "2027-01");
      expect(servidor, `inicio=${inicio} dato=${dato} → botón ${cliente} vs servidor ${servidor}`).toBe(cliente);
    }
  });
});

describe("NFR-2701 — la cuenta real no cambia", () => {
  /** @aitri-trace FR-ID: NFR-2701, US-ID: US-2701, AC-ID: AC-2701b, TC-ID: TC-CCO-060h */
  it("TC-CCO-060h: con inicio igual al primer dato, el cierre da el mismo mes que antes", async () => {
    // @aitri-tc TC-CCO-060h
    const a = await newUser("cco-real@example.com");
    await sembrar(a.userId, SEP, SEP);

    expect((await cerrar(a.cookie, await revisionDe(a.userId))).status).toBe(200);
    expect((await cierreEnBd(a.userId)).closed).toBe(SEP);
  });

  /** @aitri-trace FR-ID: NFR-2701, US-ID: US-2701, AC-ID: AC-2701b, TC-ID: TC-CCO-061e */
  it("TC-CCO-061e: con inicio igual al primer dato los dos rangos son idénticos", () => {
    // @aitri-tc TC-CCO-061e
    const s = estado(SEP, SEP);
    const a = closureScope(s, "2026-10");
    const b = serverScope(s, "2026-10");
    expect(a).toEqual(b);
    expect(a).toHaveLength(b.length);
    expect([a[0], a[a.length - 1]]).toEqual([b[0], b[b.length - 1]]);
  });

  /** @aitri-trace FR-ID: NFR-2701, US-ID: US-2701, AC-ID: AC-2701b, TC-ID: TC-CCO-062f */
  it("TC-CCO-062f: no se cierra ningún mes de más en la cuenta real", async () => {
    // @aitri-tc TC-CCO-062f
    const a = await newUser("cco-nada-de-mas@example.com");
    const { hoja } = await sembrar(a.userId, SEP, SEP);
    expect((await cerrar(a.cookie, await revisionDe(a.userId))).status).toBe(200);
    expect((await cierreEnBd(a.userId)).closed).toBe(SEP);

    // La frontera NO se adelantó: cerró un solo mes.
    expect((await cierreEnBd(a.userId)).closed).not.toBe(JUL);
    expect((await cierreEnBd(a.userId)).closed).not.toBe(AGO);

    // Agosto sí queda congelado, como SIEMPRE: cerrar un mes congela los anteriores (isClosed). Lo que
    // este caso protege es que la frontera no se haya adelantado, no que agosto siguiera escribible.
    const l = (await loadLedger(a.userId))!;
    const conAgosto: LedgerState = { ...l.state, budgets: { ...l.state.budgets, [hoja]: { [AGO]: 5_000 } } };
    const put = await putLedger(a.cookie, l.revision, conAgosto);
    const cuerpo = await put.json();
    expect(put.status, JSON.stringify(cuerpo)).toBe(422);
    expect(cuerpo.error.code).toBe("closed_period_violation");
  });
});

describe("NFR-2702 — el cierre sigue en orden y sin futuro", () => {
  /** @aitri-trace FR-ID: NFR-2702, US-ID: US-2702, AC-ID: AC-2702b, TC-ID: TC-CCO-070h */
  it("TC-CCO-070h: el cierre no se salta meses", async () => {
    // @aitri-tc TC-CCO-070h
    const a = await newUser("cco-orden@example.com");
    await sembrar(a.userId, JUL, SEP);
    expect(await cerrarVeces(a.cookie, a.userId, 1)).toEqual([JUL]);

    expect((await cerrar(a.cookie, await revisionDe(a.userId))).status).toBe(200);
    expect((await cierreEnBd(a.userId)).closed).toBe(AGO); // el inmediato, no el mes con datos
  });

  /** @aitri-trace FR-ID: NFR-2702, US-ID: US-2702, AC-ID: AC-2702a, TC-ID: TC-CCO-071e */
  it("TC-CCO-071e: no se cierra hacia el futuro", async () => {
    // @aitri-tc TC-CCO-071e
    const a = await newUser("cco-sin-futuro@example.com");
    await sembrar(a.userId, JUL, SEP);
    process.env.LEDGER_TODAY = "2026-08-05";
    expect(await cerrarVeces(a.cookie, a.userId, 2)).toEqual([JUL, AGO]);

    const res = await cerrar(a.cookie, await revisionDe(a.userId));
    const cuerpo = await res.json();
    expect(res.status, JSON.stringify(cuerpo)).toBe(422);
    expect(cuerpo.error.code).toBe("not_closable");
    expect((await cierreEnBd(a.userId)).closed).toBe(AGO);
    process.env.LEDGER_TODAY = HOY;
  });

  /** @aitri-trace FR-ID: NFR-2702, US-ID: US-2702, AC-ID: AC-2702a, TC-ID: TC-CCO-072f */
  it("TC-CCO-072f: una petición con una revisión vieja no avanza el cierre", async () => {
    // @aitri-tc TC-CCO-072f
    const a = await newUser("cco-revision@example.com");
    const { hoja } = await sembrar(a.userId, JUL, SEP);
    const vieja = await revisionDe(a.userId);

    // Otra escritura mueve la revisión.
    const l = (await loadLedger(a.userId))!;
    const otro: LedgerState = { ...l.state, budgets: { ...l.state.budgets, [hoja]: { [AGO]: 1_000 } } };
    expect((await putLedger(a.cookie, l.revision, otro)).status).toBe(200);

    const res = await cerrar(a.cookie, vieja);
    const cuerpo = await res.json();
    expect(res.status, JSON.stringify(cuerpo)).toBe(409);
    expect((await cierreEnBd(a.userId)).closed).toBeNull();
  });
});

describe("NFR-2703 — reabrir sigue alcanzando solo al último cerrado", () => {
  /** @aitri-trace FR-ID: NFR-2703, US-ID: US-2702, AC-ID: AC-2702b, TC-ID: TC-CCO-080h */
  it("TC-CCO-080h: reabrir devuelve el último mes cerrado", async () => {
    // @aitri-tc TC-CCO-080h
    const a = await newUser("cco-reabrir@example.com");
    await sembrar(a.userId, JUL, SEP);
    expect(await cerrarVeces(a.cookie, a.userId, 3)).toEqual([JUL, AGO, SEP]);

    const res = await reabrir(a.cookie, await revisionDe(a.userId));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await cierreEnBd(a.userId)).toEqual({ closed: AGO, reopened: SEP });
  });

  /** @aitri-trace FR-ID: NFR-2703, US-ID: US-2702, AC-ID: AC-2702b, TC-ID: TC-CCO-081e */
  it("TC-CCO-081e: no se encadenan dos reaperturas sin volver a cerrar", async () => {
    // @aitri-tc TC-CCO-081e
    const a = await newUser("cco-dos-reaperturas@example.com");
    await sembrar(a.userId, JUL, SEP);
    await cerrarVeces(a.cookie, a.userId, 3);
    expect((await reabrir(a.cookie, await revisionDe(a.userId))).status).toBe(200);
    const antes = await cierreEnBd(a.userId);

    const res = await reabrir(a.cookie, await revisionDe(a.userId));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(422);
    expect(await cierreEnBd(a.userId)).toEqual(antes);
  });

  /** @aitri-trace FR-ID: NFR-2703, US-ID: US-2702, AC-ID: AC-2702b, TC-ID: TC-CCO-082f */
  it("TC-CCO-082f: reabrir no alcanza un mes anterior al último cerrado", async () => {
    // @aitri-tc TC-CCO-082f
    const a = await newUser("cco-no-salta@example.com");
    const { hoja } = await sembrar(a.userId, JUL, SEP);
    await cerrarVeces(a.cookie, a.userId, 3);
    expect((await reabrir(a.cookie, await revisionDe(a.userId))).status).toBe(200);

    const estadoCierre = await cierreEnBd(a.userId);
    expect(estadoCierre.reopened).toBe(SEP);
    expect(estadoCierre.reopened).not.toBe(JUL);

    // Julio sigue congelado.
    const l = (await loadLedger(a.userId))!;
    const enJulio: LedgerState = { ...l.state, budgets: { ...l.state.budgets, [hoja]: { [JUL]: 3_000 } } };
    const put = await putLedger(a.cookie, l.revision, enJulio);
    const cuerpo = await put.json();
    expect(put.status, JSON.stringify(cuerpo)).toBe(422);
    expect(cuerpo.error.code).toBe("closed_period_violation");
  });
});

describe("NFR-2704 — un mes cerrado sigue congelado", () => {
  /** @aitri-trace FR-ID: NFR-2704, US-ID: US-2702, AC-ID: AC-2702a, TC-ID: TC-CCO-090h */
  it("TC-CCO-090h: un PUT sobre un mes cerrado responde closed_period_violation", async () => {
    // @aitri-tc TC-CCO-090h
    const a = await newUser("cco-congelado@example.com");
    const { hoja } = await sembrar(a.userId, SEP, SEP);
    await cerrarVeces(a.cookie, a.userId, 1);
    const revision = await revisionDe(a.userId);

    const l = (await loadLedger(a.userId))!;
    const cambiado: LedgerState = { ...l.state, budgets: { ...l.state.budgets, [hoja]: { [SEP]: 9_000 } } };
    const put = await putLedger(a.cookie, revision, cambiado);
    const cuerpo = await put.json();
    expect(put.status, JSON.stringify(cuerpo)).toBe(422);
    expect(cuerpo.error.code).toBe("closed_period_violation");
    expect(await revisionDe(a.userId)).toBe(revision);
  });

  /** @aitri-trace FR-ID: NFR-2704, US-ID: US-2702, AC-ID: AC-2702c, TC-ID: TC-CCO-091e */
  it("TC-CCO-091e: el mes VACÍO recién cerrado también congela", async () => {
    // @aitri-tc TC-CCO-091e
    const a = await newUser("cco-vacio-congelado@example.com");
    const { hoja } = await sembrar(a.userId, JUL, SEP);
    await cerrarVeces(a.cookie, a.userId, 1); // cierra julio, que está vacío

    const l = (await loadLedger(a.userId))!;
    const enJulio: LedgerState = { ...l.state, budgets: { ...l.state.budgets, [hoja]: { [JUL]: 4_000 } } };
    const put = await putLedger(a.cookie, l.revision, enJulio);
    const cuerpo = await put.json();
    expect(put.status, JSON.stringify(cuerpo)).toBe(422);
    expect(cuerpo.error.code).toBe("closed_period_violation");
    const [{ n }] = [...(await testDb().execute(
      sql`SELECT count(*)::int AS n FROM amount_cell WHERE owner_id = ${a.userId} AND period = ${JUL}`))] as { n: number }[];
    expect(n).toBe(0);
  });

  /** @aitri-trace FR-ID: NFR-2704, US-ID: US-2702, AC-ID: AC-2702a, TC-ID: TC-CCO-092f */
  it("TC-CCO-092f: las otras puertas tampoco escriben en un mes cerrado", async () => {
    // @aitri-tc TC-CCO-092f
    const a = await newUser("cco-otras-puertas@example.com");
    await sembrar(a.userId, SEP, SEP);
    await cerrarVeces(a.cookie, a.userId, 1);
    const id = `m-${a.userId}`;

    for (const res of [
      await movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, body: { amount: 9_000 } }), ctx(id)),
      await movDELETE(req(`/api/v1/movements/${id}`, { method: "DELETE", cookie: a.cookie }), ctx(id)),
    ]) {
      const cuerpo = await res.json();
      expect(res.status, JSON.stringify(cuerpo)).toBe(422);
      expect(cuerpo.error.code).toBe("closed_period_violation");
    }
    const m = (await loadLedger(a.userId))!.state.movements.find((x) => x.id === id);
    expect(m?.amount).toBe(7_000);
  });
});

describe("NFR-2705 — en un mes cerrado se sigue comentando", () => {
  const comentario = (text: string) => ({ id: "n1", createdAt: 1, text, date: "2026-10-05" });

  /** @aitri-trace FR-ID: NFR-2705, US-ID: US-2702, AC-ID: AC-2702a, TC-ID: TC-CCO-100h */
  it("TC-CCO-100h: un comentario fechado entra en un mes cerrado", async () => {
    // @aitri-tc TC-CCO-100h
    const a = await newUser("cco-comentar@example.com");
    const { hoja } = await sembrar(a.userId, SEP, SEP);
    await cerrarVeces(a.cookie, a.userId, 1);

    const l = (await loadLedger(a.userId))!;
    const conNota: LedgerState = { ...l.state, cellNotes: { [hoja]: { [SEP]: [comentario("Revisado")] } } };
    const put = await putLedger(a.cookie, l.revision, conNota);
    expect(put.status, JSON.stringify(await put.clone().json())).toBe(200);
    const fila = [...(await testDb().execute(
      sql`SELECT period, date FROM cell_note WHERE owner_id = ${a.userId} AND id = 'n1'`))][0] as
      { period: string; date: string };
    expect(fila).toEqual({ period: SEP, date: "2026-10-05" });
  });

  /** @aitri-trace FR-ID: NFR-2705, US-ID: US-2702, AC-ID: AC-2702c, TC-ID: TC-CCO-101e */
  it("TC-CCO-101e: también en un mes vacío recién cerrado", async () => {
    // @aitri-tc TC-CCO-101e
    const a = await newUser("cco-comentar-vacio@example.com");
    const { hoja } = await sembrar(a.userId, JUL, SEP);
    await cerrarVeces(a.cookie, a.userId, 1); // julio, vacío

    const l = (await loadLedger(a.userId))!;
    const conNota: LedgerState = { ...l.state, cellNotes: { [hoja]: { [JUL]: [comentario("Nada este mes")] } } };
    const put = await putLedger(a.cookie, l.revision, conNota);
    expect(put.status, JSON.stringify(await put.clone().json())).toBe(200);
    const [{ notas, celdas }] = [...(await testDb().execute(sql`
      SELECT (SELECT count(*)::int FROM cell_note   WHERE owner_id = ${a.userId} AND period = ${JUL}) AS notas,
             (SELECT count(*)::int FROM amount_cell WHERE owner_id = ${a.userId} AND period = ${JUL}) AS celdas`))] as
      { notas: number; celdas: number }[];
    expect({ notas, celdas }).toEqual({ notas: 1, celdas: 0 });
  });

  /** @aitri-trace FR-ID: NFR-2705, US-ID: US-2702, AC-ID: AC-2702a, TC-ID: TC-CCO-102f */
  it("TC-CCO-102f: comentar no abre la puerta a cambiar cifras del mes cerrado", async () => {
    // @aitri-tc TC-CCO-102f
    const a = await newUser("cco-comentar-y-cifra@example.com");
    const { hoja } = await sembrar(a.userId, SEP, SEP);
    await cerrarVeces(a.cookie, a.userId, 1);
    const revision = await revisionDe(a.userId);

    const l = (await loadLedger(a.userId))!;
    const ambos: LedgerState = {
      ...l.state,
      budgets: { ...l.state.budgets, [hoja]: { [SEP]: 9_000 } },
      cellNotes: { [hoja]: { [SEP]: [comentario("Revisado")] } },
    };
    const put = await putLedger(a.cookie, revision, ambos);
    const cuerpo = await put.json();
    expect(put.status, JSON.stringify(cuerpo)).toBe(422);
    expect(cuerpo.error.code).toBe("closed_period_violation");
    const [{ n }] = [...(await testDb().execute(
      sql`SELECT count(*)::int AS n FROM cell_note WHERE owner_id = ${a.userId}`))] as { n: number }[];
    expect(n).toBe(0);
    expect(await revisionDe(a.userId)).toBe(revision);
  });
});

describe("NFR-2706 — el cierre sigue siendo del dueño y con sesión", () => {
  /** @aitri-trace FR-ID: NFR-2706, US-ID: US-2703, AC-ID: AC-2703a, TC-ID: TC-CCO-110f */
  it("TC-CCO-110f: sin sesión, el cierre responde 401", async () => {
    // @aitri-tc TC-CCO-110f
    const a = await newUser("cco-sin-sesion@example.com");
    await sembrar(a.userId, JUL, SEP);

    const res = await closurePOST(req("/api/v1/closure", { method: "POST", body: { baseRevision: 1 } }));
    const cuerpo = await res.json();
    expect(res.status, JSON.stringify(cuerpo)).toBe(401);
    expect(cuerpo.error.code).toBe("unauthorized");
    expect((await cierreEnBd(a.userId)).closed).toBeNull();
  });

  /** @aitri-trace FR-ID: NFR-2706, US-ID: US-2703, AC-ID: AC-2703a, TC-ID: TC-CCO-111h */
  it("TC-CCO-111h: con sesión válida el cierre escribe en el ledger del dueño", async () => {
    // @aitri-tc TC-CCO-111h
    const a = await newUser("cco-con-sesion@example.com");
    await sembrar(a.userId, JUL, SEP);

    expect((await cerrar(a.cookie, await revisionDe(a.userId))).status).toBe(200);
    const [fila] = [...(await testDb().execute(
      sql`SELECT owner_id, closed_through FROM ledger WHERE owner_id = ${a.userId}`))] as
      { owner_id: string; closed_through: string }[];
    expect(fila).toEqual({ owner_id: a.userId, closed_through: JUL });
  });

  /** @aitri-trace FR-ID: NFR-2706, US-ID: US-2703, AC-ID: AC-2703a, TC-ID: TC-CCO-112e */
  it("TC-CCO-112e: el cierre de una cuenta no toca el de otra", async () => {
    // @aitri-tc TC-CCO-112e
    const a = await newUser("cco-duena@example.com");
    const b = await newUser("cco-otra@example.com");
    await sembrar(a.userId, JUL, SEP);
    await sembrar(b.userId, JUL, SEP);

    expect((await cerrar(b.cookie, await revisionDe(b.userId))).status).toBe(200);

    expect((await cierreEnBd(b.userId)).closed).toBe(JUL);
    expect((await cierreEnBd(a.userId)).closed).toBeNull();
  });
});
