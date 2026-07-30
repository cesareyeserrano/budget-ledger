// @aitri-trace domain:reserve — feature transferencias (modelo v2 del usuario, 2026-07-29):
// celdas transfer = APORTES DEL MES (flujo, como Ingresos/Gastos); los RETIROS son operaciones
// explícitas del journal (De→A); el saldo por alcancía es DERIVADO: Σ aportes − Σ retiros.
//
// Módulo:       src/domain/reserve.ts
// Propósito:    La capa de dominio de las Reservas. La grilla teclea aportes (editar la celda
//               corrige el aporte del mes — JAMÁS genera retiros implícitos); el registro y la
//               fila «Retiros» operan De→A vía applyReserveOp (journal con from/to). Las reglas:
//               TECHO global por mes (no reservar más que el margen: neto ≤ disponible previo +
//               flujo) y PISO por alcancía (el saldo derivado nunca negativo, en cadena de 12
//               meses). Una regla, todas las puertas. Capa PURA: sin React/DOM/IO.
// Dependencias: ./types, ./months, ./tree, ./rollup, ./validation, ./ids.

import type { AmountMap, CellNote, LedgerState, MonthKey, Movement } from "./types";
import { MONTH_KEYS } from "./months";
import { findNode, isLeaf } from "./tree";
import { typeTotals } from "./rollup";
import { normalizeNote, parseAmount } from "./validation";
import { nextSeq, uid } from "./ids";

/** Los dos planos de la grilla. (balance.ts lo re-exporta; el origen vive aquí para evitar ciclos.) */
export type Plane = "budget" | "actual";

/**
 * Sentinel del extremo "Disponible" en las operaciones De→A (ADR-02). Solo válido en
 * `Movement.from`/`Movement.to` — JAMÁS en `Movement.target`.
 */
export const AVAILABLE_ID = "@disponible";

/** ¿El extremo es el sentinel "Disponible"? Único punto de comparación (evita fugas del literal). */
export function isAvailable(id: string | null | undefined): boolean {
  return id === AVAILABLE_ID;
}

/** Aviso de plan (Pres.) o componente de bloqueo (Ejecutado). */
export interface ReserveWarning {
  rule: "techo" | "piso";
  month: MonthKey;
  leafId?: string;
  /** techo: margen restante del mes; piso: el saldo que tiene (mes editado) o quedaría (cadena). */
  limit: number;
}

/** Veredicto de una escritura de reserva. En Pres. SIEMPRE ok (avisa, no bloquea). */
export type ReserveVerdict =
  | { ok: true; warnings: ReserveWarning[] }
  | { ok: false; rule: "techo" | "piso"; month: MonthKey; leafId?: string; limit: number };

/** Edición de celda transfer (grilla): el valor tecleado es el APORTE nuevo de ese mes. */
export interface ReserveEdit {
  leafId: string;
  month: MonthKey;
  plane: Plane;
  newAmount: number;
}

/** Operación De→A (registro o fila Retiros). Extremos: hoja transfer o sentinel. */
export interface ReserveOp {
  from: string;
  to: string;
  month: MonthKey;
  amount: number;
  date?: string;
  note?: string | null;
}

export type ReserveOpResult =
  | { state: LedgerState; movement: Movement }
  | { rejected: ReserveVerdict | "invalid_target" };

export type ReserveEditResult =
  | { state: LedgerState; warnings: ReserveWarning[]; noop: boolean }
  | { rejected: ReserveVerdict | "invalid_target" };

// ── Derivaciones (saldo por alcancía, aportes/retiros del mes) ─────────────────────────────────

// Contadores de instrumentación de NFR (perf): cómputos de series y llamadas a validación.
let seriesComputes = 0;
let validateCalls = 0;

/** Lectura de los contadores de perf (solo tests). */
export function __reservePerfCounters(): { seriesComputes: number; validateCalls: number } {
  return { seriesComputes, validateCalls };
}

/** Reinicio de los contadores de perf (solo tests). */
export function __resetReservePerfCounters(): void {
  seriesComputes = 0;
  validateCalls = 0;
}

