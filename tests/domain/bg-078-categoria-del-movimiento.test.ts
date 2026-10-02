/**
 * BG-078 (c) — el `catId`/`subId` de un movimiento cuenta la misma historia que su destino.
 *
 * `target` es el dato; el par es su etiqueta. Se desacompasaban por dos vías: editar un movimiento se
 * fiaba del par recibido —y el propio editor manda `{ catId: <hoja> }`, que con una subcategoría deja
 * `catId` = la sub y `subId` vacío—, y mover una categoría dejaba sus movimientos con el padre viejo.
 * Los totales no lo notaban porque mandan sobre `target`.
 */
import { describe, it, expect } from "vitest";
import { AVAILABLE_ID, applyReserveOp, editMovement, moveNode, movementTargetOk, repairMovementCats } from "@/domain";
import { closedPeriodsViolated } from "@/domain/closure";
import { worsenedBy } from "@/domain/guard";
import { MONTH_CALENDAR } from "@/domain/cycles";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";
import { P, M } from "../helpers/periods";

const SEP = M.sep;
const AGO = M.ago;

const n = (id: string, level: LedgerNode["level"], parentId: string | null, order: number, type: LedgerNode["type"] = "expense"): LedgerNode =>
  ({ id, ownerId: "local", type, level, parentId, name: id, icon: null, order });

const NODES: LedgerNode[] = [
  n("g-a", "group", null, 0),
  n("c-comida", "category", "g-a", 1), n("s-rest", "sub", "c-comida", 2), n("s-cafe", "sub", "c-comida", 3),
  n("c-casa", "category", "g-a", 4), n("s-luz", "sub", "c-casa", 5),
  n("c-taxi", "category", "g-a", 6),
  n("g-b", "group", null, 7),
  n("c-ocio", "category", "g-b", 8),
  n("g-ing", "group", null, 9, "income"), n("c-sueldo", "category", "g-ing", 10, "income"),
];

function mov(id: string, target: string, catId: string, subId: string | null, period: PeriodKey = SEP): Movement {
  return { id, ownerId: "local", type: "expense", catId, subId, target, amount: 10_000, period, createdAt: 1, date: `${period}-10T12:00` };
}
function estado(movements: Movement[], over: Partial<LedgerState> = {}): LedgerState {
  const actuals: LedgerState["actuals"] = {};
  for (const m of movements) (actuals[m.target] ??= {})[m.period] = (actuals[m.target]![m.period] ?? 0) + m.amount;
  return { ownerId: "local", nodes: NODES, budgets: {}, actuals, movements, ...over };
}
/** ¿El par del movimiento es el de su destino? (la misma regla que valida un registro nuevo) */
const coherente = (s: LedgerState, id: string) => {
  const m = s.movements.find((x) => x.id === id)!;
  return movementTargetOk(s.nodes, { type: m.type, catId: m.catId, subId: m.subId });
};
const par = (s: LedgerState, id: string) => {
  const m = s.movements.find((x) => x.id === id)!;
  return { catId: m.catId, subId: m.subId, target: m.target };
};

describe("BG-078 (c) · editar un movimiento escribe el par de su destino", () => {
  const base = () => estado([mov("m1", "s-rest", "c-comida", "s-rest")]);
  const editar = (patch: Parameters<typeof editMovement>[2]) => editMovement(base(), "m1", patch, MONTH_CALENDAR, P);

  it("BG-078c: `{ catId: <sub> }` —lo que manda el editor— queda como categoría + subcategoría", () => {
    const r = editar({ catId: "s-luz" });
    if (!("state" in r)) throw new Error(JSON.stringify(r));
    expect(par(r.state, "m1")).toEqual({ catId: "c-casa", subId: "s-luz", target: "s-luz" });
    expect(coherente(r.state, "m1")).toBe(true);
    expect(r.state.actuals["s-luz"]?.[SEP]).toBe(10_000);
    expect(r.state.actuals["s-rest"]?.[SEP]).toBe(0);
  });

  it("BG-078c: `{ subId }` de OTRA categoría toma a su padre de verdad, no el `catId` viejo", () => {
    const r = editar({ subId: "s-luz" });
    if (!("state" in r)) throw new Error(JSON.stringify(r));
    expect(par(r.state, "m1")).toEqual({ catId: "c-casa", subId: "s-luz", target: "s-luz" });
  });

  it("BG-078c: a una categoría sin subcategorías, el par es ella sola", () => {
    const r = editar({ catId: "c-taxi" });
    if (!("state" in r)) throw new Error(JSON.stringify(r));
    expect(par(r.state, "m1")).toEqual({ catId: "c-taxi", subId: null, target: "c-taxi" });
  });

  it("BG-078c: las dos mitades dadas y contradictorias se rechazan sin tocar nada", () => {
    expect(editar({ catId: "c-comida", subId: "s-luz" })).toEqual({ rejected: "invalid_target" });
    expect(editar({ catId: "no-existe", subId: "s-luz" })).toEqual({ rejected: "invalid_target" });
  });

  it("BG-078c: las dos mitades dadas y coherentes pasan", () => {
    const r = editar({ catId: "c-casa", subId: "s-luz" });
    if (!("state" in r)) throw new Error(JSON.stringify(r));
    expect(par(r.state, "m1")).toEqual({ catId: "c-casa", subId: "s-luz", target: "s-luz" });
  });

  it("BG-078c: un parche que no nombra el destino no toca el par (ni lo corrige ni lo rompe)", () => {
    const r = editar({ amount: 25_000 });
    if (!("state" in r)) throw new Error(JSON.stringify(r));
    expect(par(r.state, "m1")).toEqual({ catId: "c-comida", subId: "s-rest", target: "s-rest" });
  });
});

