#!/usr/bin/env bash
# Smoke gate (NFR-006 + NFR-004/NFR-512): arranca la app y verifica que sirve de verdad —
# que / responde, que /health responde, que las 4 rutas de datos están gateadas sin sesión, y
# que los 5 headers de seguridad viajan en la respuesta.
#
# Arranca el servidor AUTOCONTENIDO (`standalone/server.js`), que es lo que ejecuta la imagen de
# producción, no `next start` (BL-067). Este gate no toca la base: la variante que migra un Postgres
# y hace una petición con sesión es scripts/smoke-backend.sh.
# Un único script (los quality_gates corren sin shell). Falla (exit!=0) si algo de eso no se cumple.
set -euo pipefail

# Independiente del cwd: `aitri feature verify-run <name>` ejecuta los gates con el directorio de la
# FEATURE como working dir, donde ni este script ni package.json existen. Sin este cd, el gate moría
# con spawn ENOENT y se reportaba como `error (exit_code null)` — que es exactamente lo que llevaba
# pasando, en silencio, en todas las features.
cd "$(dirname "$0")"

PORT="${PORT:-3210}"
export PORT

# Directorio de build PROPIO: `aitri verify-run` corre este gate en paralelo con la suite e2e, cuyo
# webServer reescribe `.next`. Compartirlo hacía que se pisaran mutuamente.
NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-smoke}"
export NEXT_DIST_DIR

# BG-014 / RQ-SEC-010: el puerto ocupado por OTRO proceso era el fallo silencioso más caro de este
# gate. `next start` moría con EADDRINUSE y los curl los respondía el servidor ajeno que ya estaba
# ahí — el gate "pasaba" sin haber arrancado nada. Ante un puerto ocupado, fallar en voz alta.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[smoke] FAIL: el puerto $PORT ya está ocupado; abortando para no medir otro proceso."
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN || true
  exit 1
fi

# BG-014 / RQ-SEC-010: antes se compilaba SOLO si faltaba BUILD_ID, así que una vez creado el
# directorio no se recompilaba nunca. El gate llevaba cuatro semanas acreditando un build del 9 de
# julio —anterior a la feature `backend`, sin rutas de API y sin CSP/HSTS en su routes-manifest—
# mientras el código seguía cambiando. Ahora se recompila también si alguna fuente es más reciente.
needs_build=0
if [ ! -f "$NEXT_DIST_DIR/BUILD_ID" ]; then
  needs_build=1
  echo "[smoke] sin build de producción ($NEXT_DIST_DIR/BUILD_ID ausente) — compilando..."
elif [ -n "$(find src next.config.mjs package.json -newer "$NEXT_DIST_DIR/BUILD_ID" 2>/dev/null | head -1)" ]; then
  needs_build=1
  echo "[smoke] hay fuentes más recientes que el build — recompilando..."
fi
[ "$needs_build" -eq 1 ] && npm run build

# BL-067 — SE ARRANCA LO QUE PRODUCCIÓN EJECUTA. La imagen corre `node server.js` sobre la salida
# `standalone` (Dockerfile); este gate arrancaba `next start`, que es otro servidor con otro
# node_modules. Un fallo propio del empaquetado autocontenido —una dependencia que el trazado de
# Next deja fuera, por ejemplo— pasaba el gate y aparecía al desplegar.
#
# `static` y `public` no viajan dentro de `standalone`: Next los deja fuera por diseño y el
# Dockerfile los copia a mano. Aquí se hace la misma copia, en el mismo sitio.
STANDALONE="$NEXT_DIST_DIR/standalone"
if [ ! -f "$STANDALONE/server.js" ]; then
  echo "[smoke] FAIL: el build no emitió $STANDALONE/server.js (¿se quitó output: standalone?)"
  exit 1
fi
rm -rf "$STANDALONE/$NEXT_DIST_DIR/static" "$STANDALONE/public"
cp -R "$NEXT_DIST_DIR/static" "$STANDALONE/$NEXT_DIST_DIR/static"
cp -R public "$STANDALONE/public"

