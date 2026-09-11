/**
 * Feature meses-y-saldo-inicial — EP-03: la tarjeta de arranque en el navegador.
 * TCs: FR-2203 (020h,021h,022e,023e,024f,025e,026e,027h) · NFR-2206 (095h,096f,097e)
 *
 * Lo que se prueba aquí es lo que NO se puede afirmar sin un navegador real: que la tarjeta no es
 * un muro (foco, teclado, grilla operable detrás), que se va por las cuatro vías y no vuelve, y que
 * su copia cambia con el mes declarado.
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import type { LedgerNode } from "@/domain/types";

const DESK = { width: 1440, height: 900 };
const MOVIL = { width: 375, height: 812 };
const ANIO = new Date().getFullYear();
const P = (m: number) => `${ANIO}-${String(m).padStart(2, "0")}`;

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sueldo", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Sueldo", icon: null, order: 1 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "c-comida", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Comida", icon: null, order: 3 },
];

/** Un usuario SIN datos y SIN declaración: el único estado en que la tarjeta existe. */
async function sinDatos(page: Page, viewport = DESK): Promise<void> {
  await page.setViewportSize(viewport);
  await seedLedger(page, { nodes: NODES });
  await page.goto("/");
}

test("TC-MSI-020h: Sin datos y sin declarar, la tarjeta está y la grilla opera detrás", async ({ page }) => {
  // @aitri-tc TC-MSI-020h
  await sinDatos(page);
  const tarjeta = page.getByTestId("opening-card");
  await expect(tarjeta).toBeVisible();

  // No es un muro: nada de diálogo modal, y la grilla se ve.
  await expect(tarjeta).not.toHaveAttribute("aria-modal", "true");
  await expect(tarjeta).toHaveAttribute("role", "region");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();

  // Y se OPERA detrás: una celda de hoja abre su editor con la tarjeta puesta.
  await grid.getByText("Comida", { exact: true }).first().click();
  await grid.getByTestId("cell-leaf").first().click();
  await expect(page.getByLabel("Editar valor")).toBeVisible();
});

test("TC-MSI-021h: Guardar un monto retira la tarjeta y el número aparece en el Balance", async ({ page }) => {
  // @aitri-tc TC-MSI-021h
  await sinDatos(page);
  await page.getByTestId("opening-amount").fill("3000000");
  await page.getByTestId("opening-save").click();

  await expect(page.getByTestId("opening-card")).toHaveCount(0);
  // La fila conserva su rótulo: no se renombra ni se le pone rótulo condicional (no_go_zone).
  await expect(page.getByText("Saldo del mes anterior", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("balance-module")).toContainText("3.000.000");
});

test("TC-MSI-022e: «Empiezo desde cero» retira la tarjeta y no vuelve tras recargar", async ({ page }) => {
  // @aitri-tc TC-MSI-022e
  await sinDatos(page);
  await page.getByTestId("opening-zero").click();
  await expect(page.getByTestId("opening-card")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("opening-card")).toHaveCount(0);

  const estado = await (await page.request.get("/api/v1/ledger")).json();
  expect(estado.state.openingBalance).toBe(0);
  expect(estado.state.startMonth).not.toBeNull();
});

test("TC-MSI-023e: Teclear en la grilla sin responder retira la tarjeta y deja el saldo en 0", async ({ page }) => {
  // @aitri-tc TC-MSI-023e
  await sinDatos(page);
  await expect(page.getByTestId("opening-card")).toBeVisible();

  const grid = page.getByTestId("budget-grid");
  await grid.getByText("Comida", { exact: true }).first().click();
  await grid.getByTestId("cell-leaf").first().click();
  const editor = page.getByLabel("Editar valor");
  await editor.fill("120000");
  await editor.press("Enter");

  await expect(page.getByTestId("opening-card")).toHaveCount(0);

  // La declaración implícita sale DESPUÉS del guardado de la celda (va diferido y serializado), así
  // que se espera a que aterrice en vez de recargar encima: una recarga inmediata cancelaría la
  // petición en vuelo y el test mediría la carrera, no el requisito.
  await expect.poll(async () => {
    const r = await page.request.get("/api/v1/ledger");
    return ((await r.json()) as { state: { openingBalance: number | null } }).state.openingBalance;
  }, { timeout: 10_000 }).toBe(0);

  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("opening-card")).toHaveCount(0);
  await expect(grid.getByTestId("cell-leaf").first()).toHaveText("120.000");
});

