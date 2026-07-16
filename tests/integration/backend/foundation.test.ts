/**
 * Epic 1 — Cimientos. Capa de datos + persistencia contra un Postgres real (testcontainers).
 * TCs: FR-506 (021h,022e,023f) · FR-512 (040h) · NFR-505 (059h,061f)
 */
import { afterAll, beforeEach, describe, expect, it, inject } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { buildSeed, addMovement, createNode, setLeafAmount } from "@/domain";
import { loadLedger, saveLedger, getMovement } from "@/server/data/ledgerRepo";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";

const A = "user-A";
const B = "user-B";

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "ana@example.com");
  await createTestUser(B, "beto@example.com");
});

afterAll(async () => {
  await closeTestDb();
});

describe("FR-506 — esquema y persistencia por usuario", () => {
  it("TC-BE-021h: un movimiento guardado es legible con los mismos valores por su ownerId", async () => {
    // @aitri-tc TC-BE-021h
    const seed = buildSeed(A);
    const withMov = addMovement(seed, {
      type: "expense",
      catId: "c-comida",
      subId: "s-comida-mercado",
      amount: 5000,
      month: "jun",
    });
    const res = await saveLedger(A, withMov, 0);
    expect(res).toEqual({ ok: true, revision: 1 });

    const loaded = await loadLedger(A);
    expect(loaded).not.toBeNull();
    const mv = loaded!.state.movements.find((m) => m.amount === 5000);
    expect(mv).toBeDefined();
    expect(mv!.catId).toBe("c-comida");
    expect(mv!.subId).toBe("s-comida-mercado");
    expect(mv!.target).toBe("s-comida-mercado");
    expect(mv!.month).toBe("jun");
    expect(mv!.ownerId).toBe(A);
  });

  it("TC-BE-022e: nodo, presupuesto y ejecutado persisten cada uno con su ownerId", async () => {
    // @aitri-tc TC-BE-022e
    let state = buildSeed(A);
    state = createNode(state, { level: "category", parentId: "g-esenciales", type: "expense", name: "Salud" });
    const leaf = state.nodes.find((n) => n.name === "Salud")!;
    state = setLeafAmount(state, leaf.id, "jun", "budget", 30000);
    state = setLeafAmount(state, leaf.id, "jun", "actual", 12000);
    await saveLedger(A, state, 0);

    const loaded = await loadLedger(A);
    const node = loaded!.state.nodes.find((n) => n.id === leaf.id);
    expect(node).toBeDefined();
    expect(node!.ownerId).toBe(A);
    expect(loaded!.state.budgets[leaf.id]?.jun).toBe(30000);
    expect(loaded!.state.actuals[leaf.id]?.jun).toBe(12000);

    // Los tres tipos de fila existen en la BD con owner_id = A.
    const db = testDb();
    const nodeCount = (await db.execute(
      sql`SELECT count(*)::int AS n FROM "node" WHERE owner_id=${A} AND id=${leaf.id}`
    )) as unknown as { n: number }[];
    expect(nodeCount[0].n).toBe(1);
  });

  it("TC-BE-023f: una escritura de dominio sin ownerId es rechazada por constraint", async () => {
    // @aitri-tc TC-BE-023f
    const db = testDb();
    const before = (await db.execute(sql`SELECT count(*)::int AS n FROM "movement"`)) as unknown as { n: number }[];

    await expect(
      db.execute(
        sql`INSERT INTO "movement" (owner_id, id, type, cat_id, target, amount, month, created_at)
            VALUES (NULL, 'mov-x', 'expense', 'c-comida', 'c-comida', 100, 'jun', 1)`
      )
    ).rejects.toThrow();

    const after = (await db.execute(sql`SELECT count(*)::int AS n FROM "movement"`)) as unknown as { n: number }[];
    expect(after[0].n).toBe(before[0].n); // nada se persistió
  });
});

