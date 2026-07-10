import { test, expect, type Page } from "@playwright/test";

// Feature ux-consistency — refinamiento profesional del acabado. Los TCs visuales afirman VALORES
// computados reales (tokens/superficies/sombras/fuentes/radios/contraste), no presencia de nodos.
// Prefijo TC-UXC-* para no colisionar con root/grid-ux/stack-upgrade-theme.

const MOBILE = { width: 375, height: 900 };
const DESK = { width: 1440, height: 900 };
const RADIUS_SCALE = ["6px", "8px", "10px", "14px", "9999px"];

function rgb(hex: string): string {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
function parseColor(s: string): number[] {
  const t = s.trim();
  if (t.startsWith("#")) {
    let v = t.slice(1);
    if (v.length === 3) v = [...v].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  }
  const m = t.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}
function lum([r, g, b]: number[]): number {
  const a = [r, g, b].map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function contrast(c1: string, c2: string): number {
  const l1 = lum(parseColor(c1)), l2 = lum(parseColor(c2));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
const readVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

async function gotoDesk(page: Page, scheme: "light" | "dark" = "light") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
}
async function gotoMobile(page: Page, scheme: "light" | "dark" = "light") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
}
const catButtons = (page: Page) => page.getByTestId("category-row").getByRole("button");
async function selectLeaf(page: Page) {
  await catButtons(page).first().click();
  const subRow = page.getByTestId("subcategory-row");
  const hasSubs = await subRow.waitFor({ state: "visible", timeout: 800 }).then(() => true).catch(() => false);
  if (hasSubs) await subRow.getByRole("button").first().click();
}

// ── FR-301 · superficie/elevación + bugs de tema ───────────────────────────────
test("TC-UXC-301h: claro — la card es más clara que el lienzo y tiene sombra (elevación)", async ({ page }) => {
  await gotoDesk(page, "light");
  const kpiBg = await page.getByTestId("kpi").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const kpiShadow = await page.getByTestId("kpi").first().evaluate((el) => getComputedStyle(el).boxShadow);
  const canvasBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // AC: "la card es más clara que el lienzo + sombra suave" → se afirma la PROPIEDAD, no un hex
  // concreto, para que el test siga siendo válido si la paleta se re-afina.
  expect(kpiBg).not.toBe(canvasBg);
  expect(lum(parseColor(kpiBg))).toBeGreaterThan(lum(parseColor(canvasBg)));
  expect(kpiShadow).not.toBe("none");
});

test("TC-UXC-301e: oscuro — los 4 niveles de superficie son distinguibles y surface > canvas", async ({ page }) => {
  await gotoDesk(page, "dark");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  const [canvas, surface, surface2, sunken, highlight] = await Promise.all(
    ["--bg", "--bg-card", "--bg-elevated", "--bg-sunken", "--elev-highlight"].map((n) => readVar(page, n))
  );
  const values = [canvas, surface, surface2, sunken];
  expect(new Set(values).size).toBe(4); // 4 valores distintos
  expect(lum(parseColor(surface))).toBeGreaterThan(lum(parseColor(canvas)));
  expect(highlight).toContain("inset"); // highlight superior sutil solo en oscuro (light = sin inset)
});

test("TC-UXC-301f: sin blanco/negro hardcodeado en tooltip del dashboard ni sombra del Select", async ({ page }) => {
  await gotoDesk(page, "light");
  // Select de mes: sombra theme-aware (--shadow-lg), no rgba(0,0,0,0.5)
  await page.getByLabel("Mes").click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const selShadow = await listbox.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(selShadow).not.toBe("none");
  expect(selShadow).not.toContain("0.5)"); // no la sombra negra fija anterior
  await page.keyboard.press("Escape");
  // Tooltip del dashboard: cursor con token theme-aware (no rgba blanco fijo)
  await page.getByRole("tab", { name: "Dashboard" }).click();
  await page.locator(".recharts-bar-rectangle").first().hover();
  const cursorFill = await page.locator(".recharts-tooltip-cursor").first().getAttribute("fill");
  expect(cursorFill).not.toBe("rgba(255,255,255,0.03)");
  expect(cursorFill ?? "").toMatch(/--fg|color-mix/);
});

// ── FR-302 · escala de radios ──────────────────────────────────────────────────
test("TC-UXC-302h: cards/botones/controles usan un radio de la escala de tokens", async ({ page }) => {
  await gotoDesk(page, "light");
  const kpiR = await page.getByTestId("kpi").first().evaluate((el) => getComputedStyle(el).borderRadius);
  const btnR = await page.getByRole("button", { name: "Nuevo movimiento" }).evaluate((el) => getComputedStyle(el).borderRadius);
  const pillR = await page.getByTestId("period-pill").evaluate((el) => getComputedStyle(el).borderRadius);
  expect(kpiR).toBe("10px");
  expect(btnR).toBe("8px");
  expect(pillR).toBe("10px"); // mismo radio que las tabs Resumen/Dashboard (consistencia de radios)
});

test("TC-UXC-302e: --radius-xs/sm/md/lg/full están definidos y expuestos", async ({ page }) => {
  await gotoDesk(page, "light");
  const vals = await Promise.all(["--radius-xs", "--radius-sm", "--radius-md", "--radius-lg", "--radius-full"].map((n) => readVar(page, n)));
  expect(vals).toEqual(["6px", "8px", "10px", "14px", "9999px"]);
});

test("TC-UXC-302f: ninguna card/control con esquina cuadrada (radio 0)", async ({ page }) => {
  await gotoDesk(page, "light");
  const radii = await page.evaluate(() => {
    const sel = '[data-testid="kpi"], [data-testid="save-button"], button[aria-label="Nuevo movimiento"]';
    return [...document.querySelectorAll(sel)].map((el) => getComputedStyle(el as HTMLElement).borderTopLeftRadius);
  });
  expect(radii.length).toBeGreaterThan(0);
  for (const r of radii) expect(r).not.toBe("0px");
});

// ── FR-303 · escala tipográfica ────────────────────────────────────────────────
test("TC-UXC-303h: el título y el eyebrow resuelven a la escala (20px/600 · 11px/600)", async ({ page }) => {
  await gotoDesk(page, "light");
  const title = await page.getByTestId("page-title").evaluate((el) => { const s = getComputedStyle(el); return { fs: s.fontSize, fw: s.fontWeight }; });
  const eyebrow = await page.locator(".eyebrow").first().evaluate((el) => { const s = getComputedStyle(el); return { fs: s.fontSize, fw: s.fontWeight }; });
  expect(title).toEqual({ fs: "20px", fw: "600" });
  expect(eyebrow).toEqual({ fs: "11px", fw: "600" });
});

test("TC-UXC-303e: los títulos usan un peso estándar (no 450)", async ({ page }) => {
  await gotoDesk(page, "light");
  const deskW = await page.getByTestId("page-title").evaluate((el) => getComputedStyle(el).fontWeight);
  expect(["400", "500", "600", "700"]).toContain(deskW);
  await gotoMobile(page, "light");
  const mobW = await page.getByTestId("page-title").evaluate((el) => getComputedStyle(el).fontWeight);
  expect(["400", "500", "600", "700"]).toContain(mobW);
});

test("TC-UXC-303f: no queda ningún font-[450] en el DOM del escritorio", async ({ page }) => {
  await gotoDesk(page, "light");
  const count = await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el as HTMLElement).fontWeight === "450").length);
  expect(count).toBe(0);
});

