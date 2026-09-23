/**
 * Module: tests/helpers/cuadre
 * Purpose: Sembrar celdas de Ejecutado que CUADRAN con sus movimientos (feature diario-de-celda,
 *   NFR-2502/NFR-2507).
 *
 *   Por qué existe: desde esta feature el servidor rechaza una escritura que DESCUADRE una celda de
 *   gasto o ingreso — su valor tiene que ser la suma de sus movimientos. Muchas siembras de la suite
 *   ponían la cifra directamente (`setLeafAmount(..., "actual", N)`) porque hasta ahora nada exigía
 *   respaldo; su intención NUNCA fue «una celda sin movimientos», sino «una celda con N».
 *
 *   La decisión del usuario (2026-09-15) es ajustar el FIXTURE y jamás el resultado esperado: estas
 *   pruebas siguen afirmando exactamente lo mismo, con datos que ahora son representables.
 *
 *   Los bolsillos (`transfer`) NO se siembran con esto: su celda es un aporte y nunca cuenta como
 *   descuadre (NFR-2503). Para ellos sigue valiendo la asignación directa.
 * Dependencies: @/domain
 */
import { adjustCell, findNode } from "@/domain";
import { monthOf } from "@/domain/periods";
import type { LedgerState, Movement, PeriodKey } from "@/domain/types";

/**
 * Pone la celda de Ejecutado en `value` POR LA MISMA VÍA QUE EL PRODUCTO: `adjustCell`, que crea el
 * ajuste por la diferencia con lo que suman sus movimientos (FR-2504).
 *
 * Se usa donde una prueba ponía la cifra con `setLeafAmount(..., "actual", N)`. Eso escribía una
 * celda que el usuario ya no puede producir: en la app, teclear un total crea su respaldo. Cambiar
 * el fixture mantiene intacto lo que la prueba AFIRMA — sigue siendo «el ingreso vale N»— y lo monta
 * con datos representables.
 *
 * @throws Error si `adjustCell` rechaza (hoja inexistente, bolsillo o periodo fuera de rango): en un
 *         fixture eso es un error del test, no un caso del producto.
 */
export function ajustarCelda(
  state: LedgerState, leafId: string, period: PeriodKey, value: number, periods: readonly PeriodKey[]
): LedgerState {
  const r = adjustCell(state, leafId, period, value, `${monthOf(period)}-10T12:00`, periods);
  if ("rejected" in r) throw new Error(`ajustarCelda: ${leafId}/${period} rechazado (${r.rejected})`);
  return r.state;
}

/** Contador propio: los ids y el orden de creación no deben depender del `nextSeq` del dominio. */
let n = 0;

/** Reinicia el contador — para pruebas que comparan ids o `createdAt` entre corridas. */
export function resetCuadre(): void {
  n = 0;
}

/**
 * Deja `actuals[leafId][period] = amount` CON un movimiento que lo respalda.
 *
 * @param state Estado de partida (no se muta).
 * @param leafId Hoja de gasto o ingreso.
 * @param period Periodo de la celda.
 * @param amount Monto de la celda; 0 deja la celda en 0 y no crea movimiento.
 * @returns Un estado nuevo con la celda y su movimiento.
 * @throws Error si la hoja no existe o es un bolsillo — sembrar así un `transfer` sería un error del
 *         test, no un caso que el producto admita.
 */
export function celdaCuadrada(
  state: LedgerState, leafId: string, period: PeriodKey, amount: number
): LedgerState {
  const node = findNode(state.nodes, leafId);
  if (!node) throw new Error(`celdaCuadrada: la hoja ${leafId} no existe`);
  if (node.type === "transfer") throw new Error(`celdaCuadrada: ${leafId} es un bolsillo; usa la vía de reservas`);

  const actuals = { ...state.actuals, [leafId]: { ...(state.actuals[leafId] ?? {}), [period]: amount } };
  if (amount === 0) return { ...state, actuals };

  const mv: Movement = {
    id: `cuadre-${++n}`,
    ownerId: state.ownerId,
    type: node.type,
    catId: node.level === "sub" && node.parentId ? node.parentId : leafId,
    subId: node.level === "sub" ? leafId : null,
    target: leafId,
    amount,
    period,
    createdAt: 1_000_000 + n,
    // Día 10: dentro del mes y, en modo ciclos, dentro del ciclo que ese mes nombra.
    date: `${monthOf(period)}-10T12:00`,
  };
  return { ...state, actuals, movements: [mv, ...state.movements] };
}
