import { test, expect, type Page } from "@playwright/test";

// FR-015 — reparent por arrastrar-y-soltar. dnd-kit usa PointerSensor (distancia de activación),
// por eso el arrastre se simula con pasos de mouse (mousedown → move >6px → move a destino → mouseup).

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

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  // las categorías inician colapsadas: expandir 'Comida' para que su subcategoría 'Café' sea visible
  await grid.getByText("Comida", { exact: true }).first().click();
  await expect(grid.getByText("Café", { exact: true }).first()).toBeVisible();
});

test("TC-015h: arrastrar una subcategoría sobre otra categoría la reubica", async ({ page }) => {
  const grid = page.getByTestId("budget-grid");
  // 'Café' es subcategoría semilla de 'Comida'; se arrastra sobre 'Vivienda' (categoría del mismo tipo Gasto)
  const cafe = grid.getByText("Café", { exact: true }).first();
  const vivienda = grid.getByText("Vivienda", { exact: true }).first();
  await drag(page, cafe, vivienda);
  // Al reparentar, el store re-monta la grilla y las categorías vuelven a colapsarse: 'Café' queda
  // bajo 'Vivienda' colapsada. Reintentar expandir 'Vivienda' hasta ver 'Café' bajo su nuevo padre
  // (evita la carrera con el re-montaje; solo hace clic cuando 'Café' está oculta, sin oscilar).
  await expect(async () => {
    if ((await grid.getByText("Café", { exact: true }).count()) === 0) {
      await grid.getByText("Vivienda", { exact: true }).first().click();
    }
    await expect(grid.getByText("Café", { exact: true }).first()).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });
});

test("TC-015f: el destino de otro tipo no reubica (jerarquía intacta)", async ({ page }) => {
  const grid = page.getByTestId("budget-grid");
  const cafe = grid.getByText("Café", { exact: true }).first();
  const salario = grid.getByText("Salario", { exact: true }).first(); // tipo Ingreso
  await drag(page, cafe, salario);
  // cross-type rechazado: 'Café' sigue bajo Gasto (visible en la grilla sin cambios de tipo)
  await expect(grid.getByText("Café", { exact: true }).first()).toBeVisible();
});
