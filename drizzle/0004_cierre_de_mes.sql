-- cierre-de-mes (FR-2001, FR-2005) — el mes cerrado entra en el modelo.
--
-- PURAMENTE ADITIVA, y a proposito: dos columnas nulables y una tabla nueva. No toca ninguna
-- llave primaria (amount_cell y cell_note ya la cambiaron en 0002) ni convierte ningun dato: no
-- hay un solo cierre que migrar. Por eso, a diferencia de multi-anio, NO impone orden de
-- despliegue — el codigo viejo sigue funcionando contra la base migrada porque ignora columnas
-- que no conoce (NFR-2008, TC-CDM-270h).
--
-- La frontera es un ESCALAR (ADR-11): todo periodo <= closed_through esta cerrado. Con una marca
-- por mes, "los meses cerrados son una racha continua" seria un invariante a vigilar en cada
-- escritura; con un escalar es INDECIBLE. Un invariante que no se puede expresar no se rompe.
--
-- NO hay migracion inversa, tambien a proposito: revertir el codigo es seguro sin tocar la base, y
-- un down que borrara las columnas destruiria el rastro de closure_event dando falsa seguridad.
ALTER TABLE "ledger" ADD COLUMN "closed_through" text;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "reopened_period" text;--> statement-breakpoint

ALTER TABLE "ledger" ADD CONSTRAINT "ledger_closed_through_ck"
  CHECK ("closed_through" IS NULL OR "closed_through" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_reopened_period_ck"
  CHECK ("reopened_period" IS NULL OR "reopened_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
-- Un mes reabierto solo existe si hay frontera: no se puede reabrir lo que nunca se cerro.
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_reopened_needs_boundary_ck"
  CHECK ("reopened_period" IS NULL OR "closed_through" IS NOT NULL);--> statement-breakpoint

-- El rastro (FR-2005). Solo se le INSERTA: nunca se actualiza ni se borra, y por eso una
-- reapertura sigue constando aunque el mes se vuelva a cerrar (TC-CDM-055h).
CREATE TABLE IF NOT EXISTS "closure_event" (
  "id"       bigserial PRIMARY KEY,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "period"   text NOT NULL,
  "action"   text NOT NULL,
  "at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "closure_event_action_ck" CHECK ("action" in ('close','reopen')),
  CONSTRAINT "closure_event_period_ck" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "closure_event_owner_at_idx" ON "closure_event" ("owner_id", "at" DESC);
