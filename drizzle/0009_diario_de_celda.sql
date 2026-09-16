-- Feature diario-de-celda · FR-2504 (ADR-04) — el AJUSTE como clase de movimiento.
--
-- UNA columna nueva y dos CHECK; ninguna cifra existente se toca.
--
-- `kind` distingue el movimiento que el usuario registró (`manual`) del que nace de teclear un total
-- en la celda (`adjustment`). Las filas que ya existen reciben 'manual' por el DEFAULT, así que la
-- migración no reescribe nada y una imagen anterior sigue leyendo la tabla.
--
-- El CHECK de monto pasa a depender del `kind`: un movimiento manual sigue exigiendo >= 1, y solo un
-- ajuste admite negativo — nunca cero (un ajuste de cero no existe: es «no hacer nada») y solo en
-- gasto o ingreso, porque las reservas tienen su propia regla (NFR-2503).
--
-- ATENCIÓN AL ROLLBACK: la imagen anterior valida `amount >= 1` al LEER, así que una vez creado un
-- ajuste negativo, volver atrás exige restaurar el respaldo. Respaldo obligatorio antes de migrar
-- (riesgo del TRD, y queda escrito en DEPLOYMENT.md en la fase 5).
--
-- Se escribe A MANO, sin `drizzle-kit generate`: `schema.ts` conserva la regex de periodo anterior a
-- la 0007 y regenerar podría revertirla.
--
-- Idempotente (IF NOT EXISTS / DROP IF EXISTS) y aditiva.
ALTER TABLE "movement" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'manual';

ALTER TABLE "movement" DROP CONSTRAINT IF EXISTS "movement_kind_ck";
ALTER TABLE "movement" ADD CONSTRAINT "movement_kind_ck" CHECK ("kind" IN ('manual','adjustment'));

ALTER TABLE "movement" DROP CONSTRAINT IF EXISTS "movement_amount_ck";
ALTER TABLE "movement" ADD CONSTRAINT "movement_amount_ck" CHECK (
  ("kind" = 'manual' AND "amount" >= 1)
  OR ("kind" = 'adjustment' AND "amount" <> 0 AND "type" IN ('expense','income'))
);
