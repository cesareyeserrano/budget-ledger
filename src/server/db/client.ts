// @aitri-trace FR-ID: FR-512, US-ID: US-512, AC-ID: AC-512a, TC-ID: TC-BE-040h
/**
 * Module: server/db/client
 * Purpose: Cliente Drizzle sobre postgres.js. La conexión sale de DATABASE_URL (env, NFR-505/NFR-510):
 *   cero rutas/IPs de host en el código. Pool acotado (max=10). server-only: nunca al bundle cliente.
 *   INICIALIZACIÓN PEREZOSA: env() NO se llama al importar el módulo — solo en el primer acceso a `db`.
 *   Así `next build` (que importa las rutas para recolectar page data) NO exige DATABASE_URL en build;
 *   la validación de entorno ocurre en runtime/arranque (NFR-510: fallar en el boot, no en el build).
 * Dependencies: postgres, drizzle-orm/postgres-js, ./schema, ../env
 */
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "../env";

const POOL_MAX = 10;

// Singleton entre hot-reloads en dev (evita agotar conexiones al recompilar).
const globalForDb = globalThis as unknown as {
  __ledgerSql?: ReturnType<typeof postgres>;
  __ledgerDb?: ReturnType<typeof drizzle<typeof schema>>;
};

/** Inicializa (una vez) el cliente Drizzle. Llama a env() aquí — NO al importar el módulo. */
function realDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (globalForDb.__ledgerDb) return globalForDb.__ledgerDb;
  const sql = globalForDb.__ledgerSql ?? postgres(env().DATABASE_URL, { max: POOL_MAX });
  if (env().NODE_ENV !== "production") globalForDb.__ledgerSql = sql;
  const db = drizzle(sql, { schema });
  globalForDb.__ledgerDb = db;
  return db;
}

/**
 * Cliente Drizzle tipado (proxy perezoso). Se inicializa en el primer acceso a una propiedad, no al
 * importar — evita que `next build` requiera DATABASE_URL. Los métodos se bindean a la instancia real.
 */
export const db: ReturnType<typeof drizzle<typeof schema>> = new Proxy(
  {} as ReturnType<typeof drizzle<typeof schema>>,
  {
    get(_target, prop) {
      const real = realDb() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
    },
  }
);

/** Tipo de una transacción Drizzle (para firmas de la capa de datos). */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { schema };
