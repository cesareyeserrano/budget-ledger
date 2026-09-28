# BUILD_PLAN — carril-de-presupuesto

Plan de la primera generación (2026-09-27). Dos epics: la regla (dominio y servidor) y lo que se ve en la
grilla. La segunda depende de la primera: el editor Pres. solo puede rechazar si el dominio ya bloquea.

## EP-01 — El plan calcula y bloquea en su propio carril   [status: done]
  Delivers:    US-2901, US-2902, US-2903, US-2904, US-2906
  FRs:         FR-2901, FR-2902, FR-2903, FR-2904, FR-2906
  Makes pass:  TC-CDP-001h, TC-CDP-002h, TC-CDP-003e, TC-CDP-004f,
               TC-CDP-010h, TC-CDP-011e, TC-CDP-012f, TC-CDP-013e,
               TC-CDP-020h, TC-CDP-021h, TC-CDP-022f, TC-CDP-023e, TC-CDP-024e,
               TC-CDP-030h, TC-CDP-031f, TC-CDP-032e, TC-CDP-033f, TC-CDP-034e, TC-CDP-035f, TC-CDP-036e,
               TC-CDP-060h, TC-CDP-061f, TC-CDP-062f, TC-CDP-063e, TC-CDP-064e,
               TC-CDP-101h, TC-CDP-102e, TC-CDP-103f, TC-CDP-111h, TC-CDP-112f, TC-CDP-113e,
               TC-CDP-121h, TC-CDP-122e, TC-CDP-123f, TC-CDP-131h, TC-CDP-132f, TC-CDP-133e,
               TC-CDP-141h, TC-CDP-142e, TC-CDP-143f, TC-CDP-151h, TC-CDP-152e, TC-CDP-153f,
               TC-CDP-161h, TC-CDP-162f, TC-CDP-163e, TC-CDP-171h, TC-CDP-172e, TC-CDP-173f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    todo lo demás lee estas funciones; sin la regla, la pantalla no tiene qué mostrar.

Orden interno:
1. Capturar con el código SIN cambiar (795ca8a) la serie Ejec. y el impacto de reapertura de los fixtures
   `tests/fixtures/carril-base.json` y `carril-desvio.json`. Si se capturan después, no prueban nada.
2. Escribir `tests/domain/carril-de-presupuesto.test.ts` y
   `tests/integration/backend/carril-de-presupuesto.test.ts`. Los TCs de la regla nueva deben fallar contra
   el código viejo; los de regresión, pasar.
3. Cambiar `computeBalanceSeries`, `techoScanRaw`, `chainedAporteSlack`, `chainCheck`, `monthIssues` y
   `worsenedBy`. Commit propio: su SHA es el ancla nueva de TC-CDM-222f.
4. Reescribir las pruebas de otras features que fijan la regla vieja (TC-BAL-915e, FR-1008, NFR-2805 y el
   ancla de TC-CDM-222f), citando la regla que las sustituye.

## EP-02 — La grilla del plan se comporta como la de lo real   [status: done]
  Delivers:    US-2905
  FRs:         FR-2905
  Makes pass:  TC-CDP-005e, TC-CDP-040h, TC-CDP-041h, TC-CDP-042f, TC-CDP-043h, TC-CDP-044e, TC-CDP-045e,
               TC-CDP-046e, TC-CDP-047e, TC-CDP-048e, TC-CDP-049e, TC-CDP-050e
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    usa el bloqueo de EP-01; retira el aviso ámbar y pinta el problema del plan en el mes.

## Evidencia
- 2026-09-27, EP-01. Capturas de `carril-base.json` y `carril-desvio.json` tomadas sobre 795ca8a con `src/`
  sin tocar. Los 39 TCs de dominio escritos antes del cambio: contra el código viejo fallaron los 18 de la
  regla nueva y pasaron los 21 de regresión.
- 5eacb9c: cambio de regla (balance.ts, reserve.ts, guard.ts) y, para no romper el `next dev` del usuario
  que recarga este código, también la parte de pantalla (ReserveCells, BudgetGrid, BalanceModule).
  Pruebas de otras features reescritas: TC-BAL-915e/906h/906f, TC-TRF4-008h/008f, TC-RPG-141h/142f/143e/
  181h/182f/183e, TC-TDF-093e, TC-RSP-031e, TC-MAN-210h/211e, TC-CIC-100h, TC-SFU-103f y los asserts de
  conservación de tres ficheros.
- b9c0230: anclas de TC-CDM-202e/222f y TC-RES-032e/202e avanzadas a 5eacb9c con la razón escrita.
- Proyecto app 895/895; proyecto backend 423/423 (incluye los 10 TCs de integración de la feature);
  typecheck y lint limpios.
- 2026-09-27, EP-02. `tests/e2e/carril-de-presupuesto.spec.ts`: 12/12. 708d34c: además, `seedLedger` infla
  también el ingreso planeado en su paso holgado (el plan ya bloquea), TC-TRF4-008e/156f afirman el
  triángulo del mes en vez del «!» ámbar, y ciclos.spec usa `getByLabel("Mes", { exact: true })` y compara
  la cabecera de TC-CIC-064f sin el triángulo del plan (ese estado reserva 70.124.800 sobre 42.579.500).
- e2e completa por `e2e.sh`: 592 pasan y 1 inestable ajeno (TC-REC-029h, pasa al reintentar), exit 0.
- typecheck 0 errores, lint limpio. Se corrió con el Mac en batería: el gate coverage puede fallar por
  tiempo en verify-run (ver memoria verify-sin-bajo-consumo).