// ── FR-304 · cabecera con intención ────────────────────────────────────────────
test("TC-UXC-304h: escritorio — marca discreta + un único título (no doble LEDGER)", async ({ page }) => {
  await gotoDesk(page, "light");
  await expect(page.getByTestId("topbar-brand")).toHaveCount(1);
  await expect(page.getByTestId("page-title")).toHaveCount(1);
  const title = await page.getByTestId("page-title").textContent();
  expect(title).not.toContain("LEDGER");
});

test("TC-UXC-304e: el año/periodo es un control segmentado discreto, no parte del título", async ({ page }) => {
  await gotoDesk(page, "light");
  const pill = page.getByTestId("period-pill");
  await expect(pill).toBeVisible();
  expect(await pill.getByRole("tab").count()).toBeGreaterThan(0);
  // consistencia de radios: el control de periodo usa EXACTAMENTE el mismo radio que las tabs de vista
  const viewTabs = page.getByRole("tablist").filter({ hasText: "Resumen" });
  const viewR = await viewTabs.evaluate((el) => getComputedStyle(el).borderRadius);
  const pillR = await pill.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(pillR).toBe("10px");
  expect(pillR).toBe(viewR);
  expect(await page.getByTestId("page-title").textContent()).not.toContain("2026");
});

test("TC-UXC-304f: no queda el patrón eyebrow 'LEDGER' + título grande (móvil ni escritorio)", async ({ page }) => {
  await gotoDesk(page, "light");
  expect(await page.locator(".eyebrow", { hasText: /^LEDGER$/ }).count()).toBe(0);
  await gotoMobile(page, "light");
  expect(await page.locator(".eyebrow", { hasText: /^LEDGER$/ }).count()).toBe(0);
});

