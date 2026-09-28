import { test, expect, type Page } from "./helpers/fixtures";
import { readLedger, seedLedger } from "./helpers/seed";
import type { LedgerNode } from "@/domain/types";

// Feature carril-de-presupuesto — lo que solo el NAVEGADOR puede afirmar (FR-2905, y FR-2901 a la
// vista): que el Balance muestre el arrastre por carril, que el editor de la celda Pres. de un bolsillo
// rechace como el de Ejec. (franja, valor conservado, Escape), que la pastilla «Máx.» avise mientras se
// teclea, y que un mes del plan que ya se pasa se marque en el encabezado y en la franja del Balance en
// vez del «!» ámbar de la celda. Prefijo TC-CDP-*.
//
// La aritmética vive en tests/domain/carril-de-presupuesto.test.ts; aquí, que la pantalla la muestre.
// Las celdas se localizan por sus atributos (hoja × mes × plano), no por índice de columna: el rango de
// la grilla depende del día en que corre la suite.

const DESK = { width: 1440, height: 1100 };
const TABLET = { width: 768, height: 1000 };
const MOBILE = { width: 375, height: 800 };
const OCT = "2026-10";
const NOV = "2026-11";
const DIC = "2026-12";

/** Color de `--alert-strong` y de `--fg-muted` en el tema claro, computados (globals.css). */
const ALERTA_CLARO = "rgb(173, 57, 50)";
const MUTED_CLARO = "rgb(107, 107, 115)";

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 1 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 0 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 2 },
  { id: "A", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Alcancía", icon: null, order: 0 },
];

type Seed = Parameters<typeof seedLedger>[1];

/** Octubre: el plan deja 500 (ingreso 1.000, gasto 500) y lo real 400 (ingreso 1.000, gasto 600). */
const OCTUBRE_DIVERGENTE: Seed = {
  nodes: NODES,
  budgets: { "c-salario": { [OCT]: 1000 }, "c-mercado": { [OCT]: 500 } },
  actuals: { "c-salario": { [OCT]: 1000 }, "c-mercado": { [OCT]: 600 } },
};

/** El mismo octubre con un plan LEGADO: A reserva 800 en noviembre sobre los 500 que deja el plan. */
const PLAN_LEGADO: Seed = {
  ...OCTUBRE_DIVERGENTE,
  budgets: { ...OCTUBRE_DIVERGENTE.budgets, A: { [NOV]: 800 } },
};

/** Noviembre sin cupo en el plan: octubre planea ingreso 500 y gasto 500. */
const SIN_CUPO: Seed = {
  nodes: NODES,
  budgets: { "c-salario": { [OCT]: 500 }, "c-mercado": { [OCT]: 500 } },
  actuals: {},
};

const filaDe = (page: Page, name: string) =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: name }) });

/** Idempotente: el botón se llama «Expandir» en los dos estados (ver techo-de-flujo.spec.ts). */
async function desplegarReservas(page: Page): Promise<void> {
  // Primero que la grilla esté montada con sus filas: tras un `reload` o una carga retenida, contar la
  // fila del bolsillo antes de tiempo da 0 y el clic PLEGARÍA un grupo que ya estaba abierto.
  await expect(filaDe(page, "Reservas").first()).toBeVisible();
  if (await filaDe(page, "Alcancía").count()) return;
  await filaDe(page, "Reservas").first().getByRole("button", { name: "Expandir" }).first().click();
  await expect(filaDe(page, "Alcancía")).toBeVisible();
}

const celda = (page: Page, mes: string, plano: "budget" | "actual" = "budget") =>
  page.locator(`[data-testid="cell-leaf"][data-cell="A"][data-month="${mes}"][data-plane="${plano}"]`);

const celdaBalance = (page: Page, row: string, mes: string, plano: 0 | 1) =>
  page.locator(`[data-testid="balance-row"][data-row="${row}"] [data-month="${mes}"] [data-testid="balance-cell"]`).nth(plano);

async function abrir(page: Page, seed: Seed, viewport = DESK): Promise<void> {
  await page.setViewportSize(viewport);
  await seedLedger(page, seed);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await desplegarReservas(page);
}

/** Abre el editor de la celda Pres. de A en `mes` y teclea `valor`. */
async function teclear(page: Page, mes: string, valor: string) {
  await celda(page, mes).click();
  const input = page.getByLabel("Editar valor");
  await input.fill(valor);
  return input;
}