describe("BG-078 (c) · mover un nodo se lleva la etiqueta de sus movimientos", () => {
  const base = () => estado([
    mov("m-taxi", "c-taxi", "c-taxi", null),
    mov("m-rest", "s-rest", "c-comida", "s-rest"),
    mov("m-luz", "s-luz", "c-casa", "s-luz"),
    mov("m-ocio", "c-ocio", "c-ocio", null),
  ]);
  const mover = (id: string, dest: Parameters<typeof moveNode>[2]) => {
    const r = moveNode(base(), id, dest);
    if (!("state" in r)) throw new Error(`mover rechazado: ${r.rejected}`);
    return r.state;
  };
  const todosCoherentes = (s: LedgerState) => s.movements.every((m) => coherente(s, m.id));

  it("BG-078c: una categoría dentro de otra — pasa a ser su subcategoría", () => {
    const s = mover("c-taxi", { kind: "category", id: "c-casa" });
    expect(par(s, "m-taxi")).toEqual({ catId: "c-casa", subId: "c-taxi", target: "c-taxi" });
    expect(todosCoherentes(s)).toBe(true);
  });

  it("BG-078c: una subcategoría a otra categoría — cambia de padre", () => {
    const s = mover("s-rest", { kind: "category", id: "c-casa" });
    expect(par(s, "m-rest")).toEqual({ catId: "c-casa", subId: "s-rest", target: "s-rest" });
    expect(todosCoherentes(s)).toBe(true);
  });

  it("BG-078c: una subcategoría a un grupo — pasa a ser categoría", () => {
    const s = mover("s-rest", { kind: "group", id: "g-b" });
    expect(par(s, "m-rest")).toEqual({ catId: "s-rest", subId: null, target: "s-rest" });
    expect(todosCoherentes(s)).toBe(true);
  });

  it("BG-078c: una subcategoría promovida a grupo, y una categoría con subcategorías promovida a grupo", () => {
    const sub = mover("s-luz", { kind: "root", type: "expense" });
    expect(par(sub, "m-luz")).toEqual({ catId: "s-luz", subId: null, target: "s-luz" });
    const cat = mover("c-comida", { kind: "root", type: "expense" });
    expect(par(cat, "m-rest")).toEqual({ catId: "s-rest", subId: null, target: "s-rest" });
    expect(todosCoherentes(sub) && todosCoherentes(cat)).toBe(true);
  });

  it("BG-078c: un grupo degradado dentro de otro — sus categorías pasan a subcategorías", () => {
    const s = mover("g-b", { kind: "group", id: "g-a" });
    expect(par(s, "m-ocio")).toEqual({ catId: "g-b", subId: "c-ocio", target: "c-ocio" });
    expect(todosCoherentes(s)).toBe(true);
  });

  it("BG-078c: ninguna cifra cambia al mover, y un rechazo devuelve el motivo de siempre", () => {
    const antes = base();
    const s = mover("c-taxi", { kind: "category", id: "c-casa" });
    expect(s.actuals).toEqual(antes.actuals);
    expect(s.movements.map((m) => [m.id, m.target, m.amount, m.period])).toEqual(antes.movements.map((m) => [m.id, m.target, m.amount, m.period]));
    expect(moveNode(antes, "c-taxi", { kind: "category", id: "c-sueldo" })).toEqual({ rejected: "cross_type" });
  });

  it("BG-078c: mover una categoría con movimientos en un mes CERRADO no cuenta como tocar ese mes", () => {
    const cerrado: LedgerState = { ...estado([mov("m-viejo", "c-taxi", "c-taxi", null, AGO)]), closure: { closedThrough: AGO, reopened: null } };
    const r = moveNode(cerrado, "c-taxi", { kind: "category", id: "c-casa" });
    if (!("state" in r)) throw new Error(`mover rechazado: ${r.rejected}`);
    expect(par(r.state, "m-viejo")).toEqual({ catId: "c-casa", subId: "c-taxi", target: "c-taxi" });
    expect(closedPeriodsViolated(cerrado, r.state)).toEqual([]);
    // Lo que el cierre congela sigue vigilado: cambiar el monto de ese movimiento sí lo viola.
    const tocado = { ...r.state, movements: r.state.movements.map((m) => ({ ...m, amount: m.amount + 1 })) };
    expect(closedPeriodsViolated(cerrado, tocado)).toEqual([AGO]);
  });
});

