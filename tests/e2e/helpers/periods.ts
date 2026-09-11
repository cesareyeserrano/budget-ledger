// Periodos para la suite e2e (feature multi-anio, FR-1901).
// Copia deliberada del helper de tests/helpers/periods.ts: la suite e2e vive fuera del tsconfig
// principal y del alias "@/", así que no puede importarlo por ruta de proyecto.
export const REF_YEAR = 2026;
const pad = (n: number) => String(n).padStart(2, "0");
/** Los doce periodos del año de referencia, en orden. */
export const P: string[] = Array.from({ length: 12 }, (_, i) => `${REF_YEAR}-${pad(i + 1)}`);
export const P0 = P[0];
/** Traduce un mes del modelo viejo a su periodo del año de referencia. */
export const M = Object.fromEntries(
  ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
    .map((m, i) => [m, P[i]])
) as Record<string, string>;

/**
 * Cuántas columnas de mes pinta la grilla AHORA MISMO.
 *
 * Desde multi-anio ya no son doce: el rango va del dato más antiguo al fin del horizonte, así que
 * cualquier aserción que fije el 12 mide el calendario y no el comportamiento. Se lee del DOM.
 */
export async function visibleMonthCount(page: import("@playwright/test").Page): Promise<number> {
  return page.locator("[data-month-head]").count();
}
