import { test, expect, type Locator, type Page } from "@playwright/test";
import { MONTH_KEYS } from "../../src/domain/months";

// Feature budget-state-color — el color de la grilla señala el ESTADO del presupuesto, no el tipo.
// Los TCs visuales afirman VALORES COMPUTADOS reales (color, background, scrollWidth, contraste
// calculado), nunca clases ni presencia de nodos. Prefijo TC-BSC-* para no colisionar con
// root/grid-ux/stack-upgrade-theme/ux-consistency.

const DESK = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 900 };

/** Mes sobre el que se posa el filtro en los tests: fijo, para que el resaltado sea determinista. */
const PICKED = { key: "ene", label: "Enero", index: MONTH_KEYS.indexOf("ene") };
/** Un mes cualquiera SIN resaltar, para leer superficies sin el tinte del filtro. */
const PLAIN_INDEX = MONTH_KEYS.indexOf("feb");

const STATE_WARNING = "rgb(158, 71, 8)"; // --state-warning claro (#9e4708)
const STATE_OVER = "rgb(173, 57, 50)"; // --state-over claro (#ad3932)
const FG = "rgb(28, 28, 31)"; // --fg claro
const BG = "rgb(247, 247, 248)"; // --bg (fila hoja)
const BG_SUNKEN = "rgb(241, 241, 243)"; // --bg-sunken (fila de estructura)
const SUCCESS = "rgb(47, 125, 83)"; // --success claro
const WARNING = "rgb(180, 83, 9)"; // --warning claro (Ingreso corto — NO es --state-warning)
const ACCENT_LIGHT = "rgb(85, 85, 93)"; // --accent-light (Transferencia)
const TYPE_EXPENSE = "rgb(196, 69, 62)"; // --type-expense claro

// ── contraste WCAG calculado a partir de los valores REALES del navegador ──────────────────────
/**
 * Normaliza a canales 0-255. Chrome devuelve `rgb(…)` con enteros, pero un `color-mix()` resuelto
 * llega como `color(srgb 0.89498 0.89498 0.903059)` — fracciones. Leerlo como enteros daría un
 * contraste falso (fue el primer fallo de este test), así que se distingue el formato.
 */
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

// ── fixture: un periodo con un estado de presupuesto por caso frontera ─────────────────────────
type Leaf = { id: string; name: string; budget: number; actual: number };

const EXPENSE_LEAVES: Leaf[] = [
  { id: "c-60", name: "Ocio", budget: 200_000, actual: 120_000 }, //  60 % → within
  { id: "c-100", name: "Servicios", budget: 200_000, actual: 200_000 }, // 100 % → within (sin glifo)
  { id: "c-110", name: "Arriendo", budget: 200_000, actual: 220_000 }, // 110 % → over_soft ›
  { id: "c-120", name: "Transporte", budget: 100_000, actual: 120_000 }, // 120 % → over_hard ›› (primer rojo)
  { id: "c-130", name: "Mercado", budget: 150_000, actual: 195_000 }, // 130 % → over_hard ››
];
/** Hoja de 7 cifras: `›› 1.300.000` es el peor caso de ancho en una sub-celda de 108px (riesgo #1). */
const SEVEN_DIGITS: Leaf = { id: "c-7dig", name: "Deuda", budget: 1_000_000, actual: 1_300_000 };
const SUB_LEAF: Leaf = { id: "s-colegio", name: "Colegio", budget: 300_000, actual: 150_000 };
const INCOME_SHORT: Leaf = { id: "c-inc-short", name: "Salario", budget: 3_000_000, actual: 2_000_000 };
const INCOME_OVER: Leaf = { id: "c-inc-over", name: "Bonos", budget: 1_000_000, actual: 1_300_000 }; // 130 % y BUENO
const TRANSFER: Leaf = { id: "c-ahorro", name: "Ahorro", budget: 500_000, actual: 400_000 };

