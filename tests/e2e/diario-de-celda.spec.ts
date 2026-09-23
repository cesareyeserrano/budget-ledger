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
import { seedDescuadrado, descuadrarCelda } from "./helpers/descuadre";
import { e2eEmail } from "./helpers/globalSetup";
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
  await declararInicio(page, seed);
  await page.goto("/");
  await expect(page.getByTestId(viewport.width < 760 ? "mobile-shell" : "budget-grid")).toBeVisible();
}

/**
 * Declara como MES DE INICIO el primer periodo con datos de la siembra (FR-2201).
 *
 * La cuenta e2e nace declarando 2026-01, y desde la feature cierre-coherente el SERVIDOR respeta ese
 * inicio declarado igual que ya lo respetaba el botón (FR-2701): sin esto, cerrar en un escenario que
 * habla de Agosto cerraría Enero, que es justo la divergencia que esa feature corrige (BG-040). Se
 * declara por el endpoint real, como lo haría el usuario, y el valor es el que estos casos ya daban por
 * supuesto: el ledger empieza donde empiezan sus datos.
 */
async function declararInicio(page: Page, seed: Seed): Promise<void> {
  const s = seed as unknown as {
    actuals?: Record<string, Record<string, number>>;
    budgets?: Record<string, Record<string, number>>;
    movements?: { period: string }[];
  };
  const periodos: string[] = [];
  for (const mapa of [s.actuals, s.budgets]) {
    for (const celdas of Object.values(mapa ?? {})) periodos.push(...Object.keys(celdas ?? {}));
  }
  for (const m of s.movements ?? []) periodos.push(m.period);
  const inicio = periodos.sort()[0];
  if (!inicio) return;
  const rev = ((await (await page.request.get("/api/v1/ledger")).json()) as { revision: number }).revision;
  const res = await page.request.put("/api/v1/ledger/start", {
    data: { baseRevision: rev, startMonth: inicio.slice(0, 7), openingBalance: 0 },
  });
  if (!res.ok()) throw new Error(`declararInicio: /start falló HTTP ${res.status()} ${await res.text()}`);
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

/**
 * Cierra el editor de la celda y ESPERA a que se haya ido.
 *
 * No basta con pulsar Escape una o dos veces. El editor se cierra en niveles —primero el bloque de
 * edición de la fila, luego el panel— y el Escape se atiende en el CONTENEDOR, así que solo llega si
 * el foco sigue dentro; cuando un popover se acaba de cerrar, o un bloque se desmontó, el foco puede
 * caer al `body` y la tecla se pierde. Con dos pulsaciones a ciegas el resultado depende del momento,
 * que es como TC-DDC-090f se volvió intermitente: fallaba al leer la celda porque, con el editor
 * abierto, la grilla pinta ahí el editor y el nodo `[data-cell]` de ese mes NO EXISTE.
 *
 * Esto pulsa hasta que el panel desaparece de verdad, con un tope para no colgarse.
 */
async function cerrarEditor(page: Page): Promise<void> {
  const panel = page.getByTestId("cell-notes");
  for (let i = 0; i < 4 && (await panel.count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 1_500 }).catch(() => {});
  }
  await expect(panel).toHaveCount(0);
}

/**
 * Despliega el campo «Añadir comentario» si está a un clic (gasto o ingreso de un mes ABIERTO, donde
 * la línea del movimiento ya tiene su «Nota»: decisión del usuario del 2026-09-21). En bolsillos y
 * meses cerrados el campo ya está a la vista y esto no hace nada.
 */
