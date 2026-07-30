import { test, expect, type Page } from "@playwright/test";

// Feature transferencias (Reservas) — EP-04: la grilla habla SALDO. Los TCs visuales afirman
// VALORES COMPUTADOS reales (color, texto, persistencia), nunca clases. Prefijo TC-TRF-*.

const DESK = { width: 1440, height: 1250 };

// Tintas del tema claro (globals.css) — los tres estados de una celda-saldo (9.6).
const FG = "rgb(28, 28, 31)"; //        --fg          (explícita plena, Ejec.)
const FG_MUTED = "rgb(107, 107, 115)"; // --fg-muted   (arrastrada / sin historia)
const STATE_WARNING = "rgb(158, 71, 8)"; // --state-warning (marca de plan inviable)

type CellMap = Record<string, Record<string, number>>;

const NODES = [
  { id: "g-ingresos", type: "income", level: "group", parentId: null, name: "Trabajo", order: 0 },
  { id: "c-salario", type: "income", level: "category", parentId: "g-ingresos", name: "Salario", order: 1 },
  { id: "g-gastos", type: "expense", level: "group", parentId: null, name: "Esenciales", order: 2 },
  { id: "c-mercado", type: "expense", level: "category", parentId: "g-gastos", name: "Mercado", order: 3 },
  { id: "g-ahorro", type: "transfer", level: "group", parentId: null, name: "Ahorro", order: 4 },
  { id: "c-viaje", type: "transfer", level: "category", parentId: "g-ahorro", name: "Viaje", order: 5 },
  { id: "c-fondo", type: "transfer", level: "category", parentId: "g-ahorro", name: "Fondo", order: 6 },
  { id: "c-vacia", type: "transfer", level: "category", parentId: "g-ahorro", name: "Vaciada", order: 7 },
  { id: "c-nueva", type: "transfer", level: "category", parentId: "g-ahorro", name: "Nueva", order: 8 },
];

/** Fixture BASE: margen holgado en ene; Viaje arrastra desde jul; Vaciada quedó en 0 explícito. */
const BASE = {
  budgets: {} as CellMap,
  actuals: {
    "c-salario": { ene: 1_000_000 },
    "c-viaje": { jul: 200_000 },
    "c-fondo": { ene: 300_000 },
    "c-vacia": { feb: 100_000, dic: 0 },
  } as CellMap,
};

/** Fixture TIGHT: margen exacto de 150.000 en ene (para el bloqueo del techo con mensaje). */
const TIGHT = {
  budgets: {} as CellMap,
  actuals: { "c-salario": { ene: 150_000 } } as CellMap,
};

/** Fixture PLAN: trayectoria Pres. de Viaje que supera el margen planeado de marzo (1.000.000). */
const PLAN = {
  budgets: { "c-viaje": { mar: 1_200_000 } } as CellMap,
  actuals: { "c-salario": { ene: 1_000_000 } } as CellMap,
};

async function seed(page: Page, data: { budgets: CellMap; actuals: CellMap; movements?: unknown[] }, opts: { noticeSeen?: boolean } = {}) {
  await page.addInitScript(
    ({ nodes, budgets, actuals, movements, noticeSeen }) => {
      if (localStorage.getItem("ledger.nodes.v1")) return; // idempotente entre navegaciones
      localStorage.setItem(
        "ledger.nodes.v1",
        JSON.stringify({ version: 1, ownerId: "local", nodes: nodes.map((n) => ({ ...n, ownerId: "local", icon: null })) })
      );
      localStorage.setItem("ledger.budget.v3", JSON.stringify({ version: 3, budgets, actuals, movements }));
      if (noticeSeen) localStorage.setItem("ledger.ui.reservasNoticeSeen.v1", "1");
    },
    { nodes: NODES, budgets: data.budgets, actuals: data.actuals, movements: data.movements ?? [], noticeSeen: opts.noticeSeen ?? true }
  );
}

async function gotoGrid(page: Page, data: { budgets: CellMap; actuals: CellMap; movements?: unknown[] } = BASE, opts: { noticeSeen?: boolean } = {}) {
  await page.setViewportSize(DESK);
  await seed(page, data, opts);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
}

