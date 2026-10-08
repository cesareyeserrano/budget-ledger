# BUILD_PLAN — impacto-movil

Plan de construcción de la fase 4. Generación 1 (8-oct-2026). Archivo de trabajo: nada lo valida.
Runner: `../../../unit.sh`; e2e con `../../../e2e.sh`. Libro de ejemplo: `tests/fixtures/gmv-base.ts`.

Es un incremento chico: una épica, sin fronteras intermedias.

## EP-01 — El aviso de impacto en el teléfono   [status: done]
  Delivers:    US-3301, US-3302, US-3303, US-3304
  FRs:         FR-3301, FR-3302, FR-3303, FR-3304, NFR-3301, NFR-3302, NFR-3303, NFR-3304
  Makes pass:  TC-IMV-001h, 002h, 003f, 004e, 005h, 010h, 011f, 012e, 013e, 020h, 021e, 022f, 023f, 024e, 030h,
               031f, 032f, 033e, 034e, 040h, 041e, 042f, 045h, 046e, 047f, 050h, 051e, 052f, 055h, 056e, 057f
  Build steps: skeleton (`ImpactCard` leyendo `useDownstreamImpact`) → integraciones (estado plegado en
               `MobileBudget`, montaje en la lista y, por la prop `notice`, en `LeafScreen`) → hardening (cifras de
               nueve dígitos, marca de roto, pie igual al de escritorio)
  Why here:    es todo el incremento.

## Bitácora
### EP-01 — hecha el 8-oct-2026
Resultado: 31/31 en verde. Unit: TC-IMV-056e, 057f. Integración (jsdom): 002h, 003f, 004e, 010h, 011f, 013e, 023f,
024e, 030h, 031f, 032f, 033e, 034e, 042f, 045h, 046e, 050h, 051e, 052f, 055h. Navegador: 001h, 005h, 012e, 020h, 021e,
022f, 040h, 041e, 047f — `9 passed (25.1s)`.
Suite completa (`unit.sh`, Node 22): 1.828 de 1.828. Typecheck, lint y design-tokens en verde.
Código: `ImpactCard` nuevo; `MobileBudget` guarda el plegado y lo monta en la lista y en el detalle; `LeafScreen`
acepta `notice`. Sin cambios en el store, el dominio ni escritorio.
Notas: las cifras llevan «$» (money, como escritorio); los horizontes válidos son 1 y 2; la tarjeta de resumen va en
un envoltorio sin id, así que TC-IMV-032f y 045h la nombran por lo que contiene.
