/**
 * Module: src/server/data/cyclesRepo
 * Purpose: Feature ciclos (FR-2401, FR-2403, FR-2404, FR-2408, FR-2410; ADR-03/04/05). Las DOS
 *   operaciones sobre la configuración de ciclos: previsualizar (calcula, no escribe) y aplicar
 *   (transacción con FOR UPDATE, versión nueva, estado reubicado, invariantes, revision + 1). Las dos
 *   corren la MISMA función pura `relocate`: lo que la previsualización muestra es lo que se aplica.
 * Dependencies: ../db/client, ../db/schema, ./ledgerRepo (loadStateInTx, insertSnapshot,
 *   closureFromRow, baselineColumns, calendarOf), @/domain/cycles, ../clock
 */
import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { ledger, node, amountCell, movement, cellNote, cycleConfigVersion, relocationOrigin } from "../db/schema";
import {
  loadStateInTx, insertSnapshot, closureFromRow, baselineColumns, calendarOf,
} from "./ledgerRepo";
import {
  buildCalendar, boundsFor, planVersionChange, relocate, upcomingCycles, activationVersion, NO_CYCLES,
  type CycleTarget, type RelocationSummary, type Calendar,
} from "@/domain/cycles";
import { periodLabel, monthOf } from "@/domain/periods";
import { normalizeStartMonth } from "@/domain/opening";
import type { CycleConfig, LedgerState, PeriodKey } from "@/domain/types";
import { testFailAfter } from "../clock";

export type CyclesBlocked =
  | "closed_period" | "first_pay_required" | "first_pay_invalid" | "no_change" | "relocation_invariant";

export interface PreviewCycle {
  key: PeriodKey; label: string; start: string; end: string; transition: boolean; current: boolean;
}
export interface PreviewResult {
  cycles: PreviewCycle[];
  relocation: RelocationSummary & { note: string };
  cfg: CycleConfig;
}
export type CyclesResult<T> =
  | { ok: true; value: T }
  | { ok: false; conflict: true; revision: number }
  | { ok: false; blocked: CyclesBlocked; detail?: Record<string, unknown> };

