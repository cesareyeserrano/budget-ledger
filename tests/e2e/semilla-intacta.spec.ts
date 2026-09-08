/**
 * Feature semilla-intacta — FR-2302 en el navegador, y NFR-2302 sobre el camino real.
 *
 * LA BRECHA QUE ESTE FICHERO CIERRA. `meses-y-saldo-inicial` dejó ocho casos verdes para la tarjeta
 * de arranque… que sembraban un ledger vacío a mano. El producto real nunca mostraba esa tarjeta,
 * porque la semilla dejaba datos. Verde en la suite y roto en la app.
 *
 * Por eso aquí NO se fabrica un ledger: se escribe EXACTAMENTE lo que `buildSeed` —la función del
 * producto— genera para un usuario nuevo, y se comprueba qué ve ese usuario. Si alguien volviera a
 * poner montos en la semilla, este fichero se pone rojo; un ledger fabricado a mano no lo haría.
 *
 * (La app no expone ruta de registro: las cuentas las crea `globalSetup`. Escribir la salida literal
 * de `buildSeed` sobre la cuenta del worker es el estado de usuario nuevo más fiel que el entorno
 * permite, y es estrictamente más fuerte que la siembra sintética que enmascaró el defecto.)
 */
import { test, expect } from "./helpers/fixtures";
import { buildSeed } from "@/domain";
import { P0 } from "../helpers/periods";

const DESK = { width: 1440, height: 900 };

/** Deja la cuenta del worker en el estado LITERAL de un usuario nuevo, según el producto. */
async function comoUsuarioNuevo(page: import("@playwright/test").Page) {
  const actual = await page.request.get("/api/v1/ledger");
  const baseRevision =
    actual.status() === 200 ? ((await actual.json()) as { revision: number }).revision : 0;
  const res = await page.request.put("/api/v1/ledger", {
    data: { baseRevision, state: buildSeed("local", P0) },
  });
  if (!res.ok()) throw new Error(`no se pudo poner la cuenta como usuario nuevo (HTTP ${res.status()})`);
}

test("TC-SIN-010h: un usuario nuevo ve la tarjeta de arranque y ninguna cifra inventada", async ({ page }) => {
  // @aitri-tc TC-SIN-010h
  await page.setViewportSize(DESK);
  await comoUsuarioNuevo(page);
  await page.goto("/");

  // 1) La tarjeta que hasta hoy no veía NADIE.
  await expect(page.getByTestId("opening-card")).toBeVisible();

  // 2) La estructura SÍ está: no es una pantalla en blanco.
  await expect(page.getByText("Comida", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Salario", { exact: true }).first()).toBeVisible();

  // 3) Y no hay ni un peso que el usuario no haya tecleado. Se leen las celdas de la grilla y se
  //    exige que ninguna muestre un importe con separador de miles.
  const celdas = page.locator('[data-testid^="cell-"]');
  const n = await celdas.count();
  expect(n).toBeGreaterThan(0);
  const textos = await celdas.allInnerTexts();
  const conImporte = textos.filter((t) => /\d[\d.,]*\d/.test(t.replace(/\s/g, "")));
  expect(conImporte).toHaveLength(0);
});

test("TC-SIN-012f: una cuenta con datos propios NO ve la tarjeta", async ({ page }) => {
  // @aitri-tc TC-SIN-012f
  // El fixture `freshLedger` ya deja la cuenta con el baseline POBLADO, que es justo el caso.
  await page.setViewportSize(DESK);
  await page.goto("/");

  await expect(page.getByTestId("opening-card")).toHaveCount(0);
  // y la grilla sí muestra importes
  const textos = await page.locator('[data-testid^="cell-"]').allInnerTexts();
  expect(textos.some((t) => /\d[\d.,]*\d/.test(t.replace(/\s/g, "")))).toBe(true);
});

test("TC-SIN-032f: la semilla sigue siendo editable — renombrar una categoría persiste", async ({ page }) => {
  // @aitri-tc TC-SIN-032f
  // NFR-2302: el segundo criterio de FR-013 de la raíz (semilla EDITABLE) sigue vigente sin tocar.
  await page.setViewportSize(DESK);
  await comoUsuarioNuevo(page);

  const antes = await page.request.get("/api/v1/ledger");
  const { revision, state } = (await antes.json()) as { revision: number; state: { nodes: { id: string; name: string }[] } };
  const nodos = state.nodes.map((n) => (n.id === "c-comida" ? { ...n, name: "Alimentación" } : n));
  const put = await page.request.put("/api/v1/ledger", {
    data: { baseRevision: revision, state: { ...state, nodes: nodos } },
  });
  expect(put.ok()).toBe(true);

  // Releído desde el servidor: el renombrado persistió y el resto de la jerarquía no cambió.
  const despues = await page.request.get("/api/v1/ledger");
  const releido = (await despues.json()) as { state: { nodes: { id: string; name: string }[] } };
  expect(releido.state.nodes.find((n) => n.id === "c-comida")!.name).toBe("Alimentación");
  expect(releido.state.nodes).toHaveLength(12);
});
