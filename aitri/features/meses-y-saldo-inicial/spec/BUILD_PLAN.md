# BUILD_PLAN — meses-y-saldo-inicial

_Generación 1 (2026-09-06). Fichero de trabajo, no artefacto de pipeline: nada lo valida._
_Los 62 TC de `03_TEST_CASES.json` están repartidos: cada uno vive en exactamente una épica._

**Orden por dependencia:** el dominio primero porque todo lo demás lo consume; la persistencia
después porque las dos superficies de UI escriben a través de ella; las dos pantallas al final,
porque son las únicas que se pueden ver y conviene verlas sobre cimientos ya verdes.

---

## EP-01 — Dominio: la apertura existe y llega a las cifras   [status: done]
  Delivers:    US-2201, US-2202
  FRs:         FR-2201, FR-2202
  Makes pass:  TC-MSI-001h, TC-MSI-002f, TC-MSI-003e, TC-MSI-004e, TC-MSI-005e,
               TC-MSI-010h, TC-MSI-011h, TC-MSI-012h, TC-MSI-013f, TC-MSI-014f,
               TC-MSI-015e, TC-MSI-016e, TC-MSI-017e, TC-MSI-018e,
               TC-MSI-040h, TC-MSI-050f, TC-MSI-053h, TC-MSI-054e, TC-MSI-055e,
               TC-MSI-070h, TC-MSI-071f, TC-MSI-072e,
               TC-MSI-080h, TC-MSI-081f, TC-MSI-082e,
               TC-MSI-085h, TC-MSI-086f, TC-MSI-087e
  Build steps: esqueleto (`domain/opening.ts` + los dos campos en `LedgerState`) →
               integraciones (3.er ancla en `range.ts`; `openingCarry` en `BalanceModule` y en
               `closingCarry` de `closure.ts`) → endurecimiento (basura, NaN, mes futuro, dato
               anterior, y la comparación byte a byte de la regresión)
  Why here:    Todo lo demás lo consume. Y es donde vive el riesgo real: 28 de los 62 TC, incluida
               TC-MSI-018e (FLAG-1), que es el único defecto de la feature capaz de pasar todos los
               gates en verde. Sin esta épica en verde, construir UI sería construir sobre arena.

## EP-02 — Persistencia y las dos reglas del servidor   [status: done]
  Delivers:    US-2205, US-2206, US-2207
  FRs:         FR-2205, FR-2206, FR-2207
  Makes pass:  TC-MSI-041f, TC-MSI-043h, TC-MSI-051f, TC-MSI-052e,
               TC-MSI-060h, TC-MSI-061f, TC-MSI-062e, TC-MSI-063e, TC-MSI-064e,
               TC-MSI-090f, TC-MSI-091f, TC-MSI-092h, TC-MSI-093e
  Build steps: esqueleto (migración `0006_saldo_inicial.sql` + columnas en `db/schema.ts`) →
               integraciones (`startPutSchema` y los dos campos en `ledgerStateSchema`;
               `saveStart`/`loadLedger` en `ledgerRepo`; endpoint `PUT /api/v1/ledger/start`;
               `setStart` en el store y en `ServerRepository`) → endurecimiento (409 por revisión
               obsoleta, 401 sin sesión, aislamiento entre usuarios, y el CHECK de la base)
  Why here:    Las dos superficies de UI escriben por aquí, así que va antes que ellas. Reúne
               FR-2205 y FR-2206 porque sus reglas no son código de pantalla: son las que el
               servidor tiene que hacer cumplir, y esa es la razón de que el endpoint exista.

## EP-03 — La tarjeta de arranque   [status: done]
  Delivers:    US-2203
  FRs:         FR-2203
  Makes pass:  TC-MSI-020h, TC-MSI-021h, TC-MSI-022e, TC-MSI-023e, TC-MSI-024f,
               TC-MSI-025e, TC-MSI-026e, TC-MSI-027h,
               TC-MSI-095h, TC-MSI-096f, TC-MSI-097e
  Build steps: esqueleto (`OpeningCard` con su predicado de visibilidad, montada en `BudgetGrid`) →
               integraciones (las cuatro vías de resolución contra `setStart`; el desplegable del
               selector de mes; la copia condicional al mes declarado) → endurecimiento (fallo de
               guardado sin falso «guardado», foco no atrapado, `prefers-reduced-motion`, y la
               ausencia en móvil)
  Why here:    Es la primera cosa que un usuario nuevo ve, y ahora se puede construir contra un
               dominio y una persistencia ya verdes. Su ausencia en móvil sale gratis: `MobileShell`
               no importa la grilla, así que la garantía es estructural.

