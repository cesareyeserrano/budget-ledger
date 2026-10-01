// @aitri-trace domain:guard — reglas-en-el-servidor: el veredicto sobre un ESTADO, no sobre una operación.
//
// Módulo:       src/domain/guard.ts
// Propósito:    Responder «¿esta escritura deja algún mes peor de lo que estaba?» comparando dos
//               estados. Es lo que el servidor necesita y `validateReserveWrite` no puede dar:
//               aquélla valida una OPERACIÓN (qué hoja, qué plano, qué monto) y el servidor no ve
//               operaciones, ve snapshots.
// Dependencias: ./types, ./reserve, ./tree.
//
// POR QUÉ VIVE APARTE Y NO EN `reserve.ts`: la regla es de `reserve.ts` y aquí no se reimplementa
// ni una línea — se delega entera en `chainCheck`. Este módulo solo decide QUÉ se le pasa. Separarlo
// mantiene `reserve.ts` como la única sede de la regla (una sola implementación, FR-2103) y deja su
// diff en lo mínimo: dos palabras `export` y un campo aditivo.

import type { LedgerState, PeriodKey } from "./types";
import { chainCheck, isPlannedRetiroKey, type ReserveWarning } from "./reserve";
import { isLeaf } from "./tree";

/**
 * ¿La escritura toca la dimensión de RESERVAS? Celdas de hojas transfer o movimientos de reserva.
 *
 * Es el acotamiento que hace legítimo al guardia (decisión del usuario, 2026-09-03). NFR-1803 de
 * `techo-de-flujo` —aprobado y construido— dice literalmente que «ninguna escritura de ingresos o
 * gastos adquiere validación nueva», y TC-CPR-040e prueba que bajar un ingreso SE ACEPTA aunque
 * deje el mes excedido: la marca aparece como consecuencia y no bloquea. Un guardia que juzgara
 * todo diff rompería las dos cosas.
 *
 * Así que el servidor hace cumplir exactamente lo que la app ya hace cumplir: las reglas de las
 * operaciones de RESERVA. Si el diff no toca ninguna reserva, cualquier empeoramiento vino de un
 * ingreso o un gasto y no es asunto de esta regla.
 *
 * Una escritura que toca AMBAS cosas sí se juzga, y es correcto: en la app equivaldría a bajar el
 * ingreso (permitido) y después subir la reserva (bloqueado), así que rechazarla combinada da el
 * mismo veredicto que darían los dos pasos por separado.
 */
function touchesReserves(prev: LedgerState, next: LedgerState): boolean {
  const leaves = transferLeavesOf(prev, next);
  for (const plane of ["budgets", "actuals"] as const) {
    for (const id of leaves) {
      const a = prev[plane][id] ?? {};
      const b = next[plane][id] ?? {};
      for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) {
        // Ausente y 0 son el MISMO valor contable: borrar una celda en cero no es tocar nada.
        if ((a[p as PeriodKey] ?? 0) !== (b[p as PeriodKey] ?? 0)) return true;
      }
    }
  }
  // saldo-de-bolsillo (FR-3008): las filas de retiros planeados —la global y las de cada bolsillo— son
  // reservas del plan aunque no sean nodos; un snapshot que solo cambia una de ellas también se juzga.
  const filasPlan = new Set([...Object.keys(prev.budgets), ...Object.keys(next.budgets)].filter(isPlannedRetiroKey));
  for (const id of filasPlan) {
    const a = prev.budgets[id] ?? {};
    const b = next.budgets[id] ?? {};
    for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if ((a[p as PeriodKey] ?? 0) !== (b[p as PeriodKey] ?? 0)) return true;
    }
  }
  // BG-057: con origen y destino. Sin ellos, reescribir el `from` de un traslado (que no cambia
  // `target`) no contaba como tocar reservas, y el guardia ni siquiera se ejecutaba.
  const firma = (st: LedgerState) =>
    st.movements
      .filter((m) => m.type === "transfer")
      .map((m) => `${m.id}:${m.period}:${m.amount}:${m.target}:${m.catId ?? ""}:${m.from ?? ""}:${m.to ?? ""}`)
      .sort()
      .join("|");
  return firma(prev) !== firma(next);
}

/** Las alcancías (hojas transfer) que existen en CUALQUIERA de los dos estados. */
function transferLeavesOf(a: LedgerState, b: LedgerState): string[] {
  const out = new Set<string>();
  for (const st of [a, b]) {
    for (const n of st.nodes) {
      if (n.type === "transfer" && isLeaf(n, st.nodes)) out.add(n.id);
    }
  }
  return [...out];
}

