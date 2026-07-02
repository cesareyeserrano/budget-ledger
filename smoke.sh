#!/usr/bin/env bash
# Smoke gate (NFR-006): arranca la app y verifica que / responde sin error de servidor.
# Un único script (los quality_gates corren sin shell). Falla (exit!=0) si / da 5xx o no arranca.
set -euo pipefail

PORT="${PORT:-3210}"
export PORT

# Asegurar build de producción.
if [ ! -d ".next" ]; then
  echo "[smoke] .next ausente — compilando..."
  npm run build
fi

echo "[smoke] arrancando la app en :$PORT"
npm run start >/tmp/ledger_smoke.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Esperar a que levante (hasta 40s).
up=""
for _ in $(seq 1 40); do
  if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then up="1"; break; fi
  sleep 1
done

code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" || echo "000")
echo "[smoke] GET / -> $code"

if [ "$code" != "200" ]; then
  echo "[smoke] FAIL: / no respondió 200 (recibido $code)"
  tail -20 /tmp/ledger_smoke.log || true
  exit 1
fi
echo "[smoke] OK"
