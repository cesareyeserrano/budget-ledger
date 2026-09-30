/**
 * BG-084 — la nota de un movimiento va con su movimiento, también en un bolsillo.
 *
 * Reportado en producción el 2026-09-30: un retiro de 400.000 de Ahorros a Disponible con la nota
 * «Para regalos» salía en la celda Ejec. de Ahorros de ese mes —que muestra los 1.300.000 APORTADOS—
 * pintado como un comentario, como si esos 1,3 millones fueran para regalos. Decisión del usuario: las
 * notas se comportan igual en cualquier celda — la celda lista los movimientos que forman su cifra,
 * cada uno con su nota, y aparte los comentarios escritos en ella. Un retiro no forma la cifra del
 * bolsillo; su nota se lee en «Retiros del mes».
 */
import { describe, it, expect } from "vitest";
import { applyReserveCellEdit, applyReserveOp, AVAILABLE_ID, cellDetail, cellObservations } from "@/domain";
import type { LedgerState, PeriodKey } from "@/domain/types";
import { P } from "../helpers/periods";

const OCT = "2026-10" as PeriodKey;

/** Un ingreso holgado y el bolsillo Ahorros, sin movimientos. */
function base(): LedgerState {
  return {
    ownerId: "local",
    nodes: [
      { id: "g-ingreso", ownerId: "local", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
      { id: "c-ingreso", ownerId: "local", type: "income", level: "category", parentId: "g-ingreso", name: "Salario", icon: null, order: 1 },
      { id: "g-ahorro", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: null, order: 2 },
      { id: "c-ahorros", ownerId: "local", type: "transfer", level: "category", parentId: "g-ahorro", name: "Ahorros", icon: null, order: 3 },
    ],
    budgets: {},
    actuals: { "c-ingreso": { [OCT]: 20_000_000 } },
    movements: [],
  };
}

/** Ahorros con 1.300.000 aportados en octubre (nota «Prima») y un retiro de 400.000 «Para regalos». */
function escenario(): LedgerState {
  let s = base();
  const aporte = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-ahorros", period: OCT, amount: 1_300_000, date: "2026-09-21T09:00", note: "Prima" }, P);
  if (!("state" in aporte)) throw new Error("el aporte se rechazó");
  s = aporte.state;
  const retiro = applyReserveOp(s, { from: "c-ahorros", to: AVAILABLE_ID, period: OCT, amount: 400_000, date: "2026-09-24T18:00", note: "Para regalos" }, P);
  if (!("state" in retiro)) throw new Error("el retiro se rechazó");
  return retiro.state;
}

describe("BG-084 · la nota de un retiro no aparece en la celda del bolsillo", () => {
  it("BG-084a: el Detalle de la celda lista el aporte como movimiento, con su nota, y NO el retiro", () => {
    const s = escenario();
    expect(s.actuals["c-ahorros"]?.[OCT]).toBe(1_300_000); // la cifra de la celda es el aporte

    const detalle = cellDetail(s, "c-ahorros", OCT, P);
    const movimientos = detalle.filter((e) => e.kind === "movement");
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ movement: { amount: 1_300_000, note: "Prima", to: "c-ahorros" } });
    // Ninguna entrada —movimiento, comentario o automática— dice «Para regalos».
    expect(JSON.stringify(detalle)).not.toContain("Para regalos");
    expect(detalle.some((e) => e.kind === "comment")).toBe(false);
  });

  it("BG-084b: el punto y el título de la celda no toman la nota del retiro", () => {
    const s = escenario();
    const textos = cellObservations(s, "c-ahorros", OCT, P).map((o) => o.text);
    expect(textos).not.toContain("Para regalos");
    // Sin comentarios escritos en la celda, no hay nada que marcar con el punto.
    expect(cellObservations(s, "c-ahorros", OCT, P).filter((o) => o.source === "manual")).toHaveLength(0);
  });

  it("BG-084c: el retiro sigue guardado con su nota — no se perdió nada", () => {
    const s = escenario();
    const retiro = s.movements.find((m) => m.from === "c-ahorros" && m.to === AVAILABLE_ID);
    expect(retiro).toMatchObject({ amount: 400_000, note: "Para regalos", period: OCT });
  });

  it("BG-084d: la cifra de la celda y la de sus aportes cuadran — sin fila «Escrito en la celda»", () => {
    const detalle = cellDetail(escenario(), "c-ahorros", OCT, P);
    expect(detalle.some((e) => e.kind === "tecleado")).toBe(false);
  });
});

/** Suma a la vista del Detalle: aportes + lo escrito en la celda. Tiene que dar la cifra de la celda. */
function sumaDelDetalle(s: LedgerState, leaf: string): number {
  return cellDetail(s, leaf, OCT, P).reduce(
    (t, e) => t + (e.kind === "movement" ? e.movement.amount : e.kind === "tecleado" ? e.amount : 0), 0);
}

describe("BG-084 · el Detalle del bolsillo suma la cifra de su celda (revisión adversarial)", () => {
  it("BG-084e: aporte de 1.300.000 y la celda corregida a 0 en la grilla → fila de −1.300.000", () => {
    const conAporte = applyReserveOp(base(), { from: AVAILABLE_ID, to: "c-ahorros", period: OCT, amount: 1_300_000, note: "Prima" }, P);
    if (!("state" in conAporte)) throw new Error("el aporte se rechazó");
    const corregida = applyReserveCellEdit(conAporte.state, { leafId: "c-ahorros", period: OCT, plane: "actual", newAmount: 0 }, P);
    if (!("state" in corregida)) throw new Error(`la corrección se rechazó: ${JSON.stringify(corregida)}`);
    const s = corregida.state;
    expect(s.actuals["c-ahorros"]?.[OCT] ?? 0).toBe(0);

    const detalle = cellDetail(s, "c-ahorros", OCT, P);
    expect(detalle.find((e) => e.kind === "tecleado")).toEqual({ kind: "tecleado", amount: -1_300_000 });
    expect(sumaDelDetalle(s, "c-ahorros")).toBe(0);
  });

  it("BG-084f: 5.000.000 escritos en la celda y luego un aporte de 700.000 → fila de 5.000.000", () => {
    const tecleada = applyReserveCellEdit(base(), { leafId: "c-ahorros", period: OCT, plane: "actual", newAmount: 5_000_000 }, P);
    if (!("state" in tecleada)) throw new Error("la celda se rechazó");
    const conAporte = applyReserveOp(tecleada.state, { from: AVAILABLE_ID, to: "c-ahorros", period: OCT, amount: 700_000, note: "Extra" }, P);
    if (!("state" in conAporte)) throw new Error("el aporte se rechazó");
    const s = conAporte.state;
    expect(s.actuals["c-ahorros"]?.[OCT]).toBe(5_700_000);

    const detalle = cellDetail(s, "c-ahorros", OCT, P);
    expect(detalle.filter((e) => e.kind === "movement")).toHaveLength(1);
    expect(detalle.find((e) => e.kind === "tecleado")).toEqual({ kind: "tecleado", amount: 5_000_000 });
    expect(sumaDelDetalle(s, "c-ahorros")).toBe(5_700_000);
  });
});
