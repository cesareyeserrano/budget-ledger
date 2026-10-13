/**
 * Feature tony-ledger · EP-03 — Escrituras del agente.
 *
 * Módulo:       tests/integration/backend/agente-escrituras.test.ts
 * Propósito:    Registrar un gasto o un ingreso (FR-3408), no duplicar por referencia (FR-3409),
 *               reservar, sacar y mover (FR-3410), corregir (FR-3411) y deshacer (FR-3412), contra
 *               Postgres real y los route handlers reales. Cada rechazo se comprueba con su código
 *               exacto Y con que la base no cambió.
 * Dependencias: el Postgres efímero del globalSetup, ./helpers/agente.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { closeTestDb, testDb, truncateAll } from "./helpers/db";
import {
  OCT, ORIGIN, agentReq, apiReq, celda, celdas, conClave, crearToken, filasDeMovimiento, libro, limpiarTopes, newUser,
  nodos, revisionDe, sembrar, superficie, volcado,
} from "./helpers/agente";
import { closeMonthFor, insertMovement, loadLedger } from "@/server/data/ledgerRepo";
import { applyCyclesFor } from "@/server/data/cyclesRepo";
import { calendarOf } from "@/server/data/ledgerRepo";
import { computeBalanceSeries } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { periodRange } from "@/domain/periods";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain";
import { GET as movsGET, POST as movsPOST } from "@/app/api/agent/v1/movements/route";
import { DELETE as movDELETE, PATCH as movPATCH } from "@/app/api/agent/v1/movements/[key]/route";
import { GET as summaryGET } from "@/app/api/agent/v1/summary/route";
import { GET as periodGET } from "@/app/api/agent/v1/period/route";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as apiMovsPOST } from "@/app/api/v1/movements/route";

const SEP: PeriodKey = "2026-09";
const NOV: PeriodKey = "2026-11";
const DIA21 = { mode: "cycle", anchorDay: 21, eomPolicy: "last_day" } as const;

interface Cuenta { cookie: string; userId: string; token: string; tokenId: string }

/** Octubre con el salario ejecutado y Mercado en 100.000: margen de sobra para reservar. */
const conSalario = (id: string): LedgerState =>
  libro(id, { actuals: { "c-salario": { [OCT]: 3_000_000 }, "s-mercado": { [OCT]: 100_000 } } });

async function cuenta(email: string, state: (id: string) => LedgerState = conSalario): Promise<Cuenta> {
  const u = await newUser(email);
  await sembrar(u.userId, state(u.userId));
  const t = await crearToken(u.userId);
  return { ...u, token: t.token, tokenId: t.id };
}

const registrar = (c: Cuenta, body: unknown): Promise<Response> =>
  movsPOST(agentReq("/movements", { token: c.token, method: "POST", body }));
const corregir = (c: Cuenta, key: string, body: unknown): Promise<Response> =>
  movPATCH(agentReq(`/movements/${encodeURIComponent(key)}`, { token: c.token, method: "PATCH", body }), conClave(key));
const deshacer = (c: Cuenta, key: string): Promise<Response> =>
  movDELETE(agentReq(`/movements/${encodeURIComponent(key)}`, { token: c.token, method: "DELETE" }), conClave(key));

const gasto = (ref: string, amount = 50_000, target = "s-mercado", date = "2026-10-10") =>
  ({ type: "expense", target, amount, date, ref });
const reservar = (ref: string, amount: number, to = "s-viaje", date = "2026-10-10") =>
  ({ type: "transfer", from: "@disponible", to, amount, date, ref });
const sacar = (ref: string, amount: number, from = "s-viaje", date = "2026-10-12") =>
  ({ type: "transfer", from, to: "@disponible", amount, date, ref });

/** Registra y devuelve el movimiento creado; falla la prueba si no fue 201. */
async function creado(c: Cuenta, body: unknown): Promise<{ id: string; revision: number }> {
  const res = await registrar(c, body);
  const cuerpo = await res.json();
  expect(res.status, JSON.stringify(cuerpo)).toBe(201);
  return { id: cuerpo.movement.id, revision: cuerpo.revision };
}

async function resumen(c: Cuenta, period: PeriodKey = OCT): Promise<{
  balance: { available: number; reserved: number };
  pockets: { id: string; contributed: number; balance: number }[];
}> {
  return (await summaryGET(agentReq(`/summary?period=${period}`, { token: c.token }))).json();
}
async function saldo(c: Cuenta, pocket: string, period: PeriodKey = OCT): Promise<number> {
  return (await resumen(c, period)).pockets.find((p) => p.id === pocket)!.balance;
}

/** Deja septiembre cerrado: un ingreso registrado en él (celda y movimiento cuadran) y el cierre. */
async function cerrarSeptiembre(c: Cuenta): Promise<void> {
  const ingreso = await insertMovement(c.userId, { type: "income", catId: "c-salario", amount: 500_000, period: SEP, date: "2026-09-05" });
  expect(ingreso && "movement" in ingreso).toBe(true);
  const cierre = await closeMonthFor(c.userId, await revisionDe(c.userId), "2026-10-10");
  expect(cierre.ok, JSON.stringify(cierre)).toBe(true);
  expect((await loadLedger(c.userId))!.state.closure?.closedThrough).toBe(SEP);
}

