/**
 * BG-065 — Configuración usa el mismo inicio que el servidor para bloquear el saldo inicial.
 *
 * Antes la pantalla miraba el mes DECLARADO, y sin declaración tomaba «hoy»: con el mes anterior
 * cerrado y nada declarado dejaba editar una apertura que movía su saldo. Ahora mira el inicio
 * efectivo (el primero con datos) y, además, avisa si el mes ELEGIDO está cerrado.
 *
 * Los escenarios se anclan en el mes ANTERIOR al en curso, que siempre es pasado y siempre se puede
 * cerrar: la suite no admite `test.skip` (TC-MAN-202f), así que no puede depender de la fecha.
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import { monthPrev, periodMonthLabel, periodYear } from "@/domain/periods";
import type { LedgerNode, PeriodKey } from "@/domain/types";

const DESK = { width: 1440, height: 900 };
const HOY = new Date();
const ACTUAL = `${HOY.getFullYear()}-${String(HOY.getMonth() + 1).padStart(2, "0")}` as PeriodKey;
const ANTERIOR = monthPrev(ACTUAL);

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sueldo", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Sueldo", icon: null, order: 1 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "c-comida", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Comida", icon: null, order: 3 },
];

async function revision(page: Page): Promise<number> {
  return ((await (await page.request.get("/api/v1/ledger")).json()) as { revision: number }).revision;
}

/** Cierra el mes cerrable y devuelve lo que el servidor dejó: la frontera y el inicio declarado. */
async function cerrarUnMes(page: Page): Promise<{ closedThrough: string | null; startMonth: string | null }> {
  const cierre = await page.request.post("/api/v1/closure", { data: { baseRevision: await revision(page) } });
  expect(cierre.ok(), await cierre.text()).toBe(true);
  const l = (await (await page.request.get("/api/v1/ledger")).json()) as {
    state: { closure?: { closedThrough: string | null }; startMonth?: string | null };
  };
  return { closedThrough: l.state.closure?.closedThrough ?? null, startMonth: l.state.startMonth ?? null };
}

/** Elige año y mes en los selectores de «Mes de inicio». */
async function elegirMes(page: Page, p: PeriodKey): Promise<void> {
  await page.getByTestId("config-year-select").click();
  await page.getByRole("option", { name: String(periodYear(p)), exact: true }).click();
  await page.getByTestId("config-month-select").click();
  await page.getByRole("option", { name: periodMonthLabel(p), exact: true }).click();
}

const enFrase = (p: PeriodKey) => `${periodMonthLabel(p).toLocaleLowerCase("es")} de ${periodYear(p)}`;

test("BG-065: sin inicio declarado y con el primer mes con datos cerrado, el saldo inicial llega bloqueado", async ({ page }) => {
  await page.setViewportSize(DESK);
  await seedLedger(page, { nodes: NODES, actuals: { "c-comida": { [ANTERIOR]: 40_000 } } });
  // Precondición: nada declarado y el mes anterior (el primero con datos) cerrado.
  expect(await cerrarUnMes(page)).toEqual({ closedThrough: ANTERIOR, startMonth: null });

  await page.goto("/configuracion");
  await expect(page.getByTestId("config-opening")).toBeDisabled();
  const aviso = page.getByTestId("config-blocked");
  await expect(aviso).toBeVisible();
  // Nombra el mes que de verdad bloquea, no el mes en curso.
  await expect(aviso).toContainText(`${enFrase(ANTERIOR)} está cerrado`);
  await expect(page.getByTestId("config-save")).toBeDisabled();
});

test("BG-065: si el mes elegido está cerrado, se avisa y no se puede guardar; con el vigente abierto, no", async ({ page }) => {
  await page.setViewportSize(DESK);
  // Inicio declarado en el mes en curso y, después, un dato ANTERIOR (FR-1906 lo permite), cerrado.
  await seedLedger(page, { nodes: NODES });
  const declarado = await page.request.put("/api/v1/ledger/start", {
    data: { baseRevision: await revision(page), startMonth: ACTUAL, openingBalance: 1_000_000 },
  });
  expect(declarado.ok(), await declarado.text()).toBe(true);
  await seedLedger(page, { nodes: NODES, actuals: { "c-comida": { [ANTERIOR]: 40_000 } } });
  expect(await cerrarUnMes(page)).toEqual({ closedThrough: ANTERIOR, startMonth: ACTUAL });

  await page.goto("/configuracion");
  // El inicio vigente está abierto: el campo NO llega bloqueado y no hay aviso.
  const aviso = page.getByTestId("config-start-closed");
  await expect(page.getByTestId("config-opening")).toBeEnabled();
  await expect(aviso).toHaveCount(0);

  // Elegir el mes anterior (cerrado) avisa y deshabilita Guardar.
  await elegirMes(page, ANTERIOR);
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText(`${enFrase(ANTERIOR)} está cerrado`);
  await expect(page.getByTestId("config-save")).toBeDisabled();

  // Volver al mes vigente quita el aviso.
  await elegirMes(page, ACTUAL);
  await expect(aviso).toHaveCount(0);
});
