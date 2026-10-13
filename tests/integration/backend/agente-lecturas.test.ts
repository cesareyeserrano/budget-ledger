/**
 * Feature tony-ledger · EP-02 — Lecturas del agente.
 *
 * Módulo:       tests/integration/backend/agente-lecturas.test.ts
 * Propósito:    El árbol (FR-3407), el resumen del periodo (FR-3415), los movimientos (FR-3416) y el
 *               periodo de una fecha (FR-3417), contra Postgres real y los route handlers reales.
 *               Las cifras del resumen se comprueban contra valores escritos a mano Y contra las
 *               funciones del dominio que usa la pantalla.
 * Dependencias: el Postgres efímero del globalSetup, ./helpers/agente.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, testDb, truncateAll } from "./helpers/db";
import { sql } from "drizzle-orm";
import {
  OCT, ORIGIN, agentReq, apiReq, crearToken, hoy, libro, limpiarTopes, marcarComoAgente, newUser, sembrar, superficie,
  volcado,
} from "./helpers/agente";
import { calendarOf, closeMonthFor, insertMovement, loadLedger, saveStartFor } from "@/server/data/ledgerRepo";
import { activeKeys } from "@/domain/range";
import { applyCyclesFor } from "@/server/data/cyclesRepo";
import { computeBalanceSeries } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { periodRange } from "@/domain/periods";
import type { LedgerState, PeriodKey } from "@/domain";
import * as treeRoute from "@/app/api/agent/v1/tree/route";
import { GET as movsGET } from "@/app/api/agent/v1/movements/route";
import { GET as periodGET } from "@/app/api/agent/v1/period/route";
import { GET as summaryGET } from "@/app/api/agent/v1/summary/route";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";

const SEP: PeriodKey = "2026-09";
const DIA21 = { mode: "cycle", anchorDay: 21, eomPolicy: "last_day" } as const;

/** El libro del resumen: octubre con plan y ejecución, y un bolsillo que ya traía saldo. */
function libroDelResumen(ownerId: string): LedgerState {
  return libro(ownerId, {
    budgets: { "s-mercado": { [OCT]: 800_000 }, "s-restaurantes": { [OCT]: 200_000 } },
    actuals: {
      "s-mercado": { [OCT]: 320_000 },
      "s-restaurantes": { [OCT]: 250_000 },
      "c-salario": { [SEP]: 750_000, [OCT]: 3_000_000 },
      "s-viaje": { [SEP]: 750_000, [OCT]: 200_000 },
    },
  });
}

interface Cuenta { cookie: string; userId: string; token: string; tokenId: string }
async function cuenta(email: string, state?: (id: string) => LedgerState): Promise<Cuenta> {
  const u = await newUser(email);
  await sembrar(u.userId, (state ?? ((id) => libro(id)))(u.userId));
  const t = await crearToken(u.userId);
  return { ...u, token: t.token, tokenId: t.id };
}
async function revision(ownerId: string): Promise<number> {
  return (await loadLedger(ownerId))!.revision;
}
/** Registra un gasto manual (por el repositorio, como lo haría la app) y devuelve su id. */
async function gastoManual(ownerId: string, subId: string, amount: number, date = "2026-10-10"): Promise<string> {
  const r = await insertMovement(ownerId, { type: "expense", catId: "c-alimentacion", subId, amount, period: date.slice(0, 7) as PeriodKey, date });
  if (!r || !("movement" in r)) throw new Error(`No se pudo registrar el gasto de prueba: ${JSON.stringify(r)}`);
  return r.movement.id;
}

beforeEach(async () => {
  await truncateAll();
  superficie("on");
  limpiarTopes();
});
afterAll(async () => {
  superficie("off");
  await closeTestDb();
});

