import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3220";
const BASE = `http://localhost:${PORT}`;

// E2E de flujos críticos (FR-006/009/010/012/015). Arranca el build de producción.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
    timeout: 180_000,
  },
});
