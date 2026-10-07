import { test, expect, type Page, type Locator } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import { closeViaApi, fixToday } from "./helpers/cycles";
import { descuadrarCelda } from "./helpers/descuadre";
import { e2eEmail } from "./helpers/globalSetup";
import { GMV, GMV_LARGO, NOMBRE_LARGO, gmvBase, gmvLargo, gmvVacio, type GmvSeed } from "../fixtures/gmv-base";

// Feature gestion-movil — lo que solo el NAVEGADOR puede afirmar: que desde el teléfono se llega a
// gestionar la estructura y a cerrar el mes, que el «atrás» del navegador deshace pantalla por
// pantalla, que todo cabe y se toca con el dedo, y que lo hecho en el teléfono está en escritorio.
// Prefijo TC-GMV-*.
//
// Las reglas de cada pantalla viven en tests/integration/gestion-movil-pantallas.test.ts; aquí, el
// recorrido completo. «Hoy» se fija con `fixToday`, así que el mes en curso es siempre M.

const MOBILE = { width: 375, height: 812 };
const SMALL = { width: 360, height: 740 };
const DESK = { width: 1440, height: 900 };
const HOY = "2026-08-25";
const M = "2026-08";
const PREV = "2026-07";
const LABEL_M = "Agosto 2026";
const LABEL_PREV = "Julio 2026";

interface AbrirOpts {
  viewport?: { width: number; height: number };
  seed?: GmvSeed;
  ruta?: string;
  /** Cuántos meses cerrar por la API antes de abrir: 1 cierra PREV; 2, PREV y M. */
  cerrar?: number;
}

/** Siembra el libro de ejemplo con «hoy» fijo y abre la app. */
async function abrir(page: Page, opts: AbrirOpts = {}): Promise<void> {
  await fixToday(page, HOY);
  await page.setViewportSize(opts.viewport ?? MOBILE);
  await seedLedger(page, opts.seed ?? gmvBase(M, PREV));
  for (let i = 0; i < (opts.cerrar ?? 0); i++) expect(await closeViaApi(page), `cierre ${i + 1}`).toBe(200);
  await page.goto(opts.ruta ?? "/");
}

/** Abre el teléfono ya en la vista de presupuesto. */
async function abrirPresupuesto(page: Page, opts: AbrirOpts = {}): Promise<void> {
  await abrir(page, opts);
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await page.getByTestId("mb-nav").getByRole("tab", { name: "Presupuesto" }).click();
  await expect(page.getByTestId("mb-budget")).toBeVisible();
}

const titulo = (page: Page) => page.getByTestId("mb-title");
const busqueda = (page: Page) => page.evaluate(() => window.location.search);
/** La fila de la lista del periodo con ese nombre exacto. */
const fila = (page: Page, nombre: string): Locator =>
  page.getByTestId("mb-row").filter({ has: page.getByTestId("mb-row-name").getByText(nombre, { exact: true }) });
/** La fila de Organizar con ese nombre exacto. */
const filaOrg = (page: Page, nombre: string): Locator =>
  page.getByTestId("mb-org-row").filter({ has: page.getByTestId("mb-org-row-name").getByText(nombre, { exact: true }) });

async function irAOrganizar(page: Page): Promise<void> {
  await page.getByTestId("mb-open-organize").click();
  await expect(page.getByTestId("mb-organize")).toBeVisible();
}

// ═══ FR-3201 · llegar a las acciones de un elemento ══════════════════════════════════════════════

test("TC-GMV-001h: la pantalla de Mercado lista sus cinco acciones", async ({ page }) => {
  // @aitri-tc TC-GMV-001h
  await abrirPresupuesto(page);
  await irAOrganizar(page);
  await filaOrg(page, "Mercado").click();

  await expect(titulo(page)).toHaveText("Mercado");
  await expect(page.getByTestId("mb-node")).toContainText("Gastos · Comida");
  const acciones = page.getByTestId("mb-node").locator('[data-testid^="mb-node-"][data-testid$="rename"], [data-testid="mb-node-icon"], [data-testid="mb-node-add"], [data-testid="mb-node-move"], [data-testid="mb-node-delete"]');
  await expect(acciones).toHaveText(["Renombrar", "Cambiar ícono", "Añadir subcategoría", "Mover a…", "Borrar"]);
  // Cada acción se deja tocar con el dedo.
  for (const alto of await acciones.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
    expect(alto).toBeGreaterThanOrEqual(40);
  }
});

test("TC-GMV-002h: tocar una hoja en la lista sigue abriendo su detalle", async ({ page }) => {
  // @aitri-tc TC-GMV-002h
  await abrirPresupuesto(page);
  await fila(page, "Comida").click();
  await fila(page, "Mercado").click();

  expect(await busqueda(page)).toContain("d=leaf");
  await expect(titulo(page)).toHaveText("Mercado");
  await expect(page.getByTestId("mb-amount-card-budget").getByTestId("mb-amount-value")).toHaveText("800");
  await expect(page.getByTestId("mb-amount-card-actual").getByTestId("mb-amount-value")).toHaveText("100");
  // Es el detalle de siempre, no la gestión.
  await expect(page.getByTestId("mb-node-actions")).toHaveCount(0);
});

test("TC-GMV-008e: el «atrás» del navegador deshace pantalla por pantalla", async ({ page }) => {
  // @aitri-tc TC-GMV-008e
  await abrirPresupuesto(page);
  // Una marca en la página: si algo recargara, desaparecería.
  await page.evaluate(() => { (window as unknown as { __gmv: number }).__gmv = 1; });
  // Los grupos desplegados dan alto para desplazar la lista. El desplazamiento es corto a propósito:
  // «Organizar» está en la línea del título y tiene que seguir a la vista para poder tocarlo (con uno
  // largo, el propio clic de la prueba subiría la página y ya no habría posición que recuperar).
  for (const g of ["Comida", "Ocio", "Viajes"]) await fila(page, g).click();
  await page.evaluate(() => window.scrollTo(0, 30));
  const antes = await page.evaluate(() => window.scrollY);
  expect(antes).toBe(30);

  await irAOrganizar(page);
  await filaOrg(page, "Mercado").click();
  await expect(titulo(page)).toHaveText("Mercado");

  await page.goBack();
  await expect(titulo(page)).toHaveText("Organizar categorías");
  await page.goBack();
  await expect(titulo(page)).toHaveText("Presupuesto");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(antes);
  expect(await page.evaluate(() => (window as unknown as { __gmv?: number }).__gmv)).toBe(1);
});

