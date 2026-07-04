import { test, expect } from "@playwright/test";

// Flujos críticos de UI (FR-006/009/010/012). Cada test embebe su TC id para verify-run.

test("TC-012h: los tokens CSS coinciden con el sistema de diseño César Augusto", async ({ page }) => {
  await page.goto("/");
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      bg: s.getPropertyValue("--bg").trim(),
      primary: s.getPropertyValue("--primary").trim(),
      success: s.getPropertyValue("--success").trim(),
      warning: s.getPropertyValue("--warning").trim(),
      error: s.getPropertyValue("--error").trim(),
      font: s.getPropertyValue("--font-mono").trim(),
    };
  });
  expect(tokens.bg).toBe("#080c12");
  expect(tokens.primary).toBe("#4a7fa5");
  expect(tokens.success).toBe("#10b981");
  expect(tokens.warning).toBe("#f59e0b");
  expect(tokens.error).toBe("#ef4444");
  // FR-109 (feature grid-ux) reemplazó la familia tipográfica Fira Code por Lexend; la paleta se conserva.
  expect(tokens.font).toContain("Lexend");
});

test("TC-010h: 375px muestra solo Registrar; escritorio muestra la grilla", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);

  await page.setViewportSize({ width: 1300, height: 900 });
  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("mobile-shell")).toHaveCount(0);
});

test("TC-001h: registrar un movimiento lo suma y lo muestra en recientes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  // El formulario pre-selecciona la primera categoría (effectiveCat = catId || categories[0]),
  // así que basta con el monto para habilitar Guardar (canSave: amount>0 && catId).
  await page.getByLabel("Monto").fill("50000");
  await page.getByRole("button", { name: "Guardar movimiento" }).click();
  await expect(page.getByTestId("recent-item").first()).toBeVisible();
});

test("TC-006h: la grilla renderiza con columna categoría sticky y 12 meses", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  // exact:true evita colisionar con los botones "Nueva categoría"/"Nueva subcategoría" (substring case-insensitive)
  await expect(grid.getByText("CATEGORÍA", { exact: true })).toBeVisible();
  await expect(grid.getByText("Enero").first()).toBeVisible();
  await expect(grid.getByText("Diciembre").first()).toBeVisible();
});

test("TC-009f: dashboard muestra estado vacío de 'Sobre presupuesto' cuando no hay excesos", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect(page.getByTestId("over-empty")).toBeVisible();
});
