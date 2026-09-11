// @aitri-trace components:exceptionColor — FR-1403/FR-1405 (feature balance-jerarquia), ADR-01.
//
// Módulo:       src/components/exceptionColor.ts
// Propósito:    Domicilio ÚNICO de la regla de color «neutro por defecto; color sólo en la
//               excepción». Antes de esta feature la regla estaba escrita TRES veces —en
//               `balanceColor`, en el ternario de `HeaderTotalCell` y en el del chip RESTANTE de
//               `DesktopShell`— y dos de las tres se habían quedado en verde permanente sin que
//               nadie lo notara. Tres copias divergen; una no puede.
// Dependencias: ninguna. Función pura, sin estado y sin imports: así es trivial de probar y no
//               puede arrastrar un ciclo de imports a ningún consumidor.

/** Color neutro de una cifra destacada (resultado, bottom-line, indicador). */
const NEUTRAL = "var(--fg)";

/** Color de la excepción grave: saldo negativo. Mismo token que usa la grilla para el sobre-consumo. */
const EXCEPTION = "var(--alert-strong)";

/**
 * Color de una cifra según la regla de excepción del producto.
 *
 * La regla, en una frase: **el color aparece sólo cuando hay algo que mirar.** Un valor sano no se
 * colorea — se distingue por peso y por posición. El único color que sobrevive es el de la
 * excepción, y precisamente por ser el único se ve al instante.
 *
 * Es la regla que `BalanceModule` ya declaraba por escrito («un verde en cada insumo positivo sería
 * ruido permanente y dejaría de significar algo») y que luego incumplía trece líneas más abajo. Aquí
 * queda aplicada de verdad, y con un solo sitio donde puede estar mal.
 *
 * OJO CON EL CERO: `value < 0` es estricto a propósito. La condición anterior del chip RESTANTE era
 * `available >= 0 ? favorable : alerta`, que pintaba de VERDE un restante de exactamente cero. Cero
 * no es una buena noticia: es el límite exacto, y se pinta neutro (TC-BJE-005e, TC-BJE-008e).
 *
 * @param value Valor de la cifra. Se compara con cero; no se formatea aquí.
 * @param opts.alarms `false` para una fila que NO señala excepción por signo (sus negativos son
 *   normales, como un flujo mensual negativo). Por defecto `true`: quien no lo declara, alarma.
 * @returns La variable CSS del color, lista para pasar a `style`.
 *
 * @aitri-trace FR-ID: FR-1403, US-ID: US-1403, AC-ID: AC-1403a, TC-ID: TC-BJE-005h, TC-BJE-005e, TC-BJE-005f
 */
export function exceptionColor(value: number, opts?: { alarms?: boolean }): string {
  const alarms = opts?.alarms ?? true;
  return alarms && value < 0 ? EXCEPTION : NEUTRAL;
}
