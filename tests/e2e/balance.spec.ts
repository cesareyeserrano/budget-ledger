import { test, expect, type Locator, type Page } from "@playwright/test";
import { MONTH_KEYS } from "../../src/domain/months";

// Feature balance — el módulo de Balance al pie de la grilla y la separación del bloque
// Transferencia. Los TCs visuales afirman VALORES COMPUTADOS reales (color, background, altura,
// contraste calculado), nunca clases ni presencia de nodos. Prefijo TC-BAL-*.

const DESK = { width: 1440, height: 1250 };
const MOBILE = { width: 375, height: 900 };

/** Mes sobre el que se posa el filtro: fijo, para que el resaltado sea determinista. */
const PICKED = { key: "ene", label: "Enero", index: MONTH_KEYS.indexOf("ene") };
/** Un mes SIN resaltar, para leer superficies sin el tinte del filtro. */
const PLAIN = { key: "feb", index: MONTH_KEYS.indexOf("feb") };

const BG_SUNKEN = "rgb(241, 241, 243)"; // --bg-sunken claro
// El módulo usa las variantes AA-seguras, no --success/--error: medidos sobre la superficie
// HUNDIDA, los tonos base se quedan en 4.45:1 y 4.36:1, bajo el mínimo AA de 4.5.
const SUCCESS_STRONG = "rgb(45, 118, 80)"; // --success-strong claro (#2d7650) — 4.87:1
const ERROR_STRONG = "rgb(173, 57, 50)"; //   --error-strong claro   (#ad3932) — 5.46:1
const TRANSFER = "rgb(47, 109, 180)"; //      --type-transfer claro  (#2f6db4)
const FG_SECONDARY = "rgb(85, 85, 93)"; //    --fg-secondary claro

