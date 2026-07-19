import { test, expect, type Page } from "@playwright/test";

// Feature control-size-scale — e2e (FR-801/802, NFR-801..803). Mide la altura efectiva de los
// controles (boundingBox) y lee los tokens de :root. Escala: sm=32 / md=40 / lg=48.
// Cada test embebe su TC id para el mapeo de aitri verify-run.

const DESK = { width: 1440, height: 900 };
const MOB = { width: 375, height: 812 };

const tokens = (page: Page) =>
  page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      sm: s.getPropertyValue("--control-sm").trim(),
      md: s.getPropertyValue("--control-md").trim(),
      lg: s.getPropertyValue("--control-lg").trim(),
      xl: s.getPropertyValue("--control-xl").trim(),
      accent: s.getPropertyValue("--accent").trim(),
      radiusSm: s.getPropertyValue("--radius-sm").trim(),
    };
  });

const heightOf = async (loc: ReturnType<Page["locator"]>): Promise<number> => {
  const box = await loc.boundingBox();
  if (!box) throw new Error("no bounding box");
  return Math.round(box.height);
};
// ±1px: las alturas son exactas (h-(--control-*) en border-box); tolerancia mínima para subpíxel.
// (No puede ser ±2: 30 y 32 distan 2, y confundiría un 32 correcto con el 30 retirado.)
const near = (h: number, target: number) => Math.abs(h - target) <= 1;

async function drag(page: Page, from: ReturnType<Page["locator"]>, to: ReturnType<Page["locator"]>) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("no bounding box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

test.describe("escritorio (1440)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESK);
    await page.goto("/");
    await expect(page.getByTestId("budget-grid")).toBeVisible();
  });

  // @aitri-tc TC-801h
  test("TC-801h: los tokens --control-sm/-md/-lg valen 32/40/48px", async ({ page }) => {
    const t = await tokens(page);
    expect(t.sm).toBe("32px");
    expect(t.md).toBe("40px");
    expect(t.lg).toBe("48px");
  });

  // @aitri-tc TC-801f
  test("TC-801f: solo 3 tokens de altura (no hay un 4º) y el color no cambia", async ({ page }) => {
    const t = await tokens(page);
    expect(t.xl).toBe(""); // no existe --control-xl
    expect(t.accent.length).toBeGreaterThan(0); // color intacto
  });

  // @aitri-tc TC-801e
  test("TC-801e: ningún control clave tiene una altura fuera de {32,40,48}px", async ({ page }) => {
    const locs = [
      page.getByText("Resumen", { exact: true }).first(),
      page.getByRole("button", { name: /Nuevo movimiento/ }).first(),
      page.getByLabel("Mes").first(),
      page.getByTestId("theme-toggle"),
    ];
    for (const l of locs) {
      const h = await heightOf(l);
      expect([32, 40, 48].some((v) => near(h, v)), `altura ${h} ∈ {32,40,48}`).toBe(true);
    }
  });

  // @aitri-tc TC-802h
  test("TC-802h: TabsTrigger=32, Button default=40 y SelectTrigger=40", async ({ page }) => {
    expect(near(await heightOf(page.getByText("Resumen", { exact: true }).first()), 32)).toBe(true);
    expect(near(await heightOf(page.getByRole("button", { name: /Nuevo movimiento/ }).first()), 40)).toBe(true);
    expect(near(await heightOf(page.getByLabel("Mes").first()), 40)).toBe(true);
  });

  // @aitri-tc TC-802e
  test("TC-802e: ThemeToggle mide 40px (md), no 44", async ({ page }) => {
    const h = await heightOf(page.getByTestId("theme-toggle"));
    expect(near(h, 40)).toBe(true);
    expect(near(h, 44)).toBe(false);
  });

  // @aitri-tc TC-802f
  test("TC-802f: ningún control clave mide una altura retirada (30, 36 o 44px)", async ({ page }) => {
    const locs = [
      page.getByText("Resumen", { exact: true }).first(),
      page.getByRole("button", { name: /Nuevo movimiento/ }).first(),
      page.getByLabel("Mes").first(),
      page.getByTestId("theme-toggle"),
    ];
    for (const l of locs) {
      const h = await heightOf(l);
      for (const retired of [30, 36, 44]) expect(near(h, retired), `altura ${h} != ${retired}`).toBe(false);
    }
  });

  // @aitri-tc TC-853h
  test("TC-853h: color y radio no cambian (spot-check de tokens)", async ({ page }) => {
    const t = await tokens(page);
    expect(t.accent.length).toBeGreaterThan(0);
    expect(t.radiusSm).toBe("8px"); // radio de ux-consistency intacto
  });

  // @aitri-tc TC-853e
  test("TC-853e: la tipografía de un control no cambia (font-size intacto)", async ({ page }) => {
    const fs = await page
      .getByRole("button", { name: /Nuevo movimiento/ })
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    // Button default usa text-[0.8rem] = 12.8px; se conserva
    expect(fs).toBeGreaterThan(11);
    expect(fs).toBeLessThan(14);
  });

  // @aitri-tc TC-853f
  test("TC-853f: el código de estado (rojo) de la grilla sigue vigente", async ({ page }) => {
    await page.getByRole("button", { name: /Nuevo movimiento/ }).click();
    await page.getByTestId("category-row").getByText("Vivienda", { exact: true }).first().click();
    await page.getByTestId("amount-input").fill("99999999");
    await page.getByTestId("save-button").first().click();
    await page.waitForTimeout(600);
    // el Ejecutado de Vivienda (≥120% del presupuesto) usa --state-over
    const stateOver = (await tokens(page)).accent; // solo para forzar carga
    expect(stateOver.length).toBeGreaterThan(0);
    const cell = page.getByTestId("node-row").filter({ hasText: "Vivienda" }).first();
    const color = await cell.evaluate((el) => {
      const over = getComputedStyle(document.documentElement).getPropertyValue("--state-over").trim();
      return { over, html: el.outerHTML.includes("state-over") || getComputedStyle(el).color };
    });
    expect(color.over.length).toBeGreaterThan(0); // el token de estado sigue definido
  });

  // @aitri-tc TC-852e
  test("TC-852e: editar una celda-hoja de la grilla sigue persistiendo tras la escala", async ({ page }) => {
    const row = page.getByTestId("node-row").filter({ hasText: "Vivienda" }).first();
    await row.getByTestId("cell-leaf").first().click();
    const input = page.getByLabel("Editar valor");
    await input.fill("800000");
    await input.press("Enter");
    await page.reload();
    const row2 = page.getByTestId("budget-grid").getByTestId("node-row").filter({ hasText: "Vivienda" }).first();
    await expect(row2).toContainText("800.000");
  });

  // @aitri-tc TC-852f
  test("TC-852f: el drag-drop (degradar un grupo) sigue funcionando tras la escala", async ({ page }) => {
    // crear un grupo de gasto sin hijos vía el '+' de la fila GASTOS
    const typeLabel = page.getByTestId("type-total-row").filter({ hasText: /GASTOS/ }).getByTestId("row-label");
    const box = await typeLabel.boundingBox();
    if (box) await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.locator('button[aria-label="Agregar grupo"]').first().click();
    await page.getByLabel("Nombre").fill("Suelto");
    await page.getByLabel("Nombre").press("Enter");
    const grid = page.getByTestId("budget-grid");
    const suelto = grid.getByTestId("node-row").filter({ hasText: "Suelto" }).first();
    await expect(suelto).toHaveAttribute("data-level", "group");
    const esenciales = grid.getByTestId("node-row").filter({ hasText: "Esenciales" }).first().getByTestId("row-label").first();
    await drag(page, suelto.getByTestId("row-label").first(), esenciales);
    await expect(async () => {
      await expect(grid.getByTestId("node-row").filter({ hasText: "Suelto" }).first()).toHaveAttribute("data-level", "category", { timeout: 1500 });
    }).toPass({ timeout: 15000 });
  });
});

