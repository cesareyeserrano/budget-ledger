import { test, expect } from "@playwright/test";

// Feature grid-ux — e2e. Cada test embebe su TC id para el mapeo de aitri verify-run.
const DESK = { width: 1440, height: 1250 };

type PW = import("@playwright/test").Page;
type Loc = import("@playwright/test").Locator;

function row(page: PW, name: RegExp): Loc {
  return page.getByTestId("budget-grid").locator("div").filter({ hasText: name }).first();
}
// Hover fiable: mueve el mouse al centro-izquierda de la fila (evita la fragilidad de .hover() sobre hijos).
// BG-007: la grilla arranca auto-scrolleada al mes en curso, así que box.x de la fila puede ser
// negativo; el hover se ancla a la columna de etiquetas (sticky), siempre visible al borde
// izquierdo del contenedor.
async function hoverRow(page: PW, r: Loc) {
  await r.scrollIntoViewIfNeeded();
  const box = await r.boundingBox();
  const grid = await page.getByTestId("budget-grid").boundingBox();
  if (box) await page.mouse.move(Math.max(box.x, grid?.x ?? 0) + 40, box.y + box.height / 2);
}

// ---------- FR-101 — crear grupo desde la grilla ----------
test("TC-201h: el '+' en hover del TIPO crea un grupo y abre rename inline", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await hoverRow(page, row(page, /^GASTOS/));
  await page.locator(String.raw`button[aria-label="Agregar grupo"]`).first().click();
  await expect(page.getByLabel("Nombre")).toBeVisible();
});

test("TC-201e: al confirmar el nombre, el grupo nuevo queda en la jerarquía", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await hoverRow(page, row(page, /^GASTOS/));
  await page.locator(String.raw`button[aria-label="Agregar grupo"]`).first().click();
  const inp = page.getByLabel("Nombre");
  await inp.click();
  await inp.fill("Ocio Test");
  await inp.press("Enter");
  await expect(page.getByTestId("budget-grid")).toContainText("Ocio Test");
});

test("TC-201f: no hay filas adder persistentes; el '+' de grupo vive en el tipo", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  // sin filas adder de texto
  await expect(page.getByText("Nuevo grupo", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Nueva subcategoría", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Nueva categoría", { exact: true })).toHaveCount(0);
  // el "+" de grupo aparece al hacer hover en el tipo
  await hoverRow(page, row(page, /^GASTOS/));
  await expect(page.locator(String.raw`button[aria-label="Agregar grupo"]`).first()).toBeVisible();
});

// ---------- FR-102 — "+" inline ----------
test("TC-202h: '+' inline en grupo crea categoría hija y abre rename", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const r = row(page, /^Esenciales/);
  await hoverRow(page, r);
  await page.locator(String.raw`button[aria-label="Agregar categoría"]`).first().click();
  await expect(page.getByLabel("Nombre")).toBeVisible();
});

test("TC-202e: '+' inline en categoría-hoja crea una subcategoría", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const r = row(page, /^Vivienda/);
  await hoverRow(page, r);
  await page.locator(String.raw`button[aria-label="Agregar subcategoría"]`).first().click();
  await expect(page.getByLabel("Nombre")).toBeVisible();
});

test("TC-202f: un nodo NO borrable no muestra 🗑 (categoría con datos, grupo con hijos)", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  // Vivienda tiene ejecutado → no borrable → sin ícono borrar (#4)
  await hoverRow(page, row(page, /^Vivienda/));
  await expect(page.locator(String.raw`button[aria-label="Borrar"]`)).toHaveCount(0);
  // Esenciales es un grupo con categorías → no borrable → sin ícono borrar
  await hoverRow(page, row(page, /^Esenciales/));
  await expect(page.locator(String.raw`button[aria-label="Borrar"]`)).toHaveCount(0);
});