// ── FR-305 · toda cifra en DM Mono ─────────────────────────────────────────────
const isMono = (ff: string) => /DM.?Mono/i.test(ff);

test("TC-UXC-305h: KPI del dashboard y del escritorio en DM Mono tabular", async ({ page }) => {
  await gotoDesk(page, "light");
  const deskVal = page.getByTestId("kpi").first().locator(".tabular");
  expect(isMono(await deskVal.evaluate((el) => getComputedStyle(el).fontFamily))).toBe(true);
  expect(await deskVal.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
  await page.getByRole("tab", { name: "Dashboard" }).click();
  const dashVal = page.getByTestId("kpi").first().locator(".tabular");
  expect(isMono(await dashVal.evaluate((el) => getComputedStyle(el).fontFamily))).toBe(true);
});

test("TC-UXC-305e: celda de grilla y monto de recientes en DM Mono", async ({ page }) => {
  await gotoDesk(page, "light");
  const cellFont = await page.getByTestId("cell-leaf").first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(isMono(cellFont)).toBe(true);
  await gotoMobile(page, "light");
  await page.getByTestId("amount-input").fill("50000");
  await selectLeaf(page);
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("confirm-overlay")).toHaveCount(0, { timeout: 4000 });
  const amtFont = await page.getByTestId("recent-amount").first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(isMono(amtFont)).toBe(true);
});

test("TC-UXC-305f: ninguna cifra de KPI/celda queda en Inter pleno", async ({ page }) => {
  await gotoDesk(page, "light");
  const fonts = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid="kpi"] .tabular, [data-testid="cell-leaf"]')];
    return els.map((el) => getComputedStyle(el as HTMLElement).fontFamily);
  });
  expect(fonts.length).toBeGreaterThan(0);
  for (const f of fonts) expect(/DM.?Mono/i.test(f)).toBe(true);
});

// ── FR-306 · eyebrow único ─────────────────────────────────────────────────────
async function eyebrowStyles(page: Page) {
  return page.$$eval(".eyebrow", (els) => els.map((e) => { const s = getComputedStyle(e); return { fs: s.fontSize, fw: s.fontWeight, tt: s.textTransform, color: s.color }; }));
}
test("TC-UXC-306h: los eyebrows resuelven al mismo tamaño/peso/color vía .eyebrow", async ({ page }) => {
  await gotoDesk(page, "light");
  const deskEyebrows = await eyebrowStyles(page);
  expect(deskEyebrows.length).toBeGreaterThan(1);
  for (const s of deskEyebrows) { expect(s.fs).toBe("11px"); expect(s.fw).toBe("600"); expect(s.tt).toBe("uppercase"); }
  expect(new Set(deskEyebrows.map((s) => s.color)).size).toBe(1);
  await gotoMobile(page, "light");
  const mobEyebrow = (await eyebrowStyles(page))[0];
  expect(mobEyebrow.fs).toBe("11px");
  expect(mobEyebrow.fw).toBe("600");
  expect(mobEyebrow.color).toBe(deskEyebrows[0].color);
});

test("TC-UXC-306e: el eyebrow 'CATEGORÍA' de la grilla usa .eyebrow con contraste ≥4.5:1", async ({ page }) => {
  await gotoDesk(page, "light");
  const cat = page.getByTestId("budget-grid").getByText("CATEGORÍA", { exact: true });
  const { fs, fw, color, bg } = await cat.evaluate((el) => {
    const s = getComputedStyle(el as HTMLElement);
    return { fs: s.fontSize, fw: s.fontWeight, color: s.color, bg: s.backgroundColor };
  });
  expect(fs).toBe("11px");
  expect(fw).toBe("600");
  expect(contrast(color, bg)).toBeGreaterThanOrEqual(4.5);
});

