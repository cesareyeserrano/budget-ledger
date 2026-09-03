/**
 * Feature cierre-de-mes — lo que solo se puede afirmar en el navegador.
 * TCs: FR-2006 (060h,061e,062f) · FR-2009 (090h,091f,092e,093h) · NFR-2004 (231e)
 *
 * El resto vive en integración: el congelamiento es AUTORIDAD del servidor y lo que se comprueba
 * aquí es que el usuario lo VE y entiende qué hacer (ADR-12).
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import type { LedgerNode } from "@/domain/types";

const DESK = { width: 1440, height: 900 };
/** El historial arranca en junio del año en curso: junio…(mes actual − 1) están terminados. */
const AHORA = new Date();
const ANIO = AHORA.getFullYear();
const P = (m: number) => `${ANIO}-${String(m).padStart(2, "0")}`;
const INICIO = P(6);

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sueldo", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Sueldo", icon: null, order: 1 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 3 },
];

/** Deja el ledger sembrado desde junio y sin ningún mes cerrado. */
async function abrir(page: Page): Promise<void> {
  await page.setViewportSize(DESK);
  await seedLedger(page, {
    nodes: NODES,
    actuals: { "c-sueldo": { [INICIO]: 1_000_000 }, "c-mercado": { [INICIO]: 300_000 } },
  });
  await page.request.delete("/api/v1/closure", { data: { baseRevision: 0 } }).catch(() => {});
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
}

/**
 * Cierra `n` meses por API, recarga y ESPERA a que la pantalla lo refleje.
 *
 * La espera no es cosmética: la grilla pinta con el estado sembrado ANTES de que `repo.load()`
 * traiga el cierre desde el servidor, así que `budget-grid` visible NO significa «el cierre ya
 * está en pantalla». Sin este último paso, cualquier lectura posterior del DOM es una carrera —
 * y era justo lo que hacía intermitentes a dos de estas pruebas.
 */
async function cerrar(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const cur = await page.request.get("/api/v1/ledger");
    const { revision } = (await cur.json()) as { revision: number };
    const res = await page.request.post("/api/v1/closure", { data: { baseRevision: revision } });
    if (!res.ok()) throw new Error(`no se pudo cerrar (${i + 1}/${n}): ${res.status()} ${await res.text()}`);
  }
  await page.reload();
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  // 15s y no los 5 por defecto: aquí se espera una ida y vuelta al servidor (la grilla pinta con
  // el estado sembrado y el cierre llega DESPUÉS, con la hidratación), y con dos workers en
  // paralelo contra un servidor recién arrancado eso pasaba de 5s de vez en cuando. El plazo corto
  // era la causa de la intermitencia; no había ningún defecto detrás.
  await expect(page.locator('[data-month-head][data-closed="true"]')).toHaveCount(n, { timeout: 15_000 });
}

/** Los periodos cuya cabecera está marcada como cerrada. */
async function cerrados(page: Page): Promise<string[]> {
  return page.locator('[data-month-head][data-closed="true"]').evaluateAll(
    (els) => els.map((e) => (e as HTMLElement).dataset.monthHead ?? ""));
}

// ══ FR-2006 · el aviso ══════════════════════════════════════════════════════════════════════════
test("TC-CDM-060h: el aviso dice cuántos meses faltan y cuál es el siguiente cerrable", async ({ page }) => {
  // @aitri-tc TC-CDM-060h
  await abrir(page);
  const banner = page.getByTestId("closure-banner");
  await expect(banner).toBeVisible();
  // Junio hasta el mes anterior al actual: al menos uno, y el texto lo dice con su número.
  const pendientes = Number(await banner.getAttribute("data-pending"));
  expect(pendientes).toBeGreaterThan(0);
  await expect(banner).toContainText(String(pendientes));
  await expect(banner).toContainText("puedes cerrar");
});

