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

// -- v4 -> v5 - contrapartidas (feature contrapartidas-reserva, FR-1604) ------------------------

/** Residuo de la conversión: la celda no alcanzaba a cubrir el mover que se le resta. */
export interface CounterpartyResidue {
  leafId: string;
  month: MonthKey;
  /** Lo que faltaba para poder restar entero (la celda se acota a 0). */
  shortfall: number;
}

export interface MigratedV5 {
  state: LedgerState;
  residues: CounterpartyResidue[];
}

/**
 * v4 a v5: quita de la celda del destino lo que el modelo v4 le había sumado por cada MOVER.
 *
 * En v4 un mover alcancía a alcancía escribía su llegada en la celda del destino Y se journalizaba.
 * Desde FR-1601 solo se journaliza, y `resolvedSeries` recoge la llegada del journal; si las celdas
 * viejas conservaran esa suma, cada mover ya guardado se contaría DOS veces y los saldos derivados
 * se inflarían. Esta conversión las devuelve a su significado único: lo apartado desde Disponible.
 *
 * **La idempotencia la da el MARCADOR de versión, no la aritmética.** Restar dos veces sería
 * incorrecto — es la misma carga estructural que ya tiene v3 a v4, y por eso el llamador estampa el
 * marcador en la MISMA transacción (ADR-02).
 *
 * Caso patológico ([RISK-1] del diseño): si el usuario editó a la baja la celda del destino DESPUÉS
 * del mover, la resta daría negativo y `amount_cell` declara `CHECK (amount >= 0)`. Se acota a 0 y
 * el faltante se devuelve como residuo para que el desvío quede VISIBLE en el log, en vez de
 * corromper la fila o reventar la restricción.
 *
 * @param state Estado en semántica v4 (no se muta).
 * @returns El estado convertido y los residuos detectados (vacío en el caso normal).
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-1604, US-ID: US-1604, AC-ID: AC-1610, TC-ID: TC-CPR-024h
 */
export function migrateStateV4toV5(state: LedgerState): MigratedV5 {
  const porCelda = new Map<string, number>();
  for (const m of state.movements) {
    if (m.type !== "transfer") continue;
    if (!m.from || !m.to) continue;
    if (m.from === AVAILABLE || m.to === AVAILABLE) continue; // solo los MOVERES escribían celda
    if (!MONTH_KEYS.includes(m.month)) continue;
    const k = `${m.to} ${m.month}`;
    porCelda.set(k, (porCelda.get(k) ?? 0) + m.amount);
  }
  if (porCelda.size === 0) return { state, residues: [] };

  const actuals: AmountMap = structuredClone(state.actuals);
  const residues: CounterpartyResidue[] = [];
  for (const [k, total] of porCelda) {
    const sep = k.lastIndexOf(" ");
    const leafId = k.slice(0, sep);
    const month = k.slice(sep + 1) as MonthKey;
    const actual = actuals[leafId]?.[month] ?? 0;
    const restante = actual - total;
    actuals[leafId] = { ...(actuals[leafId] ?? {}) };
    actuals[leafId][month] = Math.max(0, restante);
    if (restante < 0) residues.push({ leafId, month, shortfall: -restante });
  }
  return { state: { ...state, actuals }, residues };
}
