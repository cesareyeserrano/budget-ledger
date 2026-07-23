# Technical Design Document (TRD / SDD)
## Feature: backend — Ledger multiusuario con servidor (auth + API + BD + sync)

> **Naturaleza:** cambio a un sistema EXISTENTE. El frontend, el dominio puro (`src/domain/**`) y el
> comportamiento visible NO cambian — cambia el **origen de los datos**. El punto de swap es la
> interfaz `LedgerRepository` ([src/data/repository.ts:24](../../../../src/data/repository.ts)), diseñada
> desde el FR-011 raíz exactamente para esto. Arranque limpio confirmado: no se migra el localStorage.

---

## Executive Summary

| Capa | Tecnología | Versión | Razón |
|---|---|---|---|
| Servidor HTTP / API | Next.js Route Handlers (mismo app) | 15.1.6 (existente) | Coherente con el stack (technology_preferences); un solo deploy; los route handlers soportan streaming (SSE) sin servidor custom. |
| Runtime | Node.js | 22 LTS | LTS activo; imagen oficial alpine multi-arch (x64/ARM — la Pi es solo un target más). |
| Base de datos | PostgreSQL | 16 (imagen `postgres:16-alpine`) | ADR-01. SQL portátil real: corre en docker-compose con volumen nombrado (preferencia declarada) Y en cualquier Postgres gestionado (RDS/Neon/Supabase) sin cambiar código. Escrituras concurrentes (multiusuario + SSE) sin la limitación de single-writer de SQLite. |
| Acceso a datos / migraciones | Drizzle ORM + drizzle-kit | ^0.44 / ^0.31 | ADR-02. TS-first, queries parametrizadas por construcción (NFR-501), runtime mínimo sin binario de engine, migraciones SQL versionadas en el repo. |
| Driver | postgres.js | ^3.4 | Driver recomendado por Drizzle; pool integrado; puro JS (portable). |
| Autenticación | Better Auth | ^1.3 | ADR-03. Email+contraseña Y Google OAuth de primera clase, sesiones en BD con cookies HttpOnly/Secure/SameSite, rate limiting integrado (NFR-512), adapter Drizzle oficial. |
| Hash de credenciales | argon2id (`@node-rs/argon2`) | ^2 | NFR-501 lo nombra explícitamente; parámetros OWASP (m=19 MiB, t=2, p=1) vía el hook de password de Better Auth. |
| Validación de input | Zod | 3.24.1 (existente) | Los esquemas persistidos (`persistedNodesSchema`, `persistedBudgetSchema`) ya existen y se COMPARTEN cliente/servidor: el contrato de datos es uno solo. |
| Sync en vivo | Server-Sent Events (SSE) | — (estándar web) | ADR-07. Unidireccional es suficiente (las escrituras van por HTTP); `EventSource` reconecta solo; no exige servidor custom ni dependencia nueva. |
| Contenedores | Docker + docker-compose | Dockerfile multi-stage (`node:22-alpine`) | Preferencia declarada; `next build` standalone; volumen nombrado `pgdata` para la persistencia (NFR-505/FR-512). |
| CI | GitHub Actions | — | NFR-503/NFR-513: lint, typecheck, unit, e2e, SCA (`npm audit`), escaneo de secretos (gitleaks). |

**Decisiones centrales** (detalle en ADRs, `## Risk Analysis`):

1. **API REST versionada `/api/v1`** (ADR-05) — contrato explícito consumible por más de un cliente (FR-507).
2. **Modelo de escritura por snapshot con lock optimista por `revision`** (ADR-06) — la impl de servidor
   de `LedgerRepository.save()` hace `PUT /api/v1/ledger` con el estado completo + `baseRevision`;
   el servidor lo aplica en UNA transacción (FR-508: nunca parcial) y rechaza 409 si está stale.
   Es la traducción literal del contrato `save(ownerId, state)` que ya existe.
3. **Sesiones en BD con cookie** (ADR-04), no JWT stateless — el logout INVALIDA de verdad (AC-503c).
4. **Sync en vivo por SSE con hub en memoria por usuario** (ADR-07) — un write publica `{revision}`
   solo a las conexiones de ESE usuario (FR-511); los demás dispositivos re-consultan el snapshot.
5. **La semilla del usuario nuevo la construye el cliente** con el `buildSeed()` compartido existente
   (ADR-09) — cero duplicación de lógica de dominio; el servidor responde 204 a un ledger nunca
   persistido y el cliente siembra y guarda, exactamente el flujo `hydrate()` de hoy (FR-513).
6. **Aislamiento por `ownerId` estructural**: el `ownerId` sale SIEMPRE de la sesión del servidor,
   jamás del payload; toda función de la capa de datos exige `ownerId` como primer parámetro (FR-505).

**Dependencias nuevas (runtime):** `better-auth`, `drizzle-orm`, `postgres`, `@node-rs/argon2`.
**Dev:** `drizzle-kit`. **Cambios al dominio:** ninguno (guardrail NFR-507).

---

## System Architecture

