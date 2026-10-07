# BUILD_PLAN — gestion-movil

Plan de construcción de la fase 4. Generación 1 (6-oct-2026). Archivo de trabajo: nada lo valida.
Runner: `../../../unit.sh` (el de `presupuesto-movil`); e2e con `../../../e2e.sh`.
Libro de ejemplo: `tests/fixtures/gmv-base.ts` (cifras inventadas; el repo es público).

Reglas de esta construcción:
- Las pantallas pintan y llaman acciones; no validan ni calculan (TRD, regla de capas).
- No se tocan `BudgetGrid`, `ClosureControl`, `IconPicker` ni las acciones del store (NFR-3201).
- Las dos aserciones vigentes del texto «en el computador» se reescriben en un commit propio (ADR-05).
- Nada de `skip`/`only`/`todo`; fechas ancladas al mes en curso y al anterior.

## EP-01 — Organizar y la pantalla de un elemento   [status: done]
  Delivers:    US-3201
  FRs:         FR-3201
  Makes pass:  TC-GMV-001h, 002h, 003f, 004f, 005f, 006e, 007e, 008e, 009f, 010e
  Build steps: skeleton (variantes de `Detail` en `screenStack`, `structureView.organizeTree`, `nodeText`, fixture
               gmv-base) → integraciones (`OrganizeScreen`, `NodeScreen` con su lista de acciones, botones «Organizar»
               y «Cierre» en el título, despacho en `MobileBudget`, texto de sección vacía) → hardening (enlaces
               rotos, elemento del sistema, historial del navegador)
  Why here:    es el esqueleto de navegación del que cuelgan todas las demás pantallas.

## EP-02 — Crear, renombrar y cambiar ícono   [status: done]
  Delivers:    US-3202, US-3203, US-3204
  FRs:         FR-3202, FR-3203, FR-3204
  Makes pass:  TC-GMV-020h, 021h, 022e, 023e, 024f, 025f, 026e, 027f, 030h, 031f, 032e, 033e, 040h, 041f, 042e,
               043h, 044e
  Build steps: skeleton (`NewNodeScreen`, modo edición de la tarjeta de identidad, `IconGrid`) → integraciones
               (`createNode`, `renameNode`, `setNodeIcon`, avisos del `Toaster`, aviso de traslado de montos) →
               hardening (nombre vacío, padre desaparecido, búsqueda sin resultados)
  Why here:    son las operaciones que no destruyen nada; dan datos para probar borrar y mover.

## EP-03 — Borrar y «Mover a…»   [status: done]
  Delivers:    US-3205, US-3206
  FRs:         FR-3205, FR-3206, NFR-3204
  Makes pass:  TC-GMV-050h, 051f, 052f, 053f, 054e, 055e, 056f, 057e, 058f, 060h, 061h, 062h, 063h, 064f, 065f,
               066e, 067e, 068f, 069e, 070e, 145h, 146e, 147f
  Build steps: skeleton (`structureView.moveDestinations`, `MoveScreen`, bloque de confirmación y motivo en
               `NodeScreen`) → integraciones (`deleteBlockReason`/`deleteNode`, `moveNode`) → hardening (carreras
               con otra sesión, sin destinos válidos, escala)
  Why here:    las operaciones con bloqueos; necesitan la pantalla de elemento de EP-01.

## EP-04 — Cierre de mes y aviso de periodo cerrado   [status: done]
  Delivers:    US-3207, US-3208, US-3209
  FRs:         FR-3207, FR-3208, FR-3209, NFR-3205, NFR-3206
  Makes pass:  TC-GMV-080h, 081e, 082f, 083e, 084f, 085f, 086e, 087h, 090h, 091f, 092f, 093e, 094f, 100h, 101f,
               102f, 103e, 104e, 150h, 151e, 152f, 155h, 156e, 157f
  Build steps: skeleton (`ClosureScreen` con sus dos bloques) → integraciones (`useClosureStatus`, `closeMonth`,
               `reopenMonth`, `closeBlockerText`, `ClosedNotice` con el copy nuevo y el enlace) → hardening (espera,
               fallo, doble toque; reescritura de las dos aserciones vigentes, en commit propio)
  Why here:    independiente de la estructura; va después para no mezclar dos familias de reglas en un mismo corte.

## EP-05 — Encaje, guardado y lo que no debe cambiar   [status: done]
  Delivers:    US-3210, US-3211
  FRs:         FR-3210, FR-3211, NFR-3201, NFR-3202, NFR-3203, NFR-3207
  Makes pass:  TC-GMV-110h, 111f, 112e, 113h, 114e, 115e, 120h, 121h, 122e, 123f, 124f, 130h, 131e, 132f, 135h,
               136e, 137f, 140h, 141e, 142f, 160h, 161e, 162f
  Build steps: skeleton (specs de ancho, tamaño táctil y contraste sobre todas las pantallas) → integraciones
               (persistencia real en Postgres efímero, ida y vuelta teléfono ↔ escritorio) → hardening (regresión de
               escritorio, de la primera entrega y del registro)
  Why here:    recorre TODAS las pantallas, así que solo puede cerrarse cuando existen.

