# BUILD_PLAN — feature diario-de-celda

Plan generation: 1 (fresh build, 2026-09-15). Fuente: 01_REQUIREMENTS.json + 01_UX_SPEC.md + 02_SYSTEM_DESIGN.md +
03_TEST_CASES.json (171 TCs, cada uno en exactamente un epic: 21 + 49 + 64 + 37).

Prerrequisitos ya hechos: BG-039 arreglado (`4753a39`, todo movimiento de gasto o ingreso apunta a una hoja) y change request
de `transferencias` por FR-2509 (`e4542a6`, fases 3-5 re-aprobadas, verify 67/67).

**Corrección del 2026-09-15, tras leer los TCs (el plan presentado al usuario decía lo contrario):** el aviso de mes cerrado
(`BudgetGrid.tsx:364-365`, «dejar una observación») **SÍ cambia** — lo exigen TC-DDC-175f («el aviso contiene comentario y no
casa /observaci/i») y TC-DDC-173f (0 apariciones de /observaci/i en 5 superficies). `cierre-de-mes.spec.ts:159` esperaba
«observación»: decisión del usuario del 2026-09-15 → se cambió **solo el código de ese test** a «comentario», sin change
request sobre `cierre-de-mes`. Su TC-CDM-091f pide que el aviso «nombre la salida», y la sigue nombrando; es el mismo
criterio que el diseño aprobado ya aplicó a la etiqueta de `techo-de-flujo`. Queda declarado en `04_BUILD_REPORT.json`.

**Cuatro TCs movidos de epic** respecto del plan presentado, porque no pueden estar en verde en EP-01: TC-DDC-009e (siembra un
ajuste `kind:'adjustment'` negativo → EP-02), TC-DDC-174f (abre el bloque de edición del movimiento → EP-03), TC-DDC-157f
(usa `cellMismatches` → EP-04) y TC-DDC-173f (barre también el aviso de descuadre del Balance → EP-04).

**Un quinto movido el 2026-09-16:** TC-DDC-077e (`kind` y signo sobreviven a un PATCH del ajuste y al cierre) → **EP-03**.
Necesita `PATCH /api/v1/movements/{id}`, que hoy responde `unsupported` (`movements/[id]/route.ts:27`) y se construye en ese
epic. EP-02 queda en 48 TCs y EP-03 en 65; el reparto sigue cubriendo los 171 exactamente una vez.

## EP-01 — Ver el Detalle de la celda   [status: done]
  Delivers:    US-2501, US-2508, US-2509
  FRs:         FR-2501, FR-2508, FR-2509
  Makes pass:  TC-DDC-001h, TC-DDC-002h, TC-DDC-003e, TC-DDC-004f, TC-DDC-005f, TC-DDC-006e, TC-DDC-007e, TC-DDC-008e, TC-DDC-010e, TC-DDC-011e, TC-DDC-151h, TC-DDC-152h, TC-DDC-153e, TC-DDC-154e, TC-DDC-155f, TC-DDC-156f, TC-DDC-158e, TC-DDC-159e, TC-DDC-171h, TC-DDC-172e, TC-DDC-175f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Superficie de solo lectura (`cellDetail`, `displayAmount`, `CellDetail`, `DetailRow`) más los textos de FR-2509 y su test estructural. No cambia el servidor ni el esquema, y las acciones de los epics siguientes se montan dentro de este panel. Incluye el renombre del aviso de mes cerrado y el ajuste de `cierre-de-mes.spec.ts:159`.

