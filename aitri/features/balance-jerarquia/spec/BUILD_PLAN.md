# BUILD_PLAN — `balance-jerarquia`

Plan generado el 2026-08-25. Fichero de trabajo: ningún gate lo valida; existe para el humano y para
que una sesión nueva pueda retomar el build sin reconstruir el estado.

**Tres epics.** El corte NO es por fichero ni por FR: es por **regla de producto**. EP-01 entrega
«el color significa una sola cosa en toda la pantalla», EP-02 entrega «la tabla deja leer su
aritmética», EP-03 fija las dos por máquina. Cada uno es verificable por sí solo.

Los 34 TCs de `03_TEST_CASES.json` están repartidos: 15 + 16 + 3. Ninguno queda sin epic.

---

## EP-01 — La regla de color, con un solo domicilio   [status: done]

  Delivers:    US-1403, US-1404, US-1405
  FRs:         FR-1403, FR-1404, FR-1405 · NFR-1402
  Makes pass:  TC-BJE-005h, TC-BJE-005e, TC-BJE-005f, TC-BJE-006h, TC-BJE-006e, TC-BJE-006f,
               TC-BJE-007h, TC-BJE-007e, TC-BJE-007f, TC-BJE-008h, TC-BJE-008e, TC-BJE-008f,
               TC-BJE-010h, TC-BJE-010e, TC-BJE-010f
  Build steps: skeleton (`exceptionColor.ts` + sus tests unitarios) → integración (los TRES
               llamantes a la vez: `balanceColor`, `HeaderTotalCell`, chip `RESTANTE`; y el
               em-dash en `BalanceCell`) → hardening (contraste medido en ambos temas, los tres
               canales del negativo)
  Why here:    Primero porque es la mitad de la feature que el usuario puede juzgar de un vistazo,
               y porque los tres llamantes se cambian EN EL MISMO PASO a propósito: arreglar uno y
               olvidar otro es literalmente el defecto que originó esta feature (dos de las tres
               copias se escaparon al redactar los FR). Separarlos en epics distintos reproduciría
               el fallo dentro del plan que existe para corregirlo.

## EP-02 — La escalera   [status: done]

  Delivers:    US-1401, US-1402
  FRs:         FR-1401, FR-1402 · NFR-1401, NFR-1403
  Makes pass:  TC-BJE-001h, TC-BJE-001e, TC-BJE-001f, TC-BJE-002h, TC-BJE-002f, TC-BJE-013h,
               TC-BJE-003h, TC-BJE-003f, TC-BJE-004h, TC-BJE-004e,
               TC-BJE-009h, TC-BJE-009e, TC-BJE-009f, TC-BJE-011h, TC-BJE-011e, TC-BJE-011f
  Build steps: skeleton (campo `level` en `RowSpec` + reordenar `ROWS` + el validador de
               invariantes como función pura, con sus unitarios) → integración (`paddingLeft`
               derivado, con el paso responsive 16/12) → hardening (arrastre entre meses, plegado
               en sus dos niveles, orden de lectura accesible)
  Why here:    Independiente de EP-01 — se podría hacer antes — pero va después porque es la parte
               que ya falló una vez por resultar demasiado sutil. Llegar aquí con EP-01 ya en
               pantalla permite juzgar la escalera sobre el módulo con su color definitivo, que es
               como el usuario la va a ver.

## EP-03 — El cierre mecánico   [status: done]

  Delivers:    (ningún US — NFR-1404, que no cuelga de ninguna historia)
  FRs:         NFR-1404
  Makes pass:  TC-BJE-012h, TC-BJE-012e, TC-BJE-012f
  Build steps: skeleton (comprobación nueva en `scripts/design-tokens.sh`, como lista NEGRA de
               tokens con las dos excepciones legítimas declaradas) → integración (ejecutarlo
               sobre el árbol real) → hardening (probarlo en los TRES sentidos: pasa limpio, falla
               ante el infractor en cada uno de los dos ficheros, y NO se dispara por los usos
               legítimos de `register/` y `Dashboard.tsx`)
  Why here:    Último por necesidad: el gate afirma un invariante sobre el árbol de ficheros, así
               que sólo puede escribirse cuando EP-01 y EP-02 ya dejaron el árbol en su estado
               final. Escribirlo antes obligaría a reescribirlo.

