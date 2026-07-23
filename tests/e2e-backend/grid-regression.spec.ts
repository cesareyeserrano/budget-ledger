/**
 * Epic 5 e2e — regresión de la grilla contra el backend autenticado (NFR-508). La superficie visible
 * se comporta igual que en el baseline; solo cambia el origen de los datos.
 * TCs: NFR-508 (068h, 069e, 070f).
 */
import { test, expect } from "@playwright/test";
import { register, uniqueEmail, createMovementViaApi, actualFor, movementCount } from "./helpers/app";

/** Espera hasta que el store en vivo alcance un nº de movimientos (actualización por SSE). */
async function waitForCount(page: import("@playwright/test").Page, target: number, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await movementCount(page)) >= target) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

test("TC-BE-068h: guardar un movimiento suma a Ejecutado y se refleja en la grilla", async ({ page }) => {
  // @aitri-tc TC-BE-068h
  await register(page, uniqueEmail("grid"));
  const before = await actualFor(page, "s-comida-mercado", "jun");
  expect(await createMovementViaApi(page, 5000, "jun")).toBe(201);
  // El store en vivo (que alimenta la grilla) refleja el nuevo Ejecutado tras el evento SSE.
  expect(await waitForCount(page, 1)).toBe(true);
  const after = await actualFor(page, "s-comida-mercado", "jun");
  expect(after).toBe(before + 5000);
  // La grilla sigue montada y funcional (misma superficie visible).
  await expect(page.getByRole("heading", { name: "Presupuesto" })).toBeVisible();
  await expect(page.getByText("GASTOS").first()).toBeVisible();
});

test("TC-BE-069e: cambiar Mes/Año recalcula los indicadores igual que el baseline", async ({ page }) => {
  // @aitri-tc TC-BE-069e
  await register(page, uniqueEmail("periodo"));
  // Valor del KPI de presupuesto en modo Mes.
  const kpi = page.getByText(/PRESUPUESTO/).first();
  await expect(kpi).toBeVisible();
  await page.getByRole("tab", { name: "Mes" }).click();
  const mesText = await page.locator("main").innerText();
  // Cambiar a Año: el total anual (12 meses) difiere del mensual.
  await page.getByRole("tab", { name: "Año" }).click();
  await page.waitForTimeout(300);
  const anioText = await page.locator("main").innerText();
  expect(anioText).not.toBe(mesText); // el recálculo por período cambió los indicadores
});

test("TC-BE-070f: guardar con monto 0 no crea movimiento (igual que hoy)", async ({ page }) => {
  // @aitri-tc TC-BE-070f
  await register(page, uniqueEmail("cero"));
  const before = await movementCount(page);
  // Monto 0 → la API lo rechaza (422), no se crea movimiento.
  expect(await createMovementViaApi(page, 0, "jun")).toBe(422);
  await page.waitForTimeout(500);
  expect(await movementCount(page)).toBe(before); // sin cambios
});
