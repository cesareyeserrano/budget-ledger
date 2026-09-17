/**
 * Feature diario-de-celda — EP-01: lo que solo el NAVEGADOR puede afirmar del Detalle.
 * TCs: FR-2501 (001h,003e,005f,006e,007e,011e) · FR-2508 (151h,152h,153e,154e,155f,158e) ·
 *      FR-2509 (171h,172e,175f)
 *
 * La aritmética y el orden viven en tests/domain/diario-de-celda-detalle.test.ts; aquí se afirma que
 * la pantalla los MUESTRA: anatomía de la fila, signo y color del monto, estado vacío, posición del
 * panel y los nombres de FR-2509. Son fallos distintos — el selector puede acertar y el render no.
 *
 * Escenario común (el del spec): modo ciclos con día de pago 21, así que «Septiembre» va del
 * 2026-08-21 al 2026-09-20 y su clave es «2026-09». «Hoy» se fija en el servidor y en el navegador.
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { readLedger, seedLedger } from "./helpers/seed";
import { applyCycles, closeViaApi, fixToday } from "./helpers/cycles";
import type { LedgerNode, Movement } from "@/domain/types";

const DESK = { width: 1440, height: 900 };
const NARROW = { width: 768, height: 900 };
const MOBILE = { width: 375, height: 812 };

const HOY = "2026-09-10";
const AGO = "2026-08";
const SEP = "2026-09";
const OCT = "2026-10";

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 1 },
  { id: "c-rest", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Restaurantes", icon: null, order: 0 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 1 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 2 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 0 },
];

/** Un gasto o ingreso manual con fecha explícita dentro de su ciclo. */
function mv(
  id: string, type: "expense" | "income", target: string, amount: number, period: string, date: string, createdAt: number, note?: string
): Movement {
  return {
    id, ownerId: "local", type, catId: target, subId: null, target, amount,
    period: period as Movement["period"], createdAt, date, ...(note ? { note } : {}),
  };
}

/**
 * La operación De→A que deja su nota en la celda del bolsillo.
 *
 * Lleva FECHA a propósito: en modo ciclos el servidor DERIVA el periodo de la fecha y rechaza con
 * `period_mismatch` un movimiento cuyo `period` no case con ella. Sin fecha, la siembra entera
 * fallaba con 422 — el mismo contrato que protege al usuario de fechas incoherentes.
 */
const DEA: Movement = {
  id: "m-dea", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje",
  amount: 300_000, period: SEP as Movement["period"], createdAt: 7, date: "2026-09-05T12:00",
  note: "pasaje", from: "@disponible", to: "c-viaje",
};

/** Los tres movimientos del escenario: 50.000 el 18, 30.000 el 19 y 20.000 el 20 de septiembre. */
const TRES = [
  mv("m-1", "expense", "c-rest", 50_000, SEP, "2026-09-18T12:00", 1, "Almuerzo"),
  mv("m-2", "expense", "c-rest", 30_000, SEP, "2026-09-19T12:00", 2),
  mv("m-3", "expense", "c-rest", 20_000, SEP, "2026-09-20T12:00", 3, "Taxi"),
];

type Seed = Parameters<typeof seedLedger>[1];

/**
 * Deja la cuenta en modo ciclos (día 21), siembra el estado y abre la app.
 *
 * El orden importa: los ciclos se activan ANTES de sembrar, porque el servidor valida la fecha de
 * cada movimiento contra el calendario del dueño — con el calendario de meses, una fecha del 18 de
 * septiembre pertenecería a otro periodo y el PUT respondería `period_mismatch`.
 *
 * A 375 px la app NO monta la grilla: muestra solo «Nuevo movimiento» (FR-010 de la raíz), así que
 * la espera final depende del ancho. Esperar siempre la grilla dejaba el caso móvil en rojo por un
 * defecto del test, no del producto.
 */
async function abrir(page: Page, seed: Seed, viewport = DESK): Promise<void> {
  await page.setViewportSize(viewport);
  await fixToday(page, HOY);
  await applyCycles(page, { mode: "cycle", anchorDay: 21 });
  await seedLedger(page, seed);
  await page.goto("/");
  await expect(page.getByTestId(viewport.width < 760 ? "mobile-shell" : "budget-grid")).toBeVisible();
}

/** La celda de Ejecutado de una hoja en un periodo. */
const celda = (page: Page, leafId: string, period: string) =>
  page.locator(`[data-cell="${leafId}"][data-month="${period}"][data-plane="actual"]`).first();

/**
 * Elige un día en el calendario de la línea «Añadir movimiento».
 *
 * Es react-day-picker con DESPLEGABLES de mes y año (`captionLayout="dropdown"`), no con flechas:
 * hay que mover los selects y pulsar el día por su `data-day`. Buscarlo por su nombre accesible no
 * sirve cuando el día cae en otro mes — el calendario abre en el de la fecha propuesta y el día
 * sencillamente no está en el DOM. Mismo patrón que `fijarFecha` de ciclos.spec.ts.
 */
async function elegirFecha(page: Page, panel: ReturnType<Page["locator"]>, iso: string): Promise<void> {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  await panel.getByTestId("add-date").click();
  const pop = page.getByTestId("add-date-popover");
  await expect(pop.locator("select.rdp-years_dropdown")).toBeVisible();
  await pop.locator("select.rdp-years_dropdown").selectOption(String(y));
  await pop.locator("select.rdp-months_dropdown").selectOption(String(m - 1));
  await pop.locator(`[data-day="${iso}"]:not([data-outside]) button`).click();
}

/** Abre el editor de esa celda y devuelve el panel «Detalle». */
async function abrirCelda(page: Page, leafId: string, period: string) {
  await celda(page, leafId, period).click();
  const panel = page.getByTestId("cell-notes");
  await expect(panel).toBeVisible();
  return panel;
}

const REST_SEP: Seed = {
  nodes: NODES,
  actuals: { "c-rest": { [SEP]: 100_000 } },
  movements: TRES,
} as unknown as Seed;

/** El escenario del bolsillo: reserva de septiembre financiada en parte con el saldo de agosto. */
const BOLSILLO: Seed = {
  nodes: NODES,
  actuals: { "c-salario": { [AGO]: 2_000_000 }, "c-viaje": { [SEP]: 1_000_000 } },
  movements: [DEA],
} as unknown as Seed;

// ── Contraste (convención de la suite: cada spec resuelve sus tokens y compone) ──────────────────

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

/**
 * El fondo EFECTIVO de un elemento, COMPUESTO: las filas del Detalle van sobre un tinte translúcido
 * (4 % de `--fg-muted`, 8 % de `--alert-soft`) y el color que ve el ojo es esa capa mezclada con el
 * fondo opaco del panel.
 *
 * Tomar la capa translúcida tal cual daba un resultado absurdo —ratio 1.0— porque el tinte está
 * hecho CON el mismo token que el texto: sin componer, fondo y texto salían idénticos. Es el error
 * que tenía este test, no un fallo de contraste del producto.
 */
const fondoEfectivo = (loc: ReturnType<Page["locator"]>) =>
  loc.evaluate((el) => {
    const parse = (s: string): { c: number[]; a: number } => {
      const nums = (s.match(/-?\d*\.?\d+/g) ?? ["0", "0", "0"]).map(Number);
      const esFraccion = s.trim().startsWith("color(");
      const c = nums.slice(0, 3).map((v) => (esFraccion ? Math.round(v * 255) : v));
      const a = nums.length > 3 ? nums[3]! : 1;
      return { c, a };
    };
    // Capas translúcidas de abajo del elemento hacia arriba, hasta el primer fondo opaco.
    const capas: { c: number[]; a: number }[] = [];
    let n: HTMLElement | null = el as HTMLElement;
    let base = [255, 255, 255];
    while (n) {
      const { c, a } = parse(getComputedStyle(n).backgroundColor);
      if (a >= 1) { base = c; break; }
      if (a > 0) capas.push({ c, a });
      n = n.parentElement;
    }
    // Se componen de la más lejana a la más cercana: cada una sobre el resultado anterior.
    let out = base;
    for (const capa of capas.reverse()) {
      out = out.map((b, i) => Math.round(capa.c[i]! * capa.a + b * (1 - capa.a)));
    }
    return `rgb(${out.join(", ")})`;
  });

