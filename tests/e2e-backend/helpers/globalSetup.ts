// @aitri-trace FR-ID: FR-510, US-ID: US-510, AC-ID: AC-510a, TC-ID: TC-BE-033h
/**
 * Module: tests/e2e-backend/helpers/globalSetup
 * Purpose: Levanta el entorno e2e del backend: Postgres 16 efímero (testcontainers), migraciones, y la
 *   app Next en MODO SERVIDOR (NEXT_PUBLIC_LEDGER_SERVER_MODE=true) apuntando a esa BD. Guarda el PID
 *   de la app y la URL de la BD en un archivo temporal para el teardown. El contenedor lo reap-ea Ryuk
 *   al salir del proceso.
 * Dependencies: @testcontainers/postgresql, drizzle-orm, postgres, child_process
 */
import { PostgreSqlContainer } from "@testcontainers/postgresql";
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

  // Build de producción: sin cold-compile por request (estable para el gate); SERVER_MODE se inlinea
  // en build. NEXT_DIST_DIR aísla este build del .next del dev y del e2e existente.
  const buildEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: "e2e-secret-not-for-production-000000000000",
    BETTER_AUTH_URL: E2E_BASE,
    NEXT_PUBLIC_LEDGER_SERVER_MODE: "true",
    NEXT_PUBLIC_GOOGLE_ENABLED: "false",
    NEXT_DIST_DIR: ".next-e2e-backend",
    // Todo el tráfico e2e viene de 127.0.0.1: el rate limit por IP haría flaky los tests en serie.
    // Se desactiva SOLO aquí; en producción queda activo (NFR-512), verificado en TC-BE-081f.
    LEDGER_RATE_LIMIT_DISABLED: "true",
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
