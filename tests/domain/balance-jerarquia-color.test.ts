import { describe, it, expect } from "vitest";
import { exceptionColor } from "@/components/exceptionColor";
import { cellNum } from "@/components/format";

/**
 * balance-jerarquia — la regla de color, con un solo domicilio (EP-01).
 *
 * `exceptionColor` es una función pura sin imports, así que se verifica aquí igual que el resto de
 * lo puro del proyecto. Los TCs que exigen el color EFECTIVO sobre las 192 celdas renderizadas y en
 * los dos temas viven en la suite e2e: son fallos distintos (la función puede acertar y el CSS no
 * aplicarse, y al revés).
 */

const NEUTRO = "var(--fg)";
const ALERTA = "var(--alert-strong)";

describe("FR-1403 — neutro por defecto; el color sólo en la excepción", () => {
  // @aitri-tc TC-BJE-005h
  it("TC-BJE-005h: un resultado sano devuelve neutro, nunca --favorable", () => {
    for (const v of [300000, 1, 2800000]) {
      const c = exceptionColor(v, { alarms: true });
      expect(c).toBe(NEUTRO);
      // El fondo del asunto: el token retirado no puede reaparecer por ninguna vía.
      expect(c).not.toContain("favorable");
      expect(c).not.toContain("success");
    }
  });

  // @aitri-tc TC-BJE-005e
  it("TC-BJE-005e: un resultado de EXACTAMENTE cero se pinta neutro, ni favorable ni alerta", () => {
    // Es el borde exacto que la condición anterior del chip (`available >= 0`) pintaba de verde.
    // Cero no es una buena noticia: es el límite.
    expect(exceptionColor(0, { alarms: true })).toBe(NEUTRO);
    expect(exceptionColor(0, { alarms: true })).not.toBe(ALERTA);
    // -0 es 0 en JS, pero `-0 < 0` es false: se comprueba para que nadie "arregle" el signo con
    // una comparación que lo trate como negativo.
    expect(exceptionColor(-0, { alarms: true })).toBe(NEUTRO);
  });

  // @aitri-tc TC-BJE-005f
  it("TC-BJE-005f: un negativo con alarmas SÍ devuelve alerta — la excepción sigue viva", () => {
    // El fallo más grave posible aquí sería retirar la señal en vez del ruido.
    expect(exceptionColor(-600000, { alarms: true })).toBe(ALERTA);
    expect(exceptionColor(-1, { alarms: true })).toBe(ALERTA);
    // Una fila que NO señala por signo (un flujo mensual negativo es normal) no se pinta de alerta.
    expect(exceptionColor(-600000, { alarms: false })).toBe(NEUTRO);
    // Por defecto, quien no declara `alarms` alarma: es el valor seguro.
    expect(exceptionColor(-600000)).toBe(ALERTA);
  });

  it("la función es total: devuelve uno de los dos tokens y nada más", () => {
    // Guarda contra una futura rama que reintroduzca un tercer color por la puerta de atrás.
    const salidas = new Set(
      [-2, -1, 0, 1, 2, 1e9, -1e9].flatMap((v) => [
        exceptionColor(v, { alarms: true }),
        exceptionColor(v, { alarms: false }),
      ]),
    );
    expect([...salidas].sort()).toEqual([ALERTA, NEUTRO].sort());
  });
});

describe("FR-1404 — una celda sin dato nunca lleva el color de su fila", () => {
  // BL-063: esta prueba llevaba el id TC-BJE-007f y afirmaba sobre una regla de color escrita aquí
  // mismo, que ya no era la de `BalanceCell`. El caso se prueba ahora contra la celda real, en
  // tests/e2e/balance-jerarquia.spec.ts. Aquí queda lo que sí es código del producto.
  it("cellNum trata el cero como ausencia: cero y sin dato dan el mismo guion", () => {
    expect(cellNum(0)).toBe("—");
    expect(cellNum(undefined)).toBe("—");
    expect(cellNum(300000)).not.toBe("—");
    // y el color de excepción nunca devuelve el atenuado: ese lo decide la celda, no esta función
    expect(exceptionColor(0, { alarms: true })).toBe(NEUTRO);
  });
});
