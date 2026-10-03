/**
 * Helpers para leer el resultado de una operación del dominio sin que un rechazo pase por verde (BL-064).
 *
 * Las operaciones devuelven `{ state }` si se aplican y `{ rejected }` o `{ blocked }` si no. El
 * modismo que estos helpers sustituyen era
 *
 *     const state = "state" in res ? res.state : s;
 *
 * que ante un rechazo cae al estado ORIGINAL. Las aserciones que venían después —cero huérfanos,
 * mismo conteo, un valor que la propia prueba había sembrado— son ciertas de ese estado original,
 * así que una regresión que hiciera fallar la operación, o que la dejara sin efecto, no ponía la
 * prueba en rojo. La otra mitad del problema eran las aserciones sobre el veredicto guardadas dentro
 * de un `if (typeof r.rejected === "object")`: un rechazo por OTRO motivo se saltaba el bloque entero.
 */
import { expect } from "vitest";
import type { ReserveVerdict } from "@/domain/reserve";

/** El estado de una operación ACEPTADA. La prueba cae si fue rechazada o bloqueada. */
export function aceptada<S>(res: { state: S } | object): S {
  if (!("state" in res)) return expect.fail(`se esperaba una operación aceptada y devolvió ${JSON.stringify(res)}`);
  return res.state;
}

/** El veredicto de bloqueo de un RECHAZO. La prueba cae si se aceptó o si se rechazó sin veredicto. */
export function bloqueo(res: object): Extract<ReserveVerdict, { ok: false }> {
  if (!("rejected" in res)) return expect.fail("se esperaba un rechazo y la operación se aceptó");
  const v = (res as { rejected: unknown }).rejected;
  if (typeof v !== "object" || v === null || (v as { ok: boolean }).ok) {
    return expect.fail(`rechazo sin veredicto de regla: ${JSON.stringify(v)}`);
  }
  return v as Extract<ReserveVerdict, { ok: false }>;
}
