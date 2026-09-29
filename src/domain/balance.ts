// @aitri-trace domain:balance — FR-905/906/907: las seis cifras del balance por mes y por plano.
//
// Módulo:       src/domain/balance.ts
// Propósito:    Derivar el módulo de Balance (seis cifras por columna/mes, en los planos
//               Presupuestado y Ejecutado) a partir del estado del ledger. Capa de DERIVACIÓN
//               pura: no persiste nada, no muta la entrada, no hace IO ni red. El balance es
//               un cálculo de solo lectura — el dato almacenado sigue siendo hoja a hoja.
// Dependencias: ./types (LedgerState, PeriodKey), ./rollup (typeTotals — el mecanismo de
//               agregación EXISTENTE, que esta feature consume sin modificar).
//               El orden de las columnas ya NO vive aquí: la lista de periodos la provee el
//               llamador (FR-1901/ADR-02 de multi-anio), porque el dominio no lee el reloj.

import type { Carry, LedgerState, PeriodKey } from "./types";
import { typeTotals } from "./rollup";
import { reserveDelta, type Plane } from "./reserve";
import { declaredOpeningAt } from "./opening";

/** Los dos planos de la grilla: el plan que el usuario tecleó y lo que ocurrió de verdad.
 *  (El origen del tipo vive en reserve.ts — feature transferencias — para evitar ciclos.) */
export type { Plane } from "./reserve";

