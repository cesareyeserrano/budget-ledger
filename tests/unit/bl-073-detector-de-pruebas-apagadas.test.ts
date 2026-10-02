/**
 * BL-073 — el detector de pruebas apagadas ve también los saltos condicionales.
 *
 * Los cuatro suelos de la suite (TC-MAN-202f, TC-CDM-201f, TC-RES-201f, TC-SIN-043f) comparten ahora
 * tests/helpers/pruebasApagadas.ts. Aquí se comprueba el detector en sí, con fuentes de mentira: sin
 * esto, un detector que no detectara nada dejaría los cuatro suelos en verde.
 *
 * Los marcadores se arman por partes para que este fichero no se acuse a sí mismo.
 */
import { describe, it, expect } from "vitest";
import { lineasApagadas, pruebasApagadas } from "../helpers/pruebasApagadas";

const m = (sujeto: string, marca: string, resto = '("x", () => {})') => `${sujeto}.${marca}${resto}`;

describe("BL-073 · qué cuenta como prueba apagada", () => {
  it("BL-073: las formas incondicionales, también encadenadas y con x delante", () => {
    for (const fuente of [
      m("it", "skip"), m("test", "only"), m("describe", "todo"), m("test", "fixme"),
      m("test", ["describe", "skip"].join(".")), m("it", ["concurrent", "skip"].join(".")),
      'x' + 'it("x", () => {})', 'x' + 'describe("x", () => {})', 'x' + 'test("x", () => {})',
    ]) {
      expect(lineasApagadas(fuente), fuente).toEqual([1]);
    }
  });

  it("BL-073: un salto condicional con una condición cualquiera es una prueba apagada", () => {
    expect(lineasApagadas(m("it", "skipIf", '(true)("x", () => {})'))).toEqual([1]);
    expect(lineasApagadas(m("it", "runIf", '(false)("x", () => {})'))).toEqual([1]);
    expect(lineasApagadas(m("test", "skipIf", '(process.env.CI)("x", () => {})'))).toEqual([1]);
  });

  it("BL-073: las dos guardas admitidas no cuentan, ni un comentario, ni una llamada a runExit", () => {
    expect(lineasApagadas(m("it", "skipIf", '(SALTAR_SI_INSTRUMENTADO)("x", () => {})'))).toEqual([]);
    expect(lineasApagadas(m("it", "skipIf", '(!!process.env.VITEST_NESTED)("x", () => {})'))).toEqual([]);
    expect(lineasApagadas(`  // ${m("it", "skip")}`)).toEqual([]);
    expect(lineasApagadas('expect(runExit("bash", ["x.sh"])).toBe(0);')).toEqual([]);
    expect(lineasApagadas('it("TC-001h: una prueba normal", () => {});')).toEqual([]);
  });

  it("BL-073: devuelve la línea exacta dentro de un fuente de varias", () => {
    const fuente = ['it("a", () => {});', m("it", "skipIf", '(true)("b", () => {})'), 'it("c", () => {});'].join("\n");
    expect(lineasApagadas(fuente)).toEqual([2]);
  });

  it("BL-073: hoy la suite no tiene ninguna prueba apagada", () => {
    expect(pruebasApagadas()).toEqual([]);
  });
});
