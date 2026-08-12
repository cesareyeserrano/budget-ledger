import { test, expect, type Page, type Locator } from "./helpers/fixtures";

/**
 * refinamiento-ui — sistema visual del escritorio (parte 1 de 2).
 *
 * Los TCs de dominio viven en tests/domain/refinamiento-ui.test.ts y los de tokens en
 * tests/integration/design-tokens.test.ts. Aquí quedan los que sólo se pueden afirmar sobre el
 * producto montado: identidad de bloque, chrome, textos retirados, las cuatro regresiones y el
 * contraste medido en ambos temas.
 */

const DESK = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 900 };
const TYPE_VARS = ["--type-expense", "--type-income", "--type-transfer"];

async function gotoDesk(page: Page, scheme: "light" | "dark" = "light") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();
}

async function gotoMobile(page: Page, scheme: "light" | "dark" = "light") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
}

/** Valor resuelto de una custom property del documento, normalizado a rgb() comparable. */
async function resolvedVar(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const probe = document.createElement("span");
    probe.style.color = raw;
    document.body.appendChild(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, name);
}

function parseColor(s: string): number[] {
  const m = s.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}
function lum([r, g, b]: number[]): number {
  const a = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function contrast(c1: string, c2: string): number {
  const l1 = lum(parseColor(c1)), l2 = lum(parseColor(c2));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const nodeRow = (page: Page, name: string) =>
  page.getByTestId("node-row").filter({ hasText: name }).first();

/** Arrastre con los pasos intermedios que dnd-kit necesita para registrar el over. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

// ── FR-1202 · la identidad de bloque es neutra ─────────────────────────────────
test("TC-RUI-002h: los encabezados de bloque van en tinta neutra con glifo lateral", async ({ page }) => {
  // @aitri-tc TC-RUI-002h
  await gotoDesk(page);
  const labels = page.getByTestId("type-total-row").getByTestId("row-label");
  await expect(labels).toHaveCount(3);

  // los tres rótulos resuelven al MISMO color
  const colors = await labels.evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  expect(new Set(colors).size, `colores de bloque: ${colors.join(" | ")}`).toBe(1);

  // y ese color no es ninguno de los hues de tipo
  const typeColors = await Promise.all(TYPE_VARS.map((v) => resolvedVar(page, v)));
  expect(typeColors).not.toContain(colors[0]);

  // cada bloque muestra su glifo lateral, y los tres son distintos entre sí. Se excluyen los svg
  // dentro de un <button>: el primero del rótulo es el chevron de colapsar, idéntico en los tres.
  const glyphs = await labels.evaluateAll((els) =>
    els.map((e) => {
      const svg = [...e.querySelectorAll("svg")].find((s) => !s.closest("button"));
      return svg?.getAttribute("class") ?? "";
    })
  );
  for (const g of glyphs) expect(g).not.toBe("");
  expect(new Set(glyphs).size).toBe(3);
});

test("TC-RUI-002e: la celda sin dato se pinta atenuada, no con el color de su categoría", async ({ page }) => {
  // @aitri-tc TC-RUI-002e
  await gotoDesk(page);
  const dashes = page.getByTestId("cell-leaf").filter({ hasText: "—" });
  const n = await dashes.count();
  expect(n, "la semilla debe dejar celdas sin ejecutado").toBeGreaterThan(0);

  const colors = await dashes.evaluateAll((els) => els.map((e) => getComputedStyle(e).color));

  // El «sin dato» usa DOS tonos neutros, y es deliberado: el del Ejecutado sale del rol muted del
  // dominio (--fg-secondary) y el del Presupuesto de --fg-muted, porque el plan es información
  // secundaria respecto de lo ejecutado. Lo que FR-1202 exige no es un único gris, sino que ninguno
  // de los dos sea el hue de la categoría: la celda vacía recede, no se identifica.
  const neutros = await Promise.all(["--fg-secondary", "--fg-muted"].map((v) => resolvedVar(page, v)));
  const typeColors = await Promise.all(TYPE_VARS.map((v) => resolvedVar(page, v)));
  for (const c of new Set(colors)) {
    expect(neutros, `em-dash con color ${c}, que no es un neutro declarado`).toContain(c);
    expect(typeColors).not.toContain(c);
  }
});

test("TC-RUI-002f: ningún elemento de la grilla deriva su color del tipo", async ({ page }) => {
  // @aitri-tc TC-RUI-002f
  await gotoDesk(page);
  const typeColors = new Set(await Promise.all(TYPE_VARS.map((v) => resolvedVar(page, v))));

  // Se barre TODO el subárbol de la grilla y del Balance: si algún nodo conservara el hue de tipo,
  // su color computado coincidiría con uno de los tres tokens.
  for (const surface of ["budget-grid", "balance-module"]) {
    const hits = await page.getByTestId(surface).evaluate(
      (root, tc: string[]) =>
        [...root.querySelectorAll("*")]
          .map((e) => ({ c: getComputedStyle(e).color, t: (e.textContent ?? "").slice(0, 20) }))
          .filter((x) => tc.includes(x.c)),
      [...typeColors]
    );
    expect(hits, `${surface}: ${JSON.stringify(hits.slice(0, 5))}`).toEqual([]);
  }
});

// ── FR-1204 · el chrome devuelve espacio a los datos ───────────────────────────
test("TC-RUI-004h: el chrome cede altura y no queda superficie que no aporte", async ({ page }) => {
  // @aitri-tc TC-RUI-004h
  //
  // El AC original pedía DOS cosas: chrome < 240 px Y más de 3 filas de Balance visibles. La primera
  // se cumple con margen (240 → 128, medido abajo). La segunda NO es alcanzable por esta vía, y se
  // midió antes de reencuadrar: a 1024×768 el reparto es 128 px de chrome + 76 de cabecera de grilla
  // + 408 de DATOS (12 filas de categorías) y sólo entonces el Balance. Los píxeles que empujan al
  // Balance bajo el pliegue son categorías del usuario, que crecen con lo que él cree — no adornos.
  // Ponerle un techo a la grilla para forzar la métrica sería pelear contra su comportamiento
  // natural. Decisión del usuario (2026-08-12): el requisito trata de QUITAR LO QUE NO APORTA, y eso
  // es lo que este TC mide. La composición del Balance queda en BL-025 para la parte 2, y BG-001
  // registra la mitad no entregada del AC.
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await expect(page.getByTestId("budget-grid")).toBeVisible();

  // 1) el chrome adelgaza: era 240 px antes del primer dato, el 31 % de la altura
  const chrome = (await page.getByTestId("budget-grid").boundingBox())!.y;
  expect(chrome, `chrome = ${chrome}px`).toBeLessThan(240);

  // 2) ninguna franja fija de ayuda o leyenda por debajo de la grilla
  await expect(page.getByTestId("grid-legend")).toHaveCount(0);

  // 3) ningún rótulo del chrome repite lo que ya dice el control de al lado. Es la regla que costó
  //    tres hallazgos: el <h1> contra la pestaña, «Presupuesto» contra «Resumen», «Agosto 2026»
  //    contra el selector que ya decía «Agosto».
  const rotulos = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="budget-grid"]');
    const out: string[] = [];
    for (const e of document.querySelectorAll("body *")) {
      if (grid?.contains(e) || e.children.length > 0) continue;
      const r = e.getBoundingClientRect();
      // >1 px en ambos ejes: el <h1> sr-only mide 1×1 y NO compite por espacio visible. Dice lo
      // mismo que la pestaña a propósito — nombra la vista para quien no la ve.
      if (r.width <= 1 || r.height <= 1) continue;
      const t = (e.textContent ?? "").trim();
      // Sólo RÓTULOS: una cifra repetida no es redundancia de vocabulario. PRESUPUESTO y RESTANTE
      // coinciden hoy porque el ejecutado es 0; con datos reales divergen.
      if (t && !/^[\d.,%$+\-—–\s]+$/.test(t)) out.push(t.toLowerCase());
    }
    return out;
  });
  const repetidos = rotulos.filter((t, i) => rotulos.indexOf(t) !== i);
  expect(repetidos, `el chrome repite: ${[...new Set(repetidos)].join(", ")}`).toEqual([]);
});

test("TC-RUI-004e: la vista tiene un solo nombre y el periodo aparece una sola vez", async ({ page }) => {
  // @aitri-tc TC-RUI-004e
  await gotoDesk(page);
  // Línea base: el encabezado decía «Presupuesto» y la pestaña de la misma vista «Resumen».
  const heading = (await page.getByTestId("page-title").textContent())?.trim();
  const activeTab = (await page.getByRole("tab", { selected: true }).first().textContent())?.trim();
  expect(heading).toBe(activeTab);

  // Línea base: la etiqueta de alcance salía aquí y otra vez como subtítulo de la primera tarjeta.
  await expect(page.getByTestId("scope-label")).toHaveCount(1);
});

test("TC-RUI-004f: la marca no se renderiza en ninguno de los dos shells", async ({ page }) => {
  // @aitri-tc TC-RUI-004f
  await gotoDesk(page);
  await expect(page.getByTestId("topbar-brand")).toHaveCount(0);
  await gotoMobile(page);
  await expect(page.getByTestId("topbar-brand")).toHaveCount(0);
});

// ── FR-1205 · la interfaz no afirma lo que no sabe ─────────────────────────────
test("TC-RUI-005h: queda una sola leyenda en pantalla", async ({ page }) => {
  // @aitri-tc TC-RUI-005h
  await gotoDesk(page);
  // Línea base: DOS leyendas — la del encabezado y la del pie, diciendo cosas distintas del mismo
  // código. La resolución final (decisión del usuario, 2026-08-12) no fue quedarse con una de las
  // dos, sino con NINGUNA franja: la clave se muda al `title` del propio glifo. «Una sola leyenda»
  // se afirma en su forma fuerte — cero superficie dedicada a explicar, una sola fuente de verdad.
  await expect(page.getByTestId("grid-legend")).toHaveCount(0);

  const titulos = await page.getByTestId("cell-glyph").evaluateAll((els) =>
    [...new Set(els.map((e) => `${(e.textContent ?? "").trim()}→${e.getAttribute("title") ?? ""}`))]
  );
  // cada símbolo tiene UNA explicación y sólo una: el vocabulario no se bifurca por sitio
  const porGlifo = new Map<string, Set<string>>();
  for (const t of titulos) {
    const [g, txt] = t.split("→");
    if (!porGlifo.has(g)) porGlifo.set(g, new Set());
    porGlifo.get(g)!.add(txt);
  }
  for (const [g, set] of porGlifo) expect(set.size, `el glifo "${g}" se explica de ${set.size} maneras`).toBe(1);
});

test("TC-RUI-005e: con datos propios, ningún texto afirma el reparto de la semilla", async ({ page }) => {
  // @aitri-tc TC-RUI-005e
  // BL-013: «Ene–May ejecutado · Jun en curso · Jul–Dic proyectado» era la tabla FACTOR de seed.ts
  // escrita a mano. Con datos reales —o al pasar de año— afirmaba algo falso con el peso de una
  // leyenda del producto. La regla que instala FR-1205: o se deriva del estado, o no existe.
  await gotoDesk(page);
  await expect(page.getByText(/Ene–May/)).toHaveCount(0);
  await expect(page.getByText(/proyectado/i)).toHaveCount(0);
  await expect(page.getByText(/en curso/i)).toHaveCount(0);
});

test("TC-RUI-005f: el pie de ayuda ya no se renderiza", async ({ page }) => {
  // @aitri-tc TC-RUI-005f
  await gotoDesk(page);
  await expect(page.getByText(/Arrastra el borde de la columna/)).toHaveCount(0);
  await expect(page.getByText(/doble clic/i)).toHaveCount(0);
});

// ── NFR-1202 · regresión: el contrato de la grilla ─────────────────────────────
test("TC-RUI-102h: regresión — el contrato de edición de la grilla se conserva", async ({ page }) => {
  // @aitri-tc TC-RUI-102h
  await gotoDesk(page);
  const grid = page.getByTestId("budget-grid");
  await grid.getByText("Comida", { exact: true }).first().click(); // expandir
  const leaf = grid.getByTestId("cell-leaf").first();
  await leaf.click();
  const editor = page.getByLabel("Editar valor");
  await editor.fill("555000");
  await editor.press("Enter");
  await expect(grid.getByTestId("cell-leaf").first()).toHaveText("555.000");

  // Escape descarta, que es la otra mitad del contrato
  const before = await grid.getByTestId("cell-leaf").first().textContent();
  await grid.getByTestId("cell-leaf").first().click();
  await page.getByLabel("Editar valor").fill("999000");
  await page.getByLabel("Editar valor").press("Escape");
  await expect(grid.getByTestId("cell-leaf").first()).toHaveText(before!);
});

test("TC-RUI-102e: regresión — sticky y scroll horizontal se conservan", async ({ page }) => {
  // @aitri-tc TC-RUI-102e
  await gotoDesk(page);
  const pos = await page.getByTestId("row-label").first().evaluate((e) => getComputedStyle(e).position);
  expect(pos).toBe("sticky");

  // la columna de etiquetas no se desplaza al mover el scroll horizontal de la grilla
  const label = page.getByTestId("row-label").first();
  const x0 = (await label.boundingBox())!.x;
  await page.getByTestId("budget-grid").evaluate((e) => { e.scrollLeft = 400; });
  const x1 = (await label.boundingBox())!.x;
  expect(Math.abs(x1 - x0), "la columna sticky se movió con el scroll").toBeLessThan(2);
});

test("TC-RUI-102f: regresión — el arrastrar-y-soltar sigue operativo", async ({ page }) => {
  // @aitri-tc TC-RUI-102f
  await gotoDesk(page);
  // Rechazo cross-type: un gasto no puede caer en el bloque de ingresos, y el rechazo NO muta.
  const vivienda = nodeRow(page, "Vivienda");
  const incomeBlock = page.locator('[data-testid="type-total-row"][data-type="income"]');
  const antes = await page.request.get("/api/v1/ledger").then((r) => r.json());
  const padreAntes = antes.state.nodes.find((n: { name: string }) => n.name === "Vivienda").parentId;

  await drag(page, vivienda.getByTestId("row-label"), incomeBlock);
  await expect(nodeRow(page, "Vivienda")).toHaveCount(1);

  // «Sin mutar» se comprueba contra la fuente de verdad, no contra la posición en pantalla: el
  // bloque de ingresos va PRIMERO en la grilla (camino de la plata: entra, sale, se aparta), así
  // que comparar coordenadas afirmaría lo contrario de lo que parece.
  const despues = await page.request.get("/api/v1/ledger").then((r) => r.json());
  const vivDespues = despues.state.nodes.find((n: { name: string }) => n.name === "Vivienda");
  expect(vivDespues.type).toBe("expense");
  expect(vivDespues.parentId).toBe(padreAntes);
});

// ── NFR-1203 · regresión: el registro conserva su color por tipo ───────────────
test("TC-RUI-103h: regresión — el registro conserva su color por tipo", async ({ page }) => {
  // @aitri-tc TC-RUI-103h
  await gotoMobile(page);
  const seen: string[] = [];
  for (const t of ["income", "expense", "transfer"]) {
    await page.getByTestId(`type-${t}`).click();
    const bg = await page.getByTestId(`type-${t}`).evaluate((e) => getComputedStyle(e).backgroundColor);
    seen.push(bg);
  }
  // los tres tipos activos se distinguen entre sí: la propagación por tipo sigue viva
  expect(new Set(seen).size, `rellenos: ${seen.join(" | ")}`).toBe(3);
});

test("TC-RUI-103e: regresión — cambiar de tipo conserva el monto y deselecciona la categoría", async ({ page }) => {
  // @aitri-tc TC-RUI-103e
  await gotoMobile(page);
  await page.getByTestId("type-expense").click();
  await page.getByTestId("amount-input").fill("12345");
  await page.getByTestId("category-row").first().click();

  await page.getByTestId("type-income").click();
  // El monto vive en el <input>, no en el texto del contenedor: `amount-display` sólo aporta el signo.
  await expect(page.getByTestId("amount-input")).toHaveValue(/12[.,]?345/); // el monto se conserva
  // la categoría del tipo anterior no sobrevive al cambio
  const selected = await page.getByTestId("category-row").evaluateAll(
    (els) => els.filter((e) => e.getAttribute("aria-pressed") === "true" || e.getAttribute("data-selected") === "true").length
  );
  expect(selected).toBe(0);
});

test("TC-RUI-103f: regresión — el registro NO adopta la tinta neutra de la grilla", async ({ page }) => {
  // @aitri-tc TC-RUI-103f
  // Es la regla de campos perceptuales (NFR-1203), no un olvido: en el registro hay UN tipo activo
  // y no se muestra estado, así que el color codifica la SELECCIÓN. Este TC existe para que nadie
  // "corrija" el registro por coherencia superficial con la grilla.
  await gotoMobile(page);
  await page.getByTestId("type-expense").click();
  const fg = await resolvedVar(page, "--fg");
  const bg = await page.getByTestId("type-expense").evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).not.toBe(fg);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
});

// ── NFR-1204 · contraste AA tras la unificación ────────────────────────────────
test("TC-RUI-104h: contraste AA en ambos temas tras la unificación", async ({ page }) => {
  // @aitri-tc TC-RUI-104h
  for (const scheme of ["light", "dark"] as const) {
    await gotoDesk(page, scheme);
    const bg = await resolvedVar(page, "--bg");
    for (const role of ["--favorable", "--alert-soft", "--alert-strong"]) {
      const c = await resolvedVar(page, role);
      expect(contrast(c, bg), `${role} sobre --bg en ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("TC-RUI-104e: el peor caso de contraste sigue siendo el medido", async ({ page }) => {
  // @aitri-tc TC-RUI-104e
  // El peor caso no es sobre el lienzo, es sobre la superficie HUNDIDA de una fila resaltada.
  for (const scheme of ["light", "dark"] as const) {
    await gotoDesk(page, scheme);
    const sunken = await resolvedVar(page, "--bg-sunken");
    for (const role of ["--favorable", "--alert-soft", "--alert-strong"]) {
      const c = await resolvedVar(page, role);
      expect(contrast(c, sunken), `${role} sobre --bg-sunken en ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("TC-RUI-104f: la unificación no baja el contraste de ningún par", async ({ page }) => {
  // @aitri-tc TC-RUI-104f
  // FR-1201 fusionó tres pares y en cada uno conservó el valor con MEJOR contraste medido. Los
  // literales de la línea base son los valores RETIRADOS: el rol canónico debe igualarlos o superarlos.
  const RETIRADOS: Record<string, string> = {
    "--favorable": "rgb(47, 125, 83)",    // #2f7d53, el --success antiguo
    "--alert-soft": "rgb(180, 83, 9)",    // #b45309, el --warning antiguo
    "--alert-strong": "rgb(196, 69, 62)", // #c4453e, el --error antiguo
  };
  await gotoDesk(page, "light");
  const bg = await resolvedVar(page, "--bg-sunken");
  for (const [role, retirado] of Object.entries(RETIRADOS)) {
    const ahora = await resolvedVar(page, role);
    expect(contrast(ahora, bg), `${role}: ${ahora} vs retirado ${retirado}`).toBeGreaterThanOrEqual(contrast(retirado, bg));
  }
});
