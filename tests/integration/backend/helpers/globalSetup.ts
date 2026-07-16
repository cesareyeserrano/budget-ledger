// @aitri-trace FR-ID: FR-512, US-ID: US-512, AC-ID: AC-512a, TC-ID: TC-BE-040h
/**
 * Module: tests/integration/backend/helpers/globalSetup
 * Purpose: globalSetup de vitest para los tests de integración del backend. Arranca UN Postgres 16
 *   efímero (testcontainers), corre las migraciones Drizzle una vez, y PROVEE la DATABASE_URL a los
 *   workers vía `provide` (los forks no heredan process.env del setup). Destruye el contenedor al final.
 *   Aislado y portable a CI (solo requiere Docker).
 * Dependencies: @testcontainers/postgresql, drizzle-orm, postgres
 */
import type { GlobalSetupContext } from "vitest/node";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const url = container.getConnectionUri();

  const migrationClient = postgres(url, { max: 1 });
  const db = drizzle(migrationClient);
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  await migrationClient.end();

  provide("databaseUrl", url);

  return async () => {
    await container?.stop();
  };
}