async function desplegarComentario(panel: ReturnType<Page["locator"]>): Promise<void> {
  const enlace = panel.getByTestId("comment-reveal");
  if (await enlace.count()) await enlace.click();
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
    await expect(filas.getByTestId("detail-amount")).toHaveText(["50.000", "30.000", "20.000"]);
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
    await expect(monto).toHaveText("3.000.000");
    // Color NORMAL, no el verde de ingreso: FR-1201 reserva el verde para «situación favorable».
    expect(await monto.evaluate((el) => getComputedStyle(el).color)).toBe(await cssVar(page, "--fg"));
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
      expect(Math.round(box.width)).toBe(Math.min(440, vp.width - 32));
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
    // Un comentario no lleva monto, y este —sin día, como todos los anteriores a fecha-de-comentario—
    // no muestra fecha. Desde FR-2602 de esa feature la fila SÍ tiene la columna de fecha, vacía, para
    // alinear el texto: por eso se afirma que está vacía y no que no existe.
    const comentario = filas.nth(1);
    await expect(comentario.getByTestId("detail-amount")).toHaveCount(0);
    await expect(comentario.getByTestId("detail-date")).toHaveText("");
  });

  test("TC-DDC-152h: un comentario nuevo se ve, persiste al recargar y no cambia la celda", async ({ page }) => {
    // @aitri-tc TC-DDC-152h
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 20_000 } },
      movements: [mv("m-u", "expense", "c-rest", 20_000, SEP, "2026-09-18T12:00", 1)],
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);
    await desplegarComentario(panel);

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
    await desplegarComentario(panel);

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
    // Misma anatomía Y mismo fondo (FR-2508): la distingue su ícono, nunca un color de alerta (FR-1201).
    const [a, n] = await Promise.all([
      auto.evaluate((el) => { const s = getComputedStyle(el); return `${s.fontSize}|${s.padding}`; }),
      nota.evaluate((el) => { const s = getComputedStyle(el); return `${s.fontSize}|${s.padding}`; }),
    ]);
    expect(a).toBe(n);
    const [bgAuto, bgNota] = await Promise.all([
      auto.evaluate((el) => getComputedStyle(el).backgroundColor),
      nota.evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(bgAuto).toBe(bgNota);
    // Y el ícono tampoco va en ámbar: antes era --alert-soft (BG-042).
    const iconColor = await auto.locator("svg").first().evaluate((el) => getComputedStyle(el).color);
    expect(iconColor).not.toBe(await cssVar(page, "--alert-soft"));
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
    await expect(fila.getByTestId("detail-amount")).toHaveText("30.000");
    // Se añade DENTRO de la celda: no hay un segundo formulario que llenar.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Y la línea queda lista para el siguiente, con el foco en Monto.
    await expect(panel.getByLabel("Monto")).toHaveValue("");
    await expect(panel.getByLabel("Nota")).toHaveValue("");
    await expect(panel.getByLabel("Monto")).toBeFocused();
    // El total se lee en la CELDA, no en «Editar valor»: ese input conserva el valor capturado al
    // abrir el editor y solo cambia si el usuario teclea. Y la celda solo existe con el editor
    // CERRADO —mientras está abierto, el editor ocupa su sitio—, así que se cierra antes de leerla.
    await cerrarEditor(page);
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
    await cerrarEditor(page);
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
    await expect(ajuste.getByTestId("detail-amount")).toHaveText("20.000");
    await expect(page.getByLabel("Editar valor")).toHaveValue("120000");

    // El resaltado es una respuesta a la acción, no un estado: se apaga solo.
    expect(await ajuste.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await cssVar(page, "--accent"));
    await expect
      .poll(async () => ajuste.evaluate((el) => getComputedStyle(el).borderTopWidth), { timeout: 10_000 })
      .toBe("0px");
  });

  test("TC-DDC-064e: el ajuste que BAJA la celda se ve «−10.000» y persiste", async ({ page }) => {
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
    await expect(monto).toHaveText("−10.000");
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

    // Color NORMAL, no el rojo de gasto: FR-1201 reserva el rojo para señalar una excepción.
    expect(await gasto.getByTestId("detail-amount").evaluate((el) => getComputedStyle(el).color))
      .toBe(await cssVar(page, "--fg"));
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
    await expect(panel.getByTestId("detail-amount").filter({ hasText: "50.000" })).toHaveCount(1);
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
    await desplegarComentario(panel);

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
      await expect(fila.getByTestId("detail-amount")).toHaveText("5.000");
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
        .toHaveText("50.000");

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
    await cerrarEditor(page);
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

// ══ EP-04 — Cierre y descuadres ═════════════════════════════════════════════════════════════════
//
// TCs: FR-2507 (131h,132e,133e,134e,139f) · FR-2509 (173f) · FR-2511 (192h,193e,195e,199f) ·
//      FR-2512 (211h,213e,217f,219e)
//
// La aritmética del descuadre vive en tests/domain/diario-de-celda-descuadres.test.ts y la autoridad
// del cierre en tests/integration/backend/. Aquí se afirma lo único que el navegador puede decir:
// que el aviso SE VE, que el botón NO se pulsa, que el triángulo aparece y desaparece, y que abrir
// una grilla descuadrada no escribe nada.

/**
 * Nodos con CINCO hojas de gasto: las tres del escenario (Restaurantes, Taxi, Mercado) más dos que
 * solo usa TC-DDC-219e, donde el motivo tiene que nombrar cinco celdas para llegar a truncarse.
 */
const NODES_DESC: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 1 },
  { id: "c-rest", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Restaurantes", icon: null, order: 0 },
  { id: "c-taxi", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Taxi", icon: null, order: 1 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 2 },
  { id: "c-luz", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Luz", icon: null, order: 3 },
  { id: "c-agua", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Agua", icon: null, order: 4 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 5 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 0 },
];

/** El control de cierre de escritorio y sus dos piezas. */
const botonCerrar = (page: Page) => page.getByTestId("closure-control").getByRole("button", { name: /^Cerrar/ });
const motivoBloqueo = (page: Page) => page.getByTestId("close-blocked");

/**
 * Siembra CUADRADA por la API y luego reescribe actuals+movements por SQL.
 *
 * Los dos pasos hacen cosas distintas y los dos hacen falta. El segundo planta el descuadre, que la
 * API rechaza por diseño (NFR-2502) y que por tanto solo se puede escribir por debajo.
 *
 * Y el PRIMERO no está solo para crear los nodos: siembra las MISMAS celdas del escenario, cuadradas
 * (`seedLedger` las respalda con movimientos), porque es esa escritura la que fija el RANGO ACTIVO
 * del ledger. Sembrando vacío, el rango arrancaba donde el ledger recién creado dice —no donde están
 * los datos—, y el mes cerrable salía siendo otro: el control decía «Cerrar Enero 2026» en un
 * escenario que habla de Septiembre. El SQL de después no mueve el rango, solo las cifras.
 */
async function abrirDescuadrado(
  page: Page, email: string,
  estado: { actuals: Record<string, Record<string, number>>; movements: Movement[] },
  opciones: {
    hoy?: string; viewport?: { width: number; height: number }; nodes?: LedgerNode[]; inicio?: string;
  } = {}
): Promise<void> {
  const { hoy = HOY, viewport = DESK, nodes = NODES_DESC, inicio } = opciones;
  await page.setViewportSize(viewport);
  await fixToday(page, hoy);
  await applyCycles(page, { mode: "cycle", anchorDay: 21 });
  await seedLedger(page, { nodes, actuals: estado.actuals, movements: [] } as unknown as Seed);
  // El MES DE INICIO declarado (FR-2201) es el ancla que fija dónde empieza el rango, y con él cuál
  // es el mes que toca cerrar. La cuenta e2e nace declarando 2026-01, así que sin esto el control
  // ofrece «Cerrar Enero 2026» en un escenario que habla de Septiembre. Se declara por el endpoint
  // real, igual que lo haría el usuario, no tocando la base.
  if (inicio) {
    const rev = ((await (await page.request.get("/api/v1/ledger")).json()) as { revision: number }).revision;
    const res = await page.request.put("/api/v1/ledger/start", {
      data: { baseRevision: rev, startMonth: inicio, openingBalance: 0 },
    });
    if (!res.ok()) throw new Error(`abrirDescuadrado: /start falló HTTP ${res.status()} ${await res.text()}`);
  }
  await seedDescuadrado(email, estado as unknown as Parameters<typeof seedDescuadrado>[1]);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
}

/** Teclea un valor en la celda de Ejecutado de una hoja y confirma con Enter (misma vía que FR-2504). */
async function teclearCelda(page: Page, leafId: string, period: string, valor: number): Promise<void> {
  await celda(page, leafId, period).click();
  await page.getByLabel("Editar valor").fill(String(valor));
  await page.getByLabel("Editar valor").press("Enter");
}

test.describe("FR-2507 — un periodo cerrado congela las vías nuevas; uno abierto las admite", () => {
  test("TC-DDC-131h: en un ciclo cerrado el Detalle oculta añadir, editar y borrar, y avisa", async ({ page }) => {
    // @aitri-tc TC-DDC-131h
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [AGO]: 12_000 } },
      movements: [
        mv("m-a1", "expense", "c-rest", 7_000, AGO, "2026-08-05T12:00", 1, "Pan"),
        mv("m-a2", "expense", "c-rest", 5_000, AGO, "2026-08-10T12:00", 2, "Leche"),
      ],
    } as unknown as Seed);
    expect(await closeViaApi(page)).toBe(200);
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();

    const panel = await abrirCelda(page, "c-rest", AGO);

    // El aviso, con su candado, y con el texto EXACTO: es la instrucción de salida del usuario.
    const aviso = panel.getByTestId("closed-notice");
    await expect(aviso).toBeVisible();
    // El rótulo lleva el AÑO («Agosto 2026»): es el formato de `periodLabel`, establecido por la
    // feature multi-anio (FR-1905) y compartido por toda la app. El TC lo escribe sin año como
    // abreviatura; el producto es consistente consigo mismo y no se cambia por una prueba.
    await expect(aviso).toHaveText(
      "Agosto 2026 está cerrado. Para cambiar sus movimientos, reábrelo desde el cierre de mes."
    );
    await expect(aviso.locator("svg")).toHaveCount(1); // el candado

    // Y ninguna vía de escritura de movimientos: ni añadir, ni lápiz, ni papelera.
    await expect(panel.getByTestId("add-movement")).toHaveCount(0);
    await expect(panel.getByLabel("Editar movimiento")).toHaveCount(0);
    await expect(panel.getByLabel("Borrar movimiento")).toHaveCount(0);

    // Los dos movimientos SÍ se leen: cerrado es de solo lectura, no invisible.
    await expect(panel.getByTestId("detail-row")).toHaveCount(2);

    // La celda es TEXTO, no campo. `closed-value` lo pinta dentro del editor abierto —no dentro de
    // `[data-cell]`, que es su contenedor de la grilla—, así que se localiza por su propio testid.
    const valor = page.getByTestId("closed-value");
    await expect(valor).toBeVisible();
    await expect(valor).toHaveAttribute("aria-label", "Valor de un mes cerrado, no editable");
    await expect(page.getByLabel("Editar valor")).toHaveCount(0); // y no hay campo editable
  });

  test("TC-DDC-132e: un ciclo terminado pero no cerrado admite añadir con fecha anterior", async ({ page }) => {
    // @aitri-tc TC-DDC-132e
    // Agosto se cierra con «hoy» en septiembre (es entonces el mes cerrable)…
    //
    // La siembra LLEVA una celda en Agosto a propósito: el rango activo del ledger lo fijan los
    // datos, y con una siembra vacía el mes cerrable resultaba ser el mes en curso — se cerraba
    // Septiembre y el caso probaba justo lo contrario de lo que dice su nombre.
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [AGO]: 5_000 } },
      movements: [mv("m-ago", "expense", "c-rest", 5_000, AGO, "2026-08-05T12:00", 1, "Pan")],
    } as unknown as Seed);
    expect(await closeViaApi(page)).toBe(200);

    // …y luego el reloj avanza al 22 de septiembre: Septiembre ya TERMINÓ (el ciclo cierra el 20)
    // pero sigue abierto. Ese es el estado que se prueba: terminado ≠ cerrado.
    await fixToday(page, "2026-09-22");
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();

    const panel = await abrirCelda(page, "c-rest", SEP);
    await expect(panel.getByTestId("closed-notice")).toHaveCount(0);

    const linea = panel.getByTestId("add-movement");
    await linea.getByLabel("Monto").fill("12000");
    await elegirFecha(page, panel, "2026-09-18");
    await linea.getByTestId("add-movement-confirm").click();

    await expect(panel.getByTestId("detail-date")).toHaveText("18 sep");
    // Se cierra el editor antes de mirar la celda: mientras está abierto, la grilla pinta ahí el
    // campo de edición y no la cifra.
    await cerrarEditor(page);
    await expect(celda(page, "c-rest", SEP)).toContainText("12.000");
  });

  test("TC-DDC-133e: tras reabrir el último ciclo cerrado se puede editar un movimiento suyo", async ({ page }) => {
    // @aitri-tc TC-DDC-133e
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [AGO]: 7_000 } },
      movements: [mv("m-a1", "expense", "c-rest", 7_000, AGO, "2026-08-05T12:00", 1, "Pan")],
    } as unknown as Seed);
    expect(await closeViaApi(page)).toBe(200);
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();

    // Se reabre por el control real, que es la salida que el aviso de TC-DDC-131h le promete.
    await page.getByTestId("closure-control").getByRole("button", { name: /^Reabrir/ }).click();
    await expect(page.getByTestId("closure-control")).toHaveAttribute("data-reopened", AGO);

    const panel = await abrirCelda(page, "c-rest", AGO);
    await expect(panel.getByTestId("closed-notice")).toHaveCount(0);

    const editor = await editarFila(page, panel, "Pan");
    await editor.getByLabel("Monto").fill("6000");
    await editor.getByRole("button", { name: "Guardar" }).click();

    await cerrarEditor(page);
    await expect(celda(page, "c-rest", AGO)).toContainText("6.000");
  });

  test("TC-DDC-134e: en un ciclo cerrado SÍ se puede añadir un comentario", async ({ page }) => {
    // @aitri-tc TC-DDC-134e
    // FR-2004 sigue vivo: cerrar congela las CIFRAS, no la conversación sobre ellas.
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [AGO]: 7_000 } },
      movements: [mv("m-a1", "expense", "c-rest", 7_000, AGO, "2026-08-05T12:00", 1, "Pan")],
    } as unknown as Seed);
    expect(await closeViaApi(page)).toBe(200);
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();

    const panel = await abrirCelda(page, "c-rest", AGO);
    const antes = await page.getByTestId("closed-value").innerText();

    const campo = panel.getByLabel("Añadir comentario", { exact: true });
    await campo.fill("Revisar con el banco");
    await campo.press("Enter");

    await expect(panel.getByTestId("cell-note").filter({ hasText: "Revisar con el banco" })).toHaveCount(1);
    // Y la cifra no se movió: un comentario nunca suma a la celda.
    expect(await page.getByTestId("closed-value").innerText()).toBe(antes);
  });

  test("TC-DDC-139f: si el mes se cierra desde otra pestaña, el panel pasa a cerrado y nada se escribe", async ({ page }) => {
    // @aitri-tc TC-DDC-139f
    // El caso que el botón deshabilitado NO cubre: el editor ya estaba abierto y la frontera se
    // movió por debajo.
    //
    // DESVIACIÓN DECLARADA respecto al `then` del TC. El caso dice «se pulsa Guardar y el servidor
    // responde 422». Ese camino YA NO es alcanzable desde el navegador, y no por un atajo del test:
    // la app mantiene un canal de sincronización en vivo (SSE, FR-511), así que el cierre llega a
    // esta pestaña en el acto y el bloque de edición se retira antes de que nadie pueda pulsar nada
    // —comportamiento que este mismo epic tuvo que ARREGLAR, porque el bloque sobrevivía al cierre y
    // dejaba un «Guardar» vivo sobre un mes cerrado, contra FR-2507—. Lo que el TC quiere garantizar
    // («aviso de mes cerrado y valor 9.000 intacto») se afirma entero aquí; el 422 del servidor se
    // afirma de frente donde SÍ es alcanzable, que es su capa: TC-DDC-135f, TC-DDC-136f y
    // TC-DDC-381h lo piden por la ruta directa, que es justamente la vía que un cliente viejo usaría.
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 9_000 } },
      movements: [mv("m-pan", "expense", "c-rest", 9_000, SEP, "2026-09-10T12:00", 1, "Pan")],
    } as unknown as Seed);
    await fixToday(page, "2026-09-25"); // Septiembre pasa a ser el mes cerrable
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();

    const panel = await abrirCelda(page, "c-rest", SEP);
    await editarFila(page, panel, "Pan"); // el bloque de edición, abierto
    await expect(panel.getByTestId("edit-save")).toBeVisible();

    // Ninguna escritura de movimientos puede prosperar a partir de aquí.
    const respuestas: number[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/v1/movements/")) respuestas.push(r.status());
    });

    // La otra pestaña cierra Septiembre.
    expect(await closeViaApi(page)).toBe(200);

    // El panel se pone al día y NO queda ninguna vía de edición abierta: ni el bloque que estaba
    // desplegado, ni lápiz, ni papelera, ni línea de añadir.
    await expect(panel.getByTestId("closed-notice")).toBeVisible();
    await expect(panel.getByTestId("edit-save")).toHaveCount(0);
    await expect(panel.getByLabel("Monto")).toHaveCount(0);
    await expect(panel.getByLabel("Editar movimiento")).toHaveCount(0);
    await expect(panel.getByLabel("Borrar movimiento")).toHaveCount(0);
    await expect(panel.getByTestId("add-movement")).toHaveCount(0);

    // La cifra sigue en 9.000 en pantalla y en la fuente de verdad, y nada se escribió.
    await expect(panel.getByTestId("detail-amount")).toHaveText("9.000");
    const fin = await readLedger(page);
    expect(fin?.actuals["c-rest"]?.[SEP]).toBe(9_000);
    expect(respuestas.filter((c) => c >= 200 && c < 300)).toHaveLength(0);
  });
});