## EP-04 — Configuración, y el cierre de la feature   [status: done]
  Delivers:    US-2204
  FRs:         FR-2204
  Makes pass:  TC-MSI-030h, TC-MSI-031h, TC-MSI-032e, TC-MSI-033e, TC-MSI-034f, TC-MSI-035h,
               TC-MSI-042e,
               TC-MSI-075h, TC-MSI-076f, TC-MSI-077e
  Build steps: esqueleto (ruta `app/configuracion/page.tsx` y las dos entradas de cabecera) →
               integraciones (los cinco ajustes contra sus mecanismos existentes; `HorizonSelect`
               se MUEVE aquí y se retira de `DesktopShell`) → endurecimiento (campo bloqueado con
               el mes cerrado, ancho oculto en móvil, volver sin perder estado, y el manifiesto de
               construcción con sus quality_gates)
  Why here:    Va la última porque consume todo lo anterior y porque es el camino de VUELTA: solo
               tiene sentido cuando ya hay algo declarado que volver a editar. Recoge además los
               tres TC manuales de NFR-2202, que afirman propiedades de la suite completa y del
               diff, y por tanto solo pueden evaluarse cuando ya no queda nada por construir.

---

## Notas de ejecución

- **Los TC manuales de EP-04** (TC-MSI-075h, 076f, 077e) no se automatizan: son circulares por
  construcción. Se registran con `aitri feature tc meses-y-saldo-inicial mark-manual` y se verifican
  con `aitri feature tc meses-y-saldo-inicial verify` — un TC manual sembrado pero sin verificar NO
  cuenta para la cobertura.
- **TC-MSI-085h (rendimiento)** lleva la guarda de cronómetro que el repo ya usa
  (`it.skipIf` sobre la variable de entorno de instrumentación), por BG-026 y BG-030.
- **`verify-run` una feature a la vez**, esperando a que la carga baje: BG-030 sigue abierto y con
  dos suites concurrentes las aserciones de tiempo de la corrida normal caen por falta de CPU.

---

## Evidencia por épica

### EP-01 — cerrada el 2026-09-06
- `npx vitest run tests/domain/meses-y-saldo-inicial.test.ts --reporter verbose` → **28 passed (28)**,
  exit 0. Los 28 TC de la épica en verde, con TC-MSI-085h ejecutado (cronómetro fiable, no saltado).
- `npx vitest run` (suite completa) → **824 passed (824)**, 67 ficheros, exit 0. La línea base de
  NFR-2202 era 796; 796 + 28 = 824, así que no se perdió ni se relajó ninguna prueba preexistente.
- Ficheros: `src/domain/opening.ts` (nuevo), `src/domain/types.ts` (+2 campos opcionales),
  `src/domain/range.ts` (3.er ancla), `src/domain/closure.ts` (FLAG-1: `closingCarry` abre con
  `openingCarry`), `src/components/BalanceModule.tsx` (la serie abre con la apertura),
  `tests/domain/meses-y-saldo-inicial.test.ts` (nuevo).
- Grafo de imports del dominio verificado sin ciclos: `range → {closure, opening} → balance → reserve`.

### EP-02 — cerrada el 2026-09-06
- `npx vitest run tests/integration/backend/meses-y-saldo-inicial.test.ts` → **12 passed (12)**, exit 0,
  contra Postgres real. `tests/unit/meses-y-saldo-inicial.test.ts` → **1 passed**. Los 13 TC de la épica.
- `npx vitest run` (suite completa) → **837 passed (837)**, 69 ficheros, exit 0.
  Progresión: 796 (base) → 824 (EP-01) → 837 (EP-02). Cero pruebas perdidas o relajadas.
- Ficheros: `drizzle/0006_saldo_inicial.sql` (nuevo, con tres CHECK), `drizzle/meta/_journal.json`
  (entrada 6), `src/server/db/schema.ts` (+2 columnas), `src/server/schemas.ts`
  (`startPutSchema` + los dos campos en `ledgerStateSchema`), `src/server/data/ledgerRepo.ts`
  (`openingFromRow` + `saveStartFor` con las dos reglas), `src/app/api/v1/ledger/start/route.ts`
  (nuevo), `src/data/serverRepository.ts` (`saveStart`), `src/state/store.ts` (`setStart`).

**Dos hallazgos de esta épica, ninguno bloqueante:**

1. **La migración necesitaba entrada en `drizzle/meta/_journal.json`.** Escribir el `.sql` no basta:
   el arnés de pruebas aplica las migraciones por el journal, y sin la entrada 6 los 10 primeros
   tests fallaban con `column "start_month" does not exist`. Queda anotado porque no es evidente y
   la próxima migración lo va a necesigar igual.
