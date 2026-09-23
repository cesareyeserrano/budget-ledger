import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger, readLedger } from "./helpers/seed";
import type { LedgerNode } from "@/domain/types";

// Feature transferencias · modelo v4 — la grilla habla APORTES del mes; los retiros se operan y
// corrigen en la fila «Retiros del mes» del Balance. Valores COMPUTADOS reales. Prefijo TC-TRF4-*.

const DESK = { width: 1440, height: 1250 };

type CellMap = Record<string, Record<string, number>>;
type Mov = Record<string, unknown>;

const NODES = [
  { id: "g-ingresos", type: "income", level: "group", parentId: null, name: "Trabajo", order: 0 },
  { id: "c-salario", type: "income", level: "category", parentId: "g-ingresos", name: "Salario", order: 1 },
  { id: "g-gastos", type: "expense", level: "group", parentId: null, name: "Esenciales", order: 2 },
  { id: "c-mercado", type: "expense", level: "category", parentId: "g-gastos", name: "Mercado", order: 3 },
  { id: "g-ahorro", type: "transfer", level: "group", parentId: null, name: "Ahorro", order: 4 },
  { id: "c-viaje", type: "transfer", level: "category", parentId: "g-ahorro", name: "Viaje", order: 5 },
  { id: "c-fondo", type: "transfer", level: "category", parentId: "g-ahorro", name: "Fondo", order: 6 },
  { id: "s-fondo-emergencia", type: "transfer", level: "sub", parentId: "c-fondo", name: "Emergencia", order: 7 },
  { id: "c-nueva", type: "transfer", level: "category", parentId: "g-ahorro", name: "Nueva", order: 8 },
];

/** BASE: margen holgado; Viaje aporta en ene; la sub Emergencia aporta en feb. */
const BASE = {
  budgets: {} as CellMap,
  actuals: { "c-salario": { "2026-01": 1_000_000 }, "c-viaje": { "2026-01": 100_000 }, "s-fondo-emergencia": { "2026-02": 200_000 } } as CellMap,
  movements: [] as Mov[],
};

// Siembra por la API autenticada (feature servidor-fuente-unica, FR-1104): localStorage dejó de
// almacenar datos financieros. El PUT es un snapshot completo, así que cada test parte de un
// estado conocido — el aislamiento entre tests paralelos lo da la cuenta por worker (fixtures.ts).
async function seed(page: Page, data: { budgets: CellMap; actuals: CellMap; movements?: Mov[] }) {
  await seedLedger(page, {
    nodes: NODES.map((n) => ({ ...n, ownerId: "local", icon: null })) as unknown as LedgerNode[],
    budgets: data.budgets,
    actuals: data.actuals,
    movements: (data.movements ?? []) as unknown as Parameters<typeof seedLedger>[1]["movements"],
  });
}

async function gotoGrid(page: Page, data: { budgets: CellMap; actuals: CellMap; movements?: Mov[] } = BASE) {
  await page.setViewportSize(DESK);
  await seed(page, data);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
}

const rowByName = (page: Page, name: string) =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: name }) });

/** Celda de una hoja transfer: mes (0-11) × plano. */
const reserveCell = (page: Page, name: string, monthIdx: number, plane: "budget" | "actual") =>
  rowByName(page, name).getByTestId("cell-leaf").nth(monthIdx * 2 + (plane === "actual" ? 1 : 0));

async function persisted(page: Page): Promise<{ budgets: CellMap; actuals: CellMap; movements: { id: string; from?: string; to?: string; note?: string | null; period: string; amount: number }[] }> {
  // Se lee del SERVIDOR, que es la fuente de verdad (FR-1103) — antes se leía ledger.budget.v4.
  const state = await readLedger(page);
  return state as unknown as { budgets: CellMap; actuals: CellMap; movements: { id: string; from?: string; to?: string; note?: string | null; period: string; amount: number }[] };
}

/**
 * Cuenta los movimientos del servidor esperando a que converja.
 *
 * La UI se actualiza en el acto y la persistencia va detrás (fire-and-forget), así que leer el
 * servidor justo después de una acción es una carrera: la aserción de pantalla ya pasó y el PUT
 * puede seguir en vuelo. Desde que las escrituras se serializan (BL-010), el PUT del «Deshacer»
 * además espera su turno tras el de la operación que deshace, y la ventana se ensanchó lo bastante
 * como para fallar ~1 de cada 3 corridas.
 */
