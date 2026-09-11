/**
 * Helpers de test para las operaciones de reserva.
 *
 * Desde FR-1803 eliminar o editar una operación DEVUELVE UN VEREDICTO en vez del estado: la
 * eliminación pasó a validarse, que es la corrección de fondo de `techo-de-flujo`. Estos helpers
 * desempaquetan el resultado en los tests que solo quieren el camino feliz, y fallan con el motivo
 * cuando la cadena rechaza — en vez de dejar que un `{rejected}` se cuele como si fuera un estado.
 */
import { expect } from "vitest";
import { editReserveOp, removeReserveOp } from "@/domain/reserve";
import type { LedgerState } from "@/domain/types";
import { P } from "../helpers/periods";

/** Elimina una operación esperando que la cadena la acepte. Falla nombrando el motivo si rechaza. */
export function removeOrFail(state: LedgerState, movementId: string): LedgerState {
  const r = removeReserveOp(state, movementId, P);
  if ("rejected" in r) {
    expect.fail(`removeReserveOp rechazó ${movementId}: ${JSON.stringify(r.rejected)}`);
  }
  return r.state;
}

/** Corrige el monto de una operación esperando que la cadena lo acepte. */
export function editOrFail(state: LedgerState, movementId: string, amount: number): LedgerState {
  const r = editReserveOp(state, movementId, amount, P);
  if ("rejected" in r) {
    expect.fail(`editReserveOp rechazó ${movementId}→${amount}: ${JSON.stringify(r.rejected)}`);
  }
  return r.state;
}

/**
 * Elimina una operación si la cadena lo permite; si la rechaza, devuelve el estado SIN CAMBIOS.
 *
 * Es el helper para los bucles de propiedad (conservación, invariantes bajo secuencias mixtas):
 * ahí un rechazo no es un fallo del test sino una respuesta legítima del dominio —desde FR-1803
 * eliminar un retiro puede dejar un mes sin respaldo y se bloquea—, y como el rechazo no muta, la
 * propiedad bajo prueba se sigue cumpliendo. Usa `removeOrFail` cuando el test SÍ exige que la
 * eliminación tenga éxito.
 */
export function removeIfAllowed(state: LedgerState, movementId: string): LedgerState {
  const r = removeReserveOp(state, movementId, P);
  return "rejected" in r ? state : r.state;
}
