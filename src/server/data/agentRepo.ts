/**
 * Module: server/data/agentRepo
 * Purpose: Las operaciones de la puerta para agentes sobre el libro (feature tony-ledger). No trae
 *   reglas propias: cada una carga el estado del dueño y llama a las MISMAS funciones del dominio y
 *   del repositorio que usa la app, para que el agente y la pantalla no puedan dar dos respuestas
 *   distintas a la misma pregunta.
 * Dependencies: ./ledgerRepo, @/domain
 */
import "server-only";
import {
  calendarOf, insertMovementWith, loadLedger, serverScope, writeMovementWith,
  type InsertMovementResult, type InsertPlan, type MovementWriteResult,
} from "./ledgerRepo";
import { deleteMovement, editMovement, type MovementPatch } from "@/domain/adjust";
import { findNode, isLeaf, subtreeIds } from "@/domain/tree";
import { rollupTable, typeTotals } from "@/domain/rollup";
import { balanceAt, computeBalanceSeries } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { isAvailable, reserveLeafIds, resolvedBalance, undoReserveOp } from "@/domain/reserve";
import { isClosed } from "@/domain/closure";
import { isPeriodKey, monthOf } from "@/domain/periods";
import { PERIOD_KEY, isCalendarDay } from "@/domain/validation";
import type { Calendar } from "@/domain/cycles";
import type { LedgerNode, LedgerState, Movement, NodeLevel, NodeType, PeriodKey, PeriodMode } from "@/domain";
import type { AgentMovementInput, AgentPatchInput } from "../agent/schemas";
import { REF_KEY_PREFIX } from "../agent/schemas";

/** Un nodo del árbol tal como lo ve el agente. */
export interface AgentNode {
  id: string;
  name: string;
  type: NodeType;
  level: NodeLevel;
  parentId: string | null;
  /** true si se puede registrar sobre él (misma regla que la app). */
  leaf: boolean;
}

/**
 * El árbol vigente de la cuenta: tipos, grupos, categorías, subcategorías y bolsillos (FR-3407).
 * El agente clasifica contra esto; no tiene catálogo propio y no puede cambiarlo.
 * @param ownerId la cuenta del token
 * @returns el árbol y la revisión del libro, o null si la cuenta aún no guardó su libro
 * @throws si la base no responde
 * @aitri-trace FR-ID: FR-3407, US-ID: US-3407, AC-ID: AC-3407a, TC-ID: TC-AGT-070h, TC-AGT-073f, TC-AGT-074e
 */
export async function agentTree(ownerId: string): Promise<{ revision: number; nodes: AgentNode[] } | null> {
  const loaded = await loadLedger(ownerId);
  if (!loaded) return null;
  const { nodes } = loaded.state;
  return {
    revision: loaded.revision,
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      level: n.level,
      parentId: n.parentId,
      leaf: isLeaf(n, nodes),
    })),
  };
}

/** Un movimiento tal como lo ve el agente: manual o suyo, con el nombre de su hoja. */
export interface AgentMovement {
  id: string;
  type: NodeType;
  /** La hoja afectada (gasto, ingreso o bolsillo). */
  target: string;
  targetName: string;
  amount: number;
  period: PeriodKey;
  date: string | null;
  note: string | null;
  /** Extremos De→A de una operación de bolsillo; null en gasto e ingreso. */
  from: string | null;
  to: string | null;
  /** Referencia de origen y quién lo registró; null en un movimiento registrado a mano. */
  ref: string | null;
  agent: { id: string; name: string } | null;
}

/** Un periodo del calendario de la cuenta, con su rango de fechas y si está cerrado. */
export interface AgentPeriod {
  period: PeriodKey;
  mode: PeriodMode;
  start: string;
  end: string;
  closed: boolean;
}

/** Presupuestado, ejecutado y restante de un nodo en un periodo. */
export interface AgentSummaryNode {
  id: string;
  name: string;
  type: NodeType;
  level: NodeLevel;
  parentId: string | null;
  budget: number;
  actual: number;
  remaining: number;
}

/** El resumen de un periodo, con las mismas cifras que la pantalla (FR-3415). */
export interface AgentSummary extends AgentPeriod {
  revision: number;
  nodes: AgentSummaryNode[];
  totals: {
    income: { budget: number; actual: number };
    expense: { budget: number; actual: number; remaining: number };
  };
  /** Plano Ejecutado del Balance en el periodo: lo gastable y lo reservado acumulado. */
  balance: { available: number; reserved: number };
  /** Por bolsillo: lo aportado en el periodo (la celda) y el saldo derivado acumulado. */
  pockets: { id: string; name: string; contributed: number; balance: number }[];
}