2. **`serverScope` no conoce el mes de inicio declarado.** `ledgerRepo.ts:518` deriva su rango de
   `oldestPeriodWithData`/`newestPeriodWithData` + el mes en curso, NO de `activeRange`, así que el
   tercer ancla de FR-2201 no lo alcanza. Consecuencia observada: con un ledger sin datos, el primer
   mes cerrable es el mes en curso, no el mes declarado. **NO se corrige aquí**: cambiarlo alteraría
   qué mes cierra `nextClosable`, que es comportamiento de `cierre-de-mes`, y sería un cambio de
   especificación que hay que enrutar por la pipeline, no absorber en un build. FR-2205 sigue
   funcionando igual porque `closedThrough` es un ESCALAR: cerrar cualquier mes ≥ el de inicio deja
   el de inicio cerrado, y `isClosed` lo detecta. TC-MSI-041f se reescribió al escenario real
   (declarar junio, transcribirlo, cerrarlo) en vez de forzar el código.

### EP-03 — cerrada el 2026-09-07
- `npx playwright test tests/e2e/meses-y-saldo-inicial.spec.ts --workers=1 --retries=0`
  → **11 passed (11)**, exit 0, en 2,3 min. Los 11 TC de la épica.
- Ficheros: `src/components/OpeningCard.tsx` (nuevo), `src/components/BudgetGrid.tsx` (monta la
  tarjeta en un contenedor `relative`), `tests/e2e/meses-y-saldo-inicial.spec.ts` (nuevo),
  `tests/e2e/helpers/opening.ts` y `helpers/pg.ts` (nuevos), `helpers/closure.ts` (usa la conexión
  compartida), `helpers/fixtures.ts` (limpia también la apertura).

**Tres defectos encontrados por las pruebas, los tres reales:**

1. **La declaración sobrevivía entre pruebas.** Pasaban las 3 primeras y morían las 8 siguientes.
   Causa: el PUT del snapshot IGNORA los dos campos a propósito (ADR-02), así que `seedLedger` no
   podía limpiarlos. Es el MISMO problema que `cierre-de-mes` ya había resuelto, y se resolvió igual:
   `resetOpening` por SQL directo, infraestructura de pruebas, sin endpoint de producción. La
   conexión se extrajo a `helpers/pg.ts` para no abrir un segundo pool por worker.
2. **Carrera real en la declaración implícita (estado 4).** Teclear una celda dispara el guardado
   diferido del snapshot; la declaración salía inmediatamente después con la revisión anterior y
   recibía 409. Arreglado con reintento acotado en `OpeningCard`: `ServerRepository` actualiza su
   revisión con la que trae el 409, así que el segundo intento va con la buena. **Pasaría igual en
   producción**, no solo en el test.
3. **El mes iba capitalizado dentro de la frase.** `periodMonthLabel` capitaliza porque su uso
   original es el encabezado de columna; en «cuánto tenías al empezar Junio» está mal. Se pasa a
   minúscula solo en las frases, no en las etiquetas del selector.

**Dos fallos de la suite completa que NO son de esta feature** (verificados en aislado):

- `TC-BJE-012h` (gate de design-tokens): agotó su timeout de 5 s tras **25 s** bajo carga. En
  aislado pasa **10/10**. Es la familia de BG-026/BG-030 — un tope de tiempo fijo mientras otra
  suite compite por CPU. No es una aserción rota.
- `TC-REC-046f` / `TC-REC-047e` (recuperar-acceso): 502 donde se espera 200. Dependen de un relay
  SMTP **externo real**: `.env.local` apunta a Brevo, no a Mailpit. Ese fichero está en `.gitignore`
  y su última modificación es del **2026-08-27**, once días antes de esta sesión: no lo tocó esta
  feature. Re-corridos con el mismo código pasaron de 2 fallos a 1, que es la firma de una
  dependencia de red, no de una regresión.

---

## DECISIÓN PENDIENTE DE ENRUTAR — la semilla con montos de ejemplo (2026-09-07)

**El hallazgo.** La tarjeta de arranque no se le mostrará a ningún usuario nuevo real.
`src/state/store.ts:537` hace `const data = loaded ?? buildSeed(OWNER, currentPeriod())` y persiste
de inmediato; `buildSeed` llama a `genBudget` (`src/domain/seed.ts:133`), que rellena presupuestos y
ejecutados de ejemplo en todas las hojas. Así que un usuario recién registrado YA tiene datos, y el
predicado de FR-2203 —«sin datos NI declaración»— nunca se cumple.

