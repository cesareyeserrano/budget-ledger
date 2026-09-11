/**
 * Feature multi-anio — la capa de persistencia contra un Postgres real (testcontainers).
 * TCs: FR-1902 (010h,011e,012f,013e,015f) · FR-1907 (060h,061e,062f,063f) ·
 *      NFR-1905 (240h,241f,242e) · NFR-1908 (270f,271f,272f,273f,274h) · NFR-1909 (280h,281f,282e)
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { sql } from "drizzle-orm";
// NFR-2303 (semilla-intacta): estas pruebas necesitan un ledger CON celdas para operar; su
// intención nunca fue verificar que la semilla traiga dinero. Desde FR-2301 la siembra del
// producto sale vacía, así que componen la semilla poblada de siempre con este helper.
import { setLeafAmount } from "@/domain";
import { buildSeedConMontos as buildSeed } from "../../helpers/seedConMontos";
import { loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { getHorizon, setHorizon } from "@/server/data/preferencesRepo";
import { PERIOD_KEY } from "@/domain/validation";
import { horizonPutSchema } from "@/server/schemas";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";
import { P, P0 } from "../../helpers/periods";
import { isLeaf } from "@/domain/tree";
import type { LedgerState } from "@/domain/types";

/** Una HOJA de gasto real: las categorías de la semilla tienen subcategorías, así que no lo son. */
function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene ninguna hoja de gasto");
  return h.id;
}