// ── contraste WCAG calculado a partir de los valores REALES del navegador ──────────────────────
/** Chrome devuelve `color-mix()` resuelto como `color(srgb 0.9 …)` (fracciones), no `rgb()`. */
function parseColor(s: string): number[] {
  const t = s.trim();
  const nums = (t.match(/-?\d*\.?\d+/g) ?? ["0", "0", "0"]).map(Number);
  const channels = nums.slice(0, 3);
  return t.startsWith("color(") ? channels.map((v) => Math.round(v * 255)) : channels;
}
function luminance(c: number[]): number {
  const [r, g, b] = c.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(parseColor(fg)), luminance(parseColor(bg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// ── fixture ────────────────────────────────────────────────────────────────────────────────────
type Leaf = { id: string; budget: number; actual: number };

const NODES = [
  // GASTOS · dos grupos (el segundo permite degradar un grupo sobre el primero, mismo tipo)
  { id: "g-gastos", type: "expense", level: "group", parentId: null, name: "Esenciales", order: 0 },
  { id: "c-mercado", type: "expense", level: "category", parentId: "g-gastos", name: "Mercado", order: 0 },
  { id: "c-transporte", type: "expense", level: "category", parentId: "g-gastos", name: "Transporte", order: 1 },
  { id: "g-otros", type: "expense", level: "group", parentId: null, name: "Ocio", order: 1 },
  { id: "c-cine", type: "expense", level: "category", parentId: "g-otros", name: "Cine", order: 0 },
  // INGRESOS
  { id: "g-ingresos", type: "income", level: "group", parentId: null, name: "Trabajo", order: 0 },
  { id: "c-salario", type: "income", level: "category", parentId: "g-ingresos", name: "Salario", order: 0 },
  // TRANSFERENCIAS
  { id: "g-ahorro", type: "transfer", level: "group", parentId: null, name: "Reservas", order: 0 },
  { id: "c-alcancia", type: "transfer", level: "category", parentId: "g-ahorro", name: "Alcancía", order: 0 },
];

/** Saldo SANO: ingresos > gastos, así que disponible y total quedan ≥0 en todos los meses. */
const POSITIVE: Leaf[] = [
  { id: "c-mercado", budget: 300_000, actual: 300_000 },
  { id: "c-transporte", budget: 0, actual: 0 },
  { id: "c-cine", budget: 0, actual: 0 },
  { id: "c-salario", budget: 1_000_000, actual: 1_000_000 },
  { id: "c-alcancia", budget: 100_000, actual: 100_000 },
];
/** Estados de color de la GRILLA (no del balance): gasto al 110 %, ingreso corto, transferencia. */
const STATES: Leaf[] = [
  { id: "c-mercado", budget: 200_000, actual: 220_000 }, // 110 % → ámbar con marca ›
  { id: "c-transporte", budget: 0, actual: 0 },
  { id: "c-cine", budget: 0, actual: 0 },
  { id: "c-salario", budget: 1_000_000, actual: 800_000 }, // ingreso por debajo del plan
  { id: "c-alcancia", budget: 100_000, actual: 100_000 },
];
/** Sobre-gasto REAL: el gasto supera al ingreso, así que disponible y total quedan <0. */
const NEGATIVE: Leaf[] = [
  { id: "c-mercado", budget: 300_000, actual: 900_000 },
  { id: "c-transporte", budget: 0, actual: 0 },
  { id: "c-cine", budget: 0, actual: 0 },
  { id: "c-salario", budget: 1_000_000, actual: 100_000 },
  { id: "c-alcancia", budget: 100_000, actual: 0 },
];

/**
 * Siembra localStorage antes de que la app arranque, con los mismos montos en los 12 meses.
 * IDEMPOTENTE: `addInitScript` corre en CADA navegación; sin la guarda, una recarga pisaría lo que
 * el test acaba de editar y TC-BAL-908h sería un falso negativo.
 */
async function seed(page: Page, leaves: Leaf[]) {
  await page.addInitScript(
    ({ nodes, leaves, months }) => {
      if (localStorage.getItem("ledger.nodes.v1")) return;
      const budgets: Record<string, Record<string, number>> = {};
      const actuals: Record<string, Record<string, number>> = {};
      for (const l of leaves) {
        budgets[l.id] = {};
        actuals[l.id] = {};
        for (const m of months) {
          budgets[l.id][m] = l.budget;
          actuals[l.id][m] = l.actual;
        }
      }
      localStorage.setItem(
        "ledger.nodes.v1",
        JSON.stringify({ version: 1, ownerId: "local", nodes: nodes.map((n) => ({ ...n, ownerId: "local", icon: null })) })
      );
      localStorage.setItem("ledger.budget.v2", JSON.stringify({ version: 2, budgets, actuals, movements: [] }));
    },
    { nodes: NODES, leaves, months: MONTH_KEYS }
  );
}

async function gotoGrid(page: Page, leaves: Leaf[] = POSITIVE, scheme: "light" | "dark" = "light") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(DESK);
  await seed(page, leaves);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("balance-module")).toBeVisible();
  // filtro en un mes FIJO: el resaltado deja de depender de la fecha real del reloj
  await page.getByLabel("Mes").click();
  await page.getByRole("option", { name: PICKED.label, exact: true }).click();
}

// ── localizadores ──────────────────────────────────────────────────────────────────────────────
const rowByName = (page: Page, name: string) =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: name }) });
const gridCells = (row: Locator) => row.locator('[data-testid="cell-leaf"], [data-testid="cell-parent"]');
const gridEjec = (row: Locator, monthIndex: number) => gridCells(row).nth(monthIndex * 2 + 1);

const balRow = (page: Page, key: string) => page.locator(`[data-testid="balance-row"][data-row="${key}"]`);
const balCell = (row: Locator, monthIndex: number, plane: "budget" | "actual") =>
  row.getByTestId("balance-cell").nth(monthIndex * 2 + (plane === "actual" ? 1 : 0));

const colorOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el).color);
const bgOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el).backgroundColor);

/** "1.234.567" → 1234567 · "−800.000‹‹" → −800000 · "—" → 0. */
function amountOf(text: string | null): number {
  const t = (text ?? "").trim();
  if (t.includes("—")) return 0;
  const digits = t.replace(/\D/g, "");
  const n = digits ? Number(digits) : 0;
  return t.startsWith("−") ? -n : n;
}
const readBal = async (page: Page, key: string, monthIndex: number, plane: "budget" | "actual") =>
  amountOf(await balCell(balRow(page, key), monthIndex, plane).textContent());

/** dnd-kit necesita un umbral de 6px antes de activar el arrastre. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("no bounding box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}
/** La fila de tipo mide ~2600px; su centro cae fuera de pantalla — se apunta a su etiqueta sticky. */
const typeLabel = (page: Page, name: RegExp) =>
  page.getByTestId("type-total-row").filter({ hasText: name }).getByTestId("row-label");

// ══ FR-905 · el código de color de los resultados ══════════════════════════════════════════════

