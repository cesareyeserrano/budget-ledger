#!/usr/bin/env bash
# @aitri-trace NFR-513 — gate de escaneo de secretos. Exit != 0 si hay un secreto hardcodeado en el
# árbol de fuentes. Usa gitleaks si está instalado; si no, un fallback de patrones. Un único script
# (los quality_gates corren sin shell). Se auto-ubica en la raíz del repo (verify-run corre los gates
# con el dir de la feature como cwd).
set -uo pipefail
cd "$(dirname "$0")/.."

# Rutas a escanear (fuentes + config), excluyendo dependencias, builds, ejemplos y fixtures de test.
SCAN_DIRS=(src scripts .github next.config.mjs docker-compose.yml drizzle.config.ts)

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source . --no-git --redact --exit-code 1 \
    --report-path /tmp/gitleaks-report.json >/dev/null 2>&1
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "[secret-scan] gitleaks detectó secretos (exit $code)"
    exit 1
  fi
  echo "[secret-scan] gitleaks: sin secretos."
  exit 0
fi

# Fallback: patrones de secretos comunes.
PATTERNS='(AKIA[0-9A-Z]{16})|(-----BEGIN [A-Z ]*PRIVATE KEY-----)|((BETTER_AUTH_SECRET|GOOGLE_CLIENT_SECRET|DATABASE_URL)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9+/_-]{16,}["'"'"'])|(xox[baprs]-[0-9A-Za-z-]{10,})'

# Marcadores de valores throwaway (NO son secretos: placeholders de build/smoke/e2e). Se filtran para
# no dar falsos positivos; un secreto real no lleva estos marcadores. No se filtra "example" porque
# claves de ejemplo tipo AKIA...EXAMPLE deben seguir detectándose.
PLACEHOLDERS='not-for-production|placeholder|change-me|smoke-secret|build-time|0000000000'

found=0
for target in "${SCAN_DIRS[@]}"; do
  [ -e "$target" ] || continue
  hits=$(grep -rInE --binary-files=without-match "$PATTERNS" "$target" 2>/dev/null | grep -vEi "$PLACEHOLDERS")
  if [ -n "$hits" ]; then
    echo "$hits"
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo "[secret-scan] se detectaron posibles secretos hardcodeados (patrón)."
  exit 1
fi
echo "[secret-scan] sin secretos (fallback de patrones)."
exit 0
