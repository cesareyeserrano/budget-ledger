#!/usr/bin/env bash
# Gate de tokens de diseño — refinamiento-ui ADR-01.
#
# POR QUÉ EXISTE: `ux-consistency` FR-303 eliminó ~17 tamaños tipográficos ad-hoc, se aprobó y se
# verificó… y al medirlo el 2026-08-05 había 18 otra vez. Una regla visual escrita en una spec no
# sobrevive a la siguiente feature porque nada la comprueba. Este gate convierte las reglas en
# código de salida, igual que security-config.sh hizo con la postura de seguridad.
set -uo pipefail
cd "$(dirname "$0")/.."

FALLOS=()
check() { [ "$2" -eq 0 ] || FALLOS+=("$1"); }

# ── 1. El color por TIPO sólo vive en el registro (FR-1201 / FR-1202) ──────────
# En el registro el color codifica la SELECCIÓN activa (un tipo a la vez, sin estado en pantalla);
# en la grilla codificaría CATEGORÍA y competiría con el estado. Campos perceptuales distintos.
fuera=$(grep -rl "typeColorVar\|typeFillVar\|typeTextColorVar" src/components/ 2>/dev/null \
        | grep -v "^src/components/register/" | grep -v "^src/components/format.ts$" || true)
[ -z "$fuera" ]; check "FR-1201: color por tipo usado fuera de register/: $fuera" $?

# ── 2. Cero tamaños tipográficos ad-hoc (FR-1206) ─────────────────────────────
n=$(grep -rho 'text-\[[0-9.]*rem\]' src/ 2>/dev/null | wc -l | tr -d ' ')
[ "$n" -eq 0 ]; check "FR-1206: $n tamaño(s) text-[…rem] fuera de la escala (línea base histórica: 18)" $?

# ── 3. Cero duraciones escritas a mano (FR-1206) ──────────────────────────────
n=$(grep -rho 'duration-\[[0-9]*ms\]' src/ 2>/dev/null | wc -l | tr -d ' ')
[ "$n" -eq 0 ]; check "FR-1206: $n duración(es) escritas a mano en vez de la escala de motion" $?

# ── 4. La escala semántica de espaciado sigue declarada (FR-1206) ─────────────
# NO se comprueba "rejilla de 4 px": al medirlo aparecieron 19 valores de medio paso, que NO son
# ad-hoc — son la escala por defecto de Tailwind (pasos de 2 px). El diagnóstico original decía que
# "no existe escala de espaciado" y era falso: existe la de Tailwind; lo que faltaba era una capa
# SEMÁNTICA propia. Se declara y se comprueba que siga ahí; forzar la rejilla habría movido píxeles
# en decenas de componentes —incluidas zonas aparcadas— sin ganancia para el usuario.
grep -q -- "--spacing-1:" src/app/globals.css; check "FR-1206: falta la escala semántica de espaciado en @theme" $?

# ── 5. Cero módulos huérfanos (FR-1207) ───────────────────────────────────────
huerfanos=$(python3 - <<'PY'
import re,os,subprocess
src=[f for f in subprocess.run(['git','ls-files','src'],capture_output=True,text=True).stdout.split()
     if f.endswith(('.ts','.tsx')) and os.path.exists(f)]
imported=set()
imp=re.compile(r'from\s+["\']([^"\']+)["\']|import\(["\']([^"\']+)["\']\)')
scan=src+[f for f in subprocess.run(['git','ls-files','tests'],capture_output=True,text=True).stdout.split()
          if f.endswith(('.ts','.tsx')) and os.path.exists(f)]
for f in scan:
    for m in imp.finditer(open(f).read()):
        spec=m.group(1) or m.group(2)
        if spec.startswith('@/'): base='src/'+spec[2:]
        elif spec.startswith('.'): base=os.path.normpath(os.path.join(os.path.dirname(f),spec))
        else: continue
        for c in (base+'.ts',base+'.tsx',base+'/index.ts',base+'/index.tsx',base):
            if c in src: imported.add(c); break
print(' '.join(f for f in src if f not in imported and not f.startswith('src/app/')))
PY
)
[ -z "$huerfanos" ]; check "FR-1207: módulo(s) sin ningún importador: $huerfanos" $?

# ── 6. Los mapeos @theme de Tailwind NO son huérfanos (FR-1207, trampa registrada) ──
# Se consumen por CLASES UTILITARIAS (bg-card, text-fg), no por var(). Un barrido ingenuo los marca
# como muertos y retirarlos rompería el tema entero. El gate comprueba que siguen declarados.
grep -q -- "--color-card:" src/app/globals.css; check "FR-1207: faltan los mapeos @theme de Tailwind — no son huérfanos, se usan por clase" $?

# ── 7. El verde señala EXCEPCIÓN, no normalidad (balance-jerarquia FR-1403/FR-1405, ADR-03) ──
# POR QUÉ: `--favorable` sobrevivió a refinamiento-ui pintando tres filas enteras del Balance y el
# chip RESTANTE de la franja superior — verde permanente que ya no señalaba nada. Ningún test lo
# cazaba: TC-RUI-002f comprueba colores de TIPO, y --favorable no lo es.
#
# Es una LISTA NEGRA con excepciones declaradas, no una lista blanca de ficheros vigilados. Un
# componente NUEVO queda cubierto por defecto en vez de excluido por defecto — que es exactamente
# cómo se escapó el chip RESTANTE, que nadie estaba mirando.
#
# Excepciones legítimas, las dos en el no_go_zone de la feature:
#   · Dashboard.tsx  — el usuario lo excluyó en refinamiento-ui; sus gráficas usan el verde con otra
#                      función (series de datos, no estado).
#   · BudgetGrid.tsx — su `favorable` sale de `cellTone` y es CONDICIONAL al cumplimiento del plan
#                      del ingreso: cambia de estado, luego sí señala algo. Territorio de
#                      budget-state-color FR-401.
# Se ignoran las líneas de COMENTARIO: los dos ficheros corregidos documentan por escrito el token
# que retiraron, y un barrido ingenuo leería esa documentación como una infracción.
verde=$(grep -rn 'var(--favorable)\|var(--success)\|var(--success-strong)' src/components/ 2>/dev/null \
        | grep -v '^src/components/Dashboard\.tsx:' \
        | grep -v '^src/components/BudgetGrid\.tsx:' \
        | grep -vE ':[0-9]+: *(\*|//|\{/\*)' || true)
[ -z "$verde" ]; check "FR-1403/FR-1405: verde de normalidad fuera de sus dos excepciones: ${verde//$'\n'/ | }" $?

if [ ${#FALLOS[@]} -gt 0 ]; then
  echo "❌ design-tokens: el sistema visual retrocedió (${#FALLOS[@]} comprobación(es))"
  for f in "${FALLOS[@]}"; do echo "   · $f"; done
  echo ""
  echo "   Contexto: aitri/features/refinamiento-ui/spec/02_SYSTEM_DESIGN.md — ADR-01"
  exit 1
fi
echo "✅ design-tokens: color por significado, escalas respetadas, sin huérfanos"
exit 0
