/**
 * BG-065 — Configuración usa el mismo inicio que el servidor para bloquear el saldo inicial.
 *
 * Antes la pantalla miraba el mes DECLARADO, y sin declaración tomaba «hoy»: con junio cerrado y
 * nada declarado dejaba editar una apertura que movía el saldo de junio. Ahora mira el inicio
 * efectivo (el primero con datos) y, además, avisa si el mes ELEGIDO está cerrado.
 */
import { test, expect } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import { periodMonthLabel } from "@/domain/periods";
import type { LedgerNode } from "@/domain/types";

const DESK = { width: 1440, height: 900 };
const HOY = new Date();
const ANIO = HOY.getFullYear();
const MES = HOY.getMonth() + 1;
const P = (m: number) => `${ANIO}-${String(m).padStart(2, "0")}`;

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sueldo", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Sueldo", icon: null, order: 1 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "c-comida", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Comida", icon: null, order: 3 },
];

async function cerrarUnMes(page: import("./helpers/fixtures").Page): Promise<{ closedThrough: string | null; startMonth: string | null }> {
  const rev = ((await (await page.request.get("/api/v1/ledger")).json()) as { revision: number }).revision;
  const cierre = await page.request.post("/api/v1/closure", { data: { baseRevision: rev } });
  expect(cierre.ok(), await cierre.text()).toBe(true);
  const l = (await (await page.request.get("/api/v1/ledger")).json()) as {
    state: { closure?: { closedThrough: string | null }; startMonth?: string | null };
  };
  return { closedThrough: l.state.closure?.closedThrough ?? null, startMonth: l.state.startMonth ?? null };
}

test("BG-065: sin inicio declarado y con el primer mes con datos cerrado, el saldo inicial llega bloqueado", async ({ page }) => {
  test.skip(MES <= 6, "el escenario necesita junio en el pasado del año en curso");
  await page.setViewportSize(DESK);
  await seedLedger(page, { nodes: NODES, actuals: { "c-comida": { [P(6)]: 40_000 } } });
  // Precondición: nada declarado y junio (el primer mes con datos) cerrado.
  expect(await cerrarUnMes(page)).toEqual({ closedThrough: P(6), startMonth: null });

  await page.goto("/configuracion");
  await expect(page.getByTestId("config-opening")).toBeDisabled();
  const aviso = page.getByTestId("config-blocked");
  await expect(aviso).toBeVisible();
  // Nombra el mes que de verdad bloquea: junio, no el mes en curso.
  await expect(aviso).toContainText(`junio de ${ANIO} está cerrado`);
  await expect(page.getByTestId("config-save")).toBeDisabled();
});

test("BG-065: si el mes elegido está cerrado, se avisa y no se puede guardar; con uno abierto, sí", async ({ page }) => {
  test.skip(MES === 12, "el control necesita un mes posterior dentro del mismo año");
  await page.setViewportSize(DESK);
  await seedLedger(page, { nodes: NODES });
  // Sin datos, el servidor cierra el mes en curso. Nada declarado: el mes que Configuración propone
  // por defecto es justo ese.
  expect(await cerrarUnMes(page)).toEqual({ closedThrough: P(MES), startMonth: null });

  await page.goto("/configuracion");
  const aviso = page.getByTestId("config-start-closed");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("está cerrado");
  // El campo no llega bloqueado entero: el usuario puede elegir otro mes.
  await expect(page.getByTestId("config-opening")).toBeEnabled();
  await expect(page.getByTestId("config-save")).toBeDisabled();

  // Control: con el mes siguiente (abierto), el aviso se va y se puede guardar.
  await page.getByTestId("config-month-select").click();
  await page.getByRole("option", { name: periodMonthLabel(P(MES + 1)), exact: true }).click();
  await expect(aviso).toHaveCount(0);
  await expect(page.getByTestId("config-save")).toBeEnabled();
});
