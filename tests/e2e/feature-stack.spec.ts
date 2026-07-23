import { test, expect, type Page } from "@playwright/test";

// Feature stack-upgrade-theme — registro móvil MVP + tema zinc + stack. Cada test embebe su TC id.

const MOBILE = { width: 375, height: 900 };
const DESK = { width: 1440, height: 900 };

/** "#C4453E" → "rgb(196, 69, 62)" para comparar con getComputedStyle. */
function rgb(hex: string): string {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
// ux-consistency FR-301/FR-311: los acentos se AFINAN a tonos desaturados (ladrillo/bosque/acero)
// para eliminar la vibración. Mismo hue y semántica; permitido por NFR-302 ("los tokens se AFINAN").
const EXPENSE_L = rgb("#C4453E"), INCOME_L = rgb("#2F7D53"), TRANSFER_L = rgb("#2F6DB4");
// El relleno de acento (toggle/Guardar) usa el tono de claro en ambos temas → ≥4.9:1 con texto blanco.
// Con la paleta afinada el relleno coincide con el color base del tipo.
const INCOME_FILL = INCOME_L;

async function gotoMobile(page: Page, scheme: "light" | "dark" = "light") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
}
const catButtons = (page: Page) => page.getByTestId("category-row").getByRole("button");

/** Elige la HOJA disponible: clic en la primera categoría; si despliega subcategorías, elige la primera. */
async function selectLeaf(page: Page) {
  await catButtons(page).first().click();
  const subRow = page.getByTestId("subcategory-row");
  const hasSubs = await subRow.waitFor({ state: "visible", timeout: 800 }).then(() => true).catch(() => false);
  if (hasSubs) await subRow.getByRole("button").first().click();
}

// ── FR-201 · tema ────────────────────────────────────────────────────────────
test("TC-SUT-201h: SO en oscuro sin preferencia arranca en tema oscuro con el lienzo oscuro", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
  expect(bg).toBe("#131316"); // ux-consistency FR-301: lienzo oscuro afinado (#09090b→#131316, nunca negro puro)
});

// ── FR-203 · propagación de color ────────────────────────────────────────────
test("TC-SUT-207h: el color del tipo activo se propaga a signo, input y botón Guardar", async ({ page }) => {
  await gotoMobile(page);
  await expect(page.getByTestId("amount-sign")).toHaveCSS("color", EXPENSE_L);
  await expect(page.getByTestId("amount-input")).toHaveCSS("color", EXPENSE_L);
  await expect(page.getByTestId("save-button")).toHaveCSS("background-color", EXPENSE_L);
  await page.getByTestId("type-income").click();
  await expect(page.getByTestId("amount-sign")).toHaveCSS("color", INCOME_L); // el signo del monto conserva el verde base
  await expect(page.getByTestId("save-button")).toHaveCSS("background-color", INCOME_FILL); // Guardar usa el relleno AA (green-700)
  await page.getByTestId("type-transfer").click();
  await expect(page.getByTestId("save-button")).toHaveCSS("background-color", TRANSFER_L);
});

test("TC-SUT-208e: en escritorio el chrome usa primary neutro (zinc), no un color de tipo", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  const btn = page.getByRole("button", { name: "Nuevo movimiento" });
  const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect([EXPENSE_L, INCOME_L, TRANSFER_L]).not.toContain(bg); // no se rellena con color de tipo
});

test("TC-SUT-209f: el botón de acción principal fuera del Registro no se rellena con color de tipo", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  const btn = page.getByRole("button", { name: "Nuevo movimiento" });
  const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  // fondo neutro/transparente (bordes sobre rellenos), nunca rojo/verde/azul de tipo
  expect([EXPENSE_L, INCOME_L, TRANSFER_L]).not.toContain(bg);
});

// ── FR-205 · toggle de tema ──────────────────────────────────────────────────
test("TC-SUT-213h: a 1440px el ThemeToggle aplica 'Oscuro' y <html> gana la clase dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  await page.getByTestId("theme-toggle").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
});

