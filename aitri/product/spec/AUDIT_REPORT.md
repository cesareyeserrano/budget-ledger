# Audit Report — T-Ledger

## Technical Review (código) — 2026-07-28

_Auditoría técnica bajo demanda sobre el árbol en `feat/balance` (HEAD 56f92fa). Método: lectura del código real (73 archivos en `src/`, 5.645 líneas) a lo largo de las cinco dimensiones — calidad, arquitectura, lógica, seguridad y stack — más ejecución de `npm run lint`, `npm audit`, `npm outdated` y una prueba dirigida para confirmar la hipótesis del hallazgo BUG-1. Los `archive/` no se leyeron (histórico)._

**Qué se revisó explícitamente por dimensión:** *Calidad* — funciones >40 líneas, anidamiento, exports sin uso, duplicación entre `store.ts` y `data/makeRepo.ts`. *Arquitectura* — separación dominio puro / estado / repositorio / servidor, caminos de error de `persist()`, estado en memoria (`SyncHub`) frente a multi-instancia. *Lógica* — invariante `padre == Σhojas` en `mutations.ts`/`rollup.ts`, casos borde de `budgetState`, `balance.ts`, ciclos en `tree.ts`, monotonía de `createdAt`. *Seguridad* — validación Zod en el borde, aislamiento por `ownerId`, cabeceras de `next.config.mjs`, cookies/rate-limit de `auth.ts`, secretos en el árbol, `npm audit`. *Stack* — versiones mayores atrasadas, gates declarados en `04_BUILD_REPORT.json`, CI, linter.

### GAP-16 — El montos de la semilla: el discovery aprobado lo pide y FR-013 ya lo niega (2026-09-07)

**Estado: UNCOVERED — y no registrado en ninguna parte del rastro de la raiz.**

**La necesidad, citada literal.** El discovery aprobado, criterio de exito 1:

> "**Primer arranque operable sin configuracion:** al abrir la app sin datos previos, el usuario ve
> una estructura de categorias **y montos semilla coherentes** y puede empezar a operar de inmediato
> (0 pasos de configuracion obligatorios)."

Y el brief original, en sus criterios de exito:

> "Given un usuario nuevo, when abre la app por primera vez, then ve datos semilla coherentes
> (**jerarquia + montos dummy**) y puede operar sin configuracion."

**Lo que dice hoy el requisito.** FR-013 fue enmendado el 2026-09-07 por decision del usuario: la
semilla genera la jerarquia **SIN montos** — `budgets` y `actuals` salen sin una sola clave. La feature
`semilla-intacta` (FR-2301/FR-2302) lo implementa. La razon de producto es solida y esta escrita:
nadie abre una app de finanzas personales y quiere ver dinero que no tecleo; ademas esos montos
tapaban la tarjeta de arranque de FR-2203, que por eso no se le mostro nunca a ningun usuario real.

**Por que ES un hallazgo aunque la decision sea legitima.** El cambio es del cliente y esta bien
tomado. Lo que falta es el RASTRO: la mitad "montos" del criterio de exito 1 del discovery aprobado
dejo de estar cubierta y **eso no se registro en ningun sitio**.

- `coverage_map` de la raiz sigue diciendo `"Datos semilla determinísticos al primer arranque (seed
  editable)" -> FR-013`. Sigue siendo cierto para la jerarquia y **calla** que los montos salieron.
- `idea_gaps` de la raiz esta **VACIO** (0 entradas), asi que no hay ninguna anotacion de la divergencia.
- `00_DISCOVERY.md` conserva su criterio de exito 1 intacto, contradiciendo al FR que lo implementa.

Es exactamente el patron que las auditorias anteriores SI manejaron bien en tres casos comparables
—la categoria "Sin asignar" (FR-003 declara "SUSTITUYE el mecanismo del brief original"), la lista de
"Movimientos recientes" (BL-003, con su entrada de out_of_scope) y el tema oscuro unico (FR-012
declara "SUSTITUYE el 'tema oscuro unico' del brief original")—. Aqui falto hacer lo mismo.

**Matiz que importa para no sobreactuar.** El criterio de exito 1 tiene DOS mitades y solo se perdio
una. "0 pasos de configuracion obligatorios" y "puede empezar a operar de inmediato" **siguen
cumpliendose**: el usuario nuevo recibe su jerarquia completa de 12 nodos y puede teclear en cualquier
celda desde el primer segundo. No ve una pantalla en blanco. Lo que ya no ve son los montos de ejemplo.

**Accion sugerida — una de las dos, no ambas:**

1. **Registrar la divergencia** (barato, y es lo que el patron del proyecto pide): anadir la entrada a
   `coverage_map` y a `idea_gaps` de la raiz declarando que la mitad "montos semilla" del SC-1 se
   retiro por decision del usuario del 2026-09-07, con su motivo. No reabre nada mas.
2. **Actualizar `00_DISCOVERY.md`** para que su criterio de exito 1 diga lo que el producto hace hoy.
   Es lo mas limpio, pero toca la fase de discovery aprobada y arrastra su propia cascada.

**Nota de honestidad sobre esta auditoria:** la enmienda a FR-013 la escribio esta misma sesion, unas
horas antes de correr este pase, asi que sobre ESTE hallazgo la auditoria no es independiente. Los
demas requisitos de la raiz los escribieron sesiones anteriores.

---

### Findings → Bugs

**[BUG-1]** `[severity: high]` — `moveNode` hacia una categoría-hoja con montos borra sus montos del roll-up (pérdida silenciosa de dinero)
- File: `src/domain/mutations.ts:394-407` (rama `dest.kind === "category"`)
- Problem: cuando el usuario arrastra una subcategoría dentro de una **categoría hoja que ya tiene montos propios**, la categoría destino gana su primer hijo y deja de ser hoja. `rollupBudget` agrega **solo hojas**, así que los montos que quedaron colgados de la categoría destino desaparecen de todos los totales — del grupo, del tipo, de los KPIs y del módulo de Balance. El dato sigue en `state.budgets[destId]`, pero ya no lo suma nadie: es invisible y no hay forma de recuperarlo desde la UI. Es exactamente el caso FR-604 que **sí** está resuelto en `createNode` (`src/domain/mutations.ts:137-146`) y en las otras dos ramas de `moveNode` (grupo-origen `:377-390`, grupo-destino `:411-423`); esta rama es la única que lo omite. Rompe el invariante que el diseño declara garantizado "por construcción" (`02_SYSTEM_DESIGN.md`, roll-ups derivados).
- Reproducción confirmada: grupo `g1` con categoría-hoja `cA` (Pres. ene = 100.000) y categoría `cB` con sub `sB1` (Pres. ene = 50.000). Total del grupo antes: **150.000**. Tras `moveNode(s, "sB1", { kind: "category", id: "cA" })` el total del grupo baja a **50.000**; `budgets["cA"] = {ene: 100000}` sigue presente pero ya no se agrega. El mismo escenario vía `createNode` conserva el total (control).
- **Se dispara con los datos semilla, en el escenario exacto de un test que hoy está en verde.** Reproduciendo `TC-105e` (`tests/domain/move-dashboard-seed.test.ts:87`) — crear "Cafetería" bajo `g-esenciales` y arrastrarla sobre `c-vivienda`, que en la semilla es categoría-hoja con montos —: el Presupuestado de `g-esenciales` en enero cae de **2.520.000 a 2.220.000**, y `budgets["c-vivienda"]` queda huérfano con 300.000 en **los doce meses** (3.6 M/año fuera de todos los totales). Cualquier usuario que arrastre algo sobre "Vivienda", "Transporte", "Salario", "Freelance" o "Ahorros" —todas hojas en la semilla— pierde el presupuesto de esa categoría de la vista sin ningún aviso. Ver BL-L: el test que debía cubrir esto no comprueba ningún total.
- Suggested: `aitri bug add --title "moveNode a categoria-hoja con montos pierde el presupuesto del destino en el roll-up (FR-604)" --severity high --description "La rama dest.kind==='category' de moveNode (src/domain/mutations.ts:394-407) no traslada los montos del destino a una hoja cuando el destino era hoja con montos y gana su primer hijo, a diferencia de createNode y de las otras ramas de moveNode. Los montos quedan huerfanos y desaparecen de todos los totales."`

**[BUG-2]** `[severity: medium]` — `createdAt` de los movimientos no es monotónico entre sesiones ni entre usuarios; el orden de `/api/v1/movements` es incorrecto
- File: `src/domain/mutations.ts:87-95` (`_seq` / `nextSeq()`), consumido en `src/server/data/ledgerRepo.ts:92,201,238`
- Problem: `createdAt` se genera con un contador de módulo que arranca en 0 en cada carga de página y en cada arranque del proceso servidor. En modo servidor ese contador además es **global al proceso, compartido por todos los usuarios**. La BD indexa y ordena por él (`movement_owner_created_idx`, `orderBy(desc(movement.createdAt))`), y `GET /api/v1/movements` documenta "más nuevos primero": tras un reinicio o redeploy, los movimientos nuevos reciben `createdAt` 1, 2, 3… — por debajo de los de la sesión anterior — y se devuelven al final de la lista. También produce colisiones de valor entre usuarios distintos. Hoy no hay una vista que liste movimientos (la lista "Recientes" se retiró en BL-003), así que el síntoma no es visible en la UI, pero el contrato de la API ya está publicado y es incorrecto.
- Suggested: `aitri bug add --title "createdAt de los movimientos no es monotonico entre sesiones (orden incorrecto en GET /api/v1/movements)" --severity medium --description "nextSeq() en src/domain/mutations.ts:87-95 reinicia el contador en cada carga de pagina y en cada arranque del servidor, y en servidor es global a todos los usuarios. La BD ordena por createdAt (ledgerRepo.ts:92,201,238), asi que tras un reinicio los movimientos nuevos quedan al final. Usar Date.now() con desempate, o un contador sembrado del maximo existente, manteniendo la inyectabilidad para los tests."`

### Findings → Backlog

**[BL-A]** `[priority: P1]` — 11 test cases de `grid-ux` (6 de ellos NFR de **regresión**) nunca se implementaron
- File: `tests/e2e/grid-ux.spec.ts` / `aitri/features/grid-ux/spec/03_TEST_CASES.json`
- Problem: TC-205e, TC-208e, TC-210e, TC-211e, TC-211f, TC-213e, TC-213f, TC-214h, TC-214f, TC-215e y TC-215f figuran como `skip` en `04_TEST_RESULTS.json` con la nota "Not detected in runner output". Un `grep` de cada id sobre `tests/` devuelve **cero coincidencias**: no es un problema de parseo del runner, los tests no existen. Seis cubren NFR de regresión declarados (NFR-101 Escape cancela edición · NFR-102 reparent por arrastre + la manija de resize no dispara drag · NFR-104 el registro no desborda a 375px · NFR-105 los datos persisten tras usar el resize · NFR-106 contraste ≥4.5:1 y cero petición externa de fuente). NFR-106 es justamente el invariante que BG-001 rompió una vez. La feature figura "5/5 verify ✅" y el agregado del proyecto muestra 12 ⊘ — cifra que se lee como "saltados a propósito" cuando en realidad es "sin escribir". (El 12º, TC-BE-077h, es la verificación manual de TLS en tránsito descrita en la sección Security; debería marcarse `mark-manual` y verificarse, no quedar en `skip`.)
- Suggested: `aitri backlog add --title "Implementar los 11 TC de grid-ux nunca escritos (6 NFR de regresion)" --priority P1 --problem "TC-205e/208e/210e/211e/211f/213e/213f/214h/214f/215e/215f figuran skip en 04_TEST_RESULTS.json pero no existe ningun test que los referencie. Seis son NFR de regresion (NFR-101..106). Escribirlos en tests/e2e/grid-ux.spec.ts nombrandolos por su TC-ID, y marcar TC-BE-077h como manual y verificarlo."`

