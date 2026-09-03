/**
 * Feature transferencias · modelo v4 — FR-1012: observaciones por celda (capa de dominio).
 */
import { describe, it, expect } from "vitest";
import { addCellNote, cellObservations, CELL_NOTE_MAX } from "@/domain/reserve";
import type { AmountMap, LedgerNode, LedgerState } from "@/domain/types";
import { P } from "../helpers/periods";

function makeState(): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-ahorro", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: null, order: 0 },
    { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-ahorro", name: "Viaje", icon: null, order: 1 },
  ];
  const actuals: AmountMap = { "c-viaje": { "2026-01": 100_000 } };
  return { ownerId: "local", nodes, budgets: {}, actuals, movements: [] };
}

describe("FR-1012 · observaciones por celda", () => {
  it("TC-TRF4-012f: una observación de más de 280 caracteres se rechaza sin truncar", () => {
    // @aitri-tc TC-TRF4-012f
    const s = makeState();
    const frozen = JSON.parse(JSON.stringify(s));

    expect(addCellNote(s, "c-viaje", "2026-01", "x".repeat(CELL_NOTE_MAX + 1), P)).toEqual({ rejected: "invalid_note" });
    expect(addCellNote(s, "c-viaje", "2026-01", "   ", P)).toEqual({ rejected: "invalid_note" });
    expect(addCellNote(s, "c-no-existe", "2026-01", "hola", P)).toEqual({ rejected: "invalid_target" });
    expect(s).toEqual(frozen);

    const ok = addCellNote(s, "c-viaje", "2026-01", "y".repeat(CELL_NOTE_MAX), P);
    expect("state" in ok).toBe(true);
    if (!("state" in ok)) return;
    const obs = cellObservations(ok.state, "c-viaje", "2026-01", P);
    expect(obs).toHaveLength(1);
    expect(obs[0].text).toHaveLength(CELL_NOTE_MAX); // íntegra, sin recorte
    expect(cellObservations(ok.state, "c-viaje", "2026-02", P)).toHaveLength(0);
  });
});