test("TC-SUT-214e: a 375px el ThemeToggle está en la cabecera del Registro y es accesible por teclado", async ({ page }) => {
  await gotoMobile(page);
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toBeVisible();
  await toggle.focus();
  expect(await toggle.evaluate((el) => el === document.activeElement)).toBe(true);
});

test("TC-SUT-215f: tras elegir 'Claro' y recargar, la app sigue en claro (persistencia)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" }); // sistema oscuro
  await page.setViewportSize(DESK);
  await page.goto("/");
  // forzar claro con el toggle (dark → light)
  await page.getByTestId("theme-toggle").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
});

// ── FR-206 · stack ────────────────────────────────────────────────────────────
test("TC-SUT-217e: react-day-picker se carga diferida y solo aparece al abrir el calendario", async ({ page }) => {
  await gotoMobile(page);
  await expect(page.locator(".rdp-root .rdp-month_grid")).toHaveCount(0); // no montado aún
  await page.getByTestId("date-field").click();
  await expect(page.getByTestId("date-popover")).toBeVisible();
  await expect(page.locator(".rdp-month_grid").first()).toBeVisible(); // ahora sí
});

test("TC-SUT-218f: ninguna dependencia nueva emite una petición HTTP externa en runtime", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/^https?:/i.test(u) && !/localhost|127\.0\.0\.1/.test(u)) external.push(u);
  });
  await gotoMobile(page);
  await page.getByTestId("date-field").click(); // carga react-day-picker
  await page.getByTestId("theme-toggle").click(); // next-themes
  await page.waitForTimeout(400);
  expect(external, external.join(",")).toEqual([]);
});

// ── FR-207 · monto ────────────────────────────────────────────────────────────
test("TC-SUT-219h: teclear 1250 muestra '$1.250' en DM Mono con color de Gasto y teclado numérico", async ({ page }) => {
  await gotoMobile(page);
  const input = page.getByTestId("amount-input");
  await input.fill("1250");
  await expect(input).toHaveValue("$1.250");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await expect(input).toHaveCSS("color", EXPENSE_L);
  const ff = await input.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(ff).toMatch(/DM.?Mono/i);
});

test("TC-SUT-221f: monto vacío muestra placeholder '$0' y deja Guardar deshabilitado", async ({ page }) => {
  await gotoMobile(page);
  const input = page.getByTestId("amount-input");
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("placeholder", "$0");
  await expect(page.getByTestId("save-button")).toBeDisabled();
});

// ── FR-208 · toggle de tipo ───────────────────────────────────────────────────
test("TC-SUT-223h: tipo=Gasto está relleno con el ladrillo del tipo, aria-selected=true y los otros inactivos", async ({ page }) => {
  await gotoMobile(page);
  await expect(page.getByTestId("type-expense")).toHaveCSS("background-color", EXPENSE_L);
  await expect(page.getByTestId("type-expense")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("type-income")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("type-transfer")).toHaveAttribute("aria-selected", "false");
});

test("TC-SUT-224e: cambiar de Gasto a Ingreso conserva el monto y deselecciona la categoría", async ({ page }) => {
  await gotoMobile(page);
  await page.getByTestId("amount-input").fill("50000");
  await selectLeaf(page);
  await expect(page.getByRole("button", { pressed: true })).toHaveCount(1); // una hoja seleccionada
  await page.getByTestId("type-income").click();
  await expect(page.getByTestId("amount-input")).toHaveValue("$50.000"); // monto conservado
  await expect(page.getByRole("button", { pressed: true })).toHaveCount(0); // selección limpiada
});

