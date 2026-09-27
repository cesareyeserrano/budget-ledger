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
# Se separan DOS casos que `npm audit` colapsa en el mismo exit 1: encontrar una vulnerabilidad
# alta, y no poder ejecutar el escaneo (endpoint caído, 400, sin red). La versión anterior mandaba
# la salida a /dev/null y reportaba SIEMPRE «npm audit reporta vulnerabilidades altas o críticas»
# — un mensaje que MIENTE cuando el escaneo ni siquiera corrió, y que además borraba la única pista
# para averiguarlo. Lo vimos en el cron semanal del CI: seis rojos idénticos con dos causas
# opuestas (2026-09-18).
if command -v npm >/dev/null 2>&1; then
  SCA_OUT=$(npm audit --audit-level=high 2>&1); SCA_RC=$?
  if [ $SCA_RC -ne 0 ] && printf '%s' "$SCA_OUT" | grep -qiE 'audit endpoint returned an error|Invalid package tree|Bad Request|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET'; then
    # Falla igual —un escaneo que no corre no acredita nada— pero dice la verdad sobre por qué.
    check "RQ-SEC-005: el escaneo NO SE EJECUTÓ (npm audit no pudo completar; esto no es un hallazgo): $(printf '%s' "$SCA_OUT" | tr '\n' ' ' | cut -c1-200)" 1
  else
    check "RQ-SEC-005: npm audit reporta vulnerabilidades altas o críticas" $SCA_RC
  fi
fi

# ── recuperación de contraseña: postura del flujo (NFR-1306) ─────────────────
# Cuatro propiedades ESTÁTICAS que ningún test verde detecta si retroceden. Se comprueban aquí, y no
# en un test, por la misma razón que el resto de este gate: son propiedades de la configuración, y un
# test que lee configuración como texto probaría el código, no lo que produce.
if [ -f "$AUTH" ]; then
  # 1) La expiración del secreto no puede alargarse en silencio. 1800 s = 30 min (FR-1304), que es
  #    además lo que el correo le promete al usuario.
  grep -qE 'resetPasswordTokenExpiresIn:[[:space:]]*RESET_TOKEN_TTL_SECONDS' "$AUTH"
  check "NFR-1306: $AUTH no fija resetPasswordTokenExpiresIn (el secreto usaría la hora por defecto de la librería, no los 30 min prometidos)" $?
  grep -qE 'RESET_TOKEN_TTL_SECONDS[[:space:]]*=[[:space:]]*1_?800' "$AUTH"
  check "NFR-1306: RESET_TOKEN_TTL_SECONDS ya no vale 1800 s en $AUTH (FR-1304 promete 30 minutos en pantalla y en el correo)" $?

  # 2) Cambiar la contraseña DEBE cerrar las sesiones abiertas (FR-1309). Si esto se apaga, un
  #    acceso robado sobrevive a la recuperación — y la recuperación deja de servir para lo que
  #    más importa: recuperar una cuenta comprometida.
  grep -qE 'revokeSessionsOnPasswordReset:[[:space:]]*true' "$AUTH"
  check "NFR-1306/FR-1309: $AUTH no invalida las sesiones al recuperar (revokeSessionsOnPasswordReset debe ser true)" $?

  # 3) El endpoint de recuperación debe seguir acotado, como el login (NFR-1303).
  grep -qE '"/request-password-reset":[[:space:]]*\{' "$AUTH"
  check "NFR-1303: $AUTH no acota /request-password-reset (sería el único endpoint de credenciales sin límite)" $?
fi

# 4) Ninguna credencial SMTP puede alcanzar el navegador: NEXT_PUBLIC_ es el único prefijo que Next
#    inlinea al cliente, y el módulo de correo debe seguir marcado como exclusivo de servidor.
! grep -rqE 'NEXT_PUBLIC_SMTP' src 2>/dev/null
check "NFR-1306: hay una variable NEXT_PUBLIC_SMTP_* en src/ — las credenciales de correo llegarían al navegador" $?
if [ -f src/server/mail/mailer.ts ]; then
  grep -qE '^import "server-only";' src/server/mail/mailer.ts
  check "NFR-1304: src/server/mail/mailer.ts perdió la marca server-only — nodemailer podría acabar en el bundle del cliente" $?
fi