```
┌──────────────────────────── Navegador (por dispositivo) ────────────────────────────┐
│                                                                                      │
│  UI existente (grilla, registro, dashboard) — SIN CAMBIOS (NFR-508)                  │
│        │ acciones                                                                    │
│  Zustand store (src/state/store.ts) — mutaciones puras del dominio, igual que hoy    │
│        │ persist(data) / hydrate()                                                   │
│  ┌─────┴──────────────────────────────┐   ┌───────────────────────────────────────┐  │
│  │ ServerRepository (NUEVO,           │   │ SyncClient (NUEVO)                    │  │
│  │ src/data/serverRepository.ts)      │   │ EventSource /api/v1/sync/stream       │  │
│  │ implements LedgerRepository        │   │ evento revision>local → re-hydrate    │  │
│  │  load → GET /api/v1/ledger         │   └───────────────────────────────────────┘  │
│  │  save → PUT /api/v1/ledger         │   ┌───────────────────────────────────────┐  │
│  │  (baseRevision, 409→refetch+aviso) │   │ localStorage: SOLO tema + prefs UI    │  │
│  └─────┬──────────────────────────────┘   │ (FR-509; llaves ledger.* se retiran)  │  │
│        │ HTTPS (TLS, NFR-511)             └───────────────────────────────────────┘  │
└────────┼─────────────────────────────────────────────────────────────────────────────┘
         ▼
┌──────────────────────── Next.js server (contenedor app, Node 22) ────────────────────┐
│                                                                                       │
│  withApi() (NUEVO, src/server/http.ts) — envoltura de TODA ruta /api/v1:              │
│   auth (sesión→userId) · validación Zod · log [ts] METHOD /path STATUS (NFR-502)      │
│   · mapeo de errores consistente · check de Origin (CORS restringido, NFR-512)        │
│        │                                                                              │
│  ┌─────┴─────────────┐  ┌──────────────────┐  ┌────────────────────────────────────┐  │
│  │ Rutas /api/v1     │  │ Better Auth      │  │ SSE Hub (NUEVO, src/server/sync.ts)│  │
│  │ ledger (GET/PUT)  │  │ /api/auth/*      │  │ Map<userId, Set<conexión>>         │  │
│  │ movements         │  │ email+pass       │  │ publish(userId,{revision})         │  │
│  │ (GET/POST/GET:id) │  │ Google OAuth     │  │ heartbeat 25s; solo MISMO usuario  │  │
│  │ sync/stream (GET) │  │ rate limit login │  └────────────────────────────────────┘  │
│  │ /health (GET,     │  │ sesiones en BD   │                                          │
│  │  sin auth)        │  │ argon2id         │                                          │
│  └─────┬─────────────┘  └───────┬──────────┘                                          │
│        │                        │                                                     │
│  Capa de datos (NUEVO, src/server/data/*) — Drizzle; TODA query filtra por ownerId    │
│  de la sesión; snapshot replace en UNA transacción; bump de revision                  │
└────────┼──────────────────────────────────────────────────────────────────────────────┘
         ▼
┌── PostgreSQL 16 (contenedor db) ──┐        ┌── Google OAuth (externo) ──┐
│ user/session/account/verification │        │ solo en el flujo de login  │
│ ledger/node/amount_cell/movement  │        └────────────────────────────┘
│ volumen nombrado pgdata (FR-512)  │
└───────────────────────────────────┘
```

**Responsabilidades:** la UI y el dominio no saben que existe un servidor (mismo contrato
`LedgerRepository`). `withApi()` concentra las políticas transversales (auth, validación, log,
errores, Origin) para que ninguna ruta pueda "olvidarlas". La capa de datos es la única que toca
la BD y es estructuralmente imposible de llamar sin `ownerId`. El SSE Hub solo enruta
notificaciones (`{revision}`), nunca datos de otro usuario.

---

## Data Model

### Contrato preservado (NO cambia)

- **Tipos del dominio** ([src/domain/types.ts](../../../../src/domain/types.ts)): `LedgerNode`,
  `AmountMap`, `Movement`, `LedgerState`, `MonthKey` — intactos. La BD los espeja; no se
  reinterpretan.
- **Interfaz `LedgerRepository`** (`load(ownerId) → LedgerState | null`, `save(ownerId, state) → boolean`)
  — intacta; se AGREGA una implementación (FR-508), no se modifica el contrato.
- **Semántica de montos:** enteros COP (`amount` entero ≥ 0 en celdas, ≥ 1 en movimientos) — igual.
- **localStorage de prefs de dispositivo:** tema (`next-themes`) y ancho de grilla (`src/lib/gridWidth`)
  siguen en localStorage (FR-509). Las llaves financieras `ledger.nodes.v1` / `ledger.budget.v2` se
  RETIRAN: la impl de servidor las elimina en el primer boot autenticado (limpieza, no migración).

### Delta — esquema PostgreSQL (Drizzle, migraciones versionadas)

Tablas de Better Auth (generadas por su CLI con el adapter Drizzle; nombres estándar):

| Tabla | Campos clave | Notas |
|---|---|---|
| `user` | `id` PK, `email` UNIQUE NOT NULL, `name`, `email_verified`, `created_at` | `user.id` ES el `ownerId` real (reemplaza el `"local"` fijo, FR-503). |
| `session` | `id` PK, `token` UNIQUE, `user_id` FK→user ON DELETE CASCADE, `expires_at`, `ip_address`, `user_agent` | Sesiones en BD → logout = DELETE (AC-503c). |
| `account` | `id` PK, `user_id` FK, `provider_id` (`credential` \| `google`), `account_id`, `password` (hash argon2id, solo credential) | Vincula email+pass y Google al MISMO `user` (AC-502b: ownerId estable). |
| `verification` | estándar Better Auth | Tokens de flujo (state OAuth, etc.). |

Tablas del ledger (todas con `owner_id` NOT NULL FK→`user.id` ON DELETE CASCADE):

| Tabla | Campos y constraints |
|---|---|
| `ledger` | `owner_id` PK, `revision` BIGINT NOT NULL DEFAULT 0, `updated_at` TIMESTAMPTZ NOT NULL. Una fila por usuario; ancla del lock optimista y del evento SSE. Fila ausente = usuario nunca persistió (→ 204, el cliente siembra, FR-513). |
| `node` | PK (`owner_id`,`id`); `type` TEXT CHECK IN ('expense','income','transfer'); `level` TEXT CHECK IN ('group','category','sub'); `parent_id` TEXT NULL; `name` TEXT NOT NULL; `icon` TEXT NULL; `system` BOOLEAN NOT NULL DEFAULT false; `sort_order` INT NOT NULL |
| `amount_cell` | PK (`owner_id`,`node_id`,`month`,`kind`); `month` TEXT CHECK IN ('ene',…,'dic'); `kind` TEXT CHECK IN ('budget','actual'); `amount` BIGINT NOT NULL CHECK (`amount` >= 0). Espeja `AmountMap` (budgets y actuals) celda a celda. |
| `movement` | PK (`owner_id`,`id`); `type`, `month` con los mismos CHECK; `cat_id` TEXT NOT NULL; `sub_id` TEXT NULL; `target` TEXT NOT NULL; `amount` BIGINT NOT NULL CHECK (`amount` >= 1); `created_at` BIGINT NOT NULL; `date` TEXT NULL; `note` TEXT NULL. Índice (`owner_id`,`created_at` DESC). |

