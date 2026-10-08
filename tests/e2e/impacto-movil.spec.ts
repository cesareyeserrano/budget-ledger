import { test, expect, type Page, type Locator } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import { closeViaApi, fixToday } from "./helpers/cycles";
import { GMV, gmvBase, type GmvSeed } from "../fixtures/gmv-base";

// Feature impacto-movil — lo que solo el NAVEGADOR puede afirmar: que tras reabrir un mes por la ruta
// real y corregirlo desde el teléfono, el aviso aparece donde se corrige, con las mismas filas que el
// panel de escritorio, y que cabe y se lee. Prefijo TC-IMV-*.
//
// Julio (PREV) cierra con 3.150 de disponible; agosto (M) y los meses siguientes, con 6.850. Subir 100
// el gasto de Mercado de julio (850 → 950) los mueve a 6.750; subirlo a 7.900 los deja en −200.

const MOBILE = { width: 375, height: 812 };
const SMALL = { width: 360, height: 740 };
const DESK = { width: 1440, height: 900 };
const HOY = "2026-08-25";
const M = "2026-08";
const PREV = "2026-07";
const LABEL_PREV = "Julio 2026";

/** Reabre el último mes cerrado por la ruta real: es el servidor quien fija la línea de base. */
async function reopenViaApi(page: Page): Promise<number> {
  const current = await page.request.get("/api/v1/ledger");
  const baseRevision = ((await current.json()) as { revision: number }).revision;
  const res = await page.request.delete("/api/v1/closure", { data: { baseRevision } });
  return res.status();
}

/** Siembra el libro, cierra julio, lo reabre y abre la app. */
async function abrirReabierto(page: Page, opts: { viewport?: { width: number; height: number }; seed?: GmvSeed; ruta?: string } = {}): Promise<void> {
  await fixToday(page, HOY);
  await page.setViewportSize(opts.viewport ?? MOBILE);
  await seedLedger(page, opts.seed ?? gmvBase(M, PREV));
  expect(await closeViaApi(page), "cerrar julio").toBe(200);
  expect(await reopenViaApi(page), "reabrir julio").toBe(200);
  await page.goto(opts.ruta ?? "/");
}

const tarjeta = (page: Page) => page.getByTestId("mb-impact");
const filaDe = (page: Page, periodo: string) => page.locator(`[data-testid="mb-impact-row"][data-period="${periodo}"]`);
const sinDesborde = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
const numero = (texto: string | null) => (texto ?? "").replace(/[^\d−-]/g, "");

/** Pone la vista del teléfono en julio y abre el detalle de Mercado. */
async function irAMercadoDeJulio(page: Page): Promise<void> {
  await page.goto("/?v=p");
  await expect(page.getByTestId("mb-budget")).toBeVisible();
  await page.getByTestId("mb-period-prev").click();
  await expect(page.getByTestId("mb-period-label")).toContainText(LABEL_PREV);
  const fila = (nombre: string) => page.getByTestId("mb-row").filter({ has: page.getByTestId("mb-row-name").getByText(nombre, { exact: true }) });
  await fila("Comida").click();
  await fila("Mercado").click();
  await expect(page.getByTestId("mb-leaf")).toBeVisible();
}
/** Corrige el gasto de Mercado de julio desde su detalle, por el formulario de edición del teléfono. */
async function corregirGasto(page: Page, monto: string): Promise<void> {
  await page.getByTestId("mb-mov-edit").first().click();
  await expect(page.getByTestId("mb-edit-form")).toBeVisible();
  await page.getByTestId("mb-edit-amount").fill(monto);
  await page.getByTestId("mb-edit-save").click();
  await expect(page.getByTestId("mb-leaf")).toBeVisible();
}
async function desplegar(page: Page): Promise<void> {
  const cab = page.getByTestId("mb-impact-toggle");
  if ((await cab.getAttribute("aria-expanded")) !== "true") await cab.click();
  await expect(cab).toHaveAttribute("aria-expanded", "true");
}
/** (periodo, antes, después) de cada fila, solo dígitos y signo: comparable entre teléfono y escritorio. */
const leerFilas = (filas: Locator, antes: string, despues: string) => filas.evaluateAll((els, ids) => els.map((e) => ({
  periodo: e.getAttribute("data-period"),
  antes: (e.querySelector(`[data-testid="${ids[0]}"]`)?.textContent ?? "").replace(/[^\d−-]/g, ""),
  despues: (e.querySelector(`[data-testid="${ids[1]}"]`)?.textContent ?? "").replace(/[^\d−-]/g, ""),
})), [antes, despues]);

// ═══ FR-3301 / FR-3303 · corregir y ver el impacto ═══════════════════════════════════════════════

