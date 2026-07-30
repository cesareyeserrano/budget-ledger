/**
 * Feature transferencias (Reservas) — EP-07: observaciones por celda (FR-1012), capa de dominio.
 */
import { describe, it, expect } from "vitest";
import { addCellNote, cellObservations, CELL_NOTE_MAX } from "@/domain/reserve";
import type { AmountMap, LedgerNode, LedgerState } from "@/domain/types";

function makeState(): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-ahorro", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: null, order: 0 },
    { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-ahorro", name: "Viaje", icon: null, order: 1 },
  ];
  const actuals: AmountMap = { "c-viaje": { ene: 100_000 } };
  return { ownerId: "local", nodes, budgets: {}, actuals, movements: [] };
}

describe("FR-1012 · observaciones por celda", () => {
  it("TC-TRF-112f: una observación manual de más de 280 caracteres se rechaza", () => {
    // @aitri-tc TC-TRF-112f
    const s = makeState();
    const frozen = JSON.parse(JSON.stringify(s));

    // 281 caracteres → rechazo tipado SIN truncar y sin mutar el estado.
    const tooLong = addCellNote(s, "c-viaje", "ene", "x".repeat(CELL_NOTE_MAX + 1));
    expect(tooLong).toEqual({ rejected: "invalid_note" });
    expect(s).toEqual(frozen);

    // Vacío (o solo espacios) también se rechaza.
    expect(addCellNote(s, "c-viaje", "ene", "   ")).toEqual({ rejected: "invalid_note" });
    // Y una hoja inexistente o no-transfer no acepta observaciones.
    expect(addCellNote(s, "c-no-existe", "ene", "hola")).toEqual({ rejected: "invalid_target" });

    // 280 exactos SÍ se acepta (el límite es inclusivo) y la observación queda legible.
    const ok = addCellNote(s, "c-viaje", "ene", "y".repeat(CELL_NOTE_MAX));
    expect("state" in ok).toBe(true);
    if (!("state" in ok)) return;
    const obs = cellObservations(ok.state, "c-viaje", "ene");
    expect(obs).toHaveLength(1);
    expect(obs[0].text).toHaveLength(CELL_NOTE_MAX);
    expect(obs[0].source).toBe("manual");
    // Otro mes de la misma hoja sigue sin observaciones.
    expect(cellObservations(ok.state, "c-viaje", "feb")).toHaveLength(0);
  });
});
