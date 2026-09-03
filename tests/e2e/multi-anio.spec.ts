/**
 * Feature multi-anio — lo que solo se puede afirmar en el navegador.
 * TCs: FR-1905 (040h,041h,042e,043f,044h,045h) · FR-1908 (071h,072e) · FR-1910 (093e) ·
 *      NFR-1906 (250h,252e)
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import type { LedgerNode } from "@/domain/types";
import { P, visibleMonthCount } from "./helpers/periods";

const DESK = { width: 1440, height: 900 };

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sueldo", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Sueldo", icon: null, order: 1 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 3 },
];

async function abrir(page: Page, extra: Record<string, Record<string, number>> = {}) {
  await page.setViewportSize(DESK);
  await seedLedger(page, { nodes: NODES, actuals: { "c-sueldo": { [P[0]]: 1_000_000 }, ...extra } });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
}

/** Los años que la banda del encabezado rotula ahora mismo, en orden. */
async function anios(page: Page): Promise<string[]> {
  return page.getByTestId("year-band").locator("[data-year]").evaluateAll(
    (els) => els.map((e) => (e as HTMLElement).dataset.year ?? ""));
}

// ══ FR-1905 · la tira continua ════════════════════════════════════════════════════════════════
test("TC-MAN-040h: se pasa de diciembre a enero del año siguiente scrolleando, sin cambiar de vista", async ({ page }) => {
  // @aitri-tc TC-MAN-040h
  await abrir(page);
  const grid = page.getByTestId("budget-grid");
  const cabezas = page.locator("[data-month-head]");
  const total = await cabezas.count();
  expect(total).toBeGreaterThan(12); // el rango cruza el año: no son doce columnas

  // diciembre y el enero siguiente existen en el MISMO riel
  await expect(page.locator(`[data-month-head="${P[11]}"]`)).toHaveCount(1);
  const eneroSiguiente = `${Number(P[0].slice(0, 4)) + 1}-01`;
  await expect(page.locator(`[data-month-head="${eneroSiguiente}"]`)).toHaveCount(1);

  // y se llega desplazándose, sin recarga ni cambio de pantalla
  const antes = page.url();
  await grid.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await expect.poll(() => grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(page.url()).toBe(antes);
});

test("TC-MAN-041h: la banda rotula cada año, incluido un primer tramo parcial", async ({ page }) => {
  // @aitri-tc TC-MAN-041h
  await abrir(page);
  const ys = await anios(page);
  expect(ys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(ys).size).toBe(ys.length);            // sin años repetidos
  expect([...ys].sort()).toEqual(ys);                  // en orden
  // ningún tramo se queda sin etiqueta: la suma de sus columnas es el total de la grilla
  const suma = await page.getByTestId("year-band").locator("[data-year]").evaluateAll(
    (els) => els.reduce((n, e) => n + Math.round((e as HTMLElement).getBoundingClientRect().width / 216), 0));
  expect(suma).toBe(await visibleMonthCount(page));
});

test("TC-MAN-042e: el Balance sigue alineado con la grilla en todo el rango", async ({ page }) => {
  // @aitri-tc TC-MAN-042e
  await abrir(page);
  const grid = page.getByTestId("budget-grid");
  await grid.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await expect.poll(() => grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  // un ÚNICO contenedor de scroll: el Balance vive dentro de la misma caja que la grilla (ADR-04)
  const dentro = await page.getByTestId("balance-module").evaluate(
    (el, sel) => !!el.closest(sel), '[data-testid="budget-grid"]');
  expect(dentro).toBe(true);
});

test("TC-MAN-043f: la columna de categorías no se desplaza ni pierde su ancho", async ({ page }) => {
  // @aitri-tc TC-MAN-043f
  await abrir(page);
  const grid = page.getByTestId("budget-grid");
  // La celda de encabezado de la columna fija: la que lleva el rótulo CATEGORÍA.
  const sticky = page.getByText("CATEGORÍA", { exact: true }).first();
  const xAntes = (await sticky.boundingBox())!.x;
  const anchoAntes = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--cat-w"));
  await grid.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await expect.poll(() => grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(Math.round((await sticky.boundingBox())!.x)).toBe(Math.round(xAntes));
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--cat-w"))).toBe(anchoAntes);
});

test("TC-MAN-044h: el filtro Año recorta las columnas pero no el cálculo", async ({ page }) => {
  // @aitri-tc TC-MAN-044h
  const anio = Number(P[0].slice(0, 4));
  // cierre con saldo en diciembre del PRIMER año: su arrastre debe seguir vivo en enero del segundo
  await abrir(page, {});
  await seedLedger(page, { nodes: NODES, actuals: { "c-sueldo": { [P[11]]: 500_000 } } });
  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();

  await page.getByTestId("period-pill").getByRole("tab", { name: "Año" }).click();
  await page.getByLabel("Año").click();
  await page.getByRole("option", { name: String(anio + 1), exact: true }).click();

  // (a) solo se pintan periodos de ese año
  const cabezas = await page.locator("[data-month-head]").evaluateAll(
    (els) => els.map((e) => (e as HTMLElement).dataset.monthHead ?? ""));
  expect(cabezas.length).toBeGreaterThan(0);
  for (const c of cabezas) expect(c.startsWith(String(anio + 1))).toBe(true);

  // (b) ninguna fila pinta más celdas que columnas hay — el fallo que el usuario vio
  const celdasPorFila = await page.getByTestId("balance-module").getByTestId("balance-row").first()
    .locator("[data-month]").count();
  expect(celdasPorFila).toBe(cabezas.length);

  // (c) el cálculo NO se recortó: enero abre con el cierre de diciembre del año anterior
  const apertura = await page.getByTestId("balance-row").filter({ hasText: "Saldo del mes anterior" })
    .first().locator("[data-month]").first().textContent();
  expect(apertura ?? "").not.toMatch(/^—?$/);
});

test("TC-MAN-045h: el posicionamiento inicial no se come el primer gesto de rueda", async ({ page }) => {
  // @aitri-tc TC-MAN-045h
  await page.setViewportSize({ width: 1440, height: 520 }); // fuerza desborde vertical
  await seedLedger(page, { nodes: NODES, actuals: { "c-sueldo": { [P[0]]: 1_000_000 } } });
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  // SIN esperar: con `behavior:"smooth"` al montar, la animación absorbía este gesto y la grilla
  // se quedaba en scrollTop 0 durante ~1,5s.
  const box = (await grid.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

// ══ FR-1908 · el periodo en el registro ═══════════════════════════════════════════════════════
test("TC-MAN-071h: el selector de mes muestra el año junto al mes", async ({ page }) => {
  // @aitri-tc TC-MAN-071h
  await abrir(page);
  await page.getByLabel("Mes").click();
  const opciones = await page.getByRole("option").allTextContents();
  expect(opciones.length).toBeGreaterThan(12);
  for (const o of opciones) expect(o).toMatch(/\d{4}/);      // todas llevan año
  expect(new Set(opciones).size).toBe(opciones.length);      // dos «Marzo» no se confunden
});

test("TC-MAN-072e: elegir un mes lo deja a la vista sin scrollear a mano", async ({ page }) => {
  // @aitri-tc TC-MAN-072e
  await abrir(page);
  const grid = page.getByTestId("budget-grid");
  await grid.evaluate((el) => { el.scrollLeft = 0; });
  await page.getByLabel("Mes").click();
  const opciones = page.getByRole("option");
  const ultima = opciones.nth((await opciones.count()) - 1);
  await ultima.click();
  await expect.poll(() => grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

// ══ FR-1910 / NFR-1906 · siembra y registro ═══════════════════════════════════════════════════
test("TC-MAN-093e: el fixture freshLedger deja un estado coherente con el periodo en curso", async ({ page }) => {
  // @aitri-tc TC-MAN-093e
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  const cabezas = await page.locator("[data-month-head]").evaluateAll(
    (els) => els.map((e) => (e as HTMLElement).dataset.monthHead ?? ""));
  expect(cabezas.length).toBeGreaterThan(0);
  for (const c of cabezas) expect(c).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  expect([...cabezas].sort()).toEqual(cabezas); // ordenados y sin huecos de formato
});

test("TC-MAN-250h: un movimiento capturado suma al Ejecutado de SU periodo", async ({ page }) => {
  // @aitri-tc TC-MAN-250h
  await abrir(page);
  const objetivo = P[0];
  const res = await page.request.post("/api/v1/movements", {
    data: { type: "expense", catId: "c-mercado", amount: 5000, period: objetivo },
  });
  expect(res.status()).toBe(201);
  const back = await (await page.request.get("/api/v1/ledger")).json();
  expect(back.state.actuals["c-mercado"]?.[objetivo]).toBe(5000);
  const otroAnio = `${Number(objetivo.slice(0, 4)) + 1}${objetivo.slice(4)}`;
  expect(back.state.actuals["c-mercado"]?.[otroAnio] ?? 0).toBe(0); // no se filtró al mismo mes de otro año
});

test("TC-MAN-252e: el registro apunta por defecto al periodo en curso, con su año", async ({ page }) => {
  // @aitri-tc TC-MAN-252e
  await abrir(page);
  const etiqueta = (await page.getByLabel("Mes").textContent()) ?? "";
  const ahora = new Date();
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  expect(etiqueta).toContain(meses[ahora.getMonth()]);
  expect(etiqueta).toContain(String(ahora.getFullYear()));
});

// ══ FR-1904 · elegir el horizonte ═════════════════════════════════════════════════════════════
// Sin TC id a propósito: FR-1904 declara como criterio MUST «el usuario puede fijar el horizonte en
// 1 o en 2 años», pero ninguno de los TCs sembrados en la Fase 3 (TC-MAN-030h…034f, 060h…064f) lo
// ejercita — los diez prueban dominio, store y endpoint, y el control de interfaz no existía. Lo
// detectó la auditoría de requisitos del 2026-09-03 (GAP-1). Esta prueba cubre ese hueco desde
// fuera del pipeline; cuando el hallazgo se reconcilie en el expediente, le corresponde un TC id.

test("el usuario puede fijar el horizonte desde la cabecera, y su elección persiste", async ({ page }) => {
  await abrir(page);
  const anio = Number(P[0].slice(0, 4));

  const ultimaColumna = async () => {
    const cabezas = await page.locator("[data-month-head]").evaluateAll(
      (els) => els.map((e) => (e as HTMLElement).dataset.monthHead ?? ""));
    return cabezas[cabezas.length - 1] ?? "";
  };

  try {
    // De salida, el defecto: 2 años completos → el rango termina en el diciembre del año+2
    await expect(page.getByTestId("horizon-select")).toBeVisible();
    const columnasCon2 = await visibleMonthCount(page);
    expect(await ultimaColumna()).toBe(`${anio + 2}-12`);

    // El usuario elige 1 año
    await page.getByTestId("horizon-select").click();
    await page.getByRole("option", { name: "1 año", exact: true }).click();

    // El rango se encoge y sigue terminando en DICIEMBRE — años completos, no una cuenta de meses
    await expect.poll(() => visibleMonthCount(page)).toBeLessThan(columnasCon2);
    expect(await ultimaColumna()).toBe(`${anio + 1}-12`);

    // La preferencia vive en la cuenta (FR-1907/ADR-06): sobrevive a la recarga
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await expect.poll(() => ultimaColumna()).toBe(`${anio + 1}-12`);
  } finally {
    // El horizonte NO lo restaura el fixture `freshLedger` —no vive en el ledger— así que dejarlo
    // en 1 contaminaría a los tests siguientes del mismo worker, que comparten cuenta.
    await page.request.put("/api/v1/preferences/horizon", { data: { horizon: 2 } });
  }
});
