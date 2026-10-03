/**
 * BG-090 — los esquemas del borde tienen tope de tamaño.
 *
 * El snapshot del PUT no limitaba cuántos nodos, movimientos o notas traía, ni lo largo de un nombre,
 * un icono, un id o una nota: una sola petición con sesión podía hacer que el servidor validara e
 * insertara un cuerpo arbitrariamente grande dentro de la transacción que retiene el candado del
 * dueño. Aquí se comprueban los esquemas; el 422 y el 413 de las rutas, en
 * tests/integration/backend/bg-090-topes-servidor.test.ts.
 *
 * Los topes van MUY por encima de lo que la app deja crear (un nombre son 60 caracteres, una nota
 * 280): no son reglas de producto, son el techo de lo que el servidor acepta procesar.
 */
import { describe, it, expect } from "vitest";
import { ledgerPutSchema, ledgerStateSchema, movementInputSchema, TOPES } from "@/server/schemas";
import { buildSeed } from "@/domain";
import type { LedgerNode, LedgerState, Movement } from "@/domain/types";
import { P0 } from "../helpers/periods";

const semilla = buildSeed("u", P0);
const valido = (state: unknown) => ledgerPutSchema.safeParse({ baseRevision: 0, state }).success;
const nodo = (i: number, extra: Partial<LedgerNode> = {}): LedgerNode =>
  ({ id: `n-${i}`, ownerId: "u", type: "expense", level: "group", parentId: null, name: `Grupo ${i}`, icon: null, order: i, ...extra }) as LedgerNode;
const mov = (i: number, extra: Partial<Movement> = {}): Movement =>
  ({ id: `m-${i}`, ownerId: "u", type: "expense", catId: "c-vivienda", subId: null, target: "c-vivienda", amount: 1000, period: P0, createdAt: i, ...extra }) as Movement;
const con = (extra: Partial<LedgerState>): LedgerState => ({ ...semilla, ...extra });

describe("BG-090 · topes del snapshot (PUT /api/v1/ledger)", () => {
  it("BG-090: lo que la app deja crear sigue siendo válido — nombre de 60 y nota de 280 (control)", () => {
    expect(valido(semilla)).toBe(true);
    expect(valido(con({
      nodes: [...semilla.nodes, nodo(1, { name: "x".repeat(60) })],
      movements: [mov(1, { note: "y".repeat(280) })],
      cellNotes: { "c-vivienda": { [P0]: [{ id: "k", createdAt: 1, text: "z".repeat(280) }] } },
    }))).toBe(true);
  });

  it("BG-090: justo en el tope pasa y uno más no — nodos y movimientos", () => {
    const nodos = (n: number) => Array.from({ length: n }, (_, i) => nodo(i));
    expect(valido(con({ nodes: nodos(TOPES.nodos) }))).toBe(true);
    expect(valido(con({ nodes: nodos(TOPES.nodos + 1) }))).toBe(false);

    const movs = (n: number) => Array.from({ length: n }, (_, i) => mov(i));
    expect(valido(con({ movements: movs(TOPES.movimientos) }))).toBe(true);
    expect(valido(con({ movements: movs(TOPES.movimientos + 1) }))).toBe(false);
  });

  it("BG-090: rechaza un nombre, un icono, un id o una nota más largos que su tope, y un id vacío", () => {
    const larga = (n: number) => "a".repeat(n + 1);
    expect(valido(con({ nodes: [...semilla.nodes, nodo(1, { name: larga(TOPES.nombre) })] }))).toBe(false);
    expect(valido(con({ nodes: [...semilla.nodes, nodo(1, { icon: larga(TOPES.icono) })] }))).toBe(false);
    expect(valido(con({ nodes: [...semilla.nodes, nodo(1, { id: larga(TOPES.id) })] }))).toBe(false);
    expect(valido(con({ nodes: [...semilla.nodes, nodo(1, { id: "" })] }))).toBe(false);
    expect(valido(con({ nodes: [...semilla.nodes, nodo(1, { parentId: larga(TOPES.id) })] }))).toBe(false);
    expect(valido(con({ movements: [mov(1, { id: larga(TOPES.id) })] }))).toBe(false);
    expect(valido(con({ movements: [mov(1, { target: larga(TOPES.id) })] }))).toBe(false);
    expect(valido(con({ movements: [mov(1, { catId: larga(TOPES.id) })] }))).toBe(false);
    expect(valido(con({ movements: [mov(1, { note: larga(TOPES.nota) })] }))).toBe(false);
  });

  it("BG-090: rechaza más notas por celda que el tope, y una clave de celda más larga que un id", () => {
    const notas = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `k-${i}`, createdAt: i, text: "nota" }));
    expect(valido(con({ cellNotes: { "c-vivienda": { [P0]: notas(TOPES.notasPorCelda) } } }))).toBe(true);
    expect(valido(con({ cellNotes: { "c-vivienda": { [P0]: notas(TOPES.notasPorCelda + 1) } } }))).toBe(false);
    expect(valido(con({ budgets: { ["a".repeat(TOPES.id + 1)]: { [P0]: 100 } } }))).toBe(false);
  });

  it("BG-090: el tope vive en el PUT, no en la lectura — lo ya guardado se sigue pudiendo cargar", () => {
    // `ledgerStateSchema` valida también el snapshot que el navegador RECIBE. Si el tope viviera
    // ahí, un dato guardado antes de la regla dejaría al usuario sin poder abrir su ledger.
    const viejo = con({ nodes: [...semilla.nodes, nodo(1, { name: "a".repeat(TOPES.nombre + 1) })] });
    expect(ledgerStateSchema.safeParse(viejo).success).toBe(true);
    expect(valido(viejo)).toBe(false);
  });
});

describe("BG-090 · topes del movimiento nuevo (POST /api/v1/movements)", () => {
  const base = { type: "expense", catId: "c-vivienda", amount: 1000, period: P0 };

  it("BG-090: acepta una nota larga dentro del tope (el dominio la recorta a 280, como siempre)", () => {
    expect(movementInputSchema.safeParse({ ...base, note: "n".repeat(TOPES.nota) }).success).toBe(true);
  });

  it("BG-090: rechaza una nota, una categoría o una subcategoría por encima de su tope", () => {
    expect(movementInputSchema.safeParse({ ...base, note: "n".repeat(TOPES.nota + 1) }).success).toBe(false);
    expect(movementInputSchema.safeParse({ ...base, catId: "c".repeat(TOPES.id + 1) }).success).toBe(false);
    expect(movementInputSchema.safeParse({ ...base, subId: "s".repeat(TOPES.id + 1) }).success).toBe(false);
  });
});