test("TC-GMV-010e: sección sin grupos: guía y entrada para crear", async ({ page }) => {
  // @aitri-tc TC-GMV-010e
  await abrirPresupuesto(page, { seed: gmvVacio(M, PREV) });
  const ingresos = page.getByTestId("mb-section-income");
  await expect(ingresos.getByTestId("mb-section-empty")).toContainText("Aún no hay categorías.");
  await expect(ingresos.getByTestId("mb-section-empty")).not.toContainText("computador");

  await ingresos.getByTestId("mb-section-empty-link").click();
  expect(await busqueda(page)).toBe("?v=p&d=org");
  const orgIngresos = page.getByTestId("mb-org-section-income");
  await expect(orgIngresos.getByTestId("mb-org-empty")).toHaveText("Aún no hay grupos");
  await expect(orgIngresos.getByTestId("mb-org-add-group")).toBeVisible();
  // Las otras secciones sí tienen sus grupos: el vacío es de Ingresos, no de la pantalla.
  await expect(page.getByTestId("mb-org-section-expense").getByTestId("mb-org-group")).not.toHaveCount(0);
});

// ── Ayudas de las pantallas de gestión ──────────────────────────────────────────────────────────
const toast = (page: Page) => page.getByTestId("toast");
const sinDesborde = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
/** Abre la pantalla de un elemento desde Organizar. */
async function irAElemento(page: Page, nombre: string): Promise<void> {
  await irAOrganizar(page);
  await filaOrg(page, nombre).click();
  await expect(page.getByTestId("mb-node")).toBeVisible();
}
/** Los nodos tal como los tiene guardados el servidor. */
async function nodosGuardados(page: Page): Promise<{ id: string; name: string; level: string; type: string; parentId: string | null; icon: string | null }[]> {
  const res = await page.request.get("/api/v1/ledger");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { state: { nodes: { id: string; name: string; level: string; type: string; parentId: string | null; icon: string | null }[] } }).state.nodes;
}
/** La fila de un nodo en la grilla de escritorio. */
const filaGrilla = (page: Page, nombre: string) =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: nombre }) });
/** Despliega en la grilla todos los nodos plegados, hasta que no quede ninguno. */
async function desplegarGrilla(page: Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const botones = page.getByTestId("budget-grid").locator('button[aria-label="Expandir"][aria-expanded="false"]');
    if ((await botones.count()) === 0) return;
    await botones.first().click();
  }
}

// ═══ FR-3202 · crear ═════════════════════════════════════════════════════════════════════════════

test("TC-GMV-020h: crear un grupo en Gastos", async ({ page }) => {
  // @aitri-tc TC-GMV-020h
  await abrirPresupuesto(page);
  await irAOrganizar(page);
  const antes = (await nodosGuardados(page)).length;

  await page.getByTestId("mb-org-section-expense").getByTestId("mb-org-add-group").click();
  await expect(titulo(page)).toHaveText("Nuevo grupo");
  await expect(page.getByTestId("mb-new-node")).toContainText("en Gastos");
  await page.getByTestId("mb-new-name").fill("Hogar");
  await page.getByTestId("mb-new-create").click();

  await expect(titulo(page)).toHaveText("Organizar categorías");
  await expect(toast(page)).toContainText("Grupo creado");
  const grupos = page.getByTestId("mb-org-section-expense").getByTestId("mb-org-group");
  await expect(grupos.last().getByTestId("mb-org-row-name").first()).toHaveText("Hogar");

  // Y quedó guardado como un grupo de Gasto, uno solo.
  await expect.poll(async () => (await nodosGuardados(page)).length).toBe(antes + 1);
  const hogar = (await nodosGuardados(page)).filter((n) => n.name === "Hogar");
  expect(hogar).toHaveLength(1);
  expect(hogar[0]).toMatchObject({ level: "group", type: "expense", parentId: null });
});

// ═══ FR-3203 · renombrar ═════════════════════════════════════════════════════════════════════════

test("TC-GMV-030h: renombrar Mercado a Supermercado", async ({ page }) => {
  // @aitri-tc TC-GMV-030h
  await abrirPresupuesto(page);
  await irAElemento(page, "Mercado");
  await page.getByTestId("mb-node-rename").click();
  await page.getByTestId("mb-node-name-input").fill("Supermercado");
  await page.getByTestId("mb-node-name-save").click();

  await expect(titulo(page)).toHaveText("Supermercado");
  await expect(toast(page)).toContainText("Nombre actualizado");
  await expect(page.getByTestId("mb-node-name")).toHaveText("Supermercado");

  // En la lista del periodo…
  await page.goBack();
  await page.goBack();
  await expect(titulo(page)).toHaveText("Presupuesto");
  await fila(page, "Comida").click();
  await expect(fila(page, "Supermercado")).toHaveCount(1);
  await expect(fila(page, "Mercado")).toHaveCount(0);

  // …y en Registrar, como destino de un gasto.
  await page.getByTestId("mb-nav").getByRole("tab", { name: "Registrar" }).click();
  await expect(page.getByTestId(`category-${GMV.mercado}`)).toHaveText(/Supermercado/);
});

// ═══ FR-3204 · ícono ═════════════════════════════════════════════════════════════════════════════

test("TC-GMV-040h: elegir un ícono buscándolo", async ({ page }) => {
  // @aitri-tc TC-GMV-040h
  await abrirPresupuesto(page);
  await irAElemento(page, "Mercado");
  await expect(page.getByTestId("mb-node-identity")).toHaveAttribute("data-icon", "coffee");

  await page.getByTestId("mb-node-icon").click();
  await page.getByTestId("mb-icon-search").fill("pizz");
  const opciones = page.getByTestId("mb-icon-option");
  await expect(opciones).toHaveCount(1);
  await opciones.first().click();

  await expect(page.getByTestId("mb-icon-grid")).toHaveCount(0);
  await expect(page.getByTestId("mb-node-identity")).toHaveAttribute("data-icon", "pizza");
  await expect(page.getByTestId("mb-node-identity").locator("svg.lucide-pizza")).toBeVisible();
  await expect.poll(async () => (await nodosGuardados(page)).find((n) => n.id === GMV.mercado)?.icon).toBe("pizza");

  await page.goBack();
  await expect(filaOrg(page, "Mercado")).toHaveAttribute("data-icon", "pizza");
  await expect(filaOrg(page, "Mercado").locator("svg.lucide-pizza")).toBeVisible();
});

