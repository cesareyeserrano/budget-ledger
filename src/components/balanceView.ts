// @aitri-trace components:balanceView — features balance, techo-de-flujo, balance-jerarquia y presupuesto-movil (FR-3111, FR-3115, NFR-3106).
//
// Módulo:       src/components/balanceView.ts
// Propósito:    Lo que el Balance PINTA, como funciones puras: el valor de cada fila, su color, la
//               regla del cero y el resumen de los cuatro saldos. Las tres primeras vivían como
//               privadas dentro de `BalanceModule.tsx` y se mudaron aquí SIN cambiar su cuerpo, para
//               que el Balance del teléfono no las reimplemente.
// Dependencias: @/domain/balance, @/domain/reserve, ./balanceRows (RowSpec), ./exceptionColor.
//               Vive junto a `balanceRows.ts` y no en el dominio porque depende de su `RowSpec`.

import { balanceAt, type BalanceSeries, type MonthBalance, type Plane } from "@/domain/balance";
import { reserveAportes, reserveRetiros } from "@/domain/reserve";
import type { LedgerState, PeriodKey } from "@/domain/types";
import type { RowSpec } from "./balanceRows";
import { exceptionColor } from "./exceptionColor";

/**
 * Color de una cifra del balance según su fila y su signo.
 *
 * El color es ESCASO a propósito (principio heredado de budget-state-color): el rojo señala lo que
 * quedó negativo y TODO LO DEMÁS es neutro. Un color en cada cifra positiva sería ruido permanente
 * y dejaría de significar algo.
 *
 * balance-jerarquia FR-1403: esa frase estaba escrita aquí desde el principio, y la línea siguiente
 * la incumplía —`if (spec.tone === "result") return "var(--favorable)"`— pintando de verde las tres
 * filas de resultado en las doce columnas: 72 celdas verdes con un balance sano, medido a 1920px el
 * 2026-08-24. El verde había dejado de ser señal para ser el fondo del módulo, y el único dato que
 * sí exigía atención competía contra él. Ahora la regla vive en `exceptionColor` y se aplica de
 * verdad; los resultados se distinguen por PESO y SANGRÍA, no por color.
 *
 * @param spec Fila a la que pertenece la celda.
 * @param value Valor de la celda.
 * @returns La variable CSS del color, lista para `style`.
 *
 * @aitri-trace FR-ID: FR-1403, US-ID: US-1403, AC-ID: AC-1403a, TC-ID: TC-BJE-005h, TC-BJE-006h, TC-BJE-005f
 */
export function balanceColor(spec: RowSpec, value: number): string {
  // La excepción manda: si está en rojo, se ve, sea cual sea la fila.
  if (spec.alarms && value < 0) return exceptionColor(value, { alarms: true });
  // Un SUMANDO es contexto: atenuado, para que los resultados destaquen sin gastar color.
  // refinamiento-ui FR-1201: el reservado dejaba de ser azul por ser del tipo `transfer` — eso era
  // identidad, no estado. Ahora se distingue por su fila, su rótulo y su signo, como el resto.
  if (spec.tone !== "result") return "var(--fg-secondary)";
  // Un RESULTADO sano: neutro pleno. Destaca sobre el sumando por contraste y peso, no por hue.
  return exceptionColor(value, { alarms: spec.alarms });
}

/** Aportes y retiros BRUTOS del mes por plano — las dos filas de un solo signo del bloque 2. */
export type ReserveFlows = Record<PeriodKey, Record<Plane, { aportes: number; retiros: number }>>;

/**
 * Desdoble del movimiento de reservas por mes y plano: `aportes` (subidas de saldo) y `retiros`
 * (bajadas), ambos ≥ 0 siempre — el neto que usa el dominio es `aportes − retiros`.
 *
 * FR-1810 v3 los vuelve a necesitar: el Balance publica las dos cifras BRUTAS en filas separadas.
 * Netearlas ahorraría una fila y produciría «− Reservas del mes: −500» en un mes que sólo
 * retira, que es doble negación.
 *
 * @param data Estado del ledger.
 * @returns Los dos componentes por mes y plano.
 *
 * @aitri-trace FR-ID: FR-1810, US-ID: US-1810, AC-ID: AC-1840, TC-ID: TC-TDF-101h
 */
