/**
 * BG-076 / FR-207 — un monto con decimales se rechaza con su mensaje y no se guarda.
 *
 * Los campos borraban todo lo que no fuera dígito: «1500,50» se guardaba como 150.050, cien veces la
 * cifra, sin aviso. «1.500.000» (miles con punto, como se escribe en Colombia) sigue valiendo.
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import type { LedgerNode, PeriodKey } from "@/domain/types";

const HOY = new Date();
const ACTUAL = `${HOY.getFullYear()}-${String(HOY.getMonth() + 1).padStart(2, "0")}` as PeriodKey;
const MENSAJE = "El monto debe ser un valor entero en pesos.";

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 1 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 0 },
];

async function leer(page: Page): Promise<{ state: { openingBalance?: number | null; budgets: Record<string, Record<string, number>>; movements: unknown[] } }> {
  return (await (await page.request.get("/api/v1/ledger")).json()) as never;
}

test("BG-076: en Configuración «1500,50» se rechaza y «1.500.000» se guarda como 1.500.000", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedLedger(page, { nodes: NODES });
  await page.goto("/configuracion");
  const saldo = page.getByTestId("config-opening");

  await saldo.fill("1500,50");
  await expect(page.getByTestId("amount-error")).toHaveText(MENSAJE);
  await expect(page.getByTestId("config-save")).toBeDisabled();

  await saldo.fill("1.500.000");
  await expect(page.getByTestId("amount-error")).toHaveCount(0);
  await page.getByTestId("config-save").click();
  await expect(page.getByTestId("config-saved")).toBeVisible();
  expect((await leer(page)).state.openingBalance).toBe(1_500_000);
});

test("BG-076: en una celda de la grilla «1500,50» no se escribe; la celda se queda abierta con el aviso", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedLedger(page, { nodes: NODES, budgets: { "c-mercado": { [ACTUAL]: 1_000 } } });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();

  await page.locator(`[data-testid="cell-leaf"][data-cell="c-mercado"][data-month="${ACTUAL}"][data-plane="budget"]`).click();
  const valor = page.getByLabel("Editar valor");
  await valor.fill("1500,50");
  await valor.press("Enter");
  await expect(page.getByTestId("amount-error")).toHaveText(MENSAJE);
  await expect(valor).toBeVisible();
  expect((await leer(page)).state.budgets["c-mercado"]?.[ACTUAL]).toBe(1_000);

  await valor.press("Escape");
  await expect(valor).toHaveCount(0);
});

test("BG-076: en «Añadir movimiento» «1500,50» muestra el aviso y no registra nada", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedLedger(page, { nodes: NODES });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();

  await page.locator(`[data-testid="cell-leaf"][data-cell="c-mercado"][data-month="${ACTUAL}"][data-plane="actual"]`).click();
  const linea = page.getByTestId("add-movement");
  await linea.getByLabel("Monto").fill("1500,50");
  await expect(linea.getByTestId("amount-error")).toHaveText(MENSAJE);
  await linea.getByLabel("Monto").press("Enter");
  expect((await leer(page)).state.movements).toHaveLength(0);
});
