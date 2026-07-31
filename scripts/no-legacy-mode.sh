#!/usr/bin/env bash
# Gate estático de la feature servidor-fuente-unica (FR-1101 / NFR-1107).
#
# Por qué es un gate y no un test: el criterio "grep SERVER_MODE en src/ devuelve 0" es una
# comprobación ESTÁTICA sobre el código fuente. Escribirla como test violaría la regla
# Behavior-vs-Implementation del pipeline (un test que lee el código como texto prueba el código,
# no lo que produce). Como quality_gate corre en cada verify y es honesta sobre lo que es.
#
# Alcance: SOLO src/. Tests y documentación pueden mencionar estos nombres legítimamente
# (p. ej. para explicar qué se retiró), y hacerlos fallar sería un falso positivo.
#
# Salida: 0 si el código está limpio; 1 e imprime las coincidencias si algo reapareció.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

PATRON='SERVER_MODE|LEDGER_SERVER_MODE|LocalStorageRepository'

if ! [ -d src ]; then
  echo "no-legacy-mode: no existe src/ — nada que revisar" >&2
  exit 2
fi

# Solo CÓDIGO, no prosa. Los comentarios que documentan qué se retiró y por qué son deseables
# (src/data/repository.ts explica la retirada de LocalStorageRepository); hacerlos fallar
# obligaría a borrar la explicación para pasar el gate — justo lo contrario de lo que se busca.
# awk separa "archivo:línea:contenido" y descarta el contenido que empieza por *, // o /*.
HITS=$(grep -rEn "$PATRON" src 2>/dev/null \
  | awk -F: '{ resto = substr($0, index($0, $2 ":") + length($2) + 1);
               sub(/^[ \t]+/, "", resto);
               if (resto !~ /^(\*|\/\/|\/\*)/) print }' \
  || true)

if [ -n "$HITS" ]; then
  echo "❌ no-legacy-mode: reapareció el modo retirado en src/"
  echo "   La feature servidor-fuente-unica eliminó el interruptor de rollout y el repositorio de"
  echo "   localStorage. Postgres es la única fuente de verdad (FR-1101/FR-1103)."
  echo ""
  echo "$HITS"
  exit 1
fi

echo "✅ no-legacy-mode: src/ limpio (0 apariciones de $PATRON)"
exit 0
