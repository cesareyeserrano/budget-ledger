/**
 * Feature fecha-de-comentario — EP-02: lo que solo el NAVEGADOR puede afirmar del día del comentario.
 * TCs: FR-2601 (005h) · FR-2602 (020h, 021e, 022e, 023f, 024h, 025e, 026e, 027h, 028e, 029f, 030e) ·
 *      FR-2603 (047h) · NFR-2602 (071e) · NFR-2603 (080h).
 *
 * El orden y el día guardado viven en tests/domain/fecha-de-comentario.test.ts; aquí se afirma que la
 * pantalla los MUESTRA: la columna de fecha, su alineación con la del movimiento, el color, la
 * recarga desde Postgres y el mes cerrado.
 *
 * Escenario: modo MES y «hoy» en el servidor 2026-09-21, así que «Septiembre» va del 1 al 30 y un
 * comentario de hoy cae entre movimientos del 18 y del 25. El navegador corre en America/Bogota
 * (la zona del único usuario) con el reloj fijado a la hora de cada caso.
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { readLedger, seedLedger } from "./helpers/seed";
import { closeViaApi, fixToday } from "./helpers/cycles";
import type { CellNote, LedgerNode, Movement } from "@/domain/types";

test.use({ timezoneId: "America/Bogota" });

const DESK = { width: 1440, height: 900 };
const NARROW = { width: 768, height: 900 };
const MOBILE = { width: 375, height: 812 };

const HOY = "2026-09-21";
/** Las 10:00 del 21-sep en Bogotá: la hora a la que se escribe en casi todos los casos. */
const MANANA = "2026-09-21T10:00:00-05:00";
const AGO = "2026-08";
const SEP = "2026-09";

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-vida", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Estilo de vida", icon: null, order: 1 },
  { id: "c-rest", ownerId: "local", type: "expense", level: "category", parentId: "g-vida", name: "Restaurantes", icon: null, order: 0 },
  { id: "c-cafe", ownerId: "local", type: "expense", level: "category", parentId: "g-vida", name: "Café", icon: null, order: 1 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 2 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 0 },
];

type Seed = Parameters<typeof seedLedger>[1];

/** Un gasto de Restaurantes con fecha y nota. */
function gasto(id: string, period: string, dia: string, amount: number, createdAt: number, note?: string): Movement {
  return {
    id, ownerId: "local", type: "expense", catId: "c-rest", subId: null, target: "c-rest", amount,
    period: period as Movement["period"], createdAt, date: `${dia}T12:00`, ...(note ? { note } : {}),
  };
}
function nota(id: string, createdAt: number, text: string, date?: string): CellNote {
  return { id, createdAt, text, ...(date ? { date } : {}) };
}

/** Restaurantes de septiembre con los movimientos y comentarios dados; la celda, cuadrada. */
function restaurantes(movs: Movement[], notas: CellNote[] = []): Seed {
  const total = movs.reduce((s, m) => s + m.amount, 0);
  return {
    nodes: NODES,
    actuals: { "c-rest": { [SEP]: total } },
    movements: movs,
    ...(notas.length > 0 ? { cellNotes: { "c-rest": { [SEP]: notas } } } : {}),
  } as unknown as Seed;
}

/**
 * Fija «hoy» (servidor y navegador), siembra y abre la app. `hora` es el instante exacto del reloj
 * del navegador: `fixToday` lo deja a mediodía y aquí se precisa, porque el día del comentario
 * depende de la hora local.
 */
async function abrir(page: Page, seed: Seed, viewport = DESK, hora = MANANA): Promise<void> {
  await page.setViewportSize(viewport);
  await fixToday(page, HOY);
  await page.clock.setFixedTime(new Date(hora));
  await seedLedger(page, seed);
  await page.goto("/");
  await expect(page.getByTestId(viewport.width < 760 ? "mobile-shell" : "budget-grid")).toBeVisible();
}

const celda = (page: Page, leafId: string, period: string) =>
  page.locator(`[data-cell="${leafId}"][data-month="${period}"][data-plane="actual"]`).first();

async function abrirCelda(page: Page, leafId: string, period: string) {
  await celda(page, leafId, period).click();
  const panel = page.getByTestId("cell-notes");
  await expect(panel).toBeVisible();
  return panel;
}

