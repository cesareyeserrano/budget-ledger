import { test, expect } from "@playwright/test";

// TCs sembrados en 03_TEST_CASES.json que no tenían spec real (aparecían como skip en verify-run).
// Cada test embebe su TC id en el título para que aitri verify-run lo mapee.
// Cubren: FR-006 (TC-006e), FR-010 (TC-010f), FR-012/NFR-002 (TC-012e, TC-102h, TC-102e).

test("TC-006e: editar una celda-hoja Pres. y confirmar con Enter fija el nuevo valor", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  await grid.getByText("Comida", { exact: true }).first().click(); // expandir para exponer celdas de hoja
  const leaf = grid.getByTestId("cell-leaf").first();
  await leaf.click();
  const editor = page.getByLabel("Editar valor");
  await expect(editor).toBeVisible();
  await editor.fill("123456");
  await editor.press("Enter");
  await expect(page.getByLabel("Editar valor")).toHaveCount(0);              // editor cerrado tras confirmar
  await expect(grid.getByTestId("cell-leaf").first()).toHaveText("123.456"); // el nuevo valor quedó fijado
});

test("TC-010f: en el límite exacto de 760px se muestra la vista compacta móvil (solo Registrar)", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();  // a 760px exactos → móvil
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);  // grilla ausente del DOM
});

test("TC-012e: el contraste de texto primario sobre el fondo es ≥ 4.5:1", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const ratio = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const hexToRgb = (h: string) => {
      let v = h.trim().replace("#", "");
      if (v.length === 3) v = [...v].map((c) => c + c).join(""); // #fff → #ffffff (Lightning CSS minifica)
      return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
    };
    const lum = (rgb: number[]) => {
      const a = rgb.map((c) => {
        const x = c / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    };
    const fg = lum(hexToRgb(s.getPropertyValue("--fg")));
    const bg = lum(hexToRgb(s.getPropertyValue("--bg")));
    const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
    return (hi + 0.05) / (lo + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test("TC-102h: la app renderiza sin desborde horizontal a 375, 768 y 1440px", async ({ page }) => {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    // esperar a que el shell correspondiente esté montado antes de medir
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow, `desborde horizontal a ${width}px`).toBeLessThanOrEqual(1); // ≤1px de tolerancia de redondeo
  }
});

test("TC-102e: los controles clave son accesibles por teclado con foco visible", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 }); // vista de registro (controles clave)
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await page.mouse.click(5, 5); // enfocar el documento (headless: Tab no avanza desde body sin foco previo)

  // tabular por la página hasta enfocar un control interactivo
  let focused: { tag: string; visibleFocus: boolean } | null = null;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const tag = el.tagName.toLowerCase();
      const interactive = ["input", "button", "select", "a", "textarea"].includes(tag) || el.getAttribute("role") === "combobox" || el.tabIndex >= 0;
      if (!interactive) return { tag, visibleFocus: false };
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      const ring = cs.boxShadow !== "none" && cs.boxShadow !== "";
      return { tag, visibleFocus: outline || ring };
    });
    if (focused?.visibleFocus) break;
  }
  expect(focused, "ningún control recibió foco por teclado").not.toBeNull();
  expect(focused!.visibleFocus, `el control enfocado (${focused!.tag}) no muestra indicador de foco visible`).toBe(true);
});
