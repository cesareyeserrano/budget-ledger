/**
 * BG-085 — la regla de huérfanos (FR-2206) solo cuenta lo que el cambio de inicio saca del historial.
 *
 * Con un dato anterior al inicio (FR-1906; BG-054 lo muestra como historia), `orphanedByStart` lo
 * contaba siempre, y el saldo inicial dejaba de poder editarse aunque el mes no se moviera.
 */
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { isLeaf } from "@/domain/tree";
import { newlyOrphanedByStart } from "@/domain/openingGuard";
import type { LedgerState, PeriodKey } from "@/domain/types";

/** Un ledger con un ejecutado en cada periodo de `conDatos` y el inicio declarado que se indique. */
function ledger(conDatos: PeriodKey[], startMonth: PeriodKey | null): LedgerState {
  const seed = buildSeed("u", "2026-06");
  const hoja = seed.nodes.find((n) => n.type === "expense" && isLeaf(n, seed.nodes))!.id;
  const celdas = Object.fromEntries(conDatos.map((p) => [p, 100]));
  return { ...seed, budgets: {}, actuals: { [hoja]: celdas }, movements: [], startMonth, openingBalance: startMonth ? 1_000 : null };
}

describe("newlyOrphanedByStart", () => {
  it("volver a guardar el mismo inicio no deja nada fuera, aunque haya datos anteriores", () => {
    expect(newlyOrphanedByStart(ledger(["2026-06", "2026-07"], "2026-07"), "2026-07")).toEqual([]);
  });

  it("mover el inicio adelante cuenta los meses desde el inicio vigente, no la historia anterior", () => {
    expect(newlyOrphanedByStart(ledger(["2026-06", "2026-07"], "2026-07"), "2026-08")).toEqual(["2026-07"]);
  });

  it("mover el inicio atrás dentro de la historia no deja nada fuera", () => {
    expect(newlyOrphanedByStart(ledger(["2026-05", "2026-06"], "2026-07"), "2026-06")).toEqual([]);
  });

  it("sin mes declarado, cuenta todo lo anterior al propuesto, como siempre (FR-2206)", () => {
    expect(newlyOrphanedByStart(ledger(["2026-09", "2026-10"], null), "2026-11")).toEqual(["2026-09", "2026-10"]);
  });
});
