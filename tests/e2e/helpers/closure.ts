/**
 * Module: tests/e2e/helpers/closure
 * Purpose: Devolver el ledger a «nada cerrado» entre pruebas (feature cierre-de-mes).
 *
 *   POR QUÉ HACE FALTA UN ACCESO DIRECTO A LA BASE, y por qué NO es un atajo. El cierre es un
 *   TRINQUETE por diseño: solo se puede reabrir el último mes cerrado, y uno a la vez (FR-2005),
 *   así que desde la API NO existe ningún camino que devuelva la frontera a `null`. Es correcto
 *   para el producto —el usuario nunca quiere "descerrar" su historia entera— pero deja a la suite
 *   sin salida: en cuanto una prueba cierra un mes, el fixture `freshLedger` intenta restaurar la
 *   semilla, el guardia lo rechaza con 422 y TODAS las pruebas siguientes de ese worker mueren.
 *
 *   Es infraestructura de pruebas, equivalente a un TRUNCATE: no se añade ningún endpoint de
 *   producción para esto. Un "reset" expuesto por la API sería exactamente la puerta trasera que la
 *   feature existe para no tener.
 * Dependencies: postgres, ./globalSetup
 */
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { STATE_FILE } from "./globalSetup";

let sql: ReturnType<typeof postgres> | null = null;

function db(): ReturnType<typeof postgres> | null {
  if (sql) return sql;
  if (!existsSync(STATE_FILE)) return null;
  const { databaseUrl } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { databaseUrl?: string };
  if (!databaseUrl) return null;
  sql = postgres(databaseUrl, { max: 1 });
  return sql;
}

/**
 * Devuelve a «nada cerrado» el ledger de UN usuario, por su correo. No falla si no hay base.
 *
 * ACOTADO A UNA CUENTA, y no por elegancia: la primera versión hacía un UPDATE global, así que un
 * worker borraba el cierre de OTRO en mitad de su prueba y aparecía como intermitencia inexplicable
 * en un test que no había hecho nada mal. Los workers comparten Postgres —cada uno tiene su cuenta,
 * no su base— así que cualquier escritura de limpieza tiene que llevar su WHERE.
 */
export async function resetClosure(email: string): Promise<void> {
  const c = db();
  if (!c) return;
  // La línea de base va en el MISMO UPDATE: `ledger_reopen_baseline_ck` (FR-2010) exige que exista
  // exactamente cuando existe `reopened_period`, así que limpiar uno sin el otro rompe el CHECK y
  // el helper revienta antes de que la prueba empiece.
  await c`UPDATE ledger SET reopened_period = NULL, closed_through = NULL,
                            reopen_base_available = NULL, reopen_base_reserved = NULL
          WHERE owner_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await c`DELETE FROM closure_event
          WHERE owner_id IN (SELECT id FROM "user" WHERE email = ${email})`;
}