test("TC-UXC-306f: ningún eyebrow con tamaño/peso ad-hoc distinto de la clase", async ({ page }) => {
  await gotoDesk(page, "light");
  const styles = await eyebrowStyles(page);
  for (const s of styles) { expect(s.fs).toBe("11px"); expect(s.fw).toBe("600"); }
});

// ── FR-307 · registro coherente ────────────────────────────────────────────────
test("TC-UXC-307h: los campos del registro usan superficie/borde/radio por token", async ({ page }) => {
  await gotoMobile(page, "light");
  const df = await page.getByTestId("date-field").evaluate((el) => {
    const s = getComputedStyle(el); return { r: s.borderTopLeftRadius, bw: parseFloat(s.borderTopWidth), bg: s.backgroundColor };
  });
  expect(RADIUS_SCALE).toContain(df.r);
  expect(df.bw).toBeGreaterThanOrEqual(1);
  expect(df.bg).toBe("rgb(255, 255, 255)"); // --bg-card en claro
});

test("TC-UXC-307e: el tile de categoría seleccionado conserva su tinte/borde del tipo", async ({ page }) => {
  await gotoMobile(page, "light");
  const defBorder = await catButtons(page).first().evaluate((el) => getComputedStyle(el).borderColor);
  await selectLeaf(page); // elige la hoja disponible (categoría-hoja o subcategoría)
  const sel = page.getByRole("button", { pressed: true }).first();
  await expect(sel).toBeVisible();
  const selBorder = await sel.evaluate((el) => getComputedStyle(el).borderColor);
  const selBg = await sel.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(selBorder).not.toBe(defBorder); // borde teñido del tipo
  expect(parseColor(selBg)[0]).toBeGreaterThan(parseColor(selBg)[2]); // tinte rojizo (Gasto): R>B
});

test("TC-UXC-307f: ningún campo del registro con radio fuera de la escala", async ({ page }) => {
  await gotoMobile(page, "light");
  const radii = await page.evaluate(() => {
    const sel = '[data-testid="date-field"], [data-testid="note-input"], [data-testid="save-button"], [data-testid="category-row"] > button';
    return [...document.querySelectorAll(sel)].map((el) => getComputedStyle(el as HTMLElement).borderTopLeftRadius);
  });
  const scale = ["6px", "8px", "10px", "14px", "9999px"];
  expect(radii.length).toBeGreaterThan(0);
  for (const r of radii) expect(scale).toContain(r);
});

// ── FR-308 · consolidación Kpi / selector único ────────────────────────────────
test("TC-UXC-308h: dashboard y escritorio usan el MISMO Kpi (mismo padding y regla de cifra)", async ({ page }) => {
  await gotoDesk(page, "light");
  const readKpi = () => page.getByTestId("kpi").first().evaluate((el) => {
    const s = getComputedStyle(el); const v = getComputedStyle(el.querySelector(".tabular") as HTMLElement);
    return { pad: `${s.paddingTop}|${s.paddingRight}|${s.paddingBottom}|${s.paddingLeft}`, font: v.fontFamily };
  });
  const deskKpi = await readKpi();
  await page.getByRole("tab", { name: "Dashboard" }).click();
  const dashKpi = await readKpi();
  expect(dashKpi.pad).toBe(deskKpi.pad);
  expect(/DM.?Mono/i.test(deskKpi.font)).toBe(true);
  expect(/DM.?Mono/i.test(dashKpi.font)).toBe(true);
});

test("TC-UXC-308f: la selección de tipo no cambia de comportamiento (sin regresión)", async ({ page }) => {
  await gotoMobile(page, "light");
  await page.getByTestId("type-income").click();
  await expect(page.getByTestId("type-income")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("type-expense")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("save-button")).toHaveCSS("background-color", rgb("#2F7D53")); // relleno AA de Ingreso (bosque)
  await page.getByTestId("type-transfer").click();
  await expect(page.getByTestId("save-button")).toHaveCSS("background-color", rgb("#2F6DB4")); // acero
});

// ── FR-309 · selector de iconos rico ───────────────────────────────────────────
test("TC-UXC-309h: el IconPicker ofrece ≥40 iconos Lucide y permite elegir uno", async ({ page }) => {
  await gotoDesk(page, "light");
  await page.locator('button[aria-label="Cambiar ícono"]').first().click();
  await expect(page.getByTestId("icon-picker")).toBeVisible();
  expect(await page.getByTestId("icon-option").count()).toBeGreaterThanOrEqual(40);
  await page.locator('[aria-label="Icono pizza"]').click();
  await expect(page.getByTestId("icon-picker")).toHaveCount(0);
  await expect(page.getByTestId("budget-grid").locator("svg.lucide-pizza").first()).toBeVisible();
});

