import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3220";
const BASE = `http://localhost:${PORT}`;

// E2E de flujos críticos (FR-006/009/010/012/015). Arranca el build de producción.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Reintentos y workers acotados: verify-run corre e2e junto con coverage y el smoke-server,
  // así que se limita la concurrencia y se reintentan los timeouts por contención de recursos.
  retries: 2,
  workers: 2,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    // La suite e2e es la app en modo localStorage (NFR-509: SERVER_MODE OFF = cero regresión).
    // Se fuerza OFF aquí para que el build inline el modo cliente-puro y la grilla renderice sin
    // LoginGate, aunque el .env.local de la máquina tenga NEXT_PUBLIC_LEDGER_SERVER_MODE=true para
    // pruebas del backend en vivo. process.env tiene precedencia sobre .env.local (BL-006).
    env: { NEXT_PUBLIC_LEDGER_SERVER_MODE: "false" },
    // Holgado: durante `verify-run` este webServer compila bajo carga (testcontainers + otros builds).
    timeout: 300_000,
  },
});
