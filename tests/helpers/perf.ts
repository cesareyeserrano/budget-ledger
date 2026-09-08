// @aitri-trace tests:helpers:perf — el cronómetro bajo instrumentación (BG-026).
//
// Módulo:    tests/helpers/perf.ts
// Propósito: decir si el reloj de pared es fiable en esta corrida.
//
// POR QUÉ EXISTE. Las pruebas de dominio llevan guardarraíles de tiempo: «esto cabe en 150 ms»,
// «el coste por periodo no se triplica». Miden con `performance.now()` contra un margen FIJO, y
// eso solo tiene sentido si el código corre tal cual. Bajo instrumentación de cobertura no corre
// tal cual: v8 envuelve cada rama para contarla, así que lo que el cronómetro mide es el coste de
// contar, no el del algoritmo.
//
// El resultado era un gate INTERMITENTE. El 2026-09-04, en la misma tanda y con el mismo comando,
// reventaron dos aserciones distintas —multi-anio (0,03711 contra un tope de 0,03693, un 0,5% por
// encima de un margen de ×3) y budget-state (56,7 contra 50)— mientras el mismo `npm run coverage`
// pasaba en verde sobre el pipeline raíz. Trece features más la raíz declaran ese gate como
// `required`, así que un fallo de azar bloqueaba `verify-complete` en cualquiera de ellas.
//
// QUÉ NO ES ESTO. No es apagar los guardarraíles: la corrida normal (`vitest run`, la que Aitri
// parsea para acreditar los TCs) NO define la variable, así que ahí se afirman todos, exactamente
// como antes. Solo se callan donde la medición no significa nada.
//
// El interruptor lo encienden los DOS puntos de entrada de cobertura del proyecto: el script
// `coverage` de package.json y `coverage.sh`. Quien invoque `npx vitest run --coverage` a mano se
// queda sin el cinturón, y volverá a ver el fallo de azar: es el precio de no tener señal de
// instrumentación en tiempo de ejecución (el proveedor es v8, que no deja `__coverage__` global
// ni `NODE_V8_COVERAGE` — comprobado con una sonda el 2026-09-04).

/** ¿Vale lo que marca `performance.now()` en esta corrida? Falso bajo cobertura. */
export const CRONOMETRO_FIABLE = !process.env.AITRI_COVERAGE;

/**
 * Para una prueba cuyo ÚNICO contenido es un guardarraíl de tiempo: se salta entera bajo
 * cobertura, de modo que aparezca como saltada y no como una prueba verde que no afirmó nada.
 *
 * Uso: `it.skipIf(SALTAR_SI_INSTRUMENTADO)("TC-XXX: …", () => { … })`
 */
export const SALTAR_SI_INSTRUMENTADO = !CRONOMETRO_FIABLE;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LA OTRA MITAD (BG-030): la contención, que la guarda de arriba NO cubría
//
// `CRONOMETRO_FIABLE` protege a la corrida INSTRUMENTADA. Pero `aitri verify-run` lanza a la vez
// el runner normal (`npm run test:run`, SIN la variable) y el gate de cobertura (CON ella) — y es
// la corrida NORMAL la que se queda sin CPU. Sus guardarraíles seguían afirmándose contra márgenes
// fijos mientras otra suite completa le competía, así que el runner salía con exit 1 y CERO TCs en
// rojo: el falso verde. Ocurrió cuatro veces el 2026-09-08.
//
// LA CAUSA NO ES LA LENTITUD, ES LA RÁFAGA. Una máquina uniformemente lenta no rompe una razón
// (c168/c12): las dos mitades se frenan igual. Lo que rompe es que la contención llega a ráfagas y
// pilla a UNA de las dos mediciones. Por eso ampliar el margen no arregla nada: solo hace falta que
// la ráfaga sea más grande.
//
// LA SALIDA es medir varias veces y quedarse con el MÍNIMO — la muestra que menos competencia tuvo
// es la que más se acerca al coste real del algoritmo. MEDIDO el 2026-09-08 con seis carriles de
// CPU compitiendo, repitiendo la misma medición seis veces (el valor verdadero es 1.02):
//
//     media simple :  2.18  0.97  0.75  1.03  1.02  2.13     ← se va hasta 2.18, tope 3.00
//     mejor-de-5   :  1.02  1.02  1.02  1.03  1.03  1.02     ← clavado, seis de seis
//
// NO ES AFLOJAR EL GUARDARRAÍL, ES AFILARLO. La media simple obliga a márgenes anchos para no dar
// falsos rojos, y un margen ancho deja pasar regresiones reales. El mínimo devuelve el valor
// verdadero, así que el mismo tope pasa a ser mucho más exigente: una regresión cuadrática de
// verdad no puede producir un mínimo rápido, por muy desahogada que esté la máquina.

/**
 * Ejecuta `medir` varias veces y devuelve el MÍNIMO: la muestra menos contaminada por la
 * competencia de CPU. Úsalo en TODA aserción de tiempo, sea razón o presupuesto absoluto.
 *
 * `veces = 5` es el punto donde la medición se estabilizó en el experimento; subirlo alarga la
 * suite sin ganar precisión.
 */
export function mejorDe(medir: () => number, veces = 5): number {
  let min = Infinity;
  for (let i = 0; i < veces; i++) min = Math.min(min, medir());
  return min;
}

/**
 * Azúcar para el caso más común: cronometrar `trabajo` y devolver el mejor tiempo de varias
 * pasadas, en milisegundos.
 */
export function mejorTiempo(trabajo: () => void, veces = 5): number {
  return mejorDe(() => {
    const t0 = performance.now();
    trabajo();
    return performance.now() - t0;
  }, veces);
}
