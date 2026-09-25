# BUILD_PLAN — retirar-para-gastar

Plan de la primera generación (2026-09-25). Una sola epic: la feature es una línea de regla y sus pruebas.

## EP-01 — El techo de Ejecutado se consume en neto   [status: done]
  Delivers:    US-2801, US-2802, US-2803, US-2804, US-2805, US-2806, US-2807
  FRs:         FR-2801, FR-2802, FR-2803, FR-2804, FR-2805, FR-2806, FR-2807
  Makes pass:  TC-RPG-001h, TC-RPG-002f, TC-RPG-003e, TC-RPG-004e, TC-RPG-005e, TC-RPG-006e,
               TC-RPG-021h, TC-RPG-022f, TC-RPG-023e, TC-RPG-024e, TC-RPG-025f,
               TC-RPG-031h, TC-RPG-032f, TC-RPG-033e, TC-RPG-041h, TC-RPG-042f, TC-RPG-043e,
               TC-RPG-051f, TC-RPG-052h, TC-RPG-053e, TC-RPG-061h, TC-RPG-062f, TC-RPG-063e,
               TC-RPG-071h, TC-RPG-072f, TC-RPG-073f, TC-RPG-074e, TC-RPG-075h,
               TC-RPG-101h, TC-RPG-102f, TC-RPG-103e, TC-RPG-111f, TC-RPG-112f, TC-RPG-113h, TC-RPG-114e,
               TC-RPG-121h, TC-RPG-122e, TC-RPG-123f, TC-RPG-131f, TC-RPG-132h, TC-RPG-133e,
               TC-RPG-141h, TC-RPG-142f, TC-RPG-143e, TC-RPG-151f, TC-RPG-152h, TC-RPG-153e,
               TC-RPG-161f, TC-RPG-162h, TC-RPG-163e, TC-RPG-171f, TC-RPG-172h, TC-RPG-173e,
               TC-RPG-181h, TC-RPG-182f, TC-RPG-183e
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    es la única epic; el orden interno sí importa (abajo).

Orden interno:
1. Capturar con el código SIN cambiar las líneas base de TC-RPG-121h (Balance) y TC-RPG-141h/143e
   (plano Presupuestado) en `tests/fixtures/`. Si se capturan después del cambio, no prueban nada.
2. Escribir `tests/domain/retirar-para-gastar.test.ts` y `tests/integration/backend/retirar-para-gastar.test.ts`.
   Los TCs de la regla nueva tienen que fallar contra el código viejo (prueba de que muerden).
3. Cambiar la línea de `techoScanRaw` y los comentarios que describen la regla vieja (reserve.ts,
   Register.tsx). Commit propio: su SHA es el ancla nueva de TC-CDM-222f.
4. Reescribir las 7 pruebas que fijan la regla vieja (ADR-03/04/05 del TRD).
5. Correr unit.sh, typecheck y lint; después `aitri feature verify-run`.

## Evidencia
- 2026-09-25: los 56 TCs escritos. Contra el código viejo fallaron los de la regla nueva y pasaron los de regresión.
- d22b1b0: cambio de regla. 0684671 y cbfd3f5: las 8 pruebas que fijaban la regla vieja, reescritas y con anclas avanzadas.
- unit.sh completo: 1261/1261 (EXIT 0). Tras reabrir fases 1-3 por NFR-2806, TC-RPG-152h añadido: dominio 45/45, integración 11/11.
- typecheck 0 errores, lint limpio.
