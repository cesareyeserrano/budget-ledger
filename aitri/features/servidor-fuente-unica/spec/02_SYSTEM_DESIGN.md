# Technical Design Document (TRD / SDD) — servidor-fuente-unica

## Executive Summary

Esta feature es **sustractiva**: no agrega capacidades, retira un camino de persistencia. Elimina el
interruptor `NEXT_PUBLIC_LEDGER_SERVER_MODE` y el repositorio de `localStorage` del camino de
producción, dejando Postgres como única fuente de verdad, la sesión como obligatoria, y `localStorage`
restringido a preferencias del dispositivo.

**El origen del flag importa para entender qué se retira.** `src/lib/serverMode.ts` se documenta a sí
mismo como *"Interruptor de despliegue del backend. OFF (default) → la app se comporta EXACTAMENTE
como antes (localStorage, cliente-puro): cero regresión en la suite existente (NFR-509)"*. Es decir:
`SERVER_MODE` **nunca fue una elección de producto**, fue el andamio de rollout con el que la feature
`backend` introdujo el servidor sin romper la suite existente. El rollout terminó — el entorno de
desarrollo corre con el flag en ON contra Postgres, y las 10 features posteriores se construyeron
sobre ese supuesto. Esta feature retira el andamio.

Sin cambios de stack, sin dependencias nuevas, sin cambios de esquema y sin endpoints nuevos. El
trabajo es eliminación de ramas, unificación de un punto de construcción, adopción del sistema de
diseño en una pantalla, y una re-cimentación de cuatro archivos de test que hoy se apoyan en la clase
que desaparece.

**Cobertura de requisitos:** FR-1101, FR-1102, FR-1103, FR-1104, FR-1105, FR-1106, FR-1107, FR-1108 ·
NFR-1101…NFR-1108.

---

## System Architecture

### Estado actual (el que se retira)

```
                      ┌─────────────────────────────────────────┐
                      │  NEXT_PUBLIC_LEDGER_SERVER_MODE          │  ← flag de rollout
                      └──────────────┬──────────────────────────┘
                    OFF ─────────────┴───────────── ON
                     │                               │
        ┌────────────▼─────────────┐    ┌────────────▼──────────────┐
        │ LoginGate = passthrough  │    │ ServerGate: sesión + sync │
        │ (sin sesión)             │    │ SSE + hydrate tras auth   │
        └────────────┬─────────────┘    └────────────┬──────────────┘
        ┌────────────▼─────────────┐    ┌────────────▼──────────────┐
        │ LocalStorageRepository   │    │ ServerRepository → API    │
        │ ledger.nodes / .budget   │    │ → Postgres                │
        └──────────────────────────┘    └───────────────────────────┘

        ⚠ Punto de swap DUPLICADO y en conflicto:
          store.ts:69      decide por SERVER_MODE      ← el que corre
          data/makeRepo.ts decide por `authenticated`  ← huérfano; solo lo usa un test
```

### Estado objetivo

```
   ┌──────────────────────────────────────────────────────────────┐
   │ app/page.tsx  →  <LoginGate>                                  │
   │                    ├─ isPending → <AuthPending/>              │
   │                    ├─ sin sesión → <AuthForm/>   (P-1)        │
   │                    └─ con sesión → hydrate() + SyncClient     │
   │                                     + <LogoutButton/> (P-2)   │
   │                                     + <ShellSwitch/>          │
   └───────────────────────────┬──────────────────────────────────┘
                               │  único punto de construcción (store.ts)
                   ┌───────────▼────────────┐
                   │ SSR (sin window)? → null│
                   │ si no → ServerRepository│
                   └───────────┬────────────┘
                               │  fetch same-origin
                   ┌───────────▼────────────┐
                   │ /api/v1/*  (sesión ⇒   │
                   │  401 sin cookie)        │
                   └───────────┬────────────┘
                   ┌───────────▼────────────┐
                   │ Drizzle → Postgres      │  ← única fuente de verdad
                   └─────────────────────────┘

   localStorage (superficie superviviente, solo preferencias del dispositivo):
     · `theme`         — providers.tsx, next-themes
     · ancho columna   — lib/gridWidth.ts
     ✗ `ledger.nodes.v1`, `ledger.budget.v4`  → retirados del camino de escritura
```

### Componentes y responsabilidades

