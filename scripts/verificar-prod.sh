#!/usr/bin/env bash
# Verificación POST-DESPLIEGUE contra producción (Ultron). Un comando, un veredicto.
#
# POR QUÉ EXISTE. Aitri no sabe que existe la Pi: su gate `smoke` arranca la app en un entorno de
# pruebas local, nunca contra producción. Así que lo que confirma que un despliegue quedó bien se
# hacía a mano, consulta por consulta, y dependía de acordarse y de escribirlas sin erratas. El
# 2026-09-23 eso costó un despliegue silenciosamente incompleto: `migrate.mjs` corrió con la imagen
# ANTERIOR —las migraciones viajan DENTRO de la imagen— y no aplicó nada; la app seguía sana y no se
# notaba. Este script lo habría cazado en el acto con la comprobación 3.
#
# QUÉ COMPRUEBA, y falla en voz alta si algo no cuadra:
#   1. /health responde 200 desde dentro del contenedor.
#   2. La imagen que CORRE es la del commit desplegado (y ese commit es el de la rama remota).
#   3. Las migraciones aplicadas en la base son tantas como ficheros hay en el journal.
#   4. Cero celdas descuadradas (FR-2511): celda = suma de sus movimientos.
#   5. Cero movimientos cuyo periodo no case con su fecha.
#   6. Si se le pasa un respaldo, que NINGUNA cifra de `amount_cell` haya cambiado respecto a él.
#
# USO (desde el Mac, o dentro de Ultron):
#   ssh ultron 'cd ~/apps/budget-ledger && scripts/verificar-prod.sh'
#   ssh ultron 'cd ~/apps/budget-ledger && scripts/verificar-prod.sh ~/respaldo-2026-09-23-1430.sql'
#
# Es de solo lectura: no escribe en la base ni toca contenedores.
set -uo pipefail
cd "$(dirname "$0")/.."

RESPALDO="${1:-}"
FALLOS=0
ok()   { printf '  ✅ %s\n' "$1"; }
fallo() { printf '  ❌ %s\n' "$1"; FALLOS=$((FALLOS + 1)); }

if [ -f .env ]; then set -a; . ./.env; set +a; fi
PSQL() { docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At "$@"; }

echo "── 1. La app responde"
if docker compose exec -T app wget -qO- http://127.0.0.1:3000/health 2>/dev/null | grep -q '"status":"ok"'; then
  ok "/health devuelve status ok"
else
  fallo "/health NO responde ok — la app no está sirviendo"
fi

echo "── 2. La imagen que corre es el commit desplegado"
COMMIT=$(git rev-parse --short HEAD)
CORRIENDO=$(docker compose ps --format '{{.Image}}' app 2>/dev/null | head -1 | sed 's/.*://')
if [ "$CORRIENDO" = "$COMMIT" ]; then
  ok "imagen t-ledger:$CORRIENDO = HEAD $COMMIT"
else
  fallo "la imagen que corre es '$CORRIENDO' y HEAD es '$COMMIT' — falta reconstruir o levantar"
fi
git fetch -q origin 2>/dev/null || true
REMOTO=$(git rev-parse --short "origin/$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null || echo "$COMMIT")
if [ "$REMOTO" = "$COMMIT" ]; then
  ok "HEAD está al día con la rama remota"
else
  fallo "la rama remota está en '$REMOTO' y aquí hay '$COMMIT' — falta git pull"
fi

echo "── 3. Las migraciones están todas aplicadas"
# Las migraciones viajan DENTRO de la imagen: si se migró con una imagen vieja, faltan ficheros.
EN_JOURNAL=$(grep -c '"tag"' drizzle/meta/_journal.json)
APLICADAS=$(PSQL -c "SELECT count(*) FROM drizzle.__drizzle_migrations" 2>/dev/null || echo "?")
if [ "$APLICADAS" = "$EN_JOURNAL" ]; then
  ok "$APLICADAS de $EN_JOURNAL migraciones aplicadas"
else
  fallo "aplicadas $APLICADAS de $EN_JOURNAL — migra con la imagen NUEVA: docker compose run --rm app node scripts/migrate.mjs"
fi

echo "── 4. Ninguna celda descuadrada (FR-2511)"
DESCUADRES=$(PSQL -c "
  SELECT count(*) FROM amount_cell c
  JOIN node n ON n.owner_id = c.owner_id AND n.id = c.node_id
  LEFT JOIN (SELECT owner_id, target, period, sum(amount) s FROM movement WHERE type <> 'transfer' GROUP BY 1,2,3) x
    ON x.owner_id = c.owner_id AND x.target = c.node_id AND x.period = c.period
  WHERE c.kind = 'actual' AND n.type <> 'transfer' AND c.amount <> coalesce(x.s, 0)" 2>/dev/null || echo "?")
if [ "$DESCUADRES" = "0" ]; then
  ok "cero celdas descuadradas"
else
  fallo "$DESCUADRES celdas descuadradas — la app se lo va a decir al usuario"
fi

echo "── 5. Ningún movimiento con periodo incoherente"
INCOHERENTES=$(PSQL -c "
  SELECT count(*) FROM movement
  WHERE date IS NOT NULL AND substr(date, 1, 7) <> substr(period, 1, 7)
    AND substr(period, 1, 7) <> to_char((substr(date,1,10))::date + interval '1 month', 'YYYY-MM')" 2>/dev/null || echo "?")
if [ "$INCOHERENTES" = "0" ]; then
  ok "cero movimientos con fecha fuera de su periodo o su ciclo"
else
  fallo "$INCOHERENTES movimientos con periodo incoherente con su fecha"
fi

echo "── 6. Las cifras no cambiaron"
if [ -z "$RESPALDO" ]; then
  echo "  ⏭  sin respaldo que comparar (pásalo como argumento para activar esta comprobación)"
elif [ ! -f "$RESPALDO" ]; then
  fallo "el respaldo '$RESPALDO' no existe"
else
  python3 - "$RESPALDO" > /tmp/verificar-prod-antes.txt <<'PY'
import sys
copia = open(sys.argv[1], encoding="utf-8", errors="replace").read()
bloque = copia.split("COPY public.amount_cell", 1)[1].split("\\.", 1)[0]
filas = [l.split("\t") for l in bloque.splitlines()[1:] if l.strip()]
print("\n".join(sorted(f"{f[1]}|{f[2]}|{f[3]}|{f[4]}" for f in filas)))
PY
  PSQL -F'|' -c "SELECT node_id, period, kind, amount FROM amount_cell ORDER BY 1,2,3" | sort > /tmp/verificar-prod-ahora.txt
  ANTES=$(grep -c '' /tmp/verificar-prod-antes.txt)
  AHORA=$(grep -c '' /tmp/verificar-prod-ahora.txt)
  if diff -q /tmp/verificar-prod-antes.txt /tmp/verificar-prod-ahora.txt >/dev/null; then
    ok "las $AHORA celdas son idénticas a las del respaldo"
  else
    fallo "las cifras cambiaron respecto al respaldo ($ANTES celdas antes, $AHORA ahora):"
    diff /tmp/verificar-prod-antes.txt /tmp/verificar-prod-ahora.txt | head -10
  fi
fi

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "✅ Despliegue verificado: todo en orden."
  exit 0
fi
echo "❌ $FALLOS comprobación(es) fallaron — el despliegue NO está completo."
exit 1