/** Las seis cifras de un mes en UN plano, más los dos componentes que arrastra del mes previo. */
export interface MonthBalance {
  /** Saldo disponible con el que abre el mes = cierre disponible del mes previo EN ESTE PLANO (FR-2901). */
  prevAvailable: number;
  /** Saldo reservado con el que abre el mes = cierre reservado del mes previo EN ESTE PLANO (FR-2901). */
  prevReserved: number;
  /**
   * Ingresos del mes en el plano. Se PUBLICA (FR-1810/ADR-09) porque el Balance lo pinta como fila
   * propia: `computeBalanceSeries` ya lo calculaba internamente para derivar `flow`, así que
   * exponerlo no añade ni una pasada — y evita que la UI vuelva a llamar a `typeTotals` por su
   * cuenta, que sería una segunda fuente para el mismo número.
   */
  income: number;
  /** Gastos del mes en el plano. Mismo motivo que `income` (FR-1810/ADR-09). */
  expense: number;
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
export type BalanceSeries = Record<PeriodKey, { budget: MonthBalance; actual: MonthBalance }>;

/**
 * Balance en cero. Lo devuelve `balanceAt` para un periodo que no está en el rango activo.
 *
 * Existe porque desde multi-anio (FR-1901) la serie es DISPERSA: contiene solo los periodos del
 * rango, no doce claves siempre presentes. Un acceso directo `series[p]` a un periodo ausente
 * devuelve `undefined`, y `undefined.available` revienta en ejecución, no en compilación
 * (RISK-02 del TRD). Se accede por aquí, no por corchete.
 */
export const ZERO_BALANCE: MonthBalance = {
  prevAvailable: 0, prevReserved: 0, income: 0, expense: 0, flow: 0,
  reserved: 0, available: 0, reservedBalance: 0, total: 0,
};

/** Lectura segura de la serie dispersa: un periodo fuera del rango vale cero, no `undefined`. */
export function balanceAt(
  series: BalanceSeries, period: PeriodKey
): { budget: MonthBalance; actual: MonthBalance } {
  return series[period] ?? { budget: ZERO_BALANCE, actual: ZERO_BALANCE };
}

// `Carry` (lo que un mes le pasa al siguiente dentro de su plano) se mudó a `types.ts` cuando
// FR-2010 necesitó guardarlo dentro de `Closure`. Misma forma, misma semántica: solo cambió de casa
// para no cerrar un ciclo de imports. Aquí se sigue usando exactamente igual.

/**
 * El PRIMER periodo del rango no tiene previo: abre en 0/0 en ambos componentes y en ambos planos.
 * Ningún otro lo hace — en particular, un enero que no sea el primero abre con el cierre de su
 * diciembre (FR-1903). No existe un saldo inicial manual (es la feature del punto 4).
 */
export const ZERO_CARRY: Carry = { available: 0, reservedBalance: 0 };

/**
 * Movimiento neto de reservas de un mes en un plano: aportes − retiros, derivado de SALDOS
 * RESUELTOS por hoja (feature transferencias, FR-1009 — supersede la versión de FR-907 que
 * sumaba celdas como flujo: con semántica saldo, una celda ausente resolvía 0 e inventaba
 * retiros fantasma en cada mes sin operación, hallazgo 9.2). Puede ser negativo (retiro neto);
 * la conservación total = total previo + flujo se hereda por construcción en monthBalance.
 *
 * @param state Estado completo del ledger.
 * @param month Mes (columna) a calcular.
 * @param plane Plano a leer: `budget` (la trayectoria planeada) o `actual` (lo operado).
 * @returns Σsaldos(m) − Σsaldos(m−1) del tipo transfer. Sin hojas devuelve 0.
 * @throws Nunca. La resolución por hoja es total.
 *
 * @aitri-trace FR-ID: FR-1009, US-ID: US-1009, AC-ID: AC-1009, TC-ID: TC-TRF-109h, TC-TRF-109e, TC-TRF-109f
 */
export function reserveNet(state: LedgerState, month: PeriodKey, plane: Plane): number {
  return reserveDelta(state, month, plane);
}

/**
 * Las seis cifras de un mes en un plano, a partir del arrastre de ESE plano y de los dos insumos
 * del mes.
 *
 * La reconciliación (`total = total previo + flow`) se cumple por construcción y no por una
 * comprobación aparte: `reserved` se resta de `available` y se suma a `reservedBalance`, de modo
 * que se cancela en el total. Guardar reubica la plata, no la crea ni la destruye.
 *
 * Es también lo que sostiene la lectura del Balance reestructurado (FR-1810): «Quedó disponible»
 * (`flow − reserved`) es exactamente `available − prev.available`, y «Reservas del mes»
 * (`reserved`) es `reservedBalance − prev.reservedBalance`. Las dos filas del bloque del reparto
 * son, literalmente, el movimiento de cada saldo — por eso el encadenamiento mes a mes cierra sin
 * fórmula nueva (ADR-09).
 *
 * @param prev Cierre del mes anterior en el MISMO plano (el `opening` en el primer periodo).
 * @param income Ingresos del mes en el plano.
 * @param expense Gastos del mes en el plano.
 * @param reserved Neto reservado del mes en el plano.
 * @returns Las cifras del mes, más los dos componentes arrastrados.
 * @throws Nunca. Es aritmética total sobre números finitos.
 *
 * @aitri-trace FR-ID: FR-905, US-ID: US-905, AC-ID: AC-905, TC-ID: TC-BAL-905h, TC-BAL-915e, TC-BAL-925e
 */
function monthBalance(prev: Carry, income: number, expense: number, reserved: number): MonthBalance {
  const flow = income - expense;
  const available = prev.available + flow - reserved;
  const reservedBalance = prev.reservedBalance + reserved;
  return {
    prevAvailable: prev.available,
    prevReserved: prev.reservedBalance,
    income,
    expense,
    flow,
    reserved,
    available,
    reservedBalance,
    total: available + reservedBalance,
  };
}

/**
 * Calcula la serie de balance completa: todos los periodos × 2 planos, en una sola pasada.
 *
 * CADA PLANO ARRASTRA SU PROPIO SALDO (FR-2901, feature carril-de-presupuesto, 2026-09-27): el mes
 * Pres. abre con el cierre Pres. del mes anterior y el mes Ejec. con el cierre Ejec. Los dos arrancan
 * del mismo `opening` en el primer periodo (FR-2902). Palabras del usuario: «el presupuesto y el
 * ejecutado deberían tener el mismo comportamiento, para poder hacer una simulación real y una
 * comparación real».
 *
 * HISTORIA. ADR-03 de balance (revisado el 2026-07-27) hacía lo contrario: los dos planos abrían en el
 * cierre REAL, para que un mes mal ejecutado no dejara al plan siguiente arrancando con plata que ya
 * no existía. El precio era que el plan de un mes futuro no le pasaba nada al siguiente, así que no se
 * podía planear un año hacia adelante. El usuario eligió el carril propio conociendo ese caso: la
 * desviación entre plan y realidad se lee comparando las dos columnas.
 *
 * @param state Estado completo del ledger (nodos + budgets + actuals). NO se muta.
 * @param periods Los periodos de la serie, en orden (los provee el llamador, FR-1901).
 * @param opening El arrastre con que abren LOS DOS planos en `periods[0]`.
 * @returns La serie por mes, cada uno con sus planos `budget` y `actual`.
 * @throws Nunca. Un nodo mal referenciado o una celda ausente resuelven 0, igual que los `rollup*`.
 *
 * @aitri-trace FR-ID: FR-2901, US-ID: US-2901, AC-ID: AC-2901, TC-ID: TC-CDP-001h, TC-CDP-002h, TC-CDP-003e, TC-CDP-004f
 * @aitri-trace FR-ID: FR-2902, US-ID: US-2902, AC-ID: AC-2905, TC-ID: TC-CDP-010h, TC-CDP-011e, TC-CDP-012f
 */
export function computeBalanceSeries(
  state: LedgerState,
  periods: readonly PeriodKey[],
  opening: Carry = ZERO_CARRY
): BalanceSeries {
  const series = {} as BalanceSeries;
  let prevBudget: Carry = opening;
  let prevActual: Carry = opening;

  // Solo periods[0] abre en `opening` (FR-1903). Cada diciembre entrega su saldo a enero del año
  // siguiente igual que cualquier periodo entrega al siguiente: el borde de año no reinicia nada.
  //
  // `opening` lo introdujo FR-2010: calcular el «antes» del impacto es correr ESTA MISMA serie
  // abriendo en la línea de base en vez de en el carry actual — no una fórmula paralela.
  for (const [i, month] of periods.entries()) {
    // BG-054: el mes de inicio abre en el saldo declarado, que sustituye al disponible arrastrado.
    // También en `periods[0]`: el Balance ya lo pasa en `opening` (y esto no cambia nada), pero el
    // cierre arranca series con su propia apertura —`closingCarry`, la línea de base al reabrir— y,
    // si la primera de esas series es justo el mes de inicio, sin esto el impacto de reabrir el mes
    // anterior se calculaba sin el saldo declarado (revisión adversarial, 2026-09-29).
    const apertura = declaredOpeningAt(state, month);
    if (apertura !== null) {
      prevBudget = { ...prevBudget, available: apertura };
      prevActual = { ...prevActual, available: apertura };
    }
    const income = typeTotals(state, "income", [month]);
    const expense = typeTotals(state, "expense", [month]);

    const budget = monthBalance(prevBudget, income.budget, expense.budget, reserveNet(state, month, "budget"));
    const actual = monthBalance(prevActual, income.actual, expense.actual, reserveNet(state, month, "actual"));

    series[month] = { budget, actual };
    prevBudget = budget;
    prevActual = actual;
  }

  return series;
}
