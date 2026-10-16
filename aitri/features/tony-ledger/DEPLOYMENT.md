# Despliegue — tony-ledger (puerta para agentes)

_Fase 5. El modelo de despliegue es el del proyecto: **contenedores Docker**, descrito en el
`DEPLOYMENT.md` de la raíz. Esta feature no añade imagen ni servicio; añade una migración, dos
variables opcionales y, solo si se usa un agente, una red Docker._

## Qué cambia al desplegar esta versión

| | |
|---|---|
| **Migración** | `drizzle/0013_agente.sql` — aditiva e idempotente: tabla `agent_token` y tres columnas nuevas (NULL) en `movement`. No reescribe ninguna fila. |
| **Variables nuevas** | `LEDGER_AGENT_API` y `LEDGER_AGENT_SOURCES`, las dos opcionales. Están en el `.env.example` de la raíz; esta feature no lleva uno propio. |
| **Dependencias** | Ninguna nueva. |
| **Imagen** | La misma (`Dockerfile` y `docker-compose.yml` de la raíz). `docker-compose.agent.yml` es un añadido opcional. |
| **Comportamiento por defecto** | **La puerta nace apagada.** Sin `LEDGER_AGENT_API=on`, todo `/api/agent/v1` responde 404 y la app se comporta como antes. |

Desplegar esta versión y encender la puerta son **dos pasos separados**. El primero es un despliegue
normal con una migración; el segundo solo hace falta el día que haya un agente que conectar.

## Paso 1 — Desplegar la versión (la puerta sigue apagada)

Es el procedimiento de siempre del `DEPLOYMENT.md` de la raíz, sin nada especial salvo que **hay
migración**, así que la regla de migrar con la imagen NUEVA aplica:

```bash
cd ~/apps/budget-ledger
git pull
export LEDGER_TAG=$(git rev-parse --short HEAD)

# 1. Respaldo — obligatorio: la migración añade columnas a `movement`
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > ~/backup-$(date +%F-%H%M).sql
# 2. Imagen nueva
docker compose build app
# 3. Migrar CON LA IMAGEN NUEVA (la 0013 viaja dentro de ella)
docker compose run --rm app node scripts/migrate.mjs
# 4. Arrancar
docker compose up -d
# 5. Verificar
scripts/verificar-prod.sh ~/backup-<fecha>.sql
```

Lo que `verificar-prod.sh` debe decir tras este paso:

- comprobación 3: **14 de 14** migraciones aplicadas (la 0013 es la decimocuarta);
- comprobación 6: ninguna cifra de `amount_cell` cambió;
- comprobación 7: `/api/agent/v1` responde **404** por los tres caminos (la URL pública, la URL
  pública con `X-Forwarded-For` falsificado y el puerto publicado en el host). Con la puerta
  apagada el 404 es lo esperado.

**Orden y ventana.** La migración antes que el código nuevo: el código nuevo lee las tres columnas
de `movement` en cada carga del libro, y sin ellas la app falla en todas las lecturas. El código
viejo sobre la base ya migrada funciona (ignora las columnas), así que no hay ventana peligrosa si
se migra primero.

## Paso 2 — Encender la puerta (solo cuando haya un agente)

No forma parte del despliegue de esta versión. El detalle está en el `DEPLOYMENT.md` de la raíz,
sección «Agent door», y el contrato en `docs/agent-api.md`. En resumen:

```bash
# Una vez: la red que comparten la app y el contenedor del agente (la base NO está en ella)
docker network create --subnet 172.30.34.0/24 ledger-agent

# En el .env de la app:
#   LEDGER_AGENT_API=on
#   LEDGER_AGENT_SOURCES=172.30.34.10      ← la IP FIJA del contenedor del agente, no la subred
docker compose -f docker-compose.yml -f docker-compose.agent.yml up -d

# El token del agente: se imprime UNA vez y solo se guarda su hash
docker compose exec app node scripts/agent-token.mjs create <correo-de-la-cuenta> "Agent-L"
```