/** Motivos por los que una lectura no se puede atender. El borde los traduce a su código HTTP. */
export type AgentReadError = "no_ledger" | "invalid_period" | "invalid_date" | "not_found";

const DIAS_DEL_MES_BASE = 1;

/**
 * Traduce un movimiento del dominio a la forma del agente.
 * @param m el movimiento
 * @param nodes los nodos de la cuenta, para resolver el nombre de la hoja
 * @returns el movimiento con `targetName`, `ref` y `agent`
 */
export function toAgentMovement(m: Movement, nodes: LedgerNode[]): AgentMovement {
  return {
    id: m.id,
    type: m.type,
    target: m.target,
    targetName: findNode(nodes, m.target)?.name ?? "",
    amount: m.amount,
    period: m.period,
    date: m.date ?? null,
    note: m.note ?? null,
    from: m.from ?? null,
    to: m.to ?? null,
    ref: m.origin?.ref ?? null,
    agent: m.origin ? { id: m.origin.agentId, name: m.origin.agentName } : null,
  };
}

/**
 * Primer y último día de un mes calendario. Lo usa el modo mes, donde el calendario no guarda
 * rangos (`rangeOf` devuelve null).
 * @param period clave `YYYY-MM`
 * @returns `{ start, end }` en ISO
 * @aitri-trace FR-ID: FR-3417, US-ID: US-3417, AC-ID: AC-3417a, TC-ID: TC-AGT-174h
 */
export function monthRange(period: PeriodKey): { start: string; end: string } {
  const mes = monthOf(period);
  const [y, m] = mes.split("-").map(Number);
  // Día 0 del mes siguiente = último día de este: resuelve 28, 29, 30 y 31 sin tabla.
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dd = (n: number) => String(n).padStart(2, "0");
  return { start: `${mes}-${dd(DIAS_DEL_MES_BASE)}`, end: `${mes}-${dd(ultimo)}` };
}

/**
 * Describe un periodo con el calendario de la cuenta: modo, rango de fechas y si está cerrado.
 * @param state estado cargado (con su cierre)
 * @param cal calendario de la cuenta
 * @param period la clave a describir
 * @returns el periodo descrito
 */
export function describePeriod(state: LedgerState, cal: Calendar, period: PeriodKey): AgentPeriod {
  const rango = cal.rangeOf(period) ?? monthRange(period);
  return { period, mode: cal.mode, start: rango.start, end: rango.end, closed: isClosed(state.closure, period) };
}

/**
 * El periodo que el calendario de la cuenta asigna a una fecha (FR-3417). Es la misma función que
 * usa el registro manual para derivar el periodo de un movimiento, así que el agente no lleva el
 * ciclo por su cuenta.
 * @param ownerId la cuenta del token
 * @param date día `YYYY-MM-DD`
 * @returns el periodo, o el motivo: sin libro, o fecha inexistente / fuera del calendario
 * @throws si la base no responde
 * @aitri-trace FR-ID: FR-3417, US-ID: US-3417, AC-ID: AC-3417a, TC-ID: TC-AGT-170h, TC-AGT-171e, TC-AGT-172f, TC-AGT-173e
 */
export async function agentPeriodOf(ownerId: string, date: string | null): Promise<AgentPeriod | AgentReadError> {
  if (!isCalendarDay(date)) return "invalid_date";
  const loaded = await loadLedger(ownerId);
  if (!loaded) return "no_ledger";
  const period = periodOfDate(loaded.state, date);
  if (!period) return "invalid_date";
  return describePeriod(loaded.state, calendarOf(loaded.state, period), period);
}

/** El periodo de una fecha, o null si el calendario de la cuenta no la contiene. */
function periodOfDate(state: LedgerState, date: string): PeriodKey | null {
  try {
    // La fecha amplía las cotas del calendario: un día posterior al último dato sigue teniendo periodo.
    const period = calendarOf(state, date.slice(0, 7) as PeriodKey).periodForDate(date);
    // Y el periodo tiene que ser uno que el resto del sistema acepte (año dentro del rango válido).
    return PERIOD_KEY.safeParse(period).success ? period : null;
  } catch {
    return null;
  }
}

/** Resuelve el periodo pedido, o el vigente si no se pidió ninguno. */
function resolvePeriod(state: LedgerState, raw: string | null, today: string): PeriodKey | "invalid_period" {
  if (raw === null) return periodOfDate(state, today) ?? "invalid_period";
  return isPeriodKey(raw) ? raw : "invalid_period";
}