## EP-02 — Añadir un movimiento y teclear un ajuste   [status: done]
  Delivers:    US-2502, US-2503, US-2504
  FRs:         FR-2502, FR-2503, FR-2504
  Makes pass:  TC-DDC-021h, TC-DDC-022h, TC-DDC-023e, TC-DDC-024e, TC-DDC-025f, TC-DDC-026f, TC-DDC-027f, TC-DDC-028f, TC-DDC-029e, TC-DDC-030e, TC-DDC-031f, TC-DDC-041h, TC-DDC-042h, TC-DDC-043e, TC-DDC-044e, TC-DDC-045e, TC-DDC-046e, TC-DDC-047f, TC-DDC-048f, TC-DDC-049f, TC-DDC-061h, TC-DDC-062h, TC-DDC-063e, TC-DDC-064e, TC-DDC-065e, TC-DDC-066e, TC-DDC-067e, TC-DDC-068f, TC-DDC-069f, TC-DDC-070f, TC-DDC-071e, TC-DDC-072f, TC-DDC-073f, TC-DDC-074e, TC-DDC-075e, TC-DDC-076e, TC-DDC-009e, TC-DDC-341h, TC-DDC-342f, TC-DDC-343e, TC-DDC-344e, TC-DDC-345e, TC-DDC-351h, TC-DDC-352e, TC-DDC-353f, TC-DDC-371h, TC-DDC-372e, TC-DDC-373f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Introduce lo que todo lo demás necesita: migración `0009` (`kind` + CHECK), mapeo de `kind` en las cuatro lecturas y reescrituras del snapshot, `apiMovementSchema` con ajustes negativos, `proposedDate`/`isDateInPeriod`, `adjustCell`/`movementSum` y el cuadre relativo del PUT. Como ese cuadre rechaza siembras con Ejecutado sin movimientos, AQUÍ se arreglan los datos de prueba (decisión del usuario del 2026-09-15, NFR-2507): `buildSeedConMontos`, el paso holgado de `seedLedger`, `tests/fixtures/ciclos-usuario.ts` y las siembras de integración listadas en `03_TEST_CASES.json#test_plan.strategy`, siempre ajustando el fixture y nunca el resultado esperado. TCs NFR alojados aquí: NFR-2503 (bolsillos), NFR-2504 («Nuevo movimiento» sin cambios), NFR-2506 (Presupuestado sin cambios).

## EP-03 — Editar y borrar movimientos   [status: done]
  Delivers:    US-2505, US-2506
  FRs:         FR-2505, FR-2506
  Makes pass:  TC-DDC-081h, TC-DDC-082h, TC-DDC-083h, TC-DDC-084e, TC-DDC-085e, TC-DDC-086e, TC-DDC-087e, TC-DDC-088f, TC-DDC-089f, TC-DDC-090f, TC-DDC-091f, TC-DDC-092f, TC-DDC-093f, TC-DDC-094f, TC-DDC-095h, TC-DDC-096e, TC-DDC-097f, TC-DDC-098e, TC-DDC-099e, TC-DDC-100f, TC-DDC-101f, TC-DDC-103e, TC-DDC-174f, TC-DDC-077e, TC-DDC-111h, TC-DDC-112h, TC-DDC-113e, TC-DDC-114e, TC-DDC-115e, TC-DDC-116f, TC-DDC-117f, TC-DDC-118f, TC-DDC-119f, TC-DDC-120f, TC-DDC-121e, TC-DDC-122f, TC-DDC-123f, TC-DDC-301h, TC-DDC-302f, TC-DDC-303f, TC-DDC-304f, TC-DDC-305f, TC-DDC-306f, TC-DDC-307e, TC-DDC-308f, TC-DDC-309f, TC-DDC-310e, TC-DDC-311e, TC-DDC-312f, TC-DDC-328e, TC-DDC-321h, TC-DDC-322e, TC-DDC-323f, TC-DDC-324f, TC-DDC-325e, TC-DDC-326e, TC-DDC-327e, TC-DDC-361h, TC-DDC-362f, TC-DDC-363e, TC-DDC-364e, TC-DDC-391h, TC-DDC-392e, TC-DDC-393f, TC-DDC-394e
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Las rutas nuevas `PATCH` y `DELETE /api/v1/movements/{id}` (transacción con `FOR UPDATE`, 404 por dueño, `negative_cell`, `invalid_target`) y `editMovement`/`deleteMovement`/`wouldGoNegative` se apoyan en el `kind` persistido y en el cuadre relativo de EP-02. Con todas las vías de escritura ya existentes se cierran aquí sus NFRs transversales: NFR-2501 (seguridad), NFR-2502 (no empeora), NFR-2505 (techo y piso) y NFR-2508 (registro vía `withApi`).

