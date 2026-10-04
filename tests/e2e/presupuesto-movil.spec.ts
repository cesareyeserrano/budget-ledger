import type { Browser, BrowserContext } from "@playwright/test";
import { test, expect, type Page, type Locator } from "./helpers/fixtures";
import { readLedger, seedLedger } from "./helpers/seed";
import { applyCycles, closeViaApi, fixToday } from "./helpers/cycles";
import { E2E_BASE, E2E_PASSWORD, e2eEmail, storageStatePath } from "./helpers/globalSetup";
import { PMV, pmvBase, type PmvSeed } from "../fixtures/pmv-base";

// Feature presupuesto-movil — lo que solo el NAVEGADOR puede afirmar: que a ≤760 px el teléfono
// tiene registro y presupuesto, que la navegación es la de una página web (segmentado arriba y el
// «atrás» del navegador), y que la lista del periodo muestra las MISMAS cifras que la grilla de
// escritorio. Prefijo TC-PMV-*.
//
// La aritmética vive en tests/domain/presupuesto-movil-*.test.ts; aquí, que la pantalla la muestre.
// «Hoy» se fija con `fixToday`, así que el periodo actual es siempre M y la suite no depende de la
// fecha en que corre.

const MOBILE = { width: 375, height: 812 };
const DESK = { width: 1440, height: 900 };
const HOY = "2026-08-25";
const M = "2026-08";
const PREV = "2026-07";
const LABEL_M = "Agosto 2026";
const LABEL_PREV = "Julio 2026";

const fmt = (n: number) => n.toLocaleString("es-CO");

interface AbrirOpts {
  viewport?: { width: number; height: number };
  seed?: PmvSeed;
  cerrarPrev?: boolean;
  ruta?: string;
}

/** Siembra el libro de ejemplo con «hoy» fijo y abre la app. */
async function abrir(page: Page, opts: AbrirOpts = {}): Promise<void> {
  await fixToday(page, HOY);
  await page.setViewportSize(opts.viewport ?? MOBILE);
  await seedLedger(page, opts.seed ?? pmvBase(M, PREV));
  if (opts.cerrarPrev) expect(await closeViaApi(page), "cerrar el periodo anterior").toBe(200);
  await page.goto(opts.ruta ?? "/");
}

async function abrirMovil(page: Page, opts: AbrirOpts = {}): Promise<void> {
  await abrir(page, opts);
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
}

const tab = (page: Page, nombre: "Registrar" | "Presupuesto") => page.getByTestId("mb-nav").getByRole("tab", { name: nombre });

async function irAPresupuesto(page: Page): Promise<void> {
  await tab(page, "Presupuesto").click();
  await expect(page.getByTestId("mb-budget")).toBeVisible();
}

/** La fila de la lista con ese nombre exacto. */
const fila = (page: Page, nombre: string): Locator =>
  page.getByTestId("mb-row").filter({ has: page.getByTestId("mb-row-name").getByText(nombre, { exact: true }) });
const real = (page: Page, nombre: string) => fila(page, nombre).getByTestId("mb-row-actual");
const plan = (page: Page, nombre: string) => fila(page, nombre).getByTestId("mb-row-budget");
const barra = (page: Page, nombre: string) => fila(page, nombre).getByTestId("mb-bar-fill");

