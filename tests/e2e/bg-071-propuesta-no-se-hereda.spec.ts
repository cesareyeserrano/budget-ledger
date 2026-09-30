import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import { applyCycles, fixToday } from "./helpers/cycles";
import { estadoSyn } from "../fixtures/ciclos";
import type { LedgerState } from "@/domain/types";

// BG-071 — «Contar en el ciclo que abre» no se hereda al siguiente ingreso. La opción se reiniciaba
// con un efecto sobre la PROPUESTA, y tras guardar la propuesta no cambia si «hoy» sigue dentro de
// la ventana del pago adelantado: mismo tipo, misma fecha, mismo ciclo propuesto. El siguiente
// ingreso nacía contado en el ciclo que abre sin que nadie lo eligiera. Con «hoy» fijado en esa
// ventana se reproduce sin tocar el calendario del formulario.

const DESK = { width: 1440, height: 900 };
const HOY = "2026-11-20"; // un día antes del día de pago (21): la ventana de la propuesta

async function periodosGuardados(page: Page, amount: number): Promise<string[]> {
  const body = (await (await page.request.get("/api/v1/ledger")).json()) as { state: LedgerState };
  return body.state.movements.filter((m) => m.amount === amount).map((m) => m.period);
}

test.describe("BG-071 · la propuesta del ciclo que abre no queda marcada para el siguiente ingreso", () => {
  test("BG-071-a: tras guardar un ingreso contado en Diciembre, el siguiente vuelve a «Mantener»", async ({ page }) => {
    await fixToday(page, HOY);
    const st = estadoSyn({ budgets: { "c-salario": { "2026-09": 1 } } });
    await seedLedger(page, { nodes: st.nodes, budgets: st.budgets, actuals: st.actuals, movements: st.movements });
    await applyCycles(page, { mode: "cycle", anchorDay: 21 });
    await page.setViewportSize(DESK);
    await page.goto("/");
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await page.getByRole("button", { name: "Nuevo movimiento" }).click();
    await expect(page.getByTestId("date-field")).toBeVisible();

    // Primer ingreso: el usuario acepta contarlo en el ciclo que abre.
    await page.getByTestId("type-income").click();
    await page.getByTestId("amount-input").fill("8450000");
    await page.getByTestId("category-c-salario").click();
    await expect(page.getByTestId("opening-proposal")).toBeVisible();
    await page.getByTestId("proposal-accept").click();
    await expect(page.getByTestId("proposal-accept")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("save-button").click();
    await expect.poll(() => periodosGuardados(page, 8_450_000)).toEqual(["2026-12"]);

    // El formulario se limpia para el siguiente (tras el overlay de confirmación).
    await expect(page.getByTestId("confirm-overlay")).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId("amount-input")).toHaveValue("");

    // Segundo ingreso, misma ventana: la propuesta vuelve a ofrecerse, pero SIN elegir.
    await expect(page.getByTestId("opening-proposal")).toBeVisible();
    await expect(page.getByTestId("proposal-keep")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("proposal-accept")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("register-cycle")).toContainText("Noviembre");

    // Y guardado sin tocar nada, queda en el ciclo de su fecha.
    await page.getByTestId("amount-input").fill("45000");
    await page.getByTestId("category-c-salario").click();
    await page.getByTestId("save-button").click();
    await expect.poll(() => periodosGuardados(page, 45_000)).toEqual(["2026-11"]);
  });
});
