-- Feature cierre-de-mes · FR-2010 (ADR-15) — la linea de base del impacto aguas abajo.
--
-- Al reabrir un mes se fotografia el saldo con el que CERRABA en ese instante. Es el referente de
-- «valor anterior» cuando se enumeran los meses posteriores que se movieron. Se persiste (dos
-- numeros, no un snapshot) para que el marco de referencia siga siendo «como estaba cuando lo
-- reabri» despues de recargar la pagina o cambiar de dispositivo.
--
-- Puramente aditiva: dos columnas nulables. No hay datos que convertir. Corre en transaccion y es
-- idempotente por IF NOT EXISTS / DROP IF EXISTS, NO por `data_version` (NFR-2008).
--
-- POR QUE NO SE TOCA `data_version`, contra lo que decia el borrador del TRD: esa columna marca el
-- modelo de DATOS (semantica de las celdas) y `saveLedger` la re-estampa en DATA_VERSION_COUNTERPARTY
-- en cada guardado — subirla aqui a 5 seria una marca que se borra sola en la siguiente escritura,
-- es decir una idempotencia falsa. Estas dos columnas no cambian ningun dato existente, asi que no
-- son un cambio de modelo de datos: son estado nuevo y nulable.

ALTER TABLE "ledger" ADD COLUMN IF NOT EXISTS "reopen_base_available" bigint;
ALTER TABLE "ledger" ADD COLUMN IF NOT EXISTS "reopen_base_reserved"  bigint;

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