/** Un movimiento registrado a mano (por la API del navegador). */
async function manual(c: Cuenta, amount: number, subId = "s-mercado"): Promise<string> {
  const res = await apiMovsPOST(apiReq("/api/v1/movements", {
    method: "POST", cookie: c.cookie, origin: ORIGIN,
    body: { type: "expense", catId: "c-alimentacion", subId, amount, period: OCT, date: "2026-10-09" },
  }));
  expect(res.status).toBe(201);
  return (await res.json()).movement.id;
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

describe("FR-3408 — registrar un gasto o un ingreso", () => {
  it("TC-AGT-080h: un gasto de 50.000 sube el Ejecutado de la hoja y de sus ancestros", async () => {
    // @aitri-tc TC-AGT-080h
    const c = await cuenta("admin@admin.com");
    const antes = await revisionDe(c.userId);
    const res = await registrar(c, { ...gasto("L300"), note: "Éxito" });
    expect(res.status).toBe(201);
    const { movement, revision } = await res.json();
    expect(movement).toMatchObject({
      type: "expense", target: "s-mercado", targetName: "Mercado", amount: 50_000, period: OCT, note: "Éxito", ref: "L300",
      agent: { id: c.tokenId, name: "Agent-L" },
    });
    expect(revision).toBe(antes + 1);
    expect(movement.date).toBe("2026-10-10");
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(150_000);
    // La fila, tal como quedó en la base.
    const [fila] = await filasDeMovimiento(c.userId);
    expect(fila).toMatchObject({
      id: movement.id, type: "expense", cat_id: "c-alimentacion", sub_id: "s-mercado", target: "s-mercado",
      amount: "50000", period: OCT, date: "2026-10-10", note: "Éxito", origin_ref: "L300", agent_name: "Agent-L",
    });

    // Los ancestros suben exactamente 50.000 por roll-up.
    const r = await (await summaryGET(agentReq(`/summary?period=${OCT}`, { token: c.token }))).json();
    const nodo = (id: string) => r.nodes.find((n: { id: string }) => n.id === id);
    expect(nodo("c-alimentacion").actual).toBe(150_000);
    expect(nodo("g-vida").actual).toBe(150_000);
    expect(r.totals.expense.actual).toBe(150_000);
  });

  it("TC-AGT-081h: un ingreso por el agente deja el libro igual que el mismo ingreso por la app", async () => {
    // @aitri-tc TC-AGT-081h
    const a1 = await cuenta("a1@example.com", (id) => libro(id));
    const a2 = await cuenta("a2@example.com", (id) => libro(id));
    const porAgente = await registrar(a1, { type: "income", target: "c-salario", amount: 3_000_000, date: "2026-10-05", ref: "L301" });
    const porApp = await apiMovsPOST(apiReq("/api/v1/movements", {
      method: "POST", cookie: a2.cookie, origin: ORIGIN,
      body: { type: "income", catId: "c-salario", amount: 3_000_000, period: OCT, date: "2026-10-05" },
    }));
    expect(porAgente.status).toBe(201);
    expect(porApp.status).toBe(201);

    expect(await celdas(a1.userId)).toEqual(await celdas(a2.userId));
    expect(await celdas(a1.userId)).toEqual([`c-salario|${OCT}|actual|3000000`]);
    const disponible = async (id: string) => {
      const state = (await loadLedger(id))!.state;
      return computeBalanceSeries(state, [OCT], openingCarry(state, [OCT]))[OCT].actual.available;
    };
    expect(await disponible(a1.userId)).toBe(3_000_000);
    expect(await disponible(a1.userId)).toBe(await disponible(a2.userId));
  });

  it("TC-AGT-082e: en una cuenta con ciclos el periodo es el que da el calendario a la fecha", async () => {
    // @aitri-tc TC-AGT-082e
    const c = await cuenta("admin@admin.com");
    const ciclos = await applyCyclesFor(c.userId, await revisionDe(c.userId), DIA21, "2026-10-10");
    expect(ciclos.ok, JSON.stringify(ciclos)).toBe(true);

    const res = await registrar(c, { type: "expense", target: "s-mercado", amount: 20_000, date: "2026-10-22", ref: "L302" });
    expect(res.status).toBe(201);
    const { movement } = await res.json();
    const delServidor = await (await periodGET(agentReq("/period?date=2026-10-22", { token: c.token }))).json();
    const state = (await loadLedger(c.userId))!.state;
    // El mismo periodo que el calendario del dueño —el que usa el registro manual— da a esa fecha.
    expect(movement.period).toBe(calendarOf(state).periodForDate("2026-10-22"));
    expect(movement.period).toBe(delServidor.period);
    expect(delServidor).toMatchObject({ mode: "cycle", start: "2026-10-21", end: "2026-11-20" });
    expect(movement.period).not.toBe(calendarOf(state).periodForDate("2026-10-10"));
    // Y el dinero cayó en ESE periodo, no en el del mes calendario de la fecha.
    expect(await celda(c.userId, "s-mercado", movement.period)).toBe(20_000);
    expect(await celda(c.userId, "s-mercado", calendarOf(state).periodForDate("2026-10-10"))).toBe(100_000);
  });

  it("TC-AGT-083f: destino inexistente, no hoja o de otro tipo: invalid_target y nada cambia", async () => {
    // @aitri-tc TC-AGT-083f
    const c = await cuenta("admin@admin.com");
    const antes = await volcado(c.userId);
    for (const [ref, target] of [["L303", "s-noexiste"], ["L304", "c-alimentacion"], ["L305", "c-salario"]]) {
      const res = await registrar(c, gasto(ref, 50_000, target));
      expect(res.status, target).toBe(422);
      expect((await res.json()).error.code, target).toBe("invalid_target");
    }
    expect(await volcado(c.userId)).toBe(antes);
    expect(await filasDeMovimiento(c.userId)).toHaveLength(0);
  });

  it("TC-AGT-084f: fecha en un periodo cerrado: closed_period_violation", async () => {
    // @aitri-tc TC-AGT-084f
    const c = await cuenta("admin@admin.com");
    await cerrarSeptiembre(c);
    const antes = await volcado(c.userId);
    const res = await registrar(c, gasto("L306", 50_000, "s-mercado", "2026-09-15"));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("closed_period_violation");
    expect(await volcado(c.userId)).toBe(antes);
    expect((await filasDeMovimiento(c.userId)).some((f) => f.origin_ref === "L306")).toBe(false);
  });

  it("TC-AGT-086e: con un libro de tamaño real, un registro toca una fila y una celda", async () => {
    // @aitri-tc TC-AGT-086e
    // 60 nodos, 24 periodos y 2000 movimientos que cuadran con sus celdas.
    const c = await cuenta("admin@admin.com", (id) => {
      const extra: LedgerNode[] = Array.from({ length: 48 }, (_, i) => ({
        id: `c-extra-${i}`, ownerId: id, type: "expense", level: "category", parentId: "g-vida", name: `Rubro ${i}`, icon: "tag", order: 100 + i,
      }));
      const periodos = periodRange("2026-01", "2027-12");
      const actuals: LedgerState["actuals"] = { "c-salario": {}, "s-mercado": { [OCT]: 100_000 } };
      const movements: Movement[] = [];
      for (const p of periodos) actuals["c-salario"]![p] = 9_000_000;
      for (let i = 0; i < 2000; i++) {
        const n = extra[i % extra.length];
        const p = periodos[i % periodos.length];
        actuals[n.id] = { ...(actuals[n.id] ?? {}) };
        actuals[n.id]![p] = (actuals[n.id]![p] ?? 0) + 1_000;
        movements.push({ id: `m-${i}`, ownerId: id, type: "expense", catId: n.id, subId: null, target: n.id, amount: 1_000, period: p, createdAt: i + 1, date: `${p}-05` });
      }
      return { ownerId: id, nodes: [...nodos(id), ...extra], budgets: {}, actuals, movements };
    });
    expect(await filasDeMovimiento(c.userId)).toHaveLength(2000);
    const antes = await celdas(c.userId);

    await creado(c, gasto("L307"));
    expect(await filasDeMovimiento(c.userId)).toHaveLength(2001);
    const despues = await celdas(c.userId);
    const distintas = despues.filter((f, i) => f !== antes[i]);
    expect(despues).toHaveLength(antes.length);
    expect(distintas).toEqual([`s-mercado|${OCT}|actual|150000`]);
  });

  it("TC-AGT-088f: una fecha fuera del calendario responde invalid_date", async () => {
    // @aitri-tc TC-AGT-088f
    const c = await cuenta("admin@admin.com");
    const inexistente = await registrar(c, gasto("L308", 1_000, "s-mercado", "2026-02-30"));
    expect(inexistente.status).toBe(422);
    expect((await inexistente.json()).error.code).toBe("invalid_payload");
    // 1999 es una fecha real, pero ningún periodo del sistema la contiene.
    const fuera = await registrar(c, gasto("L309", 1_000, "s-mercado", "1999-01-01"));
    expect(fuera.status).toBe(400);
    expect((await fuera.json()).error.code).toBe("invalid_date");
    expect(await filasDeMovimiento(c.userId)).toHaveLength(0);
  });
});

describe("FR-3409 — referencia de origen e idempotencia", () => {
  it("TC-AGT-090h: el mismo registro dos veces deja un solo movimiento", async () => {
    // @aitri-tc TC-AGT-090h
    const c = await cuenta("admin@admin.com");
    const primera = await registrar(c, gasto("L300"));
    const segunda = await registrar(c, gasto("L300"));
    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(200);
    const [a, b] = [await primera.json(), await segunda.json()];
    expect(b.movement.id).toBe(a.movement.id);
    expect(b.revision).toBe(a.revision);
    expect((await filasDeMovimiento(c.userId)).filter((f) => f.origin_ref === "L300")).toHaveLength(1);
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(150_000); // 100.000 + 50.000, no + 100.000
  });

  it("TC-AGT-091e: dos registros simultáneos con la misma referencia dejan uno", async () => {
    // @aitri-tc TC-AGT-091e
    const c = await cuenta("admin@admin.com");
    const [r1, r2] = await Promise.all([registrar(c, gasto("L301")), registrar(c, gasto("L301"))]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    const [a, b] = [await r1.json(), await r2.json()];
    expect(a.movement.id).toBe(b.movement.id);
    expect((await filasDeMovimiento(c.userId)).filter((f) => f.origin_ref === "L301")).toHaveLength(1);
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(150_000);
  });

  it("TC-AGT-092f: misma referencia con otro monto: conflicto y nada cambia", async () => {
    // @aitri-tc TC-AGT-092f
    const c = await cuenta("admin@admin.com");
    await creado(c, gasto("L300"));
    const antes = await volcado(c.userId);
    const res = await registrar(c, gasto("L300", 70_000));
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error.code).toBe("reference_conflict");
    expect(error.detail.movement).toMatchObject({ amount: 50_000, ref: "L300" });
    expect(await volcado(c.userId)).toBe(antes);
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(150_000);
    // También es conflicto con otra hoja, con otra fecha o con otro tipo de movimiento.
    expect((await registrar(c, gasto("L300", 50_000, "s-restaurantes"))).status).toBe(409);
    expect((await registrar(c, gasto("L300", 50_000, "s-mercado", "2026-10-11"))).status).toBe(409);
    expect((await registrar(c, { type: "income", target: "c-salario", amount: 50_000, date: "2026-10-10", ref: "L300" })).status).toBe(409);
    expect((await registrar(c, { type: "transfer", from: "@disponible", to: "s-viaje", amount: 50_000, date: "2026-10-10", ref: "L300" })).status).toBe(409);
    // Y en una operación de bolsillo, con otros extremos.
    await creado(c, reservar("L310", 200_000));
    const otrosExtremos = await registrar(c, reservar("L310", 200_000, "s-carro"));
    expect(otrosExtremos.status).toBe(409);
    expect((await otrosExtremos.json()).error.detail.movement).toMatchObject({ to: "s-viaje", ref: "L310" });
    expect(await celda(c.userId, "s-carro", OCT)).toBe(0);
  });

  it("TC-AGT-093e: la misma referencia en dos cuentas no choca", async () => {
    // @aitri-tc TC-AGT-093e
    const a = await cuenta("admin@admin.com");
    const b = await cuenta("otra@example.com");
    expect((await registrar(a, gasto("L300"))).status).toBe(201);
    expect((await registrar(b, gasto("L300"))).status).toBe(201);
    const filas = (await testDb().execute(sql`SELECT owner_id FROM "movement" WHERE origin_ref = 'L300'`)) as unknown as { owner_id: string }[];
    expect(filas.map((f) => f.owner_id).sort()).toEqual([a.userId, b.userId].sort());
  });

  it("TC-AGT-094f: sin referencia, vacía o de 129 caracteres: invalid_payload; 128 se acepta", async () => {
    // @aitri-tc TC-AGT-094f
    const c = await cuenta("admin@admin.com");
    const base = { type: "expense", target: "s-mercado", amount: 1_000, date: "2026-10-10" };
    for (const cuerpo of [base, { ...base, ref: "" }, { ...base, ref: "r".repeat(129) }]) {
      const res = await registrar(c, cuerpo);
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("invalid_payload");
    }
    expect(await filasDeMovimiento(c.userId)).toHaveLength(0);

    expect((await registrar(c, { ...base, ref: "r".repeat(128) })).status).toBe(201);
    const [fila] = await filasDeMovimiento(c.userId);
    expect(String(fila.origin_ref)).toHaveLength(128);
  });

  it("TC-AGT-095h: la referencia sobrevive a un reinicio del servidor", async () => {
    // @aitri-tc TC-AGT-095h
    const c = await cuenta("admin@admin.com");
    await creado(c, gasto("L300"));

    // «Reinicio»: se cierra el cliente de base de la app y se descartan TODOS sus módulos; lo que
    // sigue lo atiende código recién cargado con un pool nuevo. Lo único que sobrevive es Postgres.
    const g = globalThis as unknown as { __ledgerSql?: { end: (o: { timeout: number }) => Promise<void> }; __ledgerDb?: unknown };
    await g.__ledgerSql?.end({ timeout: 5 });
    delete g.__ledgerSql;
    delete g.__ledgerDb;
    vi.resetModules();
    const ruta = await import("@/app/api/agent/v1/movements/route");
    expect(ruta.GET).not.toBe(movsGET);

    const leido = await ruta.GET(agentReq("/movements?ref=L300", { token: c.token }));
    expect(leido.status).toBe(200);
    expect((await leido.json()).movement).toMatchObject({ ref: "L300", amount: 50_000, target: "s-mercado" });

    const reintento = await ruta.POST(agentReq("/movements", { token: c.token, method: "POST", body: gasto("L300") }));
    expect(reintento.status).toBe(200);
    expect(await filasDeMovimiento(c.userId)).toHaveLength(1);
  });

  it("TC-AGT-096e: deshacer libera la referencia", async () => {
    // @aitri-tc TC-AGT-096e
    const c = await cuenta("admin@admin.com");
    const primero = await creado(c, gasto("L300"));
    expect((await deshacer(c, "ref:L300")).status).toBe(200);

    const res = await registrar(c, gasto("L300", 60_000));
    expect(res.status).toBe(201);
    const { movement } = await res.json();
    expect(movement.id).not.toBe(primero.id);
    expect(movement.amount).toBe(60_000);
    expect((await filasDeMovimiento(c.userId)).filter((f) => f.origin_ref === "L300")).toHaveLength(1);
  });

  it("TC-AGT-097e: un reintento que solo cambia la nota no es conflicto ni reescribe", async () => {
    // @aitri-tc TC-AGT-097e
    const c = await cuenta("admin@admin.com");
    const { revision } = await creado(c, { ...gasto("L300"), note: "Éxito" });
    const res = await registrar(c, { ...gasto("L300"), note: "Éxito Calle 80" });
    expect(res.status).toBe(200);
    expect((await res.json()).movement.note).toBe("Éxito");
    expect(await revisionDe(c.userId)).toBe(revision);
    expect((await filasDeMovimiento(c.userId))[0].note).toBe("Éxito");
  });
});

describe("FR-3410 — operaciones de bolsillo", () => {
  it("TC-AGT-100h: reservar 200.000 de Disponible a «Viaje»", async () => {
    // @aitri-tc TC-AGT-100h
    const c = await cuenta("admin@admin.com", (id) => libro(id, { actuals: { "c-salario": { [OCT]: 3_000_000 } } }));
    expect((await resumen(c)).balance.available).toBe(3_000_000);
    const res = await registrar(c, reservar("L310", 200_000));
    expect(res.status).toBe(201);
    expect((await res.json()).movement).toMatchObject({ type: "transfer", from: "@disponible", to: "s-viaje", amount: 200_000, targetName: "Viaje" });

    expect(await celda(c.userId, "s-viaje", OCT)).toBe(200_000);
    const r = await resumen(c);
    expect(r.pockets.find((p) => p.id === "s-viaje")).toMatchObject({ contributed: 200_000, balance: 200_000 });
    expect(r.balance).toEqual({ available: 2_800_000, reserved: 200_000 });
  });

  it("TC-AGT-101h: sacar 50.000 de «Viaje» hacia Disponible", async () => {
    // @aitri-tc TC-AGT-101h
    const c = await cuenta("admin@admin.com", (id) => libro(id, { actuals: { "c-salario": { [OCT]: 3_000_000 } } }));
    await creado(c, reservar("L310", 200_000));
    const res = await registrar(c, sacar("L311", 50_000));
    expect(res.status).toBe(201);

    expect(await saldo(c, "s-viaje")).toBe(150_000);
    expect(await celda(c.userId, "s-viaje", OCT)).toBe(200_000); // el aporte del mes no cambia
    expect((await resumen(c)).balance.available).toBe(2_850_000);
  });

  it("TC-AGT-102e: mover 30.000 de «Viaje» a «Carro» no cambia el total reservado", async () => {
    // @aitri-tc TC-AGT-102e
    const c = await cuenta("admin@admin.com");
    await creado(c, reservar("L310", 200_000));
    const antes = await celdas(c.userId);
    const res = await registrar(c, { type: "transfer", from: "s-viaje", to: "s-carro", amount: 30_000, date: "2026-10-12", ref: "L312" });
    expect(res.status).toBe(201);

    const r = await resumen(c);
    expect(r.pockets.find((p) => p.id === "s-viaje")!.balance).toBe(170_000);
    expect(r.pockets.find((p) => p.id === "s-carro")!.balance).toBe(30_000);
    expect(r.balance.reserved).toBe(200_000);
    expect(await celdas(c.userId)).toEqual(antes); // un mover no escribe celdas de aporte
  });

  it("TC-AGT-103f: sacar más de lo que hay: piso con el límite real", async () => {
    // @aitri-tc TC-AGT-103f
    const c = await cuenta("admin@admin.com");
    await creado(c, reservar("L310", 200_000));
    const antes = await volcado(c.userId);
    const res = await registrar(c, sacar("L313", 250_000));
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.code).toBe("domain_rule_violation");
    expect(error.detail.violations).toEqual([{ rule: "piso", period: OCT, leafId: "s-viaje", limit: 200_000 }]);
    expect(await volcado(c.userId)).toBe(antes);
    expect(await saldo(c, "s-viaje")).toBe(200_000);
  });

  it("TC-AGT-104f: reservar por encima del margen del mes: techo", async () => {
    // @aitri-tc TC-AGT-104f
    const c = await cuenta("admin@admin.com", (id) => libro(id, { actuals: { "c-salario": { [OCT]: 1_000_000 } } }));
    const res = await registrar(c, reservar("L314", 1_000_001));
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.code).toBe("domain_rule_violation");
    expect(error.detail.violations).toHaveLength(1);
    expect(error.detail.violations[0]).toMatchObject({ rule: "techo", period: OCT, limit: 1_000_000 });
    expect(await celda(c.userId, "s-viaje", OCT)).toBe(0);
    // Y justo el límite sí cabe.
    expect((await registrar(c, reservar("L315", 1_000_000))).status).toBe(201);
    expect(await celda(c.userId, "s-viaje", OCT)).toBe(1_000_000);
  });

  it("TC-AGT-105f: extremos inválidos: invalid_target", async () => {
    // @aitri-tc TC-AGT-105f
    const c = await cuenta("admin@admin.com");
    const extremos = [
      { from: "s-viaje", to: "s-viaje" },
      { from: "@disponible", to: "@disponible" },
      { from: "s-mercado", to: "@disponible" },
      { from: "@disponible", to: "s-noexiste" },
      { from: "@disponible", to: "s-mercado" },   // el destino es una hoja de gasto, no un bolsillo
      { from: "s-viaje", to: "c-salario" },       // ni una de ingreso
      { from: "@disponible", to: "c-metas" },     // ni una categoría de bolsillos con hijos
    ];
    for (const [i, e] of extremos.entries()) {
      const res = await registrar(c, { type: "transfer", ...e, amount: 1_000, date: "2026-10-10", ref: `LX${i}` });
      expect(res.status, JSON.stringify(e)).toBe(422);
      expect((await res.json()).error.code, JSON.stringify(e)).toBe("invalid_target");
    }
    expect(await filasDeMovimiento(c.userId)).toHaveLength(0);
  });

  it("TC-AGT-106e: sacar exactamente todo el saldo deja el bolsillo en 0", async () => {
    // @aitri-tc TC-AGT-106e
    const c = await cuenta("admin@admin.com");
    await creado(c, reservar("L310", 200_000));
    expect((await registrar(c, sacar("L316", 200_000))).status).toBe(201);
    expect(await saldo(c, "s-viaje")).toBe(0);

    const uno = await registrar(c, sacar("L317", 1));
    expect(uno.status).toBe(422);
    expect((await uno.json()).error.detail.violations[0]).toMatchObject({ rule: "piso", leafId: "s-viaje", limit: 0 });
  });

  it("TC-AGT-107e: la idempotencia vale igual para una operación de bolsillo", async () => {
    // @aitri-tc TC-AGT-107e
    const c = await cuenta("admin@admin.com");
    const primera = await registrar(c, reservar("L310", 200_000));
    const segunda = await registrar(c, reservar("L310", 200_000));
    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(200);
    expect((await segunda.json()).movement.id).toBe((await primera.json()).movement.id);
    expect(await saldo(c, "s-viaje")).toBe(200_000); // no 400.000
    expect((await filasDeMovimiento(c.userId)).filter((f) => f.origin_ref === "L310")).toHaveLength(1);
  });
});