**Integridad referencial intra-ledger** (`parent_id`, `target` → nodos): se valida a nivel de
aplicación con los esquemas Zod compartidos + invariantes del dominio (los mismos que hoy protegen
localStorage), no con FKs auto-referentes — el snapshot replace (delete+insert en una transacción)
haría a las FKs auto-referentes frágiles al orden de inserción sin aportar una garantía que el
dominio no dé ya. La FK dura que SÍ existe en toda tabla es `owner_id → user.id`: un registro de
dominio sin owner válido es imposible de persistir (FR-506, AC-506c).

**Un registro sin `ownerId` no es válido ni accesible** (FR-506): `owner_id` es NOT NULL + FK en
las cuatro tablas, y toda query de la capa de datos filtra por el `ownerId` de la sesión.

---

## API Design

### Contrato preservado

La superficie interna del cliente no cambia: el store sigue llamando `repo.load(ownerId)` /
`repo.save(ownerId, state)` y las mutaciones puras del dominio. Lo nuevo es la superficie HTTP.

### Superficie HTTP nueva

Convenciones: JSON UTF-8; errores con forma única `{ "error": { "code": string, "message": string } }`;
códigos consistentes: 400/422 payload inválido · 401 sin sesión válida · 404 recurso ajeno o
inexistente (sin filtrar existencia, AC-505b) · 409 revisión stale · 429 rate limit · 5xx solo fallo
real del servidor. Toda ruta `/api/v1/*` pasa por `withApi()` (auth + Zod + log + Origin).

**Autenticación (Better Auth, montada en `/api/auth/[...all]`):**

| Método y ruta | Auth | Request | Respuesta | Errores |
|---|---|---|---|---|
| POST `/api/auth/sign-up/email` | — | `{name, email, password}` | 200 + cookie de sesión; crea `user`+`account` | 422 email ya registrado (una sola cuenta por email, AC-501c); 429 rate limit |
| POST `/api/auth/sign-in/email` | — | `{email, password}` | 200 + cookie de sesión | 401 credenciales inválidas — mismo error exista o no el email (AC-501b); 429 tras N intentos (NFR-512) |
| POST `/api/auth/sign-out` | cookie | — | 200; borra la sesión en BD e invalida la cookie | — (idempotente) |
| GET `/api/auth/get-session` | cookie | — | 200 `{session, user}` o `null` | — |
| POST `/api/auth/sign-in/social` | — | `{provider:"google", callbackURL}` | 200 `{url}` → redirect a Google | 400 provider desconocido |
| GET `/api/auth/callback/google` | — | `?code&state` | 302 a la app con sesión creada/vinculada (AC-502a/b) | Denegado o `state`/`code` inválido → 302 a pantalla de error SIN sesión, nunca 5xx (AC-502c) |

**Ledger v1 (todas exigen sesión; sin sesión → 401 y cero datos, FR-504):**

| Método y ruta | Request | Respuesta | Errores |
|---|---|---|---|
| GET `/api/v1/ledger` | — | 200 `{revision, state:{nodes, budgets, actuals, movements}}` — solo datos del `ownerId` de la sesión | 204 sin cuerpo si el usuario nunca persistió (el cliente siembra con `buildSeed()`, FR-513); 401 |
| PUT `/api/v1/ledger` | `{baseRevision, state}` (validado con los Zod compartidos; `ownerId` del payload se IGNORA — manda la sesión) | 200 `{revision}` — replace transaccional del ledger del usuario + bump de `revision` + publish SSE | 400/422 inválido (nada persiste, AC-507c); 409 `{revision}` si `baseRevision` ≠ actual (el cliente re-hidrata y avisa); 401 |
| GET `/api/v1/movements` | `?month=` opcional | 200 `{movements}` — únicamente del usuario (AC-505a/AC-507b) | 401 |
| GET `/api/v1/movements/{id}` | — | 200 `{movement}` si es del usuario | 404 si es de otro usuario o no existe — sin distinción (AC-505b); 401 |
| POST `/api/v1/movements` | `{type, catId, subId, amount, month, date?, note?}` | 201 `{movement, revision}` — ejecuta la mutación pura COMPARTIDA `addMovement` (dominio) en una transacción: inserta el movimiento Y actualiza la celda `actual`, coherente con el cliente | 400/422 inválido — misma regla de validación que el dominio; 401 |
| PATCH/DELETE `/api/v1/movements/{id}` | — | — | 404 `unsupported_operation`: en v1 los movimientos son un journal inmutable (el producto no tiene editar/borrar movimiento; no se inventa dominio). Propio o ajeno: 404 y nada se altera (AC-505c). |
| GET `/api/v1/sync/stream` | — (SSE) | 200 `text/event-stream`; evento `revision` `{revision}` en cada write del MISMO usuario; heartbeat `:ping` cada 25s | 401 antes de abrir el stream |
| GET `/health` | sin auth | 200 `{status:"ok"}` — vivo; no expone datos de usuario (NFR-504) | — |

**Nota sobre `POST /movements` y el guardrail:** el servidor ejecuta ahí la mutación pura compartida
(escritura), NUNCA el cálculo de lectura (rollups / balance / `budgetState`) — ese sigue 100% en el
cliente (no_go_zone). El cliente web ni siquiera usa esta ruta (usa el snapshot PUT); existe porque
FR-507 exige una superficie consumible por más de un cliente y las ACs la referencian.

---

## Implementation Approach

FR-501: Registro e inicio de sesión con email + contraseña
Method: Better Auth `emailAndPassword` con hash argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1) vía hooks `password.hash/verify`; unicidad por constraint UNIQUE en `user.email`.
I/O: `{name, email, password}` → cookie de sesión + fila `user`+`account(provider=credential, password=hash)`; login `{email,password}` → cookie.
Failure: email duplicado → 422 sin segunda cuenta; contraseña errónea → 401 genérico (sin enumeración de usuarios); BD caída → 503, sin sesión.

FR-502: Inicio de sesión con Google OAuth
Method: Better Auth `socialProviders.google` (authorization code + PKCE + verificación de `state`); vinculación por email verificado al `user` existente → mismo `ownerId` (AC-502b).
I/O: redirect a Google → callback `?code&state` → sesión en cookie + `account(provider=google)`.
Failure: consentimiento denegado o `state`/`code` inválido → redirect a error manejado, sin sesión ni cuenta, nunca 5xx; credenciales Google no configuradas → botón deshabilitado + warning explícito en boot (solo email+pass activo).