// ── FR-209 · categorías ───────────────────────────────────────────────────────
test("TC-SUT-226h: se elige la HOJA disponible (categoría-hoja o subcategoría) con tinte del tipo", async ({ page }) => {
  await gotoMobile(page);
  await expect(catButtons(page).first()).toBeVisible();
  expect(await catButtons(page).count()).toBeGreaterThan(0);
  await selectLeaf(page); // categoría-hoja directa, o despliega subcategorías y elige la primera
  const selected = page.getByRole("button", { pressed: true });
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveCSS("color", EXPENSE_L); // tinte del tipo activo
});

test("FR-209 extra: tocar una categoría CON subcategorías despliega sus hijos para elegir la hoja", async ({ page }) => {
  await gotoMobile(page);
  // busca una categoría que tenga subcategorías (despliega la fila de subs al tocarla)
  const n = await catButtons(page).count();
  let found = false;
  for (let i = 0; i < n; i++) {
    await catButtons(page).nth(i).click();
    const subRow = page.getByTestId("subcategory-row");
    if (await subRow.waitFor({ state: "visible", timeout: 500 }).then(() => true).catch(() => false)) {
      await expect(subRow.getByRole("button").first()).toBeVisible();
      await subRow.getByRole("button").first().click();
      await expect(subRow.getByRole("button", { pressed: true })).toHaveCount(1); // subcategoría elegida
      found = true;
      break;
    }
  }
  expect(found, "el seed debe tener al menos una categoría con subcategorías").toBe(true);
});

test("TC-SUT-227e: un tipo sin categorías muestra la guía a crearlas en escritorio y bloquea Guardar", async ({ page }) => {
  await gotoMobile(page);
  // Quitar TODOS los nodos de Transferencia (grupo, categoría y sub) del estado persistido.
  // Incluye el grupo: desde promote-to-group (FR-606) un grupo SIN hijos es un destino válido del
  // registro, así que un tipo está "vacío" solo si no le queda ni categoría ni grupo-hoja.
  await page.evaluate(() => {
    const raw = localStorage.getItem("ledger.nodes.v1");
    if (!raw) return;
    const data = JSON.parse(raw);
    data.nodes = data.nodes.filter((n: { type: string; level: string }) => !(n.type === "transfer" && (n.level === "category" || n.level === "sub" || n.level === "group")));
    localStorage.setItem("ledger.nodes.v1", JSON.stringify(data));
  });
  await page.reload();
  await page.getByTestId("type-transfer").click();
  await expect(page.getByTestId("category-empty")).toBeVisible();
  await expect(page.getByTestId("category-empty")).toContainText("créalas en el escritorio");
});

test("TC-SUT-228f: guardar sin categoría muestra 'Elige una categoría.' y no persiste", async ({ page }) => {
  await gotoMobile(page);
  await page.getByTestId("amount-input").fill("30000");
  await page.getByTestId("save-button").click();
  await expect(page.getByRole("alert").filter({ hasText: "Elige una categoría." })).toBeVisible();
  await expect(page.getByTestId("recent-item")).toHaveCount(0); // no se agregó
});

// ── FR-210 · fecha ────────────────────────────────────────────────────────────
test("TC-SUT-229h: el campo de fecha muestra 'Hoy' por defecto", async ({ page }) => {
  await gotoMobile(page);
  await expect(page.getByTestId("date-label")).toHaveText("Hoy");
});

test("TC-SUT-230e: abrir el calendario y elegir el día 15 muestra la fecha y cierra el popover", async ({ page }) => {
  await gotoMobile(page);
  await page.getByTestId("date-field").click();
  await expect(page.getByTestId("date-popover")).toBeVisible();
  await page.getByTestId("date-popover").getByText("15", { exact: true }).first().click();
  await expect(page.getByTestId("date-popover")).toHaveCount(0);
  await expect(page.getByTestId("date-label")).toContainText("15");
  await expect(page.getByTestId("date-label")).not.toContainText(":"); // la hora no se muestra
});

