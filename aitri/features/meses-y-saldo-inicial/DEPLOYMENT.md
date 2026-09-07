# DEPLOYMENT — meses-y-saldo-inicial

**Modelo de despliegue: contenedor Docker detrás de Nginx — el del PROYECTO, sin envoltorio propio.**

Esta feature **no crea ningún artefacto desplegable nuevo**. No hay `Dockerfile` ni
`docker-compose.yml` aquí a propósito: los del proyecto raíz ya existen (los creó `cierre-de-mes` el
2026-09-03 como trabajo de la raíz) y esta feature no cambia qué se empaqueta ni cómo. Duplicarlos
crearía dos fuentes de verdad para la misma imagen. Tampoco hay `.env.example` propio: el manifiesto
declara `environment_variables: []` — esta feature **no introduce ni una sola variable de entorno**.

Lo único que el despliegue gana es **una migración**.

---

## Requisitos previos

Los del proyecto, sin añadidos: Node 20+, PostgreSQL 16, y las variables de entorno que ya declara
`.env.example` de la raíz. Ninguna nueva.

## La migración: `drizzle/0006_saldo_inicial.sql`

Dos columnas nulables en `ledger` y tres `CHECK`. **Puramente aditiva**: sin backfill, sin datos que
convertir, sin bloqueo largo sobre la tabla.

```
start_month      text    NULL   CHECK formato '^[0-9]{4}-(0[1-9]|1[0-2])$'
opening_balance  bigint  NULL   CHECK >= 0
                                CHECK ledger_opening_ck: opening_balance IS NULL
                                                         OR start_month IS NOT NULL
```

**No toca `data_version`, y es deliberado.** Esa columna marca el modelo de DATOS de las celdas y
`saveLedger` la re-estampa en cada guardado, así que subirla sería una marca que se borra sola: una
idempotencia falsa. La idempotencia real viene de `ADD COLUMN IF NOT EXISTS` y
`DROP CONSTRAINT IF EXISTS`. Es el mismo criterio que `0005_cierre_impacto.sql` dejó escrito.

**Registrada en `drizzle/meta/_journal.json` (entrada 6).** Sin esa entrada, `db:migrate` termina
**con éxito sin aplicar nada** — el fallo silencioso más caro de esta familia. Se comprobó en carne
propia el 2026-09-06: diez pruebas de integración cayeron con `column "start_month" does not exist`
hasta registrarla.

### Aplicar

```bash
npm run db:migrate
```

### Verificar que de verdad se aplicó — no basta con que el comando salga en 0

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'ledger' AND column_name IN ('start_month','opening_balance');
-- Esperado: dos filas.

SELECT conname FROM pg_constraint WHERE conname LIKE 'ledger_%_ck';
-- Esperado: incluye ledger_start_month_ck, ledger_opening_balance_ck, ledger_opening_ck.
```

## Ventana de despliegue: no hay ninguna peligrosa

Las dos direcciones degradan bien, así que **no hace falta despliegue coordinado ni ventana de
mantenimiento**:

- **Código viejo contra base migrada:** ignora las dos columnas que no conoce. Se comporta como
  antes, byte a byte.
- **Código nuevo contra base sin migrar:** el `SELECT` de `ledgerRepo` pediría columnas inexistentes
  y fallaría en voz alta —no en silencio—, así que el orden correcto es **migrar y luego desplegar**,
  igual que con las migraciones anteriores.
- **Usuario que nunca declara nada:** ambas columnas `NULL` ≡ no declarado ≡ comportamiento previo.
  `openingCarry` devuelve `ZERO_CARRY` y la serie sale idéntica (NFR-2201, verificado byte a byte por
  TC-MSI-070h).

## Reversión

```sql
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_opening_ck";
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_opening_balance_ck";
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_start_month_ck";
ALTER TABLE "ledger" DROP COLUMN IF EXISTS "opening_balance";
ALTER TABLE "ledger" DROP COLUMN IF EXISTS "start_month";
```
Y quitar la entrada 6 de `drizzle/meta/_journal.json`.

**Qué se pierde al revertir:** las declaraciones de apertura de los usuarios que las hubieran hecho.
Nada más depende de esas columnas, así que no hay cascada que reconstruir. Si se prevé volver a
aplicar la migración, conviene exportar antes:
`SELECT owner_id, start_month, opening_balance FROM ledger WHERE start_month IS NOT NULL;`

## Comprobaciones de salud tras desplegar

El `/health` del proyecto sigue siendo el mismo; esta feature no añade dependencias que vigilar.
Además, para dar por buena la superficie nueva:

1. **El endpoint exige sesión.** Sin cookie debe responder **401**, nunca 200:
   ```bash
   curl -si -X PUT https://<host>/api/v1/ledger/start \
     -H 'content-type: application/json' \
     -d '{"baseRevision":0,"startMonth":"2026-06","openingBalance":0}' | head -1
   ```
2. **La ruta de Configuración también.** `GET /configuracion` sin sesión debe caer en el acceso, no
   mostrar la pantalla: vive bajo `LoginGate` precisamente por eso.
3. **El horizonte sigue vivo.** Ya NO está en la cabecera (FR-1907 saldado): su único control está en
   `/configuracion`. Si aparece en las dos, algo se desplegó a medias.

## Lo que un operador debe saber, y no es evidente

**La tarjeta de arranque no se le mostrará a un usuario nuevo real.** No es un fallo del despliegue:
`buildSeed` siembra montos de ejemplo al registrarse, así que el predicado «sin datos ni declaración»
no se cumple. Está declarado como deuda en el manifiesto y su resolución —que el usuario nuevo
arranque con las celdas vacías— se enruta como feature propia porque cambia FR-013 del proyecto raíz.
**El camino que sí funciona hoy para declarar el saldo inicial es Configuración**, en escritorio y en
móvil.