FR-503: Sesión que identifica al usuario en cada request
Method: cookie de sesión (HttpOnly+Secure+SameSite=Lax) → lookup en tabla `session` (BD) por `withApi()`; expiración por `expires_at`; logout = DELETE de la fila.
I/O: request con cookie → `ctx.userId` disponible para la ruta; sin cookie/expirada/manipulada → `ctx.userId` ausente, jamás un default.
Failure: sesión inválida en ruta protegida → 401; tras logout la misma cookie → 401 (la fila ya no existe).

FR-504: Gating de la API
Method: `withApi({auth:"required"})` corta ANTES del handler; ninguna ruta de datos se registra sin la envoltura (patrón estructural, no disciplina).
I/O: sin sesión → 401 `{error}` sin datos; con sesión → 200 con datos del usuario.
Failure: error del handler ya autenticado → 5xx con forma de error única, nunca datos de otro usuario.

FR-505: Aislamiento por ownerId
Method: `ownerId` deriva EXCLUSIVAMENTE de la sesión; las funciones de la capa de datos tienen firma `(ownerId, …)` y componen `WHERE owner_id = $1` por construcción; acceso por id ajeno → 404 indistinguible de inexistente.
I/O: query de A → solo filas `owner_id = A`; write de A sobre recurso de B → 404 y B intacto.
Failure: payload que incluya `ownerId` → se ignora/reescribe con el de la sesión (nunca 500).

FR-506: Esquema de BD por usuario
Method: self-evident from Data Model (owner_id NOT NULL + FK + CHECKs espejando los tipos del dominio).
I/O: `LedgerState` ↔ filas de `node`/`amount_cell`/`movement` + ancla `ledger`.
Failure: registro sin owner válido → rechazo por constraint (23502/23503 → 422).

FR-507: API versionada filtrada por usuario
Method: REST bajo `/api/v1/*` (ADR-05); validación Zod compartida en el borde; ver tabla de API Design.
I/O: por endpoint (tabla). Escritura válida → persistida y legible en la siguiente lectura del mismo usuario.
Failure: payload malformado → 400/422 sin persistir nada (la validación corre ANTES de abrir la transacción).

FR-508: Implementación de servidor de LedgerRepository
Method: `ServerRepository implements LedgerRepository` sobre `fetch` con `credentials:"include"`; `load` = GET snapshot (204 → null); `save` = PUT snapshot con `baseRevision` en memoria; `makeRepo(session)` devuelve la impl de servidor cuando hay sesión.
I/O: `load(ownerId) → LedgerState|null`; `save(ownerId, state) → boolean` (contrato intacto).
Failure: red caída o 5xx en `save` → `false` → banner no bloqueante (ruta `storageError` existente, generalizada a "error de sincronización"); el estado en memoria queda válido y la fuente de verdad no recibe nada parcial (transacción del lado servidor); 409 → re-fetch del snapshot + re-hidratación + aviso (last-write-wins informado, ADR-06).

FR-509: Split de almacenamiento
Method: la impl de servidor jamás escribe datos financieros en localStorage; en el primer hydrate autenticado elimina `ledger.nodes.v1`/`ledger.budget.v2` (limpieza de legado, no migración); tema y ancho de grilla siguen su camino actual.
I/O: localStorage = {tema, prefs UI} exclusivamente; credenciales viven SOLO en la cookie HttpOnly (ilegible por JS).
Failure: localStorage indisponible → prefs efímeras; los datos financieros no dependen de él en absoluto.

FR-510: Sincronización al recargar/abrir
Method: consecuencia directa de la fuente de verdad única: `hydrate()` siempre parte de GET `/api/v1/ledger` del `ownerId` de la sesión.
I/O: mismo usuario en N dispositivos → mismo `{revision, state}` tras recargar; otro usuario → su propio ledger, nunca el ajeno.
Failure: servidor inalcanzable al abrir → pantalla de error de conexión con reintento; NO se cae a datos locales financieros (no existen, FR-509).

FR-511: Sincronización en vivo
Method: SSE Hub en memoria `Map<userId, Set<conn>>` (ADR-07): todo write (PUT snapshot o POST movement) publica `{revision}` únicamente a las conexiones de ese `userId`; el cliente compara con su revisión local y re-hidrata (GET snapshot). `EventSource` re-conecta solo; heartbeat 25s mantiene vivo el stream tras proxies.
I/O: write en dispositivo 1 → evento en dispositivo 2 del MISMO usuario → refetch → UI actualizada ≪5s en LAN/banda ancha.
Failure: stream caído → reconexión automática con re-sync inicial (revision check al reconectar); app cerrada en el otro dispositivo → sin error, al abrir ve el dato vía FR-510; usuario distinto → jamás recibe el evento (el hub enruta por userId de la sesión del stream).

FR-512: Persistencia portátil
Method: volumen nombrado `pgdata` en docker-compose (o Postgres gestionado vía `DATABASE_URL`); cero rutas/IPs de host en el código — toda localización por variables de entorno validadas al boot.
I/O: `DATABASE_URL` → pool postgres.js; restore = mismo volumen/dump en otro host.
Failure: variable de entorno faltante → el boot FALLA explícito con el nombre de la variable (fail-fast, NFR-510 negative), nunca un default silencioso.

FR-513: Estado inicial de usuario nuevo
Method: el registro NO siembra nada en el servidor; el primer GET `/api/v1/ledger` devuelve 204 y el CLIENTE ejecuta el flujo existente `loaded ?? buildSeed(ownerId)` + `save` (ADR-09) — la semilla es la misma función compartida de hoy, con el `ownerId` real.
I/O: cuenta nueva → 204 → `buildSeed(userId)` → PUT → ledger propio y utilizable.
Failure: PUT de la semilla falla → el usuario ve la semilla en memoria + banner de sync; reintento en el siguiente write; dos usuarios nuevos → dos filas `ledger` independientes (AC-513c).

---

## Security Design

Línea base OWASP Top 10 / ASVS L1 (NFR-501), diseñada aquí, no parcheada después:

- **Autenticación:** argon2id (parámetros OWASP) para contraseñas — nunca texto plano ni cifrado
  reversible (AC-501d). Login con error 401 genérico (sin enumeración de usuarios). Google OAuth con
  verificación de `state` (anti-CSRF del flujo) y PKCE.