async function expectMovementCount(page: Page, n: number): Promise<void> {
  // NFR-2502: se cuentan los movimientos DE LA PRUEBA. Desde que el servidor exige que cada celda
  // de gasto o ingreso cuadre con sus movimientos, la siembra añade el respaldo que falte
  // (`helpers/seed.ts`), y esas filas no son lo que estas pruebas miden — aquí se opera con
  // reservas. Contarlas habría obligado a cambiar el número esperado, que es justo lo que no se hace.
  await expect.poll(
    async () => (await persisted(page)).movements.filter((m) => !m.id.startsWith("respaldo-")).length,
    { timeout: 10_000 }
  ).toBe(n);
}

/** Un retiro ya operado, para las fixtures que lo necesitan. */
const retiro = (from: string, period: string, amount: number, note?: string): Mov => ({
  id: `mv-${from}-${period}`, ownerId: "local", type: "transfer", catId: from, subId: null, target: from,
  amount, period, createdAt: 1, from, to: "@disponible", ...(note ? { note } : {}),
});

test.describe("FR-1002 — la celda dice el aporte del mes", () => {
  test("TC-TRF4-002h: la celda dice el aporte de ESE mes y el total del bloque es la suma del mes", async ({ page }) => {
    // @aitri-tc TC-TRF4-002h
    await gotoGrid(page);

    await expect(reserveCell(page, "Viaje", 0, "actual")).toHaveText("100.000");
    for (const idx of [1, 2, 11]) await expect(reserveCell(page, "Viaje", idx, "actual")).toHaveText("—");
    // la subcategoría vive bajo Fondo: expandirla primero
    await rowByName(page, "Fondo").first().getByLabel("Expandir").click();
    await expect(reserveCell(page, "Emergencia", 1, "actual")).toHaveText("200.000");

    // La fila total RESERVAS: ene = 100.000 y feb = 200.000 (jamás 300.000 acumulado).
    const typeRow = page.getByTestId("type-total-row").filter({ hasText: "RESERVAS" });
    const cells = typeRow.locator("div.flex > div").filter({ hasText: /./ });
    await expect(typeRow).toContainText("RESERVAS");
    const eneActual = typeRow.locator(":scope > div").nth(1).locator("> div").nth(1);
    const febActual = typeRow.locator(":scope > div").nth(2).locator("> div").nth(1);
    await expect(eneActual).toHaveText("100.000");
    await expect(febActual).toHaveText("200.000");
    void cells;
  });

  test("TC-TRF4-002e: la fila padre agrega celdas del mes, como los otros tipos", async ({ page }) => {
    // @aitri-tc TC-TRF4-002e
    await gotoGrid(page);
    // c-fondo (padre de Emergencia): feb = 200.000 y el resto em-dash.
    const fondoRow = rowByName(page, "Fondo").first();
    const cells = fondoRow.getByTestId("cell-parent");
    await expect(cells.nth(1 * 2 + 1)).toHaveText("200.000"); // feb Ejec.
    await expect(cells.nth(0 * 2 + 1)).toHaveText("—"); // ene Ejec.
    await expect(cells.nth(11 * 2 + 1)).toHaveText("—"); // dic Ejec. (sin acumulado)
  });

  test("TC-TRF4-002f: ninguna celda del bloque muestra un acumulado ni un negativo", async ({ page }) => {
    // @aitri-tc TC-TRF4-002f
    await gotoGrid(page, { ...BASE, movements: [retiro("c-viaje", "2026-03", 40_000)] });

    // Operar: subir un aporte por celda y sacar desde la fila Retiros del mes.
    await reserveCell(page, "Nueva", 2, "actual").click();
    await page.getByLabel("Editar valor").fill("50000");
    await page.keyboard.press("Enter");

    for (const name of ["Viaje", "Emergencia", "Nueva"]) {
      const texts = await rowByName(page, name).getByTestId("cell-leaf").allTextContents();
      for (const t of texts) {
        expect(t.startsWith("−"), `${name}: "${t}"`).toBe(false);
        expect(t.startsWith("-"), `${name}: "${t}"`).toBe(false);
      }
    }
    // La celda de Viaje sigue diciendo su aporte de ene (100.000) — no el saldo derivado (60.000).
    await expect(reserveCell(page, "Viaje", 0, "actual")).toHaveText("100.000");
  });
});

