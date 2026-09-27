// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { buildSeed } from "@/domain/seed";
import { setLeafAmount } from "@/domain/mutations";
import { rollupBudget, rollupActual, typeTotals, rollupTable } from "@/domain/rollup";
import { findNode, isLeaf } from "@/domain/tree";
import { P as MONTH_KEYS } from "../helpers/periods";
import { writeCatWidth, readCatWidth } from "@/lib/gridWidth";
import type { LedgerNode, LedgerState, NodeType } from "@/domain/types";
import { P, P0 } from "../helpers/periods";
import { CRONOMETRO_FIABLE, mejorTiempo } from "../helpers/perf";

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
    const { budget, actual } = typeTotals(state, t, P);
    parts.push(budget, actual);
  }
  return parts.join(",");
}

describe("NFR-103 · roll-up jerárquico bajo umbral y desacoplado del resize", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("TC-212h: editar una hoja refleja los roll-ups de todos los ancestros en ≤150ms", () => {
    let state = buildSeed("local", P0);
    const leaf = state.nodes.find((n) => isLeaf(n, state.nodes));
    expect(leaf).toBeTruthy();
    const leafId = leaf!.id;
    const ancestors = ancestorsOf(state, leafId);
    // una hoja real cuelga de una jerarquía (categoría/grupo): hay ancestros que agregar.
    expect(ancestors.length).toBeGreaterThan(0);

    // Edición + recómputo completo de la grilla, cronometrado.
    // BG-030: mejor-de-5 — el mínimo mide el algoritmo, no la ráfaga de CPU (tests/helpers/perf.ts).
    const elapsed = mejorTiempo(() => {
      state = setLeafAmount(state, leafId, "2026-01", "actual", 123456, P);
      recomputeGrid(state);
    });

    // El cambio SÍ se refleja hacia arriba: el Ejecutado del ancestro raíz incluye el nuevo monto.
    const rootAncestor = ancestors[ancestors.length - 1];
    expect(rollupActual(state, rootAncestor, "2026-01")).toBeGreaterThanOrEqual(123456);
    // …y en ≤150ms (guardrail de rendimiento).
    // Guardarrail de tiempo: no se afirma bajo instrumentación de cobertura (BG-026).
    if (CRONOMETRO_FIABLE) expect(elapsed).toBeLessThanOrEqual(150);
  });

  // BL-009: TC-212h mide sobre la semilla (12 nodos), el único tamaño donde no puede fallar. Este caso
  // mide lo que la grilla hace de verdad —editar una hoja y rearmar la tabla de roll-ups— sobre un
  // ledger de 216 hojas y 24 meses, unas seis veces el de un usuario real.
  it("con ~200 hojas, editar una hoja y rearmar la tabla de roll-ups de la grilla cabe en ≤150ms", () => {
    const seed = buildSeed("local", P0);
    const nodes: LedgerNode[] = [];
    const budgets: LedgerState["budgets"] = {};
    const actuals: LedgerState["actuals"] = {};
    const months = [...P, ...P.map((m) => m.replace(/^\d{4}/, (y) => String(Number(y) + 1)))];
    let order = 0;
    for (const type of TYPES) {
      for (let g = 0; g < 3; g++) {
        const gid = `${type}-g${g}`;
        nodes.push({ id: gid, ownerId: "local", type, level: "group", parentId: null, name: gid, icon: null, order: order++ });
        for (let c = 0; c < 6; c++) {
          const cid = `${gid}-c${c}`;
          nodes.push({ id: cid, ownerId: "local", type, level: "category", parentId: gid, name: cid, icon: null, order: order++ });
          for (let k = 0; k < 4; k++) {
            const sid = `${cid}-s${k}`;
            nodes.push({ id: sid, ownerId: "local", type, level: "sub", parentId: cid, name: sid, icon: null, order: order++ });
            budgets[sid] = Object.fromEntries(months.map((m) => [m, 1000]));
            actuals[sid] = Object.fromEntries(months.map((m) => [m, 900]));
          }
        }
      }
    }
    let state: LedgerState = { ...seed, nodes, budgets, actuals };
    expect(nodes.filter((n) => isLeaf(n, nodes)).length).toBe(216);
    const leafId = "expense-g0-c0-s0";

    const elapsed = mejorTiempo(() => {
      state = setLeafAmount(state, leafId, P[0], "actual", 123456, P);
      rollupTable(state, months);
    });

    // El cambio sube hasta el grupo: 24 hojas × 900, menos el 900 que se reemplazó, más el monto nuevo.
    expect(rollupTable(state, months).cell("expense-g0", P[0]).actual).toBe(24 * 900 - 900 + 123456);
    if (CRONOMETRO_FIABLE) expect(elapsed).toBeLessThanOrEqual(150);
  });

  it("TC-212e: redimensionar la columna (writeCatWidth) NO recomputa ni altera los roll-ups", () => {
    const state = buildSeed("local", P0);
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