/** Ids de las HOJAS transfer (las alcancías). */
export function reserveLeafIds(state: LedgerState): string[] {
  return state.nodes.filter((n) => n.type === "transfer" && isLeaf(n, state.nodes)).map((n) => n.id);
}

// Memoización por IDENTIDAD (WeakMap): cada mutación clona `budgets`/`actuals`/`movements`, así
// que un par (mapa, journal) dado es inmutable de facto y sus series se computan una sola vez.
const seriesMemo = new WeakMap<AmountMap, WeakMap<Movement[], Map<string, readonly number[]>>>();

/** Σ retiros del journal de una hoja, por mes (movimientos transfer con from = la hoja). */
function retirosByMonth(movements: Movement[], leafId: string): number[] {
  const out = new Array<number>(12).fill(0);
  for (const m of movements) {
    if (m.type === "transfer" && m.from === leafId) {
      const idx = MONTH_KEYS.indexOf(m.month);
      if (idx >= 0) out[idx] += m.amount;
    }
  }
  return out;
}

/**
 * Serie DERIVADA del saldo de una alcancía: saldo[m] = Σ aportes(celdas)[1..m] − Σ retiros
 * (journal)[1..m]. En Pres. no hay retiros (no se planean en v1): la trayectoria del plan es el
 * acumulado de los aportes planeados.
 *
 * @param state Estado del ledger (no se muta).
 * @param leafId Hoja transfer (una hoja desconocida deriva [0×12]).
 * @param plane Plano a leer.
 * @returns Serie readonly de 12 saldos derivados. Referencia estable para el mismo estado.
 * @throws Nunca.
 */
export function resolvedSeries(state: LedgerState, leafId: string, plane: Plane): readonly number[] {
  const map = plane === "budget" ? state.budgets : state.actuals;
  let byJournal = seriesMemo.get(map);
  if (!byJournal) {
    byJournal = new WeakMap();
    seriesMemo.set(map, byJournal);
  }
  let byLeaf = byJournal.get(state.movements);
  if (!byLeaf) {
    byLeaf = new Map();
    byJournal.set(state.movements, byLeaf);
  }
  const key = `${plane}:${leafId}`;
  let series = byLeaf.get(key);
  if (!series) {
    seriesComputes += 1;
    const cells = map[leafId];
    const retiros = plane === "actual" ? retirosByMonth(state.movements, leafId) : null;
    const out: number[] = [];
    let running = 0;
    for (let i = 0; i < MONTH_KEYS.length; i++) {
      running += cells?.[MONTH_KEYS[i]] ?? 0;
      if (retiros) running -= retiros[i];
      out.push(running);
    }
    series = out;
    byLeaf.set(key, series);
  }
  return series;
}

/**
 * Saldo DERIVADO de una alcancía en un mes: cuánto HAY acumulado (aportes − retiros hasta m).
 * Es la cifra que el registro muestra al operar y la que el piso protege — NO se almacena ni se
 * muestra celda a celda: la celda dice el aporte del mes (decisión del usuario, 2026-07-29).
 *
 * @aitri-trace FR-ID: FR-1001, US-ID: US-1001, AC-ID: AC-1001, TC-ID: TC-TRF-101h
 */
export function resolvedBalance(state: LedgerState, leafId: string, month: MonthKey, plane: Plane): number {
  return resolvedSeries(state, leafId, plane)[MONTH_KEYS.indexOf(month)] ?? 0;
}

/** Σ de saldos derivados del tipo en un mes (el "Saldo reservado" que el Balance acumula). */
export function resolvedTypeTotal(state: LedgerState, month: MonthKey, plane: Plane): number {
  return reserveLeafIds(state).reduce((sum, id) => sum + resolvedBalance(state, id, month, plane), 0);
}

/**
 * Aportes del mes = Σ de las CELDAS transfer del mes (lo tecleado en la grilla + lo guardado por
 * el registro, que también escribe la celda). La fila «− Reservas del mes» del Balance.
 *
 * @aitri-trace FR-ID: FR-1009, US-ID: US-1009, AC-ID: AC-1009, TC-ID: TC-TRF-109h
 */
