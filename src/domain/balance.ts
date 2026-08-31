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
import { reserveDelta, type Plane, reserveAportes } from "./reserve";

/** Los dos planos de la grilla: el plan que el usuario tecleó y lo que ocurrió de verdad.
 *  (El origen del tipo vive en reserve.ts — feature transferencias — para evitar ciclos.) */
export type { Plane } from "./reserve";

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
 * Movimiento neto de reservas de un mes en un plano: aportes − retiros, derivado de SALDOS
 * RESUELTOS por hoja (feature transferencias, FR-1009 — supersede la versión de FR-907 que
 * sumaba celdas como flujo: con semántica saldo, una celda ausente resolvía 0 e inventaba
 * retiros fantasma en cada mes sin operación, hallazgo 9.2). Puede ser negativo (retiro neto);
 * la conservación total = total previo + flujo se hereda por construcción en monthBalance.
 *
 * @param state Estado completo del ledger.
 * @param month Mes (columna) a calcular.
 * @param plane Plano a leer: `budget` (la trayectoria planeada, anclada al real previo, ADR-03)
 *              o `actual` (lo operado).
 * @returns Σsaldos(m) − Σsaldos(m−1) del tipo transfer. Sin hojas devuelve 0.
 * @throws Nunca. La resolución por hoja es total.
 *
 * @aitri-trace FR-ID: FR-1009, US-ID: US-1009, AC-ID: AC-1009, TC-ID: TC-TRF-109h, TC-TRF-109e, TC-TRF-109f
 */
export function reserveNet(state: LedgerState, month: MonthKey, plane: Plane): number {
  return reserveDelta(state, month, plane);
}

/**
 * De dónde salió lo reservado en un mes: del flujo propio (ingresos − gastos) o del acumulado que
 * traía (FR-1810).
 *
 * Reporte del usuario, textual: «está diciendo que el mes quedamos debiendo y no es correcto…
 * reservas del mes, sin contar lo que sacamos del acumulado». Cuando la fila «Reservas del mes»
 * resta el bruto completo del flujo, un mes que reservó 1.500 con flujo de 1.000 muestra
 * «Disponible del mes −500» con alarma — una deuda que no existe, porque los 500 salieron del
 * cierre del mes anterior. El desglose carga cada peso a su fuente:
 *
 *     delFlujo     = max(0, min(aportes, flujo))     → se resta del flujo del mes
 *     delAcumulado = aportes − delFlujo              → se resta del saldo del mes anterior
 *
 * La suma reconstruye el bruto, así que la cascada completa cierra exactamente igual que la fórmula
 * vigente (verificado por partida doble en TC-TDF-101e). En un estado imposible (reservas por
 * encima de flujo + acumulado) el negativo aflora en «Saldo disponible» — donde el hueco es real —
 * y con flujo negativo por gastos el «Disponible del mes» sí queda en deuda, que también es real.
 *
 * @param state Estado del ledger (no se muta).
 * @param month Mes a desglosar.
 * @param plane Plano a leer.
 * @returns Los dos componentes, ambos ≥ 0.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-1810, US-ID: US-1810, AC-ID: AC-1839, TC-ID: TC-TDF-100h, TC-TDF-102f
 */
export function reserveSplit(
  state: LedgerState,
  month: MonthKey,
  plane: Plane
): { delFlujo: number; delAcumulado: number } {
  const income = typeTotals(state, "income", [month]);
  const expense = typeTotals(state, "expense", [month]);
  const flujo = plane === "budget" ? income.budget - expense.budget : income.actual - expense.actual;
  const aportes = reserveAportes(state, month, plane);
  const delFlujo = Math.max(0, Math.min(aportes, flujo));
  return { delFlujo, delAcumulado: aportes - delFlujo };
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