**[BL-B]** `[priority: P2]` — Los roll-ups se recalculan en O(n²) por celda; el guardrail NFR-103 solo se mide sobre la semilla de 12 nodos
- File: `src/components/BudgetGrid.tsx:435-444` y `:325-334`; `src/domain/rollup.ts`; `tests/domain/rollup-perf.test.ts`
- Problem: cada `NodeRow` invoca `rollupBudget` + `rollupActual` 12 veces (una por mes), y cada llamada recorre el árbol con `leafDescendants`/`subtreeIds`, que a su vez usan `childrenOf` (un `filter` sobre **todos** los nodos por nivel). `TypeTotalRow` llama `typeTotals` 12 veces por tipo, y `typeTotals` filtra todos los nodos llamando `isLeaf`, que es otro escaneo completo — O(n²) por llamada. Además, `NodeRow` y `TypeTotalRow` se suscriben al objeto `data` completo (`useLedgerStore((s) => s.data)`), así que **toda** fila re-renderiza ante cualquier cambio; el diseño (`02_SYSTEM_DESIGN.md`) prometía "selectores memoizados (guardrail ≤150ms, NFR-001)". El test que acredita el guardrail (`tests/domain/rollup-perf.test.ts:49`) corre sobre `buildSeed()` — 12 nodos —, de modo que el umbral de 150 ms está verificado en el único tamaño donde no puede fallar. Un usuario con ~200 hojas no tiene ninguna evidencia detrás.
- **Añadido tras el `verify-complete` del 2026-07-28:** el mismo NFR-001 se acredita además con **TC-101f**, un TC verificado a mano cuya nota dice *"Render granular: selectores de slice Zustand… edición re-renderiza solo consumidores del slice, **no las 12xN celdas**"*. La segunda mitad de esa afirmación no se sostiene contra el código: `NodeRow` y `TypeTotalRow` **son** consumidores de ese slice (`useLedgerStore((s) => s.data)`), y `data` se reemplaza por un objeto nuevo en cada mutación, así que sí re-renderizan todas. Es el caso que el propio `verify-complete` advierte —*"un override respaldado por evidencia débil o circular envía un TC no ejercitado como pass"*—: la evidencia describe una propiedad de diseño que la implementación no tiene. Al atacar este backlog, re-verificar TC-101f contra el comportamiento real en vez de contra la intención.
- Suggested: `aitri backlog add --title "Memoizar los roll-ups de la grilla y medir NFR-103 a escala real" --priority P2 --problem "BudgetGrid.tsx recalcula rollupBudget/rollupActual y typeTotals por celda (12 meses x fila), cada uno O(n^2) por los escaneos de childrenOf/isLeaf, y cada fila se suscribe al objeto data completo. El test de guardrail rollup-perf.test.ts solo mide sobre la semilla de 12 nodos. Precalcular un indice hijos-por-padre y una tabla de roll-ups por mes en un useMemo del contenedor, y añadir un caso del test con ~200 hojas."`

**[BL-C]** `[priority: P2]` — `persist()` dispara PUTs concurrentes con la misma `baseRevision`: en modo servidor una edición en vuelo se puede perder
- File: `src/state/store.ts:57-66` y `src/data/serverRepository.ts:58-81`
- Problem: `persist()` es fire-and-forget (`void repo?.save(...)`) y se invoca en cada mutación. `ServerRepository.revision` solo se actualiza cuando **responde** el PUT, así que dos ediciones rápidas seguidas (teclear en dos celdas de la grilla) salen con la misma `baseRevision`; la segunda recibe 409 y el manejador llama `get().resync()`, que hace `set({ data: loaded })` — reemplaza el estado local, incluida la edición que el usuario acaba de hacer, sin avisarle. El comentario del código lo describe como "converger", pero el efecto observable es que un valor tecleado se revierte en silencio. No hay cola de escrituras ni debounce entre la UI y el repositorio.
- Suggested: `aitri backlog add --title "Serializar las escrituras al servidor (cola/debounce) para no perder ediciones en vuelo" --priority P2 --problem "store.ts:57-66 llama repo.save() sin esperar; ServerRepository solo actualiza this.revision al responder, asi que dos mutaciones seguidas mandan la misma baseRevision, la segunda recibe 409 y resync() sobrescribe el estado local con el del servidor, revirtiendo en silencio lo que el usuario acaba de teclear. Encolar los saves (uno en vuelo a la vez) con coalescencia del ultimo estado, y avisar al usuario cuando un resync descarte cambios."`

**[BL-D]** `[priority: P2]` — La pantalla de login no usa el sistema de diseño: es la primera pantalla del producto en modo servidor
- File: `src/components/auth/AuthForm.tsx:42-110`, `src/components/auth/LoginGate.tsx:52-59`
- Problem: `AuthForm` está maquetado con `style={{...}}` inline y `<input>`/`<button>` sin clase alguna — sin tokens, sin los componentes `ui/` (Button, Card), sin estados de foco. El botón "Salir" del gate es un `<button>` `position:fixed` con `opacity:0.7` y ningún estilo. En modo servidor (`NEXT_PUBLIC_LEDGER_SERVER_MODE=true`) es lo **primero** que ve un usuario, y contradice FR-012 (sistema de diseño César Augusto, tokens exactos) y el trabajo de la feature `ux-consistency`. Ningún TC cubre la fidelidad visual de esta pantalla.
- Suggested: `aitri backlog add --title "Aplicar el sistema de diseño a AuthForm y al boton de logout" --priority P2 --problem "src/components/auth/AuthForm.tsx usa estilos inline crudos y controles sin clase; LoginGate.tsx:52-59 dibuja el boton Salir sin estilo. Es la primera pantalla en modo servidor y no cumple FR-012 ni los patrones de ux-consistency. Rehacerla con Card/Button/Input del sistema y tokens, con foco visible (NFR-002)."`

**[BL-E]** `[priority: P2]` — `src/data/makeRepo.ts` es código muerto en producción, pero acredita un TC
- File: `src/data/makeRepo.ts`
- Problem: el módulo exporta `makeRepo({ authenticated })` y su único consumidor es `tests/integration/backend/repo-sync.test.ts:18`, que es el test que acredita **TC-BE-027h**. La aplicación real nunca lo importa: `src/state/store.ts:46` define su propia función local `makeRepo()` con otra firma (decide por `SERVER_MODE`, no por autenticación). El TC verifica por tanto un camino que el producto no ejecuta, y las dos decisiones de swap pueden divergir sin que ningún test lo note.
- Suggested: `aitri backlog add --title "Unificar el punto de swap del repositorio: data/makeRepo.ts es codigo muerto" --priority P2 --problem "src/data/makeRepo.ts solo lo usa tests/integration/backend/repo-sync.test.ts (TC-BE-027h); la app usa la funcion local makeRepo() de src/state/store.ts:46, con otra firma. O el store consume data/makeRepo.ts (y el TC pasa a verificar el camino real), o se borra el modulo y el TC se reapunta al store."`

**[BL-F]** `[priority: P2]` — El pie de la grilla afirma en texto fijo la tabla de factores de la **semilla**
- File: `src/components/DesktopShell.tsx:147`
- Problem: `GridFooter` imprime "**Ene–May** ejecutado · **Jun** en curso · **Jul–Dic** proyectado". Eso describe literalmente el `FACTOR` de `src/domain/seed.ts:14-17`, no los datos del usuario. En cuanto alguien captura movimientos reales — o simplemente al pasar el tiempo — el pie afirma algo falso sobre la grilla que tiene delante, con el peso tipográfico de una leyenda del producto.
- Suggested: `aitri backlog add --title "El pie de la grilla describe la semilla, no los datos del usuario" --priority P2 --problem "DesktopShell.tsx:147 imprime 'Ene-May ejecutado / Jun en curso / Jul-Dic proyectado', que es la tabla FACTOR de src/domain/seed.ts:14-17. Con datos reales o al avanzar el año la leyenda miente. Derivarla del estado (ultimo mes con ejecutado > 0 y el mes en curso via currentMonthKey()) o retirarla."`

**[BL-G]** `[priority: P2]` — El gate `lint` (required) depende de `next lint`, eliminado en Next 16, y no cubre `tests/e2e/`
- File: `package.json:lint`, `.eslintrc.json`, `aitri/product/spec/04_BUILD_REPORT.json#quality_gates`
- Problem: `npm run lint` ejecuta `next lint`, que ya imprime "`next lint` is deprecated and will be removed in Next.js 16"; el propio `npm outdated` muestra Next 16.2.12 como latest. Cuando se haga el salto, un `quality_gate` marcado `required: true` deja de existir y `verify-run` fallará por motivos que no tienen que ver con el código. Además `.eslintrc.json` es formato legacy (ESLint 9 usa flat config por defecto) e `ignorePatterns` excluye `tests/e2e/**`, que son ~2.500 líneas de las más frágiles del repo.
- Suggested: `aitri backlog add --title "Migrar el lint a la CLI de ESLint con flat config y cubrir tests/e2e" --priority P2 --problem "package.json usa 'next lint', deprecado y eliminado en Next 16 (el gate lint es required en 04_BUILD_REPORT.json). .eslintrc.json es formato legacy y excluye tests/e2e/**. Migrar con 'npx @next/codemod@canary next-lint-to-eslint-cli .', pasar a eslint.config.mjs y quitar la exclusion de e2e."`

**[BL-H]** `[priority: P2]` — Los `quality_gates` no declaran ningún gate de seguridad; el `security-config.sh` que propuso la auditoría anterior no se creó
- File: `aitri/product/spec/04_BUILD_REPORT.json#quality_gates`, `scripts/`
- Problem: los gates declarados son `typecheck`, `lint`, `coverage`, `smoke` y `e2e`. El escaneo de secretos (`scripts/secret-scan.sh`, que **sí** existe) y el SCA (`npm audit --audit-level=high`) solo corren en `.github/workflows/ci.yml`, de modo que `aitri verify-run` — el gate que decide si el proyecto es desplegable — no los ejecuta nunca. El `scripts/security-config.sh` propuesto al cierre de la sección Security (verificar cabeceras, `poweredByHeader`, CSP sin `unsafe-eval`, cookies y rate-limit) no está en `scripts/`: la postura de seguridad no se re-chequea cada ciclo, tal como pedía ese hallazgo. Dos de sus cinco puntos ya se corrigieron en el código (`poweredByHeader: false` en `next.config.mjs:5`, límite de `/sign-up/email` en `auth.ts:83`) sin que nada impida que se reviertan.
- Suggested: `aitri backlog add --title "Declarar los gates de seguridad en 04_BUILD_REPORT.json y crear scripts/security-config.sh" --priority P2 --problem "quality_gates solo declara typecheck/lint/coverage/smoke/e2e: secret-scan.sh y npm audit solo viven en CI, asi que verify-run no los corre. Ademas falta el scripts/security-config.sh propuesto en la seccion Security del AUDIT_REPORT (cabeceras, poweredByHeader, CSP sin unsafe-eval, cookies httpOnly/sameSite, customRule de /sign-up/email). Crearlo y declarar ambos como quality_gates."`

**[BL-I]** `[priority: P3]` — `04_BUILD_REPORT.json` cita archivos que ya no existen
- File: `aitri/product/spec/04_BUILD_REPORT.json` (`files_created`, `test_files`)
- Problem: `files_created` lista `src/components/MovementForm.tsx` y `src/components/RecentList.tsx`, ambos borrados (los reemplazaron `register/` y BL-003). `test_files` sigue enumerando siete archivos de la primera build, cuando la suite real son 33. El artefacto es la referencia que lee cualquiera que llegue nuevo al proyecto y hoy describe un árbol que no existe.
- Suggested: `aitri backlog add --title "Actualizar files_created y test_files de 04_BUILD_REPORT.json" --priority P3 --problem "files_created cita src/components/MovementForm.tsx y RecentList.tsx, ambos borrados; test_files lista 7 archivos cuando la suite real tiene 33. Regenerar ambas listas contra el arbol actual."`

**[BL-J]** `[priority: P3]` — Cada guardado reescribe el ledger completo del usuario
- File: `src/server/data/ledgerRepo.ts:174-177`
- Problem: `saveLedger` borra **todos** los nodos, celdas y movimientos del owner y los reinserta en cada PUT. Para una edición de una sola celda eso son tres DELETE + N INSERT en chunks de 500. Con un año de movimientos el coste por tecla crece linealmente y el `for update` sobre la fila ancla serializa todo. Es una decisión deliberada y correcta (ADR-06: nunca deja estado parcial) que funciona bien en el volumen actual; se registra como deuda a revisar antes de que el volumen la haga notoria.
- Suggested: `aitri backlog add --title "Escritura incremental del ledger en vez de snapshot-replace completo" --priority P3 --problem "saveLedger (src/server/data/ledgerRepo.ts:174-177) borra y reinserta todos los nodos, celdas y movimientos del usuario en cada PUT, incluso al editar una sola celda. Evaluar un diff por celda/nodo dentro de la misma transaccion, conservando el lock optimista por revision."`