## Bitácora
### EP-01 — hecha el 6-oct-2026
Resultado: 10/10 en verde. Unit (Vitest, proyecto app): TC-GMV-006e, 007e. Integración (jsdom): 003f, 004f, 005f,
009f. Navegador (Playwright, 375 px): 001h, 002h, 008e, 010e — `4 passed (36.1s)`.
Typecheck y lint en verde.

Adelantado: las cinco pantallas ya están escritas y conectadas (`OrganizeScreen`, `NodeScreen`, `IconGrid`,
`NewNodeScreen`, `MoveScreen`, `ClosureScreen`), `structureView.moveDestinations` y el copy nuevo de `ClosedNotice`.
Las épicas 02 a 05 son sobre todo sus pruebas y el endurecimiento.

Rojo esperado hasta EP-04: TC-PMV-111f (integración) y la aserción e2e de `presupuesto-movil.spec.ts` que fijan el
texto «reábrelo desde el cierre de mes en el computador» (ADR-05).

Desviaciones respecto al plan de pruebas, para declarar en el manifiesto:
- «Cambiar ícono» no se ofrece en subcategorías ni en elementos del sistema, igual que en escritorio (la grilla solo
  da ícono propio a grupos y categorías editables). TC-GMV-004f y 005f lo afirman así; el texto del plan listaba
  «Cambiar ícono» también para ellos. Un elemento del sistema tampoco ofrece «Mover a…».
- La ruta dice «Gastos · Comida» (el `pathOf` vigente de la primera entrega), no «Gasto · Comida».
- TC-GMV-008e desplaza la lista 30 px y no 300: «Organizar» está en la línea del título, y con un desplazamiento
  largo el propio clic de la prueba sube la página.
- gmv-vacio no lleva cifras: sin ingresos el servidor rechaza gastos y aportes por déficit.

### EP-02 — hecha el 6-oct-2026
Resultado: 17/17 en verde. Integración (jsdom): TC-GMV-021h, 022e, 023e, 024f, 025f, 026e, 027f, 031f, 032e, 033e,
041f, 042e. Navegador: 020h, 030h, 040h, 043h, 044e.
Desviaciones: TC-GMV-027f afirma lo que de verdad ocurre —el alta no se crea y la pantalla vuelve a Organizar—; el
texto «No se pudo crear: el elemento donde iba ya no existe» queda como defensa, pero la redirección por padre
inexistente llega antes y el usuario no llega a leerlo. El ícono del libro de ejemplo es «coffee» (no existe «cart»
en el catálogo).

### EP-03 — hecha el 6-oct-2026
Resultado: 23/23 en verde. Dominio: TC-GMV-064f, 066e, 067e, 145h. Unit: 057e. Integración: 051f, 052f, 053f, 054e,
055e, 056f, 058f, 061h, 062h, 063h, 065f, 068f, 069e, 146e, 147f. Navegador: 050h, 060h, 070e.
Hallazgo: en escritorio, mover una categoría CON subcategorías dentro de otra categoría no se bloquea: aplana las
subcategorías al nuevo padre (rama previa de `moveNode`, NFR-703). El teléfono lo ofrece igual («como
subcategoría»). El desborde con aviso solo existe al bajar un GRUPO. TC-GMV-064f lo fija así.
Desviación: TC-GMV-068f — el destino borrado desaparece de la lista en el mismo instante, así que el texto «Ese
lugar ya no está disponible» no llega a verse; se afirma que nada se movió.

### EP-04 — hecha el 6-oct-2026
Resultado: 24/24 en verde. Integración (jsdom): TC-GMV-081e, 083e, 084f, 085f, 086e, 087h, 091f, 092f, 093e, 094f,
101f, 102f, 104e, 150h, 151e, 156e. Postgres efímero: 152f, 157f. Navegador: 080h, 082f, 090h, 100h, 103e, 155h.
Notas: el mes EN CURSO es cerrable (FR-2008), así que los escenarios son «PREV y M cerrados» y «PREV cerrado, M
reabierto», no M−2/M−1 como decía el plan. La ruta de cierre es POST (cerrar) y DELETE (reabrir) con solo
`baseRevision` en el cuerpo; el TRD decía `{ action, revision }`. Una celda descuadrada no se puede sembrar por la
API: se planta en la base con `descuadrarCelda`, como en diario-de-celda.
Reescritas (ADR-05): TC-PMV-111f y la aserción gemela de `tests/e2e/presupuesto-movil.spec.ts`.

### EP-05 — hecha el 6-oct-2026
Resultado: 23/23 en verde. Integración: TC-GMV-136e, 137f, 142f. Postgres efímero: 121h. Navegador: 110h, 111f, 112e,
113h, 114e, 115e, 120h, 122e, 123f, 124f, 130h, 131e, 132f, 135h, 140h, 141e, 160h, 161e, 162f.
Suite completa (`unit.sh`, Node 22): 1.778 de 1.779 en la primera corrida; el rojo era el guardia TC-CDM-064f de
cierre-de-mes, que solo admitía dos invocaciones de `closeMonth`. Se amplió para admitir la de `ClosureScreen`, con
el motivo escrito, y pasa. Spec de navegador de la feature: 37/37.

## Cierre de la fase
97/97 TCs con su prueba, una por id. Typecheck, lint y design-tokens en verde. Falta `verify-run`, que corre la
suite completa de navegador.
