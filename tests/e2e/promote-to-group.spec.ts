import { test, expect, type Page } from "@playwright/test";

// Feature promote-to-group — e2e. Cada test embebe su TC id para el mapeo de aitri verify-run.
// dnd-kit usa PointerSensor (distancia de activación): el arrastre se simula con pasos de mouse.

const DESK = { width: 1440, height: 1250 };

async function drag(page: Page, from: ReturnType<Page["locator"]>, to: ReturnType<Page["locator"]>) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("no bounding box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

async function gotoGrid(page: Page) {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  return grid;
}

// La fila de tipo mide ~2600px (12 meses); su CENTRO cae fuera de pantalla. Apuntamos a su etiqueta
// sticky (izquierda, siempre visible) — que forma parte del mismo droppable root:{type}.
function typeLabel(page: Page, name: RegExp) {
  return page.getByTestId("type-total-row").filter({ hasText: name }).getByTestId("row-label");
}
// Crea un grupo sin hijos bajo el tipo dado vía el '+' en hover de su etiqueta.
async function addGroup(page: Page, typeName: RegExp, groupName: string) {
  const label = typeLabel(page, typeName);
  const box = await label.boundingBox();
  if (box) await page.mouse.move(box.x + 20, box.y + box.height / 2); // hover fiable (izquierda de la fila)
  await page.locator('button[aria-label="Agregar grupo"]').first().click();
  await page.getByLabel("Nombre").fill(groupName);
  await page.getByLabel("Nombre").press("Enter");
}

// FR-601 — promover a grupo arrastrando a la fila de tipo.
test("TC-601h: arrastrar la subcategoría 'Café' a la fila GASTOS la convierte en grupo", async ({ page }) => {
  const grid = await gotoGrid(page);
  await grid.getByText("Comida", { exact: true }).first().click(); // expandir para ver 'Café'
  await expect(grid.getByText("Café", { exact: true }).first()).toBeVisible();
  const cafe = grid.getByText("Café", { exact: true }).first();
  await drag(page, cafe, typeLabel(page, /GASTOS/));
  // 'Café' ahora es una fila de grupo (data-level='group') visible en la grilla
  await expect(async () => {
    const row = grid.getByTestId("node-row").filter({ hasText: "Café" }).first();
    await expect(row).toHaveAttribute("data-level", "group", { timeout: 1500 });
  }).toPass({ timeout: 15000 });
});

test("TC-601e: arrastrar una categoría con subcategorías a su tipo la vuelve grupo (sus subs pasan a categorías)", async ({ page }) => {
  const grid = await gotoGrid(page);
  // 'Comida' es una categoría de gasto con la subcategoría 'Café'
  const comida = grid.getByText("Comida", { exact: true }).first();
  await drag(page, comida, typeLabel(page, /GASTOS/));
  await expect(async () => {
    const row = grid.getByTestId("node-row").filter({ hasText: "Comida" }).first();
    await expect(row).toHaveAttribute("data-level", "group", { timeout: 1500 });
  }).toPass({ timeout: 15000 });
});

test("TC-601f: soltar un nodo de gasto sobre la fila INGRESOS no realiza ningún cambio", async ({ page }) => {
  const grid = await gotoGrid(page);
  await grid.getByText("Comida", { exact: true }).first().click();
  await expect(grid.getByText("Café", { exact: true }).first()).toBeVisible();
  const cafe = grid.getByText("Café", { exact: true }).first();
  await drag(page, cafe, typeLabel(page, /INGRESOS/));
  // cross-type rechazado: 'Café' sigue siendo subcategoría (data-level='sub')
  const row = grid.getByTestId("node-row").filter({ hasText: "Café" }).first();
  await expect(row).toHaveAttribute("data-level", "sub");
});

// FR-603 — grupo sin hijos editable en la grilla.
test("TC-603e: la celda Pres. de un grupo sin hijos es editable y persiste tras recargar", async ({ page }) => {
  const grid = await gotoGrid(page);
  await addGroup(page, /GASTOS/, "GrupoHoja"); // grupo sin hijos bajo GASTOS
  const row = grid.getByTestId("node-row").filter({ hasText: "GrupoHoja" }).first();
  await expect(row).toHaveAttribute("data-level", "group");
  // su primera celda-hoja editable (data-testid cell-leaf) abre editor, escribimos 800000
  await row.getByTestId("cell-leaf").first().click();
  const input = page.getByLabel("Editar valor");
  await input.fill("800000");
  await input.press("Enter");
  await page.reload();
  const row2 = page.getByTestId("budget-grid").getByTestId("node-row").filter({ hasText: "GrupoHoja" }).first();
  await expect(row2).toContainText("800.000");
});

// FR-606 — grupo sin hijos como destino en el registro.
test("TC-606e: el registro lista un grupo sin hijos como destino; las categorías siguen listadas", async ({ page }) => {
  await gotoGrid(page);
  await addGroup(page, /GASTOS/, "GrupoDestino"); // grupo sin hijos bajo GASTOS
  // abrir el registro (Nuevo movimiento) y verificar el destino
  await page.getByRole("button", { name: /Nuevo movimiento/ }).click();
  await expect(page.getByTestId("category-row")).toContainText("GrupoDestino");
  await expect(page.getByTestId("category-row")).toContainText("Vivienda"); // categorías siguen
});

test("TC-606f: un grupo CON hijos no aparece como destino en el registro", async ({ page }) => {
  const grid = await gotoGrid(page);
  await page.getByRole("button", { name: /Nuevo movimiento/ }).click();
  // 'Esenciales' es un grupo semilla CON categorías → no debe ser un tile de destino de primer nivel
  const tiles = page.getByTestId("category-row");
  await expect(tiles.getByRole("button", { name: "Esenciales", exact: true })).toHaveCount(0);
});
