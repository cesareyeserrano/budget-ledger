/**
 * Module: tests/e2e/helpers/cycles
 * Purpose: Feature ciclos. Activar/cambiar/volver por la API con la cookie de la página, fijar «hoy»
 *   en el servidor (cabecera x-ledger-today, solo pruebas) y en el navegador (page.clock), y dejar
 *   la cuenta e2e en modo mes entre tests (las versiones son append-only: se borran por SQL).
 * Dependencies: ./pg
 */
import type { Page } from "@playwright/test";
import { db } from "./pg";

export async function resetCycles(email: string): Promise<void> {
  const c = db();
  if (!c) return;
  await c`DELETE FROM cycle_config_version WHERE owner_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  // Re-derivación 2026-09-10 (ADR-07): la memoria de origen tampoco sobrevive entre tests.
  await c`DELETE FROM relocation_origin WHERE owner_id IN (SELECT id FROM "user" WHERE email = ${email})`;
}

export type CycleTarget =
  | { mode: "month" }
  | { mode: "cycle"; anchorDay: number; eomPolicy?: "last_day" | "shift"; firstPayDate?: string };

/** PUT /api/v1/ledger/cycles con la revisión vigente. Lanza si el servidor rechaza. */
export async function applyCycles(page: Page, target: CycleTarget): Promise<number> {
  const current = await page.request.get("/api/v1/ledger");
  const baseRevision = current.status() === 200 ? ((await current.json()) as { revision: number }).revision : 0;
  const res = await page.request.put("/api/v1/ledger/cycles", {
    data: { baseRevision, target: target.mode === "cycle" ? { eomPolicy: "last_day", ...target } : target },
  });
  if (!res.ok()) throw new Error(`applyCycles falló: HTTP ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { revision: number }).revision;
}

/** Fija «hoy» en el servidor (cabecera de pruebas) y en el navegador (reloj falso). */
export async function fixToday(page: Page, iso: string): Promise<void> {
  await page.context().setExtraHTTPHeaders({ "x-ledger-today": iso });
  await page.clock.setFixedTime(new Date(`${iso}T12:00:00`));
}

/** POST /api/v1/closure con la revisión vigente. */
export async function closeViaApi(page: Page): Promise<number> {
  const current = await page.request.get("/api/v1/ledger");
  const baseRevision = ((await current.json()) as { revision: number }).revision;
  const res = await page.request.post("/api/v1/closure", { data: { baseRevision } });
  return res.status();
}
