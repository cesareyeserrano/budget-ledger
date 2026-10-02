/**
 * BG-082 — salir del editor de una celda por el Detalle guarda lo tecleado, igual que el clic fuera.
 *
 * Solo el blur del campo del valor guardaba. Con el foco en el Detalle (un comentario, un botón), un
 * Tab a otra celda y Enter abrían la otra, y lo tecleado en la primera se perdía sin aviso.
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import type { LedgerNode, PeriodKey } from "@/domain/types";

const HOY = new Date();
const ACTUAL = `${HOY.getFullYear()}-${String(HOY.getMonth() + 1).padStart(2, "0")}` as PeriodKey;

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 1 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 0 },
  { id: "c-luz", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Luz", icon: null, order: 1 },
];

const celda = (page: Page, id: string) =>
  page.locator(`[data-testid="cell-leaf"][data-cell="${id}"][data-month="${ACTUAL}"][data-plane="budget"]`);

async function presupuesto(page: Page, id: string): Promise<number | undefined> {
  const l = (await (await page.request.get("/api/v1/ledger")).json()) as { state: { budgets: Record<string, Record<string, number>> } };
  return l.state.budgets[id]?.[ACTUAL];
}

test("BG-082: con el foco en el Detalle, pasar a otra celda y pulsar Enter guarda lo tecleado en la primera", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedLedger(page, { nodes: NODES, budgets: { "c-mercado": { [ACTUAL]: 1_000 }, "c-luz": { [ACTUAL]: 500 } } });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();

  await celda(page, "c-mercado").click();
  await page.getByLabel("Editar valor").fill("2000");
  // El foco pasa al Detalle de la celda abierta. Es una celda de Presupuestado: desde BG-089 su
  // Detalle son solo sus comentarios, así que el control enfocable es la caja del comentario.
  await page.getByLabel("Añadir comentario", { exact: true }).focus();
  // Y de ahí a otra celda, que se abre con Enter (BG-069).
  await celda(page, "c-luz").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Editar valor")).toHaveValue("500");

  await expect.poll(() => presupuesto(page, "c-mercado")).toBe(2_000);
});

test("control: abrir el editor y salir por el Detalle SIN teclear no escribe nada", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedLedger(page, { nodes: NODES, budgets: { "c-mercado": { [ACTUAL]: 1_000 }, "c-luz": { [ACTUAL]: 500 } } });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  const antes = ((await (await page.request.get("/api/v1/ledger")).json()) as { revision: number }).revision;

  await celda(page, "c-mercado").click();
  await page.getByLabel("Añadir comentario", { exact: true }).focus();
  await celda(page, "c-luz").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Editar valor")).toHaveValue("500");

  expect(await presupuesto(page, "c-mercado")).toBe(1_000);
  expect(((await (await page.request.get("/api/v1/ledger")).json()) as { revision: number }).revision).toBe(antes);
});