test("TC-GMV-043h: mismo catálogo que escritorio, en celdas tocables", async ({ page }) => {
  // @aitri-tc TC-GMV-043h
  let enMovil = 0;
  for (const viewport of [MOBILE, SMALL]) {
    await abrirPresupuesto(page, { viewport });
    await irAElemento(page, "Mercado");
    await page.getByTestId("mb-node-icon").click();
    const opciones = page.getByTestId("mb-icon-option");
    enMovil = await opciones.count();
    expect(enMovil, `catálogo a ${viewport.width}`).toBeGreaterThanOrEqual(40);
    for (const caja of await opciones.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }))) {
      expect(Math.min(...caja), `celda a ${viewport.width}`).toBeGreaterThanOrEqual(40);
    }
    expect(await sinDesborde(page), `sin desborde a ${viewport.width}`).toBe(true);
    await expect(page.locator('[data-testid="mb-icon-option"][aria-pressed="true"]')).toHaveAttribute("data-icon", "coffee");
  }

  // El popover de escritorio ofrece exactamente los mismos.
  await abrir(page, { viewport: DESK });
  await desplegarGrilla(page);
  await filaGrilla(page, "Mercado").first().locator('button[aria-label="Cambiar ícono"]').click();
  await expect(page.getByTestId("icon-option")).toHaveCount(enMovil);
});

test("TC-GMV-044e: el ícono elegido en el teléfono se ve en escritorio", async ({ page }) => {
  // @aitri-tc TC-GMV-044e
  await abrirPresupuesto(page);
  await irAElemento(page, "Mercado");
  await page.getByTestId("mb-node-icon").click();
  await page.locator('[data-testid="mb-icon-option"][data-icon="pizza"]').click();
  await expect.poll(async () => (await nodosGuardados(page)).find((n) => n.id === GMV.mercado)?.icon).toBe("pizza");

  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await desplegarGrilla(page);
  await expect(filaGrilla(page, "Mercado").first().locator("svg.lucide-pizza")).toBeVisible();
  // Restaurantes, que no se tocó, no lo lleva.
  await expect(filaGrilla(page, "Restaurantes").first().locator("svg.lucide-pizza")).toHaveCount(0);
});

// ═══ FR-3205 · borrar ════════════════════════════════════════════════════════════════════════════

test("TC-GMV-050h: borrar una categoría vacía", async ({ page }) => {
  // @aitri-tc TC-GMV-050h
  await abrirPresupuesto(page);
  await irAElemento(page, "Prueba");
  await page.getByTestId("mb-node-delete").click();
  await expect(page.getByTestId("mb-confirm-delete")).toContainText("¿Borrar la categoría “Prueba”?");
  await page.getByTestId("mb-confirm-yes").click();

  await expect(titulo(page)).toHaveText("Organizar categorías");
  expect(await busqueda(page)).toBe("?v=p&d=org");
  await expect(toast(page)).toContainText("Categoría borrada");
  await expect(filaOrg(page, "Prueba")).toHaveCount(0);
  // Su hermana Cine sigue: se borró una, no el grupo.
  await expect(filaOrg(page, "Cine")).toHaveCount(1);
  await expect.poll(async () => (await nodosGuardados(page)).some((n) => n.id === GMV.prueba)).toBe(false);

  await page.goBack();
  await page.getByTestId("mb-nav").getByRole("tab", { name: "Registrar" }).click();
  await expect(page.getByTestId(`category-${GMV.cine}`)).toBeVisible();
  await expect(page.getByTestId(`category-${GMV.prueba}`)).toHaveCount(0);
});

// ═══ FR-3206 · mover ═════════════════════════════════════════════════════════════════════════════

const destino = (page: Page, id: string) => page.locator(`[data-testid="mb-move-option"][data-dest="${id}"]`);
const real = (page: Page, nombre: string) => fila(page, nombre).getByTestId("mb-row-actual");
const totalSeccion = (page: Page) => page.getByTestId("mb-section-expense").getByTestId("mb-section-total");

test("TC-GMV-060h: mover una categoría a otro grupo", async ({ page }) => {
  // @aitri-tc TC-GMV-060h
  await abrirPresupuesto(page);
  await expect(real(page, "Comida")).toHaveText("500");
  await expect(real(page, "Ocio")).toHaveText("—");
  const totalAntes = await totalSeccion(page).innerText();

  await irAElemento(page, "Restaurantes");
  await page.getByTestId("mb-node-move").click();
  await expect(titulo(page)).toHaveText("Mover “Restaurantes”");
  await destino(page, GMV.ocio).click();

  // Vuelve a la pantalla del elemento, con la ruta nueva.
  await expect(titulo(page)).toHaveText("Restaurantes");
  await expect(page.getByTestId("mb-node")).toContainText("Gastos · Ocio");
  await expect(toast(page)).toContainText("Movido a Ocio");

  await page.goBack();
  await page.goBack();
  await expect(titulo(page)).toHaveText("Presupuesto");
  // Ocio no tiene nada planeado, así que sus 400 llevan el glifo de sobre-consumo.
  await expect(real(page, "Ocio")).toHaveText("›› 400");
  await expect(real(page, "Comida")).toHaveText("100");
  await expect(totalSeccion(page)).toHaveText(totalAntes);
  await fila(page, "Ocio").click();
  await expect(real(page, "Restaurantes")).toHaveText("›› 400");
  await expect.poll(async () => (await nodosGuardados(page)).find((n) => n.id === GMV.restaurantes)?.parentId).toBe(GMV.ocio);
});

test("TC-GMV-070e: cada destino dice en qué se convierte", async ({ page }) => {
  // @aitri-tc TC-GMV-070e
  await abrirPresupuesto(page);
  await irAElemento(page, "Restaurantes");
  await page.getByTestId("mb-node-move").click();

  const opciones = page.getByTestId("mb-move-option");
  await expect(opciones.first()).toContainText("Convertir en grupo de Gastos");
  await expect(destino(page, GMV.ocio).getByTestId("mb-move-becomes")).toHaveText("como categoría");
  await expect(destino(page, GMV.mercado).getByTestId("mb-move-becomes")).toHaveText("como subcategoría");
  await expect(destino(page, GMV.comida).getByTestId("mb-move-current")).toHaveText("Aquí está");
  await expect(destino(page, GMV.comida)).toHaveAttribute("aria-disabled", "true");
  await expect(destino(page, GMV.comida).getByTestId("mb-move-becomes")).toHaveCount(0);
  // El propio elemento no es un destino, y en el teléfono nada se arrastra.
  await expect(destino(page, GMV.restaurantes)).toHaveCount(0);
  await expect(page.getByTestId("mb-move").locator('[draggable="true"], [aria-roledescription="draggable"]')).toHaveCount(0);

  // Tocar el lugar donde ya está no mueve nada.
  await destino(page, GMV.comida).click({ force: true });
  await expect(titulo(page)).toHaveText("Mover “Restaurantes”");
  expect((await nodosGuardados(page)).find((n) => n.id === GMV.restaurantes)?.parentId).toBe(GMV.comida);
});

