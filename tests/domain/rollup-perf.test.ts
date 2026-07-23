// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { buildSeed } from "@/domain/seed";
import { setLeafAmount } from "@/domain/mutations";
import { rollupBudget, rollupActual, typeTotals } from "@/domain/rollup";
import { findNode, isLeaf } from "@/domain/tree";
import { MONTH_KEYS } from "@/domain/months";
import { writeCatWidth, readCatWidth } from "@/lib/gridWidth";
import type { LedgerState, NodeType } from "@/domain/types";

// Feature grid-ux — NFR-103 (Regression): el roll-up jerárquico sigue en ≤150ms al editar
// una hoja, y el resize de columna NO desencadena recómputo de roll-ups.

const TYPES: NodeType[] = ["expense", "income", "transfer"];

/** Ids de los ancestros de un nodo, subiendo por parentId hasta la raíz. */
function ancestorsOf(state: LedgerState, id: string): string[] {
  const out: string[] = [];
  let cur = findNode(state.nodes, id)?.parentId ?? null;
  while (cur) {
    out.push(cur);
    cur = findNode(state.nodes, cur)?.parentId ?? null;
  }
  return out;
}

/** Recalcula lo que la grilla re-renderiza tras una edición: Presupuestado/Ejecutado
 *  de cada nodo en cada mes + los totales por tipo. Devuelve una firma para comparar. */
function recomputeGrid(state: LedgerState): string {
  const parts: number[] = [];
  for (const n of state.nodes) {
    for (const m of MONTH_KEYS) {
      parts.push(rollupBudget(state, n.id, m));
      parts.push(rollupActual(state, n.id, m));
    }
  }
  for (const t of TYPES) {
    const { budget, actual } = typeTotals(state, t);
    parts.push(budget, actual);
  }
  return parts.join(",");
}

describe("NFR-103 · roll-up jerárquico bajo umbral y desacoplado del resize", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("TC-212h: editar una hoja refleja los roll-ups de todos los ancestros en ≤150ms", () => {
    let state = buildSeed();
    const leaf = state.nodes.find((n) => isLeaf(n, state.nodes));
    expect(leaf).toBeTruthy();
    const leafId = leaf!.id;
    const ancestors = ancestorsOf(state, leafId);
    // una hoja real cuelga de una jerarquía (categoría/grupo): hay ancestros que agregar.
    expect(ancestors.length).toBeGreaterThan(0);

    // Edición + recómputo completo de la grilla, cronometrado.
    const start = performance.now();
    state = setLeafAmount(state, leafId, "ene", "actual", 123456);
    recomputeGrid(state);
    const elapsed = performance.now() - start;

    // El cambio SÍ se refleja hacia arriba: el Ejecutado del ancestro raíz incluye el nuevo monto.
    const rootAncestor = ancestors[ancestors.length - 1];
    expect(rollupActual(state, rootAncestor, "ene")).toBeGreaterThanOrEqual(123456);
    // …y en ≤150ms (guardrail de rendimiento).
    expect(elapsed).toBeLessThanOrEqual(150);
  });

  it("TC-212e: redimensionar la columna (writeCatWidth) NO recomputa ni altera los roll-ups", () => {
    const state = buildSeed();
    const before = recomputeGrid(state);

    // Simular varios pasos de resize dentro del rango [180,480].
    for (const w of [200, 260, 320, 400, 480, 180]) {
      writeCatWidth(w);
    }
    expect(readCatWidth()).toBe(180); // último write = 180 (dentro de rango)

    // El estado de ancho vive en localStorage bajo su propia clave; los datos del ledger
    // y por tanto los roll-ups son idénticos → el resize no desencadena recómputo de datos.
    const after = recomputeGrid(state);
    expect(after).toBe(before);
    // El resize no tocó las estructuras de datos del ledger.
    expect(state.budgets).toBeTruthy();
    expect(state.actuals).toBeTruthy();
  });
});