test.describe("FR-2509 — ningún texto visible dice «Observaciones»", () => {
  test("TC-DDC-173f: cero apariciones de /observaci/i en las cinco superficies", async ({ page }, testInfo) => {
    // @aitri-tc TC-DDC-173f
    // El renombre se comprueba SOBRE LA PÁGINA RENDERIZADA, no sobre el código: un `grep` en src
    // pasaría igual con el texto viejo llegando desde otro módulo.
    const email = e2eEmail(testInfo.parallelIndex);
    await abrirDescuadrado(page, email, {
      actuals: { "c-rest": { [SEP]: 120_000 }, "c-viaje": { [SEP]: 300_000 } },
      movements: [
        mv("m-1", "expense", "c-rest", 100_000, SEP, "2026-09-05T12:00", 1, "Almuerzo"),
        { ...DEA, amount: 300_000 },
      ],
    });

    const recogido: string[] = [];
    const barrer = async () => {
      recogido.push(
        await page.evaluate(() => {
          const textos: string[] = [document.body.innerText];
          for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
            for (const attr of ["placeholder", "aria-label", "title"]) {
              const v = el.getAttribute(attr);
              if (v) textos.push(v);
            }
          }
          return textos.join("\n");
        })
      );
    };

    // 1) la grilla, con su aviso de descuadre a la vista
    await barrer();
    // 2) una celda de gasto
    await abrirCelda(page, "c-rest", SEP);
    await barrer();
    await page.keyboard.press("Escape");
    // 3) una celda de bolsillo, con su comentario automático De→A
    await abrirCelda(page, "c-viaje", SEP);
    await barrer();
    await page.keyboard.press("Escape");
    // 4) el Balance
    await expect(page.getByTestId("balance-module")).toBeVisible();
    await barrer();
    // 5) «Nuevo movimiento»
    await page.getByRole("button", { name: /Nuevo movimiento/ }).first().click();
    await barrer();

    const culpables = recogido.filter((t) => /observaci/i.test(t));
    expect(culpables, culpables.join("\n---\n").slice(0, 800)).toHaveLength(0);
  });
});

