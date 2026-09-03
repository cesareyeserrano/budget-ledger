// @aitri-trace domain:closure — cierre-de-mes: qué está cerrado y qué mutación lo viola.
//
// Módulo:       src/domain/closure.ts
// Propósito:    La ÚNICA autoridad sobre el cierre de mes. Decide qué periodo está cerrado, cuál
//               es cerrable, cuál reabrible, y —lo más importante— qué mutación toca una cifra de
//               un mes cerrado. No persiste, no pinta y no lee el reloj.
// Dependencias: ./types, ./periods, ./range.
//
// LA IDEA QUE SOSTIENE TODO EL DISEÑO: el cierre es un permiso de ESCRITURA, no un concepto de
// CÁLCULO. `balance.ts`, `reserve.ts` y los roll-ups NO importan este módulo ni conocen `Closure`:
// siguen recorriendo la misma lista de periodos que les da `activeRange` y produciendo los mismos
// números. Si el cierre entrara en el cálculo habría dos algoritmos que mantener sincronizados
// para siempre — y el usuario eligió cierre VOLUNTARIO, así que el mundo «sin meses cerrados» no
// desaparece nunca. Manteniéndolo fuera, ese mundo ES el código de hoy, sin ramas nuevas
// (NFR-2002, NFR-2003, verificado por TC-CDM-212f).
//
// PURO Y SIN RELOJ (ADR-02): `currentPeriod` es un PARÁMETRO. El reloj vive en `src/lib/date.ts`.

import type { Closure, LedgerState, PeriodKey } from "./types";
import { addMonths, comparePeriods, isPeriodKey } from "./periods";

// NO se importa `range.ts`: `activeRange` ancla su inicio en la frontera del cierre (ADR-14), así
// que importarlo aquí cerraría un ciclo. Las dos funciones que necesitan el rango lo RECIBEN como
// parámetro — que es como opera el resto del dominio (ADR-02: la lista de periodos entra, no se
// deriva dentro).

/** Nada cerrado. Es el estado de todo usuario existente y de todo usuario nuevo. */
export const NO_CLOSURE: Closure = { closedThrough: null, reopened: null };

/**
 * Normaliza un `closure` de procedencia dudosa (base corrupta, formato viejo, JSON ajeno).
 *
 * Misma política que `normalizeHorizon` (FR-1907): NUNCA lanza y nunca deja pasar basura. Un
 * `closedThrough` ilegible degrada a «nada cerrado» en vez de impedir el arranque — y degradar a
 * «nada cerrado» es seguro porque el servidor sigue rechazando: lo peor que produce es que la
 * interfaz pinte como editable algo que la API va a rechazar, nunca una escritura ilegal.
 *
 * @aitri-trace FR-ID: FR-2001, US-ID: US-2001, AC-ID: AC-2003, TC-ID: TC-CDM-012h, TC-CDM-013f
 */
export function normalizeClosure(v: unknown): Closure {
  if (!v || typeof v !== "object") return NO_CLOSURE;
  const raw = v as { closedThrough?: unknown; reopened?: unknown };
  const closedThrough = isPeriodKey(raw.closedThrough) ? raw.closedThrough : null;
  if (closedThrough === null) return NO_CLOSURE;
  // `reopened` solo es creíble si es EXACTAMENTE el mes siguiente a la frontera: es el invariante
  // que ADR-13 impone, y aquí es donde se hace cumplir para cualquier estado que entre de fuera.
  const reopened =
    isPeriodKey(raw.reopened) && raw.reopened === addMonths(closedThrough, 1) ? raw.reopened : null;
  return { closedThrough, reopened };
}

/** El `closure` efectivo de un estado: ausente ≡ nada cerrado (delta aditivo, FR-2001). */
export function closureOf(state: LedgerState): Closure {
  return normalizeClosure(state.closure);
}

/**
 * ¿Está cerrado este periodo? Es la pregunta que hace toda mutación antes de mutar.
 *
 * Una comparación de dos cadenas «YYYY-MM»: el orden lexicográfico coincide con el cronológico
 * desde FR-1901, así que no hace falta parsear nada. No se memoiza a propósito — memoizar una
 * comparación de cadenas cuesta más que la comparación (TC-CDM-250h).
 *
 * @aitri-trace FR-ID: FR-2003, US-ID: US-2003, AC-ID: AC-2007, TC-ID: TC-CDM-012h
 */
export function isClosed(closure: Closure | undefined, period: PeriodKey): boolean {
  const c = normalizeClosure(closure);
  if (c.closedThrough === null) return false;
  return comparePeriods(period, c.closedThrough) <= 0;
}