test("TC-BAL-935h: un resultado sano (≥0) se pinta en verde (--success-strong)", async ({ page }) => {
  // @aitri-tc TC-BAL-935h
  await gotoGrid(page, POSITIVE);

  const disponible = balCell(balRow(page, "available"), PICKED.index, "actual");
  const total = balCell(balRow(page, "total"), PICKED.index, "actual");

  expect(await readBal(page, "available", PICKED.index, "actual")).toBe(600_000);
  expect(await readBal(page, "total", PICKED.index, "actual")).toBe(700_000);

  // ambos en el verde de "saldo sano" — la variante AA-segura del verde del producto
  expect(await colorOf(disponible)).toBe(SUCCESS_STRONG);
  expect(await colorOf(total)).toBe(SUCCESS_STRONG);

  // un positivo no lleva signo ni marca: un número sin signo ya es positivo
  for (const c of [disponible, total]) {
    const t = (await c.textContent())!.trim();
    expect(t.startsWith("−")).toBe(false);
    expect(t).not.toContain("+");
    expect(t).not.toContain("‹‹");
  }
});

test("TC-BAL-935f: un resultado negativo se pinta rojo (--error-strong) con − y marca ‹‹", async ({ page }) => {
  // @aitri-tc TC-BAL-935f
  await gotoGrid(page, NEGATIVE);

  const total = balCell(balRow(page, "total"), PICKED.index, "actual");
  const value = await readBal(page, "total", PICKED.index, "actual");

  expect(value).toBe(-800_000); // 100.000 de ingreso − 900.000 de gasto
  expect(await colorOf(total)).toBe(ERROR_STRONG);

  const t = (await total.textContent())!.trim();
  expect(t.startsWith("−"), `texto: ${t}`).toBe(true); // signo explícito, primero
  expect(t).toContain("‹‹"); // marca de forma: no depende solo del color (WCAG 1.4.1)
  expect(t).toContain("800.000");

  // la marca es aria-hidden: el dato ya lo porta el signo
  await expect(total.locator("span[aria-hidden='true']")).toHaveText("‹‹");

  // el disponible negativo recibe el mismo tratamiento
  expect(await colorOf(balCell(balRow(page, "available"), PICKED.index, "actual"))).toBe(ERROR_STRONG);
});

// ══ FR-908 · recálculo en vivo ═════════════════════════════════════════════════════════════════

test("TC-BAL-908h: editar una hoja de ejecutado recalcula el balance al instante", async ({ page }) => {
  // @aitri-tc TC-BAL-908h
  await gotoGrid(page, POSITIVE);

  const before = await readBal(page, "total", PLAIN.index, "actual");
  expect(before).toBe(1_400_000); // dos meses acumulados de 700.000

  // sumar 10.000 al Ejecutado de una hoja de GASTO en ese mes
  const cell = gridEjec(rowByName(page, "Mercado"), PLAIN.index);
  await cell.click();
  const input = page.getByLabel("Editar valor");
  await input.fill(String(300_000 + 10_000));
  await input.press("Enter");

  // el Saldo total ejecutado del mes baja EXACTAMENTE 10.000, sin recargar
  await expect
    .poll(async () => readBal(page, "total", PLAIN.index, "actual"))
    .toBe(before - 10_000);

  // y el arrastre lo propaga a los meses siguientes
  expect(await readBal(page, "total", PLAIN.index + 1, "actual")).toBe(2_100_000 - 10_000);
});

