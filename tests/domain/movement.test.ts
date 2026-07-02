import { describe, it, expect, beforeEach } from "vitest";
import { buildSeed, addMovement, canSave, createNode, __resetSeq } from "@/domain";
import { rollupActual } from "@/domain/rollup";

beforeEach(() => __resetSeq());

describe("FR-001 registrar movimiento", () => {
  // @aitri-tc TC-001e
  it("TC-001e: addMovement con subId suma a la hoja subId, no a la categoría", () => {
    const s0 = buildSeed("local");
    // 'Comida' (c-comida) tiene sub 'Mercado' (s-comida-mercado)
    const before = s0.actuals["s-comida-mercado"]?.jun ?? 0;
    const s1 = addMovement(s0, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 30000, month: "jun" });
    expect(s1.movements[0].target).toBe("s-comida-mercado");
    expect(s1.actuals["s-comida-mercado"].jun).toBe(before + 30000);
    // el actual directo de la categoría (no hoja) no se toca
    expect(s1.actuals["c-comida"]?.jun).toBe(s0.actuals["c-comida"]?.jun);
  });

  // @aitri-tc TC-001f
  it("TC-001f: monto 0 o sin categoría → canSave false y no crea movimiento", () => {
    const s0 = buildSeed("local");
    expect(canSave({ amount: 0, catId: null })).toBe(false);
    expect(canSave({ amount: 0, catId: "c-comida" })).toBe(false);
    const s1 = addMovement(s0, { type: "expense", catId: "", amount: 0, month: "jun" });
    expect(s1.movements.length).toBe(s0.movements.length);
    expect(s1).toBe(s0); // negativo: estado sin cambios
  });

  // happy a nivel dominio del registro (target = subId ?? catId)
  it("TC-001h: registrar en categoría-hoja suma exactamente el monto al Ejecutado", () => {
    let s = buildSeed("local");
    // 'Vivienda' (c-vivienda) es categoría-hoja
    s = createNode(s, { level: "sub", parentId: "c-comida", type: "expense", name: "tmp" }); // no afecta vivienda
    const before = rollupActual(buildSeed("local"), "c-vivienda", "jun");
    const s2 = addMovement(buildSeed("local"), { type: "expense", catId: "c-vivienda", amount: 50000, month: "jun" });
    expect(rollupActual(s2, "c-vivienda", "jun")).toBe(before + 50000);
    expect(s2.movements[0].amount).toBe(50000);
  });
});

describe("NFR-004 validación de monto", () => {
  // @aitri-tc TC-104h
  it("TC-104h: acepta entero positivo", () => {
    const s0 = buildSeed("local");
    const s1 = addMovement(s0, { type: "expense", catId: "c-vivienda", amount: 15000, month: "ene" });
    expect(s1.movements[0].amount).toBe(15000);
  });

  // @aitri-tc TC-104f
  it("TC-104f: rechaza no numérico y negativo (no persiste)", () => {
    const s0 = buildSeed("local");
    const sA = addMovement(s0, { type: "expense", catId: "c-vivienda", amount: "abc", month: "ene" });
    const sB = addMovement(s0, { type: "expense", catId: "c-vivienda", amount: -500, month: "ene" });
    expect(sA.movements.length).toBe(0);
    expect(sB.movements.length).toBe(0);
  });
});