| Componente | Responsabilidad | Cambio |
|---|---|---|
| `app/page.tsx` | Selección de shell (móvil/escritorio) por breakpoint 760px | Deja de hidratar: elimina `if (!SERVER_MODE) void hydrate()`. La hidratación es siempre del gate |
| `components/auth/LoginGate.tsx` | Sesión, hidratación tras auth, ciclo de vida del `SyncClient`, logout | `LoginGate` deja de bifurcar; pasa a ser lo que hoy es `ServerGate`. Se colapsan los dos componentes en uno |
| `components/auth/AuthForm.tsx` | Formulario de acceso (P-1) | Adopta el sistema de diseño (FR-1108). Cero cambio de comportamiento |
| `components/ui/input.tsx` | **Nuevo** primitivo compartido de campo | Extrae el patrón que el sistema ya usa; misma construcción `cva` que `Button` |
| `components/auth/LogoutButton.tsx` | Control de sesión (P-2) | Extraído del JSX inline del gate; `Button` variante `ghost` |
| `state/store.ts` | Estado en memoria + único punto de construcción del repositorio | Construye `ServerRepository` sin ramas por modo; `resync` ante 409, limpieza de `ledger.*` y seam de test dejan de estar tras el flag |
| `lib/serverMode.ts` | — | **Eliminado** |
| `data/makeRepo.ts` | — | **Eliminado** (ver ADR-02) |
| `data/repository.ts` | Contrato `LedgerRepository` + impl localStorage + `stripLegacyUnassigned` | Conserva **solo** la interfaz `LedgerRepository`. Salen de `src/` la clase y `stripLegacyUnassigned` (ADR-03) |
| `domain/migrate.ts` | Conversión v3→v4 del modelo de reservas | **Sin cambios — se conserva.** Tiene un consumidor vivo en el servidor (`ensureV4InTx`); solo desaparece su llamador de localStorage (ADR-04 corregido) |
| `data/serverRepository.ts` | Impl contra la API | Sin cambios |

---

## Data Model

**Sin cambios de esquema.** Esta feature no altera ninguna tabla de Postgres, ningún tipo del dominio
ni ningún contrato de datos. El modelo v4 de reservas permanece intacto (NFR-1105).

Lo que sí cambia es **qué espacios de almacenamiento existen**:

| Espacio | Contenido | Antes | Después |
|---|---|---|---|
| Postgres (`nodes`, `cells`, `movements`, `journal`, `user`, `session`, `account`) | Todo dato del usuario | Fuente de verdad **solo** con el flag en ON | **Única** fuente de verdad, siempre |
| `localStorage["ledger.nodes.v1"]` | Jerarquía de nodos | Fuente de verdad con el flag en OFF | **Retirado**; se conserva su `removeItem` de limpieza (ADR-05) |
| `localStorage["ledger.budget.v4"]` | Presupuesto y ejecutado | Ídem | Ídem |
| `localStorage["theme"]` | Preferencia de tema | Preferencia | **Sin cambio** — preferencia del dispositivo (NFR-1101) |
| `localStorage[CAT_WIDTH_KEY]` | Ancho de la columna de categorías | Preferencia | **Sin cambio** (NFR-1101) |

`STORAGE_KEYS` (`domain/types.ts:75-81`) **sobrevive** como constante, porque la rutina de limpieza
necesita los nombres de las claves a borrar. Lo que desaparece es su uso en el camino de **escritura**
— exactamente lo que exige FR-1104 (*"del camino de escritura"*, no de la existencia).

`LEGACY_BUDGET_KEYS` (las claves `ledger.budget.v2`/`v3` de `localStorage`) **sí** se retira: pertenece
al almacén que desaparece. La **conversión** v3→v4 (`domain/migrate.ts`) es otra cosa y **se conserva**
— sigue viva en el servidor con marca por columna `dataVersion` (ADR-04 corregido).

---

## API Design

**Sin endpoints nuevos.** La feature no toca el contrato de la API. Se documenta el contrato existente
porque pasa a ser el **único** camino de datos, y porque FR-1102/NFR-1106 dependen de su comportamiento
sin sesión.

