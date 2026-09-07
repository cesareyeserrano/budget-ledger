/**
 * Module: tests/e2e/helpers/opening
 * Purpose: Devolver el ledger a «sin apertura declarada» entre pruebas
 *   (feature meses-y-saldo-inicial).
 *
 *   POR QUÉ HACE FALTA, y es la MISMA razón que en `closure.ts`. El PUT del snapshot IGNORA
 *   `startMonth` y `openingBalance` a propósito (ADR-02): la apertura solo la mueve
 *   `PUT /api/v1/ledger/start`, que es donde viven sus dos reglas de servidor. Correcto para el
 *   producto —un usuario nunca quiere «desdeclarar» su historia— pero deja a la suite sin salida:
 *   en cuanto una prueba declara, `seedLedger` ya no puede limpiarlo y la tarjeta de arranque no
 *   vuelve a aparecer para NINGUNA prueba posterior del mismo worker. Fue exactamente el síntoma
 *   observado el 2026-09-06: pasaban las tres primeras pruebas del fichero y morían las ocho
 *   siguientes.
 *
 *   Es infraestructura de pruebas, equivalente a un TRUNCATE. No se añade ningún endpoint de
 *   producción para esto.
 * Dependencies: ./pg
 */
import { db } from "./pg";

/**
 * Borra la apertura declarada de UN usuario, por su correo. No falla si no hay base.
 *
 * ACOTADO A UNA CUENTA, por la misma lección que dejó `resetClosure`: los workers comparten
 * Postgres —cada uno tiene su cuenta, no su base— así que un UPDATE global borraría la declaración
 * de otro worker en mitad de su prueba y aparecería como intermitencia inexplicable.
 *
 * Las DOS columnas van en el mismo UPDATE: `ledger_opening_ck` exige que no exista un saldo sin mes
 * al que aplicarse, así que limpiar una sola rompería el CHECK.
 */
export async function resetOpening(email: string): Promise<void> {
  const c = db();
  if (!c) return;
  await c`UPDATE ledger SET start_month = NULL, opening_balance = NULL
          WHERE owner_id IN (SELECT id FROM "user" WHERE email = ${email})`;
}
