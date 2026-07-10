import { test, expect } from "@playwright/test";

// TCs declarados en 03_TEST_CASES.json que faltaban implementar como specs reales.
// Cubren AC-012 (FR-006), AC-019 (FR-010) y AC-024 (FR-012) + NFR-004.

test("TC-006f: Escape cancela la edición y la celda de un nodo padre no es editable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  await grid.getByText("Comida", { exact: true }).first().click(); // expandir para exponer celdas de hoja
  const leaf = grid.getByTestId("cell-leaf").first();
  const original = ((await leaf.textContent()) ?? "").trim();
  await leaf.click();
  const editor = page.getByLabel("Editar valor");
  await expect(editor).toBeVisible();
  await editor.fill("987654");
  await editor.press("Escape");
  await expect(page.getByLabel("Editar valor")).toHaveCount(0);            // editor cerrado
  await expect(grid.getByTestId("cell-leaf").first()).toHaveText(original); // valor original intacto
  // una celda de nodo padre (total por roll-up) NO abre editor al hacer clic
  await grid.getByTestId("cell-parent").first().click();
  await expect(page.getByLabel("Editar valor")).toHaveCount(0);
});

test("TC-010e: un movimiento capturado en pantalla pequeña se refleja en la grilla de escritorio", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  // Registro rediseñado: monto + elegir la hoja disponible + Guardar.
  await page.getByLabel("Monto en pesos").fill("77777");
  await page.getByTestId("category-row").getByRole("button").first().click();
  const subRow = page.getByTestId("subcategory-row");
  if (await subRow.waitFor({ state: "visible", timeout: 800 }).then(() => true).catch(() => false)) {
    await subRow.getByRole("button").first().click();
  }
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("recent-item").first()).toBeVisible();
  // cambiar a escritorio: mismos datos vía localStorage, sin importar/exportar
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  await expect(grid.getByText("77.777", { exact: true }).first()).toBeVisible(); // Ejecutado refleja el monto
});

test("TC-104e: no se realizan peticiones HTTP externas en runtime (v1 offline)", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!/^https?:/i.test(url)) return; // ignorar data:/blob:
    const host = new URL(url).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") external.push(url);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.waitForTimeout(500);
  expect(external, `peticiones externas detectadas: ${external.join(", ")}`).toEqual([]);
});

test("TC-012f: prefers-reduced-motion elimina animaciones y no hay emoji/gradiente", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  const { hasEmoji, hasGradient } = await page.evaluate(() => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u.test(document.body.innerText);
    let grad = false;
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (getComputedStyle(el).backgroundImage.includes("gradient")) { grad = true; break; }
    }
    return { hasEmoji: emoji, hasGradient: grad };
  });
  expect(hasEmoji).toBe(false);
  expect(hasGradient).toBe(false);
});

test("TC-102f: con reduced-motion las transiciones se reducen a ~0.001ms", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  // el navegador normaliza 0.001ms a "1e-06s"; comparar numéricamente en segundos
  const { transition, animation } = await page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return { transition: parseFloat(s.transitionDuration), animation: parseFloat(s.animationDuration) };
  });
  expect(transition).toBeLessThan(0.01); // ~0.000001s, muy por debajo de cualquier transición real
  expect(animation).toBeLessThan(0.01);
});
