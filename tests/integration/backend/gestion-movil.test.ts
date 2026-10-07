/**
 * Feature gestion-movil — lo que solo la base de datos y las rutas reales pueden afirmar.
 * TCs: FR-3211 (TC-GMV-121h) · NFR-3205 (TC-GMV-152f) · NFR-3206 (TC-GMV-157f).
 *
 * El teléfono no añade rutas ni reglas: guarda la estructura por el PUT del libro y cierra por la ruta
 * de cierre. Aquí se comprueba, con Postgres, que lo que el teléfono guarda sobrevive a un proceso
 * nuevo, y que el servidor sigue siendo la autoridad sobre el orden del cierre y sobre un mes cerrado
 * aunque una pantalla dejara pasar algo.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { buildSeed, createNode } from "@/domain";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as closurePOST } from "@/app/api/v1/closure/route";
import type { LedgerState, PeriodKey } from "@/domain/types";
import { GMV, gmvBase } from "../../fixtures/gmv-base";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
const PREV: PeriodKey = "2026-07";
const M: PeriodKey = "2026-08";
const HOY = "2026-08-25";

let ipCounter = 0;
const nextIp = () => `10.32.${Math.floor((++ipCounter) / 250)}.${ipCounter % 250}`;

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

/** Un usuario con el libro de ejemplo guardado; ningún mes cerrado. */
async function usuario(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  const base = gmvBase(M, PREV);
  const state: LedgerState = {
    ...buildSeed(userId, PREV),
    nodes: base.nodes.map((n) => ({ ...n, ownerId: userId })),
    budgets: base.budgets,
    actuals: base.actuals,
    movements: base.movements.map((m) => ({ ...m, ownerId: userId })),
  };
  const guardado = await saveLedger(userId, state, 0);
  if (!guardado.ok) throw new Error(`no se pudo sembrar: ${JSON.stringify(guardado)}`);
  return { cookie, userId };
}
const cerrar = (cookie: string, body: Record<string, unknown>) => closurePOST(req("/api/v1/closure", { method: "POST", cookie, body }));

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = HOY;
});
afterAll(async () => {
  delete process.env.LEDGER_TODAY;
  await closeTestDb();
});

describe("gestion-movil · lo creado en el teléfono queda en la base", () => {
  /** @aitri-trace FR-ID: FR-3211, US-ID: US-3211, AC-ID: AC-3236, TC-ID: TC-GMV-121h */
  it("TC-GMV-121h: el snapshot guardado sobrevive a un proceso nuevo", async () => {
    // @aitri-tc TC-GMV-121h
    const a = await usuario("gmv-guardar@example.com");
    const antes = (await loadLedger(a.userId))!;
    // Lo mismo que hace la pantalla «Nuevo grupo»: la acción de dominio y el PUT del libro.
    const conHogar = createNode(antes.state, { level: "group", parentId: null, type: "expense", name: "Hogar" });
    expect(conHogar.nodes).toHaveLength(antes.state.nodes.length + 1);

    const put = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie: a.cookie, body: { baseRevision: antes.revision, state: conHogar } }));
    const cuerpo = await put.json();
    expect(put.status, JSON.stringify(cuerpo)).toBe(200);
    expect(cuerpo.revision).toBe(antes.revision + 1);

    // Leído de la base por la ruta, no de la respuesta del PUT ni de la memoria de esta prueba.
    const get = await ledgerGET(req("/api/v1/ledger", { cookie: a.cookie }));
    expect(get.status).toBe(200);
    const leido = (await get.json()) as { revision: number; state: LedgerState };
    expect(leido.revision).toBe(antes.revision + 1);
    const hogar = leido.state.nodes.filter((n) => n.name === "Hogar");
    expect(hogar).toHaveLength(1);
    expect(hogar[0]).toMatchObject({ level: "group", type: "expense", parentId: null });
    expect(leido.state.nodes).toHaveLength(antes.state.nodes.length + 1);
    // Y lo que ya estaba sigue igual.
    expect(leido.state.actuals[GMV.mercado]?.[M]).toBe(100);

    // Otra cuenta no lo ve: el libro es del dueño.
    const b = await usuario("gmv-otra-cuenta@example.com");
    const ajeno = (await (await ledgerGET(req("/api/v1/ledger", { cookie: b.cookie }))).json()) as { state: LedgerState };
    expect(ajeno.state.nodes.some((n) => n.name === "Hogar")).toBe(false);
  });
});