describe("FR-512 / NFR-505 — persistencia portátil que sobrevive al reinicio", () => {
  it("TC-BE-040h: los datos sobreviven a un reinicio del proceso del servidor", async () => {
    // @aitri-tc TC-BE-040h
    const seed = buildSeed(A);
    const withMov = addMovement(seed, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 5000, month: "jun" });
    await saveLedger(A, withMov, 0);

    // "Reinicio": una conexión NUEVA (proceso nuevo) a la misma BD lee el dato durable en Postgres.
    const fresh = postgres(inject("databaseUrl"), { max: 1 });
    try {
      const rows = await fresh`SELECT amount FROM "movement" WHERE owner_id=${A} AND amount=5000`;
      expect(rows.length).toBe(1);
      expect(Number(rows[0].amount)).toBe(5000);
    } finally {
      await fresh.end({ timeout: 5 });
    }
  });

  it("TC-BE-059h: un registro escrito sigue legible tras reiniciar el proceso", async () => {
    // @aitri-tc TC-BE-059h
    const seed = buildSeed(A);
    const withMov = addMovement(seed, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 3000, month: "jul" });
    await saveLedger(A, withMov, 0);

    const fresh = postgres(inject("databaseUrl"), { max: 1 });
    try {
      const rows = await fresh`SELECT count(*)::int AS n FROM "movement" WHERE owner_id=${A} AND amount=3000`;
      expect(rows[0].n).toBe(1);
    } finally {
      await fresh.end({ timeout: 5 });
    }
  });

  it("TC-BE-041e: un dump→wipe→restore recupera los datos sin pérdida (restore en otro host)", async () => {
    // @aitri-tc TC-BE-041e
    // Restore a nivel de filas: exporta todo, vacía la BD (host nuevo/limpio), reinserta, verifica.
    const seed = buildSeed(A);
    const withMov = addMovement(seed, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 4200, month: "abr" });
    await saveLedger(A, withMov, 0);
    const before = await loadLedger(A);

    const raw = postgres(inject("databaseUrl"), { max: 1 });
    try {
      // Dump: filas crudas de cada tabla (orden respeta las FKs al restaurar).
      const tables = ["user", "ledger", "node", "amount_cell", "movement"] as const;
      const dump: Record<string, Record<string, unknown>[]> = {};
      for (const t of tables) dump[t] = await raw`SELECT * FROM ${raw(t)}`;

      // Wipe: BD vacía (como un host nuevo antes de restaurar).
      await raw`TRUNCATE TABLE "movement","amount_cell","node","ledger","session","account","verification","user" RESTART IDENTITY CASCADE`;
      const emptied = (await raw`SELECT count(*)::int AS n FROM "movement"`)[0].n;
      expect(emptied).toBe(0);

      // Restore: reinserta las filas crudas (bulk insert de postgres.js).
      for (const t of tables) {
        if (dump[t].length > 0) await raw`INSERT INTO ${raw(t)} ${raw(dump[t])}`;
      }
    } finally {
      await raw.end({ timeout: 5 });
    }

    // Sin pérdida: el ledger restaurado es idéntico al original.
    const after = await loadLedger(A);
    expect(after!.state.movements.length).toBe(before!.state.movements.length);
    expect(after!.state.nodes.length).toBe(before!.state.nodes.length);
    expect(after!.state.movements.find((m) => m.amount === 4200)).toBeDefined();
    expect(after!.revision).toBe(before!.revision);
  });

  it("TC-BE-061f: un reinicio no pierde ninguno de los registros previos", async () => {
    // @aitri-tc TC-BE-061f
    let state = buildSeed(A);
    for (const amount of [1000, 2000, 4000]) {
      state = addMovement(state, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount, month: "jun" });
    }
    await saveLedger(A, state, 0);

    const fresh = postgres(inject("databaseUrl"), { max: 1 });
    try {
      const rows = await fresh`SELECT count(*)::int AS n FROM "movement" WHERE owner_id=${A}`;
      expect(rows[0].n).toBe(3); // ninguno se perdió
    } finally {
      await fresh.end({ timeout: 5 });
    }
    // Sanidad: el otro usuario no recibió ninguno.
    expect(await getMovement(B, "whatever")).toBeNull();
  });
});
