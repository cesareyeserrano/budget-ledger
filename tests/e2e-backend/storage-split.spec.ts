/**
 * Epic 4 e2e — split de almacenamiento: localStorage solo para prefs de dispositivo.
 * TCs: FR-509 (030h, 031e).
 */
import { test, expect } from "@playwright/test";
import { register, uniqueEmail, createMovementViaApi, dumpLocalStorage } from "./helpers/app";

test("TC-BE-030h: el tema persiste en localStorage tras recargar", async ({ page }) => {
  // @aitri-tc TC-BE-030h
  await register(page, uniqueEmail("tema"));
  // Cambiar el tema (el botón de tema alterna claro/oscuro).
  await page.getByRole("button", { name: /Cambiar a tema/ }).click();
  const themeBefore = await page.evaluate(() => localStorage.getItem("theme"));
  expect(themeBefore).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Presupuesto" })).toBeVisible();
  const themeAfter = await page.evaluate(() => localStorage.getItem("theme"));
  expect(themeAfter).toBe(themeBefore); // la preferencia sobrevive la recarga desde localStorage
});

test("TC-BE-031e: tras guardar movimientos, localStorage no contiene datos financieros", async ({ page }) => {
  // @aitri-tc TC-BE-031e
  await register(page, uniqueEmail("split"));
  // Guardar varios movimientos vía la API (fuente de verdad = servidor).
  expect(await createMovementViaApi(page, 5000)).toBe(201);
  expect(await createMovementViaApi(page, 7000, "jul")).toBe(201);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Presupuesto" })).toBeVisible();

  const ls = await dumpLocalStorage(page);
  // No hay llaves financieras.
  expect(ls["ledger.nodes.v1"]).toBeUndefined();
  expect(ls["ledger.budget.v2"]).toBeUndefined();
  // Ningún valor de localStorage contiene montos/movimientos/nodos/presupuestos.
  const blob = JSON.stringify(ls);
  expect(blob).not.toContain("5000");
  expect(blob).not.toContain("7000");
  expect(blob).not.toMatch(/movements|budgets|actuals/);
});
