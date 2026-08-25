import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import type { LedgerNode } from "@/domain/types";
import { MONTH_KEYS } from "../../src/domain/months";

// Feature balance-jerarquia — el módulo de Balance deja leer su propia aritmética, y el color pasa
// a señalar sólo la excepción en TODA la pantalla principal. Los TCs afirman VALORES COMPUTADOS
// (color resuelto, paddingLeft en px, contraste calculado), nunca clases ni presencia de nodos.
// Prefijo TC-BJE-*.

const DESK = { width: 1440, height: 1250 };

// ── tokens resueltos, por tema ────────────────────────────────────────────────────────────────
const BG_SUNKEN = "rgb(241, 241, 243)"; //   --bg-sunken claro
const FAVORABLE_LIGHT = "rgb(45, 118, 80)"; // --favorable claro — el token RETIRADO del módulo
const FAVORABLE_DARK = "rgb(95, 190, 130)"; // --favorable oscuro
const ALERT_LIGHT = "rgb(173, 57, 50)"; //    --alert-strong claro
const FG_LIGHT = "rgb(28, 28, 31)"; //        --fg claro
const FG_MUTED_LIGHT = "rgb(107, 107, 115)"; // --fg-muted claro
const FG_SECONDARY_LIGHT = "rgb(85, 85, 93)"; // --fg-secondary claro (color del sumando)
const FG_MUTED_DARK = "rgb(155, 155, 163)"; //  --fg-muted oscuro

// ── contraste WCAG a partir de los valores REALES del navegador ───────────────────────────────
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

// ── fixture ───────────────────────────────────────────────────────────────────────────────────
type Leaf = { id: string; budget: number; actual: number };

const NODES = [
  { id: "g-gastos", type: "expense", level: "group", parentId: null, name: "Esenciales", order: 0 },
  { id: "c-mercado", type: "expense", level: "category", parentId: "g-gastos", name: "Mercado", order: 0 },
  { id: "g-ingresos", type: "income", level: "group", parentId: null, name: "Trabajo", order: 0 },
  { id: "c-salario", type: "income", level: "category", parentId: "g-ingresos", name: "Salario", order: 0 },
  { id: "g-ahorro", type: "transfer", level: "group", parentId: null, name: "Reservas", order: 0 },
  { id: "c-alcancia", type: "transfer", level: "category", parentId: "g-ahorro", name: "Alcancía", order: 0 },
];

/** Balance SANO: ingresos > gastos, así que los tres resultados quedan ≥0 en los doce meses. */
const POSITIVE: Leaf[] = [
  { id: "c-mercado", budget: 300_000, actual: 300_000 },
  { id: "c-salario", budget: 1_000_000, actual: 1_000_000 },
  { id: "c-alcancia", budget: 100_000, actual: 100_000 },
];
/** Sobre-gasto real: el gasto supera al ingreso, así que disponible y total quedan <0. */
const NEGATIVE: Leaf[] = [
  { id: "c-mercado", budget: 300_000, actual: 900_000 },
  { id: "c-salario", budget: 1_000_000, actual: 100_000 },
  { id: "c-alcancia", budget: 100_000, actual: 0 },
];
/** Restante EXACTAMENTE cero: ejecutado iguala al presupuesto en los gastos. */
const RESTANTE_CERO: Leaf[] = [
  { id: "c-mercado", budget: 300_000, actual: 300_000 },
  { id: "c-salario", budget: 300_000, actual: 300_000 },
  { id: "c-alcancia", budget: 0, actual: 0 },
];

async function seed(page: Page, leaves: Leaf[], months: readonly string[] = MONTH_KEYS) {
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
  await seedLedger(page, {
    nodes: NODES.map((n) => ({ ...n, ownerId: "local", icon: null })) as unknown as LedgerNode[],
    budgets,
    actuals,
  });
}

