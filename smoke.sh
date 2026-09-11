#!/usr/bin/env bash
# Smoke gate (NFR-006 + NFR-004/NFR-512): arranca la app y verifica que sirve de verdad —
# que / responde, que /health responde, que las 4 rutas de datos están gateadas sin sesión, y
# que los 5 headers de seguridad viajan en la respuesta.
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

echo "[smoke] arrancando la app en :$PORT"
npm run start >/tmp/ledger_smoke.log 2>&1 &
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
