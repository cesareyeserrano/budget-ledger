/**
 * Feature tony-ledger — la puerta para agentes contra el servidor REAL (build de producción).
 *
 * Módulo:       tests/e2e/tony-ledger.spec.ts
 * Propósito:    Lo que solo se puede comprobar pasando por el enrutador y las cabeceras de Next:
 *               que bajo /api/agent/v1 existen las siete operaciones y ninguna más (FR-3403), y que
 *               todas exigen token (NFR-3410). Las pruebas en proceso llaman a las rutas sin pasar
 *               por Next; aquí la petición recorre el mismo camino que la del agente.
 * Dependencias: ./helpers/fixtures (cuenta del worker con la semilla restaurada), ./helpers/agente.
 */
import { test, expect, type Page } from "./helpers/fixtures";
import { e2eEmail } from "./helpers/globalSetup";
import { AGENT, clienteAgente, crearToken } from "./helpers/agente";
import { seedLedger } from "./helpers/seed";
import { fixToday } from "./helpers/cycles";
import type { LedgerNode, Movement } from "@/domain/types";

const DESK = { width: 1280, height: 900 };
const MOBILE = { width: 375, height: 812 };
const HOY = "2026-09-10";
const SEP = "2026-09";

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 1 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 0 },
  { id: "c-rest", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Restaurantes", icon: null, order: 1 },
];

const manual = (id: string, target: string, amount: number, createdAt: number, note: string): Movement => ({
  id, ownerId: "local", type: "expense", catId: target, subId: null, target, amount,
  period: SEP as Movement["period"], createdAt, date: "2026-09-08T12:00", note,
});

/** La celda de Ejecutado de una hoja en un periodo. */
const celda = (page: Page, leafId: string, period = SEP) =>
  page.locator(`[data-cell="${leafId}"][data-month="${period}"][data-plane="actual"]`).first();

/** Siembra el libro del worker con «hoy» fijo. Los movimientos manuales van en la siembra. */
async function sembrar(page: Page, manuales: Movement[] = []): Promise<void> {
  await fixToday(page, HOY);
  const actuals: Record<string, Record<string, number>> = { "c-salario": { [SEP]: 3_000_000 } };
  for (const m of manuales) actuals[m.target] = { [SEP]: (actuals[m.target]?.[SEP] ?? 0) + m.amount };
  await seedLedger(page, { nodes: NODES, actuals, movements: manuales } as Parameters<typeof seedLedger>[1]);
}

/** El agente registra un gasto por su puerta, con su token. Devuelve el id del movimiento. */
async function registraElAgente(
  testInfo: { parallelIndex: number }, target: string, amount: number, ref: string, nombre = "Agent-L"
): Promise<string> {
  const { token } = await crearToken(e2eEmail(testInfo.parallelIndex), nombre);
  const agente = await clienteAgente(token);
  try {
    const res = await agente.post(`${AGENT}/movements`, { data: { type: "expense", target, amount, date: "2026-09-09", note: "Del agente", ref } });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { movement: { id: string } }).movement.id;
  } finally {
    await agente.dispose();
  }
}

/** Abre el escritorio y el Detalle de una celda. */
async function abrirDetalle(page: Page, leafId: string) {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
  await celda(page, leafId).click();
  const panel = page.getByTestId("cell-notes");
  await expect(panel).toBeVisible();
  return panel;
}

