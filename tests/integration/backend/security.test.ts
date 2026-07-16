/**
 * Epic 5 — Cifrado (NFR-511). Credenciales ilegibles en reposo (argon2id) + contrato de cifrado del
 * volumen documentado. TLS en tránsito (077h) se verifica manual con evidencia.
 * TCs: NFR-511 (078e).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";

const ROOT = process.cwd();

beforeEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestDb();
});

describe("NFR-511 — cifrado en reposo (credenciales + contrato de volumen)", () => {
  it("TC-BE-078e: las credenciales no quedan legibles en claro; el cifrado en reposo está en el contrato", async () => {
    // @aitri-tc TC-BE-078e
    const PASSWORD = "Contra$eña123";
    await signUp("ana@example.com", PASSWORD, "Ana", "10.7.0.1");

    // Inspección directa del almacenamiento: la contraseña es un hash argon2id, nunca el texto plano.
    const rows = (await testDb().execute(
      sql`SELECT password FROM "account" WHERE provider_id='credential'`
    )) as unknown as { password: string }[];
    expect(rows[0].password).toMatch(/^\$argon2id\$/);
    expect(rows[0].password).not.toContain(PASSWORD);

    // El mecanismo de cifrado en reposo de los datos financieros (volumen) es un contrato de despliegue
    // documentado (ADR-08). Debe estar declarado, no ser una promesa vacía.
    const deployment = readFileSync(path.join(ROOT, "DEPLOYMENT.md"), "utf8");
    expect(deployment).toMatch(/cifra.*volumen|volumen.*cifr/i);
    expect(deployment).toMatch(/argon2id/i);
    expect(deployment).toMatch(/TLS|HTTPS/);
  });
});
