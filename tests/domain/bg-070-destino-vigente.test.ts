/**
 * BG-070 (y de paso BG-064) — un gasto o un ingreso solo se guarda sobre una hoja VIGENTE de su tipo.
 *
 * El registro puede tener elegida una categoría que desaparece con el formulario abierto: otro
 * dispositivo la borra, o le da su primera subcategoría y deja de ser hoja. `addMovement` sumaba el
 * monto a la celda de ese nodo sin mirar el árbol, y el movimiento quedaba vivo en la BD e invisible
 * en la app. El servidor corre la MISMA mutación en POST /movements (BG-064), así que el guardia del
 * dominio cierra las dos puertas.
 */
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { addMovement, createNode, deleteNode } from "@/domain/mutations";
import type { LedgerState } from "@/domain/types";
import { P, P0 } from "../helpers/periods";

const gasto = (catId: string, subId: string | null = null) =>
  ({ type: "expense" as const, catId, subId, amount: 25_000, period: P0 });

describe("BG-070 · el destino de un gasto o un ingreso tiene que existir, ser hoja y ser de su tipo", () => {
  it("BG-070a: una hoja vigente del mismo tipo sigue recibiendo el movimiento", () => {
    const s = buildSeed("u", P0);
    const next = addMovement(s, gasto("c-vivienda"), P);
    expect(next).not.toBe(s);
    expect(next.actuals["c-vivienda"]?.[P0]).toBe(25_000);
    expect(next.movements[0]).toMatchObject({ catId: "c-vivienda", target: "c-vivienda" });

    const conSub = addMovement(s, gasto("c-comida", "s-comida-cafe"), P);
    expect(conSub.actuals["s-comida-cafe"]?.[P0]).toBe(25_000);
  });

  it("BG-070b: una categoría que ya no existe no recibe el movimiento", () => {
    const s = buildSeed("u", P0);
    const borrada = deleteNode(s, "c-vivienda", P);
    if (!("state" in borrada)) throw new Error(`deleteNode rechazó: ${JSON.stringify(borrada)}`);
    const sinNodo: LedgerState = borrada.state;
    expect(sinNodo.nodes.some((n) => n.id === "c-vivienda")).toBe(false);

    expect(addMovement(sinNodo, gasto("c-vivienda"), P)).toBe(sinNodo);
    expect(addMovement(s, gasto("c-no-existe"), P)).toBe(s);
  });

  it("BG-070c: una categoría que ganó su primera subcategoría ya no es hoja y no recibe el movimiento", () => {
    let s = buildSeed("u", P0);
    s = createNode(s, { level: "sub", parentId: "c-vivienda", type: "expense", name: "Arriendo" });
    expect(addMovement(s, gasto("c-vivienda"), P)).toBe(s);
    // Un grupo con hijos tampoco, aunque se mande como catId.
    expect(addMovement(s, gasto("g-esenciales"), P)).toBe(s);
  });

  it("BG-070d: el tipo del movimiento tiene que coincidir con el de la hoja", () => {
    const s = buildSeed("u", P0);
    expect(addMovement(s, { type: "income", catId: "c-vivienda", amount: 25_000, period: P0 }, P)).toBe(s);
    expect(addMovement(s, gasto("c-salario"), P)).toBe(s);
    // Y el ingreso sobre su propia hoja pasa.
    const ok = addMovement(s, { type: "income", catId: "c-salario", amount: 25_000, period: P0 }, P);
    expect(ok.actuals["c-salario"]?.[P0]).toBe(25_000);
  });

  it("BG-070h: catId y subId tienen que contar la misma historia (revisión adversarial)", () => {
    const s = buildSeed("u", P0);
    // La sub vale, pero el catId que la acompaña no es su padre: de otro tipo, o inexistente.
    expect(addMovement(s, gasto("c-salario", "s-comida-cafe"), P)).toBe(s);
    expect(addMovement(s, gasto("c-no-existe", "s-comida-cafe"), P)).toBe(s);
    expect(addMovement(s, gasto("c-vivienda", "s-comida-cafe"), P)).toBe(s);
    // Un subId que no es una sub, o una sub mandada como catId sin su subId.
    expect(addMovement(s, gasto("c-vivienda", "c-transporte"), P)).toBe(s);
    expect(addMovement(s, gasto("s-comida-cafe"), P)).toBe(s);
  });

  it("BG-070i: un grupo sin hijos es hoja (FR-606) y sigue recibiendo movimientos", () => {
    let s = buildSeed("u", P0);
    s = createNode(s, { level: "group", parentId: null, type: "expense", name: "Viaje" });
    const grupo = s.nodes.find((n) => n.name === "Viaje")!.id;
    const next = addMovement(s, gasto(grupo), P);
    expect(next.actuals[grupo]?.[P0]).toBe(25_000);
  });
});