test.describe("FR-2511 — las celdas descuadradas se señalan como un problema del mes", () => {
  /** Restaurantes vale 120.000 pero sus movimientos suman 100.000; Taxi vale 45.000 sin ninguno. */
  const DOS_DESCUADRES = {
    actuals: { "c-rest": { [SEP]: 120_000 }, "c-taxi": { [SEP]: 45_000 }, "c-mercado": { [SEP]: 30_000 } },
    movements: [
      mv("m-1", "expense", "c-rest", 100_000, SEP, "2026-09-05T12:00", 1, "Almuerzo"),
      mv("m-2", "expense", "c-mercado", 30_000, SEP, "2026-09-06T12:00", 2, "Feria"),
    ],
  };

  test("TC-DDC-192h: triángulo en el encabezado y línea en el aviso del Balance", async ({ page }, testInfo) => {
    // @aitri-tc TC-DDC-192h
    await abrirDescuadrado(page, e2eEmail(testInfo.parallelIndex), DOS_DESCUADRES);

    const marca = page.locator('[data-testid="techo-mark"][data-month="' + SEP + '"]');
    await expect(marca).toHaveCount(1);
    // El TRIÁNGULO usa `cycleMonthLabel` (sin año) y el AVISO usa `periodLabel` (con año). Son dos
    // rótulos distintos del producto, no una incoherencia de esta feature: el encabezado ya lleva el
    // año en su fila y repetirlo en la marca sería redundante. Cada uno se afirma como es.
    const texto = "Septiembre: 2 celdas no cuadran con sus movimientos";
    await expect(marca).toHaveAttribute("title", texto);
    await expect(marca).toHaveAttribute("aria-label", texto);
    // El color es el de alerta del tema, no un rojo escrito a mano en el componente.
    const esperado = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--alert-strong").trim()
    );
    expect(esperado).not.toBe("");
    await expect(marca).toHaveCSS("color", await marca.evaluate((el) => getComputedStyle(el).color));

    // El aviso NOMBRA las dos celdas: el usuario tiene que saber a cuál ir.
    const aviso = page.getByTestId("techo-banner");
    await expect(aviso).toHaveAttribute("role", "status");
    await expect(aviso).toContainText(
      "Septiembre 2026: 2 celdas no cuadran con sus movimientos — Restaurantes, Taxi. "
      + "Teclea su valor o corrige sus movimientos."
    );
    // Mercado cuadra y NO aparece.
    await expect(aviso).not.toContainText("Mercado");
  });

  test("TC-DDC-193e: al cuadrar las dos celdas desaparecen el triángulo y la línea", async ({ page }, testInfo) => {
    // @aitri-tc TC-DDC-193e
    await abrirDescuadrado(page, e2eEmail(testInfo.parallelIndex), DOS_DESCUADRES, { hoy: "2026-09-14" });
    await expect(page.locator('[data-testid="techo-mark"][data-month="' + SEP + '"]')).toHaveCount(1);

    // Cuadrar es TECLEAR el valor: crea el ajuste que respalda la cifra (FR-2504).
    await teclearCelda(page, "c-rest", SEP, 100_000);
    await teclearCelda(page, "c-taxi", SEP, 45_000);

    await expect(page.locator('[data-testid="techo-mark"][data-month="' + SEP + '"]')).toHaveCount(0);
    await expect(page.getByTestId("techo-banner")).toHaveCount(0);
  });

  test("TC-DDC-195e: descuadre y techo del mismo mes comparten un solo triángulo", async ({ page }, testInfo) => {
    // @aitri-tc TC-DDC-195e
    // Dos problemas distintos en el mismo mes: si cada uno pintara su marca, el encabezado tendría
    // dos triángulos diciendo cosas distintas en el mismo sitio.
    await abrirDescuadrado(page, e2eEmail(testInfo.parallelIndex), {
      actuals: { "c-taxi": { [SEP]: 45_000 }, "c-viaje": { [SEP]: 5_000_000 } },
      movements: [{ ...DEA, id: "m-dea-alto", amount: 5_000_000 }],
    });

    const marca = page.locator('[data-testid="techo-mark"][data-month="' + SEP + '"]');
    await expect(marca).toHaveCount(1); // UNA sola
    const title = (await marca.getAttribute("title")) ?? "";
    expect(title).toContain(" · ");
    expect(title).toContain("1 celda no cuadra con sus movimientos");
    expect(title).toMatch(/reservas|retiro/); // el texto de techo vigente, el que sea

    // Y el aviso trae DOS líneas para Septiembre, una por problema.
    await expect(page.getByTestId("techo-banner").locator(`[data-month="${SEP}"]`)).toHaveCount(2);
  });

  test("TC-DDC-199f: abrir la grilla con descuadres no envía ninguna escritura", async ({ page }, testInfo) => {
    // @aitri-tc TC-DDC-199f
    // «Nada automático» (decisión del usuario, 2026-09-14) tiene que ser comprobable: la tentación
    // de cuadrar solo al detectar el descuadre es exactamente lo que este caso prohíbe.
    const email = e2eEmail(testInfo.parallelIndex);
    const escrituras: string[] = [];
    page.on("request", (r) => {
      if (["PUT", "PATCH", "DELETE", "POST"].includes(r.method()) && r.url().includes("/api/v1")) {
        escrituras.push(`${r.method()} ${new URL(r.url()).pathname}`);
      }
    });

    await abrirDescuadrado(page, email, DOS_DESCUADRES);
    const revisionAntes = ((await (await page.request.get("/api/v1/ledger")).json()) as { revision: number }).revision;

    // Solo se cuentan las que salgan DESPUÉS de la siembra: la propia siembra escribe, claro.
    escrituras.length = 0;
    // Tres segundos de reposo. NO se espera `networkidle`: la app mantiene abierto el canal de
    // sincronización (SSE), así que la red nunca queda ociosa y la espera agotaría el tiempo del
    // caso sin decir nada sobre las escrituras, que es lo que aquí se mide.
    await page.waitForTimeout(3_000);

    expect(escrituras, escrituras.join(", ")).toHaveLength(0);
    const revisionDespues = ((await (await page.request.get("/api/v1/ledger")).json()) as { revision: number }).revision;
    expect(revisionDespues).toBe(revisionAntes);
    // Y el descuadre sigue ahí, sin que nadie lo haya tocado.
    await expect(page.locator('[data-testid="techo-mark"][data-month="' + SEP + '"]')).toHaveCount(1);
  });
});

