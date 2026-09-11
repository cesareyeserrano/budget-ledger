// @aitri-trace components:gridLayout — geometría compartida de la grilla de presupuesto.
//
// Módulo:       src/components/gridLayout.ts
// Propósito:    Constantes de layout que la grilla (`BudgetGrid`) y el módulo de Balance
//               (`BalanceModule`) deben compartir para que sus columnas queden alineadas.
//               Viven aquí, y no en `BudgetGrid.tsx`, porque `BudgetGrid` monta el
//               `BalanceModule`: importarlas de vuelta desde allí sería un ciclo.
// Dependencias: ninguna (solo cadenas de clases Tailwind).

/** Ancho de la columna fija de categorías, vía la CSS var --cat-w (FR-104, redimensionable). */
export const LABEL_W = "w-[var(--cat-w)]";

/** Ancho de una sub-celda de mes (Pres. o Ejec.). Un mes ocupa dos: 216px. */
export const CELL_W = "w-[108px]";

/** Base de la celda fija (sticky) de la izquierda: la que no scrollea con los meses. */
export const STICKY_BASE =
  "sticky left-0 z-[2] flex items-center gap-2 flex-none border-r border-border-strong min-h-[34px]";
