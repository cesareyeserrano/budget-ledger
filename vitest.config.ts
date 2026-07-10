import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit + integration tests only. E2E (Playwright) lives in tests/e2e and runs via `npm run test:e2e`.
export default defineConfig({
  // Transforma JSX con el runtime automático (react/jsx-runtime), como Next, para que los tests que
  // renderizan componentes en jsdom no requieran React en scope (ux-consistency FR-308).
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // verbose imprime el nombre de cada test (incluye su id TC-XXX) para que `aitri verify-run` lo mapee.
    reporters: ["verbose"],
    include: ["tests/domain/**/*.test.ts", "tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environmentMatchGlobs: [["tests/integration/**", "jsdom"]],
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/data/**"],
      reporter: ["text", "text-summary"],
      // Gate: la lógica de dominio + persistencia debe mantenerse ≥80% (actual ~94% líneas).
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