## EP-04 — Cierre y descuadres   [status: done]
  Delivers:    US-2507, US-2511, US-2512
  FRs:         FR-2507, FR-2511, FR-2512
  Makes pass:  TC-DDC-131h, TC-DDC-132e, TC-DDC-133e, TC-DDC-134e, TC-DDC-135f, TC-DDC-136f, TC-DDC-137f, TC-DDC-138e, TC-DDC-139f, TC-DDC-191h, TC-DDC-192h, TC-DDC-193e, TC-DDC-194e, TC-DDC-195e, TC-DDC-196f, TC-DDC-197f, TC-DDC-198f, TC-DDC-199f, TC-DDC-200e, TC-DDC-157f, TC-DDC-173f, TC-DDC-211h, TC-DDC-212h, TC-DDC-213e, TC-DDC-214e, TC-DDC-215f, TC-DDC-216f, TC-DDC-217f, TC-DDC-218e, TC-DDC-219e, TC-DDC-381h, TC-DDC-382e, TC-DDC-383f, TC-DDC-384e, TC-DDC-401h, TC-DDC-402e, TC-DDC-403f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Cerrar congela las vías que crean EP-02 y EP-03 (`closedPeriodsViolated` compara también `note`, `date` y `kind`), así que va después de ellas. `cellMismatches`/`monthIssues` pintan el triángulo y la línea del Balance, y `closeBlockers` bloquea «Cerrar» en el cliente y en `closeMonthFor` (422 `unbalanced_cells`); es la primera regla que bloquea un cierre (riesgo high del TRD). Cierra con NFR-2507 (cierre de mes íntegro) y NFR-2509 (CI existente, sin workflow nuevo).

---

## Checkpoints / evidencia
(al cierre de cada epic: resultado del run de sus TCs + notas)

### EP-01 (2026-09-15) — done
**Runs.** Playwright sobre los tres specs que comparten superficie, en UNA sola corrida (dos corridas Playwright a la vez se
pisan las cuentas e2e — BG-036): `diario-de-celda` 18 + `transferencias` 14 + `techo-de-flujo` 22 = **54 passed, exit 0**
(27,8 s). Vitest: `diario-de-celda-detalle` 6/6 y `reserve-notes` 1/1 = **7 passed, exit 0**. `typecheck` y `lint` exit 0.

**Qué se construyó.**
- `src/domain/detail.ts` (nuevo): `cellDetail` (orden: automático → movimientos por fecha y `createdAt` → comentarios),
  `displayAmount` (signo del tipo × signo del monto; `addsToCell` gobierna el color) y `firstDayOf`.
- `Movement.kind?: "adjustment"` en `types.ts` — delta de TIPO solamente; su persistencia y su CHECK son de EP-02.
- `src/components/CellDetail.tsx` (nuevo): el panel «Detalle» con `DetailRow`, estado vacío, `max-height` 360 px y
  posicionamiento que se alinea al borde derecho de la celda cuando no cabe (TC-DDC-006e, verificado a 768 y 1440 px).
- `src/components/CellNoteInput.tsx` (nuevo): el campo «Añadir comentario». Se sacó de `ReserveCells` para romper el ciclo
  de imports que aparecía al montar `CellDetail` dentro del editor de bolsillos.
- `CellNotesSection` desaparece: era el panel entero y se repartió en esas dos piezas. Los `data-testid` que NFR-2503 manda
  conservar (`cell-notes`, `cell-note`, `carry-note`, `cell-notes-empty`) viven ahora en `CellDetail`, con el mismo
  significado — lo prueban los 14 de `transferencias` y los 22 de `techo-de-flujo` en verde.
