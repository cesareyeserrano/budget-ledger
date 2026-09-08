-- Feature cierre-de-mes · FR-2010 (ADR-15) — la linea de base del impacto aguas abajo.
--
-- Al reabrir un mes se fotografia el saldo con el que CERRABA en ese instante. Es el referente de
-- «valor anterior» cuando se enumeran los meses posteriores que se movieron. Se persiste (dos
-- numeros, no un snapshot) para que el marco de referencia siga siendo «como estaba cuando lo
-- reabri» despues de recargar la pagina o cambiar de dispositivo.
--
-- Aditiva en columnas, PERO NO libre de datos que convertir — corregido el 2026-09-08 (BG-003).
-- La redaccion anterior decia «Puramente aditiva: dos columnas nulables. No hay datos que convertir»
-- y era FALSA: el CHECK de mas abajo es un bicondicional, y las columnas nacen en NULL, asi que
-- cualquier fila que YA tuviera `reopened_period` lo violaba en el instante de crear la restriccion.
-- La migracion abortaba con 23514 (check_violation, ATRewriteTable) y se llevaba por delante la
-- cadena entera: la 0006 tampoco llegaba a aplicarse. Funcionaba en base vacia y fallaba en una con
-- datos — reproducido contra la base de desarrollo el 2026-09-07. De ahi el paso de conversion.
-- Sigue corriendo en transaccion y sigue siendo idempotente por IF NOT EXISTS / DROP IF EXISTS,
-- NO por `data_version` (NFR-2008).
--
-- POR QUE NO SE TOCA `data_version`, contra lo que decia el borrador del TRD: esa columna marca el
-- modelo de DATOS (semantica de las celdas) y `saveLedger` la re-estampa en DATA_VERSION_COUNTERPARTY
-- en cada guardado — subirla aqui a 5 seria una marca que se borra sola en la siguiente escritura,
-- es decir una idempotencia falsa. Estas dos columnas no cambian ningun dato existente, asi que no
-- son un cambio de modelo de datos: son estado nuevo y nulable.

ALTER TABLE "ledger" ADD COLUMN IF NOT EXISTS "reopen_base_available" bigint;
ALTER TABLE "ledger" ADD COLUMN IF NOT EXISTS "reopen_base_reserved"  bigint;

-- ── CONVERSION DE DATOS (BG-003) ──────────────────────────────────────────────────────────────
-- Una fila reabierta ANTES de esta migracion no tiene linea de base, y no hay forma de
-- reconstruirla: la linea de base es el saldo con el que el mes CERRABA en el instante en que se
-- reabrio, y ese instante ya paso sin que existiera donde anotarlo.
--
-- Rellenarla con ceros seria PEOR que no tenerla: el sistema tratara esos dos numeros como la
-- foto real y enumeraria el impacto aguas abajo contra un referente inventado. Un dato ausente se
-- nota; uno falso, no.
--
-- Asi que se suelta la reapertura, que es la unica salida honesta: ese mes vuelve a contarse como
-- no reabierto. El usuario puede reabrirlo de nuevo cuando quiera, y ESA reapertura si nacera con
-- su linea de base bien tomada. No se pierde ningun dato del ledger: `reopened_period` es estado
-- de cierre, no cifras.
UPDATE "ledger"
   SET "reopened_period" = NULL
 WHERE "reopened_period" IS NOT NULL
   AND ("reopen_base_available" IS NULL OR "reopen_base_reserved" IS NULL);

-- La linea de base existe EXACTAMENTE cuando hay un mes reabierto: ni antes ni despues. El
-- bicondicional convierte «se borra al volver a cerrar» en algo que la base no deja olvidar, en
-- vez de una disciplina del codigo (TC-CDM-105e).
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_reopen_baseline_ck";
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_reopen_baseline_ck"
  CHECK ( ("reopened_period" IS NULL     AND "reopen_base_available" IS NULL
                                         AND "reopen_base_reserved"  IS NULL)
       OR ("reopened_period" IS NOT NULL AND "reopen_base_available" IS NOT NULL
                                         AND "reopen_base_reserved"  IS NOT NULL) );

-- Ni `available` ni `reserved` llevan >= 0: un mes puede cerrar en deficit, y la linea de base
-- tiene que poder representar el estado REAL, no el deseable.