/**
 * EL GUARDIA DE ESTADO (FR-2101). Las violaciones que `next` INTRODUCE respecto de `prev`.
 *
 * Toda la lógica vive en `chainCheck`; aquí solo se decide qué se le pasa, y esas dos decisiones
 * SON el diseño:
 *
 * 1. **`affectedLeaves` = TODAS las alcancías**, no las que una operación declare. El servidor no
 *    ve operaciones: ve un snapshot contra otro, y dos escrituras distintas producen el mismo diff.
 *    Fiarse de que la petición diga qué tocó sería fiarse de quien se está validando (ADR-17).
 *
 * 2. **Los DOS planos** (FR-2906, carril-de-presupuesto). Hasta 2026-09-27 aquí se juzgaba solo
 *    Ejecutado, porque en Presupuestado `chainCheck` nunca bloqueaba (el plan avisaba, ADR-08) y hacer
 *    cumplir el plan dejaba al servidor más estricto que la app (NFR-2102). Desde FR-2904 el plan
 *    bloquea en la app, así que el servidor tiene que bloquear igual: la simetría de NFR-2102 se
 *    mantiene, ahora en el otro sentido.
 *
 * La comparación es RELATIVA: solo reporta lo que empeora respecto de `prev`. Un estado que YA
 * violaba el techo no se rechaza en bloque, o su dueño no podría ni corregirlo (FR-2104, ADR-18).
 *
 * @param prev Estado PERSISTIDO, leído por el servidor. Nunca el que la petición afirme.
 * @param next Estado entrante.
 * @param periods Rango a juzgar: la unión del alcance de los dos estados, o un mes estrenado por la
 *   escritura se quedaría fuera del juicio (TC-RES-015e).
 * @returns Las violaciones ordenadas por periodo. Vacío = la escritura no empeora nada.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2101, US-ID: US-2101, AC-ID: AC-2101, TC-ID: TC-RES-010f, TC-RES-011f, TC-RES-012h, TC-RES-013f
 * @aitri-trace FR-ID: FR-2906, US-ID: US-2906, AC-ID: AC-2919, TC-ID: TC-CDP-061f, TC-CDP-062f, TC-CDP-063e, TC-CDP-064e
 */
export function worsenedBy(
  prev: LedgerState,
  next: LedgerState,
  periods: readonly PeriodKey[]
): ReserveWarning[] {
  if (periods.length === 0) return [];
  // ACOTAMIENTO (decisión del usuario, 2026-09-03): solo se juzgan las escrituras que tocan
  // reservas. Ver `touchesReserves` — hacerlo cumplir sobre ingresos y gastos contradiría NFR-1803,
  // que es un requisito aprobado y construido, no una preferencia.
  if (!touchesReserves(prev, next)) return [];
  // `blocking` es la violación de PERIODO MÁS TEMPRANO —`chainCheck` ya las ordena y normaliza sus
  // límites al mínimo—, así que devolverla sola no pierde nada operativo: es la que hay que
  // arreglar antes de que la siguiente sea siquiera alcanzable. Es la misma filosofía de ADR-19
  // aplicada dentro de una sola regla: un obstáculo cada vez, y el que de verdad bloquea.
  //
  // Además es lo que permite que `chainCheck` no cambie NI UNA LÍNEA de su cuerpo: exponer la lista
  // completa habría exigido tocar sus returns, y TC-CDM-222f vigila —con razón— que el cálculo del
  // techo no se toque.
  //
  // FR-2906 (carril-de-presupuesto): el plan se juzga con la MISMA función y en la misma pasada. Antes
  // solo se juzgaba Ejecutado porque el plan no bloqueaba; ahora bloquea (FR-2904), y una regla que
  // solo cumple el navegador la salta cualquier snapshot fabricado. Se devuelve el obstáculo del
  // periodo más temprano entre los dos planos; a igual periodo, el de Ejecutado.
  const leaves = transferLeavesOf(prev, next);
  const candidatos = (["actual", "budget"] as const)
    .map((plane) => chainCheck(prev, next, plane, leaves, periods).blocking)
    .filter((b): b is ReserveWarning => b !== null);
  if (candidatos.length === 0) return [];
  const primero = candidatos.reduce((a, b) => (periods.indexOf(b.period) < periods.indexOf(a.period) ? b : a));
  return [primero];
}