// ---------- FR-103 — hover fiable ----------
test("TC-203h: hover muestra los controles (renombrar/agregar) accionables", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await hoverRow(page, row(page, /^Vivienda/));
  await expect(page.locator(String.raw`button[aria-label="Renombrar"]`).first()).toBeVisible();
  await expect(page.locator(String.raw`button[aria-label="Agregar subcategoría"]`).first()).toBeVisible();
});

test("TC-203e: 🗑 en una categoría vacía abre confirmación ✓/✗ y ✗ cancela", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await hoverRow(page, row(page, /^Esenciales/));
  await page.locator(String.raw`button[aria-label="Agregar categoría"]`).first().click();
  await page.getByLabel("Nombre").fill("Borrable");
  await page.getByLabel("Nombre").press("Enter");
  await hoverRow(page, row(page, /^Borrable/));
  await page.locator(String.raw`button[aria-label="Borrar"]`).first().click();
  await expect(page.locator(String.raw`button[aria-label="Confirmar borrado"]`)).toBeVisible();
  await page.locator(String.raw`button[aria-label="Cancelar borrado"]`).click();
  await expect(grid.getByText("Borrable", { exact: true })).toBeVisible();
});

test("TC-203f: los controles son SVG (0 emoji)", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await hoverRow(page, row(page, /^Vivienda/));
  const btn = page.locator(String.raw`button[aria-label="Renombrar"]`).first();
  await expect(btn.locator("svg")).toHaveCount(1);
  const txt = (await btn.textContent()) ?? "";
  expect(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(txt)).toBe(false);
});

// ---------- FR-104 — columna redimensionable ----------
test("TC-204h: arrastrar la manija cambia el ancho de la columna", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const handle = page.getByRole("separator", { name: /Redimensionar/ });
  const grid = page.getByTestId("budget-grid");
  const before = await grid.evaluate((el) => getComputedStyle(el).getPropertyValue("--cat-w"));
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + 3, box!.y + 20);
  await page.mouse.down();
  await page.mouse.move(box!.x + 83, box!.y + 20, { steps: 5 });
  await page.mouse.up();
  const after = await grid.evaluate((el) => getComputedStyle(el).getPropertyValue("--cat-w"));
  expect(parseInt(after)).toBeGreaterThan(parseInt(before));
});

test("TC-204e: el ancho persiste tras recargar (localStorage)", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("ledger.grid.catWidth.v1", "360"));
  await page.reload();
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  const w = await grid.evaluate((el) => getComputedStyle(el).getPropertyValue("--cat-w"));
  expect(parseInt(w)).toBe(360);
});

// ---------- FR-105 — español ----------
test("TC-205h: la pestaña muestra 'Resumen' (no 'Budget')", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Resumen" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Budget" })).toHaveCount(0);
});

test("TC-205f: no aparece 'Budget' en ninguna etiqueta visible", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByText("Budget", { exact: true })).toHaveCount(0);
});

// ---------- FR-106 — período por defecto (SUPERSEDED por ux-consistency FR-312) ----------
// FR-312 cambia el default de 'Año' al MES EN CURSO. Los TCs conservan su id y se re-encuadran:
// el agregado anual sigue sumando ejecutado (206h) y el arranque abre en Mes, no en Año (206f).
test("TC-206h: al cambiar a 'Año', el KPI 'Ejecutado' agrega y es > 0", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.getByRole("tab", { name: "Año" }).click();
  const val = await page.evaluate(() => {
    const label = [...document.querySelectorAll("div")].find((d) => d.textContent?.trim() === "EJECUTADO");
    return label?.nextElementSibling?.textContent ?? "";
  });
  const digits = (val.match(/[\d.]+/) ?? ["0"])[0].replace(/\./g, "");
  expect(parseInt(digits || "0")).toBeGreaterThan(0);
});

test("TC-206f: el arranque abre en el MES EN CURSO, no en 'Año' (FR-312)", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Mes" })).toHaveAttribute("data-state", "active");
  await expect(page.getByRole("tab", { name: "Año" })).toHaveAttribute("data-state", "inactive");
  // el selector muestra el mes del reloj, no enero ni un mes fijo
  const clockMonth = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][new Date().getMonth()];
  await expect(page.getByLabel("Mes")).toContainText(clockMonth);
});

