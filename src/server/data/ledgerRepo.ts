// @aitri-trace FR-ID: FR-505, US-ID: US-505, AC-ID: AC-505a, TC-ID: TC-BE-017h
/**
 * Module: server/data/ledgerRepo
 * Purpose: ÚNICA capa que toca la BD del ledger. Aislamiento estructural (FR-505): TODA función
 *   exige `ownerId` como primer parámetro y compone `WHERE owner_id = $1` por construcción — es
 *   imposible llamarla sin owner. Escritura por snapshot replace en UNA transacción con lock
 *   optimista por `revision` (ADR-06/FR-508): nunca deja un estado parcial. La escritura de un
 *   movimiento reutiliza la mutación pura COMPARTIDA del dominio (addMovement) — cero divergencia
 *   con el cliente (NFR-507).
 * Dependencies: drizzle-orm, ../db/client, @/domain
 */
import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, type DbTx } from "../db/client";
import { ledger, node, amountCell, movement, cellNote, closureEvent } from "../db/schema";
import type { AmountMap, CellNotesMap, LedgerNode, LedgerState, PeriodKey, Movement, NodeLevel, NodeType } from "@/domain";
import { addMovement, migrateStateV3toV4, migrateStateV4toV5, type NewMovement } from "@/domain";
import { comparePeriods, isPeriodKey, periodRange } from "@/domain/periods";
import { oldestPeriodWithData, newestPeriodWithData } from "@/domain/range";
import { worsenedBy } from "@/domain/guard";
import type { ReserveWarning } from "@/domain/reserve";
import {
  closedPeriodsViolated, closeMonth, isClosed, normalizeClosure, reopenMonth, NO_CLOSURE,
} from "@/domain/closure";
import { normalizeOpeningBalance, normalizeStartMonth, orphanedByStart } from "@/domain/opening";
import type { Closure } from "@/domain/types";

/** Versión de DATOS vigente (modelo v4, 2026-07-29): celdas = aportes; retiros en el journal.
 *  Historia: 2 = aportes sin journal de retiros · 3 = saldos con arrastre (revertido) · 4 = vigente. */
const DATA_VERSION_FLOWS = 4;
// Feature contrapartidas-reserva (FR-1604): el mover deja de escribir la celda del destino, asi
// que las celdas de un ledger v4 llevan dentro llegadas que ahora vienen del journal. v5 las quita.
const DATA_VERSION_COUNTERPARTY = 5;
const DATA_VERSION_BALANCES = 3;

/** Límite de filas por INSERT para no exceder el tope de parámetros de Postgres. */
const INSERT_CHUNK = 500;

export interface LoadResult {
  revision: number;
  state: LedgerState;
}

export type SaveResult =
  | { ok: true; revision: number }
  | { ok: false; conflict: true; revision: number }
  /** Feature cierre-de-mes (FR-2003): la escritura tocaba cifras de meses cerrados. */
  | { ok: false; closedViolation: true; periods: PeriodKey[] }
  /** Feature reglas-en-el-servidor (FR-2101): la escritura dejaba algún mes peor de lo que estaba. */
  | { ok: false; domainViolation: true; violations: ReserveWarning[] };

/** Reconstruye un LedgerState a partir de las filas de la BD de un owner. */
function rowsToState(
  ownerId: string,
  nodeRows: (typeof node.$inferSelect)[],
  cellRows: (typeof amountCell.$inferSelect)[],
  movementRows: (typeof movement.$inferSelect)[],
  cellNoteRows: (typeof cellNote.$inferSelect)[] = []
): LedgerState {
  const nodes: LedgerNode[] = nodeRows
    .map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      type: r.type as NodeType,
      level: r.level as NodeLevel,
      parentId: r.parentId,
      name: r.name,
      icon: r.icon,
      ...(r.system ? { system: true } : {}),
      order: r.sortOrder,
    }))
    .sort((a, b) => a.order - b.order);

  const budgets: AmountMap = {};
  const actuals: AmountMap = {};
  for (const c of cellRows) {
    const store = c.kind === "budget" ? budgets : actuals;
    (store[c.nodeId] ??= {})[c.period as PeriodKey] = c.amount;
  }

  const movements: Movement[] = movementRows.map((r) => ({
    id: r.id,
    ownerId: r.ownerId,
    type: r.type as NodeType,
    catId: r.catId,
    subId: r.subId,
    target: r.target,
    amount: r.amount,
    period: r.period as PeriodKey,
    createdAt: r.createdAt,
    ...(r.date != null ? { date: r.date } : {}),
    ...(r.note != null ? { note: r.note } : {}),
    // FR-1010: quinta capa del precedente date/note — sin esto los extremos se perderían al leer.
    ...(r.fromId != null ? { from: r.fromId } : {}),
    ...(r.toId != null ? { to: r.toId } : {}),
  }));

  // FR-1012: observaciones manuales por celda.
  const cellNotes: CellNotesMap = {};
  for (const r of cellNoteRows) {
    ((cellNotes[r.nodeId] ??= {})[r.period as PeriodKey] ??= []).push({ id: r.id, createdAt: r.createdAt, text: r.text });
  }
  for (const byMonth of Object.values(cellNotes)) {
    for (const list of Object.values(byMonth)) list?.sort((a, b) => a.createdAt - b.createdAt);
  }

  return { ownerId, nodes, budgets, actuals, movements, ...(cellNoteRows.length > 0 ? { cellNotes } : {}) };
}

