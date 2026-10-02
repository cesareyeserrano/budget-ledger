-- BG-089 — los comentarios de una celda son de SU celda: Presupuestado y Ejecutado, cada uno los suyos.
--
-- UNA columna nueva y un CHECK; ninguna fila existente se reescribe.
--
-- Hasta aquí un comentario se guardaba por categoría y periodo, sin plano, así que el de la celda de
-- Ejecutado aparecía igual en la de Presupuestado. `plane` dice de cuál de las dos celdas es:
--   NULL      → Ejecutado. Es el valor de TODO comentario anterior a esta migración (decisión del
--               usuario, 2026-10-01: los que ya existen se quedan en Ejecutado, que es donde nacieron).
--   'budget'  → Presupuestado.
-- No se guarda 'actual': ausente y Ejecutado son el mismo dato, igual que `movement.kind` con 'manual'.
--
-- ROLLBACK: la imagen anterior no conoce la columna y funciona, pero su primer PUT reescribe el
-- snapshot sin ella: los comentarios de Presupuestado escritos después del despliegue pasarían a verse
-- en Ejecutado (el texto no se pierde). Respaldo obligatorio antes de migrar, como desde la 0009.
--
-- Se escribe A MANO, sin `drizzle-kit generate`, por el mismo motivo que la 0009.
--
-- Idempotente (IF NOT EXISTS / DROP IF EXISTS) y aditiva.
ALTER TABLE "cell_note" ADD COLUMN IF NOT EXISTS "plane" text;

ALTER TABLE "cell_note" DROP CONSTRAINT IF EXISTS "cell_note_plane_ck";
ALTER TABLE "cell_note" ADD CONSTRAINT "cell_note_plane_ck" CHECK ("plane" IS NULL OR "plane" = 'budget');