- FR-2509: el aviso de mes cerrado dice «dejar un comentario» y `cierre-de-mes.spec.ts:159` busca esa palabra.

**Dos arreglos de producto que salieron del camino** (ninguno es un cambio de test para pasar la prueba):
1. `formatDay` extraído de `formatRange` (`cycles.ts`): el formato «18 sep» estaba escondido dentro del formateador de
   rangos. `Intl` con `es-CO` devuelve «1 de sept», que no es el formato del producto, así que una segunda copia habría
   violado NFR-2412 («formato único en toda la app»). Ahora el rango de ciclos y la fila del Detalle usan la misma función;
   las 70 pruebas de `ciclos` siguen en verde.
2. `ReserveLeafCell` ahora emite `data-cell`, `data-month` y `data-plane`, como ya hacía `Cell` para gasto e ingreso. Sin
   ellos, una celda de bolsillo solo se podía localizar contando columnas y el Detalle no tenía forma estable de señalarla.

**Cuatro defectos del propio test corregidos antes de acreditar nada** (la primera corrida dio 7 rojos): el cálculo de
contraste comparaba el texto contra un tinte hecho con su MISMO token (ratio 1,0) en vez de componer las capas translúcidas
sobre el fondo opaco; la operación De→A se sembraba sin fecha y el servidor la rechazaba con `period_mismatch`; `getByLabel`
contaba «Añadir comentario» como «Comentario» por no exigir coincidencia exacta; y el ayudante esperaba la grilla a 375 px,
donde la app solo monta el registro.

**Pendiente para EP-02, ya detectado:** `TC-DDC-152h` afirma que el comentario persiste tras recargar, y pasa; el cuadre
relativo del PUT que llega en EP-02 va a rechazar las siembras con Ejecutado sin movimientos, así que los datos de prueba de
este spec se revisan con el resto (NFR-2507).

### EP-02 (2026-09-17) — done
**Runs.** Playwright, suite COMPLETA (los doce specs, porque estos casos comparten fixture con todos): **520 passed, exit 0**
(3,5 min); el spec propio, 37/37. Vitest, suite completa: **86 ficheros, 1.043 passed, exit 0**. `typecheck` y `lint` exit 0.
Los 48 TCs declarados para este epic tienen prueba etiquetada —comprobado por barrido de `@aitri-tc` contra el plan—, sin
huecos y sin etiquetas adelantadas de EP-03/EP-04.

**Qué se construyó.**
- Migración `0009` (`kind` + `movement_kind_ck` + `movement_amount_ck`), reflejada en `schema.ts` y mapeada en las cuatro
  lecturas/reescrituras del snapshot de `ledgerRepo`. El ajuste es el ÚNICO movimiento que puede ser negativo, y solo en
  gasto e ingreso.
- `src/domain/adjust.ts` (nuevo): `proposedDate`, `isDateInPeriod` y `adjustCell` — teclear un total ya no cambia solo la
  cifra, crea el ajuste que la respalda (FR-2504).
- Cuadre RELATIVO en el PUT (`worsenedCellMismatches`): se rechaza solo lo que la escritura EMPEORA, no un descuadre que ya
  venía de antes. Va entre el guardia del cierre y las reglas de reserva, y viaja hasta el usuario como aviso propio
  (422 `cell_movement_mismatch` → `repo.cellMismatch` → toast), no como «no se pudo guardar».
- `AddMovementLine` (nuevo): monto, nota y fecha en una fila, con el calendario acotado al periodo de la celda y el foco de
  vuelta en Monto para transcribir en ráfaga.
- Resaltado del ajuste recién creado. **Discrepancia documentada, no resuelta en silencio:** el UX spec dice 1,5 s y
  TC-DDC-062h exige 2 s; se implementa lo que el TC verifica y queda anotado en `CellDetail.tsx`.

