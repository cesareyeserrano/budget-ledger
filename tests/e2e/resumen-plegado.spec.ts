import { test, expect, type Locator, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import type { LedgerNode } from "@/domain/types";
import { P as MONTH_KEYS, visibleMonthCount } from "./helpers/periods";

// Feature resumen-plegado — plegado, el encabezado del módulo de Balance resume el mes con el
// SALDO DISPONIBLE (FR-1501) y conserva la señal de la cifra (FR-1502). Los TCs afirman VALORES y
// estilos COMPUTADOS del navegador, nunca clases ni mera presencia de nodos. Prefijo TC-RSP-*.
//
// REVOCACIÓN DECLARADA: FR-909 de la feature `balance` fijaba el Saldo total en este encabezado.
// Esta suite verifica lo contrario a propósito; TC-BAL-909h quedó re-derivado en balance.spec.ts.

const DESK = { width: 1440, height: 1250 };
const MOBILE = { width: 375, height: 900 };

const FG = "rgb(28, 28, 31)"; //           --fg claro          — neutro por defecto (FR-1403)
const FG_MUTED = "rgb(107, 107, 115)"; //  --fg-muted claro    — celda sin dato (FR-1404)
const ALERT_STRONG = "rgb(173, 57, 50)"; // --alert-strong claro — excepción: saldo negativo

const NODES = [
  { id: "g-gastos", type: "expense", level: "group", parentId: null, name: "Esenciales", order: 0 },
  { id: "c-mercado", type: "expense", level: "category", parentId: "g-gastos", name: "Mercado", order: 0 },
  { id: "g-ingresos", type: "income", level: "group", parentId: null, name: "Trabajo", order: 0 },
  { id: "c-salario", type: "income", level: "category", parentId: "g-ingresos", name: "Salario", order: 0 },
  { id: "g-ahorro", type: "transfer", level: "group", parentId: null, name: "Reservas", order: 0 },
  { id: "c-alcancia", type: "transfer", level: "category", parentId: "g-ahorro", name: "Alcancía", order: 0 },
];

type Leaf = { id: string; budget: number; actual: number };

/** RSP: ene cierra en disponible 600.000 · reservado 100.000 · TOTAL 700.000 — los dos difieren. */
const RSP: Leaf[] = [
  { id: "c-mercado", budget: 300_000, actual: 300_000 },
  { id: "c-salario", budget: 1_000_000, actual: 1_000_000 },
  { id: "c-alcancia", budget: 100_000, actual: 100_000 },
];
/** Sin reservas: disponible == total, así que la cifra plegada no cambia respecto de antes. */
const SIN_RESERVAS: Leaf[] = [
  { id: "c-mercado", budget: 300_000, actual: 300_000 },
  { id: "c-salario", budget: 1_000_000, actual: 1_000_000 },
  { id: "c-alcancia", budget: 0, actual: 0 },
];
/** Plan y realidad divergen: ene → disponible Pres. 600.000 vs Ejec. 200.000. */
const DIVERGENTE: Leaf[] = [
  { id: "c-mercado", budget: 300_000, actual: 300_000 },
  { id: "c-salario", budget: 1_000_000, actual: 600_000 },
  { id: "c-alcancia", budget: 100_000, actual: 100_000 },
];
/** Sobre-gasto real: ene cierra en disponible −800.000. */
const NEGATIVO: Leaf[] = [
  { id: "c-mercado", budget: 300_000, actual: 900_000 },
  { id: "c-salario", budget: 1_000_000, actual: 100_000 },
  { id: "c-alcancia", budget: 0, actual: 0 },
];
/**
 * El fixture más discriminante: el disponible se va a NEGATIVO mientras el total sigue POSITIVO,
 * porque lo apartado en la alcancía sostiene el bottom-line. Enero cierra en disponible −100.000 y
 * total +100.000, así que la celda plegada distingue las dos cifras por SIGNO, no solo por monto.
 */
const NEG_CON_TOTAL_POSITIVO: Leaf[] = [
  { id: "c-mercado", budget: 200_000, actual: 200_000 },
  { id: "c-salario", budget: 300_000, actual: 300_000 },
  { id: "c-alcancia", budget: 200_000, actual: 200_000 },
];
/** Disponible exactamente 0 en todos los meses: el borde que separa neutro de excepción. */
const CERO: Leaf[] = [
  { id: "c-mercado", budget: 300_000, actual: 300_000 },
  { id: "c-salario", budget: 300_000, actual: 300_000 },
  { id: "c-alcancia", budget: 0, actual: 0 },
];

async function seed(page: Page, leaves: Leaf[]) {
  const budgets: Record<string, Record<string, number>> = {};
  const actuals: Record<string, Record<string, number>> = {};
  for (const l of leaves) {
    budgets[l.id] = {};
    actuals[l.id] = {};
    for (const m of MONTH_KEYS) {
      budgets[l.id][m] = l.budget;
      actuals[l.id][m] = l.actual;
    }
  }
  await seedLedger(page, {
    nodes: NODES.map((n) => ({ ...n, ownerId: "local", icon: null })) as unknown as LedgerNode[],
    budgets,
    actuals,
  });
}

async function gotoGrid(page: Page, leaves: Leaf[] = RSP, scheme: "light" | "dark" = "light", viewport = DESK) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(viewport);
  await seed(page, leaves);
  await page.goto("/");
  // ≤760px es el shell MÓVIL (FR-010 raíz): ahí no hay grilla que esperar, y esperarla sería el
  // propio defecto que TC-RSP-041f existe para detectar. Se ancla al shell que sí corresponde.
  if (viewport.width <= 760) await expect(page.getByTestId("mobile-shell")).toBeVisible();
  else await expect(page.getByTestId("budget-grid")).toBeVisible();
}

