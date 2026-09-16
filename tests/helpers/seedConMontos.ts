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
import { monthOf } from "@/domain/periods";
import type { AmountMap, LedgerState, Movement, PeriodKey } from "@/domain/types";

/**
 * La semilla de `buildSeed` MÁS los montos deterministas de `genBudget`, anclados al mismo
 * `startPeriod`. Equivale byte a byte a lo que `buildSeed` devolvía antes de FR-2301.
 *
 * No muta la semilla base: compone un objeto nuevo (NFR-2303, TC-SIN-041e).
 */
export function buildSeedConMontos(ownerId: string, startPeriod: PeriodKey): LedgerState {
  const base = buildSeed(ownerId, startPeriod);
  const { budgets, actuals } = genBudget(base.nodes, startPeriod);
  return { ...base, budgets, actuals, movements: movimientosDeRespaldo(base, actuals) };
}

/**
 * Un movimiento por cada celda de Ejecutado de gasto o ingreso que no esté en cero (NFR-2502).
 *
 * Desde la feature `diario-de-celda` el servidor rechaza una celda que no cuadre con la suma de sus
 * movimientos, y esta semilla ponía las cifras sueltas: el PUT de `freshLedger` respondía 422 y se
 * caía la suite e2e ENTERA, antes de la primera aserción. La intención de estas pruebas nunca fue
 * «celdas sin respaldo», sino «un ledger poblado sobre el que operar» — así que se añade el respaldo
 * y no se toca ni una aserción (decisión del usuario, 2026-09-15).
 *
 * Los bolsillos (`transfer`) se quedan fuera a propósito: su celda es el aporte del mes y nunca
 * cuenta como descuadre (NFR-2503).
 */
function movimientosDeRespaldo(base: LedgerState, actuals: AmountMap): Movement[] {
  const movements: Movement[] = [];
  let seq = 0;
  for (const node of base.nodes) {
    if (node.type === "transfer") continue;
    const meses = actuals[node.id];
    if (!meses) continue;
    for (const [period, amount] of Object.entries(meses)) {
      if (!amount) continue;
      movements.push({
        id: `semilla-${++seq}`,
        ownerId: base.ownerId,
        type: node.type,
        catId: node.level === "sub" && node.parentId ? node.parentId : node.id,
        subId: node.level === "sub" ? node.id : null,
        target: node.id,
        amount,
        period: period as PeriodKey,
        createdAt: seq,
        // Día 10: dentro del mes natural y, cuando la cuenta pasa a ciclos, dentro del ciclo que ese
        // mes nombra — así la siembra vale en los dos modos sin tocar las pruebas de `ciclos`.
        date: `${monthOf(period as PeriodKey)}-10T12:00`,
      });
    }
  }
  return movements;
}
