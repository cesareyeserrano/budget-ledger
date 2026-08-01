import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger, readLedger } from "./helpers/seed";
import { E2E_BASE, E2E_PASSWORD, e2eEmail, storageStatePath } from "./helpers/globalSetup";
import { buildSeed } from "@/domain";
import type { Browser, BrowserContext } from "@playwright/test";
import type { LedgerNode } from "@/domain/types";

// Feature servidor-fuente-unica — e2e. Postgres es la ÚNICA fuente de verdad: sin sesión no hay
// app ni petición de datos, lo guardado en un navegador aparece en otro, y localStorage solo
// conserva preferencias del dispositivo. Prefijo TC-SFU-*.
//
// NOTA SOBRE LA CUENTA: los TCs hablan de `admin@admin.com` (la cuenta de dev del usuario). El
// entorno e2e levanta un Postgres EFÍMERO donde esa cuenta no existe: la cuenta real de cada
// worker es `e2e-w<N>@ledger.test` (globalSetup). Donde el TC pide credenciales VÁLIDAS se usa la
// del worker; donde pide credenciales INVÁLIDAS se conserva `admin@admin.com` literal — el caso
// que verifica es precisamente el rechazo, y un email inexistente lo ejerce igual.

const DESK = { width: 1440, height: 900 };
const MOB = { width: 375, height: 812 };
// Índices de mes en la grilla: cada mes ocupa dos celdas (Pres., Ejec.) en orden ene…dic.
const MONTH_IDX = { ene: 0, sep: 8, oct: 9 } as const;
const cellIdx = (month: keyof typeof MONTH_IDX, plane: "budget" | "actual") =>
  MONTH_IDX[month] * 2 + (plane === "actual" ? 1 : 0);

const fmt = (n: number) => n.toLocaleString("es-CO");
const workerEmail = () => e2eEmail(test.info().parallelIndex);

/** Contexto de navegador SIN cookie de sesión (el `test` de fixtures siempre trae una). */
async function anonContext(browser: Browser, viewport = DESK): Promise<BrowserContext> {
  return browser.newContext({ baseURL: E2E_BASE, viewport, storageState: { cookies: [], origins: [] } });
}
/** Segundo contexto con la MISMA cuenta del worker (para los TCs multi-dispositivo). */
async function sameAccountContext(browser: Browser, viewport = DESK): Promise<BrowserContext> {
  return browser.newContext({ baseURL: E2E_BASE, viewport, storageState: storageStatePath(test.info().parallelIndex) });
}

async function fillLogin(page: Page, email: string, password: string) {
  await expect(page.getByTestId("auth-form")).toBeVisible();
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-submit").click();
}

const nodeRow = (page: Page, name: string) =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: name }) }).first();

/** 'Mercado' es subcategoría de 'Comida', que arranca colapsada. */
async function expandComida(page: Page) {
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  if ((await grid.getByText("Mercado", { exact: true }).count()) === 0) {
    await grid.getByText("Comida", { exact: true }).first().click();
  }
  await expect(grid.getByText("Mercado", { exact: true }).first()).toBeVisible();
}

async function editLeafCell(page: Page, rowName: string, idx: number, value: string) {
  await nodeRow(page, rowName).getByTestId("cell-leaf").nth(idx).click();
  const editor = page.getByLabel("Editar valor");
  await editor.fill(value);
  await editor.press("Enter");
}

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

const ledgerKeys = (page: Page) =>
  page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("ledger.")));