/**
 * Carga el ledger de un usuario.
 * @param ownerId id del usuario autenticado (de la sesión, nunca del payload)
 * @returns { revision, state } o null si el usuario nunca persistió (→ el caller responde 204)
 */
export async function loadLedger(ownerId: string): Promise<LoadResult | null> {
  const [head] = await db.select().from(ledger).where(eq(ledger.ownerId, ownerId));
  if (!head) return null;

  // En modo servidor el DUEÑO de las migraciones de formato es el servidor — lazy, aquí.
  if (head.dataVersion < DATA_VERSION_COUNTERPARTY) {
    return migrateLedgerToV4(ownerId);
  }

  const [nodeRows, cellRows, movementRows, cellNoteRows] = await Promise.all([
    db.select().from(node).where(eq(node.ownerId, ownerId)),
    db.select().from(amountCell).where(eq(amountCell.ownerId, ownerId)),
    db
      .select()
      .from(movement)
      .where(eq(movement.ownerId, ownerId))
      .orderBy(desc(movement.createdAt)),
    db.select().from(cellNote).where(eq(cellNote.ownerId, ownerId)),
  ]);

  const state = rowsToState(ownerId, nodeRows, cellRows, movementRows, cellNoteRows);
  return {
    revision: head.revision,
    state: { ...state, closure: closureFromRow(head), ...openingFromRow(head) },
  };
}

/**
 * La APERTURA declarada de la fila ancla, normalizada (FR-2201/FR-2202).
 *
 * Se normaliza SIEMPRE por el mismo motivo que `closureFromRow`: los CHECK de la migracion 0006 son
 * una segunda barrera independiente, no la primera, y una fila escrita a mano por un operador o
 * anterior a la migracion no puede impedir que la app arranque. Un valor corrupto se comporta como
 * «no declarado», que es el estado seguro (TC-MSI-002f, TC-MSI-014f).
 *
 * @param head La fila de `ledger` del usuario.
 * @returns Los dos campos ya normalizados, listos para mezclar en el snapshot.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-2207, US-ID: US-2207, AC-ID: AC-2219, TC-ID: TC-MSI-060h, TC-MSI-062e
 */
function openingFromRow(head: { startMonth: string | null; openingBalance: number | null }): {
  startMonth: PeriodKey | null;
  openingBalance: number | null;
} {
  return {
    startMonth: normalizeStartMonth(head.startMonth),
    openingBalance: normalizeOpeningBalance(head.openingBalance),
  };
}

/**
 * El `closure` de la fila ancla, normalizado.
 *
 * Se normaliza SIEMPRE, aunque la base tenga CHECKs de formato: los CHECKs son una segunda barrera
 * independiente, no la primera, y una fila escrita antes de la migracion o a mano por un operador
 * no puede impedir que la app arranque (TC-CDM-013f).
 *
 * @aitri-trace FR-ID: FR-2001, US-ID: US-2001, AC-ID: AC-2001, TC-ID: TC-CDM-010h, TC-CDM-262e
 */
function closureFromRow(head: {
  closedThrough: string | null;
  reopenedPeriod: string | null;
  reopenBaseAvailable?: number | null;
  reopenBaseReserved?: number | null;
}): Closure {
  // La linea de base solo se ofrece si sus DOS componentes estan: `normalizeClosure` la descarta
  // entera si no cuadra, y nunca inventa un «antes» (FR-2010).
  const reopenBaseline =
    head.reopenBaseAvailable == null || head.reopenBaseReserved == null
      ? undefined
      : { available: head.reopenBaseAvailable, reservedBalance: head.reopenBaseReserved };
  return normalizeClosure({
    closedThrough: head.closedThrough,
    reopened: head.reopenedPeriod,
    reopenBaseline,
  });
}

/** Las dos columnas de la linea de base a partir de un `Closure` — el bicondicional del CHECK. */
function baselineColumns(closure: Closure): {
  reopenBaseAvailable: number | null;
  reopenBaseReserved: number | null;
} {
  const b = closure.reopened === null ? undefined : closure.reopenBaseline;
  return {
    reopenBaseAvailable: b ? b.available : null,
    reopenBaseReserved: b ? b.reservedBalance : null,
  };
}

/**
 * Migración lazy de DATOS al modelo v4, DENTRO de una transacción con `for update` sobre la fila
 * ancla — dos dispositivos que cargan a la vez se serializan y el re-check del marcador garantiza
 * que corre EXACTAMENTE una vez. Caminos:
 * · v2→v4: las celdas ya eran aportes — identidad; solo se estampa el marcador.
 * · v3→v4: se deshace el acumulado de saldos (deltas) y los deltas negativos entran al journal
 *   como retiros sintetizados (la historia operada no se pierde).
 * No destructiva: nodos, movimientos previos y celdas expense/income quedan intactos.
 *
 * @param ownerId usuario autenticado (el lock es por su fila ancla)
 * @returns el estado ya migrado con su revision
 * @throws Propaga errores de BD: la transacción revierte completa (sin estado parcial).
 *
 * @aitri-trace FR-ID: FR-1010, US-ID: US-1010, AC-ID: AC-1010b, TC-ID: TC-TRF-110e
 */