test("TC-BAL-908e: promover a grupo recompone el balance sin quedar obsoleto", async ({ page }) => {
  // @aitri-tc TC-BAL-908e
  await gotoGrid(page, POSITIVE);

  const totalBefore = await readBal(page, "total", PLAIN.index, "actual");
  const flowBefore = await readBal(page, "flow", PLAIN.index, "actual");

  await drag(page, rowByName(page, "Transporte").getByTestId("row-label"), typeLabel(page, /GASTOS/));
  await expect(rowByName(page, "Transporte")).toHaveAttribute("data-level", "group");

  // el balance sigue coherente con los roll-ups de la NUEVA jerarquía: promover no crea ni pierde
  // plata, así que las cifras se conservan — y ninguna queda con un valor obsoleto
  await expect.poll(async () => readBal(page, "flow", PLAIN.index, "actual")).toBe(flowBefore);
  expect(await readBal(page, "total", PLAIN.index, "actual")).toBe(totalBefore);

  // el módulo sigue vivo tras la reestructuración: una edición posterior lo mueve.
  // El clic se reintenta: justo después del drag la grilla se está re-renderizando y un clic
  // puede perderse contra la posición vieja de la fila (era la causa de un flake real).
  const input = page.getByLabel("Editar valor");
  await expect(async () => {
    await gridEjec(rowByName(page, "Mercado"), PLAIN.index).click();
    await expect(input).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  await input.fill("350000");
  await input.press("Enter");
  await expect.poll(async () => readBal(page, "total", PLAIN.index, "actual")).toBe(totalBefore - 50_000);
});

// ══ NFR-901 · el módulo es de SOLO LECTURA ═════════════════════════════════════════════════════

test("TC-BAL-951e: el módulo de balance no ofrece edición de sus celdas", async ({ page }) => {
  // @aitri-tc TC-BAL-951e
  await gotoGrid(page, POSITIVE);

  const total = balCell(balRow(page, "total"), PLAIN.index, "actual");
  const textBefore = await total.textContent();

  await total.click();
  await total.click({ clickCount: 2 }); // ni el doble click abre editor

  // a diferencia de una hoja, no aparece ningún input
  await expect(page.getByLabel("Editar valor")).toHaveCount(0);
  expect(await total.textContent()).toBe(textBefore);

  // contraste con el comportamiento real de una hoja: esa SÍ abre editor
  await gridEjec(rowByName(page, "Mercado"), PLAIN.index).click();
  await expect(page.getByLabel("Editar valor")).toHaveCount(1);
});

// ══ NFR-903 · el código de color de la grilla no se filtra al balance ══════════════════════════

test("TC-BAL-953e: las filas del balance no muestran la marca de sobre-consumo de la grilla", async ({ page }) => {
  // @aitri-tc TC-BAL-953e
  await gotoGrid(page, POSITIVE);

  const cells = page.getByTestId("balance-module").getByTestId("balance-cell");
  const count = await cells.count();
  expect(count).toBe(6 * 12 * 2); // seis filas × doce meses × dos planos

  const texts = await cells.allTextContents();
  for (const t of texts) {
    expect(t, `celda con glifo de sobre-consumo: ${t}`).not.toContain("›");
  }
  // el balance tiene su propio canal de forma (‹‹), que NO es el de la grilla (›/››)
  expect(texts.join("")).not.toMatch(/›/);
});

// ══ NFR-904 · promover y degradar siguen funcionando ═══════════════════════════════════════════

test("TC-BAL-954h: promover a grupo sigue funcionando con la feature activa", async ({ page }) => {
  // @aitri-tc TC-BAL-954h
  await gotoGrid(page, POSITIVE);

  const node = rowByName(page, "Transporte");
  await expect(node).toHaveAttribute("data-level", "category");

  await drag(page, node.getByTestId("row-label"), typeLabel(page, /GASTOS/));

  // el nodo pasa a grupo, con el mismo comportamiento de la feature promote-to-group
  await expect(rowByName(page, "Transporte")).toHaveAttribute("data-level", "group");
  await expect(page.getByTestId("balance-module")).toBeVisible();
});

test("TC-BAL-954e: degradar nodo sigue funcionando con la feature activa", async ({ page }) => {
  // @aitri-tc TC-BAL-954e
  await gotoGrid(page, POSITIVE);

  const group = rowByName(page, "Ocio");
  await expect(group).toHaveAttribute("data-level", "group");
  const totalBefore = await readBal(page, "total", PLAIN.index, "actual");

  // degradar: soltar un grupo sobre otro grupo del MISMO tipo lo baja a categoría
  await drag(page, group.getByTestId("row-label"), rowByName(page, "Esenciales").getByTestId("row-label"));

  await expect(rowByName(page, "Ocio")).toHaveAttribute("data-level", "category");
  // el balance se recompone sin error y sin perder plata (el subárbol degradado no tenía montos)
  await expect(page.getByTestId("balance-module")).toBeVisible();
  expect(await readBal(page, "total", PLAIN.index, "actual")).toBe(totalBefore);
});

// ══ NFR-905 · el registro de movimientos queda intacto ═════════════════════════════════════════

test("TC-BAL-955h: registrar un movimiento suma al Ejecutado igual que antes", async ({ page }) => {
  // @aitri-tc TC-BAL-955h
  await gotoGrid(page, POSITIVE);

  /** Los doce Ejecutados de la hoja Mercado. Se comparan mes a mes para no depender del reloj:
   *  el registro fecha el movimiento con el día de hoy, y ese mes no se conoce de antemano. */
  const mercadoActuals = async () => {
    const row = rowByName(page, "Mercado");
    const texts = await gridCells(row).allTextContents();
    return MONTH_KEYS.map((_, i) => amountOf(texts[i * 2 + 1]));
  };

  const before = await mercadoActuals();

  await page.getByRole("button", { name: /Nuevo movimiento/i }).click();
  await page.getByLabel("Monto en pesos").fill("15000");
  await page.getByTestId("category-row").getByRole("button", { name: /Mercado/ }).click();
  await page.getByTestId("save-button").click();

  // exactamente UN mes sube, y sube exactamente 15.000: el registro conserva su comportamiento
  await expect
    .poll(async () => (await mercadoActuals()).reduce((n, v, i) => n + (v - before[i]), 0))
    .toBe(15_000);

  const after = await mercadoActuals();
  const changed = after.map((v, i) => v - before[i]).filter((d) => d !== 0);
  expect(changed).toEqual([15_000]);
});

// ══ NFR-906 · el módulo respeta el sistema visual existente ════════════════════════════════════

test("TC-BAL-956h: el módulo usa la superficie y tipografía existentes (sin tokens nuevos)", async ({ page }) => {
  // @aitri-tc TC-BAL-956h
  await gotoGrid(page, POSITIVE);

  // superficie hundida, la misma que las filas NO editables de la grilla (mes sin resaltar)
  const cell = balCell(balRow(page, "flow"), PLAIN.index, "actual");
  expect(await bgOf(cell)).toBe(BG_SUNKEN);
  // se compara contra el MISMO mes sin resaltar: la columna filtrada lleva un tinte encima
  const typeRowCell = page.getByTestId("type-total-row").first().getByTestId("cell-parent").nth(PLAIN.index * 2);
  expect(await bgOf(cell)).toBe(await bgOf(typeRowCell));

  // misma familia mono que las cifras de la grilla: la feature no introduce tipografía nueva
  const fontOf = (l: Locator) => l.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await fontOf(cell)).toBe(await fontOf(typeRowCell));
  expect((await fontOf(cell)).toLowerCase()).toContain("mono");

  // los colores usados son los tokens existentes, ninguno inventado
  expect(await colorOf(balCell(balRow(page, "flow"), PLAIN.index, "actual"))).toBe(FG_SECONDARY);
  expect(await colorOf(balCell(balRow(page, "reservedBalance"), PLAIN.index, "actual"))).toBe(TRANSFER);
  expect(await colorOf(balCell(balRow(page, "total"), PLAIN.index, "actual"))).toBe(SUCCESS_STRONG);
});

test("TC-BAL-956e: las cifras del balance cumplen contraste AA sobre --bg-sunken", async ({ browser }) => {
  // @aitri-tc TC-BAL-956e
  // Cada combinación va en un contexto LIMPIO: la semilla es idempotente por diseño, así que
  // reutilizar la página dejaría los montos de la corrida anterior y mediría el color equivocado.
  const ratios: Record<string, number> = {};

  for (const scheme of ["light", "dark"] as const) {
    // los tres roles que aparecen con saldo sano
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await gotoGrid(p, POSITIVE, scheme);
    for (const [role, key] of [
      ["fg-secondary", "flow"],
      ["transfer", "reservedBalance"],
      ["success-strong", "total"],
    ] as const) {
      const cell = balCell(balRow(p, key), PLAIN.index, "actual");
      const r = contrast(await colorOf(cell), await bgOf(cell));
      ratios[`${scheme}/${role}`] = r;
      expect(r, `${scheme} · ${role} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
    await ctx.close();

    // y el rojo, que solo existe con sobre-gasto real
    const negCtx = await browser.newContext();
    const negPage = await negCtx.newPage();
    await gotoGrid(negPage, NEGATIVE, scheme);
    const cell = balCell(balRow(negPage, "total"), PLAIN.index, "actual");
    const r = contrast(await colorOf(cell), await bgOf(cell));
    ratios[`${scheme}/error-strong`] = r;
    expect(r, `${scheme} · error = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    await negCtx.close();
  }

  expect(Object.keys(ratios).length).toBe(8); // 4 roles × 2 temas, todos MEDIDOS, ninguno asumido
});

test("TC-BAL-956f: el módulo no introduce una altura de fila fuera de la escala", async ({ page }) => {
  // @aitri-tc TC-BAL-956f
  await gotoGrid(page, POSITIVE);

  const heightOf = (l: Locator) => l.evaluate((el) => Math.round(el.getBoundingClientRect().height));
  const gridRowHeight = await heightOf(gridEjec(rowByName(page, "Mercado"), PLAIN.index));

  // filas de insumo: exactamente la altura de una fila de la grilla
  for (const key of ["prevAvailable", "flow", "reserved", "reservedBalance"]) {
    const h = await heightOf(balCell(balRow(page, key), PLAIN.index, "actual"));
    expect(h, `fila ${key}: ${h}px vs grilla ${gridRowHeight}px`).toBe(gridRowHeight);
  }

  // las dos filas de RESULTADO llevan una regla superior de 1px que cierra el bloque de insumos:
  // suman ese hairline, pero no estrenan una altura ad-hoc fuera de la escala
  for (const key of ["available", "total"]) {
    const h = await heightOf(balCell(balRow(page, key), PLAIN.index, "actual"));
    expect(h, `fila ${key}: ${h}px vs grilla ${gridRowHeight}px`).toBeGreaterThanOrEqual(gridRowHeight);
    expect(h, `fila ${key}: ${h}px vs grilla ${gridRowHeight}px`).toBeLessThanOrEqual(gridRowHeight + 2);
  }
});

// ══ FR-904 · separación visual del bloque Transferencia ════════════════════════════════════════

test("TC-BAL-904h: el módulo de Balance tiene una separación visual propia", async ({ page }) => {
  // @aitri-tc TC-BAL-904h
  await gotoGrid(page, POSITIVE);

  const boxOf = async (l: Locator) => (await l.boundingBox())!;

  const sep = page.getByTestId("balance-separator");
  await expect(sep).toHaveCount(1);
  const sepBox = await boxOf(sep);
  const header = await boxOf(page.getByTestId("balance-header"));

  // espaciado entre dos filas CONTIGUAS de la grilla: la última fila del grupo Esenciales
  // (su hija Transporte) y la primera del grupo Ocio. Es la referencia de "sin separación".
  const transporte = await boxOf(rowByName(page, "Transporte").getByTestId("row-label"));
  const ocio = await boxOf(rowByName(page, "Ocio").getByTestId("row-label"));
  const gapEntreFilas = ocio.y - (transporte.y + transporte.height);
  expect(gapEntreFilas, "las filas de la grilla son contiguas").toBeLessThan(4);

  expect(sepBox.height, "el separador del balance debe medir ~32px").toBeGreaterThanOrEqual(24);
  expect(sepBox.height).toBeGreaterThan(gapEntreFilas); // ESTRICTAMENTE mayor
  // y está donde debe: justo encima del encabezado BALANCE
  expect(sepBox.y + sepBox.height).toBeLessThanOrEqual(header.y + 1);
});

test("TC-BAL-904e: los tres tipos quedan contiguos y los datos intactos", async ({ page }) => {
  // @aitri-tc TC-BAL-904e
  await gotoGrid(page, POSITIVE);

  // el orden lógico de los tipos no cambia
  const tipos = await page.getByTestId("type-total-row").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-type"))
  );
  // orden nuevo: sigue el camino de la plata — entra, sale, se aparta
  expect(tipos).toEqual(["income", "expense", "transfer"]);

  // NO hay separador entre los tipos: el bloque Transferencia dejó de estar aislado
  await expect(page.getByTestId("transfer-separator")).toHaveCount(0);

  const boxOf = async (l: Locator) => (await l.boundingBox())!;
  // el último nodo del bloque anterior (GASTOS · Cine) y la fila RESERVAS deben ser contiguos
  const ultimoGasto = await boxOf(rowByName(page, "Cine").getByTestId("row-label"));
  const filaReservas = await boxOf(typeLabel(page, /RESERVAS/));
  const gap = filaReservas.y - (ultimoGasto.y + ultimoGasto.height);
  expect(gap, `GASTOS y RESERVAS deben ser contiguos (gap ${gap}px)`).toBeLessThan(4);

  // y los totales por tipo no cambiaron: la separación era solo visual
  const totalGastos = await gridCells(page.getByTestId("type-total-row").filter({ hasText: "GASTOS" })).nth(PLAIN.index * 2).textContent();
  expect(amountOf(totalGastos)).toBe(300_000);
});

test("TC-BAL-904f: en móvil (≤760px) no se renderiza la grilla ni el balance", async ({ page }) => {
  // @aitri-tc TC-BAL-904f
  await seed(page, POSITIVE);
  await page.setViewportSize(MOBILE);
  await page.goto("/");

  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);
  await expect(page.getByTestId("balance-module")).toHaveCount(0);
  await expect(page.getByTestId("transfer-separator")).toHaveCount(0);
});

// ══ NFR-903 · el código de color de la grilla sigue intacto ════════════════════════════════════

test("TC-BAL-953h: el color de estado sigue aplicando a las hojas de gasto sobre-consumidas", async ({ page }) => {
  // @aitri-tc TC-BAL-953h
  await gotoGrid(page, STATES);

  const cell = gridEjec(rowByName(page, "Mercado"), PLAIN.index); // 220.000 sobre 200.000 = 110 %
  const text = (await cell.textContent())!.trim();

  expect(text.startsWith("›")).toBe(true); // ámbar lleva UNA marca
  expect(text.startsWith("››")).toBe(false);
  expect(text).toContain("220.000");
  expect(await colorOf(cell)).toBe("rgb(158, 71, 8)"); // --state-warning claro (#9e4708)
});

test("TC-BAL-953f: Ingreso y Transferencia conservan su semántica de color", async ({ page }) => {
  // @aitri-tc TC-BAL-953f
  await gotoGrid(page, STATES);

  // un ingreso por debajo de su presupuesto sigue en --warning (NO en --state-warning)
  const ingreso = gridEjec(rowByName(page, "Salario"), PLAIN.index);
  expect(await colorOf(ingreso)).toBe("rgb(180, 83, 9)"); // --warning claro (#b45309)

  // la transferencia sigue neutra: la feature no le añadió semántica de estado
  const transfer = gridEjec(rowByName(page, "Alcancía"), PLAIN.index);
  expect(await colorOf(transfer)).toBe("rgb(85, 85, 93)"); // --accent-light claro

  // y ninguna de las dos lleva marca de sobre-consumo
  for (const c of [ingreso, transfer]) expect((await c.textContent())!).not.toContain("›");
});

// ══ NFR-905 · en móvil solo existe el registro ═════════════════════════════════════════════════

test("TC-BAL-955e: en móvil solo existe el registro (ni grilla ni balance)", async ({ page }) => {
  // @aitri-tc TC-BAL-955e
  await seed(page, POSITIVE);
  await page.setViewportSize(MOBILE);
  await page.goto("/");

  // el registro SÍ está y es usable
  await expect(page.getByLabel("Monto en pesos")).toBeVisible();
  await expect(page.getByTestId("save-button")).toBeVisible();

  // la grilla y el balance NO existen en el DOM (no es que estén ocultos: no se renderizan)
  await expect(page.getByTestId("budget-grid")).toHaveCount(0);
  await expect(page.getByTestId("balance-module")).toHaveCount(0);
  await expect(page.getByTestId("balance-row")).toHaveCount(0);
});

// ══ FR-909 · plegado del módulo en dos niveles ═════════════════════════════════════════════════

/** Las claves `data-row` de las filas de balance visibles, en orden de DOM. */
const filasVisibles = (page: Page) =>
  page.getByTestId("balance-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-row")));

