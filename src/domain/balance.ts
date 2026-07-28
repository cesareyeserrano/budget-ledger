// @aitri-trace domain:balance — FR-905/906/907: las seis cifras del balance por mes y por plano.
//
// Módulo:       src/domain/balance.ts
// Propósito:    Derivar el módulo de Balance (seis cifras por columna/mes, en los planos
//               Presupuestado y Ejecutado) a partir del estado del ledger. Capa de DERIVACIÓN
//               pura: no persiste nada, no muta la entrada, no hace IO ni red. El balance es
//               un cálculo de solo lectura — el dato almacenado sigue siendo hoja a hoja.
// Dependencias: ./types (LedgerState, MonthKey), ./rollup (typeTotals — el mecanismo de
//               agregación EXISTENTE, que esta feature consume sin modificar), ./months
//               (MONTH_KEYS, el orden de las columnas).

import type { LedgerState, MonthKey } from "./types";
import { typeTotals } from "./rollup";
import { MONTH_KEYS } from "./months";

/** Los dos planos de la grilla: el plan que el usuario tecleó y lo que ocurrió de verdad. */
export type Plane = "budget" | "actual";

/** Las seis cifras de un mes en UN plano, más los dos componentes que arrastra del mes previo. */
export interface MonthBalance {
  /** Saldo disponible con el que abre el mes = cierre disponible REAL del mes previo (ambos planos). */
  prevAvailable: number;
  /** Saldo reservado con el que abre el mes = cierre reservado REAL del mes previo (ambos planos). */
  prevReserved: number;
  /** Flujo del mes = Ingreso − Gasto. NO incluye el arrastre ni las reservas. */
  flow: number;
  /** Reservas del mes = lo transferido (guardado) este mes. En v1 solo aportes, luego ≥ 0. */
  reserved: number;
  /** Saldo disponible = prevAvailable + flow − reserved. Lo gastable. Puede ser negativo. */
  available: number;
  /** Saldo reservado GLOBAL acumulado = prevReserved + reserved. */
  reservedBalance: number;
  /** Saldo total = available + reservedBalance. El bottom-line. Puede ser negativo. */
  total: number;
}

/** La serie completa: cada mes con sus dos planos independientes. */
export type BalanceSeries = Record<MonthKey, { budget: MonthBalance; actual: MonthBalance }>;

/** Lo que un mes le pasa al siguiente DENTRO de su propio plano: dos componentes que no se mezclan. */
interface Carry {
  available: number;
  reservedBalance: number;
}

/**
 * El mes 1 no tiene mes previo: abre en 0/0 en ambos componentes y en ambos planos.
 * No existe un saldo inicial manual (decisión de producto, no_go_zone).
 */
const ZERO_CARRY: Carry = { available: 0, reservedBalance: 0 };

/**
 * Neto de reserva de un mes en un plano: lo transferido (guardado) hacia las reservas.
 *
 * Se apoya en `typeTotals`, el mismo roll-up que ya alimenta las filas de total por tipo — de ahí
 * que el "Reservas del mes" del balance y la fila TRANSFERENCIAS de la grilla no puedan divergir.
 * En v1 solo se guarda (aportes ≥ 0), así que el neto nunca es negativo.
 *
 * @param state Estado completo del ledger.
 * @param month Mes (columna) a calcular.
 * @param plane Plano a leer: `budget` (el plan tecleado) o `actual` (lo real).
 * @returns El neto transferido del mes en ese plano. Sin hojas de transferencia devuelve 0.
 * @throws Nunca. Un mes sin celdas resuelve 0, igual que los `rollup*`.
 *
 * @aitri-trace FR-ID: FR-907, US-ID: US-907, AC-ID: AC-907, TC-ID: TC-BAL-907h, TC-BAL-907f, TC-BAL-936e
 */
export function reserveNet(state: LedgerState, month: MonthKey, plane: Plane): number {
  return typeTotals(state, "transfer", [month])[plane];
}

/**
 * Las seis cifras de un mes en un plano, a partir del arrastre de ESE plano y de los dos insumos
 * del mes.
 *
 * La reconciliación (`total = total previo + flow`) se cumple por construcción y no por una
 * comprobación aparte: `reserved` se resta de `available` y se suma a `reservedBalance`, de modo
 * que se cancela en el total. Guardar reubica la plata, no la crea ni la destruye.
 *
 * @param prev Cierre REAL del mes anterior (0/0 en el mes 1). Lo comparten ambos planos.
 * @param flow Flujo del mes del plano = Ingreso − Gasto. Puede ser negativo.
 * @param reserved Neto reservado del mes en el plano.
 * @returns Las seis cifras del mes, más los dos componentes arrastrados.
 * @throws Nunca. Es aritmética total sobre números finitos.
 *
 * @aitri-trace FR-ID: FR-905, US-ID: US-905, AC-ID: AC-905, TC-ID: TC-BAL-905h, TC-BAL-915e, TC-BAL-925e
 */
function monthBalance(prev: Carry, flow: number, reserved: number): MonthBalance {
  const available = prev.available + flow - reserved;
  const reservedBalance = prev.reservedBalance + reserved;
  return {
    prevAvailable: prev.available,
    prevReserved: prev.reservedBalance,
    flow,
    reserved,
    available,
    reservedBalance,
    total: available + reservedBalance,
  };
}

/**
 * Calcula la serie de balance completa: los 12 meses × 2 planos, en una sola pasada.
 *
 * ADR-03 (revisado 2026-07-27): AMBOS planos abren cada mes en el cierre REAL del mes anterior.
 * El presupuesto de un mes se planea sobre la plata que de verdad quedó, no sobre la que se había
 * planeado tener; así el plan se re-ancla a la realidad mes a mes en vez de arrastrar el error de
 * un mes mal ejecutado hasta diciembre. Solo la cadena ejecutada acumula: el cierre presupuestado
 * de un mes NO alimenta al siguiente, porque cada mes se planea a mano.
 *
 * @param state Estado completo del ledger (nodos + budgets + actuals). NO se muta.
 * @returns La serie por mes, cada uno con sus planos `budget` y `actual`.
 * @throws Nunca. Un nodo mal referenciado o una celda ausente resuelven 0, igual que los `rollup*`.
 *
 * @aitri-trace FR-ID: FR-905, US-ID: US-905, AC-ID: AC-905, TC-ID: TC-BAL-905h, TC-BAL-905e, TC-BAL-906h, TC-BAL-908f
 */
export function computeBalanceSeries(state: LedgerState): BalanceSeries {
  const series = {} as BalanceSeries;
  let prevActual: Carry = ZERO_CARRY;

  for (const month of MONTH_KEYS) {
    const income = typeTotals(state, "income", [month]);
    const expense = typeTotals(state, "expense", [month]);

    // AMBOS planos abren en el cierre REAL del mes previo: el plan de un mes se hace sobre la plata
    // que de verdad quedó, no sobre la que se había planeado tener. Solo la cadena ejecutada
    // acumula — el cierre presupuestado de un mes NO se arrastra al siguiente.
    const budget = monthBalance(prevActual, income.budget - expense.budget, reserveNet(state, month, "budget"));
    const actual = monthBalance(prevActual, income.actual - expense.actual, reserveNet(state, month, "actual"));

    series[month] = { budget, actual };
    prevActual = actual;
  }

  return series;
}
