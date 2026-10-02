/**
 * BG-089 — los comentarios de Presupuestado y de Ejecutado son independientes.
 *
 * Reportado por el usuario el 2026-10-01: un comentario escrito en la celda de Ejecutado aparecía igual
 * en la de Presupuestado del mismo mes. Aquí se comprueba en la pantalla real, con recarga desde el
 * servidor: cada celda muestra los suyos, la marca se enciende donde se escribió, y un comentario
 * anterior a la distinción (sin plano) se queda en Ejecutado.
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { readLedger, seedLedger } from "./helpers/seed";
import { fixToday } from "./helpers/cycles";
import type { LedgerNode, Movement } from "@/domain/types";

test.use({ timezoneId: "America/Bogota" });

const HOY = "2026-09-21";
const SEP = "2026-09";

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-vida", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Estilo de vida", icon: null, order: 1 },
  { id: "c-rest", ownerId: "local", type: "expense", level: "category", parentId: "g-vida", name: "Restaurantes", icon: null, order: 0 },
];
const almuerzo: Movement = {
  id: "m1", ownerId: "local", type: "expense", catId: "c-rest", subId: null, target: "c-rest", amount: 50_000,
  period: SEP as Movement["period"], createdAt: 1, date: "2026-09-18T12:00", note: "Almuerzo",
};

async function abrir(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixToday(page, HOY);
  await seedLedger(page, {
    nodes: NODES,
    // El plan necesita un ingreso que lo cubra, o el servidor rechaza la siembra por déficit.
    budgets: { "c-salario": { [SEP]: 1_000_000 }, "c-rest": { [SEP]: 200_000 } },
    actuals: { "c-rest": { [SEP]: 50_000 } },
    movements: [almuerzo],
    // Un comentario de ANTES de la distinción: sin plano.
    cellNotes: { "c-rest": { [SEP]: [{ id: "n-viejo", createdAt: 2, text: "Escrito antes" }] } },
  } as unknown as Parameters<typeof seedLedger>[1]);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
}

const celda = (page: Page, plane: "budget" | "actual") =>
  page.locator(`[data-cell="c-rest"][data-month="${SEP}"][data-plane="${plane}"]`).first();

async function abrirCelda(page: Page, plane: "budget" | "actual") {
  await celda(page, plane).click();
  const panel = page.getByTestId("cell-notes");
  await expect(panel).toBeVisible();
  return panel;
}
async function cerrarEditor(page: Page): Promise<void> {
  const panel = page.getByTestId("cell-notes");
  for (let i = 0; i < 4 && (await panel.count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: 1_500 }).catch(() => {});
  }
  await expect(panel).toHaveCount(0);
}
async function comentar(panel: ReturnType<Page["locator"]>, texto: string): Promise<void> {
  const enlace = panel.getByTestId("comment-reveal");
  if (await enlace.count()) await enlace.click();
  const campo = panel.getByLabel("Añadir comentario", { exact: true });
  await campo.fill(texto);
  await campo.press("Enter");
}
const comentarios = (panel: ReturnType<Page["locator"]>) => panel.getByTestId("cell-note");

test.describe("BG-089 · comentarios independientes por celda", () => {
  test("BG-089-a: lo que ya estaba escrito se ve en Ejecutado y no en Presupuestado", async ({ page }) => {
    await abrir(page);
    await expect(celda(page, "actual").getByTestId("note-dot")).toHaveCount(1);
    await expect(celda(page, "budget").getByTestId("note-dot")).toHaveCount(0);

    const ejec = await abrirCelda(page, "actual");
    await expect(comentarios(ejec)).toHaveText(["Escrito antes"]);
    await expect(ejec.locator('[data-testid="detail-row"][data-kind="movement"]')).toHaveCount(1);
    await cerrarEditor(page);

    const pres = await abrirCelda(page, "budget");
    await expect(pres.getByTestId("cell-notes-empty")).toHaveText("Sin comentarios");
    await expect(pres.getByTestId("detail-row")).toHaveCount(0);   // ni el comentario ni el movimiento
    await expect(pres.getByTestId("comment-reveal")).toHaveCount(0); // ni la línea de añadir movimiento
    await expect(pres.getByLabel("Añadir comentario", { exact: true })).toBeVisible();
  });

  test("BG-089-b: un comentario escrito en cada celda queda en la suya, también tras recargar", async ({ page }) => {
    await abrir(page);
    const pres = await abrirCelda(page, "budget");
    await comentar(pres, "Subir el tope en octubre");
    await expect(comentarios(pres)).toHaveText(["Subir el tope en octubre"]);
    await cerrarEditor(page);

    const ejec = await abrirCelda(page, "actual");
    await comentar(ejec, "Cumpleaños de Ana");
    // El de hoy lleva día y va por su fecha; el anterior no tiene día y va al final (FR-2603).
    await expect(comentarios(ejec)).toHaveText(["Cumpleaños de Ana", "Escrito antes"]);
    await cerrarEditor(page);

    // En el servidor: el de Presupuestado lleva su plano; los de Ejecutado, ninguno.
    await expect.poll(async () => ((await readLedger(page))?.cellNotes?.["c-rest"]?.[SEP as Movement["period"]] ?? []).map((n) => [n.text, n.plane ?? null]))
      .toEqual([["Escrito antes", null], ["Subir el tope en octubre", "budget"], ["Cumpleaños de Ana", null]]);

    await page.reload();
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await expect(celda(page, "budget").getByTestId("note-dot")).toHaveCount(1);
    const pres2 = await abrirCelda(page, "budget");
    await expect(comentarios(pres2)).toHaveText(["Subir el tope en octubre"]);
    await cerrarEditor(page);
    const ejec2 = await abrirCelda(page, "actual");
    await expect(comentarios(ejec2)).toHaveText(["Cumpleaños de Ana", "Escrito antes"]);
  });
});
