import { test, expect } from "./helpers/fixtures";

// Flujos críticos de UI (FR-006/009/010/012). Cada test embebe su TC id para verify-run.

test("TC-012h: los tokens CSS coinciden con el sistema de diseño zinc (tema claro)", async ({ page }) => {
  // Feature stack-upgrade-theme: reemplaza César Augusto steel-blue por zinc neutro + tema claro/oscuro.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      bg: s.getPropertyValue("--bg").trim(),
      primary: s.getPropertyValue("--primary").trim(),
      success: s.getPropertyValue("--success").trim(),
      warning: s.getPropertyValue("--warning").trim(),
      error: s.getPropertyValue("--error").trim(),
      font: s.getPropertyValue("--font-sans").trim(),
      transfer: s.getPropertyValue("--type-transfer").trim(),
    };
  });
  // Lightning CSS minifica #ffffff → #fff; normalizamos el shorthand antes de comparar.
  const expand = (h: string) => (h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h);
  // ux-consistency FR-301/FR-311: lienzo off-white + acentos desaturados (mismo hue, sin vibración).
  expect(expand(tokens.bg)).toBe("#f7f7f8"); // lienzo (antes #ffffff) para profundidad
  expect(tokens.primary).toBe("#1c1c1f");
  // refinamiento-ui FR-1201 fusiona los pares de estado en tres roles canónicos —favorable,
  // alert-soft y alert-strong—, y en cada par conserva el valor con MEJOR contraste medido. Los
  // literales de abajo son los nuevos: la unificación sube el contraste o lo deja igual, nunca lo
  // baja (4.87:1, 4.92:1 y 4.85:1). El invariante que este TC protege no se relaja.
  // --type-transfer queda fuera de la fusión: los --type-* siguen vivos para el registro (NFR-1203).
  expect(tokens.success).toBe("#2d7650");
  expect(tokens.warning).toBe("#9e4708");
  expect(tokens.error).toBe("#ad3932");
  expect(tokens.transfer).toBe("#2f6db4"); // Transferencia: azul acero (FR-204)
  expect(tokens.font).toContain("Inter"); // FR-213: Inter reemplaza Lexend
});

// presupuesto-movil (FR-3113) cambió FR-010: a ≤760 px ya no hay SOLO registro — hay registro y una
// vista de presupuesto propia. Lo que esta prueba sigue fijando es que la app ABRE en el registro y que la
// grilla de escritorio no se monta en el teléfono. La vista nueva se prueba en presupuesto-movil.spec.ts.
test("TC-010h: 375px abre en Registrar, sin la grilla de escritorio; escritorio muestra la grilla", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);

  await page.setViewportSize({ width: 1300, height: 900 });
  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("mobile-shell")).toHaveCount(0);
});

test("TC-001h: registrar un movimiento lo guarda y confirma con toast", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  // Registro rediseñado (feature stack-upgrade-theme): monto + elegir la hoja disponible + Guardar.
  await page.getByLabel("Monto en pesos").fill("50000");
  await page.getByTestId("category-row").getByRole("button").first().click();
  const subRow = page.getByTestId("subcategory-row");
  if (await subRow.waitFor({ state: "visible", timeout: 800 }).then(() => true).catch(() => false)) {
    await subRow.getByRole("button").first().click();
  }
  await page.getByTestId("save-button").click();
  // BL-003: la lista 'Recientes' se retiró del móvil; el guardado se confirma por el overlay
  // con el monto y por el campo de monto que vuelve a 0 (AC de FR-001).
  await expect(page.getByTestId("confirm-overlay")).toContainText("$50.000");
  await expect(page.getByTestId("confirm-overlay")).toHaveCount(0, { timeout: 4000 });
  await expect(page.getByLabel("Monto en pesos")).toHaveValue("");
});

test("TC-006h: la grilla renderiza con columna categoría sticky y 12 meses", async ({ page }) => {
  // BL-063: afirmaba que tres textos se veían. Lo que el caso declara es que, al hacer scroll 300 px
  // en vertical y 400 px en horizontal, la columna de categoría y los encabezados de mes NO se van.
  // 1440 de ancho como pide el caso; el alto se acorta para que la grilla tenga 300 px que recorrer.
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  await grid.getByText("Comida", { exact: true }).first().click(); // jerarquía expandida
  // exact:true evita colisionar con los botones "Nueva categoría"/"Nueva subcategoría" (substring case-insensitive)
  const esquina = grid.getByText("CATEGORÍA", { exact: true });
  await expect(esquina).toBeVisible();

  // La grilla arranca desplazada al mes en curso (BG-007): se parte del origen para medir el scroll.
  await grid.evaluate((el) => { el.scrollTop = 0; el.scrollLeft = 0; });
  expect(await grid.evaluate((el) => [el.scrollTop, el.scrollLeft])).toEqual([0, 0]);
  const cabeza = grid.locator("[data-month-head]").nth(2);
  const fila = grid.locator('[data-testid="node-row"]').filter({ hasText: "Vivienda" }).first();
  const etiqueta = fila.getByTestId("row-label");
  const celda = fila.getByTestId("cell-leaf").first();
  const caja = async (l: typeof cabeza) => (await l.boundingBox())!;
  const antes = { cabeza: await caja(cabeza), etiqueta: await caja(etiqueta), celda: await caja(celda), esquina: await caja(esquina) };

  await grid.evaluate((el) => { el.scrollTop = 300; el.scrollLeft = 400; });
  // el scroll ocurrió entero: si la grilla no tuviera recorrido, lo de abajo no probaría nada
  expect(await grid.evaluate((el) => [el.scrollTop, el.scrollLeft])).toEqual([300, 400]);
  const despues = { cabeza: await caja(cabeza), etiqueta: await caja(etiqueta), celda: await caja(celda), esquina: await caja(esquina) };

  // Lo que NO es sticky se fue con el scroll…
  expect(Math.abs(despues.celda.x - (antes.celda.x - 400))).toBeLessThan(2);
  expect(Math.abs(despues.celda.y - (antes.celda.y - 300))).toBeLessThan(2);
  // …la columna de categoría se movió en vertical con su fila, pero sigue pegada a la izquierda…
  expect(Math.abs(despues.etiqueta.x - antes.etiqueta.x)).toBeLessThan(2);
  expect(Math.abs(despues.etiqueta.y - (antes.etiqueta.y - 300))).toBeLessThan(2);
  // …los encabezados de mes se movieron en horizontal con su columna, pero siguen pegados arriba…
  expect(Math.abs(despues.cabeza.y - antes.cabeza.y)).toBeLessThan(2);
  expect(Math.abs(despues.cabeza.x - (antes.cabeza.x - 400))).toBeLessThan(2);
  // …y la esquina, que es de las dos, no se movió nada.
  expect(Math.abs(despues.esquina.x - antes.esquina.x)).toBeLessThan(2);
  expect(Math.abs(despues.esquina.y - antes.esquina.y)).toBeLessThan(2);
  await expect(esquina).toBeVisible();
});

test("TC-009f: dashboard muestra estado vacío de 'Sobre presupuesto' cuando no hay excesos", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect(page.getByTestId("over-empty")).toBeVisible();
});
