#!/usr/bin/env node
// @aitri-trace FR-ID: FR-3401, US-ID: US-3401, AC-ID: AC-3401a, TC-ID: TC-AGT-010h, TC-AGT-012f, TC-AGT-013f
// @aitri-trace FR-ID: FR-3402, US-ID: US-3402, AC-ID: AC-3402a, TC-ID: TC-AGT-020h, TC-AGT-021h, TC-AGT-022f
//
// Crea, lista y revoca los tokens de la puerta para agentes (/api/agent/v1) DESDE LA TERMINAL.
//
// POR QUÉ ES UN COMANDO Y NO UNA PANTALLA (decisión del usuario, 2026-10-10): un token da acceso al
// libro sin navegador. Si se pudiera fabricar desde la app, una sesión robada podría fabricarse uno;
// así, crear un token exige acceso a la máquina. No hay ninguna ruta HTTP que haga esto.
//
// El token se imprime UNA vez, al crearlo. En la base solo queda su hash SHA-256: si se pierde, se
// revoca y se crea otro. Los MISMOS formato y hash que src/server/agent/tokens.ts — si divergen,
// este comando crearía tokens que el servidor no sabe reconocer.
//
// Uso (dentro del contenedor de la app, o con DATABASE_URL a mano):
//   node scripts/agent-token.mjs create <correo> <nombre>
//   node scripts/agent-token.mjs list   <correo>
//   node scripts/agent-token.mjs revoke <id>
import postgres from "postgres";
import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "tla_";
const TOKEN_BYTES = 32;
const ID_PREFIX = "agt_";
const ID_BYTES = 9;
const NAME_MAX = 60;

const USO = [
  "Uso:",
  "  node scripts/agent-token.mjs create <correo> <nombre>",
  "  node scripts/agent-token.mjs list   <correo>",
  "  node scripts/agent-token.mjs revoke <id>",
].join("\n");

/** Termina con un mensaje en stderr y código 1. */
function fallar(mensaje) {
  console.error(`[agent-token] ${mensaje}`);
  process.exitCode = 1;
}

const url = process.env.DATABASE_URL;
const [comando, ...args] = process.argv.slice(2);

if (!url) {
  fallar("DATABASE_URL no definida");
} else if (!["create", "list", "revoke"].includes(comando ?? "")) {
  console.error(USO);
  process.exitCode = 1;
} else {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (comando === "create") await crear(sql, args[0], args[1]);
    else if (comando === "list") await listar(sql, args[0]);
    else await revocar(sql, args[0]);
  } catch (err) {
    fallar(`falló: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Busca la cuenta por correo. El mensaje de fallo no nombra ninguna otra cuenta. */
async function cuentaDe(sql, correo) {
  if (!correo) {
    fallar("falta el correo de la cuenta");
    return null;
  }
  const filas = await sql`SELECT id FROM "user" WHERE lower(email) = lower(${correo})`;
  if (filas.length === 0) {
    fallar("no existe ninguna cuenta con ese correo");
    return null;
  }
  return filas[0].id;
}

/** create <correo> <nombre>: genera el token, guarda su hash y lo imprime una sola vez. */
async function crear(sql, correo, nombre) {
  const limpio = (nombre ?? "").trim();
  if (limpio.length < 1 || limpio.length > NAME_MAX) {
    fallar(`el nombre del token es obligatorio y tiene como máximo ${NAME_MAX} caracteres`);
    return;
  }
  const ownerId = await cuentaDe(sql, correo);
  if (!ownerId) return;

  const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const id = ID_PREFIX + randomBytes(ID_BYTES).toString("base64url");
  await sql`INSERT INTO agent_token (id, owner_id, name, token_hash) VALUES (${id}, ${ownerId}, ${limpio}, ${hash})`;

  console.log(`Token creado: ${id} («${limpio}»)`);
  console.log("");
  console.log(token);
  console.log("");
  console.log("Guárdalo ahora: no se vuelve a mostrar. Si se pierde, revócalo y crea otro.");
}

/** list <correo>: nombre, id, creado, último uso y estado. Nunca el token ni su hash. */
async function listar(sql, correo) {
  const ownerId = await cuentaDe(sql, correo);
  if (!ownerId) return;
  const filas = await sql`
    SELECT id, name, created_at, last_used_at, revoked_at
    FROM agent_token WHERE owner_id = ${ownerId} ORDER BY created_at`;
  if (filas.length === 0) {
    console.log("Esta cuenta no tiene tokens.");
    return;
  }
  const iso = (d) => (d ? new Date(d).toISOString() : "nunca");
  for (const f of filas) {
    const estado = f.revoked_at ? `revocado ${iso(f.revoked_at)}` : "activo";
    console.log(`${f.id}  «${f.name}»  creado ${iso(f.created_at)}  último uso ${iso(f.last_used_at)}  ${estado}`);
  }
}

/** revoke <id>: desde la siguiente petición ese token deja de entrar. */
async function revocar(sql, id) {
  if (!id) {
    fallar("falta el id del token (agt_…)");
    return;
  }
  const filas = await sql`
    UPDATE agent_token SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL RETURNING id, name`;
  if (filas.length === 0) {
    fallar("no hay ningún token activo con ese id");
    return;
  }
  console.log(`Token revocado: ${filas[0].id} («${filas[0].name}»). Deja de funcionar de inmediato.`);
}
