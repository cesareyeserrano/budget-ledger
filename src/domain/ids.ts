// @aitri-trace domain:ids — generación de ids y secuencia monotónica compartidas por mutations y reserve.
//
// Módulo:       src/domain/ids.ts
// Propósito:    Un único punto de generación de ids (uid) y de `createdAt` monotónico (nextSeq)
//               para toda mutación que emite movimientos. Extraído de mutations.ts para que
//               reserve.ts (feature transferencias) lo comparta sin crear un ciclo de imports
//               (mutations → reserve para delegar; reserve jamás importa mutations).
// Dependencias: ninguna (globalThis.crypto con degradación).

/**
 * Genera un id único para movimientos/nodos. `crypto.randomUUID()` SOLO existe en secure contexts
 * (HTTPS o localhost); servida por HTTP en una IP de LAN no lo está, y ahí lanzaría (BG-004). Por eso
 * degrada: getRandomValues sí está disponible sobre HTTP, y como último recurso un id no-cripto
 * (suficiente para un app single-user local — la unicidad, no la impredecibilidad, es lo que importa).
 *
 * @returns Un id único (UUID v4 cuando el entorno lo permite).
 * @throws Nunca.
 */
export function uid(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // versión 4
    b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// createdAt monotónico e inyectable (evita Date.now() no determinista en tests).
let _seq = 0;

/**
 * Siguiente valor de la secuencia monotónica de `createdAt`.
 * @returns Entero estrictamente creciente dentro del proceso.
 * @throws Nunca.
 */
export function nextSeq(): number {
  _seq += 1;
  return _seq;
}

/** Reinicia la secuencia (solo tests). */
export function __resetSeq(): void {
  _seq = 0;
}
