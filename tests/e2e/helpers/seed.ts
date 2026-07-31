/**
 * Module: tests/e2e/helpers/seed
 * Purpose: Siembra el ledger de la cuenta e2e a través de la API autenticada.
 *
 *   Reemplaza el mecanismo anterior —`page.addInitScript(() => localStorage.setItem("ledger.nodes.v1", …))`—
 *   que dejó de funcionar al retirar el almacén de localStorage (feature servidor-fuente-unica,
 *   FR-1104). Sembrar por la API es además más fiel: es el mismo camino que recorre un dato real,
 *   así que un fallo del contrato de escritura sale aquí en vez de esconderse tras una siembra
 *   sintética que ningún usuario ejecuta.
 *
 * Dependencies: @playwright/test
 */
import type { Page } from "@playwright/test";
import type { LedgerNode, AmountMap, Movement } from "@/domain/types";

export interface SeedInput {
  nodes: LedgerNode[];
  budgets?: AmountMap;
  actuals?: AmountMap;
  movements?: Movement[];
  cellNotes?: Record<string, Record<string, string>>;
}

/**
 * Escribe el estado completo del ledger de la cuenta e2e. Debe llamarse ANTES de `page.goto`,
 * porque la app hidrata al montar el gate.
 *
 * Lee la revisión vigente primero: el PUT usa lock optimista y un `baseRevision` obsoleto
 * devolvería 409 (el mismo mecanismo que protege al usuario de escrituras concurrentes).
 */
export async function seedLedger(page: Page, input: SeedInput): Promise<void> {
  const ctx = page.request;

  const current = await ctx.get("/api/v1/ledger");
  const baseRevision = current.status() === 200 ? ((await current.json()) as { revision: number }).revision : 0;

  const state = {
    ownerId: "local",
    nodes: input.nodes,
    budgets: input.budgets ?? {},
    actuals: input.actuals ?? {},
    movements: input.movements ?? [],
    ...(input.cellNotes ? { cellNotes: input.cellNotes } : {}),
  };

  const res = await ctx.put("/api/v1/ledger", { data: { baseRevision, state } });
  if (!res.ok()) {
    throw new Error(`seedLedger falló: HTTP ${res.status()} ${await res.text()}`);
  }
}

/**
 * Lee el estado, aplica `mutate` sobre sus nodos y lo vuelve a escribir.
 *
 * Sustituye al patrón `page.evaluate(() => { leer ledger.nodes.v1 → mutar → escribir })` que usaban
 * los tests para inyectar nodos o corromper un icono. Tras la escritura hay que recargar para que
 * la app re-hidrate, igual que antes.
 */
export async function mutateNodes(page: Page, mutate: (nodes: LedgerNode[]) => void): Promise<void> {
  const res = await page.request.get("/api/v1/ledger");
  if (res.status() !== 200) throw new Error(`mutateNodes: no se pudo leer el ledger (HTTP ${res.status()})`);
  const body = (await res.json()) as { revision: number; state: SeedInput & { nodes: LedgerNode[] } };

  mutate(body.state.nodes);

  const put = await page.request.put("/api/v1/ledger", {
    data: { baseRevision: body.revision, state: body.state },
  });
  if (!put.ok()) throw new Error(`mutateNodes falló: HTTP ${put.status()} ${await put.text()}`);
}

/** Lee el estado vigente del servidor — sustituye a leer `ledger.budget.v4` de localStorage. */
export async function readLedger(page: Page): Promise<{
  budgets: AmountMap;
  actuals: AmountMap;
  movements: Movement[];
} | null> {
  const res = await page.request.get("/api/v1/ledger");
  if (res.status() !== 200) return null;
  const body = (await res.json()) as { state: { budgets: AmountMap; actuals: AmountMap; movements: Movement[] } };
  return body.state;
}