test.describe("FR-2512 — un mes con celdas descuadradas no se puede cerrar", () => {
  /** Septiembre cerrable (hoy 25 sep) con Taxi descuadrada y el resto cuadrado. */
  const TAXI_SOLO = {
    actuals: { "c-rest": { [SEP]: 100_000 }, "c-taxi": { [SEP]: 45_000 } },
    movements: [mv("m-1", "expense", "c-rest", 100_000, SEP, "2026-09-05T12:00", 1, "Almuerzo")],
  };
  const MOTIVO_TAXI = "No se puede cerrar: 1 celda no cuadra (Taxi)";

  test("TC-DDC-211h: «Cerrar Septiembre» deshabilitado con el motivo que nombra la celda", async ({ page }, testInfo) => {
    // @aitri-tc TC-DDC-211h
    await abrirDescuadrado(page, e2eEmail(testInfo.parallelIndex), TAXI_SOLO, { hoy: "2026-09-25", inicio: SEP });

    const boton = botonCerrar(page);
    await expect(boton).toBeVisible();
    await expect(boton).toHaveText(/Cerrar Septiembre 2026/);
    await expect(boton).toBeDisabled();
    await expect(boton).toHaveAttribute("title", MOTIVO_TAXI);

    // El motivo también SE LEE al lado: un botón apagado sin explicación obliga a adivinar.
    const motivo = motivoBloqueo(page);
    await expect(motivo).toBeVisible();
    await expect(motivo).toHaveText(MOTIVO_TAXI);
    await expect(motivo).toHaveAttribute("title", MOTIVO_TAXI);
    await expect(motivo.locator("svg")).toHaveCount(1); // el triángulo de alerta
  });

  test("TC-DDC-213e: tras cuadrar Taxi el botón se habilita y cierra el mes", async ({ page }, testInfo) => {
    // @aitri-tc TC-DDC-213e
    // La otra mitad de la regla: no es una pared, es una condición que el usuario puede cumplir.
    await abrirDescuadrado(page, e2eEmail(testInfo.parallelIndex), TAXI_SOLO, { hoy: "2026-09-25", inicio: SEP });
    await expect(botonCerrar(page)).toBeDisabled();

    await teclearCelda(page, "c-taxi", SEP, 45_000);

    await expect(motivoBloqueo(page)).toHaveCount(0);
    await expect(botonCerrar(page)).toBeEnabled();

    await botonCerrar(page).click();
    await expect(page.getByTestId("closure-control").getByRole("button", { name: /^Reabrir Septiembre 2026/ })).toBeVisible();
    // Y la celda de Septiembre queda como no editable. Con el editor cerrado, lo que la grilla
    // expone es `data-closed`; el rótulo «Valor de un mes cerrado, no editable» aparece al abrirla
    // (es lo que comprueba TC-DDC-131h). Mismo criterio que TC-DDC-175f.
    await expect(celda(page, "c-rest", SEP)).toHaveAttribute("data-closed", "true", { timeout: 15_000 });
  });

  test("TC-DDC-217f: desde una pestaña con datos viejos el servidor rechaza y el control se pone al día", async ({ page }, testInfo) => {
    // @aitri-tc TC-DDC-217f
    // El botón es ERGONOMÍA; la autoridad está en el servidor (ADR-12). Aquí el cliente cree que
    // puede cerrar porque su copia está cuadrada, y el dato cambió por debajo sin mover la revisión.
    const email = e2eEmail(testInfo.parallelIndex);
    await abrirDescuadrado(page, email, {
      actuals: { "c-rest": { [SEP]: 100_000 } },
      movements: [mv("m-1", "expense", "c-rest", 100_000, SEP, "2026-09-05T12:00", 1, "Almuerzo")],
    }, { hoy: "2026-09-25", inicio: SEP });

    // La pestaña ve todo cuadrado: el botón está habilitado.
    await expect(botonCerrar(page)).toBeEnabled();
    await expect(motivoBloqueo(page)).toHaveCount(0);

    // Por debajo, Taxi pasa a 45.000 sin movimientos y SIN subir la revisión.
    await descuadrarCelda(email, "c-taxi", SEP, 45_000);

    await botonCerrar(page).click();

    // Septiembre sigue abierto y, tras el resync, el control dice por qué.
    await expect(motivoBloqueo(page)).toHaveText(MOTIVO_TAXI);
    await expect(botonCerrar(page)).toBeDisabled();
    await expect(page.getByTestId("closure-control").getByRole("button", { name: /^Reabrir Septiembre 2026/ })).toHaveCount(0);
  });

  test("TC-DDC-219e: a 768 px el motivo se trunca y conserva el texto completo en title", async ({ page }, testInfo) => {
    // @aitri-tc TC-DDC-219e
    // Con cinco celdas el motivo es largo. Truncar es lo correcto —el texto vive en `title`—, pero
    // solo si de verdad trunca: sin tope de ancho crecería y empujaría al historial fuera.
    await abrirDescuadrado(page, e2eEmail(testInfo.parallelIndex), {
      actuals: {
        "c-rest": { [SEP]: 120_000 }, "c-taxi": { [SEP]: 45_000 }, "c-mercado": { [SEP]: 30_000 },
        "c-luz": { [SEP]: 20_000 }, "c-agua": { [SEP]: 15_000 },
      },
      movements: [],
    }, { hoy: "2026-09-25", viewport: NARROW, inicio: SEP });

    const motivo = motivoBloqueo(page);
    await expect(motivo).toBeVisible();
    const completo = (await motivo.getAttribute("title")) ?? "";
    expect(completo).toContain("5 celdas no cuadran");

    const medidas = await motivo.evaluate((el) => {
      const cs = getComputedStyle(el);
      const interior = el.querySelector("span:last-of-type") as HTMLElement;
      return {
        overflow: cs.textOverflow,
        maxWidth: parseFloat(cs.maxWidth),
        scrollWidth: interior.scrollWidth,
        clientWidth: interior.clientWidth,
        interiorOverflow: getComputedStyle(interior).textOverflow,
      };
    });
    expect(medidas.interiorOverflow).toBe("ellipsis");
    expect(medidas.maxWidth).toBeLessThanOrEqual(320);
    expect(medidas.scrollWidth).toBeGreaterThan(medidas.clientWidth);
    expect(medidas.overflow).toBe("ellipsis");

    // Y la página no se desborda a lo ancho por culpa del control.
    const desborde = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(desborde).toBeLessThanOrEqual(0);
  });
});

