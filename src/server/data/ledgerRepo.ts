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
import { ledger, node, amountCell, movement } from "../db/schema";
import type { AmountMap, LedgerNode, LedgerState, MonthKey, Movement, NodeLevel, NodeType } from "@/domain";
import { addMovement, type NewMovement } from "@/domain";

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
  movementRows: (typeof movement.$inferSelect)[]
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
  }));

  return { ownerId, nodes, budgets, actuals, movements };
}

/**
 * Carga el ledger de un usuario.
 * @param ownerId id del usuario autenticado (de la sesión, nunca del payload)
 * @returns { revision, state } o null si el usuario nunca persistió (→ el caller responde 204)
 */
export async function loadLedger(ownerId: string): Promise<LoadResult | null> {
  const [head] = await db.select().from(ledger).where(eq(ledger.ownerId, ownerId));
  if (!head) return null;

  const [nodeRows, cellRows, movementRows] = await Promise.all([
    db.select().from(node).where(eq(node.ownerId, ownerId)),
    db.select().from(amountCell).where(eq(amountCell.ownerId, ownerId)),
    db
      .select()
      .from(movement)
      .where(eq(movement.ownerId, ownerId))
      .orderBy(desc(movement.createdAt)),
  ]);

  return { revision: head.revision, state: rowsToState(ownerId, nodeRows, cellRows, movementRows) };
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
    await insertSnapshot(tx, ownerId, { ...state, ownerId });

    const revision = current + 1;
    if (head) {
      await tx
        .update(ledger)
        .set({ revision, updatedAt: new Date() })
        .where(eq(ledger.ownerId, ownerId));
    } else {
      await tx.insert(ledger).values({ ownerId, revision, updatedAt: new Date() });
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
 * Inserta un movimiento ejecutando la mutación pura COMPARTIDA del dominio (addMovement) y
 * persistiendo el delta (movimiento + celda actual) en una transacción; bump de revision.
 * @param ownerId usuario autenticado
 * @param input datos del movimiento (validados en el borde por Zod antes de llegar aquí)
 * @returns { movement, revision } o null si el input fue rechazado por el dominio (monto inválido/sin categoría)
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
    const prev = rowsToState(ownerId, nodeRows, cellRows, movementRows);
    const next = addMovement(prev, input);
    if (next === prev) return null; // rechazado por el dominio (monto inválido / sin categoría)

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
    });

    // Upsert de la celda actual afectada (target/month) con el nuevo total del dominio.
    const newActual = next.actuals[mv.target]?.[mv.month] ?? 0;
    await tx
      .insert(amountCell)
      .values({ ownerId, nodeId: mv.target, month: mv.month, kind: "actual", amount: newActual })
      .onConflictDoUpdate({
        target: [amountCell.ownerId, amountCell.nodeId, amountCell.month, amountCell.kind],
        set: { amount: newActual },
      });

    const revision = head.revision + 1;
    await tx.update(ledger).set({ revision, updatedAt: new Date() }).where(eq(ledger.ownerId, ownerId));
    return { movement: mv, revision };
  });
}
