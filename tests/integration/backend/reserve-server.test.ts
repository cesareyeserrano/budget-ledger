/**
 * Feature transferencias (Reservas) — EP-03: el lado servidor contra Postgres efímero.
 * FR-1010 (migración lazy transaccional con marcador data_version; from/to por las cinco capas)
 * y FR-1004 (insertMovement persiste el diff multi-celda de una operación De→A en UNA transacción).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger, saveLedger, insertMovement } from "@/server/data/ledgerRepo";
import { AVAILABLE_ID, resolvedBalance } from "@/domain/reserve";
import type { LedgerNode, LedgerState } from "@/domain";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as movsPOST } from "@/app/api/v1/movements/route";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.7.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

async function newUser(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { cookie, userId };
}

function req(url: string, init: { method?: string; cookie?: string; body?: unknown; origin?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost:3100${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Estado mínimo: salario (income) + dos alcancías, con los montos que cada TC necesita. */
function makeState(ownerId: string, opts: { salario?: Partial<Record<string, number>>; viaje?: Partial<Record<string, number>>; fondo?: Partial<Record<string, number>> } = {}): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-trabajo", ownerId, type: "income", level: "group", parentId: null, name: "Trabajo", icon: "folder", order: 0 },
    { id: "c-salario", ownerId, type: "income", level: "category", parentId: "g-trabajo", name: "Salario", icon: "tag", order: 1 },
    { id: "g-ahorro", ownerId, type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: "folder", order: 2 },
    { id: "c-viaje", ownerId, type: "transfer", level: "category", parentId: "g-ahorro", name: "Viaje", icon: "tag", order: 3 },
    { id: "c-fondo", ownerId, type: "transfer", level: "category", parentId: "g-ahorro", name: "Fondo", icon: "tag", order: 4 },
  ];
  return {
    ownerId,
    nodes,
    budgets: {},
    actuals: {
      ...(opts.salario ? { "c-salario": opts.salario } : {}),
      ...(opts.viaje ? { "c-viaje": opts.viaje } : {}),
      ...(opts.fondo ? { "c-fondo": opts.fondo } : {}),
    } as LedgerState["actuals"],
    movements: [],
  };
}

beforeEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestDb();
});

describe("FR-1010 — migración lazy en el servidor", () => {
  it("TC-TRF-110e: dos cargas concurrentes migran exactamente una vez", async () => {
    // @aitri-tc TC-TRF-110e
    const { userId } = await newUser("mig@example.com");
    // Datos en semántica VIEJA (aportes mensuales): 100.000 en ene, feb y mar.
    const v2 = makeState(userId, { salario: { ene: 500_000 }, viaje: { ene: 100_000, feb: 100_000, mar: 100_000 } });
    expect((await saveLedger(userId, v2, 0)).ok).toBe(true);
    // saveLedger estampa v3; retroceder el marcador simula un ledger pre-feature.
    await testDb().execute(sql`UPDATE "ledger" SET data_version = 2 WHERE owner_id = ${userId}`);

    // Dos dispositivos cargan durante la ventana de migración.
    const [a, b] = await Promise.all([loadLedger(userId), loadLedger(userId)]);

    // Ambos ven el estado migrado (cumsum UNA vez, disperso: {100, 200, 300} y el resto arrastra —
    // jamás doble acumulado ni celdas materializadas de más).
    for (const r of [a, b]) {
      expect(r!.state.actuals["c-viaje"]).toEqual({ ene: 100_000, feb: 200_000, mar: 300_000 });
      expect(resolvedBalance(r!.state, "c-viaje", "dic", "actual")).toBe(300_000); // diciembre ARRASTRA
      expect(r!.state.actuals["c-salario"]).toEqual({ ene: 500_000 }); // income intacto
    }
    // El marcador quedó estampado y una tercera carga no re-acumula.
    const [row] = (await testDb().execute(sql`SELECT data_version FROM "ledger" WHERE owner_id = ${userId}`)) as unknown as { data_version: number }[];
    expect(row.data_version).toBe(3);
    const again = await loadLedger(userId);
    expect(again!.state.actuals["c-viaje"].mar).toBe(300_000);
  });

  it("TC-TRF-110f: from/to sobreviven las cinco capas; los movimientos viejos sin ellos siguen válidos", async () => {
    // @aitri-tc TC-TRF-110f
    const { cookie, userId } = await newUser("capas@example.com");
    // Snapshot inicial con un movimiento VIEJO (sin from/to) — sigue siendo válido en el PUT.
    const base = makeState(userId, { salario: { ene: 500_000 }, viaje: { ene: 200_000 } });
    base.movements = [
      { id: "m-viejo", ownerId: userId, type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 200_000, month: "ene", createdAt: 1 },
    ];
    const put = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, origin: ORIGIN, body: { baseRevision: 0, state: base } }));
    expect(put.status).toBe(200);

    // Capa API de entrada: POST de una operación De→A con from/to (capa 2), que el dominio ejecuta.
    const post = await movsPOST(
      req("/api/v1/movements", {
        method: "POST",
        cookie,
        origin: ORIGIN,
        body: { type: "transfer", catId: "c-viaje", amount: 50_000, month: "feb", from: "c-viaje", to: AVAILABLE_ID, note: "retiro por API" },
      })
    );
    expect(post.status).toBe(201);
    const created = (await post.json()) as { movement: { from?: string; to?: string; target: string } };
    expect(created.movement.from).toBe("c-viaje");
    expect(created.movement.to).toBe(AVAILABLE_ID);
    expect(created.movement.target).toBe("c-viaje"); // el sentinel jamás es target

    // Capa BD (capa 3): columnas from_id/to_id pobladas.
    const rows = (await testDb().execute(sql`SELECT from_id, to_id FROM "movement" WHERE owner_id = ${userId} AND note = 'retiro por API'`)) as unknown as { from_id: string | null; to_id: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].from_id).toBe("c-viaje");
    expect(rows[0].to_id).toBe(AVAILABLE_ID);

    // Capas rowsToState + GET (capas 4-5): el ciclo completo cliente→PUT→BD→GET→cliente conserva todo.
    const get = await ledgerGET(req("/api/v1/ledger", { cookie }));
    expect(get.status).toBe(200);
    const body = (await get.json()) as { state: LedgerState };
    const nuevo = body.state.movements.find((m) => m.note === "retiro por API")!;
    expect(nuevo.from).toBe("c-viaje");
    expect(nuevo.to).toBe(AVAILABLE_ID);
    const viejo = body.state.movements.find((m) => m.id === "m-viejo")!;
    expect(viejo.from).toBeUndefined(); // el movimiento pre-feature ni lanza ni gana campos fantasma
    expect(viejo.to).toBeUndefined();
  });
});

