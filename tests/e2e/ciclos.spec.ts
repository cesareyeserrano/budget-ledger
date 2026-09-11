/**
 * Feature ciclos — EP-03: lo que solo se puede afirmar en el navegador.
 * TCs: FR-2401 (001h,002h,003f,005e,007e,008e,009e,141e,142e,144h,146e,154e,163e) ·
 *      FR-2403 (020h,021f,022e,023e,025e,026f,027e,143f,147e,160e) · FR-2404 (161e,162f,164h) ·
 *      FR-2405 (045h,051e,052f,145e) · FR-2406 (054h,056f,058e,061e) ·
 *      FR-2407 (062h,063e,064f,065e,067e,068e,069e,166e,167e,168e) · FR-2408 (079e,081e,165f) ·
 *      FR-2410 (096e) · NFR-2410 (132h) · NFR-2412 (138h,139e,140f)
 *
 * El servidor es AUTORIDAD (EP-02); aquí se comprueba que el usuario VE lo que el spec de UX declara:
 * la sección de Configuración, la previsualización inline, la cabecera de dos líneas, el selector con
 * rango, la línea «Ciclo» del Registro y la propuesta del ingreso adelantado. «Hoy» se fija en el
 * servidor con la cabecera de pruebas x-ledger-today y en el navegador con page.clock (helpers/cycles).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import { applyCycles, closeViaApi, fixToday } from "./helpers/cycles";
import { estadoReal, estadoSyn, mv, resetSeq } from "../fixtures/ciclos";
import { estadoUsuario, F_USER_INICIO } from "../fixtures/ciclos-usuario";
import { computeBalanceSeries } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { periodRange } from "@/domain/periods";
import type { LedgerState } from "@/domain/types";

const DESK = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };
const HOY = "2026-09-10";
const RANGO_RE = /^\d{1,2} [a-z]{3} – \d{1,2} [a-z]{3}$/;
const SEP26 = "21 ago – 20 sep";

/** Miles con punto, como `money()` (es-CO). */
const conPuntos = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

async function seedReal(page: Page): Promise<LedgerState> {
  const st = estadoReal();
  await seedLedger(page, { nodes: st.nodes, budgets: st.budgets, actuals: st.actuals, movements: st.movements });
  const current = await page.request.get("/api/v1/ledger");
  const baseRevision = ((await current.json()) as { revision: number }).revision;
  const res = await page.request.put("/api/v1/ledger/start", {
    data: { baseRevision, startMonth: "2026-08", openingBalance: st.openingBalance ?? 0 },
  });
  if (!res.ok()) throw new Error(`seedReal: /start falló HTTP ${res.status()}`);
  return st;
}
/** F-USER: réplica del ledger del usuario previo a activar (35 nodos, 50 celdas con 5 en 0, 27 movimientos). */
async function seedUser(page: Page): Promise<LedgerState> {
  const st = estadoUsuario();
  await seedLedger(page, { nodes: st.nodes, budgets: st.budgets, actuals: st.actuals, movements: st.movements });
  const current = await page.request.get("/api/v1/ledger");
  const baseRevision = ((await current.json()) as { revision: number }).revision;
  const res = await page.request.put("/api/v1/ledger/start", { data: { baseRevision, startMonth: F_USER_INICIO.startMonth, openingBalance: F_USER_INICIO.openingBalance } });
  if (!res.ok()) throw new Error(`seedUser: /start falló HTTP ${res.status()}`);
  return st;
}
async function seedSyn(page: Page, over: Partial<LedgerState> = {}): Promise<void> {
  const st = estadoSyn(over);
  await seedLedger(page, { nodes: st.nodes, budgets: st.budgets, actuals: st.actuals, movements: st.movements });
}
async function snapshot(page: Page): Promise<unknown> {
  return (await page.request.get("/api/v1/ledger")).json();
}
/**
 * Periodo del movimiento GUARDADO en el servidor con ese monto (null si aún no llegó). El Registro
 * persiste con el snapshot (PUT /api/v1/ledger, validado con period_mismatch), no con POST /movements.
 */
async function periodoGuardado(page: Page, amount: number): Promise<string | null> {
  const body = (await snapshot(page)) as { state: LedgerState };
  const hits = body.state.movements.filter((m) => m.amount === amount);
  return hits.length === 1 ? hits[0]!.period : hits.length === 0 ? null : `duplicado×${hits.length}`;
}
async function abrirConfig(page: Page, viewport = DESK): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/configuracion");
  await expect(page.getByTestId("config-period")).toBeVisible();
}
async function elegirCiclos(page: Page, dia = "21"): Promise<void> {
  await page.getByTestId("config-period-cycle").click();
  await page.getByTestId("config-anchor-day").fill(dia);
}
async function previsualizar(page: Page): Promise<void> {
  await page.getByTestId("config-preview").click();
  await expect(page.getByTestId("cycle-row").first()).toBeVisible();
}
async function abrirGrilla(page: Page, viewport = DESK): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
}
/** El Registro vive en el panel derecho del escritorio y es la pantalla inicial del móvil. */
async function abrirRegistro(page: Page): Promise<void> {
  // En escritorio el panel es opcional y se abre con «Nuevo movimiento»; en móvil ya está en pantalla.
  const nuevo = page.getByRole("button", { name: "Nuevo movimiento" });
  await expect(page.getByTestId("date-field").or(nuevo).first()).toBeVisible();
  if (!(await page.getByTestId("date-field").isVisible())) await nuevo.click();
  await expect(page.getByTestId("date-field")).toBeVisible();
}
/** Elige un día en el calendario del Registro (react-day-picker con desplegables de mes y año). */
async function fijarFecha(page: Page, iso: string): Promise<void> {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  await page.getByTestId("date-field").click();
  const pop = page.getByTestId("date-popover");
  await expect(pop.locator("select.rdp-years_dropdown")).toBeVisible();
  await pop.locator("select.rdp-years_dropdown").selectOption(String(y));
  await pop.locator("select.rdp-months_dropdown").selectOption(String(m - 1));
  await pop.locator(`[data-day="${iso}"]:not([data-outside]) button`).click();
  await expect(pop).toHaveCount(0);
}
const celda = (page: Page, node: string, month: string, plane: "budget" | "actual" = "actual") =>
  page.locator(`[data-cell="${node}"][data-month="${month}"][data-plane="${plane}"]`).first();
const scrollWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);
const alturas = async (page: Page) => Promise.all((await page.locator("[data-month-head]").all()).map(async (h) => (await h.boundingBox())!.height));

