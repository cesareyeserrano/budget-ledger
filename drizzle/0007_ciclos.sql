-- Feature ciclos · FR-2401/FR-2404/FR-2408 (ADR-02, ADR-03) — el presupuesto por ciclo de pago.
--
-- DOS COSAS, ninguna toca una cifra existente:
--
-- (1) La tabla `cycle_config_version`, APPEND-ONLY: cada fila es una version de la configuracion de
--     ciclos del usuario. La ultima por `id` es la vigente (mode 'cycle' o 'month'); sin filas = modo
--     mes = todo usuario previo a la feature, byte a byte. Cambiar la configuracion es INSERTAR: los
--     ciclos cerrados nunca se recalculan (RF-07/RF-08). No hay UNIQUE sobre effective_from: activar,
--     volver y activar el mismo dia son tres filas legitimas; el orden lo da `id`.
--     NO hay columna `period_mode` en `ledger`: seria una segunda fuente de verdad sin CHECK cruzado
--     posible (revision adversarial de la fase 2, hallazgo 12). El modo se deriva de la ultima fila.
--
-- (2) Los SIETE CHECKs de formato de periodo se amplian para admitir la clave del ciclo de
--     TRANSICION «YYYY-MMt» (ADR-02): amount_cell, movement, cell_note (0002), ledger.closed_through,
--     ledger.reopened_period, closure_event (0004) y ledger.start_month (0006). Puramente ampliatorio:
--     toda fila existente sigue cumpliendo.
--
-- Idempotente por IF NOT EXISTS / DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT (criterio de 0005/0006),
-- NO por `data_version` (marca el modelo de las celdas; esto no cambia ningun dato). Reversible:
-- soltar la tabla y devolver los siete CHECKs al patron sin «t?» — solo posible si no existen claves
-- con sufijo (comprobar `SELECT count(*) FROM movement WHERE period ~ 't$'` antes de revertir).

CREATE TABLE IF NOT EXISTS "cycle_config_version" (
  "id"                  bigserial PRIMARY KEY,
  "owner_id"            text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "mode"                text NOT NULL,
  "anchor_day"          integer,
  "eom_policy"          text,
  "effective_from"      date NOT NULL,
  "first_pay"           date,
  "restore_start_month" text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cycle_cfg_mode_ck" CHECK ("mode" IN ('month','cycle')),
  CONSTRAINT "cycle_cfg_anchor_ck" CHECK ("anchor_day" IS NULL OR ("anchor_day" >= 1 AND "anchor_day" <= 31)),
  CONSTRAINT "cycle_cfg_eom_ck" CHECK ("eom_policy" IS NULL OR "eom_policy" IN ('last_day','shift')),
  CONSTRAINT "cycle_cfg_restore_ck" CHECK ("restore_start_month" IS NULL OR "restore_start_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "cycle_cfg_shape_ck" CHECK (
    ("mode" = 'cycle' AND "anchor_day" IS NOT NULL AND "eom_policy" IS NOT NULL) OR
    ("mode" = 'month' AND "anchor_day" IS NULL AND "eom_policy" IS NULL AND "first_pay" IS NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cycle_cfg_owner_id_idx" ON "cycle_config_version" ("owner_id","id");--> statement-breakpoint

ALTER TABLE "amount_cell" DROP CONSTRAINT IF EXISTS "amount_cell_period_ck";--> statement-breakpoint
ALTER TABLE "amount_cell" ADD CONSTRAINT "amount_cell_period_ck"
  CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])t?$');--> statement-breakpoint
ALTER TABLE "movement" DROP CONSTRAINT IF EXISTS "movement_period_ck";--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_period_ck"
  CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])t?$');--> statement-breakpoint
ALTER TABLE "cell_note" DROP CONSTRAINT IF EXISTS "cell_note_period_ck";--> statement-breakpoint
ALTER TABLE "cell_note" ADD CONSTRAINT "cell_note_period_ck"
  CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])t?$');--> statement-breakpoint
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_closed_through_ck";--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_closed_through_ck"
  CHECK ("closed_through" IS NULL OR "closed_through" ~ '^[0-9]{4}-(0[1-9]|1[0-2])t?$');--> statement-breakpoint
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_reopened_period_ck";--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_reopened_period_ck"
  CHECK ("reopened_period" IS NULL OR "reopened_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])t?$');--> statement-breakpoint
ALTER TABLE "closure_event" DROP CONSTRAINT IF EXISTS "closure_event_period_ck";--> statement-breakpoint
ALTER TABLE "closure_event" ADD CONSTRAINT "closure_event_period_ck"
  CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])t?$');--> statement-breakpoint
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_start_month_ck";--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_start_month_ck"
  CHECK ("start_month" IS NULL OR "start_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])t?$');
