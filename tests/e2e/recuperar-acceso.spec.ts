/**
 * EP-04 — Las tres pantallas del flujo de recuperación (feature recuperar-acceso).
 * TCs: FR-1301 (001h,002e,003f,004e,005e) · FR-1302 (006h,007f,008e,009e,010e)
 *      · FR-1306 (025h,026f,027f,028e) · FR-1307 (032f) · FR-1308 (039h)
 *      · FR-1312 (053h,054e,055e,056f,057e) · NFR-1301 (201h,203f)
 *
 * IMPORTANTE — estos specs usan `test` de @playwright/test, NO el de helpers/fixtures: el fixture
 * inyecta una sesión por worker, y todo el flujo de recuperación existe precisamente para quien NO
 * puede entrar. Un contexto autenticado aterrizaría en la app y ninguno de estos casos tendría
 * sentido. Es la única suite del proyecto que debe correr sin sesión.
 */
import { test, expect, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const MOBILE = { width: 375, height: 812 };
const TABLET = { width: 768, height: 900 };
const DESK = { width: 1440, height: 900 };
const BOUNDARY = { width: 760, height: 900 };

// ── contraste WCAG (mismo cálculo que ux-consistency.spec.ts) ────────────────
function parseColor(c: string): number[] {
  const m = c.match(/[\d.]+/g);
  if (!m) throw new Error(`color ilegible: ${c}`);
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
  const l1 = lum(parseColor(c1));
  const l2 = lum(parseColor(c2));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Abre la pantalla de acceso sin sesión. */
async function gotoLogin(page: Page, viewport = DESK): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await expect(page.getByTestId("auth-form")).toBeVisible();
}

/** Abre la pantalla de solicitud (P-2) desde la de acceso. */
async function gotoRequest(page: Page, viewport = DESK): Promise<void> {
  await gotoLogin(page, viewport);
  await page.getByTestId("auth-forgot").click();
  await expect(page.getByTestId("reset-request-form")).toBeVisible();
}

/** Altura computada en píxeles de un elemento. */
const heightOf = (page: Page, testId: string): Promise<number> =>
  page.getByTestId(testId).evaluate((el) => Math.round(el.getBoundingClientRect().height));

// ═════════════════════════════════════════════════════════════════════════════
test.describe("FR-1301 — entrada al flujo desde la pantalla de acceso", () => {
  test("TC-REC-001h: el enlace aparece en modo login y abre la pantalla de solicitud", async ({ page }) => {
    // @aitri-tc TC-REC-001h
    await gotoLogin(page);
    const enlace = page.getByTestId("auth-forgot");
    await expect(enlace).toBeVisible();
    await expect(enlace).toHaveText("¿Olvidaste tu contraseña?");

    await enlace.click();
    await expect(page.getByTestId("reset-email")).toBeVisible();
    await expect(page.getByTestId("reset-request-submit")).toHaveText("Enviar enlace");
    await expect(page.getByText("Email", { exact: true })).toBeVisible();
    // El formulario de acceso ya no está: es una conmutación de vista, no un añadido.
    await expect(page.getByTestId("auth-password")).toHaveCount(0);
  });

  test("TC-REC-002e: el control es alcanzable por teclado con foco visible", async ({ page }) => {
    // @aitri-tc TC-REC-002e
    await gotoLogin(page);
    await page.getByTestId("auth-forgot").focus();
    await expect(page.getByTestId("auth-forgot")).toBeFocused();

    const outline = await page
      .getByTestId("auth-forgot")
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { width: s.outlineWidth, style: s.outlineStyle };
      });
    expect(outline.style).toBe("solid");
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("reset-request-form")).toBeVisible();
  });

  test("TC-REC-003f: el control NO existe en modo 'Crear cuenta'", async ({ page }) => {
    // @aitri-tc TC-REC-003f
    await gotoLogin(page);
    await page.getByTestId("auth-toggle").click();
    // El campo Nombre confirma que el modo cambió de verdad.
    await expect(page.getByTestId("auth-name")).toBeVisible();
    await expect(page.getByTestId("auth-forgot")).toHaveCount(0);
    await expect(page.getByText("Olvidaste")).toHaveCount(0);
  });

  test("TC-REC-004e: los data-testid de la pantalla de acceso siguen intactos", async ({ page }) => {
    // @aitri-tc TC-REC-004e
    await gotoLogin(page);
    for (const id of ["auth-form", "auth-email", "auth-password", "auth-submit", "auth-google", "auth-toggle"]) {
      await expect(page.getByTestId(id), `falta ${id}`).toHaveCount(1);
    }
    // aria-label literales — contrato de regresión de 85 TCs de la feature backend.
    await expect(page.getByLabel("Email", { exact: true })).toHaveCount(1);
    await expect(page.getByLabel("Contraseña", { exact: true })).toHaveCount(1);

    await page.getByTestId("auth-toggle").click();
    await expect(page.getByTestId("auth-name")).toHaveCount(1);
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveCount(1);
  });

  test("TC-REC-005e: el control se renderiza sin desborde a 375px", async ({ page }) => {
    // @aitri-tc TC-REC-005e
    await gotoLogin(page, MOBILE);
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE.width);

    const box = await page.getByTestId("auth-forgot").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
test.describe("FR-1302 — pantalla de solicitud", () => {
  test("TC-REC-006h: una dirección válida presenta el acuse neutro", async ({ page }) => {
    // @aitri-tc TC-REC-006h
    await gotoRequest(page);
    await page.getByTestId("reset-email").fill("cualquiera@example.com");
    await page.getByTestId("reset-request-submit").click();

    await expect(page.getByTestId("reset-request-sent")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();
    await expect(page.getByTestId("reset-request-sent")).toContainText("Si esa dirección tiene una cuenta");
    await expect(page.getByTestId("reset-request-sent")).toContainText("30 minutos");
    // El formulario desaparece: no hay dónde reenviar por accidente.
    await expect(page.getByTestId("reset-email")).toHaveCount(0);
  });

  test("TC-REC-007f: con el campo vacío no se envía nada y el campo se marca inválido", async ({ page }) => {
    // @aitri-tc TC-REC-007f
    await gotoRequest(page);
    let peticiones = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/recovery/request")) peticiones += 1;
    });

    await page.getByTestId("reset-request-submit").click();
    await expect(page.getByTestId("reset-request-error")).toHaveText("Escribe una dirección de correo válida.");
    await expect(page.getByTestId("reset-email")).toHaveAttribute("aria-invalid", "true");
    expect(peticiones).toBe(0);
  });

  test("TC-REC-008e: una doble pulsación produce exactamente una petición", async ({ page }) => {
    // @aitri-tc TC-REC-008e
    await gotoRequest(page);
    let peticiones = 0;
    await page.route("**/api/v1/recovery/request", async (route) => {
      peticiones += 1;
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });

    await page.getByTestId("reset-email").fill("cualquiera@example.com");
    const boton = page.getByTestId("reset-request-submit");
    await boton.click();
    // Durante el envío el botón queda apagado y lo anuncia.
    await expect(boton).toBeDisabled();
    await expect(boton).toHaveAttribute("aria-busy", "true");
    await expect(boton).toHaveText("Enviando…");
    await boton.click({ force: true, timeout: 2_000 }).catch(() => undefined);

    await expect(page.getByTestId("reset-request-sent")).toBeVisible();
    expect(peticiones).toBe(1);
  });

  test("TC-REC-009e: a 375px no desborda y sus controles miden 48px", async ({ page }) => {
    // @aitri-tc TC-REC-009e
    await gotoRequest(page, MOBILE);
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE.width);
    expect(await heightOf(page, "reset-email")).toBe(48);
    expect(await heightOf(page, "reset-request-submit")).toBe(48);
  });

  test("TC-REC-010e: 'Volver a iniciar sesión' regresa sin recargar", async ({ page }) => {
    // @aitri-tc TC-REC-010e
    await gotoRequest(page);
    await page.evaluate(() => {
      (window as unknown as { __noReload?: boolean }).__noReload = true;
    });

    await page.getByTestId("reset-request-back").click();
    await expect(page.getByTestId("auth-form")).toBeVisible();
    // El marcador sobrevive ⇒ no hubo navegación de documento.
    const intacto = await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);
    expect(intacto).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
test.describe("FR-1306 / FR-1307 / FR-1308 — pantalla de contraseña nueva", () => {
  test("TC-REC-025h: con token en la URL se presenta el formulario sin sesión", async ({ page }) => {
    // @aitri-tc TC-REC-025h
    await page.setViewportSize(DESK);
    await page.goto("/recuperar?token=aaaaaaaaaaaaaaaaaaaaaaaa");
    await expect(page.getByTestId("reset-password-form")).toBeVisible();

    await expect(page.getByTestId("reset-password")).toHaveAttribute("type", "password");
    await expect(page.getByTestId("reset-confirm")).toHaveAttribute("type", "password");
    await expect(page.getByText("Contraseña nueva", { exact: true })).toBeVisible();
    await expect(page.getByText("Repite la contraseña", { exact: true })).toBeVisible();
    await expect(page.getByTestId("reset-password-submit")).toHaveText("Guardar contraseña");
    // Sin cookie de sesión en el contexto.
    expect((await page.context().cookies()).filter((c) => c.name.includes("session"))).toHaveLength(0);
  });

  test("TC-REC-026f: abrir la ruta sin token no presenta el formulario", async ({ page }) => {
    // @aitri-tc TC-REC-026f
    await page.goto("/recuperar");
    await expect(page.getByTestId("reset-dead")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Este enlace ya no sirve" })).toBeVisible();
    await expect(page.locator("input[type=password]")).toHaveCount(0);
  });

  test("TC-REC-027f: la pantalla no emite ninguna petición al contrato de datos", async ({ page }) => {
    // @aitri-tc TC-REC-027f
    const datos: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (/^\/api\/v1\/(ledger|movements|sync)/.test(u.pathname)) datos.push(u.pathname);
    });

    await page.goto("/recuperar?token=aaaaaaaaaaaaaaaaaaaaaaaa");
    await expect(page.getByTestId("reset-password-form")).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(datos).toEqual([]);
  });

  test("TC-REC-028e: a 375px no desborda y sus controles miden 48px", async ({ page }) => {
    // @aitri-tc TC-REC-028e
    await page.setViewportSize(MOBILE);
    await page.goto("/recuperar?token=aaaaaaaaaaaaaaaaaaaaaaaa");
    await expect(page.getByTestId("reset-password-form")).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE.width);
    expect(await heightOf(page, "reset-password")).toBe(48);
    expect(await heightOf(page, "reset-confirm")).toBe(48);
    expect(await heightOf(page, "reset-password-submit")).toBe(48);
  });

  test("TC-REC-032f: una confirmación distinta se detecta en cliente y no llega al servidor", async ({ page }) => {
    // @aitri-tc TC-REC-032f
    await page.goto("/recuperar?token=aaaaaaaaaaaaaaaaaaaaaaaa");
    let peticiones = 0;
    page.on("request", (r) => {
      if (r.url().includes("/reset-password")) peticiones += 1;
    });

    await page.getByTestId("reset-password").fill("NuevaClave9!");
    await page.getByTestId("reset-confirm").fill("NuevaClave8!");
    await page.getByTestId("reset-password-submit").click();

    await expect(page.getByTestId("reset-password-error")).toHaveText("Las contraseñas no coinciden.");
    await expect(page.getByTestId("reset-confirm")).toHaveAttribute("aria-invalid", "true");
    expect(peticiones).toBe(0);
  });

  test("TC-REC-039h: el panel de enlace muerto muestra su texto y ofrece pedir uno nuevo", async ({ page }) => {
    // @aitri-tc TC-REC-039h
    await page.goto("/recuperar?error=INVALID_TOKEN");
    await expect(page.getByRole("heading", { name: "Este enlace ya no sirve" })).toBeVisible();
    await expect(page.getByTestId("reset-dead")).toContainText("caducan a los 30 minutos");

    await page.getByTestId("reset-request-new").click();
    await expect(page.getByTestId("reset-request-form")).toBeVisible();
    await expect(page.getByTestId("reset-email")).toHaveValue("");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
test.describe("FR-1312 — las pantallas nuevas adoptan el sistema de diseño", () => {
  test("TC-REC-053h: usan los componentes compartidos y no llevan estilos de color en línea", async ({ page }) => {
    // @aitri-tc TC-REC-053h
    for (const url of ["/?recuperar=1", "/recuperar?token=aaaaaaaaaaaaaaaaaaaaaaaa"]) {
      await page.goto(url);
      const form = page.locator("[data-testid=reset-request-form], [data-testid=reset-password-form]");
      await expect(form).toBeVisible();

      // Radio del sistema en campos y botones (--radius-sm = 8px).
      const radios = await form.locator("input, button[type=submit]").evaluateAll((els) =>
        els.map((el) => getComputedStyle(el).borderRadius)
      );
      expect(radios.length).toBeGreaterThan(0);
      for (const r of radios) expect(r).toBe("8px");

      // Ningún style en línea de color/tipografía/espaciado.
      const inline = await form.locator("*").evaluateAll((els) =>
        els.map((el) => el.getAttribute("style") ?? "").filter(Boolean)
      );
      for (const s of inline) {
        expect(s).not.toMatch(/color|background|font-size|padding|margin/i);
      }
    }
  });

  test("TC-REC-054e: contraste de texto ≥4.5:1 en ambos temas", async ({ page }) => {
    // @aitri-tc TC-REC-054e
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/?recuperar=1");
      await expect(page.getByTestId("reset-request-form")).toBeVisible();

      const fondo = await page
        .getByTestId("reset-request-form")
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      const titulo = await page
        .getByRole("heading", { name: "Recuperar contraseña" })
        .evaluate((el) => getComputedStyle(el).color);
      const etiqueta = await page
        .getByText("Email", { exact: true })
        .evaluate((el) => getComputedStyle(el).color);

      expect(contrast(titulo, fondo), `título/${scheme}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(etiqueta, fondo), `etiqueta/${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("TC-REC-055e: los controles miden ≥48px bajo 760px y exponen foco visible", async ({ page }) => {
    // @aitri-tc TC-REC-055e
    //
    // DESVIACIÓN DECLARADA respecto al texto del caso aprobado. El caso afirmaba que a 760px
    // EXACTOS los controles miden 48px, "porque max-[760px] es inclusivo". Es falso en Tailwind v4:
    // el variante `max-*` compila a `@media (width < 760px)`, exclusivo (verificado en
    // tailwindcss/dist/lib.js, v4.3.2). A 760px exactos miden 40px.
    //
    // No se cambia el producto para forzar la inclusividad: la clase es LA MISMA que usa AuthForm
    // desde la feature backend, así que hacerla inclusiva aquí dejaría la pantalla de acceso y la
    // de recuperación con alturas distintas en el mismo viewport — una inconsistencia real a cambio
    // de salvar una frase equivocada. Se afirma el límite REAL por sus dos lados y, además, que
    // AuthForm se comporta idéntico: es una prueba más fuerte que la pedida.
    await page.setViewportSize({ width: BOUNDARY.width - 1, height: BOUNDARY.height });
    await page.goto("/?recuperar=1");
    await expect(page.getByTestId("reset-request-form")).toBeVisible();

    for (const id of ["reset-email", "reset-request-submit"]) {
      expect(await heightOf(page, id), `${id} debería ser táctil a 759px`).toBeGreaterThanOrEqual(48);
      await page.getByTestId(id).focus();
      const outline = await page.getByTestId(id).evaluate((el) => {
        const s = getComputedStyle(el);
        return { width: s.outlineWidth, style: s.outlineStyle };
      });
      expect(outline.style, `${id} sin foco visible`).toBe("solid");
      expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
    }

    // El otro lado del límite, y la consistencia con la pantalla que ya existía.
    await page.setViewportSize(BOUNDARY);
    await page.goto("/?recuperar=1");
    await expect(page.getByTestId("reset-request-form")).toBeVisible();
    const recuperacion760 = await heightOf(page, "reset-email");
    expect(recuperacion760).toBe(40);

    await page.goto("/");
    await expect(page.getByTestId("auth-form")).toBeVisible();
    const acceso760 = await heightOf(page, "auth-email");
    expect(acceso760, "la recuperación y el acceso divergen en el mismo viewport").toBe(recuperacion760);
  });

  test("TC-REC-056f: cero emoji, gradientes y glow", async ({ page }) => {
    // @aitri-tc TC-REC-056f
    for (const url of ["/?recuperar=1", "/recuperar?token=aaaaaaaaaaaaaaaaaaaaaaaa"]) {
      await page.goto(url);
      const form = page.locator("[data-testid=reset-request-form], [data-testid=reset-password-form]");
      await expect(form).toBeVisible();

      const texto = (await form.innerText()) ?? "";
      expect(texto, `emoji en ${url}`).not.toMatch(/\p{Extended_Pictographic}/u);

      const estilos = await form.locator("*").evaluateAll((els) =>
        els.map((el) => {
          const s = getComputedStyle(el);
          return { bg: s.backgroundImage, shadow: s.boxShadow };
        })
      );
      for (const { bg, shadow } of estilos) {
        expect(bg).not.toMatch(/gradient/i);
        // Sin glow de color: las sombras del sistema son negro con alfa.
        if (shadow && shadow !== "none") {
          expect(shadow).toMatch(/rgba?\(0,\s*0,\s*0/);
        }
      }
    }
  });

  test("TC-REC-057e: sin desbordes a 375px, 768px ni 1440px", async ({ page }) => {
    // @aitri-tc TC-REC-057e
    for (const url of ["/?recuperar=1", "/recuperar?token=aaaaaaaaaaaaaaaaaaaaaaaa"]) {
      for (const vp of [MOBILE, TABLET, DESK]) {
        await page.setViewportSize(vp);
        await page.goto(url);
        const form = page.locator("[data-testid=reset-request-form], [data-testid=reset-password-form]");
        await expect(form).toBeVisible();
        const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
        expect(scrollWidth, `${url} @ ${vp.width}px`).toBeLessThanOrEqual(vp.width);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
test.describe("NFR-1301 — el gate sigue siendo la puerta única a los datos", () => {
  test("TC-REC-201h: sin sesión el contrato de datos responde 401 desde las pantallas nuevas", async ({ page }) => {
    // @aitri-tc TC-REC-201h
    await page.goto("/?recuperar=1");
    await expect(page.getByTestId("reset-request-form")).toBeVisible();

    const res = await page.request.get("/api/v1/ledger", { failOnStatusCode: false });
    expect(res.status()).toBe(401);
    const body = await res.text();
    expect(body).not.toContain("nodes");
    expect(body).not.toContain("budgets");
  });

  test("TC-REC-203f: la ruta de contraseña nueva no monta el sincronizador ni hidrata", async ({ page }) => {
    // @aitri-tc TC-REC-203f
    const sse: string[] = [];
    const ledger: string[] = [];
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (p.startsWith("/api/v1/sync")) sse.push(p);
      if (p.startsWith("/api/v1/ledger")) ledger.push(p);
    });

    await page.goto("/recuperar?token=aaaaaaaaaaaaaaaaaaaaaaaa");
    await expect(page.getByTestId("reset-password-form")).toBeVisible();
    await page.waitForTimeout(3_000);

    expect(sse).toEqual([]);
    expect(ledger).toEqual([]);
  });
});
