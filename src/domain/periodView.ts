// @aitri-trace domain:periodView — feature presupuesto-movil (FR-3103, FR-3104), ADR-02.
//
// Módulo:       src/domain/periodView.ts
// Propósito:    El view-model de la lista de UN periodo para el teléfono. No calcula cifras: las lee
//               de la misma `rollupTable` que la grilla de escritorio y las ordena como ella. Lo único
//               propio es la forma (secciones › grupos › hijos) y la razón de avance de la barra.
// Dependencias: ./rollup, ./tree, ./budgetState, ./closure, ./reserve, ./types.

import { cellGlyph, cellTone, type CellTone } from "./budgetState";
import { closureOf, isClosed } from "./closure";
import { RETIROS_PLAN_ID, reserveRetiros } from "./reserve";
import { rollupTable } from "./rollup";
import { TYPE_ORDER, isLeaf, orderedChildren, orderedGroups } from "./tree";
import type { LedgerNode, LedgerState, NodeType, PeriodKey } from "./types";

/** Nombre de la fila de retiros, igual que en la grilla de escritorio. */
export const RETIROS_ROW_NAME = "Retiros del mes";

/** Una fila de la lista: un grupo, una categoría, una subcategoría o la fila de retiros. */
export interface PeriodRow {
  /** Id del nodo; `RETIROS_PLAN_ID` para la fila «Retiros del mes». */
  id: string;
  name: string;
  icon: string | null;
  /** 0 = grupo, 1 = categoría, 2 = subcategoría. */
  level: 0 | 1 | 2;
  type: NodeType;
  /** Presupuestado del periodo, COP entero. */
  budget: number;
  /** Ejecutado del periodo, COP entero. */
  actual: number;
  /** true ⇒ abre pantalla de detalle; false ⇒ pliega y despliega. */
  leaf: boolean;
  tone: CellTone;
  glyph: string;
  /** Avance de la barra, de 0 a 1. */
  progress: number;
  children: PeriodRow[];
}

/** Una sección por tipo, con sus totales. */
export interface PeriodSection {
  type: NodeType;
  budget: number;
  actual: number;
  groups: PeriodRow[];
}

/** La lista completa de un periodo. */
export interface PeriodView {
  period: PeriodKey;
  closed: boolean;
  sections: PeriodSection[];
}

/**
 * Razón de avance de la barra: ejecutado sobre presupuestado, con tope en 1.
 *
 * Sin presupuesto y con ejecutado la barra va llena (todo lo gastado es exceso); sin ninguno, vacía.
 * No es una cifra nueva: es la misma razón que ya decide el color de estado.
 *
 * @param budget Presupuestado.
 * @param actual Ejecutado.
 * @returns Un número entre 0 y 1; nunca NaN ni Infinity.
 * @throws Nunca.
 */
export function progressOf(budget: number, actual: number): number {
  if (actual <= 0) return 0;
  if (budget <= 0) return 1;
  return Math.min(actual / budget, 1);
}

/**
 * La lista de un periodo en el orden de la grilla.
 *
 * @param state Estado del ledger.
 * @param period Periodo a mostrar.
 * @returns Secciones en `TYPE_ORDER`, con grupos e hijos por `order` y las cifras de `rollupTable`.
 * @throws Nunca. Un ciclo de padres (datos corruptos) se corta con un conjunto de visitados.
 *
 * @aitri-trace FR-ID: FR-3103, US-ID: US-3103, AC-ID: AC-3109, TC-ID: TC-PMV-025h, TC-PMV-026f, TC-PMV-027e
 * @aitri-trace FR-ID: FR-3104, US-ID: US-3104, AC-ID: AC-3111, TC-ID: TC-PMV-033f, TC-PMV-168h
 */
export function periodView(state: LedgerState, period: PeriodKey): PeriodView {
  const table = rollupTable(state, [period]);
  const seen = new Set<string>();

  const rowOf = (node: LedgerNode, level: 0 | 1 | 2): PeriodRow => {
    seen.add(node.id);
    const { budget, actual } = table.cell(node.id, period);
    const kids = orderedChildren(state.nodes, node.id).filter((k) => !seen.has(k.id));
    return {
      id: node.id,
      name: node.name,
      icon: node.icon,
      level,
      type: node.type,
      budget,
      actual,
      leaf: isLeaf(node, state.nodes),
      tone: cellTone(node.type, budget, actual),
      glyph: cellGlyph(node.type, budget, actual),
      progress: progressOf(budget, actual),
      children: kids.map((k) => rowOf(k, Math.min(level + 1, 2) as 0 | 1 | 2)),
    };
  };

  const sections = TYPE_ORDER.map((type): PeriodSection => {
    const totals = table.type(type, period);
    const groups = orderedGroups(state.nodes, type).map((g) => rowOf(g, 0));
    if (type === "transfer") groups.push(retirosRow(state, period));
    return { type, budget: totals.budget, actual: totals.actual, groups };
  });

  return { period, closed: isClosed(closureOf(state), period), sections };
}

/**
 * La fila «Retiros del mes»: retiros reales contra planeados, graduados como un sobre-consumo.
 * Es la misma lectura que hace la celda de retiros de escritorio.
 */
function retirosRow(state: LedgerState, period: PeriodKey): PeriodRow {
  const budget = reserveRetiros(state, period, "budget");
  const actual = reserveRetiros(state, period, "actual");
  return {
    id: RETIROS_PLAN_ID,
    name: RETIROS_ROW_NAME,
    icon: null,
    level: 0,
    type: "transfer",
    budget,
    actual,
    leaf: true,
    tone: cellTone("expense", budget, actual),
    glyph: cellGlyph("expense", budget, actual),
    progress: 0,
    children: [],
  };
}
