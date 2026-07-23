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
trap cleanup EXIT

echo "[smoke-be] arrancando Postgres efímero…"
docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$DB_CONTAINER" -e POSTGRES_USER=ledger -e POSTGRES_PASSWORD=ledger \
  -e POSTGRES_DB=ledger -p "${DB_PORT}:5432" postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$DB_CONTAINER" pg_isready -U ledger >/dev/null 2>&1; then break; fi
  sleep 1
done

export DATABASE_URL="$DB_URL"
export BETTER_AUTH_SECRET="smoke-secret-not-for-production-0000000000"
export BETTER_AUTH_URL="http://localhost:${PORT}"
export NEXT_PUBLIC_LEDGER_SERVER_MODE="true"
export NEXT_DIST_DIR="$DIST"
export NODE_ENV=production
export PORT

echo "[smoke-be] migrando…"
node scripts/migrate.mjs || { echo "[smoke-be] migración falló"; exit 1; }

if [ ! -f "$DIST/BUILD_ID" ]; then
  echo "[smoke-be] compilando (server mode)…"
  npm run build || { echo "[smoke-be] build falló"; exit 1; }
fi

echo "[smoke-be] arrancando la app en :$PORT"
npm run start -- -p "$PORT" >/tmp/ledger_smoke_be.log 2>&1 &
APP_PID=$!

# Esperar /health (hasta 60s).
UP=0
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/health" 2>/dev/null || true)
  if [ "$code" = "200" ]; then UP=1; break; fi
  sleep 1
done
[ "$UP" = "1" ] || { echo "[smoke-be] /health no respondió 200"; cat /tmp/ledger_smoke_be.log | tail -20; exit 1; }

# Rutas clave sin 5xx.
for route in /health /; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}${route}" 2>/dev/null || echo 000)
  echo "[smoke-be] GET ${route} → ${code}"
  if [ "${code:0:1}" = "5" ] || [ "$code" = "000" ]; then
    echo "[smoke-be] FALLA: ${route} devolvió ${code}"
    exit 1
  fi
done
echo "[smoke-be] OK — la app arranca y sirve sin 5xx."
exit 0