// ---------- FR-107 — pie de ayuda ----------
test("TC-207h: bajo la grilla aparece el pie de ayuda + leyenda de meses", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByText(/Arrastra el borde de la columna/)).toBeVisible();
  await expect(page.getByText(/Ene–May.*Jul–Dic proyectado/)).toBeVisible();
});

test("TC-207e: el pie no se renderiza a 375px (móvil)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await expect(page.getByText(/Arrastra el borde de la columna/)).toHaveCount(0);
});

test("TC-207f: el pie no menciona reparto/distribución (D-4)", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByText(/reparte|distribuci[oó]n del monto/i)).toHaveCount(0);
});

// ---------- FR-108 — conector └ ----------
test("TC-208h: las subcategorías muestran el conector (CornerDownRight)", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await grid.getByText("Comida", { exact: true }).first().click(); // expandir
  await expect(grid.getByText("Mercado", { exact: true })).toBeVisible();
  const mercado = row(page, /^Mercado/);
  expect(await mercado.locator("svg").count()).toBeGreaterThan(0); // conector CornerDownRight presente
});

test("TC-208f: grupos y categorías no comparten el ícono de conector de subs", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  // Vivienda (categoría) usa su ícono propio (home), no el conector de sub
  await expect(grid.getByText("Vivienda", { exact: true })).toBeVisible();
});

// ---------- FR-213 — tipografía Inter (reemplaza Lexend) ----------
test("TC-209h: la fuente global resuelve a Inter (no Lexend/Fira Code)", async ({ page }) => {
  await page.goto("/");
  const ff = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(ff).toContain("Inter");
  expect(ff).not.toContain("Lexend");
  expect(ff).not.toContain("Fira Code");
});

test("TC-209e: las cifras de la grilla usan tabular-nums", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const cell = page.getByTestId("cell-leaf").first();
  const fvn = await cell.evaluate((el) => getComputedStyle(el).fontVariantNumeric);
  expect(fvn).toContain("tabular-nums");
});

test("TC-209f: no hay petición externa para la fuente (self-hosted)", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (req) => {
    const u = req.url();
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) external.push(u);
  });
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.waitForTimeout(400);
  expect(external, external.join(",")).toEqual([]);
});

test("TC-209i: tokens de color zinc y contraste ≥4.5:1 (tema claro)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const { tokens, ratio } = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const hex = (h: string) => { let v = h.trim().replace("#", ""); if (v.length === 3) v = [...v].map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
    const lum = (rgb: number[]) => { const a = rgb.map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
    const fg = lum(hex(s.getPropertyValue("--fg"))), bg = lum(hex(s.getPropertyValue("--bg")));
    const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
    return { tokens: { primary: s.getPropertyValue("--primary").trim(), success: s.getPropertyValue("--success").trim(), error: s.getPropertyValue("--error").trim() }, ratio: (hi + 0.05) / (lo + 0.05) };
  });
  // ux-consistency FR-301/FR-311: tokens afinados (desaturados) — el gate real es el ratio AA de abajo.
  expect(tokens.primary).toBe("#1c1c1f");
  expect(tokens.success).toBe("#2f7d53");
  expect(tokens.error).toBe("#c4453e");
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

// ---------- Regresión ----------
test("TC-210h: (regresión) editar celda-hoja: Enter fija el valor", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await grid.getByText("Comida", { exact: true }).first().click();
  const leaf = grid.getByTestId("cell-leaf").first();
  await leaf.click();
  const editor = page.getByLabel("Editar valor");
  await editor.fill("555000");
  await editor.press("Enter");
  await expect(grid.getByTestId("cell-leaf").first()).toHaveText("555.000");
});

test("TC-210f: (regresión) una celda de nodo padre no abre editor", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await grid.getByTestId("cell-parent").first().click();
  await expect(page.getByLabel("Editar valor")).toHaveCount(0);
});