| Endpoint | Método | Payload | Respuesta | Sin sesión |
|---|---|---|---|---|
| `/api/v1/ledger` | `GET` | — | `{ nodes, budgets, actuals, movements, journal, version }` | **401**, cuerpo sin datos |
| `/api/v1/ledger` | `PUT` | `LedgerState` completo + `version` | `200 { version }` · `409` si `version` es stale | **401** |
| `/api/v1/movements` | `GET` | — | `Movement[]` ordenado | **401** |
| `/api/v1/sync` (SSE) | `GET` | — | stream de eventos de invalidación | **401** |
| `/api/auth/[...all]` | `*` | better-auth | sesión en cookie `HttpOnly/Secure/SameSite` | n/a |

**Contrato de fallo relevante para el diseño:** un `PUT` que devuelve `409` (stale) dispara
`resync()` en el cliente (ADR-06 de la feature `backend`). Esta rama vive hoy dentro de
`if (SERVER_MODE)` en `store.ts:85` y **debe sobrevivir como incondicional** — es el riesgo #1 de
esta feature (ver Risk Analysis) y la razón de ser de NFR-1103.

---

## Implementation Approach

### FR-1101 · Punto único de construcción del repositorio

- **Método:** eliminar `src/lib/serverMode.ts` y `src/data/makeRepo.ts`. En `store.ts`, `makeRepo()`
  privada queda como única constructora, sin rama por modo.
- **Entrada:** ninguna (lee `typeof window`).
- **Salida:** `LedgerRepository | null` — `null` **solo** en SSR.
- **Fallo:** en SSR devuelve `null`; `hydrate()` ya trata `!repo` marcando `hydrated: true` sin cargar
  (`store.ts:183-186`). Sin excepción, sin pantalla rota.

```ts
// store.ts — única constructora, cero ramas de producto
function makeRepo(): LedgerRepository | null {
  if (typeof window === "undefined") return null; // SSR: no hay repo, el gate aún no montó
  return new ServerRepository();
}
```

### FR-1102 · Sesión obligatoria

- **Método:** `LoginGate` absorbe `ServerGate`; se elimina `if (!SERVER_MODE) return <>{children}</>`.
- **Entrada:** `useSession()` de better-auth.
- **Salida:** `isPending → <AuthPending/>` · `!session → <AuthForm/>` · `session → app + sync`.
- **Fallo:** si `useSession()` falla, `session` es nulo → se muestra el formulario. **Fail-closed**: el
  modo degradado es pedir credenciales, nunca mostrar datos.
- **Nota de defensa en profundidad:** el gate es de cliente. La barrera real es la API, que ya responde
  401 sin cookie (FR-504). El gate evita mostrar el shell; la API evita entregar los datos. Ninguna de
  las dos se apoya en la otra.

### FR-1103 · Postgres única fuente de verdad

- **Método:** `store.ts` importa solo `ServerRepository`. Se elimina el import de
  `LocalStorageRepository`.
- **Entrada / salida:** contrato `LedgerRepository` sin cambios (`load`, `save`).
- **Fallo:** `save` que rechaza o devuelve `false` → aviso no bloqueante; ante `409`, `resync()`. **No
  hay fallback a localStorage** — es un criterio de aceptación negativo explícito (FR-1103).

### FR-1104 · localStorage solo preferencias

- **Método:** ningún módulo de `src/` escribe `STORAGE_KEYS.*`. Se conserva el `removeItem` de limpieza
  en `hydrate()`, ahora incondicional (ADR-05).
- **Fallo:** `localStorage` indisponible → el `try/catch` existente ya lo absorbe; los datos del usuario
  no dependen de él (FR-1104, criterio edge).

### FR-1105 · Retiro declarado de la migración local

- **Método:** salen de `src/` `LocalStorageRepository` y `stripLegacyUnassigned`. Se conservan
  `LedgerRepository` (la interfaz), `STORAGE_KEYS` y **`migrateStateV3toV4`** (ver ADR-04 corregido:
  tiene un consumidor vivo en el camino de servidor). Se retira `LEGACY_BUDGET_KEYS`.
