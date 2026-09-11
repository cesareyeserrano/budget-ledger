-- multi-anio (FR-1902) — el periodo del ledger pasa de mes suelto a año+mes.
--
-- CAMBIO DE ESTRUCTURA, NO MIGRACION DE DATOS (ADR-05): el 2026-09-02 las tres tablas quedaron
-- vacias por decision del usuario, asi que no hay filas que traducir. Eso elimina de raiz el peor
-- riesgo posible: elegir mal el anio ancla etiquetaria los datos con un anio que no es el suyo, y
-- el error seria INDETECTABLE despues (el dato viejo no lleva anio con el que comparar).
--
-- Por eso este script COMPRUEBA que estan vacias y aborta con un mensaje claro si no lo estan.
-- Migrar filas con `month` = 'mar' produciria periodos que no pasan el CHECK y la transaccion
-- fallaria de todos modos: mejor pararse antes y decir por que.
DO $$
DECLARE
  n_cells   bigint;
  n_moves   bigint;
  n_notes   bigint;
BEGIN
  SELECT count(*) INTO n_cells FROM amount_cell;
  SELECT count(*) INTO n_moves FROM movement;
  SELECT count(*) INTO n_notes FROM cell_note;
  IF n_cells > 0 OR n_moves > 0 OR n_notes > 0 THEN
    RAISE EXCEPTION
      'multi-anio: las tablas no estan vacias (amount_cell=%, movement=%, cell_note=%). Esta migracion solo cambia la estructura; migrar datos del modelo de doce meses exige decidir el anio ancla y es un escalon aparte.',
      n_cells, n_moves, n_notes;
  END IF;
END $$;--> statement-breakpoint

-- amount_cell -------------------------------------------------------------------------------
ALTER TABLE "amount_cell" DROP CONSTRAINT "amount_cell_month_ck";--> statement-breakpoint
ALTER TABLE "amount_cell" DROP CONSTRAINT "amount_cell_owner_id_node_id_month_kind_pk";--> statement-breakpoint
ALTER TABLE "amount_cell" RENAME COLUMN "month" TO "period";--> statement-breakpoint
ALTER TABLE "amount_cell" ADD CONSTRAINT "amount_cell_owner_id_node_id_period_kind_pk" PRIMARY KEY("owner_id","node_id","period","kind");--> statement-breakpoint
ALTER TABLE "amount_cell" ADD CONSTRAINT "amount_cell_period_ck" CHECK ("amount_cell"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint

-- movement ----------------------------------------------------------------------------------
ALTER TABLE "movement" DROP CONSTRAINT "movement_month_ck";--> statement-breakpoint
ALTER TABLE "movement" RENAME COLUMN "month" TO "period";--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_period_ck" CHECK ("movement"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint

-- cell_note ---------------------------------------------------------------------------------
ALTER TABLE "cell_note" DROP CONSTRAINT "cell_note_month_ck";--> statement-breakpoint
ALTER TABLE "cell_note" DROP CONSTRAINT "cell_note_owner_id_node_id_month_id_pk";--> statement-breakpoint
ALTER TABLE "cell_note" RENAME COLUMN "month" TO "period";--> statement-breakpoint
ALTER TABLE "cell_note" ADD CONSTRAINT "cell_note_owner_id_node_id_period_id_pk" PRIMARY KEY("owner_id","node_id","period","id");--> statement-breakpoint
ALTER TABLE "cell_note" ADD CONSTRAINT "cell_note_period_ck" CHECK ("cell_note"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint

-- Preferencia de horizonte (FR-1907, ADR-06): vive en la CUENTA, no en el navegador, asi que
-- viaja entre dispositivos. NO forma parte del snapshot del ledger, de modo que cambiarla no
-- toca `ledger.revision`.
ALTER TABLE "user" ADD COLUMN "horizon" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_horizon_ck" CHECK ("user"."horizon" in (12, 24));--> statement-breakpoint

-- Marca de version: la idempotencia es por MARCA, nunca por heuristica sobre el contenido.
UPDATE "ledger" SET "data_version" = 6 WHERE "data_version" < 6;
