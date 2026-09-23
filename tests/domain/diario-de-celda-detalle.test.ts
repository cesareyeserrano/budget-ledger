/**
 * Feature diario-de-celda — EP-01: el Detalle de una celda (capa de dominio).
 *
 * Aquí se afirma QUÉ forma una celda y en qué orden se lee; que la pantalla lo pinte se verifica en
 * tests/e2e/diario-de-celda.spec.ts. Son fallos distintos: el selector puede acertar y el render no.
 */
import { describe, it, expect } from "vitest";
import { addCellNote, cellDetail, displayAmount, firstDayOf, CELL_NOTE_MAX } from "@/domain";
import type { CellNote, LedgerNode, LedgerState, Movement } from "@/domain/types";
import { dayLabel } from "@/components/CellDetail";
import { P, M } from "../helpers/periods";

const NODES: LedgerNode[] = [
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 0 },
  { id: "c-rest", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Restaurantes", icon: null, order: 0 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 1 },
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 2 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 3 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 0 },
];

/** Un gasto manual de la hoja, con fecha y orden de creación explícitos. */
function gasto(
  id: string, target: string, amount: number, period: string, date: string | undefined, createdAt: number, note?: string
): Movement {
  return {
    id, ownerId: "local", type: "expense", catId: target, subId: null, target, amount,
    period: period as Movement["period"], createdAt, ...(date ? { date } : {}), ...(note ? { note } : {}),
  };
}

function estado(over: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "local", nodes: NODES, budgets: {}, actuals: {}, movements: [], ...over };
}

/** Los tres movimientos del escenario del spec: 50.000 el 18, 30.000 el 19 y 20.000 el 20 de sep. */
const SEP = M.sep;
const TRES = [
  gasto("m-1", "c-rest", 50_000, SEP, "2026-09-18T12:00", 1, "Almuerzo"),
  gasto("m-2", "c-rest", 30_000, SEP, "2026-09-19T12:00", 2),
  gasto("m-3", "c-rest", 20_000, SEP, "2026-09-20T12:00", 3, "Taxi"),
];

