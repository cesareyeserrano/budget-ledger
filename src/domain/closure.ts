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

import type { Carry, Closure, ImpactRow, LedgerState, PeriodKey } from "./types";
import { comparePeriods, isCycleKey, isPeriodKey, monthNext, monthPrev } from "./periods";
// Se importa `balance.ts`, y la dirección IMPORTA: el cálculo no conoce el cierre (esa es la
// invariante que sostiene el diseño y que TC-CDM-212f barre), pero el cierre sí puede USAR el
// cálculo. `downstreamImpact` no calcula nada nuevo: corre DOS VECES la serie de siempre y las
// compara.
import { computeBalanceSeries, ZERO_CARRY } from "./balance";
import { openingCarry } from "./opening";

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
  // Feature ciclos (FLAG-1, hallazgo 3/A): si alguna clave lleva el sufijo de transición, aquí NO
  // hay aritmética posible — la vecindad la verifica el BORDE con el calendario
  // (`checkClosureNeighbors`). Esta función sigue sin lanzar nunca.
  const sinAritmetica = isCycleKey(closedThrough) || isCycleKey(raw.reopened);
  const reopened =
    isPeriodKey(raw.reopened) && (sinAritmetica || raw.reopened === monthNext(closedThrough))
      ? raw.reopened
      : null;
  if (reopened === null) return { closedThrough, reopened: null };
  // La línea de base solo es creíble ACOMPAÑANDO a un mes reabierto y con dos números finitos.
  // Sin ella se degrada a «no hay línea de base» y el impacto sale vacío: nunca se inventa un
  // «antes» (FR-2010). El esquema lo garantiza con un CHECK, esto cubre lo que entre de fuera.
  const baseline = readCarry((v as { reopenBaseline?: unknown }).reopenBaseline);
  return baseline === null
    ? { closedThrough, reopened }
    : { closedThrough, reopened, reopenBaseline: baseline };
}

/** Un `Carry` de procedencia dudosa: dos enteros finitos o nada. Nunca lanza. */
function readCarry(v: unknown): Carry | null {
  if (!v || typeof v !== "object") return null;
  const raw = v as { available?: unknown; reservedBalance?: unknown };
  if (!Number.isFinite(raw.available) || !Number.isFinite(raw.reservedBalance)) return null;
  return { available: Number(raw.available), reservedBalance: Number(raw.reservedBalance) };
}

/**
 * El saldo con el que CIERRA un periodo en el plano ejecutado — el carry que entrega al siguiente.
 *
 * Es lo que se fotografía al reabrir (FR-2010) y contra lo que se mide después. Se calcula con la
 * misma serie que pinta el Balance: una sola fuente de verdad, sin fórmula paralela.
 *
 * FR-2202: `upTo` arranca en la CABEZA del rango, así que la serie tiene que abrir con la apertura
 * declarada igual que la del Balance. Esta línea es FLAG-1 del TRD y no es cosmética: sin ella, un
 * usuario que declara saldo inicial hace que el cierre fotografíe un saldo distinto del que la
 * pantalla muestra, y la divergencia es INVISIBLE —las dos cifras siguen siendo coherentes consigo
 * mismas— hasta que alguien reabre un mes y mide el impacto contra una referencia falsa.
 * Sin declaración, `openingCarry` devuelve `ZERO_CARRY` y esto se comporta byte a byte como antes.
 */
function closingCarry(
  state: LedgerState,
  range: readonly PeriodKey[],
  period: PeriodKey
): Carry {
  const upTo = range.filter((p) => comparePeriods(p, period) <= 0);
  if (upTo.length === 0) return ZERO_CARRY;
  const series = computeBalanceSeries(state, upTo, openingCarry(state, upTo));
  const last = series[upTo[upTo.length - 1]];
  if (!last) return ZERO_CARRY;
  return { available: last.actual.available, reservedBalance: last.actual.reservedBalance };
}

/** El `closure` efectivo de un estado: ausente ≡ nada cerrado (delta aditivo, FR-2001). */
export function closureOf(state: LedgerState): Closure {
  return normalizeClosure(state.closure);
}

/**
 * Feature ciclos (FR-2409). La relación «reopened = siguiente de closedThrough» verificada con la
 * vecindad REAL (`calendar.next`), una sola vez y en el borde: `closureFromRow` en el servidor e
 * `hydrate` en el cliente. Si no casa, degrada `reopened` (y su línea de base) a null — el mismo
 * efecto que `normalizeClosure` tiene para claves de mes, ahora también para las de transición.
 *
 * @aitri-trace FR-ID: FR-2409, US-ID: US-2409, AC-ID: AC-2429, TC-ID: TC-CIC-087e
 */
export function checkClosureNeighbors(c: Closure, next: (p: PeriodKey) => PeriodKey): Closure {
  if (c.closedThrough === null || c.reopened === null) return c;
  if (next(c.closedThrough) === c.reopened) return c;
  return { closedThrough: c.closedThrough, reopened: null };
}

