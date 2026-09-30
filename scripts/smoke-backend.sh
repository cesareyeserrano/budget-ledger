#!/usr/bin/env bash
# @aitri-trace NFR-504/NFR-511 — smoke gate del backend: la app ENSAMBLADA arranca en modo servidor
# contra un Postgres real y sirve sin 5xx. Un único script (los gates corren sin shell). Se auto-ubica
# en la raíz del repo. Requiere Docker.
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${SMOKE_BE_PORT:-3240}"
DB_CONTAINER="ledger-smoke-be-db"
DB_PORT="${SMOKE_BE_DB_PORT:-5442}"
DIST="${SMOKE_BE_DIST:-.next-smoke-be}"
DB_URL="postgres://ledger:ledger@127.0.0.1:${DB_PORT}/ledger"

cleanup() {
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null || true
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
}

# BG-058 (BG-014 portado de smoke.sh): con el puerto ocupado por OTRO proceso, `next start` muere con
# EADDRINUSE y los curl los responde el servidor ajeno; el gate "pasaba" sin haber arrancado nada. Lo
# mismo con el puerto de la BD: si `docker run` no puede publicarlo, las migraciones irían contra el
# Postgres que ya esté ahí. Se comprueba ANTES de levantar nada y antes del trap, para que abortar no
# borre nada. El contenedor propio que dejó una corrida anterior (matada por timeout, sin trap) se
# retira antes de mirar el puerto de la BD: no es un proceso ajeno.
port_busy() { # <puerto>
  if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[smoke-be] FAIL: el puerto $1 ya está ocupado; abortando para no medir otro proceso."
    lsof -nP -iTCP:"$1" -sTCP:LISTEN || true
    exit 1
  fi
}
port_busy "$PORT"
docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
port_busy "$DB_PORT"
trap cleanup EXIT

echo "[smoke-be] arrancando Postgres efímero…"
docker run -d --name "$DB_CONTAINER" -e POSTGRES_USER=ledger -e POSTGRES_PASSWORD=ledger \
  -e POSTGRES_DB=ledger -p "${DB_PORT}:5432" postgres:16-alpine >/dev/null \
  || { echo "[smoke-be] FAIL: no se pudo arrancar el Postgres efímero"; exit 1; }

DB_UP=0
for _ in $(seq 1 30); do
  if docker exec "$DB_CONTAINER" pg_isready -U ledger >/dev/null 2>&1; then DB_UP=1; break; fi
  sleep 1
done
[ "$DB_UP" = "1" ] || { echo "[smoke-be] FAIL: el Postgres efímero no quedó listo en 30s"; exit 1; }

export DATABASE_URL="$DB_URL"
export BETTER_AUTH_SECRET="smoke-secret-not-for-production-0000000000"
export BETTER_AUTH_URL="http://localhost:${PORT}"
export NEXT_PUBLIC_LEDGER_SERVER_MODE="true"
export NEXT_DIST_DIR="$DIST"
export NODE_ENV=production
export PORT

echo "[smoke-be] migrando…"
node scripts/migrate.mjs || { echo "[smoke-be] migración falló"; exit 1; }

# BG-058 (BG-014 portado de smoke.sh): antes se compilaba SOLO si faltaba BUILD_ID, así que el gate
# acreditó desde el 15 de julio un build sin las rutas de closure, preferences ni recovery mientras el
# código seguía cambiando. Ahora se recompila también si alguna fuente es más reciente que el build.
needs_build=0
if [ ! -f "$DIST/BUILD_ID" ]; then
  needs_build=1
  echo "[smoke-be] sin build de producción ($DIST/BUILD_ID ausente) — compilando (server mode)…"
elif [ -n "$(find src next.config.mjs package.json -newer "$DIST/BUILD_ID" 2>/dev/null | head -1)" ]; then
  needs_build=1
  echo "[smoke-be] hay fuentes más recientes que el build — recompilando (server mode)…"
fi
if [ "$needs_build" -eq 1 ]; then
  npm run build || { echo "[smoke-be] build falló"; exit 1; }
fi

echo "[smoke-be] arrancando la app en :$PORT"
npm run start -- -p "$PORT" >/tmp/ledger_smoke_be.log 2>&1 &
APP_PID=$!

# Esperar /health (hasta 60s). Si el proceso murió (p. ej. EADDRINUSE), no seguir esperando.
UP=0
for _ in $(seq 1 60); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "[smoke-be] FAIL: el servidor murió al arrancar"
    tail -20 /tmp/ledger_smoke_be.log || true
    exit 1
  fi
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/health" 2>/dev/null || true)
  if [ "$code" = "200" ]; then UP=1; break; fi
  sleep 1
done
[ "$UP" = "1" ] || { echo "[smoke-be] /health no respondió 200"; cat /tmp/ledger_smoke_be.log | tail -20; exit 1; }

# BG-058: antes bastaba con que no fuera 5xx, así que un 404 —la ruta que el build no tiene— pasaba.
# Ahora cada ruta exige su código exacto. Las rutas GET de datos, sin sesión, responden 401: si el
# build no las trae, responden 404 y el gate cae. `-w` ya imprime 000 si curl no conecta.
fail=0
check_code() { # <ruta> <esperado>
  local got
  got=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}$1" 2>/dev/null || true)
  got="${got:-000}"
  if [ "$got" = "$2" ]; then
    echo "[smoke-be] OK   GET $1 → $got"
  else
    echo "[smoke-be] FAIL GET $1 → $got, esperado $2"
    fail=1
  fi
}

check_code "/health" 200
check_code "/" 200
for r in /api/v1/ledger /api/v1/movements /api/v1/movements/smoke-probe /api/v1/sync/stream \
         /api/v1/closure/events /api/v1/preferences/horizon; do
  check_code "$r" 401
done

if [ "$fail" -ne 0 ]; then
  echo "[smoke-be] FAIL: la app arrancó pero no cumple el contrato mínimo de servicio"
  tail -20 /tmp/ledger_smoke_be.log || true
  exit 1
fi
echo "[smoke-be] OK — la app arranca y sirve sus rutas con el código esperado."
exit 0
