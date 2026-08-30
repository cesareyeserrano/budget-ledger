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

/** Entradas y salidas del journal de UNA hoja, por mes. Doce posiciones cada una. */
interface LeafFlows {
  /** Σ de lo que ENTRA por journal: moveres cuyo `to` es esta hoja (ADR-01). */
  in: number[];
  /** Σ de lo que SALE por journal: retiros a Disponible y moveres cuyo `from` es esta hoja. */
  out: number[];
}

// Índice del journal memoizado por IDENTIDAD del array de movimientos: cada mutación lo clona, así
// que la invalidación es automática. Cuelga de la MISMA identidad que `seriesMemo` usa como clave
// interna — no de una clave propia, que es el defecto que [RISK-2] del diseño señala.
const journalIndexMemo = new WeakMap<Movement[], Map<string, LeafFlows>>();

/**
 * Índice `{in, out}` por hoja en UNA sola pasada sobre el journal (ADR-05).
 *
 * Sustituye al `retirosByMonth` anterior, que recorría el journal ENTERO por cada hoja consultada:
 * con H hojas el coste era O(H×M) y crecía con el uso. Aquí una pasada O(M) llena las doce
 * posiciones de todas las hojas a la vez, así que el término nuevo que FR-1602 necesita no sale
 * gratis: sale más barato que lo que había (NFR-1608).
 *
 * El sentinel Disponible NUNCA es una clave del índice: no es una hoja y no tiene serie.
 *
 * @param movements Journal completo (no se muta).
 * @returns Mapa hoja → {in, out}; una hoja sin movimientos simplemente no está.
 * @throws Nunca. Un mes fuera de la escala se ignora.
 */
function journalIndex(movements: Movement[]): Map<string, LeafFlows> {
  const cached = journalIndexMemo.get(movements);
  if (cached) return cached;
  const index = new Map<string, LeafFlows>();
  const flowsOf = (id: string): LeafFlows => {
    let f = index.get(id);
    if (!f) {
      f = { in: new Array<number>(12).fill(0), out: new Array<number>(12).fill(0) };
      index.set(id, f);
    }
    return f;
  };
  for (const m of movements) {
    if (m.type !== "transfer") continue;
    const idx = MONTH_KEYS.indexOf(m.month);
    if (idx < 0) continue;
    // SALIDA: cualquier movimiento que sale de una hoja real — retiro a Disponible o mover.
    if (m.from && !isAvailable(m.from)) flowsOf(m.from).out[idx] += m.amount;
    // ENTRADA: solo el MOVER. Un aporte desde Disponible entra por la CELDA, no por el journal
    // (FR-1601: el mover dejó de escribir celda; el aporte sigue escribiéndola).
    if (m.to && !isAvailable(m.to) && m.from && !isAvailable(m.from)) flowsOf(m.to).in[idx] += m.amount;
  }
  journalIndexMemo.set(movements, index);
  return index;
}

/**
 * Serie DERIVADA del saldo de una alcancía (FR-1602):
 *
 *     saldo[m] = Σ celdas[1..m] + Σ moveres que ENTRAN[1..m] − Σ movimientos que SALEN[1..m]
 *
 * El término de entradas es lo que esta feature añade. Antes las llegadas de un mover viajaban
 * dentro de la celda del destino, que es justo la anotación sin contrapartida que el usuario
 * detectó: la celda solo crecía y nada salía del origen. Ahora el mover se anota en el journal por
 * sus dos extremos y la celda vuelve a significar UNA cosa —lo apartado desde Disponible—, así que
 * la entrada tiene que llegar por aquí para que el saldo no cambie de valor (NFR-1603).
 *
 * En Pres. no hay journal (no se planean retiros ni moveres en v1): la trayectoria del plan sigue
 * siendo el acumulado de los aportes planeados.
 *
 * @param state Estado del ledger (no se muta).
 * @param leafId Hoja transfer (una hoja desconocida deriva [0×12]).
 * @param plane Plano a leer.
 * @returns Serie readonly de 12 saldos derivados. Referencia estable para el mismo estado.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-1602, US-ID: US-1602, AC-ID: AC-1604, TC-ID: TC-CPR-009h
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
    const flows = plane === "actual" ? journalIndex(state.movements).get(leafId) : undefined;
    const out: number[] = [];
    let running = 0;
    for (let i = 0; i < MONTH_KEYS.length; i++) {
      running += cells?.[MONTH_KEYS[i]] ?? 0;
      if (flows) running += flows.in[i] - flows.out[i];
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
 * Aportes del mes = Σ de las CELDAS transfer del mes. Vuelve a ser cierto SIN correcciones: desde
 * FR-1601 un mover ya no escribe la celda del destino, así que la celda solo contiene lo apartado
 * desde Disponible. La resta compensatoria `reserveMovers` que introdujo el arreglo parcial de
 * BG-001 queda RETIRADA — compensaba la contrapartida que faltaba en vez de anotarla, y con la
 * anotación puesta ya no tiene nada que compensar.
 *
 * La fila «− Reservas del mes» del Balance y el roll-up del grupo «Reservas» de la grilla leen
 * ahora la MISMA cifra, que es lo que FR-1603 exige.
 *
 * @aitri-trace FR-ID: FR-1603, US-ID: US-1603, AC-ID: AC-1607, TC-ID: TC-CPR-016h
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
 * Retiros del mes. Ejecutado: Σ de las operaciones del journal que BAJAN de una alcancía a
 * Disponible ese mes (from = hoja real Y to = Disponible). Presupuestado: el retiro PLANEADO del
 * mes (fila Retiros · Pres.). La fila «+ Retiros del mes» del Balance.
 *
 * El extremo `to` es parte de la definición, no un detalle (BG-001): antes bastaba con que el
 * movimiento SALIERA de una alcancía, así que un mover alcancía→alcancía se contaba como retiro y
 * la fila anunciaba una bajada a Disponible que jamás ocurrió —la plata seguía reservada, en otra
 * caja—. El usuario lo encontró con un mover de 9.200.300 que aparecía a la vez como retiro y
 * como saldo reservado, sin forma de conciliar las dos cifras. Ver `reserveMovers`.
 *
 * @aitri-trace FR-ID: FR-1009, US-ID: US-1009, AC-ID: AC-1009b, TC-ID: TC-TRF-109e, TC-TRF4-151f
 */
