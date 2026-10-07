// Feature gestion-movil — los defectos que destapó la revisión adversarial del 7-oct-2026, en el dominio.
//
// BG-002: mover, crear y borrar se anunciaban como hechos y el servidor los deshacía cuando el traslado
// de montos tocaba un periodo cerrado. Las tres funciones de lectura ensayan ahora el mismo guardia
// que corre el servidor (`closedPeriodsViolated`), así que el teléfono lo dice antes de actuar.
import { describe, it, expect } from "vitest";
import { closedPeriodsViolated } from "@/domain/closure";
import { createNode, deleteBlockReason, deleteNode, moveNode } from "@/domain/mutations";
import { periodRange } from "@/domain/periods";
import { AVAILABLE_ID, applyReserveOp } from "@/domain/reserve";
import { createTouchesClosed, deleteTouchesClosed, moveDestinations } from "@/domain/structureView";
import type { LedgerState, PeriodKey } from "@/domain/types";
import { GMV, gmvBase } from "../fixtures/gmv-base";

const M: PeriodKey = "2026-08";
const PREV: PeriodKey = "2026-07";
const P = periodRange(PREV, "2026-12");
const abierto = (): LedgerState => ({ ownerId: "local", ...gmvBase(M, PREV) }) as LedgerState;
/** El mismo libro con julio cerrado. Mercado tiene 900/850 en julio. */
const conPrevCerrado = (): LedgerState => ({ ...abierto(), closure: { closedThrough: PREV, reopened: null } }) as LedgerState;
const opcion = (s: LedgerState, id: string, destino: string) => moveDestinations(s, id).options.find((o) => o.nodeId === destino)!;

describe("gestion-movil BG-002 · operaciones de estructura que tocarían un mes cerrado", () => {
  it("BG-002: «Mover a…» no ofrece como válido un destino cuyo traslado tocaría un mes cerrado", () => {
    const s = conPrevCerrado();
    // Mercado es hoja con cifras en julio (cerrado): quien entre como su primer hijo se las lleva.
    const aMercado = opcion(s, GMV.cine, GMV.mercado);
    expect(aMercado).toMatchObject({ status: "closed", becomes: "sub", carries: true });
    // El escenario es real: el dominio lo acepta y el guardia del servidor lo rechazaría.
    const ensayo = moveNode(s, GMV.cine, { kind: "category", id: GMV.mercado });
    expect("state" in ensayo && closedPeriodsViolated(s, ensayo.state)).toEqual([PREV]);

    // Un destino que no cede cifras de julio sigue siendo válido.
    expect(opcion(s, GMV.cine, GMV.comida)).toMatchObject({ status: "ok", carries: false });
    expect(opcion(s, GMV.restaurantes, GMV.ocio)).toMatchObject({ status: "ok" });
    // Restaurantes es hoja con cifras SOLO en agosto (abierto): cede montos, pero no toca julio.
    expect(opcion(s, GMV.cine, GMV.restaurantes)).toMatchObject({ status: "ok", carries: true });

    // Con julio abierto, el mismo destino vuelve a ser válido: el bloqueo es por el cierre.
    expect(opcion(abierto(), GMV.cine, GMV.mercado)).toMatchObject({ status: "ok", carries: true });
  });

  it("BG-002: crear el primer hijo de una hoja con cifras en un mes cerrado se detecta antes de crear", () => {
    const s = conPrevCerrado();
    expect(createTouchesClosed(s, GMV.mercado)).toBe(true);
    const ensayo = createNode(s, { level: "sub", parentId: GMV.mercado, type: "expense", name: "Frutas" });
    expect(closedPeriodsViolated(s, ensayo)).toEqual([PREV]);

    // Restaurantes solo tiene cifras en agosto; Ocio ya tiene hijos; Cine está vacía.
    expect(createTouchesClosed(s, GMV.restaurantes)).toBe(false);
    expect(createTouchesClosed(s, GMV.ocio)).toBe(false);
    expect(createTouchesClosed(s, GMV.cine)).toBe(false);
    // Sin nada cerrado, nunca.
    expect(createTouchesClosed(abierto(), GMV.mercado)).toBe(false);
    // Un padre que no existe o que no admite hijos no es un «toca cerrado»: es otro rechazo.
    expect(createTouchesClosed(s, "no-existe")).toBe(false);
    expect(createTouchesClosed(s, GMV.nacional)).toBe(false);
  });

  it("BG-002: borrar una alcancía en cero con historia en un mes cerrado se detecta antes de borrar", () => {
    // Una alcancía de paso en julio: recibe 300 de Viaje y los retira. Saldo 0, sin celdas.
    let s = abierto();
    s = { ...s, budgets: { ...s.budgets, [GMV.viaje]: { ...s.budgets[GMV.viaje], [PREV]: 300 } }, actuals: { ...s.actuals, [GMV.viaje]: { ...s.actuals[GMV.viaje], [PREV]: 300 } } };
    s = createNode(s, { level: "category", parentId: GMV.ahorro, type: "transfer", name: "Paso" });
    const paso = s.nodes[s.nodes.length - 1].id;
    const op = (from: string, to: string) => {
      const r = applyReserveOp(s, { from, to, period: PREV, amount: 300 }, P);
      if (!("state" in r)) throw new Error(`el escenario no se montó: ${JSON.stringify(r)}`);
      s = r.state;
    };
    op(GMV.viaje, paso);
    op(paso, AVAILABLE_ID);

    // El dominio permite borrarla, también con julio cerrado…
    const cerrado = { ...s, closure: { closedThrough: PREV, reopened: null } } as LedgerState;
    expect(deleteBlockReason(cerrado, paso, P)).toBeNull();
    // …pero borrarla reescribe movimientos de julio, y eso el servidor lo rechaza.
    const ensayo = deleteNode(cerrado, paso, P);
    expect("state" in ensayo && closedPeriodsViolated(cerrado, ensayo.state)).toEqual([PREV]);
    expect(deleteTouchesClosed(cerrado, paso, P)).toBe(true);

    // Con julio abierto no hay nada que impedir, y un elemento vacío nunca toca un mes cerrado.
    expect(deleteTouchesClosed(s, paso, P)).toBe(false);
    expect(deleteTouchesClosed(conPrevCerrado(), GMV.prueba, P)).toBe(false);
    // Un elemento que el dominio YA bloquea no se reporta aquí: su motivo es otro.
    expect(deleteTouchesClosed(conPrevCerrado(), GMV.mercado, P)).toBe(false);
  });
});