export function reserveFlows(data: LedgerState, periods: readonly PeriodKey[]): ReserveFlows {
  const out = {} as ReserveFlows;
  for (const m of periods) {
    out[m] = {
      budget: { aportes: reserveAportes(data, m, "budget"), retiros: reserveRetiros(data, m, "budget") },
      actual: { aportes: reserveAportes(data, m, "actual"), retiros: reserveRetiros(data, m, "actual") },
    };
  }
  return out;
}

/**
 * Valor a pintar en una celda: el campo homónimo del balance, o la cifra bruta que la fila declara.
 *
 * FR-1810 — la columna se lee como DOS CUENTAS encadenadas, cada una cerrando a la vista:
 *
 *     Ingresos − Gastos                                        = Resultado del mes
 *     Venía + Resultado − Guardado + Sacado                     = Saldo disponible
 *     Saldo disponible + Saldo reservado                           = Saldo total
 *
 * La segunda es la fórmula que el propio usuario enunció, y es idéntica por construcción a la que
 * el dominio ya calculaba: `prevAvailable + flow − (aportes − retiros) = available`. Por eso la
 * reestructuración no puede mover un peso — sólo cambia dónde se parte la misma resta (ADR-09).
 *
 * @param m Las cifras del mes en un plano.
 * @param key Fila a leer.
 * @param flows Aportes y retiros BRUTOS del mes en ese plano.
 * @returns El valor a pintar en la celda.
 *
 * @aitri-trace FR-ID: FR-1810, US-ID: US-1810, AC-ID: AC-1839, TC-ID: TC-TDF-100h, TC-TDF-102e
 */
export function balanceRowValue(m: MonthBalance, key: RowSpec["key"], flows: { aportes: number; retiros: number }): number {
  if (key === "monthResult" || key === "monthResultCarry") return m.flow;
  if (key === "toReserves") return flows.aportes;
  if (key === "toWithdrawals") return flows.retiros;
  // `retiros` no es una fila del Balance (vive en el segmento de Reservas, ADR-09) y nunca llega.
  if (key === "retiros") return 0;
  return m[key];
}

/**
 * ¿Un cero de esta fila es una RESPUESTA y no la ausencia de dato?
 *
 * FR-1810 — un RESULTADO que vale 0 se pinta «0», no con el guion de vacío: en «Saldo disponible»,
 * «Resultado del mes» y «Saldo total» el cero es la respuesta a la pregunta de la fila. Las filas de
 * INSUMO conservan el guion, que ahí sí significa «nada que mostrar».
 *
 * @param spec Fila.
 * @param value Valor de la celda.
 * @returns true si hay que pintar «0».
 * @throws Nunca.
 */
export function zeroIsAnswer(spec: RowSpec, value: number): boolean {
  return value === 0 && spec.tone === "result";
}

/** Un saldo en sus dos planos: lo real y lo planeado. */
export interface SaldoPar {
  actual: number;
  budget: number;
}

/** Los cuatro saldos del resumen del teléfono (presupuesto-movil FR-3115). */
export interface BalanceSummary {
  resultado: SaldoPar;
  disponible: SaldoPar;
  reservado: SaldoPar;
  total: SaldoPar;
}

/**
 * Los cuatro saldos de un periodo, leídos de la serie del Balance: son las filas «Resultado del
 * mes», «Saldo disponible», «Saldo reservado» y «Saldo total» de escritorio, cifra por cifra.
 *
 * @param series Serie calculada por `computeBalanceSeries`.
 * @param period Periodo.
 * @returns Lo real y lo planeado de cada saldo; ceros si el periodo no está en la serie.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3115, US-ID: US-3115, AC-ID: AC-3143, TC-ID: TC-PMV-104e, TC-PMV-142h
 */
export function balanceSummary(series: BalanceSeries, period: PeriodKey): BalanceSummary {
  const { actual, budget } = balanceAt(series, period);
  const par = (key: "flow" | "available" | "reservedBalance" | "total"): SaldoPar => ({ actual: actual[key], budget: budget[key] });
  return { resultado: par("flow"), disponible: par("available"), reservado: par("reservedBalance"), total: par("total") };
}