export function reserveRetiros(state: LedgerState, month: MonthKey, plane: Plane): number {
  if (plane === "budget") return state.budgets[RETIROS_PLAN_ID]?.[month] ?? 0;
  return state.movements.reduce(
    (sum, m) =>
      m.type === "transfer" && m.month === month && m.from && !isAvailable(m.from) && isAvailable(m.to)
        ? sum + m.amount
        : sum,
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

/** ¿El movimiento es una operación de reserva CORREGIBLE — retiro puro o mover? */
function isRemovableReserveOp(mv: Movement | undefined): mv is Movement {
  if (!mv || mv.type !== "transfer") return false;
  // Tiene que SALIR de una hoja real. Un aporte (from = Disponible) no entra aquí: ese sí escribió
  // celda, así que quitar su movimiento NO restauraría nada — se corrige editando la celda (FR-1003).
  return !!mv.from && !isAvailable(mv.from);
}

/**
 * Elimina una operación de reserva del journal — retiro puro (from = alcancía, to = Disponible) o
 * MOVER (ambos extremos reales). Corrección de un error del usuario.
 *
 * Que el mover sea eliminable es consecuencia directa de FR-1601: al dejar de escribir la celda del
 * destino, quitar la entrada del journal restaura el saldo derivado POR CONSTRUCCIÓN — exactamente
 * el mismo argumento que ya sostenía la eliminación de un retiro. Antes era imposible: la llegada
 * vivía en la celda, así que borrar el movimiento habría dejado la plata duplicada en el destino y
 * resucitada en el origen. Por eso el usuario tenía un mover de 9.200.300 ATRAPADO, que solo podía
 * neutralizar haciendo el mover inverso a mano (mitad de corrección de BG-001).
 *
 * Siempre permitido: el estado resultante es exactamente el previo al error.
 *
 * @param state Estado del ledger (no se muta).
 * @param movementId Id del movimiento a eliminar.
 * @returns El estado sin el movimiento, o el MISMO estado si el id no es una operación eliminable
 *          (inexistente, de otro tipo, o un aporte desde Disponible).
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-1609, US-ID: US-1609, AC-ID: AC-1627, TC-ID: TC-CPR-057h
 */
export function removeReserveOp(state: LedgerState, movementId: string): LedgerState {
  const mv = state.movements.find((m) => m.id === movementId);
  if (!isRemovableReserveOp(mv)) return state;
  const next = cloneState(state);
  next.movements = next.movements.filter((m) => m.id !== movementId);
  return next;
}

/** @deprecated Nombre anterior de `removeReserveOp`, que ahora acepta también moveres (FR-1609). */
export const removeReserveRetiro = removeReserveOp;

/**
 * Las operaciones de reserva de un mes que el usuario puede CORREGIR: retiros a Disponible y
 * moveres entre alcancías, en el orden del journal.
 *
 * Antes la lista solo consideraba retiros puros, así que un mover ni siquiera se mostraba — no era
 * que fallara al borrarlo: es que no aparecía. La superficie de corrección lo lista ahora
 * identificándolo por sus DOS extremos, que es lo que lo distingue de un retiro (FR-1609/AC-1628).
 *
 * @param state Estado del ledger (no se muta).
 * @param month Mes a listar.
 * @returns Movimientos del mes, en orden de journal. Vacío si no hay ninguno.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-1609, US-ID: US-1609, AC-ID: AC-1628, TC-ID: TC-CPR-058h
 */
export function monthReserveOps(state: LedgerState, month: MonthKey): readonly Movement[] {
  return state.movements.filter((m) => m.month === month && isRemovableReserveOp(m));
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

// Memoización del barrido de techo por IDENTIDAD del journal, y dentro por la del mapa del plano.
// Misma técnica que `journalIndex`: cada mutación clona esos arrays/objetos, así que la
// invalidación es automática y no hay clave que mantener a mano.
type TechoScan = { excess: number[]; margin: number[]; delta: number[] };
const techoMemo = new WeakMap<Movement[], WeakMap<AmountMap, Partial<Record<Plane, TechoScan>>>>();

/** `techoScanRaw` memoizado — el encabezado de mes lo consulta doce veces por render. */
function techoScan(state: LedgerState, plane: Plane): TechoScan {
  let byMap = techoMemo.get(state.movements);
  if (!byMap) { byMap = new WeakMap(); techoMemo.set(state.movements, byMap); }
  const map = plane === "budget" ? state.budgets : state.actuals;
  let byPlane = byMap.get(map);
  if (!byPlane) { byPlane = {}; byMap.set(map, byPlane); }
  let scan = byPlane[plane];
  if (!scan) { scan = techoScanRaw(state, plane); byPlane[plane] = scan; }
  return scan;
}

/** Un mes cuyas reservas netas superan su margen: el mes, su margen y por cuánto se pasó. */
export interface TechoBreach {
  month: MonthKey;
  margin: number;
  excess: number;
}

/**
 * Cuánto QUEDA por reservar en un mes: el margen menos lo ya reservado neto. Es exactamente el
 * número que el dominio devuelve como `limit` al rechazar por techo, así que es el que el editor de
 * celda debe mostrar como «Máx.» (FR-1605).
 *
 * No confundir con `availableMargin`, que devuelve el margen BRUTO del mes (disponible previo +
 * flujo) sin descontar lo ya reservado. Mostrar ese al usuario le prometería sitio que no tiene:
 * en agosto de 2026 el margen bruto era 10.200.000 y lo que quedaba, 1.000.000. El indicador y el
 * rechazo tienen que decir la MISMA cifra o la incoherencia que esta feature cierra reaparece por
 * otra puerta.
 *
 * @param state Estado del ledger (no se muta).
 * @param month Mes a consultar.
 * @returns Lo reservable que queda, nunca negativo (0 si el mes ya está por encima del techo).
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-1605, US-ID: US-1605, AC-ID: AC-1613, TC-ID: TC-CPR-030h
 */
export function reserveHeadroom(state: LedgerState, month: MonthKey): number {
  const scan = techoScan(state, "actual");
  const i = MONTH_KEYS.indexOf(month);
  if (i < 0) return 0;
  return Math.max(0, scan.margin[i] - scan.delta[i]);
}

/**
 * Los meses cuyas reservas netas superan el margen de ese mes (FR-1606).
 *
 * Sale del MISMO barrido que decide los bloqueos (`techoScan`), no de un cálculo paralelo (ADR-03):
 * si la señal y el bloqueo se calcularan por separado podrían discrepar, que es exactamente la
 * clase de defecto que esta feature existe para cerrar.
 *
 * Por qué hace falta: el techo se comprueba al ESCRIBIR una reserva, y nada lo re-valida después.
 * Bajar un ingreso ya registrado —corregir un error de tecleo, algo que debe seguir permitiéndose—
 * deja el mes por encima del techo en silencio, y a partir de ahí el margen de todos los meses
 * siguientes queda en 0 y ninguna celda de reserva acepta un peso más. El usuario se topaba con una
 * app que rechazaba todo sin decir por qué (BG-002 de la feature transferencias).
 *
 * @param state Estado del ledger (no se muta).
 * @returns Los meses excedidos en orden de calendario; vacío en un estado sano.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-1606, US-ID: US-1606, AC-ID: AC-1616, TC-ID: TC-CPR-036h
 */
export function techoBreaches(state: LedgerState): readonly TechoBreach[] {
  const scan = techoScan(state, "actual");
  const out: TechoBreach[] = [];
  for (let i = 0; i < MONTH_KEYS.length; i++) {
    if (scan.excess[i] > 0) out.push({ month: MONTH_KEYS[i], margin: scan.margin[i], excess: scan.excess[i] });
  }
  return out;
}

/** Serie de excesos de techo y márgenes por mes de un estado, en un plano. */
function techoScanRaw(state: LedgerState, plane: Plane): { excess: number[]; margin: number[]; delta: number[] } {
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

  // Candidato. Solo el APORTE desde Disponible escribe celda (FR-1601). Antes bastaba con que el
  // destino fuese real, así que un MOVER también la escribía — y esa era la anotación sin
  // contrapartida: sumaba en el destino y no restaba en ningún sitio, de modo que la cuenta de
  // reservas solo podía crecer. Ahora el mover se journaliza por sus dos extremos y nada más; su
  // llegada la recoge `journalIndex` al derivar el saldo.
  //
  // No se contempló el doble asiento en celdas (restar en el origen) porque `amount_cell` declara
  // CHECK (amount >= 0): exigiría celdas negativas, un cambio de esquema y romper FR-1003 —«la
  // celda es el aporte del mes»—. Ver ADR-01.
  const writes: CellWrite[] = [];
  if (!toIsAvailable && fromIsAvailable) {
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
