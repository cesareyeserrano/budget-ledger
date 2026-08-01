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

/**
 * Eleva el suelo de la secuencia. La monotonía de `nextSeq()` era solo INTRA-proceso: `_seq`
 * arrancaba en 0 en cada carga de página, así que el primer movimiento de una sesión nueva nacía
 * con `createdAt: 1` y se ordenaba ANTES que los de la sesión anterior — que es lo que exponía
 * `GET /api/v1/movements` al ordenar por `createdAt` descendente (BG-010). Sembrar el suelo con el
 * máximo ya persistido restaura el orden real entre sesiones sin recurrir a `Date.now()`, que
 * volvería no deterministas los tests de dominio.
 *
 * @param floor Valor mínimo que debe superar la próxima llamada a `nextSeq()`.
 * @throws Nunca — un valor no finito o menor que el actual se ignora.
 */
export function seedSeq(floor: number): void {
  if (Number.isFinite(floor) && floor > _seq) _seq = Math.floor(floor);
}

/**
 * Siembra el suelo a partir de un estado recién cargado de la fuente de verdad. Recorre
 * movimientos Y observaciones de celda: ambos consumen la MISMA secuencia, así que ignorar las
 * observaciones dejaría el suelo bajo y reabriría el bug por la otra puerta.
 *
 * Tipado estructural a propósito: `ids.ts` no importa nada en runtime (existe para que
 * `reserve.ts` comparta la secuencia sin crear un ciclo con `mutations.ts`).
 *
 * @param state Estado cargado; `movements`/`cellNotes` pueden faltar (deltas aditivos).
 * @throws Nunca.
 */
export function seedSeqFrom(state: {
  movements?: readonly { createdAt: number }[];
  cellNotes?: Record<string, Partial<Record<string, readonly { createdAt: number }[]>>>;
}): void {
  let max = 0;
  for (const m of state.movements ?? []) if (m.createdAt > max) max = m.createdAt;
  for (const byMonth of Object.values(state.cellNotes ?? {})) {
    for (const list of Object.values(byMonth ?? {})) {
      for (const n of list ?? []) if (n.createdAt > max) max = n.createdAt;
    }
  }
  seedSeq(max);
}

/** Reinicia la secuencia (solo tests). */
export function __resetSeq(): void {
  _seq = 0;
}
