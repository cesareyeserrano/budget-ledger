import type { NodeType } from "@/domain/types";

export function money(n: number | undefined): string {
  return "$" + (n ?? 0).toLocaleString("es-CO");
}

/** En la grilla, 0 se muestra como em-dash (como el prototipo). */
export function cellNum(n: number | undefined): string {
  if (!n) return "—";
  return n.toLocaleString("es-CO");
}

/**
 * Variable CSS theme-aware del color de cada tipo (FR-204). Transferencia pasa de
 * steel a azul; el valor concreto por tema lo resuelve globals.css (:root/.dark).
 *
 * @aitri-trace FR-ID: FR-204, US-ID: US-204, AC-ID: AC-204, TC-ID: TC-SUT-210h
 */
export function typeColorVar(type: NodeType): string {
  switch (type) {
    case "expense":
      return "var(--type-expense)";
    case "income":
      return "var(--type-income)";
    case "transfer":
      return "var(--type-transfer)";
  }
}

/**
 * Color de tipo apto para TEXTO PEQUEÑO (AA ≥4.5:1). Solo Ingreso necesita la variante
 * green-700 en tema claro (globals: --type-income-text); el resto usa su color base.
 *
 * @aitri-trace FR-ID: FR-204, US-ID: US-204, AC-ID: AC-204, TC-ID: TC-SUT-212f
 */
export function typeTextColorVar(type: NodeType): string {
  return type === "income" ? "var(--type-income-text)" : typeColorVar(type);
}

/**
 * Relleno de acento AA-seguro para el estado activo con texto blanco (--on-accent), ≥4.5:1 en
 * ambos temas (ux-consistency FR-311). Ingreso usa green-700 como relleno; Gasto/Transferencia
 * su tono base ya pasa con blanco.
 *
 * @aitri-trace FR-ID: FR-311, US-ID: US-311, AC-ID: AC-311, TC-ID: TC-UXC-311h
 */
export function typeFillVar(type: NodeType): string {
  switch (type) {
    case "expense":
      return "var(--type-expense-fill)";
    case "income":
      return "var(--type-income-fill)";
    case "transfer":
      return "var(--type-transfer-fill)";
  }
}
