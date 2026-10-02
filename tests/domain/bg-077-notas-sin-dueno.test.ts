/**
 * BG-077 — los comentarios de una celda siguen a su celda.
 *
 * Borrar un nodo dejaba sus comentarios en `cellNotes`, y el nodo que ganaba su primer hijo se quedaba
 * con los suyos aunque ya no tuviera celda. Ninguna pantalla los mostraba, pero seguían contando como
 * dato del periodo más antiguo, y así podían impedir mover el mes de inicio. Solo las notas de la fila
 * de retiros planeados se borraban o se trasladaban.
 */
import { describe, it, expect } from "vitest";
import {
  addCellNote, cellDetail, createNode, deleteNode, moveNode, plannedRetiroKey, repairOrphanedCellNotes,
} from "@/domain";
import { oldestPeriodWithData } from "@/domain/range";
import type { CellNote, LedgerNode, LedgerState, PeriodKey } from "@/domain/types";
import { P, M } from "../helpers/periods";

const FEB = M.feb;
const SEP = M.sep;

const NODES: LedgerNode[] = [
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Esenciales", icon: null, order: 0 },
  { id: "c-gas", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Gasolina", icon: null, order: 1 },
  { id: "c-taxi", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Taxi", icon: null, order: 2 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 3 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 4 },
];

function estado(over: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "local", nodes: NODES, budgets: {}, actuals: {}, movements: [], ...over };
}

/** El estado con un comentario escrito por la puerta real (`addCellNote`). */
function conNota(s: LedgerState, leafId: string, period: PeriodKey, text: string): LedgerState {
  const r = addCellNote(s, leafId, period, text, P);
  if (!("state" in r)) throw new Error(`la nota se rechazó: ${r.rejected}`);
  return r.state;
}

const nota = (id: string, text: string, createdAt: number): CellNote => ({ id, text, createdAt });
const textos = (s: LedgerState, key: string, period: PeriodKey) => (s.cellNotes?.[key]?.[period] ?? []).map((n) => n.text);

describe("BG-077 · borrar un nodo se lleva los comentarios de sus celdas", () => {
  it("BG-077a: tras borrar la categoría no queda ninguna nota suya, y deja de contar como dato", () => {
    const s = conNota(estado(), "c-gas", FEB, "Revisar el consumo");
    expect(oldestPeriodWithData(s)).toBe(FEB);

    const r = deleteNode(s, "c-gas", P);
    if (!("state" in r)) throw new Error(`borrado bloqueado: ${r.blocked}`);
    expect(r.state.nodes.some((n) => n.id === "c-gas")).toBe(false);
    expect(Object.keys(r.state.cellNotes ?? {})).not.toContain("c-gas");
    expect(oldestPeriodWithData(r.state)).toBeNull();
  });

  it("BG-077b: las notas de las otras categorías no se tocan", () => {
    const s = conNota(conNota(estado(), "c-gas", FEB, "De gasolina"), "c-taxi", SEP, "De taxi");
    const r = deleteNode(s, "c-gas", P);
    if (!("state" in r)) throw new Error(`borrado bloqueado: ${r.blocked}`);
    expect(textos(r.state, "c-taxi", SEP)).toEqual(["De taxi"]);
  });
});

describe("BG-077 · al dejar de ser hoja, los comentarios pasan a la hoja que recibe sus celdas", () => {
  it("BG-077c: la primera subcategoría recibe los comentarios de su categoría", () => {
    const s = conNota(estado({ actuals: { "c-gas": { [FEB]: 80_000 } } }), "c-gas", FEB, "Tanque lleno");
    const next = createNode(s, { level: "sub", parentId: "c-gas", type: "expense", name: "Moto" });
    const hijo = next.nodes.find((n) => n.parentId === "c-gas")!.id;

    expect(Object.keys(next.cellNotes ?? {})).not.toContain("c-gas");
    expect(textos(next, hijo, FEB)).toEqual(["Tanque lleno"]);
    // Y se lee donde quedó la cifra: el Detalle de la celda del hijo lista el comentario.
    expect(next.actuals[hijo]?.[FEB]).toBe(80_000);
    expect(JSON.stringify(cellDetail(next, hijo, FEB, P))).toContain("Tanque lleno");
  });

  it("BG-077d: una segunda subcategoría no se lleva nada", () => {
    const s = conNota(estado(), "c-gas", FEB, "Tanque lleno");
    const conUno = createNode(s, { level: "sub", parentId: "c-gas", type: "expense", name: "Moto" });
    const primero = conUno.nodes.find((n) => n.parentId === "c-gas")!.id;
    const conDos = createNode(conUno, { level: "sub", parentId: "c-gas", type: "expense", name: "Carro" });
    const segundo = conDos.nodes.find((n) => n.parentId === "c-gas" && n.id !== primero)!.id;

    expect(textos(conDos, primero, FEB)).toEqual(["Tanque lleno"]);
    expect(textos(conDos, segundo, FEB)).toEqual([]);
  });

  it("BG-077e: mover una categoría dentro de otra que era hoja junta los comentarios de las dos", () => {
    const s = conNota(conNota(estado(), "c-gas", FEB, "De gasolina"), "c-taxi", FEB, "De taxi");
    const r = moveNode(s, "c-taxi", { kind: "category", id: "c-gas" });
    if (!("state" in r)) throw new Error(`mover rechazado: ${r.rejected}`);

    expect(Object.keys(r.state.cellNotes ?? {})).not.toContain("c-gas");
    expect(textos(r.state, "c-taxi", FEB).sort()).toEqual(["De gasolina", "De taxi"]);
  });
});

describe("BG-077 · la reparación corrige lo que el defecto ya dejó escrito", () => {
  /** El rastro del defecto: notas de un nodo borrado, de un nodo con hijos y de sus filas de retiros. */
  function danado(): LedgerState {
    const nodes: LedgerNode[] = [
      ...NODES,
      { id: "s-moto", ownerId: "local", type: "expense", level: "sub", parentId: "c-gas", name: "Moto", icon: null, order: 5 },
      { id: "s-carro", ownerId: "local", type: "expense", level: "sub", parentId: "c-gas", name: "Carro", icon: null, order: 6 },
      { id: "s-playa", ownerId: "local", type: "transfer", level: "sub", parentId: "c-viaje", name: "Playa", icon: null, order: 7 },
    ];
    return estado({
      nodes,
      actuals: { "s-moto": { [SEP]: 50_000 } },
      cellNotes: {
        "borrado": { [FEB]: [nota("n1", "De un nodo que ya no existe", 1)] },
        "c-gas": { [FEB]: [nota("n2", "Quedó en el padre", 2)] },
        "s-moto": { [FEB]: [nota("n3", "Propia del hijo", 3)], [SEP]: [nota("n4", "Otra del hijo", 4)] },
        [plannedRetiroKey("borrado")]: { [SEP]: [nota("n5", "Retiro de un bolsillo borrado", 5)] },
        [plannedRetiroKey("c-viaje")]: { [SEP]: [nota("n6", "Para el hotel", 6)] },
        "@retiros": { [SEP]: [nota("n7", "Fila global", 7)] },
        "c-taxi": { [SEP]: [nota("n8", "Sana", 8)] },
      },
    });
  }

  it("BG-077f: descarta las notas sin nodo y pasa las de un nodo con hijos a su primera hoja", () => {
    const { state: next, repaired } = repairOrphanedCellNotes(danado());

    expect(Object.keys(next.cellNotes!).sort()).toEqual(
      ["@retiros", plannedRetiroKey("s-playa"), "c-taxi", "s-moto"].sort()
    );
    expect(textos(next, "s-moto", FEB).sort()).toEqual(["Propia del hijo", "Quedó en el padre"]);
    expect(textos(next, "s-moto", SEP)).toEqual(["Otra del hijo"]);
    expect(textos(next, plannedRetiroKey("s-playa"), SEP)).toEqual(["Para el hotel"]);
    expect(textos(next, "@retiros", SEP)).toEqual(["Fila global"]);
    expect(textos(next, "c-taxi", SEP)).toEqual(["Sana"]);
    expect(repaired.sort()).toEqual(["borrado", "c-gas", plannedRetiroKey("borrado"), plannedRetiroKey("c-viaje")].sort());
  });

  it("BG-077g: no toca ninguna cifra ni ningún movimiento", () => {
    const antes = danado();
    const { state: next } = repairOrphanedCellNotes(antes);
    expect(next.actuals).toEqual(antes.actuals);
    expect(next.budgets).toEqual(antes.budgets);
    expect(next.movements).toEqual(antes.movements);
    expect(next.nodes).toEqual(antes.nodes);
  });

  it("BG-077h: aplicarla dos veces no cambia nada más, y un estado sano vuelve intacto", () => {
    const una = repairOrphanedCellNotes(danado()).state;
    const dos = repairOrphanedCellNotes(una);
    expect(dos.repaired).toEqual([]);
    expect(dos.state).toBe(una);

    const sano = conNota(estado(), "c-taxi", SEP, "Sana");
    expect(repairOrphanedCellNotes(sano).state).toBe(sano);
    expect(repairOrphanedCellNotes(estado()).state.cellNotes).toBeUndefined();
  });
});