const NODES = [
  // GASTOS · grupo con hojas (los cinco estados frontera)
  { id: "g-hogar", type: "expense", level: "group", parentId: null, name: "Hogar", order: 0 },
  ...EXPENSE_LEAVES.map((l, i) => ({ id: l.id, type: "expense", level: "category", parentId: "g-hogar", name: l.name, order: i })),
  // GASTOS · grupo sobre-consumido al 130 % (fila PADRE roja: la peor superficie de AA)
  { id: "g-creditos", type: "expense", level: "group", parentId: null, name: "Créditos", order: 1 },
  { id: SEVEN_DIGITS.id, type: "expense", level: "category", parentId: "g-creditos", name: SEVEN_DIGITS.name, order: 0 },
  // GASTOS · categoría CON hijos (no editable) + su subcategoría (hoja)
  { id: "g-edu", type: "expense", level: "group", parentId: null, name: "Formación", order: 2 },
  { id: "c-parent", type: "expense", level: "category", parentId: "g-edu", name: "Educación", order: 0 },
  { id: SUB_LEAF.id, type: "expense", level: "sub", parentId: "c-parent", name: SUB_LEAF.name, order: 0 },
  // GASTOS · grupo VACÍO: nunca es hoja, luego tampoco editable (ADR-05)
  { id: "g-vacio", type: "expense", level: "group", parentId: null, name: "Vacío", order: 3 },
  // INGRESOS
  { id: "g-inc", type: "income", level: "group", parentId: null, name: "Trabajo", order: 0 },
  { id: INCOME_SHORT.id, type: "income", level: "category", parentId: "g-inc", name: INCOME_SHORT.name, order: 0 },
  { id: INCOME_OVER.id, type: "income", level: "category", parentId: "g-inc", name: INCOME_OVER.name, order: 1 },
  // TRANSFERENCIAS
  { id: "g-tr", type: "transfer", level: "group", parentId: null, name: "Movimientos", order: 0 },
  { id: TRANSFER.id, type: "transfer", level: "category", parentId: "g-tr", name: TRANSFER.name, order: 0 },
];

const ALL_LEAVES = [...EXPENSE_LEAVES, SEVEN_DIGITS, SUB_LEAF, INCOME_SHORT, INCOME_OVER, TRANSFER];

/**
 * Siembra localStorage antes de que la app arranque, con los mismos montos en los 12 meses.
 * IDEMPOTENTE a propósito: `addInitScript` corre en CADA navegación, así que sin esta guarda una
 * recarga pisaría lo que el usuario acaba de editar y el test de persistencia (TC-BSC-454h) sería
 * un falso negativo.
 */
async function seed(page: Page) {
  await page.addInitScript(
    ({ nodes, leaves, months }) => {
      if (localStorage.getItem("ledger.nodes.v1")) return; // arranque en caliente: respetar lo persistido
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
    { nodes: NODES, leaves: ALL_LEAVES, months: MONTH_KEYS }
  );
}

async function gotoGrid(page: Page, scheme: "light" | "dark" = "light") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(DESK);
  await seed(page);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  // filtro en un mes FIJO: el resaltado (y con él la peor superficie de AA) deja de depender de la fecha real
  await page.getByLabel("Mes").click();
  await page.getByRole("option", { name: PICKED.label, exact: true }).click();
  await expect(page.getByTestId("grid-legend")).toBeVisible();
  await expandEducacion(page);
}

/** Las categorías nacen colapsadas y el estado de expansión NO se persiste: hay que abrirla en cada carga. */
async function expandEducacion(page: Page) {
  await rowByName(page, "Educación").getByLabel("Expandir").click();
  await expect(rowByName(page, "Colegio")).toBeVisible();
}

const rowByName = (page: Page, name: string) => page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: name }) });

/** Celdas de una fila en orden DOM: [Pres. ene, Ejec. ene, Pres. feb, Ejec. feb, …]. */
const cells = (row: Locator) => row.locator('[data-testid="cell-leaf"], [data-testid="cell-parent"]');
const ejecCell = (row: Locator, monthIndex: number) => cells(row).nth(monthIndex * 2 + 1);

const colorOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el).color);
const bgOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el).backgroundColor);

// ══ FR-401 / FR-402 · color y glifo ════════════════════════════════════════════════════════════

