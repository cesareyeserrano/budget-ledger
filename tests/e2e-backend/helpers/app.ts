// @aitri-trace FR-ID: FR-513, US-ID: US-513, AC-ID: AC-513a, TC-ID: TC-BE-043h
/**
 * Module: tests/e2e-backend/helpers/app
 * Purpose: Helpers de los e2e del backend: registrar/loguear un usuario por la UI real, esperar la
 *   grilla, crear un movimiento vía la API en el contexto del navegador, y leer el estado en vivo del
 *   store (seam window.__ledgerStore). Emails únicos por test para aislar cuentas.
 * Dependencies: @playwright/test
 */
import { type Page, expect } from "@playwright/test";

let seq = 0;
export function uniqueEmail(prefix = "user"): string {
  seq += 1;
  return `${prefix}-${seq}-${process.pid}@example.com`;
}

export const PASSWORD = "Contra$eña123";

/** Espera a que la grilla (shell autenticado) esté montada. */
export async function waitForGrid(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Presupuesto" })).toBeVisible({ timeout: 45_000 });
}

/** Envía el form y, tras la respuesta de auth, recarga para leer la sesión limpia desde la cookie. */
async function submitAndSettle(page: Page, authPath: string): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes(authPath), { timeout: 30_000 }).catch(() => null),
    page.getByTestId("auth-submit").click(),
  ]);
  // Recargar elimina la carrera de refresco de sesión de la SPA: con la cookie puesta, un load fresco
  // resuelve la sesión de forma determinista (get-session en el mount) → grilla.
  await page.reload();
  await waitForGrid(page);
}

/** Registra un usuario nuevo por la UI y espera la grilla. */
export async function register(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("auth-toggle").click(); // pasar a "registrar"
  await page.getByTestId("auth-name").fill(email.split("@")[0]);
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(PASSWORD);
  await submitAndSettle(page, "/api/auth/sign-up/email");
}

/** Inicia sesión de un usuario existente por la UI y espera la grilla. */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(PASSWORD);
  await submitAndSettle(page, "/api/auth/sign-in/email");
}

/** Crea un movimiento vía la API en el contexto (cookies) del navegador. Devuelve el status HTTP. */
export async function createMovementViaApi(page: Page, amount: number, month = "jun"): Promise<number> {
  return page.evaluate(
    async ({ amount, month }) => {
      const res = await fetch("/api/v1/movements", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount, month }),
      });
      return res.status;
    },
    { amount, month }
  );
}

/** Número de movimientos en el store en vivo (observa el estado, incl. actualizaciones por SSE). */
export async function movementCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __ledgerStore?: { getState: () => { data: { movements: unknown[] } } } };
    return w.__ledgerStore?.getState().data.movements.length ?? -1;
  });
}

/** ¿Existe un movimiento con este monto en el store en vivo? */
export async function hasMovementAmount(page: Page, amount: number): Promise<boolean> {
  return page.evaluate((amt) => {
    const w = window as unknown as { __ledgerStore?: { getState: () => { data: { movements: { amount: number }[] } } } };
    return (w.__ledgerStore?.getState().data.movements ?? []).some((m) => m.amount === amt);
  }, amount);
}

/** Valor de Ejecutado (actual) de un nodo/mes en el store en vivo. */
export async function actualFor(page: Page, nodeId: string, month: string): Promise<number> {
  return page.evaluate(
    ({ nodeId, month }) => {
      const w = window as unknown as { __ledgerStore?: { getState: () => { data: { actuals: Record<string, Record<string, number>> } } } };
      return w.__ledgerStore?.getState().data.actuals?.[nodeId]?.[month] ?? 0;
    },
    { nodeId, month }
  );
}

/** Snapshot de localStorage como objeto plano. */
export async function dumpLocalStorage(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out[k] = localStorage.getItem(k) ?? "";
    }
    return out;
  });
}