/** Cierra el editor y espera a que se vaya (mismo patrón y mismo motivo que diario-de-celda). */
async function cerrarEditor(page: Page): Promise<void> {
  const panel = page.getByTestId("cell-notes");
  for (let i = 0; i < 4 && (await panel.count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 1_500 }).catch(() => {});
  }
  await expect(panel).toHaveCount(0);
}

/** Escribe un comentario desde el Detalle abierto: despliega el campo si está a un clic y pulsa Enter. */
async function comentar(panel: ReturnType<Page["locator"]>, texto: string): Promise<void> {
  const enlace = panel.getByTestId("comment-reveal");
  if (await enlace.count()) await enlace.click();
  const campo = panel.getByLabel("Añadir comentario", { exact: true });
  await campo.fill(texto);
  await campo.press("Enter");
}

/** La fila de comentario cuyo texto es `texto`. */
const filaDeComentario = (panel: ReturnType<Page["locator"]>, texto: string) =>
  panel.locator('[data-testid="detail-row"][data-kind="comment"]').filter({ has: panel.page().getByTestId("cell-note").filter({ hasText: texto }) });

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
/** El fondo EFECTIVO: las filas van sobre un tinte translúcido que hay que componer con el panel. */
const fondoEfectivo = (loc: ReturnType<Page["locator"]>) =>
  loc.evaluate((el) => {
    const parse = (s: string): { c: number[]; a: number } => {
      const nums = (s.match(/-?\d*\.?\d+/g) ?? ["0", "0", "0"]).map(Number);
      const esFraccion = s.trim().startsWith("color(");
      const c = nums.slice(0, 3).map((v) => (esFraccion ? Math.round(v * 255) : v));
      const a = nums.length > 3 ? nums[3]! : 1;
      return { c, a };
    };
    const capas: { c: number[]; a: number }[] = [];
    let n: HTMLElement | null = el as HTMLElement;
    let base = [255, 255, 255];
    while (n) {
      const { c, a } = parse(getComputedStyle(n).backgroundColor);
      if (a >= 1) { base = c; break; }
      if (a > 0) capas.push({ c, a });
      n = n.parentElement;
    }
    let out = base;
    for (const capa of capas.reverse()) {
      out = out.map((b, i) => Math.round(capa.c[i]! * capa.a + b * (1 - capa.a)));
    }
    return `rgb(${out.join(", ")})`;
  });
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

// ── FR-2601 · el día persiste ────────────────────────────────────────────────────────────────────

test.describe("FR-2601 — el día del comentario sobrevive a la recarga", () => {
  test("TC-FDC-005h: flujo F1 hasta la recarga — el comentario sigue mostrando «21 sep»", async ({ page }) => {
    // @aitri-tc TC-FDC-005h
    await abrir(page, restaurantes([gasto("m18", SEP, "2026-09-18", 20_000, 1, "Almuerzo")]));
    let panel = await abrirCelda(page, "c-rest", SEP);
    await comentar(panel, "Pagar en efectivo");
    await expect(filaDeComentario(panel, "Pagar en efectivo").getByTestId("detail-date")).toHaveText("21 sep");
    await cerrarEditor(page);

    // Lo que vuelve tras recargar viene de Postgres, no del estado en memoria.
    await expect.poll(async () => (await readLedger(page))?.cellNotes?.["c-rest"]?.[SEP]?.[0]?.date).toBe("2026-09-21");
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    panel = await abrirCelda(page, "c-rest", SEP);
    await expect(filaDeComentario(panel, "Pagar en efectivo").getByTestId("detail-date")).toHaveText("21 sep");
  });
});

// ── FR-2602 · la fila muestra su día ─────────────────────────────────────────────────────────────