test("TC-BAL-909h: plegar el módulo desde su encabezado conserva el Saldo total", async ({ page }) => {
  // @aitri-tc TC-BAL-909h
  await gotoGrid(page, POSITIVE);

  const totalJulioAntes = await readBal(page, "total", MONTH_KEYS.indexOf("jul"), "actual");
  expect(totalJulioAntes).toBeGreaterThan(0); // el caso sería vacío si no hubiera datos

  await page.getByLabel("Colapsar balance").click();

  // plegar RESUME: cero filas, pero el encabezado sigue diciendo el bottom-line de cada mes/plano
  expect(await filasVisibles(page)).toEqual([]);
  const celdas = page.getByTestId("balance-header-cell");
  await expect(celdas).toHaveCount(MONTH_KEYS.length * 2); // 24 = 12 meses × 2 planos

  // y el número es el MISMO que mostraba la fila Saldo total antes de plegar
  const julEjec = amountOf(await celdas.nth(MONTH_KEYS.indexOf("jul") * 2 + 1).textContent());
  expect(julEjec).toBe(totalJulioAntes);
});

test("TC-BAL-909e: el chevron de Saldo disponible oculta las dos filas de abajo", async ({ page }) => {
  // @aitri-tc TC-BAL-909e
  await gotoGrid(page, POSITIVE);
  expect(await filasVisibles(page)).toHaveLength(6);

  await page.getByLabel("Colapsar saldos").click();

  expect(await filasVisibles(page)).toEqual(["prevAvailable", "flow", "reserved", "available"]);
  await expect(balRow(page, "reservedBalance")).toHaveCount(0);
  await expect(balRow(page, "total")).toHaveCount(0);
});

