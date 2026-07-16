# Audit Report — T-Ledger

## Requirements Coverage

**Method:** Independent re-derivation of client needs from `00_DISCOVERY.md`, `01_REQUIREMENTS.json#original_brief`, and the seed IDEA, traced backward to the functional requirements, then diffed against the Phase-1 `coverage_map`.

**Verdict (re-audited 2026-07-07):** 30 needs traced · 28 fully covered · 0 uncovered (dropped) · 2 divergences/questions to resolve. Fresh independent re-derivation on 2026-07-07 reproduced the same trace and confirms the 2026-07-02 findings stand — root Phase-1 FRs unchanged; GAP-2 and GAP-3 remain open pending a user decision. (Note: the in-flight `stack-upgrade-theme` feature will supersede FR-012's design system, but that is a feature-level change not yet folded into root Phase 1.)
No client need was silently *dropped* — every expressed need maps to an FR, an NFR, a constraint, or an explicit `no_go_zone` line. The prior GAP-1 ("Sin asignar" per-GRUPO → per-TIPO divergence) is **RESOLVED**: FR-003 now reads *"la categoría fija 'Sin asignar' del **MISMO GRUPO** … UNA por **GRUPO**"* and NFR-005 *"de 'Sin asignar' de su grupo"*, matching the brief and D-2; the editable-montos point is now consistent with the D-2 constraint (`auto, no renombrable/borrable, montos editables`). Two items still diverge and should be confirmed.

---

### Findings

**[GAP-1]** `RESOLVED (2026-07-02)` — "Sin asignar" scope is now per-GRUPO in FR-003 / NFR-005, consistent with the discovery SC-4, the brief business rule, and D-2. No action.

**[GAP-2]** `SCOPE QUESTION (reverse-check — possible v1 expansion)` — FR-015 drag-and-drop is a v1 MUST, but the brief deferred all drag-drop to Phase 5
- Source: `original_brief` Out of Scope (Post-MVP, Fase 5) — *"**Drag-and-drop para reordenar grupos/categorías (D-7)**"* listed as post-MVP.
- Requirement as written: FR-015 `[MUST]` "Reorganizar categorías/subcategorías por arrastrar-y-soltar (reparent)" — in v1. The `no_go_zone` splits D-7: *reparent* pulled into v1, *reorder-by-position* left in Phase 5.
- Status: not a gap (nothing dropped); a **scope addition**. Its rationale is sound — FR-003 leaves categories parked under "Sin asignar" and needs a mechanism to move them back out, and the brief never specified one. But the brief's own words put drag-drop in Phase 5, so v1 now carries a non-trivial MUST the client had deferred.
- Action: **confirm the v1 scope with the user.** Either accept FR-015 in v1 (and note it supersedes the brief's Phase-5 deferral for reparent), or replace the drag-drop with a lighter "move to…" action for the "Sin asignar" recovery path.

**[GAP-3]** `PARTIAL (deliverable not verifiable)` — README explaining technical decisions
- Source: `original_brief` Hard Constraints — *"El README debe explicar decisiones técnicas, no solo cómo correr el proyecto."*
- Status: captured only as a `constraints[]` entry — no FR/NFR and therefore no acceptance criteria or test case. It is a stated hard deliverable with no mechanical verification, so it can silently ship absent or thin.
- Action: minor — either add it as an acceptance item / Phase-3 manual TC, or accept explicitly that it is a constraint verified by human review at deploy (record the decision).

---

### What was traced (completeness evidence)
- **Discovery success criteria (8/8) COVERED:** SC-1 seed→FR-013/FR-011 · SC-2 captura→FR-001 · SC-2b consistencia captura→presupuesto→FR-001/FR-004 · SC-3 taxonomía CRUD→FR-002 · SC-4 borrado sin pérdida→FR-003 *(GAP-1 resolved — per-grupo)* · SC-5 plan-vs-realidad grilla→FR-006/FR-004 · SC-6 dashboard→FR-009 · SC-7 móvil compacto→FR-010 · SC-8 end-to-end→North Star/FR-010+all.
- **Discovery evidence gaps resolved:** D-3 (Ejecutado editable vs derivado) → FR-006 inline edit + FR-001 movement-derived · D-8 (movimiento a subcategoría) → FR-001 subcategoría opcional.
- **Brief business rules (9/9) COVERED:** BR1→FR-001 · BR2→FR-002 · BR3→FR-003 *(GAP-1 resolved)* · BR4→FR-004 · BR5→FR-006 · BR6→FR-008 · BR7→FR-009 · BR8→FR-010 · BR9→FR-011 · BR10→FR-012.
- **Constraints:** stack/theme/COP/breakpoint/hosting→`constraints[]`+NFR-006 · README→`constraints[]` *(GAP-3)*.
- **Scaffolding:** multiuser + external-API andamiaje→FR-014.
- **Visual assets (mockups):** dashboard→FR-009/FR-012 · budget grid→FR-006/FR-008 — covered via UX-type FRs and the approved UX phase.
- **Out-of-scope (10/10) correctly excluded, not reported as gaps:** distribución proporcional · presupuesto/dashboard móvil · teclado numérico · multiusuario/login · APIs runtime · multi-año/moneda · backend Supabase · reordenar-por-posición + arrastrar grupos · exportación · tweaks como preferencias — each cited in `no_go_zone`.

---

## Security

_Adversarial review tras cerrar la feature `backend` (modo servidor multiusuario: auth, API `/api/v1`, Postgres, SSE). Fecha: 2026-07-16._

**Surfaces audited:** static (código/repo/deps): **covered** — `src/server/**`, rutas `src/app/api/**`, `next.config.mjs`, `docker-compose.yml`, `Dockerfile`, `.env.example`, `npm audit`, escaneo de secretos y de git-tracked env. · runtime (local): **covered** — app booteada en modo servidor (`NEXT_PUBLIC_LEDGER_SERVER_MODE=true`) contra Postgres 16 efímero; probados headers, `/health`, gating 401, rutas de error, endpoints de debug/docs, y el bundle cliente servido. Sin instancia desplegada pública (TLS terminado en proxy) → la verificación de TLS en tránsito queda como manual (ver TC-BE-077h).

**Postura general: sólida.** Auth exigida en las 4 rutas de datos, aislamiento por `ownerId` estructural, contraseñas argon2id, queries parametrizadas (Drizzle), cookies HttpOnly/Secure/SameSite, headers de seguridad presentes, sin endpoints de debug (todo 404), sin stack traces en errores, sin `@aitri-trace`/IDs internos en el bundle cliente, y **sin fuga del valor de ningún secreto al cliente** (el bundle solo contiene el guard de Next que *lanza* al tocar una env server-only). Los hallazgos son de **endurecimiento (todos P2)**, no huecos explotables.

**[RQ-SEC-001]** `P2` — CSP permite `'unsafe-inline'` y `'unsafe-eval'`
- Severity: Low — Un atacante que logre inyectar HTML (p. ej. vía un XSS futuro en algún punto no escapado) podría ejecutar scripts inline; la CSP actual no lo frenaría. Mitigado en profundidad por el escape por defecto de React y la cookie de sesión HttpOnly (un XSS no exfiltra la sesión), por eso Low.
- Evidence: header servido `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; ...` (probado con `curl -D -` sobre `/`).
- Acceptance criteria: la CSP servida NO contiene `'unsafe-inline'` ni `'unsafe-eval'` en `script-src` (usa nonce o hash). `curl -sD - / | grep -i content-security-policy` no muestra `unsafe-eval`.
- Suggested implementation: CSP basada en nonce vía `middleware.ts` de Next (genera un nonce por request, lo inyecta en `script-src 'nonce-...'`), o migrar los estilos inline a clases para quitar `unsafe-inline` de `style-src`. Requiere probar que la app no rompe (Next inyecta scripts inline con nonce).

**[RQ-SEC-002]** `P2` — Header `X-Powered-By: Next.js` expone el framework
- Severity: Low — Fingerprinting: un atacante identifica el framework/versión y ajusta ataques a CVEs conocidos de Next. No es una vulnerabilidad por sí misma, reduce el costo del reconocimiento.
- Evidence: `curl -sD - / -o /dev/null | grep -i x-powered-by` → `X-Powered-By: Next.js`.
- Acceptance criteria: la respuesta NO incluye el header `X-Powered-By`.
- Suggested implementation: `poweredByHeader: false` en `next.config.mjs` (una línea).

**[RQ-SEC-003]** `P2` — Rate-limit de login basado en `X-Forwarded-For` (spoofable sin proxy que lo sanee)
- Severity: Medium (dependiente del despliegue) — El limitador de `/sign-in/email` (5/60s) se llavea por IP tomada de `x-forwarded-for` (`advanced.ipAddress.ipAddressHeaders`). Si el reverse proxy no **sobrescribe** ese header (o no hay proxy), un atacante rota `X-Forwarded-For` en cada request → un bucket distinto por intento → **elude el límite de fuerza bruta**. (Verificado indirectamente: el harness e2e desactiva el rate-limit precisamente porque el header controla el bucket.)
- Evidence: `src/server/auth.ts` → `advanced.ipAddress.ipAddressHeaders: ["x-forwarded-for"]` + `rateLimit.customRules["/sign-in/email"] = { window:60, max:5 }`.
- Acceptance criteria: en el despliegue, el reverse proxy fija (no append) `X-Forwarded-For` al IP real del cliente; documentado en DEPLOYMENT.md como requisito. Opcional: un test que envíe 6 logins fallidos rotando XFF y aún reciba 429 cuando el proxy está presente.
- Suggested implementation: documentar en DEPLOYMENT.md que el proxy (nginx) debe usar `proxy_set_header X-Forwarded-For $remote_addr;` (reemplazar, no `$proxy_add_x_forwarded_for`). Considerar un `trustedProxy`/hop-count si Better Auth lo soporta.

**[RQ-SEC-004]** `P2` — El registro (`/sign-up/email`) no tiene rate-limit específico
- Severity: Low — Solo aplica el límite global (100/60s por IP). Permite creación masiva de cuentas / sondeo de emails a mayor volumen que el login. No expone datos; es abuso de recursos.
- Evidence: `src/server/auth.ts` → `customRules` solo declara `/sign-in/email`; `/sign-up/email` cae al global `max: 100`.
- Acceptance criteria: `customRules["/sign-up/email"]` declara un límite acotado (p. ej. 10/60s); un test de 11 registros desde una IP recibe 429.
- Suggested implementation: añadir `"/sign-up/email": { window: 60, max: 10 }` a `rateLimit.customRules`.

**[RQ-SEC-005]** `P2` — 6 vulnerabilidades moderadas en dependencias (dev/build), 0 altas/críticas
- Severity: Low — `drizzle-kit` (→ `@esbuild-kit/esm-loader`) y `postcss` (vía `next`, XSS en el stringify de CSS) son de **build/dev**, no llegan al runtime servido. `npm audit --audit-level=high` sale 0 (el gate de CI no bloquea). Riesgo real bajo.
- Evidence: `npm audit` → "6 moderate severity vulnerabilities"; `npm audit --audit-level=high` → exit 0.
- Acceptance criteria: `npm audit --audit-level=high` mantiene exit 0; revisar y actualizar cuando haya fixes no-breaking para las moderadas.
- Suggested implementation: seguimiento periódico; el gate SCA de CI ya cubre alto/crítico (NFR-513).

**Proposed quality_gate** — `scripts/security-config.sh` (exit-code): verifica estáticamente que `next.config.mjs` declara los headers requeridos (`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, CSP con `frame-ancestors 'none'`) **y** `poweredByHeader: false`; que la CSP de `script-src` no contiene `unsafe-eval` (RQ-SEC-001); que `src/server/auth.ts` mantiene `httpOnly` + `sameSite` en las cookies y un `customRule` para `/sign-up/email` (RQ-SEC-004). Declararlo en `04_BUILD_REPORT.json#quality_gates` para que `verify` re-chequee la postura cada ciclo. El gate `security` existente (`scripts/secret-scan.sh`) ya cubre secretos en el árbol.

**Verdict:** 5 hallazgos — **P0: 0 · P1: 0 · P2: 5**. Riesgo general **bajo**: la superficie está bien endurecida; los hallazgos son mejoras de defensa-en-profundidad (CSP más estricta, fingerprinting, rate-limit del registro, y una dependencia operativa del proxy para el anti-fuerza-bruta). Ninguno bloquea el despliegue; RQ-SEC-003 es el más importante por su dependencia del proxy.
