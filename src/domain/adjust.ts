// @aitri-trace domain:adjust — feature diario-de-celda (FR-2503, FR-2504): la fecha que se propone
// y el AJUSTE que nace de teclear un total en la celda.
//
// Módulo:       src/domain/adjust.ts
// Propósito:    Dominio puro. `proposedDate`/`isDateInPeriod` deciden qué fecha ofrece y acepta una
//               celda; `adjustCell` convierte «tecleé 120.000» en un movimiento por la DIFERENCIA
//               con lo que ya suman sus movimientos. Nada aquí escribe ni conoce la UI.
// Dependencias: ./types, ./periods, ./tree, ./detail (movementSum), ./cycles (Calendar).

import { isValidMovementPeriod, proposeOpeningCycle, type Calendar } from "./cycles";
import { monthOf } from "./periods";
import type { LedgerState, Movement, PeriodKey } from "./types";
import { findNode, isLeaf } from "./tree";
import { movementSum } from "./detail";
import { uid, nextSeq } from "./ids";
import { MONTO_MAX, normalizeNote } from "./validation";

/**
 * Copia del estado con lo que esta función MUTA clonado en profundidad.
 *
 * Mismo criterio que el `clone` de `mutations.ts` (que es privado de ese módulo): se propaga el
 * estado con spread —así un campo nuevo viaja solo, sin que nadie tenga que acordarse de añadirlo—
 * y se clonan en profundidad las partes que se tocan. `adjust` escribe en `actuals` y en
 * `movements`; el resto viaja por referencia a propósito, porque no se modifica.
 */
function clone(state: LedgerState): LedgerState {
  return {
    ...state,
    actuals: structuredClone(state.actuals),
    movements: state.movements.map((m) => ({ ...m })),
  };
}

/** Nota con la que nace un ajuste — el usuario la ve en el Detalle y puede cambiarla luego. */
export const AJUSTE_NOTE = "Ajuste manual";

/** La hora que se le pone a una fecha propuesta que NO es «ahora»: mediodía, lejos de los bordes. */
const MEDIODIA = "T12:00";