**Un defecto REAL del producto, encontrado por un test** (no un test ajustado para pasar): `placementContext` usaba
`Math.abs(delta)` al pesar los meses en el paso a ciclos. Hasta esta feature ningún movimiento era negativo y el valor
absoluto no se notaba; con los ajustes, un −10.000 contaba como +10.000 e inflaba el peso de su mes, pudiendo colocar la
celda en el mes equivocado (TC-DDC-074e).

**El barrido de datos de prueba** (decisión del usuario del 2026-09-15: ajustar el FIXTURE, jamás el resultado esperado).
Se creó `tests/helpers/cuadre.ts` — `celdaCuadrada` y `ajustarCelda`, esta última por la MISMA vía del producto
(`adjustCell`)— y se aplicó a `buildSeedConMontos`, al paso holgado de `seedLedger`, al fixture de ciclos, a
`categories.test.ts` y a las siembras de integración. Para el único escenario que debe NACER descuadrado (TC-CIC-176f) se
sembró por SQL directo (`tests/e2e/helpers/descuadre.ts`), siguiendo el precedente de `closure.ts`.

**Lo que se me escapó, dicho como fue.** `cierre-de-mes.test.ts` no entró en ese barrido y solo salió en la corrida completa,
con 6 rojos. Ninguno era defecto del producto: tres escribían la cifra a pelo (ahora van por la vía real), dos contaban
filas contra cero cuando la siembra ya puebla el mes (ahora contra el estado previo) y uno movía el periodo de un
movimiento sin su fecha. Ese último escondía **un segundo fallo que el mensaje de error no mostraba**: su última aserción
—«ningún movimiento queda en el mes cerrado»— habría pasado a ser falsa aunque el rechazo fuera correcto, porque la siembra
ahora pone siete ahí. Se reescribió como «el mes cerrado conserva exactamente los suyos», que es lo que la prueba quiere
decir. Ninguno de los seis cambió su resultado esperado.

**Pendiente para EP-03, ya detectado:** las rutas `PATCH`/`DELETE` se apoyan en el `kind` persistido y en el cuadre relativo
que este epic deja puestos; TC-DDC-077e y TC-DDC-174f ya están asignados allí.

### EP-03 (2026-09-17) — done
**Runs.** Vitest, suite completa: **91 ficheros, 1.097 passed, exit 0**. Playwright, suite COMPLETA (los doce specs):
**535 passed, exit 0** (3,6 min). `typecheck` y `lint` exit 0. Los **65 TCs declarados** para este epic tienen prueba
etiquetada —barrido de `@aitri-tc` contra el plan—, sin huecos y sin etiquetas adelantadas a EP-04; EP-01 y EP-02 siguen
enteros (cero casos suyos sin cubrir).

**Qué se construyó.**
- `editMovement`, `deleteMovement` y `wouldGoNegative` en `src/domain/adjust.ts` — junto a `adjustCell`, que es la otra vía de
  escritura de esta feature. Van AHÍ y no en `mutations.ts` para no duplicar por tercera vez su `clone` privado y para evitar
  por construcción el ciclo de imports (`adjust` ya depende de `cycles`; `mutations` no).
- `PATCH` y `DELETE /api/v1/movements/{id}`: la ruta deja de ser un tapón `unsupported_operation`. Las dos comparten
  `writeMovement` (transacción con `FOR UPDATE`) y **una sola función traduce los rechazos**, porque si cada puerta tradujera
  por su cuenta acabarían divergiendo — que es justo lo que TC-DDC-326e vigila.
- `movementPatchSchema` (`.strict()`, al menos un campo) y `apiMovementSchema` exportado para poder probarlo de frente.
- Store: `editMovement`/`deleteMovement` corren la MISMA función del dominio que el servidor, y comprueban el cierre antes
  para no lanzar una escritura optimista que volvería rebotada.
- UI: `MovementEditor` (monto, nota, fecha con «Pasará a …» y categoría del mismo tipo), lápiz y papelera en la fila
  reutilizando la confirmación en línea que ya usaba la grilla, aviso de celda negativa, y el mes cerrado en solo lectura.

