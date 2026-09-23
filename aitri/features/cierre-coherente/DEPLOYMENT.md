# Deployment — Feature: cierre-coherente

Esta feature **NO cambia el modelo de despliegue** ni la base de datos: el mismo contenedor Next.js
standalone + Postgres de la raíz, en Ultron detrás de Tailscale. Ver el `DEPLOYMENT.md`, el `Dockerfile` y el
`docker-compose.yml` **de la raíz del proyecto**.

## Qué cambia en el despliegue

**Nada de infraestructura. SIN migraciones** — es el primer despliegue desde la 0009 que no toca el esquema.
No hay columnas, rutas, servicios ni variables de entorno nuevas.

Lo único que cambia es el COMPORTAMIENTO del cierre: el servidor pasa a contar el mes de inicio declarado
(`ledger.start_month`) para decidir qué mes se cierra, igual que ya hacía el botón.

- **Orden: indiferente.** La imagen nueva y la anterior leen y escriben exactamente las mismas columnas.
- **Sin respaldo obligatorio por esta feature.** El respaldo antes de desplegar sigue siendo buena práctica,
  pero aquí no hay migración que lo haga imprescindible (a diferencia de la 0009 y la 0010).

## Pasos

```bash
docker compose up -d --build
```

## Health check

Sin cambios: `GET /health` responde **200** sin autenticación, `GET /api/v1/ledger` sin sesión responde
**401** y `POST /api/v1/closure` sin sesión responde **401** (TC-CCO-110f). El gate `smoke` los verifica en
cada verify.

## Rollback

**Volver la imagen anterior es suficiente y no pierde ningún dato.** Lo único que revierte es el
comportamiento: el mes cerrable vuelve a anclarse en el primer periodo con datos, es decir, vuelve el defecto
BG-040. Un mes que ya se cerró sigue cerrado, porque `closed_through` es un dato y no depende de esta lógica.

```bash
docker tag t-ledger:<tag-anterior> t-ledger:latest
docker compose up -d
```

## Qué mirar después de desplegar

En la cuenta de producción el inicio declarado y el primer dato coinciden, así que **no debería cambiar
nada**. Para confirmarlo, el botón de cierre debe seguir nombrando el mismo mes que antes:

```bash
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT start_month, closed_through, (SELECT min(period) FROM movement m WHERE m.owner_id = l.owner_id) AS primer_dato FROM ledger l;"
```

Si `start_month` y `primer_dato` son el mismo mes, el comportamiento es idéntico al de antes (NFR-2701).

## Variables de entorno

Ninguna nueva. No hay `.env.example` propio: la feature usa las de la raíz sin cambios.

## CI/CD

Sin cambios en `.github/workflows/ci.yml`: los tests nuevos corren dentro de las suites que el CI ya ejecuta.