describe("FR-2501 · el Detalle lista lo que forma la celda", () => {
  it("TC-DDC-002h: cellDetail ordena por fecha y, a igual fecha, por orden de creación", () => {
    // @aitri-tc TC-DDC-002h
    // El cuarto movimiento comparte fecha con el de 30.000 y se creó después: el desempate por
    // createdAt es lo que hace que la lista sea ESTABLE, y no dependa del orden del array.
    const cuarto = gasto("m-4", "c-rest", 5_000, SEP, "2026-09-19T12:00", 9);
    const state = estado({
      actuals: { "c-rest": { [SEP]: 105_000 } },
      movements: [cuarto, ...TRES], // a propósito, desordenados respecto del resultado esperado
    });

    const entries = cellDetail(state, "c-rest", SEP, P);

    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.kind === "movement")).toBe(true);
    const montos = entries.map((e) => (e.kind === "movement" ? e.movement.amount : null));
    expect(montos).toEqual([50_000, 30_000, 5_000, 20_000]);
  });

  it("TC-DDC-004f: excluye otro periodo, otra hoja y los movimientos de reserva", () => {
    // @aitri-tc TC-DDC-004f
    const otroPeriodo = gasto("m-oct", "c-rest", 40_000, M.oct, "2026-10-02T12:00", 4, "Cena octubre");
    const otraHoja = gasto("m-mer", "c-mercado", 15_000, SEP, "2026-09-10T12:00", 5);
    const reserva: Movement = {
      id: "m-res", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje",
      amount: 9_000, period: SEP as Movement["period"], createdAt: 6, date: "2026-09-05T12:00",
      from: "c-viaje", to: "@disponible", note: "pasaje",
    };
    const state = estado({
      actuals: { "c-rest": { [SEP]: 100_000, [M.oct]: 40_000 }, "c-mercado": { [SEP]: 15_000 } },
      movements: [...TRES, otroPeriodo, otraHoja, reserva],
    });

    const entries = cellDetail(state, "c-rest", SEP, P);

    expect(entries).toHaveLength(3);
    const ids = entries.map((e) => (e.kind === "movement" ? e.movement.id : null));
    expect(ids).toEqual(["m-1", "m-2", "m-3"]);
    // Ni el de octubre, ni el de otra hoja, ni el de reserva: los tres se quedan fuera.
    expect(ids).not.toContain("m-oct");
    expect(ids).not.toContain("m-mer");
    expect(ids).not.toContain("m-res");
  });

  it("TC-DDC-008e: displayAmount aplica el signo del APORTE a la celda, no el del tipo", () => {
    // @aitri-tc TC-DDC-008e
    // Lo que SUMA va sin signo; solo lo que RESTA lleva «−». Ningún monto lleva «+».
    expect(displayAmount(50_000)).toEqual({ sign: "", abs: 50_000, addsToCell: true });
    expect(displayAmount(-10_000)).toEqual({ sign: "−", abs: 10_000, addsToCell: false });
    expect(displayAmount(20_000)).toEqual({ sign: "", abs: 20_000, addsToCell: true });
    expect(displayAmount(-40_000)).toEqual({ sign: "−", abs: 40_000, addsToCell: false });

    // LA GUARDA QUE IMPIDE QUE VUELVA LA REGLA RETIRADA. Antes la firma era (type, amount) y el
    // signo salía de «signo del tipo × signo del monto», así que el mismo importe se pintaba al
    // revés según la celda en la que estuviera. Ahora la función NO recibe el tipo: la regla vieja
    // ya no es expresable. Esto lo comprueba de frente — un solo argumento, y aridad 1.
    expect(displayAmount.length).toBe(1);
    // Y ningún resultado puede llevar «+», que era el signo con el que un ajuste que baja la celda
    // se disfrazaba de ingreso.
    for (const v of [1, -1, 50_000, -50_000, 999_999]) {
      expect(displayAmount(v).sign).not.toBe("+");
    }
  });

  it("TC-DDC-010e: un movimiento sin fecha se lista y se muestra con el primer día del periodo", () => {
    // @aitri-tc TC-DDC-010e
    // Los movimientos anteriores a stack-upgrade-theme no tienen `date`. No se inventa una fecha:
    // se usa la única que el dato garantiza — que cayó en ese periodo.
    const sinFecha = gasto("m-viejo", "c-rest", 12_000, SEP, undefined, 1000);
    const conFecha = gasto("m-nuevo", "c-rest", 8_000, SEP, "2026-09-05T12:00", 500);
    const state = estado({ actuals: { "c-rest": { [SEP]: 20_000 } }, movements: [sinFecha, conFecha] });

    const entries = cellDetail(state, "c-rest", SEP, P);

    expect(entries).toHaveLength(2);
    expect(firstDayOf(SEP)).toBe("2026-09-01T00:00");
    expect(dayLabel(firstDayOf(SEP))).toBe("1 sep");
    // El que no tiene fecha se ordena como el día 1, antes del día 5.
    const ids = entries.map((e) => (e.kind === "movement" ? e.movement.id : null));
    expect(ids).toEqual(["m-viejo", "m-nuevo"]);
  });
});

describe("FR-2508 · comentarios en el Detalle", () => {
  it("TC-DDC-156f: addCellNote rechaza 281 caracteres y vacío sin tocar los existentes", () => {
    // @aitri-tc TC-DDC-156f
    const previa: CellNote = { id: "n-1", createdAt: 1, text: "A" };
    const state = estado({ actuals: { "c-rest": { [SEP]: 0 } }, cellNotes: { "c-rest": { [SEP]: [previa] } } });
    const frozen = JSON.parse(JSON.stringify(state));

    expect(addCellNote(state, "c-rest", SEP, "x".repeat(CELL_NOTE_MAX + 1), P)).toEqual({ rejected: "invalid_note" });
    expect(addCellNote(state, "c-rest", SEP, "", P)).toEqual({ rejected: "invalid_note" });
    expect(state).toEqual(frozen); // ni una mutación

    const entries = cellDetail(state, "c-rest", SEP, P);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ kind: "comment", note: previa });
  });

  it("TC-DDC-159e: el orden es automático → movimientos → comentarios por creación", () => {
    // @aitri-tc TC-DDC-159e
    const comentarios: CellNote[] = [
      { id: "n-2", createdAt: 2, text: "Compartido con Ana" },
      { id: "n-1", createdAt: 1, text: "Pedir factura" },
    ];
    const gastoState = estado({
      actuals: { "c-rest": { [SEP]: 38_000 } },
      movements: [
        gasto("m-b", "c-rest", 30_000, SEP, "2026-09-19T12:00", 2),
        gasto("m-a", "c-rest", 8_000, SEP, "2026-09-05T12:00", 1),
      ],
      cellNotes: { "c-rest": { [SEP]: comentarios } },
    });

    const gastoEntries = cellDetail(gastoState, "c-rest", SEP, P);
    expect(gastoEntries.map((e) => e.kind)).toEqual(["movement", "movement", "comment", "comment"]);
    expect(gastoEntries.map((e) => (e.kind === "movement" ? e.movement.id : e.kind === "comment" ? e.note.id : null)))
      .toEqual(["m-a", "m-b", "n-1", "n-2"]);

    // Un bolsillo no tiene movimientos propios en el Detalle: su operación De→A se lee como nota, y
    // el aviso automático del arrastre va SIEMPRE primero.
    const bolsillo = estado({
      actuals: { "c-salario": { [M.ene]: 2_000_000 }, "c-viaje": { [M.feb]: 1_000_000 } },
      movements: [{
        id: "m-dea", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje",
        amount: 300_000, period: M.feb as Movement["period"], createdAt: 7, note: "pasaje",
        from: "@disponible", to: "c-viaje",
      }],
    });

    const bolsilloEntries = cellDetail(bolsillo, "c-viaje", M.feb, P);
    expect(bolsilloEntries.map((e) => e.kind)).toEqual(["auto", "reserveNote"]);
    expect(bolsilloEntries[1]).toMatchObject({ kind: "reserveNote", text: "pasaje" });
  });
});

