import { test, expect, type Browser, type Page } from "./helpers/fixtures";
import { E2E_BASE } from "./helpers/globalSetup";

// BG-050 — la pantalla de acceso borraba lo escrito al salir de la pestaña y volver. better-auth vuelve a
// consultar la sesión cuando la pestaña recupera la visibilidad (con un mínimo de 5 s entre consultas) y
// LoginGate desmontaba el formulario mientras tanto. Aquí se reproduce el gesto real: escribir, esperar
// más de 5 s fuera y volver.

const DESK = { width: 1440, height: 900 };
const FUERA_MS = 6_000; // por encima del mínimo de 5 s que better-auth deja entre consultas

async function sinSesion(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: E2E_BASE, viewport: DESK, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByTestId("auth-form")).toBeVisible();
  return page;
}

/** Sale de la pestaña y vuelve: espera fuera y dispara el `visibilitychange` que oye better-auth. */
async function salirYVolver(page: Page): Promise<void> {
  await page.waitForTimeout(FUERA_MS);
  const consulta = page.waitForResponse((r) => r.url().includes("/api/auth/get-session"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await consulta;
}

test.describe("BG-050 · volver a la pestaña no borra lo escrito", () => {
  test("BG-050-a: el correo escrito sigue ahí y el campo es el mismo", async ({ browser }) => {
    const page = await sinSesion(browser);
    await page.getByTestId("auth-email").fill("alguien@example.com");
    await page.getByTestId("auth-email").evaluate((el) => { (el as HTMLElement).dataset.marca = "original"; });
    await salirYVolver(page);
    await expect(page.getByTestId("auth-email")).toHaveValue("alguien@example.com");
    await expect(page.getByTestId("auth-email")).toHaveAttribute("data-marca", "original");
    await page.context().close();
  });

  test("BG-050-b: en el registro se conservan nombre, correo y contraseña y no vuelve a «Iniciar sesión»", async ({ browser }) => {
    const page = await sinSesion(browser);
    await page.getByTestId("auth-toggle").click();
    await expect(page.getByTestId("auth-name")).toBeVisible();
    await page.getByTestId("auth-name").fill("Alguien");
    await page.getByTestId("auth-email").fill("alguien@example.com");
    await page.getByTestId("auth-password").fill("Una-clave-larga-1");
    await salirYVolver(page);
    await expect(page.getByTestId("auth-name")).toHaveValue("Alguien");
    await expect(page.getByTestId("auth-email")).toHaveValue("alguien@example.com");
    await expect(page.getByTestId("auth-password")).toHaveValue("Una-clave-larga-1");
    await page.context().close();
  });

  test("BG-050-c: la solicitud de recuperación conserva el correo", async ({ browser }) => {
    const page = await sinSesion(browser);
    await page.getByTestId("auth-forgot").click();
    const correo = page.getByTestId("reset-email");
    await correo.fill("alguien@example.com");
    await salirYVolver(page);
    await expect(correo).toHaveValue("alguien@example.com");
    await page.context().close();
  });
});