test.describe("FR-1003 — editar la celda con validación inline", () => {
  test("TC-TRF4-003f: el bloqueo del techo no cierra el editor: franja, valor seleccionado, Escape restaura", async ({ page }) => {
    // @aitri-tc TC-TRF4-003f
    await gotoGrid(page, { budgets: {}, actuals: { "c-salario": { "2026-01": 150_000 } }, movements: [] });

    await reserveCell(page, "Nueva", 0, "actual").click();
    const input = page.getByLabel("Editar valor");
    await input.fill("200000");
    await page.keyboard.press("Enter");

    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    // FR-1808 (feature techo-de-flujo) reescribió esta rama: el editor de celda compara el TOTAL
    // tecleado, no un incremento, así que el mensaje habla del total que la celda admite — la
    // MISMA cifra que su indicador «Máx.». Antes decía «tu margen este mes es $150.000» junto a un
    // «Máx. $150.000»: dos redacciones para el mismo límite. La aserción sigue siendo igual de
    // fuerte porque nombra la cifra exacta.
    await expect(page.getByTestId("reserve-block")).toContainText("Esta celda admite hasta $150.000 este mes");
    expect(await input.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(6);

    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await expect(reserveCell(page, "Nueva", 0, "actual")).toHaveText("—");
    expect((await persisted(page)).actuals["c-nueva"]).toBeUndefined();
  });
});

test.describe("FR-1008 — la marca del plan de aportes", () => {
  test("TC-TRF4-008e: la marca del plan es «!» + ámbar: canal propio, distinto de ›/›› y ‹‹", async ({ page }) => {
    // @aitri-tc TC-TRF4-008e
    await gotoGrid(page, { budgets: { "c-viaje": { "2026-03": 1_200_000 } }, actuals: { "c-salario": { "2026-01": 1_000_000 } }, movements: [] });

    const cell = reserveCell(page, "Viaje", 2, "budget");
    await expect(cell).toHaveAttribute("data-plan-warn", "true");
    await expect(cell).toHaveCSS("color", "rgb(158, 71, 8)"); // --state-warning claro
    const text = (await cell.textContent()) ?? "";
    expect(text).toContain("!");
    expect(text).toContain("1.200.000"); // el valor SE GUARDÓ
    expect(text).not.toContain("›");
    expect(text).not.toContain("‹");
  });
});

test.describe("FR-1012 — observaciones por celda", () => {
  test("TC-TRF4-012h: la nota de una operación De→A se lee desde la celda y se puede añadir manual", async ({ page }) => {
    // @aitri-tc TC-TRF4-012h
    await gotoGrid(page, { ...BASE, movements: [retiro("c-viaje", "2026-09", 50_000, "pasaje")] });

    const cell = reserveCell(page, "Viaje", 8, "actual");
    await expect(cell.getByTestId("note-dot")).toBeVisible();
    await expect(cell).toHaveAttribute("title", /pasaje/);
    await cell.click();
    const notes = page.getByTestId("cell-notes");
    await expect(notes.getByTestId("cell-note")).toHaveText("pasaje");
    await page.getByLabel("Añadir comentario").fill("meta del viaje");
    await page.getByTestId("cell-note-add").click();
    await expect(notes.getByTestId("cell-note")).toHaveCount(2);
    await expect(notes.getByTestId("cell-note").nth(1)).toHaveText("meta del viaje");
  });

  test("TC-TRF4-012e: celda sin movimientos ni comentarios: sin indicador y con placeholder en el editor", async ({ page }) => {
    // @aitri-tc TC-TRF4-012e
    await gotoGrid(page);
    const cell = reserveCell(page, "Viaje", 4, "actual");
    await expect(cell.getByTestId("note-dot")).toHaveCount(0);
    await cell.click();
    await expect(page.getByTestId("cell-notes-empty")).toHaveText("Sin movimientos ni comentarios");
  });
});

test.describe("FR-1014 — operar y corregir retiros en «Retiros del mes»", () => {
  test("TC-TRF4-014h: el mini-form saca con desplegable jerárquico, Máx. y toast con Deshacer", async ({ page }) => {
    // @aitri-tc TC-TRF4-014h
    await gotoGrid(page);
    await expect(page.getByTestId("balance-module")).toBeVisible();

    await page.getByTestId("withdraw-cell").nth(5).click(); // jun
    const select = page.getByTestId("withdraw-source");
    await expect(select).toBeVisible();
    // Desplegable con TODAS las alcancías, ruta completa y saldo derivado.
    await expect(select.locator("option", { hasText: "Ahorro · Fondo · Emergencia — $200.000" })).toHaveCount(1);
    await expect(select.locator("option", { hasText: "Ahorro · Viaje — $100.000" })).toHaveCount(1);
    await select.selectOption("s-fondo-emergencia");
    await page.getByTestId("withdraw-amount").fill("50000");
    await expect(page.getByText("Máx. $200.000")).toBeVisible();
    await page.getByTestId("withdraw-save").click();

    await expect(page.getByTestId("withdraw-cell").nth(5)).toContainText("50.000");
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Sacaste $50.000 de Emergencia → Disponible");
    await page.getByTestId("toast-undo").click();
    await expect(page.getByTestId("withdraw-cell").nth(5)).toHaveText("—");
    await expectMovementCount(page, 0);
  });

  test("TC-TRF4-014e: eliminar un retiro del historial restaura el saldo derivado", async ({ page }) => {
    // @aitri-tc TC-TRF4-014e
    await gotoGrid(page, { ...BASE, movements: [retiro("c-viaje", "2026-06", 40_000)] });

    await expect(page.getByTestId("withdraw-cell").nth(5)).toContainText("40.000");
    await page.getByTestId("withdraw-cell").nth(5).click();
    const history = page.getByTestId("withdraw-history");
    await expect(history).toContainText("Ahorro · Viaje");
    // FR-1802: el botón de borrar se retiró — la corrección es teclear el monto, y 0 elimina.
    const monto = page.getByTestId("op-amount-mv-c-viaje-2026-06");
    await monto.fill("0");
    await monto.press("Enter");

    await expect(page.getByTestId("withdraw-cell").nth(5)).toHaveText("—");
    await expectMovementCount(page, 0);
    // El saldo derivado se restauró: el desplegable (el popover sigue abierto) ofrece $100.000.
    await expect(page.getByTestId("withdraw-source").locator("option", { hasText: "Ahorro · Viaje — $100.000" })).toHaveCount(1);
  });

  test("TC-TRF4-014f: el sobre-retiro se gradúa como los gastos (›/›› + ámbar/rojo)", async ({ page }) => {
    // @aitri-tc TC-TRF4-014f
    await gotoGrid(page, {
      budgets: { "@retiros": { "2026-03": 100_000, "2026-05": 150_000 } },
      actuals: { "c-salario": { "2026-01": 1_000_000 }, "c-viaje": { "2026-01": 500_000 } },
      movements: [retiro("c-viaje", "2026-03", 150_000), retiro("c-viaje", "2026-05", 160_000), retiro("c-viaje", "2026-06", 30_000)],
    });

    // "2026-03": 150k/100k = 150% → rojo + ›› · "2026-05": 160k/150k ≈107% → ámbar + › · "2026-06": sin plan → rojo + ››
    const mar = page.getByTestId("withdraw-cell").nth(2);
    await expect(mar).toHaveAttribute("data-over", "over_hard");
    await expect(mar).toContainText("››");
    // el color es exactamente el token --state-over resuelto por el tema
    const stateOver = await cssVar(page, "--state-over");
    await expect(mar).toHaveCSS("color", stateOver);
    const may = page.getByTestId("withdraw-cell").nth(4);
    await expect(may).toHaveAttribute("data-over", "over_soft");
    await expect(may).toContainText("›");
    const jun = page.getByTestId("withdraw-cell").nth(5);
    await expect(jun).toHaveAttribute("data-over", "over_hard");
  });
});

test.describe("FR-1015 — retiros planeados", () => {
  test("TC-TRF4-015e: franja al exceder el plan y marca auto-sanadora al quedar descubierto", async ({ page }) => {
    // @aitri-tc TC-TRF4-015e
    await gotoGrid(page, {
      budgets: { "c-viaje": { "2026-01": 200_000 }, "@retiros": { "2026-06": 150_000 } },
      actuals: { "c-salario": { "2026-01": 1_000_000 } },
      movements: [],
    });

    // Exceder el plan: la franja con el límite exacto; el editor no se cierra.
    await page.getByTestId("planned-withdraw-cell").nth(1).click(); // feb
    const input = page.getByLabel("Retiro planeado");
    await input.fill("250000");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("planned-withdraw-block")).toContainText("Solo hay $200.000 reservados en tu plan hasta febrero");
    await page.keyboard.press("Escape");

    // Auto-sanador: el retiro planeado de jun (150k) quedó descubierto al bajar el plan de aportes.
    await reserveCell(page, "Viaje", 0, "budget").click();
    await page.getByLabel("Editar valor").fill("100000");
    await page.keyboard.press("Enter");
    const junPlanned = page.getByTestId("planned-withdraw-cell").nth(5);
    await expect(junPlanned).toHaveAttribute("data-plan-warn", "true");
    await expect(junPlanned).toContainText("!");
    await expect(junPlanned).toHaveAttribute("title", /ya no cubre/);
  });
});