async function migrateLedgerToV4(ownerId: string): Promise<LoadResult | null> {
  return db.transaction(async (tx) => {
    const [head] = await tx.select().from(ledger).where(eq(ledger.ownerId, ownerId)).for("update");
    if (!head) return null;

    const [nodeRows, cellRows, movementRows, cellNoteRows] = await Promise.all([
      tx.select().from(node).where(eq(node.ownerId, ownerId)),
      tx.select().from(amountCell).where(eq(amountCell.ownerId, ownerId)),
      tx.select().from(movement).where(eq(movement.ownerId, ownerId)).orderBy(desc(movement.createdAt)),
      tx.select().from(cellNote).where(eq(cellNote.ownerId, ownerId)),
    ]);
    const state = rowsToState(ownerId, nodeRows, cellRows, movementRows, cellNoteRows);
    const migratedState = await ensureV4InTx(tx, ownerId, head.dataVersion, state);
    return { revision: head.revision, state: migratedState };
  });
}

/**
 * Garantiza el modelo v4 DENTRO de una transacción que ya tiene el lock de la fila ancla: si el
 * marcador está al día devuelve el estado tal cual (re-check post-lock); si es v2, solo estampa
 * (identidad); si es v3, deshace saldos, persiste celdas + retiros sintetizados y estampa — todo
 * en el commit del llamador. La comparten loadLedger e insertMovement (hallazgo adversarial 4:
 * un POST sobre un ledger v3 sin migrar leería saldos como aportes).
 */
async function ensureV4InTx(tx: DbTx, ownerId: string, dataVersion: number, state: LedgerState): Promise<LedgerState> {
  if (dataVersion >= DATA_VERSION_COUNTERPARTY) return state;

  // v2 = identidad (aportes ya); v3 = deshacer saldos + retiros sintetizados al journal.
  const migratedState: LedgerState = dataVersion === DATA_VERSION_BALANCES ? migrateStateV3toV4(state) : state;

  if (dataVersion === DATA_VERSION_BALANCES) {
    // Reemplazo de celdas + retiros sintetizados + marcador en el MISMO commit (todo o nada).
    await tx.delete(amountCell).where(eq(amountCell.ownerId, ownerId));
    const cellValues: (typeof amountCell.$inferInsert)[] = [];
    for (const [kind, map] of [
      ["budget", migratedState.budgets],
      ["actual", migratedState.actuals],
    ] as const) {
      for (const [nodeId, months] of Object.entries(map)) {
        for (const [month, amount] of Object.entries(months)) {
          if (amount == null) continue;
          cellValues.push({ ownerId, nodeId, period: month, kind, amount });
        }
      }
    }
    for (let i = 0; i < cellValues.length; i += INSERT_CHUNK) {
      const slice = cellValues.slice(i, i + INSERT_CHUNK);
      if (slice.length > 0) await tx.insert(amountCell).values(slice);
    }
    const newMovements = migratedState.movements.filter((m) => !state.movements.some((p) => p.id === m.id));
    for (const mv of newMovements) {
      await tx.insert(movement).values({
        ownerId,
        id: mv.id,
        type: mv.type,
        catId: mv.catId,
        subId: mv.subId,
        target: mv.target,
        amount: mv.amount,
        period: mv.period,
        createdAt: mv.createdAt,
        date: mv.date ?? null,
        note: mv.note ?? null,
        fromId: mv.from ?? null,
        toId: mv.to ?? null,
      });
    }
  }
  // ── v4 -> v5 (FR-1604): quitar de la celda del destino la llegada de cada MOVER ──────────────
  // Solo corre si el ledger venia por debajo de v5. Las celdas que cambian se reescriben una a una
  // (no un replace masivo): el conjunto afectado es pequeno —una fila por destino y mes con mover—
  // y asi la conversion no toca ni una celda que no le corresponda.
  const { state: v5State, residues } = migrateStateV4toV5(migratedState);
  if (residues.length > 0) {
    // [RISK-1] del diseno: la celda del destino se edito a la baja DESPUES del mover, asi que la
    // resta no cabia. Se acoto a 0 y el desvio se deja VISIBLE en vez de silencioso.
    console.warn(
      `[migracion v5] owner=${ownerId}: ${residues.length} celda(s) no cubrian su mover; acotadas a 0. ` +
        residues.map((r) => `${r.leafId}/${r.month} falto ${r.shortfall}`).join(" | ")
    );
  }
  for (const [leafId, months] of Object.entries(v5State.actuals)) {
    for (const [month, amount] of Object.entries(months ?? {})) {
      if (amount == null) continue;
      const previo = migratedState.actuals[leafId]?.[month as keyof typeof months];
      if (previo === amount) continue;
      await tx
        .insert(amountCell)
        .values({ ownerId, nodeId: leafId, period: month, kind: "actual", amount })
        .onConflictDoUpdate({
          target: [amountCell.ownerId, amountCell.nodeId, amountCell.period, amountCell.kind],
          set: { amount },
        });
    }
  }

  await tx
    .update(ledger)
    .set({ dataVersion: DATA_VERSION_COUNTERPARTY, updatedAt: new Date() })
    .where(eq(ledger.ownerId, ownerId));

  return v5State;
}