---

## Deuda técnica registrada

1. **`TC-BJE-007e` — la premisa del caso aprobado era FALSA.** El TC de fase 3 decía «un mes entero
   sin datos presenta TODAS sus celdas en em-dash». No existe tal estado en este producto: por el
   ARRASTRE, un mes sin movimientos propios sigue mostrando cifras — «Saldo mes anterior», «Saldo
   disponible» y «Saldo total» se acarrean del mes previo. Un mes con todo en em-dash sólo ocurre
   antes del primer dato del ledger. **Qué se hizo:** el test verifica el criterio VERDADERO y con
   el mismo rigor — en un mes sin movimientos propios no aparece ninguna marca de color: lo sin
   dato va atenuado, lo arrastrado va neutro, cero verde y cero alerta. La desviación está
   declarada en el propio test. Esfuerzo de corregir el TC en el artefacto: bajo, pero cascadearía
   la fase 3.
2. **`FR-1401`, primer criterio de aceptación — INSATISFACIBLE.** Decía «entre dos filas de
   resultado consecutivas no aparece ninguna fila de sumando». En cualquier escalera cada resultado
   va precedido de su bloque de sumandos, luego entre dos resultados consecutivos SIEMPRE hay
   sumandos. Medido el 2026-08-25: el orden anterior (el defectuoso) deja **1** sumando entre
   resultados consecutivos y la escalera deja **2** — el criterio premia al defecto sobre la cura.
   Y contradice al SEGUNDO criterio del mismo FR («cada resultado precedido por el conjunto completo
   de sus sumandos»), que es el correcto. **Qué se hizo** (decisión del usuario, 2026-08-25,
   desviación declarada en vez de cascada): el invariante discriminante es la CONTIGÜIDAD leída
   sobre los niveles —`validateContiguity`, que acepta la escalera y rechaza el estado anterior— y
   `validateCascadeOrder` pasa a comprobar la mitad satisfacible (ningún resultado se calcula antes
   que sus insumos, y la cadena va en orden). La INTENCIÓN de FR-1401 no cambia y lo construido la
   cumple; lo que queda mal redactado es un criterio en el artefacto. Precedente del proyecto:
   `TC-REC-055e`, también por premisa falsa del caso aprobado.
3. **La fila «Retiros del mes» queda fuera de los criterios de celda.** No usa `BalanceCell`: es
   OPERABLE desde la unificación del 2026-07-29 y monta `PlannedWithdrawCell`/`WithdrawCell`, con
   sus propios testids. Así que siete de las ocho filas se verifican por `balance-cell`, no ocho.
   **Por qué se acepta:** su rediseño es BL-019, que está en el `no_go_zone` de esta feature.
   Verificado aparte: esas celdas NO usan `--favorable`, así que no dejan verde huérfano.

## Bitácora de checkpoints

### EP-01 — cerrado el 2026-08-25

Ficheros: `src/components/exceptionColor.ts` (nuevo) · `BalanceModule.tsx` (balanceColor,
BalanceCell, HeaderTotalCell) · `DesktopShell.tsx` (chip RESTANTE) ·
`tests/domain/balance-jerarquia-color.test.ts` (nuevo) · `tests/e2e/balance-jerarquia.spec.ts`
(nuevo) · `tests/e2e/balance.spec.ts` (ADR-02: TC-BAL-935h y TC-BAL-956h actualizados).

Corrida de los 15 TCs del epic:

    tests/domain/balance-jerarquia-color.test.ts   5 passed   (TC-BJE-005h/e/f, 007f)
    tests/e2e/balance-jerarquia.spec.ts           11 passed   (TC-BJE-006h/e/f, 007h/e,
                                                               008h/e/f, 010h/e/f)

Regresión del árbol completo tras el epic:

    npm run test:run          52 files · 439 passed
    npx playwright test      334 passed (2.0m)

ADR-02 aplicado: `TC-BAL-935h` conserva su id e INVIERTE su aserción (de «se pinta en verde» a «se
pinta neutro, y el verde no vuelve»); `TC-BAL-956h` cambia su última aserción de `--success-strong`
a `--fg`. Los dos llevan escrita la revocación y su motivo.

