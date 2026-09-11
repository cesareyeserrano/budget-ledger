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
// Dependencias: ./types, ./tree, ./ids. (Ya NO depende de un módulo de meses: lleva sus propios
//               literales legados, ver LEGACY_MONTHS.)

import type { AmountMap, LedgerNode, LedgerState, PeriodKey, Movement } from "./types";
/**
 * Los doce literales del modelo ANTERIOR a multi-anio. Viven aquí y solo aquí: este módulo es la
 * capa de compatibilidad que lee datos escritos antes de v6, y esos datos están indexados por mes
 * sin año. FR-1901 excluye explícitamente esta capa del barrido de `MonthKey` por esta razón.
 *
 * NO usar fuera de una migración de formato: el eje vigente es `PeriodKey` ("YYYY-MM").
 */
const LEGACY_MONTHS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
] as const;

/**
 * El año al que pertenecen los datos del modelo viejo. Es una CONSTANTE literal, nunca el año del
 * reloj: los datos anteriores a multi-anio se escribieron contra el único año que la app conocía
 * (v1 declara «single-year 2026»), así que deducir el año de la fecha de ejecución etiquetaría con
 * un año equivocado — y el error sería indetectable después, porque el dato viejo no lleva año con
 * el que comparar.
 */
export const LEGACY_YEAR = 2026;

/** Traduce una clave del modelo viejo ("mar") al periodo actual ("2026-03"). */
function legacyToPeriod(m: string): PeriodKey {
  const i = (LEGACY_MONTHS as readonly string[]).indexOf(m);
  return i < 0 ? m : `${LEGACY_YEAR}-${String(i + 1).padStart(2, "0")}`;
}

/** Reescribe las claves legadas de un mapa de celdas al eje actual; deja intactas las que ya lo son. */
function remapLegacyKeys(
  cells: Partial<Record<PeriodKey, number>>
): Partial<Record<PeriodKey, number>> {
  const out: Partial<Record<PeriodKey, number>> = {};
  for (const [k, v] of Object.entries(cells)) out[legacyToPeriod(k)] = v;
  return out;
}

/** Índice → periodo actual. Las series legadas son posicionales sobre los doce meses. */
function idxToPeriod(i: number): PeriodKey {
  return `${LEGACY_YEAR}-${String(i + 1).padStart(2, "0")}`;
}
import { isLeaf } from "./tree";
import { nextSeq, uid } from "./ids";
import { AVAILABLE_ID, RETIROS_PLAN_ID } from "./reserve";
import { isPeriodKey } from "./periods";

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

/**
 * El eje sobre el que leer un mapa de celdas legado.
 *
 * Un payload v3 puede llegar con claves del modelo VIEJO ("ene") o —si ya pasó una vez por aquí—
 * con periodos del actual ("2026-01"). Se detecta por la forma de las claves en vez de suponer una,
 * que es lo que hacía que una segunda pasada no encontrara nada.
 */
function legacyAxis(cells: Partial<Record<PeriodKey, number>> | undefined): readonly string[] {
  const keys = Object.keys(cells ?? {});
  return keys.some(isPeriodKey)
    ? Array.from({ length: 12 }, (_, i) => idxToPeriod(i))
    : LEGACY_MONTHS;
}

/** Serie resuelta de un mapa de SALDOS v3 (arrastre: ausente = arrastra el último explícito). */
function resolvedV3Series(cells: Partial<Record<PeriodKey, number>> | undefined): number[] {
  const out: number[] = [];
  let carry = 0;
  for (const m of legacyAxis(cells)) {
    carry = cells?.[m] ?? carry;
    out.push(carry);
  }
  return out;
}

/**
 * Convierte el mapa de una hoja de SALDOS v3 a APORTES v4: aporte[m] = max(0, saldo[m] −
 * saldo[m−1]); los deltas negativos se devuelven aparte (retiros del modelo v3).
 */
function balancesToFlows(cells: Partial<Record<PeriodKey, number>> | undefined): {
  flows: Partial<Record<PeriodKey, number>>;
  retiros: Partial<Record<PeriodKey, number>>;
} {
  const series = resolvedV3Series(cells);
  const flows: Partial<Record<PeriodKey, number>> = {};
  const retiros: Partial<Record<PeriodKey, number>> = {};
  let prev = 0;
  for (let i = 0; i < 12; i++) {
    const delta = series[i] - prev;
    if (delta > 0) flows[idxToPeriod(i)] = delta;
    if (delta < 0) retiros[idxToPeriod(i)] = -delta;
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
  const plannedRetiros: Partial<Record<PeriodKey, number>> = {};
  for (const [nodeId, cells] of Object.entries(payload.budgets)) {
    if (!transferIds.has(nodeId)) {
      budgets[nodeId] = remapLegacyKeys(cells);
      continue;
    }
    const { flows, retiros } = balancesToFlows(cells);
    budgets[nodeId] = flows;
    for (const [month, amount] of Object.entries(retiros)) {
      plannedRetiros[month as PeriodKey] = (plannedRetiros[month as PeriodKey] ?? 0) + amount!;
    }
  }
  if (Object.keys(plannedRetiros).length > 0) budgets[RETIROS_PLAN_ID] = plannedRetiros;

  const actuals: AmountMap = {};
  const syntheticMovements: Movement[] = [];
  for (const [nodeId, cells] of Object.entries(payload.actuals)) {
    if (!transferIds.has(nodeId)) {
      actuals[nodeId] = remapLegacyKeys(cells);
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
        period: month as PeriodKey,
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
  month: PeriodKey;
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
    // Acepta el eje ACTUAL ("2026-03") y, por tolerancia, una clave legada sin convertir: este
    // paso corre sobre estados que pueden venir de cualquiera de los dos modelos.
    if (!isPeriodKey(m.period) && !(LEGACY_MONTHS as readonly string[]).includes(m.period)) continue;
    const k = `${m.to} ${m.period}`;
    porCelda.set(k, (porCelda.get(k) ?? 0) + m.amount);
  }
  if (porCelda.size === 0) return { state, residues: [] };

  const actuals: AmountMap = structuredClone(state.actuals);
  const residues: CounterpartyResidue[] = [];
  for (const [k, total] of porCelda) {
    const sep = k.lastIndexOf(" ");
    const leafId = k.slice(0, sep);
    const month = k.slice(sep + 1) as PeriodKey;
    const actual = actuals[leafId]?.[month] ?? 0;
    const restante = actual - total;
    actuals[leafId] = { ...(actuals[leafId] ?? {}) };
    actuals[leafId][month] = Math.max(0, restante);
    if (restante < 0) residues.push({ leafId, month, shortfall: -restante });
  }
  return { state: { ...state, actuals }, residues };
}