/** Inserta las filas derivadas de un LedgerState dentro de una transacción (owner ya fijado). */
async function insertSnapshot(tx: DbTx, ownerId: string, state: LedgerState): Promise<void> {
  const nodeValues = state.nodes.map((n) => ({
    ownerId,
    id: n.id,
    type: n.type,
    level: n.level,
    parentId: n.parentId,
    name: n.name,
    icon: n.icon,
    system: n.system ?? false,
    sortOrder: n.order,
  }));

  const cellValues: (typeof amountCell.$inferInsert)[] = [];
  for (const [kind, map] of [
    ["budget", state.budgets],
    ["actual", state.actuals],
  ] as const) {
    for (const [nodeId, months] of Object.entries(map)) {
      for (const [month, amount] of Object.entries(months)) {
        if (amount == null) continue;
        cellValues.push({ ownerId, nodeId, period: month, kind, amount });
      }
    }
  }

  const movementValues = state.movements.map((m) => ({
    ownerId,
    id: m.id,
    type: m.type,
    catId: m.catId,
    subId: m.subId,
    target: m.target,
    amount: m.amount,
    period: m.period,
    createdAt: m.createdAt,
    date: m.date ?? null,
    note: m.note ?? null,
    fromId: m.from ?? null,
    toId: m.to ?? null,
  }));

  for (let i = 0; i < nodeValues.length; i += INSERT_CHUNK) {
    const slice = nodeValues.slice(i, i + INSERT_CHUNK);
    if (slice.length > 0) await tx.insert(node).values(slice);
  }
  for (let i = 0; i < cellValues.length; i += INSERT_CHUNK) {
    const slice = cellValues.slice(i, i + INSERT_CHUNK);
    if (slice.length > 0) await tx.insert(amountCell).values(slice);
  }
  for (let i = 0; i < movementValues.length; i += INSERT_CHUNK) {
    const slice = movementValues.slice(i, i + INSERT_CHUNK);
    if (slice.length > 0) await tx.insert(movement).values(slice);
  }

  // FR-1012: observaciones por celda (quinta capa del snapshot).
  const noteValues: (typeof cellNote.$inferInsert)[] = [];
  for (const [nodeId, byMonth] of Object.entries(state.cellNotes ?? {})) {
    for (const [month, notes] of Object.entries(byMonth)) {
      for (const n of notes ?? []) {
        noteValues.push({ ownerId, nodeId, period: month, id: n.id, createdAt: n.createdAt, text: n.text });
      }
    }
  }
  for (let i = 0; i < noteValues.length; i += INSERT_CHUNK) {
    const slice = noteValues.slice(i, i + INSERT_CHUNK);
    if (slice.length > 0) await tx.insert(cellNote).values(slice);
  }
}

/**
 * Reemplaza el ledger completo de un usuario en UNA transacción, con lock optimista por revision.
 * @param ownerId usuario autenticado
 * @param state estado completo a persistir (el ownerId del payload se ignora: manda este parámetro)
 * @param baseRevision revisión que el cliente creía vigente
 * @returns { ok:true, revision } si aplicó; { ok:false, conflict:true, revision } si estaba stale (→409)
 */
/** Carga el estado del owner DENTRO de una transacción. Lo usan el guardia y las operaciones de cierre. */
async function loadStateInTx(tx: DbTx, ownerId: string): Promise<LedgerState> {
  const [nodeRows, cellRows, movementRows, cellNoteRows] = await Promise.all([
    tx.select().from(node).where(eq(node.ownerId, ownerId)),
    tx.select().from(amountCell).where(eq(amountCell.ownerId, ownerId)),
    tx.select().from(movement).where(eq(movement.ownerId, ownerId)).orderBy(desc(movement.createdAt)),
    tx.select().from(cellNote).where(eq(cellNote.ownerId, ownerId)),
  ]);
  return rowsToState(ownerId, nodeRows, cellRows, movementRows, cellNoteRows);
}