test("TC-BSC-402h: la celda pasada muestra el glifo antes del monto, en el color del estado", async ({ page }) => {
  // @aitri-tc TC-BSC-402h
  await gotoGrid(page);

  const soft = ejecCell(rowByName(page, "Arriendo"), PLAIN_INDEX); // 110 %
  const hard = ejecCell(rowByName(page, "Mercado"), PLAIN_INDEX); // 130 %

  const softText = (await soft.textContent())!.trim();
  expect(softText.startsWith("›")).toBe(true);
  expect(softText.startsWith("››")).toBe(false); // ámbar lleva UNA marca, no dos
  expect(softText).toContain("220.000");
  expect(await colorOf(soft)).toBe(STATE_WARNING);

  const hardText = (await hard.textContent())!.trim();
  expect(hardText.startsWith("››")).toBe(true);
  expect(hardText).toContain("195.000");
  expect(await colorOf(hard)).toBe(STATE_OVER);

  // el glifo es aria-hidden: el dato ya lo portan el monto y el Pres. adyacente
  await expect(hard.locator("span[aria-hidden='true']")).toHaveText("››");
});

test("TC-BSC-402e: fronteras del glifo y ancho: 100% sin marca, 120% con '››', y un monto de 7 cifras no desborda", async ({ page }) => {
  // @aitri-tc TC-BSC-402e
  await gotoGrid(page);

  const exact100 = ejecCell(rowByName(page, "Servicios"), PLAIN_INDEX);
  expect((await exact100.textContent())!).not.toContain("›"); // el 100 % es el último valor neutro
  expect(await colorOf(exact100)).toBe(FG);

  const exact120 = ejecCell(rowByName(page, "Transporte"), PLAIN_INDEX);
  expect((await exact120.textContent())!.trim().startsWith("››")).toBe(true); // primer valor rojo
  expect(await colorOf(exact120)).toBe(STATE_OVER);

  // riesgo #1: `›› 1.300.000` en una sub-celda de 108px
  const wide = ejecCell(rowByName(page, "Deuda"), PLAIN_INDEX);
  expect((await wide.textContent())!).toContain("1.300.000");
  const box = await wide.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(box.scroll, "el glifo + 7 cifras no puede recortar la celda").toBeLessThanOrEqual(box.client);

  // ni desbordar el documento horizontalmente
  const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(docOverflow).toBe(true);
});

test("TC-BSC-402f: ninguna celda dentro del presupuesto, ni de Ingreso/Transferencia, ni el total por tipo lleva glifo", async ({ page }) => {
  // @aitri-tc TC-BSC-402f
  await gotoGrid(page);

  // gasto ≤100 %
  for (const name of ["Ocio", "Servicios"]) {
    const text = await ejecCell(rowByName(page, name), PLAIN_INDEX).textContent();
    expect(text, `${name} (≤100 %) no debe llevar marca`).not.toContain("›");
  }
  // Ingreso (incluso superando su presupuesto) y Transferencia
  for (const name of ["Salario", "Bonos", "Ahorro"]) {
    const row = rowByName(page, name);
    const texts = await cells(row).allTextContents();
    expect(texts.join(""), `${name} no debe llevar marca`).not.toContain("›");
  }
  // filas de total por tipo
  for (const type of ["expense", "income", "transfer"]) {
    const texts = await cells(page.locator(`[data-testid="type-total-row"][data-type="${type}"]`)).allTextContents();
    expect(texts.join(""), `el total de ${type} no debe llevar marca`).not.toContain("›");
  }
});

// ══ FR-403 · leyenda ═══════════════════════════════════════════════════════════════════════════

test("TC-BSC-403h: el pie de la grilla contiene la leyenda con los tres estados, su color y su glifo", async ({ page }) => {
  // @aitri-tc TC-BSC-403h
  await gotoGrid(page);
  const legend = page.getByTestId("grid-legend");

  const text = (await legend.textContent())!.toLowerCase();
  expect(text).toContain("dentro del presupuesto");
  expect(text).toContain("te pasaste poco");
  expect(text).toContain("te pasaste mucho");
  expect(text).toContain("›");
  expect(text).toContain("››");

  // un punto de color por estado, con el color computado real de cada token
  const dots = legend.locator("span[style*='background']");
  await expect(dots).toHaveCount(3);
  expect(await bgOf(dots.nth(0))).toBe(FG);
  expect(await bgOf(dots.nth(1))).toBe(STATE_WARNING);
  expect(await bgOf(dots.nth(2))).toBe(STATE_OVER);
});

test("TC-BSC-403e: la leyenda aparece exactamente una vez, no por fila", async ({ page }) => {
  // @aitri-tc TC-BSC-403e
  await gotoGrid(page);
  expect(await page.getByTestId("node-row").count()).toBeGreaterThanOrEqual(6);
  await expect(page.getByTestId("grid-legend")).toHaveCount(1); // no se repite por fila
});