test("TC-IMV-001h: corregir un gasto del mes reabierto muestra el mes siguiente movido", async ({ page }) => {
  // @aitri-tc TC-IMV-001h
  await abrirReabierto(page);
  await irAMercadoDeJulio(page);
  await expect(tarjeta(page)).toHaveCount(0);

  await corregirGasto(page, "950");

  await expect(tarjeta(page)).toBeVisible();
  await expect(page.getByTestId("mb-impact-title")).toContainText(`Al corregir ${LABEL_PREV} se movieron`);
  await desplegar(page);
  const primera = page.getByTestId("mb-impact-row").first();
  await expect(primera).toHaveAttribute("data-period", M);
  expect(numero(await primera.getByTestId("mb-impact-before").textContent())).toBe("6850");
  expect(numero(await primera.getByTestId("mb-impact-after").textContent())).toBe("6750");
  await expect(primera).toHaveAttribute("data-broken", "false");
});

test("TC-IMV-020h: el aviso aparece en la pantalla donde se corrige y sigue en la lista", async ({ page }) => {
  // @aitri-tc TC-IMV-020h
  await abrirReabierto(page);
  await irAMercadoDeJulio(page);
  await page.evaluate(() => { (window as unknown as { __imv: number }).__imv = 1; });
  await corregirGasto(page, "950");

  // En el detalle, sin recargar, y antes de las tarjetas de Presupuestado y Ejecutado.
  await expect(tarjeta(page)).toBeVisible();
  expect(await page.evaluate(() => window.location.search)).toContain("d=leaf");
  expect(await page.evaluate(() => (window as unknown as { __imv?: number }).__imv)).toBe(1);
  const orden = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="mb-impact"]')!.getBoundingClientRect().top;
    const b = document.querySelector('[data-testid="mb-amount-card-budget"]')!.getBoundingClientRect().top;
    return a < b;
  });
  expect(orden).toBe(true);

  // En la lista de julio, bajo la barra de periodo y antes de la tarjeta de resumen.
  await page.getByTestId("mb-back").click();
  await expect(page.getByTestId("mb-budget")).toBeVisible();
  await expect(tarjeta(page)).toBeVisible();
  const enLista = await page.evaluate(() => {
    const top = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top;
    return top("mb-period-bar") < top("mb-impact") && top("mb-impact") < top("mb-summary");
  });
  expect(enLista).toBe(true);

  // Y también mirando agosto: el aviso es del libro, no del periodo que se mira.
  await page.getByTestId("mb-period-next").click();
  await expect(page.getByTestId("mb-period-label")).toContainText("Agosto 2026");
  await expect(tarjeta(page)).toBeVisible();
});

test("TC-IMV-005h: el teléfono y escritorio muestran las mismas filas", async ({ page }) => {
  // @aitri-tc TC-IMV-005h
  await abrirReabierto(page);
  await irAMercadoDeJulio(page);
  await corregirGasto(page, "950");
  await desplegar(page);
  const movil = await leerFilas(page.getByTestId("mb-impact-row"), "mb-impact-before", "mb-impact-after");
  expect(movil.length).toBeGreaterThan(1);
  expect(movil[0]).toEqual({ periodo: M, antes: "6850", despues: "6750" });

  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("impact-panel")).toBeVisible();
  const escritorio = await leerFilas(page.getByTestId("impact-row"), "impact-before", "impact-after");
  expect(escritorio).toEqual(movil);
});

// ═══ FR-3302 · la marca de roto ══════════════════════════════════════════════════════════════════