/** «YYYY-MM-DDTHH:mm» a partir de un Date, en hora LOCAL (la que el usuario ve en su reloj). */
function isoMinute(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** El último día del mes de una clave («2026-02» → «2026-02-28»), sin depender de la zona horaria. */
function lastDayOfMonth(period: PeriodKey): string {
  const m = monthOf(period);
  const year = Number(m.slice(0, 4));
  const month = Number(m.slice(5, 7));
  const dias = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${m}-${String(dias).padStart(2, "0")}`;
}

/** El rango de fechas de un periodo: el del ciclo, o el mes completo en modo mes a mes. */
function rangeOfPeriod(cal: Calendar, period: PeriodKey): { start: string; end: string } {
  const r = cal.rangeOf(period);
  if (r) return r;
  const m = monthOf(period);
  return { start: `${m}-01`, end: lastDayOfMonth(period) };
}

/**
 * La fecha que la celda propone para un movimiento nuevo (FR-2503).
 *
 * Es HOY cuando hoy cae dentro del mes o ciclo de esa celda — el caso normal, y por eso el botón
 * dice «Hoy». Si no cae (se está editando un periodo pasado o futuro), propone su ÚLTIMO día a las
 * 12:00: una fecha real dentro del periodo, lejos de los bordes de medianoche.
 *
 * @param cal Calendario del dueño (mes a mes o ciclos).
 * @param period Periodo de la celda.
 * @param now El reloj, inyectado: el dominio nunca lo pregunta por su cuenta (ADR-02 del TRD raíz).
 * @returns Fecha «YYYY-MM-DDTHH:mm» siempre dentro del periodo.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2503, US-ID: US-2503, AC-ID: AC-2503a, TC-ID: TC-DDC-041h, TC-DDC-043e, TC-DDC-045e
 */
export function proposedDate(cal: Calendar, period: PeriodKey, now: Date): string {
  const hoy = isoMinute(now);
  return isDateInPeriod(cal, period, hoy) ? hoy : `${rangeOfPeriod(cal, period).end}${MEDIODIA}`;
}

/**
 * ¿Esa fecha pertenece al mes o ciclo de la celda? (FR-2503)
 *
 * Compara solo el DÍA: las horas no deciden a qué ciclo pertenece un movimiento, y comparar la
 * cadena completa haría que «2026-09-20T23:59» cayera fuera de un ciclo que termina el 20.
 *
 * @throws Nunca — una fecha con forma inválida devuelve `false`.
 *
 * @aitri-trace FR-ID: FR-2503, US-ID: US-2503, AC-ID: AC-2503b, TC-ID: TC-DDC-045e, TC-DDC-048f
 */
export function isDateInPeriod(cal: Calendar, period: PeriodKey, date: string): boolean {
  const day = typeof date === "string" ? date.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const { start, end } = rangeOfPeriod(cal, period);
  return start <= day && day <= end;
}

/** Lo que `adjustCell` devuelve: el estado nuevo y el ajuste creado (o `null` si no hizo falta). */
export type AdjustResult =
  | { state: LedgerState; created: Movement | null }
  | { rejected: "not_leaf" | "transfer" | "invalid_value" };

/**
 * Teclear un total en la celda de Ejecutado: crea un AJUSTE por la diferencia (FR-2504).
 *
 * La celda queda exactamente en el valor tecleado, y el movimiento nuevo es la diferencia con lo
 * que ya suman sus movimientos. Si el valor YA coincide con esa suma no se crea nada: la celda
 * estaba cuadrada (o se acaba de cuadrar tecleando la suma de sus movimientos, TC-DDC-076e).
 *
 * El ajuste es el ÚNICO movimiento que admite monto negativo, y solo en gasto o ingreso: es lo que
 * permite bajar una celda sin borrar movimientos reales. La celda nunca queda por debajo de 0
 * porque el valor se acota antes de entrar.
 *
 * @param state Estado del ledger.
 * @param leafId Hoja de la celda.
 * @param period Periodo de la celda.
 * @param value Total tecleado (entero ≥ 0; se acota).
 * @param date Fecha del ajuste — normalmente `proposedDate(...)`.
 * @param periods Rango activo.
 * @returns El estado nuevo y el ajuste creado, o el motivo del rechazo.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2504, US-ID: US-2504, AC-ID: AC-2504a, TC-ID: TC-DDC-061h, TC-DDC-063e, TC-DDC-065e, TC-DDC-066e
 */
export function adjustCell(
  state: LedgerState, leafId: string, period: PeriodKey, value: number, date: string, periods: readonly PeriodKey[]
): AdjustResult {
  const node = findNode(state.nodes, leafId);
  if (!node || !isLeaf(node, state.nodes)) return { rejected: "not_leaf" };
  if (node.type === "transfer") return { rejected: "transfer" }; // los bolsillos tienen su regla (NFR-2503)
  if (!Number.isFinite(value) || !periods.includes(period)) return { rejected: "invalid_value" };

  const objetivo = Math.max(0, Math.round(value));
  const suma = movementSum(state, leafId, period);
  const diff = objetivo - suma;

  const next = clone(state);
  next.actuals[leafId] = { ...(next.actuals[leafId] ?? {}) };
  next.actuals[leafId][period] = objetivo;

  // diff = 0 — la celda ya vale lo tecleado: no se fabrica un movimiento de cero. Es el caso que
  // CUADRA una celda descuadrada tecleando la suma de sus movimientos (AC-2511b).
  if (diff === 0) return { state: next, created: null };

  const created: Movement = {
    id: uid(), ownerId: state.ownerId, type: node.type,
    catId: node.parentId && node.level === "sub" ? node.parentId : leafId,
    subId: node.level === "sub" ? leafId : null,
    target: leafId,
    amount: diff, period, createdAt: nextSeq(),
    date, note: AJUSTE_NOTE, kind: "adjustment",
  };
  next.movements = [created, ...next.movements];
  return { state: next, created };
}

// ── FR-2505 / FR-2506: editar y borrar un movimiento ─────────────────────────────────────────────

/** Una celda que quedaría por debajo de 0, con el valor al que llegaría. */
export interface NegativeCell {
  nodeId: string;
  period: PeriodKey;
  value: number;
}

/**
 * Las celdas que una escritura METERÍA bajo cero (FR-2505, FR-2506).
 *
 * El criterio es RELATIVO, igual que el del cuadre y el de las reglas de reservas: una celda que YA
 * estaba en negativo —un dato torcido de antes— no bloquea la operación; solo cuenta lo que este
 * cambio empeora. Sin eso, un solo valor malo dejaría el resto del libro en solo lectura.
 *
 * Solo hojas de gasto e ingreso: la celda de un bolsillo es un aporte y tiene su propio piso
 * (NFR-2503, `applyReserveOp`).
 *
 * @param prev Estado antes del cambio.
 * @param next Estado propuesto.
 * @returns Una entrada por celda que el cambio deja negativa; `[]` si ninguna.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2505, US-ID: US-2505, AC-ID: AC-2505g, TC-ID: TC-DDC-092f, TC-DDC-100f, TC-DDC-118f
 */
export function wouldGoNegative(prev: LedgerState, next: LedgerState): NegativeCell[] {
  const out: NegativeCell[] = [];
  for (const [nodeId, meses] of Object.entries(next.actuals)) {
    const node = findNode(next.nodes, nodeId);
    if (!node || node.type === "transfer" || !isLeaf(node, next.nodes)) continue;
    for (const [period, value] of Object.entries(meses)) {
      const v = value ?? 0;
      if (v >= 0) continue;
      if ((prev.actuals[nodeId]?.[period as PeriodKey] ?? 0) < 0) continue; // ya venía torcida
      out.push({ nodeId, period: period as PeriodKey, value: v });
    }
  }
  return out;
}

/**
 * Lo que se puede cambiar de un movimiento (FR-2505). Todos opcionales; al menos uno.
 *
 * `catId` sin `subId` significa «va a esa hoja»: la subcategoría se limpia. Es el caso de mover un
 * gasto de una categoría hoja a otra, y evita que quede un `subId` huérfano apuntando al padre viejo.
 */
export interface MovementPatch {
  amount?: number;
  note?: string | null;
  date?: string;
  /** FR-2406: un ingreso fechado en la ventana de pago puede contarse en el ciclo que ABRE. */
  countInOpeningCycle?: boolean;
  catId?: string;
  subId?: string | null;
}

/** Lo que devuelve `editMovement`: el estado nuevo, o el primer motivo por el que no se puede. */
export type EditResult =
  | { state: LedgerState; deleted?: true }
  | { rejected: "not_found" | "unsupported_type" | "invalid_amount" | "invalid_target" | "period_mismatch" }
  | { rejected: "negative_cell"; cells: NegativeCell[] };

/** Lo que devuelve `deleteMovement`. (`DeleteResult` a secas ya es de `mutations`: borrar un NODO.) */
export type DeleteMovementResult =
  | { state: LedgerState }
  | { rejected: "not_found" | "unsupported_type" }
  | { rejected: "negative_cell"; cells: NegativeCell[] };

/** El monto respeta lo que el `kind` guardado permite: manual ≥1, ajuste ≠0, y ninguno pasa el tope. */
function montoValido(amount: number, kind: Movement["kind"]): boolean {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) return false;
  if (Math.abs(amount) > MONTO_MAX) return false;
  return kind === "adjustment" ? amount !== 0 : amount >= 1;
}

/** Resta `amount` de la celda de `target` en `period` (y la deja creada si no existía). */
function bumpCell(state: LedgerState, target: string, period: PeriodKey, delta: number): void {
  state.actuals[target] = { ...(state.actuals[target] ?? {}) };
  state.actuals[target][period] = (state.actuals[target][period] ?? 0) + delta;
}

/**
 * Editar un movimiento: monto, nota, fecha y categoría (FR-2505).
 *
 * Resta el monto viejo de su celda, aplica el parche y suma el nuevo en la celda de DESTINO — que
 * puede ser otra hoja (cambió la categoría) u otro periodo (cambió la fecha). El periodo no se
 * recibe: se DERIVA de la fecha con el calendario del dueño, igual que al registrar, para que no
 * existan dos fuentes del mismo dato que puedan discrepar (FR-2405).
 *
 * El orden de los rechazos es el del contrato y no es casual: primero lo que ni siquiera identifica
 * al movimiento, después lo que el movimiento ES, y solo al final lo que el cambio PROVOCA. Así el
 * mensaje que ve el usuario nombra la causa primera, no un efecto colateral.
 *
 * Un ajuste sigue siendo un ajuste: `kind` no se toca aquí, y por eso el monto se juzga contra el
 * `kind` GUARDADO — un ajuste puede pasar a negativo, un movimiento manual nunca (TC-DDC-097f).
 *
 * @param state Estado del ledger.
 * @param id Movimiento a editar.
 * @param patch Campos a cambiar.
 * @param cal Calendario del dueño: deriva el periodo de la fecha.
 * @param periods Rango activo.
 * @returns El estado nuevo, o el motivo del rechazo.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2505, US-ID: US-2505, AC-ID: AC-2505a, TC-ID: TC-DDC-081h, TC-DDC-084e, TC-DDC-089f, TC-DDC-092f, TC-DDC-097f
 */
export function editMovement(
  state: LedgerState, id: string, patch: MovementPatch, cal: Calendar, periods: readonly PeriodKey[]
): EditResult {
  const mv = state.movements.find((m) => m.id === id);
  if (!mv) return { rejected: "not_found" };
  // Una operación De→A no se edita por aquí: su celda es un aporte con techo y piso propios, y
  // cambiarla a mano saltándose `applyReserveOp` rompería esas reglas (NFR-2503).
  if (mv.type === "transfer") return { rejected: "unsupported_type" };

  // PONER EL MONTO EN CERO ELIMINA EL MOVIMIENTO (FR-2505). No es un monto inválido: es la salida
  // que el usuario ya conoce del resto de la app — FR-1802 de `techo-de-flujo` la fijó con sus
  // propias palabras para los retiros de bolsillo, y rechazar el 0 aquí le obligaría a aprender dos
  // idiomas distintos para la misma intención.
  //
  // DELEGA en `deleteMovement` en vez de reimplementar el borrado. No es elegancia: el borrado ya
  // valida la celda negativa y el tipo, y dos implementaciones del mismo acto acabarían divergiendo
  // —es exactamente lo que TC-DDC-326e vigila en las dos puertas HTTP—. Así «poner cero» y
  // «papelera» son indistinguibles por construcción, no por disciplina (TC-DDC-125e lo comprueba
  // comparando los estados que producen).
  if (patch.amount === 0) {
    const r = deleteMovement(state, id);
    return "state" in r ? { state: r.state, deleted: true } : r;
  }

  const amount = patch.amount ?? mv.amount;
  if (patch.amount !== undefined && !montoValido(patch.amount, mv.kind)) return { rejected: "invalid_amount" };

  // Destino: `catId` sin `subId` limpia la subcategoría (se va a esa hoja).
  const catId = patch.catId ?? mv.catId;
  const subId = patch.subId !== undefined ? patch.subId : patch.catId !== undefined ? null : mv.subId;
  const target = subId ?? catId;
  if (target !== mv.target) {
    const destino = findNode(state.nodes, target);
    // Del MISMO tipo y hoja: un gasto no se convierte en ingreso cambiándole la categoría, y una
    // categoría con hijos no guarda cifras propias (su valor es la suma de los suyos).
    if (!destino || !isLeaf(destino, state.nodes) || destino.type !== mv.type) return { rejected: "invalid_target" };
  }

  const date = patch.date ?? mv.date;
  let period = mv.period;
  if (date !== undefined && date !== mv.date) {
    let derivado: PeriodKey | null = null;
    try { derivado = cal.periodForDate(date); } catch { derivado = null; }
    // FR-2406: un ingreso fechado en la ventana de pago puede contarse en el ciclo que abre, si el
    // usuario lo pidió. Es la MISMA regla que valida el servidor al registrar, no una copia.
    const apertura = patch.countInOpeningCycle ? proposeOpeningCycle(cal, mv.type, date) : null;
    period = apertura ?? derivado ?? mv.period;
    if (derivado === null && apertura === null) return { rejected: "period_mismatch" };
  }
  if (!periods.includes(period)) return { rejected: "period_mismatch" };
  if (!isValidMovementPeriod(cal, { type: mv.type, period, ...(date ? { date } : {}) })) {
    return { rejected: "period_mismatch" };
  }

  const next = clone(state);
  bumpCell(next, mv.target, mv.period, -mv.amount);
  bumpCell(next, target, period, amount);
  next.movements = next.movements.map((m) =>
    m.id !== id ? m : {
      ...m, amount, catId, subId, target, period,
      ...(date !== undefined ? { date } : {}),
      ...(patch.note !== undefined ? { note: normalizeNote(patch.note) } : {}),
    }
  );

  const negativas = wouldGoNegative(state, next);
  if (negativas.length > 0) return { rejected: "negative_cell", cells: negativas };
  return { state: next };
}

/**
 * Borrar un movimiento: desaparece del journal y su celda baja lo que él aportaba (FR-2506).
 *
 * Borrar un AJUSTE negativo sube la celda — es justo lo que hace falta para deshacer una corrección
 * de más (TC-DDC-121e). Y por eso el piso se comprueba igual que al editar: quitar un movimiento
 * real de una celda que un ajuste ya había bajado puede dejarla negativa.
 *
 * @param state Estado del ledger.
 * @param id Movimiento a borrar.
 * @returns El estado sin él, o el motivo del rechazo.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2506, US-ID: US-2506, AC-ID: AC-2506a, TC-ID: TC-DDC-111h, TC-DDC-120f, TC-DDC-121e
 */
export function deleteMovement(state: LedgerState, id: string): DeleteMovementResult {
  const mv = state.movements.find((m) => m.id === id);
  if (!mv) return { rejected: "not_found" };
  if (mv.type === "transfer") return { rejected: "unsupported_type" };

  const next = clone(state);
  bumpCell(next, mv.target, mv.period, -mv.amount);
  next.movements = next.movements.filter((m) => m.id !== id);

  const negativas = wouldGoNegative(state, next);
  if (negativas.length > 0) return { rejected: "negative_cell", cells: negativas };
  return { state: next };
}
