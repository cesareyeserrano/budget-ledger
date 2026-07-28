#!/usr/bin/env bash
# Mide cobertura desde la RAÍZ (mismo motivo que unit.sh).
# vitest.config.ts ya declara thresholds de 80%: sale distinto de 0 si no se alcanzan, que es
# justo lo que el gate de Aitri necesita para juzgar por exit code.
set -uo pipefail
cd "$(dirname "$0")"
exec npx vitest run --coverage