describe("FR-3407 — leer el árbol", () => {
  it("TC-AGT-070h: trae todos los nodos con sus campos y la marca de hoja", async () => {
    // @aitri-tc TC-AGT-070h
    const c = await cuenta("admin@admin.com");
    const res = await treeRoute.GET(agentReq("/tree", { token: c.token }));
    expect(res.status).toBe(200);
    const { revision: rev, nodes } = await res.json();
    expect(nodes).toHaveLength(12);
    const porId = Object.fromEntries(nodes.map((n: { id: string }) => [n.id, n]));
    expect(porId["s-mercado"]).toEqual({ id: "s-mercado", name: "Mercado", type: "expense", level: "sub", parentId: "c-alimentacion", leaf: true });
    expect(porId["c-alimentacion"].leaf).toBe(false);
    expect(porId["s-viaje"]).toMatchObject({ type: "transfer", leaf: true });
    // Una categoría SIN subcategorías es hoja (se registra sobre ella); un grupo y una categoría
    // con hijos, no. «Es hoja» no es «es subcategoría».
    expect(porId["c-transporte"].leaf).toBe(true);
    expect(porId["c-salario"].leaf).toBe(true);
    expect(porId["g-vida"].leaf).toBe(false);
    expect(porId["c-metas"].leaf).toBe(false);
    expect(nodes.filter((n: { leaf: boolean }) => n.leaf)).toHaveLength(7);
    expect(rev).toBe(await revision(c.userId));
  });

  it("TC-AGT-071e: un renombrado hecho en la app se ve en la siguiente lectura", async () => {
    // @aitri-tc TC-AGT-071e
    const c = await cuenta("admin@admin.com");
    const antes = await (await treeRoute.GET(agentReq("/tree", { token: c.token }))).json();
    const { revision: rev, state } = await (await ledgerGET(apiReq("/api/v1/ledger", { cookie: c.cookie }))).json();
    const renombrado = { ...state, nodes: state.nodes.map((n: { id: string; name: string }) => (n.id === "s-mercado" ? { ...n, name: "Supermercado" } : n)) };
    const put = await ledgerPUT(apiReq("/api/v1/ledger", { method: "PUT", cookie: c.cookie, origin: ORIGIN, body: { baseRevision: rev, state: renombrado } }));
    expect(put.status).toBe(200);

    const despues = await (await treeRoute.GET(agentReq("/tree", { token: c.token }))).json();
    expect(despues.nodes.find((n: { id: string }) => n.id === "s-mercado").name).toBe("Supermercado");
    expect(despues.revision).toBe(antes.revision + 1);
  });

  it("TC-AGT-072f: el agente no puede escribir sobre el árbol", async () => {
    // @aitri-tc TC-AGT-072f
    const c = await cuenta("admin@admin.com");
    const antes = await volcado(c.userId);
    // GET es la única operación del árbol. Los demás métodos están exportados, pero solo para
    // contestar por la envoltura que ahí no hay nada: con token válido, 404, y la base intacta.
    const ruta = treeRoute as unknown as Record<string, (req: Request) => Promise<Response>>;
    expect(Object.keys(ruta).sort()).toEqual(["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"]);
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const res = await ruta[metodo](agentReq("/tree", {
        token: c.token, method: metodo, ...(metodo === "OPTIONS" || metodo === "DELETE" ? {} : { body: { id: "s-mercado", name: "Hackeado" } }),
      }));
      expect(res.status, metodo).toBe(404);
      expect((await res.json()).error.code, metodo).toBe("not_found");
      // Y sin token, 401: no delata ni que el método «no existe».
      expect((await ruta[metodo](agentReq("/tree", { method: metodo }))).status, `${metodo} sin token`).toBe(401);
    }
    expect(await volcado(c.userId)).toBe(antes);
    const filas = (await testDb().execute(sql`SELECT id, name FROM "node" WHERE owner_id = ${c.userId}`)) as unknown as { id: string; name: string }[];
    expect(filas).toHaveLength(12);
    expect(filas.find((n) => n.id === "s-mercado")!.name).toBe("Mercado");
  });

  it("TC-AGT-073f: una cuenta que no ha guardado su libro recibe 404, no 500", async () => {
    // @aitri-tc TC-AGT-073f
    const u = await newUser("nueva@example.com");
    const t = await crearToken(u.userId);
    const res = await treeRoute.GET(agentReq("/tree", { token: t.token }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

describe("FR-3415 — resumen del periodo", () => {
  it("TC-AGT-150h: el resumen da las cifras del libro, peso a peso", async () => {
    // @aitri-tc TC-AGT-150h
    const c = await cuenta("admin@admin.com", libroDelResumen);
    const res = await summaryGET(agentReq(`/summary?period=${OCT}`, { token: c.token }));
    expect(res.status).toBe(200);
    const r = await res.json();
    const nodo = (id: string) => r.nodes.find((n: { id: string }) => n.id === id);

    expect(nodo("s-mercado")).toMatchObject({ budget: 800_000, actual: 320_000, remaining: 480_000 });
    expect(nodo("s-restaurantes").remaining).toBe(-50_000);
    expect(nodo("c-alimentacion")).toMatchObject({ budget: 1_000_000, actual: 570_000, remaining: 430_000 });
    expect(r.totals.expense).toEqual({ budget: 1_000_000, actual: 570_000, remaining: 430_000 });
    expect(r.totals.income.actual).toBe(3_000_000);
    expect(r.pockets.find((p: { id: string }) => p.id === "s-viaje")).toEqual({ id: "s-viaje", name: "Viaje", contributed: 200_000, balance: 950_000 });
    expect(r.balance).toEqual({ available: 2_230_000, reserved: 950_000 });
    expect(r).toMatchObject({ period: OCT, mode: "month", start: "2026-10-01", end: "2026-10-31", closed: false });
  });

  it("TC-AGT-152e: sin periodo, responde el vigente e indica cuál y su rango", async () => {
    // @aitri-tc TC-AGT-152e
    const c = await cuenta("admin@admin.com", libroDelResumen);
    const ciclos = await applyCyclesFor(c.userId, await revision(c.userId), DIA21, "2026-10-10");
    expect(ciclos.ok, JSON.stringify(ciclos)).toBe(true);

    const res = await summaryGET(agentReq("/summary", { token: c.token, headers: hoy("2026-10-10") }));
    expect(res.status).toBe(200);
    const r = await res.json();
    const p = await (await periodGET(agentReq("/period?date=2026-10-10", { token: c.token }))).json();
    expect(r).toMatchObject({ mode: "cycle", start: "2026-09-21", end: "2026-10-20", closed: false });
    expect(r.period).toBe(p.period);
  });

  it("TC-AGT-153f: periodo mal formado responde invalid_period", async () => {
    // @aitri-tc TC-AGT-153f
    const c = await cuenta("admin@admin.com", libroDelResumen);
    // Mal formados, fuera del rango de años del sistema, y una clave de transición («t») en una
    // cuenta por mes calendario, donde ese periodo no existe.
    for (const malo of ["2026-13", "octubre", "2026-1", "9999-12", "0001-01", "1999-12", "2026-10t"]) {
      const res = await summaryGET(agentReq(`/summary?period=${malo}`, { token: c.token }));
      expect(res.status, malo).toBe(400);
      const cuerpo = await res.text();
      expect(JSON.parse(cuerpo).error.code).toBe("invalid_period");
      expect(cuerpo).not.toContain("nodes");
    }
  });

  it("TC-AGT-154e: un periodo válido sin datos responde ceros, no un error", async () => {
    // @aitri-tc TC-AGT-154e
    const c = await cuenta("admin@admin.com", libroDelResumen);
    const res = await summaryGET(agentReq("/summary?period=2027-06", { token: c.token }));
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.nodes).toHaveLength(12);
    for (const n of r.nodes) expect([n.budget, n.actual, n.remaining], n.id).toEqual([0, 0, 0]);
    expect(r.totals.income.actual).toBe(0);
    expect(r.totals.expense.actual).toBe(0);
    expect(r.pockets.find((p: { id: string }) => p.id === "s-viaje").contributed).toBe(0);
  });

  it("TC-AGT-155f: cuenta sin libro guardado responde not_found", async () => {
    // @aitri-tc TC-AGT-155f
    const u = await newUser("nueva@example.com");
    const t = await crearToken(u.userId);
    const res = await summaryGET(agentReq("/summary", { token: t.token }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("TC-AGT-156e: el Disponible no depende del horizonte que tenga la pantalla", async () => {
    // @aitri-tc TC-AGT-156e
    const c = await cuenta("admin@admin.com", libroDelResumen);
    const r = await (await summaryGET(agentReq(`/summary?period=${OCT}`, { token: c.token }))).json();
    const state = (await loadLedger(c.userId))!.state;
    for (const rango of [periodRange("2026-09", "2026-12"), periodRange("2026-09", "2027-12")]) {
      const plano = computeBalanceSeries(state, rango, openingCarry(state, rango))[OCT].actual;
      expect(r.balance.available, `rango de ${rango.length}`).toBe(plano.available);
      expect(r.balance.reserved, `rango de ${rango.length}`).toBe(plano.reservedBalance);
    }
    expect(r.balance.available).toBe(2_230_000);

    // El caso que el rango del servidor perdía: un mes de inicio declarado ANTERIOR al primer dato,
    // con saldo inicial. La pantalla ancla su rango en ese mes; el resumen tiene que dar lo mismo.
    const u = await cuenta("inicio@example.com", (id) => libro(id, {
      actuals: { "c-salario": { [OCT]: 3_000_000 }, "s-mercado": { [OCT]: 500_000 } },
    }));
    const inicio = await saveStartFor(u.userId, await revision(u.userId), "2026-08", 1_000_000);
    expect(inicio.ok, JSON.stringify(inicio)).toBe(true);
    const libroU = (await loadLedger(u.userId))!.state;
    for (const [periodo, esperado] of [[OCT, 3_500_000], ["2026-09", 1_000_000], ["2026-08", 1_000_000]] as const) {
      const delAgente = await (await summaryGET(agentReq(`/summary?period=${periodo}`, { token: u.token }))).json();
      // Lo que pinta la pantalla: la serie sobre el rango activo del cliente, con su apertura.
      const rango = activeKeys(libroU, calendarOf(libroU, OCT), OCT);
      const enPantalla = computeBalanceSeries(libroU, rango, openingCarry(libroU, rango))[periodo].actual.available;
      expect(enPantalla, `pantalla ${periodo}`).toBe(esperado);
      expect(delAgente.balance.available, `agente ${periodo}`).toBe(esperado);
    }
  });
});

describe("FR-3416 — movimientos de un periodo y por referencia", () => {
  /** Tres gastos manuales y dos movimientos de agente (un gasto y una reserva) en octubre. */
  async function conCincoMovimientos(c: Cuenta): Promise<void> {
    await gastoManual(c.userId, "s-mercado", 10_000);
    await gastoManual(c.userId, "s-restaurantes", 20_000);
    const ingreso = await insertMovement(c.userId, { type: "income", catId: "c-salario", amount: 3_000_000, period: OCT, date: "2026-10-05" });
    expect(ingreso && "movement" in ingreso).toBe(true);
    const delAgente = await gastoManual(c.userId, "s-mercado", 50_000);
    await marcarComoAgente(c.userId, delAgente, "L300", c.tokenId);
    const reserva = await insertMovement(c.userId, { type: "transfer", catId: "c-metas", subId: "s-viaje", amount: 200_000, period: OCT, date: "2026-10-10", from: "@disponible", to: "s-viaje" });
    if (!reserva || !("movement" in reserva)) throw new Error(`No se pudo reservar: ${JSON.stringify(reserva)}`);
    await marcarComoAgente(c.userId, reserva.movement.id, "L310", c.tokenId);
  }

  it("TC-AGT-160h: la lista del periodo trae lo manual y lo del agente, y distingue", async () => {
    // @aitri-tc TC-AGT-160h
    const c = await cuenta("admin@admin.com");
    await conCincoMovimientos(c);
    const res = await movsGET(agentReq(`/movements?period=${OCT}`, { token: c.token }));
    expect(res.status).toBe(200);
    const { period, movements } = await res.json();
    expect(period).toBe(OCT);
    expect(movements).toHaveLength(5);

    const delAgente = movements.filter((m: { ref: string | null }) => m.ref !== null);
    const manuales = movements.filter((m: { ref: string | null }) => m.ref === null);
    expect(delAgente).toHaveLength(2);
    expect(manuales).toHaveLength(3);
    for (const m of delAgente) expect(m.agent).toEqual({ id: c.tokenId, name: "Agent-L" });
    for (const m of manuales) expect(m.agent).toBeNull();
    // Montos y fechas, los de cada movimiento.
    const resumenDe = (m: { amount: number; date: string; target: string }) => `${m.target}|${m.amount}|${m.date}`;
    expect(movements.map(resumenDe).sort()).toEqual([
      "c-salario|3000000|2026-10-05", "s-mercado|10000|2026-10-10", "s-mercado|50000|2026-10-10",
      "s-restaurantes|20000|2026-10-10", "s-viaje|200000|2026-10-10",
    ]);

    const l300 = movements.find((m: { ref: string }) => m.ref === "L300");
    expect(l300).toMatchObject({ type: "expense", target: "s-mercado", targetName: "Mercado", amount: 50_000, from: null, to: null });
    const l310 = movements.find((m: { ref: string }) => m.ref === "L310");
    expect(l310).toMatchObject({ type: "transfer", from: "@disponible", to: "s-viaje", amount: 200_000, targetName: "Viaje" });
  });

  it("TC-AGT-161h: buscar por referencia devuelve ese movimiento", async () => {
    // @aitri-tc TC-AGT-161h
    const c = await cuenta("admin@admin.com");
    await conCincoMovimientos(c);
    const res = await movsGET(agentReq("/movements?ref=L300", { token: c.token }));
    expect(res.status).toBe(200);
    expect((await res.json()).movement).toMatchObject({ ref: "L300", amount: 50_000, target: "s-mercado", period: OCT });
  });

  it("TC-AGT-162f: referencia inexistente o de otra cuenta responde not_found", async () => {
    // @aitri-tc TC-AGT-162f
    const a = await cuenta("admin@admin.com");
    const b = await cuenta("otra@example.com");
    const deB = await gastoManual(b.userId, "s-mercado", 70_000);
    await marcarComoAgente(b.userId, deB, "LB1", b.tokenId);

    const inexistente = await movsGET(agentReq("/movements?ref=L999", { token: a.token }));
    const ajena = await movsGET(agentReq("/movements?ref=LB1", { token: a.token }));
    expect(inexistente.status).toBe(404);
    expect(ajena.status).toBe(404);
    const [c1, c2] = [await inexistente.text(), await ajena.text()];
    expect(JSON.parse(c1).error.code).toBe("not_found");
    expect(c2).toBe(c1);
    // Y la dueña sí la encuentra: la referencia existe, solo que no en la cuenta A.
    expect((await movsGET(agentReq("/movements?ref=LB1", { token: b.token }))).status).toBe(200);
  });

  it("TC-AGT-163e: filtrar por un nodo padre devuelve su subárbol", async () => {
    // @aitri-tc TC-AGT-163e
    const c = await cuenta("admin@admin.com");
    await gastoManual(c.userId, "s-mercado", 10_000);
    await gastoManual(c.userId, "s-mercado", 15_000);
    await gastoManual(c.userId, "s-restaurantes", 20_000);
    await insertMovement(c.userId, { type: "income", catId: "c-salario", amount: 3_000_000, period: OCT, date: "2026-10-05" });

    const padre = await (await movsGET(agentReq(`/movements?period=${OCT}&node=c-alimentacion`, { token: c.token }))).json();
    const hoja = await (await movsGET(agentReq(`/movements?period=${OCT}&node=s-mercado`, { token: c.token }))).json();
    expect(padre.movements).toHaveLength(3);
    expect(hoja.movements).toHaveLength(2);
    for (const m of [...padre.movements, ...hoja.movements]) expect(m.type).toBe("expense");
    expect(hoja.movements.map((m: { amount: number }) => m.amount).sort()).toEqual([10_000, 15_000]);
  });

  it("TC-AGT-164e: un periodo sin movimientos responde lista vacía", async () => {
    // @aitri-tc TC-AGT-164e
    const c = await cuenta("admin@admin.com");
    await gastoManual(c.userId, "s-mercado", 10_000);
    const res = await movsGET(agentReq("/movements?period=2027-06", { token: c.token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ period: "2027-06", movements: [] });
  });

  it("TC-AGT-165f: periodo mal formado o nodo inexistente", async () => {
    // @aitri-tc TC-AGT-165f
    const c = await cuenta("admin@admin.com");
    const periodo = await movsGET(agentReq("/movements?period=2026-13", { token: c.token }));
    const nodo = await movsGET(agentReq(`/movements?period=${OCT}&node=s-noexiste`, { token: c.token }));
    expect(periodo.status).toBe(400);
    expect((await periodo.json()).error.code).toBe("invalid_period");
    expect(nodo.status).toBe(404);
    expect((await nodo.json()).error.code).toBe("not_found");
  });
});

describe("FR-3417 — periodo de una fecha", () => {
  it("TC-AGT-170h: cuenta por mes: 2026-10-10 es octubre entero", async () => {
    // @aitri-tc TC-AGT-170h
    const c = await cuenta("admin@admin.com");
    const res = await periodGET(agentReq("/period?date=2026-10-10", { token: c.token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ period: "2026-10", mode: "month", start: "2026-10-01", end: "2026-10-31", closed: false });
  });

  it("TC-AGT-171e: cuenta con ciclos y ciclo cerrado", async () => {
    // @aitri-tc TC-AGT-171e
    // Un ingreso REGISTRADO en el ciclo 21-ago…20-sep (celda y movimiento cuadran: el cierre lo
    // exige), para que haya un ciclo terminado que cerrar.
    const c = await cuenta("admin@admin.com");
    const ingreso = await insertMovement(c.userId, { type: "income", catId: "c-salario", amount: 750_000, period: SEP, date: "2026-09-05" });
    expect(ingreso && "movement" in ingreso).toBe(true);
    const ciclos = await applyCyclesFor(c.userId, await revision(c.userId), DIA21, "2026-10-10");
    expect(ciclos.ok, JSON.stringify(ciclos)).toBe(true);
    const cierre = await closeMonthFor(c.userId, await revision(c.userId), "2026-10-10");
    expect(cierre.ok, JSON.stringify(cierre)).toBe(true);

    const res = await periodGET(agentReq("/period?date=2026-09-10", { token: c.token }));
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p).toMatchObject({ mode: "cycle", start: "2026-08-21", end: "2026-09-20", closed: true });
    // El mismo periodo que la app asigna a un movimiento manual con esa fecha.
    const state = (await loadLedger(c.userId))!.state;
    expect(state.closure?.closedThrough).toBe(p.period);
    // Y el ciclo en curso, abierto.
    const actual = await (await periodGET(agentReq("/period?date=2026-10-10", { token: c.token }))).json();
    expect(actual).toMatchObject({ start: "2026-09-21", end: "2026-10-20", closed: false });
  });

  it("TC-AGT-172f: fecha inexistente, mal formada o ausente responde invalid_date", async () => {
    // @aitri-tc TC-AGT-172f
    const c = await cuenta("admin@admin.com");
    for (const consulta of ["?date=2026-02-30", "?date=hoy", "?date=2026-10", ""]) {
      const res = await periodGET(agentReq(`/period${consulta}`, { token: c.token }));
      expect(res.status, consulta).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_date");
    }
  });
});
