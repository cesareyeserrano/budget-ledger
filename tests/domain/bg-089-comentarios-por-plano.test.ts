/**
 * BG-089 — cada celda tiene sus comentarios: los de Presupuestado no son los de Ejecutado.
 *
 * Un comentario se guardaba por categoría y periodo, sin plano, y las dos celdas del mes abrían el
 * mismo panel: lo escrito en Ejecutado aparecía igual en Presupuestado. Ahora el comentario lleva de
 * cuál de las dos es. Los que ya existían no llevan nada, y eso significa Ejecutado (decisión del
 * usuario, 2026-10-01).
 */
import { describe, it, expect } from "vitest";
import { addCellNote, cellDetail, cellObservations, createNode } from "@/domain";
import { cellNotesSchema } from "@/domain/validation";
import type { CellNote, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";
import { P, M } from "../helpers/periods";

const SEP = M.sep;

const NODES: LedgerNode[] = [
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Esenciales", icon: null, order: 0 },
  { id: "c-taxi", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Taxi", icon: null, order: 1 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 2 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 3 },
];
const gasto: Movement = { id: "m1", ownerId: "local", type: "expense", catId: "c-taxi", subId: null, target: "c-taxi", amount: 40_000, period: SEP, createdAt: 1, date: "2026-09-10T12:00", note: "Al aeropuerto" };

function estado(over: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "local", nodes: NODES, budgets: { "c-taxi": { [SEP]: 100_000 } }, actuals: { "c-taxi": { [SEP]: 40_000 } }, movements: [gasto], ...over };
}
function anotar(s: LedgerState, text: string, plane?: "budget" | "actual", day?: string): LedgerState {
  const r = addCellNote(s, "c-taxi", SEP, text, P, day, plane);
  if (!("state" in r)) throw new Error(`la nota se rechazó: ${r.rejected}`);
  return r.state;
}
const comentarios = (s: LedgerState, plane: "budget" | "actual") =>
  cellDetail(s, "c-taxi", SEP, P, plane).filter((e) => e.kind === "comment").map((e) => (e as { note: CellNote }).note.text);

describe("BG-089 · cada celda guarda y muestra sus comentarios", () => {
  it("BG-089a: lo escrito en Ejecutado no aparece en Presupuestado, ni al revés", () => {
    let s = anotar(estado(), "Se dañó el carro");            // por defecto: Ejecutado
    s = anotar(s, "Subió la tarifa en septiembre", "budget");
    expect(comentarios(s, "actual")).toEqual(["Se dañó el carro"]);
    expect(comentarios(s, "budget")).toEqual(["Subió la tarifa en septiembre"]);
  });

  it("BG-089b: el de Presupuestado se marca con el plano; el de Ejecutado no lleva nada", () => {
    const s = anotar(anotar(estado(), "De ejecutado", "actual"), "De presupuesto", "budget");
    const notas = s.cellNotes!["c-taxi"]![SEP]!;
    expect(notas.find((n) => n.text === "De presupuesto")).toMatchObject({ plane: "budget" });
    expect("plane" in notas.find((n) => n.text === "De ejecutado")!).toBe(false);
  });

  it("BG-089c: los comentarios que ya existían, sin plano, son de Ejecutado", () => {
    const viejo: CellNote = { id: "n-viejo", createdAt: 5, text: "Escrito antes" };
    const s = estado({ cellNotes: { "c-taxi": { [SEP]: [viejo] } } });
    expect(comentarios(s, "actual")).toEqual(["Escrito antes"]);
    expect(comentarios(s, "budget")).toEqual([]);
  });

  it("BG-089d: el Detalle de Presupuestado son solo sus comentarios — ni movimientos ni nada del Ejecutado", () => {
    const s = anotar(estado(), "Solo del plan", "budget");
    const plan = cellDetail(s, "c-taxi", SEP, P, "budget");
    expect(plan.map((e) => e.kind)).toEqual(["comment"]);
    // Y el de Ejecutado sigue listando su movimiento, sin el comentario del plan.
    const ejec = cellDetail(s, "c-taxi", SEP, P);
    expect(ejec.map((e) => e.kind)).toEqual(["movement"]);
    expect(cellDetail(estado(), "c-taxi", SEP, P, "budget")).toEqual([]);
  });

  it("BG-089e: en Presupuestado van primero los que tienen día, por día, y después los que no", () => {
    let s = anotar(estado(), "Sin día", "budget");
    s = anotar(s, "Del 20", "budget", "2026-09-20");
    s = anotar(s, "Del 5", "budget", "2026-09-05");
    expect(comentarios(s, "budget")).toEqual(["Del 5", "Del 20", "Sin día"]);
  });

  it("BG-089f: en un bolsillo, la celda Ejec. tampoco muestra un comentario de Presupuestado", () => {
    const base = estado({ actuals: { "c-viaje": { [SEP]: 0 } } });
    const r1 = addCellNote(base, "c-viaje", SEP, "Del plan", P, undefined, "budget");
    if (!("state" in r1)) throw new Error("rechazada");
    const r2 = addCellNote(r1.state, "c-viaje", SEP, "Del ejecutado", P);
    if (!("state" in r2)) throw new Error("rechazada");
    expect(cellObservations(r2.state, "c-viaje", SEP, P).map((o) => o.text)).toEqual(["Del ejecutado"]);
    expect(cellDetail(r2.state, "c-viaje", SEP, P).filter((e) => e.kind === "comment")).toHaveLength(1);
  });

  it("BG-089g: cuando la categoría gana su primera subcategoría, los comentarios viajan con su plano", () => {
    const s = anotar(anotar(estado({ movements: [] }), "De ejecutado"), "De presupuesto", "budget");
    const next = createNode(s, { level: "sub", parentId: "c-taxi", type: "expense", name: "Uber" });
    const hijo = next.nodes.find((n) => n.parentId === "c-taxi")!.id;
    expect(cellDetail(next, hijo, SEP, P, "actual").filter((e) => e.kind === "comment").map((e) => (e as { note: CellNote }).note.text)).toEqual(["De ejecutado"]);
    expect(cellDetail(next, hijo, SEP, P, "budget").map((e) => (e as { note: CellNote }).note.text)).toEqual(["De presupuesto"]);
  });

  it("BG-089h: el esquema admite el plano de Presupuestado y rechaza cualquier otro valor", () => {
    const con = (plane: unknown) => ({ "c-taxi": { [SEP as PeriodKey]: [{ id: "n1", createdAt: 1, text: "x", ...(plane === undefined ? {} : { plane }) }] } });
    expect(cellNotesSchema.safeParse(con(undefined)).success).toBe(true);
    expect(cellNotesSchema.safeParse(con("budget")).success).toBe(true);
    expect(cellNotesSchema.safeParse(con("actual")).success).toBe(false);
    expect(cellNotesSchema.safeParse(con("otro")).success).toBe(false);
  });
});