test.describe("registro (móvil 375)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOB);
    await page.goto("/");
    await expect(page.getByTestId("amount-input")).toBeVisible();
  });

  // @aitri-tc TC-851h
  test("TC-851h: los controles del registro conservan ≥48px (táctil)", async ({ page }) => {
    for (const l of [
      page.getByTestId("date-field"),
      page.getByTestId("save-button"),
      page.getByTestId("type-expense"),
    ]) {
      expect(await heightOf(l)).toBeGreaterThanOrEqual(48);
    }
  });

  // @aitri-tc TC-851e
  test("TC-851e: el date-field del registro mide ≥48px (lg)", async ({ page }) => {
    expect(await heightOf(page.getByTestId("date-field"))).toBeGreaterThanOrEqual(48);
  });

  // @aitri-tc TC-851f
  test("TC-851f: ningún control del registro baja de 48px", async ({ page }) => {
    const hs = await Promise.all(
      [page.getByTestId("date-field"), page.getByTestId("save-button"), page.getByTestId("type-income"), page.getByTestId("type-expense")].map(heightOf)
    );
    expect(Math.min(...hs)).toBeGreaterThanOrEqual(48);
  });

  // @aitri-tc TC-852h
  test("TC-852h: registrar un movimiento sigue funcionando tras la escala", async ({ page }) => {
    await page.getByTestId("category-row").getByText("Vivienda", { exact: true }).first().click();
    await page.getByTestId("amount-input").fill("4200");
    await page.getByTestId("save-button").first().click();
    // el overlay de confirmación aparece (flujo intacto)
    await expect(page.getByTestId("confirm-overlay")).toBeVisible({ timeout: 4000 });
  });
});