/**
 * El mes que se puede cerrar AHORA: el abierto más antiguo del rango, si no es futuro.
 *
 * El cierre es SECUENCIAL por necesidad aritmética, no por gusto (FR-2002): si se pudiera cerrar
 * septiembre dejando agosto abierto, cualquier edición de agosto cambiaría el saldo de apertura de
 * septiembre y por tanto sus cifras — el criterio de éxito quedaría roto sin que nada lo delatara.
 *
 * Y nunca un mes futuro (FR-2008): congelar plan que aún no ha ocurrido contradice la feature. El
 * mes EN CURSO sí es cerrable, porque el riesgo está acotado — al ser el último cerrado, siempre
 * queda reabrible.
 *
 * @aitri-trace FR-ID: FR-2002, US-ID: US-2002, AC-ID: AC-2005, TC-ID: TC-CDM-020h, TC-CDM-021h, TC-CDM-080f
 */
export function nextClosable(
  state: LedgerState,
  currentPeriod: PeriodKey,
  range: readonly PeriodKey[]
): PeriodKey | null {
  if (!isPeriodKey(currentPeriod)) return null;
  const { closedThrough } = closureOf(state);
  if (range.length === 0) return null;
  const candidate =
    closedThrough === null ? range[0] : range.find((p) => comparePeriods(p, closedThrough) > 0);
  if (!candidate) return null;
  // Futuro fuera: solo lo ya terminado o el mes en curso (FR-2008).
  return comparePeriods(candidate, currentPeriod) <= 0 ? candidate : null;
}

/**
 * El mes que se puede reabrir AHORA: el último cerrado, salvo que ya haya uno reabierto.
 *
 * El límite a UN mes lo propuso el usuario y resuelve un problema técnico de raíz: como todo lo
 * posterior al último mes cerrado está abierto o es plan, el recálculo que dispara la reapertura
 * NUNCA alcanza a otro mes cerrado.
 *
 * `reopened !== null` es el guardia contra caminar hacia atrás: reabierto agosto hay que volver a
 * cerrarlo antes de poder reabrir otro, y al cerrarlo el último cerrado vuelve a ser agosto — así
 * que julio nunca queda al alcance (TC-CDM-053e).
 *
 * @aitri-trace FR-ID: FR-2005, US-ID: US-2005, AC-ID: AC-2014, TC-ID: TC-CDM-051f, TC-CDM-053e
 */
export function nextReopenable(closure: Closure | undefined): PeriodKey | null {
  const c = normalizeClosure(closure);
  if (c.closedThrough === null) return null;
  if (c.reopened !== null) return null;
  return c.closedThrough;
}

export type CloseResult =
  | { ok: true; closure: Closure; closed: PeriodKey }
  | { ok: false; reason: "not_closable" };

/**
 * Avanza la frontera un mes. Devuelve el resultado o el motivo del rechazo; NUNCA lanza.
 *
 * Cerrar el mes que estaba reabierto limpia `reopened`, que es lo que devuelve el derecho a una
 * nueva reapertura — sobre el MISMO mes, no sobre uno anterior.
 *
 * @aitri-trace FR-ID: FR-2002, US-ID: US-2002, AC-ID: AC-2006, TC-ID: TC-CDM-021h, TC-CDM-081h
 */
export function closeMonth(
  state: LedgerState,
  currentPeriod: PeriodKey,
  range: readonly PeriodKey[]
): CloseResult {
  const target = nextClosable(state, currentPeriod, range);
  if (target === null) return { ok: false, reason: "not_closable" };
  const prev = closureOf(state);
  const reopened = prev.reopened === target ? null : prev.reopened;
  return { ok: true, closure: { closedThrough: target, reopened }, closed: target };
}

export type ReopenResult =
  | { ok: true; closure: Closure; reopened: PeriodKey }
  | { ok: false; reason: "nothing_closed" | "already_reopened" };

/**
 * Retrocede la frontera un mes y marca el mes liberado como reabierto.
 *
 * @aitri-trace FR-ID: FR-2005, US-ID: US-2005, AC-ID: AC-2015, TC-ID: TC-CDM-050h, TC-CDM-052f, TC-CDM-054f
 */
export function reopenMonth(state: LedgerState): ReopenResult {
  const c = closureOf(state);
  if (c.closedThrough === null) return { ok: false, reason: "nothing_closed" };
  if (c.reopened !== null) return { ok: false, reason: "already_reopened" };
  const target = c.closedThrough;
  const back = addMonths(target, -1);
  return { ok: true, closure: { closedThrough: back, reopened: target }, reopened: target };
}

