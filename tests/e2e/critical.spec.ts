import { test, expect } from "@playwright/test";

// Flujos críticos de UI (FR-006/009/010/012). Cada test embebe su TC id para verify-run.

test("TC-012h: los tokens CSS coinciden con el sistema de diseño zinc (tema claro)", async ({ page }) => {
  // Feature stack-upgrade-theme: reemplaza César Augusto steel-blue por zinc neutro + tema claro/oscuro.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      bg: s.getPropertyValue("--bg").trim(),
      primary: s.getPropertyValue("--primary").trim(),
      success: s.getPropertyValue("--success").trim(),
      warning: s.getPropertyValue("--warning").trim(),
      error: s.getPropertyValue("--error").trim(),
      font: s.getPropertyValue("--font-sans").trim(),
      transfer: s.getPropertyValue("--type-transfer").trim(),
    };
  });
  // Lightning CSS minifica #ffffff → #fff; normalizamos el shorthand antes de comparar.
  const expand = (h: string) => (h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h);
  // ux-consistency FR-301/FR-311: lienzo off-white + acentos desaturados (mismo hue, sin vibración).
  expect(expand(tokens.bg)).toBe("#f7f7f8"); // lienzo (antes #ffffff) para profundidad
  expect(tokens.primary).toBe("#1c1c1f");
  expect(tokens.success).toBe("#2f7d53");
  expect(tokens.warning).toBe("#b45309");
  expect(tokens.error).toBe("#c4453e");
  expect(tokens.transfer).toBe("#2f6db4"); // Transferencia: azul acero (FR-204)
  expect(tokens.font).toContain("Inter"); // FR-213: Inter reemplaza Lexend
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

test("TC-001h: registrar un movimiento lo guarda y confirma con toast", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  // Registro rediseñado (feature stack-upgrade-theme): monto + elegir la hoja disponible + Guardar.
  await page.getByLabel("Monto en pesos").fill("50000");
  await page.getByTestId("category-row").getByRole("button").first().click();
  const subRow = page.getByTestId("subcategory-row");
  if (await subRow.waitFor({ state: "visible", timeout: 800 }).then(() => true).catch(() => false)) {
    await subRow.getByRole("button").first().click();
  }
  await page.getByTestId("save-button").click();
  // BL-003: la lista 'Recientes' se retiró del móvil; el guardado se confirma por el overlay
  // con el monto y por el campo de monto que vuelve a 0 (AC de FR-001).
  await expect(page.getByTestId("confirm-overlay")).toContainText("$50.000");
  await expect(page.getByTestId("confirm-overlay")).toHaveCount(0, { timeout: 4000 });
  await expect(page.getByLabel("Monto en pesos")).toHaveValue("");
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
