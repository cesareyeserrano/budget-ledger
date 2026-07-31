import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3220";
const BASE = `http://localhost:${PORT}`;

// E2E de flujos críticos (FR-006/009/010/012/015).
//
// Feature servidor-fuente-unica: esta suite corría con NEXT_PUBLIC_LEDGER_SERVER_MODE=false —
// la app en modo localStorage y SIN login, forzado aquí "para que la grilla renderice sin
// LoginGate". Ese modo se retiró (FR-1101), así que ahora la suite corre AUTENTICADA contra
// Postgres: globalSetup levanta la base, construye y arranca la app, registra la cuenta e2e y
// guarda su cookie como storageState compartido. El webServer desapareció de aquí porque el
// arranque lo hace globalSetup (necesita la URL de la BD efímera antes de construir).
export default defineConfig({
  testDir: "./tests/e2e",
  // helpers/ no contiene specs
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Reintentos y workers acotados: verify-run corre e2e junto con coverage y el smoke-server,
  // así que se limita la concurrencia y se reintentan los timeouts por contención de recursos.
  retries: 2,
  workers: 2,
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/helpers/globalSetup.ts",
  globalTeardown: "./tests/e2e/helpers/globalTeardown.ts",
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
    // La sesión NO se fija aquí: cada worker usa su propia cuenta vía el fixture de
    // tests/e2e/helpers/fixtures.ts. Postgres es compartido, así que una cuenta global haría que
    // dos workers se sobrescribieran los datos sembrados en pleno test.
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