// ── Contraste: luminancia relativa WCAG sobre los colores YA resueltos por el navegador ──────────
function canales(s: string): { c: number[]; a: number } {
  const nums = (s.match(/-?\d*\.?\d+/g) ?? ["0", "0", "0"]).map(Number);
  const fraccion = s.trim().startsWith("color(");
  return { c: nums.slice(0, 3).map((v) => (fraccion ? Math.round(v * 255) : v)), a: nums.length > 3 ? nums[3]! : 1 };
}
function luminancia(c: number[]): number {
  const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** Razón de contraste del texto de un elemento contra su fondo EFECTIVO (capas translúcidas compuestas). */
async function contrasteDe(loc: ReturnType<Page["locator"]>): Promise<number> {
  const { texto, capas } = await loc.evaluate((el) => {
    const capas: string[] = [];
    let n: HTMLElement | null = el as HTMLElement;
    while (n) { capas.push(getComputedStyle(n).backgroundColor); n = n.parentElement; }
    return { texto: getComputedStyle(el).color, capas };
  });
  // De la capa opaca más cercana hacia el elemento, componiendo las translúcidas encima.
  const parsed = capas.map(canales);
  const opaca = parsed.findIndex((k) => k.a >= 1);
  let fondo = opaca >= 0 ? parsed[opaca]!.c : [255, 255, 255];
  for (const capa of parsed.slice(0, opaca >= 0 ? opaca : parsed.length).filter((k) => k.a > 0).reverse()) {
    fondo = fondo.map((b, i) => Math.round(capa.c[i]! * capa.a + b * (1 - capa.a)));
  }
  const [hi, lo] = [luminancia(canales(texto).c), luminancia(fondo)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Las siete operaciones del contrato: método y ruta. */
const OPERACIONES: [string, string][] = [
  ["GET", "/tree"],
  ["GET", "/movements"],
  ["POST", "/movements"],
  ["PATCH", "/movements/m-cualquiera"],
  ["DELETE", "/movements/m-cualquiera"],
  ["GET", "/summary"],
  ["GET", "/period?date=2026-10-10"],
];

test.describe("tony-ledger — la superficie del agente en el servidor real", () => {
  test("TC-AGT-247h: todo handler bajo la superficie del agente exige token", async ({}, testInfo) => {
    // @aitri-tc TC-AGT-247h
    const sinToken = await clienteAgente();
    const { token } = await crearToken(e2eEmail(testInfo.parallelIndex));
    const conToken = await clienteAgente(token);
    try {
      const estados: number[] = [];
      for (const [metodo, ruta] of OPERACIONES) {
        const res = await sinToken.fetch(AGENT + ruta, { method: metodo, ...(metodo === "GET" || metodo === "DELETE" ? {} : { data: {} }) });
        estados.push(res.status());
        expect((await res.json()).error.code, `${metodo} ${ruta}`).toBe("unauthorized");
        expect(res.headers()["cache-control"]).toBe("no-store");
      }
      expect(estados).toEqual([401, 401, 401, 401, 401, 401, 401]);
      expect(estados).toHaveLength(7);

      // Next no contesta por su cuenta lo que la envoltura debe contestar: ni un 204 con `Allow:`
      // para OPTIONS, ni un 405 que delate qué métodos existen.
      for (const [metodo, ruta] of [["OPTIONS", "/tree"], ["OPTIONS", "/movements"], ["POST", "/tree"], ["DELETE", "/movements"], ["PUT", "/summary"]] as const) {
        const res = await sinToken.fetch(AGENT + ruta, { method: metodo });
        expect(res.status(), `${metodo} ${ruta}`).toBe(401);
        expect(res.headers()["allow"], `${metodo} ${ruta}`).toBeUndefined();
      }

      // Y con token, por el mismo camino real —el que añade las cabeceras de Next—, la puerta abre.
      const arbol = await conToken.get(`${AGENT}/tree`);
      expect(arbol.status()).toBe(200);
      const nodos = ((await arbol.json()) as { nodes: { id: string; type: string; leaf: boolean }[] }).nodes;
      expect(nodos.length).toBeGreaterThan(0);

      // Las CINCO operaciones restantes, con token y por el enrutador real. La clave `ref:` viaja
      // codificada en la URL —espacio, barra y tilde incluidos— y tiene que llegar decodificada.
      const hoja = nodos.find((n) => n.type === "expense" && n.leaf)!;
      const ref = "L 300/á#1";
      const clave = `${AGENT}/movements/${encodeURIComponent(`ref:${ref}`)}`;
      const alta = await conToken.post(`${AGENT}/movements`, { data: { type: "expense", target: hoja.id, amount: 50_000, date: "2026-09-09", ref } });
      expect(alta.status(), await alta.text()).toBe(201);
      const { movement } = (await alta.json()) as { movement: { id: string; period: string } };

      const porRef = await conToken.get(`${AGENT}/movements?ref=${encodeURIComponent(ref)}`);
      expect(porRef.status()).toBe(200);
      expect(((await porRef.json()) as { movement: { id: string } }).movement.id).toBe(movement.id);

      const corregido = await conToken.patch(clave, { data: { amount: 45_000 } });
      expect(corregido.status(), await corregido.text()).toBe(200);
      expect(((await corregido.json()) as { movement: { id: string; amount: number; ref: string } }).movement).toMatchObject({ id: movement.id, amount: 45_000, ref });

      const resumen = await conToken.get(`${AGENT}/summary?period=${movement.period}`);
      expect(resumen.status()).toBe(200);
      const periodo = await conToken.get(`${AGENT}/period?date=2026-09-09`);
      expect(((await periodo.json()) as { period: string }).period).toBe(movement.period);
      const lista = await conToken.get(`${AGENT}/movements?period=${movement.period}&node=${hoja.id}`);
      expect(((await lista.json()) as { movements: { id: string }[] }).movements.map((m) => m.id)).toContain(movement.id);

      const deshecho = await conToken.delete(clave);
      expect(deshecho.status(), await deshecho.text()).toBe(200);
      expect((await conToken.get(`${AGENT}/movements?ref=${encodeURIComponent(ref)}`)).status()).toBe(404);
      // Y por id, igual que por referencia.
      const otra = await conToken.post(`${AGENT}/movements`, { data: { type: "expense", target: hoja.id, amount: 1_000, date: "2026-09-09", ref: "L301" } });
      const id = ((await otra.json()) as { movement: { id: string } }).movement.id;
      expect((await conToken.patch(`${AGENT}/movements/${id}`, { data: { note: "por id" } })).status()).toBe(200);
      expect((await conToken.delete(`${AGENT}/movements/${id}`)).status()).toBe(200);
    } finally {
      await sinToken.dispose();
      await conToken.dispose();
    }
  });

  test("TC-AGT-034f: fuera de las siete operaciones no hay nada", async ({ page }, testInfo) => {
    // @aitri-tc TC-AGT-034f
    const { token } = await crearToken(e2eEmail(testInfo.parallelIndex));
    const agente = await clienteAgente(token);
    try {
      const antes = (await (await page.request.get("/api/v1/ledger")).json()) as { revision: number; state: { nodes: unknown[]; movements: unknown[] } };

      const fuera: [string, string][] = [
        ["GET", "/ledger"], ["PUT", "/ledger"], ["POST", "/closure"], ["POST", "/summary"],
        ["DELETE", "/period"], ["GET", "/tokens"], ["POST", "/tree"], ["PATCH", "/tree/x"], ["DELETE", "/tree/x"],
        ["PUT", "/movements"], ["GET", "/movements/m-cualquiera"], ["POST", "/tokens"],
      ];
      for (const [metodo, ruta] of fuera) {
        const res = await agente.fetch(AGENT + ruta, { method: metodo, ...(metodo === "GET" || metodo === "DELETE" ? {} : { data: {} }) });
        expect([404, 405], `${metodo} ${ruta} → ${res.status()}`).toContain(res.status());
      }

      const despues = (await (await page.request.get("/api/v1/ledger")).json()) as typeof antes;
      expect(despues.revision).toBe(antes.revision);
      expect(despues.state.nodes).toEqual(antes.state.nodes);
      expect(despues.state.movements).toEqual(antes.state.movements);
    } finally {
      await agente.dispose();
    }
  });
});

test.describe("tony-ledger — lo que el dueño ve (FR-3414, FR-3418)", () => {
  test("TC-AGT-140h: el Detalle muestra «Agent-L» en lo del agente y nada en lo manual", async ({ page }, testInfo) => {
    // @aitri-tc TC-AGT-140h
    await sembrar(page, [manual("m-manual", "c-mercado", 80_000, 1, "A mano")]);
    await registraElAgente(testInfo, "c-mercado", 50_000, "L300");

    const panel = await abrirDetalle(page, "c-mercado");
    const filas = panel.locator('[data-testid="detail-row"][data-kind="movement"]');
    await expect(filas).toHaveCount(2);
    const delAgente = filas.filter({ hasText: "Del agente" });
    const aMano = filas.filter({ hasText: "A mano" });
    await expect(delAgente.getByTestId("agent-tag")).toBeVisible();
    await expect(delAgente.getByTestId("agent-tag")).toHaveText("Agent-L");
    await expect(delAgente.getByTestId("detail-amount")).toHaveText("50.000");
    await expect(aMano.getByTestId("agent-tag")).toHaveCount(0);
    await expect(aMano.getByTestId("detail-amount")).toHaveText("80.000");
    await expect(panel.getByTestId("agent-tag")).toHaveCount(1);
    // La etiqueta no hace la fila más alta que una fila sin ella.
    const alto = (loc: typeof delAgente) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(await alto(delAgente)).toBe(await alto(aMano));
  });

  test("TC-AGT-141e: un nombre de 60 caracteres se trunca sin desbordar a 375 px", async ({ page }, testInfo) => {
    // @aitri-tc TC-AGT-141e
    const largo = "W".repeat(60);
    await sembrar(page, [manual("m-manual", "c-mercado", 80_000, 1, "A mano")]);
    await registraElAgente(testInfo, "c-mercado", 50_000, "L300", largo);

    // En el teléfono el detalle de una categoría es su pantalla, con la lista de movimientos.
    await page.setViewportSize(MOBILE);
    await page.goto("/?v=p&d=leaf&id=c-mercado");
    await expect(page.getByTestId("mb-leaf")).toBeVisible();
    const filas = page.getByTestId("mb-mov-row");
    await expect(filas).toHaveCount(2);
    const delAgente = filas.filter({ hasText: "Del agente" });
    const aMano = filas.filter({ hasText: "A mano" });
    const etiqueta = delAgente.getByTestId("agent-tag");
    await expect(etiqueta).toBeVisible();
    await expect(etiqueta).toHaveAttribute("title", largo);
    await expect(aMano.getByTestId("agent-tag")).toHaveCount(0);

    const medidas = await etiqueta.evaluate((el) => ({
      recorte: getComputedStyle(el).textOverflow, visible: el.clientWidth, texto: el.scrollWidth,
    }));
    expect(medidas.recorte).toBe("ellipsis");
    expect(medidas.visible).toBeGreaterThan(0);
    expect(medidas.visible).toBeLessThanOrEqual(96);
    expect(medidas.texto).toBeGreaterThan(medidas.visible); // el texto no cabe: está recortado

    // La fila del agente mide lo mismo que la manual: la etiqueta no la ensancha ni la desborda.
    const caja = (loc: typeof delAgente) => loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { ancho: Math.round(r.width), derecha: Math.round(r.right), scroll: el.scrollWidth };
    });
    const [cAgente, cManual] = [await caja(delAgente), await caja(aMano)];
    expect(cAgente.ancho).toBe(cManual.ancho);
    expect(cAgente.scroll).toBe(cManual.scroll);
    expect(cAgente.derecha).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    // El monto y el lápiz siguen dentro de la pantalla.
    for (const pieza of [delAgente.getByTestId("mb-mov-amount"), delAgente.getByTestId("mb-mov-edit")]) {
      await expect(pieza).toBeVisible();
      const derecha = await pieza.evaluate((el) => Math.round(el.getBoundingClientRect().right));
      expect(derecha).toBeLessThanOrEqual(375);
    }
  });

  test("TC-AGT-142f: sin movimientos de agente el Detalle no cambia", async ({ page }) => {
    // @aitri-tc TC-AGT-142f
    await sembrar(page, [manual("m-1", "c-mercado", 80_000, 1, "Uno"), manual("m-2", "c-mercado", 20_000, 2, "Dos")]);
    const panel = await abrirDetalle(page, "c-mercado");
    const filas = panel.locator('[data-testid="detail-row"][data-kind="movement"]');
    await expect(filas).toHaveCount(2);
    await expect(page.getByTestId("agent-tag")).toHaveCount(0);

    const alturas = await filas.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(alturas[0]).toBe(alturas[1]);
    // Cada fila conserva sus cuatro piezas de siempre: ícono, fecha, nota y monto.
    for (const i of [0, 1]) {
      await expect(filas.nth(i).getByTestId("detail-date")).toBeVisible();
      await expect(filas.nth(i).getByTestId("detail-note")).toBeVisible();
      await expect(filas.nth(i).getByTestId("detail-amount")).toBeVisible();
    }
    await expect(filas.filter({ hasText: "Uno" }).getByTestId("detail-amount")).toHaveText("80.000");
  });

  test("TC-AGT-143e: contraste de la etiqueta en tema claro y oscuro, y sin desbordar a 1280 px", async ({ page }, testInfo) => {
    // @aitri-tc TC-AGT-143e
    await sembrar(page);
    await registraElAgente(testInfo, "c-mercado", 50_000, "L300");
    for (const tema of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: tema });
      const panel = await abrirDetalle(page, "c-mercado");
      // El tema pedido es el que está aplicado: si no, las dos vueltas medirían el mismo.
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), `tema ${tema}`).toBe(tema === "dark");
      const etiqueta = panel.getByTestId("agent-tag");
      await expect(etiqueta).toHaveText("Agent-L");
      expect(await contrasteDe(etiqueta), `tema ${tema}`).toBeGreaterThanOrEqual(4.5);
      const fila = panel.locator('[data-testid="detail-row"][data-kind="movement"]').first();
      const dim = await fila.evaluate((el) => ({ scroll: el.scrollWidth, cliente: el.clientWidth }));
      expect(dim.scroll, `tema ${tema}`).toBeLessThanOrEqual(dim.cliente);
    }
  });

  test("TC-AGT-145e: lo del agente se edita y se borra desde la app como lo manual", async ({ page }, testInfo) => {
    // @aitri-tc TC-AGT-145e
    await sembrar(page);
    await registraElAgente(testInfo, "c-mercado", 50_000, "L300");
    const panel = await abrirDetalle(page, "c-mercado");
    const fila = panel.locator('[data-testid="detail-row"][data-kind="movement"]').filter({ hasText: "Del agente" });

    await fila.getByLabel("Editar movimiento").click();
    const editor = panel.getByTestId("movement-editor");
    await expect(editor).toBeVisible();
    await editor.getByLabel("Monto").fill("45000");
    await editor.getByTestId("edit-save").click();
    await expect(fila.getByTestId("detail-amount")).toHaveText("45.000");
    await expect(fila.getByTestId("agent-tag")).toHaveText("Agent-L"); // sigue marcado como del agente
    // Lo PERSISTIDO: la celda en 45.000 y el movimiento con su marca intacta.
    await expect.poll(async () => {
      const l = (await (await page.request.get("/api/v1/ledger")).json()) as { state: { actuals: Record<string, Record<string, number>> } };
      return l.state.actuals["c-mercado"]?.[SEP] ?? 0;
    }, { timeout: 10_000 }).toBe(45_000);
    const trasEditar = (await (await page.request.get("/api/v1/ledger")).json()) as { state: { movements: { target: string; amount: number; origin?: { ref: string; agentName: string } }[] } };
    expect(trasEditar.state.movements.find((m) => m.target === "c-mercado")).toMatchObject({ amount: 45_000, origin: { ref: "L300", agentName: "Agent-L" } });

    const guardado = page.waitForResponse((r) => r.url().includes("/api/v1/ledger") && r.request().method() === "PUT" && r.status() === 200);
    await fila.getByLabel("Borrar movimiento").click();
    await panel.getByLabel("Confirmar borrado").click();
    await expect(panel.locator('[data-testid="detail-row"][data-kind="movement"]')).toHaveCount(0);
    await guardado;
    const libro = (await (await page.request.get("/api/v1/ledger")).json()) as { state: { movements: { target: string }[]; actuals: Record<string, Record<string, number>> } };
    expect(libro.state.movements.filter((m) => m.target === "c-mercado")).toHaveLength(0);
    expect(libro.state.actuals["c-mercado"]?.[SEP] ?? 0).toBe(0);
  });

  test("TC-AGT-180h: lo que registra el agente aparece en la app abierta sin recargar", async ({ page }, testInfo) => {
    // @aitri-tc TC-AGT-180h
    await sembrar(page, [manual("m-1", "c-mercado", 100_000, 1, "A mano")]);
    await page.setViewportSize(DESK);
    await page.goto("/");
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await expect(celda(page, "c-mercado")).toContainText("100.000");
    // Una marca en la página: si hubiera una recarga o una navegación, desaparecería.
    await page.evaluate(() => { (window as unknown as { __sinRecarga?: boolean }).__sinRecarga = true; });

    await registraElAgente(testInfo, "c-mercado", 50_000, "L300");
    await expect(celda(page, "c-mercado")).toContainText("150.000", { timeout: 5_000 });
    expect(await page.evaluate(() => (window as unknown as { __sinRecarga?: boolean }).__sinRecarga)).toBe(true);

    await celda(page, "c-mercado").click();
    const panel = page.getByTestId("cell-notes");
    const delAgente = panel.locator('[data-testid="detail-row"][data-kind="movement"]').filter({ hasText: "Del agente" });
    await expect(delAgente.getByTestId("detail-amount")).toHaveText("50.000");
    await expect(delAgente.getByTestId("agent-tag")).toHaveText("Agent-L");
  });

  test("TC-AGT-212f: un libro sin movimientos de agente se ve idéntico", async ({ page }) => {
    // @aitri-tc TC-AGT-212f
    await sembrar(page, [manual("m-1", "c-mercado", 320_000, 1, "A mano")]);
    await page.setViewportSize(DESK);
    await page.goto("/");
    await expect(page.getByTestId("budget-grid")).toBeVisible();
    await expect(celda(page, "c-mercado")).toContainText("320.000");
    await expect(page.getByTestId("agent-tag")).toHaveCount(0); // ni en la grilla ni en el Balance

    await celda(page, "c-mercado").click();
    const panel = page.getByTestId("cell-notes");
    await expect(panel.locator('[data-testid="detail-row"][data-kind="movement"]')).toHaveCount(1);
    await expect(page.getByTestId("agent-tag")).toHaveCount(0);

    // Y en el teléfono, la pantalla de la categoría tampoco.
    await page.setViewportSize(MOBILE);
    await page.goto("/?v=p&d=leaf&id=c-mercado");
    await expect(page.getByTestId("mb-mov-row")).toHaveCount(1);
    await expect(page.getByTestId("agent-tag")).toHaveCount(0);
  });
});