/** Contraste WCAG entre dos colores `rgb(r, g, b)`. */
function contraste(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/\d+/g) ?? []).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test.describe("FR-2901 · el Balance muestra el arrastre por carril", () => {
  test("TC-CDP-005e: el Balance de la grilla muestra el arrastre por carril", async ({ page }) => {
    // @aitri-tc TC-CDP-005e
    await abrir(page, OCTUBRE_DIVERGENTE);
    await expect(celdaBalance(page, "prevAvailable", NOV, 0)).toHaveText("500");
    await expect(celdaBalance(page, "prevAvailable", NOV, 1)).toHaveText("400");
  });
});

test.describe("FR-2905 · el editor Pres. rechaza como el de Ejec.", () => {
  test("TC-CDP-040h: rechazo en Pres. — el editor sigue abierto con la franja", async ({ page }) => {
    // @aitri-tc TC-CDP-040h
    await abrir(page, OCTUBRE_DIVERGENTE);
    const input = await teclear(page, NOV, "501");
    // El tiempo se mide DENTRO de la página, del Enter a la franja, para no contar el viaje de Playwright.
    await page.evaluate(() => {
      const w = window as unknown as { __t0?: number; __t1?: number };
      document.addEventListener("keydown", (e) => { if (e.key === "Enter") w.__t0 = performance.now(); }, { capture: true, once: true });
      new MutationObserver((_, obs) => {
        if (document.querySelector('[data-testid="reserve-block"]')) { w.__t1 = performance.now(); obs.disconnect(); }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.keyboard.press("Enter");
    const franja = page.getByTestId("reserve-block");
    await expect(franja).toHaveText("Esta celda admite hasta $500 este mes");
    const ms = await page.evaluate(() => {
      const w = window as unknown as { __t0?: number; __t1?: number };
      return (w.__t1 ?? Infinity) - (w.__t0 ?? 0);
    });
    expect(ms).toBeLessThanOrEqual(150);
    await expect(input).toHaveValue("501");
    expect((await readLedger(page))?.budgets.A?.[NOV]).toBeUndefined();
  });

  test("TC-CDP-041h: Escape tras el rechazo restaura", async ({ page }) => {
    // @aitri-tc TC-CDP-041h
    await abrir(page, OCTUBRE_DIVERGENTE);
    await teclear(page, NOV, "501");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("reserve-block")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Editar valor")).toHaveCount(0);
    await expect(celda(page, NOV)).toHaveText("—");
  });

  test("TC-CDP-043h: una reserva del plan que cabe se guarda desde la grilla", async ({ page }) => {
    // @aitri-tc TC-CDP-043h
    await abrir(page, OCTUBRE_DIVERGENTE);
    await teclear(page, NOV, "500");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Editar valor")).toHaveCount(0);
    await expect(celda(page, NOV)).toHaveText("500");
    await expect.poll(async () => (await readLedger(page))?.budgets.A?.[NOV]).toBe(500);
    await page.reload();
    await desplegarReservas(page);
    await expect(celda(page, NOV)).toHaveText("500");
  });

  test("TC-CDP-044e: el Máx. se pone rojo mientras se teclea de más", async ({ page }) => {
    // @aitri-tc TC-CDP-044e
    await abrir(page, OCTUBRE_DIVERGENTE);
    await teclear(page, NOV, "501");
    const max = page.getByTestId("reserve-max");
    await expect(max).toHaveText("Máx. $500");
    await expect(max).toHaveCSS("color", ALERTA_CLARO);
    await page.getByLabel("Editar valor").fill("500");
    await expect(max).toHaveCSS("color", MUTED_CLARO);
  });

  test("TC-CDP-045e: a 768 px la franja no desplaza las celdas vecinas", async ({ page }) => {
    // @aitri-tc TC-CDP-045e
    await abrir(page, OCTUBRE_DIVERGENTE, TABLET);
    // Se mide con el editor YA abierto: abrirlo desplaza la grilla hasta la celda y el campo ocupa
    // 2 px más que la cifra (así es también en Ejec.). Lo que esta prueba aísla es la FRANJA.
    await teclear(page, NOV, "501");
    const vecina = celda(page, DIC);
    const debajo = page.getByTestId("retiros-row").locator(`[data-month="${NOV}"]`).first();
    const antes = { vecina: await vecina.boundingBox(), debajo: await debajo.boundingBox() };
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("reserve-block")).toBeVisible();
    expect({ vecina: await vecina.boundingBox(), debajo: await debajo.boundingBox() }).toEqual(antes);
  });

  test("TC-CDP-046e: a 375 px la grilla no existe", async ({ page }) => {
    // @aitri-tc TC-CDP-046e
    await page.setViewportSize(MOBILE);
    await seedLedger(page, OCTUBRE_DIVERGENTE);
    await page.goto("/");
    await expect(page.getByTestId("save-button")).toBeVisible();
    await expect(page.locator('[data-testid="cell-leaf"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-testid="reserve-max"]:visible')).toHaveCount(0);
  });

  test("TC-CDP-047e: la franja de rechazo cumple contraste AA en los dos temas", async ({ page }) => {
    // @aitri-tc TC-CDP-047e
    await abrir(page, OCTUBRE_DIVERGENTE);
    const medir = async () => {
      await teclear(page, NOV, "501");
      await page.keyboard.press("Enter");
      const franja = page.getByTestId("reserve-block");
      await expect(franja).toBeVisible();
      const { color, fondo } = await franja.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, fondo: cs.backgroundColor };
      });
      await page.keyboard.press("Escape");
      return contraste(color, fondo);
    };
    const esOscuro = () => page.evaluate(() => document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark");
    if (await esOscuro()) await page.getByTestId("theme-toggle").click();
    await expect.poll(esOscuro).toBe(false);
    expect(await medir()).toBeGreaterThanOrEqual(4.5);
    await page.getByTestId("theme-toggle").click();
    await expect.poll(esOscuro).toBe(true);
    expect(await medir()).toBeGreaterThanOrEqual(4.5);
  });

  test("TC-CDP-050e: sin cupo en el plan el Máx. dice $0", async ({ page }) => {
    // @aitri-tc TC-CDP-050e
    await abrir(page, SIN_CUPO);
    await teclear(page, NOV, "0");
    const max = page.getByTestId("reserve-max");
    await expect(max).toHaveText("Máx. $0");
    await page.getByLabel("Editar valor").fill("1");
    await expect(max).toHaveCSS("color", ALERTA_CLARO);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("reserve-block")).toHaveText("Esta celda admite hasta $0 este mes");
  });
});