# ── API: toda ruta de /api/v1 exige sesión, salvo una lista explícita (RQ-SEC-104) ──────
# No hay middleware: la sesión se exige ruta por ruta, así que una ruta nueva sin `withApi` —o con
# auth:"public" por descuido— nacería abierta y ningún test verde lo delataría. Ampliar la lista de
# públicas tiene que verse en el diff, con el FR que lo justifica.
PUBLICAS_OK="src/app/api/v1/recovery/request/route.ts" # FR-1303: pedir el enlace no puede exigir sesión
while IFS= read -r r; do
  case " $PUBLICAS_OK " in *" $r "*) continue ;; esac
  if grep -qE 'auth:[[:space:]]*"required"' "$r" || grep -q 'getSessionUser' "$r"; then continue; fi
  check "RQ-SEC-104: $r no exige sesión (usa withApi con auth:\"required\", o añádela a PUBLICAS_OK con su FR)" 1
done < <(find src/app/api/v1 -name route.ts | sort)
for r in $PUBLICAS_OK; do
  [ -f "$r" ] || check "RQ-SEC-104: la ruta pública $r ya no existe — revisa la lista PUBLICAS_OK" 1
done

# ── scripts que leen datos de producción: nada a rutas fijas de /tmp (BG-047 / RQ-SEC-108) ──
for s in scripts/verificar-prod.sh; do
  [ -f "$s" ] || continue
  ! grep -qE '>[[:space:]]*/tmp/' "$s"
  check "RQ-SEC-108: $s escribe datos de producción en una ruta fija de /tmp (usa mktemp -d + umask 077 + trap rm)" $?
  grep -q 'mktemp' "$s" && grep -qE "trap .*rm" "$s"
  check "RQ-SEC-108: $s no borra sus copias temporales al salir (falta mktemp o el trap rm)" $?
done

# ── interruptores de prueba: nunca en producción (BG-048 / RQ-SEC-109) ───────────────────
# LEDGER_RATE_LIMIT_DISABLED apaga el anti-fuerza-bruta. Solo actúa con la puerta de pruebas abierta,
# y el compose de producción no reenvía ni el interruptor, ni la puerta, ni un env_file entero.
! grep -qE 'LEDGER_RATE_LIMIT_DISABLED|LEDGER_TEST_OVERRIDES|^[[:space:]]*env_file' docker-compose.yml
check "RQ-SEC-109: docker-compose.yml reenvía un interruptor de pruebas o un env_file (podría apagar el rate-limit del login en producción)" $?
grep -q 'process.env.LEDGER_TEST_OVERRIDES === "1"' src/server/rateLimit.ts
check "RQ-SEC-109: src/server/rateLimit.ts ya no ata LEDGER_RATE_LIMIT_DISABLED a la puerta LEDGER_TEST_OVERRIDES=1" $?
grep -qE 'const RATE_LIMIT_DISABLED[[:space:]]*=[[:space:]]*rateLimitDisabled\(\)' "$AUTH"
check "RQ-SEC-109: $AUTH no decide su rate-limit con rateLimitDisabled() (se saltaría la puerta de pruebas)" $?

# ── compose de desarrollo: TODO puerto ligado a loopback (BG-049 / RQ-SEC-110) ───────────
# Generaliza las dos comprobaciones de RQ-SEC-006 a cualquier servicio, también a los futuros.
if [ -f "$COMPOSE" ]; then
  ! grep -qE '^[[:space:]]*-[[:space:]]*"?[0-9]+:[0-9]+' "$COMPOSE"
  check "RQ-SEC-110: $COMPOSE publica un puerto en 0.0.0.0 (antepón 127.0.0.1:)" $?
fi

# ── datos personales: ningún correo real versionado (RQ-SEC-107) ─────────────────────────
# El repo es público. Solo se admiten dominios de prueba o de ejemplo; un correo de un dominio real
# (el del propietario, el de cualquier persona) no puede llegar al árbol. Si hace falta uno nuevo de
# ejemplo, usa @example.com.
DOMINIOS_OK='example\.com|test\.local|admin\.com|correo\.com|interno\.local|ledger\.test|ledger\.local|ejemplo\.test|dominio\.com|users\.noreply\.github\.com'
CORREOS=$(git grep -h -o -I -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' -- ':!package-lock.json' 2>/dev/null \
  | grep -viE "@(${DOMINIOS_OK})$" | sort -u | tr '\n' ' ')
[ -z "$CORREOS" ]
check "RQ-SEC-107: hay correos de dominios reales versionados (el repo es público): $CORREOS" $?

if [ ${#FALLOS[@]} -gt 0 ]; then
  echo "❌ security-config: la postura de seguridad retrocedió (${#FALLOS[@]} comprobación(es))"
  for f in "${FALLOS[@]}"; do echo "   · $f"; done
  echo ""
  echo "   Contexto y remediación: sección Security de aitri/product/spec/AUDIT_REPORT.md"
  exit 1
fi

echo "✅ security-config: la postura endurecida se mantiene (headers, cookies, rate-limit, rutas con sesión, bindings, secretos, correos, deps)"
exit 0