describe("FR-1004 — insertMovement multi-celda transaccional", () => {
  it("TC-TRF-304e: insertMovement del servidor persiste el diff multi-celda en una transacción", async () => {
    // @aitri-tc TC-TRF-304e
    const { cookie, userId } = await newUser("multicel@example.com");
    const base = makeState(userId, { salario: { ene: 1_000_000 }, viaje: { ene: 200_000 }, fondo: { ene: 800_000 } });
    const put = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, origin: ORIGIN, body: { baseRevision: 0, state: base } }));
    expect(put.status).toBe(200);

    // Mover 100.000 Viaje→Fondo en mayo (margen 0: el neto es cero, el techo global lo permite).
    const result = await insertMovement(userId, { type: "transfer", catId: "c-fondo", amount: 100_000, month: "may", from: "c-viaje", to: "c-fondo" });
    expect(result).not.toBeNull();

    // AMBAS celdas actualizadas en la tabla amount_cell…
    const cells = (await testDb().execute(
      sql`SELECT node_id, amount::int AS amount FROM "amount_cell" WHERE owner_id = ${userId} AND month = 'may' AND kind = 'actual' ORDER BY node_id`
    )) as unknown as { node_id: string; amount: number }[];
    expect(cells).toEqual([
      { node_id: "c-fondo", amount: 900_000 },
      { node_id: "c-viaje", amount: 100_000 },
    ]);
    // …la fila del movimiento con from_id/to_id…
    const movs = (await testDb().execute(sql`SELECT from_id, to_id, target FROM "movement" WHERE owner_id = ${userId} AND month = 'may'`)) as unknown as { from_id: string; to_id: string; target: string }[];
    expect(movs).toEqual([{ from_id: "c-viaje", to_id: "c-fondo", target: "c-fondo" }]);
    // …la revision subió exactamente 1 (1 del PUT inicial + 1 de la operación)…
    expect(result!.revision).toBe(2);
    // …y el GET devuelve el estado consistente.
    const get = await ledgerGET(req("/api/v1/ledger", { cookie }));
    const body = (await get.json()) as { revision: number; state: LedgerState };
    expect(body.revision).toBe(2);
    expect(body.state.actuals["c-viaje"].may).toBe(100_000);
    expect(body.state.actuals["c-fondo"].may).toBe(900_000);

    // Rechazo del dominio (sacar más del saldo): nada se persiste — transaccional, sin estado parcial.
    const rejected = await insertMovement(userId, { type: "transfer", catId: "c-viaje", amount: 999_999_999, month: "jun", from: "c-viaje", to: AVAILABLE_ID });
    expect(rejected).toBeNull();
    const after = (await testDb().execute(sql`SELECT count(*)::int AS n FROM "movement" WHERE owner_id = ${userId}`)) as unknown as { n: number }[];
    expect(after[0].n).toBe(1); // solo la operación válida — la rechazada no dejó rastro
  });
});
