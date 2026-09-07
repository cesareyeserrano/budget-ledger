-- Feature meses-y-saldo-inicial · FR-2201/FR-2202/FR-2207 (ADR-01) — la apertura declarada.
--
-- El usuario declara DOS cosas: en que mes empieza su historia, y cuanto tenia ese dia. El segundo
-- ocupa la casilla que hoy ocupa «Saldo del mes anterior» en el mes de inicio, y de ahi en adelante
-- la cascada funciona sin enterarse.
--
-- POR QUE AQUI Y NO EN `user`. Es el mismo criterio que fijo `closed_through` (cierre-de-mes,
-- ADR-11): estas dos columnas CAMBIAN LAS CIFRAS, asi que viven junto a `revision` para heredar
-- gratis el lock optimista. `user.horizon` no lo hace porque es preferencia de presentacion y no
-- altera ningun numero.
--
-- Puramente aditiva: dos columnas nulables, sin backfill y sin datos que convertir. Corre en
-- transaccion y es idempotente por IF NOT EXISTS / DROP IF EXISTS, NO por `data_version` (mismo
-- criterio que la 0005: esa columna marca el modelo de DATOS de las celdas, `saveLedger` la
-- re-estampa en cada guardado, y estas dos columnas no cambian ningun dato existente).
--
-- Reversible: soltar las dos columnas y el CHECK. No hay nada que reconstruir.

ALTER TABLE "ledger" ADD COLUMN IF NOT EXISTS "start_month"     text;
ALTER TABLE "ledger" ADD COLUMN IF NOT EXISTS "opening_balance" bigint;

-- El mes de inicio es un PeriodKey «YYYY-MM», igual que `closed_through`. Una frontera con formato
-- basura no puede llegar al dominio: alli `normalizeStartMonth` la trataria como no declarada, y
-- entonces la base y el dominio discreparian sobre lo que el usuario dijo.
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_start_month_ck";
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_start_month_ck"
  CHECK ( "start_month" IS NULL OR "start_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' );

-- El saldo inicial admite CERO y positivos. Cero no es «no declarado»: es «empiezo desde cero»,
-- una respuesta explicita del usuario que retira la tarjeta de arranque para siempre. El negativo
-- si se rechaza — quien empieza debiendo lo registra como un gasto del mes, no como apertura.
-- Es la ULTIMA de las tres defensas: Zod en el borde, la regla de dominio, y este CHECK.
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_opening_balance_ck";
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_opening_balance_ck"
  CHECK ( "opening_balance" IS NULL OR "opening_balance" >= 0 );

-- Un saldo de apertura sin mes al que aplicarse no significa nada: la base impide ese estado en vez
-- de confiar en que nadie lo escriba. Lo INVERSO si es legal —mes declarado sin saldo— porque son
-- exactamente los estados 3 y 4 de la tarjeta de arranque: «Empiezo desde cero» y «teclear sin
-- responderla». Ahi el usuario declaro CUANDO empieza, pero no trae dinero previo.
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_opening_ck";
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_opening_ck"
  CHECK ( "opening_balance" IS NULL OR "start_month" IS NOT NULL );
