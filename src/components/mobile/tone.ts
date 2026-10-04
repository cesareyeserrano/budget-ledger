// @aitri-trace components:mobile:tone — feature presupuesto-movil (FR-3103).
//
// Módulo:       src/components/mobile/tone.ts
// Propósito:    Traduce el tono de estado del dominio (`CellTone`) a los tokens de color del
//               sistema de diseño. No decide el tono: eso lo hace `cellTone`, igual que en escritorio.
// Dependencias: @/domain/budgetState (solo el tipo).

import type { CellTone } from "@/domain/budgetState";

/** Color del texto de una cifra según su tono. */
const TEXT: Record<CellTone, string> = {
  neutral: "var(--fg)",
  muted: "var(--fg-muted)",
  favorable: "var(--favorable)",
  "alert-soft": "var(--alert-soft)",
  "alert-strong": "var(--alert-strong)",
};

/** Color del relleno de la barra de avance: el neutro se atenúa para no competir con la cifra. */
const BAR: Record<CellTone, string> = { ...TEXT, neutral: "var(--fg-muted)" };

/**
 * @param tone Tono de estado.
 * @returns La variable CSS del color del texto, lista para `style`.
 * @throws Nunca.
 */
export function toneColor(tone: CellTone): string {
  return TEXT[tone];
}

/**
 * @param tone Tono de estado.
 * @returns La variable CSS del relleno de la barra de avance.
 * @throws Nunca.
 */
export function barColor(tone: CellTone): string {
  return BAR[tone];
}
