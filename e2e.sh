#!/usr/bin/env bash
# Gate e2e: corre la suite Playwright COMPLETA y falla (exit!=0) si cualquier test falla.
#
# NOTA (2026-09-09): `npm run test:e2e` YA ES este script. Se cambió en package.json porque el gate
# e2e de la RAÍZ y de siete features estaba declarado como `npm run test:e2e` —playwright pelado—,
# así que corría con el MISMO puerto, el MISMO distDir y el MISMO storageState que la corrida
# autodetectada que Aitri lanza en paralelo: cero aislamiento, justo lo que BG-016/BG-028/BG-036
# habían arreglado sólo para quien llamaba a este script. Enrutar el script npm fue la vía barata
# (package.json es manifiesto de build: no marca deriva de artefacto ni dispara reconcile).
#
# Lo de abajo es la razón ORIGINAL por la que el script existe, y sigue vigente:
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

# BG-028 — `.next-e2e-gate`, NO `.next-e2e`.
#
# Pedía `.next-e2e`, que es exactamente la carpeta que usa la corrida autodetectada: las dos
# compilaban en el mismo sitio y se pisaban los artefactos a mitad de build. Daba igual que la
# variable se exportara —globalSetup la ignoraba con un literal— y al arreglar eso quedaba a la
# vista que el valor pedido tampoco separaba nada. Con carpeta propia, la promesa del comentario
# de arriba («su propio distDir y su propio puerto») es cierta por fin en sus dos mitades.
# `.gitignore` ya cubre el nombre nuevo por el patrón `.next-*/`.
export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-e2e-gate}"
export E2E_PORT="${E2E_PORT:-3230}"

# BG-036 — NAMESPACE PROPIO PARA ESTA SUITE. Lo que compartía con la corrida autodetectada NO era la
# base (cada suite arranca su propio Postgres efímero) sino el fichero de storageState en tmpdir:
# las dos escribían ledger-e2e-storage-state-w0.json, y una cookie sólo vale contra la base de SU
# suite. Con namespace cada una tiene su juego de ficheros. Ver el comentario largo en
# tests/e2e/helpers/globalSetup.ts, que deja dicho lo que esto arregla y lo que NO.
export E2E_ACCOUNT_NS="${E2E_ACCOUNT_NS:-gate-}"

echo "[e2e] suite completa · distDir=$NEXT_DIST_DIR · puerto=$E2E_PORT"
exec npx playwright test
