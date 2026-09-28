# BUILD_PLAN — saldo-de-bolsillo

Plan NUEVO (segunda generación, 2026-09-27). La decisión final del usuario sobre BL-041 reabrió la Fase 1:
la grilla vuelve a mostrar lo del mes, y el formulario de «Retiros del mes» de Ejec. pasa a Pres. Las épicas de
la primera generación (saldos en la celda, commit d738813) quedan sustituidas. Sus ids no se reutilizan con
otro contenido: las de esta generación empiezan de nuevo en EP-01.

## EP-01 — Dominio y servidor: retiro planeado por alcancía, y la celda vuelve al aporte   [status: done]
  Delivers:    US-3002, US-3003, US-3004, US-3006, US-3008
  FRs:         FR-3002, FR-3003, FR-3004, FR-3006, FR-3008
  Makes pass:  TC-SDB-006e, 010h, 011f, 012e, 013f, 014h, 015h, 016f, 017f, 018e, 020e, 021f, 030h, 031h,
               032f, 033e, 034h, 035f, 042h, 043f, 050h, 051h, 052e, 053f, 054h, 055e, 056f, 070f, 071h,
               072e, 073e, 101h, 102e, 103f, 111h, 112e, 113f, 121h, 122f, 123e, 131h, 132f, 151h, 152e,
               153f, 161h, 162e, 163f
  Build steps:
  - skeleton: retirar `reserveCellTarget`, `cellTargetMax`, `subtreeReserveBalance`, `CELDA_NOTE`,
    `setPlannedRetiro` y `applyReserveTarget`; `maxWithdrawal` con `plane`; `planRetiro`,
    `editPlannedRetiro` y `plannedRetiroRows`.
  - persistence/integrations: notas `@retiros:*` en `cell_note`, y mutaciones que mueven y borran la fila y
    sus notas.
  - hardening: la propiedad a escala y las capturas del Balance.
  Why here:    la pantalla solo llama a estas funciones; y retirar el modo saldo primero hace que el
               compilador señale cada llamada que queda.

## EP-02 — Pantalla: el formulario de planear y la grilla de aportes   [status: done]
  Delivers:    US-3001 (y la cara visible de US-3002/3003/3004)
  FRs:         FR-3001, FR-3002, FR-3003, FR-3004
  Makes pass:  TC-SDB-001h, 002h, 003f, 004f, 005e, 007e, 008e, 009e, 019h, 036h, 037f, 038e, 039e, 040h,
               041e, 044e, 045e, 114e, 133e, 134f, 141h, 142e, 143f, 144h, 145e
  Build steps:
  - skeleton: `WithdrawCell` con `plane` y `closed`, `PlanRow`, y `ReserveLeafCell`, el editor y las filas de
    grupo y tipo vueltos al aporte.
  - persistence/integrations: las acciones del store `planWithdrawal` y `editPlannedWithdrawal`.
  - hardening: devolver a su aserción de aporte las pruebas de otras features que d738813 cambió
    (TC-TRF4-002h/002e/014f/015e, TC-TDF-072f, TC-SFU-104h).
  Why here:    pinta lo que EP-01 calcula.

## Evidencia
- EP-01:
  - Dominio: 37/37 (`vitest --project app tests/domain/saldo-de-bolsillo.test.ts`).
  - Servidor: 11/11 contra Postgres (`saldo-de-bolsillo.test.ts` + `-fallo.test.ts`).
  - Proyecto app completo: 932/932.
  - Typecheck y lint limpios.
  - `setPlannedRetiro` se conserva como legado en el dominio (declarado en technical_debt).
- EP-02:
  - Primera corrida de las e2e de esta feature más transferencias, techo-de-flujo y servidor-fuente-unica:
    81/83. Los dos fallos eran de las pruebas:
    - TC-SDB-114e esperaba «150», pero la celda Ejec. pinta «››150».
    - TC-TRF4-015e buscaba «Retiro planeado» por subcadena y encontraba la etiqueta de la lista nueva.
    Corregidas.
  - Segunda corrida (saldo-de-bolsillo + transferencias): 37 pasaron y 2 inestables (TC-SDB-142e,
    TC-SDB-144h), con carga 4 y 15 min de duración. Se descartó como degradada.
  - Repetidas 4 veces cada una sin reintentos: 8/8.
  - Revertidas a 434a89b: techo-de-flujo.spec.ts y servidor-fuente-unica.spec.ts.
  - En transferencias.spec.ts:
    - TC-TRF4-002h/002e vuelven al aporte.
    - TC-TRF4-015e ahora abre el formulario de planear y comprueba que bajar el aporte que respalda un retiro
      planeado se bloquea.
