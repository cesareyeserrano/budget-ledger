// @aitri-trace FR-ID: FR-506, US-ID: US-506, AC-ID: AC-506a, TC-ID: TC-BE-021h
/**
 * Module: tests/integration/backend/helpers/db
 * Purpose: Utilidades compartidas por los tests de integración del backend: acceso al cliente Drizzle
 *   (apuntado al Postgres efímero de testcontainers vía DATABASE_URL) y truncado entre tests para
 *   aislamiento. NO arranca el contenedor — eso lo hace el globalSetup una sola vez.
 * Dependencies: drizzle-orm, postgres
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";

let _sql: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** Cliente Drizzle de test (conexión propia al Postgres efímero). */
export function testDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no definida — ¿corrió el globalSetup de testcontainers?");
    _sql = postgres(url, { max: 4 });
    _db = drizzle(_sql, { schema });
  }
  return _db;
}

/** Cierra la conexión de test (afterAll). */
export async function closeTestDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
    _db = null;
  }
}

/** Vacía todas las tablas de datos + auth para aislar cada test. */
export async function truncateAll(): Promise<void> {
  const db = testDb();
  await db.execute(
    sql`TRUNCATE TABLE "movement","amount_cell","node","ledger","session","account","verification","user" RESTART IDENTITY CASCADE`
  );
}

/** Inserta un usuario mínimo (para satisfacer la FK owner_id) y devuelve su id. */
export async function createTestUser(id: string, email: string): Promise<string> {
  const db = testDb();
  await db.execute(
    sql`INSERT INTO "user" ("id","name","email","email_verified") VALUES (${id}, ${email.split("@")[0]}, ${email}, true)`
  );
  return id;
}
