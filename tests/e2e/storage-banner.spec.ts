import { test, expect, type Page } from "./helpers/fixtures";

// BL-022 — el aviso de persistencia debe llegar al usuario en LOS DOS shells.
//
// Vivía solo en MobileShell, así que en escritorio ambos motivos ocurrían en silencio absoluto y
// el usuario seguía editando sobre datos que la fuente de verdad no confirma. Un e2e por motivo y
// por shell, que es lo que pedía el criterio de aceptación de BL-022:
//   · "network"   — el guardado no llegó al servidor (PUT caído)
//   · "malformed" — el servidor respondió algo que no cumple el contrato (BG-012)
//
// Los dos textos son distintos a propósito: decirle "no pudimos guardar" a quien tiene un problema
// de LECTURA lo manda a reintentar un guardado que nunca falló.

const DESK = { width: 1440, height: 900 };
const MOB = { width: 375, height: 812 };

/** Tumba el PUT del ledger → storageError "network". El GET sigue sirviendo normal. */
async function romperGuardado(page: Page) {
  await page.route("**/api/v1/ledger", (route) => {
    if (route.request().method() === "PUT") return route.abort("failed");
    return route.fallback();
  });
}

/** Elige una hoja en el registro móvil (mismo camino que feature-stack.spec.ts). */
async function elegirHoja(page: Page) {
  await page.getByTestId("category-row").getByRole("button").first().click();
  const subRow = page.getByTestId("subcategory-row");
  const tieneSubs = await subRow.waitFor({ state: "visible", timeout: 800 }).then(() => true).catch(() => false);
  if (tieneSubs) await subRow.getByRole("button").first().click();
}

/** Hace que el GET del ledger devuelva 200 con un cuerpo ilegible → storageError "malformed". */
async function romperLectura(page: Page) {
  await page.route("**/api/v1/ledger", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"revision":1,"state":{"forma":"equivocada"}}' });
    }
    return route.fallback();
  });
}

test.describe("BL-022 — el aviso de persistencia llega en escritorio", () => {
  test("escritorio · un guardado que no llega al servidor se avisa sobre la grilla", async ({ page }) => {
    await page.setViewportSize(DESK);
    await page.goto("/");
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    // Sin incidencia no hay aviso: si estuviera siempre visible, el test de abajo no probaría nada.
    await expect(page.getByTestId("storage-banner")).toHaveCount(0);

    await romperGuardado(page);
    const celda = page.getByTestId("cell-leaf").first();
    await celda.click();
    const editor = page.getByLabel("Editar valor");
    await editor.fill("123456");
    await editor.press("Enter");

    const aviso = page.getByTestId("storage-banner");
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("No pudimos guardar");
    // No bloquea: la grilla sigue ahí y operable.
    await expect(page.getByTestId("budget-grid")).toBeVisible();
  });

  test("escritorio · una respuesta ilegible del servidor se avisa con SU texto, no con el de red", async ({ page }) => {
    await page.setViewportSize(DESK);
    await romperLectura(page);
    await page.goto("/");

    const aviso = page.getByTestId("storage-banner");
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("no pudimos leer");
    // El texto de red NO debe aparecer: mandaría a reintentar un guardado que nunca falló.
    await expect(aviso).not.toContainText("No pudimos guardar");
  });
});

test.describe("BL-022 — el aviso sigue funcionando en móvil (regresión)", () => {
  test("móvil · guardado caído: el aviso aparece y el formulario sigue usable", async ({ page }) => {
    await page.setViewportSize(MOB);
    await page.goto("/");
    await expect(page.getByTestId("mobile-shell")).toBeVisible();
    await expect(page.getByTestId("storage-banner")).toHaveCount(0);

    await romperGuardado(page);
    await page.getByTestId("amount-input").fill("50000");
    await elegirHoja(page);
    await page.getByTestId("save-button").click();

    const aviso = page.getByTestId("storage-banner");
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("No pudimos guardar");
    await expect(page.getByTestId("amount-input")).toBeVisible();
  });

  test("móvil · respuesta ilegible: mismo texto que en escritorio", async ({ page }) => {
    await page.setViewportSize(MOB);
    await romperLectura(page);
    await page.goto("/");

    const aviso = page.getByTestId("storage-banner");
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("no pudimos leer");
  });
});
