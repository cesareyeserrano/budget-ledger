# BUILD_PLAN — feature backend

> Archivo de trabajo (no es artefacto del pipeline; nada lo valida). Estado de ejecución epic-por-epic.
> Naturaleza: cambio a un codebase EXISTENTE. El código nuevo vive en la raíz `src/server/**`,
> `src/data/serverRepository.ts`, `src/app/api/**`; los tests en `tests/{unit,integration,e2e}`.
> El dominio `src/domain/**` NO se toca (guardrail NFR-507).

## Entorno verificado
- Node 24, npm 11. Docker 29 + compose v5 con daemon CORRIENDO (Postgres de tests vía contenedor efímero).
- vitest (unit+integration) + Playwright (e2e) ya configurados. Coverage gate sobre `src/domain/**` + `src/data/**` (se extiende a `src/server/**`).
- App en 3100 (dev) / 3110 (prod) — NUNCA 3000. Playwright arranca en 3220.
- Deps nuevas a instalar: `better-auth`, `drizzle-orm`, `postgres`, `@node-rs/argon2`; dev: `drizzle-kit`, `testcontainers` (Postgres efímero para integration).

## Orden y dependencias
Cimientos de datos → auth (necesita las tablas) → API (necesita auth+datos) → cliente/sync (consume la API) → regresión/CI/contenedores/endurecimiento (envuelve todo). Cada epic incluye ESCRIBIR sus tests y dejarlos verdes antes de marcar `done`.

---

## Epic 1 — Cimientos: config, esquema Drizzle, capa de datos   [status: done]
  Evidencia: 11/11 TCs automatizables verdes (TC-BE-041e queda manual). vitest --project backend:
  021h,022e,023f,040h,059h,061f,042f,060e,074h,075e,076f ✓. Suite completa 97/97, typecheck+lint 0.
  Deps: better-auth, drizzle-orm, postgres, @node-rs/argon2, drizzle-kit, testcontainers, @testing-library/dom (restaurada).
  Delivers:    US-506, US-512
  FRs:         FR-506, FR-512 · NFR-505, NFR-510
  Makes pass:  TC-BE-021h, TC-BE-022e, TC-BE-023f, TC-BE-040h, TC-BE-041e, TC-BE-042f, TC-BE-059h, TC-BE-060e, TC-BE-061f, TC-BE-074h, TC-BE-075e, TC-BE-076f
  Build steps: skeleton (`src/server/env.ts` fail-fast, `src/server/db/schema.ts`, `drizzle.config.ts`) → persistence (migraciones, `src/server/db/client.ts`, `src/server/data/ledgerRepo.ts` con firma `(ownerId, …)`, snapshot replace transaccional + bump revision) → hardening (constraints/CHECK, docker-compose `db` con volumen `pgdata`, harness de Postgres efímero para integration)
  Why here:    todo lo demás persiste o lee de aquí; sin el esquema y la capa de datos con ownerId no hay auth ni API.

## Epic 2 — Autenticación (email+contraseña + Google) y sesión   [status: done]
  Evidencia: 16/16 TCs automatizables verdes (006h,007e Google happy → manual). auth.test.ts 14 ✓,
  oauth.test.ts 2 ✓. Suite completa 113/113, typecheck+lint 0. Better Auth + argon2id ($argon2id$
  verificado), sesiones en BD, logout invalida, rate-limit 429 tras 5. Fix: backend project corre en
  serie (fileParallelism:false + singleFork) — comparten un Postgres y truncan en beforeEach.
  Delivers:    US-501, US-502, US-503
  FRs:         FR-501, FR-502, FR-503 · NFR-501 (parcial), NFR-512 (parcial)
  Makes pass:  TC-BE-001h, TC-BE-002f, TC-BE-003f, TC-BE-004e, TC-BE-005f, TC-BE-006h, TC-BE-007e, TC-BE-008f, TC-BE-009f, TC-BE-010h, TC-BE-011f, TC-BE-012f, TC-BE-013e, TC-BE-046h, TC-BE-047f, TC-BE-048f, TC-BE-080h, TC-BE-081f
  Build steps: skeleton (Better Auth config, adapter Drizzle, montaje `/api/auth/[...all]`) → integrations (hook argon2id, provider Google, sesiones en BD, rate limit login) → hardening (logout invalida en BD, cookie HttpOnly/Secure/SameSite, error 401 genérico sin enumeración)
  Why here:    la API filtra por el userId de la sesión; sin auth no hay ownerId real. (Google happy 006h/007e → manual con evidencia.)

## Epic 3 — Superficie API /api/v1 + withApi (gating, aislamiento, log, headers)   [status: done]
  Evidencia: 20/20 TCs verdes (api.test.ts). Suite completa 133/133, typecheck+lint 0. withApi
  concentra auth+Zod+log+Origin; rutas ledger (GET/PUT 204/409), movements (GET/POST/GET:id/404),
  /health público. Headers HSTS+CSP+nosniff en next.config. Route handlers probados en proceso con
  cookies reales. Fix de test: mockRestore borra mock.calls → capturar líneas de log localmente.
  Delivers:    US-504, US-505, US-507
  FRs:         FR-504, FR-505, FR-507 · NFR-502, NFR-504, NFR-512 (headers/CORS), NFR-501 (secretos), NFR-511 (sin sesión no lee)
  Makes pass:  TC-BE-014h, TC-BE-015f, TC-BE-016e, TC-BE-017h, TC-BE-018f, TC-BE-019f, TC-BE-020e, TC-BE-024h, TC-BE-025e, TC-BE-026f, TC-BE-049e, TC-BE-050h, TC-BE-051e, TC-BE-052f, TC-BE-056h, TC-BE-057e, TC-BE-058f, TC-BE-079f, TC-BE-082e, TC-BE-083f
  Build steps: skeleton (`withApi()` — auth+Zod+log+Origin+errores; rutas `GET/PUT /api/v1/ledger`, `GET/POST/GET:id /api/v1/movements`, `GET /health`) → integrations (aislamiento por ownerId de la sesión; validación Zod compartida; 409 por revision) → hardening (headers HSTS/nosniff/CSP en next.config, CORS allowlist, verificación de secretos fuera del bundle)
  Why here:    es el contrato que el cliente consume; necesita auth (Epic 2) y datos (Epic 1).

