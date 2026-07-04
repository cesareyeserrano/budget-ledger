// FR-104 — persistencia del ancho de la columna de categoría de la grilla.
// Clave dedicada, independiente de las claves de datos (jerarquía/budgets/actuals/movements).
// Lectura tolerante a fallos: ausencia/valor no numérico/corrupción → default 240, sin excepción.

export const CAT_WIDTH_KEY = "ledger.grid.catWidth.v1";
export const CAT_WIDTH_DEFAULT = 240;
export const CAT_WIDTH_MIN = 180;
export const CAT_WIDTH_MAX = 480;

export function clampCatWidth(px: number): number {
  if (!Number.isFinite(px)) return CAT_WIDTH_DEFAULT;
  return Math.min(CAT_WIDTH_MAX, Math.max(CAT_WIDTH_MIN, Math.round(px)));
}

/** Lee el ancho persistido; ante ausencia/corrupción devuelve el default sin lanzar. */
export function readCatWidth(): number {
  try {
    if (typeof window === "undefined") return CAT_WIDTH_DEFAULT;
    const raw = window.localStorage.getItem(CAT_WIDTH_KEY);
    if (raw == null || raw.trim() === "") return CAT_WIDTH_DEFAULT; // "" → Number("")===0 (no NaN): tratar como inválido
    const n = Number(raw);
    if (!Number.isFinite(n)) return CAT_WIDTH_DEFAULT;
    return clampCatWidth(n);
  } catch {
    return CAT_WIDTH_DEFAULT;
  }
}

/** Persiste el ancho (clampado). Silencioso ante errores de almacenamiento. */
export function writeCatWidth(px: number): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CAT_WIDTH_KEY, String(clampCatWidth(px)));
  } catch {
    /* almacenamiento no disponible: no bloquear la UI */
  }
}
