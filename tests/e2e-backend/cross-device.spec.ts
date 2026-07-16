/**
 * Epic 4 e2e — sincronización al recargar/abrir entre dispositivos del mismo usuario.
 * TCs: FR-510 (033h, 034e, 035f). Dos contextos de navegador = dos dispositivos.
 */
import { test, expect, type Browser } from "@playwright/test";
import { register, login, uniqueEmail, createMovementViaApi, hasMovementAmount, movementCount } from "./helpers/app";

/** Abre un segundo dispositivo (contexto nuevo) logueado con la misma cuenta. */
async function secondDevice(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, email);
  return { ctx, page };
}

test("TC-BE-033h: un movimiento del dispositivo 1 aparece en el dispositivo 2 tras recargar", async ({ page, browser }) => {
  // @aitri-tc TC-BE-033h
  const email = uniqueEmail("dev");
  await register(page, email); // dispositivo 1
  const d2 = await secondDevice(browser, email); // dispositivo 2
  try {
    // Dispositivo 1 guarda un movimiento.
    expect(await createMovementViaApi(page, 5000)).toBe(201);
    // Dispositivo 2 recarga y lo ve; el dataset (nº de movimientos) coincide.
    await d2.page.reload();
    await expect(d2.page.getByRole("heading", { name: "Presupuesto" })).toBeVisible();
    expect(await hasMovementAmount(d2.page, 5000)).toBe(true);
    expect(await movementCount(d2.page)).toBe(await movementCount(page));
  } finally {
    await d2.ctx.close();
  }
});

test("TC-BE-034e: un cambio en el dispositivo 2 se ve en el dispositivo 1 tras recargar", async ({ page, browser }) => {
  // @aitri-tc TC-BE-034e
  const email = uniqueEmail("dev2");
  await register(page, email); // dispositivo 1
  const d2 = await secondDevice(browser, email); // dispositivo 2
  try {
    expect(await createMovementViaApi(d2.page, 4321)).toBe(201); // dispositivo 2 escribe
    await page.reload(); // dispositivo 1 recarga
    await expect(page.getByRole("heading", { name: "Presupuesto" })).toBeVisible();
    expect(await hasMovementAmount(page, 4321)).toBe(true);
  } finally {
    await d2.ctx.close();
  }
});

test("TC-BE-035f: un usuario distinto que recarga no ve el movimiento de otro", async ({ page, browser }) => {
  // @aitri-tc TC-BE-035f
  await register(page, uniqueEmail("ana")); // Ana
  expect(await createMovementViaApi(page, 5000)).toBe(201);
  // Beto (otra cuenta) recarga y no ve el movimiento de Ana.
  const betoCtx = await browser.newContext();
  const betoPage = await betoCtx.newPage();
  try {
    await register(betoPage, uniqueEmail("beto"));
    await betoPage.reload();
    await expect(betoPage.getByRole("heading", { name: "Presupuesto" })).toBeVisible();
    expect(await hasMovementAmount(betoPage, 5000)).toBe(false);
  } finally {
    await betoCtx.close();
  }
});
