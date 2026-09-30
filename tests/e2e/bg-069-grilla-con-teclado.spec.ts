import { test, expect, type Page, type Locator } from "./helpers/fixtures";

// BG-069 — la estructura de la grilla se opera también con teclado. Las acciones de fila (agregar,
// renombrar, borrar) solo se pintaban con el mouse encima y las celdas no estaban en el orden de
// tabulación: sin mouse no se podía crear, renombrar ni editar nada. Aquí todo se hace con Tab,
// Enter y Escape, con el mouse aparcado fuera de la grilla.
//
// Los botones se buscan por nombre EXACTO: el rótulo de la fila es a su vez un «botón» (el asa de
// arrastre de dnd-kit) y su nombre accesible incluye el de los botones que contiene.

const DESK = { width: 1440, height: 1250 };

const fila = (page: Page, nombre: RegExp): Locator =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: nombre }) }).first();

/** Identidad de la celda con el foco (null si el foco no está en una celda). */
const celdaConFoco = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.dataset.cell ? { cell: el.dataset.cell, month: el.dataset.month, plane: el.dataset.plane, role: el.getAttribute("role") } : null;
  });

async function abrir(page: Page): Promise<void> {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.mouse.move(0, 0); // el mouse no ayuda: nada de hover
}

test.describe("BG-069 · la grilla sin mouse", () => {
  test("BG-069-a: al llegar con el teclado a una fila aparecen sus acciones y «Renombrar» se opera con Enter", async ({ page }) => {
    await abrir(page);
    const vivienda = fila(page, /^Vivienda/);
    await expect(vivienda.getByRole("button", { name: "Renombrar", exact: true })).toHaveCount(0);

    // Desde su primera celda, Shift+Tab entra en el rótulo de la fila: las acciones aparecen.
    await vivienda.locator("[data-cell]").first().focus();
    await page.keyboard.press("Shift+Tab");
    await expect(vivienda.getByRole("button", { name: "Agregar subcategoría", exact: true })).toBeVisible();
    await expect(vivienda.getByRole("button", { name: "Renombrar", exact: true })).toBeVisible();

    // Hacia atrás hasta el ícono de la fila, y desde ahí hacia delante en el orden de lectura.
    const icono = vivienda.getByRole("button", { name: "Cambiar ícono", exact: true });
    for (let i = 0; i < 5 && !(await icono.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Shift+Tab");
    await expect(icono).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(vivienda.getByRole("button", { name: "Agregar subcategoría", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(vivienda.getByRole("button", { name: "Renombrar", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Nombre", { exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveCount(0);
  });

  test("BG-069-b: una celda se alcanza con Tab, se abre con Enter y el foco vuelve a ella al cerrar", async ({ page }) => {
    await abrir(page);
    const vivienda = fila(page, /^Vivienda/);
    await vivienda.locator("[data-cell]").first().focus();
    await page.keyboard.press("Shift+Tab");
    // Del rótulo, Tab recorre las acciones y llega a la primera celda de la fila.
    for (let i = 0; i < 6 && (await celdaConFoco(page)) === null; i++) await page.keyboard.press("Tab");
    const celda = await celdaConFoco(page);
    expect(celda).toMatchObject({ cell: "c-vivienda", role: "button" });
    const sel = `[data-cell="${celda!.cell}"][data-month="${celda!.month}"][data-plane="${celda!.plane}"]`;
    await expect(page.locator(sel).first()).toHaveAttribute("aria-label", /^Vivienda · (Presupuestado|Ejecutado) · /);

    // Enter abre el editor; teclear y Enter guarda; el foco vuelve a la MISMA celda.
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Editar valor")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("123456");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Editar valor")).toHaveCount(0);
    await expect.poll(() => celdaConFoco(page)).toMatchObject({ cell: celda!.cell, month: celda!.month, plane: celda!.plane });
    await expect(page.locator(sel).first()).toContainText("123.456");

    // Y con Escape: cierra sin guardar y el foco tampoco se pierde.
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Editar valor")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Editar valor")).toHaveCount(0);
    await expect.poll(() => celdaConFoco(page)).toMatchObject({ cell: celda!.cell, month: celda!.month, plane: celda!.plane });
  });

  test("BG-069-c: los botones de expandir dicen si están abiertos y se operan con Enter", async ({ page }) => {
    await abrir(page);
    const comida = fila(page, /^Comida/);
    const expandir = comida.getByRole("button", { name: "Expandir", exact: true });
    await expect(expandir).toHaveAttribute("aria-expanded", "false");
    await expect(fila(page, /^Mercado/)).toHaveCount(0);
    await expandir.focus();
    await page.keyboard.press("Enter");
    await expect(expandir).toHaveAttribute("aria-expanded", "true");
    await expect(fila(page, /^Mercado/)).toBeVisible();

    // Una fila sin hijos no anuncia un estado que no tiene.
    await expect(fila(page, /^Vivienda/).getByRole("button", { name: "Expandir", exact: true, includeHidden: true })).not.toHaveAttribute("aria-expanded", /.*/);
    // La fila de tipo también.
    await expect(page.getByRole("button", { name: "Colapsar tipo", exact: true }).first()).toHaveAttribute("aria-expanded", "true");
  });

  test("BG-069-d: con el mouse no cambia nada — un clic en la fila no deja las acciones pintadas al salir", async ({ page }) => {
    await abrir(page);
    const vivienda = fila(page, /^Vivienda/);
    const rotulo = vivienda.getByTestId("row-label");
    await rotulo.scrollIntoViewIfNeeded();
    const box = (await rotulo.boundingBox())!;
    const grid = (await page.getByTestId("budget-grid").boundingBox())!;
    await page.mouse.click(Math.max(box.x, grid.x) + 40, box.y + box.height / 2);
    await expect(vivienda.getByRole("button", { name: "Renombrar", exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(vivienda.getByRole("button", { name: "Renombrar", exact: true })).toHaveCount(0);
  });

  test("BG-069-e: con el mouse, «clic, teclear, Enter» no deja el foco en la celda ni las acciones pintadas", async ({ page }) => {
    // Revisión adversarial: devolver el foco a la celda tras un Enter lo marcaba como foco de teclado,
    // y la fila se quedaba con sus acciones visibles sin el mouse encima.
    await abrir(page);
    const celda = page.locator('[data-cell="c-transporte"][data-plane="actual"]').last();
    await celda.scrollIntoViewIfNeeded();
    await celda.click();
    await expect(page.getByLabel("Editar valor")).toBeFocused();
    await page.keyboard.type("7");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Editar valor")).toHaveCount(0);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200); // el foco se devuelve en el frame siguiente: darle ocasión de fallar
    expect(await celdaConFoco(page)).toBeNull();
    await expect(page.getByRole("button", { name: "Renombrar", exact: true })).toHaveCount(0);
  });

  test("BG-069-f: crear, cancelar un borrado y borrar una categoría sin mouse, sin perder el foco", async ({ page }) => {
    await abrir(page);
    const esenciales = fila(page, /^Esenciales/);
    await esenciales.getByRole("button", { name: "Cambiar ícono", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(esenciales.getByRole("button", { name: "Agregar categoría", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Nombre", { exact: true })).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a"); // el campo trae «Nueva categoría»
    await page.keyboard.type("Mascotas");
    await page.keyboard.press("Enter");

    // Al confirmar el nombre el campo desaparece; el foco vuelve al rótulo de la fila nueva.
    const mascotas = fila(page, /^Mascotas/);
    await expect(mascotas.getByTestId("row-label")).toBeFocused();
    const borrar = mascotas.getByRole("button", { name: "Borrar", exact: true });
    for (let i = 0; i < 5 && !(await borrar.evaluate((el) => el === document.activeElement).catch(() => false)); i++) await page.keyboard.press("Tab");
    await expect(borrar).toBeFocused();

    // Borrar → el foco pasa a «Confirmar»; Tab a «Cancelar» y Enter: vuelve al rótulo, nada borrado.
    await page.keyboard.press("Enter");
    await expect(mascotas.getByRole("button", { name: "Confirmar borrado", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(mascotas.getByRole("button", { name: "Cancelar borrado", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(mascotas.getByTestId("row-label")).toBeFocused();
    await expect(mascotas.getByRole("button", { name: "Renombrar", exact: true })).toBeVisible();

    // Y ahora sí: Borrar → Confirmar con Enter.
    for (let i = 0; i < 5 && !(await borrar.evaluate((el) => el === document.activeElement).catch(() => false)); i++) await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(mascotas.getByRole("button", { name: "Confirmar borrado", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(fila(page, /^Mascotas/)).toHaveCount(0);
  });
});