/**
 * EL GUARDIA (FR-2003, NFR-2005). Los periodos CERRADOS cuyas cifras difieren entre dos estados.
 *
 * Es un PUNTO DE ESTRANGULAMIENTO, no una comprobación por operación (ADR-12). Las seis vías de
 * escritura que el requisito enumera —presupuesto, ejecutado, movimientos, aportes, retiros y
 * traslados— acaban todas escribiendo en `budgets`, `actuals` o `movements`, así que comparar esas
 * tres estructuras las cubre A TODAS. Y cubre las que no existen todavía: una vía nueva queda
 * protegida sin tocarla, que es la propiedad que más importa aquí. La alternativa —preguntar
 * `isClosed` en cada mutación— hace que la corrección dependa de que nadie olvide la pregunta.
 *
 * `cellNotes` se ignora DELIBERADAMENTE: las observaciones no se congelan (FR-2004). Es una
 * ausencia, y una ausencia sin declarar es indistinguible de un olvido — por eso está escrita.
 *
 * @aitri-trace FR-ID: FR-2003, US-ID: US-2003, AC-ID: AC-2010, TC-ID: TC-CDM-030h, TC-CDM-031f, TC-CDM-042f
 */
export function closedPeriodsViolated(prev: LedgerState, next: LedgerState): PeriodKey[] {
  // La frontera que MANDA es la del estado previo: si mandara la entrante, cualquiera podría
  // abrir un mes bajándose la frontera en el mismo snapshot con el que lo edita.
  const closure = closureOf(prev);
  if (closure.closedThrough === null) return [];
  const hit = new Set<PeriodKey>();
  const mark = (p: string) => {
    if (isPeriodKey(p) && isClosed(closure, p)) hit.add(p);
  };

  for (const key of ["budgets", "actuals"] as const) {
    diffAmountMaps(prev[key], next[key], mark);
  }
  diffMovements(prev.movements ?? [], next.movements ?? [], mark);

  return [...hit].sort(comparePeriods);
}

/** Marca todo periodo cuyo importe cambió, se creó o desapareció. */
function diffAmountMaps(
  a: LedgerState["budgets"],
  b: LedgerState["budgets"],
  mark: (p: string) => void
): void {
  for (const nodeId of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const ca = (a ?? {})[nodeId] ?? {};
    const cb = (b ?? {})[nodeId] ?? {};
    for (const p of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      // Ausente y 0 son el MISMO valor contable: borrar una celda en cero no es una violación.
      if ((ca[p as PeriodKey] ?? 0) !== (cb[p as PeriodKey] ?? 0)) mark(p);
    }
  }
}

/**
 * Marca los periodos tocados por altas, bajas, cambios de importe/destino y —el caso que se
 * escapa si no se piensa— movimientos que CAMBIAN de periodo: cuentan las dos puntas, así que
 * arrastrar un movimiento hacia un mes cerrado se rechaza igual que editarlo dentro de él.
 */
function diffMovements(
  a: LedgerState["movements"],
  b: LedgerState["movements"],
  mark: (p: string) => void
): void {
  const byId = new Map(a.map((m) => [m.id, m]));
  const seen = new Set<string>();
  for (const nm of b) {
    seen.add(nm.id);
    const om = byId.get(nm.id);
    if (!om) {
      mark(nm.period); // alta
      continue;
    }
    if (om.period !== nm.period) {
      mark(om.period);
      mark(nm.period);
    }
    if (om.amount !== nm.amount || om.target !== nm.target || om.catId !== nm.catId ||
        om.subId !== nm.subId || om.type !== nm.type) {
      mark(nm.period);
      mark(om.period);
    }
  }
  for (const om of a) if (!seen.has(om.id)) mark(om.period); // baja
}

/**
 * Los meses ya TERMINADOS que siguen sin cerrar. Alimenta el aviso de FR-2006.
 *
 * El mes en curso no cuenta: aún se está viviendo, así que no tener cerrado septiembre el 3 de
 * septiembre no es un descuido. Cerrarlo sí se puede (FR-2008), pero la app no lo reclama.
 *
 * @aitri-trace FR-ID: FR-2006, US-ID: US-2006, AC-ID: AC-2019, TC-ID: TC-CDM-060h, TC-CDM-062f, TC-CDM-063f
 */
export function unclosedEndedPeriods(
  state: LedgerState,
  currentPeriod: PeriodKey,
  range: readonly PeriodKey[]
): PeriodKey[] {
  if (!isPeriodKey(currentPeriod)) return [];
  const { closedThrough } = closureOf(state);
  return range.filter(
    (p) =>
      comparePeriods(p, currentPeriod) < 0 &&
      (closedThrough === null || comparePeriods(p, closedThrough) > 0)
  );
}
