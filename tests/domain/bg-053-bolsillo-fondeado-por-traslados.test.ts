/**
 * BG-053 — un bolsillo fondeado SOLO por traslados conserva su saldo al ganar su primer hijo.
 *
 * El traslado de FR-604 (las celdas y los movimientos de una hoja pasan a su primer hijo) solo corría
 * si el padre tenía un mapa de celdas. Un traslado entre bolsillos se registra en el journal y no
 * escribe celda: en la sesión el mapa existe vacío (`{}`, verdadero), pero tras recargar el servidor
 * solo reconstruye mapas para nodos con filas de celda (`rowsToState`), así que el mapa falta, la
 * regla no corre y los movimientos siguen apuntando a un nodo que ya no es hoja. El saldo quedaba
 * contado en el Balance sin pertenecer a ningún bolsillo, y sin poder retirarse.
 */
import { describe, it, expect } from "vitest";
import { AVAILABLE_ID as D, applyReserveOp, resolvedBalance } from "@/domain/reserve";
import { computeBalanceSeries } from "@/domain/balance";
import { createNode, moveNode, repairOrphanedPocketJournal } from "@/domain/mutations";
import { periodRange } from "@/domain/periods";
import type { AmountMap, LedgerNode, LedgerState, PeriodKey } from "@/domain/types";

const ENE = "2026-01" as PeriodKey;
const P = periodRange("2026-01", "2026-12");
const nodo = (id: string, type: LedgerNode["type"], level: LedgerNode["level"], parentId: string | null, order: number): LedgerNode =>
  ({ id, ownerId: "l", type, level, parentId, name: id, icon: null, order });

const NODES: LedgerNode[] = [
  nodo("g-i", "income", "group", null, 0), nodo("ing", "income", "category", "g-i", 1),
  nodo("g-t", "transfer", "group", null, 2), nodo("A", "transfer", "category", "g-t", 3),
  nodo("B", "transfer", "category", "g-t", 4), nodo("C", "transfer", "category", "g-t", 5),
  nodo("G", "transfer", "group", null, 6), // grupo-hoja: también es un bolsillo (FR-603)
];

function ok(r: object): LedgerState {
  if ("rejected" in r || "blocked" in r) throw new Error(JSON.stringify(r));
  return (r as { state: LedgerState }).state;
}

/** Ingreso 1.000.000; aporte de 500.000 a A; traslados de 200.000 de A a B y de 100.000 de A a G. */
function base(): LedgerState {
  let s = { ownerId: "l", nodes: NODES, budgets: {}, actuals: { ing: { [ENE]: 1_000_000 } }, movements: [] } as LedgerState;
  s = ok(applyReserveOp(s, { from: D, to: "A", period: ENE, amount: 500_000, date: "2026-01-10T10:00" }, P));
  s = ok(applyReserveOp(s, { from: "A", to: "B", period: ENE, amount: 200_000, date: "2026-01-11T10:00" }, P));
  s = ok(applyReserveOp(s, { from: "A", to: "G", period: ENE, amount: 100_000, date: "2026-01-12T10:00" }, P));
  return s;
}

/** La forma que devuelve el servidor al recargar: solo hay mapa para los nodos con filas de celda. */
function recargado(s: LedgerState): LedgerState {
  const sinVacios = (m: AmountMap) => Object.fromEntries(Object.entries(m).filter(([, v]) => Object.keys(v ?? {}).length > 0)) as AmountMap;
  return { ...s, budgets: sinVacios(s.budgets), actuals: sinVacios(s.actuals) };
}

const saldo = (s: LedgerState, id: string) => resolvedBalance(s, id, ENE, "actual", P);
const reservado = (s: LedgerState) => computeBalanceSeries(s, P)[ENE].actual.reservedBalance;
const sumaHojas = (s: LedgerState, ids: string[]) => ids.reduce((acc, id) => acc + saldo(s, id), 0);

