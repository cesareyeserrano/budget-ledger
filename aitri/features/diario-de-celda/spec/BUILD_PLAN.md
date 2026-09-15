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

## EP-01 — Ver el Detalle de la celda   [status: done]
  Delivers:    US-2501, US-2508, US-2509
  FRs:         FR-2501, FR-2508, FR-2509
  Makes pass:  TC-DDC-001h, TC-DDC-002h, TC-DDC-003e, TC-DDC-004f, TC-DDC-005f, TC-DDC-006e, TC-DDC-007e, TC-DDC-008e, TC-DDC-010e, TC-DDC-011e, TC-DDC-151h, TC-DDC-152h, TC-DDC-153e, TC-DDC-154e, TC-DDC-155f, TC-DDC-156f, TC-DDC-158e, TC-DDC-159e, TC-DDC-171h, TC-DDC-172e, TC-DDC-175f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Superficie de solo lectura (`cellDetail`, `displayAmount`, `CellDetail`, `DetailRow`) más los textos de FR-2509 y su test estructural. No cambia el servidor ni el esquema, y las acciones de los epics siguientes se montan dentro de este panel. Incluye el renombre del aviso de mes cerrado y el ajuste de `cierre-de-mes.spec.ts:159`.

## EP-02 — Añadir un movimiento y teclear un ajuste   [status: pending]
  Delivers:    US-2502, US-2503, US-2504
  FRs:         FR-2502, FR-2503, FR-2504
  Makes pass:  TC-DDC-021h, TC-DDC-022h, TC-DDC-023e, TC-DDC-024e, TC-DDC-025f, TC-DDC-026f, TC-DDC-027f, TC-DDC-028f, TC-DDC-029e, TC-DDC-030e, TC-DDC-031f, TC-DDC-041h, TC-DDC-042h, TC-DDC-043e, TC-DDC-044e, TC-DDC-045e, TC-DDC-046e, TC-DDC-047f, TC-DDC-048f, TC-DDC-049f, TC-DDC-061h, TC-DDC-062h, TC-DDC-063e, TC-DDC-064e, TC-DDC-065e, TC-DDC-066e, TC-DDC-067e, TC-DDC-068f, TC-DDC-069f, TC-DDC-070f, TC-DDC-071e, TC-DDC-072f, TC-DDC-073f, TC-DDC-074e, TC-DDC-075e, TC-DDC-076e, TC-DDC-077e, TC-DDC-009e, TC-DDC-341h, TC-DDC-342f, TC-DDC-343e, TC-DDC-344e, TC-DDC-345e, TC-DDC-351h, TC-DDC-352e, TC-DDC-353f, TC-DDC-371h, TC-DDC-372e, TC-DDC-373f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Introduce lo que todo lo demás necesita: migración `0009` (`kind` + CHECK), mapeo de `kind` en las cuatro lecturas y reescrituras del snapshot, `apiMovementSchema` con ajustes negativos, `proposedDate`/`isDateInPeriod`, `adjustCell`/`movementSum` y el cuadre relativo del PUT. Como ese cuadre rechaza siembras con Ejecutado sin movimientos, AQUÍ se arreglan los datos de prueba (decisión del usuario del 2026-09-15, NFR-2507): `buildSeedConMontos`, el paso holgado de `seedLedger`, `tests/fixtures/ciclos-usuario.ts` y las siembras de integración listadas en `03_TEST_CASES.json#test_plan.strategy`, siempre ajustando el fixture y nunca el resultado esperado. TCs NFR alojados aquí: NFR-2503 (bolsillos), NFR-2504 («Nuevo movimiento» sin cambios), NFR-2506 (Presupuestado sin cambios).

## EP-03 — Editar y borrar movimientos   [status: pending]
  Delivers:    US-2505, US-2506
  FRs:         FR-2505, FR-2506
  Makes pass:  TC-DDC-081h, TC-DDC-082h, TC-DDC-083h, TC-DDC-084e, TC-DDC-085e, TC-DDC-086e, TC-DDC-087e, TC-DDC-088f, TC-DDC-089f, TC-DDC-090f, TC-DDC-091f, TC-DDC-092f, TC-DDC-093f, TC-DDC-094f, TC-DDC-095h, TC-DDC-096e, TC-DDC-097f, TC-DDC-098e, TC-DDC-099e, TC-DDC-100f, TC-DDC-101f, TC-DDC-103e, TC-DDC-174f, TC-DDC-111h, TC-DDC-112h, TC-DDC-113e, TC-DDC-114e, TC-DDC-115e, TC-DDC-116f, TC-DDC-117f, TC-DDC-118f, TC-DDC-119f, TC-DDC-120f, TC-DDC-121e, TC-DDC-122f, TC-DDC-123f, TC-DDC-301h, TC-DDC-302f, TC-DDC-303f, TC-DDC-304f, TC-DDC-305f, TC-DDC-306f, TC-DDC-307e, TC-DDC-308f, TC-DDC-309f, TC-DDC-310e, TC-DDC-311e, TC-DDC-312f, TC-DDC-328e, TC-DDC-321h, TC-DDC-322e, TC-DDC-323f, TC-DDC-324f, TC-DDC-325e, TC-DDC-326e, TC-DDC-327e, TC-DDC-361h, TC-DDC-362f, TC-DDC-363e, TC-DDC-364e, TC-DDC-391h, TC-DDC-392e, TC-DDC-393f, TC-DDC-394e
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Las rutas nuevas `PATCH` y `DELETE /api/v1/movements/{id}` (transacción con `FOR UPDATE`, 404 por dueño, `negative_cell`, `invalid_target`) y `editMovement`/`deleteMovement`/`wouldGoNegative` se apoyan en el `kind` persistido y en el cuadre relativo de EP-02. Con todas las vías de escritura ya existentes se cierran aquí sus NFRs transversales: NFR-2501 (seguridad), NFR-2502 (no empeora), NFR-2505 (techo y piso) y NFR-2508 (registro vía `withApi`).

## EP-04 — Cierre y descuadres   [status: pending]
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