test("TC-BSC-403f: no existe ningún icono de información por fila", async ({ page }) => {
  // @aitri-tc TC-BSC-403f
  await gotoGrid(page);
  const infoIcons = page.getByTestId("budget-grid").locator('[aria-label*="info" i], [title*="info" i], [aria-label*="ayuda" i], [title*="ayuda" i]');
  await expect(infoIcons).toHaveCount(0);
  // la única explicación del código de estado vive en el pie
  await expect(page.getByTestId("grid-legend")).toHaveCount(1);
});

// ══ FR-404 · superficie de estructura ══════════════════════════════════════════════════════════

test("TC-BSC-404h: las filas no editables usan la superficie hundida en TODA la fila; la hoja usa el lienzo", async ({ page }) => {
  // @aitri-tc TC-BSC-404h
  await gotoGrid(page);

  const structural = [
    page.locator('[data-testid="type-total-row"][data-type="expense"]'), // total por tipo
    rowByName(page, "Hogar"), // grupo
    rowByName(page, "Educación"), // categoría CON hijos
  ];
  for (const row of structural) {
    expect(await bgOf(row.getByTestId("row-label")), "columna fija").toBe(BG_SUNKEN);
    expect(await bgOf(ejecCell(row, PLAIN_INDEX)), "celda de mes").toBe(BG_SUNKEN);
  }

  const leaf = rowByName(page, "Colegio"); // subcategoría: dato editable
  expect(await bgOf(leaf.getByTestId("row-label"))).toBe(BG);
  expect(await bgOf(ejecCell(leaf, PLAIN_INDEX))).toBe(BG);
});

test("TC-BSC-404e: un grupo VACÍO tampoco es editable y también recibe la superficie de estructura", async ({ page }) => {
  // @aitri-tc TC-BSC-404e
  await gotoGrid(page);
  const empty = rowByName(page, "Vacío");
  await expect(empty).toHaveAttribute("data-leaf", "false"); // isLeaf() = false para TODO grupo

  expect(await bgOf(empty.getByTestId("row-label"))).toBe(BG_SUNKEN);
  const cell = ejecCell(empty, PLAIN_INDEX);
  expect(await bgOf(cell)).toBe(BG_SUNKEN);

  await cell.click();
  await expect(page.getByLabel("Editar valor")).toHaveCount(0); // la regla es !isLeaf, no "tiene hijos"
});

test("TC-BSC-404f: ninguna hoja usa la superficie de estructura, y ninguna fila cambia de altura ni de editabilidad", async ({ page }) => {
  // @aitri-tc TC-BSC-404f
  await gotoGrid(page);

  const leaves = page.locator('[data-testid="node-row"][data-leaf="true"]');
  const n = await leaves.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    expect(await bgOf(leaves.nth(i).getByTestId("row-label")), `hoja #${i}`).toBe(BG);
  }

  // la superficie no toca el layout: hoja y padre miden lo mismo
  const hLeaf = await rowByName(page, "Colegio").getByTestId("row-label").evaluate((el) => el.getBoundingClientRect().height);
  const hParent = await rowByName(page, "Hogar").getByTestId("row-label").evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(hLeaf - hParent)).toBeLessThanOrEqual(1);

  // editabilidad intacta: la hoja abre editor, la padre no
  await ejecCell(rowByName(page, "Colegio"), PLAIN_INDEX).click();
  await expect(page.getByLabel("Editar valor")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await ejecCell(rowByName(page, "Hogar"), PLAIN_INDEX).click();
  await expect(page.getByLabel("Editar valor")).toHaveCount(0);
});

// ══ NFR-401 · el Registro conserva su propagación de color por tipo ════════════════════════════

async function gotoRegister(page: Page) {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(MOBILE);
  await seed(page);
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
}

