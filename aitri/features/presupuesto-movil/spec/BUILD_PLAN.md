# BUILD_PLAN — presupuesto-movil

Plan de construcción (generación 1, 3-oct-2026). Archivo de trabajo: lo actualiza el agente en cada frontera de
épica. Al retomar una sesión, leer esto primero y seguir desde la primera épica que no esté `done`.

Runner: `vitest run` (proyectos `app` y `backend`) y Playwright (`./e2e.sh`), con Node 22 delante en el PATH.
Fixture común: `pmv-base` (descrito en `03_TEST_CASES.json#test_plan.strategy`), anclado al periodo actual M y a
M−1 cerrado.

## EP-01 — Shell móvil y navegación   [status: done]
  Delivers:    US-3101, US-3113
  FRs:         FR-3101, FR-3113 (y NFR-3101, NFR-3102, NFR-3104)
  Makes pass:  TC-PMV-001h, 002e, 003f, 004h, 005e, 006f, 007e, 120h, 121e, 122f, 123e, 150h, 151e, 153h, 154e,
               155f, 159h, 160e, 161f
  Build steps: skeleton (`screenStack`, `SegmentedNav`, `MobileShell` con montaje perezoso y un `MobileBudget`
               mínimo) → integrations (historial, enlaces directos, scroll) → hardening (URL inválida, pruebas)
  Why here:    todo lo demás vive dentro de este shell; además fija que el registro queda igual desde el primer
               commit.

## EP-02 — Leer el periodo   [status: done]
  Delivers:    US-3102, US-3103, US-3104, US-3114
  FRs:         FR-3102, FR-3103, FR-3104, FR-3114 (y NFR-3107)
  Makes pass:  TC-PMV-010h, 011e, 012f, 013e, 014h, 020h, 021h, 022e, 023f, 024e, 025h, 026f, 027e, 030h, 032e,
               033f, 034e, 168h, 170f
               (130h, 131e, 132f, 133h y 134e pasan a EP-06: miden TODAS las pantallas, y cuatro aún no existen)
  Build steps: skeleton (`orderedGroups`/`orderedChildren` en `tree.ts`, `periodView`, `PeriodBar`,
               `BudgetSections` con tarjeta, fila y barra) → integrations (store, SSE, paridad con la grilla) →
               hardening (9 dígitos, 360 px, contraste, objetivos táctiles)
  Why here:    es la pantalla desde la que se entra a todas las de detalle, y el guardrail de cifras iguales.

## EP-03 — Categoría: plan, movimientos, editar y borrar   [status: done]
  Delivers:    US-3105, US-3106, US-3107, US-3108
  FRs:         FR-3105, FR-3106, FR-3107, FR-3108 (y NFR-3101, NFR-3103)
  Makes pass:  TC-PMV-040h, 041e, 042f, 043f, 044e, 050h, 051e, 052f, 053f, 060h, 061e, 062f, 063f, 064e, 065h,
               066f, 067e, 068e, 070h, 071f, 072f, 073e, 152f, 157e
  Build steps: skeleton (`LeafScreen`, `AmountEditCard`, `amountDraftState`) → integrations (extraer
               `movementEditVerdict` de `MovementEditor`; props opcionales en las piezas del registro;
               `MovementEditScreen`; mudar `dayLabel`) → hardening (rechazos, ajuste negativo, 0 = borrar)
  Why here:    es lo que el usuario pidió primero (ver y corregir gastos); trae los dos refactors de escritorio
               más delicados, que conviene cerrar pronto.

## EP-04 — Alcancías y retiros   [status: done]
  Delivers:    US-3109, US-3110
  FRs:         FR-3109, FR-3110 (y NFR-3105)
  Makes pass:  TC-PMV-080h, 081f, 082f, 083e, 090h, 091h, 092e, 093f, 094f, 095e, 096e, 162h, 163f
  Build steps: skeleton (`LeafScreen` en modo alcancía, `WithdrawalsScreen`, `withdrawalRows`) → integrations
               (`applyReserveEdit`, `editReserveOp`, `blockMessage`, `cellHeadroom`) → hardening (rechazos con el
               texto de escritorio)
  Why here:    reusa `AmountEditCard` y la lista de EP-03.

## EP-05 — Balance y resumen protegido   [status: done]
  Delivers:    US-3111, US-3115
  FRs:         FR-3111, FR-3115 (y NFR-3106, NFR-3107)
  Makes pass:  TC-PMV-031h, 100h, 101h, 102f, 103e, 104e, 105f, 140h, 141h, 142h, 143f, 144e, 145e, 146f, 147e,
               165h, 166e, 167f, 169e
  Build steps: skeleton (mudar funciones de `BalanceModule` a `balanceView.ts`, `BalanceScreen`) → integrations
               (`SummaryCard`, `useHoldReveal`, serie memoizada compartida) → hardening (puntero cancelado, teclado,
               cifras fuera del DOM)
  Why here:    el resumen depende de la serie del Balance; va después de las pantallas que cambian datos para
               probarlo con cifras que se mueven.

## EP-06 — Periodo cerrado y cierre de la feature   [status: done]
  Delivers:    US-3112
  FRs:         FR-3112 (y NFR-3103, NFR-3105)
  Makes pass:  TC-PMV-110h, 111f, 112f, 113e, 114e, 156h, 158f, 164e, 130h, 131e, 132f, 133h, 134e
  Build steps: skeleton (aviso de cerrado y controles ausentes en todas las pantallas) → integrations (cierre por
               SSE con el editor abierto; pruebas contra Postgres efímero) → hardening (revisión una por una de las
               pruebas viejas de «en móvil no hay grilla», ADR-06; manifiesto; prueba manual del ojo en iPhone)
  Why here:    cruza todas las pantallas, así que se cierra cuando todas existen.