test("TC-BAL-909f: el chevron de Saldo disponible NO oculta ninguna fila de arriba", async ({ page }) => {
  // @aitri-tc TC-BAL-909f
  await gotoGrid(page, POSITIVE);

  await page.getByLabel("Colapsar saldos").click();

  // el defecto que este test existe para impedir: plegar hacia ARRIBA, ocultando los insumos
  for (const key of ["prevAvailable", "flow", "reserved"]) {
    await expect(balRow(page, key), `el insumo ${key} no puede ocultarse`).toHaveCount(1);
  }
  // y el ciclo es reversible: volver a abrir restituye las seis
  await page.getByLabel("Expandir saldos").click();
  expect(await filasVisibles(page)).toHaveLength(6);
});

// ══ FR-910 · orden de los bloques ══════════════════════════════════════════════════════════════

test("TC-BAL-910h: los bloques aparecen en el orden Ingresos → Gastos → Reservas", async ({ page }) => {
  // @aitri-tc TC-BAL-910h
  await gotoGrid(page, POSITIVE);

  const tipos = await page.getByTestId("type-total-row").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-type"))
  );
  expect(tipos).toEqual(["income", "expense", "transfer"]);

  // y el balance va DESPUÉS de los tres bloques
  const boxOf = async (l: Locator) => (await l.boundingBox())!;
  const ultimoTipo = await boxOf(typeLabel(page, /RESERVAS/));
  const balance = await boxOf(page.getByTestId("balance-header"));
  expect(balance.y).toBeGreaterThan(ultimoTipo.y);
});

