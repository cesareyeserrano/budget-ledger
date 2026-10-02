/**
 * BG-081 (d) — el contrato del que depende el aviso de contraseña corta del registro.
 *
 * Módulo:       tests/integration/backend/bg-081-contrasena-corta.test.ts
 * Propósito:    El formulario dice «La contraseña es demasiado corta. Usa al menos 8 caracteres.» cuando
 *               el servidor responde 400 con código PASSWORD_TOO_SHORT. Ese mínimo es el de Better Auth
 *               por defecto: aquí queda fijado, para que un cambio de versión o de configuración no deje
 *               el aviso diciendo un número que el servidor ya no aplica.
 * Dependencias: handler real de Better Auth contra Postgres efímero.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { authPost } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closeTestDb(); });

const usuarios = async (email: string) =>
  Number(((await testDb().execute(sql`SELECT count(*) AS n FROM "user" WHERE email = ${email}`)) as unknown as { n: string }[])[0]!.n);

describe("BG-081 (d) · registro con contraseña corta", () => {
  it("siete caracteres: 400 PASSWORD_TOO_SHORT y no se crea la cuenta", async () => {
    const res = await authPost("/sign-up/email", { name: "Ana", email: "ana-corta@example.com", password: "Abc$123" }, { ip: "10.81.0.1" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("PASSWORD_TOO_SHORT");
    expect(await usuarios("ana-corta@example.com")).toBe(0);
  });

  it("ocho caracteres: la cuenta se crea", async () => {
    const res = await authPost("/sign-up/email", { name: "Ana", email: "ana-justa@example.com", password: "Abc$1234" }, { ip: "10.81.0.2" });
    expect(res.status).toBe(200);
    expect(await usuarios("ana-justa@example.com")).toBe(1);
  });

  it("la respuesta es la misma tenga o no cuenta ese correo: el aviso no revela nada", async () => {
    await authPost("/sign-up/email", { name: "Ana", email: "ana-existe@example.com", password: "Contra$eña123" }, { ip: "10.81.0.3" });
    const res = await authPost("/sign-up/email", { name: "Otra", email: "ana-existe@example.com", password: "corta" }, { ip: "10.81.0.4" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("PASSWORD_TOO_SHORT");
  });
});
