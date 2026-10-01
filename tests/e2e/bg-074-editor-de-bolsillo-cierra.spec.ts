/**
 * BG-074 — el editor de la celda de un bolsillo se cierra con Escape y al hacer clic fuera.
 *
 * En un mes ABIERTO, Escape desde el campo de comentario sube a propósito (CellNoteInput), pero el
 * contenedor no lo atendía: el editor quedaba abierto sin salida por teclado. Esa es la prueba que
 * falla con el código anterior.
 *
 * La auditoría también señalaba el mes CERRADO (sin foco inicial), pero ese foco ya existía cuando se
 * arregló esto (`useEffect` de foco en ReserveCellEditor). Su prueba queda como protección de esa
 * conducta, no como demostración de este arreglo.
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import { closeViaApi } from "./helpers/cycles";
import { monthPrev } from "@/domain/periods";
import type { LedgerNode, PeriodKey } from "@/domain/types";

const HOY = new Date();
const ACTUAL = `${HOY.getFullYear()}-${String(HOY.getMonth() + 1).padStart(2, "0")}` as PeriodKey;
const ANTERIOR = monthPrev(ACTUAL);

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 1 },
  { id: "A", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Alcancía", icon: null, order: 0 },
];

const filaDe = (page: Page, name: string) =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: name }) });
const celda = (page: Page, mes: string) =>
  page.locator(`[data-testid="cell-leaf"][data-cell="A"][data-month="${mes}"][data-plane="actual"]`);

async function desplegar(page: Page): Promise<void> {
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  if (!(await filaDe(page, "Alcancía").count())) {
    await filaDe(page, "Reservas").first().getByRole("button", { name: "Expandir" }).first().click();
  }
  await expect(filaDe(page, "Alcancía")).toBeVisible();
}

async function abrir(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedLedger(page, { nodes: NODES, actuals: { "c-salario": { [ANTERIOR]: 1_000, [ACTUAL]: 1_000 } } });
  await page.goto("/");
  await desplegar(page);
}

test("BG-074: en un mes abierto, Escape desde el comentario cierra el editor del bolsillo", async ({ page }) => {
  await abrir(page);
  await celda(page, ACTUAL).click();
  await expect(page.getByLabel("Editar valor")).toBeVisible();
  await page.getByLabel("Añadir comentario").click();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Editar valor")).toHaveCount(0);
  await expect(page.getByLabel("Añadir comentario")).toHaveCount(0);
});

test("BG-074: en un mes cerrado, Escape y el clic fuera cierran el editor del bolsillo", async ({ page }) => {
  await abrir(page);
  expect(await closeViaApi(page)).toBe(200);
  await page.reload();
  await desplegar(page);

  // Abierto con el TECLADO (Enter sobre la celda, BG-069), el camino más exigente con el foco.
  await celda(page, ANTERIOR).focus();
  await page.keyboard.press("Enter");
  const comentario = page.getByLabel("Añadir comentario");
  await expect(comentario).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(comentario).toHaveCount(0);

  // Clic fuera: en la etiqueta de la fila de Trabajo, lejos del editor.
  await celda(page, ANTERIOR).focus();
  await page.keyboard.press("Enter");
  await expect(comentario).toBeVisible();
  await filaDe(page, "Trabajo").getByTestId("row-label").click();
  await expect(comentario).toHaveCount(0);
});