test("TC-BAL-910e: reordenar no cambia ningún total", async ({ page }) => {
  // @aitri-tc TC-BAL-910e
  await gotoGrid(page, POSITIVE);

  const totalDe = async (nombre: RegExp, monthIndex: number) =>
    amountOf(await gridCells(page.getByTestId("type-total-row").filter({ hasText: nombre })).nth(monthIndex * 2).textContent());

  // los valores sembrados: gasto 300.000 · ingreso 1.000.000 (febrero, sin resaltado)
  expect(await totalDe(/GASTOS/, PLAIN.index)).toBe(300_000);
  expect(await totalDe(/INGRESOS/, PLAIN.index)).toBe(1_000_000);
});

// ══ FR-911 · el bloque transfer se rotula RESERVAS ═════════════════════════════════════════════

test("TC-BAL-911h: el bloque de tipo transfer se rotula RESERVAS", async ({ page }) => {
  // @aitri-tc TC-BAL-911h
  await gotoGrid(page, POSITIVE);

  const fila = page.locator('[data-testid="type-total-row"][data-type="transfer"]');
  await expect(fila.getByTestId("row-label")).toContainText("RESERVAS");

  // la misma palabra que usa el balance: grilla y balance hablan igual
  await expect(balRow(page, "reserved").getByTestId("balance-label")).toContainText("Reservas del mes");
  await expect(balRow(page, "reservedBalance").getByTestId("balance-label")).toContainText("Saldo reservado");
});

