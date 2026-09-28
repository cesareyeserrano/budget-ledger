/**
 * Feature saldo-de-bolsillo — una conversión que falla no deja escrituras parciales (TC-SDB-163f).
 *
 * Módulo:       tests/integration/backend/saldo-de-bolsillo-fallo.test.ts
 * Propósito:    Fichero aparte porque sustituye `convertPlannedRetiros` por una versión que lanza, y ese
 *               mock afectaría a cualquier otra prueba que compartiera el fichero.
 * Dependencias: ruta real GET /api/v1/ledger; SQL directo para sembrar el formato anterior.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("@/domain/reserve", async (orig) => {
  const real = await orig<typeof import("@/domain/reserve")>();
  return { ...real, convertPlannedRetiros: () => { throw new Error("fallo simulado de la conversión"); } };
});

import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { GET as ledgerGET } from "@/app/api/v1/ledger/route";

const ORIGIN = "http://localhost:3100";

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = "2026-10-05";
});
afterAll(async () => {
  delete process.env.LEDGER_TODAY;
  await closeTestDb();
});

describe("NFR-3007 · una conversión fallida no deja escrituras parciales", () => {
  /** @aitri-trace FR-ID: FR-3006, US-ID: US-3006, AC-ID: AC-3023, TC-ID: TC-SDB-163f */
  it("TC-SDB-163f: una conversión fallida no deja escrituras parciales", async () => {
    // @aitri-tc TC-SDB-163f
    const { cookie } = await signUp("sdb-163@example.com", "Contra$eña123", "sdb", "10.31.0.1");
    const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
    await testDb().execute(sql`INSERT INTO ledger (owner_id, revision, data_version) VALUES (${userId}, 1, 5)`);
    await testDb().execute(sql`INSERT INTO node (owner_id, id, type, level, parent_id, name, icon, system, sort_order) VALUES
      (${userId}, 'g-t', 'transfer', 'group', NULL, 'Reservas', NULL, false, 0),
      (${userId}, 'A', 'transfer', 'category', 'g-t', 'Ahorros', NULL, false, 1)`);
    await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount) VALUES
      (${userId}, 'A', '2026-09', 'budget', 1000), (${userId}, '@retiros', '2026-10', 'budget', 300)`);
    const antes = [...(await testDb().execute(sql`SELECT node_id, period, kind, amount FROM amount_cell WHERE owner_id = ${userId} ORDER BY node_id, period`))];

    const res = await ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`, { headers: { origin: ORIGIN, cookie } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.budgets["@retiros"]).toEqual({ "2026-10": 300 });

    const despues = [...(await testDb().execute(sql`SELECT node_id, period, kind, amount FROM amount_cell WHERE owner_id = ${userId} ORDER BY node_id, period`))];
    expect(despues).toEqual(antes);
    const [row] = (await testDb().execute(sql`SELECT data_version FROM ledger WHERE owner_id = ${userId}`)) as unknown as { data_version: number }[];
    expect(row.data_version).toBe(5);
  });
});
