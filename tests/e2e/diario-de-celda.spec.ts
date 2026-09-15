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
import { seedLedger } from "./helpers/seed";
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
    await expect(page.locator('[data-month-head][data-closed="true"]')).toHaveCount(1, { timeout: 15_000 });

    await celda(page, "c-rest", AGO).dblclick();
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("cerrado");
    await expect(toast).toContainText("comentario");
    expect((await toast.textContent()) ?? "").not.toMatch(/observaci/i);
  });
});