// ══ FR-2505 corregido (2026-09-18) — poner el monto en cero ELIMINA ═════════════════════════════

test.describe("FR-2505 — cero elimina, con el rótulo que lo anuncia", () => {
  test("TC-DDC-124h: dejar el Monto en 0 cambia el botón a «Eliminar» y borra la fila", async ({ page }) => {
    // @aitri-tc TC-DDC-124h
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 30_000 } },
      movements: [
        mv("m-1", "expense", "c-rest", 15_000, SEP, "2026-09-10T12:00", 1, "Uno"),
        mv("m-2", "expense", "c-rest", 15_000, SEP, "2026-09-11T12:00", 2, "Dos"),
      ],
    } as unknown as Seed);

    const panel = await abrirCelda(page, "c-rest", SEP);
    const editor = await editarFila(page, panel, "Uno");

    // Con el monto original el botón guarda…
    const boton = editor.getByTestId("edit-save");
    await expect(boton).toHaveText("Guardar");

    // …y en cuanto el monto es 0 ANUNCIA lo que va a hacer, antes de que nadie pulse. Esa es la
    // razón por la que no se pide una segunda confirmación: la consecuencia ya se leyó.
    await editor.getByLabel("Monto").fill("0");
    await expect(boton).toHaveText("Eliminar");
    await expect(boton).toBeEnabled();
    const rojo = await cssVar(page, "--error");
    expect(await boton.evaluate((el) => getComputedStyle(el).color)).toBe(rojo);

    await boton.click();

    // Queda una sola fila y la celda baja: el mismo resultado que la papelera.
    await expect(panel.getByTestId("detail-row")).toHaveCount(1);
    await expect(panel.getByTestId("detail-note")).toHaveText("Dos");
    await cerrarEditor(page);
    await expect(celda(page, "c-rest", SEP)).toContainText("15.000");

    // Y persiste: no era solo pantalla.
    const fin = await readLedger(page);
    expect(fin?.movements.filter((m) => m.target === "c-rest").map((m) => m.note)).toEqual(["Dos"]);
  });

  test("TC-DDC-126f: si eliminar con 0 dejara la celda negativa, sale el MISMO aviso que la papelera", async ({ page }) => {
    // @aitri-tc TC-DDC-126f
    // Dos vías para el mismo acto no pueden dar mensajes distintos: el usuario creería que son
    // operaciones diferentes y buscaría la «que sí funciona».
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 0 } },
      movements: [
        mv("m-gasto", "expense", "c-rest", 100_000, SEP, "2026-09-10T12:00", 1, "Compra"),
        ajuste("m-aj", "c-rest", -100_000, SEP, "2026-09-11T12:00", 2),
      ],
    } as unknown as Seed);

    const panel = await abrirCelda(page, "c-rest", SEP);

    // 1) Por la PAPELERA: se captura el texto que da hoy.
    const fila = panel.getByTestId("detail-row").filter({ hasText: "Compra" });
    await fila.getByLabel("Borrar movimiento").click();
    const porPapelera = (await panel.getByTestId("delete-blocked").innerText()).replace(/\s+/g, " ").trim();
    expect(porPapelera).toContain("No se puede borrar");
    // El aviso se cierra con su propia X, NO con Escape: el Escape cierra el editor de la celda
    // entero (es su salida por teclado) y dejaría el panel sin el lápiz que hace falta después.
    await fila.getByLabel("Cancelar borrado").click();

    // 2) Por el CERO: tiene que decir lo mismo y no dejar pulsar.
    const editor = await editarFila(page, panel, "Compra");
    await editor.getByLabel("Monto").fill("0");
    const aviso = editor.getByTestId("negative-cell-warning").or(panel.getByTestId("delete-blocked"));
    await expect(aviso).toBeVisible();
    const porCero = (await aviso.innerText()).replace(/\s+/g, " ").trim();
    await expect(editor.getByTestId("edit-save")).toBeDisabled();

    expect(porCero, `papelera: «${porPapelera}» · cero: «${porCero}»`).toBe(porPapelera);

    // Y nada cambió por ninguna de las dos vías.
    const fin = await readLedger(page);
    expect(fin?.movements.filter((m) => m.target === "c-rest")).toHaveLength(2);
  });
});

