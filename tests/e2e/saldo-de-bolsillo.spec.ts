import { test, expect, type Page, type Locator } from "./helpers/fixtures";
import { readLedger, seedLedger } from "./helpers/seed";
import type { LedgerNode, Movement } from "@/domain/types";

// Feature saldo-de-bolsillo — lo que solo el NAVEGADOR puede afirmar: que la fila «Retiros del mes · Pres.»
// abra el mismo formulario que la de Ejec., que planear y corregir desde él guarde el retiro en su alcancía
// con su nota, y que las celdas de los bolsillos y las filas de grupo sigan diciendo lo del MES (decisión del
// usuario del 2026-09-27: nada de la grilla arrastra). Prefijo TC-SDB-*.
//
// La aritmética vive en tests/domain/saldo-de-bolsillo.test.ts; aquí, que la pantalla la muestre. Las
// celdas se localizan por atributos (hoja × mes × plano), no por índice: el rango depende del día.

const DESK = { width: 1440, height: 1100 };
const TABLET = { width: 768, height: 900 };
const MOBILE = { width: 375, height: 800 };
const MAR = "2026-03";
const ABR = "2026-04";
const JUL = "2026-07";
const AGO = "2026-08";
const SEP = "2026-09";

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: null, order: 1 },
  { id: "A", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 0 },
  { id: "B", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Carro", icon: null, order: 1 },
];
type Seed = Parameters<typeof seedLedger>[1];

const retiro = (from: string, period: string, amount: number, id = `r-${from}-${period}`): Movement => ({
  id, ownerId: "local", type: "transfer", catId: from, subId: null, target: from, amount, period,
  createdAt: 1, date: `${period}-15T10:00`, from, to: "@disponible",
} as Movement);

/** Viaje con 300 planeados en marzo; salario 1.000 en el plan y en lo real. */
const VIAJE_300: Seed = { nodes: NODES, budgets: { "c-salario": { [MAR]: 1000 }, A: { [MAR]: 300 } }, actuals: { "c-salario": { [MAR]: 1000 } } };
const conPlan = (extra: Record<string, Record<string, number>>): Seed =>
  ({ ...VIAJE_300, budgets: { ...VIAJE_300.budgets, ...extra } });

/** Viaje: 600.000 en julio, 400.000 en agosto y un retiro de 300.000 en septiembre. */
const TRES_MESES: Seed = {
  nodes: NODES,
  actuals: { "c-salario": { [JUL]: 2_000_000, [AGO]: 2_000_000, [SEP]: 2_000_000 }, A: { [JUL]: 600_000, [AGO]: 400_000 } },
  movements: [retiro("A", SEP, 300_000)],
};

const filaDe = (page: Page, name: string) =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: name }) });

async function desplegarReservas(page: Page): Promise<void> {
  await expect(filaDe(page, "Ahorro").first()).toBeVisible();
  if (await filaDe(page, "Viaje").count()) return;
  await filaDe(page, "Ahorro").first().getByRole("button", { name: "Expandir" }).first().click();
  await expect(filaDe(page, "Viaje")).toBeVisible();
}
const celda = (page: Page, id: string, mes: string, plano: "budget" | "actual") =>
  page.locator(`[data-testid="cell-leaf"][data-cell="${id}"][data-month="${mes}"][data-plane="${plano}"]`);
const planeados = (page: Page, mes: string) => page.locator(`[data-testid="planned-withdraw-cell"][data-month="${mes}"]`);

