import { test, expect, type Page } from "./helpers/fixtures";
import { readLedger, seedLedger } from "./helpers/seed";
import type { LedgerNode, Movement } from "@/domain/types";

// Feature saldo-de-bolsillo — lo que solo el NAVEGADOR puede afirmar: que la celda de un bolsillo pinte lo
// AHORRADO, que escribir encima anote el retiro visible, que la fila de retiros planeados sea una suma de
// solo lectura, y que las filas de grupo y «RESERVAS» sumen saldos. Prefijo TC-SDB-*.
//
// La aritmética vive en tests/domain/saldo-de-bolsillo.test.ts; aquí, que la pantalla la muestre. Las
// celdas se localizan por atributos (hoja × mes × plano), no por índice: el rango depende del día.

const DESK = { width: 1440, height: 1100 };
const MOBILE = { width: 375, height: 800 };
const JUL = "2026-07";
const AGO = "2026-08";
const SEP = "2026-09";
const MAR = "2026-03";

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

async function abrir(page: Page, seed: Seed, viewport = DESK): Promise<void> {
  await page.setViewportSize(viewport);
  await seedLedger(page, seed);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await desplegarReservas(page);
}

test.describe("FR-3001 · la celda muestra lo ahorrado", () => {
  test("TC-SDB-005e: la grilla pinta la fila de saldos", async ({ page }) => {
    // @aitri-tc TC-SDB-005e
    await abrir(page, TRES_MESES);
    await expect(celda(page, "A", JUL, "actual")).toHaveText("600.000");
    await expect(celda(page, "A", AGO, "actual")).toHaveText("1.000.000");
    await expect(celda(page, "A", SEP, "actual")).toHaveText("700.000");
  });

  test("TC-SDB-003e: un bolsillo sin plata y uno vaciado muestran «—»", async ({ page }) => {
    // @aitri-tc TC-SDB-003e
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-salario": { [JUL]: 1000 }, A: { [JUL]: 500 } },
      movements: [retiro("A", AGO, 500)],
    });
    for (const m of [JUL, AGO, SEP]) await expect(celda(page, "B", m, "actual")).toHaveText("—");
    await expect(celda(page, "A", JUL, "actual")).toHaveText("500");
    await expect(celda(page, "A", AGO, "actual")).toHaveText("—");
    await expect(celda(page, "A", SEP, "actual")).toHaveText("—");
  });

  test("TC-SDB-004f: la celda y el botón del registro dicen la misma cifra", async ({ page }) => {
    // @aitri-tc TC-SDB-004f
    await abrir(page, TRES_MESES);
    await expect(celda(page, "A", SEP, "actual")).toHaveText("700.000");
    await page.getByRole("button", { name: /Nuevo movimiento/ }).click();
    await page.getByTestId("type-transfer").click();
    // El registro propone hoy; desde septiembre 2026 el saldo de Viaje es 700.000 y ya no cambia.
    await expect(page.getByTestId("de-A")).toContainText("$700.000");
  });
});

test.describe("FR-3002 · escribir en la celda anota la diferencia", () => {
  test("TC-SDB-016h: escribir 800.000 en la grilla anota el retiro", async ({ page }) => {
    // @aitri-tc TC-SDB-016h
    await abrir(page, { nodes: NODES, actuals: { "c-salario": { [SEP]: 1_200_000 }, A: { [SEP]: 1_000_000 } } });
    await celda(page, "A", SEP, "actual").click();
    const input = page.getByLabel("Editar valor");
    await expect(input).toHaveValue("1000000");
    await input.fill("800000");
    await page.keyboard.press("Enter");
    await expect(celda(page, "A", SEP, "actual")).toHaveText("800.000");
    await expect(page.locator(`[data-testid="withdraw-cell"][data-month="${SEP}"]`)).toContainText("200.000");
    await expect.poll(async () => (await readLedger(page))?.movements.filter((m) => m.note === "Ajuste desde la celda").map((m) => [m.from, m.to, m.amount]))
      .toEqual([["A", "@disponible", 200_000]]);
    await page.reload();
    await desplegarReservas(page);
    await expect(celda(page, "A", SEP, "actual")).toHaveText("800.000");
  });
});