const hexToRgb = (hex: string) => {
  const v = hex.trim().replace("#", "");
  const full = v.length === 3 ? [...v].map((c) => c + c).join("") : v;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

// ── FR-1102 · sesión obligatoria ───────────────────────────────────────────────

test("TC-SFU-102h: sin sesión, cualquier ruta muestra el formulario y nunca el shell", async ({ browser }) => {
  // @aitri-tc TC-SFU-102h
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  try {
    // Se prueban DOS entradas, incluida una con un parámetro que en el modo retirado habría
    // servido de bypass: AC-1102 exige que no exista ninguna vía de escape.
    for (const route of ["/", "/?local=1"]) {
      await page.goto(route);
      await expect(page.getByTestId("auth-form")).toBeVisible();
      await expect(page.getByTestId("budget-grid")).toHaveCount(0);
      await expect(page.getByTestId("mobile-shell")).toHaveCount(0);
      // El shell de escritorio no lleva testid propio: su contenedor es .lx-desktop.
      await expect(page.locator(".lx-desktop")).toHaveCount(0);
      await expect(page.getByTestId("logout")).toHaveCount(0);
    }
  } finally {
    await ctx.close();
  }
});

test("TC-SFU-102e: la sesión que expira devuelve al login sin dejar datos en pantalla", async ({ page, context }) => {
  // @aitri-tc TC-SFU-102e
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expandComida(page);

  const statuses: number[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "PUT" && r.url().includes("/api/v1/ledger")) statuses.push(r.status());
  });

  await context.clearCookies();
  await editLeafCell(page, "Mercado", cellIdx("ene", "actual"), "90000");

  await expect.poll(() => statuses, { timeout: 10_000 }).toContain(401);
  await expect(page.getByTestId("auth-form")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("body")).not.toContainText("Mercado");
});

test("TC-SFU-102f: sin sesión no se emite ninguna petición de datos financieros", async ({ browser }) => {
  // @aitri-tc TC-SFU-102f
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  const dataRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1/")) dataRequests.push(r.url());
  });
  try {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.getByTestId("auth-form")).toBeVisible();

    // La pantalla de acceso no monta el toggle de tema; el cambio se ejerce por el esquema del
    // sistema, que es el default 'Sistema' — y se comprueba que el tema REALMENTE cambió.
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

    expect(dataRequests, dataRequests.join(",")).toEqual([]);
    expect(await ledgerKeys(page)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

// ── FR-1103 · un dato, todos los dispositivos ──────────────────────────────────

test("TC-SFU-103h: un dato guardado en un navegador aparece al entrar desde otro", async ({ page, browser }) => {
  // @aitri-tc TC-SFU-103h
  const before = await readLedger(page);
  const baseline = before?.actuals["s-comida-mercado"]?.ene ?? 0;

  // Contexto A: el registro móvil, con la fecha llevada a enero por el calendario.
  await page.setViewportSize(MOB);
  await page.goto("/");
  await expect(page.getByTestId("amount-input")).toBeVisible();
  await page.getByTestId("amount-input").fill("37500");
  await page.getByTestId("category-c-comida").click();
  await page.getByTestId("sub-s-comida-mercado").click();
  await page.getByTestId("date-field").click();
  await expect(page.locator(".rdp-month_grid").first()).toBeVisible();
  await page.locator("select.rdp-months_dropdown").selectOption({ label: "enero" });
  await page.locator(".rdp-day_button", { hasText: /^15$/ }).first().click();
  await expect(page.getByTestId("date-popover")).toHaveCount(0);
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("confirm-overlay")).toContainText("$37.500");

  await expect
    .poll(async () => (await readLedger(page))?.actuals["s-comida-mercado"]?.ene ?? 0, { timeout: 10_000 })
    .toBe(baseline + 37500);
  const movements = (await readLedger(page))?.movements ?? [];
  expect(movements.some((m) => m.amount === 37500 && m.month === "ene")).toBe(true);

  // Contexto B: navegador limpio, misma cuenta, login por el formulario.
  const ctxB = await browser.newContext({ baseURL: E2E_BASE, viewport: DESK, storageState: { cookies: [], origins: [] } });
  const pageB = await ctxB.newPage();
  try {
    await pageB.goto("/");
    await fillLogin(pageB, workerEmail(), E2E_PASSWORD);
    await expandComida(pageB);
    // BL-003 retiró la lista 'Recientes'; la superficie donde el movimiento se OBSERVA es la
    // celda del mes que alimenta (Mercado/ene Ejec.), que en B debe traer ya el aporte de A.
    // El \D* absorbe el glifo de sobre-consumo (›) que el gasto añade al pasarse del plan.
    await expect(nodeRow(pageB, "Mercado").getByTestId("cell-leaf").nth(cellIdx("ene", "actual"))).toHaveText(
      new RegExp(`^\\D*${fmt(baseline + 37500).replace(/\./g, "\\.")}$`)
    );
  } finally {
    await ctxB.close();
  }
});