- **Declaración exigida por el FR** — se registra aquí, que es el artefacto de diseño:
  - **Qué se retira:** la migración v2→v3→v4 de `localStorage` y el saneador de nodos `system`.
  - **Qué queda sin migración:** nodos `system` heredados ("Sin asignar") que existieran en Postgres.
    El path de servidor **nunca tuvo** migración equivalente: `ledgerRepo.ts:53` los lee y `:223` los
    reescribe tal cual. `stripLegacyUnassigned` era el único saneador y solo corría en el path local.
  - **Por qué se acepta:** el usuario confirmó (2026-07-30) que no hay usuarios reales; la única data
    viva es la de dev en Postgres, creada después del modelo actual.
  - **Consecuencia sobre BL-018:** las ramas `!node.system` de `mutations.ts:146-154`,
    `BudgetGrid.tsx:383-436`, `ReserveRow.tsx:43` y `CategoryRow.tsx:40` **se conservan**. Su premisa
    original ("inalcanzables") era falsa; ahora son defensivas ante datos legados de Postgres que nadie
    sanea. Se conservan a propósito, no por olvido.
- **Destino de la migración v3→v4 (decisión exigida por AC-1105b):** se **conserva**. Corregido
  durante el Epic 2 tras verificarlo en el código: `migrateStateV3toV4` **ya tiene un consumidor vivo
  en el servidor** (`ensureV4InTx`, `src/server/data/ledgerRepo.ts:161-207`), dentro de una
  transacción con lock y marcada por la columna `dataVersion`. Lo que se retira es su llamador de
  `localStorage` (`data/repository.ts:68`) y las claves legadas `LEGACY_BUDGET_KEYS`. Ver ADR-04.

### FR-1106 · La cobertura apunta al código que corre

Decisión por archivo (exigida por AC-1106c):

| Archivo | Usos | Decisión | Razón |
|---|---|---|---|
| `tests/integration/backend/repo-sync.test.ts` | `makeRepo` | **Re-apuntar** a la constructora de `store.ts` + `ServerRepository` | Es el TC de FR-508; hoy prueba un huérfano (pass falso) |
| `tests/integration/persistence.test.ts` | ~15 | **Re-apuntar** a `InMemoryRepository` (fake) + añadir cobertura de robustez contra `ServerRepository` | Ver ADR-03 y RISK-2: cubre NFR-003 raíz, que no puede quedar huérfano |
| `tests/integration/feature-stack.test.ts` | 3 | **Re-apuntar** a `InMemoryRepository` | Usa el repo como doble de conveniencia, no prueba localStorage |
| `tests/integration/reserve-migration.test.ts` | 4 | **Re-apuntar** a `ensureV4InTx` (camino de servidor) | **Corregido**: la migración v3→v4 sigue viva en `server/data/ledgerRepo.ts:161`. El sujeto no desaparece — solo el vehículo de localStorage con que se probaba |
| `tests/e2e-backend/helpers/globalSetup.ts` | flag | **Re-apuntar**: deja de configurar `NEXT_PUBLIC_LEDGER_SERVER_MODE` | El modo ya no existe (NFR-1108) |

### FR-1107 · Descripción pública

- **Método:** actualizar `metadata.description` en `app/layout.tsx:23`.
- **Fallo:** ninguno — string estático.

### FR-1108 · Sistema de diseño en la pantalla de acceso

- **Método:** crear `components/ui/input.tsx` (`cva`, misma forma que `button.tsx`); reescribir
  `AuthForm` con `Input`/`Button` y clases del sistema; extraer `LogoutButton`; unificar los **dos**
  indicadores de carga duplicados (`LoginGate.tsx:17-23` y `page.tsx:29-36`, ambos con `style` inline y
  el mismo contenido) en un único `AuthPending`.
- **Entrada / salida:** sin cambios de props ni de comportamiento.
- **Fallo:** ninguno funcional. El riesgo es de regresión de test (ver RISK-1): los `data-testid`,
  `aria-label`, `autoComplete` y textos de error se conservan **literales**.

### NFR-1101…NFR-1108

Cubiertos por lo anterior más: preservar `providers.tsx` y `gridWidth.ts` intactos (NFR-1101); no tocar
better-auth (NFR-1102); volver incondicional la rama de `resync` (NFR-1103); suite completa verde
(NFR-1104, NFR-1105); API 401 sin sesión (NFR-1106); grep a cero de `SERVER_MODE`/`LocalStorageRepository`
en `src/` (NFR-1107); `globalSetup.ts` sin el flag (NFR-1108).

---

## Architecture Decision Records

### ADR-01 · Cómo retirar el flag de rollout