describe("BG-078 (c) · la reparación corrige los pares que ya quedaron viejos", () => {
  /** Lo que el defecto dejó: la forma del editor, un padre viejo, y un destino que ya no existe. */
  const danado = () => estado([
    mov("m-editor", "s-luz", "s-luz", null),          // `{ catId: <sub> }`
    mov("m-padre-viejo", "s-rest", "c-casa", "s-rest"), // se movió y quedó con el padre anterior
    mov("m-bien", "c-taxi", "c-taxi", null),
    mov("m-huerfano", "no-existe", "no-existe", null),
  ]);

  it("BG-078c: corrige los pares incoherentes y deja lo demás como estaba", () => {
    const antes = danado();
    const { state: next, repaired } = repairMovementCats(antes);
    expect(repaired.sort()).toEqual(["m-editor", "m-padre-viejo"]);
    expect(par(next, "m-editor")).toEqual({ catId: "c-casa", subId: "s-luz", target: "s-luz" });
    expect(par(next, "m-padre-viejo")).toEqual({ catId: "c-comida", subId: "s-rest", target: "s-rest" });
    expect(par(next, "m-huerfano")).toEqual({ catId: "no-existe", subId: null, target: "no-existe" });
    expect(next.actuals).toBe(antes.actuals);
    expect(next.nodes).toBe(antes.nodes);
    expect(next.movements.map((m) => [m.id, m.amount, m.period, m.date])).toEqual(antes.movements.map((m) => [m.id, m.amount, m.period, m.date]));
  });

  it("BG-078c: es idempotente, y un estado sano vuelve intacto", () => {
    const una = repairMovementCats(danado()).state;
    const dos = repairMovementCats(una);
    expect(dos.repaired).toEqual([]);
    expect(dos.state).toBe(una);
  });
});

describe("BG-078 (c) · mover un bolsillo no cuenta como tocar reservas", () => {
  /** Ingreso de 1.000 y 800 aportados al bolsillo A; B es otro bolsillo, vacío. */
  function conBolsillos(): LedgerState {
    const nodes: LedgerNode[] = [
      n("g-ing", "group", null, 0, "income"), n("c-sueldo", "category", "g-ing", 1, "income"),
      n("g-res", "group", null, 2, "transfer"), n("b-a", "category", "g-res", 3, "transfer"), n("b-b", "category", "g-res", 4, "transfer"),
    ];
    const base: LedgerState = { ownerId: "local", nodes, budgets: {}, actuals: { "c-sueldo": { [SEP]: 1_000 } }, movements: [] };
    const r = applyReserveOp(base, { from: AVAILABLE_ID, to: "b-a", period: SEP, amount: 800, date: `${SEP}-05T12:00` }, [SEP]);
    if (!("state" in r)) throw new Error(`el aporte se rechazó: ${JSON.stringify(r)}`);
    return r.state;
  }
  const bajarIngreso = (s: LedgerState): LedgerState => ({ ...s, actuals: { ...s.actuals, "c-sueldo": { [SEP]: 500 } } });
  const mover = (s: LedgerState): LedgerState => {
    const r = moveNode(s, "b-a", { kind: "category", id: "b-b" });
    if (!("state" in r)) throw new Error(`mover rechazado: ${r.rejected}`);
    return r.state;
  };

  it("BG-078c: mover el bolsillo y bajar un ingreso en el mismo guardado se acepta, como cada cosa por separado", () => {
    const prev = conBolsillos();
    // El mover sí reetiqueta el aporte: es el caso que antes hacía saltar el guardia.
    expect(par(mover(prev), prev.movements[0]!.id)).toMatchObject({ catId: "b-b", subId: "b-a" });
    expect(worsenedBy(prev, bajarIngreso(prev), [SEP])).toEqual([]);
    expect(worsenedBy(prev, mover(prev), [SEP])).toEqual([]);
    expect(worsenedBy(prev, bajarIngreso(mover(prev)), [SEP])).toEqual([]);
  });

  it("BG-078c: lo que sí mueve plata se sigue juzgando — subir el aporte por encima del ingreso", () => {
    const prev = conBolsillos();
    const subido: LedgerState = {
      ...prev,
      actuals: { ...prev.actuals, "b-a": { [SEP]: 1_500 } },
      movements: prev.movements.map((m) => ({ ...m, amount: 1_500 })),
    };
    expect(worsenedBy(prev, subido, [SEP]).length).toBeGreaterThan(0);
  });
});

