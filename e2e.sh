#!/usr/bin/env bash
# Gate e2e: corre la suite Playwright COMPLETA y falla (exit!=0) si cualquier test falla.
#
# Por qué existe este script y no un `command: npm run test:e2e` a secas:
#
#  1. `aitri feature verify-run` ejecuta los quality_gates con el directorio de la FEATURE como
#     working dir, donde no hay package.json. Sin el `cd` de abajo, el gate muere con spawn ENOENT
#     y se reporta como `error (exit_code null)` — un gate muerto es indistinguible de uno verde.
#
#  2. Aitri AUTO-DETECTA el runner de Playwright y lo ejecuta EN PARALELO con los gates. Las dos
#     corridas compartían `.next` (el webServer de Playwright hace `next build`) y el puerto 3220:
#     una le arrancaba el build a la otra por debajo, y el timeout terminaba matando una corrida de
#     12.9 min que aislada tarda 40 s. Aquí la suite del gate compila y sirve en su propio distDir
#     y su propio puerto, así que ambas conviven.
#
# El valor del gate es su EXIT CODE sobre la suite entera: la corrida auto-detectada solo acredita
# los TCs que mapean a un id; un fallo en un test de otra feature no rompería nada sin este gate.
set -euo pipefail

cd "$(dirname "$0")"

export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-e2e}"
export E2E_PORT="${E2E_PORT:-3230}"

echo "[e2e] suite completa · distDir=$NEXT_DIST_DIR · puerto=$E2E_PORT"
exec npx playwright test
