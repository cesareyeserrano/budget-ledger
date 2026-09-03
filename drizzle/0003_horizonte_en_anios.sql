-- multi-anio (FR-1904) — el horizonte pasa de MESES a AÑOS COMPLETOS.
--
-- Decision del usuario (2026-09-02): un horizonte de 24 meses desde septiembre termina en agosto y
-- muestra el ultimo anio a medias. La regla honesta es «dos anios», no «veinticuatro meses».
-- 12 meses -> 1 anio, 24 meses -> 2 anios. La conversion es exacta: no habia otros valores.
ALTER TABLE "user" DROP CONSTRAINT "user_horizon_ck";--> statement-breakpoint
UPDATE "user" SET "horizon" = CASE WHEN "horizon" = 24 THEN 2 ELSE 1 END WHERE "horizon" > 2;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "horizon" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_horizon_ck" CHECK ("user"."horizon" in (1, 2));