test("TC-UXC-309e: el icono elegido persiste tras recargar", async ({ page }) => {
  await gotoDesk(page, "light");
  await page.locator('button[aria-label="Cambiar ícono"]').first().click();
  await page.locator('[aria-label="Icono pizza"]').click();
  await expect(page.getByTestId("budget-grid").locator("svg.lucide-pizza").first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("budget-grid").locator("svg.lucide-pizza").first()).toBeVisible();
});

test("TC-UXC-309f: categoría con icono desconocido usa fallback sin romper el render", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await gotoDesk(page, "light");
  await page.evaluate(() => {
    const raw = localStorage.getItem("ledger.nodes.v1");
    if (!raw) return;
    const data = JSON.parse(raw);
    const cat = data.nodes.find((n: { level: string; system?: boolean }) => n.level === "category" && !n.system);
    if (cat) cat.icon = "__nope__";
    localStorage.setItem("ledger.nodes.v1", JSON.stringify(data));
  });
  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("budget-grid").locator("svg").first()).toBeVisible(); // fallback svg
  expect(errors).toEqual([]);
});

// ── FR-310 · overlays shadcn/Radix ─────────────────────────────────────────────
test("TC-UXC-310h: calendario e IconPicker usan Popover con foco y sombra --shadow-lg", async ({ page }) => {
  await gotoMobile(page, "light");
  await page.getByTestId("date-field").click();
  const pop = page.getByTestId("date-popover");
  await expect(pop).toBeVisible();
  const shadow = await pop.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe("none");
  const focusInside = await pop.evaluate((el) => el.contains(document.activeElement));
  expect(focusInside).toBe(true);
  await gotoDesk(page, "light");
  await page.locator('button[aria-label="Cambiar ícono"]').first().click();
  await expect(page.getByTestId("icon-picker")).toBeVisible();
  const iconFocus = await page.getByTestId("icon-picker").evaluate((el) => el.contains(document.activeElement));
  expect(iconFocus).toBe(true);
});

test("TC-UXC-310e: el overlay cierra por Escape y por click fuera", async ({ page }) => {
  await gotoDesk(page, "light");
  await page.locator('button[aria-label="Cambiar ícono"]').first().click();
  await expect(page.getByTestId("icon-picker")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("icon-picker")).toHaveCount(0);
  await page.locator('button[aria-label="Cambiar ícono"]').first().click();
  await expect(page.getByTestId("icon-picker")).toBeVisible();
  await page.getByTestId("page-title").click(); // click en un elemento fuera del popover
  await expect(page.getByTestId("icon-picker")).toHaveCount(0);
});

test("TC-UXC-310f: abrir overlays no emite petición externa ni rompe el scroll de la página", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { const u = r.url(); if (/^https?:/i.test(u) && !/localhost|127\.0\.0\.1/.test(u)) external.push(u); });
  await gotoDesk(page, "light");
  await page.locator('button[aria-label="Cambiar ícono"]').first().click();
  await expect(page.getByTestId("icon-picker")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const noX = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(external, external.join(",")).toEqual([]);
  expect(noX).toBe(true);
});

// ── FR-311 · contraste AA sobre relleno ────────────────────────────────────────
async function activeToggleContrast(page: Page, type: string): Promise<number> {
  await page.getByTestId(`type-${type}`).click();
  const { color, bg } = await page.getByTestId(`type-${type}`).evaluate((el) => {
    const s = getComputedStyle(el); return { color: s.color, bg: s.backgroundColor };
  });
  return contrast(color, bg);
}
test("TC-UXC-311h: el label de Ingreso activo alcanza ≥4.5:1 en ambos temas", async ({ page }) => {
  await gotoMobile(page, "light");
  expect(await activeToggleContrast(page, "income")).toBeGreaterThanOrEqual(4.5);
  await gotoMobile(page, "dark");
  expect(await activeToggleContrast(page, "income")).toBeGreaterThanOrEqual(4.5);
});

