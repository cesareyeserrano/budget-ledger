#!/usr/bin/env bash
# Corre la suite unit/integration desde la RAÍZ del proyecto.
#
# Existe por la misma razón que smoke.sh y e2e.sh: `aitri feature verify-run` ejecuta con el
# directorio de la FEATURE como working dir, y varios tests leen archivos por ruta relativa al cwd
# (p. ej. .github/workflows/ci.yml). Desde la carpeta de la feature esos tests fallan con ENOENT
# aunque el producto esté bien. El `cd` lo hace independiente del cwd.
#
# Corre la suite COMPLETA (los dos proyectos de vitest). El proyecto `backend` levanta Postgres con
# testcontainers y su globalSetup resuelve las migraciones contra el cwd: desde la carpeta de la
# feature revienta con "Can't find meta/_journal.json" y aborta la corrida entera antes de acreditar
# un solo TC. Desde la raíz funciona, y su cobertura de src/server/** es la que lleva el total por
# encima del umbral (94% con los dos proyectos, 48% sin el backend).
set -uo pipefail
cd "$(dirname "$0")"
exec npx vitest run --reporter verbose