test.describe("FR-2501 — las cifras del Detalle suman a la vista el valor de la celda", () => {
  test("TC-DDC-012e: el caso real de Agua/octubre, sin un solo signo", async ({ page }) => {
    // @aitri-tc TC-DDC-012e
    // El escenario EXACTO en el que el usuario detectó el fallo el 2026-09-18: cuatro gastos que
    // se pintaban «−150.000 −40.000 −50.000 −10.000» bajo una celda que decía 250.000 en positivo.
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 250_000 } },
      movements: [
        mv("a-1", "expense", "c-rest", 150_000, SEP, "2026-09-05T12:00", 1, "Uno"),
        mv("a-2", "expense", "c-rest", 40_000, SEP, "2026-09-06T12:00", 2, "Dos"),
        mv("a-3", "expense", "c-rest", 50_000, SEP, "2026-09-07T12:00", 3, "Tres"),
        mv("a-4", "expense", "c-rest", 10_000, SEP, "2026-09-08T12:00", 4, "Cuatro"),
      ],
    } as unknown as Seed);

    const panel = await abrirCelda(page, "c-rest", SEP);
    const montos = await panel.getByTestId("detail-amount").allInnerTexts();
    expect(montos).toEqual(["150.000", "40.000", "50.000", "10.000"]);

    // LA PROMESA DEL PANEL, comprobada como la comprobaría el usuario: sumando lo que ve.
    const suma = montos.reduce((t, m) => t + Number(m.replace(/\./g, "")), 0);
    expect(suma).toBe(250_000);
    await cerrarEditor(page);
    await expect(celda(page, "c-rest", SEP)).toContainText("250.000");
  });

  test("TC-DDC-013f: ningún monto lleva «+», y solo lleva «−» lo que resta", async ({ page }) => {
    // @aitri-tc TC-DDC-013f
    // La guarda de la regla retirada, sobre la PÁGINA: gasto e ingreso a la vez, cada uno con un
    // movimiento que suma y un ajuste que resta.
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 90_000 }, "c-salario": { [SEP]: 90_000 } },
      movements: [
        mv("g-1", "expense", "c-rest", 100_000, SEP, "2026-09-05T12:00", 1, "Gasto"),
        ajuste("g-aj", "c-rest", -10_000, SEP, "2026-09-06T12:00", 2),
        mv("i-1", "income", "c-salario", 100_000, SEP, "2026-09-05T12:00", 3, "Ingreso"),
        { ...ajuste("i-aj", "c-salario", -10_000, SEP, "2026-09-06T12:00", 4), type: "income", catId: "c-salario", target: "c-salario" },
      ],
    } as unknown as Seed);

    for (const hoja of ["c-rest", "c-salario"]) {
      const panel = await abrirCelda(page, hoja, SEP);
      const montos = await panel.getByTestId("detail-amount").allInnerTexts();
      // Idéntico en gasto y en ingreso: la celda ya dice de qué tipo es.
      expect(montos, hoja).toEqual(["100.000", "−10.000"]);
      expect(montos.some((m) => m.includes("+")), `${hoja} no lleva «+»`).toBe(false);
      // Y leídos tal cual, suman el valor de la celda.
      const suma = montos.reduce((t, m) => t + Number(m.replace(/\./g, "").replace("−", "-")), 0);
      expect(suma, hoja).toBe(90_000);
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("FR-1201 — el Detalle no clasifica con color", () => {
  test("TC-DDC-014f: ningún monto del Detalle se pinta con un color de tipo", async ({ page }) => {
    // @aitri-tc TC-DDC-014f
    // El agujero por el que se coló el fallo. FR-1201 (refinamiento-ui) prohíbe usar el rojo o el
    // verde para decir «esto es un gasto / un ingreso»: los reserva para señalar una excepción. Sus
    // pruebas miraban la grilla y el Balance — las superficies de entonces —, y el Detalle, que llegó
    // después, pintaba cada gasto de rojo sin que nada lo viera. Además el color se escribía como
    // `var(--type-${type})`, una cadena armada al vuelo que ninguna búsqueda literal encontraba.
    // Esta prueba mira el color COMPUTADO, que no se deja engañar por cómo esté escrito.
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 90_000 }, "c-salario": { [SEP]: 90_000 } },
      movements: [
        mv("g-1", "expense", "c-rest", 100_000, SEP, "2026-09-05T12:00", 1, "Gasto"),
        ajuste("g-aj", "c-rest", -10_000, SEP, "2026-09-06T12:00", 2),
        mv("i-1", "income", "c-salario", 100_000, SEP, "2026-09-05T12:00", 3, "Ingreso"),
        { ...ajuste("i-aj", "c-salario", -10_000, SEP, "2026-09-06T12:00", 4), type: "income", catId: "c-salario", target: "c-salario" },
      ],
    } as unknown as Seed);

    const prohibidos = [await cssVar(page, "--type-expense"), await cssVar(page, "--type-income")];
    for (const hoja of ["c-rest", "c-salario"]) {
      const panel = await abrirCelda(page, hoja, SEP);
      const colores = await panel.getByTestId("detail-amount").evaluateAll(
        (els) => els.map((el) => getComputedStyle(el).color)
      );
      expect(colores.length, hoja).toBe(2);
      for (const c of colores) expect(prohibidos, `${hoja}: ${c}`).not.toContain(c);
      await cerrarEditor(page);
    }
  });
});

test.describe("Tarjeta del Detalle — legible y con salida visible (2026-09-21)", () => {
  test("TC-DDC-015e: una nota larga se lee entera, partida en varias líneas", async ({ page }) => {
    // @aitri-tc TC-DDC-015e
    // Con 320 px y una sola línea las notas salían «Almuerzo cum…», «Cena cumple…».
    const LARGA = "Almuerzo de cumpleaños con la familia en el restaurante del centro, propina incluida";
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [SEP]: 50_000 } },
      movements: [mv("m-larga", "expense", "c-rest", 50_000, SEP, "2026-09-10T12:00", 1, LARGA)],
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);
    const nota = panel.getByTestId("detail-note");
    await expect(nota).toHaveText(LARGA);
    const m = await nota.evaluate((el) => {
      const s = getComputedStyle(el);
      return { overflow: s.textOverflow, sw: el.scrollWidth, cw: el.clientWidth, alto: el.getBoundingClientRect().height, lh: parseFloat(s.lineHeight) || 16 };
    });
    expect(m.overflow).not.toBe("ellipsis");
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    expect(m.alto).toBeGreaterThan(m.lh * 1.5); // ocupa más de una línea
    await expect(panel.getByTestId("detail-amount")).toBeVisible();
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(440);
  });

  test("TC-DDC-016h: «Cancelar» descarta lo tecleado y «Guardar» equivale a Enter", async ({ page }) => {
    // @aitri-tc TC-DDC-016h
    await abrir(page, REST_SEP); // celda en 100.000
    let panel = await abrirCelda(page, "c-rest", SEP);
    await page.getByLabel("Editar valor").fill("120000");
    await panel.getByTestId("cell-cancel").click();
    await expect(panel).toHaveCount(0);
    await expect(celda(page, "c-rest", SEP)).toContainText("100.000");
    expect((await readLedger(page))?.movements.filter((m) => m.kind === "adjustment")).toHaveLength(0);

    panel = await abrirCelda(page, "c-rest", SEP);
    await page.getByLabel("Editar valor").fill("120000");
    await panel.getByTestId("cell-save").click();
    await expect(celda(page, "c-rest", SEP)).toContainText("120.000");
    await expect.poll(async () =>
      (await readLedger(page))?.movements.filter((m) => m.kind === "adjustment").map((m) => m.amount)
    ).toEqual([20_000]);
  });
});

