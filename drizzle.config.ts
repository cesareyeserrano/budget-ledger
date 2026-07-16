// @aitri-trace FR-ID: FR-506, US-ID: US-506, AC-ID: AC-506a, TC-ID: TC-BE-021h
/**
 * Module: drizzle.config
 * Purpose: Config de drizzle-kit — genera y aplica migraciones SQL versionadas en drizzle/.
 *   La URL de la BD sale de DATABASE_URL (env); sin valores de host hardcodeados.
 * Dependencies: drizzle-kit
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/ledger",
  },
  verbose: true,
  strict: true,
});