// ── FR-1104 · localStorage solo para preferencias ──────────────────────────────

test("TC-SFU-104h: tras un recorrido completo no queda ninguna clave ledger.* en localStorage", async ({ page }) => {
  // @aitri-tc TC-SFU-104h
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();

  await editLeafCell(page, "Vivienda", cellIdx("ene", "budget"), "120000");
  await expect(nodeRow(page, "Vivienda").getByTestId("cell-leaf").nth(cellIdx("ene", "budget"))).toHaveText("120.000");

  await page.getByRole("button", { name: /Nuevo movimiento/ }).click();
  await page.getByTestId("amount-input").fill("9000");
  await page.getByTestId("category-c-vivienda").click();
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("confirm-overlay")).toContainText("$9.000");

  // Reserva: corregir el aporte de enero de la alcancía 'Ahorros' (semilla: 322.000 → 40.000).
  await editLeafCell(page, "Ahorros", cellIdx("ene", "actual"), "40000");
  await expect(nodeRow(page, "Ahorros").getByTestId("cell-leaf").nth(cellIdx("ene", "actual"))).toHaveText("40.000");

  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();

  // El recorrido tiene que haber ESCRITO de verdad: si no, «0 claves» sería un pase gratis.
  const state = await readLedger(page);
  expect(state?.budgets["c-vivienda"]?.ene).toBe(120000);
  expect(state?.actuals["c-ahorros"]?.ene).toBe(40000);
  expect((state?.movements ?? []).some((m) => m.amount === 9000)).toBe(true);

  expect(await ledgerKeys(page)).toEqual([]);
});

// ── FR-1107 · metadata honesta ─────────────────────────────────────────────────

const description = (page: Page) =>
  page.locator('meta[name="description"]').getAttribute("content").then((c) => c ?? "");

test("TC-SFU-107h: la metadata describe una app con cuenta y multi-dispositivo", async ({ page }) => {
  // @aitri-tc TC-SFU-107h
  await page.goto("/");
  const desc = await description(page);
  expect(desc.length).toBeGreaterThan(0);
  expect(desc.toLowerCase()).toContain("cuenta");
  expect(desc.toLowerCase()).not.toContain("localstorage");
});

test("TC-SFU-107e: la descripción tampoco promete acceso sin cuenta", async ({ page }) => {
  // @aitri-tc TC-SFU-107e
  await page.goto("/");
  const desc = (await description(page)).toLowerCase();
  expect(desc.length).toBeGreaterThan(0);
  for (const promesa of ["single-user", "sin cuenta", "offline"]) {
    expect(desc, `la descripción no debe prometer "${promesa}"`).not.toContain(promesa);
  }
});

test("TC-SFU-107f: no queda el texto obsoleto 'single-user (localStorage)'", async ({ page }) => {
  // @aitri-tc TC-SFU-107f
  await page.goto("/");
  const head = await page.evaluate(() => document.head.innerHTML);
  expect(head.length).toBeGreaterThan(0);
  expect(head).not.toContain("single-user (localStorage)");
});

// ── FR-1108 · la pantalla de acceso dentro del sistema de diseño ───────────────

