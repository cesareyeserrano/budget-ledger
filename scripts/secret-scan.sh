#!/usr/bin/env bash
# @aitri-trace NFR-513 — gate de escaneo de secretos. Exit != 0 si hay un secreto hardcodeado en el
# árbol. Un único script (los quality_gates corren sin shell). Se auto-ubica en la raíz del repo
# (verify-run corre los gates con el dir de la feature como cwd).
#
# DOS PASADAS, y las dos cuentan (BL-068):
#
#   1. Patrones propios — SIEMPRE. Cubren lo que este proyecto puede filtrar de verdad y que un
#      escáner genérico no mira: una cadena de conexión con la contraseña dentro, las claves de
#      Brevo, los secretos de Better Auth y de Google por su nombre.
#   2. gitleaks, con sus reglas por defecto más .gitleaks.toml — cuando está instalado. En el CI es
#      OBLIGATORIO (SECRET_SCAN_REQUIRE_GITLEAKS=1): si falta, el gate falla en vez de callar.
#
# Antes era «gitleaks si está, y si no los patrones». gitleaks no estaba instalado en ningún sitio,
# así que la rama nunca corría; y de haber corrido habría APAGADO los patrones, que son los únicos
# que ven una DATABASE_URL. El patrón de DATABASE_URL, además, exigía un valor sin `:` ni `@`: no
# podía casar con ninguna cadena de conexión.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd -P)

# RAÍZ A ESCANEAR. Sin argumento, la del repo — que es como lo invoca el gate y como debe quedarse.
# El argumento existe SOLO para que la prueba del propio gate (TC-BE-085e) pueda plantar su secreto
# en un árbol aislado en vez de ensuciar `src/` (BG-033): con dos corridas de vitest a la vez —lo
# que `aitri verify-run` hace siempre— una plantaba el fichero y la otra, al comprobar «el árbol
# limpio pasa», encontraba el secreto de su vecina y fallaba. Un rojo fantasma que no era del gate
# ni del código.
if [ "$#" -gt 0 ]; then cd "$1" || exit 2; fi

# QUÉ SE ESCANEA: todo lo versionado más lo nuevo que git no ignora. Antes eran seis rutas a mano y
# quedaban fuera tests/, los scripts de la raíz, el Dockerfile, docker-compose.dev.yml y aitri/.
# Preguntarle a git deja fuera node_modules, los builds y .env.local sin tener que enumerarlos.
# Fuera de un repo (el árbol aislado de la prueba) se recorre el directorio.
listar() {
  if [ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$(pwd -P)" ]; then
    git ls-files -co --exclude-standard -z
  else
    find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './.next*/*' -print0
  fi
}

# package-lock.json: miles de hashes de integridad en base64; ningún secreto vive ahí y es donde un
# patrón corto acabaría casando por azar.
EXCLUIR='(^|/)package-lock\.json$'

# ── 1. Patrones propios ────────────────────────────────────────────────────────────────────────
CLAVES='(AKIA[0-9A-Z]{16})'
CLAVES+='|(-----BEGIN [A-Z ]*PRIVATE KEY-----)'
CLAVES+='|(xox[baprs]-[0-9A-Za-z-]{10,})'
CLAVES+='|(gh[pousr]_[A-Za-z0-9]{36,})|(github_pat_[A-Za-z0-9_]{22,})'
CLAVES+='|(AIza[0-9A-Za-z_-]{35})'
CLAVES+='|(sk_live_[0-9A-Za-z]{24,})'
CLAVES+='|(x(keysib|smtpsib)-[a-f0-9]{64}-[A-Za-z0-9]{16})'
CLAVES+='|(eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,})'
# Un secreto asignado por su nombre, con o sin comillas (un .env no las lleva).
CLAVES+='|((BETTER_AUTH_SECRET|GOOGLE_CLIENT_SECRET|SMTP_PASSWORD|POSTGRES_PASSWORD)[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9+/_=-]{16,})'
# Una cadena de conexión con usuario Y contraseña delante de la arroba del host. La contraseña no
# admite `/` para que una URL con puerto y una arroba más adelante no cuente como credencial.
CLAVES+='|([a-z][a-z0-9+.-]*://[^/[:space:]:@]+:[^@/[:space:]"'"'"'`]+@)'

# Lo que NO es un secreto aunque case:
#  · valores de usar y tirar de build, smoke y e2e, que se reconocen por su marcador. No se filtra
#    «example»: una clave tipo AKIA…EXAMPLE debe seguir detectándose (TC-BE-085e lo comprueba).
#  · las credenciales de desarrollo y de prueba que el repo documenta a propósito (la base local es
#    ledger:ledger, la del build es build:build), y una contraseña interpolada (`:${VAR}@`).
#  · la línea marcada con `gitleaks:allow`, el mismo marcador que respeta gitleaks.
PERMITIDO='not-for-production|placeholder|change-me|smoke-secret|build-time|0000000000|ledger-e2e|secreto-de-prueba|marcador-'
PERMITIDO+='|://(ledger:ledger|build:build|u:p|x:x|test:test|ledger:secreto)@'  # gitleaks:allow
PERMITIDO+='|://[^/[:space:]:@]+:\$'
PERMITIDO+='|gitleaks:allow'

hits=$(listar | grep -zvE "$EXCLUIR" | xargs -0 grep -nIsE -- "$CLAVES" 2>/dev/null | grep -vE "$PERMITIDO")
if [ -n "$hits" ]; then
  # Se imprime dónde, nunca el valor: la salida de un gate acaba en logs del CI.
  printf '%s\n' "$hits" | cut -d: -f1,2 | sed 's/^/[secret-scan] posible secreto en /'
  echo "[secret-scan] se detectaron posibles secretos hardcodeados (patrones)."
  exit 1
fi
echo "[secret-scan] patrones: sin secretos."

# ── 2. gitleaks ────────────────────────────────────────────────────────────────────────────────
if ! command -v gitleaks >/dev/null 2>&1; then
  if [ "${SECRET_SCAN_REQUIRE_GITLEAKS:-0}" = "1" ]; then
    echo "[secret-scan] FAIL: gitleaks es obligatorio aquí (SECRET_SCAN_REQUIRE_GITLEAKS=1) y no está instalado."
    exit 1
  fi
  echo "[secret-scan] gitleaks no está instalado: solo corrieron los patrones (el CI sí lo exige)."
  exit 0
fi

# gitleaks recorre un directorio entero, sin mirar .gitignore: en la raíz del repo se pasearía por
# node_modules y los builds. Se le da una copia con SOLO la lista de arriba.
copia=$(mktemp -d)
trap 'rm -rf "$copia"' EXIT
listar | grep -zvE "$EXCLUIR" | rsync -a --from0 --files-from=- ./ "$copia/" 2>/dev/null
if ! gitleaks dir "$copia" --config "$REPO/.gitleaks.toml" --no-banner --redact --verbose --exit-code 1 2>&1 | sed "s|$copia/||g"; then
  echo "[secret-scan] gitleaks detectó secretos."
  exit 1
fi
echo "[secret-scan] gitleaks: sin secretos."
exit 0
