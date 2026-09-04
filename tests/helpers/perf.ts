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
