/**
 * Epic 4 e2e — registro/arranque limpio de usuario + split de credenciales.
 * TCs: FR-513 (043h, 044e, 045f) · FR-509 (032f).
 */
import { test, expect } from "@playwright/test";
import { register, uniqueEmail, movementCount, createMovementViaApi, hasMovementAmount, dumpLocalStorage, PASSWORD } from "./helpers/app";

test("TC-BE-043h: un usuario recién registrado ve un ledger propio y utilizable, sin datos de otros", async ({ page }) => {
  // @aitri-tc TC-BE-043h
  await register(page, uniqueEmail("nueva"));
  // Ledger propio y utilizable: la jerarquía semilla está presente (GASTOS visible), sin movimientos.
  await expect(page.getByText("GASTOS").first()).toBeVisible();
  expect(await movementCount(page)).toBe(0);
  // Puede registrar un movimiento de inmediato.
  expect(await createMovementViaApi(page, 5000)).toBe(201);
});

test("TC-BE-044e: el ledger inicial no arrastra datos financieros del localStorage previo", async ({ page }) => {
  // @aitri-tc TC-BE-044e
  // Precargar localStorage con datos financieros de un uso cliente-puro previo.
  await page.addInitScript(() => {
    localStorage.setItem("ledger.nodes.v1", JSON.stringify({ version: 1, ownerId: "local", nodes: [{ id: "hack", name: "Robado" }] }));
    localStorage.setItem("ledger.budget.v2", JSON.stringify({ version: 2, budgets: {}, actuals: {}, movements: [{ amount: 99999 }] }));
  });
  await register(page, uniqueEmail("limpio"));
  // El ledger nuevo NO contiene los datos previos.
  expect(await hasMovementAmount(page, 99999)).toBe(false);
  // Las llaves financieras legadas fueron retiradas de localStorage (split, FR-509).
  const ls = await dumpLocalStorage(page);
  expect(ls["ledger.nodes.v1"]).toBeUndefined();
  expect(ls["ledger.budget.v2"]).toBeUndefined();
});

test("TC-BE-045f: dos cuentas nuevas obtienen ledgers independientes", async ({ browser }) => {
  // @aitri-tc TC-BE-045f
  const ana = await browser.newContext();
  const beto = await browser.newContext();
  const anaPage = await ana.newPage();
  const betoPage = await beto.newPage();
  try {
    await register(anaPage, uniqueEmail("ana"));
    await register(betoPage, uniqueEmail("beto"));
    // Ana registra un movimiento.
    expect(await createMovementViaApi(anaPage, 5000)).toBe(201);
    // Beto (otra cuenta) recarga y NO ve el movimiento de Ana.
    await betoPage.reload();
    await expect(betoPage.getByText("GASTOS").first()).toBeVisible();
    expect(await hasMovementAmount(betoPage, 5000)).toBe(false);
  } finally {
    await ana.close();
    await beto.close();
  }
});

test("TC-BE-032f: localStorage nunca contiene credenciales ni contraseñas", async ({ page }) => {
  // @aitri-tc TC-BE-032f
  await register(page, uniqueEmail("cred"));
  const ls = await dumpLocalStorage(page);
  const blob = JSON.stringify(ls);
  expect(blob).not.toContain(PASSWORD);
  expect(blob).not.toMatch(/session[_-]?token/i);
  expect(blob).not.toMatch(/\$argon2/); // ningún hash de contraseña
});
