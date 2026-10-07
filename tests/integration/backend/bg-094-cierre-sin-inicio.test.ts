/**
 * BG-094 — sin mes de inicio declarado, el botón de cierre y el servidor podían discrepar.
 *
 * `cierre-coherente` (FR-2701/2703) alineó las dos capas anclando el rango del servidor en el mes de
 * inicio DECLARADO. Quedó un caso sin cubrir: el cliente ancla además en la FRONTERA del cierre
 * (`activeBounds`, ADR-14) y el servidor no. Con una frontera anterior al primer dato y sin inicio
 * declarado, el botón nombraba el mes siguiente a la frontera y el servidor cerraba el primer mes con
 * datos, saltándose los vacíos de en medio. Hallado el 2026-10-07 por la revisión adversarial de
 * gestion-movil; afecta igual a escritorio y al teléfono.
 *
 * Los casos de rango son puros pero viven aquí porque `closureScope` está en `ledgerRepo`
 * (`server-only`), como los de cierre-coherente.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { closureScope, loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { activeBounds } from "@/domain/range";
import { periodRange } from "@/domain/periods";
import { nextClosable } from "@/domain/closure";
import { buildSeed, isLeaf } from "@/domain";
import { POST as closurePOST } from "@/app/api/v1/closure/route";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
const JUN: PeriodKey = "2026-06";
const JUL: PeriodKey = "2026-07";
const AGO: PeriodKey = "2026-08";
const SEP: PeriodKey = "2026-09";
const OCT: PeriodKey = "2026-10";
const HOY = "2026-10-05";

const NODES: LedgerNode[] = [
  { id: "g", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 0 },
  { id: "c", ownerId: "local", type: "expense", level: "category", parentId: "g", name: "Mercado", icon: null, order: 0 },
];

/** Un estado con (o sin) inicio declarado, un movimiento en un periodo y una frontera de cierre. */
function estado(startMonth: string | null, dato: PeriodKey | null, closedThrough: PeriodKey | null): LedgerState {
  const movimientos: Movement[] = dato
    ? [{ id: "m", ownerId: "local", type: "expense", catId: "c", subId: null, target: "c", amount: 7_000, period: dato, createdAt: 1, date: `${dato}-10T12:00` }]
    : [];
  return {
    ownerId: "local", nodes: NODES, budgets: {},
    actuals: dato ? { c: { [dato]: 7_000 } } : {},
    movements: movimientos,
    closure: { closedThrough, reopened: null },
    ...(startMonth !== null ? { startMonth } : {}),
  } as unknown as LedgerState;
}

/** El mes que propondría el BOTÓN (cliente) y el que decidiría el SERVIDOR, sobre el mismo estado. */
function mesesPropuestos(state: LedgerState, hoy: PeriodKey): { cliente: PeriodKey | null; servidor: PeriodKey | null } {
  const b = activeBounds(state, hoy);
  const rangoCliente = b ? periodRange(b.from, b.to) : [];
  return { cliente: nextClosable(state, hoy, rangoCliente), servidor: nextClosable(state, hoy, closureScope(state, hoy)) };
}

describe("BG-094 · el rango del cierre ancla también en la frontera", () => {
  it("BG-094: sin inicio declarado y con la frontera antes del primer dato, botón y servidor proponen el mismo mes", () => {
    // Julio cerrado estando vacío; agosto vacío y sin cerrar; datos desde septiembre.
    const s = estado(null, SEP, JUL);
    const { cliente, servidor } = mesesPropuestos(s, OCT);
    expect(cliente).toBe(AGO);
    // Antes del arreglo el servidor decía SEP: se saltaba agosto.
    expect(servidor).toBe(AGO);
    // El rango del servidor empieza en la frontera, no en el primer dato.
    expect(closureScope(s, OCT)[0]).toBe(JUL);
  });

  it("BG-094: ninguna combinación de inicio, primer dato y frontera los hace diferir", () => {
    const inicios: (string | null)[] = [null, JUN, JUL, SEP];
    const datos: (PeriodKey | null)[] = [null, JUN, AGO, SEP];
    const fronteras: (PeriodKey | null)[] = [null, "2026-05", JUN, JUL, AGO, SEP];
    let comparadas = 0;
    for (const inicio of inicios) for (const dato of datos) for (const frontera of fronteras) {
      for (const hoy of [OCT, "2027-01"] as PeriodKey[]) {
        const { cliente, servidor } = mesesPropuestos(estado(inicio, dato, frontera), hoy);
        expect(servidor, `inicio=${inicio} dato=${dato} frontera=${frontera} hoy=${hoy} → botón ${cliente} vs servidor ${servidor}`).toBe(cliente);
        comparadas++;
      }
    }
    expect(comparadas).toBe(inicios.length * datos.length * fronteras.length * 2);
  });

  it("BG-094: sin frontera ni inicio declarado, el rango del cierre es el de siempre", () => {
    // Lo que NO debe cambiar: una cuenta sin nada cerrado sigue partiendo de su primer dato.
    const s = estado(null, SEP, null);
    expect(closureScope(s, OCT)).toEqual([SEP, OCT]);
    // Y una frontera POSTERIOR al primer dato no recorta ni adelanta el inicio.
    expect(closureScope(estado(null, JUL, AGO), OCT)[0]).toBe(JUL);
  });
});

describe("BG-094 · el servidor cierra el mes que el botón nombra", () => {
  let ipCounter = 0;
  const nextIp = () => `10.94.${Math.floor((++ipCounter) / 250)}.${ipCounter % 250}`;
  const req = (cookie: string, body: unknown) => new Request(`${ORIGIN}/api/v1/closure`, {
    method: "POST", headers: { origin: ORIGIN, cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });

  beforeEach(async () => { await truncateAll(); process.env.LEDGER_TODAY = HOY; });
  afterAll(async () => { delete process.env.LEDGER_TODAY; await closeTestDb(); });

  it("BG-094: con julio cerrado vacío y datos desde septiembre, la siguiente petición cierra AGOSTO en la base", async () => {
    const email = "bg094-frontera@example.com";
    const { cookie } = await signUp(email, PASSWORD, "bg094", nextIp());
    const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
    const semilla = buildSeed(userId, SEP);
    const hoja = semilla.nodes.find((n) => n.type === "expense" && isLeaf(n, semilla.nodes))!.id;
    const state: LedgerState = {
      ...semilla,
      actuals: { [hoja]: { [SEP]: 7_000 } },
      movements: [{ id: "m-1", ownerId: userId, type: "expense", catId: hoja, subId: null, target: hoja, amount: 7_000, period: SEP, createdAt: 1, date: `${SEP}-10T12:00` }],
    };
    const guardado = await saveLedger(userId, state, 0);
    if (!guardado.ok) throw new Error(`no se pudo sembrar: ${JSON.stringify(guardado)}`);
    // La frontera en julio, sin inicio declarado: el estado que ninguna prueba cubría. Se planta en la
    // base porque la vía normal exige un inicio declarado para cerrar un mes vacío.
    await testDb().execute(sql`UPDATE ledger SET closed_through = ${JUL}, start_month = NULL WHERE owner_id = ${userId}`);
    const antes = (await loadLedger(userId))!;
    expect(antes.state.closure?.closedThrough).toBe(JUL);
    expect(antes.state.startMonth ?? null).toBeNull();

    const res = await closurePOST(req(cookie, { baseRevision: antes.revision }));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    // Leído de la base: agosto, el mes que el botón nombraba; no septiembre.
    expect((await loadLedger(userId))!.state.closure?.closedThrough).toBe(AGO);
  });
});