- **Opción A — Eliminar `serverMode.ts` y todas sus ramas.** Cada `if (SERVER_MODE)` se resuelve a su
  rama ON. Superficie a cero; obliga a revisar las 12 referencias una a una.
- **Opción B — Dejar `SERVER_MODE = true` como constante.** Cambio de una línea, riesgo mínimo
  inmediato; deja 12 ramas muertas, un flag mentiroso y **viola** el criterio medible de FR-1101
  (grep = 0).

**Decisión: A.** B contradice el North Star KPI de la feature y deja exactamente la clase de código
fósil que esta ronda de deuda existe para eliminar.

**Consecuencias:** obliga a auditar las 12 referencias, lo cual es deseable — dos de ellas
(`resync` ante 409, limpieza de `ledger.*`) contienen lógica que debe sobrevivir y que una eliminación
mecánica del `if` borraría con el flag. Ese es RISK-1.

### ADR-02 · Destino de `data/makeRepo.ts`

- **Opción A — Unificar: `store.ts` pasa a usar `makeRepo.ts`,** extendido para cubrir SSR + servidor.
  Deja un módulo con nombre explícito para el punto de construcción.
- **Opción B — Eliminar `makeRepo.ts`; `store.ts` construye directamente.** El "punto de swap" deja de
  existir como concepto: sin ramas de producto no hay decisión que encapsular.

**Decisión: B.** Una fábrica cuya única condición es `typeof window === "undefined"` es ceremonia, no
abstracción. El criterio de FR-1101 es *un solo punto de construcción*, y `store.ts` lo es — el único
consumidor real. Mantener un módulo aparte reintroduciría la posibilidad de que vuelvan a divergir,
que es precisamente el defecto que se está corrigiendo.

**Consecuencias:** `repo-sync.test.ts` debe re-apuntarse (FR-1106). Si en el futuro reaparece una
segunda implementación (p. ej. modo offline real), se reintroduce una fábrica **con** su decisión
explícita — no se hereda una vacía.

### ADR-03 · Qué usan los tests que hoy dependen de `LocalStorageRepository`

- **Opción A — Conservar `LocalStorageRepository` en `src/` solo para tests.** Cambio mínimo en los
  tests; **viola** NFR-1107 (grep a cero en `src/`) y deja producción con una clase que nadie usa.
- **Opción B — Apuntar todo a Postgres.** Máxima fidelidad; convierte tests unitarios rápidos en tests
  de integración que exigen base levantada, y los vuelve lentos y frágiles por una razón ajena a lo que
  verifican.
- **Opción C — `InMemoryRepository` como fake en `tests/`.** Implementa `LedgerRepository` en memoria.
  Los tests que solo necesitaban *un repositorio cualquiera* siguen siendo rápidos; `src/` queda limpio.

**Decisión: C**, con B **selectivamente** donde el test verifica persistencia real (`repo-sync.test.ts`
→ `ServerRepository`).

**Consecuencias:** el fake vive en `tests/`, no en `src/`, así que no cuenta como superficie de
producción. Riesgo asumido: un fake puede divergir del contrato real; se acota porque implementa la
interfaz `LedgerRepository`, que TypeScript verifica en compilación.

### ADR-04 · Destino de la migración v3→v4

> **CORREGIDO durante el Epic 2 (2026-07-30).** La primera redacción de este ADR afirmaba que la
> migración solo existía en `localStorage` y que portarla a Postgres sería "código muerto nuevo".
> **Es falso, y verificado en el código:** la migración v3→v4 **ya vive y está activa en el camino de
> servidor**. `src/server/data/ledgerRepo.ts:161-207` (`ensureV4InTx`) invoca `migrateStateV3toV4`
> dentro de una transacción que ya sostiene el lock de la fila ancla, con la marca en la columna
> `dataVersion` (3 = saldos, 4 = flujos). Su propio comentario registra que la comparten `loadLedger`
> e `insertMovement` por un **hallazgo adversarial previo**: "un POST sobre un ledger v3 sin migrar
> leería saldos como aportes". Ejecutar la decisión original habría **roto una migración
> transaccional de producción** ya endurecida por un bug encontrado a mano.

- **Opción A — Retirar `src/domain/migrate.ts` entero.** ❌ **Inviable**: rompe `ensureV4InTx` en el
  servidor. Descartada por hecho, no por criterio.