/**
 * Los movimientos de un periodo —manuales y de agente—, opcionalmente solo los de un subárbol
 * (FR-3416). Sirve para contestar «en qué se fue» y para ubicar lo registrado antes de corregirlo.
 * @param ownerId la cuenta del token
 * @param rawPeriod periodo pedido, o null para el vigente
 * @param nodeId nodo cuyo subárbol filtra la lista, o null
 * @param today «hoy» del servidor, para el periodo vigente
 * @returns la lista con su periodo, o el motivo del rechazo
 * @throws si la base no responde
 * @aitri-trace FR-ID: FR-3416, US-ID: US-3416, AC-ID: AC-3416a, TC-ID: TC-AGT-160h, TC-AGT-163e, TC-AGT-164e, TC-AGT-165f
 */
export async function agentMovements(
  ownerId: string, rawPeriod: string | null, nodeId: string | null, today: string
): Promise<{ period: PeriodKey; movements: AgentMovement[] } | AgentReadError> {
  const loaded = await loadLedger(ownerId);
  if (!loaded) return "no_ledger";
  const { state } = loaded;
  const period = resolvePeriod(state, rawPeriod, today);
  if (period === "invalid_period") return "invalid_period";

  let delSubarbol: Set<string> | null = null;
  if (nodeId !== null) {
    if (!findNode(state.nodes, nodeId)) return "not_found";
    delSubarbol = new Set(subtreeIds(state.nodes, nodeId));
  }
  const movements = state.movements
    .filter((m) => m.period === period && (delSubarbol === null || delSubarbol.has(m.target)))
    .map((m) => toAgentMovement(m, state.nodes));
  return { period, movements };
}

/**
 * El movimiento que lleva una referencia de origen (FR-3416). Solo busca en la cuenta del token.
 * @param ownerId la cuenta del token
 * @param ref la referencia que el agente le dio al registrarlo
 * @returns el movimiento, o el motivo: sin libro, o no existe en esta cuenta
 * @throws si la base no responde
 * @aitri-trace FR-ID: FR-3416, US-ID: US-3416, AC-ID: AC-3416b, TC-ID: TC-AGT-161h, TC-AGT-162f
 */
export async function agentMovementByRef(ownerId: string, ref: string): Promise<AgentMovement | AgentReadError> {
  const loaded = await loadLedger(ownerId);
  if (!loaded) return "no_ledger";
  const mv = loaded.state.movements.find((m) => m.origin?.ref === ref);
  return mv ? toAgentMovement(mv, loaded.state.nodes) : "not_found";
}

/**
 * Construye el resumen de un periodo a partir de un estado ya cargado. PURA: llama a las mismas
 * funciones que la pantalla —`rollupTable`, `typeTotals`, `computeBalanceSeries` con
 * `openingCarry`, `resolvedBalance`— y no calcula nada por su cuenta, así que el agente y la app
 * no pueden dar dos cifras distintas.
 * @param state estado de la cuenta, con apertura, cierre y ciclos
 * @param revision revisión del libro
 * @param period el periodo a resumir
 * @returns el resumen
 * @throws Nunca: un nodo o periodo sin datos vale 0.
 * @aitri-trace FR-ID: FR-3415, US-ID: US-3415, AC-ID: AC-3415a, TC-ID: TC-AGT-150h, TC-AGT-151h, TC-AGT-154e, TC-AGT-156e
 */
export function buildSummary(state: LedgerState, revision: number, period: PeriodKey): AgentSummary {
  const cal = calendarOf(state, period);
  const scope = serverScope(state, period);
  const tabla = rollupTable(state, [period]);
  const ingresos = typeTotals(state, "income", [period]);
  const gastos = typeTotals(state, "expense", [period]);
  const balance = balanceAt(computeBalanceSeries(state, scope, openingCarry(state, scope)), period).actual;

  return {
    ...describePeriod(state, cal, period),
    revision,
    nodes: state.nodes.map((n) => {
      const { budget, actual } = tabla.cell(n.id, period);
      return { id: n.id, name: n.name, type: n.type, level: n.level, parentId: n.parentId, budget, actual, remaining: budget - actual };
    }),
    totals: {
      income: ingresos,
      expense: { ...gastos, remaining: gastos.budget - gastos.actual },
    },
    balance: { available: balance.available, reserved: balance.reservedBalance },
    pockets: reserveLeafIds(state).map((id) => ({
      id,
      name: findNode(state.nodes, id)?.name ?? "",
      contributed: state.actuals[id]?.[period] ?? 0,
      balance: resolvedBalance(state, id, period, "actual", scope),
    })),
  };
}