// Vecindad mensual por defecto (modo mes): `monthPrev` vive en domain/periods (gate estático TC-CIC-102e).

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
  // Sin mes reabierto no hay línea de base: el bicondicional que el esquema exige
  // (ledger_reopen_baseline_ck) se cumple aquí también, para que el dominio y la base no puedan
  // discrepar (FR-2010, TC-CDM-105e).
  const closure: Closure =
    reopened === null
      ? { closedThrough: target, reopened: null }
      : { closedThrough: target, reopened, reopenBaseline: prev.reopenBaseline };
  return { ok: true, closure, closed: target };
}

export type ReopenResult =
  | { ok: true; closure: Closure; reopened: PeriodKey }
  | { ok: false; reason: "nothing_closed" | "already_reopened" };

/**
 * Retrocede la frontera un mes y marca el mes liberado como reabierto.
 *
 * Al reabrir se FOTOGRAFÍA el saldo de cierre del mes liberado (FR-2010, ADR-15). Esa foto es el
 * referente de «valor anterior» del impacto: mientras el mes siga reabierto, cada corrección se
 * mide contra cómo estaba al reabrirlo — no contra la corrección anterior. Así cinco cambios
 * seguidos muestran el efecto NETO, que es lo que el usuario necesita para saber si se pasó.
 *
 * @aitri-trace FR-ID: FR-2005, US-ID: US-2005, AC-ID: AC-2015, TC-ID: TC-CDM-050h, TC-CDM-052f, TC-CDM-054f
 * @aitri-trace FR-ID: FR-2010, US-ID: US-2010, AC-ID: AC-2032, TC-ID: TC-CDM-105e
 */
export function reopenMonth(
  state: LedgerState, range: readonly PeriodKey[], prev: (p: PeriodKey) => PeriodKey = monthPrev
): ReopenResult {
  const c = closureOf(state);
  if (c.closedThrough === null) return { ok: false, reason: "nothing_closed" };
  if (c.reopened !== null) return { ok: false, reason: "already_reopened" };
  const target = c.closedThrough;
  // Feature ciclos (FLAG-1): la vecindad entra como parámetro para que retroceder desde «2026-11»
  // llegue a la transición «2026-10t» y no la salte (TC-CIC-086e).
  const back = prev(target);
  const reopenBaseline = closingCarry(state, range, target);
  return {
    ok: true,
    closure: { closedThrough: back, reopened: target, reopenBaseline },
    reopened: target,
  };
}

/**
 * FR-2010. Los meses posteriores al reabierto cuyas cifras se MOVIERON, con su antes y su después.
 *
 * Cómo se obtiene el «antes» sin guardar un snapshot: corriendo la MISMA serie sobre los MISMOS
 * meses posteriores, pero abriendo en la línea de base en vez de en el carry actual del mes
 * reabierto. Como los datos de los meses posteriores son idénticos en las dos corridas, la
 * diferencia aísla exactamente el efecto de lo que se tocó en el mes reabierto — y si el usuario
 * además editó octubre por su cuenta, eso NO aparece como impacto, porque está en las dos.
 *
 * No se resta un delta constante: el arrastre podría no ser lineal (las reservas tienen reglas
 * propias), así que se calcula de verdad (ADR-15, TC-CDM-100h).
 *
 * NO BLOQUEA NADA, y es una decisión del usuario recogida en el `no_go_zone`: informa dónde quedó
 * el daño y deja seguir. Bloquear añadiría más vigilancia automática —la que la feature aspira a
 * poder retirar— y puede encerrar al usuario (TC-CDM-103f prueba que la escritura se acepta).
 *
 * @aitri-trace FR-ID: FR-2010, US-ID: US-2010, AC-ID: AC-2032, TC-ID: TC-CDM-100h, TC-CDM-101e, TC-CDM-102f, TC-CDM-104f
 */
export function downstreamImpact(
  state: LedgerState,
  range: readonly PeriodKey[],
  closure?: Closure
): ImpactRow[] {
  const c = normalizeClosure(closure ?? state.closure);
  const { reopened, reopenBaseline } = c;
  if (reopened === null || !reopenBaseline) return [];

  const downstream = range.filter((p) => comparePeriods(p, reopened) > 0);
  if (downstream.length === 0) return [];

  const after = computeBalanceSeries(state, downstream, closingCarry(state, range, reopened));
  const before = computeBalanceSeries(state, downstream, reopenBaseline);

  const rows: ImpactRow[] = [];
  for (const period of downstream) {
    const a = after[period]?.actual;
    const b = before[period]?.actual;
    if (!a || !b || a.available === b.available) continue;
    rows.push({
      period,
      availableBefore: b.available,
      availableAfter: a.available,
      // Roto POR ESTA corrección: pasó de cubierto a descubierto. Un mes que ya arrastraba déficit
      // antes de reabrir no se le imputa (TC-CDM-102f).
      brokenByThisEdit: a.available < 0 && b.available >= 0,
    });
  }
  return rows;
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