describe("gestion-movil · el servidor manda sobre el cierre", () => {
  /** @aitri-trace FR-ID: NFR-3205, US-ID: US-3207, AC-ID: AC-3223, TC-ID: TC-GMV-152f */
  it("TC-GMV-152f: el servidor ignora un mes propuesto fuera de orden", async () => {
    // @aitri-tc TC-GMV-152f
    const a = await usuario("gmv-orden@example.com");
    const l = (await loadLedger(a.userId))!;
    expect(l.state.closure?.closedThrough ?? null).toBeNull();

    // Una petición manipulada pide cerrar M saltándose PREV.
    const res = await cerrar(a.cookie, { baseRevision: l.revision, period: M, closedThrough: M });
    const despues = (await loadLedger(a.userId))!.state.closure?.closedThrough ?? null;
    // O la rechaza por la forma, o cierra el que toca: en ningún caso M.
    expect(despues).not.toBe(M);
    if (res.status === 200) expect(despues).toBe(PREV);
    else {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(despues).toBeNull();
    }

    // El camino legítimo sigue cerrando en orden: PREV y luego M.
    const base = (await loadLedger(a.userId))!;
    if (base.state.closure?.closedThrough !== PREV) {
      expect((await cerrar(a.cookie, { baseRevision: base.revision })).status).toBe(200);
    }
    expect((await loadLedger(a.userId))!.state.closure?.closedThrough).toBe(PREV);
  });
});

describe("gestion-movil · un mes cerrado no se cambia", () => {
  /** @aitri-trace FR-ID: NFR-3206, US-ID: US-3209, AC-ID: AC-3232, TC-ID: TC-GMV-157f */
  it("TC-GMV-157f: el servidor sigue rechazando una cifra de un mes cerrado", async () => {
    // @aitri-tc TC-GMV-157f
    const a = await usuario("gmv-cerrado@example.com");
    expect((await cerrar(a.cookie, { baseRevision: (await loadLedger(a.userId))!.revision })).status).toBe(200);
    const l = (await loadLedger(a.userId))!;
    expect(l.state.closure?.closedThrough).toBe(PREV);
    expect(l.state.actuals[GMV.mercado]?.[PREV]).toBe(850);

    const cambiado: LedgerState = {
      ...l.state,
      actuals: { ...l.state.actuals, [GMV.mercado]: { ...l.state.actuals[GMV.mercado], [PREV]: 900 } },
    };
    const put = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie: a.cookie, body: { baseRevision: l.revision, state: cambiado } }));
    const cuerpo = await put.json();
    expect(put.status, JSON.stringify(cuerpo)).toBe(422);
    expect(cuerpo.error.code).toBe("closed_period_violation");

    const despues = (await loadLedger(a.userId))!;
    expect(despues.state.actuals[GMV.mercado]?.[PREV]).toBe(850);
    expect(despues.revision).toBe(l.revision);

    // Renombrar con ese mes cerrado SÍ se guarda: la estructura no es de ningún mes.
    const renombrado: LedgerState = { ...l.state, nodes: l.state.nodes.map((n) => (n.id === GMV.mercado ? { ...n, name: "Súper" } : n)) };
    const ok = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie: a.cookie, body: { baseRevision: l.revision, state: renombrado } }));
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(200);
    expect((await loadLedger(a.userId))!.state.nodes.find((n) => n.id === GMV.mercado)?.name).toBe("Súper");
  });
});