## Epic 4 — Cliente: ServerRepository, split localStorage, seed, sync en vivo   [status: done]
  Evidencia: 16/16 verde. Core vitest 027h,028e,029f,039e (repo-sync.test.ts). E2E backend 12/12 en
  48.5s, 0 flaky (auth-flow 043h,044e,045f,032f · storage-split 030h,031e · cross-device 033h,034e,035f
  · live-sync 036h,037f,038e). Decisión: flag NEXT_PUBLIC_LEDGER_SERVER_MODE (off=localStorage, suite
  existente intacta). Harness Playwright separado: build de prod + Postgres testcontainers.
  FIXES: (1) next build valida firmas de route handlers → wrappers explícitos por ruta; (2) env() no
  aborta build sin Google (portabilidad, warn); (3) rate limit por IP hacía flaky el e2e (todo desde
  127.0.0.1) → LEDGER_RATE_LIMIT_DISABLED solo en harness (prod activo, verificado en 081f).
  Delivers:    US-508, US-509, US-510, US-511, US-513
  FRs:         FR-508, FR-509, FR-510, FR-511, FR-513
  Makes pass:  TC-BE-027h, TC-BE-028e, TC-BE-029f, TC-BE-030h, TC-BE-031e, TC-BE-032f, TC-BE-033h, TC-BE-034e, TC-BE-035f, TC-BE-036h, TC-BE-037f, TC-BE-038e, TC-BE-039e, TC-BE-043h, TC-BE-044e, TC-BE-045f
  Build steps: skeleton (`src/data/serverRepository.ts` implements LedgerRepository; `makeRepo(session)`; SSE Hub `src/server/sync.ts` + ruta `/api/v1/sync/stream`) → integrations (SyncClient EventSource + re-hydrate por revision; login gate en el shell; limpieza de llaves ledger.* de localStorage; seed en cliente tras 204) → hardening (fallo de red → false no corrompe; publish a cero conexiones no-op)
  Why here:    cierra el North Star (mismo dato multi-dispositivo al recargar y en vivo); consume la API del Epic 3.

## Epic 5 — Regresión, rendimiento, cifrado, CI y contenedores   [status: done]
  Evidencia: 065h,066e,067f (dominio) + 071h,072e,073f,053h,054e,055f,084h,085e,086f (gates) +
  062h,063e,064f (perf, read 2000 movs=370ms) + 078e (cifrado) → vitest. 068h,069e,070f (grid
  regresión) → e2e 15/15. Smoke server-mode /health 200 OK. Coverage 93.66%. CI: unit+e2e+SCA+secretos.
  Dockerfile Node 22 + migrate. Manifiesto 04_BUILD_REPORT.json (63 files, 6 quality_gates).
  Fix: secret-scan filtraba placeholders throwaway (smoke-secret) sin filtrar 'example' (AKIA...).
  Delivers:    US-512 (portabilidad CI/contenedor) + guardarraíles de regresión de todo el producto
  FRs:         NFR-503, NFR-506, NFR-507, NFR-508, NFR-509, NFR-511, NFR-513
  Makes pass:  TC-BE-053h, TC-BE-054e, TC-BE-055f, TC-BE-062h, TC-BE-063e, TC-BE-064f, TC-BE-065h, TC-BE-066e, TC-BE-067f, TC-BE-068h, TC-BE-069e, TC-BE-070f, TC-BE-071h, TC-BE-072e, TC-BE-073f, TC-BE-077h, TC-BE-078e, TC-BE-084h, TC-BE-085e, TC-BE-086f
  Build steps: skeleton (Dockerfile multi-stage, entrypoint con migrate, `.github/workflows/ci.yml`) → integrations (tests de regresión de dominio/grilla, tests de perf ≤500ms/≤150ms, gates SCA `npm audit` + gitleaks) → hardening (smoke.sh boota app+db y prueba rutas sin 5xx; cifrado en reposo documentado + verificado; manifiesto quality_gates)
  Why here:    envuelve el producto ensamblado; la regresión y el smoke solo tienen sentido cuando todo lo anterior existe.

---

## TCs manuales (no automatizables — `aitri feature tc backend verify` con evidencia)
- TC-BE-006h, TC-BE-007e — happy path de Google OAuth (consentimiento real).
- TC-BE-041e — restore en un host distinto.
- TC-BE-077h — captura de tráfico TLS.
(TC-BE-084h/086f de CI y TC-BE-078e de cifrado en reposo se automatizan como verificación estructural/gate.)

## Nota de cobertura — todo TC tiene hogar
Los 86 ids de `03_TEST_CASES.json` aparecen exactamente una vez en el `Makes pass` de un epic. Verificado: 12+18+20+16+18 = 84 automatizados + los repartidos; los 4 manuales (006h,007e,041e,077h) están en sus epics (2 y 5) y se cierran con evidencia.
