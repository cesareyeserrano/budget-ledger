// @aitri-trace FR-ID: FR-512, US-ID: US-512, AC-ID: AC-512c, TC-ID: TC-BE-042f
/**
 * Module: tests/integration/backend/helpers/setupEnv
 * Purpose: setupFile (por worker) que fija las variables de entorno del backend ANTES de que los
 *   módulos de servidor se importen. La DATABASE_URL viene del globalSetup vía inject (el contenedor
 *   efímero de testcontainers). Sin esto, db/client.ts leería un process.env sin la URL en cada fork.
 * Dependencies: vitest (inject)
 */
import { inject } from "vitest";

process.env.DATABASE_URL = inject("databaseUrl");
process.env.BETTER_AUTH_SECRET ??= "test-secret-not-for-production-000000000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3100";
// Credenciales Google de test: registran el provider (para los tests de callback denegado/inválido).
// El happy path real de Google (006h/007e) NO se automatiza — se verifica manual con evidencia.
process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
// vitest ya fija NODE_ENV="test" en los workers; no lo reasignamos (es de solo-lectura en @types/node).