export function reserveAportes(state: LedgerState, month: MonthKey, plane: Plane): number {
  return typeTotals(state, "transfer", [month])[plane];
}

/**
 * Clave sentinel del PLAN de retiros (observación del usuario 2026-07-29: los retiros también se
 * presupuestan). Vive como fila propia del mapa `budgets` — no es un nodo del árbol, así que los
 * roll-ups por nodos jamás la cuentan; persiste igual que cualquier celda (almacén local y BD).
 */
export const RETIROS_PLAN_ID = "@retiros";

/**
 * Retiros del mes. Ejecutado: Σ de las operaciones del journal que SACAN de una alcancía ese mes
 * (from = hoja real). Presupuestado: el retiro PLANEADO del mes (fila Retiros · Pres.).
 * La fila «+ Retiros del mes» del Balance.
 *
 * @aitri-trace FR-ID: FR-1009, US-ID: US-1009, AC-ID: AC-1009b, TC-ID: TC-TRF-109e
 */
export function reserveRetiros(state: LedgerState, month: MonthKey, plane: Plane): number {
  if (plane === "budget") return state.budgets[RETIROS_PLAN_ID]?.[month] ?? 0;
  return state.movements.reduce(
    (sum, m) => (m.type === "transfer" && m.month === month && m.from && !isAvailable(m.from) ? sum + m.amount : sum),
    0
  );
}

/**
 * Cuánto hay disponible PARA RETIRAR en el plan de un mes: los aportes planeados acumulados hasta
 * ese mes, menos los retiros planeados de los meses ANTERIORES. Es el techo lógico del retiro
 * presupuestado (observación del usuario 2026-07-29: no tiene sentido planear sacar más de lo que
 * el propio plan habrá reservado).
 *
 * @throws Nunca.
 */
export function plannedRetiroLimit(state: LedgerState, month: MonthKey): number {
  const idx = MONTH_KEYS.indexOf(month);
  let acc = 0;
  for (let i = 0; i <= idx; i++) {
    acc += reserveAportes(state, MONTH_KEYS[i], "budget");
    if (i < idx) acc -= reserveRetiros(state, MONTH_KEYS[i], "budget");
  }
  return Math.max(0, acc);
}

/**
 * Escribe el retiro PLANEADO de un mes (fila Retiros del mes · Pres.). A diferencia del resto del
 * plan (que avisa sin bloquear), aquí SÍ se rechaza superar lo reservado planeado: planear un
 * retiro imposible no es información, es un error de tecleo.
 *
 * @returns `{state}` o `{rejected: {limit}}` con lo retirable del plan de ese mes.
 * @throws Nunca.
 */
export function setPlannedRetiro(
  state: LedgerState,
  month: MonthKey,
  value: number
): { state: LedgerState } | { rejected: { limit: number } } {
  const v = Math.round(Number(value));
  if (!Number.isFinite(v) || v < 0 || !MONTH_KEYS.includes(month)) return { state };
  const limit = plannedRetiroLimit(state, month);
  if (v > limit) return { rejected: { limit } };
  const next = cloneState(state);
  next.budgets[RETIROS_PLAN_ID] = { ...(next.budgets[RETIROS_PLAN_ID] ?? {}) };
  next.budgets[RETIROS_PLAN_ID][month] = v;
  return { state: next };
}

/**
 * Elimina un RETIRO del journal (corrección de un error del usuario). Solo aplica a retiros puros
 * (from = alcancía, to = Disponible): como el retiro nunca tocó celdas, quitar el movimiento
 * restaura el saldo derivado por construcción — no hay nada más que revertir. Siempre permitido:
 * el estado resultante es exactamente el previo al error.
 *
 * @returns El estado sin el movimiento, o el MISMO estado si el id no es un retiro eliminable.
 * @throws Nunca.
 */
export function removeReserveRetiro(state: LedgerState, movementId: string): LedgerState {
  const mv = state.movements.find((m) => m.id === movementId);
  if (!mv || mv.type !== "transfer" || !mv.from || isAvailable(mv.from) || !isAvailable(mv.to)) return state;
  const next = cloneState(state);
  next.movements = next.movements.filter((m) => m.id !== movementId);
  return next;
}