// ══ FR-2501 corregido (2026-09-18) — el signo es el del APORTE, no el del tipo ══════════════════

describe("FR-2501 · ningún signo contradice el efecto sobre la celda", () => {
  it("TC-DDC-013f: cero contradicciones entre el signo pintado y lo que el movimiento hace", () => {
    // @aitri-tc TC-DDC-013f
    // La guarda de la regla RETIRADA. Antes, dentro de un gasto, todo lo que SUBÍA la celda se
    // pintaba «−» y lo que la BAJABA se pintaba «+»: el signo era siempre el contrario del efecto.
    // Este caso lo prohíbe de frente, y en las dos direcciones, para que no vuelva por descuido.
    const montos = [1, 800, 40_000, 50_000, 150_000, 999_999, -1, -10_000, -40_000, -999_999];
    for (const amount of montos) {
      const { sign, abs, addsToCell } = displayAmount(amount);
      expect(abs, `abs de ${amount}`).toBe(Math.abs(amount));
      // Nunca «+»: era el signo con el que un ajuste que resta se disfrazaba de ingreso.
      expect(sign, `signo de ${amount}`).not.toBe("+");
      // Y el signo dice exactamente lo que el movimiento hace con la celda.
      expect(addsToCell, `aporte de ${amount}`).toBe(amount > 0);
      expect(sign, `coherencia de ${amount}`).toBe(amount > 0 ? "" : "−");
    }
  });

  it("TC-DDC-012e: el caso real del usuario — cuatro montos que suman a la vista el total", () => {
    // @aitri-tc TC-DDC-012e
    // Agua, octubre: el escenario EXACTO en el que el usuario detectó el fallo. Antes se leía
    // «−150.000 −40.000 −50.000 −10.000» bajo una celda que decía 250.000 en positivo.
    const pintados = [150_000, 40_000, 50_000, 10_000].map((a) => {
      const { sign, abs } = displayAmount(a);
      return { texto: `${sign}${abs}`, valor: a };
    });
    expect(pintados.map((p) => p.texto)).toEqual(["150000", "40000", "50000", "10000"]);
    // Lo que el panel promete: las cifras TAL COMO SE LEEN suman el valor de la celda.
    const comoSeLeen = pintados.reduce((t, p) => t + Number(p.texto), 0);
    expect(comoSeLeen).toBe(250_000);
  });

  it("TC-DDC-012e (bis): con un ajuste que resta, las cifras leídas siguen sumando la celda", () => {
    // @aitri-tc TC-DDC-012e
    // La otra mitad: si algo resta, su «−» hace que la suma a la vista SIGA dando el total. Es la
    // razón por la que el signo no se quita del todo.
    const leidos = [100_000, -10_000].map((a) => {
      const { sign, abs } = displayAmount(a);
      return Number(`${sign === "−" ? "-" : ""}${abs}`);
    });
    expect(leidos).toEqual([100_000, -10_000]);
    expect(leidos.reduce((t, n) => t + n, 0)).toBe(90_000);
  });
});