test("TC-UXC-311e: Gasto y Transferencia activos también ≥4.5:1", async ({ page }) => {
  await gotoMobile(page, "light");
  expect(await activeToggleContrast(page, "expense")).toBeGreaterThanOrEqual(4.5);
  expect(await activeToggleContrast(page, "transfer")).toBeGreaterThanOrEqual(4.5);
});

test("TC-UXC-311f: ningún texto sobre relleno de acento por debajo de 4.5:1", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await gotoMobile(page, scheme);
    for (const t of ["expense", "income", "transfer"]) {
      expect(await activeToggleContrast(page, t), `${t}/${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
    // save-button (relleno de acento) del tipo activo actual
    const { color, bg } = await page.getByTestId("save-button").evaluate((el) => { const s = getComputedStyle(el); return { color: s.color, bg: s.backgroundColor }; });
    expect(contrast(color, bg), `save/${scheme}`).toBeGreaterThanOrEqual(4.5);
  }
});

// ── FR-312 · mes en curso (e2e recálculo) ──────────────────────────────────────
test("TC-UXC-312e: cambiar Mes/Año recalcula los indicadores", async ({ page }) => {
  await gotoDesk(page, "light");
  const monthVal = await page.getByTestId("kpi").first().locator(".tabular").textContent();
  await page.getByTestId("period-pill").getByRole("tab", { name: "Año" }).click();
  await expect.poll(async () => page.getByTestId("kpi").first().locator(".tabular").textContent()).not.toBe(monthVal);
});

// ── FR-313 · scroll con rueda ──────────────────────────────────────────────────
test("TC-UXC-313h: a 1440px la rueda (deltaY>0) sobre la grilla incrementa su scrollTop", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 520 }); // fuerza desborde vertical de la grilla
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  const box = (await grid.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("TC-UXC-313e: la rueda sobre la fila de categorías que desborda incrementa su scrollLeft", async ({ page }) => {
  await gotoMobile(page, "light");
  // inyecta categorías de Gasto para forzar desborde horizontal de la fila
  await page.evaluate(() => {
    const raw = localStorage.getItem("ledger.nodes.v1");
    if (!raw) return;
    const data = JSON.parse(raw);
    const grp = data.nodes.find((n: { type: string; level: string }) => n.type === "expense" && n.level === "group");
    for (let i = 0; i < 16; i++) data.nodes.push({ id: `c-wheel-${i}`, ownerId: "local", type: "expense", level: "category", parentId: grp.id, name: `Cat ${i}`, icon: "tag", order: 100 + i });
    localStorage.setItem("ledger.nodes.v1", JSON.stringify(data));
  });
  await page.reload();
  const row = page.getByTestId("category-row");
  await expect(row).toBeVisible();
  expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test("TC-UXC-313f: ningún contenedor desplazable queda 'muerto' a la rueda", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  expect(await grid.evaluate((el) => el.scrollTop)).toBe(0);
  const box = (await grid.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

// ── FR-314 · nitpicks de tokens/clases ─────────────────────────────────────────
test("TC-UXC-314h: el Select no contiene la clase malformada y el highlight funciona", async ({ page }) => {
  await gotoDesk(page, "light");
  await page.getByLabel("Mes").click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const html = await listbox.evaluate((el) => el.outerHTML);
  expect(html).not.toContain("highlighted:bg-elevated"); // variante malformada retirada
  const item = listbox.getByRole("option").nth(3);
  const base = await item.evaluate((el) => getComputedStyle(el).backgroundColor);
  await item.hover();
  await expect.poll(() => item.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(base);
});

test("TC-UXC-314e: no queda ningún font-[450] en el DOM (móvil ni escritorio)", async ({ page }) => {
  await gotoDesk(page, "light");
  expect(await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el as HTMLElement).fontWeight === "450").length)).toBe(0);
  await gotoMobile(page, "light");
  expect(await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el as HTMLElement).fontWeight === "450").length)).toBe(0);
});

test("TC-UXC-314f: --radius-full y --primary-foreground existen y el texto sobre relleno usa el token", async ({ page }) => {
  await gotoDesk(page, "light");
  expect(await readVar(page, "--radius-full")).toBe("9999px");
  expect(await readVar(page, "--primary-foreground")).not.toBe("");
  await gotoMobile(page, "light");
  await page.getByTestId("type-income").click();
  const labelColor = await page.getByTestId("type-income").evaluate((el) => getComputedStyle(el).color);
  expect(labelColor).toBe("rgb(255, 255, 255)"); // --on-accent, no literal suelto
});

// ── NFR-301 · regresión funcional ──────────────────────────────────────────────
test("TC-UXC-351h: guardar un movimiento suma a Ejecutado y aparece en recientes", async ({ page }) => {
  await gotoMobile(page, "light");
  await page.getByTestId("amount-input").fill("50000");
  await selectLeaf(page);
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("confirm-overlay")).toContainText("$50.000");
  await expect(page.getByTestId("confirm-overlay")).toHaveCount(0, { timeout: 4000 });
  await expect(page.getByTestId("recent-item").first()).toBeVisible();
});

test("TC-UXC-351e: edición inline de una hoja de la grilla persiste", async ({ page }) => {
  await gotoDesk(page, "light");
  const cell = page.getByTestId("cell-leaf").first();
  await cell.click();
  const editor = page.getByLabel("Editar valor");
  await editor.fill("123456");
  await editor.press("Enter");
  await expect(page.getByTestId("cell-leaf").first()).toContainText("123.456");
  await page.reload();
  await expect(page.getByTestId("cell-leaf").first()).toContainText("123.456");
});

test("TC-UXC-351f: guardar con monto 0 / sin categoría no crea movimiento", async ({ page }) => {
  await gotoMobile(page, "light");
  await expect(page.getByTestId("save-button")).toBeDisabled();
  await page.getByTestId("amount-input").fill("10000");
  await page.getByTestId("save-button").click();
  await expect(page.getByRole("alert").filter({ hasText: "Elige una categoría." })).toBeVisible();
  await expect(page.getByTestId("recent-item")).toHaveCount(0);
});

// ── NFR-302 · identidad conservada ─────────────────────────────────────────────
test("TC-UXC-352h: acentos por tipo siguen siendo rojo/verde/azul reconocibles", async ({ page }) => {
  await gotoMobile(page, "light");
  // NFR-302 pide que los acentos sigan siendo "rojo/verde/azul RECONOCIBLES", no un hex exacto
  // (los valores pueden AFINARSE). Se afirma el canal dominante de cada hue: eso es lo que falla
  // si alguien introduce un hue ajeno, y sobrevive al desaturado.
  const [er, eg, eb] = parseColor(await readVar(page, "--type-expense"));
  expect(er, "Gasto debe ser rojo dominante").toBeGreaterThan(Math.max(eg, eb));
  const [ir, ig, ib] = parseColor(await readVar(page, "--type-income"));
  expect(ig, "Ingreso debe ser verde dominante").toBeGreaterThan(Math.max(ir, ib));
  const [tr, tg, tb] = parseColor(await readVar(page, "--type-transfer"));
  expect(tb, "Transferencia debe ser azul dominante").toBeGreaterThan(Math.max(tr, tg));
});

test("TC-UXC-352e: el default de tema sigue 'Sistema'", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.removeItem("theme"));
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  const theme = await page.evaluate(() => localStorage.getItem("theme"));
  expect(theme === null || theme === "system").toBe(true);
});

test("TC-UXC-352f: no aparece un color de marca ajeno a zinc + acentos", async ({ page }) => {
  await gotoDesk(page, "light");
  expect(parseColor(await readVar(page, "--primary"))).toEqual([28, 28, 31]); // zinc neutro (#1c1c1f)
  const btnBg = await page.getByRole("button", { name: "Nuevo movimiento" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  // el chrome nunca se rellena con un acento de tipo
  expect([rgb("#C4453E"), rgb("#2F7D53"), rgb("#2F6DB4")]).not.toContain(btnBg);
});

// ── NFR-303 · accesibilidad AA ─────────────────────────────────────────────────
test("TC-UXC-353h: text-primary y text-secondary ≥4.5:1 en ambos temas", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await gotoDesk(page, scheme);
    const [fg, canvas, fg2, surface] = await Promise.all(["--fg", "--bg", "--fg-secondary", "--bg-card"].map((n) => readVar(page, n)));
    expect(contrast(fg, canvas), `text/${scheme}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fg2, surface), `text2/${scheme}`).toBeGreaterThanOrEqual(4.5);
  }
});