### EP-02 — cerrado el 2026-08-25

Ficheros: `src/components/balanceRows.ts` (nuevo: la tabla + los invariantes) ·
`BalanceModule.tsx` (importa ROWS, `paddingLeft` derivado, hook `useNarrowIndent`) ·
`tests/domain/balance-jerarquia-orden.test.ts` (nuevo) · `tests/e2e/balance-jerarquia.spec.ts`
(ampliado) · `tests/e2e/balance.spec.ts` (TC-BAL-909e: mismo comportamiento, orden actualizado).

Corrida de los 16 TCs del epic:

    tests/domain/balance-jerarquia-orden.test.ts   7 passed   (TC-BJE-001h/e/f, 003h/f, 011f)
    tests/e2e/balance-jerarquia.spec.ts           21 passed   (los 15 de EP-01 + 002h/f, 013h,
                                                               004h/e, 009h/e/f, 011h/e)

Regresión del árbol completo tras el epic:

    npm run test:run          53 files · 446 passed
    npx playwright test      344 passed (2.0m)

Medido sobre la pantalla real del usuario: `paddingLeft` = 62/62/62/46/46/30/30/14 px.

**Desviación de alcance menor, declarada.** El TRD listaba los cambios dentro de
`BalanceModule.tsx`; la tabla `ROWS` y sus invariantes se extrajeron a `src/components/balanceRows.ts`.
No es un cambio de diseño sino la CONSECUENCIA de ADR-04: si `level` es dato declarado para que «un
test pueda afirmar que todo sumando está más adentro que su resultado sin renderizar nada», la tabla
tiene que ser importable sin arrastrar React ni el store. `BalanceModule.tsx` sigue siendo el único
sitio que la pinta.

**Dos defectos que los tests cazaron durante el epic** (los dos habrían pasado una revisión de código):

1. `validateContiguity` recogía NIETOS como si fueran hijos: al retroceder por nivel se llevaba las
   filas de nivel 3 al calcular el bloque de `available` (nivel 1), que reclamaba cinco sumandos en
   vez de dos. Corregido filtrando al nivel inmediatamente inferior.
2. El punto de ruptura de la sangría era `max-width: 1023.98px`, EXCLUSIVO, y el spec fija «a 1024 px
   el paso baja a 12». A 1024 px exactos medía 62 px donde debía medir 50. Corregido a
   `max-width: 1024px`. Es la misma trampa que registró `TC-REC-055e` con `max-[760px]` de Tailwind
   v4, que compila a `width < 760px`: el límite se enuncia inclusivo y se implementa exclusivo.

### EP-03 — cerrado el 2026-08-25

Ficheros: `scripts/design-tokens.sh` (comprobación 7) ·
`tests/integration/design-tokens.test.ts` (ampliado).

Corrida de los 3 TCs del epic:

    tests/integration/design-tokens.test.ts   10 passed   (TC-BJE-012h/e/f + los 7 previos)

El gate se verificó en los TRES sentidos, ejecutándolo de verdad:

    limpio                                        exit 0
    con var(--favorable) en BalanceModule.tsx     exit 1 · nombra fichero y línea
    con var(--favorable) en DesktopShell.tsx      exit 1 · nombra fichero y línea
    con los usos legítimos de Dashboard y grilla  exit 0 · cero falsos positivos

Está escrito como LISTA NEGRA con dos excepciones declaradas (`Dashboard.tsx`, `BudgetGrid.tsx`), no
como lista blanca de ficheros vigilados: un componente NUEVO queda cubierto por defecto en vez de
excluido por defecto — que es exactamente cómo se escapó el chip RESTANTE.

**Detalle que obligó a afinarlo:** los dos ficheros corregidos DOCUMENTAN por escrito el token que
retiraron, así que un barrido ingenuo leía esa documentación como infracción. El gate ignora las
líneas de comentario, y `TC-BJE-012e` lo comprueba explícitamente.

Regresión final del árbol completo:

    npm run test:run          53 files · 449 passed
    npx playwright test      344 passed (2.1m)
    npm run lint             limpio
    ./scripts/design-tokens.sh  exit 0