## Notas de ejecución
- El `next dev` del usuario en `:3100` recarga el código a medio hacer. No hay migraciones, así que la app sigue
  cargando; escritorio solo cambia por los refactors de EP-03 y EP-05.
- Una unidad de pruebas a la vez, con carga baja. Un resultado degradado se descarta y se repite; no se acredita.
- Nada de `skip`/`only`/`todo`. Las pruebas con fecha se anclan al mes anterior.

## Evidencia por épica
- **EP-01 y EP-02 — 3-oct-2026.** 38 de 38 TCs en verde, Node 22.
  - `vitest run --project app` sobre `tests/domain/presupuesto-movil-lista.test.ts`,
    `tests/domain/presupuesto-movil-una-pasada.test.ts` y `tests/unit/presupuesto-movil-pantallas.test.ts`:
    7 pasan (007e, 025h, 026f, 027e, 033f, 168h, 170f).
  - `playwright test tests/e2e/presupuesto-movil.spec.ts --retries=0`: 31 pasan. La primera corrida dio 29/31; los
    dos rojos (030h y 034e) eran de la PRUEBA, no del código: 030h buscaba `data-cell` en celdas de padre, que no
    lo llevan, y 034e tecleaba encima del valor en vez de reemplazarlo. Corregidas y repetidas en verde.
  - `tsc --noEmit`, `tsc -p tsconfig.e2e.json` y `eslint` sobre lo tocado: limpios.
  - Adelantado de EP-03: `movementEditVerdict` extraído y `MovementEditor` ya lo consume; `bg-068` y
    `diario-de-celda-ajuste` siguen en verde (12/12).
- **Desviación del diseño anotada:** `dayLabel` no se muda a `format.ts`: es un alias de `formatDay`, que ya vive en
  el dominio, y el teléfono usa `formatDay` directamente. `CellDetail.tsx` queda sin tocar.
- **EP-03 a EP-06 — 3-oct-2026.** Los 107 TCs en verde, Node 22.
  - `vitest run --project app` (suite completa): 127 archivos, 1.215 pruebas, 0 fallos. Incluye los 35 TCs de
    cálculo y de pantalla de esta feature.
  - `vitest run --project backend tests/integration/backend/presupuesto-movil.test.ts`: 2 de 2 (112f, 164e).
  - `playwright test tests/e2e/presupuesto-movil.spec.ts --retries=0`: 70 de 70.
  - Recuento: 107 marcadores `@aitri-tc TC-PMV-*` en los archivos de prueba, ni uno de más ni de menos.
- **Lo que cazó la suite vecina.** La primera corrida completa dio 5 rojos, todos en `design-tokens.test.ts`: el
  guardia del sistema de diseño (`scripts/design-tokens.sh`) rechazaba el código nuevo por tres motivos reales.
  Corregidos así:
  1. Nueve tamaños de letra fuera de la escala (`text-[…rem]`) → ahora solo `text-caption`, `text-label`,
     `title-sm`, `title`, `display` y `eyebrow`. El resumen desplegado pasó de tres columnas a una fila por saldo:
     tres columnas no dan para cifras de nueve dígitos dentro de la escala.
  2. La etiqueta de tipo de «Editar movimiento» iba en el color del tipo → ahora va en neutro. Fuera de las piezas
     del registro el color no clasifica (refinamiento-ui FR-1201).
  3. `mobile/tone.ts` usa `--favorable` → excepción DECLARADA en el guardia, con su motivo: es el mismo `cellTone`
     condicional de la grilla, no un verde de normalidad.
- **Desviaciones del UX spec, por mandar el estándar del producto:** (a) etiqueta de tipo en neutro, no en el color
  del tipo; (b) resumen desplegado en filas, no en tres columnas; (c) «de <presupuestado>» en la letra de texto.
- **ADR-06, hecho:** se actualizó el título y el comentario de TC-010h, TC-010f, TC-SUT-257e, TC-FDC-026e,
  TC-UXC-306h y TC-BSC-451f para que digan lo que comprueban hoy. Ninguna aserción cambió, ninguna se saltó.
  TC-213f no necesitó cambio: su enunciado sigue siendo cierto.
- **Pendiente manual:** probar el ojo (mantener presionado) en un iPhone real.

## Generación 2 del plan — 4-oct-2026 (cambio de requisito)
El usuario probó la feature en dev y cambió FR-3115: el ojo del resumen pasa de «mantener presionado» a **un
toque que muestra 10 segundos y se oculta solo** (segundo toque oculta antes; no configurable). Se reabrió la fase
1 y se re-derivaron ux, arquitectura y pruebas. Las épicas EP-01 a EP-06 conservan su contenido y su estado; solo
se reabre lo que toca el ojo.

## EP-07 — El ojo con temporizador   [status: done]
  Delivers:    US-3115
  FRs:         FR-3115
  Makes pass:  TC-PMV-141h, 143f, 144e, 145e (reescritas con el mismo id), y 131e, 133h, 142h (usan el ojo)
  Build steps: `useTimedReveal` sustituye a `useHoldReveal` → `SummaryCard` con el ojo como botón de alternar →
               pruebas
  Why here:    cambio de requisito tras la entrega; no depende de nada más.

- **Evidencia EP-07:** ver el `verify-run` que sigue a este cambio. Desaparece la deuda «probar el ojo en un
  iPhone real»: ya no hay pulsación larga.