// ── localizadores ──────────────────────────────────────────────────────────────────────────────
const balRow = (page: Page, key: string) => page.locator(`[data-testid="balance-row"][data-row="${key}"]`);
const rowCell = (row: Locator, monthIndex: number, plane: "budget" | "actual") =>
  row.getByTestId("balance-cell").nth(monthIndex * 2 + (plane === "actual" ? 1 : 0));
const headerCells = (page: Page) => page.getByTestId("balance-header-cell");
const headerCell = (page: Page, monthIndex: number, plane: "budget" | "actual") =>
  headerCells(page).nth(monthIndex * 2 + (plane === "actual" ? 1 : 0));

const filasVisibles = (page: Page) =>
  page.getByTestId("balance-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-row")));

/** "1.234.567" → 1234567 · "−800.000‹‹" → −800000 · "—" → 0. */
function amountOf(text: string | null): number {
  const t = (text ?? "").trim();
  if (t.includes("—")) return 0;
  const digits = t.replace(/\D/g, "");
  const n = digits ? Number(digits) : 0;
  return t.startsWith("−") ? -n : n;
}
const readRow = async (page: Page, key: string, i: number, plane: "budget" | "actual") =>
  amountOf(await rowCell(balRow(page, key), i, plane).textContent());
const readHeader = async (page: Page, i: number, plane: "budget" | "actual") =>
  amountOf(await headerCell(page, i, plane).textContent());

const colorOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el).color);
const bgOf = (c: Locator) =>
  c.evaluate((el) => {
    let n: HTMLElement | null = el as HTMLElement;
    while (n) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
      n = n.parentElement;
    }
    return "rgb(255, 255, 255)";
  });

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

const plegar = (page: Page) => page.getByLabel("Colapsar balance").click();
const ENE = MONTH_KEYS.indexOf("2026-01");

// ── FR-1501 · la cifra ─────────────────────────────────────────────────────────────────────────

test("TC-RSP-001h: plegado, la celda de Ejecutado muestra el Saldo disponible y no el Saldo total", async ({ page }) => {
  // @aitri-tc TC-RSP-001h
  await gotoGrid(page, RSP);

  const disponible = await readRow(page, "available", ENE, "actual");
  const total = await readRow(page, "total", ENE, "actual");
  expect(disponible).toBe(600_000);
  expect(total).toBe(700_000); // el fixture SEPARA las dos cifras: sin eso el TC no probaría nada

  await plegar(page);

  expect(await readHeader(page, ENE, "actual")).toBe(600_000);
  expect(await readHeader(page, ENE, "actual")).not.toBe(total);
});

test("TC-RSP-002e: las 24 celdas del encabezado plegado coinciden con la fila «Saldo disponible»", async ({ page }) => {
  // @aitri-tc TC-RSP-002e
  await gotoGrid(page, RSP);

  const fila: number[] = [];
  for (let i = 0; i < MONTH_KEYS.length; i++) {
    fila.push(await readRow(page, "available", i, "budget"));
    fila.push(await readRow(page, "available", i, "actual"));
  }

  await plegar(page);

  const encabezado: number[] = [];
  for (let i = 0; i < MONTH_KEYS.length; i++) {
    encabezado.push(await readHeader(page, i, "budget"));
    encabezado.push(await readHeader(page, i, "actual"));
  }

  expect(encabezado).toHaveLength(24);
  expect(encabezado).toEqual(fila);
});