const rowByName = (page: Page, name: string) =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: name }) });

/** Celda de una hoja transfer: mes (0-11) × plano. Solo válido con la fila SIN editor abierto. */
const reserveCell = (page: Page, name: string, monthIdx: number, plane: "budget" | "actual") =>
  rowByName(page, name).getByTestId("cell-leaf").nth(monthIdx * 2 + (plane === "actual" ? 1 : 0));

/** El estado persistido (v3) tal como quedó en localStorage. */
async function persisted(page: Page): Promise<{ budgets: CellMap; actuals: CellMap; movements: unknown[] }> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("ledger.budget.v3") ?? "null"));
}

test.describe("FR-1002 — la celda dice su SALDO", () => {
  test("TC-TRF-102h: la celda-saldo pinta explícita plena, arrastrada atenuada, y el badge SALDO está en el bloque", async ({ page }) => {
    // @aitri-tc TC-TRF-102h
    await gotoGrid(page);

    // jul explícito: '200.000' en tinta plena.
    const jul = reserveCell(page, "Viaje", 6, "actual");
    await expect(jul).toHaveText("200.000");
    await expect(jul).toHaveCSS("color", FG);
    // ago..dic arrastran: misma cifra en la tinta más atenuada.
    for (const idx of [7, 8, 9, 10, 11]) {
      const cell = reserveCell(page, "Viaje", idx, "actual");
      await expect(cell).toHaveText("200.000");
      await expect(cell).toHaveCSS("color", FG_MUTED);
    }
    // El rótulo del bloque RESERVAS lleva el badge de semántica.
    const typeRow = page.getByTestId("type-total-row").filter({ hasText: "RESERVAS" });
    await expect(typeRow.getByTestId("saldo-badge")).toHaveText("SALDO");
  });

  test("TC-TRF-102e: '0' explícito ≠ '—' sin historia ≠ gris arrastrado — tres tintas distinguibles", async ({ page }) => {
    // @aitri-tc TC-TRF-102e
    await gotoGrid(page);

    // Diciembre, tres alcancías, tres estados:
    const vaciada = reserveCell(page, "Vaciada", 11, "actual"); // 0 EXPLÍCITO
    await expect(vaciada).toHaveText("0");
    await expect(vaciada).toHaveCSS("color", FG); // legible como DATO, no como ausencia
    const sinHistoria = reserveCell(page, "Nueva", 11, "actual");
    await expect(sinHistoria).toHaveText("—");
    await expect(sinHistoria).toHaveCSS("color", FG_MUTED);
    const arrastrada = reserveCell(page, "Viaje", 11, "actual");
    await expect(arrastrada).toHaveText("200.000");
    await expect(arrastrada).toHaveCSS("color", FG_MUTED);
  });

  test("TC-TRF-102f: ninguna celda transfer muestra un negativo bajo ninguna secuencia válida", async ({ page }) => {
    // @aitri-tc TC-TRF-102f
    await gotoGrid(page);

    // Guardar (subir Fondo), sacar (bajar Viaje) y mover A→B por dos ediciones.
    await reserveCell(page, "Fondo", 2, "actual").click();
    await page.getByLabel("Editar saldo").fill("400000");
    await page.keyboard.press("Enter");
    await reserveCell(page, "Viaje", 8, "actual").click();
    await page.getByLabel("Editar saldo").fill("150000");
    await page.keyboard.press("Enter");
    // A→B: bajar Fondo primero, subir Viaje después (el retiro financia el aporte).
    await reserveCell(page, "Fondo", 9, "actual").click();
    await page.getByLabel("Editar saldo").fill("300000");
    await page.keyboard.press("Enter");
    await reserveCell(page, "Viaje", 9, "actual").click();
    await page.getByLabel("Editar saldo").fill("250000");
    await page.keyboard.press("Enter");

    // Escaneo completo del bloque RESERVAS: cero celdas con signo negativo.
    for (const name of ["Viaje", "Fondo", "Vaciada", "Nueva"]) {
      const texts = await rowByName(page, name).getByTestId("cell-leaf").allTextContents();
      for (const t of texts) {
        expect(t.startsWith("−"), `${name}: "${t}"`).toBe(false);
        expect(t.startsWith("-"), `${name}: "${t}"`).toBe(false);
      }
    }
  });

  test("TC-TRF-202e: el banner post-migración aparece exactamente una vez", async ({ page }) => {
    // @aitri-tc TC-TRF-202e
    await gotoGrid(page, BASE, { noticeSeen: false });

    const banner = page.getByTestId("reservas-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Las celdas de Reservas ahora muestran el saldo");
    await banner.getByRole("button", { name: "Entendido" }).click();
    await expect(banner).toHaveCount(0);

    // El flag quedó persistido y el banner no reaparece en las siguientes cargas.
    expect(await page.evaluate(() => localStorage.getItem("ledger.ui.reservasNoticeSeen.v1"))).toBe("1");
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await expect(page.getByTestId("reservas-banner")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await expect(page.getByTestId("reservas-banner")).toHaveCount(0);
  });
});

test.describe("FR-1003 — editar la celda = operar el saldo", () => {
  test("TC-TRF-103h: bajar la celda saca a Disponible, con toast y Deshacer que revierte todo", async ({ page }) => {
    // @aitri-tc TC-TRF-103h
    await gotoGrid(page);
    await expect(page.getByTestId("balance-module")).toBeVisible();

    const availableRow = page.locator('[data-testid="balance-row"][data-row="available"]');
    const availableSep = availableRow.getByTestId("balance-cell").nth(8 * 2 + 1); // sep, plano Ejec.
    await expect(availableSep).toHaveText("400.000"); // 1.000.000 − 300.000 (Fondo) − 200.000 (Viaje) − 100.000 (Vaciada)

    // Editar sep de Viaje (arrastra 200.000) a 150.000 = sacar 50.000.
    await reserveCell(page, "Viaje", 8, "actual").click();
    await page.getByLabel("Editar saldo").fill("150000");
    await page.keyboard.press("Enter");

    await expect(reserveCell(page, "Viaje", 8, "actual")).toHaveText("150.000");
    await expect(availableSep).toHaveText("450.000"); // el disponible subió exactamente 50.000
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Sacaste $50.000 de Viaje → Disponible");
    await expect(toast).toContainText("Deshacer");

    // Deshacer revierte la operación completa: saldo, balance y journal sin residuo.
    await page.getByTestId("toast-undo").click();
    await expect(reserveCell(page, "Viaje", 8, "actual")).toHaveText("200.000");
    await expect(reserveCell(page, "Viaje", 8, "actual")).toHaveCSS("color", FG_MUTED); // vuelve a arrastrar
    await expect(availableSep).toHaveText("400.000");
    expect((await persisted(page)).movements).toHaveLength(0);
  });

  test("TC-TRF-103e: commit sin cambio sobre celda arrastrada = no-op total", async ({ page }) => {
    // @aitri-tc TC-TRF-103e
    await gotoGrid(page);

    const oct = reserveCell(page, "Viaje", 9, "actual");
    await expect(oct).toHaveCSS("color", FG_MUTED);
    await oct.click();
    // El editor abre con el valor RESUELTO (el arrastrado) ya cargado y seleccionado.
    const input = page.getByLabel("Editar saldo");
    await expect(input).toHaveValue("200000");
    await page.keyboard.press("Enter");

    // Cero escritura, cero journal, sigue gris.
    await expect(reserveCell(page, "Viaje", 9, "actual")).toHaveCSS("color", FG_MUTED);
    const stored = await persisted(page);
    expect(stored.actuals["c-viaje"]).toEqual({ jul: 200_000 }); // oct NO es clave explícita
    expect(stored.movements).toHaveLength(0);
  });

  test("TC-TRF-103f: el bloqueo no cierra el editor: mensaje inline, valor seleccionado, Escape restaura", async ({ page }) => {
    // @aitri-tc TC-TRF-103f
    await gotoGrid(page, TIGHT);

    // Nueva sin historia; teclear 200.000 exige un aporte de 200.000 con margen 150.000.
    await reserveCell(page, "Nueva", 0, "actual").click();
    const input = page.getByLabel("Editar saldo");
    await input.fill("200000");
    await page.keyboard.press("Enter");

    // El editor NO se cierra: input visible y con foco, franja con el mensaje exacto.
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.getByTestId("reserve-block")).toContainText("No puedes reservar $200.000: tu margen este mes es $150.000");
    // El valor rechazado queda seleccionado («corrige o Escape»).
    expect(await input.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(6);

    // Escape restaura el valor previo y nada se persistió (la recarga lo confirma).
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(reserveCell(page, "Nueva", 0, "actual")).toHaveText("—");
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await expect(reserveCell(page, "Nueva", 0, "actual")).toHaveText("—");
    expect((await persisted(page)).actuals["c-nueva"]).toBeUndefined();
  });
});

// ── contraste WCAG calculado de valores reales del navegador (patrón de TC-BSC-453h) ───────────
function parseColor(s: string): number[] {
  const t = s.trim();
  if (t.startsWith("#")) {
    const hex = t.slice(1);
    if (hex.length === 3) return [...hex].map((h) => parseInt(h + h, 16));
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

/** color y background-color computados de un locator. */
async function paint(l: ReturnType<Page["locator"]>): Promise<{ color: string; bg: string }> {
  return l.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, bg: cs.backgroundColor };
  });
}

