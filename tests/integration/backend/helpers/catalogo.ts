/**
 * Module: tests/integration/backend/helpers/catalogo
 * Purpose: Bases de usar y tirar dentro del Postgres efímero de la suite, y una foto de lo que
 *   Postgres dice que hay en cada una. Sirve a las pruebas que EJECUTAN migraciones en vez de leer su
 *   SQL (BL-072, BL-073): dos fotos iguales significan dos esquemas iguales, se escriban como se
 *   escriban las restricciones.
 * Dependencies: postgres, el DATABASE_URL que provee el globalSetup.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;
export const MIGRACIONES = path.resolve(process.cwd(), "drizzle");

export interface Catalogo {
  columnas: string[];
  restricciones: string[];
  indices: string[];
}

/** Los tags del journal, en orden: lo que `migrate()` aplica y en qué secuencia. */
export function tagsDelJournal(): string[] {
  const journal = JSON.parse(readFileSync(path.join(MIGRACIONES, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  return journal.entries.map((e) => e.tag);
}
export const sqlDe = (tag: string): string => readFileSync(path.join(MIGRACIONES, `${tag}.sql`), "utf8");

/** Lo que Postgres dice que hay en `public`, en una forma que se puede comparar línea a línea. */
export async function catalogo(db: Sql): Promise<Catalogo> {
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

/**
 * Crea una base NUEVA y vacía en el mismo servidor de la suite.
 * @returns su URL, una conexión abierta y `cerrar()`, que cierra la conexión y BORRA la base.
 */
export async function baseNueva(prefijo: string): Promise<{ url: string; db: Sql; cerrar: () => Promise<void> }> {
  const nombre = `${prefijo}_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${nombre}"`);
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${nombre}`;
  const db = postgres(u.toString(), { max: 1, onnotice: () => {} });
  return {
    url: u.toString(),
    db,
    cerrar: async () => {
      await db.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    },
  };
}