test("TC-BAL-911e: el tipo del dominio sigue siendo transfer", async ({ page }) => {
  // @aitri-tc TC-BAL-911e
  await gotoGrid(page, POSITIVE);

  // el rótulo cambió, el atributo NO
  await expect(page.locator('[data-testid="type-total-row"][data-type="transfer"]')).toHaveCount(1);

  // y el nodo PERSISTIDO conserva su tipo: cambió la palabra, no el modelo
  const tipos = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("ledger.nodes.v1")!);
    return raw.nodes.filter((n: { id: string }) => n.id === "g-ahorro").map((n: { type: string }) => n.type);
  });
  expect(tipos).toEqual(["transfer"]);
});

test("TC-BAL-911f: no queda ningún rótulo TRANSFERENCIAS en la grilla", async ({ page }) => {
  // @aitri-tc TC-BAL-911f
  await gotoGrid(page, POSITIVE);

  const rotulos = await page.getByTestId("type-total-row").getByTestId("row-label").allTextContents();
  expect(rotulos).toHaveLength(3);
  for (const r of rotulos) {
    expect(r, `el rótulo viejo no puede sobrevivir: ${r}`).not.toContain("TRANSFERENCIAS");
  }
  expect(rotulos.join(" ")).toContain("RESERVAS");
});
