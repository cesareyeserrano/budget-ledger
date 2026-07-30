/**
 * Feature transferencias (Reservas) — EP-06: reestructurar el árbol conserva los saldos resueltos.
 * FR-1011: la fusión de montos materializa el ARRASTRE de ambas series antes de combinar —
 * mergeMonthMap crudo (sumar celdas) es correcto para flujos y corrupto para saldos.
 */
import { describe, it, expect } from "vitest";
import { moveNode } from "@/domain/mutations";
import { resolvedTypeTotal } from "@/domain/reserve";
import { MONTH_KEYS } from "@/domain/months";
import { resolvedYearByMonth } from "../helpers/totals";
import type { AmountMap, LedgerNode, LedgerState, MonthKey } from "@/domain/types";

/** Árbol transfer con dos grupos: g-a (cat 'c-alcancia') y g-b (cat-hoja 'c-dest' con montos). */
function makeState(cells: { alcancia?: Partial<Record<MonthKey, number>>; dest?: Partial<Record<MonthKey, number>> }): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-a", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro A", icon: null, order: 0 },
    { id: "c-alcancia", ownerId: "local", type: "transfer", level: "category", parentId: "g-a", name: "Alcancía", icon: null, order: 1 },
    { id: "g-b", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro B", icon: null, order: 2 },
    { id: "c-dest", ownerId: "local", type: "transfer", level: "category", parentId: "g-b", name: "Destino", icon: null, order: 3 },
  ];
  const budgets: AmountMap = {};
  const actuals: AmountMap = {};
  if (cells.alcancia) actuals["c-alcancia"] = { ...cells.alcancia };
  if (cells.dest) actuals["c-dest"] = { ...cells.dest };
  return { ownerId: "local", nodes, budgets, actuals, movements: [] };
}

describe("FR-1011 · reestructurar conserva los saldos resueltos", () => {
  it("TC-TRF-111h: el merge de reestructuración materializa el arrastre: {ene:100} + {dic:50} → dic 150", () => {
    // @aitri-tc TC-TRF-111h
    // 'Alcancía' {ene:100.000} arrastra todo el año; se suelta DENTRO de la categoría-hoja
    // 'Destino' {dic:50.000} → FR-604 fusiona los montos de la hoja destino con los del movido.
    const s = makeState({ alcancia: { ene: 100_000 }, dest: { dic: 50_000 } });

    const res = moveNode(s, "c-alcancia", { kind: "category", id: "c-dest" });

    expect("state" in res).toBe(true);
    if (!("state" in res)) return;
    // El negativo exacto del merge corrupto: dic resuelto del conjunto = 150.000, nunca 50.000.
    expect(resolvedTypeTotal(res.state, "dic", "actual")).toBe(150_000);
    // Y la serie completa se conserva mes a mes: ene..nov = 100.000 (el arrastre de Alcancía).
    for (const m of MONTH_KEYS.slice(0, 11)) {
      expect(resolvedTypeTotal(res.state, m, "actual"), m).toBe(100_000);
    }
  });

  it("TC-TRF-111e: todo reparent/promote/demote de transfer conserva Σ resolved(m) en los 12 meses", () => {
    // @aitri-tc TC-TRF-111e
    const s0 = makeState({ alcancia: { feb: 300_000, sep: 250_000 }, dest: { may: 120_000 } });
    const before = resolvedYearByMonth(s0, "actual");

    // reparent: la alcancía entra como sub de la categoría-hoja destino (fusión FR-604)…
    const r1 = moveNode(s0, "c-alcancia", { kind: "category", id: "c-dest" });
    if (!("state" in r1)) throw new Error("reparent rechazado");
    expect(resolvedYearByMonth(r1.state, "actual")).toEqual(before);

    // …promote: la sub vuelve a ser grupo raíz del tipo…
    const r2 = moveNode(r1.state, "c-alcancia", { kind: "root", type: "transfer" });
    if (!("state" in r2)) throw new Error("promote rechazado");
    expect(resolvedYearByMonth(r2.state, "actual")).toEqual(before);

    // …demote: el grupo baja a categoría de otro grupo (fusión con el grupo-hoja g-b, ya vacío).
    const r3 = moveNode(r2.state, "c-alcancia", { kind: "group", id: "g-b" });
    if (!("state" in r3)) throw new Error("demote rechazado");
    expect(resolvedYearByMonth(r3.state, "actual")).toEqual(before);
  });

  it("TC-TRF-111f: el invariante viejo (suma de celdas crudas) NO detecta la fuga; el nuevo SÍ", () => {
    // @aitri-tc TC-TRF-111f
    const s = makeState({ alcancia: { ene: 100_000 }, dest: { dic: 50_000 } });

    // La fusión CORRUPTA que FR-1011 prohíbe: sumar celdas crudas ({ene:100.000, dic:50.000}).
    const corruptMerge: Partial<Record<MonthKey, number>> = { ene: 100_000, dic: 50_000 };
    const corrupt: LedgerState = {
      ...s,
      nodes: s.nodes.map((n) => (n.id === "c-alcancia" ? { ...n, parentId: "c-dest", level: "sub" as const } : n)),
      actuals: { "c-alcancia": corruptMerge },
    };

    // El invariante VIEJO (Σ de celdas crudas de los 12 meses) queda ciego: 150.000 antes y después.
    const rawSum = (st: LedgerState) =>
      Object.values(st.actuals).reduce((acc, cells) => acc + Object.values(cells).reduce((a, v) => a + (v ?? 0), 0), 0);
    expect(rawSum(corrupt)).toBe(rawSum(s));

    // El invariante NUEVO (serie de saldos resueltos) SÍ detecta el retiro fantasma de diciembre.
    const before = resolvedYearByMonth(s, "actual");
    const after = resolvedYearByMonth(corrupt, "actual");
    expect(after.dic).toBe(50_000); // la fuga: 100.000 desaparecieron sin operación ni journal
    expect(after).not.toEqual(before);

    // Y el camino REAL del dominio (moveNode con la fusión materializada) pasa el invariante nuevo.
    const real = moveNode(s, "c-alcancia", { kind: "category", id: "c-dest" });
    if (!("state" in real)) throw new Error("reparent rechazado");
    expect(resolvedYearByMonth(real.state, "actual")).toEqual(before);
  });
});