test.describe("FR-2602 — la fila del comentario muestra su día como la de un movimiento", () => {
  test("TC-FDC-020h: movimiento y comentario del 18 sep muestran «18 sep» en la misma columna y color", async ({ page }) => {
    // @aitri-tc TC-FDC-020h
    await abrir(page, restaurantes([gasto("m18", SEP, "2026-09-18", 20_000, 1)], [nota("c18", 1, "Pedir factura", "2026-09-18")]));
    const panel = await abrirCelda(page, "c-rest", SEP);

    const delMovimiento = panel.locator('[data-testid="detail-row"][data-kind="movement"]').getByTestId("detail-date");
    const delComentario = filaDeComentario(panel, "Pedir factura").getByTestId("detail-date");
    await expect(delMovimiento).toHaveText("18 sep");
    await expect(delComentario).toHaveText("18 sep");

    const [xm, xc] = [(await delMovimiento.boundingBox())!.x, (await delComentario.boundingBox())!.x];
    expect(Math.abs(xm - xc), `x movimiento ${xm} · x comentario ${xc}`).toBeLessThanOrEqual(1);
    const muted = await cssVar(page, "--fg-muted");
    await expect(delMovimiento).toHaveCSS("color", muted);
    await expect(delComentario).toHaveCSS("color", muted);
  });

  test("TC-FDC-021e: un comentario de hoy dice «21 sep», no «Hoy»", async ({ page }) => {
    // @aitri-tc TC-FDC-021e
    await abrir(page, restaurantes([gasto("m18", SEP, "2026-09-18", 20_000, 1)]));
    const panel = await abrirCelda(page, "c-rest", SEP);
    await comentar(panel, "Llamar al banco");

    await expect(filaDeComentario(panel, "Llamar al banco").getByTestId("detail-date")).toHaveText("21 sep");
    await expect(panel.getByTestId("detail-row").filter({ hasText: /\bHoy\b/ })).toHaveCount(0);
  });

  test("TC-FDC-022e: un comentario sin día deja la columna vacía de 44 px y el texto alineado", async ({ page }) => {
    // @aitri-tc TC-FDC-022e
    await abrir(page, restaurantes([gasto("m18", SEP, "2026-09-18", 20_000, 1, "Almuerzo")], [nota("viejo", 1, "Pedir factura")]));
    const panel = await abrirCelda(page, "c-rest", SEP);

    const fila = filaDeComentario(panel, "Pedir factura");
    const fecha = fila.getByTestId("detail-date");
    await expect(fecha).toHaveText("");
    await expect(fecha).toHaveCSS("width", "44px");

    const xNota = (await panel.getByTestId("detail-note").filter({ hasText: "Almuerzo" }).boundingBox())!.x;
    const xComentario = (await fila.getByTestId("cell-note").boundingBox())!.x;
    expect(Math.abs(xNota - xComentario), `nota ${xNota} · comentario ${xComentario}`).toBeLessThanOrEqual(1);
  });

  test("TC-FDC-023f: un comentario sin día nunca muestra una fecha sacada del contador interno", async ({ page }) => {
    // @aitri-tc TC-FDC-023f
    await abrir(page, restaurantes([], [nota("v1", 1, "Primero"), nota("v31", 31, "Trigésimo primero")]));
    const panel = await abrirCelda(page, "c-rest", SEP);

    const fechas = panel.locator('[data-testid="detail-row"][data-kind="comment"]').getByTestId("detail-date");
    await expect(fechas).toHaveCount(2);
    await expect(fechas).toHaveText(["", ""]);
    for (const t of await fechas.allTextContents()) {
      expect(t).not.toMatch(/\d{1,2} [a-z]{3}/);
    }
  });

  test("TC-FDC-024h: en una celda de bolsillo el comentario fechado muestra «18 sep»", async ({ page }) => {
    // @aitri-tc TC-FDC-024h
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-salario": { [AGO]: 2_000_000 }, "c-viaje": { [SEP]: 1_000_000 } },
      movements: [],
      cellNotes: { "c-viaje": { [SEP]: [nota("c18", 1, "Tiquetes en octubre", "2026-09-18")] } },
    } as unknown as Seed);
    const panel = await abrirCelda(page, "c-viaje", SEP);

    const fecha = filaDeComentario(panel, "Tiquetes en octubre").getByTestId("detail-date");
    await expect(fecha).toHaveText("18 sep");
    await expect(fecha).toHaveCSS("color", await cssVar(page, "--fg-muted"));
  });

  for (const vp of [NARROW, DESK]) {
    test(`TC-FDC-025e: un comentario largo se parte en varias líneas con la fecha arriba (${vp.width} px)`, async ({ page }) => {
      // @aitri-tc TC-FDC-025e
      const largo = "Compartido con Ana y con Juan; pedir la factura a nombre de la empresa y guardar el recibo en la carpeta de septiembre, que es la que revisa contabilidad cada mes.".slice(0, 200);
      await abrir(page, restaurantes([], [nota("c18", 1, largo, "2026-09-18")]), vp);
      const panel = await abrirCelda(page, "c-rest", SEP);

      const fila = filaDeComentario(panel, "Compartido con Ana");
      const texto = fila.getByTestId("cell-note");
      const fecha = fila.getByTestId("detail-date");
      const lineHeight = parseFloat(await texto.evaluate((el) => getComputedStyle(el).lineHeight));
      const bt = (await texto.boundingBox())!;
      const bf = (await fecha.boundingBox())!;
      expect(bt.height, `alto ${bt.height} con line-height ${lineHeight}`).toBeGreaterThan(2 * lineHeight - 1);
      await expect(fecha).toHaveText("18 sep");
      expect(Math.abs(bf.y - bt.y), `top fecha ${bf.y} · top texto ${bt.y}`).toBeLessThanOrEqual(1);
      expect(bf.x).toBeLessThan(bt.x);
    });
  }

  test("TC-FDC-026e: a 375 px no hay Detalle — la feature no cambia la vista móvil", async ({ page }) => {
    // @aitri-tc TC-FDC-026e
    await abrir(page, restaurantes([gasto("m18", SEP, "2026-09-18", 20_000, 1)], [nota("c18", 1, "Pedir factura", "2026-09-18")]), MOBILE);

    await expect(page.getByTestId("mobile-shell")).toBeVisible();
    await expect(page.getByTestId("detail-row")).toHaveCount(0);
    await expect(page.getByTestId("detail-date")).toHaveCount(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`TC-FDC-027h: la fecha del comentario pasa contraste ≥4,5:1 en tema ${scheme}`, async ({ page }) => {
      // @aitri-tc TC-FDC-027h
      await page.emulateMedia({ colorScheme: scheme });
      await abrir(page, restaurantes([], [nota("c18", 1, "Pedir factura", "2026-09-18")]));
      const panel = await abrirCelda(page, "c-rest", SEP);

      const fila = filaDeComentario(panel, "Pedir factura");
      const fecha = fila.getByTestId("detail-date");
      await expect(fecha).toHaveText("18 sep");
      const color = await fecha.evaluate((el) => getComputedStyle(el).color);
      const fondo = await fondoEfectivo(fila);
      expect(contrast(color, fondo), `fecha ${color} sobre ${fondo}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("TC-FDC-028e: estado de carga — el comentario aparece con su día antes de que responda el servidor", async ({ page }) => {
    // @aitri-tc TC-FDC-028e
    await abrir(page, restaurantes([gasto("m18", SEP, "2026-09-18", 20_000, 1)]));
    const panel = await abrirCelda(page, "c-rest", SEP);
    await page.route("**/api/v1/ledger", async (route) => {
      if (route.request().method() === "PUT") await new Promise((r) => setTimeout(r, 2_000));
      await route.continue();
    });

    await comentar(panel, "Pagar en efectivo");
    // Actualización optimista vigente: la fila ya está, con su día, mientras el PUT sigue en vuelo.
    await expect(filaDeComentario(panel, "Pagar en efectivo").getByTestId("detail-date")).toHaveText("21 sep", { timeout: 500 });
    await expect(panel.getByRole("progressbar")).toHaveCount(0);
  });

  test("TC-FDC-029f: estado de error — un 422 aplica el manejo vigente y no borra lo que hay en pantalla", async ({ page }) => {
    // @aitri-tc TC-FDC-029f
    await abrir(page, restaurantes([gasto("m18", SEP, "2026-09-18", 20_000, 1)]));
    const panel = await abrirCelda(page, "c-rest", SEP);
    await page.route("**/api/v1/ledger", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      await route.fulfill({
        status: 422, contentType: "application/json",
        body: JSON.stringify({ error: { code: "invalid_payload", message: "Cuerpo inválido" } }),
      });
    });

    await comentar(panel, "Pagar en efectivo");

    const aviso = page.getByTestId("storage-banner");
    await expect(aviso).toBeVisible();
    await expect(aviso).toHaveAttribute("role", "alert");
    await expect(aviso).toContainText("No pudimos guardar el último cambio en el servidor");
    await expect(aviso).toHaveCSS("color", await cssVar(page, "--error"));
    // El manejo vigente no descarta lo que hay en pantalla: el comentario sigue, con su día.
    await expect(filaDeComentario(panel, "Pagar en efectivo").getByTestId("detail-date")).toHaveText("21 sep");
  });

  test("TC-FDC-030e: estado vacío sin cambios — «Sin movimientos ni comentarios»", async ({ page }) => {
    // @aitri-tc TC-FDC-030e
    await abrir(page, restaurantes([]));
    const panel = await abrirCelda(page, "c-rest", SEP);

    await expect(panel.getByText("Sin movimientos ni comentarios")).toBeVisible();
    await expect(panel.getByTestId("detail-date")).toHaveCount(0);
  });
});

// ── FR-2603 · orden ──────────────────────────────────────────────────────────────────────────────

test.describe("FR-2603 — el comentario de hoy entra en su lugar cronológico", () => {
  test("TC-FDC-047h: flujo F1 completo — el comentario de hoy aparece entre los movimientos del 18 y del 25", async ({ page }) => {
    // @aitri-tc TC-FDC-047h
    await abrir(page, restaurantes([
      gasto("m25", SEP, "2026-09-25", 30_000, 2, "Cena"),
      gasto("m18", SEP, "2026-09-18", 20_000, 1, "Almuerzo"),
    ]));
    const panel = await abrirCelda(page, "c-rest", SEP);
    await comentar(panel, "Pagar en efectivo");

    await expect(panel.getByTestId("detail-row").getByTestId("detail-date")).toHaveText(["18 sep", "21 sep", "25 sep"]);
    const kinds = await panel.getByTestId("detail-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    expect(kinds).toEqual(["movement", "comment", "movement"]);
    const campo = panel.getByLabel("Añadir comentario", { exact: true });
    await expect(campo).toHaveValue("");
    await expect(campo).toBeFocused();
  });
});

// ── NFR-2602 · el comentario no suma ─────────────────────────────────────────────────────────────

test.describe("NFR-2602 — comentar no cambia ninguna cifra", () => {
  test("TC-FDC-071e: en la grilla la celda sigue en 100.000 tras comentar y recargar", async ({ page }) => {
    // @aitri-tc TC-FDC-071e
    await abrir(page, restaurantes([gasto("m18", SEP, "2026-09-18", 100_000, 1)]));
    // Los totales del grupo son sus celdas `cell-parent` (las de hoja llevan el contador de comentarios).
    const grupo = page.locator('[data-testid="node-row"][data-level="group"]')
      .filter({ has: page.getByTestId("row-label").filter({ hasText: "Estilo de vida" }) }).first()
      .locator('[data-testid="cell-parent"]');
    const totalAntes = await grupo.allTextContents();
    expect(totalAntes.join("|")).toContain("100.000");
    await expect(celda(page, "c-rest", SEP)).toContainText("100.000");

    const panel = await abrirCelda(page, "c-rest", SEP);
    await comentar(panel, "Pagar en efectivo");
    await expect(filaDeComentario(panel, "Pagar en efectivo")).toHaveCount(1);
    await cerrarEditor(page);
    await expect.poll(async () => (await readLedger(page))?.cellNotes?.["c-rest"]?.[SEP]?.length ?? 0).toBe(1);
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();

    await expect(celda(page, "c-rest", SEP)).toContainText("100.000");
    await expect(grupo).toHaveText(totalAntes);
  });
});

// ── NFR-2603 · mes cerrado ───────────────────────────────────────────────────────────────────────

test.describe("NFR-2603 — en un mes cerrado se comenta, con el día de hoy", () => {
  test("TC-FDC-080h: en «Agosto» cerrado el comentario se guarda y muestra «21 sep»", async ({ page }) => {
    // @aitri-tc TC-FDC-080h
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-rest": { [AGO]: 7_000 } },
      movements: [gasto("m-ago", AGO, "2026-08-05", 7_000, 1, "Pan")],
    } as unknown as Seed);
    expect(await closeViaApi(page)).toBe(200);
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();

    let panel = await abrirCelda(page, "c-rest", AGO);
    const campo = panel.getByLabel("Añadir comentario", { exact: true });
    await expect(campo).toBeVisible();
    await campo.fill("Revisado");
    await campo.press("Enter");
    await expect(filaDeComentario(panel, "Revisado").getByTestId("detail-date")).toHaveText("21 sep");
    await cerrarEditor(page);

    await expect.poll(async () => (await readLedger(page))?.cellNotes?.["c-rest"]?.[AGO]?.[0]?.date).toBe("2026-09-21");
    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    panel = await abrirCelda(page, "c-rest", AGO);
    await expect(filaDeComentario(panel, "Revisado").getByTestId("detail-date")).toHaveText("21 sep");
  });
});
