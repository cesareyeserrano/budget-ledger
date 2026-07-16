/**
 * Epic 4 e2e — sincronización EN VIVO (SSE) entre dispositivos del mismo usuario.
 * TCs: FR-511 (036h, 037f, 038e). Dos+ contextos = dos+ dispositivos.
 */
import { test, expect, type Page, type Browser } from "@playwright/test";
import { register, login, uniqueEmail, createMovementViaApi, movementCount, hasMovementAmount } from "./helpers/app";

/** Espera hasta que el store en vivo del dispositivo alcance `target` movimientos (o falla en timeoutMs). */
async function waitForCount(page: Page, target: number, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await movementCount(page)) >= target) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function device(browser: Browser, email: string, mode: "register" | "login") {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await (mode === "register" ? register(page, email) : login(page, email));
  return { ctx, page };
}

test("TC-BE-036h: un cambio en el dispositivo 1 se refleja en el dispositivo 2 sin recarga (≤5s)", async ({ page, browser }) => {
  // @aitri-tc TC-BE-036h
  const email = uniqueEmail("live");
  await register(page, email); // dispositivo 1
  const d2 = await device(browser, email, "login"); // dispositivo 2 (SSE conectado)
  try {
    const before = await movementCount(d2.page);
    // Dispositivo 1 escribe (dispara publish → SSE).
    expect(await createMovementViaApi(page, 7000)).toBe(201);
    // Dispositivo 2 se actualiza SIN recarga manual, en ≤5s.
    expect(await waitForCount(d2.page, before + 1, 5000)).toBe(true);
    expect(await hasMovementAmount(d2.page, 7000)).toBe(true);
  } finally {
    await d2.ctx.close();
  }
});

test("TC-BE-037f: un dispositivo de otro usuario no recibe la actualización en vivo", async ({ page, browser }) => {
  // @aitri-tc TC-BE-037f
  const ana = uniqueEmail("ana-live");
  await register(page, ana); // Ana dispositivo 1
  const anaD2 = await device(browser, ana, "login"); // Ana dispositivo 2
  const beto = await device(browser, uniqueEmail("beto-live"), "register"); // Beto (otro usuario)
  try {
    const betoBefore = await movementCount(beto.page);
    expect(await createMovementViaApi(page, 8000)).toBe(201); // Ana escribe
    // Ana dispositivo 2 SÍ recibe (control positivo).
    expect(await waitForCount(anaD2.page, 1, 5000)).toBe(true);
    // Beto NO recibe la actualización (su store no cambia).
    await beto.page.waitForTimeout(3000);
    expect(await movementCount(beto.page)).toBe(betoBefore);
    expect(await hasMovementAmount(beto.page, 8000)).toBe(false);
  } finally {
    await anaD2.ctx.close();
    await beto.ctx.close();
  }
});

test("TC-BE-038e: con el dispositivo 2 cerrado, el write del dispositivo 1 no produce error; al abrir ve el dato", async ({ page, browser }) => {
  // @aitri-tc TC-BE-038e
  const email = uniqueEmail("closed");
  await register(page, email); // dispositivo 1
  // Dispositivo 2 cerrado: escribir en 1 no produce error (publish a cero conexiones es no-op).
  expect(await createMovementViaApi(page, 6000)).toBe(201);
  // Al ABRIR el dispositivo 2, ve el dato (vía la hidratación de FR-510).
  const d2 = await device(browser, email, "login");
  try {
    expect(await hasMovementAmount(d2.page, 6000)).toBe(true);
  } finally {
    await d2.ctx.close();
  }
});