export async function saveLedger(
  ownerId: string,
  state: LedgerState,
  baseRevision: number
): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    // Bloquea la fila ancla para serializar escrituras concurrentes del MISMO usuario.
    const [head] = await tx.select().from(ledger).where(eq(ledger.ownerId, ownerId)).for("update");
    const current = head?.revision ?? 0;
    if (current !== baseRevision) {
      return { ok: false, conflict: true, revision: current };
    }

    // ── EL GUARDIA (FR-2003, NFR-2005) ────────────────────────────────────────────────────────
    // Corre AQUI: despues del `for update` y ANTES de la primera escritura, asi que no hay ventana
    // entre validar y escribir (TC-CDM-243h). Y compara contra el estado PERSISTIDO que lee el
    // propio servidor, no contra lo que el cliente afirme que habia: un cliente que mienta sobre
    // el estado previo no consigue nada (TC-CDM-038e).
    //
    // Es un PUNTO DE ESTRANGULAMIENTO (ADR-12), no una comprobacion por operacion: las seis vias
    // de escritura que FR-2003 enumera acaban todas en budgets, actuals o movements, asi que
    // compararlas las cubre a todas — y cubre las que aun no existen.
    //
    // ── EL GUARDIA DE DOMINIO (FR-2101, feature reglas-en-el-servidor) ────────────────────────
    // Antes de esta feature la ÚNICA validación de dominio del servidor era la del cierre: el techo
    // y el déficit vivían solo en el navegador, así que una peticion fabricada a mano escribía lo
    // que quisiera. La regla no se reescribe aquí — se LLAMA la misma que usa el cliente
    // (`worsenedBy` → `chainCheck`), que es lo que hace imposible que las dos divergan.
    //
    // El estado previo se carga UNA sola vez y lo comparten los dos guardias (NFR-2105): antes se
    // cargaba solo cuando había meses cerrados; ahora hace falta siempre.
    const closure = head ? closureFromRow(head) : NO_CLOSURE;
    const prev = head ? await loadStateInTx(tx, ownerId) : null;

    // ORDEN (ADR-19): el cierre PRIMERO y su rechazo corta. «Ese mes está cerrado» es una respuesta
    // completa: arreglar la reserva no desbloquearía nada, así que mandar al usuario a hacerlo
    // sería pedirle trabajo inútil.
    if (prev && closure.closedThrough !== null) {
      const violated = closedPeriodsViolated({ ...prev, closure }, state);
      if (violated.length > 0) return { ok: false, closedViolation: true, periods: violated };
    }

    if (prev) {
      // El rango juzgado es la UNIÓN de los dos alcances: un mes que la escritura estrena tiene que
      // entrar en el juicio, o crear un mes sería la puerta de escape (TC-RES-015e).
      const scope = unionScope(serverScope(prev), serverScope(state));
      const violations = worsenedBy(prev, state, scope);
      if (violations.length > 0) return { ok: false, domainViolation: true, violations };
    }

    // Snapshot replace: borra lo del owner y reinserta (owner fijado por parámetro, nunca del estado).
    await tx.delete(node).where(eq(node.ownerId, ownerId));
    await tx.delete(amountCell).where(eq(amountCell.ownerId, ownerId));
    await tx.delete(movement).where(eq(movement.ownerId, ownerId));
    await tx.delete(cellNote).where(eq(cellNote.ownerId, ownerId));
    await insertSnapshot(tx, ownerId, { ...state, ownerId });

    // El snapshot que llega ya habla semántica v3 (el cliente cargó migrado antes de escribir).
    // Estampar el marcador evita que un ledger nuevo (default 2) se "re-migre" — cumsum sobre
    // saldos sería la corrupción exacta que la marca existe para impedir (FR-1010).
    const revision = current + 1;
    if (head) {
      // OJO: `closedThrough`/`reopenedPeriod` NO se tocan aqui. El snapshot del cliente puede
      // traer un `closure`, pero el PUT del ledger no es la via para mover la frontera — solo la
      // mueven closeMonthFor/reopenMonthFor. Ignorarlo es lo que impide que alguien se abra un mes
      // bajandose la frontera en el mismo snapshot con el que lo edita.
      await tx
        .update(ledger)
        .set({ revision, updatedAt: new Date(), dataVersion: DATA_VERSION_COUNTERPARTY })
        .where(eq(ledger.ownerId, ownerId));
    } else {
      await tx.insert(ledger).values({ ownerId, revision, updatedAt: new Date(), dataVersion: DATA_VERSION_COUNTERPARTY });
    }
    return { ok: true, revision };
  });
}

/**
 * Lista los movimientos de un usuario (opcionalmente filtrados por mes), más nuevos primero.
 * @param ownerId usuario autenticado
 * @param period filtro opcional de periodo ("YYYY-MM")
 */
/**
 * El rango de periodos con el que el SERVIDOR valida (FR-1909).
 *
 * El servidor no conoce el horizonte que el usuario eligió en su navegador —es una preferencia de
 * presentación (ADR-06)— y no debe: lo que valida son las reglas del dominio sobre los periodos que
 * REALMENTE existen en el estado, más el periodo que la petición trae. Un rango más ancho no
 * cambiaría ningún veredicto: los periodos vacíos del final no acotan nada.
 */
/**
 * El rango que juzga el guardia: la unión de dos alcances, como rango CONTINUO.
 *
 * Continuo y no la simple concatenación porque el arrastre encadena: juzgar 2026-06 y 2026-09 sin
 * los meses de en medio daría un veredicto sobre una serie que no existe.
 */
function unionScope(a: readonly PeriodKey[], b: readonly PeriodKey[]): PeriodKey[] {
  const all = [...a, ...b];
  if (all.length === 0) return [];
  const from = all.reduce((x, y) => (comparePeriods(x, y) <= 0 ? x : y));
  const to = all.reduce((x, y) => (comparePeriods(x, y) >= 0 ? x : y));
  return periodRange(from, to);
}

function serverScope(state: LedgerState, extra?: PeriodKey): PeriodKey[] {
  const oldest = oldestPeriodWithData(state);
  const newest = newestPeriodWithData(state);
  const ends = [oldest, newest, extra].filter((p): p is PeriodKey => !!p && isPeriodKey(p));
  if (ends.length === 0) return extra && isPeriodKey(extra) ? [extra] : [];
  const from = ends.reduce((a, b) => (comparePeriods(a, b) <= 0 ? a : b));
  const to = ends.reduce((a, b) => (comparePeriods(a, b) >= 0 ? a : b));
  return periodRange(from, to);
}

export async function getMovements(ownerId: string, period?: PeriodKey): Promise<Movement[]> {
  const where = period
    ? and(eq(movement.ownerId, ownerId), eq(movement.period, period))
    : eq(movement.ownerId, ownerId);
  const rows = await db.select().from(movement).where(where).orderBy(desc(movement.createdAt));
  return rowsToState(ownerId, [], [], rows).movements;
}

/**
 * Lee un movimiento por id, SOLO si pertenece al usuario.
 * @returns el movimiento o null (el caller responde 404 indistinguible de inexistente, AC-505b)
 */