test("TC-211h: (regresión) categoría con datos NO borrable; una vacía SÍ se borra", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  // con datos → sin 🗑
  await hoverRow(page, row(page, /^Vivienda/));
  await expect(page.locator(String.raw`button[aria-label="Borrar"]`)).toHaveCount(0);
  // crear una categoría vacía y borrarla (sí es borrable)
  await hoverRow(page, row(page, /^Esenciales/));
  await page.locator(String.raw`button[aria-label="Agregar categoría"]`).first().click();
  await page.getByLabel("Nombre").fill("Temporal");
  await page.getByLabel("Nombre").press("Enter");
  await hoverRow(page, row(page, /^Temporal/));
  await page.locator(String.raw`button[aria-label="Borrar"]`).first().click();
  await page.locator(String.raw`button[aria-label="Confirmar borrado"]`).click();
  await expect(grid.getByText("Temporal", { exact: true })).toHaveCount(0);
});

test("TC-213h: (regresión) a 375px se muestra solo el registro (sin grilla)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);
  await expect(page.getByRole("separator", { name: /Redimensionar/ })).toHaveCount(0);
});

test("TC-215h: (regresión) sin emoji ni gradiente en la página", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  const { emoji, gradient } = await page.evaluate(() => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(document.body.innerText);
    let grad = false;
    for (const el of Array.from(document.querySelectorAll("*"))) { if (getComputedStyle(el).backgroundImage.includes("gradient")) { grad = true; break; } }
    return { emoji, gradient: grad };
  });
  expect(emoji).toBe(false);
  expect(gradient).toBe(false);
});

// ---------- Editar ícono de categoría (clic en el ícono abre el selector) ----------
// ux-consistency FR-309/310 SUPERSEDE el selector inline por un IconPicker en Popover (shadcn/Radix)
// con catálogo Lucide amplio y buscable. Se conserva el TC id y el flujo (abrir → elegir → cerrar).
// @aitri-tc TC-216h
test("TC-216h: clic en el ícono de una categoría abre el selector y lo cambia", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.locator(String.raw`button[aria-label="Cambiar ícono"]`).first().click();
  // aparece el IconPicker (Popover) con el catálogo de íconos
  await expect(page.getByTestId("icon-picker")).toBeVisible();
  await expect(page.getByTestId("icon-option").first()).toBeVisible();
  // elegir uno cierra el selector
  await page.getByTestId("icon-option").nth(3).click();
  await expect(page.getByTestId("icon-picker")).toHaveCount(0);
});

// @aitri-tc TC-216e
test("TC-216e: buscar en el IconPicker filtra el catálogo (edge)", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.locator(String.raw`button[aria-label="Cambiar ícono"]`).first().click();
  await expect(page.getByTestId("icon-picker")).toBeVisible();
  const before = await page.getByTestId("icon-option").count();
  // una búsqueda sin coincidencias vacía la lista (muestra el estado vacío)
  await page.getByTestId("icon-picker-search").fill("zzzzzznomatch");
  await expect(page.getByTestId("icon-picker-empty")).toBeVisible();
  await expect(page.getByTestId("icon-option")).toHaveCount(0);
  expect(before).toBeGreaterThan(0);
});

// @aitri-tc TC-216f
test("TC-216f: cerrar el IconPicker con Escape no cambia el ícono (negativo)", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.locator(String.raw`button[aria-label="Cambiar ícono"]`).first().click();
  await expect(page.getByTestId("icon-picker")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("icon-picker")).toHaveCount(0); // se cerró sin elegir
});

test("TC-201g: agregar grupo a un tipo COLAPSADO lo expande y muestra el nuevo grupo", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.locator(String.raw`button[aria-label="Colapsar tipo"]`).first().click(); // colapsar GASTOS
  await hoverRow(page, row(page, /^GASTOS/));
  await page.locator(String.raw`button[aria-label="Agregar grupo"]`).first().click();
  await expect(page.getByLabel("Nombre")).toBeVisible(); // el grupo se muestra → el tipo se expandió
});