- **Opción B — Conservar `migrate.ts` y retirar únicamente su llamador de `localStorage`.** El módulo
  de dominio sobrevive porque tiene un consumidor vivo y crítico; lo que desaparece es la invocación
  desde `data/repository.ts:68`.
- **Opción C — Duplicar la lógica dentro del servidor y retirar el módulo compartido.** Elimina el
  módulo de `domain/` a cambio de duplicar una conversión delicada. Rechazada: la duplicación de
  lógica de migración es exactamente cómo divergen dos caminos (el defecto que ADR-02 corrige).

**Decisión: B.** La migración de dominio es compartida y sigue teniendo un consumidor real. Esta
feature retira un *almacén*, no la capacidad de migrar datos.

**Consecuencias:**
- `src/domain/migrate.ts` **se conserva intacto**, igual que su export en `src/domain/index.ts`.
- `tests/integration/reserve-migration.test.ts` **NO se retira**: se **re-apunta al camino de
  servidor**. Su sujeto (la conversión v3→v4) sigue vivo; lo que muere es el vehículo con el que lo
  ejercitaba. Retirarlo habría dejado sin cobertura una migración transaccional en producción.
- `LEGACY_BUDGET_KEYS` (las claves `ledger.budget.v2/v3` de `localStorage`) **sí** se retiran: esas
  son del almacén que desaparece, no de la conversión.

### ADR-05 · Qué hacer con la limpieza de claves `ledger.*`

- **Opción A — Conservar el `removeItem` en `hydrate()`, ahora incondicional.** Un navegador con restos
  del modo anterior queda limpio al primer arranque. Coste: dos llamadas por hidratación.
- **Opción B — Eliminarlo también.** Si nada escribe esas claves, nada hay que borrar — salvo lo que ya
  esté escrito de antes.

**Decisión: A.** FR-1104 exige que *tras cualquier flujo* no exista ninguna clave `ledger.*`; con B, un
navegador con restos previos **fallaría** ese criterio. Además es la única red de seguridad que queda
tras descartar la ruta de importación, y cuesta dos `removeItem` envueltos en `try/catch`.

**Consecuencias:** `STORAGE_KEYS` sobrevive como constante (solo nombres de clave a borrar), lo cual es
compatible con FR-1104, que prohíbe su uso en **escritura**.

### ADR-06 · Dónde vive la hidratación

- **Opción A — Solo en el gate, tras autenticar.** Una sola ruta; `page.tsx` deja de hidratar.
- **Opción B — Mantener la doble entrada** (gate y `page.tsx`), con `page.tsx` comprobando sesión.

**Decisión: A.** B reproduce la duplicación que esta feature elimina, y abre la puerta a una carrera:
dos hidrataciones concurrentes sobre el mismo store.

**Consecuencias:** `page.tsx` queda como selección de shell pura. `ShellSwitch` solo monta bajo sesión
válida, así que `hydrated` ya no puede quedarse colgado sin repo.

---

## Security Design

**Fronteras de confianza**

```
  Navegador (NO confiable)  │  Servidor Next.js (confiable)  │  Postgres (confiable)
  ─────────────────────────┼───────────────────────────────┼──────────────────────
  AuthForm, store, UI      │  /api/v1/* + better-auth       │  datos por ownerId
  localStorage: SOLO prefs │  valida sesión en CADA request │
```

| NFR / FR | Control |
|---|---|
| **FR-1102** (sesión obligatoria) | Gate de cliente **fail-closed** (sin sesión → formulario) + 401 de la API. Dos barreras independientes |
| **NFR-1106** (sin dato sin sesión) | La API ya exige sesión (FR-504) y filtra por `ownerId` (FR-505). El cliente no pide datos hasta tener sesión |
| **FR-1104** (superficie del navegador) | Retirar datos financieros de `localStorage` **reduce** la superficie de XSS: lo que no está almacenado no se puede exfiltrar del almacén |
| Sesión | **Sin cambios** — better-auth: cookie `HttpOnly/Secure/SameSite`, sesión en BD (logout la invalida de verdad, ADR-04 de `backend`), argon2id con parámetros OWASP, rate limit 5/60s |
| Validación de entrada | **Sin cambios** — Zod en el borde de la API |

