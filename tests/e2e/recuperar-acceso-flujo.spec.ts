/**
 * EP-05 — El recorrido completo, de extremo a extremo (feature recuperar-acceso).
 * TCs: FR-1305 (023f) · FR-1307 (029h) · FR-1309 (040h) · NFR-1304 (210h)
 *      · NFR-1308 (222h,223e,224f) · NFR-1310 (228h,229e,230f)
 *
 * Aquí se comprueba el North Star: el titular que olvidó su contraseña vuelve a entrar SIN
 * intervención de nadie. El correo se lee del buzón real (Mailpit) y el enlace se abre como lo
 * abriría una persona — nada de inventarse el token, porque entonces el caso dejaría de probar
 * justamente lo que importa: que el enlace que LLEGA funciona.
 *
 * Sin sesión, como el resto del flujo: estos specs NO usan el fixture con storageState.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clearMailbox, waitForResetLink } from "./helpers/mailbox";

test.use({ storageState: { cookies: [], origins: [] } });

const ROOT = process.cwd();
const PASSWORD_INICIAL = "Contra$eña123";
const PASSWORD_NUEVA = "NuevaClave9!x";

/** Direcciones únicas por test: Postgres es compartido entre workers. */
let seq = 0;
const nuevaCuenta = (): string => {
  seq += 1;
  return `flujo-${process.pid}-${seq}@example.com`;
};

/** Registra una cuenta por API y deja el contexto SIN sesión. */
async function registrar(page: Page, email: string): Promise<void> {
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { email, password: PASSWORD_INICIAL, name: "Titular" },
    failOnStatusCode: false,
  });
  expect(res.status(), "no se pudo registrar la cuenta de prueba").toBeLessThan(400);
  await page.context().clearCookies();
}

/** Solicita la recuperación desde la UI. */
async function solicitarDesdeLaUI(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("auth-form")).toBeVisible();
  await page.getByTestId("auth-forgot").click();
  await page.getByTestId("reset-email").fill(email);
  await page.getByTestId("reset-request-submit").click();
  await expect(page.getByTestId("reset-request-sent")).toBeVisible();
}

/** Fija la contraseña nueva en la pantalla que abre el enlace. */
async function fijarContrasena(page: Page, enlace: string, password: string): Promise<void> {
  await page.goto(enlace);
  await expect(page.getByTestId("reset-password-form")).toBeVisible();
  await page.getByTestId("reset-password").fill(password);
  await page.getByTestId("reset-confirm").fill(password);
  await page.getByTestId("reset-password-submit").click();
  await expect(page.getByTestId("reset-done")).toBeVisible();
}

/** Entra por la UI y espera a que monte la app. */
async function entrar(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("auth-form")).toBeVisible();
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("auth-form")).toHaveCount(0, { timeout: 20_000 });
}

