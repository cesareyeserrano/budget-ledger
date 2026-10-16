/**
 * Module: tests/e2e/helpers/agente
 * Purpose: Lo que las pruebas e2e de la puerta para agentes (feature tony-ledger) necesitan contra
 *   el servidor REAL: crear un token para la cuenta del worker —igual que lo hace
 *   scripts/agent-token.mjs: solo el hash llega a la base— y un cliente HTTP SIN cookies que se
 *   identifica con ese token, como lo haría el agente.
 * Dependencies: @playwright/test, node:crypto, ./pg, ./globalSetup
 */
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./pg";
import { E2E_BASE } from "./globalSetup";

/** Base de la superficie del agente. */
export const AGENT = "/api/agent/v1";

/**
 * Crea un token activo para la cuenta `email` y devuelve el token en claro y su id.
 * Los tokens anteriores con el mismo nombre se retiran: cada prueba empieza con el suyo.
 */
export async function crearToken(email: string, name = "Agent-L"): Promise<{ token: string; id: string }> {
  const sql = db();
  if (!sql) throw new Error("crearToken: no hay base de la suite e2e (¿corrió el globalSetup?)");
  const [cuenta] = await sql<{ id: string }[]>`SELECT id FROM "user" WHERE email = ${email}`;
  if (!cuenta) throw new Error(`crearToken: no existe la cuenta ${email}`);
  const token = "tla_" + randomBytes(32).toString("base64url");
  const id = "agt_" + randomBytes(9).toString("base64url");
  await sql`DELETE FROM agent_token WHERE owner_id = ${cuenta.id} AND name = ${name}`;
  await sql`INSERT INTO agent_token (id, owner_id, name, token_hash)
            VALUES (${id}, ${cuenta.id}, ${name}, ${createHash("sha256").update(token).digest("hex")})`;
  return { token, id };
}

/** Un cliente HTTP sin cookies ni sesión; con `token`, se identifica como el agente. */
export async function clienteAgente(token?: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: E2E_BASE,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: token ? { authorization: `Bearer ${token}` } : {},
  });
}