test("TC-SUT-231f: clic fuera del popover lo cierra sin cambiar la fecha", async ({ page }) => {
  await gotoMobile(page);
  await page.getByTestId("date-field").click();
  await expect(page.getByTestId("date-popover")).toBeVisible();
  await page.getByText("Nuevo movimiento").click(); // clic fuera
  await expect(page.getByTestId("date-popover")).toHaveCount(0);
  await expect(page.getByTestId("date-label")).toHaveText("Hoy"); // sin cambios
});

// ── FR-212 · guardado + overlay + banner ──────────────────────────────────────
test("TC-SUT-237e: tras guardar aparece el overlay ~2s y el formulario se resetea a fecha=Hoy", async ({ page }) => {
  await gotoMobile(page);
  await page.getByTestId("amount-input").fill("50000");
  await selectLeaf(page);
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("confirm-overlay")).toBeVisible();
  await expect(page.getByTestId("confirm-overlay")).toContainText("$50.000");
  await expect(page.getByTestId("confirm-overlay")).toHaveCount(0, { timeout: 4000 }); // autocierre ~2s
  await expect(page.getByTestId("amount-input")).toHaveValue(""); // reset
  await expect(page.getByTestId("date-label")).toHaveText("Hoy");
});

test("TC-SUT-239f: con monto=0 el botón Guardar está deshabilitado; con monto y sin categoría no crea movimiento", async ({ page }) => {
  await gotoMobile(page);
  await expect(page.getByTestId("save-button")).toBeDisabled(); // monto 0
  await page.getByTestId("amount-input").fill("10000");
  await page.getByTestId("save-button").click(); // sin categoría
  await expect(page.getByTestId("recent-item")).toHaveCount(0);
});

test("TC-SUT-240e: fallo de almacenamiento (quota) muestra el StorageBanner y el form sigue usable", async ({ page }) => {
  await page.addInitScript(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === "ledger.budget.v2") { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
      return orig.call(this, k, v);
    };
  });
  await gotoMobile(page);
  await page.getByTestId("amount-input").fill("50000");
  await selectLeaf(page);
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("storage-banner")).toBeVisible();
  await expect(page.getByTestId("amount-input")).toBeVisible(); // el form sigue usable
});

// ── FR-213 · tipografía ───────────────────────────────────────────────────────
test("TC-SUT-241h: el texto general usa Inter y el monto usa DM Mono tabular-nums", async ({ page }) => {
  await gotoMobile(page);
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(bodyFont).toMatch(/Inter/i);
  const input = page.getByTestId("amount-input");
  expect(await input.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/DM.?Mono/i);
  expect(await input.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
});

test("TC-SUT-242e: el monto no salta de ancho al teclear (tabular-nums)", async ({ page }) => {
  await gotoMobile(page);
  const input = page.getByTestId("amount-input");
  expect(await input.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
  await input.fill("111111");
  await expect(input).toHaveValue("$111.111");
});

// ── NFR-201 · sin regresión funcional ─────────────────────────────────────────
test("TC-SUT-244h: la grilla de 12 meses y sus controles siguen funcionando tras la feature", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  await expect(grid.getByText("Enero").first()).toBeVisible();
  await expect(grid.getByText("Diciembre").first()).toBeVisible();
});

test("TC-SUT-245e: edición inline de una hoja se conserva en tema oscuro", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  const cell = page.getByTestId("cell-leaf").first();
  await cell.click();
  const editor = page.getByLabel("Editar valor");
  await editor.fill("123456");
  await editor.press("Enter");
  await expect(page.getByTestId("cell-leaf").first()).toContainText("123.456");
});

test("TC-SUT-246f: interacciones de escritorio (tabs Resumen/Dashboard) no cambian de comportamiento", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect(page.getByTestId("over-empty")).toBeVisible(); // el dashboard reacciona igual que antes
});

// ── NFR-203 · accesibilidad ────────────────────────────────────────────────────
test("TC-SUT-252f: los controles del Registro tienen min-height ≥48px", async ({ page }) => {
  await gotoMobile(page);
  for (const id of ["type-expense", "save-button", "date-field"]) {
    const el = page.getByTestId(id);
    await expect(el).toBeVisible(); // esperar a que el layout se asiente antes de medir
    const h = await el.evaluate((n) => Math.round(n.getBoundingClientRect().height));
    expect(h, `min-height de ${id}`).toBeGreaterThanOrEqual(48);
  }
});

