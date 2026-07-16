# Ambiente de pruebas en Docker (modo servidor)

Un comando levanta todo el stack multiusuario (Postgres + app en modo servidor + migraciones), sin
setup manual. Es el ambiente para **probar/jugar**, no producción (usa un secreto de desarrollo fijo).

## Levantar / parar

```bash
# Levantar (la primera vez construye la imagen ~1-2 min; luego es rápido)
docker compose -f docker-compose.dev.yml up -d --build

# Ver logs
docker compose -f docker-compose.dev.yml logs -f app

# Parar (los DATOS se conservan en el volumen ledger_devdata)
docker compose -f docker-compose.dev.yml down

# Parar y BORRAR los datos (arranque limpio)
docker compose -f docker-compose.dev.yml down -v
```

## Acceso

| Qué | Dónde |
|---|---|
| **App** | http://localhost:3100 (modo servidor: login gate, API, sync) |
| **Postgres** | `localhost:5432` · user/pass/db = `ledger` / `ledger` / `ledger` |
| **URL de la BD** | `postgres://ledger:ledger@localhost:5432/ledger` |
| **Health** | http://localhost:3100/health → `{"status":"ok"}` |

La primera cuenta que registres siembra su ledger y lo persiste en Postgres. Los datos sobreviven a
`down` (y a reinicios) porque viven en el volumen nombrado `ledger_devdata`.

## Ver la base de datos

```bash
# Opción A — Drizzle Studio (visor visual web)
DATABASE_URL="postgres://ledger:ledger@localhost:5432/ledger" npx drizzle-kit studio
#   → abre https://local.drizzle.studio en tu navegador

# Opción B — psql
docker exec -it ledger-dev-db psql -U ledger      # \dt, SELECT * FROM movement; ...

# Opción C — tu GUI (TablePlus/DBeaver/pgAdmin): usa los datos de conexión de la tabla de arriba
```

## Notas

- **Puertos:** usa 3100 (app) y 5432 (Postgres). Si ya tienes algo en esos puertos (p. ej. un
  `next dev` manual o un Postgres suelto), páralo antes o cambia los `ports:` en el compose.
- **Google OAuth** está deshabilitado (sin credenciales); el botón aparece deshabilitado. Para
  probarlo, pon `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` en el `environment:` del servicio `app` y
  `NEXT_PUBLIC_GOOGLE_ENABLED: "true"`, y reconstruye (`--build`).
- **HMR (hot reload):** este ambiente corre el build de producción (sin recarga en caliente). Para
  desarrollar con HMR, corre `next dev` a mano contra este mismo Postgres:
  ```bash
  DATABASE_URL="postgres://ledger:ledger@localhost:5432/ledger" \
  BETTER_AUTH_SECRET="dev-secret-not-for-production-do-not-use-000000" \
  BETTER_AUTH_URL="http://localhost:3100" \
  NEXT_PUBLIC_LEDGER_SERVER_MODE="true" NEXT_PUBLIC_GOOGLE_ENABLED="false" \
  npx next dev -p 3100
  ```
- **Producción:** es `docker-compose.yml` (secretos reales por entorno, sin defaults de desarrollo).
