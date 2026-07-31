import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger, readLedger } from "./helpers/seed";
import type { LedgerNode } from "@/domain/types";

// Feature transferencias · modelo v4 — el registro móvil opera De→A (FR-1005), la captura de
// gasto/ingreso no pasa por las reglas (NFR-1002) y los táctiles ≥48px (NFR-1006).

const MOBILE = { width: 375, height: 900 };

type CellMap = Record<string, Record<string, number>>;

const NODES = [
  { id: "g-ingresos", type: "income", level: "group", parentId: null, name: "Trabajo", order: 0 },
  { id: "c-salario", type: "income", level: "category", parentId: "g-ingresos", name: "Salario", order: 1 },
  { id: "g-gastos", type: "expense", level: "group", parentId: null, name: "Esenciales", order: 2 },
  { id: "c-mercado", type: "expense", level: "category", parentId: "g-gastos", name: "Mercado", order: 3 },
  { id: "g-ahorro", type: "transfer", level: "group", parentId: null, name: "Ahorro", order: 4 },
  { id: "c-viaje", type: "transfer", level: "category", parentId: "g-ahorro", name: "Viaje", order: 5 },
  { id: "c-fondo", type: "transfer", level: "category", parentId: "g-ahorro", name: "Fondo", order: 6 },
];

const NODES_SIN_ALCANCIAS = NODES.filter((n) => n.type !== "transfer");

/** Aportes del mes (modelo v4): Viaje 150k y Fondo 200k en ene; margen restante 150k. */
const BASE = {
  budgets: {} as CellMap,
  actuals: { "c-salario": { ene: 500_000 }, "c-viaje": { ene: 150_000 }, "c-fondo": { ene: 200_000 } } as CellMap,
};

async function gotoRegister(page: Page, nodes = NODES, data = BASE) {
  await seedLedger(page, {
    nodes: nodes.map((n) => ({ ...n, ownerId: "local", icon: null })) as unknown as LedgerNode[],
    budgets: data.budgets,
    actuals: data.actuals,
  });
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
}

async function persisted(page: Page): Promise<{ actuals: CellMap; movements: { from?: string; to?: string; note?: string | null; month: string; target: string; amount: number }[] }> {
  return (await readLedger(page)) as never;
}

