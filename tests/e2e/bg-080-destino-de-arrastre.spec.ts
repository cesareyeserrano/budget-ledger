import { test, expect, type Page, type Locator } from "./helpers/fixtures";

// BG-080 (f) — una fila solo se ilumina como destino de arrastre si soltar ahí hace algo. Antes se
// iluminaba cualquier grupo o categoría bajo el puntero —de otro tipo, la propia fila— y al soltar no
// pasaba nada, sin ningún aviso. FR-015 pide realzar «el destino válido».
//
// dnd-kit usa PointerSensor con distancia de activación: el arrastre se simula con pasos de mouse.

const rotulo = (page: Page, nombre: RegExp): Locator =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: nombre }) }).first().getByTestId("row-label");

/** Toma la fila `desde` y la lleva sobre `hasta` SIN soltar. */
async function arrastrarSobre(page: Page, desde: Locator, hasta: Locator): Promise<void> {
  const a = await desde.boundingBox();
  const b = await hasta.boundingBox();
  if (!a || !b) throw new Error("no bounding box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
}

const iluminada = (fila: Locator) => fila.evaluate((el) => (el as HTMLElement).style.boxShadow.includes("var(--accent)"));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
});

test.describe("BG-080 (f) · el destino de arrastre", () => {
  test("BG-080f: un grupo de OTRO tipo no se ilumina, y soltar ahí no mueve nada", async ({ page }) => {
    const filas = () => page.getByTestId("row-label").evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
    const antes = await filas();
    const vivienda = rotulo(page, /^Vivienda/);
    const trabajo = rotulo(page, /^Trabajo/); // grupo de ingresos; Vivienda es un gasto
    await arrastrarSobre(page, vivienda, trabajo);
    await page.waitForTimeout(150);
    expect(await iluminada(trabajo)).toBe(false);
    await page.mouse.up();

    // Nada se movió: la grilla tiene las mismas filas en el mismo orden.
    await page.waitForTimeout(150);
    expect(await filas()).toEqual(antes);
  });

  test("BG-080f: la propia fila tampoco se ilumina", async ({ page }) => {
    const comida = rotulo(page, /^Comida/);
    const a = await comida.boundingBox();
    if (!a) throw new Error("no bounding box");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 14, a.y + a.height / 2, { steps: 5 });
    await page.waitForTimeout(150);
    expect(await iluminada(comida)).toBe(false);
    await page.mouse.up();
  });

  test("BG-080f: una categoría del MISMO tipo sí se ilumina (control)", async ({ page }) => {
    const vivienda = rotulo(page, /^Vivienda/);
    const transporte = rotulo(page, /^Transporte/);
    await arrastrarSobre(page, vivienda, transporte);
    await expect.poll(() => iluminada(transporte)).toBe(true);
    // Se vuelve al origen antes de soltar: esta prueba mira el realce, no el movimiento.
    const a = await vivienda.boundingBox();
    if (a) await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 10 });
    await page.mouse.up();
  });
});