/**
 * El resumen de un periodo de la cuenta (FR-3415).
 * @param ownerId la cuenta del token
 * @param rawPeriod periodo pedido, o null para el vigente
 * @param today «hoy» del servidor, para el periodo vigente
 * @returns el resumen, o el motivo del rechazo
 * @throws si la base no responde
 * @aitri-trace FR-ID: FR-3415, US-ID: US-3415, AC-ID: AC-3415b, TC-ID: TC-AGT-152e, TC-AGT-153f, TC-AGT-155f
 */
export async function agentSummary(
  ownerId: string, rawPeriod: string | null, today: string
): Promise<AgentSummary | AgentReadError> {
  const loaded = await loadLedger(ownerId);
  if (!loaded) return "no_ledger";
  const period = resolvePeriod(loaded.state, rawPeriod, today);
  if (period === "invalid_period") return "invalid_period";
  return buildSummary(loaded.state, loaded.revision, period);
}

// ── Escrituras (EP-03) ─────────────────────────────────────────────────────────────────────────

/** Quién escribe: el token ya resuelto por el envoltorio. */
export interface AgentIdentity {
  tokenId: string;
  tokenName: string;
}

/** Salidas tempranas de un registro: la referencia ya existe, o el dato no se puede resolver. */
export type AgentInsertEarly =
  | { kind: "existing"; movement: Movement; revision: number }
  | { kind: "conflict"; movement: Movement }
  | { kind: "invalid_date" }
  | { kind: "invalid_target" };

/** Lo que devuelve registrar por la puerta del agente, con los nodos para nombrar la hoja. */
export interface AgentInsertOutcome {
  result: InsertMovementResult | { early: AgentInsertEarly };
  nodes: LedgerNode[];
}

/**
 * La hoja de gasto o ingreso, como el par categoría/subcategoría que guarda un movimiento: una
 * subcategoría va con su categoría; una categoría-hoja va sola. Es la misma forma que arma la app.
 * @param nodo la hoja destino
 * @returns `{ catId, subId }`
 * @aitri-trace FR-ID: FR-3408, US-ID: US-3408, AC-ID: AC-3408a, TC-ID: TC-AGT-087e
 */
export function targetToCatSub(nodo: LedgerNode): { catId: string; subId: string | null } {
  return nodo.level === "sub" && nodo.parentId ? { catId: nodo.parentId, subId: nodo.id } : { catId: nodo.id, subId: null };
}

/** La hoja que una operación de bolsillo afecta: el retiro, su origen; el aporte y el mover, su destino. */
function pocketTarget(from: string, to: string): string {
  return isAvailable(to) ? from : to;
}

/** ¿El registro que llega es EL MISMO que el ya guardado con esa referencia? La nota no cuenta. */
function mismoRegistro(guardado: Movement, body: AgentMovementInput): boolean {
  if (guardado.type !== body.type || guardado.amount !== body.amount || (guardado.date ?? null) !== body.date) return false;
  if (body.type === "transfer") return guardado.from === body.from && guardado.to === body.to;
  return guardado.target === body.target;
}

/**
 * Registra un gasto, un ingreso o una operación de bolsillo en nombre de un agente (FR-3408,
 * FR-3409, FR-3410). El periodo sale de la fecha con el calendario de la cuenta; la referencia de
 * origen hace el registro idempotente: si ya existe con el mismo contenido no se escribe nada, y
 * si existe con otro contenido es un conflicto. Todo ocurre con la fila del libro bloqueada, así
 * que dos registros simultáneos con la misma referencia dejan uno.
 *
 * @param ownerId la cuenta del token
 * @param who el token que registra (queda como marca del movimiento)
 * @param body el cuerpo ya validado por `agentMovementSchema`
 * @returns el resultado del repositorio (o la salida temprana) y los nodos de la cuenta
 * @throws si la base falla; la transacción revierte entera
 * @aitri-trace FR-ID: FR-3409, US-ID: US-3409, AC-ID: AC-3409a, TC-ID: TC-AGT-090h, TC-AGT-091e, TC-AGT-092f, TC-AGT-097e
 * @aitri-trace FR-ID: FR-3410, US-ID: US-3410, AC-ID: AC-3410a, TC-ID: TC-AGT-100h, TC-AGT-103f, TC-AGT-104f, TC-AGT-105f
 */