/** El color que el navegador resuelve para un token, para comparar contra un color computado. */
const colorDe = (page: Page, token: string) => page.evaluate((t) => {
  const probe = document.createElement("span");
  probe.style.color = `var(${t})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}, token);
const colorDeTexto = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).color);
const fondoDe = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
const anchoDe = (loc: Locator) => loc.evaluate((el) => (el as HTMLElement).style.width);

/** Cuenta las lecturas del libro: una navegación dentro de la app no debe provocar ninguna. */
function contarLecturas(page: Page): () => number {
  let n = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === "/api/v1/ledger") n++;
  });
  return () => n;
}

const busqueda = (page: Page) => page.evaluate(() => window.location.search);
const ruta = (page: Page) => page.evaluate(() => window.location.pathname);

/** Segundo contexto con la MISMA cuenta del worker (otro dispositivo del mismo usuario). */
function mismaCuenta(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  return browser.newContext({ baseURL: E2E_BASE, viewport, storageState: storageStatePath(test.info().parallelIndex) });
}

// ── Escritorio, para comparar ───────────────────────────────────────────────────────────────────
const celda = (page: Page, id: string, mes: string, plano: "budget" | "actual") =>
  page.locator(`[data-cell="${id}"][data-month="${mes}"][data-plane="${plano}"]`);
const filaGrilla = (page: Page, nombre: string) =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: nombre }) });

/**
 * Las dos cifras de un nodo en la columna de un mes de la grilla.
 *
 * Las celdas de hoja llevan `data-cell`; las de un padre (total por roll-up) no, así que se leen por
 * posición: la grilla pinta dos celdas por mes, en el orden de sus encabezados.
 */
async function cifrasGrilla(page: Page, id: string, nombre: string, mes: string): Promise<{ budget: number; actual: number }> {
  if (await celda(page, id, mes, "budget").count()) {
    return {
      budget: numero(await celda(page, id, mes, "budget").innerText()),
      actual: numero(await celda(page, id, mes, "actual").innerText()),
    };
  }
  const meses = await page.locator("[data-month-head]").evaluateAll((els) => els.map((e) => e.getAttribute("data-month-head")));
  const i = meses.indexOf(mes);
  expect(i, `la grilla pinta la columna ${mes}`).toBeGreaterThanOrEqual(0);
  const celdas = filaGrilla(page, nombre).first().locator('[data-testid="cell-parent"], [data-testid="cell-leaf"]');
  return { budget: numero(await celdas.nth(i * 2).innerText()), actual: numero(await celdas.nth(i * 2 + 1).innerText()) };
}

/** Despliega en la grilla todos los nodos plegados, hasta que no quede ninguno. */
async function desplegarGrilla(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const botones = page.getByTestId("budget-grid").locator('button[aria-label="Expandir"][aria-expanded="false"]');
    const n = await botones.count();
    if (n === 0) return;
    await botones.first().click();
  }
}

/** Despliega en el teléfono todas las tarjetas y categorías con hijos. */
async function desplegarLista(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const plegadas = page.locator('[data-testid="mb-row"][aria-expanded="false"]');
    if ((await plegadas.count()) === 0) return;
    await plegadas.first().click();
  }
}

/** «1.000» → 1000; «—» → 0; «› 550» → 550; «de 1.000» → 1000. */
const numero = (texto: string | null) => Number((texto ?? "").replace(/[^\d]/g, "") || 0);

// ═══ FR-3101 · navegación ════════════════════════════════════════════════════════════════════════

test("TC-PMV-001h: abre en Registrar y pasa a Presupuesto sin recargar ni volver a leer el libro", async ({ page }) => {
  // @aitri-tc TC-PMV-001h
  const lecturas = contarLecturas(page);
  await abrirMovil(page);
  await expect(page.getByTestId("page-title")).toHaveText("Nuevo movimiento");
  await expect(tab(page, "Registrar")).toHaveAttribute("aria-selected", "true");
  const antes = lecturas();

  await irAPresupuesto(page);

  await expect(page.getByTestId("mb-period-label")).toHaveText(LABEL_M);
  await expect(page.getByTestId("page-title")).toBeHidden();
  await expect(tab(page, "Presupuesto")).toHaveAttribute("aria-selected", "true");
  expect(await ruta(page)).toBe("/");
  expect(await busqueda(page)).toBe("?v=p");
  expect(lecturas(), "cambiar de vista no relee el libro").toBe(antes);
});

test("TC-PMV-002e: el periodo y los grupos abiertos se conservan al ir a Registrar y volver", async ({ page }) => {
  // @aitri-tc TC-PMV-002e
  await abrirMovil(page);
  await irAPresupuesto(page);
  await page.getByTestId("mb-period-prev").click();
  await expect(page.getByTestId("mb-period-label")).toHaveText(LABEL_PREV);
  await fila(page, "Vivienda").click();
  await expect(fila(page, "Mercado")).toBeVisible();

  await tab(page, "Registrar").click();
  await page.getByTestId("amount-input").fill("123");
  await tab(page, "Presupuesto").click();

  await expect(page.getByTestId("mb-period-label")).toHaveText(LABEL_PREV);
  await expect(fila(page, "Mercado")).toBeVisible();
  await expect(real(page, "Mercado")).toHaveText("850");

  await tab(page, "Registrar").click();
  expect(numero(await page.getByTestId("amount-input").inputValue())).toBe(123);
});

test("TC-PMV-003f: Configuración, tema y salir siguen a la mano en Presupuesto", async ({ page }) => {
  // @aitri-tc TC-PMV-003f
  await abrirMovil(page);
  await irAPresupuesto(page);
  for (const id of ["config-link", "theme-toggle", "logout"]) {
    await expect(page.getByTestId(id), id).toHaveCount(1);
    await expect(page.getByTestId(id), id).toBeVisible();
    await expect(page.getByTestId(id), id).toBeEnabled();
  }
});

test("TC-PMV-004h: el atrás del navegador vuelve de una categoría a la lista, con su scroll y sin recargar", async ({ page }) => {
  // @aitri-tc TC-PMV-004h
  const lecturas = contarLecturas(page);
  // Pantalla baja: así la lista es más alta que la ventana y hay scroll que conservar.
  await abrirMovil(page, { viewport: { width: 375, height: 420 } });
  await irAPresupuesto(page);
  await fila(page, "Vivienda").click();
  await page.evaluate(() => window.scrollTo(0, 240));
  expect(await page.evaluate(() => window.scrollY)).toBe(240);
  const antes = lecturas();

  // Clic por DOM: el de Playwright desplazaría la fila a la vista y movería el scroll que se mide.
  await fila(page, "Mercado").evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await expect(page.getByTestId("mb-title")).toHaveText("Mercado");
  expect(await busqueda(page)).toBe(`?v=p&d=leaf&id=${PMV.mercado}`);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.goBack();

  await expect(page.getByTestId("mb-leaf")).toHaveCount(0);
  await expect(page.getByTestId("mb-budget")).toBeVisible();
  expect(await busqueda(page)).toBe("?v=p");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(238);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(242);
  await expect(fila(page, "Mercado")).toBeVisible();
  expect(lecturas(), "entrar y salir de un detalle no relee el libro").toBe(antes);
});

test("TC-PMV-005e: en un enlace directo a un detalle, la flecha vuelve a la lista y no saca de la app", async ({ page }) => {
  // @aitri-tc TC-PMV-005e
  await abrirMovil(page, { ruta: `/?v=p&d=leaf&id=${PMV.mercado}` });
  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await expect(page.getByTestId("mb-title")).toHaveText("Mercado");

  await page.getByTestId("mb-back").click();

  await expect(page.getByTestId("mb-budget")).toBeVisible();
  await expect(page.getByTestId("mb-leaf")).toHaveCount(0);
  expect(await ruta(page)).toBe("/");
  expect(await busqueda(page)).toBe("?v=p");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
});

test("TC-PMV-006f: una URL con parámetros inválidos cae a una pantalla válida, sin pantalla en blanco", async ({ page }) => {
  // @aitri-tc TC-PMV-006f
  const dialogos: string[] = [];
  const errores: string[] = [];
  page.on("dialog", (d) => { dialogos.push(d.message()); void d.dismiss(); });
  page.on("pageerror", (e) => errores.push(e.message));

  await abrirMovil(page, { ruta: "/?v=p&d=leaf&id=no-existe" });
  await expect(page.getByTestId("mb-budget")).toBeVisible();
  await expect(page.getByTestId("mb-leaf")).toHaveCount(0);
  await expect.poll(() => busqueda(page)).toBe("?v=p");

  // Un grupo con hijos no es una hoja: tampoco abre pantalla.
  await page.goto(`/?v=p&d=leaf&id=${PMV.vivienda}`);
  await expect(page.getByTestId("mb-budget")).toBeVisible();
  await expect.poll(() => busqueda(page)).toBe("?v=p");

  await page.goto(`/?v=${encodeURIComponent("<script>alert(1)</script>")}&d=zzz`);
  await expect(page.getByTestId("page-title")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("Nuevo movimiento");
  await expect(page.getByTestId("mb-budget")).toHaveCount(0);

  expect(dialogos).toEqual([]);
  expect(errores).toEqual([]);
});

// ═══ FR-3102 · periodo ═══════════════════════════════════════════════════════════════════════════

test("TC-PMV-010h: abre en el periodo actual, con el mismo rótulo que el selector de escritorio", async ({ page }) => {
  // @aitri-tc TC-PMV-010h
  await abrir(page, { viewport: DESK });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  const escritorio = (await page.getByRole("combobox", { name: "Mes" }).innerText()).trim();
  expect(escritorio).toBe(LABEL_M);

  await page.setViewportSize(MOBILE);
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await irAPresupuesto(page);
  await expect(page.getByTestId("mb-period-label")).toHaveText(escritorio);
});

test("TC-PMV-011e: en modo ciclo el rótulo trae el rango de fechas del ciclo", async ({ page }) => {
  // @aitri-tc TC-PMV-011e
  await fixToday(page, HOY);
  await page.setViewportSize(DESK);
  await seedLedger(page, pmvBase(M, PREV));
  await applyCycles(page, { mode: "cycle", anchorDay: 21 });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  const escritorio = (await page.getByRole("combobox", { name: "Mes" }).innerText()).trim();
  expect(escritorio).toMatch(/^\S+ \d{4} · \d{1,2} \S+ – \d{1,2} \S+$/);

  await page.setViewportSize(MOBILE);
  await irAPresupuesto(page);
  await expect(page.getByTestId("mb-period-label")).toHaveText(escritorio);
});

test("TC-PMV-012f: en el primer periodo «anterior» está deshabilitado, y en el último «siguiente»", async ({ page }) => {
  // @aitri-tc TC-PMV-012f
  await abrirMovil(page);
  await irAPresupuesto(page);
  const prev = page.getByTestId("mb-period-prev");
  const next = page.getByTestId("mb-period-next");
  const label = page.getByTestId("mb-period-label");

  await page.getByTestId("mb-period-select").click();
  await page.getByRole("option").first().click();
  const primero = await label.innerText();
  expect(primero).toBe(LABEL_PREV);
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();
  await prev.click({ force: true });
  await expect(label).toHaveText(primero);

  await page.getByTestId("mb-period-select").click();
  await page.getByRole("option").last().click();
  const ultimo = await label.innerText();
  expect(ultimo).not.toBe(primero);
  await expect(next).toBeDisabled();
  await expect(prev).toBeEnabled();
  await next.click({ force: true });
  await expect(label).toHaveText(ultimo);
});

test("TC-PMV-013e: el selector lista los mismos periodos que escritorio, en el mismo orden", async ({ page }) => {
  // @aitri-tc TC-PMV-013e
  await abrir(page, { viewport: DESK });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.getByRole("combobox", { name: "Mes" }).click();
  const escritorio = (await page.getByRole("option").allInnerTexts()).map((t) => t.trim());
  await page.keyboard.press("Escape");
  expect(escritorio.length).toBeGreaterThan(2);
  expect(escritorio[0]).toBe(LABEL_PREV);

  await page.setViewportSize(MOBILE);
  await irAPresupuesto(page);
  await page.getByTestId("mb-period-select").click();
  const movil = (await page.getByRole("option").allInnerTexts()).map((t) => t.trim());
  expect(movil).toEqual(escritorio);
});

test("TC-PMV-014h: un periodo cerrado lleva candado en el rótulo y muestra el aviso", async ({ page }) => {
  // @aitri-tc TC-PMV-014h
  await abrirMovil(page, { cerrarPrev: true });
  await irAPresupuesto(page);
  const barraPeriodo = page.getByTestId("mb-period-bar");
  await expect(barraPeriodo.getByRole("img", { name: "cerrado" })).toHaveCount(0);
  await expect(page.getByTestId("mb-closed-notice")).toHaveCount(0);

  await page.getByTestId("mb-period-prev").click();

  await expect(page.getByTestId("mb-period-label")).toHaveText(LABEL_PREV);
  await expect(barraPeriodo.getByRole("img", { name: "cerrado" })).toBeVisible();
  await expect(page.getByTestId("mb-closed-notice")).toBeVisible();
  await expect(page.getByTestId("mb-closed-notice")).toContainText(`${LABEL_PREV} está cerrado`);
});

// ═══ FR-3103 · la lista ══════════════════════════════════════════════════════════════════════════

test("TC-PMV-020h: una fila de gasto dentro del plan muestra lo gastado, «de cuánto», tono neutro y su barra", async ({ page }) => {
  // @aitri-tc TC-PMV-020h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await fila(page, "Vivienda").click();

  await expect(real(page, "Mercado")).toHaveText("600");
  await expect(plan(page, "Mercado")).toHaveText("de 1.000");
  expect(await colorDeTexto(real(page, "Mercado"))).toBe(await colorDe(page, "--fg"));
  expect(await anchoDe(barra(page, "Mercado"))).toBe("60%");
  expect(await fondoDe(barra(page, "Mercado"))).toBe(await colorDe(page, "--fg-muted"));
  // El grupo muestra su total por roll-up.
  await expect(real(page, "Vivienda")).toHaveText("1.300");
  await expect(plan(page, "Vivienda")).toHaveText("de 1.600");
  await expect(page.getByTestId("mb-section-expense").getByTestId("mb-section-total")).toHaveText("2.000 de 2.400");
});

test("TC-PMV-021h: el sobre-consumo leve y el grave llevan el glifo y el color de escritorio", async ({ page }) => {
  // @aitri-tc TC-PMV-021h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await fila(page, "Vivienda").click();
  const soft = await colorDe(page, "--alert-soft");
  const strong = await colorDe(page, "--alert-strong");
  expect(soft).not.toBe(strong);

  await expect(real(page, "Servicios")).toHaveText("› 550");
  expect(await colorDeTexto(real(page, "Servicios"))).toBe(soft);
  expect(await anchoDe(barra(page, "Servicios"))).toBe("100%");
  expect(await fondoDe(barra(page, "Servicios"))).toBe(soft);

  await expect(real(page, "Administración")).toHaveText("›› 150");
  expect(await colorDeTexto(real(page, "Administración"))).toBe(strong);
  expect(await anchoDe(barra(page, "Administración"))).toBe("100%");
  expect(await fondoDe(barra(page, "Administración"))).toBe(strong);

  // El ingreso que alcanza su plan va en el tono favorable.
  await fila(page, "Trabajo").click();
  expect(await colorDeTexto(real(page, "Salario"))).toBe(await colorDe(page, "--favorable"));
});

test("TC-PMV-022e: tocar un grupo lo despliega y volver a tocarlo lo pliega, dejando su total", async ({ page }) => {
  // @aitri-tc TC-PMV-022e
  await abrirMovil(page);
  await irAPresupuesto(page);
  const tarjeta = page.getByTestId("mb-group").filter({ has: fila(page, "Vivienda") });
  await expect(tarjeta.getByTestId("mb-row")).toHaveCount(1);
  await expect(fila(page, "Vivienda")).toHaveAttribute("aria-expanded", "false");

  await fila(page, "Vivienda").click();
  await expect(fila(page, "Vivienda")).toHaveAttribute("aria-expanded", "true");
  await expect(tarjeta.getByTestId("mb-row")).toHaveCount(4);
  await expect(tarjeta.getByTestId("mb-row-name")).toHaveText(["Vivienda", "Mercado", "Servicios", "Administración"]);

  await fila(page, "Vivienda").click();
  await expect(tarjeta.getByTestId("mb-row")).toHaveCount(1);
  await expect(real(page, "Vivienda")).toHaveText("1.300");
  await expect(plan(page, "Vivienda")).toHaveText("de 1.600");
  expect(await busqueda(page), "plegar no abre ninguna pantalla").toBe("?v=p");
});

test("TC-PMV-023f: la alcancía muestra lo aportado en el periodo, no el saldo acumulado", async ({ page }) => {
  // @aitri-tc TC-PMV-023f
  await abrirMovil(page);
  await irAPresupuesto(page);
  await fila(page, "Ahorro").click();
  // En el periodo anterior entraron 300 y en éste 500: la fila dice 500, no 800 ni 600 (800 − 200).
  await expect(real(page, "Viaje")).toHaveText("500");
  await expect(plan(page, "Viaje")).toHaveText("de 500");
  await expect(real(page, "Retiros del mes")).toHaveText("›› 200");
  await expect(plan(page, "Retiros del mes")).toHaveText("Plan —");
});

test("TC-PMV-024e: un periodo sin datos muestra todas las tarjetas con raya, no una pantalla en blanco", async ({ page }) => {
  // @aitri-tc TC-PMV-024e
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await abrirMovil(page);
  await irAPresupuesto(page);
  const conDatos = await page.getByTestId("mb-group").count();
  expect(conDatos).toBe(6);

  await page.getByTestId("mb-period-next").click();
  await page.getByTestId("mb-period-next").click();
  await expect(page.getByTestId("mb-period-label")).toHaveText("Octubre 2026");

  await expect(page.getByTestId("mb-group")).toHaveCount(conDatos);
  const muted = await colorDe(page, "--fg-muted");
  for (const celdaReal of await page.getByTestId("mb-row-actual").all()) {
    await expect(celdaReal).toHaveText("—");
    expect(await colorDeTexto(celdaReal)).toBe(muted);
  }
  for (const b of await page.getByTestId("mb-bar-fill").all()) expect(await anchoDe(b)).toBe("0%");
  expect(errores).toEqual([]);
});

// ═══ FR-3104 · mismas cifras que escritorio ══════════════════════════════════════════════════════

test("TC-PMV-030h: cada nodo muestra en el teléfono las mismas dos cifras que en la grilla, en el mismo orden", async ({ page }) => {
  // @aitri-tc TC-PMV-030h
  await abrir(page, { viewport: DESK });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await desplegarGrilla(page);
  const nombres = ["Trabajo", "Salario", "Vivienda", "Mercado", "Servicios", "Administración", "Transporte", "Estilo de vida", "Cine", "Ahorro", "Viaje"];
  const ids = [PMV.trabajo, PMV.salario, PMV.vivienda, PMV.mercado, PMV.servicios, PMV.admin, PMV.transporte, PMV.estilo, PMV.cine, PMV.ahorro, PMV.viaje];
  const grilla: Record<string, { budget: number; actual: number }> = {};
  for (let i = 0; i < ids.length; i++) {
    await expect(filaGrilla(page, nombres[i]).first()).toBeVisible();
    grilla[nombres[i]] = await cifrasGrilla(page, ids[i], nombres[i], M);
  }
  const ordenGrilla = (await page.getByTestId("node-row").getByTestId("row-label").allInnerTexts()).map((t) => t.trim());
  expect(grilla["Vivienda"]).toEqual({ budget: 1600, actual: 1300 });
  expect(grilla["Mercado"]).toEqual({ budget: 1000, actual: 600 });
  expect(grilla["Viaje"]).toEqual({ budget: 500, actual: 500 });

  await page.setViewportSize(MOBILE);
  await irAPresupuesto(page);
  await desplegarLista(page);
  for (const n of nombres) {
    expect({ budget: numero(await plan(page, n).innerText()), actual: numero(await real(page, n).innerText()) }, n)
      .toEqual(grilla[n]);
  }
  const ordenMovil = (await page.getByTestId("mb-row-name").allInnerTexts()).filter((n) => n !== "Retiros del mes");
  expect(ordenMovil).toEqual(ordenGrilla.filter((n) => nombres.includes(n)));
  expect(ordenMovil).toEqual(nombres);
});

test("TC-PMV-032e: un gasto anotado en Registrar aparece en Presupuesto en el mismo periodo", async ({ page }) => {
  // @aitri-tc TC-PMV-032e
  await abrirMovil(page);
  await page.getByTestId("amount-input").fill("50000");
  await page.getByTestId(`category-${PMV.mercado}`).click();
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("confirm-overlay")).toBeVisible();

  await irAPresupuesto(page);
  await fila(page, "Vivienda").click();
  await expect(real(page, "Mercado")).toHaveText("›› 50.600");
  await expect(page.getByTestId("mb-section-expense").getByTestId("mb-section-total")).toHaveText("52.000 de 2.400");
});

test("TC-PMV-034e: un cambio hecho en el computador llega al teléfono sin recargar", async ({ page, browser }) => {
  // @aitri-tc TC-PMV-034e
  await abrirMovil(page);
  await irAPresupuesto(page);
  await fila(page, "Vivienda").click();
  await expect(plan(page, "Mercado")).toHaveText("de 1.000");

  const ctx = await mismaCuenta(browser, DESK);
  try {
    const escritorio = await ctx.newPage();
    await fixToday(escritorio, HOY);
    await escritorio.goto("/");
    await expect(escritorio.getByTestId("budget-grid")).toBeVisible();
    await desplegarGrilla(escritorio);
    await celda(escritorio, PMV.mercado, M, "budget").click();
    await escritorio.getByLabel("Editar valor").fill("1200");
    await escritorio.getByLabel("Editar valor").press("Enter");
    await expect(celda(escritorio, PMV.mercado, M, "budget")).toContainText("1.200");

    await expect(plan(page, "Mercado")).toHaveText("de 1.200", { timeout: 10_000 });
    await expect(plan(page, "Vivienda")).toHaveText("de 1.800");
  } finally {
    await ctx.close();
  }
});

// ═══ FR-3113 · FR-010 cambia ═════════════════════════════════════════════════════════════════════

test("TC-PMV-120h: a 375 px hay registro y presupuesto, y no hay dashboard ni grilla de escritorio", async ({ page }) => {
  // @aitri-tc TC-PMV-120h
  await abrirMovil(page);
  await expect(page.getByTestId("mb-nav").getByRole("tab")).toHaveText(["Registrar", "Presupuesto"]);
  await expect(page.getByTestId("amount-input")).toBeVisible();

  await irAPresupuesto(page);
  await expect(page.getByTestId("mb-group").first()).toBeVisible();
  await fila(page, "Vivienda").click();
  for (const id of ["budget-grid", "balance-module", "cell-leaf", "cell-parent", "node-row", "detail-row", "summary-strip"]) {
    await expect(page.getByTestId(id), id).toHaveCount(0);
  }
  await expect(page.getByRole("tab", { name: "Dashboard" })).toHaveCount(0);
  await expect(page.locator(".lx-desktop")).toHaveCount(0);
});

test("TC-PMV-121e: el límite sigue en 760 px: 760 es el teléfono y 761 el computador", async ({ page }) => {
  // @aitri-tc TC-PMV-121e
  await abrir(page, { viewport: { width: 760, height: 900 } });
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await expect(page.getByTestId("mb-nav")).toBeVisible();
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);

  await page.setViewportSize({ width: 761, height: 900 });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("mobile-shell")).toHaveCount(0);
  await expect(page.getByTestId("mb-nav")).toHaveCount(0);
});

test("TC-PMV-122f: antes de visitar Presupuesto, la página del registro es la de siempre", async ({ page }) => {
  // @aitri-tc TC-PMV-122f
  await abrirMovil(page);
  await expect(page.getByTestId("amount-input")).toBeVisible();
  // Ni oculto: el presupuesto no existe en el DOM hasta la primera visita.
  await expect(page.getByTestId("mb-budget")).toHaveCount(0);
  await expect(page.locator('[data-testid^="mb-"]:not([data-testid="mb-nav"])')).toHaveCount(0);
  expect(await page.getByTestId("mobile-shell").locator(".eyebrow").count()).toBe(0);
  await expect(page.getByTestId("page-title")).toHaveCount(1);
  await expect(page.getByTestId("page-title")).toHaveText("Nuevo movimiento");
  await expect(page.locator("h1")).toHaveCount(1);
});

test("TC-PMV-123e: a 1440 px la app es la de escritorio, también con los parámetros del teléfono en la URL", async ({ page }) => {
  // @aitri-tc TC-PMV-123e
  for (const r of ["/", "/?v=p&d=balance"]) {
    await abrir(page, { viewport: DESK, ruta: r });
    await expect(page.getByTestId("budget-grid"), r).toBeVisible();
    await expect(page.getByTestId("balance-module"), r).toBeVisible();
    await expect(page.locator('[data-testid^="mb-"]'), r).toHaveCount(0);
    await expect(page.getByTestId("mobile-shell"), r).toHaveCount(0);
  }
});

// ═══ NFR-3101 · el registro queda igual ══════════════════════════════════════════════════════════

test("TC-PMV-150h: Registrar sigue anotando un gasto igual que antes", async ({ page }) => {
  // @aitri-tc TC-PMV-150h
  await abrirMovil(page);
  await page.getByTestId("amount-input").fill("50000");
  await page.getByTestId(`category-${PMV.mercado}`).click();
  await page.getByTestId("save-button").click();

  const overlay = page.getByTestId("confirm-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(fmt(50000));
  await expect(overlay).toBeHidden({ timeout: 5000 });
  await expect(page.getByTestId("amount-input")).toHaveValue("");
  await expect.poll(async () => (await readLedger(page))?.actuals[PMV.mercado]?.[M]).toBe(50_600);
});

test("TC-PMV-151e: tras visitar Presupuesto, Registrar sigue anotando y solo hay un formulario activo", async ({ page }) => {
  // @aitri-tc TC-PMV-151e
  await abrirMovil(page);
  await irAPresupuesto(page);
  await tab(page, "Registrar").click();
  await expect(page.getByTestId("page-title")).toBeVisible();

  await page.getByTestId("type-transfer").click();
  await page.getByTestId("amount-input").fill("100");
  await page.getByTestId("de-@disponible").click();
  await page.getByTestId(`a-${PMV.viaje}`).click();
  await expect(page.locator('[data-testid="save-button"]:visible')).toHaveCount(1);
  await expect(page.locator('[data-testid="amount-input"]:visible')).toHaveCount(1);
  await page.getByTestId("save-button").click();

  await expect(page.getByTestId("confirm-overlay")).toBeVisible();
  await expect.poll(async () => (await readLedger(page))?.actuals[PMV.viaje]?.[M]).toBe(600);
});

// ═══ NFR-3102 · Configuración, tema y salir ══════════════════════════════════════════════════════

test("TC-PMV-153h: Configuración se abre desde Registrar y desde Presupuesto", async ({ page }) => {
  // @aitri-tc TC-PMV-153h
  await abrirMovil(page);
  await page.getByTestId("config-link").click();
  await expect(page).toHaveURL(/\/configuracion$/);
  await expect(page.getByLabel("Saldo inicial")).toBeVisible();

  await page.getByTestId("config-back").click();
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await irAPresupuesto(page);
  await page.getByTestId("config-link").click();
  await expect(page).toHaveURL(/\/configuracion$/);
  await expect(page.getByLabel("Saldo inicial")).toBeVisible();
});

test("TC-PMV-154e: el tema se cambia desde Presupuesto", async ({ page }) => {
  // @aitri-tc TC-PMV-154e
  await page.emulateMedia({ colorScheme: "light" });
  await abrirMovil(page);
  await irAPresupuesto(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  const claro = await fondoDe(page.locator("body"));

  await page.getByTestId("theme-toggle").click();

  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  expect(await fondoDe(page.locator("body"))).toBe("rgb(19, 19, 22)");
  expect(await fondoDe(page.locator("body"))).not.toBe(claro);
  await expect(page.getByTestId("mb-budget")).toBeVisible();
});

test("TC-PMV-155f: salir desde una pantalla de detalle cierra la sesión", async ({ browser }) => {
  // @aitri-tc TC-PMV-155f
  // Sesión PROPIA: cerrar la del worker dejaría sin acceso a las pruebas siguientes.
  const ctx = await browser.newContext({ baseURL: E2E_BASE, viewport: MOBILE, storageState: { cookies: [], origins: [] } });
  try {
    const page = await ctx.newPage();
    await page.goto("/");
    await page.getByTestId("auth-email").fill(e2eEmail(test.info().parallelIndex));
    await page.getByTestId("auth-password").fill(E2E_PASSWORD);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("mobile-shell")).toBeVisible();
    await irAPresupuesto(page);
    await page.locator('[data-testid="mb-row"][aria-expanded="false"]').first().click();
    await page.locator('[data-testid="mb-row"][data-leaf="true"]').first().click();
    await expect(page.getByTestId("mb-leaf")).toBeVisible();

    await page.getByTestId("logout").click();

    await expect(page.getByTestId("auth-form")).toBeVisible();
    await expect(page.getByTestId("mb-budget")).toHaveCount(0);
    await expect(page.getByTestId("mb-leaf")).toHaveCount(0);
    await expect(page.getByTestId("mobile-shell")).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

// ═══ NFR-3104 · el límite de 760 px ══════════════════════════════════════════════════════════════

test("TC-PMV-159h: a 760 px se monta el teléfono", async ({ page }) => {
  // @aitri-tc TC-PMV-159h
  await abrir(page, { viewport: { width: 760, height: 900 } });
  await expect(page.getByTestId("mobile-shell")).toHaveCount(1);
  await expect(page.locator(".lx-desktop")).toHaveCount(0);
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);
  await irAPresupuesto(page);
  await expect(page.getByTestId("mb-period-label")).toHaveText(LABEL_M);
});

test("TC-PMV-160e: cruzar el límite con la app abierta en modo Año pasa al teléfono con un periodo válido", async ({ page }) => {
  // @aitri-tc TC-PMV-160e
  await abrir(page, { viewport: { width: 761, height: 900 } });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await page.getByTestId("period-pill").getByRole("tab", { name: "Año" }).click();
  await expect(page.getByRole("combobox", { name: "Mes" })).toHaveCount(0);

  await page.setViewportSize({ width: 760, height: 900 });

  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await irAPresupuesto(page);
  await expect(page.getByTestId("mb-period-label")).toHaveText(LABEL_M);
  await expect(page.getByTestId("mb-group")).toHaveCount(6);
});

test("TC-PMV-161f: a 761 px no se monta el teléfono, ni con sus parámetros en la URL", async ({ page }) => {
  // @aitri-tc TC-PMV-161f
  await abrir(page, { viewport: { width: 761, height: 900 }, ruta: "/?v=p" });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("mobile-shell")).toHaveCount(0);
  await expect(page.getByTestId("mb-budget")).toHaveCount(0);
  await expect(page.getByTestId("mb-nav")).toHaveCount(0);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Pantallas de detalle: categoría, edición, alcancías, retiros, Balance y resumen
// ═════════════════════════════════════════════════════════════════════════════════════════════════

const NEXT = "2026-09";
const LABEL_NEXT = "Septiembre 2026";

/** Abre la pantalla de una hoja desde la lista (desplegando antes su grupo, si lo tiene). */
async function abrirHoja(page: Page, grupo: string | null, hoja: string): Promise<void> {
  if (grupo && (await fila(page, grupo).getAttribute("aria-expanded")) === "false") await fila(page, grupo).click();
  await fila(page, hoja).click();
  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await expect(page.getByTestId("mb-title")).toHaveText(hoja);
}
const tarjeta = (page: Page, plano: "budget" | "actual") => page.getByTestId(`mb-amount-card-${plano}`);
const valor = (page: Page, plano: "budget" | "actual") => tarjeta(page, plano).getByTestId("mb-amount-value");

/** Cambia la cifra de una tarjeta y pulsa Guardar (no espera que el cambio se acepte). */
async function cambiar(page: Page, plano: "budget" | "actual", texto: string): Promise<void> {
  await tarjeta(page, plano).getByTestId("mb-amount-change").click();
  await tarjeta(page, plano).getByRole("textbox").fill(texto);
  await tarjeta(page, plano).getByTestId("mb-amount-save").click();
}
const movimiento = (page: Page, id: string) => page.locator(`[data-testid="mb-mov-row"][data-movement-id="${id}"]`);
const movimientos = (page: Page) => page.locator('[data-testid="mb-mov-row"][data-kind="movement"], [data-testid="mb-mov-row"][data-kind="adjustment"]');

async function editar(page: Page, id: string): Promise<void> {
  await movimiento(page, id).getByTestId("mb-mov-edit").click();
  await expect(page.getByTestId("mb-edit-form")).toBeVisible();
}
/** Elige un día en el calendario del formulario de edición. */
async function fijarFechaEdicion(page: Page, iso: string): Promise<void> {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  await page.getByTestId("mb-edit-date").getByTestId("date-field").click();
  const pop = page.getByTestId("date-popover");
  await expect(pop.locator("select.rdp-years_dropdown")).toBeVisible();
  await pop.locator("select.rdp-years_dropdown").selectOption(String(y));
  await pop.locator("select.rdp-months_dropdown").selectOption(String(m - 1));
  await pop.locator(`[data-day="${iso}"]:not([data-outside]) button`).click();
  await expect(pop).toHaveCount(0);
}

/** Abre el Balance completo desde el resumen. */
async function abrirBalance(page: Page): Promise<void> {
  if ((await page.getByTestId("mb-summary-toggle").getAttribute("aria-expanded")) === "false") await page.getByTestId("mb-summary-toggle").click();
  await page.getByTestId("mb-summary-balance").click();
  await expect(page.getByTestId("mb-balance")).toBeVisible();
}
const filaBalance = (page: Page, clave: string) => page.locator(`[data-testid="mb-balance-row"][data-row="${clave}"]`);
const balReal = (page: Page, clave: string) => filaBalance(page, clave).getByTestId("mb-balance-actual");
const balPlan = (page: Page, clave: string) => filaBalance(page, clave).getByTestId("mb-balance-budget");
const volverALista = async (page: Page) => {
  await page.getByTestId("mb-back").click();
  await expect(page.getByTestId("mb-budget")).toBeVisible();
};

/** Toca el ojo del resumen: los saldos quedan a la vista 10 segundos. */
async function verSaldos(page: Page): Promise<void> {
  await page.getByTestId("mb-summary-eye").click();
  await expect(page.getByTestId("mb-summary-eye")).toHaveAttribute("aria-pressed", "true");
}
const textoResumen = (page: Page) => page.getByTestId("mb-summary").innerText();

/** El libro de ejemplo con cambios: nodos, celdas o movimientos extra. */
function conCambios(mut: (s: PmvSeed) => void): PmvSeed {
  const s = pmvBase(M, PREV);
  mut(s);
  return s;
}
const gasto = (id: string, target: string, amount: number, day: string, extra: Record<string, unknown> = {}) => ({
  id, ownerId: "local", type: "expense" as const, catId: target, subId: null, target, amount,
  period: M, createdAt: 500 + amount, date: `${M}-${day}T12:00`, ...extra,
}) as PmvSeed["movements"][number];

// ═══ FR-3105 · cambiar lo planeado ═══════════════════════════════════════════════════════════════

test("TC-PMV-040h: cambiar lo planeado de Mercado sube el roll-up y persiste tras recargar", async ({ page }) => {
  // @aitri-tc TC-PMV-040h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Vivienda", "Mercado");
  await expect(valor(page, "budget")).toHaveText("1.000");

  await cambiar(page, "budget", "1200");

  await expect(valor(page, "budget")).toHaveText("1.200");
  await expect(tarjeta(page, "budget").getByTestId("mb-amount-edit")).toHaveCount(0);
  await volverALista(page);
  await expect(plan(page, "Mercado")).toHaveText("de 1.200");
  await expect(plan(page, "Vivienda")).toHaveText("de 1.800");
  await expect(page.getByTestId("mb-section-expense").getByTestId("mb-section-total")).toHaveText("2.000 de 2.600");

  await expect.poll(async () => (await readLedger(page))?.budgets[PMV.mercado]?.[M]).toBe(1200);
  await page.reload();
  await expect(page.getByTestId("mb-budget")).toBeVisible();
  await fila(page, "Vivienda").click();
  await expect(plan(page, "Mercado")).toHaveText("de 1.200");
});

// ═══ FR-3106 · los movimientos de una categoría ══════════════════════════════════════════════════

test("TC-PMV-050h: Mercado muestra sus tres gastos con día, nota y monto, y suman lo ejecutado", async ({ page }) => {
  // @aitri-tc TC-PMV-050h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Vivienda", "Mercado");

  await expect(movimientos(page)).toHaveCount(3);
  await expect(movimientos(page).getByTestId("mb-mov-date")).toHaveText(["5 ago", "12 ago", "20 ago"]);
  await expect(movimientos(page).getByTestId("mb-mov-note")).toHaveText(["Plaza", "Supermercado", "Sin nota"]);
  await expect(movimientos(page).getByTestId("mb-mov-amount")).toHaveText(["300", "200", "100"]);
  await expect(movimientos(page).getByTestId("mb-mov-edit")).toHaveCount(3);
  const suma = (await movimientos(page).getByTestId("mb-mov-amount").allInnerTexts()).reduce((a, t) => a + numero(t), 0);
  expect(suma).toBe(600);
  await expect(valor(page, "actual")).toHaveText("600");
  await expect(valor(page, "budget")).toHaveText("1.000");
  await expect(page.getByText("Gastos · Vivienda · Agosto 2026")).toBeVisible();
});

test("TC-PMV-051e: una categoría sin movimientos muestra su guía y lleva a Registrar", async ({ page }) => {
  // @aitri-tc TC-PMV-051e
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Estilo de vida", "Cine");

  await expect(page.getByTestId("mb-mov-row")).toHaveCount(0);
  await expect(page.getByTestId("mb-mov-empty")).toContainText("Sin movimientos en Agosto 2026");
  await expect(page.getByTestId("mb-mov-empty")).toContainText("Los gastos se anotan desde Registrar");
  await expect(valor(page, "actual")).toHaveText("—");

  await page.getByTestId("mb-go-register").click();
  await expect(page.getByTestId("page-title")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveText("Nuevo movimiento");
  await expect(page.getByTestId("amount-input")).toBeVisible();
});

test("TC-PMV-052f: la alcancía muestra lo aportado, sin lápiz para editar ni borrar", async ({ page }) => {
  // @aitri-tc TC-PMV-052f
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Ahorro", "Viaje");

  await expect(page.getByTestId("mb-mov-row").first()).toBeVisible();
  await expect(page.getByTestId("mb-mov-row").getByTestId("mb-mov-amount").first()).toHaveText("500");
  await expect(page.getByTestId("mb-mov-edit")).toHaveCount(0);
  await expect(page.getByText("Reservas · Ahorro · Agosto 2026")).toBeVisible();
  // Lo que sí ofrece la alcancía es cambiar el aporte, en los dos planos.
  await expect(tarjeta(page, "budget").getByTestId("mb-amount-change")).toBeVisible();
  await expect(tarjeta(page, "actual").getByTestId("mb-amount-change")).toBeVisible();
});

test("TC-PMV-053f: tocar la cifra ejecutada de un grupo no abre ninguna lista", async ({ page }) => {
  // @aitri-tc TC-PMV-053f
  await abrirMovil(page);
  await irAPresupuesto(page);

  await real(page, "Vivienda").click();

  await expect(fila(page, "Mercado")).toBeVisible();
  await expect(page.getByTestId("mb-leaf")).toHaveCount(0);
  await expect(page.getByTestId("mb-mov-row")).toHaveCount(0);
  expect(await busqueda(page)).toBe("?v=p");
});

// ═══ FR-3107 · editar un movimiento ══════════════════════════════════════════════════════════════

test("TC-PMV-060h: editar el monto de un gasto actualiza la categoría y el Balance", async ({ page }) => {
  // @aitri-tc TC-PMV-060h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Vivienda", "Mercado");
  await editar(page, "mv-plaza");
  await expect(page.getByTestId("mb-edit-save")).toHaveText("Guardar cambios");
  await expect(page.getByTestId("mb-edit-save")).toBeDisabled();

  await page.getByTestId("mb-edit-amount").fill("250");
  await expect(page.getByTestId("mb-edit-save")).toBeEnabled();
  await page.getByTestId("mb-edit-save").click();

  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await expect(page.getByTestId("toast")).toContainText("Movimiento actualizado");
  await expect(valor(page, "actual")).toHaveText("550");
  await expect(movimiento(page, "mv-plaza").getByTestId("mb-mov-amount")).toHaveText("250");

  await volverALista(page);
  await abrirBalance(page);
  await expect(balReal(page, "expense")).toHaveText("1.950");
  await expect(balReal(page, "available")).toHaveText("5.600");
  await expect.poll(async () => (await readLedger(page))?.actuals[PMV.mercado]?.[M]).toBe(550);
});

test("TC-PMV-061e: cambiar la fecha a otro mes avisa antes de guardar y mueve el gasto después", async ({ page }) => {
  // @aitri-tc TC-PMV-061e
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Vivienda", "Mercado");
  await editar(page, "mv-super");
  await expect(page.getByTestId("mb-edit-moves")).toHaveCount(0);

  await fijarFechaEdicion(page, `${NEXT}-03`);

  await expect(page.getByTestId("mb-edit-moves")).toHaveText(`Pasará a ${LABEL_NEXT}`);
  // Aún no se guardó: el gasto sigue en su mes.
  expect((await readLedger(page))?.actuals[PMV.mercado]?.[M]).toBe(600);
  await page.getByTestId("mb-edit-save").click();

  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await expect(valor(page, "actual")).toHaveText("400");
  await expect(movimientos(page)).toHaveCount(2);
  await volverALista(page);
  await page.getByTestId("mb-period-next").click();
  await expect(page.getByTestId("mb-period-label")).toHaveText(LABEL_NEXT);
  await expect(real(page, "Mercado")).toHaveText("›› 200");
});

test("TC-PMV-064e: poner el monto en cero convierte guardar en borrar", async ({ page }) => {
  // @aitri-tc TC-PMV-064e
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Vivienda", "Mercado");
  await editar(page, "mv-sin-nota");

  await page.getByTestId("mb-edit-amount").fill("0");

  await expect(page.getByTestId("mb-edit-save")).toHaveText("Borrar movimiento");
  await expect(page.getByTestId("mb-edit-save")).toBeEnabled();
  await expect(page.getByTestId("mb-edit-delete")).toHaveCount(0);
  await page.getByTestId("mb-edit-save").click();

  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await expect(page.getByTestId("toast")).toContainText("Movimiento borrado");
  await expect(valor(page, "actual")).toHaveText("500");
  await expect(movimientos(page)).toHaveCount(2);
  await expect(movimiento(page, "mv-sin-nota")).toHaveCount(0);
});

test("TC-PMV-068e: un ajuste negativo se abre con su signo y se puede editar", async ({ page }) => {
  // @aitri-tc TC-PMV-068e
  const seed = conCambios((s) => {
    s.actuals[PMV.servicios] = { [M]: 510 };
    s.movements.push(gasto("mv-ajuste", PMV.servicios, -40, "09", { kind: "adjustment" }));
  });
  await abrirMovil(page, { seed });
  await irAPresupuesto(page);
  await abrirHoja(page, "Vivienda", "Servicios");
  await expect(valor(page, "actual")).toHaveText("› 510");
  await expect(movimiento(page, "mv-ajuste").getByTestId("mb-mov-amount")).toHaveText("−40");
  await editar(page, "mv-ajuste");

  await expect(page.getByTestId("mb-edit-amount")).toHaveValue("−$40");
  await expect(page.getByTestId("mb-edit-type")).toContainText("Ajuste");
  // El teclado numérico del teléfono no trae «−»: el signo se cambia con el botón, ida y vuelta.
  await page.getByTestId("mb-edit-sign").click();
  await expect(page.getByTestId("mb-edit-amount")).toHaveValue("$40");
  await page.getByTestId("mb-edit-sign").click();
  await expect(page.getByTestId("mb-edit-amount")).toHaveValue("−$40");
  // Y con teclado, un «−» tecleado al final (donde está el cursor) alterna el signo en vez de dar error.
  await page.getByTestId("mb-edit-amount").press("End");
  await page.getByTestId("mb-edit-amount").pressSequentially("-");
  await expect(page.getByTestId("mb-edit-amount")).toHaveValue("$40");
  await expect(page.getByTestId("mb-edit-form").getByRole("alert")).toHaveCount(0);
  await page.getByTestId("mb-edit-amount").fill("-60");
  await expect(page.getByTestId("mb-edit-amount")).toHaveValue("−$60");
  await page.getByTestId("mb-edit-save").click();

  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await expect(valor(page, "actual")).toHaveText("490");
  await expect(movimiento(page, "mv-ajuste").getByTestId("mb-mov-amount")).toHaveText("−60");
});

// ═══ FR-3108 · borrar un movimiento ══════════════════════════════════════════════════════════════

test("TC-PMV-070h: borrar un gasto con confirmación lo quita y persiste", async ({ page }) => {
  // @aitri-tc TC-PMV-070h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Vivienda", "Mercado");
  await editar(page, "mv-super");

  await page.getByTestId("mb-edit-delete").click();
  await expect(page.getByTestId("mb-confirm-delete")).toContainText("¿Borrar este gasto de $200 del 12 ago?");
  await page.getByTestId("mb-confirm-yes").click();

  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await expect(page.getByTestId("toast")).toContainText("Movimiento borrado");
  await expect(valor(page, "actual")).toHaveText("400");
  await expect(movimientos(page)).toHaveCount(2);

  await expect.poll(async () => (await readLedger(page))?.movements.some((m) => m.id === "mv-super")).toBe(false);
  await page.reload();
  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await expect(movimientos(page)).toHaveCount(2);
  await expect(valor(page, "actual")).toHaveText("400");
});

// ═══ FR-3109 · lo aportado a una alcancía ════════════════════════════════════════════════════════

test("TC-PMV-080h: cambiar lo aportado a Viaje baja el disponible y sube lo reservado", async ({ page }) => {
  // @aitri-tc TC-PMV-080h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Ahorro", "Viaje");
  await expect(valor(page, "actual")).toHaveText("500");

  await cambiar(page, "actual", "700");

  await expect(valor(page, "actual")).toHaveText("700");
  await volverALista(page);
  await expect(real(page, "Viaje")).toHaveText("700");
  await abrirBalance(page);
  await expect(balReal(page, "available")).toHaveText("5.350");
  await expect(balReal(page, "reservedBalance")).toHaveText("800");
  await expect(balReal(page, "toReserves")).toHaveText("700");
});

test("TC-PMV-081f: un aporte por encima del máximo se rechaza con el texto de escritorio", async ({ page }) => {
  // @aitri-tc TC-PMV-081f
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Ahorro", "Viaje");
  await tarjeta(page, "actual").getByTestId("mb-amount-change").click();
  const maximo = numero(await tarjeta(page, "actual").getByTestId("mb-amount-hint").innerText());
  expect(maximo).toBeGreaterThan(500);

  await tarjeta(page, "actual").getByRole("textbox").fill(String(maximo + 1));
  await tarjeta(page, "actual").getByTestId("mb-amount-save").click();

  await expect(tarjeta(page, "actual").getByTestId("mb-amount-error")).toHaveText(`Esta celda admite hasta $${fmt(maximo)} este mes`);
  await expect(tarjeta(page, "actual").getByRole("textbox")).toHaveValue(String(maximo + 1));
  expect((await readLedger(page))?.actuals[PMV.viaje]?.[M]).toBe(500);

  // El máximo exacto sí entra: el límite es el mismo número que se le mostró.
  await tarjeta(page, "actual").getByRole("textbox").fill(String(maximo));
  await tarjeta(page, "actual").getByTestId("mb-amount-save").click();
  await expect(valor(page, "actual")).toHaveText(fmt(maximo));
});

// ═══ FR-3110 · retiros del mes ═══════════════════════════════════════════════════════════════════

async function abrirRetiros(page: Page): Promise<void> {
  await fila(page, "Retiros del mes").click();
  await expect(page.getByTestId("mb-retiros")).toBeVisible();
}

test("TC-PMV-090h: la pantalla de retiros lista la operación con sus dos extremos, su nota y su monto", async ({ page }) => {
  // @aitri-tc TC-PMV-090h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirRetiros(page);

  await expect(page.getByTestId("mb-retiro-row")).toHaveCount(1);
  await expect(page.getByTestId("mb-retiro-ends")).toHaveText("Viaje → Disponible");
  await expect(page.getByTestId("mb-retiro-row")).toContainText("Tiquetes");
  await expect(page.getByTestId("mb-retiro-amount")).toHaveText("200");
  await expect(valor(page, "actual")).toHaveText("›› 200");
  await expect(valor(page, "budget")).toHaveText("—");
  await expect(page.getByTestId("mb-retiros")).toContainText("Para sacar de una alcancía, usa Registrar → Reserva.");
  expect(await busqueda(page)).toBe("?v=p&d=retiros");
});

test("TC-PMV-091h: corregir un retiro baja la cifra y el disponible", async ({ page }) => {
  // @aitri-tc TC-PMV-091h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirRetiros(page);

  await page.getByTestId("mb-retiro-edit").click();
  await page.getByTestId("mb-retiro-editing").getByRole("textbox").fill("150");
  await page.getByTestId("mb-retiro-save").click();

  await expect(page.getByTestId("mb-retiro-amount")).toHaveText("150");
  await expect(valor(page, "actual")).toHaveText("›› 150");
  await expect(page.getByTestId("toast")).toContainText("Retiro corregido");
  await volverALista(page);
  await abrirBalance(page);
  await expect(balReal(page, "available")).toHaveText("5.500");
  await expect(balReal(page, "toWithdrawals")).toHaveText("150");
});

test("TC-PMV-092e: corregir un retiro a cero lo elimina y las cifras vuelven a como estaban", async ({ page }) => {
  // @aitri-tc TC-PMV-092e
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirRetiros(page);

  await page.getByTestId("mb-retiro-edit").click();
  await page.getByTestId("mb-retiro-editing").getByRole("textbox").fill("0");
  await page.getByTestId("mb-retiro-save").click();

  await expect(page.getByTestId("mb-retiro-row")).toHaveCount(0);
  await expect(page.getByTestId("mb-retiros-empty")).toContainText("Sin operaciones este mes");
  await expect(valor(page, "actual")).toHaveText("—");
  await volverALista(page);
  await abrirBalance(page);
  await expect(balReal(page, "available")).toHaveText("5.350");
  await expect(balReal(page, "reservedBalance")).toHaveText("800");
});

// ═══ FR-3111 · el Balance ════════════════════════════════════════════════════════════════════════

test("TC-PMV-100h: el Balance muestra los tres bloques y sus diez filas con cifras reales y de plan", async ({ page }) => {
  // @aitri-tc TC-PMV-100h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirBalance(page);

  await expect(page.getByTestId("mb-balance-block").locator("h2")).toHaveText(["El mes", "Lo disponible", "El cierre"]);
  await expect(page.getByTestId("mb-balance-row")).toHaveCount(10);
  await expect(page.getByTestId("mb-balance-label")).toHaveText([
    "Ingresos", "Gastos", "Resultado del mes", "Saldo del mes anterior", "Resultado del mes",
    "Reservas del mes", "Retiros de reservas", "Saldo disponible", "Saldo reservado", "Saldo total",
  ]);
  await expect(balReal(page, "income")).toHaveText("5.000");
  await expect(balPlan(page, "income")).toHaveText("Plan 5.000");
  await expect(balReal(page, "expense")).toHaveText("2.000");
  await expect(balPlan(page, "expense")).toHaveText("Plan 2.400");
  await expect(balReal(page, "monthResult")).toHaveText("3.000");
  await expect(balPlan(page, "monthResult")).toHaveText("Plan 2.600");
  await expect(balReal(page, "toWithdrawals")).toHaveText("200");
  await expect(balPlan(page, "toWithdrawals")).toHaveText("Plan —");
  expect(await busqueda(page)).toBe("?v=p&d=balance");
});

test("TC-PMV-102f: un saldo disponible negativo va en alerta; un resultado negativo, no", async ({ page }) => {
  // @aitri-tc TC-PMV-102f
  const seed = conCambios((s) => {
    s.actuals[PMV.transporte] = { [M]: 9700 };
    s.movements.push(gasto("mv-grande", PMV.transporte, 9000, "11"));
  });
  await abrirMovil(page, { seed });
  await irAPresupuesto(page);
  await abrirBalance(page);
  const alerta = await colorDe(page, "--alert-strong");

  await expect(balReal(page, "available")).toHaveText("−3.450");
  expect(await colorDeTexto(balReal(page, "available"))).toBe(alerta);
  await expect(balReal(page, "total")).toHaveText("−2.850");
  expect(await colorDeTexto(balReal(page, "total"))).toBe(alerta);
  // «Resultado del mes» no es una fila de alarma: en pérdida se pinta en neutro, como en escritorio.
  await expect(balReal(page, "monthResult")).toHaveText("−6.000");
  expect(await colorDeTexto(balReal(page, "monthResult"))).toBe(await colorDe(page, "--fg"));
  expect(await colorDeTexto(balReal(page, "income"))).toBe(await colorDe(page, "--fg-secondary"));
});

test("TC-PMV-031h: cada fila del Balance coincide con el módulo de escritorio, en lo real y en el plan", async ({ page }) => {
  // @aitri-tc TC-PMV-031h
  await abrir(page, { viewport: DESK });
  await expect(page.getByTestId("balance-module")).toBeVisible();
  const meses = await page.locator("[data-month-head]").evaluateAll((els) => els.map((e) => e.getAttribute("data-month-head")));
  const i = meses.indexOf(M);
  expect(i).toBeGreaterThanOrEqual(0);
  const claves = ["income", "expense", "monthResult", "prevAvailable", "monthResultCarry", "toReserves", "toWithdrawals", "available", "reservedBalance", "total"];
  const escritorio: Record<string, { budget: number; actual: number }> = {};
  for (const k of claves) {
    const celdas = page.locator(`[data-testid="balance-row"][data-row="${k}"]`).getByTestId("balance-cell");
    escritorio[k] = { budget: numero(await celdas.nth(i * 2).innerText()), actual: numero(await celdas.nth(i * 2 + 1).innerText()) };
  }
  expect(escritorio.available).toEqual({ budget: 4900, actual: 5550 });
  expect(escritorio.reservedBalance).toEqual({ budget: 800, actual: 600 });
  expect(escritorio.total).toEqual({ budget: 5700, actual: 6150 });

  await page.setViewportSize(MOBILE);
  await irAPresupuesto(page);
  await abrirBalance(page);
  for (const k of claves) {
    expect({ budget: numero(await balPlan(page, k).innerText()), actual: numero(await balReal(page, k).innerText()) }, k).toEqual(escritorio[k]);
  }
});

// ═══ FR-3115 · el resumen protegido ══════════════════════════════════════════════════════════════

test("TC-PMV-140h: el resumen abre plegado y sin un solo dígito", async ({ page }) => {
  // @aitri-tc TC-PMV-140h
  await abrirMovil(page);
  await irAPresupuesto(page);
  const resumen = page.getByTestId("mb-summary");

  await expect(resumen).toHaveAttribute("data-open", "false");
  await expect(resumen).toContainText("Saldo disponible");
  await expect(page.getByTestId("mb-saldo-disponible")).toHaveText("$ ••••••");
  expect(await textoResumen(page)).not.toMatch(/[0-9]/);
  expect(await resumen.evaluate((el) => el.innerHTML)).not.toMatch(/5\.?550|4\.?900/);
  for (const id of ["mb-saldo-resultado", "mb-saldo-reservado", "mb-saldo-total", "mb-summary-balance"]) {
    await expect(page.getByTestId(id), id).toHaveCount(0);
  }
  expect((await resumen.boundingBox())!.height).toBeLessThanOrEqual(72);
});

test("TC-PMV-141h: un toque en el ojo muestra el saldo, y a los 10 segundos se oculta solo", async ({ page }) => {
  // @aitri-tc TC-PMV-141h
  test.setTimeout(90_000);
  await abrirMovil(page);
  await irAPresupuesto(page);
  const saldo = page.getByTestId("mb-saldo-disponible");
  const ojo = page.getByTestId("mb-summary-eye");
  await expect(ojo).toHaveAttribute("aria-pressed", "false");

  await ojo.click();
  const tocado = Date.now();
  // Se ve sin mantener el dedo: el ratón ya soltó.
  await page.waitForTimeout(1000);
  await expect(saldo).toHaveText("5.550");
  await expect(ojo).toHaveAttribute("aria-pressed", "true");

  // A los 9 segundos sigue a la vista…
  await page.waitForTimeout(Math.max(0, 9000 - (Date.now() - tocado)));
  await expect(saldo).toHaveText("5.550");
  // …y a los 11 ya se ocultó solo.
  await page.waitForTimeout(Math.max(0, 11_000 - (Date.now() - tocado)));
  await expect(saldo).toHaveText("$ ••••••");
  await expect(ojo).toHaveAttribute("aria-pressed", "false");
  expect(await textoResumen(page)).not.toMatch(/[0-9]/);
});

test("TC-PMV-142h: la flecha despliega los cuatro saldos con su plan y el enlace al Balance", async ({ page }) => {
  // @aitri-tc TC-PMV-142h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await page.getByTestId("mb-summary-toggle").click();
  await expect(page.getByTestId("mb-summary")).toHaveAttribute("data-open", "true");
  expect(await textoResumen(page), "desplegado sigue oculto").not.toMatch(/[0-9]/);

  await verSaldos(page);
  await expect(page.getByTestId("mb-saldo-disponible")).toHaveText("5.550");
  await expect(page.getByTestId("mb-plan-disponible")).toHaveText("4.900");
  await expect(page.getByTestId("mb-saldo-resultado")).toHaveText("3.000");
  await expect(page.getByTestId("mb-plan-resultado")).toHaveText("2.600");
  await expect(page.getByTestId("mb-saldo-reservado")).toHaveText("600");
  await expect(page.getByTestId("mb-plan-reservado")).toHaveText("800");
  await expect(page.getByTestId("mb-saldo-total")).toHaveText("6.150");
  await expect(page.getByTestId("mb-plan-total")).toHaveText("5.700");

  await page.getByTestId("mb-summary-balance").click();
  await expect(page.getByTestId("mb-balance")).toBeVisible();
  await volverALista(page);
  // Sigue como el usuario lo dejó mientras la app está abierta: desplegado.
  await expect(page.getByTestId("mb-summary")).toHaveAttribute("data-open", "true");
  await page.getByTestId("mb-summary-toggle").click();
  await expect(page.getByTestId("mb-summary")).toHaveAttribute("data-open", "false");
  await expect(page.locator('[data-testid^="mb-saldo-"]')).toHaveCount(1);
});

test("TC-PMV-143f: un segundo toque en el ojo oculta de inmediato, sin esperar los 10 segundos", async ({ page }) => {
  // @aitri-tc TC-PMV-143f
  test.setTimeout(90_000);
  await abrirMovil(page);
  await irAPresupuesto(page);
  const saldo = page.getByTestId("mb-saldo-disponible");
  await verSaldos(page);
  await expect(saldo).toHaveText("5.550");
  await page.waitForTimeout(2000);
  await expect(saldo).toHaveText("5.550");

  await page.getByTestId("mb-summary-eye").click();

  await expect(saldo).toHaveText("$ ••••••", { timeout: 200 });
  await expect(page.getByTestId("mb-summary-eye")).toHaveAttribute("aria-pressed", "false");
  expect(await textoResumen(page)).not.toMatch(/[0-9]/);
  // El temporizador del primer toque quedó cancelado: pasado su plazo no hace nada raro, y un toque
  // nuevo cuenta sus propios 10 segundos (a los 9 del nuevo toque sigue a la vista).
  await verSaldos(page);
  await page.waitForTimeout(9000);
  await expect(saldo).toHaveText("5.550");
});

test("TC-PMV-144e: los valores se ocultan si la página pierde el foco o pasa a segundo plano", async ({ page }) => {
  // @aitri-tc TC-PMV-144e
  await abrirMovil(page);
  await irAPresupuesto(page);
  const saldo = page.getByTestId("mb-saldo-disponible");
  const eventos: [string, () => Promise<void>][] = [
    ["blur de ventana", () => page.evaluate(() => { window.dispatchEvent(new Event("blur")); })],
    ["segundo plano", () => page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    })],
  ];
  for (const [nombre, interrumpir] of eventos) {
    await verSaldos(page);
    await expect(saldo, nombre).toHaveText("5.550");
    await interrumpir();
    await expect(saldo, nombre).toHaveText("$ ••••••", { timeout: 500 });
    await expect(page.getByTestId("mb-summary-eye"), nombre).toHaveAttribute("aria-pressed", "false");
    expect(await textoResumen(page), nombre).not.toMatch(/[0-9]/);
  }
  // Un «visibilitychange» que vuelve a visible no oculta: solo esconde irse, no volver.
  await verSaldos(page);
  await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await expect(saldo).toHaveText("5.550");
});

test("TC-PMV-145e: con teclado, Espacio o Enter sobre el ojo muestran, y pulsados de nuevo ocultan", async ({ page }) => {
  // @aitri-tc TC-PMV-145e
  await abrirMovil(page);
  await irAPresupuesto(page);
  const ojo = page.getByTestId("mb-summary-eye");
  const saldo = page.getByTestId("mb-saldo-disponible");
  await expect(ojo).toHaveAttribute("aria-label", "Ver los saldos durante 10 segundos");

  for (const tecla of ["Space", "Enter"]) {
    await ojo.focus();
    await page.keyboard.press(tecla);
    await expect(saldo, tecla).toHaveText("5.550");
    await expect(ojo, tecla).toHaveAttribute("aria-label", "Ocultar los saldos");
    await page.keyboard.press(tecla);
    await expect(saldo, tecla).toHaveText("$ ••••••");
    await expect(ojo, tecla).toHaveAttribute("aria-label", "Ver los saldos durante 10 segundos");
  }
  // Otra tecla no revela nada.
  await page.keyboard.press("KeyA");
  await expect(saldo).toHaveText("$ ••••••");
});

test("TC-PMV-146f: la protección no esconde las categorías ni el Balance completo", async ({ page }) => {
  // @aitri-tc TC-PMV-146f
  await abrirMovil(page);
  await irAPresupuesto(page);
  await expect(page.getByTestId("mb-saldo-disponible")).toHaveText("$ ••••••");

  await fila(page, "Vivienda").click();
  await expect(real(page, "Mercado")).toHaveText("600");
  await expect(plan(page, "Mercado")).toHaveText("de 1.000");
  await expect(page.getByTestId("mb-section-expense").getByTestId("mb-section-total")).toHaveText("2.000 de 2.400");

  await abrirBalance(page);
  await expect(balReal(page, "available")).toHaveText("5.550");
  await expect(balReal(page, "total")).toHaveText("6.150");
});

test("TC-PMV-147e: al reabrir la app el resumen vuelve plegado y oculto", async ({ page }) => {
  // @aitri-tc TC-PMV-147e
  await abrirMovil(page);
  await irAPresupuesto(page);
  await page.getByTestId("mb-summary-toggle").click();
  await expect(page.getByTestId("mb-summary")).toHaveAttribute("data-open", "true");

  await page.reload();
  await expect(page.getByTestId("mb-budget")).toBeVisible();

  await expect(page.getByTestId("mb-summary")).toHaveAttribute("data-open", "false");
  await expect(page.locator('[data-testid^="mb-saldo-"]')).toHaveCount(1);
  expect(await textoResumen(page)).not.toMatch(/[0-9]/);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Periodo cerrado, layout y que el computador siga igual
// ═════════════════════════════════════════════════════════════════════════════════════════════════

// ═══ FR-3112 · periodo cerrado ═══════════════════════════════════════════════════════════════════

test("TC-PMV-110h: en un periodo cerrado se ven los movimientos, sin acciones y con el aviso", async ({ page }) => {
  // @aitri-tc TC-PMV-110h
  await abrirMovil(page, { cerrarPrev: true });
  await irAPresupuesto(page);
  await page.getByTestId("mb-period-prev").click();
  await expect(page.getByTestId("mb-closed-notice")).toBeVisible();
  await abrirHoja(page, "Vivienda", "Mercado");

  await expect(movimientos(page)).toHaveCount(1);
  await expect(movimientos(page).getByTestId("mb-mov-note")).toHaveText("Supermercado");
  await expect(movimientos(page).getByTestId("mb-mov-amount")).toHaveText("850");
  await expect(page.getByTestId("mb-mov-edit")).toHaveCount(0);
  await expect(page.getByTestId("mb-amount-change")).toHaveCount(0);
  await expect(valor(page, "budget")).toHaveText("900");
  await expect(valor(page, "actual")).toHaveText("850");
  await expect(page.getByTestId("mb-closed-notice")).toBeVisible();
  await expect(page.getByTestId("mb-closed-notice")).toContainText("reábrelo desde el cierre de mes en el computador");
});

test("TC-PMV-114e: si el periodo se cierra desde otro dispositivo con el editor abierto, el editor se cierra", async ({ page, browser }) => {
  // @aitri-tc TC-PMV-114e
  // «Hoy» en septiembre: así agosto (M) ya terminó y se puede cerrar.
  const hoy = `${NEXT}-05`;
  await fixToday(page, hoy);
  await page.setViewportSize(MOBILE);
  await seedLedger(page, pmvBase(M, PREV));
  expect(await closeViaApi(page), "cerrar julio").toBe(200);
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await irAPresupuesto(page);
  await page.getByTestId("mb-period-prev").click();
  await expect(page.getByTestId("mb-period-label")).toHaveText(LABEL_M);
  await abrirHoja(page, "Vivienda", "Mercado");
  await editar(page, "mv-plaza");
  await page.getByTestId("mb-edit-amount").fill("250");

  const ctx = await mismaCuenta(browser, DESK);
  try {
    const otro = await ctx.newPage();
    await fixToday(otro, hoy);
    expect(await closeViaApi(otro), "cerrar agosto desde el otro dispositivo").toBe(200);

    await expect(page.getByTestId("mb-edit-form")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId("mb-leaf")).toBeVisible();
    await expect(page.getByTestId("mb-closed-notice")).toBeVisible();
    await expect(page.getByTestId("mb-mov-edit")).toHaveCount(0);
    await expect(movimiento(page, "mv-plaza").getByTestId("mb-mov-amount")).toHaveText("300");
    expect((await readLedger(page))?.movements.find((m) => m.id === "mv-plaza")?.amount).toBe(300);
  } finally {
    await ctx.close();
  }
});

// ═══ FR-3114 · cabe en el teléfono y se toca con el dedo ═════════════════════════════════════════

/** Recorre las seis pantallas de la vista y llama a `medir` en cada una. */
async function recorrerPantallas(page: Page, medir: (pantalla: string) => Promise<void>): Promise<void> {
  await irAPresupuesto(page);
  await desplegarLista(page);
  await page.getByTestId("mb-summary-toggle").click();
  await medir("lista");
  await abrirHoja(page, null, "Mercado");
  await medir("categoría");
  await editar(page, "mv-super");
  await medir("editar");
  await page.getByTestId("mb-edit-delete").click();
  await medir("confirmar borrado");
  await page.getByTestId("mb-back").click();
  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await tarjeta(page, "budget").getByTestId("mb-amount-change").click();
  await medir("cambiar lo planeado");
  await volverALista(page);
  await abrirHoja(page, null, "Viaje");
  await medir("alcancía");
  await volverALista(page);
  await abrirRetiros(page);
  await page.getByTestId("mb-retiro-edit").click();
  await medir("retiros");
  await volverALista(page);
  await abrirBalance(page);
  await medir("balance");
}
const desborde = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("TC-PMV-130h: ninguna pantalla desborda a lo ancho, ni a 375 ni a 360 px", async ({ page }) => {
  // @aitri-tc TC-PMV-130h
  for (const viewport of [MOBILE, { width: 360, height: 740 }]) {
    await abrirMovil(page, { viewport });
    const medidas: string[] = [];
    await recorrerPantallas(page, async (pantalla) => {
      expect(await desborde(page), `${pantalla} a ${viewport.width} px`).toBe(0);
      medidas.push(pantalla);
    });
    expect(medidas).toEqual(["lista", "categoría", "editar", "confirmar borrado", "cambiar lo planeado", "alcancía", "retiros", "balance"]);
  }
});

test("TC-PMV-131e: una cifra de nueve dígitos se ve completa en todas las pantallas", async ({ page }) => {
  // @aitri-tc TC-PMV-131e
  const GRANDE = 999_999_999;
  const seed = conCambios((s) => {
    s.budgets[PMV.mercado] = { ...s.budgets[PMV.mercado], [M]: GRANDE };
    s.actuals[PMV.mercado] = { ...s.actuals[PMV.mercado], [M]: GRANDE };
    s.budgets[PMV.salario] = { ...s.budgets[PMV.salario], [M]: GRANDE };
    s.actuals[PMV.salario] = { ...s.actuals[PMV.salario], [M]: GRANDE };
    s.movements = s.movements.filter((m) => !["mv-plaza", "mv-super", "mv-sin-nota", "mv-salario"].includes(m.id));
    s.movements.push(gasto("mv-grande", PMV.mercado, GRANDE, "06", { note: "Compra" }));
    s.movements.push({ ...gasto("mv-salario-grande", PMV.salario, GRANDE, "01"), type: "income" });
  });
  await abrirMovil(page, { seed });
  const CIFRAS = '[data-testid="mb-row-actual"], [data-testid="mb-row-budget"], [data-testid="mb-section-total"], [data-testid="mb-amount-value"], [data-testid^="mb-saldo-"], [data-testid^="mb-plan-"], [data-testid="mb-balance-actual"], [data-testid="mb-balance-budget"], [data-testid="mb-mov-amount"]';
  /** Cada cifra visible cabe en su caja y dentro de la pantalla; devuelve cuántas llevan nueve dígitos. */
  const medir = async (pantalla: string): Promise<number> => {
    const r = await page.locator(CIFRAS).evaluateAll((els) => els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          texto: el.textContent ?? "", cortada: el.scrollWidth > el.clientWidth + 1,
          fuera: box.left < 0 || box.right > document.documentElement.clientWidth + 0.5,
        };
      }));
    expect(r.filter((c) => c.cortada).map((c) => c.texto), `${pantalla}: cifras cortadas`).toEqual([]);
    expect(r.filter((c) => c.fuera).map((c) => c.texto), `${pantalla}: cifras fuera de la pantalla`).toEqual([]);
    expect(r.some((c) => c.texto.includes("…")), `${pantalla}: puntos suspensivos en una cifra`).toBe(false);
    expect(await desborde(page), `${pantalla}: desborde de página`).toBe(0);
    return r.filter((c) => /\d{3}\.\d{3}\.\d{3}/.test(c.texto)).length;
  };

  await irAPresupuesto(page);
  await desplegarLista(page);
  await page.getByTestId("mb-summary-toggle").click();
  await verSaldos(page);
  await expect(page.getByTestId("mb-saldo-resultado")).toContainText(".");
  expect(await medir("lista con el resumen a la vista")).toBeGreaterThanOrEqual(8);
  await expect(real(page, "Mercado")).toHaveText("999.999.999");
  await expect(plan(page, "Mercado")).toHaveText("de 999.999.999");

  await abrirHoja(page, null, "Mercado");
  await expect(valor(page, "budget")).toHaveText("999.999.999");
  await expect(valor(page, "actual")).toHaveText("999.999.999");
  expect(await medir("categoría")).toBeGreaterThanOrEqual(3);
  await editar(page, "mv-grande");
  await expect(page.getByTestId("mb-edit-amount")).toHaveValue("$999.999.999");
  const campo = await page.getByTestId("mb-edit-amount").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(campo.sw, "el monto del formulario cabe en su campo").toBeLessThanOrEqual(campo.cw + 1);
  expect(await desborde(page)).toBe(0);
  await page.getByTestId("mb-back").click();
  await volverALista(page);

  await abrirBalance(page);
  await expect(balReal(page, "income")).toHaveText("999.999.999");
  expect(await medir("balance")).toBeGreaterThanOrEqual(4);
});

test("TC-PMV-132f: todo control tocable de la vista mide al menos 40 × 40", async ({ page }) => {
  // @aitri-tc TC-PMV-132f
  await abrirMovil(page);
  const MINIMO = 40;
  let medidos = 0;
  await recorrerPantallas(page, async (pantalla) => {
    const chicos = await page.locator('[data-testid="mb-nav"], [data-testid="mb-budget"], [data-testid="mb-leaf"], [data-testid="mb-edit-form"], [data-testid="mb-retiros"], [data-testid="mb-balance"]')
      .locator('button, a, [role="tab"], [role="button"], [role="combobox"]')
      .evaluateAll((els) => els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const b = el.getBoundingClientRect();
          return { quien: el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName, w: Math.round(b.width), h: Math.round(b.height) };
        }));
    medidos += chicos.length;
    expect(chicos.filter((c) => Math.min(c.w, c.h) < MINIMO), `${pantalla}: controles de menos de ${MINIMO} px`).toEqual([]);
  });
  expect(medidos, "la prueba midió controles de verdad").toBeGreaterThan(40);
});

/** Ratio de contraste WCAG entre dos colores «rgb(r, g, b)». */
function contraste(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Color del texto y el primer fondo no transparente que tiene detrás. */
const coloresDe = (loc: Locator) => loc.evaluate((el) => {
  let nodo: Element | null = el;
  let fondo = "rgb(255, 255, 255)";
  while (nodo) {
    const bg = getComputedStyle(nodo).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) { fondo = bg; break; }
    nodo = nodo.parentElement;
  }
  return { texto: getComputedStyle(el).color, fondo };
});

test("TC-PMV-133h: las cifras cumplen contraste 4,5:1 en tema claro y en oscuro", async ({ page }) => {
  // @aitri-tc TC-PMV-133h
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await abrirMovil(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(scheme === "dark");
    await irAPresupuesto(page);
    await desplegarLista(page);
    await page.getByTestId("mb-summary-toggle").click();

    const medir = async (nombre: string, loc: Locator) => {
      const c = await coloresDe(loc);
      expect(contraste(c.texto, c.fondo), `${scheme} · ${nombre} · ${c.texto} sobre ${c.fondo}`).toBeGreaterThanOrEqual(4.5);
    };
    await medir("neutro (Mercado)", real(page, "Mercado"));
    await medir("alerta leve (Servicios)", real(page, "Servicios"));
    await medir("alerta grave (Administración)", real(page, "Administración"));
    await medir("favorable (Salario)", real(page, "Salario"));
    await medir("vacío (Cine)", real(page, "Cine"));
    await medir("«de cuánto» (Mercado)", plan(page, "Mercado"));
    await medir("total de sección", page.getByTestId("mb-section-expense").getByTestId("mb-section-total"));
    await medir("nombre de fila", fila(page, "Mercado").getByTestId("mb-row-name"));

    await verSaldos(page);
    await expect(page.getByTestId("mb-saldo-disponible")).toHaveText("5.550");
    await medir("saldo del resumen", page.getByTestId("mb-saldo-disponible"));
    await medir("saldo secundario del resumen", page.getByTestId("mb-saldo-total"));
  }
});

test("TC-PMV-134e: un nombre largo se trunca con puntos y no empuja las cifras", async ({ page }) => {
  // @aitri-tc TC-PMV-134e
  const LARGO = "Mantenimiento preventivo del vehículo familiar grande";
  const seed = conCambios((s) => {
    s.nodes.push({ id: "c-largo", ownerId: "local", type: "expense", level: "category", parentId: PMV.vivienda, name: LARGO, icon: null, order: 9 });
    s.budgets["c-largo"] = { [M]: 250_000_000 };
    s.actuals["c-largo"] = { [M]: 123_456_789 };
    s.movements.push(gasto("mv-largo", "c-largo", 123_456_789, "07"));
  });
  await abrirMovil(page, { seed, viewport: { width: 360, height: 740 } });
  await irAPresupuesto(page);
  await fila(page, "Vivienda").click();

  const nombre = fila(page, LARGO).getByTestId("mb-row-name");
  const n = await nombre.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, overflow: getComputedStyle(el).textOverflow, ws: getComputedStyle(el).whiteSpace }));
  expect(n.overflow).toBe("ellipsis");
  expect(n.ws).toBe("nowrap");
  expect(n.sw, "el nombre no cabe y por eso se trunca").toBeGreaterThan(n.cw);

  const cifra = real(page, LARGO);
  await expect(cifra).toHaveText("123.456.789");
  const c = await cifra.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, right: el.getBoundingClientRect().right }));
  expect(c.sw).toBeLessThanOrEqual(c.cw + 1);
  expect(c.right).toBeLessThanOrEqual(360);
  expect(await desborde(page)).toBe(0);
  // En su pantalla, el nombre completo no rompe el encabezado.
  await fila(page, LARGO).click();
  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  expect(await desborde(page)).toBe(0);
});

// ═══ NFR-3103 · el computador sigue igual ════════════════════════════════════════════════════════

test("TC-PMV-156h: en el computador, la grilla edita lo planeado de una hoja como antes", async ({ page }) => {
  // @aitri-tc TC-PMV-156h
  await abrir(page, { viewport: DESK });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await desplegarGrilla(page);

  await celda(page, PMV.mercado, M, "budget").click();
  await page.getByLabel("Editar valor").fill("1200");
  await page.getByLabel("Editar valor").press("Enter");

  await expect(celda(page, PMV.mercado, M, "budget")).toContainText("1.200");
  expect((await cifrasGrilla(page, PMV.vivienda, "Vivienda", M)).budget).toBe(1800);
  await expect.poll(async () => (await readLedger(page))?.budgets[PMV.mercado]?.[M]).toBe(1200);
  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await desplegarGrilla(page);
  await expect(celda(page, PMV.mercado, M, "budget")).toContainText("1.200");
});

test("TC-PMV-157e: en el computador, el Detalle edita un movimiento como antes", async ({ page }) => {
  // @aitri-tc TC-PMV-157e
  await abrir(page, { viewport: DESK });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await desplegarGrilla(page);
  await celda(page, PMV.mercado, M, "actual").click();
  const filaDetalle = page.locator('[data-testid="detail-row"][data-kind="movement"]').filter({ hasText: "Plaza" });
  await expect(filaDetalle).toBeVisible();

  await filaDetalle.hover();
  await filaDetalle.getByRole("button", { name: "Editar movimiento" }).click();
  const editor = page.getByTestId("movement-editor");
  await expect(editor.getByTestId("edit-save")).toHaveText("Guardar");
  await expect(editor.getByTestId("edit-save")).toBeEnabled();
  await editor.getByLabel("Monto").fill("250");
  await editor.getByLabel("Monto").press("Enter");

  await expect(page.getByTestId("movement-editor")).toHaveCount(0);
  await expect(page.locator('[data-testid="detail-row"][data-kind="movement"]').filter({ hasText: "Plaza" }).getByTestId("detail-amount")).toHaveText("250");
  await expect.poll(async () => (await readLedger(page))?.actuals[PMV.mercado]?.[M]).toBe(550);
  await page.keyboard.press("Escape");
  await expect(celda(page, PMV.mercado, M, "actual")).toContainText("550");
});

test("TC-PMV-158f: el computador no monta nada del teléfono, ni en Resumen ni en Dashboard", async ({ page }) => {
  // @aitri-tc TC-PMV-158f
  await abrir(page, { viewport: DESK });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.locator('[data-testid^="mb-"]')).toHaveCount(0);
  await expect(page.getByTestId("mobile-shell")).toHaveCount(0);

  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await expect(page.locator('[data-testid^="mb-"]')).toHaveCount(0);
  await expect(page.getByTestId("mobile-shell")).toHaveCount(0);
});

// ═══ NFR-3105 · las mismas reglas en los dos lados ═══════════════════════════════════════════════

/** El máximo que la celda Ejec. de Viaje admite en M, leído del indicador del teléfono. */
async function maximoMovil(page: Page): Promise<number> {
  await tarjeta(page, "actual").getByTestId("mb-amount-change").click();
  return numero(await tarjeta(page, "actual").getByTestId("mb-amount-hint").innerText());
}
async function escribirEnGrilla(page: Page, texto: string): Promise<void> {
  await celda(page, PMV.viaje, M, "actual").click();
  await page.getByLabel("Editar valor").fill(texto);
  await page.getByLabel("Editar valor").press("Enter");
}

test("TC-PMV-162h: el máximo que el teléfono muestra se acepta en el computador y en el teléfono", async ({ page }) => {
  // @aitri-tc TC-PMV-162h
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Ahorro", "Viaje");
  const maximo = await maximoMovil(page);
  expect(maximo).toBeGreaterThan(500);

  await page.setViewportSize(DESK);
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await desplegarGrilla(page);
  await expect(page.getByTestId("reserve-max")).toHaveCount(0);
  await celda(page, PMV.viaje, M, "actual").click();
  expect(numero(await page.getByTestId("reserve-max").innerText()), "los dos lados muestran el mismo máximo").toBe(maximo);
  await page.getByLabel("Editar valor").fill(String(maximo));
  await page.getByLabel("Editar valor").press("Enter");
  await expect(page.getByTestId("reserve-block")).toHaveCount(0);
  await expect.poll(async () => (await readLedger(page))?.actuals[PMV.viaje]?.[M]).toBe(maximo);
  await escribirEnGrilla(page, "500");
  await expect.poll(async () => (await readLedger(page))?.actuals[PMV.viaje]?.[M]).toBe(500);

  await page.setViewportSize(MOBILE);
  await expect(page.getByTestId("mb-leaf")).toBeVisible();
  await tarjeta(page, "actual").getByTestId("mb-amount-change").click();
  await tarjeta(page, "actual").getByRole("textbox").fill(String(maximo));
  await tarjeta(page, "actual").getByTestId("mb-amount-save").click();
  await expect(valor(page, "actual")).toHaveText(fmt(maximo));
  await expect.poll(async () => (await readLedger(page))?.actuals[PMV.viaje]?.[M]).toBe(maximo);
});

test("TC-PMV-163f: un peso por encima del máximo se rechaza en los dos lados con el mismo texto", async ({ page }) => {
  // @aitri-tc TC-PMV-163f
  await abrirMovil(page);
  await irAPresupuesto(page);
  await abrirHoja(page, "Ahorro", "Viaje");
  const maximo = await maximoMovil(page);
  await tarjeta(page, "actual").getByRole("textbox").fill(String(maximo + 1));
  await tarjeta(page, "actual").getByTestId("mb-amount-save").click();
  const textoMovil = await tarjeta(page, "actual").getByTestId("mb-amount-error").innerText();
  expect(textoMovil).toBe(`Esta celda admite hasta $${fmt(maximo)} este mes`);
  expect((await readLedger(page))?.actuals[PMV.viaje]?.[M]).toBe(500);

  await page.setViewportSize(DESK);
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await desplegarGrilla(page);
  await celda(page, PMV.viaje, M, "actual").click();
  await page.getByLabel("Editar valor").fill(String(maximo + 1));
  await page.getByLabel("Editar valor").press("Enter");

  await expect(page.getByTestId("reserve-block")).toBeVisible();
  expect((await page.getByTestId("reserve-block").innerText()).trim()).toBe(textoMovil);
  expect((await readLedger(page))?.actuals[PMV.viaje]?.[M]).toBe(500);
});

// ═══ NFR-3106 · el Balance de escritorio pinta lo mismo ══════════════════════════════════════════

test("TC-PMV-167f: el Balance del computador sigue pintando un disponible negativo en alerta, y solo eso", async ({ page }) => {
  // @aitri-tc TC-PMV-167f
  const seed = conCambios((s) => {
    s.actuals[PMV.transporte] = { [M]: 9700 };
    s.movements.push(gasto("mv-grande", PMV.transporte, 9000, "11"));
  });
  await abrir(page, { viewport: DESK, seed });
  await expect(page.getByTestId("balance-module")).toBeVisible();
  const meses = await page.locator("[data-month-head]").evaluateAll((els) => els.map((e) => e.getAttribute("data-month-head")));
  const i = meses.indexOf(M);
  expect(i).toBeGreaterThanOrEqual(0);
  const celdaBal = (clave: string) => page.locator(`[data-testid="balance-row"][data-row="${clave}"]`).getByTestId("balance-cell").nth(i * 2 + 1);
  const alerta = await colorDe(page, "--alert-strong");

  await expect(celdaBal("available")).toContainText("3.450");
  expect(await colorDeTexto(celdaBal("available"))).toBe(alerta);
  await expect(celdaBal("total")).toContainText("2.850");
  expect(await colorDeTexto(celdaBal("total"))).toBe(alerta);
  await expect(celdaBal("monthResult")).toContainText("6.000");
  expect(await colorDeTexto(celdaBal("monthResult"))).toBe(await colorDe(page, "--fg"));
  expect(await colorDeTexto(celdaBal("income"))).toBe(await colorDe(page, "--fg-secondary"));
  // Un cero de resultado se pinta «0», no el guion: la regla mudada sigue aplicándose.
  const futuro = meses.length - 1;
  await expect(page.locator('[data-testid="balance-row"][data-row="monthResult"]').getByTestId("balance-cell").nth(futuro * 2 + 1)).toHaveText("0");
});
