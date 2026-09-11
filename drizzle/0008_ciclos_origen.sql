-- Feature ciclos · re-derivación del 2026-09-10 · FR-2404/FR-2410 (ADR-07) — la memoria de origen.
--
-- UNA tabla nueva; ninguna cifra existente se toca.
--
-- `relocation_origin` guarda de qué mes calendario vino cada dato sin día que la activación de ciclos
-- movió (celda de Presupuestado, residuo tecleado del Ejecutado, movimiento sin fecha, nota de celda),
-- para que volver a mes a mes lo devuelva exactamente aunque varios meses se hayan sumado en una celda.
-- La escribe y la consume SOLO el endpoint de ciclos, dentro de la misma transacción que reubica.
--
-- SIN FK a amount_cell, movement ni cell_note: las escrituras del snapshot borran y reinsertan esas
-- filas, y una FK en cascada borraría la memoria en cada guardado. `amount` lleva signo solo en
-- 'actual' (un residuo puede ser negativo, ADR-06); en el resto es >= 0.
--
-- Idempotente (IF NOT EXISTS) y aditiva: una imagen anterior sigue funcionando sobre el esquema migrado.
CREATE TABLE IF NOT EXISTS "relocation_origin" (
  "owner_id"      text   NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "subject"       text   NOT NULL,
  "ref"           text   NOT NULL,
  "period"        text   NOT NULL,
  "origin_period" text   NOT NULL,
  "amount"        bigint NOT NULL DEFAULT 0,
  CONSTRAINT "relocation_origin_pk" PRIMARY KEY ("owner_id", "subject", "ref", "period", "origin_period"),
  CONSTRAINT "relocation_origin_subject_ck" CHECK ("subject" IN ('budget','actual','movement','note')),
  CONSTRAINT "relocation_origin_period_ck" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])t?$'),
  CONSTRAINT "relocation_origin_origin_ck" CHECK ("origin_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "relocation_origin_amount_ck" CHECK ("subject" = 'actual' OR "amount" >= 0)
);