export async function getMovement(ownerId: string, id: string): Promise<Movement | null> {
  const rows = await db
    .select()
    .from(movement)
    .where(and(eq(movement.ownerId, ownerId), eq(movement.id, id)));
  const [mv] = rowsToState(ownerId, [], [], rows).movements;
  return mv ?? null;
}

/**
 * Inserta un movimiento ejecutando la mutación pura COMPARTIDA del dominio (addMovement — que para
 * type "transfer" delega en applyReserveOp, ADR-05) y persistiendo el DIFF COMPLETO de celdas
 * `actual` que la mutación produjo, en UNA transacción con bump de revision. Deja de asumir
 * "un movimiento = una celda": una operación De→A escribe hasta dos celdas (FR-1004); un fallo a
 * mitad revierte todo (sin estado parcial).
 * @param ownerId usuario autenticado
 * @param input datos del movimiento (validados en el borde por Zod antes de llegar aquí)
 * @returns { movement, revision } o null si el dominio rechazó (monto inválido, techo/piso, extremos inválidos)
 *
 * @aitri-trace FR-ID: FR-1004, US-ID: US-1004, AC-ID: AC-1004c, TC-ID: TC-TRF-304e
 */
export async function insertMovement(
  ownerId: string,
  input: NewMovement
): Promise<
  | { movement: Movement; revision: number }
  | { closedViolation: true }
  | { domainViolation: true; violations: ReserveWarning[] }
  | null
> {
  return db.transaction(async (tx) => {
    const [head] = await tx.select().from(ledger).where(eq(ledger.ownerId, ownerId)).for("update");
    if (!head) throw new Error("El usuario no tiene un ledger inicializado");

    // Cargar el estado del owner y correr la mutación pura del dominio (misma lógica que el cliente).
    const [nodeRows, cellRows, movementRows] = await Promise.all([
      tx.select().from(node).where(eq(node.ownerId, ownerId)),
      tx.select().from(amountCell).where(eq(amountCell.ownerId, ownerId)),
      tx.select().from(movement).where(eq(movement.ownerId, ownerId)).orderBy(asc(movement.createdAt)),
    ]);
    // Modelo v4 garantizado ANTES de operar: un ledger v3 sin migrar leería saldos como aportes
    // y aceptaría retiros del doble (hallazgo adversarial 4).
    const prev = await ensureV4InTx(tx, ownerId, head.dataVersion, rowsToState(ownerId, nodeRows, cellRows, movementRows));
    // El rango activo se deriva del propio estado más el periodo del movimiento: el servidor no
    // tiene la preferencia de horizonte del cliente, y no la necesita — lo que valida son las
    // reglas del dominio sobre los periodos que existen (ADR-02).
    // EL GUARDIA, segunda via de escritura (FR-2003). insertMovement no pasa por saveLedger, asi
    // que si no se comprobara aqui quedaria un agujero — y es justo el que FR-2003 nombra primero:
    // «registrar un movimiento nuevo con periodo de un mes cerrado» (TC-CDM-033f).
    const closure = closureFromRow(head);
    if (closure.closedThrough !== null) {
      const next0 = addMovement(prev, input, serverScope(prev, input.period));
      if (next0 !== prev && closedPeriodsViolated({ ...prev, closure }, next0).length > 0) {
        return { closedViolation: true as const };
      }
    }

    const next = addMovement(prev, input, serverScope(prev, input.period));
    if (next === prev) return null; // rechazado por el dominio (monto/extremos inválidos o techo/piso)

    // EL GUARDIA DE DOMINIO en la segunda vía (FR-2101). Un movimiento de tipo `transfer` ya venía
    // validado —`addMovement` delega en `applyReserveOp`, que aplica techo y piso y devuelve el
    // mismo estado al rechazar—, pero uno de INGRESO o GASTO no pasaba por ninguna comprobación:
    // ese era el agujero. Se juzga el estado resultante, no la operación, así que cubre las dos
    // clases con una sola llamada (TC-RES-016f).
    const scope = unionScope(serverScope(prev, input.period), serverScope(next, input.period));
    const violations = worsenedBy(prev, next, scope);
    if (violations.length > 0) return { domainViolation: true as const, violations };

    const mv = next.movements[0]; // addMovement hace unshift: el nuevo va primero
    await tx.insert(movement).values({
      ownerId,
      id: mv.id,
      type: mv.type,
      catId: mv.catId,
      subId: mv.subId,
      target: mv.target,
      amount: mv.amount,
      period: mv.period,
      createdAt: mv.createdAt,
      date: mv.date ?? null,
      note: mv.note ?? null,
      fromId: mv.from ?? null,
      toId: mv.to ?? null,
    });

    // Upsert de TODAS las celdas `actual` cuyo valor cambió con la mutación (diff completo):
    // un gasto/ingreso toca una; una operación de reserva De→A, hasta dos (FR-1004).
    for (const [nodeId, months] of Object.entries(next.actuals)) {
      for (const [month, amount] of Object.entries(months)) {
        if (amount == null || prev.actuals[nodeId]?.[month as PeriodKey] === amount) continue;
        await tx
          .insert(amountCell)
          .values({ ownerId, nodeId, period: month, kind: "actual", amount })
          .onConflictDoUpdate({
            target: [amountCell.ownerId, amountCell.nodeId, amountCell.period, amountCell.kind],
            set: { amount },
          });
      }
    }

    const revision = head.revision + 1;
    await tx.update(ledger).set({ revision, updatedAt: new Date() }).where(eq(ledger.ownerId, ownerId));
    return { movement: mv, revision };
  });
}

