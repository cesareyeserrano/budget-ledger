-- Feature fecha-de-comentario · FR-2601 (ADR-01) — el día en que se escribió un comentario.
--
-- UNA columna nueva y un CHECK; ninguna fila existente se reescribe (NFR-2601).
--
-- `date` es el día LOCAL del usuario en que escribió el comentario, como texto «AAAA-MM-DD», igual
-- que `movement.date`: es un día civil, sin zona horaria, y un tipo date/timestamptz invitaría a
-- conversiones de zona que desplazarían el día. NULL = comentario anterior a la feature, y así se
-- queda: nadie le inventa un día.
--
-- El CHECK valida solo la FORMA. La validez de calendario (2026-02-30) la juzga zod en el borde de la
-- API (NFR-2606), antes de abrir la transacción.
--
-- ROLLBACK: la imagen anterior no conoce la columna y funciona, pero su primer PUT reescribe el
-- snapshot sin ella: se pierden los DÍAS de los comentarios escritos después del despliegue (el texto
-- no). Respaldo obligatorio antes de migrar, como desde la 0009 (DEPLOYMENT.md).
--
-- Se escribe A MANO, sin `drizzle-kit generate`, por el mismo motivo que la 0009.
--
-- Idempotente (IF NOT EXISTS / DROP IF EXISTS) y aditiva.
ALTER TABLE "cell_note" ADD COLUMN IF NOT EXISTS "date" text;

ALTER TABLE "cell_note" DROP CONSTRAINT IF EXISTS "cell_note_date_ck";
ALTER TABLE "cell_note" ADD CONSTRAINT "cell_note_date_ck" CHECK (
  "date" IS NULL OR "date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
);