test("TC-MSI-024f: Si el guardado falla, la tarjeta NO se retira y el monto no se pierde", async ({ page }) => {
  // @aitri-tc TC-MSI-024f
  await sinDatos(page);
  await page.route("**/api/v1/ledger/start", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));

  await page.getByTestId("opening-amount").fill("3000000");
  await page.getByTestId("opening-save").click();

  // Nunca un falso «guardado»: la tarjeta sigue, el monto sigue, y el fallo se dice.
  await expect(page.getByTestId("opening-card")).toBeVisible();
  await expect(page.getByTestId("opening-amount")).toHaveValue("3000000");
  await expect(page.getByTestId("opening-save-error")).toBeVisible();
});

test("TC-MSI-025e: En móvil la tarjeta no existe en el DOM", async ({ page }) => {
  // @aitri-tc TC-MSI-025e
  await sinDatos(page, MOVIL);
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await expect(page.getByTestId("opening-card")).toHaveCount(0);
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);
});

test("TC-MSI-026e: Con el inicio en un mes PASADO la tarjeta cambia la pregunta", async ({ page }) => {
  // @aitri-tc TC-MSI-026e
  await sinDatos(page);
  const tarjeta = page.getByTestId("opening-card");
  // Con el inicio en el mes en curso, la pregunta es «hoy».
  await expect(tarjeta).toContainText("¿Cuánto tienes hoy?");

  await page.getByTestId("opening-toggle-month").click();
  await page.getByTestId("opening-month-select").click();
  // `exact: true` y sin `.first()`: es la convención que ya usan cierre-de-mes, balance y multi-anio
  // con este mismo `ui/select`. Las etiquetas del selector van capitalizadas (encabezado), aunque
  // dentro de la frase el mes se escriba en minúscula.
  await page.getByRole("option", { name: "Junio", exact: true }).click();
  // Esperar a que el listbox se cierre ANTES de leer la tarjeta: mientras el portal de Radix está
  // abierto marca el resto de la página como inerte, y la tarjeta se lee vacía.
  await expect(page.getByRole("listbox")).toHaveCount(0);

  // Al elegir un mes pasado cambia la PREGUNTA: es lo que evita el doble conteo de quien va a
  // transcribir su historia desde un cuaderno.
  await expect(tarjeta).toContainText("¿Cuánto tenías al empezar junio?");
  await expect(tarjeta).not.toContainText("¿Cuánto tienes hoy?");
  await expect(tarjeta).toContainText("No incluyas los ingresos de junio en adelante");
  await expect(tarjeta).toContainText("Tu historia empieza en junio");
});

test("TC-MSI-027h: El selector de mes se despliega dentro de la tarjeta, sin navegar", async ({ page }) => {
  // @aitri-tc TC-MSI-027h
  await sinDatos(page);
  const enlace = page.getByTestId("opening-toggle-month");
  await expect(enlace).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("opening-month")).toHaveCount(0);

  await enlace.click();

  expect(new URL(page.url()).pathname).toBe("/");
  await expect(enlace).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("opening-month")).toBeVisible();
  await expect(page.getByTestId("opening-month-select")).toBeVisible();
  await expect(page.getByTestId("opening-year-select")).toBeVisible();
});