/** Movimiento neto de reservas del mes = aportes − retiros. Puede ser negativo (retiro neto). */
export function reserveDelta(state: LedgerState, month: MonthKey, plane: Plane): number {
  return reserveAportes(state, month, plane) - reserveRetiros(state, month, plane);
}

/**
 * Margen del mes para GUARDAR (el techo): max(0, disponible previo + flujo del mes), calculado
 * hacia adelante con la cadena ejecutada real (ADR-03). El registro lo muestra ANTES de operar.
 */
export function availableMargin(state: LedgerState, month: MonthKey): number {
  const scan = techoScan(state, "actual");
  return scan.margin[MONTH_KEYS.indexOf(month)] ?? 0;
}

// ── Validación en cadena (techo global / piso por alcancía) ────────────────────────────────────

interface CellWrite {
  leafId: string;
  month: MonthKey;
  value: number;
}

/** Candidato: escrituras de celda aplicadas y/o un movimiento provisional añadido. */
function buildCandidate(state: LedgerState, plane: Plane, writes: CellWrite[], extraMovement?: Movement): LedgerState {
  const map = plane === "budget" ? structuredClone(state.budgets) : state.budgets;
  const actuals = plane === "actual" ? structuredClone(state.actuals) : state.actuals;
  const target = plane === "budget" ? map : actuals;
  for (const w of writes) {
    target[w.leafId] = { ...(target[w.leafId] ?? {}) };
    target[w.leafId][w.month] = w.value;
  }
  return {
    ownerId: state.ownerId,
    nodes: state.nodes,
    budgets: plane === "budget" ? map : state.budgets,
    actuals,
    movements: extraMovement ? [extraMovement, ...state.movements] : state.movements,
  };
}

/** Serie de excesos de techo y márgenes por mes de un estado, en un plano. */
function techoScan(state: LedgerState, plane: Plane): { excess: number[]; margin: number[]; delta: number[] } {
  const excess: number[] = [];
  const margin: number[] = [];
  const delta: number[] = [];
  let availActual = 0;
  for (let i = 0; i < MONTH_KEYS.length; i++) {
    const m = MONTH_KEYS[i];
    const income = typeTotals(state, "income", [m]);
    const expense = typeTotals(state, "expense", [m]);
    const flowActual = income.actual - expense.actual;
    const deltaActual = reserveDelta(state, m, "actual");
    if (plane === "actual") {
      const mar = Math.max(0, availActual + flowActual);
      margin.push(mar);
      delta.push(deltaActual);
      excess.push(Math.max(0, deltaActual - mar));
    } else {
      const flowBudget = income.budget - expense.budget;
      const deltaBudget = reserveDelta(state, m, "budget");
      const mar = Math.max(0, availActual + flowBudget);
      margin.push(mar);
      delta.push(deltaBudget);
      excess.push(Math.max(0, deltaBudget - mar));
    }
    // Solo la cadena ejecutada acumula (ADR-03): ambos planos abren en el cierre real previo.
    availActual = availActual + flowActual - deltaActual;
  }
  return { excess, margin, delta };
}

interface ChainResult {
  blocking: ReserveWarning | null;
  warnings: ReserveWarning[];
}

/**
 * Corre techo global + piso por alcancía sobre los 12 meses del estado candidato.
 *
 * Techo: neto del mes (aportes − retiros) ≤ max(0, disponiblePrevio + flujo). Bloquea (o avisa,
 * en Pres.) solo donde el candidato EMPEORA al base — los datos históricos pueden violar el techo
 * legítimamente y no deben bloquear ediciones ajenas.
 *
 * Piso: el saldo DERIVADO de cada alcancía afectada queda ≥ 0 en los 12 meses del candidato —
 * bajar un aporte de febrero que deja en rojo los retiros ya operados de octubre se bloquea
 * nombrando a octubre («Viaje quedaría en −50.000»).
 */