/** Valor resuelto de una variable CSS del tema activo (medida sobre un elemento real). */
async function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((v) => getComputedStyle(document.body).getPropertyValue(v).trim(), name);
}

test.describe("NFR-1006 — accesibilidad de los estados nuevos", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`TC-TRF-156h: las tintas nuevas pasan AA sobre sus superficies en ambos temas (${scheme})`, async ({ page }) => {
      // @aitri-tc TC-TRF-156h
      await page.emulateMedia({ colorScheme: scheme });
      await gotoGrid(page, PLAN);

      // Los tres pares del spec, con los valores REALES que el tema resuelve en el navegador.
      const [fgMuted, bg, error, bgCard, warning] = await Promise.all(
        ["--fg-muted", "--bg", "--error", "--bg-card", "--state-warning"].map((v) => cssVar(page, v))
      );
      expect(contrast(fgMuted, bg), `arrastrada ${scheme}: ${fgMuted} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(error, bgCard), `bloqueo ${scheme}: ${error} sobre ${bgCard}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(warning, bg), `plan ${scheme}: ${warning} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);

      // Y la UI usa esas tintas de verdad: marca de plan sobre su celda…
      const warnPaint = await paint(reserveCell(page, "Viaje", 2, "budget"));
      expect(parseColor(warnPaint.color)).toEqual(parseColor(warning));
      // …y franja de bloqueo real (provocada) pintada con --error sobre --bg-card.
      await reserveCell(page, "Nueva", 0, "actual").click();
      await page.getByLabel("Editar saldo").fill("999999999");
      await page.keyboard.press("Enter");
      const block = page.getByTestId("reserve-block");
      await expect(block).toBeVisible();
      const blockPaint = await paint(block);
      expect(contrast(blockPaint.color, blockPaint.bg), `franja ${scheme}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("TC-TRF-156f: ningún estado nuevo depende SOLO del color", async ({ page }) => {
    // @aitri-tc TC-TRF-156f
    await gotoGrid(page, PLAN);

    // Plan inviable: porta el glifo «!» (texto real en el DOM, no un tinte).
    const warn = reserveCell(page, "Viaje", 2, "budget");
    await expect(warn).toContainText("!");
    await expect(warn).toHaveAttribute("data-plan-warn", "true");

    // Arrastre: el dato COMPLETO está en el texto (la cifra resuelta) y el estado viaja en un
    // atributo inspeccionable sin percepción de color.
    const carried = reserveCell(page, "Viaje", 11, "budget");
    await expect(carried).toHaveAttribute("data-reserve-state", "carried");
    expect(((await carried.textContent()) ?? "").trim().length).toBeGreaterThan(0);
    // Y el «0» explícito ≠ «—» sin historia: distinción por TEXTO, no por tinte.
    await expect(reserveCell(page, "Nueva", 0, "actual")).toHaveText("—");

    // Bloqueo: porta el mensaje completo en texto (número exacto incluido), jamás solo un borde rojo.
    await reserveCell(page, "Nueva", 0, "actual").click();
    await page.getByLabel("Editar saldo").fill("999999999");
    await page.keyboard.press("Enter");
    const block = page.getByTestId("reserve-block");
    await expect(block).toBeVisible();
    const text = (await block.textContent()) ?? "";
    expect(text).toMatch(/margen|solo tiene|Bloquea/);
    expect(text).toMatch(/\$/); // el número exacto está escrito
  });
});

test.describe("FR-1012 — observaciones por celda", () => {
  test("TC-TRF-112h: la nota de una operación De→A se lee desde la celda del mes", async ({ page }) => {
    // @aitri-tc TC-TRF-112h
    // Un retiro con nota «pasaje» ya registrado en sep (journal con from/to).
    const data = {
      budgets: {} as CellMap,
      actuals: { "c-salario": { ene: 1_000_000 }, "c-viaje": { jul: 200_000, sep: 150_000 } } as CellMap,
      movements: [
        { id: "mv-1", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 50_000, month: "sep", createdAt: 1, from: "c-viaje", to: "@disponible", note: "pasaje" },
      ],
    };
    await gotoGrid(page, data);

    // La celda del mes de la alcancía afectada muestra el punto indicador y la nota es legible.
    const cell = reserveCell(page, "Viaje", 8, "actual");
    await expect(cell.getByTestId("note-dot")).toBeVisible();
    await expect(cell).toHaveAttribute("title", /pasaje/);
    // Lectura completa al interactuar: el editor lista la observación derivada del journal…
    await cell.click();
    const notes = page.getByTestId("cell-notes");
    await expect(notes.getByTestId("cell-note")).toHaveText("pasaje");
    // …y se puede añadir una manual, que aflora de inmediato.
    await page.getByLabel("Añadir observación").fill("meta del viaje");
    await page.getByTestId("cell-note-add").click();
    await expect(notes.getByTestId("cell-note")).toHaveCount(2);
    await expect(notes.getByTestId("cell-note").nth(1)).toHaveText("meta del viaje");
  });

  test("TC-TRF-112e: celda sin observaciones: sin indicador y con placeholder en el editor", async ({ page }) => {
    // @aitri-tc TC-TRF-112e
    await gotoGrid(page);

    const cell = reserveCell(page, "Fondo", 4, "actual"); // may: arrastra, sin nota alguna
    await expect(cell.getByTestId("note-dot")).toHaveCount(0);
    await cell.click();
    await expect(page.getByTestId("cell-notes-empty")).toHaveText("Sin observaciones este mes");
  });
});

test.describe("FR-1008 — el plan AVISA con su propia marca", () => {
  test("TC-TRF-108e: la marca del plan es «!» + ámbar: canal no cromático propio, distinto de ›/›› y ‹‹", async ({ page }) => {
    // @aitri-tc TC-TRF-108e
    await gotoGrid(page, PLAN);

    // La celda Pres. de marzo de Viaje guarda 1.200.000 (delta planeado > margen 1.000.000).
    const cell = reserveCell(page, "Viaje", 2, "budget");
    await expect(cell).toHaveAttribute("data-plan-warn", "true");
    await expect(cell).toHaveCSS("color", STATE_WARNING);
    const text = (await cell.textContent()) ?? "";
    // Marca de forma propia: «!», y JAMÁS las de sobre-consumo (›/››) ni la de negativo (‹‹).
    expect(text).toContain("!");
    expect(text).toContain("1.200.000"); // el valor SE GUARDÓ: avisar, no bloquear
    expect(text).not.toContain("›");
    expect(text).not.toContain("‹");
    // Visible sin percepción de color: la marca es texto, presente en el DOM accesible.
    await expect(cell).toContainText("!");
  });
});