test.describe("FR-3005 · la fila de retiros planeados es una suma", () => {
  const PLAN: Seed = {
    nodes: NODES,
    budgets: { "c-salario": { [MAR]: 1000 }, A: { [MAR]: 300 }, B: { [MAR]: 200 }, "@retiros:A": { [MAR]: 100 }, "@retiros:B": { [MAR]: 50 } },
    actuals: {},
  };
  const planeados = (page: Page) => page.locator(`[data-testid="planned-withdraw-cell"][data-month="${MAR}"]`);

  test("TC-SDB-040h: la fila «Retiros del mes · Pres.» suma los retiros planeados", async ({ page }) => {
    // @aitri-tc TC-SDB-040h
    await abrir(page, PLAN);
    await expect(planeados(page)).toHaveText("150");
    await expect(celda(page, "A", MAR, "budget")).toHaveText("200");
  });

  test("TC-SDB-041f: un clic en esa fila no abre editor", async ({ page }) => {
    // @aitri-tc TC-SDB-041f
    await abrir(page, PLAN);
    await planeados(page).click();
    await expect(page.getByLabel("Retiro planeado")).toHaveCount(0);
    await expect(planeados(page)).toHaveCSS("cursor", "default");
    await expect(planeados(page)).toHaveAttribute("title", "Suma de lo que planeas sacar de cada alcancía este mes");
  });

  test("TC-SDB-042e: la fila Ejec. de retiros sigue siendo corregible", async ({ page }) => {
    // @aitri-tc TC-SDB-042e
    await abrir(page, { nodes: NODES, actuals: { "c-salario": { [MAR]: 1000 }, A: { [MAR]: 500 } }, movements: [retiro("A", MAR, 200, "r-edit")] });
    await expect(celda(page, "A", MAR, "actual")).toHaveText("300");
    await page.locator(`[data-testid="withdraw-cell"][data-month="${MAR}"]`).click();
    const monto = page.getByTestId("op-amount-r-edit");
    await monto.fill("150");
    await monto.press("Enter");
    await expect(celda(page, "A", MAR, "actual")).toHaveText("350");
  });

  test("TC-SDB-044e: a 375 px la grilla no existe", async ({ page }) => {
    // @aitri-tc TC-SDB-044e
    await page.setViewportSize(MOBILE);
    await seedLedger(page, TRES_MESES);
    await page.goto("/");
    await expect(page.getByTestId("save-button")).toBeVisible();
    await expect(page.locator('[data-testid="cell-leaf"]:visible')).toHaveCount(0);
  });
});

test.describe("FR-3007 · las filas de grupo y tipo suman saldos", () => {
  const GRUPO: Seed = {
    nodes: NODES,
    actuals: { "c-salario": { [AGO]: 2000 }, A: { [AGO]: 700 }, B: { [AGO]: 500 } },
    budgets: { "c-salario": { [AGO]: 2000 }, A: { [AGO]: 400 } },
    movements: [retiro("A", SEP, 100)],
  };
  const grupo = (page: Page, mes: string, plano: "budget" | "actual") =>
    filaDe(page, "Ahorro").first().locator(`[data-testid="cell-parent"][data-month="${mes}"][data-plane="${plano}"]`);

  test("TC-SDB-060h: la fila del grupo suma los saldos", async ({ page }) => {
    // @aitri-tc TC-SDB-060h
    await abrir(page, GRUPO);
    await expect(grupo(page, AGO, "actual")).toHaveText("1.200");
    await expect(grupo(page, SEP, "actual")).toHaveText("1.100");
  });

  test("TC-SDB-061h: «RESERVAS» coincide con «Saldo reservado»", async ({ page }) => {
    // @aitri-tc TC-SDB-061h
    await abrir(page, GRUPO);
    const meses = await page.locator("[data-month-head]").evaluateAll((els) => els.map((e) => e.getAttribute("data-month-head")!));
    const tipo = page.locator('[data-testid="type-total-row"][data-type="transfer"]').getByTestId("cell-parent");
    for (const [i, m] of meses.entries()) {
      for (const plano of [0, 1] as const) {
        const saldo = page.locator(`[data-testid="balance-row"][data-row="reservedBalance"] [data-month="${m}"] [data-testid="balance-cell"]`).nth(plano);
        const texto = ((await saldo.textContent()) ?? "").trim();
        await expect(tipo.nth(i * 2 + plano), `${m}/${plano}`).toHaveText(texto === "0" ? "—" : texto);
      }
    }
  });

  test("TC-SDB-062f: un grupo con bolsillos en 0 dice «—»", async ({ page }) => {
    // @aitri-tc TC-SDB-062f
    await abrir(page, { nodes: NODES, actuals: { "c-salario": { [JUL]: 1000 }, A: { [JUL]: 300 } }, movements: [retiro("A", AGO, 300)] });
    await expect(grupo(page, JUL, "actual")).toHaveText("300");
    await expect(grupo(page, AGO, "actual")).toHaveText("—");
  });
});

test.describe("NFR-3004 · un mes cerrado no se escribe", () => {
  test("TC-SDB-133e: la celda de un bolsillo de un mes cerrado no tiene campo de importe", async ({ page }) => {
    // @aitri-tc TC-SDB-133e
    await abrir(page, TRES_MESES);
    // Cierra julio, el primer mes terminado sin cerrar, por la ruta real (como cierre-de-mes.spec.ts).
    const { revision } = (await (await page.request.get("/api/v1/ledger")).json()) as { revision: number };
    expect((await page.request.post("/api/v1/closure", { data: { baseRevision: revision } })).status()).toBe(200);
    await page.reload();
    await desplegarReservas(page);
    await celda(page, "A", JUL, "actual").click();
    await expect(page.getByLabel("Editar valor")).toHaveCount(0);
  });
});
