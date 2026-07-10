// @aitri-trace domain:budgetState — FR-401: estado de sobre-consumo de un presupuesto de GASTO.
//
// Module:       src/domain/budgetState.ts
// Purpose:      Única fuente de verdad del umbral neutro/ámbar/rojo. Aritmética pura: sin React,
//               sin CSS. La UI mapea el enum que devuelve tanto a COLOR como a GLIFO, de modo que
//               el canal redundante de WCAG 1.4.1 no pueda desincronizarse del color (ADR-02).
// Dependencies: ninguna.

/** Estado de consumo de un presupuesto de gasto. Semántico, nunca un color (ADR-02). */
export type BudgetState = "within" | "over_soft" | "over_hard";

/**
 * Umbral del estado grave: a partir de este múltiplo del presupuesto, el sobre-consumo es "mucho".
 * Se exporta para que los tests lo importen en vez de repetir el literal 1.2, y un cambio de umbral
 * no pueda pasar inadvertido.
 */
export const OVER_HARD_RATIO = 1.2;

/**
 * Deriva el estado de consumo de un presupuesto de GASTO.
 *
 * Función TOTAL: definida para presupuesto 0, ejecutado 0 y entradas negativas (que el dominio no
 * produce, porque `setLeafAmount` aplica `Math.max(0, …)`). Nunca lanza, nunca devuelve NaN ni
 * Infinity, y nunca divide por cero.
 *
 *  - ratio ≤ 1               → "within"      (el 100 % exacto es el último valor dentro del presupuesto)
 *  - 1 < ratio < 1.2         → "over_soft"   ("te pasaste poco")
 *  - ratio ≥ 1.2             → "over_hard"   ("te pasaste mucho")
 *  - presupuesto 0, ejec > 0 → "over_hard"   (no admite porcentaje: es el estado más grave)
 *  - ejecutado ≤ 0           → "within"      (el em-dash atenuado lo resuelve la capa de UI)
 *
 * @param budget Presupuesto del mes para esa hoja/roll-up, en pesos. 0 es válido.
 * @param actual Ejecutado del mes, en pesos. 0 es válido.
 * @returns El estado semántico; siempre uno de los tres valores del enum.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-401, US-ID: US-401, AC-ID: AC-401, TC-ID: TC-BSC-401h, TC-BSC-401e, TC-BSC-401f, TC-BSC-411e
 */
export function budgetState(budget: number, actual: number): BudgetState {
  // Sin ejecutado no hay consumo que graduar — cubre también el par degenerado (0, 0).
  if (actual <= 0) return "within";
  // Sin presupuesto no hay porcentaje posible: se trata como el estado más grave, sin dividir por cero.
  if (budget <= 0) return "over_hard";

  const ratio = actual / budget;
  if (ratio <= 1) return "within";
  if (ratio < OVER_HARD_RATIO) return "over_soft";
  return "over_hard";
}
