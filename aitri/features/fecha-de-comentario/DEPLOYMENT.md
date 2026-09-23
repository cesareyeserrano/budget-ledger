# Deployment — Feature: fecha-de-comentario

Esta feature **NO cambia el modelo de despliegue**: el mismo contenedor Next.js standalone + Postgres de
la raíz, en Ultron detrás de Tailscale. No añade Dockerfile, servicios, rutas ni variables de entorno.
Ver el `DEPLOYMENT.md`, el `Dockerfile` y el `docker-compose.yml` **de la raíz del proyecto**.

## Qué cambia en el despliegue

Una sola cosa: la migración **`drizzle/0010_fecha_de_comentario.sql`**, registrada en
`drizzle/meta/_journal.json` como la entrada 10.

- Añade la columna `cell_note.date` (texto `AAAA-MM-DD`, admite NULL) y el CHECK `cell_note_date_ck`
  (solo la forma; el calendario lo valida el servidor con zod).
- **Aditiva e idempotente**: no reescribe ninguna fila. Los comentarios que ya existen quedan con
  `date = NULL` y se siguen viendo igual, sin fecha.
- **Orden: migrar ANTES de levantar la imagen nueva.** La imagen nueva selecciona la columna al leer; contra
  una base sin migrar no carga ningún ledger. La imagen vieja funciona contra la base migrada.

## Pasos

```bash
# 1. Respaldo, siempre primero (requisito, ver Rollback)
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > respaldo-$(date +%F-%H%M).sql
# 2. Migrar (aplica 0010 y cualquier otra pendiente, p. ej. la 0009 de diario-de-celda)
docker compose run --rm app node scripts/migrate.mjs
# 3. Comprobar que la columna existe: migrate.mjs ignora EN SILENCIO un .sql ausente del journal
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'cell_note' AND column_name = 'date';"
# 4. Levantar el código nuevo
docker compose up -d --build
```

Dev y pruebas: `npm run db:migrate` contra el Postgres local; los tests de integración migran solos su
Postgres efímero (globalSetup).

## Health check

Sin cambios: `GET /health` responde **200** sin autenticación y el `HEALTHCHECK` del contenedor apunta
ahí; `GET /api/v1/ledger` sin sesión responde **401**. El gate `smoke` los verifica en cada verify.

## Rollback

- **Volver la imagen funciona y no rompe la lectura**: la imagen anterior no conoce `cell_note.date` y
  drizzle solo selecciona las columnas que declara.
- **Pero se pierden días**: el primer PUT de la imagen anterior reescribe el snapshot SIN la columna,
  así que los comentarios escritos entre el despliegue y la vuelta atrás conservan su **texto** pero
  pierden su **día**. Si esos días importan, la única forma de recuperarlos es restaurar el respaldo
  del paso 1, con la pérdida de todo lo escrito después.
- La columna no se deshace: el esquema solo va hacia adelante (ver «La estructura de la base no se
  deshace» en el DEPLOYMENT.md de la raíz).

Para saber cuántos días estarían en juego antes de decidir:

```bash
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT count(*) FROM cell_note WHERE date IS NOT NULL;"
```

## Variables de entorno

Ninguna nueva. No hay `.env.example` propio: la feature usa las de la raíz sin cambios.

## CI/CD

Sin cambios en `.github/workflows/ci.yml`: la migración entra por el mismo mecanismo que la 0000–0009 y
los tests nuevos corren dentro de las suites que el CI ya ejecuta (vitest y Playwright).