test("TC-RSP-003e: cada celda usa el disponible de SU plano", async ({ page }) => {
  // @aitri-tc TC-RSP-003e
  await gotoGrid(page, DIVERGENTE);
  await plegar(page);

  const pres = await readHeader(page, ENE, "budget");
  const ejec = await readHeader(page, ENE, "actual");

  expect(pres).toBe(600_000);
  expect(ejec).toBe(200_000);
  expect(pres).not.toBe(ejec);
});

test("TC-RSP-004f: el Saldo total ya no aparece en ninguna celda del encabezado plegado", async ({ page }) => {
  // @aitri-tc TC-RSP-004f
  await gotoGrid(page, RSP);

  const totales: number[] = [];
  for (let i = 0; i < MONTH_KEYS.length; i++) {
    totales.push(await readRow(page, "total", i, "budget"));
    totales.push(await readRow(page, "total", i, "actual"));
  }

  await plegar(page);

  for (let i = 0; i < MONTH_KEYS.length; i++) {
    expect(await readHeader(page, i, "budget")).not.toBe(totales[i * 2]);
    expect(await readHeader(page, i, "actual")).not.toBe(totales[i * 2 + 1]);
  }
});

test("TC-RSP-005e: sin reservas, la cifra plegada es la misma que antes del cambio", async ({ page }) => {
  // @aitri-tc TC-RSP-005e
  await gotoGrid(page, SIN_RESERVAS);

  const disponible = await readRow(page, "available", ENE, "actual");
  const total = await readRow(page, "total", ENE, "actual");
  expect(disponible).toBe(700_000);
  expect(total).toBe(700_000); // sin reservado, las dos cifras coinciden

  await plegar(page);
  expect(await readHeader(page, ENE, "actual")).toBe(700_000);
});

test("TC-RSP-006h: desplegar devuelve la escalera intacta con su cierre en Saldo total", async ({ page }) => {
  // @aitri-tc TC-RSP-006h
  await gotoGrid(page, RSP);
  await plegar(page);
  await page.getByLabel("Expandir balance").click();

  const filas = await filasVisibles(page);
  // FR-1810 reestructuró el módulo: de ocho filas planas a DIEZ en tres bloques. La escalera sigue
  // cerrando en «Saldo total», que es lo que este TC protege.
  expect(filas).toHaveLength(10);
  expect(filas[filas.length - 1]).toBe("total");
  expect(await readRow(page, "total", ENE, "actual")).toBe(700_000);
});

test("TC-RSP-007e: con disponible negativo y total positivo, la celda plegada muestra el negativo", async ({ page }) => {
  // @aitri-tc TC-RSP-007e
  await gotoGrid(page, NEG_CON_TOTAL_POSITIVO);

  const disponible = await readRow(page, "available", ENE, "actual");
  const total = await readRow(page, "total", ENE, "actual");
  expect(disponible).toBe(-100_000); // lo gastable está en rojo...
  expect(total).toBe(100_000); //       ...mientras el bottom-line sigue en verde por lo apartado

  await plegar(page);

  // la discriminación más fuerte posible: las dos cifras difieren en SIGNO, no solo en monto
  const celda = headerCell(page, ENE, "actual");
  expect(await readHeader(page, ENE, "actual")).toBe(-100_000);
  expect(await colorOf(celda)).toBe(ALERT_STRONG);
  expect(((await celda.textContent()) ?? "").trim().startsWith("−")).toBe(true);
});

// ── FR-1502 · la señal ─────────────────────────────────────────────────────────────────────────

test("TC-RSP-010h: un disponible negativo conserva color, signo y glifo en la celda plegada", async ({ page }) => {
  // @aitri-tc TC-RSP-010h
  await gotoGrid(page, NEGATIVO);
  await plegar(page);

  const celda = headerCell(page, ENE, "actual");
  const texto = ((await celda.textContent()) ?? "").trim();

  expect(await readHeader(page, ENE, "actual")).toBe(-800_000);
  expect(await colorOf(celda)).toBe(ALERT_STRONG); // canal 1: color
  expect(texto.startsWith("−")).toBe(true); //        canal 2: signo
  expect(texto).toContain("‹‹"); //                   canal 3: glifo
});

test("TC-RSP-011e: un disponible de exactamente 0 se pinta neutro, sin color de excepción", async ({ page }) => {
  // @aitri-tc TC-RSP-011e
  await gotoGrid(page, CERO);
  await plegar(page);

  const celda = headerCell(page, ENE, "actual");
  expect(await readHeader(page, ENE, "actual")).toBe(0);
  expect(await colorOf(celda)).not.toBe(ALERT_STRONG);
  expect(await colorOf(celda)).toBe(FG_MUTED);
});

