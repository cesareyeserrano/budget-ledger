#!/usr/bin/env node
// Restablece la contraseña de una cuenta DESDE LA TERMINAL. Es la vía de recuperación del
// despliegue: quien administra Ultron tiene SSH, así que no necesita correo para volver a entrar.
//
// POR QUÉ EXISTE Y NO SE USA EL CORREO (decisión del usuario, 2026-08-27): el flujo por correo está
// construido y verificado, pero enviarlo de verdad exige un relay externo, y las dos únicas
// combinaciones que no acaban en spam son «remitente @gmail.com enviado por Gmail» o «remitente de
// un dominio propio enviado por Brevo». Sin dominio y sin querer dar credenciales de envío de la
// cuenta personal, ninguna encajaba. Esta vía no depende de terceros, no expone nada a internet y
// no tiene cuota que agotar. El flujo por correo queda DORMIDO, no borrado: sin las variables SMTP
// responde 503 y la pantalla lo avisa, así que basta configurarlas el día que haya dominio.
//
// LIMITACIÓN ACEPTADA: sólo la puede usar quien tenga acceso a la máquina. Un familiar bloqueado
// depende de que el administrador se la restablezca. Para un ledger de cuentas conocidas es un
// intercambio razonable.
//
// Uso:
//   DATABASE_URL=postgres://... node scripts/reset-password.mjs <email> [contraseña]
//   (sin contraseña, genera una aleatoria y la imprime)
import postgres from "postgres";
import { hash } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

// Los MISMOS parámetros que src/server/auth.ts (NFR-501, OWASP para argon2id). Si divergen, esta
// vía crearía hashes que el login no sabe verificar — el fallo más silencioso posible aquí.
const ARGON2_OPTS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[reset] DATABASE_URL no definida");
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error("Uso: node scripts/reset-password.mjs <email> [contraseña]");
  process.exit(1);
}

// Sin contraseña explícita se genera una: evita que el operador elija algo débil por comodidad,
// y evita que quede escrita en el historial del shell.
const nueva = process.argv[3] ?? randomBytes(12).toString("base64url");
if (nueva.length < 8) {
  console.error("[reset] la contraseña debe tener al menos 8 caracteres");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

// Se consultan por SQL crudo para no depender del build de TypeScript: este script corre con node
// directo en la Pi, igual que migrate.mjs.
try {
  const usuarios = await sql`SELECT id, email FROM "user" WHERE lower(email) = lower(${email})`;
  if (usuarios.length === 0) {
    console.error(`[reset] no existe ninguna cuenta con el correo ${email}`);
    process.exit(1);
  }
  const { id: userId } = usuarios[0];

  const cuentas = await sql`
    SELECT id FROM "account" WHERE user_id = ${userId} AND provider_id = 'credential'`;
  if (cuentas.length === 0) {
    console.error(`[reset] ${email} no tiene credenciales locales (¿entró con Google?)`);
    process.exit(1);
  }

  const hashed = await hash(nueva, ARGON2_OPTS);
  await sql`
    UPDATE "account" SET password = ${hashed}, updated_at = now()
    WHERE user_id = ${userId} AND provider_id = 'credential'`;

  // Misma garantía que revokeSessionsOnPasswordReset del flujo por correo (FR-1309): un acceso
  // obtenido ANTES del cambio no puede sobrevivir al cambio. Sin esto, restablecer por sospecha de
  // robo dejaría dentro al intruso.
  const borradas = await sql`DELETE FROM "session" WHERE user_id = ${userId} RETURNING id`;

  console.log(`[reset] contraseña restablecida para ${email}`);
  console.log(`[reset] sesiones invalidadas: ${borradas.length}`);
  if (!process.argv[3]) console.log(`\n    contraseña nueva:  ${nueva}\n`);
  console.log("[reset] entra con ella y cámbiala desde la app si quieres otra.");
} finally {
  await sql.end({ timeout: 5 });
}
