# Despliegue — cierre-de-mes

_Fase 5. El modelo de despliegue es el del proyecto: **contenedor Docker detrás de Nginx**, descrito
en el `DEPLOYMENT.md` de la raíz. Esta feature no lo cambia ni añade infraestructura propia._

> **Corregido el 2026-09-03.** Este documento afirmaba «NO contenerizada», deducido de que no había
> `Dockerfile` en el repositorio en vez de leído del plan del proyecto. Al comprobarlo apareció que
> el `Dockerfile` faltaba de verdad y que el `DEPLOYMENT.md` de la raíz describía una arquitectura
> ya retirada. Se arreglaron ambos ese día, como trabajo del proyecto raíz. A esta feature le da
> igual el envoltorio: su migración y su código se comportan idénticos dentro del contenedor o sobre
> Node pelado._

## Lo que esta feature añade al despliegue

Una sola cosa: la **migración `drizzle/0004_cierre_de_mes.sql`**.

Es **puramente aditiva** — dos columnas nulables en `ledger` (`closed_through`, `reopened_period`),
la tabla `closure_event` con su índice, y cinco CHECKs. No toca ninguna llave primaria y **no
convierte ni un dato**: ningún usuario tiene cierres todavía.

## Orden de despliegue — SIN ventana peligrosa

A diferencia de `multi-anio`, que exigía un orden estricto porque su migración borraba la columna
`month`, aquí **el código viejo sigue funcionando contra la base migrada**: ignora las columnas que
no conoce. Y el código nuevo funciona contra una base sin migrar en modo degradado — `closedThrough`
llega como `null`, que significa «nada cerrado», que es el comportamiento anterior a la feature.

Se recomienda igualmente el orden habitual, pero **la ventana entre pasos no rompe nada**:

```bash
# 1. Respaldo, como siempre
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > respaldo-$(date +%F).sql
# 2. Aplicar 0004 (transaccional, idempotente). Las migraciones viajan en la imagen.
docker compose run --rm app node scripts/migrate.mjs
# 3. Levantar el código nuevo
docker compose up -d --build
```

_En desarrollo, sin contenedor, el paso 2 es `npm run db:migrate`._

**Requisito previo:** la migración `0004` debe estar registrada en `drizzle/meta/_journal.json`. Se
registró en este repositorio; si se copia el `.sql` a otro entorno sin el diario, `db:migrate`
termina con éxito **sin aplicar nada** — un fallo silencioso que ya ocurrió una vez durante el
desarrollo. Comprobar después de migrar:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'ledger' AND column_name IN ('closed_through','reopened_period');
-- debe devolver DOS filas
SELECT to_regclass('closure_event');  -- no debe ser NULL
```

## Reversión

**Revertir el CÓDIGO es seguro y no exige tocar la base.** La app anterior ignora las dos columnas
nuevas y la tabla `closure_event`, así que vuelve a comportarse como antes con los datos intactos.

**NO hay migración inversa, y es deliberado** — mismo criterio que en `multi-anio`:

- Revertir el código ya basta, así que un `down` no aporta nada.
- Borrar las columnas **destruiría el rastro de `closure_event`**, que es auditoría: daría una falsa
  sensación de seguridad a cambio de perder información que no se puede reconstruir.

Si hiciera falta soltar los cierres sin revertir el código (p. ej. un cierre aplicado por error en
producción), la operación mínima es:

```sql
UPDATE ledger SET reopened_period = NULL, closed_through = NULL WHERE owner_id = '<id>';
-- El rastro NO se borra: closure_event conserva qué pasó y cuándo.
```

## Variables de entorno

**Esta feature no añade ninguna.** Usa las que el proyecto ya declara en el `.env.example` de la
raíz — `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` y las de SMTP. Por eso no se crea un
`.env.example` propio: duplicarlo aquí crearía una segunda lista que se desincronizaría.

## Comprobación de salud

Las de siempre, sin añadidos:

- `GET /health` — la ruta de salud del proyecto.
- `npm run gate:smoke` (`./smoke.sh`) — arranca la app y comprueba que sus rutas principales
  responden sin error de servidor.

Y dos comprobaciones específicas de esta feature, que se pueden hacer con la sesión abierta:

```
GET  /api/v1/ledger            → 200, y state.closure existe (aunque sea { null, null })
GET  /api/v1/closure/events    → 200 { events: [] } en un despliegue nuevo
```

Si `state.closure` **no** aparece en la respuesta del ledger, la migración no se aplicó o el esquema
de validación descartó el campo — es exactamente el fallo silencioso que costó una tarde durante el
desarrollo, y por eso está aquí como comprobación explícita.

## Gates de calidad que corren en cada verificación

`typecheck` · `lint` · `design-tokens` · `security-config` · `secret-scan` · `smoke` · `e2e`.
Los siete pasaron en la corrida sellada de esta feature.