- **Fuerza bruta (NFR-512):** rate limiting de Better Auth sobre las rutas de auth — ventana 60s,
  máx. 5 intentos fallidos por origen en `/sign-in/email` → 429 + evento en el log. Persistido en BD
  (sobrevive reinicio del proceso).
- **Sesión (NFR-512):** cookie `HttpOnly; Secure; SameSite=Lax`, sesión server-side en BD con
  `expires_at` (7 días, renovación deslizante); logout = invalidación real en BD (AC-503c). SameSite=Lax
  + check de `Origin` en mutaciones = defensa CSRF en profundidad.
- **Autorización (superficie crítica, FR-505):** object-level authorization estructural — `ownerId`
  solo de sesión, firma obligatoria `(ownerId, …)` en la capa de datos, 404 sin filtrar existencia.
- **Validación de input:** Zod en el borde de TODA ruta (los esquemas compartidos del dominio para el
  snapshot; esquemas por-endpoint para el resto). Inyección SQL: imposible por construcción — Drizzle
  emite queries parametrizadas; no hay SQL concatenado.
- **Cabeceras (NFR-512):** se EXTIENDE el `headers()` existente de `next.config.mjs` (preservando
  nosniff/X-Frame-Options/Referrer-Policy) con `Strict-Transport-Security: max-age=31536000;
  includeSubDomains` (solo prod tras TLS) y CSP: `default-src 'self'; frame-ancestors 'none';
  base-uri 'self'` (app same-origin, sin CDNs). **CORS:** no se emite `Access-Control-Allow-Origin`
  por defecto (same-origin estricto); `withApi()` rechaza mutaciones cuyo `Origin` no esté en el
  allowlist (`LEDGER_ALLOWED_ORIGINS`, por defecto solo el propio origen) — nunca `*`.
- **Cifrado (NFR-511):** en TRÁNSITO — TLS 1.2+ terminado en el reverse proxy/plataforma (contrato de
  despliegue) + HSTS; en desarrollo local HTTP solo en loopback. En REPOSO — cifrado a nivel de
  volumen/disco del host o storage gestionado cifrado (ADR-08): los datos financieros no quedan
  legibles para quien acceda al almacenamiento subyacente (disco/backup) sin la clave del volumen;
  las credenciales además van hasheadas (argon2id) — ilegibles incluso con la BD abierta. Los backups
  (`pg_dump`) se cifran (age/gpg) antes de salir del host. Verificado en `aitri audit security`
  pre-deploy (NFR-513).