describe("BG-053 · el saldo de un bolsillo fondeado por traslados sigue a su primer hijo", () => {
  for (const [nombre, preparar] of [["tras recargar", (s: LedgerState) => recargado(s)], ["en la misma sesión", (s: LedgerState) => s]] as const) {
    it(`createNode ${nombre}: el primer hijo de B hereda sus 200.000 y el total no cambia`, () => {
      const s = preparar(base());
      expect(saldo(s, "B")).toBe(200_000);
      const next = createNode(s, { level: "sub", parentId: "B", type: "transfer", name: "hijo" });
      const hijo = next.nodes.find((n) => n.parentId === "B")!.id;
      expect(saldo(next, hijo)).toBe(200_000);
      expect(next.movements.some((m) => m.to === "B" || m.from === "B" || m.target === "B")).toBe(false);
      expect(reservado(next)).toBe(reservado(s));
      expect(sumaHojas(next, ["A", hijo, "C", "G"])).toBe(reservado(next));
    });

    it(`moveNode a una categoría ${nombre}: C pasa a ser hija de B y recibe sus 200.000`, () => {
      const s = preparar(base());
      const next = ok(moveNode(s, "C", { kind: "category", id: "B" }));
      expect(saldo(next, "C")).toBe(200_000);
      expect(reservado(next)).toBe(reservado(s));
      expect(sumaHojas(next, ["A", "C", "G"])).toBe(reservado(next));
    });

    it(`moveNode a un grupo-hoja ${nombre}: C pasa a ser categoría de G y recibe sus 100.000`, () => {
      const s = preparar(base());
      const next = ok(moveNode(s, "C", { kind: "group", id: "G" }));
      expect(saldo(next, "C")).toBe(100_000);
      expect(reservado(next)).toBe(reservado(s));
      expect(sumaHojas(next, ["A", "B", "C"])).toBe(reservado(next));
    });
  }
});

describe("BG-053 · reparación de los datos que el defecto ya dejó escritos", () => {
  /** El rastro del defecto: B ganó un hijo cuando la regla no corría, y el traslado A→B sigue apuntando a B. */
  function danado(): LedgerState {
    const s = recargado(base());
    return { ...s, nodes: [...s.nodes, nodo("b1", "transfer", "sub", "B", 9)] };
  }

  it("los movimientos del padre pasan a su única hoja y el saldo vuelve a tener dueño", () => {
    const s = danado();
    expect(saldo(s, "b1")).toBe(0);
    const { state: next, repaired } = repairOrphanedPocketJournal(s);
    expect(repaired).toEqual(["B"]);
    expect(saldo(next, "b1")).toBe(200_000);
    expect(next.movements.some((m) => m.from === "B" || m.to === "B" || m.target === "B")).toBe(false);
    expect(reservado(next)).toBe(reservado(s)); // los totales no cambian
    expect(sumaHojas(next, ["A", "b1", "C", "G"])).toBe(reservado(next));
  });

  it("es idempotente: sobre datos sanos devuelve el mismo estado", () => {
    const { state: reparado } = repairOrphanedPocketJournal(danado());
    const otra = repairOrphanedPocketJournal(reparado);
    expect(otra.repaired).toEqual([]);
    expect(otra.state).toBe(reparado);
    const sano = recargado(base());
    expect(repairOrphanedPocketJournal(sano).state).toBe(sano);
  });

  it("no toca un bolsillo con celdas propias ni nodos que no son bolsillos", () => {
    const s = danado();
    const conCeldas = { ...s, actuals: { ...s.actuals, B: { [ENE]: 50_000 } } } as LedgerState;
    expect(repairOrphanedPocketJournal(conCeldas).repaired).toEqual([]);
    // Un ingreso con hijos y un movimiento que le apunta: no es el rastro del defecto.
    const ingreso = {
      ...recargado(base()),
      nodes: [...NODES, nodo("ing-sub", "income", "sub", "ing", 10)],
    } as LedgerState;
    expect(repairOrphanedPocketJournal(ingreso).repaired).toEqual([]);
  });
});