test("TC-CDM-061e: el aviso no bloquea el trabajo", async ({ page }) => {
  // @aitri-tc TC-CDM-061e
  await abrir(page);
  await expect(page.getByTestId("closure-banner")).toBeVisible();
  // El mes EN CURSO sigue siendo editable con el aviso en pantalla.
  const celda = page.locator(`[data-cell="c-mercado"][data-month="${P(AHORA.getMonth() + 1)}"]`).first();
  const hay = await celda.count();
  if (hay > 0) {
    await celda.dblclick();
    await expect(page.locator("input:focus")).toBeVisible();
    await page.keyboard.press("Escape");
  }
  // Y no hay ningún overlay que intercepte: el banner tiene role=status, no dialog.
  await expect(page.getByTestId("closure-banner")).toHaveAttribute("role", "status");
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test("TC-CDM-062f: sin meses terminados pendientes, no hay aviso", async ({ page }) => {
  // @aitri-tc TC-CDM-062f
  await page.setViewportSize(DESK);
  // Historial que empieza en el mes EN CURSO: no tiene ningún mes terminado.
  await seedLedger(page, {
    nodes: NODES,
    actuals: { "c-sueldo": { [P(AHORA.getMonth() + 1)]: 1_000_000 } },
  });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await expect(page.getByTestId("closure-banner")).toHaveCount(0);
});

// ══ FR-2009 · la interfaz lo dice ═══════════════════════════════════════════════════════════════
test("TC-CDM-090h: las columnas cerradas se distinguen sin interactuar", async ({ page }) => {
  // @aitri-tc TC-CDM-090h
  await abrir(page);
  expect(await cerrados(page)).toHaveLength(0);
  await cerrar(page, 2);
  expect(await cerrados(page)).toEqual([INICIO, P(7)]);
  // Y las demás quedan explícitamente abiertas, no sin atributo.
  const abiertas = await page.locator('[data-month-head][data-closed="false"]').count();
  expect(abiertas).toBeGreaterThan(0);
});

test("TC-CDM-092e: la distinción no depende solo del color", async ({ page }) => {
  // @aitri-tc TC-CDM-092e
  await abrir(page);
  await cerrar(page, 2);
  // El invariante es «cada cabecera cerrada lleva su candado», no «hay exactamente dos». Escrito
  // como número fijo, la prueba mezclaba lo que quiere afirmar con el momento en que lee el DOM y
  // salía intermitente; escrito como relación entre dos lecturas del MISMO instante, no puede.
  await expect
    .poll(async () => {
      const cerradas = await page.locator('[data-month-head][data-closed="true"]').count();
      const candados = await page.locator('[data-testid="closed-mark"]').count();
      return `${cerradas}:${candados}`;
    })
    .toBe("2:2");
  for (const p of [INICIO, P(7)]) {
    await expect(page.locator(`[data-testid="closed-mark"][data-month="${p}"]`)).toHaveCount(1);
  }
});

test("TC-CDM-091f: intentar editar una celda cerrada explica el rechazo y su salida", async ({ page }) => {
  // @aitri-tc TC-CDM-091f
  await abrir(page);
  await cerrar(page, 2);
  const celda = page.locator(`[data-cell="c-mercado"][data-month="${INICIO}"]`).first();
  const antes = (await celda.textContent()) ?? "";
  await celda.dblclick();

  // No hay campo de importe y nada toma el foco: la CIFRA no se puede escribir.
  await expect(page.getByLabel("Editar valor")).toHaveCount(0);
  await expect(page.locator("input:focus")).toHaveCount(0);

  // Dice que está cerrado Y qué hacer. Junio NO es el último cerrado, así que la salida ofrecida
  // es la observación, no reabrir.
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("cerrado");
  await expect(toast).toContainText("observación");

  // Y al cerrar el panel la cifra sigue siendo la misma. Se comprueba DESPUÉS de Escape porque
  // mientras el panel está abierto el editor sustituye el nodo de la celda: comparar el texto en
  // ese momento leería un elemento distinto, no un valor cambiado.
  await page.keyboard.press("Escape");
  await expect(page.locator(`[data-cell="c-mercado"][data-month="${INICIO}"]`).first())
    .toHaveText(antes.trim());
});

test("TC-CDM-093h: el control dice siempre qué es cerrable y qué reabrible", async ({ page }) => {
  // @aitri-tc TC-CDM-093h
  await abrir(page);
  const control = page.getByTestId("closure-control");
  await expect(control).toHaveAttribute("data-closable", INICIO);
  await expect(control).toHaveAttribute("data-reopenable", "");

  await control.getByRole("button", { name: /Cerrar/ }).click();
  // El cierre viaja al servidor y vuelve: toHaveAttribute reintenta hasta que el store se entera.
  await expect(control).toHaveAttribute("data-reopenable", INICIO);
  await expect(control).toHaveAttribute("data-closable", P(7));
  await expect(control).toHaveAttribute("data-reopenable", INICIO);

  await control.getByRole("button", { name: /Reabrir/ }).click();
  // Reabierto: ya no se ofrece reabrir otro — el límite de «uno a la vez» se VE.
  await expect(control).toHaveAttribute("data-reopened", INICIO);
  await expect(control).toHaveAttribute("data-reopenable", "");
  await expect(control).toContainText("reabierto");
});

// ══ NFR-2004 · multi-anio no se degrada ═════════════════════════════════════════════════════════
test("TC-CDM-231e: el filtro por año sigue funcionando con meses cerrados", async ({ page }) => {
  // @aitri-tc TC-CDM-231e
  await abrir(page);
  await cerrar(page, 2);
  await page.getByTestId("period-pill").getByRole("tab", { name: "Año" }).click();
  await page.getByLabel("Año").click();
  await page.getByRole("option", { name: String(ANIO), exact: true }).click();

  const cabezas = await page.locator("[data-month-head]").evaluateAll(
    (els) => els.map((e) => (e as HTMLElement).dataset.monthHead ?? ""));
  expect(cabezas.length).toBeGreaterThan(0);
  for (const c of cabezas) expect(c.startsWith(String(ANIO))).toBe(true);
  // El recorte de la VISTA no cambió qué está cerrado.
  expect(await cerrados(page)).toEqual([INICIO, P(7)]);
});

// ══ BG-001 · el mes cerrado sin datos se pinta igual (ADR-14) ═══════════════════════════════════
test("TC-CDM-094e: un mes cerrado SIN datos se pinta como columna cerrada", async ({ page }) => {
  // @aitri-tc TC-CDM-094e
  await page.setViewportSize(DESK);
  const enCurso = P(AHORA.getMonth() + 1);
  const siguiente = P(AHORA.getMonth() + 2);

  // Ledger sin NADA en el mes en curso ni antes: es el escenario de BG-001.
  await seedLedger(page, { nodes: NODES, actuals: {}, budgets: {} });
  const cur = await page.request.get("/api/v1/ledger");
  const { revision } = (await cur.json()) as { revision: number };
  const cierre = await page.request.post("/api/v1/closure", { data: { baseRevision: revision } });
  expect(cierre.ok(), await cierre.text()).toBe(true);

  // Y ahora se escriben datos SOLO en el mes siguiente, que es lo que antes tiraba de la grilla
  // hacia adelante y dejaba el mes cerrado fuera de pantalla.
  const l2 = await page.request.get("/api/v1/ledger");
  const body = (await l2.json()) as { revision: number; state: Record<string, unknown> };
  const conDatos = { ...body.state, actuals: { "c-sueldo": { [siguiente]: 1_000_000 } } };
  const put = await page.request.put("/api/v1/ledger", {
    data: { baseRevision: body.revision, state: conDatos },
  });
  expect(put.ok(), await put.text()).toBe(true);

  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();

  // La columna del mes cerrado EXISTE, marcada y con candado, aunque no tenga ni una cifra.
  const cabeza = page.locator(`[data-month-head="${enCurso}"]`);
  await expect(cabeza).toHaveCount(1);
  await expect(cabeza).toHaveAttribute("data-closed", "true");
  await expect(page.locator(`[data-testid="closed-mark"][data-month="${enCurso}"]`)).toHaveCount(1);
  // Y el control ofrece reabrirlo: la acción ya no es un callejón sin salida.
  await expect(page.getByTestId("closure-control")).toHaveAttribute("data-reopenable", enCurso);
});

test("TC-CDM-043e: la celda cerrada dice a la vez «la cifra no» y «la observación sí»", async ({ page }) => {
  // @aitri-tc TC-CDM-043e
  // Lo destapó el gate de criterios: AC-2013 no tenía prueba, y al buscar cómo escribirla apareció
  // que el panel de observaciones vive DENTRO del editor de la celda. Bloquear el editor en los
  // meses cerrados dejaba las notas inalcanzables — y la nota es la única salida que le queda a un
  // error demasiado viejo para reabrirse (FR-2004).
  await abrir(page);
  await cerrar(page, 2);

  const celda = page.locator(`[data-cell="c-mercado"][data-month="${INICIO}"]`).first();
  await expect(celda).toHaveAttribute("data-closed", "true");
  const antes = (await celda.textContent()) ?? "";
  await celda.dblclick();

  // La CIFRA no es editable: se pinta como texto, no como campo.
  await expect(page.getByTestId("closed-value")).toHaveCount(1);
  await expect(page.getByLabel("Editar valor")).toHaveCount(0);
  // La OBSERVACIÓN sí: el panel está y se puede escribir en él.
  const notas = page.getByTestId("cell-notes");
  await expect(notas).toBeVisible();
  await notas.locator("input").first().fill("error de 8.000 detectado en septiembre");
  await expect(notas.locator("input").first()).toHaveValue("error de 8.000 detectado en septiembre");
  // Y el aviso lo explica.
  await expect(page.getByTestId("toast")).toContainText("cerrado");

  await page.keyboard.press("Escape");
  // La cifra sigue igual: abrir el panel no la movió.
  await expect(celda).toContainText(antes.trim().slice(0, 6));
});