async function abrir(page: Page, seed: Seed, viewport = DESK): Promise<void> {
  await page.setViewportSize(viewport);
  await seedLedger(page, seed);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await desplegarReservas(page);
}
async function abrirPlan(page: Page, mes = MAR): Promise<void> {
  await planeados(page, mes).click();
  await expect(page.getByTestId("withdraw-title")).toBeVisible();
}
/** El color que el navegador resuelve para un token, para comparar contra un color computado. */
const colorDe = (page: Page, token: string) => page.evaluate((t) => {
  const probe = document.createElement("span");
  probe.style.color = `var(${t})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}, token);
/** Ratio de contraste WCAG entre dos colores «rgb(r, g, b)». */
function contraste(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** El fondo efectivo de un elemento: el primer ancestro con fondo no transparente. */
const fondoDe = (loc: Locator) => loc.evaluate((el) => {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
  }
  return "rgb(255, 255, 255)";
});

// ── FR-3001 · el formulario Pres. ─────────────────────────────────────────────────────────────

test.describe("FR-3001 · la fila «Retiros del mes · Pres.» abre el formulario de Ejec.", () => {
  test("TC-SDB-001h: la celda Pres. abre el formulario de planear", async ({ page }) => {
    // @aitri-tc TC-SDB-001h
    await abrir(page, VIAJE_300);
    await abrirPlan(page);
    await expect(page.getByTestId("withdraw-title")).toHaveText("Planear sacar en marzo 2026 → Disponible");
    await expect(page.getByTestId("withdraw-source")).toBeVisible();
    await expect(page.getByTestId("withdraw-amount")).toBeVisible();
    await expect(page.getByTestId("withdraw-note")).toHaveAttribute("placeholder", "¿Para qué? (opcional)");
    await expect(page.getByTestId("withdraw-save")).toHaveText("Planear");
  });

  test("TC-SDB-002h: el desplegable lista cada alcancía con lo que el plan tendría ese mes", async ({ page }) => {
    // @aitri-tc TC-SDB-002h
    await abrir(page, conPlan({ B: { [MAR]: 200 }, "@retiros:B": { [MAR]: 50 } }));
    await abrirPlan(page);
    const opciones = page.getByTestId("withdraw-source").locator("option:not([disabled])");
    await expect(opciones).toHaveText(["Ahorro · Viaje — $300", "Ahorro · Carro — $150"]);
  });

  test("TC-SDB-003f: teclear por encima del Máx. lo pinta en rojo y deshabilita «Planear»", async ({ page }) => {
    // @aitri-tc TC-SDB-003f
    await page.emulateMedia({ colorScheme: "light" });
    await abrir(page, VIAJE_300);
    await abrirPlan(page);
    await page.getByTestId("withdraw-source").selectOption("A");
    await page.getByTestId("withdraw-amount").fill("301");
    const max = page.getByTestId("withdraw-max");
    await expect(max).toHaveText("Máx. $300");
    await expect(max).toHaveCSS("color", await colorDe(page, "--error"));
    await expect(max).toHaveCSS("color", "rgb(173, 57, 50)");
    await expect(page.getByTestId("withdraw-save")).toBeDisabled();
    await page.getByTestId("withdraw-amount").fill("300");
    await expect(max).toHaveCSS("color", await colorDe(page, "--fg-muted"));
    await expect(page.getByTestId("withdraw-save")).toBeEnabled();
  });

  test("TC-SDB-004f: sin alcancía o sin monto, «Planear» está deshabilitado", async ({ page }) => {
    // @aitri-tc TC-SDB-004f
    await abrir(page, VIAJE_300);
    await abrirPlan(page);
    await page.getByTestId("withdraw-amount").fill("100");
    await expect(page.getByTestId("withdraw-save")).toBeDisabled();
    await page.getByTestId("withdraw-amount").press("Enter");
    await page.getByTestId("withdraw-source").selectOption("A");
    await page.getByTestId("withdraw-amount").fill("");
    await expect(page.getByTestId("withdraw-save")).toBeDisabled();
    await page.getByTestId("withdraw-amount").press("Enter");
    expect((await readLedger(page))?.budgets["@retiros:A"]).toBeUndefined();
  });

  test("TC-SDB-005e: sin alcancías, el desplegable lo dice", async ({ page }) => {
    // @aitri-tc TC-SDB-005e
    await page.setViewportSize(DESK);
    await seedLedger(page, { nodes: NODES.filter((n) => n.type !== "transfer"), budgets: { "c-salario": { [MAR]: 1000 } }, actuals: {} });
    await page.goto("/");
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await abrirPlan(page);
    await expect(page.getByTestId("withdraw-source").locator("option")).toHaveText(["No tienes alcancías"]);
    await expect(page.getByTestId("withdraw-save")).toBeDisabled();
  });

  test("TC-SDB-007e: Escape y «Cancelar» cierran sin guardar", async ({ page }) => {
    // @aitri-tc TC-SDB-007e
    await abrir(page, VIAJE_300);
    for (const cerrar of ["Escape", "Cancelar"] as const) {
      await abrirPlan(page);
      await expect(page.getByTestId("withdraw-amount")).toHaveValue("");
      await page.getByTestId("withdraw-source").selectOption("A");
      await page.getByTestId("withdraw-amount").fill("100");
      if (cerrar === "Escape") await page.keyboard.press("Escape");
      else await page.getByRole("button", { name: "Cancelar" }).click();
      await expect(page.getByTestId("withdraw-title")).toHaveCount(0);
      await expect(planeados(page, MAR)).toHaveText("—");
    }
    expect((await readLedger(page))?.budgets["@retiros:A"]).toBeUndefined();
  });

  test("TC-SDB-008e: el formulario cabe a 768 y a 1440 px", async ({ page }) => {
    // @aitri-tc TC-SDB-008e
    for (const vp of [TABLET, DESK]) {
      await abrir(page, VIAJE_300, vp);
      await planeados(page, MAR).scrollIntoViewIfNeeded();
      await abrirPlan(page);
      const caja = (await page.getByTestId("withdraw-popover").boundingBox())!;
      expect(Math.abs(caja.width - 384), `${vp.width}`).toBeLessThanOrEqual(1);
      expect(caja.x, `${vp.width}`).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width, `${vp.width}`).toBeLessThanOrEqual(vp.width);
      await page.keyboard.press("Escape");
    }
  });

  test("TC-SDB-009e: el «Máx.» en reposo cumple contraste AA", async ({ page }) => {
    // @aitri-tc TC-SDB-009e
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await abrir(page, VIAJE_300);
      await abrirPlan(page);
      await page.getByTestId("withdraw-source").selectOption("A");
      await page.getByTestId("withdraw-amount").fill("100");
      const max = page.getByTestId("withdraw-max");
      const color = await max.evaluate((el) => getComputedStyle(el).color);
      const ratio = contraste(color, await fondoDe(max));
      expect(ratio, scheme).toBeGreaterThanOrEqual(4.5);
      await page.keyboard.press("Escape");
    }
  });
});

// ── FR-3002 · planear desde la grilla ─────────────────────────────────────────────────────────

test.describe("FR-3002 · planear guarda el retiro en su alcancía", () => {
  test("TC-SDB-019h: planear desde la grilla guarda el retiro y su nota", async ({ page }) => {
    // @aitri-tc TC-SDB-019h
    await abrir(page, VIAJE_300);
    await abrirPlan(page);
    await page.getByTestId("withdraw-source").selectOption("A");
    await page.getByTestId("withdraw-amount").fill("100");
    await page.getByTestId("withdraw-note").fill("pasajes");
    await page.getByTestId("withdraw-save").click();
    await expect(page.getByTestId("withdraw-title")).toHaveCount(0);
    await expect(planeados(page, MAR)).toHaveText("100");
    await expect.poll(async () => (await readLedger(page))?.budgets["@retiros:A"]?.[MAR]).toBe(100);
    const guardado = await readLedger(page);
    expect(guardado?.cellNotes?.["@retiros:A"]?.[MAR]?.[0]?.text).toBe("pasajes");
    await page.reload();
    await desplegarReservas(page);
    await expect(planeados(page, MAR)).toHaveText("100");
    await abrirPlan(page);
    await expect(page.getByTestId("op-plan-A")).toContainText("pasajes");
  });
});

// ── FR-3003 · corregir desde la lista ─────────────────────────────────────────────────────────

test.describe("FR-3003 · la lista del formulario corrige los retiros planeados", () => {
  const CON_100 = conPlan({ "@retiros:A": { [MAR]: 100 } });

  test("TC-SDB-036h: corregir y eliminar desde la lista de la grilla", async ({ page }) => {
    // @aitri-tc TC-SDB-036h
    await abrir(page, CON_100);
    await abrirPlan(page);
    const monto = page.getByTestId("op-plan-amount-A");
    await monto.fill("60");
    await monto.press("Enter");
    await expect(planeados(page, MAR)).toHaveText("60");
    await monto.fill("0");
    await monto.press("Enter");
    await expect(page.getByTestId("op-deleted-notice")).toHaveText("Operación eliminada");
    await expect(page.getByTestId("withdraw-history-empty")).toHaveText("Sin retiros planeados este mes");
    await expect(planeados(page, MAR)).toHaveText("—");
    await expect.poll(async () => (await readLedger(page))?.budgets["@retiros:A"]?.[MAR]).toBeUndefined();
  });

  test("TC-SDB-037f: subir por encima en la lista muestra el motivo y devuelve el campo", async ({ page }) => {
    // @aitri-tc TC-SDB-037f
    await abrir(page, CON_100);
    await abrirPlan(page);
    const monto = page.getByTestId("op-plan-amount-A");
    await monto.fill("301");
    await monto.press("Enter");
    await expect(page.getByTestId("op-error-plan-A")).toContainText("«Viaje» solo tiene $300");
    await expect(monto).toHaveValue("100");
    await expect(planeados(page, MAR)).toHaveText("100");
  });

  test("TC-SDB-038e: la lista une las notas con « · »", async ({ page }) => {
    // @aitri-tc TC-SDB-038e
    const nota = (id: string, text: string, createdAt: number) => ({ id, createdAt, text, date: `${MAR}-10` });
    await abrir(page, {
      ...conPlan({ A: { [MAR]: 500 }, "@retiros:A": { [MAR]: 150 } }),
      cellNotes: { "@retiros:A": { [MAR]: [nota("n1", "pasajes", 1), nota("n2", "hotel", 2)] } } as unknown as Seed["cellNotes"], // el helper tipa la nota como texto; viaja tal cual
    });
    await abrirPlan(page);
    await expect(page.getByTestId("op-plan-A")).toHaveCount(1);
    await expect(page.getByTestId("op-plan-A")).toContainText("pasajes · hotel");
    await expect(page.getByTestId("op-plan-amount-A")).toHaveValue("150");
  });

  test("TC-SDB-039e: Escape en la lista revierte sin guardar", async ({ page }) => {
    // @aitri-tc TC-SDB-039e
    await abrir(page, CON_100);
    await abrirPlan(page);
    const monto = page.getByTestId("op-plan-amount-A");
    await monto.fill("60");
    await monto.press("Escape");
    await expect(planeados(page, MAR)).toHaveText("100");
    // Escape también cierra el formulario (como en Ejec.); se reabre para ver el campo.
    if (!(await page.getByTestId("withdraw-title").isVisible())) await abrirPlan(page);
    await expect(page.getByTestId("op-plan-amount-A")).toHaveValue("100");
    expect((await readLedger(page))?.budgets["@retiros:A"]?.[MAR]).toBe(100);
  });
});

// ── FR-3004 · la celda suma ───────────────────────────────────────────────────────────────────

test.describe("FR-3004 · la celda Pres. de «Retiros del mes» suma", () => {
  test("TC-SDB-040h: la celda Pres. suma los retiros de las alcancías", async ({ page }) => {
    // @aitri-tc TC-SDB-040h
    await abrir(page, conPlan({ B: { [MAR]: 200 }, "@retiros:A": { [MAR]: 100 }, "@retiros:B": { [MAR]: 50 } }));
    await expect(planeados(page, MAR)).toHaveText("150");
    await expect(celda(page, "A", MAR, "budget")).toHaveText("300");
  });

  test("TC-SDB-041e: un mes sin retiros planeados dice «—»", async ({ page }) => {
    // @aitri-tc TC-SDB-041e
    await abrir(page, conPlan({ "@retiros:A": { [MAR]: 100 } }));
    await expect(planeados(page, ABR)).toHaveText("—");
  });

  test("TC-SDB-044e: 150 planeados y 160 retirados gradúa la celda Ejec. como leve", async ({ page }) => {
    // @aitri-tc TC-SDB-044e
    await abrir(page, {
      nodes: NODES,
      budgets: { "c-salario": { [MAR]: 1000 }, A: { [MAR]: 500 }, "@retiros:A": { [MAR]: 150 } },
      actuals: { "c-salario": { [MAR]: 1000 }, A: { [MAR]: 500 } },
      movements: [retiro("A", MAR, 160)],
    });
    const ejec = page.locator(`[data-testid="withdraw-cell"][data-month="${MAR}"]`);
    await expect(ejec).toHaveAttribute("data-over", "over_soft");
    await expect(ejec).toContainText("›");
    await expect(ejec).toContainText("160");
  });

  test("TC-SDB-045e: a 375 px la grilla no existe", async ({ page }) => {
    // @aitri-tc TC-SDB-045e
    await page.setViewportSize(MOBILE);
    await seedLedger(page, VIAJE_300);
    await page.goto("/");
    await expect(page.getByTestId("save-button")).toBeVisible();
    await expect(page.locator('[data-testid="cell-leaf"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-testid="planned-withdraw-cell"]:visible')).toHaveCount(0);
  });
});

// ── NFR-3002 · Ejec. sin cambios ──────────────────────────────────────────────────────────────

test.describe("NFR-3002 · el formulario Ejec. no cambia", () => {
  test("TC-SDB-114e: el formulario Ejec. conserva sus textos y su lista", async ({ page }) => {
    // @aitri-tc TC-SDB-114e
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-salario": { [MAR]: 1000 }, A: { [MAR]: 500 } },
      movements: [retiro("A", MAR, 200, "r-edit")],
    });
    await page.locator(`[data-testid="withdraw-cell"][data-month="${MAR}"]`).click();
    await expect(page.getByTestId("withdraw-title")).toHaveText("Sacar en marzo 2026 → Disponible");
    await expect(page.getByTestId("withdraw-save")).toHaveText("Sacar");
    await expect(page.getByTestId("withdraw-history")).toContainText("Operaciones de este mes");
    const monto = page.getByTestId("op-amount-r-edit");
    await monto.fill("150");
    await monto.press("Enter");
    // Sin nada planeado, lo real se gradúa como sobre-retiro (››) delante de la cifra, como siempre.
    await expect(page.locator(`[data-testid="withdraw-cell"][data-month="${MAR}"]`)).toHaveText("››150");
    await expect.poll(async () => (await readLedger(page))?.movements.find((m) => m.id === "r-edit")?.amount).toBe(150);
  });
});

// ── NFR-3004 · mes cerrado ────────────────────────────────────────────────────────────────────

test.describe("NFR-3004 · un mes cerrado no se escribe", () => {
  /** Cierra julio, el primer mes terminado sin cerrar, por la ruta real (como cierre-de-mes.spec.ts). */
  async function cerrarJulio(page: Page): Promise<void> {
    const { revision } = (await (await page.request.get("/api/v1/ledger")).json()) as { revision: number };
    expect((await page.request.post("/api/v1/closure", { data: { baseRevision: revision } })).status()).toBe(200);
    await page.reload();
    await desplegarReservas(page);
  }

  test("TC-SDB-133e: la celda de un bolsillo de un mes cerrado no tiene campo de importe", async ({ page }) => {
    // @aitri-tc TC-SDB-133e
    await abrir(page, TRES_MESES);
    await cerrarJulio(page);
    await celda(page, "A", JUL, "actual").click();
    await expect(page.getByLabel("Editar valor")).toHaveCount(0);
  });

  test("TC-SDB-134f: la celda Pres. de «Retiros del mes» de un mes cerrado no abre", async ({ page }) => {
    // @aitri-tc TC-SDB-134f
    await abrir(page, TRES_MESES);
    await cerrarJulio(page);
    const jul = planeados(page, JUL);
    await expect(jul).toHaveAttribute("title", "Mes cerrado");
    await jul.click();
    await expect(page.getByTestId("withdraw-source")).toHaveCount(0);
  });
});

// ── NFR-3005 · la celda sigue siendo el aporte ────────────────────────────────────────────────

test.describe("NFR-3005 · nada de la grilla arrastra", () => {
  /** La columna de un mes en la fila «RESERVAS» (Pres., Ejec.): la fila no lleva atributos por mes. */
  async function reservasTipo(page: Page, mes: string, plano: 0 | 1): Promise<Locator> {
    const meses = await page.locator("[data-month-head]").evaluateAll((els) => els.map((e) => e.getAttribute("data-month-head")!));
    const i = meses.indexOf(mes);
    expect(i, `mes ${mes} visible`).toBeGreaterThanOrEqual(0);
    const fila = page.locator('[data-testid="type-total-row"][data-type="transfer"]');
    return fila.locator(":scope > div").nth(i + 1).locator("> div").nth(plano);
  }
  const grupo = (page: Page, mes: string, plano: "budget" | "actual") =>
    filaDe(page, "Ahorro").first().locator(`[data-testid="cell-parent"][data-month="${mes}"][data-plane="${plano}"]`);
  const CON_CARRO: Seed = { ...TRES_MESES, actuals: { ...TRES_MESES.actuals, B: { [AGO]: 200_000 } } };

  test("TC-SDB-141h: la celda del bolsillo dice 600, 400 y «—»", async ({ page }) => {
    // @aitri-tc TC-SDB-141h
    await abrir(page, TRES_MESES);
    await expect(celda(page, "A", JUL, "actual")).toHaveText("600.000");
    await expect(celda(page, "A", AGO, "actual")).toHaveText("400.000");
    await expect(celda(page, "A", SEP, "actual")).toHaveText("—");
  });

  test("TC-SDB-142e: escribir 500 en agosto corrige el aporte sin crear operaciones", async ({ page }) => {
    // @aitri-tc TC-SDB-142e
    await abrir(page, TRES_MESES);
    const antes = (await readLedger(page))!.movements.length;
    await celda(page, "A", AGO, "actual").click();
    const input = page.getByLabel("Editar valor");
    await expect(input).toHaveValue("400000");
    await input.fill("500000");
    await input.press("Enter");
    await expect(celda(page, "A", AGO, "actual")).toHaveText("500.000");
    await expect(celda(page, "A", SEP, "actual")).toHaveText("—");
    await expect.poll(async () => (await readLedger(page))?.actuals.A?.[AGO]).toBe(500_000);
    expect((await readLedger(page))!.movements.length).toBe(antes);
  });

  test("TC-SDB-143f: la fila del grupo no arrastra", async ({ page }) => {
    // @aitri-tc TC-SDB-143f
    await abrir(page, CON_CARRO);
    await expect(grupo(page, AGO, "actual")).toHaveText("600.000");
    await expect(grupo(page, SEP, "actual")).toHaveText("—");
  });

  test("TC-SDB-144h: la celda Pres. del bolsillo no resta su retiro planeado", async ({ page }) => {
    // @aitri-tc TC-SDB-144h
    await abrir(page, conPlan({ "@retiros:A": { [MAR]: 100 } }));
    await expect(celda(page, "A", MAR, "budget")).toHaveText("300");
    await expect(celda(page, "A", ABR, "budget")).toHaveText("—");
  });

  test("TC-SDB-145e: la fila «RESERVAS» suma aportes del mes", async ({ page }) => {
    // @aitri-tc TC-SDB-145e
    await abrir(page, CON_CARRO);
    await expect(await reservasTipo(page, AGO, 1)).toHaveText("600.000");
    await expect(await reservasTipo(page, SEP, 1)).toHaveText("—");
  });
});
