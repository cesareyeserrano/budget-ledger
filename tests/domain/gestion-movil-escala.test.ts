// Feature gestion-movil — «Mover a…» a escala. Prefijo TC-GMV-*.
//
// La lista de destinos ensaya `moveNode` una vez por candidato. Aquí se cuenta ese TRABAJO —cuántos
// ensayos— y no el tiempo de reloj: la misma suite corre bajo instrumentación de cobertura, que
// multiplica el tiempo y haría caer en falso un presupuesto en milisegundos.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LedgerNode, LedgerState, Movement } from "@/domain/types";

vi.mock("@/domain/mutations", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/domain/mutations")>();
  return { ...real, moveNode: vi.fn(real.moveNode) };
});

const GRUPOS = 104;
const POR_GRUPO = 2;
const MOVIMIENTOS = 1000;
const M = "2026-08";

/** 104 grupos de Gasto con 2 categorías cada uno (312 nodos) y 1.000 gastos repartidos. */
function estadoGrande(): LedgerState {
  const nodes: LedgerNode[] = [];
  for (let g = 0; g < GRUPOS; g++) {
    nodes.push({ id: `g${g}`, ownerId: "local", type: "expense", level: "group", parentId: null, name: `Grupo ${g}`, icon: null, order: g });
    for (let c = 0; c < POR_GRUPO; c++) {
      nodes.push({ id: `g${g}c${c}`, ownerId: "local", type: "expense", level: "category", parentId: `g${g}`, name: `Categoría ${g}.${c}`, icon: null, order: c });
    }
  }
  const movements: Movement[] = [];
  const actuals: LedgerState["actuals"] = {};
  for (let i = 0; i < MOVIMIENTOS; i++) {
    const target = `g${i % GRUPOS}c${i % POR_GRUPO}`;
    movements.push({ id: `m${i}`, ownerId: "local", type: "expense", catId: target, subId: null, target, amount: 10, period: M, createdAt: i + 1, date: `${M}-05T12:00` });
    actuals[target] = { [M]: (actuals[target]?.[M] ?? 0) + 10 };
  }
  return { ownerId: "local", nodes, budgets: {}, actuals, movements } as LedgerState;
}

describe("gestion-movil · moveDestinations a escala", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("TC-GMV-067e: a escala, un ensayo por candidato y ninguno de más", async () => {
    // @aitri-tc TC-GMV-067e
    const { moveNode } = await import("@/domain/mutations");
    const { moveDestinations } = await import("@/domain/structureView");
    const s = estadoGrande();
    expect(s.nodes).toHaveLength(GRUPOS * (1 + POR_GRUPO));
    expect(s.movements).toHaveLength(MOVIMIENTOS);

    const { toRoot, options } = moveDestinations(s, "g0c0");

    // Candidatos: la raíz, los 104 grupos y las 207 categorías ajenas.
    const candidatos = 1 + GRUPOS + (GRUPOS * POR_GRUPO - 1);
    expect(candidatos).toBe(312);
    expect(vi.mocked(moveNode)).toHaveBeenCalledTimes(candidatos);
    expect(toRoot).toMatchObject({ status: "ok", becomes: "group" });
    expect(options).toHaveLength(candidatos - 1);
    expect(options.filter((o) => o.status === "current").map((o) => o.nodeId)).toEqual(["g0"]);
    expect(options.filter((o) => o.status === "ok")).toHaveLength(candidatos - 2);
    // El ensayo no escribe: el estado de entrada sigue intacto.
    expect(s.nodes.find((n) => n.id === "g0c0")).toMatchObject({ parentId: "g0", level: "category" });
    expect(s.movements).toHaveLength(MOVIMIENTOS);
  });
});
