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
import { ledger, node, amountCell, movement, cellNote } from "../db/schema";
import type { AmountMap, CellNotesMap, LedgerNode, LedgerState, MonthKey, Movement, NodeLevel, NodeType } from "@/domain";
import { addMovement, migrateStateV3toV4, type NewMovement } from "@/domain";

/** Versión de DATOS vigente (modelo v4, 2026-07-29): celdas = aportes; retiros en el journal.
 *  Historia: 2 = aportes sin journal de retiros · 3 = saldos con arrastre (revertido) · 4 = vigente. */
const DATA_VERSION_FLOWS = 4;
const DATA_VERSION_BALANCES = 3;

/** Límite de filas por INSERT para no exceder el tope de parámetros de Postgres. */
const INSERT_CHUNK = 500;

export interface LoadResult {
  revision: number;
  state: LedgerState;
}

export type SaveResult =
  | { ok: true; revision: number }
  | { ok: false; conflict: true; revision: number };

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
    (store[c.nodeId] ??= {})[c.month as MonthKey] = c.amount;
  }

  const movements: Movement[] = movementRows.map((r) => ({
    id: r.id,
    ownerId: r.ownerId,
    type: r.type as NodeType,
    catId: r.catId,
    subId: r.subId,
    target: r.target,
    amount: r.amount,
    month: r.month as MonthKey,
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
    ((cellNotes[r.nodeId] ??= {})[r.month as MonthKey] ??= []).push({ id: r.id, createdAt: r.createdAt, text: r.text });
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
  if (head.dataVersion < DATA_VERSION_FLOWS) {
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

  return { revision: head.revision, state: rowsToState(ownerId, nodeRows, cellRows, movementRows, cellNoteRows) };
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
  if (dataVersion >= DATA_VERSION_FLOWS) return state;

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
          cellValues.push({ ownerId, nodeId, month, kind, amount });
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
        month: mv.month,
        createdAt: mv.createdAt,
        date: mv.date ?? null,
        note: mv.note ?? null,
        fromId: mv.from ?? null,
        toId: mv.to ?? null,
      });
    }
  }
  await tx
    .update(ledger)
    .set({ dataVersion: DATA_VERSION_FLOWS, updatedAt: new Date() })
    .where(eq(ledger.ownerId, ownerId));

  return migratedState;
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
        cellValues.push({ ownerId, nodeId, month, kind, amount });
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
    month: m.month,
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
        noteValues.push({ ownerId, nodeId, month, id: n.id, createdAt: n.createdAt, text: n.text });
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
      await tx
        .update(ledger)
        .set({ revision, updatedAt: new Date(), dataVersion: DATA_VERSION_FLOWS })
        .where(eq(ledger.ownerId, ownerId));
    } else {
      await tx.insert(ledger).values({ ownerId, revision, updatedAt: new Date(), dataVersion: DATA_VERSION_FLOWS });
    }
    return { ok: true, revision };
  });
}

/**
 * Lista los movimientos de un usuario (opcionalmente filtrados por mes), más nuevos primero.
 * @param ownerId usuario autenticado
 * @param month filtro opcional de mes
 */
export async function getMovements(ownerId: string, month?: MonthKey): Promise<Movement[]> {
  const where = month
    ? and(eq(movement.ownerId, ownerId), eq(movement.month, month))
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
): Promise<{ movement: Movement; revision: number } | null> {
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
    const next = addMovement(prev, input);
    if (next === prev) return null; // rechazado por el dominio (monto/extremos inválidos o techo/piso)

    const mv = next.movements[0]; // addMovement hace unshift: el nuevo va primero
    await tx.insert(movement).values({
      ownerId,
      id: mv.id,
      type: mv.type,
      catId: mv.catId,
      subId: mv.subId,
      target: mv.target,
      amount: mv.amount,
      month: mv.month,
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
        if (amount == null || prev.actuals[nodeId]?.[month as MonthKey] === amount) continue;
        await tx
          .insert(amountCell)
          .values({ ownerId, nodeId, month, kind: "actual", amount })
          .onConflictDoUpdate({
            target: [amountCell.ownerId, amountCell.nodeId, amountCell.month, amountCell.kind],
            set: { amount },
          });
      }
    }

    const revision = head.revision + 1;
    await tx.update(ledger).set({ revision, updatedAt: new Date() }).where(eq(ledger.ownerId, ownerId));
    return { movement: mv, revision };
  });
}