// ── Feature cierre-de-mes ────────────────────────────────────────────────────────────────────────

export type ClosureResult =
  | { ok: true; revision: number; closure: Closure }
  | { ok: false; conflict: true; revision: number }
  | { ok: false; rejected: "not_closable" | "nothing_closed" | "already_reopened" };

/**
 * Cierra el mes cerrable del usuario. El CLIENTE NO PROPONE cuál: el servidor lo deriva.
 *
 * Que la petición no lleve el periodo no es un detalle de comodidad — es lo que hace que un cierre
 * fuera de orden NO SEA EXPRESABLE en el protocolo (FR-2002, TC-CDM-022f). Misma filosofía que la
 * frontera escalar: preferir lo indecible a lo vigilado.
 *
 * @aitri-trace FR-ID: FR-2002, US-ID: US-2002, AC-ID: AC-2005, TC-ID: TC-CDM-010h, TC-CDM-023f, TC-CDM-081h
 */
export async function closeMonthFor(
  ownerId: string,
  baseRevision: number,
  currentPeriod: PeriodKey
): Promise<ClosureResult> {
  return db.transaction(async (tx) => {
    const [head] = await tx.select().from(ledger).where(eq(ledger.ownerId, ownerId)).for("update");
    const current = head?.revision ?? 0;
    if (!head || current !== baseRevision) return { ok: false, conflict: true, revision: current };

    const state = await loadStateInTx(tx, ownerId);
    // El SERVIDOR no conoce el horizonte del navegador (es preferencia de presentación, ADR-06):
    // valida sobre los periodos que REALMENTE existen más el mes en curso, igual que serverScope.
    const conCierre = { ...state, closure: closureFromRow(head) };
    const res = closeMonth(conCierre, currentPeriod, serverScope(conCierre, currentPeriod));
    if (!res.ok) return { ok: false, rejected: res.reason };

    const revision = current + 1;
    await tx
      .update(ledger)
      .set({
        revision,
        updatedAt: new Date(),
        closedThrough: res.closure.closedThrough,
        reopenedPeriod: res.closure.reopened,
        ...baselineColumns(res.closure),
      })
      .where(eq(ledger.ownerId, ownerId));
    // Dentro de la MISMA transacción: no existe un cierre sin rastro (TC-CDM-056f).
    await tx.insert(closureEvent).values({ ownerId, period: res.closed, action: "close" });
    return { ok: true, revision, closure: res.closure };
  });
}

/** Resultado de declarar la apertura (FR-2201/FR-2202/FR-2207). */
export type StartResult =
  | { ok: true; revision: number; startMonth: PeriodKey; openingBalance: number | null }
  | { ok: false; conflict: true; revision: number }
  | { ok: false; rejected: "month_closed" }
  | { ok: false; rejected: "would_orphan"; periods: PeriodKey[] };

/**
 * Declara el MES DE INICIO y el SALDO INICIAL del usuario, en una sola operacion y una sola
 * transaccion (ADR-02 del TRD).
 *
 * POR QUE UN ENDPOINT PROPIO Y NO EL PUT DEL SNAPSHOT. Las dos reglas de abajo son invariantes de
 * dominio, y NFR-2205 exige que se evaluen en el SERVIDOR. El proyecto tiene el contraejemplo
 * abierto: BG-002 documenta que `PUT /api/v1/ledger` acepta cualquier snapshot sin validar los
 * invariantes porque «la regla vive SOLO en el navegador». Aqui no se repite.
 *
 * Las dos reglas, ambas dentro de la transaccion y con la fila bloqueada:
 *   1. FR-2205 — el mes de inicio VIGENTE tiene que estar abierto. Cambiar la apertura recalcula
 *      toda la serie hacia adelante, incluidos meses que el usuario dio por buenos al cerrarlos.
 *   2. FR-2206 — mover el inicio hacia adelante no puede dejar meses con datos fuera del historial.
 *      Se impide, no se avisa: es el mismo principio de «cero perdida silenciosa» del borrado de
 *      categorias.
 *
 * @param ownerId        El usuario, tomado SIEMPRE de la sesion — nunca del cuerpo.
 * @param baseRevision   La revision que el cliente cree vigente (lock optimista).
 * @param startMonth     El mes de inicio propuesto, ya validado en forma por `startPutSchema`.
 * @param openingBalance El saldo de apertura, o null para «no traigo dinero previo».
 * @returns El resultado discriminado; nunca lanza por una regla de negocio.
 * @throws Solo errores de infraestructura de la base (los propaga la transaccion).
 *
 * @aitri-trace FR-ID: FR-2207, US-ID: US-2207, AC-ID: AC-2219, TC-ID: TC-MSI-041f, TC-MSI-051f, TC-MSI-060h, TC-MSI-061f
 */
