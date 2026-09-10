# Despliegue — ciclos

_Fase 5. El modelo de despliegue es el del proyecto: **contenedor Docker detrás de Nginx**, descrito
en el `DEPLOYMENT.md` de la raíz. Esta feature no añade Dockerfile, compose ni servicio: sigue
valiendo la checklist del raíz (multi-stage, `USER nextjs`, `HEALTHCHECK` contra `/health`)._

## Lo que esta feature añade al despliegue

**Dos migraciones**, ninguna cambia una cifra existente:

- **`drizzle/0007_ciclos.sql`** — la tabla `cycle_config_version` (append-only: cada fila es una
  versión de la configuración de ciclos; sin filas = modo mes) y los **siete CHECKs** de formato de
  periodo ampliados para admitir la clave de transición `YYYY-MMt`. Toda fila existente sigue
  cumpliéndolos.
- **`drizzle/0008_ciclos_origen.sql`** — la tabla `relocation_origin`: la memoria de origen de cada
  dato sin fecha que una activación movió. Es solo del servidor (`GET /api/v1/ledger` no la expone)
  y es lo que permite que volver a «Mes a mes» sea exacto.

Ambas son idempotentes (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`) y están
registradas en `drizzle/meta/_journal.json`.

**Dos rutas nuevas**, ambas con sesión y cabecera `Origin` (`withApi` con `auth: "required"`,
`mutation: true`): `POST /api/v1/ledger/cycles/preview` y `PUT /api/v1/ledger/cycles`.

## Orden de despliegue — migrar ANTES de la imagen nueva

A diferencia de `cierre-de-mes`, **aquí el orden importa en un sentido**:

- **Código nuevo sobre base sin migrar → roto.** El código nuevo consulta `cycle_config_version` y
  `relocation_origin`; sin ellas `GET /api/v1/ledger` falla y la app muestra una semilla vacía. Ya
  pasó en desarrollo el 2026-09-10 con `0007` sin aplicar: no se perdió nada, pero el usuario creyó
  que sí.
- **Código viejo sobre base migrada → funciona**, mientras nadie haya activado ciclos: ignora las
  dos tablas y los CHECKs ampliados solo admiten más.

```bash
# 1. Respaldo, siempre primero
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > respaldo-$(date +%F).sql
# 2. Aplicar 0007 y 0008 (transaccionales, idempotentes). Las migraciones viajan en la imagen.
docker compose run --rm app node scripts/migrate.mjs
# 3. Levantar el código nuevo
docker compose up -d --build
```

_En desarrollo, sin contenedor, el paso 2 es `npm run db:migrate`._ **Ojo en dev:** `next dev`
recarga en caliente lo que se escribe en `src/`, así que la app de desarrollo usa el código nuevo
en cuanto existe. Migrar (con respaldo) antes de que ese código llegue a la app que usa datos reales.

Comprobar después de migrar (no fiarse del mensaje de éxito de `migrate.mjs`):

```sql
SELECT to_regclass('cycle_config_version'), to_regclass('relocation_origin');  -- ninguna NULL
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'movement_period_ck';
-- debe incluir t?
```

## Reversión

**No hay migración inversa, a propósito.** Soltar `relocation_origin` borraría la memoria de origen
y la vuelta a mes dejaría de ser exacta; devolver los CHECKs al patrón sin `t?` solo es posible si no
queda ninguna clave de transición.

**Revertir el CÓDIGO depende de si alguien activó ciclos:**

- **Nadie en ciclos** → seguro, sin tocar la base. Averiguarlo:

  ```sql
  SELECT owner_id FROM (
    SELECT DISTINCT ON (owner_id) owner_id, mode FROM cycle_config_version ORDER BY owner_id, id DESC
  ) v WHERE mode = 'cycle';   -- vacío = nadie en ciclos
  ```

- **Algún usuario en ciclos** → **antes** de volver a la imagen anterior, ese usuario debe volver a
  «Mes a mes» desde Configuración. El código anterior no conoce los ciclos: leería las columnas de
  ciclo como meses y rechaza las claves de transición (`PERIOD_RE` = `^\d{4}-(0[1-9]|1[0-2])$`), así
  que no podría guardar. La vuelta está bloqueada si hay periodos cerrados: primero hay que
  reabrirlos.
- **Si eso no es posible**, la salida es restaurar el respaldo del paso 1 con la app parada, y se
  pierde lo escrito desde entonces.

## Variables de entorno

Documentadas en el `.env.example` de la raíz (no se crea uno propio: una segunda lista se
desincronizaría).

| Variable | Tipo | ¿Requerida? | Ejemplo | Para qué |
|---|---|---|---|---|
| `LEDGER_TZ` | string (zona IANA) | Opcional, por defecto `America/Bogota` | `America/Bogota` | Zona en la que el servidor decide «hoy» para el cierre por ciclos. El proceso corre en UTC. |
| `LEDGER_TEST_OVERRIDES` | string (`1`) | **Solo pruebas. NUNCA en producción** | `1` | Puerta: sin ella el servidor no lee ninguna de las tres siguientes. |
| `LEDGER_TODAY` | string `YYYY-MM-DD` | Solo pruebas | `2026-09-10` | Fija «hoy» en el servidor para los e2e (el servidor corre en otro proceso). |
| `LEDGER_NOW` | string (instante ISO) | Solo pruebas | `2026-09-10T12:00:00Z` | Fija el instante actual. |
| `LEDGER_TEST_FAIL_AFTER` | enum `first_insert` | Solo pruebas | `first_insert` | Fuerza un fallo tras la primera escritura de la reubicación para probar el `ROLLBACK`. |

## Comprobación de salud

Las de siempre:

- `GET /health` → `200 {"status":"ok"}`, también después de migrar.
- `npm run gate:smoke` (`./smoke.sh`) — arranca la app y comprueba que sus rutas principales
  responden sin error de servidor.

Y las de esta feature, con la sesión abierta:

```
GET  /api/v1/ledger                 → 200 con el ledger (un 500, o la semilla vacía en la app,
                                      es la firma de 0007/0008 sin aplicar)
POST /api/v1/ledger/cycles/preview  → 200 con la previsualización para un destino válido;
                                      no escribe nada
```

## Gates de calidad que corren en cada verificación

`typecheck` · `lint` · `design-tokens` · `security-config` · `secret-scan` · `smoke` · `e2e` ·
`coverage`. Los ocho pasaron en la corrida sellada de esta feature (2026-09-10, 178/178).