**TRES defectos REALES del producto, encontrados por pruebas nuevas** (ninguno es un test ajustado para pasar):
1. **El panel se quedaba sin salida por teclado.** Al desmontarse el bloque de edición (guardar, cancelar o confirmar un
   borrado) el foco caía al `body`, y el Escape que cierra el editor se atiende en su CONTENEDOR: dejaba de llegar. Seis
   casos en rojo resultaron ser este único defecto. Es el tercer arreglo de esta misma clase en `BudgetGrid.tsx`.
2. **El orden de validación estaba mal**: se comprobaba el cierre ANTES que el tipo. Un movimiento de bolsillo en un mes
   cerrado respondía «mes cerrado», mandando al usuario a reabrir un mes para hacer algo que tampoco iba a poder hacer.
   Lo declara TC-DDC-328e y lo encontré leyendo el caso ANTES de escribirlo — al revés habría consagrado el orden erróneo.
3. **El editor no bloqueaba un destino cerrado.** El ensayo que habilita «Guardar» corre la mutación del dominio, y el
   dominio no conoce la frontera de cierre: se dejaba guardar y el rechazo llegaba del servidor.

**Una pieza que me faltaba, no un defecto:** `movementPatchSchema` no normalizaba la nota (recortar, vacía→null) aunque el
TRD lo declara. Lo delató TC-DDC-309f al exigir «dos normalizaciones exactas».

**Lo que me equivoqué, dicho como fue.** (a) Anticipé que TC-DDC-362f y TC-DDC-363e fallarían por divergir mi implementación
de lo declarado: **pasaron los dos**; la predicción era mía, no un problema del código. (b) TC-DDC-305f falló y mi premisa
era falsa, no el producto: `buildSeed` deriva los ids del NOMBRE, así que todas las cuentas comparten identificadores de
nodo y «la hoja de B» era también una hoja de A. El aislamiento no vive en ids únicos sino en el filtro por `owner_id`; la
prueba ahora usa un nodo que A realmente no tiene. (c) Una prueba de integración que inventé daba por hecho que mover un
movimiento de categoría dejaría la celda de origen descuadrada: no es así —la cifra viaja con él— y la reescribí para
afirmar lo que el producto hace de verdad.

**Pendiente para EP-04, ya detectado:** `closedPeriodsViolated` ya compara `note`, `date` y `kind`, así que congelar las dos
vías nuevas está puesto; faltan `cellMismatches`/`monthIssues` en la grilla y el Balance, y `closeBlockers` bloqueando el
cierre (422 `unbalanced_cells`).

### EP-04 (2026-09-17) — done
**Runs.** Vitest, suite completa: **96 ficheros, 1.122 passed, exit 0** (65 s). Playwright, suite COMPLETA
(los doce specs, una sola corrida): **549 passed, exit 0** (3,7 min); el spec propio, 66/66. `typecheck` y `lint` exit 0.
Los **37 TCs** del epic tienen prueba etiquetada —barrido de `@aitri-tc` contra el plan— y la feature entera cierra en
**171/171**, sin huecos.

**Qué se construyó** (sobre lo que el punto seguro `2b894c1` ya dejaba puesto: `mismatch.ts`, el 422 `unbalanced_cells`
y el botón con su motivo).
- `tests/unit/diario-de-celda-guardas.test.ts` (nuevo): las guardas estáticas. El workflow de CI se PARSEA (no se
  hace `grep`) para exigir sus cuatro condiciones, y se comprueba además que vitest y Playwright corran en pasos
  DISTINTOS —en el mismo `run`, un fallo de vitest cortaría la corrida y el e2e no llegaría a ejecutarse nunca—.
  El matcher de globs se escribió a mano (12 líneas) en vez de importar `picomatch`, que solo está de forma
  transitiva y sin tipos: importarlo rompe `npm run typecheck`. Lanza ante cualquier sintaxis que no cubra, para no
  devolver un falso negativo en silencio; se verificó contra 8 rutas que discrimina de verdad.
