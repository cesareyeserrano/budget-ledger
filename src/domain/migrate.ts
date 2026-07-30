// @aitri-trace domain:migrate — migraciones de datos de celdas transfer entre modelos.
//
// Módulo:       src/domain/migrate.ts
// Propósito:    v4 es el modelo VIGENTE (decisión del usuario 2026-07-29): celdas transfer =
//               APORTES del mes (flujo) y retiros en el journal. Historia de formatos:
//               · v2 — aportes mensuales (el modelo original): v2→v4 es IDENTIDAD de celdas
//                 (solo cambia la marca de versión).
//               · v3 — saldos acumulados con arrastre (modelo intermedio, revertido): v3→v4
//                 deshace el acumulado (delta mes a mes); un delta negativo era un retiro
//                 operado en el modelo v3 y se convierte en un movimiento De→Disponible del
//                 journal — la historia no se pierde, se representa honesta.
//               Idempotencia por MARCA de versión (clave localStorage / columna data_version),
//               nunca por heurística sobre el contenido.
// Dependencias: ./types, ./months, ./tree, ./ids.

import type { AmountMap, LedgerNode, LedgerState, MonthKey, Movement } from "./types";
import { MONTH_KEYS } from "./months";
import { isLeaf } from "./tree";
import { nextSeq, uid } from "./ids";
import { AVAILABLE_ID, RETIROS_PLAN_ID } from "./reserve";

const AVAILABLE = AVAILABLE_ID;

export interface BudgetPayload {
  budgets: AmountMap;
  actuals: AmountMap;
}

export interface MigratedV4 {
  budgets: AmountMap;
  actuals: AmountMap;
  /** Retiros sintetizados desde los deltas negativos de saldos v3 (solo actuals). */
  syntheticMovements: Movement[];
}

/** Serie resuelta de un mapa de SALDOS v3 (arrastre: ausente = arrastra el último explícito). */
function resolvedV3Series(cells: Partial<Record<MonthKey, number>> | undefined): number[] {
  const out: number[] = [];
  let carry = 0;
  for (const m of MONTH_KEYS) {
    carry = cells?.[m] ?? carry;
    out.push(carry);
  }
  return out;
}

/**
 * Convierte el mapa de una hoja de SALDOS v3 a APORTES v4: aporte[m] = max(0, saldo[m] −
 * saldo[m−1]); los deltas negativos se devuelven aparte (retiros del modelo v3).
 */
function balancesToFlows(cells: Partial<Record<MonthKey, number>> | undefined): {
  flows: Partial<Record<MonthKey, number>>;
  retiros: Partial<Record<MonthKey, number>>;
} {
  const series = resolvedV3Series(cells);
  const flows: Partial<Record<MonthKey, number>> = {};
  const retiros: Partial<Record<MonthKey, number>> = {};
  let prev = 0;
  for (let i = 0; i < MONTH_KEYS.length; i++) {
    const delta = series[i] - prev;
    if (delta > 0) flows[MONTH_KEYS[i]] = delta;
    if (delta < 0) retiros[MONTH_KEYS[i]] = -delta;
    prev = series[i];
  }
  return { flows, retiros };
}

/**
 * Migra el payload completo v3→v4: cada hoja transfer pasa de saldos a aportes en AMBOS planos;
 * los deltas negativos del plano Ejecutado se convierten en movimientos de retiro del journal
 * (con nota, para que el usuario los reconozca). expense/income y nodos no-hoja: intactos.
 *
 * @param payload budgets y actuals en formato v3 (saldos).
 * @param nodes La jerarquía del mismo estado (decide qué ids son hojas transfer).
 * @param ownerId Dueño de los movimientos sintetizados.
 * @returns Mapas migrados + retiros sintetizados. No muta la entrada.
 * @throws Nunca.
 */
export function migrateBudgetV3toV4(payload: BudgetPayload, nodes: LedgerNode[], ownerId: string): MigratedV4 {
  const transferLeaves = nodes.filter((n) => n.type === "transfer" && isLeaf(n, nodes));
  const transferIds = new Set(transferLeaves.map((n) => n.id));

  // Plano Pres.: los deltas negativos del plan v3 eran retiros PLANEADOS — se conservan como la
  // fila de retiros del plan (budgets["@retiros"]), no se descartan (hallazgo adversarial 5).
  const budgets: AmountMap = {};
  const plannedRetiros: Partial<Record<MonthKey, number>> = {};
  for (const [nodeId, cells] of Object.entries(payload.budgets)) {
    if (!transferIds.has(nodeId)) {
      budgets[nodeId] = { ...cells };
      continue;
    }
    const { flows, retiros } = balancesToFlows(cells);
    budgets[nodeId] = flows;
    for (const [month, amount] of Object.entries(retiros)) {
      plannedRetiros[month as MonthKey] = (plannedRetiros[month as MonthKey] ?? 0) + amount!;
    }
  }
  if (Object.keys(plannedRetiros).length > 0) budgets[RETIROS_PLAN_ID] = plannedRetiros;

  const actuals: AmountMap = {};
  const syntheticMovements: Movement[] = [];
  for (const [nodeId, cells] of Object.entries(payload.actuals)) {
    if (!transferIds.has(nodeId)) {
      actuals[nodeId] = { ...cells };
      continue;
    }
    const { flows, retiros } = balancesToFlows(cells);
    actuals[nodeId] = flows;
    const node = transferLeaves.find((n) => n.id === nodeId)!;
    const catId = node.level === "sub" ? node.parentId! : nodeId;
    const subId = node.level === "sub" ? nodeId : null;
    for (const [month, amount] of Object.entries(retiros)) {
      syntheticMovements.push({
        id: uid(),
        ownerId,
        type: "transfer",
        catId,
        subId,
        target: nodeId,
        amount: amount!,
        month: month as MonthKey,
        createdAt: nextSeq(),
        from: nodeId,
        to: AVAILABLE,
        note: "Retiro (migrado del modelo de saldos)",
      });
    }
  }

  return { budgets, actuals, syntheticMovements };
}

/**
 * Aplica la migración v3→v4 sobre un estado completo (helper para los dos dueños de datos:
 * repositorio local y servidor). Los movimientos sintetizados se AÑADEN al journal existente.
 */
export function migrateStateV3toV4(state: LedgerState): LedgerState {
  const { budgets, actuals, syntheticMovements } = migrateBudgetV3toV4(
    { budgets: state.budgets, actuals: state.actuals },
    state.nodes,
    state.ownerId
  );
  return { ...state, budgets, actuals, movements: [...syntheticMovements, ...state.movements] };
}
