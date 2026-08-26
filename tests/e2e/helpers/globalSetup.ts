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
import { writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3220);
export const E2E_BASE = `http://localhost:${E2E_PORT}`;
export const STATE_FILE = path.join(os.tmpdir(), "ledger-e2e-state.json");

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
export const e2eEmail = (worker: number) => `e2e-w${worker}@ledger.test`;
export const storageStatePath = (worker: number) =>
  path.join(os.tmpdir(), `ledger-e2e-storage-state-w${worker}.json`);

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
    NEXT_DIST_DIR: ".next-e2e",
    // Todo el tráfico viene de 127.0.0.1: el rate limit por IP haría flaky la suite en serie.
    // Se desactiva SOLO aquí; en producción queda activo (NFR-512).
    LEDGER_RATE_LIMIT_DISABLED: "true",
    SMTP_HOST: mailpit.getHost(),
    SMTP_PORT: String(mailpit.getMappedPort(1025)),
    SMTP_USER: "ledger-e2e",
    SMTP_PASSWORD: "ledger-e2e-password",
    SMTP_FROM: "Ledger <no-reply@ledger.test>",
  };
  // Los specs leen el buzón por esta URL (se propaga a los workers vía process.env).
  process.env.MAILPIT_API = mailpitApi;
  execFileSync("npx", ["next", "build"], { cwd: process.cwd(), env: buildEnv, stdio: "inherit" });

  const app = spawn("npx", ["next", "start", "-p", String(E2E_PORT)], {
    cwd: process.cwd(),
    env: { ...buildEnv, NODE_ENV: "production" },
    stdio: "inherit",
    detached: false,
  });

  writeFileSync(STATE_FILE, JSON.stringify({ pid: app.pid, databaseUrl, mailpitApi }));
  await waitForHealth(E2E_BASE, 180_000);

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