- `tests/integration/backend/diario-de-celda-congelado.test.ts` (nuevo): las cinco de integración, por los handlers
  reales y con sesión real. Los dos casos que importan son los que NO tocan cifras —cambiar solo la nota, solo la
  fecha dentro del mismo mes—, que es justo lo que un guardia por importes deja pasar.
- `descuadrarCelda` en `tests/e2e/helpers/descuadre.ts`: descuadra una celda SIN subir la revisión. La diferencia con
  `seedDescuadrado` es todo el escenario de TC-DDC-217f: si subiera la revisión, el lock optimista detectaría el
  conflicto y el cierre nunca llegaría a pedirse.
- 14 pruebas de pantalla en `tests/e2e/diario-de-celda.spec.ts`.

**UN DEFECTO QUE TUMBABA LA APP ENTERA, heredado del punto seguro.** `2b894c1` se commiteó con Vitest en verde y sin
correr Playwright, y dejó la app muerta al cargar: **React #185, «Maximum update depth exceeded»**. El selector
`blockedBy` de `useClosureStatus` llamaba a `closeBlockers` directamente, y esa función construye un array NUEVO en
cada llamada: `useSyncExternalStore` veía un snapshot distinto en cada comprobación y volvía a renderizar sin fin.
Lo irónico es que el comentario que hay JUSTO ENCIMA de `pendingMemo`, en ese mismo fichero, describe este fallo
palabra por palabra; y el caso vacío ya estaba resuelto con la constante `VACIO` — faltaba la otra mitad, la que se
ejecuta cuando SÍ hay celdas descuadradas. O sea que el bucle solo aparecía con un descuadre real, que es
exactamente lo que este epic introduce. Arreglado con `blockersFor`, el mismo patrón de `WeakMap` que sus vecinos.
Se aisló descartando primero mi propio cambio (`git stash`) y capturando el `pageerror` del navegador, no por
sospecha.

**TRES defectos REALES más, cada uno encontrado por el caso escrito para encontrarlo** (ninguno es un test ajustado
para pasar):
1. **La pestaña vieja se quedaba sin explicación (TC-DDC-217f).** `closeMonth` del store resincronizaba ante un
   `revision_conflict` pero NO ante `unbalanced_cells`: caía al toast genérico «No se pudo cerrar el mes» sin
   traerse el estado real, así que el botón seguía habilitado y el usuario podía repetir el clic indefinidamente
   sin enterarse de por qué. Ahora resincroniza, y `blockedBy` se recalcula solo con las celdas nombradas.
2. **Un mes cerrado seguía mostrando un formulario de edición (TC-DDC-139f, FR-2507).** Si el mes se cerraba con el
   bloque de edición abierto, ese bloque SOBREVIVÍA al cambio: la fila perdía su lápiz y su papelera, pero el campo
   «Monto» y el botón «Guardar» que ya estaban desplegados seguían vivos sobre un mes cerrado. El servidor lo
   rechazaba igual (422), así que nunca corrompió nada; lo que fallaba era la promesa de la pantalla. Arreglado con
   dos líneas de defensa: la guarda `!cerrado` en el render (el efecto corre DESPUÉS del pintado, y ese fotograma
   intermedio ya enseñaba la vía prohibida) y el efecto que retira el estado y devuelve el foco.
3. **El motivo de bloqueo no truncaba (TC-DDC-219e).** `truncate` + `min-w-0` solo encogen cuando la fila ya no
   cabe; con cinco celdas nombradas el motivo crecía y empujaba el historial fuera de la pantalla a 768 px antes de
   recortar un carácter. Se le puso el tope de 320 px que lo obliga a ceder ANTES de estorbar.

