#!/usr/bin/env bash
# Suite COMPLETA del backend: la mitad unitaria/integración y la mitad e2e, LAS DOS SIEMPRE.
#
# POR QUÉ EXISTE (BG-004). Antes esto era una cadena con `&&`:
#
#     vitest run --reporter verbose && npm run test:e2e:backend
#
# y con `&&` un solo fallo unitario —aunque fuera intermitente y ajeno al backend— dejaba SIN
# EJECUTAR los 13 casos e2e. Aitri no los veía en la salida y los acreditaba como «saltados», que
# se lee como una omisión deliberada y no como lo que era: no llegaron a correr.
#
# MEDIDO el 2026-09-04: con exit_code 1 salieron 71 pass y 15 skip; tras arreglar BG-026 y salir 0,
# salieron 85 pass y 1 skip sobre el mismo total de 86. El tablero pasó de acreditar 85 a acreditar
# 71 sin que nadie tocara una prueba, y volvió solo. Esa oscilación es la que este script elimina.
#
# Las dos mitades corren SIEMPRE y se devuelve el PEOR código: un fallo sigue siendo un fallo, pero
# la evidencia de la otra mitad no se pierde por el camino.
set -uo pipefail
cd "$(dirname "$0")"

npx vitest run --reporter verbose
unit=$?

npx playwright test --config playwright.backend.config.ts
e2e=$?

# El peor de los dos. `exit 0` solo si ambas pasaron.
if [ "$unit" -ne 0 ]; then exit "$unit"; fi
exit "$e2e"