describe("FR-3411 — corregir un gasto o ingreso del agente", () => {
  it("TC-AGT-110h: cambiar la categoría mueve el monto de una hoja a la otra", async () => {
    // @aitri-tc TC-AGT-110h
    const c = await cuenta("admin@admin.com");
    const m = await creado(c, gasto("L300", 50_000, "s-restaurantes"));
    expect(await celda(c.userId, "s-restaurantes", OCT)).toBe(50_000);

    const res = await corregir(c, m.id, { target: "s-mercado" });
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.movement).toMatchObject({ target: "s-mercado", targetName: "Mercado", ref: "L300" });
    expect(cuerpo.revision).toBe(m.revision + 1);
    expect(await celda(c.userId, "s-restaurantes", OCT)).toBe(0);
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(150_000);
  });

  it("TC-AGT-111e: cambiar el monto y la fecha a otro periodo abierto", async () => {
    // @aitri-tc TC-AGT-111e
    // Noviembre todavía NO tiene ningún dato en el libro: la corrección lo añade al rango.
    const c = await cuenta("admin@admin.com");
    const m = await creado(c, gasto("L300"));
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(150_000);

    expect((await corregir(c, m.id, { amount: 45_000 })).status).toBe(200);
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(145_000);

    const movido = await corregir(c, m.id, { date: "2026-11-02" });
    expect(movido.status).toBe(200);
    expect((await movido.json()).movement.period).toBe(NOV);
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(100_000);
    expect(await celda(c.userId, "s-mercado", NOV)).toBe(45_000);
    // Y hacia atrás, a un mes anterior al primer dato; y cruzando el año.
    expect((await corregir(c, m.id, { date: "2026-09-30" })).status).toBe(200);
    expect(await celda(c.userId, "s-mercado", SEP)).toBe(45_000);
    expect(await celda(c.userId, "s-mercado", NOV)).toBe(0);
    const alOtroAnio = await corregir(c, m.id, { date: "2027-01-01" });
    expect(alOtroAnio.status).toBe(200);
    expect((await alOtroAnio.json()).movement).toMatchObject({ period: "2027-01", date: "2027-01-01", amount: 45_000 });
    expect(await celda(c.userId, "s-mercado", "2027-01")).toBe(45_000);
  });

  it("TC-AGT-112f: un movimiento registrado a mano no se puede corregir", async () => {
    // @aitri-tc TC-AGT-112f
    const c = await cuenta("admin@admin.com");
    const id = await manual(c, 80_000);
    const antes = await volcado(c.userId);
    const res = await corregir(c, id, { amount: 1 });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect(await volcado(c.userId)).toBe(antes);
    expect((await filasDeMovimiento(c.userId)).find((f) => f.id === id)!.amount).toBe("80000");
  });

  it("TC-AGT-113f: corregir en un periodo cerrado, o mover hacia uno cerrado, se rechaza", async () => {
    // @aitri-tc TC-AGT-113f
    const c = await cuenta("admin@admin.com");
    const enSeptiembre = await creado(c, gasto("L290", 50_000, "s-mercado", "2026-09-15"));
    const enOctubre = await creado(c, gasto("L300", 30_000));
    await cerrarSeptiembre(c);
    const antes = await volcado(c.userId);

    const cerrado = await corregir(c, enSeptiembre.id, { amount: 40_000 });
    const haciaCerrado = await corregir(c, enOctubre.id, { date: "2026-09-20" });
    for (const res of [cerrado, haciaCerrado]) {
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("closed_period_violation");
    }
    expect(await volcado(c.userId)).toBe(antes);
  });

  it("TC-AGT-114f: id inexistente y referencia de otra cuenta: el mismo 404", async () => {
    // @aitri-tc TC-AGT-114f
    const a = await cuenta("admin@admin.com");
    const b = await cuenta("otra@example.com");
    await creado(b, gasto("LB1", 70_000));
    const antesB = await volcado(b.userId);

    const inexistente = await corregir(a, "m-noexiste", { amount: 1 });
    const ajena = await corregir(a, "ref:LB1", { amount: 1 });
    expect(inexistente.status).toBe(404);
    expect(ajena.status).toBe(404);
    expect(await ajena.text()).toBe(await inexistente.text());
    expect(await volcado(b.userId)).toBe(antesB);
  });

  it("TC-AGT-115f: una operación de bolsillo no se corrige: unsupported_type", async () => {
    // @aitri-tc TC-AGT-115f
    const c = await cuenta("admin@admin.com");
    const m = await creado(c, reservar("L310", 200_000));
    const res = await corregir(c, m.id, { amount: 150_000 });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("unsupported_type");
    expect(await celda(c.userId, "s-viaje", OCT)).toBe(200_000);

    // Y un gasto no se puede llevar a un destino que no sea una hoja de gasto de ESTA cuenta.
    const otra = await cuenta("otra@example.com", (id) => libro(id, { prefijo: "b-" }));
    const g = await creado(c, gasto("L300"));
    const antes = await volcado(c.userId);
    for (const destino of ["s-noexiste", "c-salario", "c-alimentacion", "g-vida", "s-viaje", "b-s-mercado"]) {
      const r = await corregir(c, g.id, { target: destino });
      expect(r.status, destino).toBe(422);
      expect((await r.json()).error.code, destino).toBe("invalid_target");
    }
    expect(await volcado(c.userId)).toBe(antes);
    expect(otra.userId).not.toBe(c.userId);
  });

  it("TC-AGT-117e: corregir por referencia funciona igual y la marca no cambia", async () => {
    // @aitri-tc TC-AGT-117e
    const c = await cuenta("admin@admin.com");
    await creado(c, gasto("L 300/a"));
    const res = await corregir(c, "ref:L 300/a", { amount: 45_000 });
    expect(res.status).toBe(200);
    expect((await res.json()).movement).toMatchObject({ amount: 45_000, ref: "L 300/a" });
    const [fila] = await filasDeMovimiento(c.userId);
    expect(fila).toMatchObject({ amount: "45000", origin_ref: "L 300/a", agent_token_id: c.tokenId, agent_name: "Agent-L" });
  });
});

