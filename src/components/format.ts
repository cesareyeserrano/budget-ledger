import type { NodeType } from "@/domain/types";

export function money(n: number | undefined): string {
  const v = n ?? 0;
  // El negativo lleva el signo DELANTE del `$` y con el menos tipográfico (U+2212), igual que el
  // módulo de Balance. `toLocaleString` a secas producía «$-500» — signo descolocado y un tercer
  // formato distinto para la misma clase de cifra (auditoría 2026-09-01).
  if (v < 0) return "−$" + Math.abs(v).toLocaleString("es-CO");
  return "$" + v.toLocaleString("es-CO");
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

/**
 * El aviso de que un BORRADO dejaría la celda por debajo de 0 (FR-2505, FR-2506).
 *
 * Vive aquí y no en cada componente porque hay DOS vías para el mismo acto —la papelera de la fila
 * y dejar el monto en 0 en el bloque de edición— y el usuario tiene que leer exactamente lo mismo
 * por las dos. Cuando cada una tenía su texto, decían cosas distintas de la misma situación
 * («No se puede borrar: la celda quedaría en …» frente a «No se puede: Restaurantes quedaría en …,
 * y ninguna celda puede quedar por debajo de 0»), y eso le sugiere al usuario que son operaciones
 * diferentes y que quizá una sí le deje. Lo cazó TC-DDC-126f, que compara los dos textos.
 *
 * @param value Valor en el que quedaría la celda (negativo).
 * @returns El aviso, idéntico venga de donde venga.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2505, US-ID: US-2505, AC-ID: AC-2505e, TC-ID: TC-DDC-126f
 */
export function textoBorradoNegativo(value: number): string {
  return `No se puede borrar: la celda quedaría en ${money(value)}.`;
}
