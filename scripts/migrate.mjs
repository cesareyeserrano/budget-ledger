#!/usr/bin/env node
// @aitri-trace FR-512 / NFR-505 — aplica las migraciones Drizzle al arrancar (idempotente). Usa
// drizzle-orm (dep de runtime), sin drizzle-kit. DATABASE_URL desde el entorno.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL no definida");
  process.exit(1);
}
const sql = postgres(url, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("[migrate] migraciones aplicadas");
} catch (err) {
  console.error("[migrate] falló:", err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