function chainCheck(base: LedgerState, cand: LedgerState, plane: Plane, affectedLeaves: string[]): ChainResult {
  const violations: ReserveWarning[] = [];

  // Piso por alcancía afectada, en cadena (solo Ejecutado: el plan no tiene retiros que romper).
  if (plane === "actual") {
    for (const leafId of affectedLeaves) {
      const series = resolvedSeries(cand, leafId, "actual");
      for (let i = 0; i < MONTH_KEYS.length; i++) {
        if (series[i] < 0) {
          violations.push({ rule: "piso", month: MONTH_KEYS[i], leafId, limit: series[i] });
          break; // el primer mes ofensor de esta hoja
        }
      }
    }
  }

  // Techo global por mes, candidato vs base (bloquea solo lo que la escritura EMPEORA).
  const baseScan = techoScan(base, plane);
  const candScan = techoScan(cand, plane);
  for (let i = 0; i < MONTH_KEYS.length; i++) {
    if (candScan.excess[i] > baseScan.excess[i]) {
      violations.push({
        rule: "techo",
        month: MONTH_KEYS[i],
        limit: Math.max(0, candScan.margin[i] - baseScan.delta[i]),
      });
    }
  }

  violations.sort((a, b) => MONTH_KEYS.indexOf(a.month) - MONTH_KEYS.indexOf(b.month));

  if (plane === "budget") {
    // Pres. AVISA sin bloquear; además marca TODO mes del plan que excede su techo.
    for (let i = 0; i < MONTH_KEYS.length; i++) {
      if (candScan.excess[i] > 0 && !violations.some((v) => v.rule === "techo" && v.month === MONTH_KEYS[i])) {
        violations.push({ rule: "techo", month: MONTH_KEYS[i], limit: candScan.margin[i] });
      }
    }
    return { blocking: null, warnings: violations };
  }
  return { blocking: violations[0] ?? null, warnings: [] };
}

/**
 * Valida la edición de una celda transfer (el APORTE del mes) SIN aplicarla: techo global en
 * cadena y piso derivado de la alcancía (bajar un aporte no puede dejar en rojo retiros ya
 * operados). En Ejecutado un bloqueo devuelve ok:false; en Pres. SIEMPRE ok con warnings.
 * La grilla y el registro consultan las mismas reglas — una regla, todas las puertas.
 *
 * @throws Nunca. Valor inválido (negativo/no numérico) devuelve ok:false tipado.
 */
export function validateReserveWrite(state: LedgerState, edit: ReserveEdit): ReserveVerdict {
  validateCalls += 1;
  const value = Math.round(Number(edit.newAmount));
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, rule: "piso", month: edit.month, leafId: edit.leafId, limit: 0 };
  }
  const cand = buildCandidate(state, edit.plane, [{ leafId: edit.leafId, month: edit.month, value }]);
  const chain = chainCheck(state, cand, edit.plane, [edit.leafId]);
  if (chain.blocking) {
    const b = chain.blocking;
    return { ok: false, rule: b.rule, month: b.month, leafId: b.leafId, limit: b.limit };
  }
  return { ok: true, warnings: chain.warnings };
}

// ── Operación De→A (registro y fila Retiros) ───────────────────────────────────────────────────

/** Clon del estado con mapas nuevos (misma técnica que mutations.clone; local para evitar ciclos). */
function cloneState(state: LedgerState): LedgerState {
  return {
    ownerId: state.ownerId,
    nodes: state.nodes.map((n) => ({ ...n })),
    budgets: structuredClone(state.budgets),
    actuals: structuredClone(state.actuals),
    movements: state.movements.map((m) => ({ ...m })),
    ...(state.cellNotes ? { cellNotes: structuredClone(state.cellNotes) } : {}),
  };
}

/** ¿El id es una alcancía operable (hoja transfer existente)? */
function isReserveLeaf(state: LedgerState, id: string): boolean {
  const node = findNode(state.nodes, id);
  return !!node && node.type === "transfer" && isLeaf(node, state.nodes);
}

