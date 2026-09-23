# BUILD_PLAN — fecha-de-comentario

Plan de la fase 4, escrito el 2026-09-22 sobre las fases 1, UX, 2 y 3 re-aprobadas ese día (422 `invalid_payload`).
Es la primera generación del plan.

## EP-01 — El día se guarda y viaja   [status: done]
  Delivers:    US-2601
  FRs:         FR-2601
  Makes pass:  TC-FDC-001h, TC-FDC-002e, TC-FDC-003e, TC-FDC-004h, TC-FDC-006f, TC-FDC-007e, TC-FDC-008f,
               TC-FDC-009f, TC-FDC-010e, TC-FDC-060h, TC-FDC-061e, TC-FDC-062f, TC-FDC-070h, TC-FDC-072f,
               TC-FDC-081f, TC-FDC-082e, TC-FDC-100h, TC-FDC-101f, TC-FDC-102e, TC-FDC-110h, TC-FDC-111f,
               TC-FDC-112f, TC-FDC-113f, TC-FDC-114e, TC-FDC-115f, TC-FDC-116f
  Build steps: skeleton (localDay, isCalendarDay, CellNote.date, addCellNote con día, store) →
               persistence (migración 0010, schema drizzle, ledgerRepo, apiCellNotes y cellNotesSchema) →
               hardening (validación 422, ida y vuelta, relocalización de ciclos, mes cerrado)
  Why here:    sin el día guardado no hay nada que mostrar ni que ordenar; aquí vive el riesgo alto del TRD
               (zod descarta `date` si no se declara en los dos esquemas)

## EP-02 — El día se ve y ordena la lista   [status: done]
  Delivers:    US-2602, US-2603
  FRs:         FR-2602, FR-2603
  Makes pass:  TC-FDC-005h, TC-FDC-020h, TC-FDC-021e, TC-FDC-022e, TC-FDC-023f, TC-FDC-024h, TC-FDC-025e,
               TC-FDC-026e, TC-FDC-027h, TC-FDC-028e, TC-FDC-029f, TC-FDC-030e, TC-FDC-040h, TC-FDC-041e,
               TC-FDC-042e, TC-FDC-043f, TC-FDC-044f, TC-FDC-045e, TC-FDC-046h, TC-FDC-047h, TC-FDC-071e,
               TC-FDC-080h, TC-FDC-090h, TC-FDC-091e, TC-FDC-092f
  Build steps: skeleton (orden en cellDetail) → integrations (columna detail-date en DetailRow) →
               hardening (alineación 44 px, estados de carga/error/vacío, e2e con reloj y zona fijados)
  Why here:    usa el `date` que deja EP-01; el orden es dominio puro y la fila solo pinta lo que el
               dominio entrega

## Evidencia por epic

### EP-01 — cerrado el 2026-09-22
- `npx vitest run --project app tests/domain/fecha-de-comentario.test.ts`: 7/7 (001h, 002e, 003e, 009f, 070h, 102e, 114e).
- `npx vitest run --project backend tests/integration/backend/fecha-de-comentario.test.ts`: 19/19 (004h, 006f, 007e, 008f,
  010e, 060h, 061e, 062f, 072f, 081f, 082e, 100h, 101f, 110h, 111f, 112f, 113f, 115f, 116f).
- Suite completa (`./unit.sh`): 99 ficheros, 1158 tests, exit 0. `npm run typecheck` y `npm run lint` limpios.
- Mutaciones a mano: sin `date` en `apiCellNotes` → 11 de 19 en rojo (incluido 010e); `localDay` con
  `toISOString` → 002e y 003e en rojo. Restaurado.
- Desvío de implementación (no de spec): `isCalendarDay` vive en `src/domain/validation.ts` y no en `cycles.ts`,
  porque `cycles` importa `reserve` y `reserve` necesita la validación: en `cycles` habría ciclo de imports.
  `todayISO()` sin zona delega en `localDay` para no duplicar el cálculo del día local.
- Deuda a declarar: `addCellNote(…, day?)` lleva el día OPCIONAL para no reescribir suites de otras features
  (techo-de-flujo está protegida por TC-RES-202e); la app lo pasa siempre desde el store.

### EP-02 — cerrado el 2026-09-22
- `npx vitest run --project app tests/domain/fecha-de-comentario.test.ts`: 17/17 (los 7 de EP-01 más 040h, 041e,
  042e, 043f, 044f, 045e, 046h, 090h, 091e, 092f).
- `npx playwright test tests/e2e/fecha-de-comentario.spec.ts`: 005h, 020h, 021e, 022e, 023f, 024h, 025e (768 y 1440),
  026e, 027h (claro y oscuro), 028e, 029f, 030e, 047h, 071e, 080h en verde.
- Regresión: `./unit.sh` 99 ficheros / 1168 tests exit 0; `./e2e.sh` 581 passed exit 0 (3,9 min); typecheck y lint limpios.
- Corrección de upstream (decisión del usuario): TC-FDC-029f pedía que un 422 resincronizara y quitara el comentario;
  el manejo vigente —que el UX manda no cambiar— muestra `storage-banner` y deja los datos en pantalla. Se reabrió
  la fase 3 solo para ese TC y se re-aprobó; el conjunto de TCs no cambió.
- TC-DDC-151h (diario-de-celda) pasa de «sin detail-date» a «detail-date vacío» por FR-2602: declarado en
  technical_debt.