**UN DEFECTO AJENO, medido y NO arreglado: `BG-040` (high, abierto).** El control ofrece «Cerrar Enero 2026» y el
servidor, ante esa misma petición, cierra hasta **2026-09**: el usuario cree que cierra un mes y se le congelan
nueve, y FR-2005 solo deja reabrir el último, de uno en uno. Cliente y servidor derivan el mes objetivo de rangos
distintos (el del cliente lo ancla `startMonth`; el del servidor no). Medido de frente —`data-closable` contra el
`closedThrough` que devuelve el POST—, no inferido. **No es de esta feature** (el cableado viene de
`meses-y-saldo-inicial` y `cierre-de-mes`) y **ningún TC lo cubre**: cuál de los dos rangos es el correcto es una
decisión de producto que hay que tomar con el usuario. Salió construyendo TC-DDC-211h, que exige que el botón nombre
el mes correcto; las pruebas de FR-2512 declaran su mes de inicio por la vía real del producto
(`PUT /api/v1/ledger/start`) para que las dos mitades coincidan. **Es `high` y está abierto, así que bloquea el
`verify-complete` de la RAÍZ hasta que se decida.**

**DOS DESVIACIONES DECLARADAS respecto al texto de los TCs** (ninguna cambia lo que el caso garantiza):
1. **Los rótulos llevan el año.** Los TCs escriben «Agosto está cerrado…» y «Septiembre: 2 celdas…»; el producto
   dice «Agosto 2026» y «Septiembre 2026» porque `periodLabel` incluye el año desde `multi-anio` (FR-1905), y la
   feature vecina `techo-de-flujo` ya afirma sobre esa misma franja. El TC lo escribe abreviado; cambiar el producto
   por una prueba habría roto a los vecinos. El triángulo, que usa `cycleMonthLabel`, sí dice «Septiembre» a secas —
   son dos rótulos distintos del producto, y cada uno se afirma como es.
2. **TC-DDC-139f ya no puede pulsar «Guardar».** Su `then` describe un 422 del servidor tras pulsar Guardar con el
   mes recién cerrado. Ese camino dejó de ser alcanzable DESDE EL NAVEGADOR precisamente por el arreglo (2) de
   arriba: el canal de sincronización en vivo (SSE, FR-511) trae el cierre en el acto y el bloque se retira antes de
   que nadie pueda pulsar nada. El `expected_result` del caso —«aviso de mes cerrado y valor 9.000 intacto»— se
   afirma entero, junto con que ninguna escritura prospera; el 422 se exige de frente donde SÍ es alcanzable, que es
   su capa: TC-DDC-135f, TC-DDC-136f y TC-DDC-381h lo piden por la ruta directa, que es la vía que usaría un cliente
   viejo. Se comprobó midiendo, no suponiendo: el panel ya mostraba «Septiembre 2026 está cerrado» en el instante
   del clic.

**Las pruebas se verificaron por MUTACIÓN, no por su color.** Las cinco de integración nacieron verdes, que es
justo cuando hay que desconfiar: se rompieron a propósito los dos guardias de periodo cerrado
(`diffMovements` y la comprobación de origen de `updateMovement`) y TC-DDC-135f y TC-DDC-136f se pusieron rojos, cada
uno por su puerta —el PATCH y el PUT—; con un solo guardia roto seguían verdes, que es la defensa en profundidad
que el código ya documenta. El código se restauró desde copia y se confirmó `git status` limpio antes de seguir.

**Lo que me equivoqué, dicho como fue.** Las 14 de pantalla salieron rojas en bloque la primera vez y tardé dos
vueltas en aceptar que el escenario, no el producto, era lo que fallaba: di por hecho que el rango activo del ledger
lo fijaban los datos sembrados, y lo fija el `startMonth` declarado de la cuenta e2e (2026-01). Hasta que no lo
MEDÍ —imprimiendo `startMonth`, `closure` y `data-closable`— estuve corrigiendo síntomas. Lo mismo con la celda
«que no aparecía»: mientras el editor está abierto la grilla pinta ahí el editor y el nodo `[data-cell]` de ese mes
no existe; se vio listando los `data-month` presentes en el DOM, no razonando sobre el componente.