/**
 * Operación de reserva De→A: guardar (Disponible→alcancía: escribe el aporte en la CELDA del mes
 * y journaliza), sacar (alcancía→Disponible: SOLO journal — la celda no se toca, el saldo
 * derivado baja) o mover (alcancía→alcancía: aporte en la celda destino + journal con ambos
 * extremos). Valida techo global + piso derivado en cadena. `target` = la alcancía afectada
 * (retiro: from; aporte y mover: to); el sentinel jamás va en target.
 *
 * @param state Estado base. NO se muta bajo ningún camino.
 * @param op La operación: extremos, mes, monto entero ≥1, fecha/nota opcionales.
 * @returns `{state, movement}` o `{rejected}` tipado sin efectos.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-1004, US-ID: US-1004, AC-ID: AC-1004, TC-ID: TC-TRF-104h, TC-TRF-104f
 */
export function applyReserveOp(state: LedgerState, op: ReserveOp): ReserveOpResult {
  const amount = parseAmount(op.amount);
  if (amount === null) return { rejected: "invalid_target" };
  if (!op.from || !op.to || op.from === op.to) return { rejected: "invalid_target" };
  const fromIsAvailable = isAvailable(op.from);
  const toIsAvailable = isAvailable(op.to);
  if (fromIsAvailable && toIsAvailable) return { rejected: "invalid_target" };
  if (!fromIsAvailable && !isReserveLeaf(state, op.from)) return { rejected: "invalid_target" };
  if (!toIsAvailable && !isReserveLeaf(state, op.to)) return { rejected: "invalid_target" };
  if (!MONTH_KEYS.includes(op.month)) return { rejected: "invalid_target" };

  // target = la alcancía afectada: retiro → from; aporte y mover → to.
  const targetId = toIsAvailable ? op.from : op.to;
  const targetNode = findNode(state.nodes, targetId)!;
  const catId = targetNode.level === "sub" ? targetNode.parentId! : targetId;
  const subId = targetNode.level === "sub" ? targetId : null;

  const movement: Movement = {
    id: uid(),
    ownerId: state.ownerId,
    type: "transfer",
    catId,
    subId,
    target: targetId,
    amount,
    month: op.month,
    createdAt: nextSeq(),
    from: op.from,
    to: op.to,
    ...(op.date ? { date: op.date } : {}),
    ...(op.note !== undefined ? { note: normalizeNote(op.note) } : {}),
  };

  // Candidato: el aporte del destino se escribe en su celda; el retiro entra por el journal.
  const writes: CellWrite[] = [];
  if (!toIsAvailable) {
    const current = state.actuals[op.to]?.[op.month] ?? 0;
    writes.push({ leafId: op.to, month: op.month, value: current + amount });
  }
  const cand = buildCandidate(state, "actual", writes, fromIsAvailable ? undefined : movement);
  const affected = [op.from, op.to].filter((id) => !isAvailable(id));
  const chain = chainCheck(state, cand, "actual", affected);
  if (chain.blocking) {
    const b = chain.blocking;
    // Piso del mes de la operación: el límite útil es el saldo que la alcancía TIENE (H9).
    if (b.rule === "piso" && b.month === op.month && b.leafId && !fromIsAvailable) {
      return { rejected: { ok: false, rule: "piso", month: op.month, leafId: b.leafId, limit: resolvedBalance(state, b.leafId, op.month, "actual") } };
    }
    return { rejected: { ok: false, rule: b.rule, month: b.month, leafId: b.leafId, limit: b.limit } };
  }

  const next = cloneState(state);
  for (const w of writes) {
    next.actuals[w.leafId] = { ...(next.actuals[w.leafId] ?? {}) };
    next.actuals[w.leafId][w.month] = w.value;
  }
  next.movements.unshift(movement);
  return { state: next, movement };
}

/**
 * Edición de celda transfer desde la grilla: corrige el APORTE de ese mes (jamás genera retiros
 * ni journal — el journal es de operaciones explícitas). Valor igual = no-op. En Pres. escribe
 * siempre (el plan avisa); en Ejecutado bloquea si rompe techo o deja en rojo retiros operados.
 *
 * @throws Nunca.
 */