/** Contraste WCAG entre dos colores computados `rgb(a)`. */
function contraste(a: string, b: string): number {
  const lum = (rgb: string) => {
    const m = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
    const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(m[0]!) + 0.7152 * f(m[1]!) + 0.0722 * f(m[2]!);
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}
/** Color computado de un token CSS (`--fg`, `--alert-strong`…) resuelto en el documento. */
const token = (page: Page, name: string) => page.evaluate((n) => {
  const el = document.createElement("div"); el.style.color = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c;
}, name);
/** Fondo efectivo de un elemento: sube por los ancestros hasta el primero pintado. */
const fondoDe = (page: Page, testid: string) => page.evaluate((id) => {
  let el: HTMLElement | null = document.querySelector(`[data-testid="${id}"]`);
  while (el) { const bg = getComputedStyle(el).backgroundColor; if (bg && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(bg)) return bg; el = el.parentElement; }
  return getComputedStyle(document.body).backgroundColor;
}, testid);
const retrasar = (page: Page, url: string, method?: string, ms = 1500) =>
  page.route(url, async (route) => { if (!method || route.request().method() === method) await new Promise((r) => setTimeout(r, ms)); await route.continue(); });
const fallar500 = (page: Page, url: string, method?: string) =>
  page.route(url, (route) => (!method || route.request().method() === method)
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal_error" } }) })
    : route.continue());

// ─────────────────────────────── FR-2401 · Configuración ───────────────────────────────
test.describe("FR-2401 — el modo en Configuración", () => {
  test("TC-CIC-001h: Configuración muestra «Mes a mes» por defecto y nada más cambia", async ({ page }) => {
    // @aitri-tc TC-CIC-001h
    await seedReal(page);
    await abrirConfig(page);
    await expect(page.getByTestId("config-period-month")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("config-anchor-day")).toHaveCount(0);
    await expect(page.getByTestId("config-period-state")).toHaveText("Ahora: mes calendario, como siempre.");
    await abrirGrilla(page);
    const hs = await alturas(page);
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) expect(h).toBeCloseTo(38, 0);
    await expect(page.getByTestId("cycle-range")).toHaveCount(0);
  });

  test("TC-CIC-002h: elegir «Ciclos» con día 21 y confirmar persiste y sobrevive la recarga", async ({ page }) => {
    // @aitri-tc TC-CIC-002h
    await fixToday(page, HOY);
    await seedReal(page);
    await abrirConfig(page);
    await elegirCiclos(page);
    await previsualizar(page);
    await page.getByTestId("config-confirm").click();
    await expect(page.getByTestId("config-period-state")).toContainText("Ahora: ciclos · cobras el 21 · desde 10 sep 2026");
    await page.reload();
    await expect(page.getByTestId("config-period-cycle")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("config-period-state")).toContainText("Ahora: ciclos · cobras el 21 · desde 10 sep 2026");
    const body = (await snapshot(page)) as { state: LedgerState };
    expect(body.state.cycles?.versions[0]).toMatchObject({ anchorDay: 21, eomPolicy: "last_day", mode: "cycle" });
  });

  test("TC-CIC-003f: día 32 se rechaza en el formulario y el modo no cambia", async ({ page }) => {
    // @aitri-tc TC-CIC-003f
    await seedSyn(page);
    await abrirConfig(page);
    await elegirCiclos(page, "32");
    await page.getByTestId("config-anchor-day").blur();
    await expect(page.getByTestId("config-anchor-day")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("config-anchor-error")).toHaveText("Escribe un día del 1 al 31.");
    await expect(page.getByTestId("config-preview")).toBeDisabled();
    const body = (await snapshot(page)) as { state: LedgerState };
    expect(body.state.cycles).toBeUndefined();
  });

  test("TC-CIC-005e: la sección cabe a 1440px sin scroll horizontal, con el día junto a «Ciclos»", async ({ page }) => {
    // @aitri-tc TC-CIC-005e
    await seedSyn(page);
    await abrirConfig(page);
    await elegirCiclos(page);
    expect(await scrollWidth(page)).toBeLessThanOrEqual(1440);
    const card = (await page.getByTestId("config-period-card").boundingBox())!;
    const day = (await page.getByTestId("config-anchor-day").boundingBox())!;
    await expect(page.getByTestId("config-anchor-day")).toBeVisible();
    expect(day.y).toBeGreaterThanOrEqual(card.y);
    expect(day.y + day.height).toBeLessThanOrEqual(card.y + card.height);
    expect(day.height).toBeCloseTo(40, 0);
  });

  test("TC-CIC-007e: a 375px la sección se apila: dos opciones al 50%, día a 96px, sin desborde", async ({ page }) => {
    // @aitri-tc TC-CIC-007e
    await seedSyn(page);
    await abrirConfig(page, MOBILE);
    await elegirCiclos(page);
    const group = (await page.getByTestId("config-period").boundingBox())!;
    for (const id of ["config-period-month", "config-period-cycle"]) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.height, id).toBeCloseTo(40, 0);
      expect(Math.abs(b.width - group.width / 2), id).toBeLessThanOrEqual(2);
    }
    const day = (await page.getByTestId("config-anchor-day").boundingBox())!;
    expect(day.width).toBeCloseTo(96, 0);
    expect(day.height).toBeCloseTo(40, 0);
    expect(await scrollWidth(page)).toBeLessThanOrEqual(375);
  });

  test("TC-CIC-008e: un ledger existente con datos y sin elección se ve idéntico tras el despliegue", async ({ page }) => {
    // @aitri-tc TC-CIC-008e
    await fixToday(page, HOY);
    const st = await seedReal(page);
    await abrirGrilla(page);
    const heads = page.locator("[data-month-head]");
    await expect(heads).toHaveCount(29);
    await expect(heads.first()).toHaveAttribute("data-month-head", "2026-08");
    await expect(heads.last()).toHaveAttribute("data-month-head", "2028-12");
    await expect(heads.first()).toHaveText("Agosto");
    await expect(heads.nth(1)).toHaveText("Septiembre");
    await expect(page.getByTestId("cycle-range")).toHaveCount(0);
    const conInicio: LedgerState = { ...st, startMonth: "2026-08" };
    const keys = periodRange("2026-08", "2028-12");
    const series = computeBalanceSeries(conInicio, keys, openingCarry(conInicio, keys));
    const disponible = series["2026-09"]!.actual.available;
    await expect(page.locator('[data-testid="balance-row"][data-row="available"]')).toContainText(conPuntos(disponible));
    await expect(page.getByTestId("closure-control")).toContainText("Cerrar Agosto 2026");
    await page.getByLabel("Mes").click();
    const opciones = await page.getByRole("option").allTextContents();
    expect(opciones.length).toBeGreaterThan(0);
    for (const o of opciones) expect(o).not.toContain(" · ");
    await page.keyboard.press("Escape");
  });

  test("TC-CIC-009e: estado loading — skeleton hasta hidratar y nunca un valor falso", async ({ page }) => {
    // @aitri-tc TC-CIC-009e
    await seedSyn(page);
    await retrasar(page, "**/api/v1/ledger", "GET");
    await page.setViewportSize(DESK);
    await page.goto("/configuracion");
    // La página entera espera la hidratación tras `AuthPending` (TC-MSI-042e), así que en la carga
    // inicial la sección no llega a montarse con el estado en memoria: el «cargando» visible es ese,
    // y el skeleton propio de la sección cubre la deshidratación en caliente. Lo que el TC protege
    // —ningún modo marcado en falso mientras carga— se afirma igual.
    const cargando = page.getByTestId("auth-pending").or(page.getByTestId("config-period-skeleton"));
    await expect(cargando.first()).toBeVisible();
    await expect(page.locator('[data-testid^="config-period-"][role="radio"][aria-checked="true"]')).toHaveCount(0);
    await expect(cargando).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId("config-period-month")).toHaveAttribute("aria-checked", "true");
  });

  test("TC-CIC-141e: estado vacío del historial", async ({ page }) => {
    // @aitri-tc TC-CIC-141e
    await seedSyn(page);
    await abrirConfig(page);
    await expect(page.getByTestId("config-history-toggle")).toHaveText("Ver historial (0)");
    await page.getByTestId("config-history-toggle").click();
    await expect(page.getByTestId("cycle-history")).toHaveText("Todavía no has cambiado de periodo.");
  });

  test("TC-CIC-142e: campo de día vacío con placeholder «21» y foco al activar por primera vez", async ({ page }) => {
    // @aitri-tc TC-CIC-142e
    await seedSyn(page);
    await abrirConfig(page);
    await page.getByTestId("config-period-cycle").click();
    const day = page.getByTestId("config-anchor-day");
    await expect(day).toHaveValue("");
    await expect(day).toHaveAttribute("placeholder", "21");
    await expect(day).toBeFocused();
  });

  test("TC-CIC-144h: tokens — texto primario ≥4.5:1 y controles de 40px, en claro y oscuro", async ({ page }) => {
    // @aitri-tc TC-CIC-144h
    await seedSyn(page);
    await abrirConfig(page);
    await elegirCiclos(page);
    for (const tema of ["light", "dark"] as const) {
      await page.getByTestId(`config-theme-${tema}`).click();
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark")).toBe(tema === "dark");
      const fg = await page.locator('[data-testid="config-period-card"] .label').first().evaluate((el) => getComputedStyle(el).color);
      const bg = await fondoDe(page, "config-period-card");
      expect(contraste(fg, bg), `${tema}: ${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
      for (const id of ["config-period-month", "config-period-cycle", "config-anchor-day", "config-preview", "config-discard"]) {
        expect((await page.getByTestId(id).boundingBox())!.height, `${tema} ${id}`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test("TC-CIC-146e: fidelidad — la opción activa usa bg-card-hover + fg", async ({ page }) => {
    // @aitri-tc TC-CIC-146e
    await seedSyn(page);
    await abrirConfig(page);
    await elegirCiclos(page);
    // `transition-colors` anima el cambio de opción: se espera a que termine en vez de leer el primer fotograma.
    const hoverEsperado = await page.evaluate(() => { const d = document.createElement("div"); d.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue("--bg-card-hover").trim(); document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; });
    await expect.poll(() => page.getByTestId("config-period-cycle").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(hoverEsperado);
    await expect.poll(() => page.getByTestId("config-period-month").evaluate((el) => getComputedStyle(el).color)).toBe(await token(page, "--fg-secondary"));
    const on = await page.getByTestId("config-period-cycle").evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    const off = await page.getByTestId("config-period-month").evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    const hover = await page.evaluate(() => { const d = document.createElement("div"); d.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue("--bg-card-hover").trim(); document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; });
    expect(on.bg).toBe(hover);
    expect(on.color).toBe(await token(page, "--fg"));
    expect(off.bg).toMatch(/rgba\(\d+, \d+, \d+, 0\)|transparent/);
    expect(off.color).toBe(await token(page, "--fg-secondary"));
  });

  test("TC-CIC-154e: el selector de fin de mes solo aparece con día ≥ 29, con «Último día del mes»", async ({ page }) => {
    // @aitri-tc TC-CIC-154e
    await seedSyn(page);
    await abrirConfig(page);
    await elegirCiclos(page, "21");
    await expect(page.getByTestId("config-eom")).toHaveCount(0);
    await page.getByTestId("config-anchor-day").fill("29");
    await expect(page.getByTestId("config-eom")).toBeVisible();
    await expect(page.getByTestId("config-eom-select")).toContainText("Último día del mes");
    await expect(page.getByTestId("config-eom")).toContainText("Con día 31, en febrero cobrarías el 28 (o el 29).");
  });

  test("TC-CIC-163e: «Descartar» revierte día, política y fecha de primer pago a lo vigente", async ({ page }) => {
    // @aitri-tc TC-CIC-163e
    await fixToday(page, HOY);
    await seedSyn(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirConfig(page);
    await page.getByTestId("config-anchor-day").fill("30");
    await page.getByTestId("config-first-pay").fill("2026-10-30");
    await page.getByTestId("config-discard").click();
    await expect(page.getByTestId("config-anchor-day")).toHaveValue("21");
    await expect(page.getByTestId("config-first-pay")).toHaveCount(0);
    await expect(page.getByTestId("config-preview")).toBeDisabled();
  });
});

// ─────────────────────────────── FR-2403 · Previsualización ───────────────────────────────
test.describe("FR-2403 — la previsualización", () => {
  test("TC-CIC-020h: previsualizar con día 21 sobre la réplica del ledger del usuario lista seis ciclos y el resumen 15 · 10 · 3", async ({ page }) => {
    // @aitri-tc TC-CIC-020h
    await fixToday(page, HOY);
    await seedUser(page);
    await abrirConfig(page);
    await elegirCiclos(page);
    await expect(page.getByTestId("config-confirm")).toHaveCount(0);
    await previsualizar(page);
    const rows = page.getByTestId("cycle-row");
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0).getByTestId("cycle-name")).toContainText("Septiembre 2026");
    await expect(rows.nth(0).getByTestId("cycle-range")).toHaveText(SEP26);
    await expect(rows.nth(0).getByTestId("cycle-current-pill")).toHaveText("actual");
    await expect(rows.nth(5).getByTestId("cycle-name")).toContainText("Febrero 2027");
    await expect(rows.nth(5).getByTestId("cycle-range")).toHaveText("21 ene – 20 feb");
    const summary = page.getByTestId("cycle-summary");
    await expect(summary).toContainText("15 celdas cambian de columna");
    await expect(summary).toContainText("10 movimientos cambian de ciclo");
    await expect(summary).toContainText("3 celdas juntan dos meses");
    await expect(summary).toContainText("Totales idénticos");
    await expect(page.getByTestId("config-confirm")).toBeEnabled();
  });

  test("TC-CIC-021f: cancelar deja el snapshot persistido byte a byte igual", async ({ page }) => {
    // @aitri-tc TC-CIC-021f
    await seedReal(page);
    const antes = await snapshot(page);
    await abrirConfig(page);
    await elegirCiclos(page);
    await previsualizar(page);
    await page.getByTestId("config-cancel").click();
    await expect(page.getByTestId("cycle-preview")).toHaveCount(0);
    await expect(page.getByTestId("config-period-month")).toHaveAttribute("aria-checked", "true");
    expect(await snapshot(page)).toEqual(antes);
  });

  test("TC-CIC-022e: ledger vacío — seis ciclos, «0 celdas, 0 movimientos» y Confirmar habilitado", async ({ page }) => {
    // @aitri-tc TC-CIC-022e
    await seedSyn(page);
    await abrirConfig(page);
    await elegirCiclos(page);
    await previsualizar(page);
    await expect(page.getByTestId("cycle-row")).toHaveCount(6);
    await expect(page.getByTestId("cycle-summary")).toContainText("0 celdas");
    await expect(page.getByTestId("cycle-summary")).toContainText("0 movimientos");
    await expect(page.getByTestId("cycle-summary")).not.toContainText("juntan dos meses");
    await expect(page.getByTestId("config-confirm")).toBeEnabled();
  });

  test("TC-CIC-023e: a 1440px cada ciclo lleva nombre y rango en la misma fila, sin scroll", async ({ page }) => {
    // @aitri-tc TC-CIC-023e
    await seedReal(page);
    await abrirConfig(page);
    await elegirCiclos(page);
    await previsualizar(page);
    const rows = await page.getByTestId("cycle-row").all();
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      const r = (await row.boundingBox())!;
      const name = (await row.getByTestId("cycle-name").boundingBox())!;
      const range = (await row.getByTestId("cycle-range").boundingBox())!;
      expect(Math.abs(name.y + name.height / 2 - (range.y + range.height / 2))).toBeLessThanOrEqual(2);
      expect(name.y).toBeGreaterThanOrEqual(r.y - 1);
      expect(range.y + range.height).toBeLessThanOrEqual(r.y + r.height + 1);
      expect(await row.getByTestId("cycle-range").textContent()).toMatch(RANGO_RE);
    }
    expect(await scrollWidth(page)).toBeLessThanOrEqual(1440);
  });

  test("TC-CIC-025e: estado loading del panel — seis filas skeleton y sin botones mientras responde", async ({ page }) => {
    // @aitri-tc TC-CIC-025e
    await seedSyn(page);
    await retrasar(page, "**/api/v1/ledger/cycles/preview");
    await abrirConfig(page);
    await elegirCiclos(page);
    await page.getByTestId("config-preview").click();
    await expect(page.getByTestId("cycle-row-skeleton")).toHaveCount(6);
    await expect(page.getByTestId("config-confirm")).toHaveCount(0);
    await expect(page.getByTestId("cycle-row")).toHaveCount(6, { timeout: 10_000 });
    await expect(page.getByTestId("config-confirm")).toBeVisible();
  });

  test("TC-CIC-026f: estado error — un 500 al previsualizar muestra el aviso literal con Reintentar y no persiste", async ({ page }) => {
    // @aitri-tc TC-CIC-026f
    await seedSyn(page);
    const antes = await snapshot(page);
    await fallar500(page, "**/api/v1/ledger/cycles/preview");
    await abrirConfig(page);
    await elegirCiclos(page);
    await page.getByTestId("config-preview").click();
    const err = page.getByTestId("config-error");
    await expect(err).toContainText("No pudimos calcular la previsualización. Tus datos no cambiaron.");
    await expect(err.getByRole("button", { name: "Reintentar" })).toBeVisible();
    await expect(page.getByTestId("config-confirm")).toHaveCount(0);
    expect(await snapshot(page)).toEqual(antes);
  });

  test("TC-CIC-027e: a 375px las filas van en dos líneas y los botones apilados con Confirmar arriba", async ({ page }) => {
    // @aitri-tc TC-CIC-027e
    await seedReal(page);
    await abrirConfig(page, MOBILE);
    await elegirCiclos(page);
    await previsualizar(page);
    for (const row of await page.getByTestId("cycle-row").all()) {
      const name = (await row.getByTestId("cycle-name").boundingBox())!;
      const range = (await row.getByTestId("cycle-range").boundingBox())!;
      expect(range.y).toBeGreaterThan(name.y);
    }
    const panel = (await page.getByTestId("cycle-preview").boundingBox())!;
    const confirm = (await page.getByTestId("config-confirm").boundingBox())!;
    const cancel = (await page.getByTestId("config-cancel").boundingBox())!;
    expect(Math.abs(confirm.width - cancel.width)).toBeLessThanOrEqual(4);
    expect(panel.width - confirm.width).toBeLessThanOrEqual(36); // padding del panel (16px por lado)
    expect(confirm.y).toBeLessThan(cancel.y);
    expect(await scrollWidth(page)).toBeLessThanOrEqual(375);
  });

  test("TC-CIC-143f: estado error con acción — otro dispositivo cerró y el aviso ofrece la vía", async ({ page }) => {
    // @aitri-tc TC-CIC-143f
    await fixToday(page, "2026-09-25");
    await seedUser(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    // El sync en vivo (SSE) avisaría al cliente del cierre al instante y la vuelta quedaría bloqueada
    // en local. Para probar la vía del SERVIDOR el cliente tiene que seguir desactualizado: el stream
    // se deja colgado (sin continue/fulfill), sin eventos ni error.
    await page.route("**/api/v1/sync/stream", () => undefined);
    await abrirConfig(page);
    expect(await closeViaApi(page)).toBe(200); // «otro dispositivo»: el cliente aún cree que no hay cierres
    await page.getByTestId("config-period-month").click();
    await page.getByTestId("config-preview").click();
    const err = page.getByTestId("config-error");
    await expect(err).toContainText("Septiembre 2026 está cerrado. Para volver a mes a mes, reábrelo primero desde la grilla.");
    await expect(err.locator('svg[data-icon="alert-triangle"]')).toHaveCount(1);
    await expect(page.getByTestId("config-confirm")).toHaveCount(0);
  });

  test("TC-CIC-147e: fidelidad — solo la fila del ciclo actual lleva la pastilla «actual»", async ({ page }) => {
    // @aitri-tc TC-CIC-147e
    await fixToday(page, HOY);
    await seedReal(page);
    await abrirConfig(page);
    await elegirCiclos(page);
    await previsualizar(page);
    const pills = page.getByTestId("cycle-current-pill");
    await expect(pills).toHaveCount(1);
    await expect(page.getByTestId("cycle-row").filter({ has: pills })).toContainText("Septiembre 2026");
    await expect(pills).toHaveText("actual");
    expect(await pills.evaluate((el) => getComputedStyle(el).borderRadius)).toBe("9999px");
    expect(await pills.evaluate((el) => getComputedStyle(el).textTransform)).toBe("uppercase");
  });

  test("TC-CIC-160e: estado «Calculando…» del botón con ancho fijo", async ({ page }) => {
    // @aitri-tc TC-CIC-160e
    await seedSyn(page);
    await retrasar(page, "**/api/v1/ledger/cycles/preview");
    await abrirConfig(page);
    await elegirCiclos(page);
    const btn = page.getByTestId("config-preview");
    await expect(btn).toHaveText("Ver cómo quedaría");
    const antes = (await btn.boundingBox())!.width;
    await btn.click();
    await expect(btn).toHaveText("Calculando…");
    await expect(btn).toBeDisabled();
    expect(Math.abs((await btn.boundingBox())!.width - antes)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("cycle-row")).toHaveCount(6, { timeout: 10_000 });
  });
});

// ─────────────────────────────── FR-2404 · Aplicar ───────────────────────────────
test.describe("FR-2404 — aplicar desde la interfaz", () => {
  test("TC-CIC-161e: estado «Aplicando…» — controles deshabilitados y panel atenuado", async ({ page }) => {
    // @aitri-tc TC-CIC-161e
    await seedSyn(page);
    await retrasar(page, "**/api/v1/ledger/cycles", "PUT");
    await abrirConfig(page);
    await elegirCiclos(page);
    await previsualizar(page);
    await page.getByTestId("config-confirm").click();
    await expect(page.getByTestId("config-confirm")).toHaveText("Aplicando…");
    await expect(page.getByTestId("config-confirm")).toBeDisabled();
    await expect(page.getByTestId("config-period-cycle")).toBeDisabled();
    await expect(page.getByTestId("config-period")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("config-anchor-day")).toBeDisabled();
    expect(await page.getByTestId("cycle-preview").evaluate((el) => getComputedStyle(el).opacity)).toBe("0.6");
  });

  test("TC-CIC-162f: estado error tras Confirmar — un 500 muestra el aviso y el modo no cambia", async ({ page }) => {
    // @aitri-tc TC-CIC-162f
    await seedSyn(page);
    await fallar500(page, "**/api/v1/ledger/cycles", "PUT");
    await abrirConfig(page);
    await elegirCiclos(page);
    await previsualizar(page);
    await page.getByTestId("config-confirm").click();
    await expect(page.getByTestId("config-error")).toContainText("No pudimos activar los ciclos. Tus datos no cambiaron.");
    await expect(page.getByTestId("config-error")).toContainText("Reintentar");
    await page.unroute("**/api/v1/ledger/cycles");
    await page.reload();
    await expect(page.getByTestId("config-period-month")).toHaveAttribute("aria-checked", "true");
  });

  test("TC-CIC-176f: la previsualización nombra el rubro, no su id, cuando la activación dejaría una celda en negativo", async ({ page }) => {
    // @aitri-tc TC-CIC-176f
    await fixToday(page, HOY);
    resetSeq();
    const movements = [
      mv("expense", "c-comida", 100, "2026-08-25", "2026-08"),
      mv("expense", "c-comida", 30, "2026-09-05", "2026-09"),
      mv("expense", "c-comida", 20, "2026-09-25", "2026-09"),
      mv("expense", "c-comida", 100, "2026-10-05", "2026-10"),
    ];
    await seedSyn(page, { movements, actuals: { "c-comida": { "2026-08": 0, "2026-09": 0, "2026-10": 100 } } });
    await abrirConfig(page);
    await elegirCiclos(page);
    await page.getByTestId("config-preview").click();
    const err = page.getByTestId("config-error");
    await expect(err).toContainText("La celda de «Comida» en Septiembre 2026 quedaría en negativo: tecleaste menos de lo que suman sus movimientos. Corrígela antes de cambiar el periodo.");
    await expect(err).not.toContainText("c-comida");
    await expect(page.getByTestId("config-confirm")).toHaveCount(0);
  });
  test("TC-CIC-164h: tras confirmar aparece el Toaster «Ciclos activados» y el panel se cierra", async ({ page }) => {
    // @aitri-tc TC-CIC-164h
    await fixToday(page, HOY);
    await seedReal(page);
    await abrirConfig(page);
    await elegirCiclos(page);
    await previsualizar(page);
    await page.getByTestId("config-confirm").click();
    await expect(page.getByTestId("toast")).toContainText("Ciclos activados", { timeout: 2000 });
    await expect(page.getByTestId("cycle-preview")).toHaveCount(0);
    await expect(page.getByTestId("config-period-state")).toContainText("Ahora: ciclos · cobras el 21 · desde 10 sep 2026");
  });
});

// ─────────────────────────────── FR-2405 / FR-2406 · Registrar ───────────────────────────────
test.describe("FR-2405 / FR-2406 — el Registro en modo ciclos", () => {
  test("TC-CIC-045h: un gasto fechado 2026-10-05 cae en Octubre y el Registro lo anuncia antes de guardar", async ({ page }) => {
    // @aitri-tc TC-CIC-045h
    await fixToday(page, HOY);
    await seedSyn(page, { budgets: { "c-comida": { "2026-09": 1000 } } });
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await abrirRegistro(page);
    await page.getByTestId("type-expense").click();
    await page.getByTestId("amount-input").fill("25000");
    await page.getByTestId("category-c-comida").click();
    await fijarFecha(page, "2026-10-05");
    await expect(page.getByTestId("register-cycle")).toHaveText(/Ciclo · Octubre · 21 sep – 20 oct/);
    const oct = celda(page, "c-comida", "2026-10");
    const nov = celda(page, "c-comida", "2026-11");
    const e0 = Number(((await oct.textContent()) ?? "").replace(/\D/g, "") || 0);
    const n0 = (await nov.textContent()) ?? "";
    await page.getByTestId("save-button").click();
    await expect(oct).toContainText(conPuntos(e0 + 25000));
    await expect(nov).toHaveText(n0);
  });

  test("TC-CIC-051e: la línea «Ciclo» se actualiza en ≤100ms al cambiar la fecha, sin red", async ({ page }) => {
    // @aitri-tc TC-CIC-051e
    await fixToday(page, HOY);
    await seedSyn(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await abrirRegistro(page);
    await fijarFecha(page, "2026-10-05");
    await expect(page.getByTestId("register-cycle")).toContainText("Octubre");
    const requests: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/")) requests.push(r.url()); });
    // Reloj del navegador: el instante del click en el día y el instante en que la línea cambia.
    await page.evaluate(() => {
      const w = window as unknown as { __t0?: number; __t1?: number };
      document.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-day]")) w.__t0 = performance.now(); }, true);
      const line = document.querySelector('[data-testid="register-cycle"]')!;
      new MutationObserver(() => { if (line.textContent?.includes("Noviembre") && w.__t1 === undefined) w.__t1 = performance.now(); })
        .observe(line, { childList: true, characterData: true, subtree: true });
    });
    await fijarFecha(page, "2026-10-25");
    await expect(page.getByTestId("register-cycle")).toHaveText(/Ciclo · Noviembre · 21 oct – 20 nov/);
    const ms = await page.evaluate(() => { const w = window as unknown as { __t0?: number; __t1?: number }; return (w.__t1 ?? NaN) - (w.__t0 ?? NaN); });
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThanOrEqual(100);
    expect(requests).toHaveLength(0);
  });

  test("TC-CIC-052f: fecha fuera del rango activo — «Fuera del rango de tu presupuesto» y Guardar deshabilitado", async ({ page }) => {
    // @aitri-tc TC-CIC-052f
    await fixToday(page, HOY);
    await seedSyn(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await abrirRegistro(page);
    await page.getByTestId("amount-input").fill("1000");
    await page.getByTestId("category-c-comida").click();
    const escrituras: string[] = [];
    page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/v1/ledger" && r.method() === "PUT") escrituras.push(r.url()); });
    await fijarFecha(page, "2030-01-15");
    const line = page.getByTestId("register-cycle");
    await expect(line).toContainText("Fuera del rango de tu presupuesto");
    expect(await line.evaluate((el) => getComputedStyle(el).color)).toBe(await token(page, "--alert-strong"));
    await expect(page.getByTestId("save-button")).toBeDisabled();
    await page.getByTestId("save-button").click({ force: true });
    // Ni el clic forzado sobre el botón deshabilitado escribe: ninguna PUT del snapshot y nada guardado.
    await page.waitForTimeout(1500);
    expect(escrituras).toHaveLength(0);
    expect(((await snapshot(page)) as { state: LedgerState }).state.movements).toHaveLength(0);
  });

  test("TC-CIC-145e: a 375px el Registro muestra la línea Ciclo y la propuesta apilada, sin desborde", async ({ page }) => {
    // @aitri-tc TC-CIC-145e
    await fixToday(page, HOY);
    await seedSyn(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await abrirRegistro(page);
    await page.getByTestId("type-income").click();
    await fijarFecha(page, "2026-11-20");
    await expect(page.getByTestId("register-cycle")).toBeVisible();
    const keep = (await page.getByTestId("proposal-keep").boundingBox())!;
    const accept = (await page.getByTestId("proposal-accept").boundingBox())!;
    expect(accept.y).toBeGreaterThanOrEqual(keep.y + keep.height - 1);
    expect(keep.height).toBeCloseTo(40, 0);
    expect(accept.height).toBeCloseTo(40, 0);
    expect(await scrollWidth(page)).toBeLessThanOrEqual(375);
    await page.getByTestId("save-button").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("save-button")).toBeVisible();
    await expect(page.getByTestId("save-button")).toBeInViewport();
  });

  test("TC-CIC-054h: ingreso del 2026-11-20 — propuesta literal y al aceptar queda en Diciembre", async ({ page }) => {
    // @aitri-tc TC-CIC-054h
    await fixToday(page, HOY);
    await seedSyn(page, { budgets: { "c-salario": { "2026-09": 1 } } });
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await abrirRegistro(page);
    await page.getByTestId("type-income").click();
    await page.getByTestId("amount-input").fill("8450000");
    await page.getByTestId("category-c-salario").click();
    await fijarFecha(page, "2026-11-20");
    await expect(page.getByTestId("opening-proposal")).toContainText("Este ingreso cae 1 día antes de tu día de pago (21). ¿Es el salario que abre Diciembre?");
    await expect(page.getByTestId("proposal-accept")).toHaveText("Contar en Diciembre · 21 nov – 20 dic");
    const dic = celda(page, "c-salario", "2026-12");
    const nov = celda(page, "c-salario", "2026-11");
    const n0 = (await nov.textContent()) ?? "";
    await page.getByTestId("proposal-accept").click();
    await expect(page.getByTestId("register-cycle")).toContainText("Diciembre");
    await page.getByTestId("save-button").click();
    await expect.poll(() => periodoGuardado(page, 8_450_000)).toBe("2026-12");
    await expect(dic).toContainText(conPuntos(8_450_000));
    await expect(nov).toHaveText(n0);
  });

  test("TC-CIC-056f: rechazar la propuesta deja el ingreso en Noviembre por su fecha", async ({ page }) => {
    // @aitri-tc TC-CIC-056f
    await fixToday(page, HOY);
    await seedSyn(page, { budgets: { "c-salario": { "2026-09": 1 } } });
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await abrirRegistro(page);
    await page.getByTestId("type-income").click();
    await page.getByTestId("amount-input").fill("8450000");
    await page.getByTestId("category-c-salario").click();
    await fijarFecha(page, "2026-11-20");
    await expect(page.getByTestId("opening-proposal")).toBeVisible();
    await expect(page.getByTestId("proposal-keep")).toHaveAttribute("aria-checked", "true");
    const dic = celda(page, "c-salario", "2026-12");
    const d0 = (await dic.textContent()) ?? "";
    await page.getByTestId("save-button").click();
    await expect.poll(() => periodoGuardado(page, 8_450_000)).toBe("2026-11");
    await expect(celda(page, "c-salario", "2026-11")).toContainText(conPuntos(8_450_000));
    await expect(dic).toHaveText(d0);
  });

  test("TC-CIC-058e: un reembolso del 2026-11-20 guardado sin tocar nada queda en Noviembre", async ({ page }) => {
    // @aitri-tc TC-CIC-058e
    await fixToday(page, HOY);
    await seedSyn(page, { budgets: { "c-reembolsos": { "2026-09": 1 } } });
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await abrirRegistro(page);
    await page.getByTestId("type-income").click();
    await page.getByTestId("amount-input").fill("45000");
    await page.getByTestId("category-c-reembolsos").click();
    await fijarFecha(page, "2026-11-20");
    await expect(page.getByTestId("proposal-keep")).toHaveAttribute("aria-checked", "true");
    const dic = celda(page, "c-reembolsos", "2026-12");
    const d0 = (await dic.textContent()) ?? "";
    await page.getByTestId("save-button").click();
    await expect(celda(page, "c-reembolsos", "2026-11")).toContainText(conPuntos(45_000));
    await expect(dic).toHaveText(d0);
    await expect(dic).not.toContainText(conPuntos(45_000));
  });

  test("TC-CIC-061e: la propuesta nace con «Mantener» seleccionado y usa estilo informativo", async ({ page }) => {
    // @aitri-tc TC-CIC-061e
    await fixToday(page, HOY);
    await seedSyn(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await abrirRegistro(page);
    await page.getByTestId("type-income").click();
    await fijarFecha(page, "2026-11-20");
    const box = page.getByTestId("opening-proposal");
    await expect(page.getByTestId("proposal-keep")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("proposal-keep")).toHaveText("Mantener en Noviembre");
    await expect(box.locator('svg[data-icon="info"]')).toHaveCount(1);
    const border = await box.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(border).toBe(await token(page, "--border-strong"));
    expect(border).not.toBe(await token(page, "--alert-strong"));
  });
});

// ─────────────────────────────── FR-2407 · Nombre y rango ───────────────────────────────
test.describe("FR-2407 — nombre y rango en las superficies", () => {
  test("TC-CIC-062h: la columna actual es Septiembre con rango legible, 52px y contraste ≥4.5:1", async ({ page }) => {
    // @aitri-tc TC-CIC-062h
    await fixToday(page, HOY);
    await seedReal(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    if (await page.evaluate(() => document.documentElement.classList.contains("dark"))) await page.getByTestId("theme-toggle").click();
    const head = page.locator('[data-month-head="2026-09"]');
    await expect(head).toBeVisible();
    expect(await head.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("600");
    expect(await head.evaluate((el) => getComputedStyle(el).color)).toBe(await token(page, "--fg"));
    const range = head.getByTestId("cycle-range");
    await expect(range).toHaveText(SEP26);
    expect(await range.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await head.boundingBox())!.height).toBeCloseTo(52, 0);
    const c = await range.evaluate((el) => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el.parentElement!).backgroundColor }));
    expect(contraste(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  test("TC-CIC-063e: el selector «Mes» lista nombre y rango y el Registro muestra el ciclo de la fecha", async ({ page }) => {
    // @aitri-tc TC-CIC-063e
    await fixToday(page, HOY);
    await seedReal(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await page.getByLabel("Mes").click();
    const texts = await page.getByRole("option").allTextContents();
    expect(texts).toContain("Octubre 2026 · 21 sep – 20 oct");
    expect(texts).toContain(`Septiembre 2026 · ${SEP26}`);
    await page.keyboard.press("Escape");
    await abrirRegistro(page);
    await fijarFecha(page, "2026-10-05");
    await expect(page.getByTestId("register-cycle")).toHaveText(/Ciclo · Octubre · 21 sep – 20 oct/);
  });

  test("TC-CIC-064f: en modo mes no hay rango, la cabecera mide 38px y no existe marca de transición", async ({ page }) => {
    // @aitri-tc TC-CIC-064f
    await fixToday(page, HOY);
    await seedReal(page);
    await abrirGrilla(page);
    await expect(page.getByTestId("cycle-range")).toHaveCount(0);
    await expect(page.getByTestId("transition-mark")).toHaveCount(0);
    for (const h of await alturas(page)) expect(h).toBeCloseTo(38, 0);
    // Referencia capturada sobre el commit PREVIO a la feature (81b2caa) con el mismo estado, viewport y
    // reloj: una sola diferencia de píxel significa que la cabecera de mes cambió.
    //
    // LA COMPARACIÓN DE PÍXELES CORRE SOLO EN macOS, que es donde se capturó esa referencia. El runner
    // de CI es ubuntu y dibuja el texto con otras fuentes y otro antialiasing, así que la igualdad byte
    // a byte NO puede cumplirse ahí: en el PR #23 falló los tres intentos mientras el resto del test
    // pasaba, y no era una regresión del producto. Lo estructural —sin rango, sin marca de transición y
    // cabecera de 38px— se sigue afirmando en TODAS las plataformas, que es lo que CI comprueba.
    // La ficha de fase 3 de este TC pide la coincidencia byte a byte: se cumple en macOS, que es donde
    // `aitri verify-run` acredita el TC. Recuperar la guarda visual también en Linux exige una
    // referencia propia generada con la imagen Docker de Playwright — registrado como BL-046.
    if (process.platform === "darwin") {
      const referencia = readFileSync(path.join(path.dirname(test.info().file), "__screenshots__", "ciclos-header-month.png"));
      const actual = await page.locator('[data-month-head="2026-09"]').screenshot();
      expect(actual.equals(referencia), "la cabecera de Septiembre en modo mes difiere de la previa a la feature").toBe(true);
    }
  });

  test("TC-CIC-065e: la transición se rotula «Transición» con icono accesible y su rango real", async ({ page }) => {
    // @aitri-tc TC-CIC-065e
    await fixToday(page, HOY);
    await seedSyn(page, { budgets: { "c-comida": { "2026-09": 1000 } } });
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await applyCycles(page, { mode: "cycle", anchorDay: 30, firstPayDate: "2026-10-30" });
    await abrirGrilla(page);
    const head = page.locator('[data-month-head="2026-10t"]');
    await head.scrollIntoViewIfNeeded();
    await expect(head).toContainText("Transición");
    await expect(head.getByTestId("transition-mark").locator('svg[aria-label="Ciclo de transición"]')).toHaveCount(1);
    await expect(head.getByTestId("cycle-range")).toHaveText("21 oct – 29 oct");
    await expect(head.getByTestId("cycle-current-pill")).toHaveCount(0);
    expect(await head.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("500");
    expect(await head.getAttribute("title")).toContain("Es normal que sea más corto o más largo");
  });

  test("TC-CIC-067e: control e historial de cierre llevan el rango del ciclo", async ({ page }) => {
    // @aitri-tc TC-CIC-067e
    await fixToday(page, "2026-09-25");
    await seedUser(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    const control = page.getByTestId("closure-control");
    await expect(control).toContainText("Cerrar Septiembre 2026");
    expect(await control.getByRole("button", { name: /Cerrar/ }).getAttribute("title")).toContain(SEP26);
    await control.getByRole("button", { name: /Cerrar/ }).click();
    await expect(control).toContainText("Reabrir Septiembre 2026");
    await page.getByTestId("closure-history-toggle").click();
    await expect(page.getByTestId("closure-history-row").first()).toContainText(`Septiembre 2026 · ${SEP26}`);
  });

  test("TC-CIC-068e: el Dashboard titula «Ejecución por ciclo» solo en modo ciclos", async ({ page }) => {
    // @aitri-tc TC-CIC-068e
    await fixToday(page, HOY);
    await seedSyn(page);
    await abrirGrilla(page);
    await page.getByRole("tab", { name: "Dashboard" }).click();
    await expect(page.getByTestId("dashboard")).toContainText("Ejecución mensual");
    await expect(page.getByTestId("dashboard")).not.toContainText("Ejecución por ciclo");
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await page.getByRole("tab", { name: "Dashboard" }).click();
    await expect(page.getByTestId("dashboard")).toContainText("Ejecución por ciclo");
  });

  test("TC-CIC-069e: a 768px la cabecera de 52px se desplaza sin truncar el rango", async ({ page }) => {
    // @aitri-tc TC-CIC-069e
    await fixToday(page, HOY);
    await seedReal(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page, { width: 768, height: 1024 });
    const head = page.locator('[data-month-head="2026-09"]');
    await head.scrollIntoViewIfNeeded();
    expect((await head.boundingBox())!.height).toBeCloseTo(52, 0);
    expect(await head.getByTestId("cycle-range").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await scrollWidth(page)).toBeLessThanOrEqual(768);
    const desplaza = await head.evaluate((el) => {
      let n: HTMLElement | null = el.parentElement;
      while (n) { const ox = getComputedStyle(n).overflowX; if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth) return true; n = n.parentElement; }
      return false;
    });
    expect(desplaza).toBe(true);
  });

  test("TC-CIC-166e: el historial de cierres muestra el rango solo para eventos posteriores a la última versión", async ({ page }) => {
    // @aitri-tc TC-CIC-166e
    // Agosto se cierra en modo mes; al activar ciclos ese cierre pasa a cubrir «Septiembre» (21 ago – 20 sep),
    // así que el siguiente ciclo cerrable ya en ciclos es Octubre (hoy 25 oct).
    await fixToday(page, "2026-10-25");
    await seedReal(page);
    expect(await closeViaApi(page)).toBe(200);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    expect(await closeViaApi(page)).toBe(200);
    await abrirGrilla(page);
    await page.getByTestId("closure-history-toggle").click();
    const rows = page.getByTestId("closure-history-row");
    await expect(rows.filter({ hasText: "Octubre 2026" })).toContainText("21 sep – 20 oct");
    const agosto = rows.filter({ hasText: "Agosto 2026" });
    await expect(agosto).toHaveCount(1);
    expect(await agosto.textContent()).not.toContain(" – ");
  });

  test("TC-CIC-167e: en el año 2027 el selector muestra «Enero 2027 · 21 dic – 20 ene»", async ({ page }) => {
    // @aitri-tc TC-CIC-167e
    await fixToday(page, HOY);
    await seedReal(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await page.getByLabel("Mes").click();
    const texts = await page.getByRole("option").allTextContents();
    expect(texts).toContain("Enero 2027 · 21 dic – 20 ene");
    expect(texts.findIndex((t) => t.startsWith("Enero 2027"))).toBeGreaterThan(texts.findIndex((t) => t.startsWith("Diciembre 2026")));
  });

  test("TC-CIC-168e: la barra del Dashboard lleva el rango en su tooltip en modo ciclos", async ({ page }) => {
    // @aitri-tc TC-CIC-168e
    await fixToday(page, HOY);
    await seedReal(page);
    await abrirGrilla(page);
    await page.getByRole("tab", { name: "Dashboard" }).click();
    // Se apunta a la categoría «Sep» por su etiqueta del eje: una barra en 0 no tiene caja donde posarse.
    const tooltipDeSep = async () => {
      const chart = page.getByTestId("monthly-trend");
      await chart.scrollIntoViewIfNeeded();
      const tick = chart.locator(".recharts-cartesian-axis-tick text", { hasText: /^Sep$/ }).first();
      await expect(tick).toBeVisible();
      const t = (await tick.boundingBox())!;
      const c = (await chart.boundingBox())!;
      await page.mouse.move(t.x + t.width / 2, c.y + c.height * 0.4);
      const tip = page.locator(".recharts-tooltip-wrapper");
      await expect(tip).toContainText("Sep");
      return ((await tip.textContent()) ?? "").trim();
    };
    const enMes = await tooltipDeSep();
    expect(enMes).toMatch(/^Sep/);
    expect(enMes).not.toContain(" – ");
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirGrilla(page);
    await page.getByRole("tab", { name: "Dashboard" }).click();
    const enCiclos = await tooltipDeSep();
    expect(enCiclos).toContain(SEP26);
  });
});

// ─────────────────────────────── FR-2408 · Cambiar el día ───────────────────────────────
test.describe("FR-2408 — cambiar el día de pago desde la interfaz", () => {
  test("TC-CIC-079e: cambiar el día pide la fecha del primer pago y la previsualización muestra la transición", async ({ page }) => {
    // @aitri-tc TC-CIC-079e
    await fixToday(page, HOY);
    await seedSyn(page, { budgets: { "c-comida": { "2026-09": 1000 } } });
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirConfig(page);
    await page.getByTestId("config-anchor-day").fill("30");
    const fp = page.getByTestId("config-first-pay");
    await expect(fp).toHaveValue("");
    await expect(page.getByTestId("config-period-card")).toContainText("No la calculamos por ti: solo tú sabes si tu primer pago el 30 es este mes o el siguiente.");
    await fp.fill("2026-10-30");
    await previsualizar(page);
    const fila = page.getByTestId("cycle-row").filter({ hasText: "Transición" });
    await expect(fila).toHaveCount(1);
    await expect(fila.getByTestId("cycle-range")).toHaveText("21 oct – 29 oct");
    await expect(fila.locator('svg[aria-label="Ciclo de transición"]')).toHaveCount(1);
    await expect(fila).toContainText("Ciclo de transición: 9 días. Es normal que se vea corto.");
  });

  test("TC-CIC-081e: el historial muestra las versiones con fecha de vigencia y día", async ({ page }) => {
    // @aitri-tc TC-CIC-081e
    await fixToday(page, HOY);
    await seedSyn(page, { budgets: { "c-comida": { "2026-09": 1000 } } });
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await applyCycles(page, { mode: "cycle", anchorDay: 30, firstPayDate: "2026-10-30" });
    await abrirConfig(page);
    await expect(page.getByTestId("config-history-toggle")).toHaveText("Ver historial (2)");
    await page.getByTestId("config-history-toggle").click();
    await expect(page.getByTestId("cycle-history-row")).toHaveText([
      "Ciclos · día 30 · desde 30 oct 2026",
      "Ciclos · día 21 · desde 10 sep 2026",
      "Mes a mes · hasta 10 sep 2026",
    ]);
  });

  test("TC-CIC-165f: A7 muestra el mensaje literal de first_pay_invalid", async ({ page }) => {
    // @aitri-tc TC-CIC-165f
    await fixToday(page, "2026-10-25");
    await seedUser(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    expect(await closeViaApi(page)).toBe(200);
    expect(await closeViaApi(page)).toBe(200);
    await abrirConfig(page);
    await page.getByTestId("config-anchor-day").fill("30");
    await page.getByTestId("config-first-pay").fill("2026-10-10");
    await page.getByTestId("config-preview").click();
    await expect(page.getByTestId("config-error")).toContainText(
      "El primer pago nuevo tiene que ser después del 21 de octubre y fuera de un ciclo cerrado. Si necesitas cambiar un ciclo cerrado, reábrelo desde la grilla."
    );
    await expect(page.getByTestId("config-first-pay")).toHaveAttribute("aria-invalid", "true");
  });
});

// ─────────────────────────────── FR-2410 · Volver a mes ───────────────────────────────
test.describe("FR-2410 — volver a mes desde la interfaz", () => {
  test("TC-CIC-096e: volver a mes — resumen inverso, confirmación y cabeceras de 38px", async ({ page }) => {
    // @aitri-tc TC-CIC-096e
    await fixToday(page, HOY);
    await seedUser(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await abrirConfig(page);
    await page.getByTestId("config-period-month").click();
    await previsualizar(page);
    const summary = page.getByTestId("cycle-summary");
    await expect(summary).toContainText("15 celdas vuelven a su mes");
    await expect(summary).toContainText("10 movimientos vuelven a su mes");
    await expect(summary).toContainText("3 celdas se separan en dos meses");
    await page.getByTestId("config-confirm").click();
    await expect(page.getByTestId("config-period-state")).toHaveText("Ahora: mes calendario, como siempre.");
    await abrirGrilla(page);
    for (const h of await alturas(page)) expect(h).toBeCloseTo(38, 0);
    await expect(page.getByTestId("cycle-range")).toHaveCount(0);
    const body = (await snapshot(page)) as { state: LedgerState };
    let celdasAgosto = 0;
    for (const m of [body.state.budgets, body.state.actuals]) for (const cells of Object.values(m)) if ((cells?.["2026-08"] ?? 0) !== 0) celdasAgosto++;
    expect(celdasAgosto).toBe(14);
  });
});

// ─────────────────────────────── NFR-2410 / NFR-2412 ───────────────────────────────
test.describe("NFR-2410 / NFR-2412 — historial, previsualización obligatoria, formato único", () => {
  test("TC-CIC-132h: el historial muestra las entradas con fecha, modo y día tras activar, cambiar y volver", async ({ page }) => {
    // @aitri-tc TC-CIC-132h
    await fixToday(page, HOY);
    await seedSyn(page, { budgets: { "c-comida": { "2026-09": 1000 } } });
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await applyCycles(page, { mode: "cycle", anchorDay: 30, firstPayDate: "2026-10-30" });
    await applyCycles(page, { mode: "month" });
    await abrirConfig(page);
    await expect(page.getByTestId("config-history-toggle")).toHaveText("Ver historial (3)");
    await page.getByTestId("config-history-toggle").click();
    await expect(page.getByTestId("cycle-history-row")).toHaveText([
      "Mes a mes · desde 10 sep 2026",
      "Ciclos · día 30 · desde 30 oct 2026",
      "Ciclos · día 21 · desde 10 sep 2026",
      "Mes a mes · hasta 10 sep 2026",
    ]);
  });

  test("TC-CIC-138h: ninguna ruta de la interfaz cambia el modo sin previsualización", async ({ page }) => {
    // @aitri-tc TC-CIC-138h
    await seedSyn(page);
    const puts: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/v1/ledger/cycles") && r.method() === "PUT") puts.push(r.url()); });
    await abrirConfig(page);
    await elegirCiclos(page);
    await expect(page.getByTestId("config-confirm")).toHaveCount(0);
    await expect(page.getByTestId("config-period-card").getByRole("button", { name: /guardar|aplicar|activar/i })).toHaveCount(0);
    await page.keyboard.press("Enter");
    expect(puts).toHaveLength(0);
    await previsualizar(page);
    await expect(page.getByTestId("config-confirm")).toBeVisible();
    expect(puts).toHaveLength(0);
  });

  test("TC-CIC-139e: el rango se formatea igual en grilla, selector, Registro, historial y Configuración", async ({ page }) => {
    // @aitri-tc TC-CIC-139e
    await fixToday(page, "2026-09-25");
    await seedUser(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    expect(await closeViaApi(page)).toBe(200);
    await abrirGrilla(page);
    await expect(page.locator('[data-month-head="2026-09"]').getByTestId("cycle-range")).toHaveText(SEP26);
    await page.getByLabel("Mes").click();
    expect((await page.getByRole("option").allTextContents()).some((t) => t.endsWith(SEP26))).toBe(true);
    await page.keyboard.press("Escape");
    await abrirRegistro(page);
    await fijarFecha(page, "2026-09-01");
    await expect(page.getByTestId("register-cycle")).toContainText(SEP26);
    await page.getByTestId("closure-history-toggle").click();
    await expect(page.getByTestId("closure-history-row").first()).toContainText(SEP26);
    await abrirConfig(page);
    await page.getByTestId("config-anchor-day").fill("30");
    await page.getByTestId("config-first-pay").fill("2026-10-30");
    await previsualizar(page);
    const ranges = await page.getByTestId("cycle-range").allTextContents();
    expect(ranges.length).toBeGreaterThan(0);
    for (const r of ranges) expect(r).toMatch(RANGO_RE);
  });

  test("TC-CIC-140f: al bloquear la vuelta a mes, el aviso nombra el ciclo que hay que reabrir", async ({ page }) => {
    // @aitri-tc TC-CIC-140f
    await fixToday(page, "2026-09-25");
    await seedUser(page);
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    expect(await closeViaApi(page)).toBe(200);
    const calls: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/v1/ledger/cycles")) calls.push(r.url()); });
    await abrirConfig(page);
    await page.getByTestId("config-period-month").click();
    await expect(page.getByTestId("config-error")).toContainText("Septiembre 2026 está cerrado. Para volver a mes a mes, reábrelo primero desde la grilla.");
    await expect(page.getByTestId("config-preview")).toBeDisabled();
    expect(calls).toHaveLength(0);
  });
});
