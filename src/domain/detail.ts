// @aitri-trace domain:detail — feature diario-de-celda (FR-2501, FR-2508): QUÉ forma una celda.
//
// Módulo:       src/domain/detail.ts
// Propósito:    El Detalle de una celda: los movimientos que la componen y los comentarios que la
//               acompañan, en un orden estable. Selector PURO — no escribe, no consulta la red y no
//               conoce la UI. La pantalla (CellDetail) solo lo pinta.
// Dependencias: ./types, ./periods, ./reserve (observaciones y aviso de arrastre de bolsillos).

import type { CellNote, LedgerState, Movement, NodeType, PeriodKey } from "./types";
import { monthOf, periodLabel } from "./periods";
import { cellObservations, monthCarryUsage } from "./reserve";
import { findNode, isLeaf } from "./tree";

type PeriodScope = readonly PeriodKey[];

/**
 * Una línea del Detalle. Las cuatro formas se pintan con la MISMA anatomía (UX spec, FR-2508);
 * lo que cambia es el ícono, y solo los movimientos llevan monto.
 */
export type DetailEntry =
  | { kind: "auto"; text: string }
  | { kind: "reserveNote"; text: string; createdAt: number }
  | { kind: "movement" | "adjustment"; movement: Movement }
  | { kind: "comment"; note: CellNote };

/**
 * Lo que suman los movimientos de una celda de gasto o ingreso (FR-2504, FR-2511).
 *
 * Es la otra mitad del cuadre: la celda GUARDA su valor (ADR-01) y esto dice cuánto respaldan sus
 * movimientos. Los de reserva nunca cuentan — una celda de bolsillo no se cuadra así (NFR-2503).
 *
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2504, US-ID: US-2504, AC-ID: AC-2504a, TC-ID: TC-DDC-061h, TC-DDC-075e
 */
export function movementSum(state: LedgerState, leafId: string, period: PeriodKey): number {
  let total = 0;
  for (const m of state.movements) {
    if (m.type !== "transfer" && m.target === leafId && m.period === period) total += m.amount;
  }
  return total;
}

/** Fecha con la que ordena un movimiento: la suya, o el primer día del periodo si no la tiene. */
function sortDate(m: Movement, period: PeriodKey): string {
  return m.date ?? firstDayOf(period);
}

/**
 * El primer día del periodo en formato ISO de minuto. Es la fecha que se le atribuye a un
 * movimiento SIN `date` (los anteriores a stack-upgrade-theme): no se inventa una fecha real, se
 * usa la única que el dato garantiza — que cayó en ese periodo (FR-2501, TC-DDC-010e).
 *
 * En modo ciclos la clave puede llevar el sufijo de transición; `monthOf` la reduce a su mes.
 */
export function firstDayOf(period: PeriodKey): string {
  return `${monthOf(period)}-01T00:00`;
}

/** Miles con punto y el signo delante, como `money()` de la UI (es-CO). */
function cop(n: number): string {
  return n < 0 ? `−$${Math.abs(n).toLocaleString("es-CO")}` : `$${n.toLocaleString("es-CO")}`;
}

/**
 * Cómo se PINTA el monto de un movimiento en su fila del Detalle (FR-2501).
 *
 * El signo mostrado es el del APORTE A LA CELDA, no el del tipo del nodo: lo que suma va sin signo
 * y solo lo que resta lleva «−». Ningún monto lleva «+».
 *
 * POR QUÉ YA NO RECIBE EL TIPO, y por qué eso importa más que el cambio de signo. La versión
 * anterior era `displayAmount(type, amount)` y hacía «signo del tipo × signo del monto»: dentro de
 * una celda de gasto, un gasto de 50.000 se pintaba «−50.000» y un ajuste de −10.000 se pintaba
 * «+10.000». Es decir, el signo en pantalla era SIEMPRE el contrario del guardado.
 *
 * Eso rompía lo único que el panel promete —que sus filas suman el valor de la celda—: el usuario
 * veía −150.000, −40.000, −50.000 y −10.000 bajo una celda que decía 250.000 en positivo. Sus
 * palabras al detectarlo (2026-09-18): «ya por defecto se sabe que es gasto, y no tiene lógica
 * cuando esas cifras suman en cada celda». Tenía razón, y de raíz: la regla nunca estuvo en el
 * brief —que solo pide «día, monto y nota»— sino que se introdujo al redactar la fase 1.
 *
 * Al quitar el parámetro `type`, la regla vieja deja de ser EXPRESABLE: una función que no sabe si
 * la celda es de gasto o de ingreso no puede hacer depender el signo de eso. Es más fuerte que
 * corregir el cálculo, porque impide que vuelva por descuido.
 *
 * `addsToCell` se conserva y gobierna el COLOR, así que la distinción entre lo que suma y lo que
 * resta viaja por dos vías y no solo por el signo (WCAG 1.4.1).
 *
 * @param amount Monto guardado del movimiento, con su signo (un ajuste puede ser negativo).
 * @returns `sign` vacío si suma y «−» si resta; `abs` para formatear; `addsToCell` para el color.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2501, US-ID: US-2501, AC-ID: AC-2501d, TC-ID: TC-DDC-008e, TC-DDC-012e, TC-DDC-013f
 */