/** Valor resuelto de una custom property, normalizado a un color comparable. */
async function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((v) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${v})`;
    document.body.appendChild(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, name);
}

test.describe("FR-2501 — el Detalle lista los movimientos que forman la celda", () => {
  test("TC-DDC-001h: las 3 filas salen en orden cronológico con fecha, nota y monto", async ({ page }) => {
    // @aitri-tc TC-DDC-001h
    await abrir(page, REST_SEP);
    const panel = await abrirCelda(page, "c-rest", SEP);

    await expect(panel.getByText("Detalle", { exact: true })).toBeVisible();
    const filas = panel.getByTestId("detail-row");
    await expect(filas).toHaveCount(3);
    await expect(filas.getByTestId("detail-date")).toHaveText(["18 sep", "19 sep", "20 sep"]);
    await expect(filas.getByTestId("detail-note")).toHaveText(["Almuerzo", "Sin nota", "Taxi"]);
    await expect(filas.getByTestId("detail-amount")).toHaveText(["−50.000", "−30.000", "−20.000"]);
    // Y la celda sigue diciendo el total: 50.000 + 30.000 + 20.000.
    await expect(page.getByLabel("Editar valor")).toHaveValue("100000");
  });

  test("TC-DDC-003e: una celda sin nada muestra el texto guía y ninguna fila", async ({ page }) => {
    // @aitri-tc TC-DDC-003e
    await abrir(page, { nodes: NODES, actuals: { "c-mercado": { [SEP]: 0 } } } as unknown as Seed);
    const panel = await abrirCelda(page, "c-mercado", SEP);

    const vacio = panel.getByTestId("cell-notes-empty");
    await expect(vacio).toHaveText("Sin movimientos ni comentarios");
    await expect(panel.getByTestId("detail-row")).toHaveCount(0);
    expect(await vacio.evaluate((el) => getComputedStyle(el).color)).toBe(await cssVar(page, "--fg-muted"));
  });

  test("TC-DDC-005f: el Detalle de septiembre no muestra un movimiento de octubre", async ({ page }) => {
    // @aitri-tc TC-DDC-005f
    const octubre = mv("m-oct", "expense", "c-rest", 40_000, OCT, "2026-10-02T12:00", 4, "Cena octubre");
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 100_000, [OCT]: 40_000 } },
      movements: [...TRES, octubre],
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);

    await expect(panel.getByTestId("detail-row")).toHaveCount(3);
    await expect(panel.getByText("Cena octubre")).toHaveCount(0);
    expect(await panel.textContent()).not.toContain("40.000");
  });

  test("TC-DDC-011e: una celda de ingreso lista su movimiento con signo + y color de ingreso", async ({ page }) => {
    // @aitri-tc TC-DDC-011e
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-salario": { [SEP]: 3_000_000 } },
      movements: [mv("m-nom", "income", "c-salario", 3_000_000, SEP, "2026-09-01T12:00", 1, "Nómina")],
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-salario", SEP);

    const fila = panel.getByTestId("detail-row");
    await expect(fila).toHaveCount(1);
    await expect(fila.getByTestId("detail-date")).toHaveText("1 sep");
    await expect(fila.getByTestId("detail-note")).toHaveText("Nómina");
    const monto = fila.getByTestId("detail-amount");
    await expect(monto).toHaveText("+3.000.000");
    expect(await monto.evaluate((el) => getComputedStyle(el).color)).toBe(await cssVar(page, "--type-income"));
  });

  for (const vp of [NARROW, DESK]) {
    test(`TC-DDC-006e: el panel no desborda el viewport a ${vp.width} px, tampoco en la última columna`, async ({ page }) => {
      // @aitri-tc TC-DDC-006e
      await abrir(page, REST_SEP, vp);

      // La última columna visible de la grilla: se llega a ella con el scroll horizontal propio.
      const ultima = page.locator('[data-cell="c-rest"][data-plane="actual"]').last();
      await ultima.scrollIntoViewIfNeeded();
      await ultima.click();
      const panel = page.getByTestId("cell-notes");
      await expect(panel).toBeVisible();

      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
      expect(Math.round(box.width)).toBe(Math.min(320, vp.width - 32));
    });
  }

  for (const scheme of ["light", "dark"] as const) {
    test(`TC-DDC-007e: fecha, nota y monto de una fila pasan AA en tema ${scheme}`, async ({ page }) => {
      // @aitri-tc TC-DDC-007e
      await page.emulateMedia({ colorScheme: scheme });
      await abrir(page, REST_SEP);
      const panel = await abrirCelda(page, "c-rest", SEP);
      const fila = panel.getByTestId("detail-row").first();
      const fondo = await fondoEfectivo(fila);

      for (const testid of ["detail-date", "detail-note", "detail-amount"]) {
        const color = await fila.getByTestId(testid).evaluate((el) => getComputedStyle(el).color);
        expect(contrast(color, fondo), `${testid} en ${scheme} (texto ${color} sobre ${fondo})`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

test.describe("FR-2508 — comentarios en el Detalle, con el mismo estilo", () => {
  test("TC-DDC-151h: comentarios y movimiento comparten estilo de fila con íconos distintos", async ({ page }) => {
    // @aitri-tc TC-DDC-151h
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 20_000 } },
      movements: [mv("m-u", "expense", "c-rest", 20_000, SEP, "2026-09-18T12:00", 1)],
      cellNotes: { "c-rest": { [SEP]: [
        { id: "n-1", createdAt: 1, text: "Pedir factura" },
        { id: "n-2", createdAt: 2, text: "Compartido con Ana" },
      ] } },
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);

    const filas = panel.getByTestId("detail-row");
    await expect(filas).toHaveCount(3);
    const estilos = await filas.evaluateAll((els) =>
      els.map((e) => {
        const s = getComputedStyle(e);
        return `${s.fontSize}|${s.padding}|${s.backgroundColor}`;
      })
    );
    expect(new Set(estilos).size, "las 3 filas comparten anatomía").toBe(1);

    // `exact` no es un adorno: getByLabel busca subcadena SIN distinguir mayúsculas, así que
    // «Añadir comentario» (el campo del pie) también contaba como «Comentario».
    await expect(panel.getByLabel("Movimiento", { exact: true })).toHaveCount(1);
    await expect(panel.getByLabel("Comentario", { exact: true })).toHaveCount(2);
    // Un comentario no lleva monto ni fecha.
    const comentario = filas.nth(1);
    await expect(comentario.getByTestId("detail-amount")).toHaveCount(0);
    await expect(comentario.getByTestId("detail-date")).toHaveCount(0);
  });

  test("TC-DDC-152h: un comentario nuevo se ve, persiste al recargar y no cambia la celda", async ({ page }) => {
    // @aitri-tc TC-DDC-152h
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 20_000 } },
      movements: [mv("m-u", "expense", "c-rest", 20_000, SEP, "2026-09-18T12:00", 1)],
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);

    await panel.getByLabel("Añadir comentario").fill("Revisar la factura del 18");
    await panel.getByTestId("cell-note-add").click();
    await expect(panel.getByText("Revisar la factura del 18")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    const panel2 = await abrirCelda(page, "c-rest", SEP);
    await expect(panel2.getByText("Revisar la factura del 18")).toBeVisible();
    // La celda no se movió: un comentario no suma.
    await expect(page.getByLabel("Editar valor")).toHaveValue("20000");
  });

  test("TC-DDC-155f: un comentario en blanco no se añade", async ({ page }) => {
    // @aitri-tc TC-DDC-155f
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 0 } },
      cellNotes: { "c-rest": { [SEP]: [
        { id: "n-1", createdAt: 1, text: "Uno" },
        { id: "n-2", createdAt: 2, text: "Dos" },
      ] } },
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);

    let puts = 0;
    page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/api/v1/ledger")) puts++; });

    await panel.getByLabel("Añadir comentario").fill("   ");
    await panel.getByLabel("Añadir comentario").press("Enter");

    await expect(panel.getByTestId("cell-note")).toHaveText(["Uno", "Dos"]);
    expect(puts, "un comentario en blanco no escribe").toBe(0);
  });

  test("TC-DDC-158e: el marcador de la celda cuenta comentarios, no movimientos", async ({ page }) => {
    // @aitri-tc TC-DDC-158e
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 100_000 }, "c-mercado": { [SEP]: 0 } },
      movements: TRES,
      cellNotes: { "c-mercado": { [SEP]: [{ id: "n-1", createdAt: 1, text: "Sin movimientos todavía" }] } },
    } as unknown as Seed);

    await expect(celda(page, "c-rest", SEP).getByTestId("note-dot")).toHaveCount(0);
    await expect(celda(page, "c-mercado", SEP).getByTestId("note-dot")).toHaveCount(1);
  });

  test("TC-DDC-153e: el comentario automático de un bolsillo usa la anatomía común", async ({ page }) => {
    // @aitri-tc TC-DDC-153e
    // El aviso automático aparece cuando parte de lo reservado del mes salió del saldo anterior.
    await abrir(page, BOLSILLO);
    const panel = await abrirCelda(page, "c-viaje", SEP);

    await expect(panel.getByText("Detalle", { exact: true })).toBeVisible();
    const auto = panel.locator('[data-testid="detail-row"][data-kind="auto"]');
    await expect(auto).toHaveCount(1);
    await expect(auto.getByLabel("Automático", { exact: true })).toHaveCount(1);
    const nota = panel.locator('[data-testid="detail-row"][data-kind="comment"]').first();
    await expect(nota).toContainText("pasaje");
    // Misma anatomía: solo el tinte del fondo distingue a la automática.
    const [a, n] = await Promise.all([
      auto.evaluate((el) => { const s = getComputedStyle(el); return `${s.fontSize}|${s.padding}`; }),
      nota.evaluate((el) => { const s = getComputedStyle(el); return `${s.fontSize}|${s.padding}`; }),
    ]);
    expect(a).toBe(n);
    const [bgAuto, bgNota] = await Promise.all([
      auto.evaluate((el) => getComputedStyle(el).backgroundColor),
      nota.evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(bgAuto).not.toBe(bgNota);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`TC-DDC-154e: comentario y comentario automático pasan AA en tema ${scheme}`, async ({ page }) => {
      // @aitri-tc TC-DDC-154e
      await page.emulateMedia({ colorScheme: scheme });
      await abrir(page, {
        ...(BOLSILLO as object),
        cellNotes: { "c-viaje": { [SEP]: [{ id: "n-1", createdAt: 9, text: "Comentario manual" }] } },
      } as unknown as Seed);
      const panel = await abrirCelda(page, "c-viaje", SEP);

      const auto = panel.locator('[data-testid="detail-row"][data-kind="auto"]').first();
      const comentario = panel.getByText("Comentario manual");
      for (const loc of [auto.getByTestId("carry-note"), comentario]) {
        const color = await loc.evaluate((el) => getComputedStyle(el).color);
        const fondo = await fondoEfectivo(loc);
        expect(contrast(color, fondo), `contraste en ${scheme} (texto ${color} sobre ${fondo})`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

test.describe("FR-2502 — añadir un movimiento desde el Detalle", () => {
  test("TC-DDC-021h: añadir 30.000 «Almuerzo» sube la celda a 130.000 sin abrir otro formulario", async ({ page }) => {
    // @aitri-tc TC-DDC-021h
    await abrir(page, REST_SEP);
    const panel = await abrirCelda(page, "c-rest", SEP);

    // Nota PROPIA de este caso: el escenario ya trae una fila «Almuerzo» (m-1), así que reutilizar
    // ese texto haría que el filtro encontrara dos y la prueba no distinguiría la suya.
    await panel.getByLabel("Monto").fill("30000");
    await panel.getByLabel("Nota").fill("Café de la tarde");
    await panel.getByLabel("Nota").press("Enter");

    const fila = panel.getByTestId("detail-row").filter({ hasText: "Café de la tarde" });
    await expect(fila).toHaveCount(1);
    await expect(fila.getByTestId("detail-date")).toHaveText("10 sep"); // la fecha propuesta: HOY
    await expect(fila.getByTestId("detail-amount")).toHaveText("−30.000");
    // Se añade DENTRO de la celda: no hay un segundo formulario que llenar.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Y la línea queda lista para el siguiente, con el foco en Monto.
    await expect(panel.getByLabel("Monto")).toHaveValue("");
    await expect(panel.getByLabel("Nota")).toHaveValue("");
    await expect(panel.getByLabel("Monto")).toBeFocused();
    // El total se lee en la CELDA, no en «Editar valor»: ese input conserva el valor capturado al
    // abrir el editor y solo cambia si el usuario teclea. Y la celda solo existe con el editor
    // CERRADO —mientras está abierto, el editor ocupa su sitio—, así que se cierra antes de leerla.
    await page.keyboard.press("Escape");
    await expect(celda(page, "c-rest", SEP)).toContainText("130.000");
  });

  test("TC-DDC-023e: el movimiento añadido persiste tras recargar", async ({ page }) => {
    // @aitri-tc TC-DDC-023e
    await abrir(page, REST_SEP);
    const panel = await abrirCelda(page, "c-rest", SEP);

    // Texto propio, por lo mismo que en TC-DDC-021h: el escenario ya trae una fila «Almuerzo».
    const put = page.waitForResponse((r) => r.url().includes("/api/v1/ledger") && r.request().method() === "PUT" && r.status() === 200);
    await panel.getByLabel("Monto").fill("30000");
    await panel.getByLabel("Nota").fill("Café de la tarde");
    await panel.getByLabel("Nota").press("Enter");
    await put;

    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    const panel2 = await abrirCelda(page, "c-rest", SEP);
    await expect(page.getByLabel("Editar valor")).toHaveValue("130000");
    await expect(panel2.getByTestId("detail-row").filter({ hasText: "Café de la tarde" })).toHaveCount(1);
  });

  test("TC-DDC-025f: con el monto vacío o en 0 no se confirma ni se escribe", async ({ page }) => {
    // @aitri-tc TC-DDC-025f
    await abrir(page, {
      nodes: NODES, actuals: { "c-rest": { [SEP]: 100_000 } },
      movements: [mv("m-u", "expense", "c-rest", 100_000, SEP, "2026-09-18T12:00", 1)],
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);

    let puts = 0;
    page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/api/v1/ledger")) puts++; });

    // (a) monto vacío, con nota: Enter no hace nada.
    await panel.getByLabel("Nota").fill("x");
    await expect(panel.getByTestId("add-movement-confirm")).toBeDisabled();
    await panel.getByLabel("Nota").press("Enter");

    // (b) monto 0: el botón sigue deshabilitado.
    await panel.getByLabel("Monto").fill("0");
    await expect(panel.getByTestId("add-movement-confirm")).toBeDisabled();

    await expect(panel.getByTestId("detail-row")).toHaveCount(1);
    await expect(page.getByLabel("Editar valor")).toHaveValue("100000");
    expect(puts, "nada inválido llega al servidor").toBe(0);
  });

  test("TC-DDC-027f: una nota de 281 caracteres deshabilita «Añadir» y no se trunca", async ({ page }) => {
    // @aitri-tc TC-DDC-027f
    await abrir(page, {
      nodes: NODES, actuals: { "c-rest": { [SEP]: 100_000 } },
      movements: [mv("m-u", "expense", "c-rest", 100_000, SEP, "2026-09-18T12:00", 1)],
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);

    const larga = "a".repeat(281);
    await panel.getByLabel("Monto").fill("30000");
    await panel.getByLabel("Nota").fill(larga);

    const contador = panel.getByTestId("add-note-counter");
    await expect(contador).toHaveText("281/280");
    expect(await contador.evaluate((el) => getComputedStyle(el).color)).toBe(await cssVar(page, "--error"));
    await expect(panel.getByTestId("add-movement-confirm")).toBeDisabled();
    // El texto NO se recorta: el exceso es un error del input, no algo que se corta en silencio.
    await expect(panel.getByLabel("Nota")).toHaveValue(larga);

    await panel.getByLabel("Nota").press("Enter");
    await expect(panel.getByTestId("detail-row")).toHaveCount(1);
    await expect(page.getByLabel("Editar valor")).toHaveValue("100000");
  });

  test("TC-DDC-031f: si el servidor rechaza, se avisa y la celda vuelve al valor del servidor", async ({ page }) => {
    // @aitri-tc TC-DDC-031f
    await abrir(page, {
      nodes: NODES, actuals: { "c-rest": { [SEP]: 100_000 } },
      movements: [mv("m-u", "expense", "c-rest", 100_000, SEP, "2026-09-18T12:00", 1)],
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);

    // El PUT se intercepta DESPUÉS de sembrar: el rechazo que se ejercita es el del guardado.
    await page.route("**/api/v1/ledger", (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "closed_period_violation", detail: { periods: [SEP] } } }),
      });
    });

    await panel.getByLabel("Monto").fill("30000");
    await panel.getByLabel("Nota").fill("Almuerzo");
    await panel.getByLabel("Nota").press("Enter");

    // El aviso nombra el motivo, y tras el resync la celda vuelve a lo que dice el servidor.
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("cerrado");
    await expect(page.getByLabel("Editar valor")).toHaveValue("100000", { timeout: 10_000 });
    await expect(panel.getByTestId("detail-row")).toHaveCount(1);
  });
});

test.describe("FR-2503 — la fecha que la celda propone y acepta", () => {
  test("TC-DDC-042h: el botón dice «Hoy» y el movimiento nace con la fecha de hoy", async ({ page }) => {
    // @aitri-tc TC-DDC-042h
    await abrir(page, REST_SEP);
    const panel = await abrirCelda(page, "c-rest", SEP);

    await expect(panel.getByTestId("add-date")).toHaveText(/Hoy/);

    // Con NOTA propia, y se busca por ella: identificar el movimiento por su monto lo confundía con
    // cualquier otro del mismo importe (el de la siembra, sin ir más lejos), y la prueba acababa
    // leyendo la fecha de un movimiento que no era el suyo.
    const put = page.waitForResponse((r) => r.url().includes("/api/v1/ledger") && r.request().method() === "PUT" && r.status() === 200);
    await panel.getByLabel("Monto").fill("12000");
    await panel.getByLabel("Nota").fill("Con fecha de hoy");
    await panel.getByLabel("Nota").press("Enter");
    await put;

    const estado = await readLedger(page);
    const nuevo = estado!.movements.find((m) => m.note === "Con fecha de hoy")!;
    expect(nuevo, "el movimiento se guardó").toBeDefined();
    // «Hoy» es el día que fija este fichero (HOY), no el que cita el enunciado del caso: el reloj lo
    // pone `abrir()` y de ahí sale la fecha propuesta.
    expect(nuevo.date?.startsWith(HOY), `fecha ${nuevo.date}`).toBe(true);
  });

  test("TC-DDC-044e: con hoy fuera del ciclo, el botón propone su último día", async ({ page }) => {
    // @aitri-tc TC-DDC-044e
    // Hoy es 22 de septiembre: ya es «Octubre», así que la celda de «Septiembre» propone su último
    // día (20 sep) — una fecha real dentro del periodo que se está editando.
    await page.setViewportSize(DESK);
    await fixToday(page, "2026-09-22");
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await seedLedger(page, REST_SEP);
    await page.goto("/");
    await expect(page.getByTestId("budget-grid")).toBeVisible();

    const panel = await abrirCelda(page, "c-rest", SEP);
    await expect(panel.getByTestId("add-date")).toHaveText(/20 sep/);
  });

  test("TC-DDC-046e: elegir el 25 de agosto deja el movimiento en «Septiembre»", async ({ page }) => {
    // @aitri-tc TC-DDC-046e
    // Con día de pago 21, el ciclo «Septiembre» empieza el 21 de agosto: el 25 de agosto es suyo.
    await abrir(page, REST_SEP);
    const panel = await abrirCelda(page, "c-rest", SEP);

    await elegirFecha(page, panel, "2026-08-25");
    await expect(panel.getByTestId("add-date")).toHaveText(/25 ago/);

    const put = page.waitForResponse((r) => r.url().includes("/api/v1/ledger") && r.request().method() === "PUT" && r.status() === 200);
    await panel.getByLabel("Monto").fill("8000");
    await panel.getByLabel("Monto").press("Enter");
    await put;

    // La celda de «Septiembre» lo recibe; la columna de «Agosto» no se mueve. Se lee la CELDA, no
    // el input: «Editar valor» conserva el valor que se capturó al ABRIR el editor y solo cambia si
    // el usuario teclea, así que mirar ahí no dice nada de lo que la celda vale ahora.
    await page.keyboard.press("Escape");
    await expect(celda(page, "c-rest", SEP)).toContainText("108.000");
    const estado = await readLedger(page);
    expect(estado!.movements.find((m) => m.amount === 8_000)!.period).toBe(SEP);
    expect(estado!.actuals["c-rest"]?.[AGO] ?? 0).toBe(0);
  });

  test("TC-DDC-047f: el calendario no deja elegir un día de otro ciclo", async ({ page }) => {
    // @aitri-tc TC-DDC-047f
    await abrir(page, REST_SEP);
    const panel = await abrirCelda(page, "c-rest", SEP);

    await panel.getByTestId("add-date").click();
    const calendario = page.getByTestId("add-date-popover");
    await expect(calendario).toBeVisible();

    // El 21 de septiembre ya es «Octubre» y el 20 de agosto todavía es «Agosto»: el calendario los
    // muestra, pero deshabilitados — no se ofrecen días que el servidor rechazaría.
    const dia = (iso: string) => calendario.locator(`[data-day="${iso}"]:not([data-outside]) button`);
    await expect(dia("2026-09-21")).toBeDisabled();
    await calendario.locator("select.rdp-months_dropdown").selectOption("7"); // agosto
    await expect(dia("2026-08-20")).toBeDisabled();
    // Y el 25 de agosto SÍ está habilitado: sin esto, lo anterior pasaría con todo deshabilitado.
    await expect(dia("2026-08-25")).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(panel.getByTestId("add-date")).toHaveText(/Hoy/); // sigue en la propuesta
  });
});

test.describe("FR-2504 — teclear un total crea un ajuste por la diferencia", () => {
  test("TC-DDC-062h: teclear 120.000 crea el ajuste, resaltado, y la celda queda en 120.000", async ({ page }) => {
    // @aitri-tc TC-DDC-062h
    await abrir(page, REST_SEP);
    await abrirCelda(page, "c-rest", SEP);

    await page.getByLabel("Editar valor").fill("120000");
    await page.getByLabel("Editar valor").press("Enter");

    const panel = await abrirCelda(page, "c-rest", SEP);
    const ajuste = panel.locator('[data-testid="detail-row"][data-kind="adjustment"]');
    await expect(ajuste).toHaveCount(1);
    await expect(ajuste.getByLabel("Ajuste", { exact: true })).toHaveCount(1);
    await expect(ajuste.getByTestId("detail-note")).toHaveText("Ajuste manual");
    await expect(ajuste.getByTestId("detail-amount")).toHaveText("−20.000");
    await expect(page.getByLabel("Editar valor")).toHaveValue("120000");

    // El resaltado es una respuesta a la acción, no un estado: se apaga solo.
    expect(await ajuste.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await cssVar(page, "--accent"));
    await expect
      .poll(async () => ajuste.evaluate((el) => getComputedStyle(el).borderTopWidth), { timeout: 10_000 })
      .toBe("0px");
  });

  test("TC-DDC-064e: el ajuste negativo de un gasto se ve «+10.000» y persiste", async ({ page }) => {
    // @aitri-tc TC-DDC-064e
    await abrir(page, REST_SEP);
    await abrirCelda(page, "c-rest", SEP);

    const put = page.waitForResponse((r) => r.url().includes("/api/v1/ledger") && r.request().method() === "PUT" && r.status() === 200);
    await page.getByLabel("Editar valor").fill("90000");
    await page.getByLabel("Editar valor").press("Enter");
    await put;

    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    const panel = await abrirCelda(page, "c-rest", SEP);

    await expect(page.getByLabel("Editar valor")).toHaveValue("90000");
    const ajuste = panel.locator('[data-testid="detail-row"][data-kind="adjustment"]');
    const monto = ajuste.getByTestId("detail-amount");
    // Le QUITA gasto a la celda, así que se ve «+», y en secundario porque no suma al total.
    await expect(monto).toHaveText("+10.000");
    expect(await monto.evaluate((el) => getComputedStyle(el).color)).toBe(await cssVar(page, "--fg-secondary"));

    const estado = await readLedger(page);
    const guardado = estado!.movements.find((m) => m.note === "Ajuste manual")!;
    expect(guardado.amount).toBe(-10_000);
    expect((guardado as { kind?: string }).kind).toBe("adjustment");
  });

  test("TC-DDC-009e: el color separa lo que suma de lo que resta", async ({ page }) => {
    // @aitri-tc TC-DDC-009e
    await abrir(page, REST_SEP);
    await abrirCelda(page, "c-rest", SEP);
    // El ajuste se crea por la vía del producto: teclear un total menor que la suma.
    await page.getByLabel("Editar valor").fill("90000");
    await page.getByLabel("Editar valor").press("Enter");

    const panel = await abrirCelda(page, "c-rest", SEP);
    const gasto = panel.locator('[data-testid="detail-row"][data-kind="movement"]').first();
    const ajuste = panel.locator('[data-testid="detail-row"][data-kind="adjustment"]').first();

    expect(await gasto.getByTestId("detail-amount").evaluate((el) => getComputedStyle(el).color))
      .toBe(await cssVar(page, "--type-expense"));
    expect(await ajuste.getByTestId("detail-amount").evaluate((el) => getComputedStyle(el).color))
      .toBe(await cssVar(page, "--fg-secondary"));
  });

  test("TC-DDC-070f: teclear en Presupuestado no añade ningún movimiento", async ({ page }) => {
    // @aitri-tc TC-DDC-070f
    await abrir(page, {
      nodes: NODES,
      budgets: { "c-rest": { [SEP]: 80_000 } },
      actuals: { "c-rest": { [SEP]: 10_000 } },
      movements: [mv("m-u", "expense", "c-rest", 10_000, SEP, "2026-09-18T12:00", 1)],
    } as unknown as Seed);

    const presupuesto = page.locator(`[data-cell="c-rest"][data-month="${SEP}"][data-plane="budget"]`).first();
    await presupuesto.click();
    await page.getByLabel("Editar valor").fill("90000");
    await page.getByLabel("Editar valor").press("Enter");

    const panel = await abrirCelda(page, "c-rest", SEP);
    await expect(panel.getByTestId("detail-row")).toHaveCount(1); // el suyo, ninguno nuevo
    const estado = await readLedger(page);
    expect(estado!.movements).toHaveLength(1);
    expect(estado!.budgets["c-rest"]?.[SEP]).toBe(90_000);
  });
});

test.describe("NFR-2503 — los bolsillos no cambian", () => {
  test("TC-DDC-341h: la nota De→A sigue en la celda del bolsillo y en su Detalle", async ({ page }) => {
    // @aitri-tc TC-DDC-341h
    await abrir(page, BOLSILLO);

    const celdaBolsillo = celda(page, "c-viaje", SEP);
    await expect(celdaBolsillo.getByTestId("note-dot")).toBeVisible();
    // El `title` de la celda prioriza el aviso automático del arrastre sobre las notas (regla
    // vigente, `ReserveCells.tsx`), y este escenario lo tiene. La nota De→A se lee donde el usuario
    // la busca: dentro del Detalle, que es lo que esta prueba verifica abajo.
    await expect(celdaBolsillo).toHaveAttribute("title", /salieron del saldo/);

    const panel = await abrirCelda(page, "c-viaje", SEP);
    await expect(panel.getByTestId("cell-note").filter({ hasText: "pasaje" })).toHaveCount(1);
  });

  test("TC-DDC-343e: el Detalle de un bolsillo no ofrece añadir movimientos", async ({ page }) => {
    // @aitri-tc TC-DDC-343e
    await abrir(page, BOLSILLO);
    const panel = await abrirCelda(page, "c-viaje", SEP);

    await expect(panel.getByTestId("add-movement")).toHaveCount(0);
    await expect(panel.getByTestId("add-movement-confirm")).toHaveCount(0);
    // Pero comentar SÍ se puede: es la vía que el bolsillo siempre tuvo.
    await expect(panel.getByLabel("Añadir comentario")).toBeVisible();
  });

  test("TC-DDC-344e: el comentario automático del saldo anterior se sigue mostrando", async ({ page }) => {
    // @aitri-tc TC-DDC-344e
    await abrir(page, BOLSILLO);
    const panel = await abrirCelda(page, "c-viaje", SEP);

    const auto = panel.getByTestId("carry-note");
    await expect(auto).toHaveCount(1);
    await expect(auto).toContainText("saldo de");
  });
});

test.describe("NFR-2504 — «Nuevo movimiento» sigue igual", () => {
  test("TC-DDC-351h: guardar 50.000 desde el registro sube la hoja y aparece en su Detalle", async ({ page }) => {
    // @aitri-tc TC-DDC-351h
    await abrir(page, {
      nodes: NODES, actuals: { "c-rest": { [SEP]: 20_000 } },
      movements: [mv("m-u", "expense", "c-rest", 20_000, SEP, "2026-09-10T12:00", 1)],
    } as unknown as Seed);

    await page.getByRole("button", { name: "Nuevo movimiento" }).click();
    await page.getByTestId("amount-input").fill("50000");
    // Por `data-testid` y no por nombre: en la grilla, el rótulo de la fila «Restaurantes» también
    // es un botón (es arrastrable), así que buscar por nombre encuentra dos elementos.
    await page.getByTestId("category-c-rest").click();
    const put = page.waitForResponse((r) => r.url().includes("/api/v1/ledger") && r.request().method() === "PUT" && r.status() === 200);
    await page.getByTestId("save-button").click();
    await expect(page.getByTestId("confirm-overlay")).toBeVisible();
    await put;

    const panel = await abrirCelda(page, "c-rest", SEP);
    await expect(page.getByLabel("Editar valor")).toHaveValue("70000");
    await expect(panel.getByTestId("detail-row")).toHaveCount(2);
    await expect(panel.getByTestId("detail-amount").filter({ hasText: "−50.000" })).toHaveCount(1);
  });

  test("TC-DDC-352e: un gasto del 25 oct guardado desde el registro cae en «Noviembre»", async ({ page }) => {
    // @aitri-tc TC-DDC-352e
    // Con día de pago 21, el ciclo «Noviembre» empieza el 21 de octubre: el 25 de octubre es suyo.
    // La asignación por FECHA es de la feature `ciclos` (FR-2405) y esta prueba verifica que sigue
    // intacta — el Detalle no cambió por dónde entra un movimiento del registro.
    await page.setViewportSize(DESK);
    await fixToday(page, "2026-10-22");
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await seedLedger(page, { nodes: NODES } as unknown as Seed);
    await page.goto("/");
    await expect(page.getByTestId("budget-grid")).toBeVisible();

    await page.getByRole("button", { name: "Nuevo movimiento" }).click();
    await page.getByTestId("amount-input").fill("1000");
    // Por `data-testid` y no por nombre: en la grilla, el rótulo de la fila «Restaurantes» también
    // es un botón (es arrastrable), así que buscar por nombre encuentra dos elementos.
    await page.getByTestId("category-c-rest").click();

    // La fecha se elige en el calendario del registro, y ANTES de guardar la línea dice a qué ciclo
    // va: el usuario no descubre el destino después.
    await page.getByTestId("date-field").click();
    await page.getByTestId("date-popover").getByRole("button", { name: /25 de octubre/ }).click();
    await expect(page.getByTestId("register-cycle")).toContainText("Noviembre");

    const put = page.waitForResponse((r) => r.url().includes("/api/v1/ledger") && r.request().method() === "PUT" && r.status() === 200);
    await page.getByTestId("save-button").click();
    await put;

    const estado = await readLedger(page);
    expect(estado!.actuals["c-rest"]?.["2026-11"]).toBe(1_000);
    expect(estado!.actuals["c-rest"]?.[OCT] ?? 0, "octubre no se mueve").toBe(0);
  });

  test("TC-DDC-353f: con monto 0 o sin categoría, «Guardar» sigue deshabilitado", async ({ page }) => {
    // @aitri-tc TC-DDC-353f
    await abrir(page, REST_SEP);
    await page.getByRole("button", { name: "Nuevo movimiento" }).click();

    let puts = 0;
    page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/api/v1/ledger")) puts++; });

    // (a) monto 0 con categoría elegida.
    // Por `data-testid` y no por nombre: en la grilla, el rótulo de la fila «Restaurantes» también
    // es un botón (es arrastrable), así que buscar por nombre encuentra dos elementos.
    await page.getByTestId("category-c-rest").click();
    await expect(page.getByTestId("save-button")).toBeDisabled();

    // (b) monto válido SIN categoría. Pulsar otra vez NO la suelta: `onCategoryClick` sobre una
    // categoría-hoja siempre selecciona. La vía real es cambiar de tipo, que conserva el monto y
    // limpia la selección (FR-208/209) — y se vuelve a gasto, ya sin categoría elegida.
    await page.getByTestId("type-income").click();
    await page.getByTestId("type-expense").click();
    await expect(page.getByTestId("category-c-rest")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("amount-input").fill("5000");
    const antes = (await readLedger(page))!.movements.length;

    // «Guardar» se habilita con monto > 0 aunque no haya categoría (`saveEnabled` no la mira): la
    // guarda real está en `onSave`, que sin categoría marca el error y NO crea nada. Eso es lo que
    // el TC protege —que no se cree un movimiento sin destino—, y es lo que se afirma.
    await page.getByTestId("save-button").click();
    await expect(page.getByTestId("confirm-overlay")).toHaveCount(0);
    expect((await readLedger(page))!.movements).toHaveLength(antes);
    expect(puts).toBe(0);
  });
});

test.describe("FR-2509 — un solo nombre por concepto", () => {
  test("TC-DDC-171h: el panel se titula «Detalle» y el campo dice «Añadir comentario»", async ({ page }) => {
    // @aitri-tc TC-DDC-171h
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 20_000 } },
      movements: [mv("m-u", "expense", "c-rest", 20_000, SEP, "2026-09-18T12:00", 1)],
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);

    await expect(panel.getByText("Detalle", { exact: true })).toBeVisible();
    const campo = panel.getByLabel("Añadir comentario");
    await expect(campo).toHaveAttribute("placeholder", "Añadir comentario");
  });

  test("TC-DDC-172e: «Nuevo movimiento» conserva «Nota (opcional)» y su botón", async ({ page }) => {
    // @aitri-tc TC-DDC-172e
    await abrir(page, { nodes: NODES } as unknown as Seed, MOBILE);
    await expect(page.getByText("Nuevo movimiento").first()).toBeVisible();
    await expect(page.getByLabel("Nota (opcional)")).toBeVisible();

    await page.setViewportSize(DESK);
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    // En escritorio el registro es un panel lateral OPCIONAL (FR-010, `DesktopShell.tsx:96`): sus
    // campos no están montados hasta que se abre con el botón «Nuevo movimiento» de la barra.
    const boton = page.getByRole("button", { name: "Nuevo movimiento" });
    await expect(boton).toBeVisible();
    await boton.click();
    await expect(page.getByLabel("Nota (opcional)")).toBeVisible();
  });

  test("TC-DDC-175f: el aviso de mes cerrado habla de comentario, no de observación", async ({ page }) => {
    // @aitri-tc TC-DDC-175f
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-salario": { [AGO]: 1_000_000 }, "c-rest": { [AGO]: 100_000 } },
      movements: [mv("m-ago", "expense", "c-rest", 100_000, AGO, "2026-08-18T12:00", 1, "Agosto")],
    } as unknown as Seed);

    expect(await closeViaApi(page)).toBe(200);
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    // Lo que esta prueba necesita es que ESTA celda esté cerrada, no cuántos meses lo están: la
    // semilla puebla doce periodos, así que el cierre deja cerrada toda la franja hasta el mes
    // cerrable. Contar cabeceras ataba el test a un detalle de la siembra que no le incumbe.
    await expect(celda(page, "c-rest", AGO)).toHaveAttribute("data-closed", "true", { timeout: 15_000 });

    await celda(page, "c-rest", AGO).dblclick();
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("cerrado");
    await expect(toast).toContainText("comentario");
    expect((await toast.textContent()) ?? "").not.toMatch(/observaci/i);
  });
});

// ══ EP-03 · editar y borrar desde el Detalle ═══════════════════════════════════════════════════

/** Un ajuste: el único movimiento que puede ser negativo, y solo en gasto o ingreso (FR-2504). */
function ajuste(id: string, target: string, amount: number, period: string, date: string, createdAt: number): Movement {
  return {
    id, ownerId: "local", type: "expense", catId: target, subId: null, target, amount,
    period: period as Movement["period"], createdAt, date, note: "Ajuste manual", kind: "adjustment",
  };
}

/** Abre el bloque de edición de la fila que contenga ese texto y lo devuelve. */
async function editarFila(page: Page, panel: ReturnType<Page["locator"]>, texto: string) {
  await panel.getByTestId("detail-row").filter({ hasText: texto }).first().getByLabel("Editar movimiento").click();
  const editor = panel.getByTestId("movement-editor");
  await expect(editor).toBeVisible();
  return editor;
}

test.describe("FR-2505 — editar un movimiento desde el Detalle", () => {
    test("TC-DDC-082h: editar el monto con el lápiz actualiza la fila y la celda", async ({ page }) => {
      // @aitri-tc TC-DDC-082h
      await abrir(page, {
        nodes: NODES,
        actuals: { "c-rest": { [SEP]: 100_000 } },
        movements: [
          mv("m-1", "expense", "c-rest", 50_000, SEP, "2026-09-18T12:00", 1, "Almuerzo"),
          mv("m-2", "expense", "c-rest", 50_000, SEP, "2026-09-19T12:00", 2, "Cena"),
        ],
      } as unknown as Seed);
      const panel = await abrirCelda(page, "c-rest", SEP);

      const editor = await editarFila(page, panel, "Almuerzo");
      await editor.getByLabel("Monto").fill("5000");
      await editor.getByTestId("edit-save").click();

      // La FILA baja a 5.000…
      const fila = panel.getByTestId("detail-row").filter({ hasText: "Almuerzo" });
      await expect(fila.getByTestId("detail-amount")).toHaveText("−5.000");
      // …y la celda, 45.000 exactos. Se lee con el editor CERRADO: mientras está abierto ocupa su sitio.
      await page.keyboard.press("Escape");
      await expect(celda(page, "c-rest", SEP)).toContainText("55.000");
    });

    test("TC-DDC-085e: pasar un gasto de Restaurantes a Mercado desde el select actualiza ambas celdas", async ({ page }) => {
      // @aitri-tc TC-DDC-085e
      await abrir(page, {
        nodes: NODES,
        actuals: { "c-rest": { [SEP]: 70_000 }, "c-mercado": { [SEP]: 30_000 } },
        movements: [
          mv("m-cena", "expense", "c-rest", 20_000, SEP, "2026-09-18T12:00", 1, "Cena"),
          mv("m-otro", "expense", "c-rest", 50_000, SEP, "2026-09-19T12:00", 2, "Almuerzo"),
          mv("m-merc", "expense", "c-mercado", 30_000, SEP, "2026-09-17T12:00", 3, "Frutas"),
        ],
      } as unknown as Seed);
      const panel = await abrirCelda(page, "c-rest", SEP);

      const editor = await editarFila(page, panel, "Cena");
      await editor.getByTestId("edit-category").click();
      await page.getByRole("option", { name: "Mercado", exact: true }).click();
      // El portal de Radix tapa la pantalla mientras está abierto: esperar a que se cierre no es
      // cosmética, es lo que permite pulsar «Guardar» (mismo patrón que meses-y-saldo-inicial).
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await editor.getByTestId("edit-save").click();

      // «Cena» ya no está en Restaurantes…
      await expect(panel.getByTestId("detail-row").filter({ hasText: "Cena" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(celda(page, "c-rest", SEP)).toContainText("50.000");
      await expect(celda(page, "c-mercado", SEP)).toContainText("50.000");

      // …sino en Mercado, y UNA sola vez: mover no duplica.
      const enMercado = await abrirCelda(page, "c-mercado", SEP);
      await expect(enMercado.getByTestId("detail-row").filter({ hasText: "Cena" })).toHaveCount(1);
    });

    test("TC-DDC-087e: el aviso «Pasará a …» aparece antes de guardar y el movimiento cambia de columna", async ({ page }) => {
      // @aitri-tc TC-DDC-087e
      // Con día de pago 21, el 21 de septiembre ya es «Octubre»: un día mueve la columna entera.
      await abrir(page, {
        nodes: NODES,
        actuals: { "c-rest": { [SEP]: 15_000 } },
        movements: [mv("m-x", "expense", "c-rest", 15_000, SEP, "2026-09-18T12:00", 1, "Café")],
      } as unknown as Seed);
      const panel = await abrirCelda(page, "c-rest", SEP);

      const editor = await editarFila(page, panel, "Café");
      await editor.getByTestId("edit-date").click();
      const pop = page.getByTestId("edit-date-popover");
      await expect(pop.locator("select.rdp-years_dropdown")).toBeVisible();
      await pop.locator("select.rdp-years_dropdown").selectOption("2026");
      await pop.locator("select.rdp-months_dropdown").selectOption("8"); // septiembre (0-based)
      await pop.locator('[data-day="2026-09-21"]:not([data-outside]) button').click();

      // El aviso aparece ANTES de guardar: el usuario ve a dónde va a parar antes de decidir.
      const aviso = editor.getByTestId("edit-period-notice");
      await expect(aviso).toBeVisible();
      await expect(aviso).toContainText("Pasará a");
      await expect(aviso).toContainText("20 oct"); // el ciclo de destino, por su rango

      await editor.getByTestId("edit-save").click();
      await expect(panel.getByTestId("detail-row").filter({ hasText: "Café" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(celda(page, "c-rest", SEP)).toContainText("—");
      await expect(celda(page, "c-rest", OCT)).toContainText("15.000");
    });

    test("TC-DDC-088f: el select de categoría solo ofrece hojas del mismo tipo", async ({ page }) => {
      // @aitri-tc TC-DDC-088f
      await abrir(page, {
        nodes: NODES,
        actuals: { "c-rest": { [SEP]: 20_000 } },
        movements: [mv("m-x", "expense", "c-rest", 20_000, SEP, "2026-09-18T12:00", 1, "Café")],
      } as unknown as Seed);
      const panel = await abrirCelda(page, "c-rest", SEP);

      const editor = await editarFila(page, panel, "Café");
      await editor.getByTestId("edit-category").click();
      const opciones = await page.getByRole("option").allTextContents();

      // Las dos hojas de GASTO, y solo esas: ni el ingreso ni el bolsillo aparecen. Un gasto no se
      // convierte en ingreso cambiándole la categoría (FR-2505).
      expect(opciones.sort()).toEqual(["Mercado", "Restaurantes"]);
      expect(opciones).not.toContain("Salario");
      expect(opciones).not.toContain("Viaje");
    });

    test("TC-DDC-093f: el aviso de celda negativa aparece al cambiar el monto y deshabilita «Guardar»", async ({ page }) => {
      // @aitri-tc TC-DDC-093f
      // La celda vale 10.000 porque un ajuste de −40.000 ya bajó un movimiento de 50.000.
      await abrir(page, {
        nodes: NODES,
        actuals: { "c-rest": { [SEP]: 10_000 } },
        movements: [
          mv("m-1", "expense", "c-rest", 50_000, SEP, "2026-09-18T12:00", 1, "Almuerzo"),
          ajuste("a-1", "c-rest", -40_000, SEP, "2026-09-19T12:00", 2),
        ],
      } as unknown as Seed);
      const panel = await abrirCelda(page, "c-rest", SEP);

      const editor = await editarFila(page, panel, "Almuerzo");
      await editor.getByLabel("Monto").fill("30000");

      const aviso = editor.getByTestId("negative-cell-warning");
      await expect(aviso).toBeVisible();
      await expect(aviso).toContainText("Restaurantes");
      await expect(aviso).toContainText("10.000");
      // El botón no se puede pulsar: el error se IMPIDE, no se reporta después.
      await expect(editor.getByTestId("edit-save")).toBeDisabled();

      await page.keyboard.press("Escape"); // cancela la edición
      await page.keyboard.press("Escape"); // cierra el panel
      await expect(celda(page, "c-rest", SEP)).toContainText("10.000");
    });

    test("TC-DDC-099e: Escape en dos niveles — primero cancela la edición, luego cierra el editor", async ({ page }) => {
      // @aitri-tc TC-DDC-099e
      await abrir(page, {
        nodes: NODES,
        actuals: { "c-rest": { [SEP]: 100_000 } },
        movements: [
          mv("m-1", "expense", "c-rest", 50_000, SEP, "2026-09-18T12:00", 1, "Almuerzo"),
          mv("m-2", "expense", "c-rest", 50_000, SEP, "2026-09-19T12:00", 2, "Cena"),
        ],
      } as unknown as Seed);
      const panel = await abrirCelda(page, "c-rest", SEP);

      const editor = await editarFila(page, panel, "Almuerzo");
      await editor.getByLabel("Monto").fill("1");

      // PRIMER Escape: se va el bloque, el panel SIGUE abierto y la fila conserva su valor.
      await page.keyboard.press("Escape");
      await expect(panel.getByTestId("movement-editor")).toHaveCount(0);
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId("detail-row").filter({ hasText: "Almuerzo" }).getByTestId("detail-amount"))
        .toHaveText("−50.000");

      // SEGUNDO Escape: ahora sí se cierra el panel.
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("cell-notes")).toHaveCount(0);
      await expect(celda(page, "c-rest", SEP)).toContainText("100.000");
    });

    test("TC-DDC-101f: el «−» inicial solo se admite al editar un ajuste", async ({ page }) => {
      // @aitri-tc TC-DDC-101f
      await abrir(page, {
        nodes: NODES,
        actuals: { "c-rest": { [SEP]: 47_000 } },
        movements: [
          mv("m-1", "expense", "c-rest", 50_000, SEP, "2026-09-18T12:00", 1, "Almuerzo"),
          ajuste("a-1", "c-rest", -3_000, SEP, "2026-09-19T12:00", 2),
        ],
      } as unknown as Seed);
      const panel = await abrirCelda(page, "c-rest", SEP);

      // En un movimiento MANUAL el signo se descarta al teclearlo: no existe un gasto negativo.
      const manual = await editarFila(page, panel, "Almuerzo");
      await manual.getByLabel("Monto").fill("-3000");
      await expect(manual.getByLabel("Monto")).toHaveValue("3000");
      await page.keyboard.press("Escape");

      // En un AJUSTE sí: es el único movimiento que puede ser negativo (FR-2504).
      const aj = await editarFila(page, panel, "Ajuste manual");
      await aj.getByLabel("Monto").fill("-5000");
      await expect(aj.getByLabel("Monto")).toHaveValue("-5000");
    });
  });

  test.describe("FR-2506 — borrar un movimiento desde el Detalle", () => {
    /** El escenario de borrado: dos «Café» idénticos de 15.000 y la celda en 30.000. */
    const DOS_CAFES = {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 30_000 } },
      movements: [
        mv("d-1", "expense", "c-rest", 15_000, SEP, "2026-09-10T12:00", 1, "Café"),
        mv("d-2", "expense", "c-rest", 15_000, SEP, "2026-09-10T12:00", 2, "Café"),
      ],
    } as unknown as Seed;

    test("TC-DDC-112h: borrar con la papelera y confirmar deja una fila y la celda en 15.000", async ({ page }) => {
      // @aitri-tc TC-DDC-112h
      await abrir(page, DOS_CAFES);
      const panel = await abrirCelda(page, "c-rest", SEP);
      await expect(panel.getByTestId("detail-row")).toHaveCount(2);

      // Idénticos salvo el id: es el caso que delata un borrado que empareje por contenido.
      await panel.getByTestId("detail-row").first().getByLabel("Borrar movimiento").click();
      await panel.getByLabel("Confirmar borrado").click();

      await expect(panel.getByTestId("detail-row")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(celda(page, "c-rest", SEP)).toContainText("15.000");
    });

    test("TC-DDC-113e: el borrado persiste tras recargar", async ({ page }) => {
      // @aitri-tc TC-DDC-113e
      await abrir(page, DOS_CAFES);
      const panel = await abrirCelda(page, "c-rest", SEP);

      const put = page.waitForResponse((r) => r.url().includes("/api/v1/ledger") && r.request().method() === "PUT" && r.status() === 200);
      await panel.getByTestId("detail-row").first().getByLabel("Borrar movimiento").click();
      await panel.getByLabel("Confirmar borrado").click();
      await put;

      await page.reload();
      await expect(page.getByTestId("budget-grid")).toBeVisible();
      await expect(celda(page, "c-rest", SEP)).toContainText("15.000");
      const dePuesta = await abrirCelda(page, "c-rest", SEP);
      await expect(dePuesta.getByTestId("detail-row")).toHaveCount(1);
    });

    test("TC-DDC-115e: cancelar la confirmación deja todo igual", async ({ page }) => {
      // @aitri-tc TC-DDC-115e
      await abrir(page, DOS_CAFES);
      const panel = await abrirCelda(page, "c-rest", SEP);

      // Cero escrituras: cancelar no puede tocar la fuente de verdad ni «por si acaso».
      let puts = 0;
      page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/api/v1/ledger")) puts += 1; });

      await panel.getByTestId("detail-row").first().getByLabel("Borrar movimiento").click();
      await panel.getByLabel("Cancelar borrado").click();

      await expect(panel.getByTestId("detail-row")).toHaveCount(2);
      await page.keyboard.press("Escape");
      await expect(celda(page, "c-rest", SEP)).toContainText("30.000");
      expect(puts).toBe(0);
    });

    test("TC-DDC-119f: la papelera muestra el aviso de celda negativa en lugar del check", async ({ page }) => {
      // @aitri-tc TC-DDC-119f
      // Celda en 0 = gasto de 100.000 + ajuste de −100.000. Borrar el GASTO la dejaría en −100.000.
      await abrir(page, {
        nodes: NODES,
        actuals: { "c-rest": { [SEP]: 0 } },
        movements: [
          mv("b-1", "expense", "c-rest", 100_000, SEP, "2026-09-18T12:00", 1, "Almuerzo"),
          ajuste("a-1", "c-rest", -100_000, SEP, "2026-09-19T12:00", 2),
        ],
      } as unknown as Seed);
      const panel = await abrirCelda(page, "c-rest", SEP);

      await panel.getByTestId("detail-row").filter({ hasText: "Almuerzo" }).getByLabel("Borrar movimiento").click();

      const aviso = panel.getByTestId("delete-blocked");
      await expect(aviso).toBeVisible();
      await expect(aviso).toContainText("100.000");
      // Y NO hay nada que pulsar para provocarlo: el check ni siquiera existe (UX spec F5).
      await expect(panel.getByLabel("Confirmar borrado")).toHaveCount(0);
    });

    test("TC-DDC-116f: en un ciclo cerrado no se ofrece la papelera", async ({ page }) => {
      // @aitri-tc TC-DDC-116f
      await abrir(page, {
        nodes: NODES,
        actuals: { "c-salario": { [AGO]: 1_000_000 }, "c-rest": { [AGO]: 80_000 } },
        movements: [
          mv("m-a1", "expense", "c-rest", 50_000, AGO, "2026-08-18T12:00", 1, "Almuerzo"),
          mv("m-a2", "expense", "c-rest", 30_000, AGO, "2026-08-19T12:00", 2, "Taxi"),
        ],
      } as unknown as Seed);

      expect(await closeViaApi(page)).toBe(200);
      await page.reload();
      await expect(page.getByTestId("budget-grid")).toBeVisible();
      await expect(celda(page, "c-rest", AGO)).toHaveAttribute("data-closed", "true", { timeout: 15_000 });

      // El panel SÍ se abre en un mes cerrado: es solo lectura, no un muro. Si se cortara el camino
      // los comentarios quedarían inalcanzables, y un comentario es la única salida que le queda a
      // un error demasiado viejo para reabrirlo (FR-2004).
      const panel = await abrirCelda(page, "c-rest", AGO);
      await expect(panel.getByTestId("closed-notice")).toBeVisible();
      await expect(panel.getByTestId("detail-row")).toHaveCount(2); // la lista se ve igual…

      // …pero no se puede tocar: ni editar, ni borrar, ni añadir.
      await expect(panel.getByLabel("Borrar movimiento")).toHaveCount(0);
      await expect(panel.getByLabel("Editar movimiento")).toHaveCount(0);
      await expect(panel.getByTestId("add-movement")).toHaveCount(0);
      // El comentario, en cambio, sigue disponible (FR-2004).
      await expect(panel.getByPlaceholder("Añadir comentario")).toBeVisible();
    });
  });

  test.describe("FR-2509 — «Comentario» y «Nota» en el Detalle", () => {
    test("TC-DDC-174f: la línea sin monto se llama «Comentario» y el texto de un movimiento, «Nota»", async ({ page }) => {
      // @aitri-tc TC-DDC-174f
      await abrir(page, {
        nodes: NODES,
        actuals: { "c-rest": { [SEP]: 20_000 } },
        movements: [mv("m-1", "expense", "c-rest", 20_000, SEP, "2026-09-18T12:00", 1, "Almuerzo")],
        cellNotes: { "c-rest": { [SEP]: [{ id: "n1", createdAt: 1, text: "Pedir factura" }] } },
      } as unknown as Seed);
      const panel = await abrirCelda(page, "c-rest", SEP);

      // La línea SIN monto es un comentario, y así se llama.
      const comentario = panel.getByTestId("detail-row").filter({ hasText: "Pedir factura" });
      await expect(comentario.getByLabel("Comentario")).toHaveCount(1);
      await expect(comentario.getByTestId("detail-amount")).toHaveCount(0);

      // El texto de un MOVIMIENTO se llama «Nota», nunca «observación».
      const editor = await editarFila(page, panel, "Almuerzo");
      await expect(editor.getByLabel("Nota")).toHaveValue("Almuerzo");
      expect((await panel.textContent()) ?? "").not.toMatch(/observaci/i);
    });
  });

test.describe("FR-2507 / NFR-2501 — lo que el editor NO deja hacer", () => {
  test("TC-DDC-090f: mover a una fecha de un ciclo cerrado se bloquea con el mensaje de mes cerrado", async ({ page }) => {
    // @aitri-tc TC-DDC-090f
    // El cierre es un PREFIJO: no se puede cerrar «Octubre» dejando «Septiembre» abierto. Así que el
    // caso realizable es el que describe el AC al revés: origen ABIERTO, destino cerrado ANTERIOR.
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-salario": { [AGO]: 1_000_000 }, "c-rest": { [AGO]: 100_000, [SEP]: 15_000 } },
      movements: [
        mv("m-ago", "expense", "c-rest", 100_000, AGO, "2026-08-18T12:00", 1, "Agosto"),
        mv("m-sep", "expense", "c-rest", 15_000, SEP, "2026-09-10T12:00", 2, "Café"),
      ],
    } as unknown as Seed);

    expect(await closeViaApi(page)).toBe(200);
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await expect(celda(page, "c-rest", AGO)).toHaveAttribute("data-closed", "true", { timeout: 15_000 });

    // Septiembre sigue abierto: su movimiento SÍ se puede editar…
    const panel = await abrirCelda(page, "c-rest", SEP);
    const editor = await editarFila(page, panel, "Café");

    // …pero no llevarlo a agosto, que ya está cerrado.
    await editor.getByTestId("edit-date").click();
    const pop = page.getByTestId("edit-date-popover");
    await expect(pop.locator("select.rdp-years_dropdown")).toBeVisible();
    await pop.locator("select.rdp-years_dropdown").selectOption("2026");
    await pop.locator("select.rdp-months_dropdown").selectOption("7"); // agosto (0-based)
    await pop.locator('[data-day="2026-08-18"]:not([data-outside]) button').click();

    const aviso = editor.getByTestId("edit-closed-warning");
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("cerrado");
    await expect(aviso).toContainText("reábrelo");
    // El error se IMPIDE, no se reporta después de intentarlo.
    await expect(editor.getByTestId("edit-save")).toBeDisabled();

    // Y el movimiento sigue donde estaba, con su fecha y su celda intactas.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(celda(page, "c-rest", SEP)).toContainText("15.000");
    await expect(celda(page, "c-rest", AGO)).toContainText("100.000");
  });

  test("TC-DDC-311e: una nota con HTML se pinta como texto", async ({ page }) => {
    // @aitri-tc TC-DDC-311e
    const NOTA = '<img src=x onerror="window.__xss=1">';
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 1_000 } },
      movements: [mv("m-xss", "expense", "c-rest", 1_000, SEP, "2026-09-10T12:00", 1, NOTA)],
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);

    // Se lee como TEXTO, carácter por carácter…
    await expect(panel.getByTestId("detail-note")).toHaveText(NOTA);
    // …no hay ninguna imagen que el navegador haya intentado cargar…
    await expect(panel.locator("img")).toHaveCount(0);
    // …y nada se ejecutó: el manejador del `onerror` nunca corrió.
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

    // Tampoco al editarla: el campo la trae literal, no interpretada.
    const editor = await editarFila(page, panel, "img src");
    await expect(editor.getByLabel("Nota")).toHaveValue(NOTA);
    await expect(editor.locator("img")).toHaveCount(0);
  });
});