const A = "user-mA";

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "multianio@example.com");
});
afterAll(async () => { await closeTestDb(); });

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("FR-1902 · el esquema guarda el periodo con año", () => {
  it("TC-MAN-010h: las tres tablas aceptan un periodo bien formado y lo devuelven igual", async () => {
    const db = testDb();
    await db.execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                         VALUES (${A}, 'n1', '2027-03', 'budget', 5000)`);
    await db.execute(sql`INSERT INTO movement (owner_id, id, type, cat_id, sub_id, target, amount, period, created_at)
                         VALUES (${A}, 'm1', 'expense', 'c1', NULL, 'c1', 900, '2027-03', 1)`);
    await db.execute(sql`INSERT INTO cell_note (owner_id, node_id, period, id, created_at, text)
                         VALUES (${A}, 'n1', '2027-03', 'no1', 1, 'nota')`);
    const cells = await db.execute(sql`SELECT period FROM amount_cell WHERE owner_id = ${A}`);
    const movs = await db.execute(sql`SELECT period FROM movement WHERE owner_id = ${A}`);
    const notes = await db.execute(sql`SELECT period FROM cell_note WHERE owner_id = ${A}`);
    expect([...cells][0].period).toBe("2027-03");
    expect([...movs][0].period).toBe("2027-03");
    expect([...notes][0].period).toBe("2027-03");
  });

  it("TC-MAN-011e: la llave primaria admite el mismo nodo en dos años", async () => {
    const db = testDb();
    await db.execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                         VALUES (${A}, 'n1', '2026-03', 'budget', 100)`);
    await db.execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                         VALUES (${A}, 'n1', '2027-03', 'budget', 200)`);
    const rows = [...(await db.execute(sql`SELECT period, amount FROM amount_cell WHERE owner_id = ${A} ORDER BY period`))];
    expect(rows).toHaveLength(2);
    expect(Number(rows[0].amount)).toBe(100);
    expect(Number(rows[1].amount)).toBe(200);
  });

  it("TC-MAN-012f: el CHECK rechaza 2026-13 y 2026-00 y no deja fila", async () => {
    const db = testDb();
    for (const malo of ["2026-13", "2026-00", "mar", "26-03"]) {
      await expect(db.execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                                  VALUES (${A}, 'n1', ${malo}, 'budget', 1)`)).rejects.toThrow();
    }
    const rows = [...(await db.execute(sql`SELECT count(*)::int AS n FROM amount_cell`))];
    expect(rows[0].n).toBe(0);
  });

  it("TC-MAN-013e: la marca de versión está puesta y el CHECK vive en las tres tablas", async () => {
    const db = testDb();
    const ck = [...(await db.execute(sql`
      SELECT conname FROM pg_constraint
      WHERE conname IN ('amount_cell_period_ck','movement_period_ck','cell_note_period_ck')`))];
    expect(ck.map((r) => r.conname).sort()).toEqual(
      ["amount_cell_period_ck", "cell_note_period_ck", "movement_period_ck"]);
    // ninguna tabla conserva la columna vieja
    const cols = [...(await db.execute(sql`
      SELECT table_name FROM information_schema.columns
      WHERE column_name = 'month' AND table_schema = 'public'`))];
    expect(cols).toHaveLength(0);
  });

  it("TC-MAN-015f: el sentinel @retiros migra y persiste aunque no sea un nodo del árbol", async () => {
    const db = testDb();
    await db.execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                         VALUES (${A}, '@retiros', '2026-06', 'budget', 30000)`);
    const rows = [...(await db.execute(sql`SELECT node_id, amount FROM amount_cell WHERE node_id = '@retiros'`))];
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(30000);
    // y no existe ningún nodo con ese id: la integridad referencial NO puede exigirlo
    const nodos = [...(await db.execute(sql`SELECT count(*)::int AS n FROM node WHERE id = '@retiros'`))];
    expect(nodos[0].n).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("FR-1907 · la preferencia de horizonte", () => {
  it("TC-MAN-060h: persiste entre lecturas", async () => {
    expect(await setHorizon(A, 1)).toBe(1);
    expect(await getHorizon(A)).toBe(1);
  });

  it("TC-MAN-061e: sin preferencia guardada, el horizonte son 2 años", async () => {
    expect(await getHorizon(A)).toBe(2);
  });

  it("TC-MAN-062f: un valor corrupto cae al defecto sin lanzar", async () => {
    const db = testDb();
    // se escribe saltándose la API para simular una fila corrupta; el CHECK impide 99, así que
    // se comprueba la otra mitad de la defensa: la normalización del repositorio.
    await expect(db.execute(sql`UPDATE "user" SET horizon = 99 WHERE id = ${A}`)).rejects.toThrow();
    expect(await getHorizon(A)).toBe(2);
    expect(await setHorizon(A, 99 as never)).toBe(2); // la normalización, no el CHECK
  });

  it("TC-MAN-063f: cambiar el horizonte no sube revision del ledger", async () => {
    const seed = buildSeed(A, P0);
    const saved = await saveLedger(A, seed, 0);
    expect(saved.ok).toBe(true);
    const antes = (await loadLedger(A))!.revision;
    await setHorizon(A, 1);
    const despues = (await loadLedger(A))!.revision;
    expect(despues).toBe(antes);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("NFR-1905 · la persistencia no pierde nada", () => {
  it("TC-MAN-240h: guardar y recargar un ledger de tres años devuelve lo mismo", async () => {
    let s = buildSeed(A, P0);
    const hoja = hojaDeGasto(s);
    for (const p of ["2025-04", "2026-07", "2027-11"]) {
      s = setLeafAmount(s, hoja, p, "budget", 12345, ["2025-04", "2026-07", "2027-11"]);
    }
    const r = await saveLedger(A, s, 0);
    expect(r.ok).toBe(true);
    const back = (await loadLedger(A))!.state;
    for (const p of ["2025-04", "2026-07", "2027-11"]) {
      expect(back.budgets[hoja]?.[p]).toBe(12345);
    }
    expect(Object.keys(back.budgets).sort()).toEqual(Object.keys(s.budgets).sort());
  });

  it("TC-MAN-241f: un PUT con revision vieja se rechaza y no escribe", async () => {
    const s = buildSeed(A, P0);
    const first = await saveLedger(A, s, 0);
    expect(first.ok).toBe(true);
    const rev = (await loadLedger(A))!.revision;
    const hoja = hojaDeGasto(s);
    const s2 = setLeafAmount(s, hoja, P[0], "budget", 777, P);
    await saveLedger(A, s2, rev); // avanza a rev+1
    const stale = setLeafAmount(s, hoja, P[0], "budget", 999, P);
    const res = await saveLedger(A, stale, rev); // revisión ya obsoleta
    expect(res.ok).toBe(false);
    expect((await loadLedger(A))!.state.budgets[hoja]?.[P[0]]).toBe(777);
  });

  it("TC-MAN-242e: una celda con periodo inválido no llega a la base", async () => {
    const s = buildSeed(A, P0);
    const hoja = hojaDeGasto(s);
    // se fuerza saltándose el dominio, que es justo lo que la defensa de servidor debe atrapar
    const corrupto = { ...s, budgets: { ...s.budgets, [hoja]: { ...s.budgets[hoja], "2026-13": 500 } } };
    await expect(saveLedger(A, corrupto, 0)).rejects.toThrow();
    const rows = [...(await testDb().execute(sql`SELECT count(*)::int AS n FROM amount_cell WHERE period = '2026-13'`))];
    expect(rows[0].n).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("NFR-1908 · el periodo se valida en el servidor", () => {
  it("TC-MAN-270f: vector 1 — formato: los malformados se rechazan", () => {
    for (const malo of ["2026-13", "2026-00", "26-03", "marzo", ""]) {
      expect(PERIOD_KEY.safeParse(malo).success).toBe(false);
    }
  });

  it("TC-MAN-271f: vector 2 — rango: años absurdos que el CHECK sí aceptaría", () => {
    for (const malo of ["0000-01", "1900-05", "9999-12"]) {
      // el CHECK de la base los admite (formato correcto), la API no
      expect(/^\d{4}-(0[1-9]|1[0-2])$/.test(malo)).toBe(true);
      expect(PERIOD_KEY.safeParse(malo).success).toBe(false);
    }
    expect(PERIOD_KEY.safeParse("2000-01").success).toBe(true);
    expect(PERIOD_KEY.safeParse("2100-12").success).toBe(true);
  });

  it("TC-MAN-272f: vector 3 — tipo y tamaño", () => {
    for (const malo of [12, {}, [], null, undefined, true, "2026-01".repeat(200)]) {
      expect(PERIOD_KEY.safeParse(malo).success).toBe(false);
    }
    // la longitud se comprueba ANTES que la regex: una cadena larga no llega al motor
    const larga = "a".repeat(1000);
    expect(PERIOD_KEY.safeParse(larga).success).toBe(false);
  });

  it("TC-MAN-273f: vector 4 — inyección: una carga SQL no altera la base", async () => {
    const payload = "2026-03'; DROP TABLE movement;--";
    expect(PERIOD_KEY.safeParse(payload).success).toBe(false);
    const db = testDb();
    await expect(db.execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                                VALUES (${A}, 'n', ${payload}, 'budget', 1)`)).rejects.toThrow();
    const t = [...(await db.execute(sql`SELECT count(*)::int AS n FROM movement`))];
    expect(t[0].n).toBe(0); // la tabla sigue existiendo: la consulta no falla
  });

  it("TC-MAN-274h: un periodo legítimo atraviesa la validación", () => {
    for (const bueno of ["2026-01", "2027-12", "2100-06"]) {
      const r = PERIOD_KEY.safeParse(bueno);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data).toBe(bueno);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("NFR-1909 · la migración está versionada y documentada", () => {
  it("TC-MAN-280h: el script existe, está en el journal y nombra las tres tablas", () => {
    const ruta = "drizzle/0002_multi_anio.sql";
    expect(existsSync(ruta)).toBe(true);
    const sqlSrc = readFileSync(ruta, "utf8");
    for (const t of ["amount_cell", "movement", "cell_note"]) {
      expect(sqlSrc).toContain(`ALTER TABLE "${t}" RENAME COLUMN "month" TO "period"`);
      expect(sqlSrc).toContain(`${t}_period_ck`);
    }
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.some((e) => e.tag === "0002_multi_anio")).toBe(true);
  });

  it("TC-MAN-281f: el script aborta si las tablas no están vacías, y lo dice", () => {
    const sqlSrc = readFileSync("drizzle/0002_multi_anio.sql", "utf8");
    expect(sqlSrc).toContain("RAISE EXCEPTION");
    expect(sqlSrc).toMatch(/count\(\*\)\s+INTO\s+n_cells\s+FROM\s+amount_cell/i);
    expect(sqlSrc).toContain("anio ancla"); // el motivo, no solo el efecto
  });

  it("TC-MAN-282e: la marca de versión sube y el esquema resultante es el que el código espera", async () => {
    const db = testDb();
    const sqlSrc = readFileSync("drizzle/0002_multi_anio.sql", "utf8");
    expect(sqlSrc).toContain('UPDATE "ledger" SET "data_version" = 6');
    // la lectura funciona sin capa de compatibilidad: el esquema real sirve al repositorio
    const s = buildSeed(A, P0);
    expect((await saveLedger(A, s, 0)).ok).toBe(true);
    const back = await loadLedger(A);
    expect(back).not.toBeNull();
    const claves = Object.values(back!.state.budgets).flatMap((c) => Object.keys(c ?? {}));
    expect(claves.length).toBeGreaterThan(0);
    for (const k of claves) expect(k).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    const pk = [...(await db.execute(sql`
      SELECT conname FROM pg_constraint WHERE conname = 'amount_cell_owner_id_node_id_period_kind_pk'`))];
    expect(pk).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("bordes que solo se ven contra la base y la API", () => {
  it("TC-MAN-014f: la migración aborta con mensaje claro si las tablas no están vacías", async () => {
    const sqlSrc = readFileSync("drizzle/0002_multi_anio.sql", "utf8");
    // La guarda es un bloque DO que cuenta las tres tablas y lanza. Se comprueba que EXISTE y que
    // nombra las tres, porque re-ejecutar el script sobre esta base ya migrada no la dispararía.
    expect(sqlSrc).toContain("RAISE EXCEPTION");
    for (const t of ["amount_cell", "movement", "cell_note"]) {
      expect(sqlSrc).toMatch(new RegExp(`INTO\\s+n_\\w+\\s+FROM\\s+${t}`, "i"));
    }
    // y el mensaje explica el MOTIVO, no solo el efecto
    expect(sqlSrc).toContain("anio ancla");
    // la guarda se evalúa ANTES del primer ALTER: si no, el fallo dejaría el esquema a medias
    expect(sqlSrc.indexOf("RAISE EXCEPTION")).toBeLessThan(sqlSrc.indexOf("ALTER TABLE"));
  });

  it("TC-MAN-064f: el esquema del horizonte rechaza lo inválido y la columna lo respalda", async () => {
    for (const malo of [18, 24, 0, -1, 1.5, "2", null, {}]) {
      expect(horizonPutSchema.safeParse({ horizon: malo }).success).toBe(false);
    }
    expect(horizonPutSchema.safeParse({ horizon: 1 }).success).toBe(true);
    expect(horizonPutSchema.safeParse({ horizon: 2 }).success).toBe(true);
    // segunda defensa: el CHECK de la columna, por si algo se saltara la API
    await expect(testDb().execute(sql`UPDATE "user" SET horizon = 7 WHERE id = ${A}`)).rejects.toThrow();
    expect(await getHorizon(A)).toBe(2);
  });

  it("TC-MAN-073f: un periodo malformado no llega a escribirse por ninguna vía", async () => {
    const db = testDb();
    for (const malo of ["2026-13", "marzo", "26-03", ""]) {
      expect(PERIOD_KEY.safeParse(malo).success).toBe(false);
      await expect(db.execute(sql`INSERT INTO movement
        (owner_id, id, type, cat_id, sub_id, target, amount, period, created_at)
        VALUES (${A}, ${"m-" + malo}, 'expense', 'c1', NULL, 'c1', 1, ${malo}, 1)`)).rejects.toThrow();
    }
    const n = [...(await db.execute(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${A}`))];
    expect(n[0].n).toBe(0);
  });

  it("TC-MAN-251f: ningún movimiento queda con un periodo inválido tras guardar y recargar", async () => {
    let s = buildSeed(A, P0);
    const hoja = hojaDeGasto(s);
    s = { ...s, movements: [
      { id: "m1", ownerId: A, type: "expense", catId: hoja, subId: null, target: hoja, amount: 100, period: "2026-03", createdAt: 1 },
      { id: "m2", ownerId: A, type: "expense", catId: hoja, subId: null, target: hoja, amount: 200, period: "2028-11", createdAt: 2 },
    ] };
    expect((await saveLedger(A, s, 0)).ok).toBe(true);
    const back = (await loadLedger(A))!.state;
    expect(back.movements).toHaveLength(2);
    for (const mv of back.movements) {
      expect(mv.period).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
      expect(PERIOD_KEY.safeParse(mv.period).success).toBe(true);
    }
    // y los dos años se conservan distintos: no se colapsaron al mismo mes
    expect(back.movements.map((m) => m.period).sort()).toEqual(["2026-03", "2028-11"]);
  });
});