Después, tres comprobaciones:

1. `scripts/verificar-prod.sh` — la comprobación 7 tiene que seguir en **404 por los tres caminos**.
   Un 401 en cualquiera significa que la puerta se alcanza por ahí y solo la protege el token.
2. Desde el contenedor del agente: `GET http://t-ledger:3000/api/agent/v1/tree` con el token → **200**.
3. `docker compose exec app node scripts/agent-token.mjs list <correo>` → el token aparece con su
   último uso.

Qué **no** declarar nunca en `LEDGER_AGENT_SOURCES`: `127.0.0.1` en producción, el rango de la
tailnet, la subred entera de la red Docker (su puerta de enlace `.1` es por donde entra el tráfico
del puerto publicado en el host), ni un bloque más ancho que `/16` (el arranque lo rechaza).

## Variables de entorno

| Nombre | Tipo | ¿Requerida? | Por defecto | Ejemplo | Para qué |
|---|---|---|---|---|---|
| `LEDGER_AGENT_API` | texto | No | (vacía = apagada) | `on` | Enciende `/api/agent/v1`. Solo el valor exacto `on`. |
| `LEDGER_AGENT_SOURCES` | lista separada por comas | No | (vacía = ningún origen) | `172.30.34.10` | Las únicas direcciones desde las que se atiende la puerta. IPv4, o CIDR IPv4 de `/16` o más estrecho. Una entrada inválida aborta el arranque. |

Las demás variables del proyecto no cambian.

## Comprobación de salud

`GET /health` → `200 {"status":"ok"}`, sin autenticación, igual con la puerta encendida o apagada.
No pasa por la envoltura del agente. Es el healthcheck que ya usa el `Dockerfile`.

## Parada de emergencia

Si el agente se comporta mal, de la más rápida a la más completa:

1. **Revocar su token** — vale en la siguiente petición, sin reiniciar nada:
   `docker compose exec app node scripts/agent-token.mjs revoke <agt_…>`
2. **Apagar la puerta** — `LEDGER_AGENT_API=` en el `.env` y `docker compose up -d`.
3. **Parar el agente** en su lado.

Lo que el agente haya registrado queda marcado con su nombre y se ve en la app (Detalle de la celda
y pantalla de la categoría en el teléfono): se corrige o se borra desde ahí como cualquier
movimiento. Para listarlo todo de una vez:

```sql
SELECT date, target, amount, note, origin_ref, agent_name
FROM movement WHERE owner_id = '<id>' AND agent_token_id IS NOT NULL ORDER BY created_at DESC;
```

## Rollback

**El código** vuelve a la imagen anterior como describe el `DEPLOYMENT.md` de la raíz
(`LEDGER_TAG=<commit anterior>` y `docker compose up -d`).

**El esquema no vuelve atrás**, y no hace falta: la imagen anterior no conoce la tabla ni las
columnas nuevas y funciona con ellas. Una sola consecuencia que hay que conocer:

> Con la imagen ANTERIOR, el primer guardado del libro desde el navegador reescribe los movimientos
> **sin** sus tres columnas de origen. Los movimientos que hubiera registrado un agente **no se
> pierden**, pero pierden su marca: dejan de verse etiquetados, su referencia queda libre (un
> reintento del agente los duplicaría) y el agente ya no podrá corregirlos ni deshacerlos.

Por eso, si ya hay un agente escribiendo: **apaga la puerta antes de volver a una imagen anterior**,
y conserva el respaldo previo. Si la puerta nunca se encendió, el rollback no tiene ninguna
consecuencia para los datos.

## Lo que queda fuera de esta entrega

- El agente mismo (Agent-L): su código, su red y su token viven en su propio proyecto. Aquí se
  entrega la puerta y su contrato.
- Un listener aparte solo para `/api/agent`: hoy la puerta comparte puerto con la app, y por la red
  del agente se alcanza la app entera en HTTP plano. Declarado como deuda en el informe de
  construcción.
