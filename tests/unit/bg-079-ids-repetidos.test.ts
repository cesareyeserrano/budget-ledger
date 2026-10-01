/**
 * BG-079 (d) — un snapshot con un id repetido es un cuerpo inválido.
 *
 * El esquema del borde no miraba unicidad: el cuerpo pasaba, la base chocaba con su clave primaria y
 * la respuesta era un 500. Aquí se comprueba el esquema; el 422 de la ruta, en
 * tests/integration/backend/bg-079-servidor.test.ts.
 */
import { describe, it, expect } from "vitest";
import { ledgerPutSchema } from "@/server/schemas";
import { buildSeed } from "@/domain";
import { P0 } from "../helpers/periods";

const semilla = buildSeed("u", P0);
const cuerpo = (state: unknown) => ({ baseRevision: 0, state });
const mov = { id: "m-1", ownerId: "u", type: "expense", catId: "c-vivienda", subId: null, target: "c-vivienda", amount: 1000, period: P0, createdAt: 1 };
const nota = { id: "n-1", createdAt: 3, text: "Una nota" };

describe("BG-079 (d) · ids repetidos en el snapshot", () => {
  it("BG-079d: la semilla tal cual es válida (control)", () => {
    expect(ledgerPutSchema.safeParse(cuerpo(semilla)).success).toBe(true);
    expect(ledgerPutSchema.safeParse(cuerpo({ ...semilla, movements: [mov], cellNotes: { "c-vivienda": { [P0]: [nota] } } })).success).toBe(true);
  });

  it("BG-079d: rechaza un nodo, un movimiento o una nota de la misma celda con el id repetido", () => {
    expect(ledgerPutSchema.safeParse(cuerpo({ ...semilla, nodes: [...semilla.nodes, semilla.nodes[0]] })).success).toBe(false);
    expect(ledgerPutSchema.safeParse(cuerpo({ ...semilla, movements: [mov, { ...mov, createdAt: 2 }] })).success).toBe(false);
    expect(ledgerPutSchema.safeParse(cuerpo({ ...semilla, cellNotes: { "c-vivienda": { [P0]: [nota, { ...nota, createdAt: 4 }] } } })).success).toBe(false);
  });

  it("BG-079d: el mismo id de nota en dos celdas distintas sigue siendo válido", () => {
    const dosCeldas = { ...semilla, cellNotes: { "c-vivienda": { [P0]: [nota] }, "c-transporte": { [P0]: [nota] } } };
    expect(ledgerPutSchema.safeParse(cuerpo(dosCeldas)).success).toBe(true);
  });
});
