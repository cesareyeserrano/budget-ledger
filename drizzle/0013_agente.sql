-- Feature tony-ledger — la puerta para agentes (FR-3401, FR-3409, FR-3413).
--
-- UNA tabla nueva y TRES columnas nuevas en `movement`; ninguna fila existente se reescribe.
--
-- `agent_token` guarda el acceso de un agente a UNA cuenta. Del token solo se guarda su hash
-- SHA-256: el token se muestra una vez al crearlo (scripts/agent-token.mjs) y no se puede recuperar.
-- `id` no es secreto: es lo que se lista, se registra en el log y se revoca.
--
-- En `movement`, las tres columnas dicen quién registró un movimiento que no nació en la app:
--   origin_ref      → la referencia que el agente le dio (única por cuenta: un reintento no duplica).
--   agent_token_id  → el token que lo registró. SIN clave foránea a propósito: revocar o borrar un
--                     token no debe tocar el libro.
--   agent_name      → copia del nombre del token en ese momento (lo que la app muestra).
-- Las tres son NULL en todo movimiento registrado a mano, que es el valor de TODAS las filas
-- anteriores a esta migración. O las tres, o ninguna.
--
-- ROLLBACK: la imagen anterior no conoce las columnas y funciona, pero su primer PUT reescribe el
-- snapshot sin ellas: los movimientos del agente perderían su marca (el movimiento no se pierde).
-- Respaldo obligatorio antes de migrar, como desde la 0009.
--
-- Se escribe A MANO, sin `drizzle-kit generate`, por el mismo motivo que la 0009.
--
-- Idempotente (IF NOT EXISTS / DROP IF EXISTS) y aditiva.
CREATE TABLE IF NOT EXISTS "agent_token" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "agent_token_token_hash_unique" UNIQUE("token_hash"),
  CONSTRAINT "agent_token_name_ck" CHECK (char_length("name") between 1 and 60)
);

ALTER TABLE "agent_token" DROP CONSTRAINT IF EXISTS "agent_token_owner_id_user_id_fk";
ALTER TABLE "agent_token" ADD CONSTRAINT "agent_token_owner_id_user_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "agent_token_owner_idx" ON "agent_token" USING btree ("owner_id");

ALTER TABLE "movement" ADD COLUMN IF NOT EXISTS "origin_ref" text;
ALTER TABLE "movement" ADD COLUMN IF NOT EXISTS "agent_token_id" text;
ALTER TABLE "movement" ADD COLUMN IF NOT EXISTS "agent_name" text;

ALTER TABLE "movement" DROP CONSTRAINT IF EXISTS "movement_origin_ref_ck";
ALTER TABLE "movement" ADD CONSTRAINT "movement_origin_ref_ck"
  CHECK ("origin_ref" IS NULL OR char_length("origin_ref") between 1 and 128);

ALTER TABLE "movement" DROP CONSTRAINT IF EXISTS "movement_origin_ck";
ALTER TABLE "movement" ADD CONSTRAINT "movement_origin_ck" CHECK (
  ("origin_ref" IS NULL AND "agent_token_id" IS NULL AND "agent_name" IS NULL)
  OR ("origin_ref" IS NOT NULL AND "agent_token_id" IS NOT NULL AND "agent_name" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "movement_owner_origin_uq"
  ON "movement" USING btree ("owner_id","origin_ref") WHERE "origin_ref" IS NOT NULL;