/** Ratio de contraste WCAG entre dos colores «rgb(r, g, b)». */
function contraste(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Color del texto y el primer fondo no transparente que tiene detrás. */
const coloresDe = (loc: Locator) => loc.evaluate((el) => {
  let nodo: Element | null = el;
  let fondo = "rgb(255, 255, 255)";
  while (nodo) {
    const bg = getComputedStyle(nodo).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) { fondo = bg; break; }
    nodo = nodo.parentElement;
  }
  return { texto: getComputedStyle(el).color, fondo };
});
const colorDe = (page: Page, token: string) => page.evaluate((t) => {
  const probe = document.createElement("span");
  probe.style.color = `var(${t})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}, token);

test("TC-IMV-012e: la marca no depende solo del color y se lee en los dos temas", async ({ page }) => {
  // @aitri-tc TC-IMV-012e
  let pares = 0;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await abrirReabierto(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(scheme === "dark");
    await irAMercadoDeJulio(page);
    await corregirGasto(page, "7900");
    await desplegar(page);

    const rota = filaDe(page, M);
    await expect(rota).toHaveAttribute("data-broken", "true");
    const marca = rota.getByTestId("mb-impact-broken");
    await expect(marca).toHaveText("quedó sin cubrir");
    await expect(marca.locator("svg")).toHaveCount(1);
    expect((await coloresDe(marca)).texto).toBe(await colorDe(page, "--alert-strong"));
    expect(numero(await rota.getByTestId("mb-impact-after").textContent())).toBe("−200");

    const medir = async (nombre: string, loc: Locator) => {
      const c = await coloresDe(loc);
      expect(contraste(c.texto, c.fondo), `${scheme} · ${nombre} · ${c.texto} sobre ${c.fondo}`).toBeGreaterThanOrEqual(4.5);
      pares++;
    };
    await medir("título", page.getByTestId("mb-impact-title"));
    await medir("periodo", rota.locator("span.caption").first());
    await medir("antes", rota.getByTestId("mb-impact-before"));
    await medir("después", rota.getByTestId("mb-impact-after"));
    await medir("marca", marca);
  }
  expect(pares).toBe(10);
});

// ═══ FR-3303 · cabe y se toca ════════════════════════════════════════════════════════════════════

test("TC-IMV-021e: cifras de nueve dígitos caben a 375 y 360 px", async ({ page }) => {
  // @aitri-tc TC-IMV-021e
  // Un ingreso de agosto que deja su disponible en 999.999.999: 3.150 + ingreso − 800 − 500.
  const grande = gmvBase(M, PREV);
  const ingreso = 999_999_999 - 3150 + 800 + 500;
  grande.budgets[GMV.salario] = { ...grande.budgets[GMV.salario], [M]: ingreso };
  grande.actuals[GMV.salario] = { ...grande.actuals[GMV.salario], [M]: ingreso };
  grande.movements = grande.movements.map((m) => (m.id === "mv-salario" ? { ...m, amount: ingreso } : m));

  let vistas = 0;
  for (const viewport of [MOBILE, SMALL]) {
    await abrirReabierto(page, { viewport, seed: grande });
    await irAMercadoDeJulio(page);
    await corregirGasto(page, "950");
    await desplegar(page);
    for (const dónde of ["detalle", "lista"]) {
      if (dónde === "lista") {
        await page.getByTestId("mb-back").click();
        await expect(page.getByTestId("mb-budget")).toBeVisible();
      }
      const fila = filaDe(page, M);
      await expect(fila.getByTestId("mb-impact-before")).toHaveText("$999.999.999");
      await expect(fila.getByTestId("mb-impact-after")).toHaveText("$999.999.899");
      // El bloque de cifras no se corta ni se sale de la tarjeta.
      const cabe = await fila.getByTestId("mb-impact-figures").evaluate((el) => {
        const caja = el.getBoundingClientRect();
        const tarjeta = el.closest('[data-testid="mb-impact"]')!.getBoundingClientRect();
        return el.scrollWidth <= el.clientWidth + 1 && caja.left >= tarjeta.left && caja.right <= tarjeta.right;
      });
      expect(cabe, `${dónde} a ${viewport.width}`).toBe(true);
      expect(await sinDesborde(page), `${dónde} a ${viewport.width}`).toBe(true);
      vistas++;
    }
  }
  expect(vistas).toBe(4);
});

test("TC-IMV-022f: la cabecera de la tarjeta se deja tocar", async ({ page }) => {
  // @aitri-tc TC-IMV-022f
  await abrirReabierto(page);
  await irAMercadoDeJulio(page);
  await corregirGasto(page, "950");
  for (const abierta of [false, true]) {
    if (abierta) await desplegar(page);
    const botones = await tarjeta(page).locator("button").evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }));
    expect(botones, abierta ? "desplegada" : "plegada").toHaveLength(1);
    expect(Math.min(botones[0].w, botones[0].h)).toBeGreaterThanOrEqual(40);
  }
});

// ═══ NFR-3301 / NFR-3302 · lo que no cambia ══════════════════════════════════════════════════════

test("TC-IMV-040h: escritorio: el panel de impacto sigue mostrando sus filas", async ({ page }) => {
  // @aitri-tc TC-IMV-040h
  await abrirReabierto(page);
  await irAMercadoDeJulio(page);
  await corregirGasto(page, "950");
  await expect(tarjeta(page)).toBeVisible();

  await page.setViewportSize(DESK);
  await page.goto("/");
  const panel = page.getByTestId("impact-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-reopened", PREV);
  const deAgosto = page.locator(`[data-testid="impact-row"][data-period="${M}"]`);
  await expect(deAgosto.getByTestId("impact-before")).toHaveText("$6.850");
  await expect(deAgosto.getByTestId("impact-after")).toHaveText("$6.750");
  await expect(panel).toContainText(`Al corregir ${LABEL_PREV} se movieron`);
});

test("TC-IMV-041e: escritorio no monta la tarjeta del teléfono", async ({ page }) => {
  // @aitri-tc TC-IMV-041e
  await abrirReabierto(page);
  await irAMercadoDeJulio(page);
  await corregirGasto(page, "950");

  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("impact-panel")).toBeVisible();
  await expect(tarjeta(page)).toHaveCount(0);
  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await expect(tarjeta(page)).toHaveCount(0);
});

test("TC-IMV-047f: Organizar y Cierre no cambian con un mes reabierto", async ({ page }) => {
  // @aitri-tc TC-IMV-047f
  await abrirReabierto(page);
  await irAMercadoDeJulio(page);
  await corregirGasto(page, "950");
  await expect(tarjeta(page)).toBeVisible();

  await page.goto("/?v=p&d=org");
  await expect(page.getByTestId("mb-organize")).toBeVisible();
  await expect(tarjeta(page)).toHaveCount(0);

  await page.goto("/?v=p&d=cierre");
  await expect(page.getByTestId("mb-closure")).toBeVisible();
  await expect(tarjeta(page)).toHaveCount(0);
  await expect(page.getByTestId("mb-closure-reopened")).toContainText(`${LABEL_PREV} está reabierto`);
});