/** El último día cerrado como fecha, para validar el primer pago nuevo (FR-2408). */
function closedEndOf(state: LedgerState, cal: Calendar): string | null {
  const c = state.closure?.closedThrough ?? null;
  if (!c) return null;
  const r = cal.rangeOf(c);
  if (r) return r.end;
  // Modo mes: último día del mes `c` = día 0 del mes siguiente en índice JS (sin aritmética de periodos).
  const m = monthOf(c);
  const y = Number(m.slice(0, 4)); const mo = Number(m.slice(5, 7));
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

/** Planifica + reubica, sin escribir. Compartido por preview y apply (ADR-04). */
function compute(state: LedgerState, target: CycleTarget, todayISO: string):
  | { ok: true; next: LedgerState; summary: RelocationSummary; cfg: CycleConfig; calTo: Calendar; version: ReturnType<typeof planVersionChange> }
  | { ok: false; blocked: CyclesBlocked; detail?: Record<string, unknown> } {
  const cfg = state.cycles ?? NO_CYCLES;
  const bounds = boundsFor(state, todayISO);
  const calFrom = buildCalendar(cfg, bounds);
  const plan = planVersionChange(cfg, target, {
    todayISO,
    closedEnd: closedEndOf(state, calFrom),
    restoreStartMonth: normalizeStartMonth(state.startMonth),
    bounds,
  });
  if ("blocked" in plan) return { ok: false, blocked: plan.blocked, detail: plan.detail };
  const calTo = buildCalendar(plan.cfg, bounds);
  const act = activationVersion(cfg);
  const r = relocate(state, calFrom, calTo, todayISO, { restoreStartMonth: act?.restoreStartMonth ?? null });
  if ("blocked" in r) return { ok: false, blocked: r.blocked, detail: r.detail };
  return { ok: true, next: r.state, summary: r.summary, cfg: plan.cfg, calTo, version: plan };
}

function noteFor(state: LedgerState, target: CycleTarget): string {
  if (target.mode === "month") return "Cada parte vuelve al mes en que la escribiste. Si cambiaste una celda que juntaba dos meses, la diferencia va al mes más reciente.";
  if (state.cycles && state.cycles.mode === "cycle") return "Las celdas conservan su columna; los movimientos se reasignan por su fecha.";
  return "Cada presupuesto queda en el mismo ciclo que lo que pagaste de ese rubro. Si un rubro tenía presupuesto en dos meses que caen en el mismo ciclo, se suman y se recuerda de qué mes vino cada parte.";
}

function previewCycles(cal: Calendar, todayISO: string): PreviewCycle[] {
  return upcomingCycles(cal, todayISO).map((c) => ({
    key: c.key,
    label: c.transition ? "Transición" : periodLabel(monthOf(c.key)),
    start: c.start, end: c.end, transition: c.transition, current: c.current,
  }));
}

/**
 * FR-2403. Previsualiza el cambio: los seis próximos ciclos y el resumen de la reubicación. No escribe.
 *
 * @aitri-trace FR-ID: FR-2403, US-ID: US-2403, AC-ID: AC-2409, TC-ID: TC-CIC-024h, TC-CIC-029e, TC-CIC-171f
 */
export async function previewCyclesFor(ownerId: string, target: CycleTarget, todayISO: string): Promise<CyclesResult<PreviewResult>> {
  return db.transaction(async (tx) => {
    const [head] = await tx.select().from(ledger).where(eq(ledger.ownerId, ownerId));
    if (!head) return { ok: false, blocked: "no_change" };
    const base = await loadStateInTx(tx, ownerId);
    const state: LedgerState = { ...base, closure: closureFromRow(head, calendarOf(base)), startMonth: normalizeStartMonth(head.startMonth), openingBalance: head.openingBalance };
    const c = compute(state, target, todayISO);
    if (!c.ok) return c;
    return { ok: true, value: { cycles: previewCycles(c.calTo, todayISO), relocation: { ...c.summary, note: noteFor(state, target) }, cfg: c.cfg } };
  });
}

/**
 * FR-2404 / FR-2408 / FR-2410. Aplica el cambio en UNA transacción: FOR UPDATE sobre ledger,
 * baseRevision, INSERT de la versión, estado reubicado (borrar-e-insertar, el camino de saveLedger),
 * fronteras de cierre y mes de inicio, revision + 1, y las sumas re-verificadas en SQL antes del COMMIT.
 * Cualquier excepción o invariante rota ⇒ ROLLBACK: o todo o nada.
 *
 * @aitri-trace FR-ID: FR-2404, US-ID: US-2404, AC-ID: AC-2412, TC-ID: TC-CIC-037h, TC-CIC-032f, TC-CIC-158e
 * @aitri-trace FR-ID: FR-2410, US-ID: US-2410, AC-ID: AC-2433, TC-ID: TC-CIC-090h, TC-CIC-095f
 */
export async function applyCyclesFor(
  ownerId: string, baseRevision: number, target: CycleTarget, todayISO: string
): Promise<CyclesResult<{ revision: number; cycles: CycleConfig; summary: RelocationSummary }>> {
  return db.transaction(async (tx) => {
    const [head] = await tx.select().from(ledger).where(eq(ledger.ownerId, ownerId)).for("update");
    const current = head?.revision ?? 0;
    if (!head || current !== baseRevision) return { ok: false, conflict: true, revision: current };
    const base = await loadStateInTx(tx, ownerId);
    const state: LedgerState = { ...base, closure: closureFromRow(head, calendarOf(base)), startMonth: normalizeStartMonth(head.startMonth), openingBalance: head.openingBalance };
    const c = compute(state, target, todayISO);
    if (!c.ok) return c;
    const plan = c.version;
    if ("blocked" in plan) return { ok: false, blocked: plan.blocked };

    const sumBefore = await sums(tx, ownerId);
    const v = plan.version;
    await tx.insert(cycleConfigVersion).values({
      ownerId, mode: v.mode, anchorDay: v.anchorDay, eomPolicy: v.eomPolicy,
      effectiveFrom: v.effectiveFrom, firstPay: v.firstPay, restoreStartMonth: v.restoreStartMonth,
    });
    testFailAfter("first_insert");
    await tx.delete(node).where(eq(node.ownerId, ownerId));
    await tx.delete(amountCell).where(eq(amountCell.ownerId, ownerId));
    await tx.delete(movement).where(eq(movement.ownerId, ownerId));
    await tx.delete(cellNote).where(eq(cellNote.ownerId, ownerId));
    await insertSnapshot(tx, ownerId, { ...c.next, ownerId });
    // ADR-07: la memoria de origen se reemplaza entera con la del estado reubicado — la escribe la
    // activación, la vacía la vuelta a mes y el cambio de día la conserva.
    await tx.delete(relocationOrigin).where(eq(relocationOrigin.ownerId, ownerId));
    const originRows = (c.next.origins ?? []).map((o) => ({ ownerId, subject: o.subject, ref: o.ref, period: o.period, originPeriod: o.originPeriod, amount: o.amount }));
    for (let i = 0; i < originRows.length; i += 500) await tx.insert(relocationOrigin).values(originRows.slice(i, i + 500));
    const closure = c.next.closure ?? { closedThrough: null, reopened: null };
    const revision = current + 1;
    await tx.update(ledger).set({
      revision, updatedAt: new Date(),
      startMonth: c.next.startMonth ?? null,
      closedThrough: closure.closedThrough, reopenedPeriod: closure.reopened, ...baselineColumns(closure),
    }).where(eq(ledger.ownerId, ownerId));
    const sumAfter = await sums(tx, ownerId);
    if (sumBefore.budget !== sumAfter.budget || sumBefore.actual !== sumAfter.actual || sumBefore.movements !== sumAfter.movements) {
      throw new Error(`relocation_invariant: sumas distintas tras escribir (${JSON.stringify(sumBefore)} vs ${JSON.stringify(sumAfter)})`);
    }
    const versions = c.cfg.versions.map((x, i) => (i === c.cfg.versions.length - 1 ? { ...x } : x));
    return { ok: true, value: { revision, cycles: { mode: c.cfg.mode, versions }, summary: c.summary } };
  });
}

async function sums(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ownerId: string): Promise<{ budget: number; actual: number; movements: number }> {
  const [cells] = await tx.execute(sql`SELECT
      COALESCE(SUM(CASE WHEN kind = 'budget' THEN amount ELSE 0 END), 0)::bigint AS budget,
      COALESCE(SUM(CASE WHEN kind = 'actual' THEN amount ELSE 0 END), 0)::bigint AS actual
    FROM amount_cell WHERE owner_id = ${ownerId}`) as unknown as Array<{ budget: string | number; actual: string | number }>;
  const [mv] = await tx.execute(sql`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM movement WHERE owner_id = ${ownerId}`) as unknown as Array<{ total: string | number }>;
  return { budget: Number(cells?.budget ?? 0), actual: Number(cells?.actual ?? 0), movements: Number(mv?.total ?? 0) };
}
