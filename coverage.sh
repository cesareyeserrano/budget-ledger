#!/usr/bin/env bash
# Mide cobertura desde la RAÍZ (mismo motivo que unit.sh).
# vitest.config.ts ya declara thresholds de 80%: sale distinto de 0 si no se alcanzan, que es
# justo lo que el gate de Aitri necesita para juzgar por exit code.
set -uo pipefail
cd "$(dirname "$0")"

# Silencia los guardarrailes de tiempo: bajo instrumentacion el cronometro mide el coste de
# contar ramas, no el del algoritmo (BG-026, ver tests/helpers/perf.ts).
export AITRI_COVERAGE=1
exec npx vitest run --coverage
