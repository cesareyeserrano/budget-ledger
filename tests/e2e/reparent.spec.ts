import { test, expect, type Page, type Locator } from "./helpers/fixtures";
import { readTree, nodeNamed } from "./helpers/seed";

// FR-015 — reparent por arrastrar-y-soltar. dnd-kit usa PointerSensor (distancia de activación),
// por eso el arrastre se simula con pasos de mouse (mousedown → move >6px → move a destino → mouseup).
//
// BL-063: estas pruebas afirmaban que «Café» seguía visible tras soltar, que ya era cierto antes de
// arrastrar; un arrastre que no hiciera nada las pasaba. Ahora leen de quién es hija en el árbol que
// guarda el servidor, y en el caso rechazado comprueban que el arrastre llegó a empezar.

const nodeRow = (page: Page, name: string) =>
  page.getByTestId("budget-grid").locator('[data-testid="node-row"]').filter({ hasText: name }).first();

/** Firma nivel:nombre de cada fila visible, en orden. */
async function hierarchy(page: Page): Promise<string[]> {
  return page.getByTestId("budget-grid").locator('[data-testid="node-row"]').evaluateAll((els) =>
    els.map((e) => `${e.getAttribute("data-level")}:${e.querySelector('[data-testid="row-label"]')?.textContent?.trim() ?? ""}`)
  );
}

/** `enVuelo` corre con el botón aún abajo, para comprobar que el arrastre de verdad empezó. */
async function drag(page: Page, from: Locator, to: Locator, enVuelo?: () => Promise<void>) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("no bounding box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  if (enVuelo) await enVuelo();
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const grid = page.getByTestId("budget-grid");
  await expect(grid).toBeVisible();
  // las categorías inician colapsadas: expandir 'Comida' para que su subcategoría 'Café' sea visible
  await grid.getByText("Comida", { exact: true }).first().click();
  await expect(grid.getByText("Café", { exact: true }).first()).toBeVisible();
});

test("TC-015h: arrastrar una subcategoría sobre otra categoría la reubica", async ({ page }) => {
  const grid = page.getByTestId("budget-grid");
  // Punto de partida, leído del servidor: 'Café' es hija de 'Comida' y 'Vivienda' es una hoja.
  const antes = await readTree(page);
  const cafe = nodeNamed(antes.nodes, "Café");
  const vivienda = nodeNamed(antes.nodes, "Vivienda");
  expect(cafe.parentId).toBe(nodeNamed(antes.nodes, "Comida").id);
  await expect(nodeRow(page, "Vivienda")).toHaveAttribute("data-leaf", "true");
  const deCafe = antes.movements.filter((m) => m.target === cafe.id).length;
  const deVivienda = antes.movements.filter((m) => m.target === vivienda.id).length;
  expect(deCafe).toBeGreaterThan(0);
  expect(deVivienda).toBeGreaterThan(0);

  // 'Café' se arrastra sobre 'Vivienda' (categoría del mismo tipo Gasto)
  await drag(page, grid.getByText("Café", { exact: true }).first(), grid.getByText("Vivienda", { exact: true }).first());

  // El servidor la guarda como subcategoría de 'Vivienda'.
  await expect
    .poll(async () => nodeNamed((await readTree(page)).nodes, "Café").parentId, { timeout: 15000 })
    .toBe(vivienda.id);
  const despues = await readTree(page);
  expect(nodeNamed(despues.nodes, "Café").level).toBe("sub");
  expect(nodeNamed(despues.nodes, "Café").type).toBe("expense");

  // …con sus movimientos y sin huérfanos: ninguno se pierde, todos apuntan a un nodo que existe, y
  // los de 'Vivienda' —que deja de ser hoja— pasan a su primera hoja, que es 'Café'.
  const ids = new Set(despues.nodes.map((n) => n.id));
  expect(despues.movements.length).toBe(antes.movements.length);
  expect(despues.movements.every((m) => ids.has(m.target))).toBe(true);
  const ahoraDeCafe = despues.movements.filter((m) => m.target === cafe.id);
  expect(ahoraDeCafe.length).toBe(deCafe + deVivienda);
  expect(ahoraDeCafe.every((m) => m.catId === vivienda.id && m.subId === cafe.id)).toBe(true);

  // En pantalla: 'Vivienda' ya tiene hija y 'Café' cuelga justo debajo de ella.
  // Al reparentar, el store re-monta la grilla y las categorías vuelven a colapsarse: se reintenta
  // expandir 'Vivienda' hasta ver 'Café' (solo hace clic cuando 'Café' está oculta, sin oscilar).
  await expect(nodeRow(page, "Vivienda")).toHaveAttribute("data-leaf", "false");
  await expect(async () => {
    if ((await grid.getByText("Café", { exact: true }).count()) === 0) {
      await grid.getByText("Vivienda", { exact: true }).first().click();
    }
    await expect(grid.getByText("Café", { exact: true }).first()).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });
  const filas = await hierarchy(page);
  expect(filas[filas.indexOf("category:Vivienda") + 1]).toBe("sub:Café");
});

test("TC-015f: el destino de otro tipo no reubica (jerarquía intacta)", async ({ page }) => {
  const grid = page.getByTestId("budget-grid");
  const firma = (nodes: { id: string; type: string; level: string; parentId: string | null }[]) =>
    nodes.map((n) => `${n.id}:${n.type}:${n.level}:${n.parentId ?? "raíz"}`).sort();
  const antes = await readTree(page);
  const filasAntes = await hierarchy(page);
  expect(filasAntes).toContain("sub:Café");
  // El arrastre tiene que EMPEZAR: sin esto, un arrastre que no hace nada pasaría por «rechazado».
  const arrastrando = async () => expect(nodeRow(page, "Café")).toHaveCSS("opacity", "0.4");

  // 1) Sobre una categoría de otro tipo: 'Salario' es Ingreso.
  await drag(page, grid.getByText("Café", { exact: true }).first(), grid.getByText("Salario", { exact: true }).first(), arrastrando);
  await expect(nodeRow(page, "Café")).toHaveCSS("opacity", "1");
  expect(await hierarchy(page)).toEqual(filasAntes);
  await expect(nodeRow(page, "Salario")).toHaveAttribute("data-leaf", "true");

  // 2) Sobre la fila del tipo INGRESOS: tampoco se promueve a grupo de otro tipo.
  const ingresos = page.locator('[data-testid="type-total-row"][data-type="income"]');
  await drag(page, grid.getByText("Café", { exact: true }).first(), ingresos, arrastrando);
  await expect(nodeRow(page, "Café")).toHaveCSS("opacity", "1");
  expect(await hierarchy(page)).toEqual(filasAntes);

  // Y el servidor guarda el mismo árbol: ningún nodo cambió de tipo, de nivel ni de padre.
  expect(firma((await readTree(page)).nodes)).toEqual(firma(antes.nodes));
});
