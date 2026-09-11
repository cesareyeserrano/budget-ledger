# Despliegue — reglas-en-el-servidor

_Fase 5. El modelo de despliegue es el del proyecto: **contenedor Docker detrás de Nginx**, descrito
en el `DEPLOYMENT.md` de la raíz. Esta feature no lo cambia ni añade infraestructura propia._

## Lo que esta feature añade al despliegue

**Nada.** Y eso es el hecho relevante, no una omisión:

- **Sin migración.** No toca el esquema. `drizzle/` no gana ningún fichero.
- **Sin variables de entorno nuevas.** `.env.example` de la raíz sigue siendo la lista completa, así
  que esta feature no lleva uno propio.
- **Sin dependencias nuevas.** El guardia es TypeScript puro sobre el dominio ya existente.
- **Sin cambio de imagen.** El `Dockerfile` y el `docker-compose.yml` de la raíz sirven tal cual.

El código nuevo es `src/domain/guard.ts`, dos `export` añadidos en `src/domain/reserve.ts`, y la
llamada al guardia dentro de la transacción de `PUT /api/v1/ledger`.

## El único cambio observable: un rechazo nuevo

Peticiones que antes devolvían `200` ahora pueden devolver **`422`**. Ocurre cuando una escritura
que **toca reservas** dejaría algún mes peor de lo que estaba.

El cuerpo del 422 lleva la regla violada, el periodo y el límite operativo (FR-2102), que es lo que
permite diagnosticarlo desde un log sin adivinar.

**Quién lo nota.** Prácticamente nadie por la vía normal: la app ya frena esas operaciones en el
navegador con su propio mensaje (`blockMessage`, FR-1006), así que el 422 es una red de seguridad.
Un navegador con la app cacheada de una versión anterior puede recibir 422 donde antes escribía; el
store resincroniza y muestra el aviso. **El peor caso es un mensaje, nunca un dato corrupto.**

## Orden de despliegue — sin ventana peligrosa

No hay orden que respetar, porque no hay migración que se pueda adelantar o retrasar:

- El **código nuevo contra la base vigente** funciona: no necesita ninguna columna que no exista.
- El **código viejo contra la misma base** funciona: no hay nada nuevo que ignorar.

```bash
# 1. Respaldo, como siempre
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > respaldo-$(date +%F).sql

# 2. Construir y levantar la imagen nueva
docker compose build app && docker compose up -d app

# 3. Comprobar salud
docker compose ps            # app en 'healthy'
curl -s https://<host>/health   # {"status":"ok"}
```

## Health checks

Los del proyecto, sin añadidos:

- `GET /health` → `200 {"status":"ok"}`, sin autenticación (NFR-504). Es el endpoint contra el que
  apunta el `HEALTHCHECK` del contenedor.
- `GET /api/v1/ledger` sin sesión → `401`. Confirma que el gate sigue siendo la puerta única.

**Comprobación específica de esta feature** (opcional, tras desplegar). Con una sesión válida, una
escritura fabricada que suba una reserva por encima del techo debe responder `422` y **la base no
debe cambiar**:

```bash
# el estado de después debe ser idéntico al de antes
curl -s -b cookies.txt https://<host>/api/v1/ledger > antes.json
curl -s -b cookies.txt -X PUT https://<host>/api/v1/ledger \
     -H 'Content-Type: application/json' --data @snapshot-que-empeora.json -o rechazo.json -w '%{http_code}\n'
curl -s -b cookies.txt https://<host>/api/v1/ledger > despues.json
diff antes.json despues.json && echo "OK — la base quedó intacta"
```

Ese es literalmente el north star de la feature: ninguna petición fabricada consigue escribir un
estado peor del que había.

## Rollback

**Desplegar la imagen anterior. No hay nada más que deshacer.**

```bash
docker compose down app
docker compose up -d app   # con la etiqueta de imagen previa
```

No hay migración inversa porque no hubo migración. No queda estado a medio convertir. El único
efecto de revertir es que el servidor **deja de rechazar** lo que rechazaba: se vuelve al agujero de
`backend BG-002`, con los datos escritos hasta ese momento intactos y válidos.

## Riesgo residual declarado

El guardia juzga **solo las escrituras que tocan reservas** (ADR-20, decisión del usuario del
2026-09-03). Una petición fabricada que únicamente baje un ingreso puede dejar un mes excedido y no
se rechaza. No es un descuido: el alcance ancho contradice NFR-1803 de `techo-de-flujo`, aprobado y
construido. Cerrar ese lado exige reabrir NFR-1803, que es una decisión de producto, no de
despliegue.
