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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LA TERCERA PIEZA (BG-002 de multi-anio): cuando la racha lenta dura un lado ENTERO
//
// El mejor-de-5 supone ráfagas CORTAS: alguna de las cinco muestras escapa y el mínimo la encuentra.
// Pero una razón medía sus dos lados EN BLOQUE —cinco muestras de uno y luego cinco del otro— y si
// la racha lenta dura el bloque entero, caen las cinco y el mínimo no salva nada. Pasó en el
// verify-run de multi-anio del 2026-09-11: TC-MAN-262e en rojo, con la suite completa pasando 8 de
// 9 veces ese día y el test aislado 5 de 5.
//
// REPRODUCIDO con una sonda que copia la medición de TC-MAN-262e, bajo diez procesos quemando CPU
// (tantos como núcleos): el lado de 12 meses seguía en 0,00052 ms por periodo y las cinco muestras
// del de 168 subían JUNTAS a 0,00137 — razón 2,68, tres de treinta ensayos por encima del tope ×2.
// Medido también con tiempo de CPU del proceso (`process.cpuUsage`) y SALE IGUAL (2,68): no es
// esperar turno, es ejecutar más lento, lo que encaja con que el proceso pase a un núcleo de
// eficiencia (esta máquina tiene 4 de rendimiento y 6 de eficiencia). No está probado, y la cura
// no depende de ello.
//
// LA SALIDA es INTERCALAR: medir los dos lados en pares adyacentes, alternando cuál va primero, y
// quedarse con la MEDIANA de las razones. Una racha larga cae por igual sobre los dos lados de un
// par; solo estropea los pares que la pillan a caballo, y la mediana los descarta. MEDIDO, 60
// ensayos con los diez quemadores:
//
//     mejor-de-5 por lado          : máximo 2,03 · 1 por encima de ×2   (en la primera sonda: 2,68 · 3 de 30)
//     mediana de 9 pares alternos  : máximo 1,45 · 0
//
// Y NO PIERDE DIENTES: sobre un trabajo cuadrático sintético (×14 real) la mediana dio entre 10,9 y
// 14,5, muy por encima del tope. Ojo con la tentación del MÍNIMO de las razones: también se midió,
// y cae hasta 0,09 cuando un par pilla lento solo el lado pequeño — dejaría pasar una regresión ×14.
//
// Sobre la premisa de BG-030, arriba: el `aitri verify-run` actual NO corre el runner y los gates a
// la vez, los corre en serie (comprobado en su código el 2026-09-11). La competencia existe igual
// —otros procesos de la máquina y los forks de la propia suite—, así que todo lo anterior sigue
// valiendo; lo único que cambia es de dónde viene.

/**
 * Razón `grande / pequeno` robusta a rachas lentas largas: mide los dos lados en `pares` pares
 * adyacentes, alternando cuál va primero, y devuelve la MEDIANA de las razones. Úsala en toda
 * aserción que compare dos tiempos entre sí; para un presupuesto absoluto sigue valiendo `mejorDe`.
 *
 * `pares` debe ser impar para que la mediana sea una muestra real y no un promedio de dos.
 */
export function razonMediana(pequeno: () => number, grande: () => number, pares = 9): number {
  const razones: number[] = [];
  for (let i = 0; i < pares; i++) {
    let a: number;
    let b: number;
    if (i % 2 === 0) {
      a = pequeno();
      b = grande();
    } else {
      b = grande();
      a = pequeno();
    }
    razones.push(b / a);
  }
  razones.sort((x, y) => x - y);
  return razones[Math.floor(pares / 2)];
}
