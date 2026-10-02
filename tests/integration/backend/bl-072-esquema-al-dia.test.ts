/**
 * BL-072 — `schema.ts` describe la base que construyen las migraciones.
 *
 * Módulo:       tests/integration/backend/bl-072-esquema-al-dia.test.ts
 * Propósito:    Las migraciones 0002 en adelante están escritas a mano y `schema.ts` se quedó atrás:
 *               le faltaban los CHECK que añadieron y conservaba el patrón de periodo sin la `t` de
 *               los ciclos. Nada lo notaba, porque las pruebas construyen la base con las
 *               migraciones. El riesgo era el contrario: un `drizzle-kit generate` o `push` habría
 *               producido una migración que QUITA restricciones para igualar la base al esquema.
 *
 *               Aquí se levantan DOS bases en el mismo servidor —una con las migraciones, otra con el
 *               SQL que drizzle-kit genera desde `schema.ts`— y se comparan sus catálogos. No se
 *               compara texto: se le pregunta a Postgres qué construyó en cada una, así que dos
 *               formas de escribir la misma restricción cuentan como iguales.
 * Dependencias: drizzle-kit/api, el Postgres efímero del globalSetup, drizzle/*.sql.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "@/server/db/schema";

const MIGRACIONES = path.resolve(process.cwd(), "drizzle");
type Sql = ReturnType<typeof postgres>;

interface Catalogo {
  columnas: string[];
  restricciones: string[];
  indices: string[];
}

/** Lo que Postgres dice que hay en `public`, en una forma que se puede comparar línea a línea. */
async function catalogo(db: Sql): Promise<Catalogo> {
  const columnas = await db<{ linea: string }[]>`
    SELECT table_name || '.' || column_name || ' ' || udt_name
           || CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
           || coalesce(' DEFAULT ' || column_default, '') AS linea
    FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1`;
  // El nombre de una clave foránea NO se compara: las migraciones a mano las declaran en línea
  // (`REFERENCES "user"("id")`), Postgres las llama `<tabla>_<col>_fkey`, y drizzle-kit les pondría
  // otro nombre. Nada las busca por nombre; lo que importa es a qué apuntan y que borren en cascada.
  // El de un CHECK sí: las migraciones lo usan en sus `DROP CONSTRAINT`.
  const restricciones = await db<{ linea: string }[]>`
    SELECT rel.relname || ' ' || CASE WHEN con.contype = 'f' THEN '(fk)' ELSE con.conname END
           || ' ' || pg_get_constraintdef(con.oid) AS linea
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public' ORDER BY 1`;
  const indices = await db<{ linea: string }[]>`
    SELECT indexdef AS linea FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`;
  return {
    columnas: columnas.map((f) => f.linea),
    restricciones: restricciones.map((f) => f.linea),
    indices: indices.map((f) => f.linea),
  };
}

describe("BL-072 · schema.ts y las migraciones construyen la misma base", () => {
  const sufijo = `${process.pid}_${Date.now()}`;
  const nombres = { migraciones: `bl072_mig_${sufijo}`, esquema: `bl072_ts_${sufijo}` };
  let admin: Sql;
  let deMigraciones: Catalogo;
  let deEsquema: Catalogo;

  async function base(nombre: string, sentencias: string[]): Promise<Catalogo> {
    await admin.unsafe(`CREATE DATABASE "${nombre}"`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${nombre}`;
    const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      for (const s of sentencias) await db.unsafe(s);
      return await catalogo(db);
    } finally {
      await db.end({ timeout: 5 });
    }
  }

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL!, { max: 1 });
    const journal = JSON.parse(readFileSync(path.join(MIGRACIONES, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    deMigraciones = await base(
      nombres.migraciones,
      journal.entries.map((e) => readFileSync(path.join(MIGRACIONES, `${e.tag}.sql`), "utf8"))
    );
    // De una base vacía al esquema entero: lo que `drizzle-kit generate` escribiría en un repo nuevo.
    deEsquema = await base(
      nombres.esquema,
      await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema))
    );
  });

  afterAll(async () => {
    for (const n of Object.values(nombres)) await admin.unsafe(`DROP DATABASE IF EXISTS "${n}"`);
    await admin.end({ timeout: 5 });
  });

  it("BL-072: las dos bases tienen tablas (si alguna saliera vacía, lo de abajo pasaría en falso)", () => {
    expect(deMigraciones.columnas.length).toBeGreaterThan(60);
    expect(deMigraciones.restricciones.length).toBeGreaterThan(40);
    expect(deEsquema.columnas.length).toBeGreaterThan(60);
  });

  it("BL-072: las mismas columnas, con su tipo, su nulabilidad y su valor por defecto", () => {
    expect(deEsquema.columnas).toEqual(deMigraciones.columnas);
  });

  it("BL-072: las mismas restricciones — claves, foráneas y cada CHECK con su nombre", () => {
    expect(deEsquema.restricciones).toEqual(deMigraciones.restricciones);
  });

  it("BL-072: los mismos índices", () => {
    expect(deEsquema.indices).toEqual(deMigraciones.indices);
  });

  // La otra mitad: drizzle-kit no compara contra la base sino contra su último snapshot. Los
  // snapshots se habían quedado en la 0001, así que `generate` habría escrito una migración con todo
  // lo que las once siguientes ya hicieron a mano. Con el snapshot al día responde «nothing to
  // migrate». Quien cambie schema.ts regenera el snapshot con el número de su migración.
  it("BL-072: el último snapshot de drizzle/meta es el de schema.ts — `drizzle-kit generate` no propone nada", () => {
    const meta = path.join(MIGRACIONES, "meta");
    const ultimo = readdirSync(meta).filter((f) => f.endsWith("_snapshot.json")).sort().at(-1)!;
    const { id: _id, prevId: _prev, ...guardado } = JSON.parse(readFileSync(path.join(meta, ultimo), "utf8"));
    const { id: _id2, prevId: _prev2, ...actual } = JSON.parse(JSON.stringify(generateDrizzleJson(schema)));
    expect(guardado, `${ultimo} no describe schema.ts`).toEqual(actual);
  });
});