test.describe("FR-2905 · un mes del plan que se pasa se marca en el mes", () => {
  test("TC-CDP-042f: un mes del plan excedido se marca en el encabezado, no en la celda", async ({ page }) => {
    // @aitri-tc TC-CDP-042f
    await abrir(page, PLAN_LEGADO);
    const marca = page.locator(`[data-testid="techo-mark"][data-month="${NOV}"]`);
    await expect(marca).toHaveCount(1);
    await expect(marca).toHaveAttribute("aria-label", /Plan: reservas \$300 por encima del margen del mes/);
    await expect(celda(page, NOV)).toHaveText("800");
    await expect(celda(page, NOV)).not.toContainText("!");
    await expect(page.locator('[data-testid="cell-leaf"][data-plane="budget"][data-plan-warn]')).toHaveCount(0);
  });

  test("TC-CDP-048e: la franja del Balance lista el problema del plan", async ({ page }) => {
    // @aitri-tc TC-CDP-048e
    await abrir(page, PLAN_LEGADO);
    const linea = page.locator(`[data-testid="techo-banner"] [data-month="${NOV}"]`).getByTestId("techo-plan-line");
    await expect(linea).toHaveCount(1);
    await expect(linea).toHaveText("Plan: reservas $300 por encima del margen del mes.");
  });

  test("TC-CDP-049e: durante la hidratación no se pinta el triángulo del plan", async ({ page }) => {
    // @aitri-tc TC-CDP-049e
    await page.setViewportSize(DESK);
    await seedLedger(page, PLAN_LEGADO);
    let soltar: () => void = () => {};
    const retenida = new Promise<void>((r) => { soltar = r; });
    await page.route("**/api/v1/ledger", async (route) => {
      if (route.request().method() === "GET") await retenida;
      await route.continue();
    });
    await page.goto("/");
    const marca = page.locator(`[data-testid="techo-mark"][data-month="${NOV}"]`);
    // Mientras la carga está retenida no hay triángulo…
    await page.waitForTimeout(800);
    await expect(marca).toHaveCount(0);
    // …y aparece al completarse.
    soltar();
    await desplegarReservas(page);
    await expect(marca).toHaveCount(1);
  });
});