**[BL-L]** `[priority: P1]` — `TC-105e` se llama "totales cuadran" y no comprueba ningún total: es el falso verde que dejó pasar BUG-1
- File: `tests/domain/move-dashboard-seed.test.ts:87-95`
- Problem: el test se titula *"TC-105e: tras reparent, cero huérfanos y **totales cuadran**"* y acredita el invariante de NFR-005 raíz (*"totales = suma de hojas"*, `category: "Regression"`) y de NFR-902 de la feature `balance`. Sus únicas aserciones son `noOrphans(...)` y `subtreeIds(...).toContain("c-cafe")` — **ninguna suma nada**. Ejecuta exactamente la operación que dispara BUG-1 (arrastrar sobre `c-vivienda`, categoría-hoja con montos en la semilla), pierde 300.000 mensuales del total del grupo, y pasa en verde. Es el caso de manual de "test que pasa sin verificar el comportamiento": el nombre promete el invariante, las aserciones cubren otra cosa. La misma laguna afecta a los reparents de `demote-node.test.ts:206,258` y `promote-to-group.test.ts:320`, que tampoco comparan totales antes/después.
- Suggested: `aitri backlog add --title "TC-105e afirma 'totales cuadran' sin comprobar ningun total (dejo pasar BUG-1)" --priority P1 --problem "tests/domain/move-dashboard-seed.test.ts:87-95 solo asserta noOrphans y subtreeIds; nunca compara rollupBudget/rollupActual antes y despues del reparent, que es el invariante de NFR-005 y NFR-902. Añadir a ese test (y a los reparents de demote-node.test.ts:206,258 y promote-to-group.test.ts:320) una asercion de conservacion del total del grupo y del tipo en los 12 meses. Considerar un gate de mutacion para esta clase de falso verde."`

**[BL-K]** `[priority: P3]` — Restos de la categoría "Sin asignar", retirada del producto
- File: `src/domain/types.ts:63` (`UNASSIGNED_NAME`), `src/domain/types.ts:22` (campo `system`), `src/data/repository.ts:11-22`
- Problem: la constante `UNASSIGNED_NAME` no tiene un solo consumidor en `src/` ni en `tests/`. El campo `system` del nodo sigue gateando `canRename`/`canDelete`/`useDraggable`, pero ya no hay ningún camino que cree un nodo `system`, así que esas ramas son inalcanzables. `stripLegacyUnassigned` es una migración legítima que debe quedarse (hay datos guardados con esos nodos). Ver GAP-4 en la sección Requirements Coverage: el FR que lo justificaba sigue aprobado y describe un mecanismo retirado.
- Suggested: `aitri backlog add --title "Limpiar los restos de 'Sin asignar' (UNASSIGNED_NAME sin uso, ramas system inalcanzables)" --priority P3 --problem "src/domain/types.ts:63 exporta UNASSIGNED_NAME sin ningun consumidor y ningun camino crea ya nodos system, asi que las ramas gateadas por node.system en mutations.ts y BudgetGrid.tsx son inalcanzables. stripLegacyUnassigned (data/repository.ts) SI debe quedarse: migra datos guardados. Hacerlo junto con la re-derivacion de FR-003 (GAP-4)."`

### Observations

**[OBS-1]** — El hub de sincronización vive en memoria del proceso
- Context: `src/server/sync.ts:68-69` (singleton `globalThis.__ledgerSyncHub`)
- Concern: con más de una instancia del servidor, un write atendido por la instancia A no notifica a los dispositivos conectados a la instancia B. El sync en vivo (FR-511) degrada silenciosamente a "hasta la próxima recarga" (FR-510) para una parte de los usuarios.
- Why deferred: el propio módulo lo documenta como TRF-01 y aísla `publish()` justamente para enchufar Redis pub/sub; el despliegue actual es de instancia única, así que hoy no hay nada que arreglar — solo una condición que verificar antes de escalar horizontalmente.

**[OBS-2]** — El año 2026 está fijo en la UI y `monthKeyFromDate` descarta el año
- Context: `src/components/DesktopShell.tsx:36` (`scopeLabel`), `src/lib/date.ts:66-69`
- Concern: un movimiento fechado en otro año se agrega al mismo `MonthKey` que uno de 2026, y las etiquetas dicen "2026" pase lo que pase. Al cambiar el año calendario la app seguirá rotulando 2026.
- Why deferred: "multi-año" está explícitamente en el `no_go_zone` de v1 y el modelo de datos (`MonthKey` sin año) lo refleja de forma coherente. Convertirlo en acción exige antes una decisión de producto sobre el alcance temporal, no un cambio de código.

**[OBS-3]** — Deriva de versiones mayores en el stack
- Context: `package.json` / `npm outdated`
- Concern: Next 15→16, Zod 3→4, Recharts 2→3, Vitest 3→4, ESLint 9→10, TypeScript 5→7, lucide-react 0.474→1.x, react-day-picker 9→10, jsdom 26→29. Cuanto más se acumulen, más caro y más arriesgado el salto — y varios (Next, Zod) tocan superficies críticas del producto.
- Why deferred: `npm audit` reporta **0 vulnerabilidades** (los 6 moderados de la auditoría anterior están resueltos), ninguna versión actual está sin soporte y no hay funcionalidad bloqueada. Es mantenimiento planificable, no un problema presente.

**[OBS-4]** — La CSP sigue permitiendo `'unsafe-inline'` y `'unsafe-eval'`
- Context: `next.config.mjs:26-29`
- Concern: es RQ-SEC-001 de la sección Security, aún abierto. Ante un XSS futuro, la CSP no frenaría la ejecución de script inline.
- Why deferred: ya está registrado y razonado como P2 en la sección Security de este mismo informe (el comentario del propio archivo explica que Next inyecta scripts inline sin nonce en este setup y que endurecerla rompería la app). Duplicarlo como backlog nuevo no aporta; la acción es la migración a CSP con nonce ya descrita ahí.

**[OBS-5]** — El control de Origin solo actúa cuando la cabecera viene presente
- Context: `src/server/http.ts:93-98`
- Concern: `if (origin && !allowed)` deja pasar cualquier mutación que llegue **sin** cabecera `Origin` (clientes no-navegador, algunas herramientas).
- Why deferred: es defensa en profundidad, no la barrera principal: la cookie de sesión es `sameSite: "lax"`, que impide que un POST/PUT cross-site la lleve, y sin cookie la ruta responde 401 antes de tocar la BD. Exigir `Origin` siempre rompería clientes legítimos sin ganancia real de seguridad.

---

## Requirements Coverage

**Method:** Independent re-derivation of client needs from `00_DISCOVERY.md`, `01_REQUIREMENTS.json#original_brief`, and the seed IDEA, traced backward to the functional requirements, then diffed against the Phase-1 `coverage_map`.

**Verdict (re-auditado 2026-09-07):** 31 needs traced · 29 cubiertos · **1 UNCOVERED sin registrar (GAP-16, nuevo)** · 2 divergencias previas abiertas. El pase de hoy se disparo porque los requisitos de la raiz CAMBIARON: FR-013 se enmendo el 2026-09-07 para que la semilla no traiga montos. Ese cambio dejo sin cubrir la mitad "montos semilla" del criterio de exito 1 del discovery aprobado, sin dejar rastro en `coverage_map` ni en `idea_gaps` — ver GAP-16. Todo lo demas del trazado se reproduce igual que en los pases anteriores: ninguna otra necesidad expresada quedo huerfana, y las tres sustituciones historicas (Sin asignar, Movimientos recientes, tema oscuro unico) siguen correctamente declaradas en el FR que las sustituye.