test("TC-UXC-353e: controles del registro ≥48px y foco visible", async ({ page }) => {
  await gotoMobile(page, "light");
  for (const id of ["type-expense", "save-button", "date-field"]) {
    const h = await page.getByTestId(id).evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(h, id).toBeGreaterThanOrEqual(48);
  }
  // foco por TECLADO (note → Tab → Guardar) para gatillar :focus-visible de forma determinista.
  // Se rellena un monto para que el botón Guardar esté habilitado (un botón disabled no recibe foco).
  await page.getByTestId("amount-input").fill("1000");
  await page.getByTestId("note-input").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("save-button")).toBeFocused();
  const outline = await page.getByTestId("save-button").evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
});

test("TC-UXC-353f: ningún texto sobre relleno de acento por debajo de 4.5:1", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await gotoMobile(page, scheme);
    for (const t of ["expense", "income", "transfer"]) {
      await page.getByTestId(`type-${t}`).click();
      const { color, bg } = await page.getByTestId(`type-${t}`).evaluate((el) => { const s = getComputedStyle(el); return { color: s.color, bg: s.backgroundColor }; });
      expect(contrast(color, bg), `${t}/${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

// ── NFR-304 · sin peticiones externas ──────────────────────────────────────────
test("TC-UXC-354h: cargar + tema + overlays + guardar = 0 peticiones externas", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { const u = r.url(); if (/^https?:/i.test(u) && !/localhost|127\.0\.0\.1/.test(u)) external.push(u); });
  await gotoMobile(page, "light");
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("date-field").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("amount-input").fill("1000");
  await selectLeaf(page);
  await page.getByTestId("save-button").click();
  await page.waitForTimeout(400);
  expect(external, external.join(",")).toEqual([]);
});

test("TC-UXC-354e: abrir el IconPicker no emite ninguna petición externa", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { const u = r.url(); if (/^https?:/i.test(u) && !/localhost|127\.0\.0\.1/.test(u)) external.push(u); });
  await gotoDesk(page, "light");
  await page.locator('button[aria-label="Cambiar ícono"]').first().click();
  await expect(page.getByTestId("icon-picker")).toBeVisible();
  await page.getByTestId("icon-picker-search").fill("piz");
  await page.waitForTimeout(300);
  expect(external, external.join(",")).toEqual([]);
});

test("TC-UXC-354f: el Popover de Radix no introduce ninguna petición externa", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { const u = r.url(); if (/^https?:/i.test(u) && !/localhost|127\.0\.0\.1/.test(u)) external.push(u); });
  await gotoMobile(page, "light");
  const trigger = page.getByTestId("date-field");
  for (let i = 0; i < 3; i++) {
    await trigger.click();
    await expect(trigger).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("date-popover")).toBeVisible();
    // El calendario se importa de forma diferida: si se presiona Escape mientras el contenido aún
    // se monta, la tecla llega antes de que Radix ate su listener de dismiss y el popover no cierra
    // (causa real del flake bajo carga). Se espera a que la grilla del calendario esté montada.
    await expect(page.locator(".rdp-month_grid").first()).toBeVisible();
    await page.keyboard.press("Escape");
    // el data-state del trigger es la señal determinista de cierre en Radix
    await expect(trigger).toHaveAttribute("data-state", "closed");
    await expect(page.getByTestId("date-popover")).toHaveCount(0);
  }
  await page.waitForTimeout(300);
  expect(external, external.join(",")).toEqual([]);
});

// ── NFR-305 · suite verde (flujos previos) ─────────────────────────────────────
test("TC-UXC-355h: la grilla de 12 meses sigue funcionando tras la feature", async ({ page }) => {
  await gotoDesk(page, "light");
  const grid = page.getByTestId("budget-grid");
  await expect(grid.getByText("Enero").first()).toBeVisible();
  await expect(grid.getByText("Diciembre").first()).toBeVisible();
  await expect(grid.getByText("CATEGORÍA", { exact: true })).toBeVisible();
});

test("TC-UXC-355e: la persistencia de tema previa sigue funcionando", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  await page.getByTestId("theme-toggle").click(); // dark → light
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
});

// ── NFR-306 · smoke (la app arranca) ───────────────────────────────────────────
test("TC-UXC-356h: la app responde 200 en '/'", async ({ page }) => {
  const resp = await page.goto("/");
  expect(resp?.status()).toBe(200);
  await page.setViewportSize(DESK);
  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
});

test("TC-UXC-356f: la raíz no devuelve 5xx en el primer arranque", async ({ page }) => {
  const resp = await page.goto("/");
  expect(resp!.status()).toBeLessThan(500);
});
