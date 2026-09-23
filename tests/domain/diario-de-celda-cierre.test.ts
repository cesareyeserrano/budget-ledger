/**
 * Feature diario-de-celda — EP-04: el CIERRE congela las vías nuevas (dominio puro).
 * TCs: FR-2507 (137f, 138e) · FR-2508 (157f).
 *
 * Lo que la pantalla hace con esto vive en tests/e2e y lo que el servidor exige, en
 * tests/integration. Aquí se prueba la REGLA: qué cuenta como tocar un mes cerrado.
 */
import { describe, it, expect } from "vitest";
import { cellMismatches } from "@/domain";
import { addCellNote } from "@/domain/reserve";
import { closedPeriodsViolated, isClosed } from "@/domain/closure";
import type { Closure, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";
import { P, M } from "../helpers/periods";

const AGO = M.ago;
const SEP = M.sep;

const NODES: LedgerNode[] = [
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 0 },
  { id: "c-rest", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Restaurantes", icon: null, order: 0 },
];

/** El movimiento K del escenario: 7.000, nota «Pan», fechado el 10 de agosto. */
function K(over: Partial<Movement> = {}): Movement {
  return {
    id: "k", ownerId: "local", type: "expense", catId: "c-rest", subId: null, target: "c-rest",
    amount: 7_000, period: AGO, createdAt: 1, date: "2026-08-10T12:00", note: "Pan", ...over,
  };
}

const CERRADO: Closure = { closedThrough: AGO, reopened: null };

function estado(movements: Movement[], closure: Closure = CERRADO): LedgerState {
  return {
    ownerId: "local", nodes: NODES, budgets: {},
    actuals: { "c-rest": { [AGO]: 7_000 } }, movements, closure,
  };
}

describe("FR-2507 · qué cuenta como tocar un mes cerrado", () => {
  it("TC-DDC-137f: el guardia detecta cambios de nota, fecha y kind en periodos cerrados", () => {
    // @aitri-tc TC-DDC-137f
    // ESTE CASO DESTAPÓ UN AGUJERO REAL (2026-09-17): `diffMovements` comparaba monto, destino,
    // categoría y tipo, pero NO estos tres. Con editar y borrar ya en el producto, un mes cerrado
    // quedaba congelado en sus CIFRAS pero no en su contenido: se le podía cambiar la nota o la
    // fecha a un movimiento suyo. El documento de diseño daba la regla por cumplida.
    const prev = estado([K()]);

    // Solo la NOTA…
    expect(closedPeriodsViolated(prev, estado([K({ note: "Pan de ayer" })]))).toEqual([AGO]);
    // …solo la FECHA, dentro del mismo mes cerrado…
    expect(closedPeriodsViolated(prev, estado([K({ date: "2026-08-11T12:00" })]))).toEqual([AGO]);
    // …y solo el KIND: convertir un movimiento manual en ajuste cambia lo que la celda significa.
    expect(closedPeriodsViolated(prev, estado([K({ kind: "adjustment" })]))).toEqual([AGO]);

    // Y sin cambios, NADA: el guardia no puede marcar por releer el mismo estado.
    expect(closedPeriodsViolated(prev, estado([K()]))).toEqual([]);
  });

  it("no marca por la diferencia entre ausente y null en los campos opcionales", () => {
    // Un movimiento viejo trae `note` ausente; al releerlo puede llegar como `null`. Son el MISMO
    // dato, y tratarlos como distintos marcaría una violación sin que nadie hubiera tocado nada —
    // el usuario vería «ese mes está cerrado» al guardar algo de otro mes.
    const sinNota = K({ note: undefined, date: undefined, kind: undefined });
    const conNull = K({ note: null, date: undefined, kind: undefined });
    expect(closedPeriodsViolated(estado([sinNota]), estado([conNull]))).toEqual([]);
    // Y un `kind` ausente es «manual» explícito: tampoco es un cambio.
    expect(closedPeriodsViolated(estado([sinNota]), estado([K({ note: undefined, date: undefined })]))).toEqual([]);
  });

  it("TC-DDC-138e: el último reabierto no cuenta como cerrado", () => {
    // @aitri-tc TC-DDC-138e
    // La reapertura existe para poder corregir. Si el mes reabierto siguiera contando como cerrado,
    // la única salida del usuario no serviría de nada (FR-2005).
    const reabierto: Closure = { closedThrough: M.jul, reopened: AGO };
    expect(isClosed(reabierto, AGO)).toBe(false); // el reabierto SÍ se puede tocar
    expect(isClosed(reabierto, M.jul)).toBe(true); // el anterior sigue congelado

    // Y el guardia lo respeta: editar el reabierto no produce violación…
    const prev = estado([K()], reabierto);
    expect(closedPeriodsViolated(prev, estado([K({ note: "corregido" })], reabierto))).toEqual([]);

    // …mientras que con ese mismo mes CERRADO, el cambio se marca y el estado previo queda intacto.
    const cerrado = estado([K()]);
    const antes = structuredClone(cerrado);
    expect(closedPeriodsViolated(cerrado, estado([K({ note: "corregido" })]))).toEqual([AGO]);
    expect(cerrado).toEqual(antes);
  });
});

describe("FR-2508 · un comentario no es una cifra", () => {
  it("TC-DDC-157f: un comentario nunca suma a la celda ni al cuadre", () => {
    // @aitri-tc TC-DDC-157f
    // Es la línea que separa las dos cosas que el usuario escribe en una celda: un MOVIMIENTO lleva
    // monto y cuadra; un COMENTARIO es texto y no toca ninguna cuenta. Confundirlos convertiría cada
    // anotación en un descuadre.
    const s: LedgerState = {
      ownerId: "local", nodes: NODES, budgets: {},
      actuals: { "c-rest": { [SEP]: 20_000 } },
      movements: [K({ id: "m1", period: SEP, date: "2026-09-10T12:00", amount: 20_000, note: "Mercado" })],
    };
    expect(cellMismatches(s, P)).toEqual([]); // cuadrada de partida

    const r = addCellNote(s, "c-rest", SEP, "Pedir factura", P);
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;

    // La celda no se movió…
    expect(r.state.actuals["c-rest"]?.[SEP]).toBe(20_000);
    // …y sigue cuadrando: el comentario no entró en la suma.
    expect(cellMismatches(r.state, P)).toEqual([]);
    // El comentario sí está, para que no pase por un no-op.
    expect(r.state.cellNotes?.["c-rest"]?.[SEP]).toHaveLength(1);
  });
});