export function applyReserveCellEdit(state: LedgerState, edit: ReserveEdit): ReserveEditResult {
  if (!isReserveLeaf(state, edit.leafId)) return { rejected: "invalid_target" };
  const value = Math.round(Number(edit.newAmount));
  if (!Number.isFinite(value) || value < 0) return { rejected: "invalid_target" };
  const map = edit.plane === "budget" ? state.budgets : state.actuals;
  const current = map[edit.leafId]?.[edit.month] ?? 0;
  if (value === current) {
    return { state, warnings: [], noop: true };
  }

  const verdict = validateReserveWrite(state, edit);
  if (!verdict.ok) return { rejected: verdict };

  const next = cloneState(state);
  const target = edit.plane === "budget" ? next.budgets : next.actuals;
  target[edit.leafId] = { ...(target[edit.leafId] ?? {}) };
  target[edit.leafId][edit.month] = value;
  return { state: next, warnings: verdict.warnings, noop: false };
}

/** Rótulo de un extremo De→A para mensajes y journal ("Disponible" o el nombre del nodo). */
export function labelOfEnd(state: LedgerState, id: string | null | undefined): string {
  if (isAvailable(id)) return "Disponible";
  if (!id) return "";
  return findNode(state.nodes, id)?.name ?? id;
}

// ── Observaciones por celda ────────────────────────────────────────────────────────────────────

/** Observación legible desde una celda: manual (cellNotes) o derivada (nota de una operación De→A). */
export interface CellObservation {
  createdAt: number;
  text: string;
  source: "manual" | "movement";
}

/**
 * Las observaciones de una celda transfer en un mes: las notas de las operaciones De→A que tocan
 * la hoja en ese mes + las manuales, por antigüedad.
 *
 * @throws Nunca. Movimientos sin from/to o sin nota simplemente no aportan.
 */
export function cellObservations(state: LedgerState, leafId: string, month: MonthKey): CellObservation[] {
  const derived: CellObservation[] = state.movements
    .filter((m) => m.type === "transfer" && m.month === month && m.note && (m.from === leafId || m.to === leafId))
    .map((m) => ({ createdAt: m.createdAt, text: m.note!, source: "movement" as const }));
  const manual: CellObservation[] = (state.cellNotes?.[leafId]?.[month] ?? []).map((n) => ({
    createdAt: n.createdAt,
    text: n.text,
    source: "manual" as const,
  }));
  return [...derived, ...manual].sort((a, b) => a.createdAt - b.createdAt);
}

/** Longitud máxima de una observación manual (misma disciplina que la nota de movimiento). */
export const CELL_NOTE_MAX = 280;

/**
 * Añade una observación MANUAL a una celda. Rechaza texto vacío o de más de 280 caracteres SIN
 * truncar — el exceso es un error del input, no algo que se recorta en silencio.
 *
 * @throws Nunca.
 */
export function addCellNote(
  state: LedgerState,
  leafId: string,
  month: MonthKey,
  text: string
): { state: LedgerState } | { rejected: "invalid_note" | "invalid_target" } {
  if (!isReserveLeaf(state, leafId) || !MONTH_KEYS.includes(month)) return { rejected: "invalid_target" };
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > CELL_NOTE_MAX) return { rejected: "invalid_note" };
  const next = cloneState(state);
  const note: CellNote = { id: uid(), createdAt: nextSeq(), text: trimmed };
  const byLeaf = { ...(next.cellNotes ?? {}) };
  const byMonth = { ...(byLeaf[leafId] ?? {}) };
  byMonth[month] = [...(byMonth[month] ?? []), note];
  byLeaf[leafId] = byMonth;
  next.cellNotes = byLeaf;
  return { state: next };
}

// ── Avisos del plan ────────────────────────────────────────────────────────────────────────────

/**
 * Meses del plano Pres. cuya suma de aportes planeados supera su techo: mes → margen del plan.
 * Estado del PLAN (no de una edición): la grilla marca con «!» + ámbar las celdas Pres. de hojas
 * que aportan en esos meses. Avisar, jamás bloquear.
 */
export function planTechoMonths(state: LedgerState): Partial<Record<MonthKey, number>> {
  const scan = techoScan(state, "budget");
  const out: Partial<Record<MonthKey, number>> = {};
  for (let i = 0; i < MONTH_KEYS.length; i++) {
    if (scan.excess[i] > 0) out[MONTH_KEYS[i]] = scan.margin[i];
  }
  return out;
}