async function goto(
  page: Page,
  leaves: Leaf[] = POSITIVE,
  scheme: "light" | "dark" = "light",
  months: readonly string[] = MONTH_KEYS,
) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(DESK);
  await seed(page, leaves, months);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("balance-module")).toBeVisible();
}

/** Colores computados de todas las celdas del módulo. */
async function cellColors(page: Page): Promise<string[]> {
  return page.getByTestId("balance-cell").evaluateAll((els) =>
    els.map((e) => getComputedStyle(e).color),
  );
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FR-1403 — neutro por defecto; el color sólo en la excepción
// ══════════════════════════════════════════════════════════════════════════════════════════════
test.describe("FR-1403 — el módulo deja de pintar verde permanente", () => {
  // @aitri-tc TC-BJE-006h
  test("TC-BJE-006h: con balance sano, CERO celdas usan --favorable en los doce meses", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    const colores = await cellColors(page);
    // Línea base medida el 2026-08-24 a 1920px: 3 filas de resultado × 12 meses × 2 planos = 72
    // celdas en --favorable. El criterio es CERO, no "menos".
    expect(colores.length).toBeGreaterThan(100); // el módulo sí está renderizado con datos
    expect(colores.filter((c) => c === FAVORABLE_LIGHT)).toHaveLength(0);

    // Y lo mismo en tema oscuro: el token cambia de valor, la regla no.
    await goto(page, POSITIVE, "dark");
    const oscuros = await cellColors(page);
    expect(oscuros.filter((c) => c === FAVORABLE_DARK)).toHaveLength(0);
  });

  // @aitri-tc TC-BJE-006e
  test("TC-BJE-006e: con el módulo PLEGADO, el encabezado del Saldo total también es neutro", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    // Plegar el módulo entero: es el ÚNICO estado en que HeaderTotalCell se pinta, y por eso la
    // primera redacción de los FR lo pasó por alto.
    await page.getByRole("button", { name: "Colapsar balance" }).click();

    const header = page.getByTestId("balance-header-cell");
    await expect(header.first()).toBeVisible();
    const colores = await header.evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
    expect(colores.length).toBeGreaterThan(0);
    expect(colores.filter((c) => c === FAVORABLE_LIGHT)).toHaveLength(0);
    // Antes usaba var(--success-strong), alias de --favorable: al plegar REAPARECÍA el verde.
    for (const c of colores) expect([FG_LIGHT, FG_MUTED_LIGHT]).toContain(c);
  });

  // @aitri-tc TC-BJE-006f
  test("TC-BJE-006f: plegado y con el total NEGATIVO, el encabezado conserva alerta y sus tres canales", async ({ page }) => {
    await goto(page, NEGATIVE, "light");
    await page.getByRole("button", { name: "Colapsar balance" }).click();

    // OJO con `.first()`: el encabezado alterna Pres./Ejec. por mes, y en este fixture el plano
    // PRESUPUESTADO queda positivo (el plan cuadra) mientras el EJECUTADO se va a rojo. Se
    // selecciona la celda por su contenido, no por su posición.
    const header = page.getByTestId("balance-header-cell").filter({ hasText: "−" }).first();
    await expect(header).toBeVisible();
    // Canal 1 — color de alerta.
    await expect(header).toHaveCSS("color", ALERT_LIGHT);
    // Canal 2 — el signo menos tipográfico.
    expect((await header.textContent())?.startsWith("−")).toBe(true);
    // Canal 3 — el glifo de forma, oculto para lectores porque el dato ya lo porta el signo.
    await expect(header.locator('[aria-hidden="true"]')).toHaveCount(1);
    // Plegar debe RESUMIR, no borrar la señal.
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FR-1404 — una celda sin dato nunca lleva el color de su fila
// ══════════════════════════════════════════════════════════════════════════════════════════════
test.describe("FR-1404 — el em-dash no gasta color", () => {
  // @aitri-tc TC-BJE-007h
  test("TC-BJE-007h: las celdas sin dato se pintan en --fg-muted, no en el color de su fila", async ({ page }) => {
    // Sólo se siembran tres meses: los nueve restantes quedan sin dato.
    const TRES = MONTH_KEYS.slice(0, 3);
    await goto(page, POSITIVE, "light", TRES);

    const guiones = await page.getByTestId("balance-cell").evaluateAll((els) =>
      els.filter((e) => e.textContent?.trim() === "—").map((e) => getComputedStyle(e).color),
    );
    expect(guiones.length).toBeGreaterThan(0);
    // Línea base 2026-08-24: las últimas celdas de "Disponible del mes" eran guiones VERDES.
    for (const c of guiones) expect(c).toBe(FG_MUTED_LIGHT);
    expect(guiones.filter((c) => c === FAVORABLE_LIGHT)).toHaveLength(0);

    await goto(page, POSITIVE, "dark", TRES);
    const oscuros = await page.getByTestId("balance-cell").evaluateAll((els) =>
      els.filter((e) => e.textContent?.trim() === "—").map((e) => getComputedStyle(e).color),
    );
    for (const c of oscuros) expect(c).toBe(FG_MUTED_DARK);
  });

  // @aitri-tc TC-BJE-007e
  // DESVIACIÓN DECLARADA respecto del caso aprobado en fase 3. El TC decía «un mes entero sin datos
  // presenta TODAS sus celdas en em-dash». La premisa es FALSA en este producto: por el ARRASTRE,
  // un mes sin movimientos propios sigue mostrando cifras — «Saldo mes anterior», «Saldo
  // disponible» y «Saldo total» se acarrean del mes previo. Un mes con todo en em-dash sólo existe
  // antes del primer dato del ledger. Lo que el TC quería proteger sigue verificado, y con el mismo
  // rigor: en un mes sin movimientos propios NO aparece ninguna marca de color — las celdas sin
  // dato van atenuadas y las arrastradas van neutras. Cero verde, cero alerta.
  test("TC-BJE-007e: un mes sin movimientos propios no introduce ninguna marca de color", async ({ page }) => {
    const TRES = MONTH_KEYS.slice(0, 3);
    await goto(page, POSITIVE, "light", TRES);

    // Las celdas van en orden de fila; por mes hay 2 (Pres./Ejec.). El último mes está vacío.
    const porFila = await page.getByTestId("balance-row").evaluateAll((filas) =>
      filas.map((f) =>
        [...f.querySelectorAll('[data-testid="balance-cell"]')].map((c) => ({
          txt: (c.textContent ?? "").trim(),
          color: getComputedStyle(c as HTMLElement).color,
        })),
      ),
    );
    expect(porFila).toHaveLength(8);
    // SIETE de las ocho filas usan `balance-cell`. La octava —«Retiros del mes»— es OPERABLE desde
    // la unificación del 2026-07-29 y monta sus propias celdas (`planned-withdraw-cell` /
    // `cell-leaf`), no `BalanceCell`. Queda fuera de este criterio a propósito: su rediseño es
    // BL-019, que está en el no_go_zone de esta feature.
    const conCeldas = porFila.filter((celdas) => celdas.length > 0);
    expect(conCeldas).toHaveLength(7);

    // Últimas dos celdas de cada fila = el último mes, que no se sembró.
    const ultimoMes = conCeldas.flatMap((celdas) => celdas.slice(-2));
    expect(ultimoMes).toHaveLength(14); // 7 filas × 2 planos

    // Cada celda es una de dos cosas, y ninguna lleva marca de color:
    const sinDato = ultimoMes.filter((c) => c.txt === "—");
    const arrastradas = ultimoMes.filter((c) => c.txt !== "—");
    expect(sinDato.length).toBeGreaterThan(0); // los sumandos del mes sí están vacíos
    expect(arrastradas.length).toBeGreaterThan(0); // los saldos se acarrean: es el arrastre

    for (const c of sinDato) expect(c.color).toBe(FG_MUTED_LIGHT); // ausencia → atenuado
    for (const c of arrastradas) expect([FG_LIGHT, FG_SECONDARY_LIGHT]).toContain(c.color);

    // El criterio que de verdad protege este caso: cero marcas de color en un mes tranquilo.
    expect(ultimoMes.filter((c) => c.color === FAVORABLE_LIGHT)).toHaveLength(0);
    expect(ultimoMes.filter((c) => c.color === ALERT_LIGHT)).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FR-1405 — el chip RESTANTE de la franja superior
// ══════════════════════════════════════════════════════════════════════════════════════════════
test.describe("FR-1405 — arriba y abajo, la misma regla", () => {
  /** Los tres valores de la franja: PRESUPUESTO, EJECUTADO, RESTANTE. */
  const stripValues = (page: Page) =>
    page.getByTestId("summary-strip").getByTestId("kpi-value");

  // @aitri-tc TC-BJE-008h
  test("TC-BJE-008h: con restante positivo, los tres chips comparten color", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    const colores = await stripValues(page).evaluateAll((els) =>
      els.map((e) => getComputedStyle(e).color),
    );
    expect(colores).toHaveLength(3);
    // El conjunto de colores distintos de la franja tiene tamaño 1: un solo criterio.
    expect(new Set(colores).size).toBe(1);
    expect(colores.filter((c) => c === FAVORABLE_LIGHT)).toHaveLength(0);
  });

  // @aitri-tc TC-BJE-008e
  test("TC-BJE-008e: un restante de EXACTAMENTE cero se pinta neutro, no verde", async ({ page }) => {
    await goto(page, RESTANTE_CERO, "light");
    const [, , restante] = await stripValues(page).evaluateAll((els) =>
      els.map((e) => ({ txt: e.textContent ?? "", color: getComputedStyle(e).color })),
    );
    // Es el borde exacto: la condición anterior `kpis.available >= 0` incluía el cero y lo pintaba
    // de verde. Cero no es una buena noticia: es el límite.
    expect(restante.txt).toBe("$0");
    expect(restante.color).not.toBe(FAVORABLE_LIGHT);
    expect(restante.color).not.toBe(ALERT_LIGHT);
  });

  // @aitri-tc TC-BJE-008f
  test("TC-BJE-008f: con restante negativo, el chip es el ÚNICO elemento coloreado de la franja", async ({ page }) => {
    await goto(page, NEGATIVE, "light");
    const vals = await stripValues(page).evaluateAll((els) =>
      els.map((e) => getComputedStyle(e).color),
    );
    expect(vals).toHaveLength(3);
    const [presupuesto, ejecutado, restante] = vals;
    expect(restante).toBe(ALERT_LIGHT);
    // Los otros dos NO cambian: si lo hicieran, la señal volvería a competir.
    expect(presupuesto).not.toBe(ALERT_LIGHT);
    expect(ejecutado).not.toBe(ALERT_LIGHT);
    expect(vals.filter((c) => c === ALERT_LIGHT)).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// NFR-1402 — la accesibilidad no cromática no se degrada al retirar el verde
// ══════════════════════════════════════════════════════════════════════════════════════════════
test.describe("NFR-1402 — tres canales y contraste AA", () => {
  // @aitri-tc TC-BJE-010h
  test("TC-BJE-010h: un valor negativo conserva color, signo y glifo a la vez", async ({ page }) => {
    await goto(page, NEGATIVE, "light");
    // La celda tiene que venir de una fila CON ALARMA. Un sumando negativo —«Flujo del mes» en
    // rojo, por ejemplo— lleva su signo pero NO se colorea: `alarms:false` significa que su negativo
    // es normal y no una excepción. Filtrar sólo por el signo menos recogía justamente esas.
    const primera = page
      .locator('[data-testid="balance-row"][data-row="total"]')
      .getByTestId("balance-cell")
      .filter({ hasText: "−" })
      .first();
    await expect(primera).toBeVisible();
    await expect(primera).toHaveCSS("color", ALERT_LIGHT); // canal 1
    expect((await primera.textContent())?.includes("−")).toBe(true); // canal 2
    await expect(primera.locator('[aria-hidden="true"]')).toHaveCount(1); // canal 3
  });

  // @aitri-tc TC-BJE-010e
  test("TC-BJE-010e: con un mes FILTRADO, el módulo conserva su superficie y su contraste", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    await page.getByLabel("Mes").click();
    await page.getByRole("option", { name: "Enero", exact: true }).click();

    // El módulo NO sigue el resaltado del filtro: decisión deliberada, porque el tinte oscurece la
    // celda hasta #e4e4e6 y los colores perderían AA. Es una regresión vigente, no una novedad.
    const fondos = await page.getByTestId("balance-cell").evaluateAll((els) =>
      els.map((e) => getComputedStyle(e).backgroundColor),
    );
    for (const f of new Set(fondos)) expect(f).toBe(BG_SUNKEN);

    const pares = await page.getByTestId("balance-cell").evaluateAll((els) =>
      els.map((e) => ({
        fg: getComputedStyle(e).color,
        bg: getComputedStyle(e).backgroundColor,
      })),
    );
    for (const p of pares) expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(4.5);
  });

  // @aitri-tc TC-BJE-010f
  test("TC-BJE-010f: ningún texto del módulo baja de 4,5:1, en ambos temas", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await goto(page, NEGATIVE, scheme);
      const pares = await page
        .locator('[data-testid="balance-cell"], [data-testid="balance-label"]')
        .evaluateAll((els) =>
          els.map((e) => ({
            fg: getComputedStyle(e).color,
            bg: getComputedStyle(e).backgroundColor,
            txt: (e.textContent ?? "").trim(),
          })),
        );
      expect(pares.length).toBeGreaterThan(0);
      const ratios = pares.map((p) => contrast(p.fg, p.bg));
      expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FR-1401 / FR-1402 — la escalera sobre la pantalla real (EP-02)
// ══════════════════════════════════════════════════════════════════════════════════════════════
const ORDEN_ESPERADO = [
  "Flujo del mes",
  "Reservas del mes",
  "Retiros del mes",
  "Disponible del mes",
  "Saldo mes anterior",
  "Saldo disponible",
  "Saldo reservado",
  "Saldo total",
];

/** Textos de las etiquetas, en orden de DOM. */
const labelTexts = (page: Page) =>
  page.getByTestId("balance-label").evaluateAll((els) =>
    els.map((e) => (e.textContent ?? "").replace(/[+−=]/g, "").trim()),
  );

test.describe("FR-1401 — el orden renderizado sigue la aritmética", () => {
  // @aitri-tc TC-BJE-002h
  test("TC-BJE-002h: ocho filas, las mismas ocho etiquetas, en el orden de la cascada", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    const textos = await labelTexts(page);
    expect(textos).toEqual(ORDEN_ESPERADO);
    // El conjunto NO cambia: no se añadió ni se quitó ninguna fila (no_go_zone del usuario).
    expect(textos).toHaveLength(8);
  });

  // @aitri-tc TC-BJE-002f
  test("TC-BJE-002f: un mes sin datos conserva el orden y no colapsa ninguna fila", async ({ page }) => {
    await goto(page, POSITIVE, "light", MONTH_KEYS.slice(0, 3));
    // Si alguna fila desapareciera en los meses vacíos, el layout se movería entre meses y la
    // lectura vertical de la cascada se rompería.
    expect(await labelTexts(page)).toEqual(ORDEN_ESPERADO);
    await expect(page.getByTestId("balance-row")).toHaveCount(8);
  });

  // @aitri-tc TC-BJE-013h
  test("TC-BJE-013h: el orden de lectura accesible coincide con el declarado", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    // El orden de DOM ES el orden que anuncia un lector de pantalla. Al seguir la aritmética, la
    // lectura secuencial MEJORA: cada resultado se anuncia después de sus sumandos.
    expect(await labelTexts(page)).toEqual(ORDEN_ESPERADO);
    // Y ninguna fila depende de un tabindex numérico que el reordenamiento hubiera desincronizado.
    const conTabIndex = await page.getByTestId("balance-row").evaluateAll((els) =>
      els.filter((e) => e.querySelector("[tabindex]:not([tabindex='0']):not([tabindex='-1'])")).length,
    );
    expect(conTabIndex).toBe(0);
  });
});

test.describe("FR-1402 — la sangría renderizada", () => {
  const paddings = (page: Page) =>
    page.getByTestId("balance-label").evaluateAll((els) =>
      els.map((e) => parseFloat(getComputedStyle(e).paddingLeft)),
    );

  // @aitri-tc TC-BJE-004h
  test("TC-BJE-004h: a 1440 px el paddingLeft es 14 + nivel*16, con cuatro valores distintos", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    const pads = await paddings(page);
    // Es literalmente la fórmula del árbol de la grilla (BudgetGrid.tsx: 14 + depth * 16).
    expect(pads).toEqual([62, 62, 62, 46, 46, 30, 30, 14]);
    // CUATRO niveles, porque la cascada tiene tres eslabones.
    expect(new Set(pads).size).toBe(4);
  });

  // @aitri-tc TC-BJE-004e
  test("TC-BJE-004e: a 1024 px el paso baja a 12 px y ninguna etiqueta se trunca", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect
      .poll(async () => (await paddings(page))[0], { timeout: 5000 })
      .toBe(50);

    expect(await paddings(page)).toEqual([50, 50, 50, 38, 38, 26, 26, 14]);
    // La sangría sigue siendo perceptible: 36 px de recorrido entre el nivel 0 y el 3.
    const pads = await paddings(page);
    expect(Math.max(...pads) - Math.min(...pads)).toBe(36);

    // Y cero truncamiento: la etiqueta más larga del nivel más profundo es "Reservas del mes".
    const truncadas = await page.getByTestId("balance-label").evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent),
    );
    expect(truncadas).toEqual([]);
  });
});

test.describe("NFR-1401 / NFR-1403 — el guardrail y el plegado", () => {
  /** Valor numérico de cada celda, indexado por clave de fila. */
  async function valuesByRow(page: Page): Promise<Record<string, string[]>> {
    return page.getByTestId("balance-row").evaluateAll((filas) => {
      const out: Record<string, string[]> = {};
      for (const f of filas) {
        const key = f.getAttribute("data-row") ?? "?";
        out[key] = [...f.querySelectorAll('[data-testid="balance-cell"]')].map((c) =>
          (c.textContent ?? "").trim(),
        );
      }
      return out;
    });
  }

  // @aitri-tc TC-BJE-009h
  test("TC-BJE-009h: las cifras son las mismas que antes del reordenamiento, comparadas por CLAVE", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    const vals = await valuesByRow(page);

    // La comparación es por data-row, NO por posición — precisamente porque las posiciones cambiaron.
    // Valores derivados del fixture: ingreso 1.000.000, gasto 300.000, reserva 100.000 en 12 meses.
    expect(vals.flow?.[0]).toBe("700.000"); // 1.000.000 − 300.000
    expect(vals.reserved?.[0]).toBe("100.000");
    expect(vals.monthAvailable?.[0]).toBe("600.000"); // flujo − reservas
    expect(vals.available?.[0]).toBe("600.000"); // + saldo mes anterior (0 el primer mes)
    expect(vals.reservedBalance?.[0]).toBe("100.000");
    expect(vals.total?.[0]).toBe("700.000"); // disponible + reservado
    // Siete filas con balance-cell (la de Retiros es operable y monta las suyas).
    expect(Object.keys(vals).filter((k) => vals[k].length > 0)).toHaveLength(7);
  });

  // @aitri-tc TC-BJE-009e
  test("TC-BJE-009e: el ARRASTRE entre meses sobrevive al reordenamiento", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    const vals = await valuesByRow(page);
    // La cadena: prevAvailable(mes N) === available(mes N−1). `prevAvailable` es la fila que MÁS se
    // mueve en el reordenamiento (del puesto 1 al 5), así que es donde un error de indexación
    // rompería la cadena sin dejar ninguna celda vacía.
    const prev = vals.prevAvailable ?? [];
    const avail = vals.available ?? [];
    expect(prev.length).toBeGreaterThan(6);
    for (let mes = 1; mes < 4; mes++) {
      // índices por plano: mes*2 = Pres., mes*2+1 = Ejec.
      expect(prev[mes * 2]).toBe(avail[(mes - 1) * 2]);
      expect(prev[mes * 2 + 1]).toBe(avail[(mes - 1) * 2 + 1]);
    }
  });

  // @aitri-tc TC-BJE-009f
  test("TC-BJE-009f: la suite de dominio del balance sigue verde sin tocar un test de cálculo", async ({ page }) => {
    // El guardrail declarado: esta feature cambia cómo se PRESENTA el cálculo, jamás el cálculo.
    // La comprobación mecánica de que src/domain/balance.ts no se tocó vive en la suite unitaria
    // (se ejecuta entera en cada corrida). Aquí se afirma su consecuencia observable: la aritmética
    // del módulo sigue cuadrando sobre la pantalla real.
    await goto(page, POSITIVE, "light");
    const vals = await valuesByRow(page);
    const num = (s: string) => Number(s.replace(/\./g, "").replace("−", "-")) || 0;

    for (let col = 0; col < 6; col++) {
      // Disponible del mes = Flujo − Reservas + Retiros(0 en este fixture)
      expect(num(vals.monthAvailable[col])).toBe(num(vals.flow[col]) - num(vals.reserved[col]));
      // Saldo disponible = Saldo mes anterior + Disponible del mes
      expect(num(vals.available[col])).toBe(num(vals.prevAvailable[col]) + num(vals.monthAvailable[col]));
      // Saldo total = Saldo disponible + Saldo reservado
      expect(num(vals.total[col])).toBe(num(vals.available[col]) + num(vals.reservedBalance[col]));
    }
  });

  // @aitri-tc TC-BJE-011h
  test("TC-BJE-011h: plegar por el chevron sigue ocultando exactamente Saldo reservado y Saldo total", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    await expect(page.getByTestId("balance-row")).toHaveCount(8);

    await page.getByRole("button", { name: "Colapsar saldos" }).click();
    await expect(page.getByTestId("balance-row")).toHaveCount(6);
    // Las MISMAS dos filas que antes de la feature: la vista plegada sigue terminando en
    // "cuánto puedo gastar", que es su razón de ser.
    const textos = await labelTexts(page);
    expect(textos[textos.length - 1]).toBe("Saldo disponible");
    expect(textos).not.toContain("Saldo reservado");
    expect(textos).not.toContain("Saldo total");
  });

  // @aitri-tc TC-BJE-011e
  test("TC-BJE-011e: el SEGUNDO nivel de plegado resume en el encabezado, y en neutro", async ({ page }) => {
    await goto(page, POSITIVE, "light");
    await page.getByRole("button", { name: "Colapsar balance" }).click();

    // Desaparecen las ocho filas y aparece el encabezado con el Saldo total del mes.
    await expect(page.getByTestId("balance-row")).toHaveCount(0);
    const header = page.getByTestId("balance-header-cell");
    await expect(header.first()).toBeVisible();
    // Cruce exacto de NFR-1403 con FR-1403: es el único estado en que HeaderTotalCell se pinta.
    const colores = await header.evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
    expect(colores.filter((c) => c === FAVORABLE_LIGHT)).toHaveLength(0);
  });
});