test("TC-BSC-451h: regresión — el Registro conserva la propagación de color por tipo", async ({ page }) => {
  // @aitri-tc TC-BSC-451h
  await gotoRegister(page);

  await page.getByTestId("type-expense").click();
  expect(await colorOf(page.getByTestId("amount-sign"))).toBe(TYPE_EXPENSE);
  expect(await colorOf(page.getByTestId("amount-display"))).toBe(TYPE_EXPENSE);
  const saveExpense = await bgOf(page.getByTestId("save-button"));
  expect(parseColor(saveExpense)[0]).toBeGreaterThan(parseColor(saveExpense)[1]); // relleno rojizo: R > G

  await page.getByTestId("type-income").click();
  const signIncome = await colorOf(page.getByTestId("amount-sign"));
  expect(parseColor(signIncome)[1]).toBeGreaterThan(parseColor(signIncome)[0]); // verde bosque: G > R
  const saveIncome = await bgOf(page.getByTestId("save-button"));
  expect(saveIncome).not.toBe(saveExpense); // el botón Guardar sigue el color del tipo
});

test("TC-BSC-451e: regresión — Transferencia también propaga su color en el Registro", async ({ page }) => {
  // @aitri-tc TC-BSC-451e
  await gotoRegister(page);
  await page.getByTestId("type-transfer").click();

  const save = await bgOf(page.getByTestId("save-button"));
  expect(parseColor(save)[2]).toBeGreaterThan(parseColor(save)[0]); // azul acero: B > R

  await expect(page.getByTestId("type-transfer")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("type-expense")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("type-income")).toHaveAttribute("aria-selected", "false");
});

test("TC-BSC-451f: regresión — el Registro NO usa los tokens de estado de presupuesto", async ({ page }) => {
  // @aitri-tc TC-BSC-451f
  await gotoRegister(page);

  const leaked = await page.getByTestId("mobile-shell").evaluate((root, [warning, over]) => {
    const hits: string[] = [];
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const s = getComputedStyle(el);
      if (s.color === warning || s.color === over || s.backgroundColor === warning || s.backgroundColor === over) {
        hits.push(`${el.tagName}.${el.className}`);
      }
    }
    return hits;
  }, [STATE_WARNING, STATE_OVER]);

  expect(leaked, "los tokens de estado son de uso exclusivo de la grilla").toEqual([]);
});

// ══ NFR-402 · Ingreso y Transferencia conservan su semántica ═══════════════════════════════════

test("TC-BSC-452h: regresión — Ingreso conserva su semántica (corto = warning, superado = success)", async ({ page }) => {
  // @aitri-tc TC-BSC-452h
  await gotoGrid(page);

  const short = ejecCell(rowByName(page, "Salario"), PLAIN_INDEX); // 2.000.000 / 3.000.000
  expect(await colorOf(short)).toBe(WARNING);
  expect(await colorOf(short)).not.toBe(STATE_WARNING); // NO es el token de estado de presupuesto

  const over = ejecCell(rowByName(page, "Bonos"), PLAIN_INDEX); // 1.300.000 / 1.000.000
  expect(await colorOf(over)).toBe(SUCCESS);
  expect(await colorOf(over)).not.toBe(STATE_OVER);
});

test("TC-BSC-452e: regresión — Transferencia sigue neutra (--accent-light)", async ({ page }) => {
  // @aitri-tc TC-BSC-452e
  await gotoGrid(page);
  const cell = ejecCell(rowByName(page, "Ahorro"), PLAIN_INDEX);
  expect(await colorOf(cell)).toBe(ACCENT_LIGHT); // los umbrales de gasto no la afectan
  expect((await cell.textContent())!).not.toContain("›");
});

test("TC-BSC-452f: regresión — una fila de Ingreso que supera su presupuesto NO recibe glifo ni color de estado", async ({ page }) => {
  // @aitri-tc TC-BSC-452f
  await gotoGrid(page);
  const cell = ejecCell(rowByName(page, "Bonos"), PLAIN_INDEX); // 130 % — superarlo es BUENO en Ingreso

  expect((await cell.textContent())!).not.toContain("›");
  expect(await colorOf(cell)).toBe(SUCCESS);
  expect(await colorOf(cell)).not.toBe(STATE_OVER);
});

// ══ NFR-403 · AA sobre la app real + WCAG 1.4.1 ════════════════════════════════════════════════

