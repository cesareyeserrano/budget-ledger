// @aitri-trace FR-ID: FR-510, US-ID: US-510, AC-ID: AC-510a, TC-ID: TC-BE-033h
/**
 * Module: tests/e2e-backend/helpers/globalSetup
 * Purpose: Levanta el entorno e2e del backend: Postgres 16 efímero (testcontainers), migraciones, y la
 *   app Next apuntando a esa BD. Ya no inyecta ningún flag de modo: el interruptor de rollout se
 *   retiró y Postgres es la única fuente de verdad (FR-1101/NFR-1108). Guarda el PID
 *   de la app y la URL de la BD en un archivo temporal para el teardown. El contenedor lo reap-ea Ryuk
 *   al salir del proceso.
 * Dependencies: @testcontainers/postgresql, drizzle-orm, postgres, child_process
 */
import { startTestPostgres } from "../../helpers/testPostgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const E2E_PORT = 3230;
export const E2E_BASE = `http://localhost:${E2E_PORT}`;
export const STATE_FILE = path.join(os.tmpdir(), "ledger-e2e-backend-state.json");

/**
 * ¿Hay alguien escuchando ya en el puerto de la suite? (BL-074)
 *
 * La misma guarda que la suite principal tiene desde BG-016 (tests/e2e/helpers/globalSetup.ts). Sin
 * ella, con un servidor ajeno en el puerto —un huérfano de una corrida interrumpida, o el gate
 * `e2e.sh`, que usa este mismo 3230— el `next start` de abajo moría con EADDRINUSE y `waitForHealth`
 * recibía el 200 del proceso AJENO: la suite entera medía una app que no era la suya, contra una
 * base que no era la suya.
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
  // Antes de levantar nada: ni contenedor ni build tienen sentido si el puerto ya sirve.
  if (await portIsBusy(E2E_BASE)) {
    throw new Error(
      `El puerto ${E2E_PORT} ya está ocupado por otro proceso que responde /health.\n` +
        `Casi seguro es un servidor huérfano de una corrida anterior, o el gate e2e.sh en marcha.\n` +
        `Ciérralo con:  lsof -ti :${E2E_PORT} | xargs kill\n` +
        `Se aborta a propósito: seguir mediría un servidor que no es el de esta suite.`
    );
  }

  const container = await startTestPostgres();
  const databaseUrl = container.getConnectionUri();

  const migrationClient = postgres(databaseUrl, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  await migrationClient.end();

  // Build de producción: sin cold-compile por request (estable para el gate).
  // NEXT_DIST_DIR aísla este build del .next del dev y del e2e existente.
  const buildEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: "e2e-secret-not-for-production-000000000000",
    BETTER_AUTH_URL: E2E_BASE,
    NEXT_PUBLIC_GOOGLE_ENABLED: "false",
    NEXT_DIST_DIR: ".next-e2e-backend",
    // Todo el tráfico e2e viene de 127.0.0.1: el rate limit por IP haría flaky los tests en serie.
    // Se desactiva SOLO aquí; en producción queda activo (NFR-512), verificado en TC-BE-081f.
    LEDGER_RATE_LIMIT_DISABLED: "true",
    // BG-048: el interruptor de arriba solo actúa con la puerta de pruebas abierta.
    LEDGER_TEST_OVERRIDES: "1",
  };
  execFileSync("npx", ["next", "build"], { cwd: process.cwd(), env: buildEnv, stdio: "inherit" });

  const app = spawn("npx", ["next", "start", "-p", String(E2E_PORT)], {
    cwd: process.cwd(),
    env: { ...buildEnv, NODE_ENV: "production" },
    stdio: "inherit",
    detached: false,
  });

  writeFileSync(STATE_FILE, JSON.stringify({ pid: app.pid, databaseUrl }));

  await waitForHealth(E2E_BASE, 120_000);
  // Warmup: fuerza el compile de la página raíz (next dev compila on-demand) para que el primer test
  // no pague el cold-compile y agote su timeout.
  try {
    await fetch(E2E_BASE + "/");
  } catch {
    // no crítico
  }
}
