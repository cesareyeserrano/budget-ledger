// Feature presupuesto-movil — el ensayo de una edición (movementEditVerdict). Prefijo TC-PMV-*.
//
// La función se extrajo del editor de escritorio para que el teléfono decida con la misma regla.
// Estas pruebas la fijan por su resultado: qué se guardaría, qué lo impide y a qué periodo pasaría.
import { describe, it, expect } from "vitest";
import { MONTH_CALENDAR } from "@/domain/cycles";
import { movementEditVerdict, type MovementDraft } from "@/domain/movementEditVerdict";
import { buildSeed } from "@/domain/seed";
import type { LedgerState, Movement } from "@/domain/types";
import { MONTO_ENTERO_MSG } from "@/lib/money";
import { M as MES, P, P0 } from "../helpers/periods";
import { PMV, PMV_MOV, pmvBase } from "../fixtures/pmv-base";

const M = MES.mar;
const PREV = MES.feb;
const NEXT = MES.abr;

const base = (): LedgerState => ({
  ...buildSeed("local", P0), ...pmvBase(M, PREV), closure: { closedThrough: PREV, reopened: null },
});
const mov = (s: LedgerState, id: string): Movement => s.movements.find((m) => m.id === id)!;
const draftOf = (m: Movement, over: Partial<MovementDraft> = {}): MovementDraft => ({
  amount: String(m.amount), note: m.note ?? "", date: m.date!, target: m.target, ...over,
});
const verdict = (s: LedgerState, id: string, over: Partial<MovementDraft> = {}) =>
  movementEditVerdict(s, mov(s, id), draftOf(mov(s, id), over), MONTH_CALENDAR, P);

describe("presupuesto-movil · ensayo de la edición de un movimiento", () => {
  it("TC-PMV-065h: una edición aceptada trae el cambio a guardar, y cambiar de mes dice a cuál pasa", () => {
    // @aitri-tc TC-PMV-065h
    const s = base();
    const v = verdict(s, PMV_MOV.super, { amount: "250" });
    expect(v.kind).toBe("edit");
    expect(v.canSave).toBe(true);
    expect(v.patch.amount).toBe(250);
    expect(v.movesTo).toBeNull();
    expect(v.dry && "state" in v.dry && v.dry.state.actuals[PMV.mercado]?.[M]).toBe(650);
    // El estado de partida no se toca: el ensayo corre sobre una copia.
    expect(s.actuals[PMV.mercado]?.[M]).toBe(600);

    const mover = verdict(s, PMV_MOV.super, { date: `${NEXT}-03T12:00` });
    expect(mover.kind).toBe("edit");
    expect(mover.canSave).toBe(true);
    expect(mover.movesTo).toBe(NEXT);
    expect(mover.targetPeriod).toBe(NEXT);
    expect(mover.dry && "state" in mover.dry && mover.dry.state.actuals[PMV.mercado]?.[M]).toBe(400);
    expect(mover.dry && "state" in mover.dry && mover.dry.state.actuals[PMV.mercado]?.[NEXT]).toBe(200);

    // Poner el monto en cero es el ensayo del BORRADO, el mismo de la papelera.
    const borrar = verdict(s, PMV_MOV.sinNota, { amount: "0" });
    expect(borrar.kind).toBe("delete");
    expect(borrar.canSave).toBe(true);
    expect(borrar.dry && "state" in borrar.dry && borrar.dry.state.movements.some((m) => m.id === PMV_MOV.sinNota)).toBe(false);
  });

  it("TC-PMV-066f: lo que no se puede guardar dice por qué: monto, nota, mes cerrado u otra categoría", () => {
    // @aitri-tc TC-PMV-066f
    const s = base();

    const monto = verdict(s, PMV_MOV.super, { amount: "abc" });
    expect(monto).toMatchObject({ kind: "invalid", reason: "amount", canSave: false, amountError: MONTO_ENTERO_MSG, dry: null });
    expect(verdict(s, PMV_MOV.super, { amount: "" })).toMatchObject({ kind: "invalid", reason: "amount", canSave: false });
    expect(verdict(s, PMV_MOV.super, { amount: "12,5" })).toMatchObject({ kind: "invalid", reason: "amount", canSave: false });
    // Un movimiento manual no admite signo: el «−» solo vale en un ajuste.
    expect(verdict(s, PMV_MOV.super, { amount: "-40" })).toMatchObject({ kind: "invalid", reason: "amount", canSave: false });

    const nota = verdict(s, PMV_MOV.super, { note: "x".repeat(281) });
    expect(nota).toMatchObject({ kind: "invalid", reason: "note", canSave: false, noteTooLong: true });
    expect(verdict(s, PMV_MOV.super, { note: "x".repeat(280) })).toMatchObject({ kind: "edit", canSave: true });

    const cerrado = verdict(s, PMV_MOV.super, { date: `${PREV}-10T12:00` });
    expect(cerrado).toMatchObject({ kind: "invalid", reason: "closed_target", canSave: false, targetClosed: true, targetPeriod: PREV });

    const otroTipo = verdict(s, PMV_MOV.super, { target: PMV.salario });
    expect(otroTipo.kind).toBe("edit");
    expect(otroTipo.canSave).toBe(false);
    expect(otroTipo.otherReject).toBe("invalid_target");

    // Borrar un gasto cuya celda tiene además un ajuste negativo la dejaría bajo cero.
    const conAjuste = base();
    conAjuste.movements = conAjuste.movements.filter((m) => m.id !== "mv-servicios");
    conAjuste.movements.push(
      { id: "mv-590", ownerId: "local", type: "expense", catId: PMV.servicios, subId: null, target: PMV.servicios, amount: 590, period: M, createdAt: 50, date: `${M}-08T12:00` },
      { id: "mv-aj", ownerId: "local", type: "expense", catId: PMV.servicios, subId: null, target: PMV.servicios, amount: -40, period: M, createdAt: 51, date: `${M}-09T12:00`, kind: "adjustment" },
    );
    const negativa = verdict(conAjuste, "mv-590", { amount: "0" });
    expect(negativa.kind).toBe("delete");
    expect(negativa.canSave).toBe(false);
    expect(negativa.negative).toMatchObject({ nodeId: PMV.servicios, period: M, value: -40 });
    // Y el ajuste sí admite el signo.
    expect(verdict(conAjuste, "mv-aj", { amount: "-60" })).toMatchObject({ kind: "edit", canSave: true, amount: -60 });
    expect(verdict(conAjuste, "mv-aj", { amount: "6-0" })).toMatchObject({ kind: "invalid", reason: "amount" });
  });
});
