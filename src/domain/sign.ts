// @aitri-trace domain:sign — FR-008: signo, color y varianza por tipo.
import type { NodeType } from "./types";

export type Sign = "+" | "−" | "↔";
export type Variance = "over" | "favorable" | "under" | "neutral";

export function signOf(type: NodeType): Sign {
  switch (type) {
    case "expense":
      return "−";
    case "income":
      return "+";
    case "transfer":
      return "↔";
  }
}

/**
 * Regla de varianza (FR-008):
 * - Gasto: Ejecutado > Presupuestado => 'over' (--error).
 * - Ingreso: Ejecutado >= Presupuestado => 'favorable' (--success); si < => 'under' (--warning).
 * - Transferencia: siempre 'neutral' (--accent-light), sin juicio de sobre/bajo.
 */
export function varianceOf(type: NodeType, budget: number, actual: number): Variance {
  if (type === "transfer") return "neutral";
  if (type === "expense") return actual > budget ? "over" : "neutral";
  // income
  return actual >= budget ? "favorable" : "under";
}

/** Token CSS asociado a una varianza (para la UI). */
export function varianceColorVar(v: Variance): string {
  switch (v) {
    case "over":
      return "--error";
    case "favorable":
      return "--success";
    case "under":
      return "--warning";
    case "neutral":
      return "--accent-light";
  }
}
