// Ayudas de PERIODO para la suite (feature multi-anio, FR-1901).
//
// Antes de multi-anio las pruebas escribían meses sueltos ("ene"). Ahora el eje es "YYYY-MM", así
// que la suite fija un AÑO DE REFERENCIA y trabaja sobre sus doce periodos. Que sea un año fijo y
// no el del reloj es lo que mantiene las pruebas deterministas: una suite que se apoye en la fecha
// de ejecución se rompe sola al cambiar de mes.
import { periodRange } from "@/domain/periods";
import type { PeriodKey } from "@/domain/types";

/** Año de referencia de la suite. Coincide con el único año que el modelo viejo conocía. */
export const REF_YEAR = 2026;

/** Los doce periodos del año de referencia, en orden. Es el `periods` que reciben las funciones. */
export const P: PeriodKey[] = periodRange(`${REF_YEAR}-01`, `${REF_YEAR}-12`);

/** El primer periodo del año de referencia — el que las pruebas pasan a `buildSeed`. */
export const P0: PeriodKey = P[0];

/** Los doce periodos del año SIGUIENTE, para las pruebas que cruzan el borde de año. */
export const P_NEXT: PeriodKey[] = periodRange(`${REF_YEAR + 1}-01`, `${REF_YEAR + 1}-12`);

/** Rango de DOS años seguidos: el escenario del arrastre diciembre→enero (FR-1903). */
export const P2: PeriodKey[] = periodRange(`${REF_YEAR}-01`, `${REF_YEAR + 1}-12`);

/** Traduce un mes del modelo viejo ("ene") a su periodo del año de referencia. */
export const M = {
  ene: P[0], feb: P[1], mar: P[2], abr: P[3], may: P[4], jun: P[5],
  jul: P[6], ago: P[7], sep: P[8], oct: P[9], nov: P[10], dic: P[11],
} as const;