- **Secretos:** solo variables de entorno (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`)
  validadas fail-fast al boot con Zod (`src/server/env.ts`); `.env*` en `.gitignore`; gitleaks en CI
  verifica que ningún secreto entre al árbol de fuentes (NFR-513); nada de esto llega al bundle del
  cliente (solo módulos `server-only`).
- **Gates de seguridad en CI (NFR-513):** `npm audit --audit-level=high` (SCA, falla el pipeline con
  vulnerabilidad alta/crítica) + `gitleaks` (secretos). Ambos también declarados como `quality_gates`
  en el `04_BUILD_REPORT.json` de la fase Build para que `verify-run` los re-ejecute cada ciclo.
- **XSS:** React escapa por defecto; CSP como segunda capa; la cookie HttpOnly hace que ni un XSS
  exitoso exfiltre la sesión. **SSRF/redirects:** el `callbackURL` post-login se restringe a rutas
  relativas del propio origen.

---

## Performance & Scalability

Alcance declarado: personal / multiusuario de baja concurrencia. No se diseña para escala masiva.

- **Presupuesto (NFR-506):** lectura y escritura del ledger ≤500ms. El snapshot de un usuario típico
  (~200 nodos, ~2–5k movimientos) son 3 SELECTs indexados por `owner_id` (PK compuesto) + serialización
  — decenas de ms en Postgres local/LAN; el PUT es un replace transaccional batch (DELETE por owner +
  INSERT multi-row) del mismo orden. Respuestas comprimidas (gzip/br en el proxy).
- **Roll-up del cliente intacto:** el cálculo sigue en el cliente sobre datos ya cargados — el
  guardrail ≤150ms no se toca porque esta feature no cambia ese código (NFR-507).
- **SSE barato:** el evento es `{revision}` (bytes); el costo real es el refetch del snapshot, que
  solo ocurre cuando de verdad hubo un cambio de otro dispositivo.
- **Índices:** PKs compuestos `(owner_id, id)` cubren todas las lecturas; `(owner_id, created_at DESC)`
  para el listado de movimientos; `session.token` UNIQUE para el lookup por request (O(1) por índice).
- **Pool de conexiones:** postgres.js con `max` acotado (10) — suficiente para el alcance y no agota
  Postgres con SSE de larga vida (SSE no retiene conexiones de BD, solo memoria del proceso).
- **Cotas de tamaño:** body limit 5 MB en el PUT snapshot (un ledger personal está órdenes de magnitud
  abajo); `note` ≤280 (regla existente del dominio); si el histórico de movimientos creciera hasta
  presionar el presupuesto de 500ms, la evolución natural es paginar `movements` fuera del snapshot —
  documentado como evolución, NO se construye ahora (no diseñar para hipotéticos).
- **Escalado:** vertical primero. El hub SSE en memoria ata el sync en vivo a UNA instancia — límite
  declarado y aceptado (ver Technical Risk Flags); interfaz `publish()` aislada para poder enchufar
  Redis pub/sub si algún día hay multi-instancia.

---

## Deployment Architecture

**Modelo de despliegue: contenedorizado** (declaración explícita para Fase 5). La Pi es solo un
target de laboratorio; nada del diseño la asume.

- **Imagen de la app:** Dockerfile multi-stage — `deps` (npm ci) → `build` (`next build`, output
  `standalone`) → `runner` (`node:22-alpine`, usuario no-root, `NODE_ENV=production`). Multi-arch
  (amd64/arm64) por buildx.
- **docker-compose.yml:** servicio `app` (puerto interno 3000 → publicado por env `LEDGER_PORT`;
  en el laboratorio actual: dev 3100, prod 3110 — NUNCA 3000 publicado) + servicio `db`
  (`postgres:16-alpine`, volumen nombrado `pgdata`, healthcheck `pg_isready`; `app` arranca
  `depends_on: db: condition: service_healthy`). TLS: terminado por el reverse proxy del host o la
  plataforma (nginx ya presente en prod del laboratorio; cualquier terminador estándar sirve) — el
  contenedor de la app no gestiona certificados.
- **Migraciones:** `drizzle-kit generate` versiona SQL en `drizzle/`; el entrypoint del contenedor
  ejecuta `migrate` (idempotente) antes de `node server.js` — un deploy nuevo siempre corre sobre el
  esquema correcto.
- **Configuración por entorno (12-factor):** todo por env — `DATABASE_URL`, `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL` (origen canónico), `GOOGLE_CLIENT_ID/SECRET`, `LEDGER_ALLOWED_ORIGINS`,
  `LEDGER_PORT`. Validación fail-fast al boot; en `production` las credenciales de Google son
  obligatorias (FR-502 es MUST), en dev/test opcionales (el botón se deshabilita con warning).
- **Entornos:** *dev* — `next dev` en 3100 + `docker compose up db` (solo la BD en contenedor);
  *test/CI* — Postgres como service container del workflow; *prod* — compose completo (app+db) o la
  app en cualquier PaaS/VPS + Postgres gestionado (mismo código, distinta `DATABASE_URL`).
- **CI/CD (NFR-503, NFR-513):** `.github/workflows/ci.yml` en push a `main`: `npm ci` → lint →
  typecheck → vitest (unit) → Playwright (e2e, contra build de producción + Postgres de servicio) →
  `npm audit --audit-level=high` → gitleaks. El deploy sigue siendo manual (operar el host definitivo
  está fuera de esta feature, no_go_zone).
- **Persistencia y restore (FR-512):** los datos viven en el volumen `pgdata` (o el servicio
  gestionado); reinicio del proceso/contenedor no los toca; cambio de host = mover el volumen o
  restaurar un `pg_dump` — sin rutas ni identificadores de máquina en configuración ni código.

---

## Risk Analysis

### ADRs

ADR-01: Motor de base de datos
Context: se necesita SQL portátil, multiusuario, con la preferencia declarada de docker-compose + volumen.
Option A: PostgreSQL 16 — concurrencia real de escrituras (multiusuario + writes de SSE/API sin cola global), tipos/constraints ricos, corre igual en compose (volumen) y gestionado (RDS/Neon); costo: un servicio más que operar.
Option B: SQLite (better-sqlite3/libSQL) — cero-ops, un archivo; pero single-writer (serializa TODA escritura), el "volumen portátil" pasa a ser un archivo dentro del contenedor de la app (acopla datos a la instancia), y migrar a gestionado luego = cambiar de motor.
Decision: PostgreSQL 16 — multiusuario es central desde el día uno y la preferencia de compose+volumen describe exactamente el modelo operativo de Postgres.
Consequences: habilita concurrencia y hosting gestionado sin cambiar código; agrega el servicio `db` al compose (aceptado y ya preferido en requirements).

ADR-02: Capa de acceso a datos
Context: hace falta ORM/query builder TypeScript con migraciones versionadas y queries parametrizadas.
Option A: Drizzle ORM — TS-first, SQL transparente, runtime mínimo sin binarios, migraciones SQL legibles, adapter oficial de Better Auth.
Option B: Prisma — DX madura y muy documentada; pero engine/codegen más pesado, cliente generado, y menor transparencia del SQL emitido.
Decision: Drizzle — mínima superficie nueva, SQL visible (auditable para el audit security), y encaja nativo con Better Auth.
Consequences: migraciones en `drizzle/` dentro del repo; el equipo escribe queries cercanas a SQL (curva pequeña, más control).

ADR-03: Librería de autenticación
Context: FR-501+FR-502 exigen email+contraseña Y Google OAuth con estándar profesional; preferencia: librería portátil.
Option A: Better Auth 1.x — email+password de primera clase, social providers, sesiones en BD, rate limiting y cookies seguras integrados, adapter Drizzle; framework-agnostic (portable fuera de Next si hiciera falta).
Option B: Auth.js / NextAuth v5 — muy extendida; pero el flujo credentials (email+password) es ciudadano de segunda (la propia doc lo desaconseja), y sesiones DB + credentials combinan mal.
Option C: implementación propia (lucia-style) — control total; pero reinventar auth es la fuente clásica de vulnerabilidades y Lucia mismo quedó deprecado recomendando librerías mantenidas.
Decision: Better Auth — es la única opción donde AMBOS métodos requeridos son de primera clase y el endurecimiento de NFR-512 viene integrado en vez de artesanal.
Consequences: tablas `user/session/account/verification` según su esquema; el hash se fija a argon2id vía hooks (no el scrypt por defecto) para cumplir NFR-501 literalmente.

ADR-04: Mecanismo de sesión
Context: FR-503 exige identidad por request Y logout que invalide de verdad.
Option A: sesiones server-side en BD + cookie HttpOnly — revocación real (logout = DELETE), expiración controlada; costo: un lookup por request (indexado).
Option B: JWT stateless — sin lookup; pero un JWT emitido sigue siendo válido tras "logout" salvo denylist (que reintroduce el estado que se quería evitar) — incumple AC-503c limpio.
Decision: sesiones en BD con cookie — la semántica de logout requerida solo es natural aquí.
Consequences: el lookup por request es O(1) por índice único en `session.token`; tabla de sesiones a purgar (job de limpieza de expiradas — trivial, no crítico).

ADR-05: Estilo de API
Context: FR-507 pide contrato versionado consumible por más de un cliente.
Option A: REST `/api/v1/*` — universal (cualquier cliente HTTP), versionado por prefijo explícito, encaja 1:1 con route handlers.
Option B: GraphQL — flexibilidad de queries que nadie pidió; costo alto (esquema, resolvers, N+1) para un dominio con UN agregado.
Option C: tRPC — DX excelente TS↔TS, pero acopla el contrato al cliente TypeScript — contradice "más de un cliente".
Decision: REST versionado — la opción que satisface el requisito con la menor maquinaria.
Consequences: contrato documentado en este TRD; evolución por `/api/v2` si algún día rompe compatibilidad.

ADR-06: Modelo de escritura del cliente (repo → servidor)
Context: el store persiste el estado COMPLETO en cada mutación (`save(ownerId, state)`); hay que traducirlo a red con atomicidad (FR-508) y multi-dispositivo (FR-510/511).
Option A: snapshot PUT con lock optimista por `revision` — traducción literal del contrato existente; atómico (una transacción); conflicto = 409 → re-hidratar + aviso (last-write-wins informado); costo: payload completo por write y conflictos de grano grueso.
Option B: diff-a-operaciones — el repo diffea prev/next y emite writes finos (POST/PATCH por recurso); payloads mínimos y conflictos finos; costo: motor de diff + N endpoints de mutación + tests de cada op — mucha superficie nueva para el mismo resultado observable.
Decision: Option A — a la escala declarada (dispositivos de UN usuario, SSE cerrando la ventana a segundos) los conflictos son raros; la simplicidad protege el guardrail de regresión.
Consequences: habilita FR-508 sin tocar el store más allá de `makeRepo()`; acepta que dos writes simultáneos del mismo usuario resuelvan last-write-wins (flag TRF-02); si el snapshot creciera, la evolución es paginar movimientos, no reescribir el modelo.

ADR-07: Mecanismo de sync en vivo
Context: FR-511 — cambios reflejados ≤5s en otros dispositivos del mismo usuario, mecanismo a decidir.
Option A: SSE — unidireccional (suficiente: las escrituras van por HTTP), corre en route handlers estándar (streaming), `EventSource` reconecta solo, pasa cualquier proxy HTTP.
Option B: WebSockets — bidireccional (innecesario); exige servidor custom junto a Next (pierde `next start`/standalone limpio) y más ceremonia de reconexión.
Option C: polling corto — trivial; pero tráfico constante sin cambios y latencia = intervalo; la peor relación costo/frescura.
Decision: SSE — cumple ≤5s con margen enorme, cero dependencias, cero servidor custom.
Consequences: conexiones de larga vida en memoria del proceso → el sync en vivo es single-instance (TRF-01); heartbeat 25s para proxies; FR-510 es el fallback natural si el stream muere.

ADR-08: Cifrado en reposo (NFR-511)
Context: los datos financieros no deben ser legibles en claro desde el almacenamiento subyacente; mecanismo a decidir aquí.
Option A: cifrado a nivel de volumen/disco (LUKS / storage cifrado del proveedor) + credenciales hasheadas + backups cifrados — protege disco robado/backup filtrado; la BD queda queryable; cero gestión de claves en la app.
Option B: cifrado de campo en la aplicación (AES-256-GCM sobre montos/notas/nombres) — protege incluso con acceso a la BD viva; pero introduce gestión de claves propia (el punto más fácil de hacer mal), rompe constraints/CHECKs sobre montos y complica todo el acceso a datos.
Decision: Option A — es el mecanismo estándar proporcional al alcance, cumple la acceptance literal (almacenamiento subyacente ilegible sin la clave), y no infla la superficie de error criptográfico propia.
Consequences: el cifrado del volumen pasa a ser REQUISITO del contrato de despliegue (documentado en Deployment; verificado en `aitri audit security`); backups `pg_dump` cifrados con age/gpg antes de salir del host; revisitable a Option B si el modelo de amenaza crece.

ADR-09: Semilla del usuario nuevo (FR-513)
Context: un usuario nuevo debe abrir un ledger utilizable; ¿siembra el servidor o el cliente?
Option A: el cliente reutiliza `buildSeed()` compartido tras un GET 204 y persiste — el flujo `hydrate()` actual sin cambios de dominio; la semilla vive en UN solo lugar.
Option B: el servidor siembra al registrarse — el primer GET ya trae datos; pero duplica la semilla en el servidor (o importa dominio al registro), y acopla el registro a la forma del ledger.
Decision: Option A — cero duplicación, cero cambio del flujo existente; "utilizable de inmediato" se cumple igual (la semilla aparece en el primer render).
Consequences: la fila `ledger` nace en el primer PUT, no en el registro; un usuario que se registra y jamás abre la app no tiene filas de ledger (correcto y más limpio).

### Top risks

1. **Regresión de la superficie existente al meter auth delante de todo** — la app entera pasa a vivir
   tras login. Mitigación: el único punto tocado del flujo actual es `makeRepo()`; el login gate
   envuelve el shell sin tocar grilla/registro/dashboard; NFR-507/508/509 exigen las suites previas
   verdes y son gates duros.
2. **Pérdida de un write concurrente entre dispositivos (LWW de snapshot)** — mitigado con `revision`
   + 409 + re-hidratación con aviso, y la ventana real la cierra SSE (≤5s). Aceptado a esta escala
   (TRF-02).
3. **OAuth de Google en e2e/CI** — el consentimiento real no es automatizable. Mitigación: los e2e
   core usan email+contraseña; del flujo Google se testean callback inválido/denegado (sin Google
   real) y la configuración; el happy path Google se verifica manual (TC marcado manual con
   evidencia).
4. **Deriva del contrato Zod cliente/servidor** — mitigado por construcción: son los MISMOS módulos
   compartidos (`src/domain/validation.ts`), no dos copias.
5. **Operación de Postgres (backups, upgrades)** — nuevo costo operativo. Mitigación: compose +
   volumen nombrado + `pg_dump` cifrado documentado; el motor es el estándar con más tooling que
   existe.

---

## Failure Blast Radius

Component: PostgreSQL
Blast radius: toda lectura/escritura del ledger y la resolución de sesiones (están en BD); el SSE hub sigue vivo pero no hay writes que publicar.
User impact: la app carga pero las operaciones de datos fallan → banner de error de sincronización no bloqueante; el estado en memoria del dispositivo sigue visible y coherente; login/logout indisponibles (503).
Recovery: reintento en el próximo write/hydrate (el repo devuelve `false`, nunca corrompe); `depends_on + healthcheck` en compose relanza el orden correcto; datos intactos en el volumen `pgdata`.

Component: Capa de auth (Better Auth + tabla session)
Blast radius: emisión/validación de sesiones — sin ella, toda `/api/v1/*` responde 401.
User impact: usuarios sin sesión no pueden entrar; usuarios con app abierta ven fallos de datos como errores de sync (sus requests dejan de resolver identidad).
Recovery: al restaurarse la BD/servicio las cookies existentes vuelven a resolver (las filas `session` persisten); no hay estado de auth en memoria del proceso.

Component: SSE Hub (en memoria)
Blast radius: SOLO el sync en vivo (FR-511); escrituras, lecturas y sync-al-recargar (FR-510) intactos.
User impact: el otro dispositivo no se refresca solo; todo lo demás funciona; al recargar ve el dato.
Recovery: `EventSource` reconecta con backoff automático; al reconectar el cliente compara `revision` y re-hidrata si quedó atrás — la degradación es exactamente FR-510.

Component: Google OAuth (dependencia externa)
Blast radius: SOLO el login con Google; email+contraseña y todas las sesiones ya emitidas siguen operando.
User impact: error manejado en la pantalla de login ("Google no disponible, usa email+contraseña").
Recovery: sin intervención — depende del proveedor; el producto nunca depende de Google para operar, solo para ese flujo de entrada.

---

## Technical Risk Flags

[RISK] TRF-01 — Sync en vivo atado a una sola instancia
Conflict: FR-511 requiere entrega de eventos a todos los dispositivos del usuario, pero el hub SSE vive en la memoria del proceso: con 2+ instancias detrás de un balanceador, un write en la instancia A no notifica a un stream conectado a la B.
Mitigation: el alcance declarado es baja concurrencia single-instance (project_summary); el compose despliega UNA instancia de app; `publish()` queda aislado tras una interfaz para enchufar Redis pub/sub si multi-instancia se volviera requisito. Además el fallback estructural es FR-510 (sync al recargar).
Severity: low

[RISK] TRF-02 — Last-write-wins de snapshot puede descartar un write concurrente
Conflict: FR-510/FR-511 prometen "el mismo dataset", pero con PUT de estado completo (ADR-06) dos escrituras simultáneas desde dos dispositivos del mismo usuario resuelven por descarte del perdedor (409 → re-hidratar), no por merge.
Mitigation: `revision` + 409 garantiza que NADA se pisa silenciosamente (el perdedor re-hidrata y ve el estado ganador + aviso); SSE reduce la ventana de conflicto a segundos; es un producto de UN usuario por cuenta editando, no colaboración concurrente (no_go_zone excluye compartir).
Severity: medium

[RISK] TRF-03 — SSE y hub en memoria excluyen targets serverless
Conflict: NFR-510 exige correr "en cualquier host estándar", pero funciones serverless (Lambda/Vercel functions) matan conexiones de larga vida y no comparten memoria — el sync en vivo no funcionaría ahí.
Mitigation: el modelo de despliegue se declara CONTENEDOR de larga vida (Deployment Architecture) — VPS, PaaS de contenedores, o la Pi: todos estándar. Serverless queda explícitamente fuera del contrato de despliegue v1; si se quisiera, el camino es polling (ADR-07 Option C) o un servicio de realtime externo.
Severity: medium

[RISK] TRF-04 — Cifrado en reposo delegado al volumen (no a la app)
Conflict: NFR-511 exige datos financieros ilegibles desde el almacenamiento subyacente, pero con ADR-08 la garantía depende de que el DESPLIEGUE cumpla el contrato (volumen/disco cifrado), no del código.
Mitigation: requisito explícito del contrato de despliegue + backups cifrados por diseño + credenciales siempre argon2id (esas son ilegibles incluso con BD viva); `aitri audit security` pre-deploy verifica la postura real del host (NFR-513); ADR-08 deja el upgrade a cifrado de campo como evolución si el modelo de amenaza crece.
Severity: medium

[RISK] TRF-05 — El happy path de Google OAuth no es automatizable en CI
Conflict: NFR-503 exige la suite completa en CI, pero el consentimiento real de Google requiere un humano/credenciales vivas — un e2e de OAuth real sería flaky o guardaría secretos de una cuenta real en CI.
Mitigation: los e2e cubren email+password end-to-end y los caminos NEGATIVOS de OAuth (callback denegado/state inválido — no requieren Google real, AC-502c); el happy path Google se verifica manual con evidencia (`aitri tc mark-manual` + `tc verify`), visible y auditado en vez de fingido.
Severity: low

[RISK] TRF-06 — Crecimiento del snapshot vs presupuesto de 500ms
Conflict: NFR-506 fija ≤500ms por operación, pero GET/PUT `/api/v1/ledger` transfieren TODOS los movimientos: un histórico de años podría presionar el presupuesto (serialización + red).
Mitigation: a la escala del producto (ledger personal, miles de movimientos = ~1–2 MB sin comprimir, ~100–200 KB gzip) el presupuesto se cumple con margen; cotas medidas en los TCs de NFR-506; la evolución declarada (paginar movimientos fuera del snapshot) queda documentada y NO se construye ahora.
Severity: low

---

## Traceability Checklist

- [x] **FR-501..FR-513 → componente:** FR-501/502/503 → Better Auth + tablas auth (ADR-03/04); FR-504 → `withApi()`; FR-505 → capa de datos con firma `(ownerId,…)` + 404; FR-506 → esquema Postgres (Data Model); FR-507 → API `/api/v1` (ADR-05); FR-508 → `ServerRepository` + `makeRepo(session)` (ADR-06); FR-509 → split localStorage + limpieza de llaves legadas; FR-510 → hydrate desde snapshot; FR-511 → SSE Hub (ADR-07); FR-512 → volumen `pgdata` + env-only config; FR-513 → seed en cliente (ADR-09).
- [x] **Implementation Approach:** entrada real (método/I-O/failure) para los 13 MUST FRs; FR-506 marcado explícitamente self-evident from Data Model.
- [x] **NFRs → decisión de diseño:** NFR-501/511/512/513 → Security Design; NFR-502 → log en `withApi()`; NFR-503 → CI workflow; NFR-504 → `/health`; NFR-505/510 → volumen + env fail-fast; NFR-506 → Performance; NFR-507/508/509 → cero cambios de dominio/UI + suites previas como gate.
- [x] **ADRs:** 9 ADRs, todos con ≥2 opciones evaluadas.
- [x] **no_go_zone respetado:** sin apps/almacenamiento nativo; sin lock-in de hosting (contenedor estándar + env); sin roles/compartición (el aislamiento es por usuario único); sin cambios de UI/dominio/roll-ups (solo se agrega login gate y repo — la mutación pura compartida corre en servidor SOLO para la superficie multi-cliente de escritura; el cálculo/balance jamás); sin migración de localStorage (limpieza ≠ migración); el cálculo sigue en el cliente.
- [x] **Failure Blast Radius:** 4 componentes críticos documentados (BD, auth, SSE hub, OAuth externo).
- [x] **Technical Risk Flags:** 6 flags declarados con mitigación y severidad.
