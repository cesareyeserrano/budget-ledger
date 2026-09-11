// @aitri-trace FR-ID: FR-1304, US-ID: US-1304, AC-ID: AC-1304c, TC-ID: TC-REC-018e
/**
 * Module: server/resetTokens
 * Purpose: Garantiza la invariante "como mucho UN secreto de recuperación vigente por cuenta"
 *   (FR-1304). Better Auth NO la da: cada solicitud inserta su propia fila en `verification` con
 *   identificador `reset-password:<token>`, así que dos filas del mismo usuario nunca colisionan y
 *   la anterior sigue sirviendo hasta caducar. Quien pide dos veces porque el primer correo tardó
 *   acabaría con dos enlaces vivos.
 *
 *   POR QUÉ VIVE EN SU PROPIO MÓDULO (ADR-02): la invariante es de APLICACIÓN, no de esquema — no
 *   hay índice único que pueda imponerla sin migrar una tabla de la librería. Lo que un `DELETE` en
 *   un gancho garantiza, un descuido puede borrar sin que nada chille (TRF-04), así que se aísla
 *   para poder probarlo solo, sin levantar el flujo entero.
 * Dependencies: drizzle-orm, ./db/client, ./db/schema
 */
import "server-only";
import { and, eq, like, ne } from "drizzle-orm";
import { db } from "./db/client";
import { verification } from "./db/schema";

/** Prefijo con el que Better Auth identifica las filas de recuperación en `verification`. */
const RESET_PREFIX = "reset-password:";

/**
 * Borra los secretos de recuperación anteriores de una cuenta, conservando el recién emitido.
 *
 * Se invoca desde el gancho `sendResetPassword`, que Better Auth ejecuta DESPUÉS de insertar la
 * fila nueva — por eso recibe el token a conservar en vez de borrarlo todo.
 *
 * @param userId Id de la cuenta (es lo que Better Auth guarda en `verification.value`).
 * @param keepToken Token recién emitido, el único que debe sobrevivir.
 * @returns Número de secretos anteriores invalidados (0 en la primera solicitud).
 * @throws Error si la consulta a la base de datos falla.
 */
export async function revokePrevious(userId: string, keepToken: string): Promise<number> {
  const deleted = await db
    .delete(verification)
    .where(
      and(
        eq(verification.value, userId),
        like(verification.identifier, `${RESET_PREFIX}%`),
        ne(verification.identifier, `${RESET_PREFIX}${keepToken}`)
      )
    )
    .returning({ id: verification.id });
  return deleted.length;
}

/**
 * Cuenta los secretos de recuperación vigentes de una cuenta, caducados incluidos.
 *
 * Existe para que los tests puedan afirmar la invariante contra el ALMACÉN y no contra la UI
 * (TC-REC-016h, TC-REC-018e); el flujo de producción no la necesita.
 *
 * @param userId Id de la cuenta.
 * @returns Número de filas de recuperación de esa cuenta.
 * @throws Error si la consulta a la base de datos falla.
 */
export async function countResetTokens(userId: string): Promise<number> {
  const rows = await db
    .select({ id: verification.id })
    .from(verification)
    .where(and(eq(verification.value, userId), like(verification.identifier, `${RESET_PREFIX}%`)));
  return rows.length;
}