export function displayAmount(
  amount: number
): { sign: "" | "−"; abs: number; addsToCell: boolean } {
  const addsToCell = amount > 0;
  return { sign: addsToCell ? "" : "−", abs: Math.abs(amount), addsToCell };
}


/**
 * Las líneas que forman una celda, en el orden en que se leen: el aviso automático de arrastre (solo
 * bolsillos), después los movimientos del periodo por fecha y, a igual fecha, por orden de creación,
 * y al final los comentarios por antigüedad.
 *
 * Una hoja `transfer` no tiene movimientos propios en el Detalle: sus operaciones De→A se leen como
 * notas (`reserveNote`), exactamente como hasta ahora (NFR-2503). Los movimientos `transfer` nunca
 * forman parte de una celda de gasto o ingreso.
 *
 * @param state Estado del ledger.
 * @param leafId Hoja cuya celda se abre.
 * @param period Periodo de la celda (mes o ciclo).
 * @param periods Rango activo, para el aviso de arrastre.
 * @returns Las entradas del Detalle; `[]` si la hoja no existe o la celda está vacía.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2501, US-ID: US-2501, AC-ID: AC-2501a, TC-ID: TC-DDC-002h, TC-DDC-004f, TC-DDC-159e
 */
export function cellDetail(
  state: LedgerState, leafId: string, period: PeriodKey, periods: PeriodScope
): DetailEntry[] {
  const node = findNode(state.nodes, leafId);
  if (!node) return [];
  const entries: DetailEntry[] = [];

  if (node.type === "transfer") {
    // El aviso de arrastre es del mes, no de la celda: solo aparece si ESTA alcancía aportó (la
    // misma guarda que ya aplicaba la sección de observaciones, auditoría 2026-09-01).
    const aporto = (state.actuals[leafId]?.[period] ?? 0) > 0;
    const carry = aporto ? monthCarryUsage(state, period, "actual", periods) : null;
    if (carry) {
      entries.push({
        kind: "auto",
        text:
          `De los ${cop(carry.reservado)} reservados este mes, ${cop(carry.delSaldoAnterior)} ` +
          `salieron del saldo de ${periodLabel(carry.mesAnterior).toLowerCase()}.`,
      });
    }
    for (const o of cellObservations(state, leafId, period, periods)) {
      if (o.source === "manual") continue; // los manuales entran abajo, como comentarios
      entries.push({ kind: "reserveNote", text: o.text, createdAt: o.createdAt });
    }
  } else {
    const propios = state.movements
      .filter((m) => m.type !== "transfer" && m.target === leafId && m.period === period)
      .sort((a, b) => {
        const byDate = sortDate(a, period).localeCompare(sortDate(b, period));
        return byDate !== 0 ? byDate : a.createdAt - b.createdAt;
      });
    for (const m of propios) {
      entries.push({ kind: m.kind === "adjustment" ? "adjustment" : "movement", movement: m });
    }
  }

  const comentarios = [...(state.cellNotes?.[leafId]?.[period] ?? [])].sort((a, b) => a.createdAt - b.createdAt);
  for (const note of comentarios) entries.push({ kind: "comment", note });

  return entries;
}