**Exclusiones declaradas en Fase 1, restadas aquí:** el endurecimiento de la postura de despliegue
(HSTS, cabeceras) y la verificación de TLS quedan fuera (NFR-511 de `backend`, TC-BE-077h pendiente de
verificación manual). La recuperación de contraseña queda fuera (BL-020). **Ninguna de las dos se
introduce en esta arquitectura**, conforme al no_go_zone.

**Nota de postura, no de alcance:** al volverse el login obligatorio, la ausencia de recuperación de
contraseña deja de ser una molestia y pasa a ser un riesgo de bloqueo total del usuario. No es un
defecto de esta feature, pero esta feature **eleva su severidad**. Registrado como BL-020 (P1).

---

## Performance & Scalability

Sin objetivos nuevos. Efectos medibles del cambio:

| Efecto | Dirección | Nota |
|---|---|---|
| Bundle de cliente | ↓ | Salen `LocalStorageRepository`, `stripLegacyUnassigned`, `migrateStateV3toV4`, `serverMode` |
| Ramas en caliente | ↓ | 12 comprobaciones de flag eliminadas |
| Latencia de primer dato | **=** | El entorno real ya corría en modo servidor; no cambia el número de saltos |
| Hidrataciones por arranque | ↓ (1, antes potencialmente 2) | ADR-06 elimina la doble entrada |
| Escrituras | **sin cambio** | La serialización de escrituras (BL-010) y la escritura incremental (BL-017) son **otra feature** — explícitamente fuera |

NFR-103 raíz (rendimiento de roll-up/edición) no se toca: esta feature no entra en la grilla.

---

## Deployment Architecture

Sin cambios de topología: Next.js 15 en Docker + Nginx como reverse proxy, Postgres al lado.

**Cambio de configuración — es lo único que toca despliegue:**

| Variable | Antes | Después |
|---|---|---|
| `NEXT_PUBLIC_LEDGER_SERVER_MODE` | Obligatoria en `true` para el comportamiento correcto | **Se retira.** Debe salir de `.env.local`, del compose, del CI y de la documentación de despliegue (NFR-1107) |
| `DATABASE_URL`, `BETTER_AUTH_*` | Requeridas | **Ahora críticas sin alternativa**: no existe modo degradado sin base (ver Blast Radius) |

**Blast radius — Postgres caído**
- **Antes:** con el flag en OFF la app arrancaba igual sobre localStorage.
- **Después:** sin base **no hay app**. El gate muestra el formulario; el login falla contra la BD de
  sesiones; el usuario ve "Error de red".
- **Contención:** fallo limpio y legible, sin pantalla en blanco ni datos corruptos; recuperación
  automática al volver la base (sin estado local que reconciliar).
- **Aceptado a conciencia:** es la consecuencia directa de "una sola fuente de verdad", que es el
  objetivo de la feature. El modo degradado que desaparece nunca fue un modo degradado real —
  guardaba en otro sitio, no los mismos datos.

**Blast radius — capa de autenticación caída (better-auth / tabla `session`)**
- Nadie entra: el gate es fail-closed. Las sesiones vigentes caen en la siguiente validación.
- **No hay bypass** — es un criterio de aceptación negativo de FR-1102 (ninguna variable permite saltar
  el gate). El precio de eliminar el passthrough es que no existe puerta trasera, ni para un incidente.
- **Contención:** los datos en Postgres quedan intactos; el acceso se restablece al restaurar el
  servicio.

---

## Risk Analysis

### RISK-1 — Lógica viva sepultada bajo el flag (severidad: **alta**)

Tres bloques con lógica que **debe sobrevivir** viven hoy dentro de `if (SERVER_MODE)`. Un borrado
mecánico del `if` los elimina con él:

| Ubicación | Qué se perdería |
|---|---|
| `store.ts:85` | `resync()` ante `409` stale → el cliente dejaría de converger tras un conflicto (ADR-06 de `backend`) |
| `store.ts:187-194` | Limpieza de claves `ledger.*` → FR-1104 fallaría en navegadores con restos |
| `store.ts:284` | Seam `window.__ledgerStore` → los e2e que observan el estado en vivo perderían su punto de anclaje |

**Mitigación:** cada bloque se convierte a incondicional de forma **explícita**, no eliminando el `if`.
NFR-1103 lo blinda como regresión MUST, con TCs happy/edge/negative en Fase 3.