# El servidor autocontenido NO lee .env.local (eso lo hacía `next start`): el entorno va explícito,
# como en el contenedor. Son valores de usar y tirar; la base no se llega a consultar, porque sin
# sesión better-auth resuelve null antes de tocarla.
export DATABASE_URL="${DATABASE_URL:-postgres://ledger:ledger@127.0.0.1:5432/ledger}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-smoke-secret-not-for-production-0000000000}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:$PORT}"
export NODE_ENV=production
# Solo en la máquina: `server.js` escucha en 0.0.0.0 si nadie le dice otra cosa.
export HOSTNAME=127.0.0.1

echo "[smoke] arrancando la app (standalone) en :$PORT"
node "$STANDALONE/server.js" >/tmp/ledger_smoke.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Esperar a que levante (hasta 40s). Si el proceso murió (p. ej. EADDRINUSE), no seguir esperando.
for _ in $(seq 1 40); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[smoke] FAIL: el servidor murió al arrancar"
    tail -20 /tmp/ledger_smoke.log || true
    exit 1
  fi
  if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then break; fi
  sleep 1
done

BASE="http://localhost:$PORT"
fail=0

# `|| echo 000` CONCATENABA con la salida de curl ("000000"): -w ya imprime 000 al fallar.
check_code() { # <ruta> <esperado> <etiqueta>
  local got
  got=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$1" || true)
  got="${got:-000}"
  if [ "$got" = "$2" ]; then
    echo "[smoke] OK   $3 ($1 -> $got)"
  else
    echo "[smoke] FAIL $3 ($1 -> $got, esperado $2)"
    fail=1
  fi
}

# 1) La app arranca y sirve (NFR-006).
check_code "/" 200 "la app responde"
check_code "/health" 200 "healthcheck"

# 1b) La página trae su JavaScript. En el servidor autocontenido `static` se copia aparte: si esa
#     copia falta (aquí o en el Dockerfile), / sigue respondiendo 200 y la app se queda en blanco.
chunk=$(curl -s "$BASE/" | grep -oE '/_next/static/[^"]+\.js' | head -1 || true)
if [ -z "$chunk" ]; then
  echo "[smoke] FAIL la página no referencia ningún script de /_next/static"
  fail=1
else
  check_code "$chunk" 200 "el JavaScript de la página se sirve"
fi

# 2) Las 4 rutas de datos están gateadas sin sesión (FR-504). Verificado independiente de la BD:
#    sin sesión, better-auth resuelve null sin consultar, así que esto NO exige Postgres arriba.
for r in /api/v1/ledger /api/v1/movements /api/v1/movements/smoke-probe /api/v1/sync/stream; do
  check_code "$r" 401 "gating sin sesión"
done

# 3) Los headers de seguridad viajan de verdad (NFR-004 raíz, NFR-512). Next compila headers() al
#    routes-manifest en tiempo de BUILD: un build viejo servía la postura vieja sin que nada avisara.
headers=$(curl -sD - -o /dev/null "$BASE/" || true)
for h in "Content-Security-Policy" "Strict-Transport-Security" "X-Content-Type-Options" "X-Frame-Options" "Referrer-Policy"; do
  if printf '%s' "$headers" | grep -qi "^$h:"; then
    echo "[smoke] OK   header $h"
  else
    echo "[smoke] FAIL header ausente: $h"
    fail=1
  fi
done
# X-Powered-By NO debe aparecer (RQ-SEC-002, ya remediado: que no se revierta en silencio).
if printf '%s' "$headers" | grep -qi "^X-Powered-By:"; then
  echo "[smoke] FAIL X-Powered-By presente (debería estar desactivado)"
  fail=1
else
  echo "[smoke] OK   sin X-Powered-By"
fi

if [ "$fail" -ne 0 ]; then
  echo "[smoke] FAIL: la app arrancó pero no cumple el contrato mínimo de servicio"
  tail -20 /tmp/ledger_smoke.log || true
  exit 1
fi
echo "[smoke] OK"