export async function agentInsert(ownerId: string, who: AgentIdentity, body: AgentMovementInput): Promise<AgentInsertOutcome> {
  let nodes: LedgerNode[] = [];
  const result = await insertMovementWith<AgentInsertEarly>(ownerId, (prev, revision): InsertPlan<AgentInsertEarly> => {
    nodes = prev.nodes;
    const guardado = prev.movements.find((m) => m.origin?.ref === body.ref);
    if (guardado) {
      return { early: mismoRegistro(guardado, body) ? { kind: "existing", movement: guardado, revision } : { kind: "conflict", movement: guardado } };
    }
    const period = periodOfDate(prev, body.date);
    if (!period) return { early: { kind: "invalid_date" } };

    const origin = { ref: body.ref, agentId: who.tokenId, agentName: who.tokenName };
    const comun = { amount: body.amount, period, date: body.date, ...(body.note !== undefined ? { note: body.note } : {}) };
    if (body.type === "transfer") {
      const hoja = pocketTarget(body.from, body.to);
      return { input: { type: "transfer", catId: hoja, from: body.from, to: body.to, ...comun }, origin };
    }
    const nodo = findNode(prev.nodes, body.target);
    if (!nodo) return { early: { kind: "invalid_target" } };
    return { input: { type: body.type, ...targetToCatSub(nodo), ...comun }, origin };
  });
  return { result, nodes };
}

/**
 * Localiza un movimiento por la clave de la ruta: su id, o `ref:` + su referencia de origen.
 * @param key lo que vino en la URL (ya decodificado)
 * @returns la función que lo busca en el estado del dueño
 */
export function locateByKey(key: string): (state: LedgerState) => Movement | undefined {
  if (key.startsWith(REF_KEY_PREFIX)) {
    const ref = key.slice(REF_KEY_PREFIX.length);
    return (state) => state.movements.find((m) => m.origin?.ref === ref);
  }
  return (state) => state.movements.find((m) => m.id === key);
}

/** Lo que devuelve corregir o deshacer, con los nodos para nombrar la hoja. */
export interface AgentWriteOutcome {
  result: MovementWriteResult;
  nodes: LedgerNode[];
}

/**
 * Corrige un gasto o un ingreso registrado por un agente: monto, fecha, nota u hoja (FR-3411).
 * Usa la misma mutación que la edición manual. Un movimiento registrado a mano se contesta como
 * inexistente; una operación de bolsillo no se corrige (se deshace y se registra de nuevo).
 *
 * @param ownerId la cuenta del token
 * @param key id del movimiento, o `ref:` + su referencia
 * @param patch los campos a cambiar, ya validados por `agentPatchSchema`
 * @returns el movimiento corregido y la revisión nueva, o el motivo del rechazo
 * @throws si la base falla; la transacción revierte entera
 * @aitri-trace FR-ID: FR-3411, US-ID: US-3411, AC-ID: AC-3411a, TC-ID: TC-AGT-110h, TC-AGT-111e, TC-AGT-115f, TC-AGT-117e
 */
export async function agentUpdate(ownerId: string, key: string, patch: AgentPatchInput): Promise<AgentWriteOutcome> {
  let nodes: LedgerNode[] = [];
  const result = await writeMovementWith(
    ownerId,
    locateByKey(key),
    (prev, cal, scope, actual) => {
      nodes = prev.nodes;
      const cambio: MovementPatch = {
        ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
        ...(patch.date !== undefined ? { date: patch.date } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      };
      if (patch.target !== undefined) {
        const nodo = findNode(prev.nodes, patch.target);
        if (!nodo) return { rejected: "invalid_target" };
        Object.assign(cambio, targetToCatSub(nodo));
      }
      return editMovement(prev, actual.id, cambio, cal, scope);
    },
    { soloDeAgente: true }
  );
  return { result, nodes };
}

/**
 * Deshace un movimiento registrado por un agente (FR-3412): un gasto o ingreso con la mutación del
 * borrado manual; una operación de bolsillo con `undoReserveOp`. Lo registrado a mano no se toca.
 *
 * @param ownerId la cuenta del token
 * @param key id del movimiento, o `ref:` + su referencia
 * @returns la revisión nueva, o el motivo del rechazo
 * @throws si la base falla; la transacción revierte entera
 * @aitri-trace FR-ID: FR-3412, US-ID: US-3412, AC-ID: AC-3412a, TC-ID: TC-AGT-120h, TC-AGT-121h, TC-AGT-125e, TC-AGT-126e
 */
export async function agentUndo(ownerId: string, key: string): Promise<AgentWriteOutcome> {
  let nodes: LedgerNode[] = [];
  const result = await writeMovementWith(
    ownerId,
    locateByKey(key),
    (prev, _cal, scope, actual) => {
      nodes = prev.nodes;
      return actual.type === "transfer" ? undoReserveOp(prev, actual.id, scope) : deleteMovement(prev, actual.id);
    },
    { soloDeAgente: true, bolsillos: true }
  );
  return { result, nodes };
}
