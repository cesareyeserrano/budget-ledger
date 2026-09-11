/**
 * Module: tests/e2e/helpers/globalSetup
 * Purpose: Levanta el entorno de la suite e2e principal: Postgres 16 efímero (testcontainers),
 *   migraciones, la app Next de producción, y UNA sesión autenticada cuyo storageState reutilizan
 *   todos los specs.
 *
 *   POR QUÉ EXISTE (feature servidor-fuente-unica, FR-1102/NFR-1104): hasta ahora esta suite corría
 *   con NEXT_PUBLIC_LEDGER_SERVER_MODE=false, es decir, contra la app en modo localStorage y SIN
 *   login — la config lo forzaba explícitamente "para que la grilla renderice sin LoginGate". Al
 *   retirar ese modo, los 246 tests aterrizarían en el formulario de acceso. Ahora corren
 *   autenticados contra Postgres, que además es lo que hace un usuario real: antes verificaban un
 *   modo que nadie iba a usar.
 *
 * Dependencies: @testcontainers/postgresql, drizzle-orm, postgres, @playwright/test
 */
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { request as playwrightRequest } from "@playwright/test";
import postgres from "postgres";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, openSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3220);
export const E2E_BASE = `http://localhost:${E2E_PORT}`;
export const STATE_FILE = path.join(os.tmpdir(), "ledger-e2e-state.json");
/** Log del servidor de la suite. Ver BG-016: NO puede ir al stdio heredado. */
export const APP_LOG = path.join(os.tmpdir(), "ledger-e2e-app.log");

/**
 * UNA CUENTA POR WORKER — no es un lujo, es corrección.
 *
 * Con localStorage cada test tenía su almacén privado (contexto de navegador limpio). Postgres es
 * COMPARTIDO: si todos los workers usaran la misma cuenta, la siembra de un test sobrescribiría el
 * estado de otro a media ejecución, porque seedLedger hace un PUT de snapshot completo. Eso produce
 * fallos intermitentes que dependen del orden — el peor tipo de flakiness.
 *
 * Aislar por cuenta funciona porque la API filtra por ownerId (FR-505): dos cuentas no se ven.
 * Debe coincidir con `workers` de playwright.config.ts (se crean de más por seguridad).
 */
export const E2E_WORKERS = 4;
export const E2E_PASSWORD = "Ledger-e2e-2026!";

/**
 * BG-036 — NAMESPACE DE CUENTAS, porque el aislamiento por worker no llegaba lo bastante lejos.
 *
 * LO QUE DE VERDAD SE COMPARTÍA ERA EL storageState, NO LA BASE. Conviene dejarlo escrito con
 * precisión, porque la primera versión de este comentario afirmaba que las dos suites compartían
 * cuentas de Postgres y ESO ES FALSO: la línea 101 de este mismo fichero arranca un
 * PostgreSqlContainer POR SUITE, así que cada una tiene su base efímera y sus propias cuentas
 * e2e-w0..w3. Por ahí no había colisión.
 *
 * La que sí había es este fichero de cookie: `storageStatePath` vivía en os.tmpdir() con sólo el
 * índice de worker en el nombre. Cuando `aitri verify-run` lanza las DOS suites a la vez —la corrida
 * Playwright autodetectada y el gate `e2e.sh`, que es la suite completa otra vez—, las dos escribían
 * `ledger-e2e-storage-state-w0.json`. Y cada cookie es válida SÓLO contra la base de SU suite, así
 * que la que escribía segunda dejaba a la primera autenticándose contra una cuenta que en su base no
 * existe. tmpdir es el único estado que las dos suites veían de verdad.
 *
 * El namespace se aplica también al email. Ahí es redundante —bases distintas ya los separan— pero
 * se mantiene por simetría y porque sale de la misma variable: un namespace por suite, un juego de
 * recursos por suite.
 *
 * OJO, ESTO NO ARREGLA LA CLASE ENTERA. Con las cinco corridas de verify-run solapadas a mano el
 * 2026-09-09, el gate pasó limpio (429/429, cero 422) pero la corrida autodetectada se hundió con
 * 972 respuestas 422 y 30 minutos de reloj. Queda causa abierta y el candidato medido es la MEMORIA
 * DE DOCKER: 3,82 GB en total para los tres contenedores de desarrollo más DOS stacks e2e completos
 * (un Postgres y un Mailpit por suite) más los de la integración de backend. Dos suites Playwright
 * completas a la vez no caben, y por eso la receta operativa sigue siendo una unidad cada vez.
 */