// ═════════════════════════════════════════════════════════════════════════════
test.describe("El recorrido completo", () => {
  test("TC-REC-029h: solicitar, abrir el enlace, fijar contraseña y entrar con ella", async ({ page }) => {
    // @aitri-tc TC-REC-029h
    const email = nuevaCuenta();
    await registrar(page, email);
    await clearMailbox();

    await solicitarDesdeLaUI(page, email);
    const enlace = await waitForResetLink(email);
    await fijarContrasena(page, enlace, PASSWORD_NUEVA);

    await expect(page.getByRole("heading", { name: "Contraseña actualizada" })).toBeVisible();
    await expect(page.getByTestId("reset-done")).toContainText("Se han cerrado las sesiones abiertas");

    await page.getByTestId("reset-goto-login").click();
    await entrar(page, email, PASSWORD_NUEVA);
    // Dentro: el shell de la app está montado.
    await expect(page.getByTestId("budget-grid")).toBeVisible({ timeout: 20_000 });
  });

  test("TC-REC-228h: el recorrido se completa sin consola, sin base de datos y sin ayuda", async ({ page }) => {
    // @aitri-tc TC-REC-228h
    // Los cuatro pasos VISIBLES: solicitar · abrir el correo · fijar · entrar. Nada aquí toca la
    // base de datos ni ejecuta nada en la consola del navegador: es lo que hace una persona.
    const email = nuevaCuenta();
    await registrar(page, email);
    await clearMailbox();

    await solicitarDesdeLaUI(page, email); // 1
    const enlace = await waitForResetLink(email); // 2 — el buzón, como el titular
    await fijarContrasena(page, enlace, PASSWORD_NUEVA); // 3
    await page.getByTestId("reset-goto-login").click();
    await entrar(page, email, PASSWORD_NUEVA); // 4

    await expect(page.getByTestId("budget-grid")).toBeVisible({ timeout: 20_000 });

    // La contraseña vieja ya no sirve: la recuperación fue real, no cosmética.
    // Se limpian las cookies antes de comprobarlo: con la sesión recién abierta en el contexto,
    // Better Auth rechaza el intento con 403 antes de llegar a verificar credenciales, y eso
    // probaría otra cosa distinta de la que interesa aquí.
    await page.context().clearCookies();
    const res = await page.request.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD_INICIAL },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(401);
    // Y la nueva sí entra, desde el mismo contexto limpio.
    const ok = await page.request.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD_NUEVA },
      failOnStatusCode: false,
    });
    expect(ok.status()).toBe(200);
  });

  test("TC-REC-040h: una sesión abierta en otro contexto deja de servir tras la recuperación", async ({ page, browser }) => {
    // @aitri-tc TC-REC-040h
    const email = nuevaCuenta();
    await registrar(page, email);

    // Contexto A: sesión viva.
    const ctxA = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const pageA = await ctxA.newPage();
    await entrar(pageA, email, PASSWORD_INICIAL);
    await expect(pageA.getByTestId("budget-grid")).toBeVisible({ timeout: 20_000 });
    expect((await pageA.request.get("/api/v1/ledger", { failOnStatusCode: false })).status()).toBe(200);

    // Contexto B: recupera la contraseña.
    await clearMailbox();
    await solicitarDesdeLaUI(page, email);
    const enlace = await waitForResetLink(email);
    await fijarContrasena(page, enlace, PASSWORD_NUEVA);

    // La siguiente petición de A ya no pasa.
    const res = await pageA.request.get("/api/v1/ledger", { failOnStatusCode: false });
    expect(res.status()).toBe(401);
    // Y su UI vuelve a pedir credenciales.
    await pageA.reload();
    await expect(pageA.getByTestId("auth-form")).toBeVisible({ timeout: 20_000 });
    await ctxA.close();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
test.describe("NFR-1304 / FR-1305 — el cliente sigue sin salir a Internet", () => {
  test("TC-REC-023f: durante el flujo el navegador no emite ninguna petición externa", async ({ page }) => {
    // @aitri-tc TC-REC-023f
    const email = nuevaCuenta();
    await registrar(page, email);
    await clearMailbox();

    const propio = new URL(page.context()._options?.baseURL ?? "http://localhost:3220").origin;
    const externas: string[] = [];
    page.on("request", (r) => {
      const o = new URL(r.url()).origin;
      if (o !== propio && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) externas.push(r.url());
    });

    await solicitarDesdeLaUI(page, email);
    const enlace = await waitForResetLink(email);
    await fijarContrasena(page, enlace, PASSWORD_NUEVA);

    expect(externas, `peticiones externas: ${externas.join(", ")}`).toEqual([]);
  });

  test("TC-REC-210h: el recorrido completo, tema incluido, mantiene el cliente en cero externas", async ({ page }) => {
    // @aitri-tc TC-REC-210h
    const email = nuevaCuenta();
    await registrar(page, email);
    await clearMailbox();

    const propio = new URL(page.context()._options?.baseURL ?? "http://localhost:3220").origin;
    const externas: string[] = [];
    page.on("request", (r) => {
      const o = new URL(r.url()).origin;
      if (o !== propio && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) externas.push(r.url());
    });

    // Cargar, cambiar de tema, y recorrer el flujo entero hasta entrar.
    await page.emulateMedia({ colorScheme: "dark" });
    await solicitarDesdeLaUI(page, email);
    await page.emulateMedia({ colorScheme: "light" });
    const enlace = await waitForResetLink(email);
    await fijarContrasena(page, enlace, PASSWORD_NUEVA);
    await page.getByTestId("reset-goto-login").click();
    await entrar(page, email, PASSWORD_NUEVA);

    expect(externas, `peticiones externas: ${externas.join(", ")}`).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
test.describe("NFR-1310 — el flujo es recorrible sin ayuda", () => {
  test("TC-REC-229e: los cuatro estados muestran texto en español que dice qué pasó y qué hacer", async ({ page }) => {
    // @aitri-tc TC-REC-229e
    const email = nuevaCuenta();
    await registrar(page, email);
    await clearMailbox();

    // 1 · en curso
    await page.goto("/");
    await page.getByTestId("auth-forgot").click();
    await page.route("**/api/v1/recovery/request", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.getByTestId("reset-email").fill(email);
    await page.getByTestId("reset-request-submit").click();
    await expect(page.getByTestId("reset-request-submit")).toHaveText("Enviando…");

    // 2 · acuse neutro — el título nombra qué pasó, el párrafo qué esperar.
    await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();
    await expect(page.getByTestId("reset-request-sent")).toContainText("Si esa dirección tiene una cuenta");
    await expect(page.getByTestId("reset-request-sent")).toContainText("30 minutos");
    await page.unroute("**/api/v1/recovery/request");

    // 3 · enlace muerto, con su acción siguiente
    await page.goto("/recuperar?error=INVALID_TOKEN");
    await expect(page.getByTestId("reset-dead")).toContainText("Este enlace ya no sirve");
    await expect(page.getByTestId("reset-request-new")).toHaveText("Pedir un enlace nuevo");

    // 4 · fallo de envío, con su acción siguiente
    await page.goto("/");
    await page.getByTestId("auth-forgot").click();
    await page.route("**/api/v1/recovery/request", (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"SEND_FAILED"}' })
    );
    await page.getByTestId("reset-email").fill(email);
    await page.getByTestId("reset-request-submit").click();
    await expect(page.getByTestId("reset-request-error")).toContainText("Inténtalo de nuevo");
    // La dirección escrita se conserva: reintentar es una sola pulsación.
    await expect(page.getByTestId("reset-email")).toHaveValue(email);
  });

  test("TC-REC-230f: ningún mensaje de error se queda en un 'Error' genérico", async ({ page }) => {
    // @aitri-tc TC-REC-230f
    const mensajes: string[] = [];

    // a) email inválido
    await page.goto("/");
    await page.getByTestId("auth-forgot").click();
    await page.getByTestId("reset-request-submit").click();
    mensajes.push((await page.getByTestId("reset-request-error").innerText()).trim());

    // b) fallo de envío
    await page.route("**/api/v1/recovery/request", (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"SEND_FAILED"}' })
    );
    await page.getByTestId("reset-email").fill("alguien@example.com");
    await page.getByTestId("reset-request-submit").click();
    mensajes.push((await page.getByTestId("reset-request-error").innerText()).trim());
    await page.unroute("**/api/v1/recovery/request");

    // c) enlace muerto
    await page.goto("/recuperar?error=INVALID_TOKEN");
    mensajes.push((await page.getByTestId("reset-dead").innerText()).trim());

    // d) confirmación que no coincide
    await page.goto("/recuperar?token=aaaaaaaaaaaaaaaaaaaaaaaa");
    await page.getByTestId("reset-password").fill("NuevaClave9!");
    await page.getByTestId("reset-confirm").fill("NuevaClave8!");
    await page.getByTestId("reset-password-submit").click();
    mensajes.push((await page.getByTestId("reset-password-error").innerText()).trim());

    expect(mensajes).toHaveLength(4);
    for (const m of mensajes) {
      expect(m.length, `mensaje demasiado corto: "${m}"`).toBeGreaterThanOrEqual(15);
      expect(m).not.toBe("Error");
      expect(m).not.toBe("Algo salió mal");
      expect(m.toLowerCase()).not.toMatch(/^error$/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
test.describe("NFR-1308 — los tests nuevos entran en la corrida por defecto", () => {
  const leer = (p: string): string => readFileSync(path.join(ROOT, p), "utf8");

  test("TC-REC-222h: el workflow dispara en push a main y ejecuta la suite completa", async () => {
    // @aitri-tc TC-REC-222h
    const ci = leer(".github/workflows/ci.yml");
    expect(ci).toMatch(/on:[\s\S]*push:[\s\S]*branches:\s*\[main\]/);
    expect(ci).toContain("npm run test:run"); // unit + integration (incluye backend)
    expect(ci).toContain("npm run test:e2e"); // e2e por defecto
    expect(ci).toContain("npm run typecheck");
    expect(ci).toContain("npm run lint");
  });

  test("TC-REC-223e: los e2e de la feature viven en el directorio de la corrida por defecto", async () => {
    // @aitri-tc TC-REC-223e
    // La lección de este proyecto: tests/e2e-backend usa SU PROPIA config y queda fuera de
    // `npx playwright test`. Una regresión del H1 se escondió ahí. No se repite.
    const cfg = leer("playwright.config.ts");
    expect(cfg).toMatch(/testDir:\s*"\.\/tests\/e2e"/);

    const specs = ["tests/e2e/recuperar-acceso.spec.ts", "tests/e2e/recuperar-acceso-flujo.spec.ts"];
    for (const s of specs) {
      expect(() => leer(s), `${s} no existe`).not.toThrow();
      expect(s.startsWith("tests/e2e/"), `${s} fuera del testDir por defecto`).toBe(true);
      expect(s.startsWith("tests/e2e-backend/"), `${s} en la suite que no corre por defecto`).toBe(false);
    }
  });

  test("TC-REC-224f: sin el servidor de correo de pruebas los tests de envío no correrían", async () => {
    // @aitri-tc TC-REC-224f
    //
    // DESVIACIÓN DECLARADA respecto al texto del caso aprobado, que pedía un bloque `services:` en
    // el workflow con puertos fijos. Este proyecto arranca su infraestructura de test con
    // testcontainers (así levanta Postgres desde la feature backend), con puertos DINÁMICOS. Un
    // `services:` fijo añadiría un segundo Mailpit que nadie usa y dejaría el real sin declarar.
    // Se afirma la MISMA protección por el mecanismo que el proyecto sí usa: ambos arneses declaran
    // la imagen, así que si desapareciera, la suite rompería de forma ruidosa en vez de omitir los
    // tests de envío en silencio — que es lo que el caso quería impedir.
    const e2e = leer("tests/e2e/helpers/globalSetup.ts");
    const backend = leer("tests/integration/backend/helpers/globalSetup.ts");
    for (const [nombre, src] of [["e2e", e2e], ["backend", backend]] as const) {
      expect(src, `${nombre}: no declara la imagen de correo`).toContain("axllent/mailpit");
      expect(src, `${nombre}: no expone el puerto SMTP`).toContain("1025");
      expect(src, `${nombre}: no expone el puerto de la API HTTP`).toContain("8025");
    }
    // Y la app e2e recibe la configuración: sin ella la fachada respondería 503 y el flujo real
    // nunca se ejercitaría.
    for (const v of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]) {
      expect(e2e, `la app e2e no recibe ${v}`).toContain(v);
    }
  });
});
