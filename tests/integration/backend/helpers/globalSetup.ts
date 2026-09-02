// @aitri-trace FR-ID: FR-512, US-ID: US-512, AC-ID: AC-512a, TC-ID: TC-BE-040h
/**
 * Module: tests/integration/backend/helpers/globalSetup
 * Purpose: globalSetup de vitest para los tests de integración del backend. Arranca UN Postgres 16
 *   efímero (testcontainers), corre las migraciones Drizzle una vez, y PROVEE la DATABASE_URL a los
 *   workers vía `provide` (los forks no heredan process.env del setup). Destruye el contenedor al final.
 *   Aislado y portable a CI (solo requiere Docker).
 *
 *   Antes de levantar nada barre los huérfanos de corridas anteriores (ver ./sweepOrphans): Ryuk
 *   cubre el Ctrl-C, pero no que se caiga el demonio de Docker con la corrida en marcha.
 *
 *   El healthcheck de Postgres va EXPLÍCITO. El de @testcontainers/postgresql sondea cada 250 ms
 *   con CMD-SHELL durante toda la vida del contenedor: medido, son +66 forks/s por contenedor
 *   dentro de la VM, que nunca llega a idle profundo y se come la batería del portátil. A 5 s son
 *   +2,5 forks/s. El arranque no sufre porque no lo esperamos por el healthcheck sino por el log
 *   de readiness de Postgres, que además es más rápido (684 ms medidos frente a 1130 ms).
 * Dependencies: @testcontainers/postgresql, drizzle-orm, postgres
 */
import type { GlobalSetupContext } from "vitest/node";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { sweepOrphanedContainers } from "./sweepOrphans";

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
    /** Host:puerto SMTP de Mailpit, y URL base de su API HTTP para leer los mensajes entregados. */
    smtpHost: string;
    smtpPort: string;
    mailpitApi: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;
let mailpit: StartedTestContainer | undefined;

export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  await sweepOrphanedContainers();

  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withHealthCheck({
      test: ["CMD-SHELL", "PGPASSWORD=test pg_isready --host localhost --username test --dbname test"],
      interval: 5000,
      timeout: 2000,
      retries: 5,
      startPeriod: 10_000,
    })
    // Un waitStrategy explícito tiene prioridad sobre el healthcheck (selectWaitStrategy), así que el
    // arranque se decide por el log de readiness y el healthcheck queda sólo como señal de salud.
    // `times: 2` porque initdb arranca un servidor temporal que ya emite la línea: el primero es el
    // de la inicialización, el segundo es el servidor de verdad.
    .withWaitStrategy(
      Wait.forAll([
        Wait.forLogMessage(/database system is ready to accept connections/, 2),
        Wait.forListeningPorts(),
      ]),
    )
    .start();
  const url = container.getConnectionUri();

  const migrationClient = postgres(url, { max: 1 });
  const db = drizzle(migrationClient);
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  await migrationClient.end();

  provide("databaseUrl", url);

  // Mailpit: servidor SMTP REAL para los tests de envío (feature recuperar-acceso). No es un mock —
  // los tests afirman sobre el mensaje ENTREGADO (destinatario, cuerpo, enlace) leyéndolo por su API
  // HTTP. Un doble de nodemailer habría pasado los mismos tests con el transporte roto.
  mailpit = await new GenericContainer("axllent/mailpit:latest")
    .withExposedPorts(1025, 8025)
    .withEnvironment({ MP_SMTP_AUTH_ACCEPT_ANY: "1", MP_SMTP_AUTH_ALLOW_INSECURE: "1" })
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  provide("smtpHost", mailpit.getHost());
  provide("smtpPort", String(mailpit.getMappedPort(1025)));
  provide("mailpitApi", `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`);

  return async () => {
    await container?.stop();
    await mailpit?.stop();
  };
}