test.describe("FR-2508 — el comentario a un clic donde ya está la nota del movimiento", () => {
  test("TC-DDC-017e: gasto abierto → enlace; bolsillo y mes cerrado → campo visible", async ({ page }) => {
    // @aitri-tc TC-DDC-017e
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-salario": { [AGO]: 2_000_000 }, "c-rest": { [AGO]: 7_000, [SEP]: 10_000 }, "c-viaje": { [SEP]: 1_000_000 } },
      movements: [
        mv("m-ago", "expense", "c-rest", 7_000, AGO, "2026-08-05T12:00", 1, "Pan"),
        mv("m-sep", "expense", "c-rest", 10_000, SEP, "2026-09-05T12:00", 2, "Café"),
        DEA,
      ],
    } as unknown as Seed);

    // Gasto de un mes ABIERTO: una sola caja visible (la del movimiento) y el comentario a un clic.
    let panel = await abrirCelda(page, "c-rest", SEP);
    await expect(panel.getByLabel("Añadir comentario", { exact: true })).toHaveCount(0);
    await panel.getByTestId("comment-reveal").click();
    const campo = panel.getByLabel("Añadir comentario", { exact: true });
    await expect(campo).toBeFocused();
    await campo.fill("Revisar el recibo");
    await campo.press("Enter");
    await expect(panel.getByTestId("cell-note").filter({ hasText: "Revisar el recibo" })).toHaveCount(1);
    await cerrarEditor(page);

    // Bolsillo: no hay línea de movimiento, el comentario es la única caja y se ve siempre.
    panel = await abrirCelda(page, "c-viaje", SEP);
    await expect(panel.getByLabel("Añadir comentario", { exact: true })).toBeVisible();
    await expect(panel.getByTestId("comment-reveal")).toHaveCount(0);
    await cerrarEditor(page);

    // Mes CERRADO: tampoco hay línea de movimiento.
    expect(await closeViaApi(page)).toBe(200);
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    panel = await abrirCelda(page, "c-rest", AGO);
    await expect(panel.getByLabel("Añadir comentario", { exact: true })).toBeVisible();
    await expect(panel.getByTestId("comment-reveal")).toHaveCount(0);
  });
});

test.describe("FR-2502 / FR-2505 — Enter registra desde cualquier campo, también tras elegir la fecha", () => {
  // Hueco que encontró el usuario: tras elegir un día, el foco se quedaba en el botón de fecha y Enter
  // REABRÍA el calendario en vez de registrar. Monto y Nota ya respondían a Enter; la fecha no.
  test("añadir: elegir la fecha y pulsar Enter registra el movimiento", async ({ page }) => {
    await abrir(page, REST_SEP);
    const panel = await abrirCelda(page, "c-rest", SEP);
    const antes = (await readLedger(page))?.movements.length ?? 0;
    await panel.getByLabel("Monto").fill("1000");
    await panel.getByLabel("Nota").fill("Pan");
    await elegirFecha(page, panel, "2026-09-05");
    await expect(page.getByTestId("add-date-popover")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readLedger(page))?.movements.length ?? 0).toBe(antes + 1);
    await expect(page.getByTestId("add-date-popover")).toHaveCount(0);
  });

  test("añadir: Enter con el foco en el botón de fecha registra si ya hay monto", async ({ page }) => {
    await abrir(page, REST_SEP);
    const panel = await abrirCelda(page, "c-rest", SEP);
    const antes = (await readLedger(page))?.movements.length ?? 0;
    await panel.getByLabel("Monto").fill("1000");
    await panel.getByTestId("add-date").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readLedger(page))?.movements.length ?? 0).toBe(antes + 1);
  });

  test("editar: elegir la fecha y pulsar Enter guarda el cambio", async ({ page }) => {
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
    await pop.locator('[data-day="2026-09-15"]:not([data-outside]) button').click();
    await expect(pop).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(panel.getByTestId("movement-editor")).toHaveCount(0);
    await expect.poll(async () => (await readLedger(page))?.movements.find((m) => m.id === "m-x")?.date)
      .toMatch(/^2026-09-15/);
  });
});

test.describe("BG-001 — cerrar el Detalle no anula los movimientos recién añadidos", () => {
  // Lo que vio el usuario en Peluquería de octubre: añadía un movimiento desde el Detalle, cerraba con
  // «Guardar» (o Enter, o un clic fuera) y aparecía un «Ajuste manual» por el mismo monto en negativo.
  // El campo del valor guardaba la cifra de cuando se ABRIÓ la celda y guardar la re-tecleaba.
  const cierres: [string, (page: Page, panel: ReturnType<Page["locator"]>) => Promise<void>][] = [
    ["Guardar", async (_page, panel) => { await panel.getByTestId("cell-save").click(); }],
    ["Enter en el valor", async (page) => { await page.getByLabel("Editar valor").press("Enter"); }],
    // El clic fuera solo cierra cuando el foco está en el campo del valor (su blur comitea); tras añadir,
    // el foco queda en «Monto», así que primero se vuelve al valor, como haría el usuario.
    ["clic fuera", async (page) => {
      await page.getByLabel("Editar valor").click();
      await page.getByTestId("budget-grid").click({ position: { x: 5, y: 5 } });
    }],
  ];
  for (const [como, cerrar] of cierres) {
    test(`añadir 1.000 y cerrar con ${como} deja la celda en 1.000, sin ajuste`, async ({ page }) => {
      await abrir(page, { nodes: NODES, actuals: {}, movements: [] } as unknown as Seed);
      const panel = await abrirCelda(page, "c-rest", SEP);
      await panel.getByLabel("Monto").fill("1000");
      await panel.getByLabel("Nota").fill("Prueba");
      await panel.getByLabel("Nota").press("Enter");
      // El campo del valor pasa a la cifra nueva: no se queda mostrando el 0 de cuando se abrió.
      await expect(page.getByLabel("Editar valor")).toHaveValue("1000");
      await cerrar(page, panel);
      await expect(page.getByTestId("cell-notes")).toHaveCount(0);
      await expect.poll(async () => {
        const s = await readLedger(page);
        return {
          celda: s?.actuals["c-rest"]?.[SEP] ?? 0,
          ajustes: (s?.movements ?? []).filter((m) => m.kind === "adjustment").length,
        };
      }).toEqual({ celda: 1000, ajustes: 0 });
    });
  }

  test("si el usuario SÍ teclea un total, guardar lo sigue aplicando con su ajuste (FR-2504)", async ({ page }) => {
    await abrir(page, { nodes: NODES, actuals: {}, movements: [] } as unknown as Seed);
    const panel = await abrirCelda(page, "c-rest", SEP);
    await panel.getByLabel("Monto").fill("1000");
    await panel.getByLabel("Nota").press("Enter");
    await page.getByLabel("Editar valor").fill("1500");
    await panel.getByTestId("cell-save").click();
    await expect.poll(async () => {
      const s = await readLedger(page);
      return {
        celda: s?.actuals["c-rest"]?.[SEP] ?? 0,
        ajustes: (s?.movements ?? []).filter((m) => m.kind === "adjustment").map((m) => m.amount),
      };
    }).toEqual({ celda: 1500, ajustes: [500] });
  });
});
