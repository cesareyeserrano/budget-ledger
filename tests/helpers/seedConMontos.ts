// @aitri-trace tests:helper — NFR-2303 (semilla-intacta): restituye la semilla POBLADA que
// `buildSeed` producía antes de FR-2301, componiendo lo que ya existe en el dominio.
//
// Por qué existe: desde FR-2301 la siembra del producto NO trae montos (un usuario nuevo no debe
// ver dinero que no tecleó). Pero muchas pruebas necesitan un ledger con celdas para ejercitar
// cálculo, rollup, rangos o persistencia — y su intención NUNCA fue verificar que la semilla
// traiga dinero, sino tener datos sobre los que operar. Este helper les devuelve exactamente el
// estado que tenían antes, sin tocar una sola de sus aserciones.
//
// `genBudget` sigue exportada por el dominio precisamente para esto (ver src/domain/seed.ts).
import { buildSeed, genBudget } from "@/domain/seed";
import type { LedgerState, PeriodKey } from "@/domain/types";

/**
 * La semilla de `buildSeed` MÁS los montos deterministas de `genBudget`, anclados al mismo
 * `startPeriod`. Equivale byte a byte a lo que `buildSeed` devolvía antes de FR-2301.
 *
 * No muta la semilla base: compone un objeto nuevo (NFR-2303, TC-SIN-041e).
 */
export function buildSeedConMontos(ownerId: string, startPeriod: PeriodKey): LedgerState {
  const base = buildSeed(ownerId, startPeriod);
  const { budgets, actuals } = genBudget(base.nodes, startPeriod);
  return { ...base, budgets, actuals };
}