### RISK-2 — NFR-003 raíz queda sin sujeto (severidad: **media**)

`persistence.test.ts` cubre NFR-003 raíz ("robustez de persistencia local": corrupción → semilla, quota
excedida, datos inválidos). Al retirar `LocalStorageRepository`, ese NFR pierde su implementación.

**Mitigación:** la *intención* — "ante datos corruptos no se rompe, se recupera" — se re-apunta al
camino de servidor: respuesta malformada de la API, `load` que devuelve `null`, escritura rechazada.
Se registra en Fase 3 como cobertura de la intención, no del mecanismo. **No** se declara NFR-003
cumplido por un test que ya no existe.

### RISK-3 — Rediseño visual que rompe los e2e (severidad: **media**)

FR-1108 reescribe el marcado de `AuthForm`. Los e2e de `backend` cuelgan de 9 `data-testid`,
`aria-label` y textos de error literales.

**Mitigación:** conservación literal como criterio de aceptación (FR-1108) y en la sección de regresión
visual del UX spec. La suite de `backend` (85 TCs) es el detector.

### RISK-4 — El gate de cliente no protege por sí solo (severidad: **baja**, ya mitigada)

Un atacante puede saltarse un gate de React. **Mitigación (preexistente):** la API valida sesión en cada
request y filtra por `ownerId`. El gate es comodidad de UI; la barrera es el servidor. Se documenta para
que nadie confunda una cosa con la otra.

---

## Technical Risk Flags

**4 flags detectados.**

- **[RISK] Lógica de negocio acoplada a un flag de rollout** — severidad: **high**
  Mitigación: conversión explícita bloque por bloque + NFR-1103 como regresión MUST. Ver RISK-1.

- **[RISK] Pérdida de trazabilidad de NFR-003 raíz** — severidad: **medium**
  Mitigación: re-apuntar la intención al camino de servidor y declararlo; no dar por cumplido un NFR
  cuyo test se retira. Ver RISK-2.

- **[RISK] Regresión de e2e por reescritura de marcado** — severidad: **medium**
  Mitigación: contrato de `data-testid`/`aria-label`/textos como criterio de aceptación. Ver RISK-3.

- **[RISK] Punto único de fallo sin modo degradado** — severidad: **medium**, **aceptado**
  Postgres caído = app caída. Es la consecuencia buscada de "única fuente de verdad", no un descuido.
  Mitigación: fallo legible y recuperación automática. Ver Blast Radius.

---

## Traceability Checklist

| Requisito | Dónde se resuelve |
|---|---|
| FR-1101 | System Architecture (estado objetivo) · ADR-01 · ADR-02 · Implementation Approach |
| FR-1102 | Implementation Approach · Security Design · Blast Radius (auth) |
| FR-1103 | Implementation Approach · Data Model · Blast Radius (Postgres) |
| FR-1104 | Data Model · ADR-05 · Implementation Approach |
| FR-1105 | Implementation Approach (declaración completa) · ADR-04 |
| FR-1106 | Implementation Approach (tabla por archivo) · ADR-03 |
| FR-1107 | Implementation Approach |
| FR-1108 | Componentes · Implementation Approach · RISK-3 |
| NFR-1101 | Data Model (preferencias supervivientes) |
| NFR-1102 | Security Design (better-auth sin cambios) |
| NFR-1103 | RISK-1 · API Design (contrato 409) |
| NFR-1104 | RISK-3 · Implementation Approach |
| NFR-1105 | Data Model (sin cambios de esquema) · ADR-04 |
| NFR-1106 | Security Design |
| NFR-1107 | Deployment Architecture · ADR-01 · ADR-03 |
| NFR-1108 | Implementation Approach (globalSetup) · Deployment Architecture |

- ✅ Los 8 FRs y los 8 NFRs tienen destino en el diseño.
- ✅ Los 6 ADRs evalúan ≥2 opciones cada uno.
- ✅ Blast radius documentado para 2 componentes críticos (Postgres, capa de auth).
- ✅ **Ningún elemento del `no_go_zone` aparece en la arquitectura**: sin ruta de importación/merge, sin
  cambios de dominio ni de esquema, sin rediseño de auth, sin endurecimiento de sesión, sin
  optimización de escritura, sin modo demo, sin multiusuario.