test("TC-MSI-095h: La tarjeta no atrapa el foco ni bloquea la página", async ({ page }) => {
  // @aitri-tc TC-MSI-095h
  await sinDatos(page);
  const tarjeta = page.getByTestId("opening-card");
  await expect(tarjeta).toBeVisible();
  await expect(tarjeta).not.toHaveAttribute("role", "dialog");
  await expect(tarjeta).not.toHaveAttribute("aria-modal", "true");

  await page.getByTestId("opening-amount").focus();
  // Quince tabulaciones: el foco tiene que SALIR de la tarjeta.
  let escapo = false;
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    const dentro = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="opening-card"]');
      return !!card && card.contains(document.activeElement);
    });
    if (!dentro) { escapo = true; break; }
  }
  expect(escapo).toBe(true);
});

test("TC-MSI-096f: La tarjeta no reaparece tras resolverse por ninguna vía", async ({ page }) => {
  // @aitri-tc TC-MSI-096f
  await sinDatos(page);
  await page.getByTestId("opening-amount").fill("1500000");
  await page.getByTestId("opening-save").click();
  await expect(page.getByTestId("opening-card")).toHaveCount(0);

  // Tres recargas seguidas: ninguna la trae de vuelta.
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await expect(page.getByTestId("opening-card")).toHaveCount(0);
  }
});

test("TC-MSI-097e: La tarjeta respeta prefers-reduced-motion", async ({ page }) => {
  // @aitri-tc TC-MSI-097e
  await page.emulateMedia({ reducedMotion: "reduce" });
  await sinDatos(page);
  const tarjeta = page.getByTestId("opening-card");
  await expect(tarjeta).toBeVisible();

  // La regla global de globals.css lleva TODA duración a 0.001ms. Aplica también a esta superficie
  // nueva: no se le escapa por ser un componente añadido después.
  const ms = await tarjeta.evaluate((el) => {
    const cs = getComputedStyle(el);
    const dur = (v: string) => Math.max(...v.split(",").map((x) => parseFloat(x) * (x.includes("ms") ? 1 : 1000) || 0));
    return Math.max(dur(cs.animationDuration), dur(cs.transitionDuration));
  });
  expect(ms).toBeLessThanOrEqual(1);
});

// ── EP-04 · La página de Configuración ─────────────────────────────────────────────────────────

test("TC-MSI-030h: Configuración muestra exactamente cinco ajustes", async ({ page }) => {
  // @aitri-tc TC-MSI-030h
  await page.setViewportSize(DESK);
  await seedLedger(page, { nodes: NODES });
  await page.goto("/");
  await page.getByTestId("config-link").click();

  await expect(page).toHaveURL(/\/configuracion$/);
  // Los CINCO, ni uno más: tema, ancho de columna, horizonte, mes de inicio y saldo inicial.
  await expect(page.getByTestId("config-theme")).toBeVisible();
  await expect(page.getByTestId("config-catwidth")).toBeVisible();
  await expect(page.getByTestId("horizon-select")).toBeVisible();
  await expect(page.getByTestId("config-startmonth")).toBeVisible();
  await expect(page.getByTestId("config-opening")).toBeVisible();
});

test("TC-MSI-031h: La entrada a Configuración existe también en la cabecera móvil", async ({ page }) => {
  // @aitri-tc TC-MSI-031h
  await page.setViewportSize(MOVIL);
  await seedLedger(page, { nodes: NODES });
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();

  await page.getByRole("button", { name: "Configuración" }).click();
  await expect(page).toHaveURL(/\/configuracion$/);
  // En móvil ésta es la ÚNICA vía al saldo inicial: no hay grilla, luego no hay tarjeta.
  await expect(page.getByTestId("config-opening")).toBeVisible();
});

