import type { NodeType } from "@/domain/types";

export type Theme = "light" | "dark";

/** Tema por defecto resuelto cuando next-themes aún no resolvió (SSR/tests). */
export const DEFAULT_THEME: Theme = "light";

/**
 * Fuente única de los hex por tipo y tema (FR-204). Debe coincidir con globals.css.
 *
 * ux-consistency (FR-301/FR-311): los valores se AFINAN a tonos DESATURADOS — ladrillo / bosque /
 * acero — para eliminar la vibración (cromoestereopsis) sin cambiar el hue ni la semántica; permitido
 * por NFR-302 ("los tokens solo se AFINAN"). En claro pasan ≥4.9:1 sobre blanco y están balanceados a
 * igual claridad perceptual (L* ≈ 47/47/45). En oscuro se aclaran y desaturan (≥5.6:1 sobre superficie).
 */
export const TYPE_COLORS: Record<NodeType, Record<Theme, string>> = {
  expense: { light: "#C4453E", dark: "#EC6A66" },
  income: { light: "#2F7D53", dark: "#5FBE82" },
  transfer: { light: "#2F6DB4", dark: "#6BA6F1" },
};

/**
 * Variante de color de tipo SEGURA para TEXTO PEQUEÑO (≥4.5:1). Con la paleta afinada los tres tonos
 * ya cumplen AA como texto en su tema, así que el verde no necesita una variante aparte.
 */
const TYPE_TEXT_COLORS: Record<NodeType, Record<Theme, string>> = {
  expense: { light: "#C4453E", dark: "#EC6A66" },
  income: { light: "#2F7D53", dark: "#5FBE82" },
  transfer: { light: "#2F6DB4", dark: "#6BA6F1" },
};

/**
 * Color de relleno / texto grande de un tipo por tema (FR-204).
 * @aitri-trace FR-ID: FR-204, US-ID: US-204, AC-ID: AC-204, TC-ID: TC-SUT-210h
 */
export function typeColor(type: NodeType, theme: Theme): string {
  return TYPE_COLORS[type][theme];
}

/**
 * Color de un tipo apto para TEXTO PEQUEÑO (AA ≥4.5:1).
 * @aitri-trace FR-ID: FR-204, US-ID: US-204, AC-ID: AC-204, TC-ID: TC-SUT-212f
 */
export function typeTextColor(type: NodeType, theme: Theme): string {
  return TYPE_TEXT_COLORS[type][theme];
}