**Verdict anterior (re-audited 2026-07-07):** 30 needs traced · 28 fully covered · 0 uncovered (dropped) · 2 divergences/questions to resolve. Fresh independent re-derivation on 2026-07-07 reproduced the same trace and confirms the 2026-07-02 findings stand — root Phase-1 FRs unchanged; GAP-2 and GAP-3 remain open pending a user decision. (Note: the in-flight `stack-upgrade-theme` feature will supersede FR-012's design system, but that is a feature-level change not yet folded into root Phase 1.)
No client need was silently *dropped* — every expressed need maps to an FR, an NFR, a constraint, or an explicit `no_go_zone` line. The prior GAP-1 ("Sin asignar" per-GRUPO → per-TIPO divergence) is **RESOLVED**: FR-003 now reads *"la categoría fija 'Sin asignar' del **MISMO GRUPO** … UNA por **GRUPO**"* and NFR-005 *"de 'Sin asignar' de su grupo"*, matching the brief and D-2; the editable-montos point is now consistent with the D-2 constraint (`auto, no renombrable/borrable, montos editables`). Two items still diverge and should be confirmed.

---

### Findings

**[GAP-1]** `RESOLVED (2026-07-02)` — "Sin asignar" scope is now per-GRUPO in FR-003 / NFR-005, consistent with the discovery SC-4, the brief business rule, and D-2. No action.

**[GAP-2]** `SCOPE QUESTION (reverse-check — possible v1 expansion)` — FR-015 drag-and-drop is a v1 MUST, but the brief deferred all drag-drop to Phase 5
- Source: `original_brief` Out of Scope (Post-MVP, Fase 5) — *"**Drag-and-drop para reordenar grupos/categorías (D-7)**"* listed as post-MVP.
- Requirement as written: FR-015 `[MUST]` "Reorganizar categorías/subcategorías por arrastrar-y-soltar (reparent)" — in v1. The `no_go_zone` splits D-7: *reparent* pulled into v1, *reorder-by-position* left in Phase 5.
- Status: not a gap (nothing dropped); a **scope addition**. Its rationale is sound — FR-003 leaves categories parked under "Sin asignar" and needs a mechanism to move them back out, and the brief never specified one. But the brief's own words put drag-drop in Phase 5, so v1 now carries a non-trivial MUST the client had deferred.
- Action: **confirm the v1 scope with the user.** Either accept FR-015 in v1 (and note it supersedes the brief's Phase-5 deferral for reparent), or replace the drag-drop with a lighter "move to…" action for the "Sin asignar" recovery path.

**[GAP-3]** `PARTIAL (deliverable not verifiable)` — README explaining technical decisions
- Source: `original_brief` Hard Constraints — *"El README debe explicar decisiones técnicas, no solo cómo correr el proyecto."*
- Status: captured only as a `constraints[]` entry — no FR/NFR and therefore no acceptance criteria or test case. It is a stated hard deliverable with no mechanical verification, so it can silently ship absent or thin.
- Action: minor — either add it as an acceptance item / Phase-3 manual TC, or accept explicitly that it is a constraint verified by human review at deploy (record the decision).

---

### What was traced (completeness evidence)
- **Discovery success criteria (8/8) COVERED:** SC-1 seed→FR-013/FR-011 · SC-2 captura→FR-001 · SC-2b consistencia captura→presupuesto→FR-001/FR-004 · SC-3 taxonomía CRUD→FR-002 · SC-4 borrado sin pérdida→FR-003 *(GAP-1 resolved — per-grupo)* · SC-5 plan-vs-realidad grilla→FR-006/FR-004 · SC-6 dashboard→FR-009 · SC-7 móvil compacto→FR-010 · SC-8 end-to-end→North Star/FR-010+all.
- **Discovery evidence gaps resolved:** D-3 (Ejecutado editable vs derivado) → FR-006 inline edit + FR-001 movement-derived · D-8 (movimiento a subcategoría) → FR-001 subcategoría opcional.
- **Brief business rules (9/9) COVERED:** BR1→FR-001 · BR2→FR-002 · BR3→FR-003 *(GAP-1 resolved)* · BR4→FR-004 · BR5→FR-006 · BR6→FR-008 · BR7→FR-009 · BR8→FR-010 · BR9→FR-011 · BR10→FR-012.
- **Constraints:** stack/theme/COP/breakpoint/hosting→`constraints[]`+NFR-006 · README→`constraints[]` *(GAP-3)*.
- **Scaffolding:** multiuser + external-API andamiaje→FR-014.
- **Visual assets (mockups):** dashboard→FR-009/FR-012 · budget grid→FR-006/FR-008 — covered via UX-type FRs and the approved UX phase.
- **Out-of-scope (10/10) correctly excluded, not reported as gaps:** distribución proporcional · presupuesto/dashboard móvil · teclado numérico · multiusuario/login · APIs runtime · multi-año/moneda · backend Supabase · reordenar-por-posición + arrastrar grupos · exportación · tweaks como preferencias — each cited in `no_go_zone`.

---

### Re-auditoría 2026-07-28 — el Phase 1 raíz quedó desfasado respecto al producto entregado

**Veredicto:** 30 necesidades del cliente trazadas · **0 dropped** (ninguna necesidad expresada quedó sin cubrir) · **4 divergencias nuevas**, todas del mismo tipo: nueve features posteriores cambiaron el producto y el artefacto Phase 1 raíz **nunca se re-derivó**. No es pérdida de alcance — es que el contrato de requisitos ya no describe lo construido, y por tanto ya no sirve para detectar la pérdida de alcance siguiente. GAP-2 y GAP-3 siguen abiertos sin cambio.

Cambio de requisitos desde la auditoría del 2026-07-07: uno solo (commit `40f736d`, BL-003 — retirar la lista "Recientes" del registro móvil), correctamente re-derivado en FR-001/AC-001 y en el `coverage_map`. Esa reducción de alcance es una decisión registrada del usuario, no un gap.

**[GAP-4]** `DIVERGENCIA (FR MUST que el producto ya no implementa)` — FR-003 describe un mecanismo de borrado que fue retirado
- Source: `01_REQUIREMENTS.json#FR-003` `[MUST]` — *"una Categoría CON movimientos NO se destruye: se CONVIERTE en una subcategoría dentro de la categoría fija 'Sin asignar' del MISMO GRUPO… La categoría 'Sin asignar' es UNA por GRUPO, gestionada por el sistema"*. `coverage_map` mapea **dos** necesidades del cliente a FR-003, y NFR-005 (`category: "Regression"`) lo referencia.
- Estado real: el mecanismo no existe. `src/domain/mutations.ts:176` — *"Borrado (sin 'Sin asignar' — decisión del usuario: se retiró hasta redefinirla)"*; `src/data/repository.ts:11-22` es una **migración** que desmonta los nodos "Sin asignar" guardados por versiones anteriores. El borrado hoy funciona al revés: se **bloquea** hasta que el nodo quede sin hijos y sin montos (BG-001/BG-002/BG-006), y `src/domain/types.ts:63` (`UNASSIGNED_NAME`) quedó como export sin un solo consumidor.
- Por qué no es una pérdida de alcance: la necesidad del cliente detrás de FR-003 es SC-4 del discovery — *borrar sin perder datos* —, y el mecanismo de bloqueo la cumple igual de bien (nada se borra con datos dentro). **La decisión sí está registrada**, pero en la feature: `grid-ux` la declara en su `no_go_zone` (*"Categoría 'Sin asignar' — RETIRADA por decisión del usuario; borrar con datos queda bloqueado (revierte FR-003 root)"*) y la sustituye por su FR-110 (*"Borrado seguro: bloquear si hay datos"*). Lo que falta es plegarla al artefacto raíz: hoy FR-003 sigue aprobado como MUST describiendo el mecanismo derogado, y hay que abrir el Phase 1 de una feature para enterarse.
- Action: re-abrir Phase 1 raíz y **re-escribir FR-003** con la regla vigente (bloqueo hasta vaciar + reparent por FR-015 como vía de recuperación, es decir FR-110 de `grid-ux`), actualizar NFR-005 y las dos entradas del `coverage_map`, y citar la decisión. Borrar el export muerto `UNASSIGNED_NAME` (ver BL-K).

**[GAP-5]** `DIVERGENCIA (el no_go_zone contradice lo entregado)` — backend, multiusuario y login están construidos y en producción
- Source: `01_REQUIREMENTS.json#no_go_zone` — *"Multiusuario real / login funcional / libros compartidos — en v1 solo se deja el ANDAMIAJE de datos (FR-014); auth se implementa en Fase 2"*, *"APIs externas / conexiones HTTP… solo andamiaje en v1"*, *"Backend / base de datos (Supabase, PostgreSQL) — v1 persiste solo en localStorage"*.
- Estado real: la feature `backend` (5/5, 85 ✓) entregó autenticación Better Auth con argon2id (`src/server/auth.ts`), sesiones en Postgres, el contrato `/api/v1` (`src/app/api/v1/**`), aislamiento por `ownerId` y sync SSE — todo activable con `NEXT_PUBLIC_LEDGER_SERVER_MODE=true`. Es exactamente "la Fase 2" del `no_go_zone`, ya construida.
- Action: re-abrir Phase 1 para mover esas tres líneas del `no_go_zone` a FRs raíz (o registrar explícitamente que los FR-5xx de la feature `backend` las superseden). Como está, el artefacto raíz declara fuera de alcance la mitad del producto desplegable.

**[GAP-6]** `DIVERGENCIA (el no_go_zone contradice lo entregado)` — el tema claro existe
- Source: `no_go_zone` — *"Modo claro / theming alternativo — el producto es tema oscuro único por diseño"*; FR-012 `[MUST]` — *"Sistema de diseño César Augusto (tema oscuro mono, tokens exactos)"*.
- Estado real: `src/app/providers.tsx` monta `next-themes` con `defaultTheme="system"` y `enableSystem`; `src/components/ThemeToggle.tsx:25` alterna claro/oscuro; el código de la grilla razona explícitamente sobre el contraste AA **en tema claro** (`BudgetGrid.tsx:463-477`). Lo entregó la feature `stack-upgrade-theme` (5/5, 64 ✓). La auditoría del 2026-07-07 ya lo anticipó como nota al pie ("*supersede FR-012's design system, but that is a feature-level change not yet folded into root Phase 1*"); la feature cerró y el plegado nunca ocurrió.
- Action: re-abrir Phase 1: retirar esa línea del `no_go_zone` y re-escribir FR-012 apuntando al sistema de diseño vigente (dual claro/oscuro), o registrar que FR-2xx de `stack-upgrade-theme` lo supersede.

**[GAP-7]** `MENOR (AC desalineado con el observable real)` — AC-001 dice "toast" y el registro móvil muestra un overlay
- Source: `01_REQUIREMENTS.json#FR-001` AC#1 y `AC-001` — *"se muestra el toast de confirmación"* (redactado en el commit `40f736d`).
- Estado real: el registro móvil confirma con `ConfirmOverlay` (`src/components/register/ConfirmOverlay.tsx`), no con el `Toaster` — el propio mensaje de ese commit lo dice: *"Se descartó usar el Toaster: no se renderiza en el registro móvil"*. Los TCs verifican el overlay; el AC nombra otra cosa.
- Action: menor — corregir la redacción del AC en la próxima re-derivación de Phase 1 (no hay pérdida de alcance ni de verificación).

**Necesidades re-derivadas y su estado (2026-07-28):** las 30 de la traza anterior siguen mapeadas; las cuatro divergencias de arriba afectan a **cómo está escrito** FR-003, FR-012 y el `no_go_zone`, no a si el cliente recibió lo que pidió. Ninguna necesidad expresada quedó sin FR, sin NFR y sin decisión de fuera-de-alcance.

---

### Re-auditoría 2026-08-04 — primera pasada que traza los assets de `idea_context/`

**Veredicto:** **60 necesidades trazadas · 54 cubiertas · 4 parciales · 2 sin cubrir.** _(Rectificado el mismo día: GAP-8 se emitió como «sin cubrir» y el usuario lo corrigió — la decisión existía, aprobada y verificada, en artefactos de feature. Baja a parcial. La lección va en la nota de método de abajo.)_

**Naturaleza de los cinco hallazgos:** cuatro de los cinco son **de registro, no de alcance** — el producto hace lo correcto y la decisión existe, pero vive en artefactos de feature y no llega al `coverage_map`/`no_go_zone` de la raíz, que es lo único que se lee para saber qué se prometió. El único hueco de verificación real es GAP-9. Ninguno bloquea el despliegue.

**Estado de lo anterior:** GAP-4, GAP-5, GAP-6 y GAP-7 quedan **RESUELTOS** por la re-derivación del 2026-08-03 (commit `9bfe751`): FR-003 describe hoy el bloqueo hasta vaciar, el `no_go_zone` registra backend/login/tema claro como entregados, y el AC-001 nombra el `ConfirmOverlay`. RQ-SEC-007 también. GAP-2 (FR-015 como MUST de v1 pese al aplazamiento del brief) quedó **cerrado por los hechos**: la constraint *«D-7 (parcial en v1)»* registra la decisión y tres features la construyeron. GAP-3 (README) queda **cerrado**: `README.md` tiene una sección «Decisiones técnicas (el *por qué*, no solo el *cómo*)» con siete decisiones razonadas — el entregable existe, aunque siga sin TC.

**Por qué esta pasada encuentra cosas que las tres anteriores no.** Las auditorías del 2026-07-02, 07-07 y 07-28 trazaron el discovery y el `original_brief` — 30 necesidades — y las dieron por completas. Pero el propio brief dice, en su primera línea, que *«la definición detallada del producto vive en `aitri/product/idea_context/` … y es **autoritativa**»*. Esta pasada trazó también esa fuente: la Especificación Técnica Completa (§1–§13) y las notas de dominio (`parte2-presupuesto-notas-rescatadas.md`), ambas listadas como Assets del brief. Las 30 necesidades duplican; las 30 nuevas salen de ahí, y los huecos también. La lección de proceso: **un asset designado como autoritativo tiene que entrar en la traza, no solo el resumen que lo cita.**

**Segunda lección, del error de esta misma pasada.** GAP-8 se emitió afirmando que editar/borrar movimientos «no está ni construido ni descartado». La búsqueda que lo sustentaba fue un `grep` de nombres de función sobre `src/` — que efectivamente no encuentra nada, porque la decisión está tomada **en el contrato de la API** (`PATCH/DELETE → 404 unsupported_operation`) y escrita en el diseño de la feature `backend`, no en una función ausente. Un `grep` que no encuentra algo prueba que ese nombre no existe, **no** que la decisión no exista. Cuando la traza cruza la frontera raíz↔feature, la ausencia hay que confirmarla leyendo los artefactos de la feature (contrato, `no_go_zone`, TCs), no infiriéndola del código de la raíz.

**[GAP-8]** `PARTIAL` — D-5 (editar/borrar movimientos) SÍ está decidido, pero la decisión no llega al artefacto raíz
- Source: seed brief, *«Decisiones aún abiertas (para discovery/diseño): … **D-5 (log único de movimientos)**»*, que remite a la spec autoritativa §12: *«**D-5 — Vínculo Movimiento ↔ presupuesto.** Confirmar log único de punta a punta (móvil + escritorio), **incluyendo ediciones y borrados de movimientos**.»*
- **Corrección (2026-08-04):** la primera redacción de este hallazgo afirmó que la segunda mitad de D-5 «no está ni construida ni descartada». **Es falso, y el usuario lo señaló.** La decisión existe, está aprobada y está verificada: `aitri/features/backend/spec/02_SYSTEM_DESIGN.md:183` fija el contrato — *«PATCH/DELETE `/api/v1/movements/{id}` → 404 `unsupported_operation`: en v1 los movimientos son un **journal inmutable** (el producto no tiene editar/borrar movimiento; **no se inventa dominio**)»* —, `src/app/api/v1/movements/[id]/route.ts` lo implementa así, y TC-BE-018f/TC-BE-019f lo verifican. `stack-upgrade-theme` la asume como **trade-off explícito** en su UX (`01_UX_SPEC.md:83`: *«el MVP no ofrece "deshacer" un guardado; se mitiga con el overlay y el reset explícito… Editar/borrar movimientos vive en otra superficie (lista, fuera de esta feature)»*), y el diseño raíz (`02_SYSTEM_DESIGN.md:142`) y FR-003 razonan sobre la inmutabilidad del journal. No es una decisión abierta.
- Status: **PARTIAL — de registro, no de alcance.** Lo que sí falta es que la Fase 1 raíz no la lleva: no hay línea en el `no_go_zone` ni entrada en el `coverage_map` que cierre D-5, de modo que desde el artefacto raíz —el único que se lee para saber qué se prometió— la segunda mitad de D-5 parece sin resolver. D-1, D-2, D-4 y D-7 sí tienen su línea en `constraints[]`; D-3 y D-8 se resolvieron vía FR-006/FR-001; D-6 vía `no_go_zone`. D-5 es la única cuya resolución vive solo en artefactos de feature.
- Nota de producto (informativa, no un gap): el rodeo vigente para un monto mal tecleado es sobrescribir la celda de Ejecutado en la grilla (FR-006), lo que deja el journal y los `actuals` contando historias distintas. Las Reservas sí tienen corrección propia (`transferencias`, FR-1003, FR-1014 y `undoLastReserveOp`), porque su dominio De→A la exige. Si algún día se quiere paridad para gastos e ingresos, es una feature nueva — no un hueco de este pipeline.
- Action: añadir al `no_go_zone` raíz la línea que cierra D-5 («journal inmutable en v1: no hay editar/borrar movimiento — decidido en `backend`, contrato §API y TC-BE-018f/019f»), y su entrada en el `coverage_map`. Sin re-abrir nada más que eso.

**[GAP-9]** `UNCOVERED` — La franja de indicadores «Resumen» no tiene FR, ni entrada en el mapa, ni test
- Source: Especificación Técnica §7.1 — *«**Franja de indicadores (Resumen)** — mínimo 3, gobernados por el filtro Mes/Año: 1. **Total presupuestado** (gastos) … 2. **Ejecutado** con **% del presupuesto** … 3. **Disponible** (presupuesto − ejecutado) — `--success` si ≥0, `--error` si negativo.»* Y §7.2: *«El **filtro Mes/Año** afecta **solo las tarjetas de resumen**; la grilla **siempre** muestra los 12 meses.»*
- Status: **UNCOVERED a nivel de requisito, aunque esté construido.** Los tres KPIs existen en [DesktopShell.tsx:104-106](src/components/DesktopShell.tsx#L104-L106) y la UX los recoge en [01_UX_SPEC.md:89-90](aitri/product/spec/01_UX_SPEC.md#L89-L90). Pero ningún FR los cubre: FR-006 es la grilla y FR-009 son los **7 indicadores del dashboard**, entre los que «Disponible» no figura. No hay entrada en el `coverage_map`, y un `grep` de `disponible|kpi|resumen` sobre `03_TEST_CASES.json` no devuelve **ningún TC**.
- Consecuencia: una superficie que la spec pedía como *mínimo* está fuera de la cadena requisito→AC→TC. Puede regresar en silencio (nada la verifica) y un lector de la Fase 1 no sabría que debe existir. Es exactamente la clase de hueco que el `coverage_map` existe para hacer visible.
- Action: re-abrir Phase 1 para añadirla — como FR propio o plegada a FR-006 con sus AC — y darle TC en Phase 3. Alternativa mínima: registrar en el `coverage_map` que la cubre la fase UX, aceptando explícitamente que no tiene verificación mecánica.

**[GAP-10]** `PARTIAL` — El módulo de Balance (saldo que rueda + doble disponible) no aparece en el artefacto raíz
- Source: notas de dominio (`parte2-presupuesto-notas-rescatadas.md`, asset designado), §B — *«**Saldo acumulado que rueda mes a mes (clave)**. El año se calcula encadenado: si un mes **sobra** dinero, ese sobrante es **saldo disponible del mes siguiente**»*; y *«al menos dos "disponibles": **Disponible total** (patrimonio: caja + ahorro) · **Disponible de caja** (lo gastable ya, sin tocar ahorro)»*.
- Status: **PARTIAL — la necesidad está construida, el registro no.** La feature `balance` la cubre con precisión (FR-905 «seis cifras derivadas por columna», FR-906 «arrastre del saldo entre meses… el cierre EJECUTADO real del mes anterior», FR-907 «el Saldo reservado GLOBAL se acumula mes a mes») y `transferencias` completa el doble disponible (FR-1001, FR-1009). Pero el `coverage_map` raíz **no tiene ninguna entrada** para ella y ningún FR raíz la menciona. FR-011, FR-012 y FR-014 sí registran su traslado a features; ésta no.
- Consecuencia: no es pérdida de alcance — es un agujero de trazabilidad sobre una de las capacidades más sustanciales del producto. Quien lea solo la Fase 1 raíz no sabe que el módulo de Balance existe.
- Action: añadir la entrada al `coverage_map` raíz apuntando a las FR-9xx/FR-10xx de las features, con el mismo formato con que ya se registraron FR-011 y FR-014.

**[GAP-11]** `PARTIAL` — La lista «Recientes» se retiró, pero el discovery aprobado la sigue exigiendo y los requisitos no lo registran
- Source: `00_DISCOVERY.md` SC-2 — *«el movimiento queda reflejado en el total ejecutado de su categoría **y en la lista de recientes** inmediatamente»*; seed brief, Success Criteria — *«se suma al Ejecutado, se recalculan los roll-ups **y aparece en recientes**»*; spec §6 — *«**Movimientos recientes**: ícono de categoría · nombre · meta (tipo · cuándo) · monto con signo»*.
- Status: **PARTIAL.** La retirada fue deliberada y está trazada (BL-003, cerrado; `01_UX_SPEC.md:28` y `TC-001h` la citan). Pero **no está registrada donde el pipeline la busca**: no hay línea en el `no_go_zone` ni entrada en el `coverage_map`, y `00_DISCOVERY.md` — artefacto **aprobado** — sigue afirmándola como criterio de éxito. Peor: FR-212 de `stack-upgrade-theme`, aprobado y vigente, describe el guardado como *«se recalculan los roll-ups **y aparece en recientes** — parent FR-001»*, o sea un FR vivo que referencia una superficie que ya no existe. También quedó el eco en BUG-2 de este mismo informe.
- Action: añadir una línea al `no_go_zone` citando BL-003 (barato y cierra el hueco), y corregir la redacción de FR-212 en la próxima re-derivación de esa feature. La divergencia con el discovery se acepta o se anota: el discovery es histórico, pero hoy contradice al producto sin dejar rastro de por qué.

**[GAP-12]** `PARTIAL` — «Borrado sin pérdida de historial»: hoy el historial sí se borra con el nodo
- Source: `00_DISCOVERY.md` SC-4 — *«Borrado sin pérdida de historial: al borrar una categoría que tiene movimientos, esos movimientos **se conservan**… cero movimientos huérfanos»*; brief BR3 — *«**preservar** los movimientos al borrar una categoría»*.
- Status: **PARTIAL.** Lo registrado en el `no_go_zone` es la retirada del *mecanismo* («Sin asignar»), y esa parte está bien cerrada. Lo que no se registró es la **consecuencia sobre la necesidad**: FR-003 dice hoy que un nodo sin hijos y sin datos *«se borra directo, junto con sus entradas en budgets/actuals **y sus movimientos históricos**»* (BG-006). El invariante «cero huérfanos» se conserva íntegro; el «se conservan» del discovery, no.
- Severidad real: baja, y menor de lo que parecía en la primera redacción: el razonamiento **sí** está escrito — `02_SYSTEM_DESIGN.md:142` y la `resolution` de BG-006 explican por qué la señal es el monto vigente y no el journal (si fuera el journal, un nodo con historia sería imborrable para siempre). El guardrail de bloqueo hace además que llegar ahí exija vaciar el nodo a mano. Lo que falta es la reconciliación con SC-4 en el `no_go_zone`: hoy el criterio de éxito aprobado dice «se conservan» y ninguna línea autoriza lo contrario.
- Action: registrarlo explícitamente (una línea que acepte que el journal de un nodo vaciado se elimina con él, y por qué), **o** conservar el journal al borrar el nodo. Se resuelve junto con GAP-8: si el movimiento pasa a ser editable/borrable por sí mismo, esta regla se re-piensa entera.

**Trazado y NO reportado como gap (evidencia de completitud).**
- **Discovery (9/9):** SC-1 semilla→FR-013 · SC-2 captura→FR-001 *(parcial, GAP-11)* · SC-2b consistencia→FR-001/FR-004 · SC-3 taxonomía→FR-002 · SC-4 borrado→FR-003 *(parcial, GAP-12)* · SC-5 grilla→FR-006/FR-004 · SC-6 dashboard→FR-009 · SC-7 móvil→FR-010 · SC-8 end-to-end→North Star.
- **Reglas de negocio del brief (10/10):** BR1→FR-001 · BR2→FR-002 · BR3→FR-003 · BR4→FR-004 · BR5→FR-006 · BR6→FR-008 · BR7→FR-009 · BR8→FR-010 · BR9→FR-011 · BR10→FR-012.
- **Spec autoritativa:** §3 modelo→FR-002/FR-004 · §4.1 roll-up (hojas vs subárbol)→FR-004 · §4.3 CRUD + traslado de montos→FR-002 · §4.4 varianza→FR-008 · §4.5 registro→FR-001 · §5 módulo de categorías→FR-002/FR-006 · §6 módulo de registro→FR-001 · §7.1 grilla→FR-006 *(la franja de KPIs es GAP-9)* · §7.2 edición inline + Ejecutado editable (D-3)→FR-006 · §8 dashboard 7 indicadores + tendencia→FR-009 · §9 responsive 760px→FR-010/NFR-002 · §10 inventario de íconos→FR-012/FR-309 · §11 tweaks→`no_go_zone` · §12 D-1/D-2/D-4/D-7→`constraints[]`, D-3→FR-006, D-6→`no_go_zone`, D-8→FR-001 *(D-5 es GAP-8)*.
- **Notas de dominio:** CRUD jerárquico→FR-002 · seed editable→FR-013 · sin huérfanos→NFR-005 · `Ingresos − Gastos = saldo` y subtotal por grupo→FR-004/FR-905 · transferencia no es ingreso ni gasto neto→FR-008 + `transferencias` · origen manual vs automático de la celda→FR-006/FR-001 · saldo rodante y doble disponible→*(GAP-10)* · selector multi-año→`no_go_zone`.
- **Constraints:** stack · COP/español · breakpoint · hosting Docker/Nginx/Pi5→`constraints[]`+NFR-006 · README con decisiones técnicas→`constraints[]`, **entregado** (§«Decisiones técnicas» con 7 entradas).
- **Fuera de alcance (12/12) correctamente excluido:** distribución proporcional · presupuesto/dashboard en móvil · teclado numérico · libros compartidos · APIs de terceros · multi-año/multi-moneda · importar desde localStorage · reordenar por posición y arrastrar grupos · exportación · tweaks como preferencias · temas alternativos · app nativa. Cada uno con su línea en `no_go_zone`.
- **Detalles menores trazados, no elevados a gap:** la insignia *«N movs»* de la spec §5 no está implementada — la propia spec la marca **«opcional»**, y con la regla de borrado vigente (bloqueo por monto vigente, no por movimientos) perdió su función. El *«posible menú lateral para futuros módulos»* de las notas de dominio es explícitamente especulativo. El ordinal de dos dígitos («01 — Esenciales») de §5 es un detalle visual que la fase UX absorbió.
- **Reverse-check (FRs sin necesidad del cliente detrás):** ninguno. FR-015 (arrastre) nace de la necesidad de vaciar un nodo que creó la nueva regla de borrado, y su adopción en v1 está registrada en `constraints[]`.

---


### Re-auditoría 2026-08-27 — el pipeline de recuperación de acceso no llegó al registro raíz

**Veredicto:** **57 necesidades trazadas · 54 cubiertas · 3 parciales/sin cubrir · 0 dropped.** Ninguna necesidad expresada por el cliente quedó sin FR, sin NFR o sin línea explícita de fuera-de-alcance. Los tres hallazgos son posteriores a la pasada del 2026-08-05 y nacen todos de la misma tanda: la feature `recuperar-acceso` (12 FR MUST, 87 TCs) y su cambio de método por terminal.

**Estado de lo anterior — todo cerrado.** GAP-8 (D-5, journal inmutable) → `no_go_zone` #14. GAP-9 (franja «Resumen») → **FR-016 creado** con seis AC y tres TCs (TC-016h/e/f), la cadena requisito→AC→TC completa. GAP-10 (saldo rodante y doble disponible) → entrada propia en el `coverage_map` apuntando a las FR-9xx/FR-10xx. GAP-11 (lista «Recientes») → `no_go_zone` #15. GAP-12 (journal del nodo borrado) → `no_go_zone` #16. GAP-2 y GAP-3 siguen cerrados. Cambio de requisitos desde entonces: uno solo, el commit `1db61e9` que creó FR-016 — correctamente derivado y verificado.

**Ruta decidida (2026-08-27, decision del usuario):** GAP-13 y GAP-14 quedan **DIFERIDOS a ultima prioridad** — se registran en **BL-033** y no se abre ningun pipeline por ahora. Motivo: ambos dependen del mismo bloqueo que ya dejo a BL-031 y BL-032 en ultima prioridad (sin dominio propio no hay envio de correo fiable), y ninguno pierde alcance ni bloquea el despliegue: el producto hace lo correcto, lo que falta es que el artefacto lo diga. GAP-15 **RESUELTO el mismo dia por decision del usuario**: se re-abrio la Fase 1 raiz solo para el, se corrigio la redaccion de FR-013 (descripcion y dos AC: «para una cuenta autenticada sin libro persistido (load → 204)» en vez de «en un navegador sin datos previos»), y se re-derivo y re-aprobo la cascada completa —ux, 2, 3, 4, 5— con `verify-run` limpio (59/59 en la raiz, 756/757 en todos los pipelines) y `aitri validate` en verde. Ningun artefacto aguas abajo necesito cambio: el diseño (§Data Model, FR-013) y los TCs (TC-013h/e/f) ya estaban redactados por cuenta, no por navegador — el AC era lo unico desalineado.

**[GAP-13]** `PARTIAL (registro, no alcance)` — La recuperación de acceso no existe en el artefacto raíz
- Source: no hay necesidad del cliente en el discovery ni en el brief — el login mismo era ANDAMIAJE (`original_brief` Out of Scope: *"Multiusuario real / login funcional — solo se deja el ANDAMIAJE de datos"*). La feature nace de una decisión posterior del usuario (2026-08-13).
- Estado real: `recuperar-acceso` entregó 12 FR MUST (FR-1301..FR-1312), 10 NFRs y 87 TCs verdes — pantalla de solicitud, acuse neutro, secreto de un solo uso con expiración, invalidación de sesiones al cambiar la contraseña, endurecimiento del endpoint público (BG-015). Nada de eso aparece en la raíz: ni FR, ni línea del `no_go_zone`, ni entrada del `coverage_map`. FR-014 y NFR-004 enumeran los FR-5xx de `backend` y FR-1101..1103 de `servidor-fuente-unica`, pero se detienen ahí.
- Por qué importa: es la misma clase de hueco que GAP-5/GAP-6/GAP-10 (ya resueltos por este método). Quien lea solo la Fase 1 raíz no sabe que el producto tiene un camino de recuperación de cuenta, ni que ese camino añadió el único endpoint público sin autenticar del sistema.
- Action: añadir la entrada al `coverage_map` raíz (con el formato de FR-011/FR-014) y ampliar NFR-004 con la superficie pública y su acotamiento, en la próxima re-derivación de la Fase 1 raíz.

**[GAP-14]** `UNCOVERED (verificación)` — El único camino de recuperación operativo hoy no tiene requisito ni caso de prueba en ningún pipeline
- Source: FR-1305 `[MUST]` de `recuperar-acceso` — *"Entrega del secreto por correo vía SMTP, enviado desde el servidor"* — y FR-1311, *"Configuración SMTP por variables de entorno, validada al arrancar"*.
- Estado real: el flujo por correo está **dormido a conciencia**. Sin variables SMTP el endpoint responde 503 y la pantalla lo avisa; la decisión (el usuario no tiene dominio propio y descartó la contraseña de aplicación de su Gmail) se tomó el 2026-08-27 y sustituyó el correo por un reset por terminal: `npm run user:reset-password -- <email>` ([scripts/reset-password.mjs](scripts/reset-password.mjs), `package.json:29`), documentado en [DEPLOYMENT.md:104](DEPLOYMENT.md#L104). Ese script fija la contraseña e invalida todas las sesiones — la misma garantía que FR-1309 — y se probó a mano de punta a punta, pero **no existe en ningún artefacto**: ni FR, ni AC, ni TC, ni entrada de `no_go_zone`. El único rastro en el pipeline es su ruta dentro de los ficheros tocados por BG-015.
- Consecuencia: doble. (a) Doce FR MUST aprobados describen un camino que la configuración desplegada no ofrece, sin que ningún artefacto registre la latencia — un lector concluye que el correo funciona. (b) El mecanismo de último recurso para no quedarse fuera del producto no está en la cadena requisito→AC→TC: si se rompe en silencio, se descubre el día que no se puede entrar. Es el patrón exacto de GAP-9 — superficie construida y verificada a mano, fuera de la verificación mecánica.
- Action: re-abrir la Fase 1 de `recuperar-acceso` para (1) registrar el reset por terminal como FR propio con su TC —automatizable contra la base de pruebas, o manual vía `aitri feature tc recuperar-acceso mark-manual`— y (2) añadir al `no_go_zone` de la feature la línea que declara el flujo por correo DORMIDO hasta que haya dominio y SMTP, citando la decisión del 2026-08-27.

**[GAP-15]** `RESUELTO (2026-08-27)` · `MENOR (AC desalineado con el observable real)` — El AC de FR-013 sigue redactado en la era localStorage
- Source: `01_REQUIREMENTS.json#FR-013` AC#1 — *"En un **navegador** sin datos previos, al abrir la app se muestra la jerarquía semilla"*.
- Estado real: con el gate de sesión (FR-504 de `backend`, FR-1102) abrir la app en un navegador limpio muestra la pantalla de acceso; la semilla se genera **por cuenta**, cuando el `load` del servidor devuelve 204 y el cliente siembra ([src/state/store.ts:331-332](src/state/store.ts#L331-L332), FR-513). Los TCs sí están bien redactados (*"ningún libro persistido para el usuario"*), así que no hay hueco de verificación — solo el AC dice algo que ya no se observa.
- Action: menor — corregir la redacción ("sin libro persistido para la cuenta") en la próxima re-derivación de la Fase 1 raíz. Misma clase que el ya resuelto GAP-7.

**Trazado y NO reportado como gap (evidencia de completitud, 2026-08-27).**
- **Discovery (12/12):** SC-1 semilla sin configuración→FR-013 *(matiz de redacción, GAP-15)* · SC-2 captura→FR-001 *(recientes retiradas, `no_go_zone` #15)* · SC-2b consistencia→FR-001/FR-004 · SC-3 taxonomía→FR-002 · SC-4 borrado→FR-003 *(`no_go_zone` #13 y #16)* · SC-5 grilla + ≤150 ms→FR-006/FR-004/NFR-001 · SC-6 dashboard→FR-009 · SC-7 móvil compacto→FR-010 *(`no_go_zone` #2)* · SC-8 end-to-end→North Star/NFR-005 · los dos momentos de uso del usuario→FR-001 y FR-006/FR-009 · baseline prototipo como referencia de cálculo→FR-004/FR-008 · D-3→FR-006, D-8→FR-001, breakpoint→FR-010/NFR-002.
- **Reglas de negocio del brief (10/10):** BR1→FR-001 · BR2→FR-002 · BR3→FR-003 · BR4→FR-004 · BR5→FR-006 · BR6→FR-008 · BR7→FR-009 · BR8→FR-010 · BR9→FR-011 · BR10→FR-012.
- **Spec autoritativa (15):** §3 modelo→FR-002/FR-004 · §4.1 roll-up hojas vs subárbol→FR-004 · §4.3 CRUD y traslado de montos a la primera subcategoría→FR-002 (AC#2 lo verifica) · §4.4 varianza→FR-008 · §4.5 registro→FR-001 · §5 acordeón, íconos y acciones→FR-002/FR-006 · §6 registro→FR-001 *(teclado numérico `no_go_zone` #3)* · §7.1 grilla→FR-006 y franja Resumen→**FR-016** · §7.2 edición inline y filtro que gobierna solo la franja→FR-006/FR-016 · §8 siete indicadores + tendencia deseable→FR-009 · §9 responsive 760px→FR-010/NFR-002 · §10 íconos→FR-012 · §11 tweaks→`no_go_zone` #10 · §12 D-1/D-2/D-4/D-7→`constraints[]`, D-5→`no_go_zone` #14, D-6→`no_go_zone` #6 · §13 plan por fases: estructura, no necesidad.
- **Notas de dominio (7):** CRUD jerárquico→FR-002 · seed editable y sin huérfanos→FR-013/NFR-005 · `Ingresos − Gastos` y subtotal por grupo→FR-004 · transferencia neutra y doble disponible→FR-008 + `transferencias` · saldo que rueda mes a mes→`coverage_map`→FR-9xx/FR-10xx · origen manual vs automático de la celda (override)→FR-006/FR-001 · multi-año→`no_go_zone` #6.
- **Stack/portafolio (7):** autenticación básica→FR-014 + FR-501..FR-504 · andamiaje multiusuario→FR-014 y `no_go_zone` #4 · andamiaje de APIs externas→`no_go_zone` #5 · escritorio completo / móvil compacto→FR-010 · dark mode por defecto→FR-012 y `constraints` #3 (sustituido a conciencia por claro/oscuro/sistema) · datos coherentes→North Star · README con decisiones técnicas→`constraints` #8, entregado.
- **Fuera de alcance (16/16) correctamente excluido:** las dieciséis líneas del `no_go_zone`, cada una con su razón y su decisión citada. Ninguna se reporta como gap.
- **Detalles menores, no elevados a gap:** la insignia *"N movs"* de §5 sigue sin implementar — la spec la marca **opcional** y la regla de borrado vigente (por monto vigente, no por movimientos) le quitó la función. El *"posible menú lateral"* de las notas de dominio es explícitamente especulativo.
- **Reverse-check (FRs sin necesidad del cliente detrás):** ninguno. FR-016 traza a §7.1 de la spec; FR-015 a D-7 con su decisión en `constraints` #12, y las features `promote-to-group` y `demote-node` caen dentro de sus dos AC de reubicación (soltar sobre categoría / soltar en grupo), no son alcance nuevo.

---

## Security

_Adversarial review tras cerrar la feature `backend` (modo servidor multiusuario: auth, API `/api/v1`, Postgres, SSE). Fecha: 2026-07-16._

**Surfaces audited:** static (código/repo/deps): **covered** — `src/server/**`, rutas `src/app/api/**`, `next.config.mjs`, `docker-compose.yml`, `Dockerfile`, `.env.example`, `npm audit`, escaneo de secretos y de git-tracked env. · runtime (local): **covered** — app booteada en modo servidor (`NEXT_PUBLIC_LEDGER_SERVER_MODE=true`) contra Postgres 16 efímero; probados headers, `/health`, gating 401, rutas de error, endpoints de debug/docs, y el bundle cliente servido. Sin instancia desplegada pública (TLS terminado en proxy) → la verificación de TLS en tránsito queda como manual (ver TC-BE-077h).

**Postura general: sólida.** Auth exigida en las 4 rutas de datos, aislamiento por `ownerId` estructural, contraseñas argon2id, queries parametrizadas (Drizzle), cookies HttpOnly/Secure/SameSite, headers de seguridad presentes, sin endpoints de debug (todo 404), sin stack traces en errores, sin `@aitri-trace`/IDs internos en el bundle cliente, y **sin fuga del valor de ningún secreto al cliente** (el bundle solo contiene el guard de Next que *lanza* al tocar una env server-only). Los hallazgos son de **endurecimiento (todos P2)**, no huecos explotables.

**[RQ-SEC-001]** `P2` — CSP permite `'unsafe-inline'` y `'unsafe-eval'`
- Severity: Low — Un atacante que logre inyectar HTML (p. ej. vía un XSS futuro en algún punto no escapado) podría ejecutar scripts inline; la CSP actual no lo frenaría. Mitigado en profundidad por el escape por defecto de React y la cookie de sesión HttpOnly (un XSS no exfiltra la sesión), por eso Low.
- Evidence: header servido `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; ...` (probado con `curl -D -` sobre `/`).
- Acceptance criteria: la CSP servida NO contiene `'unsafe-inline'` ni `'unsafe-eval'` en `script-src` (usa nonce o hash). `curl -sD - / | grep -i content-security-policy` no muestra `unsafe-eval`.
- Suggested implementation: CSP basada en nonce vía `middleware.ts` de Next (genera un nonce por request, lo inyecta en `script-src 'nonce-...'`), o migrar los estilos inline a clases para quitar `unsafe-inline` de `style-src`. Requiere probar que la app no rompe (Next inyecta scripts inline con nonce).

**[RQ-SEC-002]** `P2` — Header `X-Powered-By: Next.js` expone el framework
- Severity: Low — Fingerprinting: un atacante identifica el framework/versión y ajusta ataques a CVEs conocidos de Next. No es una vulnerabilidad por sí misma, reduce el costo del reconocimiento.
- Evidence: `curl -sD - / -o /dev/null | grep -i x-powered-by` → `X-Powered-By: Next.js`.
- Acceptance criteria: la respuesta NO incluye el header `X-Powered-By`.
- Suggested implementation: `poweredByHeader: false` en `next.config.mjs` (una línea).

**[RQ-SEC-003]** `P2` — Rate-limit de login basado en `X-Forwarded-For` (spoofable sin proxy que lo sanee)
- Severity: Medium (dependiente del despliegue) — El limitador de `/sign-in/email` (5/60s) se llavea por IP tomada de `x-forwarded-for` (`advanced.ipAddress.ipAddressHeaders`). Si el reverse proxy no **sobrescribe** ese header (o no hay proxy), un atacante rota `X-Forwarded-For` en cada request → un bucket distinto por intento → **elude el límite de fuerza bruta**. (Verificado indirectamente: el harness e2e desactiva el rate-limit precisamente porque el header controla el bucket.)
- Evidence: `src/server/auth.ts` → `advanced.ipAddress.ipAddressHeaders: ["x-forwarded-for"]` + `rateLimit.customRules["/sign-in/email"] = { window:60, max:5 }`.
- Acceptance criteria: en el despliegue, el reverse proxy fija (no append) `X-Forwarded-For` al IP real del cliente; documentado en DEPLOYMENT.md como requisito. Opcional: un test que envíe 6 logins fallidos rotando XFF y aún reciba 429 cuando el proxy está presente.
- Suggested implementation: documentar en DEPLOYMENT.md que el proxy (nginx) debe usar `proxy_set_header X-Forwarded-For $remote_addr;` (reemplazar, no `$proxy_add_x_forwarded_for`). Considerar un `trustedProxy`/hop-count si Better Auth lo soporta.

**[RQ-SEC-004]** `P2` — El registro (`/sign-up/email`) no tiene rate-limit específico
- Severity: Low — Solo aplica el límite global (100/60s por IP). Permite creación masiva de cuentas / sondeo de emails a mayor volumen que el login. No expone datos; es abuso de recursos.
- Evidence: `src/server/auth.ts` → `customRules` solo declara `/sign-in/email`; `/sign-up/email` cae al global `max: 100`.
- Acceptance criteria: `customRules["/sign-up/email"]` declara un límite acotado (p. ej. 10/60s); un test de 11 registros desde una IP recibe 429.
- Suggested implementation: añadir `"/sign-up/email": { window: 60, max: 10 }` a `rateLimit.customRules`.

**[RQ-SEC-005]** `P2` — 6 vulnerabilidades moderadas en dependencias (dev/build), 0 altas/críticas
- Severity: Low — `drizzle-kit` (→ `@esbuild-kit/esm-loader`) y `postcss` (vía `next`, XSS en el stringify de CSS) son de **build/dev**, no llegan al runtime servido. `npm audit --audit-level=high` sale 0 (el gate de CI no bloquea). Riesgo real bajo.
- Evidence: `npm audit` → "6 moderate severity vulnerabilities"; `npm audit --audit-level=high` → exit 0.
- Acceptance criteria: `npm audit --audit-level=high` mantiene exit 0; revisar y actualizar cuando haya fixes no-breaking para las moderadas.
- Suggested implementation: seguimiento periódico; el gate SCA de CI ya cubre alto/crítico (NFR-513).

**Proposed quality_gate** — `scripts/security-config.sh` (exit-code): verifica estáticamente que `next.config.mjs` declara los headers requeridos (`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, CSP con `frame-ancestors 'none'`) **y** `poweredByHeader: false`; que la CSP de `script-src` no contiene `unsafe-eval` (RQ-SEC-001); que `src/server/auth.ts` mantiene `httpOnly` + `sameSite` en las cookies y un `customRule` para `/sign-up/email` (RQ-SEC-004). Declararlo en `04_BUILD_REPORT.json#quality_gates` para que `verify` re-chequee la postura cada ciclo. El gate `security` existente (`scripts/secret-scan.sh`) ya cubre secretos en el árbol.

**Verdict:** 5 hallazgos — **P0: 0 · P1: 0 · P2: 5**. Riesgo general **bajo**: la superficie está bien endurecida; los hallazgos son mejoras de defensa-en-profundidad (CSP más estricta, fingerprinting, rate-limit del registro, y una dependencia operativa del proxy para el anti-fuerza-bruta). Ninguno bloquea el despliegue; RQ-SEC-003 es el más importante por su dependencia del proxy.

---

### Security — pasada delta (2026-08-01)

_Segunda revisión adversarial, disparada porque los requisitos cambiaron desde la anterior (features `transferencias`, `balance` y `servidor-fuente-unica`: retirada del interruptor de rollout, Postgres como fuente única, pantalla de acceso como única entrada). No re-audita lo ya cubierto el 2026-07-16 salvo para confirmar el estado de RQ-SEC-001…005._

**Surfaces audited:** static: **covered** — `src/server/**`, las 4 rutas `src/app/api/**` + `/health`, `next.config.mjs`, `docker-compose.dev.yml`, `.gitignore`, `git ls-files`, `scripts/secret-scan.sh`, `npm audit` (con y sin dev), y un **build de producción limpio** en un `distDir` aislado para inspeccionar exactamente lo que se sirve al cliente. · runtime: **covered** — app de producción arrancada en `:3199` contra el Postgres local; probados headers servidos, gating de las 4 rutas de datos sin sesión, cuerpo de los errores, `/health`, ruta inexistente, y los contenedores de `docker-compose.dev.yml` que estaban en marcha. · **No cubierto:** TLS en tránsito (se termina en el proxy; sin instancia pública desplegada) — sigue siendo verificación manual, como en la pasada anterior.

**Lo que se confirmó sano (evidenciado, no asumido):**
- Las 4 rutas de datos devuelven `401` sin sesión — `/api/v1/ledger`, `/api/v1/movements`, `/api/v1/movements/{id}`, `/api/v1/sync/stream`. El cuerpo es `{"error":{"code":"unauthorized"}}`: sin stack trace, sin versión, sin reflejar la entrada.
- **Cero fuga al bundle cliente.** Sobre un build de producción limpio: 0 source maps, 0 `@aitri-trace`, 0 IDs de requisito (FR/AC/TC), y del secreto solo aparece el **nombre** dentro de un getter de la librería better-auth — el valor no. (Los hits de `@aitri-trace` que sí aparecen en `.next/static/webpack/*.hot-update.js` son artefactos de HMR de desarrollo, no se sirven en producción: falso positivo descartado.)
- Headers servidos verificados con `curl` sobre la app real: HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP con `frame-ancestors 'none'`, y **sin** `X-Powered-By`.
- Aislamiento del SSE: `syncHub` enruta por `userId` tomado de la sesión validada, y el evento transporta solo `{revision}` — ningún dato financiero viaja por el stream; el cliente re-consulta por la ruta autorizada.
- RQ-SEC-002 **remediado** (`poweredByHeader:false`). RQ-SEC-004 **remediado** (`/sign-up/email` con 10/60s). RQ-SEC-005 **resuelto**: `npm audit` completo reporta **0 vulnerabilidades** (eran 6 moderadas). RQ-SEC-001 y RQ-SEC-003 siguen **abiertos** por decisión (ver backlog de la feature `backend`).

**[RQ-SEC-006]** `P1` — El compose de desarrollo publica la BD financiera y un visor **sin login** en todas las interfaces
- Severity: **Medium-High (verificado, y activo en el momento de la auditoría)** — Cualquiera en la misma red (wifi de oficina, café, red de invitados) alcanza `http://<ip-del-portátil>:8081` y obtiene un navegador completo de la base de datos: leer, consultar y exportar toda la información financiera, **sin credenciales**. El puerto `5432` queda igualmente expuesto con credenciales fijas y conocidas (`ledger/ledger`), lo que además permite escritura. No hace falta ninguna vulnerabilidad de la app: la puerta está abierta por configuración.
- Evidence: `docker ps` → `ledger-dev-pgweb 0.0.0.0:8081->8081/tcp` y `ledger-dev-db 0.0.0.0:5432->5432/tcp`, ambos en marcha. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/` → **200**; `curl .../api/connection` → **200**, sin cabecera `WWW-Authenticate` ni redirección a login. Origen: `docker-compose.dev.yml` declaraba `- "5432:5432"` y `- "8081:8081"` (sin dirección → Docker publica en `0.0.0.0`). El propio comentario del fichero ya advertía «sin login»; lo que faltaba era atarlo a loopback.
- Acceptance criteria: `docker ps` muestra los dos servicios atados a `127.0.0.1`; `curl` a `http://<ip-de-LAN>:8081` no conecta, mientras `http://127.0.0.1:8081` sigue funcionando para el desarrollador.
- Suggested implementation: prefijar la dirección de loopback en los mapeos — `"127.0.0.1:5432:5432"` y `"127.0.0.1:8081:8081"`. **Aplicado en esta pasada.** El servicio `app` (`3100:3000`) se deja deliberadamente abierto: es lo que permite probar desde el móvil en la misma red. Ojo con esa decisión — ese contenedor usa el `BETTER_AUTH_SECRET` de desarrollo que está **en el repositorio**, así que quien alcance `:3100` puede forjar una sesión válida contra esa instancia. Es dato de desarrollo, no de producción, pero conviene no levantarlo en redes que no controles.

**[RQ-SEC-007]** `P2` — La NFR de seguridad declarada describe un sistema que ya no existe
- Severity: Low (proceso, no explotable) — `NFR-004` sigue diciendo *«App web single-user offline sin backend, sin auth, sin secretos y sin PII enviada por red en v1: no hay superficie de red que proteger»*. Desde la feature `backend` hay superficie de red, autenticación, secretos y PII. El riesgo no es un agujero, es de **gobierno**: la promesa de seguridad del proyecto raíz ya no describe lo que se despliega, y un revisor que solo lea los requisitos concluirá que no hay nada que proteger. Las NFRs reales viven en las features (`NFR-512`, `NFR-1106`), que es donde el pipeline las verifica.
- Evidence: `01_REQUIREMENTS.json#NFR-004` (raíz) contra `src/server/auth.ts`, `src/app/api/v1/**` y `docker-compose.yml`.
- Acceptance criteria: `NFR-004` refleja la arquitectura vigente (servidor, sesión, secretos gestionados por entorno) o remite explícitamente a las NFRs de seguridad de las features que la reemplazan.
- Suggested implementation: corregir la redacción en la próxima re-derivación de la Fase 1 de la raíz. No justifica re-abrir la fase por sí solo; agrúpese con la corrección de redacción del AC de FR-001 que ya registra este informe.

**[RQ-SEC-008]** `P2` — El control de Origin en mutaciones solo actúa si el header viene
- Severity: Low — En `withApi`, la allowlist se evalúa como `if (origin && !allowed)`: una petición **sin** cabecera `Origin` salta la comprobación entera. La defensa CSRF efectiva hoy es la cookie `SameSite=lax` más el preflight que exige `content-type: application/json`, no esta allowlist; por eso es Low y no Medium. Pero la protección está escrita como si fuera incondicional, y quien la lea asumirá que lo es.
- Evidence: `src/server/http.ts` → `if (opts.mutation) { const origin = req.headers.get("origin"); if (origin && !e.allowedOrigins.includes(origin)) ... }`.
- Acceptance criteria: una mutación sin `Origin` ni `Referer` se rechaza con 403, o el comentario del módulo declara explícitamente que la defensa CSRF recae en `SameSite` y que la allowlist es solo defensa en profundidad.
- Suggested implementation: exigir `Origin` (o caer a `Referer`) en mutaciones y rechazar si ninguno está presente — comprobando antes que no rompe clientes no-navegador legítimos, si los hubiera.

**[RQ-SEC-009]** `P2` — El stream SSE no acota conexiones por usuario
- Severity: Low — `syncHub.subscribe` no limita cuántas conexiones abre un mismo `userId`, y cada una arrastra su propio `setInterval` de heartbeat. Un usuario **autenticado** puede abrir miles y agotar memoria y timers del proceso. Requiere sesión válida, así que el atacante es un usuario registrado, no un anónimo: por eso Low.
- Evidence: `src/server/sync.ts` → `subscribe()` hace `set.add(conn)` sin cota; `src/app/api/v1/sync/stream/route.ts` abre un `setInterval` por conexión.
- Acceptance criteria: superado un tope razonable por usuario (p. ej. 10), la conexión nueva se rechaza o cierra la más antigua; un test abre N+1 streams y comprueba el comportamiento.
- Suggested implementation: cota en `SyncHub.subscribe` que expulse la conexión más antigua al superar el límite.

**Quality gate creado — `scripts/security-config.sh`.** La pasada anterior lo propuso y nunca se creó, así que la postura endurecida no se re-verificaba en ningún ciclo. Ya existe y comprueba por código de salida: headers y `poweredByHeader` en `next.config.mjs`; `httpOnly`/`sameSite` y los rate-limits de `/sign-in/email` y `/sign-up/email` en `auth.ts`; los bindings a loopback de RQ-SEC-006; que no haya `.env` versionado; y `npm audit --audit-level=high`. Verificado en ambas direcciones: pasa con la postura actual y **falla** al revertir `poweredByHeader` o el binding de pgweb. Falta declararlo en `04_BUILD_REPORT.json#quality_gates` para que `aitri verify-run` lo ejecute.

**Verdict:** 4 hallazgos nuevos — **P0: 0 · P1: 1 · P2: 3**. Riesgo general **bajo-medio**, y el matiz importa: la superficie *del producto* sigue bien endurecida (auth, aislamiento, headers, cero fuga al cliente, 0 vulnerabilidades en dependencias), pero el hallazgo P1 no estaba en el producto sino en el **entorno de desarrollo**, expuesto y activo mientras se auditaba. Es el recordatorio de por qué una auditoría solo de código es media auditoría.

---

### Security — pasada delta (2026-08-05)

_Tercera revisión adversarial, disparada porque los requisitos cambiaron con la re-derivación de la Fase 1 (2026-08-04). El delta de CÓDIGO desde la pasada anterior son tres cambios: **BG-013** (confianza en `X-Forwarded-For`), **BG-012** (validación de la respuesta de la API) y **BL-022** (aviso de persistencia en escritorio). No se re-audita lo ya cubierto salvo para confirmar estado._

**Surfaces audited:** static: **covered** — `src/server/**`, las 4 rutas `/api/v1` + `/health`, `next.config.mjs`, `Dockerfile`, `.github/workflows/`, `.gitignore`, `git ls-files`, `npm audit`, y los dos gates de seguridad ejecutados a mano. · runtime: **covered** — **build de producción limpio** (`.next-smoke` reconstruido desde el árbol actual) arrancado en `:3247`; probados headers servidos, gating de las 4 rutas de datos sin sesión, allowlist de Origin en mutaciones, `/health`, y rutas de descubrimiento/diagnóstico. · **No cubierto:** TLS en tránsito (se termina en el proxy; sin instancia pública) — sigue siendo verificación manual (TC-BE-077h).

**Nota de método — la primera pasada de hoy midió el servidor equivocado.** El primer sondeo reportó «faltan CSP y HSTS» y «las rutas de `/api/v1` dan 404». Era falso: `.next-smoke` contenía un build del **9 de julio**, y un `next-server` viejo seguía ocupando el puerto, así que un `npm run start` posterior murió con `EADDRINUSE` y las peticiones las respondía el proceso antiguo. Sobre el build reconstruido y un puerto limpio, la postura real es la que se documenta abajo: correcta. Se deja escrito porque **ese error de medición destapó RQ-SEC-010**, que es el hallazgo importante de esta pasada.

**Lo que se confirmó sano (evidenciado sobre el build actual, no asumido):**
- **Los cinco headers de seguridad, servidos:** `Content-Security-Policy` (con `frame-ancestors 'none'` y `base-uri 'self'`), `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. Sin `X-Powered-By`.
- **Gating íntegro:** las 4 rutas de datos responden `401 {"error":{"code":"unauthorized"}}` sin sesión — GET y mutaciones por igual. Sin stack trace, sin versión, sin reflejar la entrada. La allowlist de Origin dispara antes que la auth en mutaciones (`403 origin_not_allowed` con un Origin no listado), y el orden del wrapper es el correcto: Origin → auth (401) → validación del cuerpo (422), o sea **nunca se parsea el cuerpo de un no autenticado**.
- `/health` devuelve `{"status":"ok"}` y nada más. `/api/v1`, `/debug`, `/.env`, `/api/v1/openapi.json` → 404. Sin docs ni diagnóstico expuestos.
- `npm audit`: **0 vulnerabilidades** (info/low/moderate/high/critical todas a 0). Los gates `secret-scan` y `security-config` pasan (exit 0) ejecutados a mano.
- **Postura de repositorio:** CI (`ci.yml`) + **CodeQL** (`codeql.yml`) + `dependabot.yml` presentes; `.gitignore` cubre `.env`, `.env.local`, `.env.*.local`; el único fichero de entorno versionado es `.env.example`. El Dockerfile y el CI **compilan desde fuente en cada corrida** — la producción no hereda el problema de RQ-SEC-010.
- **RQ-SEC-003 — REMEDIADO** (BG-013). `LEDGER_TRUST_PROXY` decide si se lee `X-Forwarded-For`, con comparación estricta contra `"true"`, y **falla hacia el lado seguro**: sin la variable, la IP es la de la conexión TCP y el límite siempre limita. `DEPLOYMENT.md:98-113` documenta la decisión, incluido el trade-off de granularidad cuando varios usuarios comparten IP de salida. Verificado en `src/server/env.ts:72` y `src/server/auth.ts:78`.
- **RQ-SEC-006 — se mantiene remediado:** `docker ps` muestra `ledger-dev-db` y `ledger-dev-pgweb` atados a `127.0.0.1`.
- **RQ-SEC-001, RQ-SEC-008, RQ-SEC-009 siguen abiertos por decisión**, sin cambio de estado: la CSP servida contiene `'unsafe-inline'`/`'unsafe-eval'`; `src/server/http.ts:95` mantiene `if (origin && !allowed)`; `SyncHub.subscribe` sigue sin cota por usuario.

**[RQ-SEC-010]** `P1` — El gate `smoke` (required) llevaba cuatro semanas acreditando un build del 9 de julio
- Severity: **Medium (de aseguramiento, verificado)** — No es una vulnerabilidad explotable: el artefacto desplegado se compila fresco en el Dockerfile y en el CI. El daño es a la **evidencia**: `smoke` está declarado `required: true`, cuenta para `verifyPassed` y por tanto para la decisión de desplegable, y lo que verificaba no era el código actual.
- Evidence: `smoke.sh` solo compila `if [ ! -f "$NEXT_DIST_DIR/BUILD_ID" ]`. `ls -la .next-smoke/BUILD_ID` → **9 de julio 21:52**, contra un último commit de código del **3 de agosto**. El build viejo no contenía siquiera el directorio `api/` (`ls .next-smoke/server/app/` → solo `page.js` y `_not-found`): era anterior a la feature `backend`. Su `routes-manifest.json` declaraba **3 headers**, sin CSP ni HSTS — Next compila `headers()` al manifest en tiempo de build, así que el servidor arrancado desde ahí servía la postura de julio. Reconstruido el directorio desde el árbol actual, aparecen `api/` y `health/` y los cinco headers.
- Attack scenario: no hay atacante directo. El escenario es de regresión silenciosa — una rotura de arranque, una ruta caída o un header retirado pasan el gate sin que nadie lo note, porque el gate no mira el código nuevo. Es exactamente la clase de falso verde que el propio informe registra en BL-L para los tests.
- Acceptance criteria: `smoke` recompila cuando cualquier fuente (`src/`, `next.config.mjs`, `package.json`) es más reciente que `BUILD_ID`, o compila siempre; y su verificación no se limita a `GET / → 200` sino que comprueba **las 4 rutas de `/api/v1` respondiendo 401 sin sesión** y **los 5 headers de seguridad presentes**. Prueba en ambos sentidos: falla si se retira un header o si una ruta deja de estar gateada.
- Suggested implementation: en `smoke.sh`, sustituir el guard por una comparación de mtime (`find src next.config.mjs package.json -newer "$NEXT_DIST_DIR/BUILD_ID" | head -1`) y añadir tras el arranque los `curl` de headers y de gating con `exit 1` ante cualquier ausencia. Eso convierte `smoke` en el gate mecánico de postura que hoy no existe.

**[RQ-SEC-011]** `P1` — El servidor de desarrollo publica en todas las interfaces y llevaba tres días vivo
- Severity: **Medium (verificado, activo durante la auditoría)** — `npm run dev` es `next dev -p 3100`, y `next dev` liga a `0.0.0.0` por defecto. Cualquiera en la misma red (wifi de oficina, café, invitados) alcanza la app. Verificado: `curl http://192.168.1.8:3100/` → **200** desde la IP de LAN, con el proceso corriendo desde hacía **3 días**. Es el hermano de RQ-SEC-006 —que ató los contenedores a loopback— pero en el proceso de Next, que quedó fuera de aquella corrección.
- Attack scenario: quien alcance `:3100` obtiene la app completa contra la BD de desarrollo. Y como el `BETTER_AUTH_SECRET` de desarrollo **está versionado en el repositorio** (la pasada anterior ya lo advirtió para el contenedor `app`), quien lo tenga puede **forjar una sesión válida** contra esa instancia. Datos de desarrollo, no de producción — por eso Medium y no High.
- Acceptance criteria: `npm run dev` liga a `127.0.0.1`; `curl http://<ip-de-LAN>:3100/` no conecta mientras `http://127.0.0.1:3100/` sigue funcionando. Si se quiere probar desde el móvil en la misma red, que sea un script aparte y explícito (`dev:lan`), no el default.
- Suggested implementation: `"dev": "next dev -H 127.0.0.1 -p 3100"` en `package.json`, y opcionalmente `"dev:lan": "next dev -H 0.0.0.0 -p 3100"` para el caso deliberado. Añadir la comprobación a `scripts/security-config.sh` para que no se revierta en silencio.

**Higiene observada (no es hallazgo):** quedaron procesos `next-server` huérfanos de sesiones anteriores — uno de 3 días en `:3100` y otro de más de un día en `:3220` (webServer de Playwright). Además del punto de RQ-SEC-011, ocupan puertos y provocaron el `EADDRINUSE` que falseó el primer sondeo de esta auditoría. Conviene cerrarlos al terminar una sesión de trabajo.

**Verdict:** 2 hallazgos nuevos — **P0: 0 · P1: 2 · P2: 0**. Riesgo del **producto: bajo** y sin cambio — headers completos, gating íntegro en las 4 rutas, orden correcto de auth antes de parsear el cuerpo, 0 vulnerabilidades en dependencias, repositorio con CI + CodeQL + Dependabot y sin secretos versionados; y RQ-SEC-003, el más importante de las pasadas anteriores, quedó bien remediado. Los dos hallazgos nuevos no están en lo que se despliega sino en **cómo se verifica y cómo se desarrolla**: un gate obligatorio que acreditaba un artefacto obsoleto, y el servidor de desarrollo abierto a la red local. Por segunda pasada consecutiva, lo que aparece no es el producto — es el entorno alrededor del producto.

### Security

_Audit run 2026-09-02 (`aitri audit security`, CLI 2.2.0-rc.9) — first field execution of the repository-posture step (rc.6) + host run-state reading (rc.9). Auditor: agent session; self-declared: this session also authored the rc.6/rc.9 audit machinery being exercised._

**Surfaces audited:** static — repo posture: **covered** (file signals + host settings via `gh`, read-only + workflow run results) · dependencies: **covered** (npm audit, branch-local) · secrets: **partial** (committed-file scan + host secret-scanning config; full-history scan delegated to the declared gitleaks CI step) · code trust boundaries: **NOT re-audited this run** (delegated to declared gates: secret-scan, security-config, e2e) · runtime (deployed/local service): **NOT AUDITED** (no instance probed this run).

**[RQ-SEC-101]** `P1` — Scheduled dependency-security job RED on `main` for ≥3 consecutive weeks
- Severity: High — known-CVE rot in a finance app's HTTP stack. `undici` carried 4 high/2 moderate advisories (cookie-attribute injection GHSA-v3r7-h72x-cjcm, cache-control disclosure GHSA-jr45-8vmc-qm54) while the red runs went unwatched — the exact silent-rot class.
- Evidence: `gh run list --branch main --workflow CI`: scheduled runs failed 2026-08-17, 08-24, 08-31 (run 33387603750: "6 vulnerabilities (2 moderate, 4 high) … fix available via npm audit fix"). Branch `feat/servidor-fuente-unica` audits clean (0 vulns) — the fix exists in its newer lockfile; `main` has not received it.
- Acceptance criteria: next scheduled CI run on `main` exits 0 on the security job; `npm audit --audit-level=high` on `main` exits 0.
- Suggested implementation: land the current branch (or `npm audit fix` directly on `main`). The newly declared `security-audit` quality_gate (`npm audit --audit-level=high`, 04_BUILD_REPORT.json) now mirrors this check in `verify-run`, so the next rot surfaces in the operator loop, not only in Actions.

**[RQ-SEC-102]** `P2` — Branch protection on `main` does not bind administrators (`enforce_admins: false`)
- Severity: Medium — the repo's only committer is an admin, so every protection (PR reviews required, 2 status checks, no force-push) is bypassable by the account most likely to be phished and by the operator's own muscle memory. A compromised admin token pushes to `main` directly, skipping CodeQL/CI.
- Evidence: `gh api repos/cesareyeserrano/budget-ledger/branches/main/protection` → `{"enforce_admins": false, "required_reviews": true, "required_status_checks": 2, "allow_force_pushes": false}`.
- Acceptance criteria: same endpoint returns `enforce_admins: true`; an admin push to `main` without a PR is rejected.
- Suggested implementation: `gh api -X POST repos/cesareyeserrano/budget-ledger/branches/main/protection/enforce_admins` (owner runs it — this audit is read-only).

**Observations (not findings — no attacker story at this threat model):** `secret_scanning_non_provider_patterns` and `secret_scanning_validity_checks` disabled (generic-pattern and validity hardening; provider patterns + push protection ARE enabled, which carry the real weight). `.env.example` contains only placeholder/localhost values, matches its own "never commit real values" header.

**Checked clean (evidence of coverage, not assumption):** CI + CodeQL workflows present and wired · `dependabot.yml` present, security updates enabled, vulnerability alerts enabled (204) · secret scanning + push protection enabled · LICENSE present · `.gitignore` covers `.env*` (3 patterns), only `.env.example` committed · `npm audit` clean on the working branch · no `.env`/credential files in tracked history's current tree.

**Proposed quality_gate:** already landed this cycle — `security-audit` (`npm audit --audit-level=high`, required) declared in `04_BUILD_REPORT.json` alongside the existing secret-scan/security-config gates. No additional gate proposed: RQ-SEC-102 is a host setting (one-time fix, re-checked by future posture audits), and presence-only checks would be gate theater.