describe("FR-3412 — deshacer un movimiento del agente", () => {
  it("TC-AGT-120h: deshacer un gasto lo quita del Ejecutado y de las lecturas", async () => {
    // @aitri-tc TC-AGT-120h
    const c = await cuenta("admin@admin.com");
    const m = await creado(c, gasto("L300"));
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(150_000);

    const res = await deshacer(c, m.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: m.revision + 1 });
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(100_000);
    expect(await filasDeMovimiento(c.userId)).toHaveLength(0);
    expect((await movsGET(agentReq("/movements?ref=L300", { token: c.token }))).status).toBe(404);
  });

  it("TC-AGT-121h: deshacer una reserva devuelve el bolsillo y el Disponible", async () => {
    // @aitri-tc TC-AGT-121h
    const c = await cuenta("admin@admin.com", (id) => libro(id, { actuals: { "c-salario": { [OCT]: 3_000_000 } } }));
    await creado(c, reservar("L310", 200_000));
    expect((await resumen(c)).balance).toEqual({ available: 2_800_000, reserved: 200_000 });

    expect((await deshacer(c, "ref:L310")).status).toBe(200);
    expect(await celda(c.userId, "s-viaje", OCT)).toBe(0);
    const r = await resumen(c);
    expect(r.pockets.find((p) => p.id === "s-viaje")!.balance).toBe(0);
    expect(r.balance).toEqual({ available: 3_000_000, reserved: 0 });
    expect(await filasDeMovimiento(c.userId)).toHaveLength(0);
  });

  it("TC-AGT-122f: deshacer una reserva ya gastada en parte: piso", async () => {
    // @aitri-tc TC-AGT-122f
    const c = await cuenta("admin@admin.com");
    const reserva = await creado(c, reservar("L310", 200_000));
    await creado(c, sacar("L311", 150_000));
    const antes = await volcado(c.userId);

    const res = await deshacer(c, reserva.id);
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.code).toBe("domain_rule_violation");
    // El límite es lo que el bolsillo TIENE ahora (50.000), no un saldo negativo.
    expect(error.detail.violations).toEqual([{ rule: "piso", period: OCT, leafId: "s-viaje", limit: 50_000 }]);
    expect(await volcado(c.userId)).toBe(antes);
    expect(await celda(c.userId, "s-viaje", OCT)).toBe(200_000);
  });

  it("TC-AGT-123f: un movimiento registrado a mano no se puede deshacer", async () => {
    // @aitri-tc TC-AGT-123f
    const c = await cuenta("admin@admin.com", (id) => libro(id));
    const id = await manual(c, 80_000);
    const res = await deshacer(c, id);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect((await filasDeMovimiento(c.userId)).map((f) => f.id)).toEqual([id]);
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(80_000);
  });

  it("TC-AGT-124f: deshacer en un periodo cerrado se rechaza", async () => {
    // @aitri-tc TC-AGT-124f
    const c = await cuenta("admin@admin.com");
    const m = await creado(c, gasto("L290", 50_000, "s-mercado", "2026-09-15"));
    await cerrarSeptiembre(c);
    const antes = await volcado(c.userId);
    const res = await deshacer(c, m.id);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("closed_period_violation");
    expect(await volcado(c.userId)).toBe(antes);
  });

  it("TC-AGT-125e: deshacer dos veces: la segunda no encuentra nada", async () => {
    // @aitri-tc TC-AGT-125e
    const c = await cuenta("admin@admin.com");
    const m = await creado(c, gasto("L300"));
    const primera = await deshacer(c, m.id);
    const segunda = await deshacer(c, m.id);
    expect(primera.status).toBe(200);
    expect((await primera.json()).revision).toBe(m.revision + 1);
    expect(segunda.status).toBe(404);
    expect((await segunda.json()).error.code).toBe("not_found");
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(100_000);
    expect(await revisionDe(c.userId)).toBe(m.revision + 1);
  });

  it("TC-AGT-126e: deshacer un retiro y un mover del agente", async () => {
    // @aitri-tc TC-AGT-126e
    const c = await cuenta("admin@admin.com");
    await creado(c, reservar("L310", 200_000));
    const retiro = await creado(c, sacar("L311", 50_000));
    const mover = await creado(c, { type: "transfer", from: "s-viaje", to: "s-carro", amount: 30_000, date: "2026-10-12", ref: "L312" });
    expect([await saldo(c, "s-viaje"), await saldo(c, "s-carro")]).toEqual([120_000, 30_000]);

    expect((await deshacer(c, mover.id)).status).toBe(200);
    expect([await saldo(c, "s-viaje"), await saldo(c, "s-carro")]).toEqual([150_000, 0]);
    expect((await deshacer(c, retiro.id)).status).toBe(200);
    expect([await saldo(c, "s-viaje"), await saldo(c, "s-carro")]).toEqual([200_000, 0]);
    expect((await filasDeMovimiento(c.userId)).map((f) => f.origin_ref)).toEqual(["L310"]);

    // Deshacer un mover cuyo dinero YA se sacó del destino dejaría ese bolsillo en negativo: no.
    const otroMover = await creado(c, { type: "transfer", from: "s-viaje", to: "s-carro", amount: 30_000, date: "2026-10-13", ref: "L320" });
    await creado(c, sacar("L321", 30_000, "s-carro", "2026-10-14"));
    const antes = await volcado(c.userId);
    const rechazado = await deshacer(c, otroMover.id);
    expect(rechazado.status).toBe(422);
    const { error } = await rechazado.json();
    expect(error.code).toBe("domain_rule_violation");
    expect(error.detail.violations[0]).toMatchObject({ rule: "piso", leafId: "s-carro" });
    expect(await volcado(c.userId)).toBe(antes);
    expect([await saldo(c, "s-viaje"), await saldo(c, "s-carro")]).toEqual([170_000, 0]);
  });

  it("TC-AGT-127f: la celda del aporte ya fue bajada a mano: cell_already_changed", async () => {
    // @aitri-tc TC-AGT-127f
    const c = await cuenta("admin@admin.com");
    const reserva = await creado(c, reservar("L310", 200_000));
    // El dueño baja la celda del aporte a 100.000 en la grilla (guardado completo desde la app).
    const { revision, state } = await (await ledgerGET(apiReq("/api/v1/ledger", { cookie: c.cookie }))).json();
    state.actuals["s-viaje"] = { ...state.actuals["s-viaje"], [OCT]: 100_000 };
    const put = await ledgerPUT(apiReq("/api/v1/ledger", { method: "PUT", cookie: c.cookie, origin: ORIGIN, body: { baseRevision: revision, state } }));
    expect(put.status, await put.clone().text()).toBe(200);
    const antes = await volcado(c.userId);

    const res = await deshacer(c, reserva.id);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("cell_already_changed");
    expect(await volcado(c.userId)).toBe(antes);
    expect(await celda(c.userId, "s-viaje", OCT)).toBe(100_000);
  });
});