const E2E_NS = process.env.E2E_ACCOUNT_NS ?? "";
export const e2eEmail = (worker: number) => `e2e-${E2E_NS}w${worker}@ledger.test`;
export const storageStatePath = (worker: number) =>
  path.join(os.tmpdir(), `ledger-e2e-storage-state-${E2E_NS}w${worker}.json`);

/**
 * ¿Hay alguien escuchando ya en el puerto de la suite? (BG-016)
 *
 * Es la MISMA lección que `smoke.sh` aprendió en BG-014: con el puerto ocupado por otro proceso,
 * `next start` muere con EADDRINUSE y lo que respondía a los curl era el servidor ajeno. Aquí el
 * síntoma era distinto pero igual de caro: se esperaban 180 s por un `/health` que nunca iba a ser
 * el nuestro, y el diagnóstico quedaba enterrado bajo un timeout genérico. Fallar en voz alta.
 */
async function portIsBusy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // aún no está arriba
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`La app no respondió /health en ${timeoutMs}ms`);
}

export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const databaseUrl = container.getConnectionUri();

  const migrationClient = postgres(databaseUrl, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  await migrationClient.end();

  // Servidor SMTP de pruebas (feature recuperar-acceso). La app lo necesita configurado para que el
  // flujo de recuperación esté disponible; sin él la fachada respondería 503 y los specs del flujo
  // verificarían la pantalla de "no disponible" en vez del camino real.
  const mailpit = await new GenericContainer("axllent/mailpit:latest")
    .withExposedPorts(1025, 8025)
    .withEnvironment({ MP_SMTP_AUTH_ACCEPT_ANY: "1", MP_SMTP_AUTH_ALLOW_INSECURE: "1" })
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const mailpitApi = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`;

  // Ya no se inlinea ningún NEXT_PUBLIC_LEDGER_SERVER_MODE: el modo desapareció (FR-1101).
  const buildEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: "e2e-secret-not-for-production-000000000000",
    BETTER_AUTH_URL: E2E_BASE,
    NEXT_PUBLIC_GOOGLE_ENABLED: "false",
    // BG-028 — el valor del entorno MANDA, y por eso no es un literal.
    //
    // `buildEnv` hace spread de `...process.env` arriba, así que un literal aquí lo pisa siempre.
    // Con el literal, el `export NEXT_DIST_DIR` de e2e.sh no hacía NADA: su cabecera promete que
    // «la suite del gate compila y sirve en su propio distDir y su propio puerto», y solo la mitad
    // del puerto era cierta. Las dos corridas concurrentes que lanza `verify-run` —la Playwright
    // autodetectada y la del gate e2e— compilaban las dos sobre el MISMO `.next-e2e` y se pisaban
    // los artefactos a mitad de build.
    //
    // El fallback conserva el comportamiento de quien no define la variable (la corrida suelta,
    // `npx playwright test` a mano), que sigue compilando en `.next-e2e` como siempre.
    // next.config.mjs:10 ya leía `process.env.NEXT_DIST_DIR`: el cableado existía entero y lo
    // único que faltaba era dejar pasar el valor.
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-e2e",
    // Todo el tráfico viene de 127.0.0.1: el rate limit por IP haría flaky la suite en serie.
    // Se desactiva SOLO aquí; en producción queda activo (NFR-512).
    LEDGER_RATE_LIMIT_DISABLED: "true",
    // Feature ciclos: deja que un spec fije «hoy» en el servidor con la cabecera x-ledger-today
    // (`page.setExtraHTTPHeaders`). Solo en el servidor de pruebas; producción nunca la define.
    LEDGER_TEST_OVERRIDES: "1",
    SMTP_HOST: mailpit.getHost(),
    SMTP_PORT: String(mailpit.getMappedPort(1025)),
    SMTP_USER: "ledger-e2e",
    SMTP_PASSWORD: "ledger-e2e-password",
    SMTP_FROM: "Ledger <no-reply@ledger.test>",
  };
  // Los specs leen el buzón por esta URL (se propaga a los workers vía process.env).
  process.env.MAILPIT_API = mailpitApi;
  // BG-016: comprobar ANTES de compilar. Si el puerto ya sirve, hay un servidor ajeno vivo (casi
  // siempre un huérfano de una corrida anterior interrumpida) y esta suite mediría ESE proceso.
  if (await portIsBusy(E2E_BASE)) {
    throw new Error(
      `El puerto ${E2E_PORT} ya está ocupado por otro proceso que responde /health.\n` +
        `Casi seguro es un servidor huérfano de una corrida e2e anterior (BG-016).\n` +
        `Ciérralo con:  lsof -ti :${E2E_PORT} | xargs kill\n` +
        `Se aborta a propósito: seguir mediría un servidor que no es el de esta suite.`
    );
  }

  execFileSync("npx", ["next", "build"], { cwd: process.cwd(), env: buildEnv, stdio: "inherit" });

  // BG-016 — `detached: true` NO es cosmético: crea un GRUPO DE PROCESOS propio para que el
  // teardown pueda matarlo entero con `kill(-pid)`. Antes se guardaba el PID de `npx`, que lanza
  // `next-server` como HIJO suyo: matar a npx dejaba vivo al nieto, y ese nieto (a) se quedaba con
  // el puerto, tumbando la corrida siguiente con EADDRINUSE, y (b) conservaba el PIPE de stdout
  // heredado, así que el `spawnSync` con el que Aitri lanza Playwright para acreditar los TC ids
  // nunca veía el EOF y se colgaba hasta agotar su timeout — 30 min, reportados como «E2E dispatch
  // killed», con los TCs e2e en `skip` y la suite entera en verde. Verde que no acredita.
  // BG-016 — el servidor escribe a su PROPIO archivo, nunca al stdio heredado.
  //
  // Con `stdio: "inherit"` la app escribía una línea de log por petición en el mismo descriptor que
  // heredaba de quien lanzó la suite. Desde una terminal (o con la salida redirigida a un archivo)
  // eso es inofensivo. Pero `aitri verify-run` lanza Playwright con `spawnSync` y stdio de PIPE, y
  // ahí el mismo log convierte una corrida de 2 minutos en uno de más de 30: medido el 2026-08-28,
  // la suite completa tarda 2:07 con la salida a un archivo y no terminaba en 30 min por pipe.
  // Aitri la mataba por timeout, marcaba los TCs e2e como `skip` y dejaba la suite ENTERA EN VERDE
  // sin acreditar nada — verde que no acredita, el síntoma más caro de todos.
  //
  // El log no se pierde: queda en APP_LOG y el fallo de arranque lo cita, que es cuando se lee.
  const appLog = openSync(APP_LOG, "w");
  const app = spawn("npx", ["next", "start", "-p", String(E2E_PORT)], {
    cwd: process.cwd(),
    env: { ...buildEnv, NODE_ENV: "production" },
    stdio: ["ignore", appLog, appLog],
    detached: true,
  });
  // El grupo queda adjunto al proceso de Playwright igualmente: sin `unref()`, un fallo del
  // teardown no deja la suite colgada esperando al hijo.
  app.unref();

  writeFileSync(STATE_FILE, JSON.stringify({ pid: app.pid, databaseUrl, mailpitApi }));
  try {
    await waitForHealth(E2E_BASE, 180_000);
  } catch (e) {
    throw new Error(`${(e as Error).message}\nLog del servidor: ${APP_LOG}`);
  }

  // Registra UNA cuenta por worker y guarda su cookie como storageState propio.
  // Se hace por API (no por UI) a propósito: si el formulario de acceso se rompiera, queremos que
  // falle el TC del formulario, no los 246 tests de las otras features.
  for (let w = 0; w < E2E_WORKERS; w++) {
    const email = e2eEmail(w);
    const api = await playwrightRequest.newContext({ baseURL: E2E_BASE });
    const res = await api.post("/api/auth/sign-up/email", {
      data: { email, password: E2E_PASSWORD, name: `e2e-w${w}` },
    });
    if (!res.ok()) {
      // Ya existía (reuseExistingServer entre corridas locales): iniciar sesión en su lugar.
      const login = await api.post("/api/auth/sign-in/email", { data: { email, password: E2E_PASSWORD } });
      if (!login.ok()) {
        throw new Error(`No se pudo preparar la cuenta ${email}: signup HTTP ${res.status()}, signin HTTP ${login.status()}`);
      }
    }
    await api.storageState({ path: storageStatePath(w) });
    await api.dispose();
  }
}
