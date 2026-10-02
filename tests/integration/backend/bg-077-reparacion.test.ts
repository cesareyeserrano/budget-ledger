/**
 * BG-077 — la carga repara las notas de celda que el defecto dejó sin dueño.
 *
 * Módulo:       tests/integration/backend/bg-077-reparacion.test.ts
 * Propósito:    Sembrar por SQL el rastro exacto del defecto (una nota de un nodo borrado y otra de una
 *               categoría que después ganó una subcategoría) y comprobar que GET /api/v1/ledger lo repara
 *               una vez, sube la revisión y no toca ninguna cifra.
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
    (${userId}, 'gas', 'expense', 'category', 'g-g', 'Gasolina', NULL, false, 1),
    (${userId}, 'moto', 'expense', 'sub', 'gas', 'Moto', NULL, false, 2),
    (${userId}, 'taxi', 'expense', 'category', 'g-g', 'Taxi', NULL, false, 3)`);
  await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount) VALUES
    (${userId}, 'moto', '2026-09', 'budget', 80000),
    (${userId}, 'taxi', '2026-09', 'budget', 30000)`);
  await testDb().execute(sql`INSERT INTO cell_note (owner_id, node_id, period, id, created_at, text, date) VALUES
    (${userId}, 'borrado', '2026-02', 'n-borrado', 1, 'De un nodo que ya no existe', NULL),
    (${userId}, 'gas', '2026-09', 'n-padre', 2, 'Quedó en el padre', '2026-09-03'),
    (${userId}, 'taxi', '2026-09', 'n-sana', 3, 'Sana', NULL)`);
}

const get = (cookie: string) => ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`, { headers: { origin: ORIGIN, cookie } }));
// `revision` es bigint: el SQL directo lo devuelve como texto.
const revisionEnBase = async (userId: string) =>
  Number(((await testDb().execute(sql`SELECT revision FROM ledger WHERE owner_id = ${userId}`)) as unknown as { revision: string }[])[0].revision);

describe("BG-077 · la carga repara las notas sin dueño", () => {
  it("la nota del nodo borrado desaparece, la del padre pasa a su hoja y las cifras no cambian", async () => {
    const { cookie } = await signUp("bg077-a@example.com", "Contra$eña123", "bg077", "10.77.0.1");
    const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
    await sembrarDanado(userId);

    const res = await get(cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.state.cellNotes).sort()).toEqual(["moto", "taxi"]);
    expect(body.state.cellNotes.moto["2026-09"]).toEqual([
      { id: "n-padre", createdAt: 2, text: "Quedó en el padre", date: "2026-09-03" },
    ]);
    expect(body.state.cellNotes.taxi["2026-09"]).toEqual([{ id: "n-sana", createdAt: 3, text: "Sana" }]);

    const filas = [...(await testDb().execute(sql`SELECT node_id, id FROM cell_note WHERE owner_id = ${userId} ORDER BY id`))] as { node_id: string; id: string }[];
    expect(filas).toEqual([{ node_id: "moto", id: "n-padre" }, { node_id: "taxi", id: "n-sana" }]);
    expect(await revisionEnBase(userId)).toBe(2);
    expect(body.revision).toBe(2); // la que quedó en la base, no la leída antes de reparar

    // Ninguna cifra se movió.
    expect(body.state.budgets).toMatchObject({ moto: { "2026-09": 80000 }, taxi: { "2026-09": 30000 } });
    const celdas = [...(await testDb().execute(sql`SELECT node_id, amount FROM amount_cell WHERE owner_id = ${userId} ORDER BY node_id`))] as { node_id: string; amount: string }[];
    expect(celdas.map((c) => [c.node_id, Number(c.amount)])).toEqual([["moto", 80000], ["taxi", 30000]]);
  });

  it("una segunda carga no repara nada ni sube la revisión", async () => {
    const { cookie } = await signUp("bg077-b@example.com", "Contra$eña123", "bg077", "10.77.0.2");
    const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
    await sembrarDanado(userId);

    await get(cookie);
    const res = await get(cookie);
    expect((await res.json()).revision).toBe(2);
    expect(await revisionEnBase(userId)).toBe(2);
  });
});