**La regla que el usuario quiere** (2026-09-07, textual): «quien no haya registrado ningún valor en
la historia, allí se muestra». El código de hoy no puede distinguir un monto tecleado por el usuario
de uno puesto por la semilla: para él son la misma celda con número.

**La decisión del usuario:** el usuario nuevo arranca con las celdas VACÍAS. `buildSeed` sigue
creando la estructura de categorías, pero sin montos. Entonces «ningún valor registrado» es
literalmente cierto y la tarjeta funciona sin trucos. Razón adicional que pesó: nadie abre una app
de finanzas personales y ve dinero falso.

**Por qué NO se hace aquí.** Cambia el comportamiento de FR-013, que es del proyecto RAÍZ y no de
esta feature. El protocolo de build es explícito: una corrección que cambia la especificación se
enruta por la pipeline, no se absorbe en un build. Se trata como feature propia y pequeña
(`aitri feature init`) al cerrar meses-y-saldo-inicial.

**Qué NO hay que volver a discutir**, para que la próxima sesión no reabra lo ya cerrado: se
evaluaron y se descartaron las otras dos vías. Comparar contra la semilla recalculada es frágil
—`buildSeed` depende del mes en que se creó la cuenta, y ese dato no se guarda, así que la
comparación fallaría al cambiar de mes—. Y mirar solo los movimientos del diario deja fuera a quien
teclea directamente en la grilla, que no crea movimiento.

### EP-04 — cerrada el 2026-09-07
- `npx playwright test tests/e2e/meses-y-saldo-inicial.spec.ts` → **18 passed (18)**, exit 0 (38 s).
- Suite e2e COMPLETA → **426 passed (426)**, exit 0 (2,8 min). Suite unitaria → **837 passed (837)**,
  exit 0. Gate `./scripts/design-tokens.sh` → exit 0.
- Ficheros: `src/app/configuracion/page.tsx` (nuevo, bajo `LoginGate`),
  `src/components/DesktopShell.tsx` (entrada de ajustes; se RETIRA `HorizonSelect`),
  `src/components/MobileShell.tsx` (entrada de ajustes),
  `src/components/HorizonSelect.tsx` (`mostrarRotulo` opcional; su nota de provisionalidad se
  actualiza a definitiva), `tests/e2e/multi-anio.spec.ts` (la prueba del horizonte navega a la nueva
  ubicación, sin tocar ninguna aserción).

**Tres defectos encontrados, dos de ellos de producto:**

1. **La ruta de Configuración no tenía puerta de sesión.** Era alcanzable SIN autenticar, una fuga
   de superficie que ninguna otra pantalla de datos tiene. Resuelto envolviéndola en `LoginGate`.
2. **Y no hidrataba el store.** Al entrar por URL directa o recargar allí, leía el estado inicial en
   memoria en vez del del servidor: el mes de inicio y el saldo salían vacíos y la regla del mes
   cerrado no se evaluaba. La misma solución lo arregla, porque la hidratación vive EXCLUSIVAMENTE
   en el gate (ADR-06). Lo detectó TC-MSI-042e.
3. **Yo dupliqué el selector de horizonte** en vez de reutilizarlo, contra lo que decía mi propio
   TRD («se mueve, no se reconstruye»). Lo destapó el gate de huérfanos: `HorizonSelect.tsx` se
   quedaba sin consumidor. Corregido reutilizando el componente con un rótulo opcional.

**Una consecuencia aceptada, anotada para que no se descubra tarde:** volver de Configuración
conserva el estado de la GRILLA —filtro de periodo, datos, jerarquía, todo lo que vive en el store,
que es un singleton de módulo— pero NO la pestaña Resumen/Dashboard, que es `useState` local de
`DesktopShell` y se pierde al desmontar. TC-MSI-033e observa el filtro de periodo, que es lo que el
criterio de FR-2204 llama «el estado de la grilla». Llevar la pestaña al store sería un cambio fuera
de alcance.

**Un fallo ajeno confirmado como transitorio:** `TC-REC-023f` (recuperar-acceso) falló por no llegar
el correo en la penúltima corrida y PASÓ en la última, con el mismo código. Depende del relay SMTP
externo que `.env.local` declara. No es de esta feature.

**Nota de proceso:** los gates de `design-tokens.test.ts` usan `git ls-files`, así que con ficheros
sin rastrear dan falsos positivos —`HorizonSelect` aparecía huérfano porque quien lo importa no
estaba en el índice—. Hay que `git add` antes de leer ese gate.
