import { test, expect, type Page, type Locator } from "./helpers/fixtures";

// BG-083 — confirmar un borrado con el teclado no deja el foco en el <body>. Cancelar y renombrar ya
// devolvían el foco al rótulo de la fila (BG-069), pero al CONFIRMAR la fila desaparece y no queda
// rótulo propio al que volver: el siguiente Tab empezaba desde el principio de la página. Ahora el foco
// pasa al rótulo de la fila vecina: la hermana siguiente y, si no hay, la de arriba.

const DESK = { width: 1440, height: 1250 };

const fila = (page: Page, nombre: RegExp): Locator =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: nombre }) }).first();

/** Los nombres de las filas de la grilla, en el orden en que se ven. */
const nombresDeFilas = (page: Page) =>
  page.getByTestId("row-label").evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));

/** El nombre de la fila cuyo rótulo tiene el foco, o null si el foco está en otra parte. */
const filaConFoco = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.dataset.testid === "row-label" ? (el.textContent ?? "").trim() : null;
  });

async function abrir(page: Page): Promise<void> {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.mouse.move(0, 0); // el mouse no ayuda: nada de hover
}

/** Crea una categoría en «Esenciales» solo con teclado; el foco queda en su rótulo. */
async function crearCategoria(page: Page, nombre: string): Promise<void> {
  const esenciales = fila(page, /^Esenciales/);
  await esenciales.getByRole("button", { name: "Cambiar ícono", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(esenciales.getByRole("button", { name: "Agregar categoría", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Nombre", { exact: true })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a"); // el campo trae «Nueva categoría»
  await page.keyboard.type(nombre);
  await page.keyboard.press("Enter");
  await expect(fila(page, new RegExp(`^${nombre}`)).getByTestId("row-label")).toBeFocused();
}

/** Desde el rótulo de la fila: Tab hasta «Borrar», Enter, y Enter en «Confirmar borrado». */
async function borrarConTeclado(page: Page, nombre: RegExp): Promise<void> {
  const f = fila(page, nombre);
  const borrar = f.getByRole("button", { name: "Borrar", exact: true });
  for (let i = 0; i < 5 && !(await borrar.evaluate((el) => el === document.activeElement).catch(() => false)); i++) await page.keyboard.press("Tab");
  await expect(borrar).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(f.getByRole("button", { name: "Confirmar borrado", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(fila(page, nombre)).toHaveCount(0);
}

test.describe("BG-083 · el foco tras confirmar un borrado con teclado", () => {
  test("BG-083-a: al borrar la última categoría del grupo, el foco pasa al rótulo de la fila de arriba", async ({ page }) => {
    await abrir(page);
    await crearCategoria(page, "Mascotas");
    const antes = await nombresDeFilas(page);
    const i = antes.findIndex((n) => n.startsWith("Mascotas"));
    expect(i).toBeGreaterThan(0);

    await borrarConTeclado(page, /^Mascotas/);

    await expect.poll(() => filaConFoco(page)).toBe(antes[i - 1]);
    // Y el siguiente Tab sigue dentro de la grilla, no vuelve al principio de la página.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="budget-grid"]'))).toBe(true);
  });

  test("BG-083-b: al borrar una categoría con una hermana debajo, el foco pasa a esa hermana", async ({ page }) => {
    await abrir(page);
    await crearCategoria(page, "Mascotas");
    await crearCategoria(page, "Jardín");
    const antes = await nombresDeFilas(page);
    const i = antes.findIndex((n) => n.startsWith("Mascotas"));
    expect(antes[i + 1]).toMatch(/^Jardín/);

    // El foco quedó en «Jardín» al crearla: se lleva al rótulo de «Mascotas» sin tocar el mouse.
    await fila(page, /^Mascotas/).getByTestId("row-label").focus();
    await page.keyboard.press("Tab"); // una tecla real: el arreglo solo actúa para quien viene del teclado
    await page.keyboard.press("Shift+Tab");
    await borrarConTeclado(page, /^Mascotas/);

    await expect.poll(() => filaConFoco(page)).toMatch(/^Jardín/);
    await expect(fila(page, /^Jardín/).getByRole("button", { name: "Renombrar", exact: true })).toBeVisible();
  });
});