test("TC-SFU-108h: la pantalla de acceso no usa estilos inline ni colores en hex literal", async ({ browser }) => {
  // @aitri-tc TC-SFU-108h
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  try {
    await page.goto("/");
    await expect(page.getByTestId("auth-form")).toBeVisible();

    const inlined = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="auth-form"], [data-testid="auth-form"] *')]
        .filter((el) => (el.getAttribute("style") ?? "").trim() !== "")
        .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? ""}]="${el.getAttribute("style")}"`)
    );
    expect(inlined, inlined.join(" · ")).toEqual([]);

    await fillLogin(page, "admin@admin.com", "incorrecta");
    const err = page.getByTestId("auth-error");
    await expect(err).toBeVisible();
    const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--error"));
    const color = await err.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe(hexToRgb(token));
    expect(color).not.toBe(hexToRgb("#c0392b")); // el hex de respaldo del maquetado anterior
  } finally {
    await ctx.close();
  }
});

test("TC-SFU-108e: los controles del login usan la escala canónica 32/40/48", async ({ browser }) => {
  // @aitri-tc TC-SFU-108e
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  const ids = ["auth-email", "auth-password", "auth-submit", "auth-google"];
  const heights = async () => {
    const out: Record<string, number> = {};
    for (const id of ids) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box) throw new Error(`sin bounding box: ${id}`);
      out[id] = Math.round(box.height);
    }
    return out;
  };
  try {
    await page.goto("/");
    await expect(page.getByTestId("auth-form")).toBeVisible();

    const desk = await heights();
    for (const id of ids) {
      expect([32, 40, 48], `${id} fuera de la escala canónica`).toContain(desk[id]);
      expect(desk[id], `${id} a 1440px`).toBe(40);
    }

    await page.setViewportSize(MOB);
    await expect(page.getByTestId("auth-form")).toBeVisible();
    const mob = await heights();
    for (const id of ids) expect(mob[id], `${id} a 375px (objetivo táctil WCAG 2.5.5)`).toBe(48);
  } finally {
    await ctx.close();
  }
});

test("TC-SFU-108f: el rediseño conserva los 9 data-testid y no altera el flujo", async ({ browser }) => {
  // @aitri-tc TC-SFU-108f
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  try {
    await page.goto("/");
    for (const id of ["auth-form", "auth-email", "auth-password", "auth-submit", "auth-google", "auth-toggle"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }

    await page.getByTestId("auth-toggle").click();
    await expect(page.getByTestId("auth-name")).toBeVisible();
    await page.getByTestId("auth-toggle").click();
    await expect(page.getByTestId("auth-name")).toHaveCount(0);

    await expect(page.getByTestId("auth-google")).toBeDisabled(); // GOOGLE_ENABLED=false

    await fillLogin(page, "admin@admin.com", "incorrecta");
    await expect(page.getByTestId("auth-error")).toHaveText("Credenciales inválidas");

    await fillLogin(page, workerEmail(), E2E_PASSWORD);
    await expect(page.getByTestId("logout")).toBeVisible();
  } finally {
    await ctx.close();
  }
});

// ── NFR-1101 · las preferencias del dispositivo siguen en localStorage ─────────

test("TC-SFU-201h: el tema y el ancho de columna siguen persistiendo tras recargar", async ({ page }) => {
  // @aitri-tc TC-SFU-201h
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(DESK);
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();

  await page.getByTestId("theme-toggle").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

  // El default es 240px; se arrastra la manija exactamente +80px para dejarla en 320.
  const handle = page.getByRole("separator", { name: "Redimensionar columna de categorías" });
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, y, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2 + 80, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => grid.evaluate((el) => el.style.getPropertyValue("--cat-w"))).toBe("320px");

  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  expect(await page.getByTestId("budget-grid").evaluate((el) => el.style.getPropertyValue("--cat-w"))).toBe("320px");
  // El ancho no solo se recuerda: la columna fija LO MIDE.
  const labelW = await nodeRow(page, "Vivienda").getByTestId("row-label").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(labelW).toBe(320);
});

test("TC-SFU-201e: el default del tema sigue siendo 'Sistema'", async ({ browser }) => {
  // @aitri-tc TC-SFU-201e
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await fillLogin(page, workerEmail(), E2E_PASSWORD);
    await expect(page.getByTestId("budget-grid")).toBeVisible();

    // Sin clave 'theme' escrita, el control está en 'Sistema': el tema SIGUE al del sistema en
    // ambos sentidos (eso es lo que distingue 'Sistema' de un 'oscuro' fijo).
    const theme = await page.evaluate(() => window.localStorage.getItem("theme"));
    expect(theme === null || theme === "system", `theme=${theme}`).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  } finally {
    await ctx.close();
  }
});

// ── NFR-1102 · el flujo de acceso no se degrada ────────────────────────────────

test("TC-SFU-202h: el login con credenciales válidas sigue entrando", async ({ browser }) => {
  // @aitri-tc TC-SFU-202h
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  try {
    await page.goto("/");
    await fillLogin(page, workerEmail(), E2E_PASSWORD);
    await expect(page.getByTestId("logout")).toBeVisible();
    await expect(page.getByTestId("auth-form")).toHaveCount(0);
    await expect(page.getByTestId("budget-grid")).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("TC-SFU-202e: la sesión sobrevive a recargar la página", async ({ browser }) => {
  // @aitri-tc TC-SFU-202e
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  try {
    await page.goto("/");
    await fillLogin(page, workerEmail(), E2E_PASSWORD);
    await expect(page.getByTestId("logout")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("logout")).toBeVisible();
    await expect(page.getByTestId("auth-form")).toHaveCount(0);
    await expect(page.getByTestId("budget-grid")).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("TC-SFU-202f: credenciales inválidas no entran y muestran el error literal", async ({ browser }) => {
  // @aitri-tc TC-SFU-202f
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  try {
    await page.goto("/");
    await fillLogin(page, "admin@admin.com", "noesesta");
    await expect(page.getByTestId("auth-error")).toHaveText("Credenciales inválidas");
    await expect(page.getByTestId("auth-form")).toBeVisible();
    await expect(page.getByTestId("logout")).toHaveCount(0);
    await expect(page.getByTestId("auth-email")).toHaveValue("admin@admin.com");
  } finally {
    await ctx.close();
  }
});

// ── NFR-1103 · el sync en vivo sigue vigente ───────────────────────────────────

test("TC-SFU-203e: el sync en vivo sigue actualizando la vista sin recargar", async ({ page, browser }) => {
  // @aitri-tc TC-SFU-203e
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expandComida(page);

  const ctxB = await sameAccountContext(browser);
  const pageB = await ctxB.newPage();
  try {
    await pageB.goto("/");
    await expandComida(pageB);
    const cellB = nodeRow(pageB, "Mercado").getByTestId("cell-leaf").nth(cellIdx("sep", "actual"));
    await expect(cellB).toHaveText("—"); // sep no tiene ejecución en la semilla

    // Testigo de «no se recargó»: una marca en el window de B que cualquier navegación borraría.
    await pageB.evaluate(() => ((window as unknown as { __sfu: boolean }).__sfu = true));

    await editLeafCell(page, "Mercado", cellIdx("sep", "actual"), "88000");
    await expect(nodeRow(page, "Mercado").getByTestId("cell-leaf").nth(cellIdx("sep", "actual"))).toHaveText("88.000");

    await expect(cellB).toHaveText("88.000", { timeout: 5000 });
    expect(await pageB.evaluate(() => (window as unknown as { __sfu?: boolean }).__sfu === true)).toBe(true);
  } finally {
    await ctxB.close();
  }
});

// ── NFR-1104 · la grilla y la jerarquía siguen íntegras ────────────────────────

test("TC-SFU-204h: la grilla de 12 meses sigue operando contra Postgres", async ({ page }) => {
  // @aitri-tc TC-SFU-204h
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expandComida(page);

  await editLeafCell(page, "Mercado", cellIdx("oct", "budget"), "143000");
  await page.reload();
  await expandComida(page);

  const cell = nodeRow(page, "Mercado").getByTestId("cell-leaf").nth(cellIdx("oct", "budget"));
  await expect(cell).toHaveText("143.000");

  const state = await readLedger(page);
  expect(state?.budgets["s-comida-mercado"]?.oct).toBe(143000);
  // Roll-up del padre: 'Comida' no es hoja — su celda agrega a sus tres subcategorías.
  const esperado =
    143000 +
    (state?.budgets["s-comida-restaurantes"]?.oct ?? 0) +
    (state?.budgets["s-comida-cafe"]?.oct ?? 0);
  expect(esperado).toBeGreaterThan(143000);
  await expect(nodeRow(page, "Comida").getByTestId("cell-parent").nth(cellIdx("oct", "budget"))).toHaveText(fmt(esperado));
});

test("TC-SFU-204e: promote y demote de nodos siguen funcionando tras el retiro", async ({ page }) => {
  // @aitri-tc TC-SFU-204e
  // 'Ocio'/'Cine' no están en la semilla: se siembran por la API, el mismo camino de un dato real.
  const seed = buildSeed("local");
  const nodes: LedgerNode[] = [
    ...seed.nodes,
    { id: "c-ocio", ownerId: "local", type: "expense", level: "category", parentId: "g-esenciales", name: "Ocio", icon: "tag", order: 100 },
    { id: "s-ocio-cine", ownerId: "local", type: "expense", level: "sub", parentId: "c-ocio", name: "Cine", icon: null, order: 101 },
  ];
  await seedLedger(page, { nodes, budgets: seed.budgets, actuals: seed.actuals });

  await page.setViewportSize({ width: 1440, height: 1250 });
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();

  const parentOf = async (id: string) => {
    const res = await page.request.get("/api/v1/ledger");
    const body = (await res.json()) as { state: { nodes: LedgerNode[] } };
    return body.state.nodes.find((n) => n.id === id)?.parentId ?? null;
  };
  const label = (name: string) => nodeRow(page, name).getByTestId("row-label").first();
  const gastos = page.getByTestId("type-total-row").filter({ hasText: /GASTOS/ }).getByTestId("row-label");

  // Promover: 'Ocio' → grupo. 'Cine' sube a categoría pero SIGUE colgando de 'Ocio'.
  await drag(page, label("Ocio"), gastos);
  await expect(async () => {
    await expect(nodeRow(page, "Ocio")).toHaveAttribute("data-level", "group", { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  expect(await parentOf("s-ocio-cine")).toBe("c-ocio");
  // 'Ocio' nace CATEGORÍA, así que initialExpanded (que solo marca los grupos del primer render) no
  // lo tiene expandido y su hijo no se pinta al promoverlo. Hay que abrirlo — con reintento, porque
  // el clic compite con el re-render que produce la propia promoción.
  await expect(async () => {
    if ((await grid.getByText("Cine", { exact: true }).count()) === 0) {
      await grid.getByText("Ocio", { exact: true }).first().click();
    }
    await expect(nodeRow(page, "Cine")).toHaveAttribute("data-level", "category", { timeout: 1500 });
  }).toPass({ timeout: 15_000 });

  // Degradar: 'Ocio' vuelve a categoría dentro de 'Esenciales'; 'Cine' baja a subcategoría.
  await drag(page, label("Ocio"), label("Esenciales"));
  await expect(async () => {
    await expect(nodeRow(page, "Ocio")).toHaveAttribute("data-level", "category", { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  expect(await parentOf("c-ocio")).toBe("g-esenciales");
  expect(await parentOf("s-ocio-cine")).toBe("c-ocio");

  // Sin huérfanos: todo parentId apunta a un nodo existente y solo los grupos van sin padre.
  const res = await page.request.get("/api/v1/ledger");
  const finalNodes = ((await res.json()) as { state: { nodes: LedgerNode[] } }).state.nodes;
  const ids = new Set(finalNodes.map((n) => n.id));
  const huerfanos = finalNodes.filter((n) => (n.parentId === null ? n.level !== "group" : !ids.has(n.parentId)));
  expect(huerfanos.map((n) => n.id)).toEqual([]);
});

// ── NFR-1106 · cerrar sesión no deja rastro ────────────────────────────────────

test("TC-SFU-206e: tras cerrar sesión no queda dato financiero en el navegador", async ({ browser }) => {
  // @aitri-tc TC-SFU-206e
  // Sesión PROPIA, no la del worker: `signOut` la revoca en el servidor, y la del worker es la
  // que comparten los demás tests (revocarla los tumbaría a todos con 401 en freshLedger).
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  try {
    await page.goto("/");
    await fillLogin(page, workerEmail(), E2E_PASSWORD);
    await expandComida(page);
    await expect(page.locator("body")).toContainText("Mercado");

    await page.getByTestId("logout").click();
    await expect(page.getByTestId("auth-form")).toBeVisible();

    expect(await ledgerKeys(page)).toEqual([]);
    await expect(page.locator("body")).not.toContainText("Mercado");
    await expect(page.getByTestId("budget-grid")).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

/**
 * AC-1108c — el contraste de la pantalla de acceso, en ambos temas.
 *
 * Este criterio se quedó SIN TC en la fase 3 (sus tres TCs cubren AC-1108a/b/d), y `verify-run` lo
 * señala como el único AC sin test de la feature. La cobertura se añade aquí porque un criterio de
 * un FR MUST sobre una pantalla recién re-estilada es justo lo que regresa en silencio; el TC que
 * lo acredite formalmente exige re-abrir la fase 3, que es decisión del humano.
 */
for (const scheme of ["light", "dark"] as const) {
  test(`AC-1108c: todo texto de la pantalla de acceso alcanza 4.5:1 en tema ${scheme}`, async ({ browser }) => {
    const ctx = await browser.newContext({
      baseURL: E2E_BASE,
      viewport: DESK,
      storageState: { cookies: [], origins: [] },
      colorScheme: scheme,
    });
    const page = await ctx.newPage();
    try {
      await page.goto("/");
      const form = page.getByTestId("auth-form");
      await expect(form).toBeVisible();

      // Se mide sobre el DOM real: color efectivo del texto contra el fondo pintado detrás, subiendo
      // por los ancestros hasta encontrar uno con fondo opaco (el propio elemento suele ser
      // transparente). Solo elementos con texto propio.
      const bajos = await form.evaluate((root) => {
        const lum = (c: string) => {
          const m = c.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"];
          const [r, g, b] = [Number(m[0]), Number(m[1]), Number(m[2])].map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const fondoDe = (el: Element): string => {
          let cur: Element | null = el;
          while (cur) {
            const bg = getComputedStyle(cur).backgroundColor;
            const alpha = bg.startsWith("rgba") ? Number(bg.match(/[\d.]+/g)![3]) : 1;
            if (alpha > 0) return bg;
            cur = cur.parentElement;
          }
          return "rgb(255, 255, 255)";
        };
        const malos: { texto: string; ratio: number }[] = [];
        for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
          const propio = Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent?.trim() ?? "")
            .join("");
          if (!propio) continue;
          const s = getComputedStyle(el);
          if (s.visibility === "hidden" || s.display === "none") continue;
          const l1 = lum(s.color);
          const l2 = lum(fondoDe(el));
          const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
          const ratio = (hi + 0.05) / (lo + 0.05);
          if (ratio < 4.5) malos.push({ texto: propio.slice(0, 40), ratio: Math.round(ratio * 100) / 100 });
        }
        return malos;
      });

      expect(bajos, `textos por debajo de 4.5:1 en tema ${scheme}: ${JSON.stringify(bajos)}`).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