test.describe("FR-1005 — el registro opera Reservas con De→A", () => {
  test("TC-TRF4-005h: el registro Reserva muestra saldos en De y el máximo/margen antes de operar", async ({ page }) => {
    // @aitri-tc TC-TRF4-005h
    await gotoRegister(page);
    await page.getByTestId("type-transfer").click();

    const deViaje = page.getByTestId("de-c-viaje");
    await expect(deViaje).toContainText("Viaje");
    await expect(deViaje).toContainText("$150.000"); // saldo derivado visible
    await expect(page.getByTestId("de-c-fondo")).toContainText("$200.000");

    await deViaje.click();
    const guide = page.getByTestId("reserve-guide");
    await expect(guide).toContainText("Máx.");
    await expect(guide).toContainText("$150.000");

    await page.getByTestId("de-@disponible").click();
    await expect(guide).toContainText("Margen del mes");
    await expect(guide).toContainText("$150.000"); // 500k − 150k − 200k ya aportados
  });

  test("TC-TRF4-005e: estado vacío sin alcancías, y el toggle dice 'Reserva'", async ({ page }) => {
    // @aitri-tc TC-TRF4-005e
    await gotoRegister(page, NODES_SIN_ALCANCIAS, { budgets: {}, actuals: { "c-salario": { ene: 500_000 } } });
    await page.getByTestId("type-transfer").click();

    const empty = page.getByTestId("reserve-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("No tienes alcancías — créalas en el escritorio");
    await expect(page.getByTestId("reserve-de-row")).toHaveCount(0);
    await expect(page.getByTestId("reserve-a-row")).toHaveCount(0);
    await expect(page.getByTestId("save-button")).toBeDisabled();
    await expect(page.getByTestId("type-transfer")).toContainText("Reserva");
    await expect(page.locator("body")).not.toContainText("Transferencia");
  });

  test("TC-TRF4-005f: De=A es imposible por construcción", async ({ page }) => {
    // @aitri-tc TC-TRF4-005f
    await gotoRegister(page);
    await page.getByTestId("type-transfer").click();

    await page.getByTestId("de-c-viaje").click();
    await expect(page.getByTestId("a-c-viaje")).toHaveCount(0);
    await expect(page.getByTestId("a-c-fondo")).toHaveCount(1);

    await page.getByTestId("de-c-fondo").click();
    await expect(page.getByTestId("a-c-viaje")).toHaveCount(1);
    await expect(page.getByTestId("a-c-fondo")).toHaveCount(0);
  });

  test("TC-TRF4-105h: guardar la operación crea el movimiento from/to y muestra el overlay", async ({ page }) => {
    // @aitri-tc TC-TRF4-105h
    await gotoRegister(page);
    await page.getByTestId("type-transfer").click();

    await page.getByTestId("de-c-viaje").click();
    await page.getByTestId("a-@disponible").click();
    await page.getByTestId("amount-input").fill("50000");
    await page.getByTestId("note-input").fill("pasaje");
    await page.getByTestId("save-button").click();

    const overlay = page.getByTestId("confirm-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("$50.000");
    await expect(page.getByTestId("confirm-summary")).toHaveText("$50.000 · Viaje → Disponible");
    await expect(overlay).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByTestId("amount-input")).toHaveValue("");

    const stored = await persisted(page);
    expect(stored.movements).toHaveLength(1);
    const mv = stored.movements[0];
    expect(mv.from).toBe("c-viaje");
    expect(mv.to).toBe("@disponible");
    expect(mv.note).toBe("pasaje");
    expect(mv.target).toBe("c-viaje");
    // Modelo v4: SACAR no toca celdas — el aporte de ene sigue intacto; el saldo derivado bajó.
    expect(stored.actuals["c-viaje"]).toEqual({ ene: 150_000 });
  });
});

test.describe("NFR-1002 — gasto e ingreso no pasan por las reglas de reservas", () => {
  test("TC-TRF4-152e: la captura de gasto/ingreso del registro no pasa por las reglas", async ({ page }) => {
    // @aitri-tc TC-TRF4-152e
    await gotoRegister(page, NODES, { budgets: {}, actuals: { "c-viaje": { ene: 150_000 } } });

    await page.getByTestId("amount-input").fill("9999999");
    await page.getByTestId("category-c-mercado").click();
    await page.getByTestId("save-button").click();

    await expect(page.getByTestId("confirm-overlay")).toBeVisible();
    await expect(page.getByTestId("confirm-overlay")).toHaveCount(0, { timeout: 5000 });
    const stored = await persisted(page);
    expect(stored.movements).toHaveLength(1);
    expect(stored.movements[0].from).toBeUndefined();
    expect(Object.values(stored.actuals["c-mercado"])[0]).toBe(9_999_999);
    expect(stored.actuals["c-viaje"]).toEqual({ ene: 150_000 });
  });
});

test.describe("NFR-1006 — táctiles del registro", () => {
  test("TC-TRF4-156e: táctiles ≥48px en los controles nuevos del registro", async ({ page }) => {
    // @aitri-tc TC-TRF4-156e
    await gotoRegister(page);
    await page.getByTestId("type-transfer").click();

    for (const id of ["de-@disponible", "de-c-viaje", "de-c-fondo"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.height, id).toBeGreaterThanOrEqual(48);
    }
    await page.getByTestId("de-c-viaje").click();
    for (const id of ["a-@disponible", "a-c-fondo"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.height, id).toBeGreaterThanOrEqual(48);
    }
    const save = (await page.getByTestId("save-button").boundingBox())!;
    expect(save.height).toBeGreaterThanOrEqual(48);
  });
});
