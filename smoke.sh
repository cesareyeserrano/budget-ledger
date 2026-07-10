#!/usr/bin/env bash
# Smoke gate (NFR-006): arranca la app y verifica que / responde sin error de servidor.
# Un único script (los quality_gates corren sin shell). Falla (exit!=0) si / da 5xx o no arranca.
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

# Asegurar build de PRODUCCIÓN. No basta con que exista el directorio: `next dev` también lo crea,
# pero sin BUILD_ID, y entonces `next start` aborta con "Could not find a production build". Ese era
# el motivo por el que este gate nunca llegó a ejecutarse (reportaba error en todas las features).
if [ ! -f "$NEXT_DIST_DIR/BUILD_ID" ]; then
  echo "[smoke] sin build de producción ($NEXT_DIST_DIR/BUILD_ID ausente) — compilando..."
  npm run build
fi

echo "[smoke] arrancando la app en :$PORT"
npm run start >/tmp/ledger_smoke.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Esperar a que levante (hasta 40s).
for _ in $(seq 1 40); do
  if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then break; fi
  sleep 1
done

# `|| echo 000` CONCATENABA con la salida de curl ("000000"): -w ya imprime 000 al fallar.
code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" || true)
code="${code:-000}"
echo "[smoke] GET / -> $code"

if [ "$code" != "200" ]; then
  echo "[smoke] FAIL: / no respondió 200 (recibido $code)"
  tail -20 /tmp/ledger_smoke.log || true
  exit 1
fi
echo "[smoke] OK"
