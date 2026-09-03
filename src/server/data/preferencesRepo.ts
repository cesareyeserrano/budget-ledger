// @aitri-trace server:preferencesRepo — FR-1907: la preferencia de horizonte, en la cuenta.
//
// Módulo:       src/server/data/preferencesRepo.ts
// Propósito:    Leer y escribir el horizonte de planeación del usuario (12 o 24 meses).
// Dependencias: ../db/client, ../db/schema, @/domain/range.
//
// Deliberadamente APARTE de `ledgerRepo`: el horizonte NO es parte del ledger. Si viviera en el
// snapshot, cambiarlo subiría `revision` y haría chocar el guardado de otro dispositivo por un
// ajuste de presentación — exactamente lo que FR-1907 prohíbe.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { user } from "../db/schema";
import { normalizeHorizon, DEFAULT_HORIZON, type Horizon } from "@/domain/range";

/**
 * El horizonte del usuario. Un valor corrupto en la base (o un usuario sin fila) cae al defecto
 * sin lanzar: una preferencia ilegible no puede impedir que la app arranque (FR-1907, TC-MAN-062f).
 */
export async function getHorizon(ownerId: string): Promise<Horizon> {
  const rows = await db.select({ horizon: user.horizon }).from(user).where(eq(user.id, ownerId));
  return rows.length === 0 ? DEFAULT_HORIZON : normalizeHorizon(rows[0].horizon);
}

/** Fija el horizonte. Devuelve el valor efectivamente guardado, ya normalizado. */
export async function setHorizon(ownerId: string, value: number): Promise<Horizon> {
  const h = normalizeHorizon(value);
  await db.update(user).set({ horizon: h }).where(eq(user.id, ownerId));
  return h;
}
