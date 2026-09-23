# BUILD_PLAN — cierre-coherente

Plan de la fase 4, escrito el 2026-09-22. Primera generación.

## EP-01 — El cierre ancla en el mes de inicio declarado   [status: done]
  Delivers:    US-2701, US-2702, US-2703
  FRs:         FR-2701, FR-2702, FR-2703
  Makes pass:  TC-CCO-001h, TC-CCO-002e, TC-CCO-003e, TC-CCO-004f, TC-CCO-005f, TC-CCO-020h, TC-CCO-021h,
               TC-CCO-022e, TC-CCO-023f, TC-CCO-040h, TC-CCO-041e, TC-CCO-042f, TC-CCO-060h, TC-CCO-061e,
               TC-CCO-062f, TC-CCO-070h, TC-CCO-071e, TC-CCO-072f, TC-CCO-080h, TC-CCO-081e, TC-CCO-082f,
               TC-CCO-090h, TC-CCO-091e, TC-CCO-092f, TC-CCO-100h, TC-CCO-101e, TC-CCO-102f, TC-CCO-110f,
               TC-CCO-111h, TC-CCO-112e
  Build steps: skeleton (closureScope sobre serverScope) → integrations (startMonth en el estado de
               closeMonthFor y reopenMonthFor; las dos pasan closureScope) → hardening (regresiones del
               cierre, la reapertura y el congelado)
  Why here:    epic único — la feature es un cambio de lógica acotado al borde del cierre; partirlo en dos
               dejaría media corrección sin efecto observable

## Evidencia por epic

### EP-01 — cerrado el 2026-09-22
- `npx vitest run --project backend tests/integration/backend/cierre-coherente.test.ts`: 30/30.
- Regresión: `./unit.sh` 100 ficheros / 1198 tests exit 0; `./e2e.sh` 580 passed exit 0 (1 flaky en
  recuperar-acceso, ajeno al cambio, verde al reintentar). typecheck y lint limpios.
- Dos correcciones durante el epic: (1) `closureScope` tomaba el suelo de `extra` (el mes en curso) y con un
  inicio declarado en el futuro dejaba cerrable octubre — lo cazó TC-CCO-023f; (2) ocho e2e de cierre de
  diario-de-celda daban por cerrado Agosto porque el servidor ignoraba el inicio declarado: su siembra ahora
  declara el inicio donde empiezan sus datos (declarado en technical_debt).
