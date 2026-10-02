/**
 * BG-089 — el plano de un comentario viaja al servidor y vuelve, y la migración 0012 no toca lo viejo.
 *
 * Módulo:       tests/integration/backend/bg-089-comentarios-por-plano.test.ts
 * Propósito:    Un comentario de Presupuestado se guarda con `plane = 'budget'` y vuelve con él; uno de
 *               Ejecutado se guarda con NULL y vuelve sin el campo, igual que los anteriores a la
 *               migración. La 0012 se prueba en una base APARTE del mismo contenedor, como la 0010.
 * Dependencias: rutas reales GET/PUT /api/v1/ledger; SQL directo; drizzle/0012.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { buildSeed } from "@/domain";
import type { LedgerState } from "@/domain/types";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { P0 } from "../../helpers/periods";

const ORIGIN = "http://localhost:3100";

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closeTestDb(); });

async function usuario(nombre: string, ip: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(`${nombre}@example.com`, "Contra$eña123", nombre, ip);
  return { cookie, userId: (await getSessionUser(new Headers({ cookie })))!.userId };
}
const put = (cookie: string, baseRevision: number, state: unknown) =>
  ledgerPUT(new Request(`${ORIGIN}/api/v1/ledger`, { method: "PUT", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ baseRevision, state }) }));
const get = (cookie: string) => ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`, { headers: { cookie, origin: ORIGIN } }));

describe("BG-089 · el plano del comentario, de ida y vuelta", () => {
  it("el de Presupuestado se guarda con su plano; el de Ejecutado, sin él", async () => {
    const { cookie, userId } = await usuario("bg089-a", "10.89.0.1");
    const estado: LedgerState = {
      ...buildSeed(userId, P0),
      cellNotes: { "c-vivienda": { [P0]: [
        { id: "n-ejec", createdAt: 1, text: "Del ejecutado" },
        { id: "n-plan", createdAt: 2, text: "Del presupuesto", plane: "budget" },
      ] } },
    };
    expect((await put(cookie, 0, estado)).status).toBe(200);

    const filas = [...(await testDb().execute(sql`SELECT id, plane FROM cell_note WHERE owner_id = ${userId} ORDER BY id`))] as { id: string; plane: string | null }[];
    expect(filas).toEqual([{ id: "n-ejec", plane: null }, { id: "n-plan", plane: "budget" }]);

    const body = (await (await get(cookie)).json()) as { state: LedgerState };
    expect(body.state.cellNotes!["c-vivienda"]![P0]).toEqual([
      { id: "n-ejec", createdAt: 1, text: "Del ejecutado" },
      { id: "n-plan", createdAt: 2, text: "Del presupuesto", plane: "budget" },
    ]);
  });

  it("una pestaña con el código anterior, que reenvía los comentarios sin plano, no los cambia de celda", async () => {
    const { cookie, userId } = await usuario("bg089-c", "10.89.0.3");
    const estado: LedgerState = {
      ...buildSeed(userId, P0),
      cellNotes: { "c-vivienda": { [P0]: [
        { id: "n-ejec", createdAt: 1, text: "Del ejecutado" },
        { id: "n-plan", createdAt: 2, text: "Del presupuesto", plane: "budget" },
      ] } },
    };
    expect((await put(cookie, 0, estado)).status).toBe(200);

    // Lo que haría el cliente viejo: cargar, perder `plane` (su esquema no lo conoce), editar otra cosa
    // y guardar el snapshot entero. De paso añade un comentario nuevo, que para él no tiene plano.
    const cargado = ((await (await get(cookie)).json()) as { state: LedgerState }).state;
    const sinPlano = cargado.cellNotes!["c-vivienda"]![P0]!.map(({ plane: _perdido, ...resto }) => { void _perdido; return resto; });
    const viejo: LedgerState = {
      ...cargado,
      budgets: { "c-transporte": { [P0]: 50_000 } },
      cellNotes: { "c-vivienda": { [P0]: [...sinPlano, { id: "n-nuevo", createdAt: 3, text: "Escrito desde la pestaña vieja" }] } },
    };
    expect((await put(cookie, 1, viejo)).status).toBe(200);

    const filas = [...(await testDb().execute(sql`SELECT id, plane FROM cell_note WHERE owner_id = ${userId} ORDER BY id`))] as { id: string; plane: string | null }[];
    expect(filas).toEqual([{ id: "n-ejec", plane: null }, { id: "n-nuevo", plane: null }, { id: "n-plan", plane: "budget" }]);
  });

  it("un plano que no existe se rechaza con 422 y no escribe nada", async () => {
    const { cookie, userId } = await usuario("bg089-b", "10.89.0.2");
    const semilla = buildSeed(userId, P0);
    expect((await put(cookie, 0, semilla)).status).toBe(200);
    for (const plane of ["actual", "otro"]) {
      const res = await put(cookie, 1, { ...semilla, cellNotes: { "c-vivienda": { [P0]: [{ id: "n1", createdAt: 1, text: "x", plane }] } } });
      expect(res.status, plane).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_payload");
    }
    const n = [...(await testDb().execute(sql`SELECT count(*)::int AS n FROM cell_note WHERE owner_id = ${userId}`))] as { n: number }[];
    expect(n[0]!.n).toBe(0);
  });
});

describe("BG-089 · la migración 0012 deja los comentarios existentes en Ejecutado", () => {
  const MIGRACIONES = path.resolve(process.cwd(), "drizzle");
  const tags = () => (JSON.parse(readFileSync(path.join(MIGRACIONES, "meta/_journal.json"), "utf8")).entries as { tag: string }[]).map((e) => e.tag);

  /** Una base NUEVA en el mismo servidor, migrada hasta la 0011 inclusive, con dos comentarios viejos. */
  async function baseEn0011() {
    const url = new URL(process.env.DATABASE_URL!);
    const nombre = `bg089_mig_${process.pid}_${Date.now()}`;
    const admin = postgres(url.toString(), { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${nombre}"`);
    url.pathname = `/${nombre}`;
    const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
    const todos = tags();
    for (const tag of todos.slice(0, todos.indexOf("0011_reconciliar_celdas_viejas") + 1)) {
      await db.unsafe(readFileSync(path.join(MIGRACIONES, `${tag}.sql`), "utf8"));
    }
    await db`INSERT INTO "user" (id, name, email, email_verified) VALUES ('u-mig', 'mig', 'mig@example.com', true)`;
    await db`INSERT INTO cell_note (owner_id, node_id, period, id, created_at, text, date) VALUES
      ('u-mig', 'c-rest', '2026-09', 'v1', 1, 'Pedir factura', NULL),
      ('u-mig', 'c-rest', '2026-09', 'v2', 2, 'Compartido con Ana', '2026-09-12')`;
    const aplicar0012 = () => db.unsafe(readFileSync(path.join(MIGRACIONES, "0012_comentarios_por_plano.sql"), "utf8"));
    const cerrar = async () => {
      await db.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${nombre}"`);
      await admin.end({ timeout: 5 });
    };
    return { db, aplicar0012, cerrar };
  }

  it("la 0012 está en el journal, justo después de la 0011", () => {
    const todos = tags();
    expect(todos.indexOf("0012_comentarios_por_plano")).toBe(todos.indexOf("0011_reconciliar_celdas_viejas") + 1);
  });

  it("aplicarla (dos veces) conserva cada comentario, con el plano vacío: son de Ejecutado", async () => {
    const { db, aplicar0012, cerrar } = await baseEn0011();
    try {
      await aplicar0012();
      await expect(aplicar0012()).resolves.toBeDefined();
      const filas = await db<{ id: string; text: string; date: string | null; plane: string | null }[]>`SELECT id, text, date, plane FROM cell_note ORDER BY id`;
      expect(filas.map((f) => ({ ...f }))).toEqual([
        { id: "v1", text: "Pedir factura", date: null, plane: null },
        { id: "v2", text: "Compartido con Ana", date: "2026-09-12", plane: null },
      ]);
    } finally { await cerrar(); }
  });

  it("el CHECK de la 0012 solo admite el plano de Presupuestado", async () => {
    const { db, aplicar0012, cerrar } = await baseEn0011();
    try {
      await aplicar0012();
      await db`INSERT INTO cell_note (owner_id, node_id, period, id, created_at, text, plane) VALUES ('u-mig', 'c-rest', '2026-09', 'p1', 3, 'Del plan', 'budget')`;
      await expect(db`INSERT INTO cell_note (owner_id, node_id, period, id, created_at, text, plane) VALUES ('u-mig', 'c-rest', '2026-09', 'p2', 4, 'Mal', 'actual')`).rejects.toThrow(/cell_note_plane_ck/);
    } finally { await cerrar(); }
  });
});
