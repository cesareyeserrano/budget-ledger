/**
 * Module: tests/helpers/testPostgres
 * Purpose: arranca el Postgres efímero de las suites Playwright (e2e y e2e-backend) con la misma
 *   configuración que ya usaba la integración de backend (tests/integration/backend/helpers/globalSetup):
 *   - barre antes los contenedores huérfanos de corridas anteriores (sweepOrphanedContainers);
 *   - healthcheck cada 5 s, no el de 250 ms que trae @testcontainers/postgresql por defecto. Un
 *     huérfano con ese healthcheck lanzaba ~148 procesos por segundo dentro de la VM de Docker
 *     (medido el 2026-09-02) y la tenía despierta sin fin;
 *   - arranque decidido por el log de readiness y un margen de 120 s para una máquina ocupada (BG-032).
 *   Al terminar, el contenedor lo borra Ryuk con el resto de la sesión de Testcontainers.
 * Dependencies: @testcontainers/postgresql, testcontainers
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Wait } from "testcontainers";
import { sweepOrphanedContainers } from "../integration/backend/helpers/sweepOrphans";

export async function startTestPostgres(): Promise<StartedPostgreSqlContainer> {
  await sweepOrphanedContainers();
  return new PostgreSqlContainer("postgres:16-alpine")
    .withHealthCheck({
      test: ["CMD-SHELL", "PGPASSWORD=test pg_isready --host localhost --username test --dbname test"],
      interval: 5000,
      timeout: 2000,
      retries: 5,
      startPeriod: 10_000,
    })
    // `times: 2`: initdb arranca un servidor temporal que ya emite la línea; el segundo es el de verdad.
    .withWaitStrategy(
      Wait.forAll([Wait.forLogMessage(/database system is ready to accept connections/, 2), Wait.forListeningPorts()]),
    )
    .withStartupTimeout(120_000)
    .start();
}
