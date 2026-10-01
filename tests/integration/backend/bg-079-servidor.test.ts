/**
 * BG-079 — cuatro defectos menores de servidor.
 *
 * Módulo:       tests/integration/backend/bg-079-servidor.test.ts
 * Propósito:    (a) la carga corrige la fecha del ajuste de apertura que la migración 0011 dejó fuera de
 *               su ciclo de transición, y con ella el ledger vuelve a poder guardarse; (d) tres entradas
 *               que pasaban la validación y la base rechazaba responden 409, 404 y 422 en vez de 500.
 * Dependencias: rutas reales GET/PUT /api/v1/ledger y POST /api/v1/movements; SQL directo para sembrar.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { buildSeed } from "@/domain";
import type { LedgerState } from "@/domain/types";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as movsPOST } from "@/app/api/v1/movements/route";
import { P0 } from "../../helpers/periods";

const ORIGIN = "http://localhost:3100";
const PASSWORD = "Contra$eña123";

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = "2026-11-05";
});
afterAll(async () => {
  delete process.env.LEDGER_TODAY;
  await closeTestDb();
});

let ip = 0;
async function usuario(nombre: string): Promise<{ cookie: string; userId: string }> {
  ip += 1;
  const { cookie } = await signUp(`${nombre}@example.com`, PASSWORD, nombre, `10.79.${Math.floor(ip / 250)}.${ip % 250}`);
  return { cookie, userId: (await getSessionUser(new Headers({ cookie })))!.userId };
}
function req(url: string, init: { method?: string; cookie: string; body?: unknown }): Request {
  return new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers: { cookie: init.cookie, origin: ORIGIN, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const put = (cookie: string, baseRevision: number, state: LedgerState) =>
  ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, body: { baseRevision, state } }));
const contar = async (tabla: "ledger" | "node" | "movement", userId: string) =>
  Number(((await testDb().execute(sql`SELECT count(*) AS n FROM ${sql.identifier(tabla)} WHERE owner_id = ${userId}`)) as unknown as { n: string }[])[0]!.n);

describe("BG-079 (a) · el ajuste de apertura de una celda de transición", () => {
  /** Día de pago 21, cambiado a 30 con primer pago el 30-oct: «2026-10t» va del 21 al 29 de octubre. */
  async function sembrar(userId: string) {
    await testDb().execute(sql`INSERT INTO ledger (owner_id, revision, data_version) VALUES (${userId}, 1, 7)`);
    await testDb().execute(sql`INSERT INTO node (owner_id, id, type, level, parent_id, name, icon, system, sort_order) VALUES
      (${userId}, 'g-g', 'expense', 'group', NULL, 'Esenciales', NULL, false, 0),
      (${userId}, 'taxi', 'expense', 'category', 'g-g', 'Taxi', NULL, false, 1)`);
    await testDb().execute(sql`INSERT INTO cycle_config_version (owner_id, mode, anchor_day, eom_policy, effective_from, first_pay, restore_start_month, created_at) VALUES
      (${userId}, 'cycle', 21, 'last_day', '2026-08-21', NULL, '2026-08', '2026-08-21T00:00:00Z'),
      (${userId}, 'cycle', 30, 'last_day', '2026-10-30', '2026-10-30', NULL, '2026-10-30T00:00:00Z')`);
    await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount) VALUES
      (${userId}, 'taxi', '2026-10t', 'actual', 45000)`);
    // Lo que dejó la migración 0011: el ajuste, fechado el día 1 del mes de la clave.
    await testDb().execute(sql`INSERT INTO movement (owner_id, id, type, cat_id, sub_id, target, amount, period, created_at, date, note, from_id, to_id, kind) VALUES
      (${userId}, 'adj-apertura-0123456789abcdef', 'expense', 'taxi', NULL, 'taxi', 45000, '2026-10t', 1, '2026-10-01T12:00', 'Ajuste de apertura', NULL, NULL, 'adjustment')`);
  }

  it("BG-079a: la carga le pone el primer día de su ciclo, sin tocar la cifra, y el ledger vuelve a guardar", async () => {
    const { cookie, userId } = await usuario("bg079-a");
    await sembrar(userId);

    const res = await ledgerGET(req("/api/v1/ledger", { cookie }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: number; state: LedgerState };
    expect(body.revision).toBe(2);
    expect(body.state.movements).toHaveLength(1);
    expect(body.state.movements[0]).toMatchObject({ id: "adj-apertura-0123456789abcdef", date: "2026-10-21T12:00", period: "2026-10t", amount: 45000 });
    expect(body.state.actuals).toEqual({ taxi: { "2026-10t": 45000 } });

    const [fila] = [...(await testDb().execute(sql`SELECT date, amount FROM movement WHERE owner_id = ${userId}`))] as { date: string; amount: string }[];
    expect(fila).toEqual({ date: "2026-10-21T12:00", amount: "45000" });

    // Antes, este guardado —y cualquier otro— respondía 422 period_mismatch.
    const guardado = await put(cookie, body.revision, { ...body.state, budgets: { taxi: { "2026-11": 60000 } } });
    expect(guardado.status).toBe(200);

    // Y una segunda carga ya no repara nada.
    const otra = (await (await ledgerGET(req("/api/v1/ledger", { cookie }))).json()) as { revision: number };
    expect(otra.revision).toBe(3);
  });
});

describe("BG-079 (d) · un 4xx donde antes salía un 500", () => {
  it("BG-079d: el primer guardado desde dos dispositivos a la vez da un 200 y un 409, nunca un 500", async () => {
    // La carrera depende del reloj: varias rondas, para que una sola con suerte no la dé por buena.
    for (let ronda = 0; ronda < 8; ronda++) {
      const { cookie, userId } = await usuario(`bg079-d1-${ronda}`);
      const semilla = buildSeed(userId, P0);
      const [a, b] = await Promise.all([put(cookie, 0, semilla), put(cookie, 0, semilla)]);
      expect([a.status, b.status].sort(), `ronda ${ronda}`).toEqual([200, 409]);
      const perdedor = (await (a.status === 409 ? a : b).json()) as { error?: { code?: string }; revision?: number };
      expect(perdedor.error?.code).toBe("revision_conflict");
      expect(perdedor.revision).toBe(1);
      expect(await contar("node", userId)).toBe(semilla.nodes.length);
      expect(await contar("ledger", userId)).toBe(1);
    }
  });

  it("BG-079d: registrar un movimiento sin haber guardado nunca el ledger responde 404 y no crea nada", async () => {
    const { cookie, userId } = await usuario("bg079-d2");
    const res = await movsPOST(req("/api/v1/movements", { method: "POST", cookie, body: { type: "expense", catId: "c-comida", amount: 8000, period: "2026-07" } }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
    expect(await contar("ledger", userId)).toBe(0);
    expect(await contar("movement", userId)).toBe(0);
  });

  it("BG-079d: un snapshot con un id repetido responde 422 y no escribe nada", async () => {
    const { cookie, userId } = await usuario("bg079-d3");
    const semilla = buildSeed(userId, P0);
    expect((await put(cookie, 0, semilla)).status).toBe(200);
    const nodos = await contar("node", userId);

    const nodoRepetido = { ...semilla, nodes: [...semilla.nodes, { ...semilla.nodes[0]! }] };
    const mov = { id: "m-1", ownerId: userId, type: "expense" as const, catId: "c-vivienda", subId: null, target: "c-vivienda", amount: 1000, period: P0, createdAt: 1 };
    const movimientoRepetido = { ...semilla, actuals: { "c-vivienda": { [P0]: 2000 } }, movements: [mov, { ...mov, createdAt: 2 }] };
    const nota = { id: "n-1", createdAt: 3, text: "Una nota" };
    const notaRepetida = { ...semilla, cellNotes: { "c-vivienda": { [P0]: [nota, { ...nota, createdAt: 4 }] } } };

    for (const [nombre, estado] of [["nodo", nodoRepetido], ["movimiento", movimientoRepetido], ["nota", notaRepetida]] as const) {
      const res = await put(cookie, 1, estado as LedgerState);
      expect(res.status, nombre).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code, nombre).toBe("invalid_payload");
    }
    expect(await contar("node", userId)).toBe(nodos);
    expect(await contar("movement", userId)).toBe(0);

    // El mismo id de nota en dos celdas DISTINTAS es legítimo: la clave es por celda.
    const dosCeldas = { ...semilla, cellNotes: { "c-vivienda": { [P0]: [nota] }, "c-transporte": { [P0]: [nota] } } };
    expect((await put(cookie, 1, dosCeldas as LedgerState)).status).toBe(200);
  });
});
