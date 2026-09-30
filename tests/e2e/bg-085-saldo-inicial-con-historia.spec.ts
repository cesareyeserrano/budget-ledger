/**
 * BG-085 — en Configuración, el saldo inicial se puede cambiar aunque haya datos antes del inicio.
 *
 * Antes el guardado respondía «No puedes empezar en …: dejarías fuera 1 mes con datos» sin haber
 * movido el mes: la regla de huérfanos contaba la historia anterior al inicio (FR-1906).
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import { monthPrev } from "@/domain/periods";
import type { LedgerNode, PeriodKey } from "@/domain/types";

const DESK = { width: 1440, height: 900 };
const HOY = new Date();
const ACTUAL = `${HOY.getFullYear()}-${String(HOY.getMonth() + 1).padStart(2, "0")}` as PeriodKey;
const ANTERIOR = monthPrev(ACTUAL);

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sueldo", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Sueldo", icon: null, order: 1 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "c-comida", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Comida", icon: null, order: 3 },
];

async function leer(page: Page): Promise<{ revision: number; state: { startMonth?: string | null; openingBalance?: number | null } }> {
  return (await (await page.request.get("/api/v1/ledger")).json()) as never;
}

test("BG-085: con un gasto anterior al mes de inicio, cambiar el saldo inicial se guarda", async ({ page }) => {
  await page.setViewportSize(DESK);
  await seedLedger(page, { nodes: NODES });
  const declarado = await page.request.put("/api/v1/ledger/start", {
    data: { baseRevision: (await leer(page)).revision, startMonth: ACTUAL, openingBalance: 1_000 },
  });
  expect(declarado.ok(), await declarado.text()).toBe(true);
  // Un gasto en el mes ANTERIOR al inicio: historia (FR-1906).
  await seedLedger(page, { nodes: NODES, actuals: { "c-comida": { [ANTERIOR]: 100 } } });
  expect((await leer(page)).state).toMatchObject({ startMonth: ACTUAL, openingBalance: 1_000 });

  await page.goto("/configuracion");
  const saldo = page.getByTestId("config-opening");
  await expect(saldo).toBeEnabled();
  await saldo.fill("2000");
  await page.getByTestId("config-save").click();

  await expect(page.getByTestId("config-saved")).toBeVisible();
  await expect(page.getByTestId("config-blocked")).toHaveCount(0);
  expect((await leer(page)).state).toMatchObject({ startMonth: ACTUAL, openingBalance: 2_000 });
});