export async function saveStartFor(
  ownerId: string,
  baseRevision: number,
  startMonth: PeriodKey,
  openingBalance: number | null
): Promise<StartResult> {
  return db.transaction(async (tx) => {
    const [head] = await tx.select().from(ledger).where(eq(ledger.ownerId, ownerId)).for("update");
    const current = head?.revision ?? 0;
    if (!head || current !== baseRevision) return { ok: false, conflict: true, revision: current };

    const state = await loadStateInTx(tx, ownerId);
    const closure = closureFromRow(head);

    // Regla 1 (FR-2205). Se evalua sobre el mes VIGENTE, no sobre el propuesto: lo que el cierre
    // protege es la serie ya congelada, y esa cuelga de donde la apertura esta HOY.
    const vigente = normalizeStartMonth(head.startMonth);
    if (vigente !== null && isClosed(closure, vigente)) {
      return { ok: false, rejected: "month_closed" };
    }

    // Regla 2 (FR-2206). Mover hacia atras nunca huerfana nada, y `orphanedByStart` lo refleja sin
    // caso especial: no habra ningun periodo anterior al candidato.
    const huerfanos = orphanedByStart(state, startMonth);
    if (huerfanos.length > 0) {
      return { ok: false, rejected: "would_orphan", periods: huerfanos };
    }

    const revision = current + 1;
    await tx
      .update(ledger)
      .set({ revision, updatedAt: new Date(), startMonth, openingBalance })
      .where(eq(ledger.ownerId, ownerId));
    return { ok: true, revision, startMonth, openingBalance };
  });
}

/**
 * Reabre el último mes cerrado. Uno a la vez: hay que volver a cerrarlo antes de reabrir otro, y
 * al cerrarlo el último cerrado vuelve a ser el mismo — así que un mes más antiguo nunca queda al
 * alcance (FR-2005/ADR-13, TC-CDM-053e).
 *
 * @aitri-trace FR-ID: FR-2005, US-ID: US-2005, AC-ID: AC-2015, TC-ID: TC-CDM-050h, TC-CDM-052f, TC-CDM-054f, TC-CDM-056f
 */
export async function reopenMonthFor(ownerId: string, baseRevision: number): Promise<ClosureResult> {
  return db.transaction(async (tx) => {
    const [head] = await tx.select().from(ledger).where(eq(ledger.ownerId, ownerId)).for("update");
    const current = head?.revision ?? 0;
    if (!head || current !== baseRevision) return { ok: false, conflict: true, revision: current };

    const state = await loadStateInTx(tx, ownerId);
    const conCierre = { ...state, closure: closureFromRow(head) };
    // El rango entra como parámetro (ADR-02) y es el mismo `serverScope` que usa el cierre: la
    // línea de base se calcula sobre los periodos que REALMENTE existen, no sobre el horizonte del
    // navegador, que el servidor no conoce.
    const res = reopenMonth(conCierre, serverScope(conCierre));
    if (!res.ok) return { ok: false, rejected: res.reason };

    const revision = current + 1;
    await tx
      .update(ledger)
      .set({
        revision,
        updatedAt: new Date(),
        closedThrough: res.closure.closedThrough,
        reopenedPeriod: res.closure.reopened,
        ...baselineColumns(res.closure),
      })
      .where(eq(ledger.ownerId, ownerId));
    await tx.insert(closureEvent).values({ ownerId, period: res.reopened, action: "reopen" });
    return { ok: true, revision, closure: res.closure };
  });
}

export interface ClosureEventRow {
  period: PeriodKey;
  action: "close" | "reopen";
  at: string;
}

export const CLOSURE_EVENTS_LIMIT = 200;

export interface ClosureEventPage {
  events: ClosureEventRow[];
  /** true si hay más historia de la que cabe en el tope: se DECLARA, no se oculta (TC-CDM-116e). */
  truncated: boolean;
}

/**
 * El rastro del usuario, más reciente primero. Solo lectura y SIEMPRE filtrado por su ownerId.
 *
 * Es lo que alimenta el historial que el usuario consulta (FR-2011). Sin paginación a propósito: un
 * producto de usuario único cierra ~12 veces al año, así que 200 filas son más de una década. Al
 * llegar al tope se devuelve `truncated: true` — mentir por omisión sería peor que el tope.
 *
 * El desempate por `id` no es cosmético: dos eventos del mismo instante dejarían el orden
 * indeterminado con `at` a solas, y el historial cambiaría de forma entre dos lecturas iguales.
 *
 * @aitri-trace FR-ID: FR-2005, US-ID: US-2005, AC-ID: AC-2018, TC-ID: TC-CDM-055h
 * @aitri-trace FR-ID: FR-2011, US-ID: US-2011, AC-ID: AC-2035, TC-ID: TC-CDM-110h, TC-CDM-111e, TC-CDM-112e, TC-CDM-116e
 */
export async function getClosureEvents(
  ownerId: string,
  limit = CLOSURE_EVENTS_LIMIT
): Promise<ClosureEventPage> {
  // Se pide UNA fila de más: si vuelve, hay historia más allá del tope. Es la forma barata de
  // saberlo sin un COUNT(*) aparte.
  const rows = await db
    .select()
    .from(closureEvent)
    .where(eq(closureEvent.ownerId, ownerId))
    .orderBy(desc(closureEvent.at), desc(closureEvent.id))
    .limit(limit + 1);
  const truncated = rows.length > limit;
  return {
    truncated,
    events: rows.slice(0, limit).map((r) => ({
      period: r.period as PeriodKey,
      action: r.action === "reopen" ? "reopen" : "close",
      at: r.at.toISOString(),
    })),
  };
}