// ── contraste WCAG computado (patrón de TC-BSC-453h) ───────────────────────────────────────────
function parseColor(s: string): number[] {
  const t = s.trim();
  if (t.startsWith("#")) {
    const hex = t.slice(1);
    return [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((h) => parseInt(h, 16));
  }
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
async function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((v) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${v})`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, name);
}

test.describe("NFR-1006 — accesibilidad de los estados nuevos", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`TC-TRF4-156h: las tintas nuevas pasan AA en ambos temas (${scheme})`, async ({ page }) => {
      // @aitri-tc TC-TRF4-156h
      await page.emulateMedia({ colorScheme: scheme });
      await gotoGrid(page, { budgets: {}, actuals: { "c-salario": { "2026-01": 150_000 } }, movements: [] });

      const [fgMuted, bg, error, bgCard, warning] = await Promise.all(
        ["--fg-muted", "--bg", "--error", "--bg-card", "--state-warning"].map((v) => cssVar(page, v))
      );
      expect(contrast(fgMuted, bg), `muted ${scheme}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(error, bgCard), `error ${scheme}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(warning, bg), `warning ${scheme}`).toBeGreaterThanOrEqual(4.5);

      // La franja de bloqueo REAL pintada con esos pares.
      await reserveCell(page, "Nueva", 0, "actual").click();
      await page.getByLabel("Editar valor").fill("999999999");
      await page.keyboard.press("Enter");
      const block = page.getByTestId("reserve-block");
      await expect(block).toBeVisible();
      const paint = await block.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, bg: cs.backgroundColor };
      });
      expect(contrast(paint.color, paint.bg), `franja ${scheme}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("TC-TRF4-156f: ningún estado nuevo depende SOLO del color", async ({ page }) => {
    // @aitri-tc TC-TRF4-156f
    await gotoGrid(page, {
      budgets: { "c-viaje": { "2026-03": 1_200_000 } },
      actuals: { "c-salario": { "2026-01": 1_000_000 }, "c-viaje": { "2026-01": 300_000 } },
      movements: [retiro("c-viaje", "2026-06", 100_000)],
    });

    // Plan inviable: glifo «!» + atributo inspeccionable.
    const warn = reserveCell(page, "Viaje", 2, "budget");
    await expect(warn).toContainText("!");
    await expect(warn).toHaveAttribute("data-plan-warn", "true");
    // Sobre-retiro (sin plan): glifo ›› + atributo.
    const jun = page.getByTestId("withdraw-cell").nth(5);
    await expect(jun).toContainText("››");
    await expect(jun).toHaveAttribute("data-over", "over_hard");
    // Bloqueo: el mensaje completo en texto, con el número exacto.
    await reserveCell(page, "Nueva", 0, "actual").click();
    await page.getByLabel("Editar valor").fill("999999999");
    await page.keyboard.press("Enter");
    const text = (await page.getByTestId("reserve-block").textContent()) ?? "";
    // Lo que este TC protege es que el estado se comunique con TEXTO y no solo con color, así que
    // el patrón admite cualquiera de las redacciones reales del dominio. «admite hasta» entra con
    // FR-1808 (el editor de celda habla del total tecleable).
    expect(text).toMatch(/margen|solo tiene|Bloquea|admite hasta/);
    expect(text).toMatch(/\$/);
  });
});
