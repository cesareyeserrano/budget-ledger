/**
 * BG-059 — si la primera carga falla, la app lo dice y deja reintentar, en vez de pintar el libro vacío.
 */
import { test, expect } from "./helpers/fixtures";

test("BG-059: con el servidor fallando al cargar se ve el aviso, y «Reintentar» carga la grilla", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Solo la LECTURA del ledger falla; la sesión y el resto responden normal.
  let caido = true;
  await page.route("**/api/v1/ledger", async (route) => {
    if (caido && route.request().method() === "GET") {
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"internal"}}' });
    } else {
      await route.continue();
    }
  });

  await page.goto("/");
  const aviso = page.getByTestId("load-error");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("No pudimos cargar tus datos");
  // Y no hay grilla debajo fingiendo un libro vacío.
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);

  caido = false;
  await page.getByTestId("load-retry").click();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(aviso).toHaveCount(0);
});
