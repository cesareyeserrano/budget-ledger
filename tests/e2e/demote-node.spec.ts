import { test, expect, type Page } from "@playwright/test";

// Feature demote-node — e2e (FR-701). Bajar un grupo de nivel arrastrándolo dentro de otro grupo
// (→categoría) o de una categoría (→subcategoría), siempre del mismo tipo. Cada test embebe su TC id
// para el mapeo de aitri verify-run. dnd-kit usa PointerSensor: el arrastre se simula con pasos de mouse.

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

function typeLabel(page: Page, name: RegExp) {
  return page.getByTestId("type-total-row").filter({ hasText: name }).getByTestId("row-label");
}

// Crea un grupo SIN hijos bajo el tipo dado vía el '+' en hover de su etiqueta.
async function addGroup(page: Page, typeName: RegExp, groupName: string) {
  const label = typeLabel(page, typeName);
  const box = await label.boundingBox();
  if (box) await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.locator('button[aria-label="Agregar grupo"]').first().click();
  await page.getByLabel("Nombre").fill(groupName);
  await page.getByLabel("Nombre").press("Enter");
}

// La fila de un nodo (por su texto) y su etiqueta sticky (que porta el draggable/droppable).
function nodeRow(grid: ReturnType<Page["getByTestId"]>, name: string) {
  return grid.getByTestId("node-row").filter({ hasText: name }).first();
}
function nodeLabel(grid: ReturnType<Page["getByTestId"]>, name: string) {
  return nodeRow(grid, name).getByTestId("row-label").first();
}

// @aitri-tc TC-701h
test("TC-701h: arrastrar un grupo sin hijos dentro de otro grupo lo baja a categoría", async ({ page }) => {
  const grid = await gotoGrid(page);
  await addGroup(page, /GASTOS/, "Suelto"); // grupo de gasto sin hijos
  await expect(nodeRow(grid, "Suelto")).toHaveAttribute("data-level", "group");
  // arrastrar 'Suelto' sobre el grupo semilla 'Esenciales' (mismo tipo)
  await drag(page, nodeLabel(grid, "Suelto"), nodeLabel(grid, "Esenciales"));
  await expect(async () => {
    await expect(nodeRow(grid, "Suelto")).toHaveAttribute("data-level", "category", { timeout: 1500 });
  }).toPass({ timeout: 15000 });
});

// @aitri-tc TC-701e
test("TC-701e: arrastrar un grupo sin hijos dentro de una categoría lo baja a subcategoría", async ({ page }) => {
  const grid = await gotoGrid(page);
  await addGroup(page, /GASTOS/, "Suelto");
  await expect(nodeRow(grid, "Suelto")).toHaveAttribute("data-level", "group");
  // 'Vivienda' es una categoría de gasto semilla (visible: los grupos inician expandidos)
  await drag(page, nodeLabel(grid, "Suelto"), nodeLabel(grid, "Vivienda"));
  // Al reubicar, el store re-monta la grilla y las categorías vuelven a colapsarse: 'Suelto' queda
  // como sub bajo 'Vivienda' colapsada. Reexpandir 'Vivienda' hasta ver 'Suelto' como subcategoría.
  await expect(async () => {
    if ((await nodeRow(grid, "Suelto").count()) === 0) {
      await grid.getByText("Vivienda", { exact: true }).first().click();
    }
    await expect(nodeRow(grid, "Suelto")).toHaveAttribute("data-level", "sub", { timeout: 1500 });
  }).toPass({ timeout: 15000 });
});

// @aitri-tc TC-701f
test("TC-701f: soltar un grupo de gasto sobre un destino de ingreso no realiza ningún cambio", async ({ page }) => {
  const grid = await gotoGrid(page);
  await addGroup(page, /GASTOS/, "Suelto");
  await expect(nodeRow(grid, "Suelto")).toHaveAttribute("data-level", "group");
  // 'Salario' es de tipo Ingreso → cross-type: sin cambios, 'Suelto' sigue siendo grupo de gasto
  await drag(page, nodeLabel(grid, "Suelto"), nodeLabel(grid, "Salario"));
  await expect(nodeRow(grid, "Suelto")).toHaveAttribute("data-level", "group");
});
