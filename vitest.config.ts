import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit + integration tests. E2E (Playwright) vive en tests/e2e y corre vía `npm run test:e2e`.
// Dos proyectos: "app" (dominio/unit/integration existentes, sin cambios de comportamiento) y
// "backend" (integración del servidor contra un Postgres efímero de testcontainers, node env).
export default defineConfig({
  // Transforma JSX con el runtime automático (react/jsx-runtime), como Next, para que los tests que
  // renderizan componentes en jsdom no requieran React en scope (ux-consistency FR-308).
  // Vitest 4 transforma con oxc e ignora `esbuild` (BL-048). Sin esto oxc hereda `jsx: "preserve"`
  // de tsconfig.json —que es para Next— y los .tsx importados por los tests no se pueden analizar.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` lanza fuera de un React Server Component; en tests de node lo neutralizamos.
      "server-only": path.resolve(__dirname, "./tests/integration/backend/helpers/server-only-stub.ts"),
    },
  },
  test: {
    // verbose imprime el nombre de cada test (incluye su id TC-XXX) para que `aitri verify-run` lo mapee.
    reporters: ["verbose"],
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/data/**", "src/server/**"],
      reporter: ["text", "text-summary"],
      // Gate: dominio + persistencia + servidor ≥80% líneas.
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "app",
          environment: "node",
          include: ["tests/domain/**/*.test.ts", "tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
          exclude: ["tests/integration/backend/**"],
          // Los tests de tests/integration/ corren en jsdom: cada fichero lo declara en su cabecera
          // con `// @vitest-environment jsdom`. Vitest 4 retiró environmentMatchGlobs (BL-048), y un
          // proyecto aparte para jsdom rompería TC-CIC-135h, que fija los proyectos en app y backend.
        },
      },
      {
        extends: true,
        test: {
          name: "backend",
          environment: "node",
          include: ["tests/integration/backend/**/*.test.ts"],
          globalSetup: ["tests/integration/backend/helpers/globalSetup.ts"],
          setupFiles: ["tests/integration/backend/helpers/setupEnv.ts"],
          testTimeout: 30_000,
          hookTimeout: 180_000,
          // Los archivos backend comparten un ÚNICO Postgres y truncan en beforeEach: deben correr
          // en serie, uno por uno, sin pisarse los datos. Vitest 4 retiró poolOptions.singleFork
          // (BL-048): fileParallelism:false fija un solo worker y conserva el aislamiento por fichero.
          fileParallelism: false,
        },
      },
    ],
  },
});