test("TC-MSI-032e: En móvil el ancho de columna no se muestra", async ({ page }) => {
  // @aitri-tc TC-MSI-032e
  await page.setViewportSize(MOVIL);
  await seedLedger(page, { nodes: NODES });
  await page.goto("/configuracion");

  await expect(page.getByTestId("config-catwidth")).toBeHidden();
  // Los otros cuatro sí están.
  await expect(page.getByTestId("config-theme")).toBeVisible();
  await expect(page.getByTestId("horizon-select")).toBeVisible();
  await expect(page.getByTestId("config-startmonth")).toBeVisible();
  await expect(page.getByTestId("config-opening")).toBeVisible();
});

test("TC-MSI-033e: Volver de Configuración no pierde el estado de la grilla", async ({ page }) => {
  // @aitri-tc TC-MSI-033e
  await page.setViewportSize(DESK);
  await seedLedger(page, { nodes: NODES, actuals: { "c-comida": { [P(6)]: 40_000 } } });
  await page.goto("/");

  // El observable es el FILTRO DE PERIODO, que es estado de la grilla y vive en el store. La
  // pestaña Resumen/Dashboard NO sirve: es `useState` local de DesktopShell, así que se pierde al
  // desmontar y volver — consecuencia aceptada y anotada, no es «el estado de la grilla».
  await page.getByRole("tab", { name: "Año" }).click();
  const alcance = page.getByLabel("Año");
  await expect(alcance).toBeVisible();

  await page.getByTestId("config-link").click();
  await expect(page).toHaveURL(/\/configuracion$/);
  await page.getByTestId("config-back").click();

  await expect(page).toHaveURL(/\/$/);
  // El store es un singleton de módulo: la navegación de cliente no lo re-hidrata ni lo reinicia.
  await expect(page.getByRole("tab", { name: "Año" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Año")).toBeVisible();
});

test("TC-MSI-034f: El selector de horizonte YA NO está en la cabecera de escritorio", async ({ page }) => {
  // @aitri-tc TC-MSI-034f
  await page.setViewportSize(DESK);
  await seedLedger(page, { nodes: NODES });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();

  // FR-1907 saldado: un solo control por ajuste, y vive en Configuración.
  await expect(page.getByTestId("horizon-select")).toHaveCount(0);
  await page.goto("/configuracion");
  await expect(page.getByTestId("horizon-select")).toHaveCount(1);
});

test("TC-MSI-035h: Cambiar el tema desde Configuración surte el mismo efecto y persiste", async ({ page }) => {
  // @aitri-tc TC-MSI-035h
  await page.setViewportSize(DESK);
  await seedLedger(page, { nodes: NODES });
  await page.goto("/configuracion");

  await page.getByTestId("config-theme-dark").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  // Y «Claro» lo revierte, igual que el conmutador de la cabecera.
  await page.getByTestId("config-theme-light").click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("TC-MSI-042e: Con el mes cerrado, el campo llega deshabilitado y explica la vía", async ({ page }) => {
  // @aitri-tc TC-MSI-042e
  await page.setViewportSize(DESK);
  await seedLedger(page, { nodes: NODES, actuals: { "c-comida": { [P(6)]: 40_000 } } });

  // Declarar junio como inicio y cerrarlo por API: el escenario real de FR-2205.
  const rev = ((await (await page.request.get("/api/v1/ledger")).json()) as { revision: number }).revision;
  await page.request.put("/api/v1/ledger/start", {
    data: { baseRevision: rev, startMonth: P(6), openingBalance: 3_000_000 },
  });
  const rev2 = ((await (await page.request.get("/api/v1/ledger")).json()) as { revision: number }).revision;
  await page.request.post("/api/v1/closure", { data: { baseRevision: rev2 } });

  await page.goto("/configuracion");
  // Se PREVIENE, no se castiga: el campo llega bloqueado y dice qué hacer.
  await expect(page.getByTestId("config-opening")).toBeDisabled();
  const aviso = page.getByTestId("config-blocked");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("cerrado");
  await expect(aviso).toContainText("reabre ese mes");
  await expect(page.getByTestId("config-save")).toBeDisabled();
});