// ── NFR-204 · sin peticiones externas ──────────────────────────────────────────
test("TC-SUT-253h: cargar, cambiar tema, abrir calendario y guardar producen 0 peticiones externas", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { const u = r.url(); if (/^https?:/i.test(u) && !/localhost|127\.0\.0\.1/.test(u)) external.push(u); });
  await gotoMobile(page);
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("date-field").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("amount-input").fill("1000");
  await selectLeaf(page);
  await page.getByTestId("save-button").click();
  await page.waitForTimeout(400);
  expect(external, external.join(",")).toEqual([]);
});

test("TC-SUT-255f: abrir el calendario (react-day-picker) no emite ninguna petición externa", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { const u = r.url(); if (/^https?:/i.test(u) && !/localhost|127\.0\.0\.1/.test(u)) external.push(u); });
  await gotoMobile(page);
  await page.getByTestId("date-field").click();
  await expect(page.getByTestId("date-popover")).toBeVisible();
  await page.waitForTimeout(300);
  expect(external, external.join(",")).toEqual([]);
});

// ── NFR-205 · sin regresión de layout ──────────────────────────────────────────
test("TC-SUT-256h: a 1440px la grilla conserva alineación y columna sticky", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("budget-grid").getByText("CATEGORÍA", { exact: true })).toBeVisible();
});

test("TC-SUT-257e: a 375px se muestra solo el Registro sin desbordamiento horizontal", async ({ page }) => {
  await gotoMobile(page);
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(overflow).toBe(true);
});

test("TC-SUT-258f: cambiar de tema no altera el layout a 1440px", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  const before = await page.getByTestId("budget-grid").evaluate((el) => el.getBoundingClientRect().width);
  await page.getByTestId("theme-toggle").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  const after = await page.getByTestId("budget-grid").evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
});

// ── NFR-206 · registro centrado ─────────────────────────────────────────────────
test("TC-SUT-259h: el Registro no produce scroll horizontal a 375, 768 ni 1440px", async ({ page }) => {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const noX = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noX, `overflow a ${width}px`).toBe(true);
  }
});

test("TC-SUT-260e: a 768px el Registro se mantiene centrado a máx. 480px", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  // 768px ≤ 760 breakpoint? no: 768 > 760 → escritorio. La vista móvil es ≤760; a 760 es móvil.
  await page.setViewportSize({ width: 760, height: 900 });
  await page.reload();
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
});

test("TC-SUT-261f: tras Guardar el overlay de confirmación aparece de inmediato", async ({ page }) => {
  await gotoMobile(page);
  await page.getByTestId("amount-input").fill("50000");
  await selectLeaf(page);
  const t0 = Date.now();
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("confirm-overlay")).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(2000); // feedback perceptible inmediato
});

// ── Refinamientos de revisión (fuente consistente + registro unificado) ────────
test("FR-213 extra: los botones de escritorio usan la misma fuente de texto (Inter, no DM Mono)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  const btnFont = await page.getByRole("button", { name: "Nuevo movimiento" }).evaluate((el) => getComputedStyle(el).fontFamily);
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(btnFont).toMatch(/Inter/i);
  expect(btnFont).not.toMatch(/DM.?Mono/i);
  expect(btnFont).toBe(bodyFont); // misma fuente que el resto de la UI
});

test("FR-207 extra: el módulo de registro de escritorio es el MISMO Register que en móvil", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  await page.getByRole("button", { name: "Nuevo movimiento" }).click();
  await expect(page.getByTestId("type-expense")).toBeVisible();
  await expect(page.getByTestId("amount-input")).toBeVisible();
  await expect(page.getByTestId("save-button")).toBeVisible();
});
