#!/usr/bin/env bash
# Gate estático de configuración de seguridad — el "suelo mecánico" que dejó la auditoría
# adversarial (sección Security de AUDIT_REPORT.md, RQ-SEC-001…006).
#
# Por qué es un gate y no un test: todo lo que comprueba son propiedades ESTÁTICAS de ficheros de
# configuración (next.config, auth.ts, compose). Un test que lee el código como texto probaría el
# código, no lo que produce — misma razón que scripts/no-legacy-mode.sh. Como quality_gate corre en
# cada `aitri verify-run` y re-verifica la postura endurecida ciclo a ciclo.
#
# Lo que NO cubre: la postura en ejecución (headers realmente servidos, gating 401, TLS). Eso lo
# ejercitan el gate de smoke y los TCs de NFR-1106 contra Postgres. Este gate protege contra la
# REGRESIÓN silenciosa de la configuración, que es lo que ningún test verde detecta.
#
# Salida: 0 si la postura se mantiene; 1 enumerando cada comprobación fallida.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

FALLOS=()
check() { # check <descripción> <0|1 resultado>
  if [ "$2" -ne 0 ]; then FALLOS+=("$1"); fi
}

# ── next.config: headers de seguridad y fingerprinting ───────────────────────
NEXT_CFG=$(ls next.config.* 2>/dev/null | head -1)
if [ -z "$NEXT_CFG" ]; then
  echo "security-config: no encuentro next.config.* — ¿cambió el layout?" >&2
  exit 2
fi
grep -q "poweredByHeader:[[:space:]]*false" "$NEXT_CFG"; check "RQ-SEC-002: falta poweredByHeader:false en $NEXT_CFG (el header X-Powered-By delata el framework)" $?
grep -q "Strict-Transport-Security" "$NEXT_CFG";          check "NFR-512: falta el header Strict-Transport-Security en $NEXT_CFG" $?
grep -q "X-Content-Type-Options" "$NEXT_CFG";             check "NFR-512: falta el header X-Content-Type-Options (nosniff) en $NEXT_CFG" $?
grep -q "frame-ancestors 'none'" "$NEXT_CFG";             check "NFR-512: la CSP no cierra el clickjacking (falta frame-ancestors 'none') en $NEXT_CFG" $?

# ── auth: cookies endurecidas y anti-fuerza-bruta ────────────────────────────
AUTH=src/server/auth.ts
if [ ! -f "$AUTH" ]; then
  echo "security-config: no existe $AUTH — ¿cambió el layout?" >&2
  exit 2
fi
grep -q "httpOnly:[[:space:]]*true" "$AUTH"; check "NFR-512: la cookie de sesión perdió httpOnly en $AUTH (un XSS podría exfiltrarla)"  $?
grep -q "sameSite:" "$AUTH";                 check "NFR-512: la cookie de sesión perdió sameSite en $AUTH (es la defensa CSRF efectiva)" $?
grep -q '"/sign-in/email"' "$AUTH";          check "NFR-512: desapareció el rate-limit de /sign-in/email en $AUTH (fuerza bruta sin tope)" $?
grep -q '"/sign-up/email"' "$AUTH";          check "RQ-SEC-004: desapareció el rate-limit de /sign-up/email en $AUTH (creación masiva de cuentas)" $?
# BG-013/RQ-SEC-003: la IP del rate-limit no puede salir de un header que el cliente controla salvo
# que se afirme que hay un proxy saneándolo. Una declaración incondicional apaga el anti-fuerza-bruta
# sin que nada lo delate, así que el gate exige la guarda.
if grep -q "ipAddressHeaders" "$AUTH"; then
  grep -q "e.trustProxy ? { ipAddress:" "$AUTH"
  check "BG-013: $AUTH declara ipAddressHeaders SIN la guarda de trustProxy — el rate-limit del login se llavea por un header que el cliente elige" $?
fi

# ── compose de desarrollo: la BD y su visor NO salen a la red ────────────────
# RQ-SEC-006: pgweb no tiene login. Publicado en 0.0.0.0 era un navegador completo de la base de
# datos financiera para cualquiera en la misma red (verificado: HTTP 200 sin credenciales).
COMPOSE=docker-compose.dev.yml
if [ -f "$COMPOSE" ]; then
  ! grep -qE '^\s*-\s*"5432:5432"' "$COMPOSE"; check "RQ-SEC-006: $COMPOSE publica Postgres en 0.0.0.0 (usa \"127.0.0.1:5432:5432\")" $?
  ! grep -qE '^\s*-\s*"8081:8081"' "$COMPOSE"; check "RQ-SEC-006: $COMPOSE publica pgweb —sin login— en 0.0.0.0 (usa \"127.0.0.1:8081:8081\")" $?
fi

# ── servidor de desarrollo: tampoco sale a la red ────────────────────────────
# RQ-SEC-011 / BL-023: `next dev` liga a 0.0.0.0 por defecto. La instancia de desarrollo quedaba
# alcanzable desde toda la LAN (verificado el 2026-08-05: 200 desde la IP de red, viva 3 días) y el
# secreto de desarrollo está versionado, así que quien llegara podía forjar una sesión válida.
# El script `dev:lan` existe para el caso deliberado de probar desde el móvil; el default, no.
PKG=package.json
if [ -f "$PKG" ]; then
  grep -qE '"dev"[[:space:]]*:[[:space:]]*"next dev -H 127\.0\.0\.1' "$PKG"
  check "RQ-SEC-011: el script \"dev\" de $PKG no liga a 127.0.0.1 (usa \"next dev -H 127.0.0.1\"; para la LAN existe dev:lan)" $?
fi

# ── secretos: ningún .env real versionado ────────────────────────────────────
ENVS=$(git ls-files 2>/dev/null | grep -E '(^|/)\.env' | grep -v '\.env\.example$' || true)
[ -z "$ENVS" ]; check "Secretos: hay ficheros .env versionados en git: $ENVS" $?

# ── dependencias: nada alto/crítico ──────────────────────────────────────────
if command -v npm >/dev/null 2>&1; then
  npm audit --audit-level=high >/dev/null 2>&1
  check "RQ-SEC-005: npm audit reporta vulnerabilidades altas o críticas" $?
fi

if [ ${#FALLOS[@]} -gt 0 ]; then
  echo "❌ security-config: la postura de seguridad retrocedió (${#FALLOS[@]} comprobación(es))"
  for f in "${FALLOS[@]}"; do echo "   · $f"; done
  echo ""
  echo "   Contexto y remediación: sección Security de aitri/product/spec/AUDIT_REPORT.md"
  exit 1
fi

echo "✅ security-config: la postura endurecida se mantiene (headers, cookies, rate-limit, bindings, secretos, deps)"
exit 0
