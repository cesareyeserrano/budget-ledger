/**
 * BG-053 — la carga repara los movimientos que el defecto dejó apuntando a un bolsillo que ya no es hoja.
 *
 * Módulo:       tests/integration/backend/bg-053-reparacion.test.ts
 * Propósito:    Sembrar por SQL el rastro exacto del defecto (un traslado A→B cuyo destino B ganó después
 *               un hijo, sin celdas propias) y comprobar que GET /api/v1/ledger lo repara una vez, sube la
 *               revisión y devuelve la revisión que quedó en la base.
 * Dependencias: ruta real GET /api/v1/ledger; SQL directo para sembrar.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { GET as ledgerGET } from "@/app/api/v1/ledger/route";

const ORIGIN = "http://localhost:3100";

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = "2026-09-20";
});
afterAll(async () => {
  delete process.env.LEDGER_TODAY;
  await closeTestDb();
});

async function sembrarDanado(userId: string) {
  await testDb().execute(sql`INSERT INTO ledger (owner_id, revision, data_version) VALUES (${userId}, 1, 7)`);
  await testDb().execute(sql`INSERT INTO node (owner_id, id, type, level, parent_id, name, icon, system, sort_order) VALUES
    (${userId}, 'g-i', 'income', 'group', NULL, 'Ingresos', NULL, false, 0),
    (${userId}, 'ing', 'income', 'category', 'g-i', 'Sueldo', NULL, false, 1),
    (${userId}, 'g-t', 'transfer', 'group', NULL, 'Reservas', NULL, false, 2),
    (${userId}, 'A', 'transfer', 'category', 'g-t', 'Viaje', NULL, false, 3),
    (${userId}, 'B', 'transfer', 'category', 'g-t', 'Ahorros', NULL, false, 4),
    (${userId}, 'b1', 'transfer', 'sub', 'B', 'Fondo', NULL, false, 5)`);
  await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount) VALUES
    (${userId}, 'ing', '2026-09', 'actual', 1000000),
    (${userId}, 'A', '2026-09', 'actual', 500000)`);
  await testDb().execute(sql`INSERT INTO movement (owner_id, id, type, cat_id, sub_id, target, amount, period, created_at, date, note, from_id, to_id, kind) VALUES
    (${userId}, 'm-ing', 'income', 'ing', NULL, 'ing', 1000000, '2026-09', 1, '2026-09-05T10:00', NULL, NULL, NULL, 'manual'),
    (${userId}, 'm-aporte', 'transfer', 'A', NULL, 'A', 500000, '2026-09', 2, '2026-09-10T10:00', NULL, '@disponible', 'A', 'manual'),
    (${userId}, 'm-mover', 'transfer', 'B', NULL, 'B', 200000, '2026-09', 3, '2026-09-11T10:00', NULL, 'A', 'B', 'manual')`);
}

const get = (cookie: string) => ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`, { headers: { origin: ORIGIN, cookie } }));
// `revision` es bigint: el SQL directo lo devuelve como texto.
const revisionEnBase = async (userId: string) =>
  Number(((await testDb().execute(sql`SELECT revision FROM ledger WHERE owner_id = ${userId}`)) as unknown as { revision: string }[])[0].revision);

describe("BG-053 · la carga repara el rastro del defecto", () => {
  it("el traslado pasa al único hijo del bolsillo, la revisión sube y la respuesta la trae", async () => {
    const { cookie } = await signUp("bg053-a@example.com", "Contra$eña123", "bg053", "10.53.0.1");
    const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
    await sembrarDanado(userId);

    const res = await get(cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    const mover = body.state.movements.find((m: { id: string }) => m.id === "m-mover");
    expect(mover).toMatchObject({ from: "A", to: "b1", target: "b1", catId: "B", subId: "b1" });

    const [fila] = [...(await testDb().execute(sql`SELECT to_id, target FROM movement WHERE owner_id = ${userId} AND id = 'm-mover'`))] as { to_id: string; target: string }[];
    expect(fila).toEqual({ to_id: "b1", target: "b1" });
    expect(await revisionEnBase(userId)).toBe(2);
    expect(body.revision).toBe(2); // la que quedó en la base, no la leída antes de reparar

    // Nada más se perdió: los otros movimientos y las celdas siguen ahí.
    expect(body.state.movements).toHaveLength(3);
    expect(body.state.actuals).toMatchObject({ ing: { "2026-09": 1000000 }, A: { "2026-09": 500000 } });
  });

  it("una segunda carga no repara nada ni sube la revisión", async () => {
    const { cookie } = await signUp("bg053-b@example.com", "Contra$eña123", "bg053", "10.53.0.2");
    const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
    await sembrarDanado(userId);

    await get(cookie);
    const res = await get(cookie);
    expect((await res.json()).revision).toBe(2);
    expect(await revisionEnBase(userId)).toBe(2);
  });
});
