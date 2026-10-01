/**
 * BG-078 (c) — la carga pone de acuerdo el `catId`/`subId` de cada movimiento con su destino.
 *
 * Módulo:       tests/integration/backend/bg-078-reparacion.test.ts
 * Propósito:    Sembrar por SQL los dos rastros del defecto (la forma que escribía el editor y el padre
 *               viejo tras mover una categoría) y comprobar que GET /api/v1/ledger los corrige una vez,
 *               sube la revisión y no toca ninguna cifra.
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
    (${userId}, 'g-g', 'expense', 'group', NULL, 'Esenciales', NULL, false, 0),
    (${userId}, 'casa', 'expense', 'category', 'g-g', 'Casa', NULL, false, 1),
    (${userId}, 'luz', 'expense', 'sub', 'casa', 'Luz', NULL, false, 2),
    (${userId}, 'agua', 'expense', 'sub', 'casa', 'Agua', NULL, false, 3),
    (${userId}, 'taxi', 'expense', 'category', 'g-g', 'Taxi', NULL, false, 4)`);
  await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount) VALUES
    (${userId}, 'luz', '2026-09', 'actual', 40000),
    (${userId}, 'agua', '2026-09', 'actual', 25000),
    (${userId}, 'taxi', '2026-09', 'actual', 12000)`);
  await testDb().execute(sql`INSERT INTO movement (owner_id, id, type, cat_id, sub_id, target, amount, period, created_at, date, note, from_id, to_id, kind) VALUES
    (${userId}, 'm-editor', 'expense', 'luz', NULL, 'luz', 40000, '2026-09', 1, '2026-09-05T10:00', NULL, NULL, NULL, 'manual'),
    (${userId}, 'm-padre-viejo', 'expense', 'taxi', 'agua', 'agua', 25000, '2026-09', 2, '2026-09-06T10:00', NULL, NULL, NULL, 'manual'),
    (${userId}, 'm-bien', 'expense', 'taxi', NULL, 'taxi', 12000, '2026-09', 3, '2026-09-07T10:00', NULL, NULL, NULL, 'manual')`);
}

const get = (cookie: string) => ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`, { headers: { origin: ORIGIN, cookie } }));
// `revision` es bigint: el SQL directo lo devuelve como texto.
const revisionEnBase = async (userId: string) =>
  Number(((await testDb().execute(sql`SELECT revision FROM ledger WHERE owner_id = ${userId}`)) as unknown as { revision: string }[])[0].revision);

describe("BG-078 (c) · la carga corrige el par categoría/subcategoría", () => {
  it("los dos movimientos incoherentes quedan con el par de su destino; las cifras no cambian", async () => {
    const { cookie } = await signUp("bg078-a@example.com", "Contra$eña123", "bg078", "10.78.0.1");
    const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
    await sembrarDanado(userId);

    const res = await get(cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    const par = (id: string) => {
      const m = body.state.movements.find((x: { id: string }) => x.id === id);
      return { catId: m.catId, subId: m.subId, target: m.target, amount: m.amount };
    };
    expect(par("m-editor")).toEqual({ catId: "casa", subId: "luz", target: "luz", amount: 40000 });
    expect(par("m-padre-viejo")).toEqual({ catId: "casa", subId: "agua", target: "agua", amount: 25000 });
    expect(par("m-bien")).toEqual({ catId: "taxi", subId: null, target: "taxi", amount: 12000 });

    const filas = [...(await testDb().execute(sql`SELECT id, cat_id, sub_id FROM movement WHERE owner_id = ${userId} ORDER BY id`))] as { id: string; cat_id: string; sub_id: string | null }[];
    expect(filas).toEqual([
      { id: "m-bien", cat_id: "taxi", sub_id: null },
      { id: "m-editor", cat_id: "casa", sub_id: "luz" },
      { id: "m-padre-viejo", cat_id: "casa", sub_id: "agua" },
    ]);
    expect(await revisionEnBase(userId)).toBe(2);
    expect(body.revision).toBe(2);
    expect(body.state.actuals).toEqual({ luz: { "2026-09": 40000 }, agua: { "2026-09": 25000 }, taxi: { "2026-09": 12000 } });
  });

  it("una segunda carga no repara nada ni sube la revisión", async () => {
    const { cookie } = await signUp("bg078-b@example.com", "Contra$eña123", "bg078", "10.78.0.2");
    const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
    await sembrarDanado(userId);

    await get(cookie);
    const res = await get(cookie);
    expect((await res.json()).revision).toBe(2);
    expect(await revisionEnBase(userId)).toBe(2);
  });
});
