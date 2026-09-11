/**
 * Module: tests/e2e/helpers/pg
 * Purpose: La conexión compartida que usan los helpers de RESET de la suite e2e.
 *
 *   Se extrajo de `closure.ts` cuando la feature meses-y-saldo-inicial necesitó el mismo mecanismo
 *   por el mismo motivo, para no abrir un segundo pool por worker. El razonamiento de por qué estos
 *   resets van por SQL directo y no por la API está escrito en `closure.ts` y sigue vigente: la API
 *   no ofrece camino de vuelta a propósito, y añadir uno sería la puerta trasera que las features
 *   existen para no tener.
 * Dependencies: postgres, ./globalSetup
 */
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { STATE_FILE } from "./globalSetup";

let sql: ReturnType<typeof postgres> | null = null;

/** La conexión de limpieza, o `null` si la suite corre sin base. Nunca lanza. */
export function db(): ReturnType<typeof postgres> | null {
  if (sql) return sql;
  if (!existsSync(STATE_FILE)) return null;
  const { databaseUrl } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { databaseUrl?: string };
  if (!databaseUrl) return null;
  sql = postgres(databaseUrl, { max: 1 });
  return sql;
}
