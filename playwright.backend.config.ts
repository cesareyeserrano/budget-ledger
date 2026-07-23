import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE } from "./tests/e2e-backend/helpers/globalSetup";

// E2E del backend (FR-508..513): app en MODO SERVIDOR contra un Postgres efímero. El entorno lo
// gestiona globalSetup (levanta BD + app) / globalTeardown. Proyecto SEPARADO del e2e existente para
// no tocar su config ni su modo localStorage.
export default defineConfig({
  testDir: "./tests/e2e-backend",
  fullyParallel: false, // comparten una BD; los specs corren en serie
  workers: 1,
  retries: 1,
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./tests/e2e-backend/helpers/globalSetup.ts",
  globalTeardown: "./tests/e2e-backend/helpers/globalTeardown.ts",
  use: {
    baseURL: E2E_BASE,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