// ═══ FR-3207 / FR-3208 / FR-3209 · cierre de mes ═════════════════════════════════════════════════

/** La frontera de cierre tal como la tiene guardada el servidor. */
async function cierreGuardado(page: Page): Promise<{ closedThrough: string | null; reopened: string | null }> {
  const res = await page.request.get("/api/v1/ledger");
  const c = ((await res.json()) as { state: { closure?: { closedThrough: string | null; reopened: string | null } } }).state.closure;
  return { closedThrough: c?.closedThrough ?? null, reopened: c?.reopened ?? null };
}
async function irACierre(page: Page): Promise<void> {
  await page.getByTestId("mb-open-closure").click();
  await expect(page.getByTestId("mb-closure")).toBeVisible();
}
/** El color que el navegador resuelve para un token. */
const colorDe = (page: Page, token: string) => page.evaluate((t) => {
  const probe = document.createElement("span");
  probe.style.color = `var(${t})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}, token);
const colorDeTexto = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).color);
/** Abre el detalle de una hoja desde la lista del periodo. */
async function abrirHoja(page: Page, grupo: string, hoja: string): Promise<void> {
  if ((await fila(page, grupo).getAttribute("aria-expanded")) !== "true") await fila(page, grupo).click();
  await fila(page, hoja).click();
  await expect(page.getByTestId("mb-leaf")).toBeVisible();
}

test("TC-GMV-080h: cerrar el mes cerrable desde el teléfono", async ({ page }) => {
  // @aitri-tc TC-GMV-080h
  await abrirPresupuesto(page);
  expect(await cierreGuardado(page)).toEqual({ closedThrough: null, reopened: null });
  await irACierre(page);
  await expect(titulo(page)).toHaveText("Cierre de mes");
  await expect(page.getByTestId("mb-closure-period")).toHaveText(LABEL_PREV);
  await expect(page.getByTestId("mb-closure-close-button")).toHaveText(`Cerrar ${LABEL_PREV}`);

  await page.getByTestId("mb-closure-close-button").click();
  await expect(page.getByTestId("mb-closure-confirm")).toContainText(`¿Cerrar ${LABEL_PREV}?`);
  await page.getByTestId("mb-closure-confirm-yes").click();

  // El bloque pasa al mes siguiente y el otro ya ofrece reabrir el que se cerró.
  await expect(page.getByTestId("mb-closure-close-button")).toHaveText(`Cerrar ${LABEL_M}`);
  await expect(page.getByTestId("mb-closure-reopen-button")).toHaveText(`Reabrir ${LABEL_PREV}`);
  await expect(page.getByTestId("mb-closure-failed")).toHaveCount(0);
  // El mes que el botón nombraba es el que quedó cerrado en el servidor.
  expect(await cierreGuardado(page)).toEqual({ closedThrough: PREV, reopened: null });

  // Y en escritorio, tras recargar, es el mismo.
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("closure-control")).toHaveAttribute("data-reopenable", PREV);
});

test("TC-GMV-082f: con celdas descuadradas no se deja cerrar y el motivo se lee entero", async ({ page }, testInfo) => {
  // @aitri-tc TC-GMV-082f
  await abrir(page);
  // Mercado pasa a decir 900 en julio, pero sus movimientos suman 850: no cuadra. El servidor no deja
  // guardar una celda así por la API, de modo que se planta en la base, como hace diario-de-celda.
  await descuadrarCelda(e2eEmail(testInfo.parallelIndex), GMV.mercado, PREV, 900);
  await page.reload();
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await page.getByTestId("mb-nav").getByRole("tab", { name: "Presupuesto" }).click();
  await irACierre(page);

  await expect(page.getByTestId("mb-closure-close-button")).toBeDisabled();
  const motivo = page.getByTestId("mb-closure-blocked");
  await expect(motivo).toBeVisible();
  await expect(motivo).toHaveText("No se puede cerrar: 1 celda no cuadra (Mercado)");
  // Se lee entero: no hay recorte ni puntos suspensivos, a diferencia del control de escritorio.
  const recorte = await motivo.evaluate((el) => {
    const span = el.querySelector("span") as HTMLElement;
    return { cabe: span.scrollWidth <= span.clientWidth + 1, overflow: getComputedStyle(span).textOverflow, espacio: getComputedStyle(span).whiteSpace };
  });
  expect(recorte).toEqual({ cabe: true, overflow: "clip", espacio: "normal" });
  expect(await colorDeTexto(motivo)).toBe(await colorDe(page, "--alert-strong"));
  expect(await sinDesborde(page)).toBe(true);
  // Y no se cerró nada.
  expect(await cierreGuardado(page)).toEqual({ closedThrough: null, reopened: null });
});

test("TC-GMV-090h: reabrir el último mes cerrado", async ({ page }) => {
  // @aitri-tc TC-GMV-090h
  await abrirPresupuesto(page, { cerrar: 2 });
  expect(await cierreGuardado(page)).toEqual({ closedThrough: M, reopened: null });
  await irACierre(page);

  // Solo el último cerrado: agosto, no julio.
  await expect(page.getByTestId("mb-closure-reopen-button")).toHaveText(`Reabrir ${LABEL_M}`);
  await expect(page.getByRole("button", { name: new RegExp(`Reabrir ${LABEL_PREV}`) })).toHaveCount(0);
  await page.getByTestId("mb-closure-reopen-button").click();
  await expect(page.getByTestId("mb-reopen-confirm")).toContainText(`¿Reabrir ${LABEL_M}?`);
  await page.getByTestId("mb-reopen-confirm-yes").click();

  await expect(page.getByTestId("mb-closure-reopened")).toContainText(`${LABEL_M} está reabierto`);
  await expect(page.getByTestId("mb-closure-reopen-button")).toHaveCount(0);
  expect(await cierreGuardado(page)).toEqual({ closedThrough: PREV, reopened: M });

  // Agosto vuelve a admitir cambios.
  await page.goBack();
  await expect(titulo(page)).toHaveText("Presupuesto");
  await expect(page.getByTestId("mb-closed-notice")).toHaveCount(0);
  await abrirHoja(page, "Comida", "Mercado");
  await expect(page.getByTestId("mb-amount-card-budget").getByTestId("mb-amount-change")).toBeVisible();
});

test("TC-GMV-100h: el aviso lleva a Cierre de mes y no nombra el computador", async ({ page }) => {
  // @aitri-tc TC-GMV-100h
  await abrirPresupuesto(page, { cerrar: 2 });
  const aviso = page.getByTestId("mb-closed-notice");
  await expect(aviso).toContainText(`${LABEL_M} está cerrado. Puedes mirarlo; para cambiarlo, reábrelo.`);
  await expect(aviso).not.toContainText("computador");
  await expect(aviso).not.toContainText("escritorio");
  const enlace = aviso.getByTestId("mb-closed-notice-link");
  await expect(enlace).toHaveText("Ir a Cierre de mes ›");
  expect((await enlace.boundingBox())!.height).toBeGreaterThanOrEqual(40);

  await enlace.click();
  expect(await busqueda(page)).toBe("?v=p&d=cierre");
  await expect(titulo(page)).toHaveText("Cierre de mes");
});

test("TC-GMV-103e: reabrir desde el aviso y volver: las acciones aparecen sin recargar", async ({ page }) => {
  // @aitri-tc TC-GMV-103e
  await abrirPresupuesto(page, { cerrar: 2 });
  await page.evaluate(() => { (window as unknown as { __gmv: number }).__gmv = 1; });
  // Antes: agosto cerrado, sin «Cambiar».
  await abrirHoja(page, "Comida", "Mercado");
  await expect(page.getByTestId("mb-amount-change")).toHaveCount(0);
  await page.goBack();

  await page.getByTestId("mb-closed-notice-link").click();
  await page.getByTestId("mb-closure-reopen-button").click();
  await page.getByTestId("mb-reopen-confirm-yes").click();
  await expect(page.getByTestId("mb-closure-reopened")).toBeVisible();
  await page.getByTestId("mb-back").click();

  await expect(titulo(page)).toHaveText("Presupuesto");
  await expect(page.getByTestId("mb-closed-notice")).toHaveCount(0);
  await abrirHoja(page, "Comida", "Mercado");
  await expect(page.getByTestId("mb-amount-card-budget").getByTestId("mb-amount-change")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __gmv?: number }).__gmv)).toBe(1);
});

test("TC-GMV-155h: mes cerrado: la lista y el detalle se miran, no se cambian", async ({ page }) => {
  // @aitri-tc TC-GMV-155h
  await abrirPresupuesto(page, { cerrar: 2 });
  await page.getByTestId("mb-period-prev").click();
  await expect(page.getByTestId("mb-period-label")).toContainText(LABEL_PREV);
  await expect(page.getByTestId("mb-closed-notice")).toContainText(`${LABEL_PREV} está cerrado`);

  // Las cifras de julio se ven…
  await abrirHoja(page, "Comida", "Mercado");
  await expect(page.getByTestId("mb-amount-card-budget").getByTestId("mb-amount-value")).toHaveText("900");
  await expect(page.getByTestId("mb-amount-card-actual").getByTestId("mb-amount-value")).toHaveText("850");
  // …sin ninguna acción de cambio.
  await expect(page.getByTestId("mb-amount-change")).toHaveCount(0);
  await expect(page.getByTestId("mb-mov-edit")).toHaveCount(0);
  await page.goBack();

  await fila(page, "Retiros del mes").click();
  await expect(titulo(page)).toHaveText("Retiros del mes");
  await expect(page.getByTestId("mb-closed-notice")).toBeVisible();
  await expect(page.locator('[data-testid="mb-retiro-edit"], [data-testid="mb-retiro-delete"], [data-testid="mb-amount-change"]')).toHaveCount(0);
});

// ═══ FR-3210 · caben y se tocan con el dedo ══════════════════════════════════════════════════════

/** Las pantallas de gestión, por enlace directo. La de Mercado lleva el selector de ícono abierto. */
const PANTALLAS: { nombre: string; ruta: string; raiz: string; preparar?: (page: Page) => Promise<void> }[] = [
  { nombre: "lista", ruta: "/?v=p", raiz: "mb-title-row" },
  { nombre: "organizar", ruta: "/?v=p&d=org", raiz: "mb-organize" },
  { nombre: "elemento con selector de ícono", ruta: `/?v=p&d=node&id=${GMV.mercado}`, raiz: "mb-node", preparar: async (page) => { await page.getByTestId("mb-node-icon").click(); await expect(page.getByTestId("mb-icon-grid")).toBeVisible(); } },
  { nombre: "elemento confirmando borrar", ruta: `/?v=p&d=node&id=${GMV.prueba}`, raiz: "mb-node", preparar: async (page) => { await page.getByTestId("mb-node-delete").click(); await expect(page.getByTestId("mb-confirm-delete")).toBeVisible(); } },
  { nombre: "nueva categoría", ruta: `/?v=p&d=new&id=${GMV.ocio}`, raiz: "mb-new-node" },
  { nombre: "mover", ruta: `/?v=p&d=move&id=${GMV.restaurantes}`, raiz: "mb-move" },
  { nombre: "cierre", ruta: "/?v=p&d=cierre", raiz: "mb-closure" },
];
/** Recorre las pantallas de gestión llamando a `medir` en cada una. */
async function recorrer(page: Page, medir: (p: (typeof PANTALLAS)[number]) => Promise<void>): Promise<void> {
  for (const p of PANTALLAS) {
    await page.goto(p.ruta);
    await expect(page.getByTestId(p.raiz)).toBeVisible();
    if (p.preparar) await p.preparar(page);
    await medir(p);
  }
}

test("TC-GMV-110h: sin desborde horizontal en las pantallas nuevas", async ({ page }) => {
  // @aitri-tc TC-GMV-110h
  let medidas = 0;
  for (const viewport of [MOBILE, SMALL]) {
    await abrir(page, { viewport });
    await recorrer(page, async (p) => {
      expect(await sinDesborde(page), `${p.nombre} a ${viewport.width} px`).toBe(true);
      medidas++;
    });
  }
  expect(medidas).toBe(PANTALLAS.length * 2);
});

test("TC-GMV-111f: ningún control tocable mide menos de 40×40", async ({ page }) => {
  // @aitri-tc TC-GMV-111f
  await abrir(page);
  let medidos = 0;
  await recorrer(page, async (p) => {
    const cajas = await page.getByTestId(p.raiz).locator("button, a, input").evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => {
        const r = e.getBoundingClientRect();
        return { quien: e.getAttribute("data-testid") ?? e.textContent?.trim().slice(0, 30) ?? e.tagName, w: Math.round(r.width), h: Math.round(r.height) };
      }));
    for (const c of cajas) {
      expect(Math.min(c.w, c.h), `${p.nombre} · ${c.quien} mide ${c.w}×${c.h}`).toBeGreaterThanOrEqual(40);
      medidos++;
    }
  });
  expect(medidos, "la prueba midió controles de verdad").toBeGreaterThan(100);
});

test("TC-GMV-112e: un nombre de 60 caracteres no rompe nada", async ({ page }) => {
  // @aitri-tc TC-GMV-112e
  expect(NOMBRE_LARGO).toHaveLength(60);
  await abrir(page, { viewport: SMALL, seed: gmvLargo(M, PREV) });

  await page.goto("/?v=p&d=org");
  await expect(filaOrg(page, NOMBRE_LARGO)).toHaveCount(1);
  expect(await sinDesborde(page), "organizar").toBe(true);

  await page.goto(`/?v=p&d=node&id=${GMV_LARGO}`);
  const nombre = page.getByTestId("mb-node-name");
  await expect(nombre).toHaveText(NOMBRE_LARGO);
  // En la tarjeta de identidad parte en varias líneas y se lee completo.
  const lineas = await nombre.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  expect(lineas).toBeGreaterThanOrEqual(1.9);
  expect(await sinDesborde(page), "elemento").toBe(true);

  await page.getByTestId("mb-node-delete").click();
  await expect(page.getByTestId("mb-confirm-delete")).toContainText(NOMBRE_LARGO);
  expect(await sinDesborde(page), "confirmación de borrar").toBe(true);

  await page.goto(`/?v=p&d=move&id=${GMV.restaurantes}`);
  await expect(page.locator(`[data-testid="mb-move-option"][data-dest="${GMV_LARGO}"]`)).toBeVisible();
  expect(await sinDesborde(page), "mover").toBe(true);
  // En una fila el nombre se recorta dentro de su caja, sin empujar el «como subcategoría».
  await expect(page.locator(`[data-testid="mb-move-option"][data-dest="${GMV_LARGO}"]`).getByTestId("mb-move-becomes")).toBeVisible();
});

/** Ratio de contraste WCAG entre dos colores «rgb(r, g, b)». */
function contraste(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
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

test("TC-GMV-113h: contraste ≥4,5:1 en claro y oscuro", async ({ page }) => {
  // @aitri-tc TC-GMV-113h
  let pares = 0;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await abrir(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(scheme === "dark");
    const medir = async (nombre: string, loc: Locator) => {
      const c = await coloresDe(loc.first());
      expect(contraste(c.texto, c.fondo), `${scheme} · ${nombre} · ${c.texto} sobre ${c.fondo}`).toBeGreaterThanOrEqual(4.5);
      pares++;
    };

    await page.goto("/?v=p&d=org");
    await medir("nombre de fila", filaOrg(page, "Mercado").getByTestId("mb-org-row-name"));

    await page.goto(`/?v=p&d=node&id=${GMV.mercado}`);
    await medir("ruta", page.getByTestId("mb-node").locator("p.caption"));
    await medir("rótulo de acción", page.getByTestId("mb-node-rename"));
    await medir("«Borrar»", page.getByTestId("mb-node-delete"));
    await page.getByTestId("mb-node-delete").click();
    await medir("motivo de bloqueo", page.getByTestId("mb-node-blocked"));

    await page.goto(`/?v=p&d=move&id=${GMV.restaurantes}`);
    await medir("«como categoría»", page.locator(`[data-testid="mb-move-option"][data-dest="${GMV.ocio}"]`).getByTestId("mb-move-becomes"));
    await medir("destino deshabilitado", page.locator(`[data-testid="mb-move-option"][data-dest="${GMV.comida}"] span.truncate`));
  }
  expect(pares).toBe(14);
});

test("TC-GMV-114e: la línea del título cabe con holgura a 360 px", async ({ page }) => {
  // @aitri-tc TC-GMV-114e
  await abrirPresupuesto(page, { viewport: SMALL });
  const m = await page.getByTestId("mb-title-row").evaluate((row) => {
    const h1 = row.querySelector("h1") as HTMLElement;
    const botones = Array.from(row.querySelectorAll("button")) as HTMLElement[];
    const estilo = getComputedStyle(row);
    const ancho = row.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
    return {
      ancho,
      titulo: h1.scrollWidth,
      recortado: h1.scrollWidth > h1.clientWidth,
      botones: botones.reduce((t, b) => t + b.getBoundingClientRect().width, 0),
      tops: [h1, ...botones].map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)),
      separacion: parseFloat(estilo.columnGap) || 0,
    };
  });
  // Los tres en una sola línea, el título entero y al menos 4 px de sobra: la letra de Linux es más ancha.
  expect(Math.max(...m.tops) - Math.min(...m.tops)).toBeLessThanOrEqual(2);
  expect(m.recortado).toBe(false);
  expect(m.ancho - (m.titulo + m.botones + m.separacion), JSON.stringify(m)).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId("mb-open-organize")).toHaveText("Organizar");
  await expect(page.getByTestId("mb-open-closure")).toHaveText("Cierre");
});

test("TC-GMV-115e: el color dice lo que el diseño declara", async ({ page }) => {
  // @aitri-tc TC-GMV-115e
  await abrir(page);
  const fuerte = await colorDe(page, "--alert-strong");
  const suave = await colorDe(page, "--alert-soft");
  expect(fuerte).not.toBe(suave);

  await page.goto(`/?v=p&d=node&id=${GMV.mercado}`);
  expect(await colorDeTexto(page.getByTestId("mb-node-delete"))).toBe(fuerte);
  // «Renombrar», que no es peligro, no lleva ese color.
  expect(await colorDeTexto(page.getByTestId("mb-node-rename"))).not.toBe(fuerte);
  await page.getByTestId("mb-node-delete").click();
  expect(await colorDeTexto(page.getByTestId("mb-node-blocked"))).toBe(fuerte);

  await page.goto(`/?v=p&d=new&id=${GMV.mercado}`);
  expect(await colorDeTexto(page.getByTestId("mb-new-carry"))).toBe(suave);

  await page.goto(`/?v=p&d=move&id=${GMV.viajes}`);
  expect(await colorDeTexto(page.locator(`[data-testid="mb-move-option"][data-dest="${GMV.ocio}"]`).getByTestId("mb-move-note"))).toBe(suave);
});

// ═══ FR-3211 · guardado, de ida y de vuelta ══════════════════════════════════════════════════════

/** Crea el grupo «Hogar» en Gastos desde Organizar. */
async function crearHogar(page: Page): Promise<void> {
  await page.getByTestId("mb-org-section-expense").getByTestId("mb-org-add-group").click();
  await page.getByTestId("mb-new-name").fill("Hogar");
  await page.getByTestId("mb-new-create").click();
  await expect(titulo(page)).toHaveText("Organizar categorías");
}

test("TC-GMV-120h: lo creado en el teléfono está en escritorio", async ({ page }) => {
  // @aitri-tc TC-GMV-120h
  await abrirPresupuesto(page);
  await irAOrganizar(page);
  await crearHogar(page);
  await expect.poll(async () => (await nodosGuardados(page)).some((n) => n.name === "Hogar")).toBe(true);

  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(filaGrilla(page, "Hogar")).toHaveCount(1);
  await expect(filaGrilla(page, "Hogar")).toHaveAttribute("data-level", "group");
});

test("TC-GMV-122e: lo renombrado en escritorio llega al teléfono", async ({ page }) => {
  // @aitri-tc TC-GMV-122e
  await abrir(page, { viewport: DESK });
  await desplegarGrilla(page);
  const mercado = filaGrilla(page, "Mercado").first();
  await mercado.hover();
  await mercado.getByRole("button", { name: "Renombrar", exact: true }).click();
  const campo = page.getByLabel("Nombre", { exact: true });
  await campo.fill("Súper");
  await campo.press("Enter");
  await expect.poll(async () => (await nodosGuardados(page)).find((n) => n.id === GMV.mercado)?.name).toBe("Súper");

  await page.setViewportSize(MOBILE);
  await page.goto("/?v=p&d=org");
  await expect(filaOrg(page, "Súper")).toHaveCount(1);
  await expect(filaOrg(page, "Mercado")).toHaveCount(0);
  await page.goto("/?v=p");
  await fila(page, "Comida").click();
  await expect(fila(page, "Súper")).toHaveCount(1);
});

test("TC-GMV-123f: el guardado falla: aviso y nada persistido", async ({ page }) => {
  // @aitri-tc TC-GMV-123f
  await abrirPresupuesto(page);
  await irAOrganizar(page);
  await page.route("**/api/v1/ledger", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal" } }) })
      : route.fallback());
  await crearHogar(page);

  // Optimista: se ve, pero el aviso dice que no quedó guardado.
  await expect(filaOrg(page, "Hogar")).toHaveCount(1);
  // El aviso se ve en la propia pantalla de gestión, sin tener que volver a la lista. (Hay otro en la
  // vista Registrar, que está oculta.)
  await expect(page.locator('[data-testid="storage-banner"]:visible')).toHaveCount(1);

  await page.unroute("**/api/v1/ledger");
  expect((await nodosGuardados(page)).some((n) => n.name === "Hogar")).toBe(false);
  await page.goto("/?v=p&d=org");
  await expect(page.getByTestId("mb-organize")).toBeVisible();
  await expect(filaOrg(page, "Hogar")).toHaveCount(0);
});

test("TC-GMV-124f: ninguna operación usa una ruta nueva", async ({ page }) => {
  // @aitri-tc TC-GMV-124f
  await abrirPresupuesto(page);
  const rutas = new Set<string>();
  const fallidas: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) rutas.add(`${r.method()} ${u.pathname}`);
  });
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/") && r.status() === 404) fallidas.push(r.url());
  });

  // Crear, renombrar, ícono, mover y borrar…
  await irAOrganizar(page);
  await crearHogar(page);
  await filaOrg(page, "Mercado").click();
  await page.getByTestId("mb-node-rename").click();
  await page.getByTestId("mb-node-name-input").fill("Súper");
  await page.getByTestId("mb-node-name-save").click();
  await page.getByTestId("mb-node-icon").click();
  await page.locator('[data-testid="mb-icon-option"][data-icon="pizza"]').click();
  await page.getByTestId("mb-node-move").click();
  await page.locator(`[data-testid="mb-move-option"][data-dest="${GMV.ocio}"]`).click();
  await expect(page.getByTestId("mb-node")).toContainText("Gastos · Ocio");
  await page.goto(`/?v=p&d=node&id=${GMV.prueba}`);
  await page.getByTestId("mb-node-delete").click();
  await page.getByTestId("mb-confirm-yes").click();
  await expect(titulo(page)).toHaveText("Organizar categorías");
  // …y cerrar y reabrir.
  await page.goto("/?v=p&d=cierre");
  await page.getByTestId("mb-closure-close-button").click();
  await page.getByTestId("mb-closure-confirm-yes").click();
  await expect(page.getByTestId("mb-closure-reopen-button")).toHaveText(`Reabrir ${LABEL_PREV}`);
  await page.getByTestId("mb-closure-reopen-button").click();
  await page.getByTestId("mb-reopen-confirm-yes").click();
  await expect(page.getByTestId("mb-closure-reopened")).toBeVisible();
  await expect.poll(async () => (await nodosGuardados(page)).some((n) => n.id === GMV.prueba)).toBe(false);

  // Las escrituras fueron solo las dos rutas de siempre.
  const escrituras = [...rutas].filter((r) => !r.startsWith("GET ")).sort();
  expect(escrituras).toEqual(["DELETE /api/v1/closure", "POST /api/v1/closure", "PUT /api/v1/ledger"]);
  const permitidas = /^(GET|PUT|POST|DELETE) \/api\/(v1\/(ledger|closure|closure\/events|sync\/stream|movements|preferences\/horizon)|auth\/.+)$/;
  for (const r of rutas) expect(r, "ruta fuera de las vigentes").toMatch(permitidas);
  expect(fallidas).toEqual([]);
});

// ═══ NFR-3201 · escritorio no cambia ═════════════════════════════════════════════════════════════

test("TC-GMV-130h: escritorio: cerrar sigue siendo un clic, sin diálogo", async ({ page }) => {
  // @aitri-tc TC-GMV-130h
  await abrir(page, { viewport: DESK });
  const control = page.getByTestId("closure-control");
  await expect(control).toHaveAttribute("data-closable", PREV);
  await control.getByRole("button", { name: new RegExp(`^Cerrar ${LABEL_PREV}`) }).click();

  await expect(control).toHaveAttribute("data-reopenable", PREV);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(toast(page)).toContainText("Mes cerrado.");
  expect(await cierreGuardado(page)).toEqual({ closedThrough: PREV, reopened: null });
});

test("TC-GMV-131e: escritorio: el selector de íconos sigue siendo el popover", async ({ page }) => {
  // @aitri-tc TC-GMV-131e
  await abrir(page, { viewport: DESK });
  await desplegarGrilla(page);
  await filaGrilla(page, "Mercado").first().locator('button[aria-label="Cambiar ícono"]').click();
  await expect(page.getByTestId("icon-picker")).toBeVisible();
  await expect(page.getByTestId("icon-picker-search")).toBeVisible();
  // Las celdas de escritorio conservan su tamaño de mouse (36 px), no el del dedo.
  const lado = await page.getByTestId("icon-option").first().evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(lado)).toBe(36);
  await expect(page.getByTestId("mb-icon-grid")).toHaveCount(0);
});

test("TC-GMV-132f: escritorio no monta nada de la gestión móvil", async ({ page }) => {
  // @aitri-tc TC-GMV-132f
  const moviles = () => page.locator('[data-testid^="mb-"]');
  await abrir(page, { viewport: DESK });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(moviles()).toHaveCount(0);

  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await expect(moviles()).toHaveCount(0);

  await page.goto("/?v=p&d=org");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(moviles()).toHaveCount(0);
  await expect(page.getByTestId("mobile-shell")).toHaveCount(0);
});

// ═══ NFR-3202 / NFR-3203 · la primera entrega y el registro ═════════════════════════════════════

test("TC-GMV-135h: teléfono: cambiar lo planeado sigue igual", async ({ page }) => {
  // @aitri-tc TC-GMV-135h
  await abrirPresupuesto(page);
  await abrirHoja(page, "Comida", "Mercado");
  const tarjeta = page.getByTestId("mb-amount-card-budget");
  await expect(tarjeta.getByTestId("mb-amount-value")).toHaveText("800");
  await tarjeta.getByTestId("mb-amount-change").click();
  await tarjeta.getByRole("textbox").fill("900");
  await tarjeta.getByTestId("mb-amount-save").click();
  await expect(tarjeta.getByTestId("mb-amount-value")).toHaveText("900");

  await page.goBack();
  await expect(fila(page, "Mercado").getByTestId("mb-row-budget")).toHaveText("de 900");
  await expect(fila(page, "Comida").getByTestId("mb-row-budget")).toHaveText("de 900");
});

const montoRegistrar = (page: Page) => page.getByTestId("amount-input");
const soloDigitos = async (loc: Locator) => (await loc.inputValue()).replace(/\D/g, "");
const tab = (page: Page, nombre: "Registrar" | "Presupuesto") => page.getByTestId("mb-nav").getByRole("tab", { name: nombre });

test("TC-GMV-140h: lo escrito en Registrar sobrevive a organizar", async ({ page }) => {
  // @aitri-tc TC-GMV-140h
  await abrir(page);
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await montoRegistrar(page).fill("50000");
  await page.getByTestId(`category-${GMV.mercado}`).click();
  await expect(page.getByTestId(`category-${GMV.mercado}`)).toHaveAttribute("aria-pressed", "true");

  await tab(page, "Presupuesto").click();
  await irAElemento(page, "Mercado");
  await expect(titulo(page)).toHaveText("Mercado");
  await tab(page, "Registrar").click();

  expect(await soloDigitos(montoRegistrar(page))).toBe("50000");
  await expect(page.getByTestId(`category-${GMV.mercado}`)).toHaveAttribute("aria-pressed", "true");
});

test("TC-GMV-141e: lo escrito en Registrar sobrevive a la pantalla de cierre y al atrás", async ({ page }) => {
  // @aitri-tc TC-GMV-141e
  await abrir(page);
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await montoRegistrar(page).fill("50000");

  await tab(page, "Presupuesto").click();
  await irACierre(page);
  await page.getByTestId("mb-closure-close-button").click();
  await page.getByTestId("mb-closure-confirm-no").click();
  await page.goBack();
  await expect(titulo(page)).toHaveText("Presupuesto");
  await tab(page, "Registrar").click();

  expect(await soloDigitos(montoRegistrar(page))).toBe("50000");
  // Y no se cerró nada por el camino.
  expect(await cierreGuardado(page)).toEqual({ closedThrough: null, reopened: null });
});

// ═══ NFR-3207 · dashboard, grilla y el corte de 760 px ═══════════════════════════════════════════

test("TC-GMV-160h: en el teléfono no hay grilla de 12 meses ni dashboard", async ({ page }) => {
  // @aitri-tc TC-GMV-160h
  await abrir(page);
  for (const [ruta, raiz] of [["/?v=p", "mb-budget"], ["/?v=p&d=org", "mb-organize"], ["/?v=p&d=cierre", "mb-closure"]]) {
    await page.goto(ruta);
    await expect(page.getByTestId(raiz)).toBeVisible();
    await expect(page.getByTestId("budget-grid"), ruta).toHaveCount(0);
    await expect(page.getByTestId("dashboard"), ruta).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Dashboard" }), ruta).toHaveCount(0);
  }
});

test("TC-GMV-161e: el corte sigue en 760 px", async ({ page }) => {
  // @aitri-tc TC-GMV-161e
  await abrir(page, { viewport: { width: 760, height: 900 }, ruta: "/?v=p" });
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await expect(page.getByTestId("mb-open-organize")).toBeVisible();
  await expect(page.getByTestId("mb-open-closure")).toBeVisible();
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);

  await page.setViewportSize({ width: 761, height: 900 });
  await page.goto("/?v=p");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("mobile-shell")).toHaveCount(0);
  await expect(page.getByTestId("mb-open-organize")).toHaveCount(0);
  await expect(page.getByTestId("mb-open-closure")).toHaveCount(0);
});

test("TC-GMV-162f: un enlace a Organizar en escritorio muestra escritorio", async ({ page }) => {
  // @aitri-tc TC-GMV-162f
  await abrir(page, { viewport: DESK, ruta: "/?v=p&d=org" });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("closure-control")).toBeVisible();
  await expect(page.getByTestId("mb-organize")).toHaveCount(0);
  await expect(page.getByTestId("mobile-shell")).toHaveCount(0);
});
