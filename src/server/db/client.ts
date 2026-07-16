// @aitri-trace FR-ID: FR-512, US-ID: US-512, AC-ID: AC-512a, TC-ID: TC-BE-040h
/**
 * Module: server/db/client
 * Purpose: Cliente Drizzle sobre postgres.js. La conexión sale de DATABASE_URL (env, NFR-505/NFR-510):
 *   cero rutas/IPs de host en el código. Pool acotado (max=10) — suficiente para el alcance y no agota
 *   Postgres con SSE de larga vida. server-only: nunca llega al bundle del cliente.
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
};

const sql = globalForDb.__ledgerSql ?? postgres(env().DATABASE_URL, { max: POOL_MAX });
if (env().NODE_ENV !== "production") globalForDb.__ledgerSql = sql;

/** Cliente Drizzle tipado con el esquema completo. */
export const db = drizzle(sql, { schema });

/** Tipo de una transacción Drizzle (para firmas de la capa de datos). */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { sql, schema };