test("TC-BSC-453e: AA en la app real — el estado sobre la celda resaltada de una fila padre cumple ≥4.5:1", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    // @aitri-tc TC-BSC-453e
    await gotoGrid(page, scheme);

    // grupo "Créditos" al 130 %: fila PADRE (hundida) sobre-consumida, en el mes resaltado por el filtro
    const cell = ejecCell(rowByName(page, "Créditos"), PICKED.index);
    expect((await cell.textContent())!.trim().startsWith("››")).toBe(true);

    const fg = await colorOf(cell);
    const bg = await bgOf(cell);

    // en claro, la superficie que el NAVEGADOR compone es exactamente la peor del diseño: #e4e4e6
    if (scheme === "light") {
      expect(parseColor(bg)).toEqual([228, 228, 230]);
      expect(parseColor(fg)).toEqual([173, 57, 50]);
    }

    const ratio = contrast(fg, bg); // calculado sobre los valores REALES del navegador
    expect(ratio, `${scheme}: ${fg} sobre ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});

test("TC-BSC-453f: WCAG 1.4.1 — el estado nunca se codifica solo con color: toda celda coloreada lleva glifo", async ({ page }) => {
  // @aitri-tc TC-BSC-453f
  await gotoGrid(page);

  const audit = await page.getByTestId("budget-grid").evaluate(
    (root, [warning, over]) => {
      let colored = 0;
      let withoutGlyph = 0;
      for (const el of Array.from(root.querySelectorAll('[data-testid="cell-leaf"], [data-testid="cell-parent"]'))) {
        const c = getComputedStyle(el).color;
        if (c !== warning && c !== over) continue;
        colored++;
        if (!(el.textContent ?? "").includes("›")) withoutGlyph++;
      }
      return { colored, withoutGlyph };
    },
    [STATE_WARNING, STATE_OVER]
  );

  expect(audit.colored, "el fixture debe producir celdas en estado").toBeGreaterThan(0);
  expect(audit.withoutGlyph, "una celda con color de estado y sin glifo dependería solo del color").toBe(0);
});

// ══ NFR-404 · cero regresión funcional ═════════════════════════════════════════════════════════

test("TC-BSC-454h: regresión — la edición inline de una hoja sigue funcionando y persiste", async ({ page }) => {
  // @aitri-tc TC-BSC-454h
  await gotoGrid(page);

  const cell = ejecCell(rowByName(page, "Colegio"), PLAIN_INDEX);
  await cell.click();
  await page.getByLabel("Editar valor").fill("123456");
  await page.keyboard.press("Enter");
  await expect(cell).toContainText("123.456");

  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expandEducacion(page);
  await expect(ejecCell(rowByName(page, "Colegio"), PLAIN_INDEX)).toContainText("123.456"); // la persistencia no cambió
});

test("TC-BSC-454e: regresión — filtro Mes/Año, roll-ups y la lista Recientes siguen intactos", async ({ page }) => {
  // @aitri-tc TC-BSC-454e
  await gotoGrid(page);

  // el roll-up del padre iguala la suma de sus hijos (Hogar = 120+200+220+120+195 = 855.000)
  const groupActual = await ejecCell(rowByName(page, "Hogar"), PLAIN_INDEX).textContent();
  expect(groupActual).toContain("855.000");

  // el filtro Mes/Año recalcula los KPIs (el año agrega los 12 meses), y volver a Mes los restituye
  const budgetKpi = page.getByTestId("kpi").first().locator(".display");
  const kpiMonth = await budgetKpi.textContent();
  await page.getByTestId("period-pill").getByRole("tab", { name: "Año" }).click();
  const kpiYear = await budgetKpi.textContent();
  expect(kpiYear).not.toBe(kpiMonth);
  await page.getByTestId("period-pill").getByRole("tab", { name: "Mes" }).click();
  await expect(budgetKpi).toHaveText(kpiMonth!); // el mes vuelve a agregar lo mismo
  await expect(page.getByTestId("budget-grid")).toBeVisible();

  // a 375px la lista Recientes sigue existiendo (su remoción es BL-003, otra feature)
  await page.setViewportSize(MOBILE);
  await expect(page.getByText("RECIENTES")).toBeVisible();
});

test("TC-BSC-454f: regresión — una celda de fila padre sigue sin abrir el editor", async ({ page }) => {
  // @aitri-tc TC-BSC-454f
  await gotoGrid(page);
  await ejecCell(rowByName(page, "Hogar"), PLAIN_INDEX).click();
  await expect(page.getByLabel("Editar valor")).toHaveCount(0); // la nueva superficie es apariencia, no editabilidad
});