test("TC-RSP-012f: un valor positivo no lleva color de excepción ni glifo de negativo", async ({ page }) => {
  // @aitri-tc TC-RSP-012f
  await gotoGrid(page, RSP);
  await plegar(page);

  const celda = headerCell(page, ENE, "actual");
  const texto = ((await celda.textContent()) ?? "").trim();

  expect(await colorOf(celda)).toBe(FG);
  expect(texto).not.toContain("−");
  expect(texto).not.toContain("‹‹");
});

test("TC-RSP-013h: contraste ≥4.5:1 de la cifra plegada en claro y en oscuro, sana y negativa", async ({ page }) => {
  // @aitri-tc TC-RSP-013h
  for (const scheme of ["light", "dark"] as const) {
    for (const leaves of [RSP, NEGATIVO]) {
      await gotoGrid(page, leaves, scheme);
      await plegar(page);
      const celda = headerCell(page, ENE, "actual");
      const ratio = contrast(await colorOf(celda), await bgOf(celda));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  }
});

// ── NFR-1501 · regresión: el módulo desplegado y su plegado en dos niveles ─────────────────────

test("TC-RSP-020h: el módulo desplegado conserva sus filas, en orden, cerrando en Saldo total", async ({ page }) => {
  // @aitri-tc TC-RSP-020h
  // FR-1810: diez filas en tres bloques (el mes · lo disponible · el cierre). «retiros» ya no está
  // en la lista porque salió de la cascada del Balance — su reflejo aquí es «toWithdrawals», y la
  // fila OPERABLE vive en el segmento de Reservas con su propio testid.
  await gotoGrid(page, RSP);
  expect(await filasVisibles(page)).toEqual([
    "income", "expense", "monthResult", "prevAvailable", "monthResultCarry", "toReserves", "toWithdrawals", "available", "reservedBalance", "total",
  ]);
});

test("TC-RSP-021e: el chevron interno sigue ocultando exactamente Saldo reservado y Saldo total", async ({ page }) => {
  // @aitri-tc TC-RSP-021e
  await gotoGrid(page, RSP);
  await page.getByLabel("Colapsar saldos").click();

  expect(await filasVisibles(page)).toEqual([
    "income", "expense", "monthResult", "prevAvailable", "monthResultCarry", "toReserves", "toWithdrawals", "available",
  ]);
  await expect(balRow(page, "reservedBalance")).toHaveCount(0);
  await expect(balRow(page, "total")).toHaveCount(0);
});

test("TC-RSP-022f: el estado plegado no se persiste — recargar devuelve el módulo desplegado", async ({ page }) => {
  // @aitri-tc TC-RSP-022f
  await gotoGrid(page, RSP);
  await plegar(page);
  expect(await filasVisibles(page)).toEqual([]);

  await page.reload();
  await expect(page.getByTestId("balance-module")).toBeVisible();

  expect(await filasVisibles(page)).toHaveLength(10);
  const claves = await page.evaluate(() => Object.keys(localStorage));
  expect(claves.filter((k) => /balance|plegad|collapse/i.test(k))).toEqual([]);
});

// ── NFR-1503 · regresión: sigue siendo de escritorio ───────────────────────────────────────────

test("TC-RSP-040h: en escritorio el encabezado plegado tiene sus 24 celdas y ninguna fila", async ({ page }) => {
  // @aitri-tc TC-RSP-040h
  await gotoGrid(page, RSP);
  await plegar(page);

  // Ya no son doce columnas fijas: el encabezado plegado debe tener DOS celdas por cada
  // columna que la grilla pinte, sea cual sea el rango activo (multi-anio, FR-1905).
  await expect(headerCells(page)).toHaveCount((await visibleMonthCount(page)) * 2);
  // `balance-row` cuenta SOLO las filas del módulo: la fila operable de retiros vive en el segmento
  // de Reservas y lleva su propio testid desde FR-1810 (antes compartía éste y se colaba aquí).
  await expect(page.getByTestId("balance-row")).toHaveCount(0);
});

test("TC-RSP-041f: a 375px el módulo de Balance no se renderiza", async ({ page }) => {
  // @aitri-tc TC-RSP-041f
  await gotoGrid(page, RSP, "light", MOBILE);

  await expect(page.getByTestId("balance-module")).toHaveCount(0);
  await expect(page.getByTestId("balance-header-cell")).toHaveCount(0);
});

test("TC-RSP-042e: el breakpoint no se mueve — 760px sin módulo, 761px con módulo", async ({ page }) => {
  // @aitri-tc TC-RSP-042e
  await gotoGrid(page, RSP, "light", { width: 760, height: 1000 });
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await expect(page.getByTestId("balance-module")).toHaveCount(0);

  await page.setViewportSize({ width: 761, height: 1000 });
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("balance-module")).toHaveCount(1);
});
