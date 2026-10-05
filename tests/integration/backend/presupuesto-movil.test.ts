/**
 * Feature presupuesto-movil — el SERVIDOR es la autoridad sobre un periodo cerrado.
 * TCs: FR-3112 (TC-PMV-112f) · NFR-3105 (TC-PMV-164e).
 *
 * El teléfono no ofrece acciones en un periodo cerrado, pero ocultar un botón es UX, no una regla. Estas
 * pruebas escriben contra las rutas reales, con Postgres, las dos peticiones que el teléfono haría si un
 * control se quedara a la vista: corregir un movimiento y cambiar lo planeado. Las dos deben rebotar con
 * 422 y dejar el dato como estaba, leído de la base y no de la respuesta.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { buildSeed } from "@/domain";
import { PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as closurePOST } from "@/app/api/v1/closure/route";
import { PATCH as movPATCH, DELETE as movDELETE } from "@/app/api/v1/movements/[id]/route";
import type { LedgerState, PeriodKey } from "@/domain/types";
import { PMV, PMV_MOV, pmvBase } from "../../fixtures/pmv-base";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
const PREV: PeriodKey = "2026-07";
const M: PeriodKey = "2026-08";
const HOY = "2026-08-25";

let ipCounter = 0;
const nextIp = () => `10.31.${Math.floor((++ipCounter) / 250)}.${ipCounter % 250}`;

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

/** Un usuario con el libro de ejemplo guardado y el periodo PREV ya cerrado. */
async function usuarioConPrevCerrado(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  const base = pmvBase(M, PREV);
  const state: LedgerState = {
    ...buildSeed(userId, PREV),
    nodes: base.nodes.map((n) => ({ ...n, ownerId: userId })),
    budgets: base.budgets,
    actuals: base.actuals,
    movements: base.movements.map((m) => ({ ...m, ownerId: userId })),
  };
  const guardado = await saveLedger(userId, state, 0);
  if (!guardado.ok) throw new Error(`no se pudo sembrar: ${JSON.stringify(guardado)}`);
  const cierre = await closurePOST(req("/api/v1/closure", { method: "POST", cookie, body: { baseRevision: (await loadLedger(userId))!.revision } }));
  if (cierre.status !== 200) throw new Error(`no se pudo cerrar ${PREV}: ${JSON.stringify(await cierre.json())}`);
  const cerrado = (await loadLedger(userId))!.state.closure?.closedThrough;
  if (cerrado !== PREV) throw new Error(`se esperaba ${PREV} cerrado y quedó ${String(cerrado)}`);
  return { cookie, userId };
}

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = HOY;
});
afterAll(async () => {
  delete process.env.LEDGER_TODAY;
  await closeTestDb();
});

describe("presupuesto-movil · un periodo cerrado no se cambia, lo pida quien lo pida", () => {
  /** @aitri-trace FR-ID: FR-3112, US-ID: US-3112, AC-ID: AC-3134, TC-ID: TC-PMV-112f */
  it("TC-PMV-112f: corregir o borrar un movimiento de un periodo cerrado responde 422 y no cambia nada", async () => {
    // @aitri-tc TC-PMV-112f
    const a = await usuarioConPrevCerrado("pmv-cerrado-mov@example.com");
    const id = PMV_MOV.superPrev;
    const revision = (await loadLedger(a.userId))!.revision;

    const patch = await movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, body: { amount: 100 } }), ctx(id));
    const cuerpo = await patch.json();
    expect(patch.status, JSON.stringify(cuerpo)).toBe(422);
    expect(cuerpo.error.code).toBe("closed_period_violation");
    expect(cuerpo.error.detail.periods).toEqual([PREV]);

    const borrar = await movDELETE(req(`/api/v1/movements/${id}`, { method: "DELETE", cookie: a.cookie }), ctx(id));
    expect(borrar.status).toBe(422);
    expect((await borrar.json()).error.code).toBe("closed_period_violation");

    const despues = (await loadLedger(a.userId))!;
    expect(despues.state.movements.find((m) => m.id === id)?.amount).toBe(850);
    expect(despues.state.actuals[PMV.mercado]?.[PREV]).toBe(850);
    expect(despues.revision).toBe(revision);

    // El periodo ABIERTO sí se corrige por la misma ruta: el rechazo era por el cierre.
    const abierto = await movPATCH(req(`/api/v1/movements/${PMV_MOV.plaza}`, { method: "PATCH", cookie: a.cookie, body: { amount: 250 } }), ctx(PMV_MOV.plaza));
    expect(abierto.status, JSON.stringify(await abierto.clone().json())).toBe(200);
    expect((await loadLedger(a.userId))!.state.actuals[PMV.mercado]?.[M]).toBe(550);
  });

  /** @aitri-trace FR-ID: NFR-3105, US-ID: US-3112, AC-ID: AC-3134, TC-ID: TC-PMV-164e */
  it("TC-PMV-164e: cambiar lo planeado de un periodo cerrado por PUT responde 422 y nombra el periodo", async () => {
    // @aitri-tc TC-PMV-164e
    const a = await usuarioConPrevCerrado("pmv-cerrado-plan@example.com");
    const l = (await loadLedger(a.userId))!;
    expect(l.state.budgets[PMV.mercado]?.[PREV]).toBe(900);

    const cambiado: LedgerState = {
      ...l.state,
      budgets: { ...l.state.budgets, [PMV.mercado]: { ...l.state.budgets[PMV.mercado], [PREV]: 1000 } },
    };
    const put = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie: a.cookie, body: { baseRevision: l.revision, state: cambiado } }));
    const cuerpo = await put.json();
    expect(put.status, JSON.stringify(cuerpo)).toBe(422);
    expect(cuerpo.error.code).toBe("closed_period_violation");
    expect(cuerpo.error.detail.periods).toEqual([PREV]);

    const despues = (await loadLedger(a.userId))!;
    expect(despues.state.budgets[PMV.mercado]?.[PREV]).toBe(900);
    expect(despues.revision).toBe(l.revision);

    // El mismo cambio en el periodo ABIERTO entra: es la acción que hace «Cambiar» en el teléfono.
    const enAbierto: LedgerState = {
      ...l.state,
      budgets: { ...l.state.budgets, [PMV.mercado]: { ...l.state.budgets[PMV.mercado], [M]: 1200 } },
    };
    const ok = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie: a.cookie, body: { baseRevision: l.revision, state: enAbierto } }));
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(200);
    expect((await loadLedger(a.userId))!.state.budgets[PMV.mercado]?.[M]).toBe(1200);
  });
});
