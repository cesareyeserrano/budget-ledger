# Technical Design Document (TRD / SDD) — feature `tony-ledger`

Puerta para agentes en T-Ledger, para que Agent-L (la copia del perfil Hermes) lleve su libro en la
app. Este documento diseña SOLO el lado de T-Ledger; el perfil del agente vive en otro repositorio.

## Executive Summary

La feature es un incremento sobre el sistema existente y **no introduce ninguna dependencia nueva**:

| Pieza | Elección | Por qué |
|---|---|---|
| Servidor | Next.js `^15.1.6` (App Router, route handlers), Node 22 | Es el servidor que ya existe; la superficie del agente son route handlers nuevos en el mismo proceso, así comparte dominio, repositorio y `syncHub` sin red de por medio |
| Persistencia | PostgreSQL 16 + Drizzle `^0.45.3`, migración aditiva `0013` | Única fuente de verdad (FR-011); la transacción con `FOR UPDATE` sobre la fila `ledger` que ya serializa escrituras da la idempotencia sin mecanismo nuevo |
| Validación | Zod (el que ya usa `src/server/schemas.ts`), esquemas `.strict()` | Mismo patrón que el PATCH de movimientos |
| Token | `node:crypto` (`randomBytes`, `createHash('sha256')`, `timingSafeEqual`) | Un secreto de 256 bits al azar no necesita argon2 ni una librería; Better Auth `^1.7.7` no se toca (ADR-02) |
| Tope de peticiones | `src/server/rateLimit.ts` (`allow`, ventana deslizante en memoria) | Ya existe, una sola instancia en Ultron |
| Gestión de tokens | `scripts/agent-token.mjs` con `postgres` (SQL crudo) | Mismo patrón que `scripts/reset-password.mjs`: corre con `node` en el contenedor, sin build de TS |

Decisiones que sostienen el diseño (detalle en *Risk Analysis*): superficie separada `/api/agent/v1`
con envoltorio propio y negación por defecto (ADR-01); token opaco con hash SHA-256 gestionado por
comando (ADR-02); la marca de origen viaja en el tipo `Movement` y el servidor la restaura desde lo
guardado en cada guardado completo (ADR-03); idempotencia dentro de la transacción del libro
(ADR-04); deshacer operaciones de bolsillo componiendo funciones de dominio existentes (ADR-05);
la superficie no atiende peticiones que llegan por el proxy externo (ADR-06).

## System Architecture

```
┌──────────────────────── Raspberry Pi (Ultron) ─────────────────────────────────────┐
│                                                                                     │
│  contenedor hermes                    red Docker `ledger-agent` (solo estos dos)    │
│  ┌──────────────────────┐   HTTP + Authorization: Bearer tla_…                      │
│  │ Agent-L (perfil      │ ───────────────────────────────────┐                      │
│  │ tledger): ayudante   │                                    │                      │
│  │ determinista (repo   │                                    ▼                      │
│  │ aparte)              │        ┌──────────── contenedor app (Next.js) ──────────┐ │
│  └──────────────────────┘        │                                                │ │
│                                  │  /api/agent/v1/*   ── withAgent() ──┐          │ │
│  navegador (tailnet)             │   interruptor · sin proxy · token · │          │ │
│  ┌───────────────┐  TLS          │   tope · Zod estricto · log         │          │ │
│  │ app web       │──tailscale──▶ │                                     ▼          │ │
│  └───────────────┘   serve       │  /api/v1/*  ── withApi() ──▶  server/data/     │ │
│        ▲  (añade X-Forwarded-*)  │   sesión + Origin (SIN CAMBIOS)  ledgerRepo ───┼─┼─▶ PostgreSQL
│        │                         │                                     │          │ │   movement (+3 col.)
│        └────── SSE /api/v1/sync/stream ◀── syncHub.publish ◀──────────┘          │ │   agent_token (nueva)
│                                  │                              domain/ (puro)    │ │
│  operador (SSH)                  │  scripts/agent-token.mjs ──────────────────────┼─┼─▶ agent_token
│  docker compose exec app node …  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Componentes y responsabilidad**

- **`src/server/agent/http.ts` — `withAgent()`** (nuevo). Envoltorio de TODA ruta bajo
  `/api/agent/v1`. Orden fijo: interruptor → rechazo de peticiones con cabeceras de proxy → token →
  tope → tamaño y validación Zod del cuerpo → handler → log. Es el único lugar donde se lee la
  cabecera `Authorization`. `withApi` (`src/server/http.ts`) no se modifica (NFR-3401).
- **`src/server/agent/tokens.ts`** (nuevo). `hashToken`, `parseToken`, `resolveToken(raw)` →
  `{ tokenId, ownerId, name } | null`, y la actualización acotada de `last_used_at`.
- **`src/server/agent/schemas.ts`** (nuevo). Esquemas Zod estrictos de entrada y los traductores de
  resultado → respuesta (un solo traductor de rechazos para las tres escrituras).
- **`src/server/data/agentRepo.ts`** (nuevo). Operaciones del agente sobre el libro:
  `agentTree`, `agentMovements`, `agentMovementByRef`, `agentInsert`, `agentUpdate`, `agentUndo`,
  `agentSummary`, `agentPeriodOf`. Cada escritura es UNA transacción con `FOR UPDATE` sobre `ledger`
  y llama a las mutaciones puras del dominio, igual que `insertMovement`/`writeMovement`. Reutiliza
  de `ledgerRepo.ts` las funciones ya exportadas (`loadStateInTx`, `loadCyclesIn`, `calendarOf`,
  `closureFromRow`, `closureScope`, `unionScope`, `serverScope`) y se exportan las tres que hoy son
  privadas y hacen falta (`rowsToState`, `openingFromRow`, `ensureV4InTx`).
- **`src/app/api/agent/v1/**/route.ts`** (nuevo). Cinco archivos de ruta, siete operaciones.
- **`src/domain/types.ts`** (delta aditivo). `Movement.origin?: MovementOrigin`.
- **`src/domain/reserve.ts`** (delta aditivo). `undoAporteOp` — composición de funciones existentes.
- **`src/server/data/ledgerRepo.ts`** (delta). Lee/escribe las tres columnas nuevas en
  `rowsToState`, `insertSnapshot` e `insertMovement`; `saveLedger` restaura el origen desde lo
  guardado (`conservarOrigen`).
- **`src/components/CellDetail.tsx`** (delta). Etiqueta de texto con `origin.agentName`.
- **`scripts/agent-token.mjs`** (nuevo). `create | list | revoke`.
- **`docs/agent-api.md`** (nuevo). Contrato de la superficie (FR-3419).
- **`docker-compose.agent.yml`** (nuevo, opcional). Añade la red `ledger-agent` al servicio `app`.

**Desviación respecto a la arquitectura raíz, justificada:** la raíz tiene UN envoltorio (`withApi`)
para toda ruta. Aquí se crea un segundo (`withAgent`) a propósito: mezclar dos formas de
autenticación en `withApi` obligaría a decidir ruta por ruta qué puede el token, y un olvido abre un
hueco. Dos envoltorios, dos árboles de rutas, cero solapamiento (ADR-01).

## Data Model

**Contrato de preservación (no cambia):** todas las tablas existentes (`user`, `session`, `account`,
`ledger`, `node`, `amount_cell`, `movement`, `cell_note`, `cycle_config_version`, cierre) conservan
columnas, tipos, claves, índices y CHECKs. Las filas existentes no se reescriben. `ledger.revision`
sigue siendo el control optimista del guardado completo.

**Delta — migración `drizzle/0013_agente.sql` (solo aditiva)**

Tabla nueva `agent_token`:

| Columna | Tipo | Restricción |
|---|---|---|
| `id` | text | PK. `agt_` + 12 caracteres base64url al azar. No es secreto: es lo que se lista, se loguea y se revoca |
| `owner_id` | text | NOT NULL, FK → `user.id` ON DELETE CASCADE |
| `name` | text | NOT NULL, CHECK `char_length(name) between 1 and 60` |
| `token_hash` | text | NOT NULL, UNIQUE. SHA-256 hex (64 caracteres) del token completo |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |
| `last_used_at` | timestamptz | NULL = nunca usado |
| `revoked_at` | timestamptz | NULL = activo |

Índice: `agent_token_owner_idx (owner_id)`.

Columnas nuevas en `movement` (todas NULL en las filas existentes y en todo movimiento manual):

| Columna | Tipo | Restricción |
|---|---|---|
| `origin_ref` | text | NULL; CHECK `char_length(origin_ref) between 1 and 128` |
| `agent_token_id` | text | NULL. **Sin FK** a propósito: revocar o borrar un token no debe tocar el libro (FR-3413) |
| `agent_name` | text | NULL. Copia del nombre del token en el momento del registro |

- CHECK `movement_origin_ck`: las tres son NULL o las tres son NOT NULL.
- Índice único parcial `movement_owner_origin_uq (owner_id, origin_ref) WHERE origin_ref IS NOT NULL`
  — la unicidad por cuenta de FR-3409; dos movimientos manuales (NULL) no chocan (NFR-3406).

**Tipo de dominio (delta aditivo en `src/domain/types.ts`)**

```ts
/** Quién registró un movimiento que no nació en la app. Ausente ≡ registrado a mano. */
export interface MovementOrigin { ref: string; agentId: string; agentName: string }
export interface Movement { /* …campos actuales sin cambio… */ origin?: MovementOrigin }
```

`rowsToState` lo adjunta solo si `origin_ref` no es NULL; `insertSnapshot` e `insertMovement` lo
escriben. Como viaja en el `Movement`, cualquier ruta del servidor que cargue el estado y lo
reinserte (migración v4, retiros planeados, cierre) lo conserva sin código especial.

**Token (no se guarda):** `tla_` + base64url de 32 bytes de `crypto.randomBytes` (43 caracteres;
47 en total). Regex de formato: `^tla_[A-Za-z0-9_-]{43}$`.

## API Design

**Contrato preservado:** `/api/v1/*`, `/api/auth/*` y `/health` conservan métodos, cuerpos, códigos y
cookies. Único cambio visible: los movimientos que devuelven `GET /api/v1/ledger` y
`GET /api/v1/movements` pueden traer el campo opcional `origin` (aditivo). `apiMovementSchema`
acepta `origin` opcional en el PUT, y el servidor **ignora** lo que llegue y usa lo guardado.

**Superficie nueva — base `/api/agent/v1`.** Toda petición: cabecera
`Authorization: Bearer <token>`; sin cookie; sin `Origin`. Toda respuesta: JSON y
`Cache-Control: no-store`. Errores con la forma existente `{ "error": { "code", "message"?, "detail"? } }`.

Rechazos comunes a las siete operaciones (los emite `withAgent`, en este orden):

| Situación | Respuesta |
|---|---|
| `LEDGER_AGENT_API` ≠ `on` | 404 `not_found` |
| La petición trae `x-forwarded-for`, `x-forwarded-host`, `forwarded` o `tailscale-user-login` | 404 `not_found` |
| Sin token, mal formado, inexistente o revocado | 401 `unauthorized` (cuerpo idéntico en los cuatro casos); más de 20 en 60 s → 429 `rate_limited` |
| Tope del token superado | 429 `rate_limited` + cabecera `Retry-After: 60` |
| Cuerpo > 16 KiB | 413 `payload_too_large` |
| Cuerpo que no valida (campo desconocido, tipo, rango) | 422 `invalid_payload` |
| La cuenta no ha guardado su libro | 404 `not_found` |
| Fallo interno | 500 `internal_error` (sin detalle) |

Objeto `AgentMovement` (salida de las lecturas y escrituras):

```json
{ "id": "m_…", "type": "expense", "target": "s-mercado", "targetName": "Mercado",
  "amount": 50000, "period": "2026-10", "date": "2026-10-10", "note": "Éxito",
  "from": null, "to": null, "ref": "L300",
  "agent": { "id": "agt_…", "name": "Agent-L" } }
```
`ref` y `agent` son `null` en un movimiento manual. `from`/`to` solo en `type: "transfer"`
(`"@disponible"` o id de bolsillo).

| # | Método y ruta | Entrada | Éxito | Rechazos propios |
|---|---|---|---|---|
| 1 | `GET /tree` | — | 200 `{ revision, nodes: [{ id, name, type: "expense"\|"income"\|"transfer", level: "group"\|"category"\|"sub", parentId, leaf: boolean }] }` | — |
| 2 | `GET /movements` | `?period=YYYY-MM[t]` (opcional; por defecto el vigente) · `?node=<id>` (opcional, filtra por subárbol) · o `?ref=<ref>` (excluyente con los otros) | 200 `{ period, movements: AgentMovement[] }`; con `ref`: 200 `{ movement }` | 400 `invalid_period`; 404 `not_found` (ref o node inexistente) |
| 3 | `POST /movements` | `{ type: "expense"\|"income", target, amount, date, note?, ref }` o `{ type: "transfer", from, to, amount, date, note?, ref }` | 201 `{ movement, revision }` (creado) · 200 `{ movement, revision }` (misma `ref` y mismo contenido: no crea nada) | 409 `reference_conflict` `{ detail: { movement } }`; 422 `invalid_target`; 422 `closed_period_violation`; 422 `domain_rule_violation` `{ detail: { violations: [{ rule, period, leafId?, limit }] } }`; 400 `invalid_date` |
| 4 | `PATCH /movements/{key}` | `{ amount?, date?, note?, target? }` estricto, al menos un campo | 200 `{ movement, revision }` | 404 `not_found` (inexistente, ajeno o manual); 422 `unsupported_type` (bolsillo); 422 `closed_period_violation`; 422 `invalid_target`; 422 `domain_rule_violation`; 422 `negative_cell`; 422 `cell_movement_mismatch` |
| 5 | `DELETE /movements/{key}` | — | 200 `{ revision }` | 404 `not_found`; 422 `closed_period_violation`; 422 `domain_rule_violation`; 422 `negative_cell`; 422 `cell_already_changed` (ver FR-3412) |
| 6 | `GET /summary` | `?period=` (opcional; por defecto el vigente) | 200 (abajo) | 400 `invalid_period` |
| 7 | `GET /period` | `?date=YYYY-MM-DD` (obligatorio) | 200 `{ period, mode: "month"\|"cycle", start, end, closed: boolean }` | 400 `invalid_date` |

- `{key}` = id del movimiento, o `ref:` + la referencia codificada para URL.
- Campos: `amount` entero 1…tope del dominio (`amountSchema`); `date` con el esquema `MOVEMENT_DATE`
  del dominio; `note` ≤ 280; `ref` 1…128 caracteres; `target`/`from`/`to` ≤ 64.
- El **periodo nunca viaja**: lo deriva el servidor con `calendarOf(state).periodForDate(date)`.
- Cualquier otro método o ruta bajo `/api/agent/v1` → 405 / 404 (no hay archivo de ruta que lo
  atienda; lo comprueba una prueba estructural).

Respuesta de `GET /summary`:

```json
{ "period": "2026-10", "mode": "cycle", "start": "2026-09-21", "end": "2026-10-20", "closed": false,
  "revision": 412,
  "nodes": [ { "id": "s-mercado", "name": "Mercado", "type": "expense", "level": "sub",
               "parentId": "c-alimentacion", "budget": 800000, "actual": 320000, "remaining": 480000 } ],
  "totals": { "income":  { "budget": 0, "actual": 0 },
              "expense": { "budget": 0, "actual": 0, "remaining": 0 } },
  "balance": { "available": 0, "reserved": 0 },
  "pockets": [ { "id": "s-viaje", "name": "Viaje", "contributed": 200000, "balance": 950000 } ] }
```
`remaining = budget − actual` (gasto e ingreso). `balance` es el plano Ejecutado del periodo.
`pockets[].contributed` es el aporte del periodo (la celda); `pockets[].balance` el saldo derivado.

## Implementation Approach

**FR-3401 · Crear token por comando**
Method: `scripts/agent-token.mjs create <correo> <nombre>`; `randomBytes(32)` → token `tla_…`;
`sha256` → `token_hash`; `INSERT` en `agent_token` por SQL crudo.
I/O: argv → stdout con el token (única vez) y su `id`; exit 0.
Failure: correo inexistente, nombre vacío o > 60 → mensaje en stderr, exit 1, cero filas. El mensaje
de cuenta inexistente no lista otras cuentas.

**FR-3402 · Listar y revocar**
Method: `list <correo>` hace `SELECT id, name, created_at, last_used_at, revoked_at`; `revoke <id>`
hace `UPDATE … SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`. La revocación es
inmediata porque `resolveToken` consulta la base en cada petición (sin caché). `last_used_at` se
actualiza como mucho una vez por minuto por token (`WHERE last_used_at IS NULL OR last_used_at < now() - interval '60 seconds'`).
I/O: argv → tabla de texto / confirmación. Nunca imprime `token_hash`.
Failure: id inexistente o ya revocado → 0 filas afectadas → exit 1 con mensaje.

**FR-3403 · Autenticación por token y aislamiento**
Method: `withAgent(opts, handler)`; extrae `Bearer`, valida el formato por regex, `sha256`, busca
por `token_hash` con `revoked_at IS NULL` y compara con `timingSafeEqual`. El `ownerId` sale SOLO
de la fila del token; los handlers no leen ningún `ownerId` de la petición.
I/O: `Request` → `{ ownerId, tokenId, tokenName, body, params }` al handler.
Failure: los cuatro casos de token inválido devuelven la MISMA respuesta 401. Un id de otra cuenta
no aparece al buscar dentro del estado del dueño → 404.

**FR-3404 · La API del navegador no acepta el token**
Method: por construcción — `withApi` no se modifica y no lee `Authorization`; `getSessionUser`
sigue resolviendo solo la cookie. Se añade una prueba estructural que falla si `src/server/http.ts`
o `src/server/session.ts` mencionan `authorization` o importan de `src/server/agent/`.
I/O: n/a. Failure: n/a (ausencia de código).

**FR-3405 · Interruptor**
Method: variable `LEDGER_AGENT_API` en `env.ts` (opcional); `agentEnabled = (valor === "on")`.
Primer paso de `withAgent`, antes de tocar el token o la base.
I/O: env → booleano. Failure: cualquier otro valor ("true", "1", "ON") ≡ apagado → 404.

**FR-3406 · Tope por token**
Method: `allow()` de `rateLimit.ts` con cubos `agent:w:<tokenId>` (30/60 s, métodos de escritura),
`agent:r:<tokenId>` (120/60 s, GET) y `agent:bad:<origen>` (20/60 s) donde `<origen>` es la IP de
`X-Forwarded-For` solo si `trustProxy`, y si no la constante `global`. El cubo `bad` solo se
consulta cuando el token NO resolvió, así que agotar ese cubo no deja fuera a un token válido.
I/O: `(clave, max, ventana)` → booleano. Failure: tope superado → 429 antes de leer el cuerpo.
Las constantes viven en `src/server/agent/limits.ts`.

**FR-3407 · Leer el árbol**
Method: `agentTree(ownerId)` carga los nodos y calcula `leaf` con `isLeaf` de `domain/tree`.
I/O: → `{ revision, nodes[] }`. Failure: sin fila `ledger` → 404. No existe handler de escritura
sobre el árbol.

**FR-3408 · Registrar gasto o ingreso**
Method: `agentInsert(ownerId, token, input)`: una transacción con `FOR UPDATE` sobre `ledger`; carga
el estado igual que `insertMovement` (v4 garantizado, apertura, ciclos); resuelve `target` → `catId`/
`subId`; deriva `period = cal.periodForDate(date)`; comprueba la referencia (FR-3409); ejecuta
`addMovement` del dominio y los MISMOS guardias y en el mismo orden que `insertMovement` (destino →
periodo → cierre → `worsenedBy`); inserta la fila con las tres columnas de origen; hace upsert del
diff de celdas `actual`; `revision + 1`. Para no duplicar ese cuerpo, `insertMovement` se refactoriza
a una función interna `insertMovementInTx(tx, head, ownerId, input, origin?)` que usan las dos vías.
I/O: `{ type, target, amount, date, note?, ref }` → `{ movement, revision }`.
Failure: cada rechazo del repositorio se traduce a su código (tabla del API); nada se escribe.
Fecha que el calendario no contiene → 400 `invalid_date`.

**FR-3409 · Referencia de origen e idempotencia**
Method: dentro de la transacción y con la fila `ledger` bloqueada, `SELECT` del movimiento con
`(owner_id, origin_ref)`. Si existe: se compara `type`, `target`, `amount`, `date`, `from`, `to`
(la nota NO cuenta) → iguales: 200 con el existente y la revisión actual, sin escribir; distintos:
409 `reference_conflict`. Si no existe: se inserta. El bloqueo de fila serializa dos peticiones
simultáneas; el índice único parcial es la segunda barrera.
I/O: `ref` → fila existente o inserción. Failure: violación del índice único (solo alcanzable si
algo esquiva el bloqueo) → se captura y se responde como reintento, releyendo la fila.

**FR-3410 · Operación de bolsillo**
Method: mismo `agentInsert` con `type: "transfer"`: construye la entrada con `from`/`to` y la pasa a
`addMovement`, que delega en `applyReserveOp` (techo, piso y déficit en cadena).
I/O: `{ from, to, amount, date, note?, ref }` → `{ movement, revision }`.
Failure: extremos inválidos → 422 `invalid_target`. Rechazo de regla: hoy `addMovement` devuelve el
mismo estado y `insertMovement` responde `invalid_movement` sin motivo; para cumplir el AC (regla y
límite en la respuesta), `agentInsert` llama a `applyReserveOp` directamente cuando el tipo es
`transfer` y traduce su `ReserveVerdict` a `domain_rule_violation` con `{ rule, period, leafId, limit }`.

**FR-3411 · Corregir gasto o ingreso del agente**
Method: `agentUpdate(ownerId, key, patch)`: resuelve `key` (id o `ref:`) a un movimiento del estado
del dueño; si no existe **o no tiene `origin`** → `notFound`; si es `transfer` → `unsupported_type`;
después el mismo cuerpo de `writeMovement` con `editMovement` (se extrae a `writeMovementInTx` con un
predicado `allow(mv)` opcional). `target` del cuerpo se traduce a `catId`/`subId`.
I/O: `{ amount?, date?, note?, target? }` → `{ movement, revision }`. Las columnas de origen no se
tocan en el `UPDATE`.
Failure: tabla del API; 404 indistinguible entre inexistente, ajeno y manual.

**FR-3412 · Deshacer un movimiento del agente**
Method: `agentUndo(ownerId, key)`: misma resolución y mismo filtro de `origin`. Gasto o ingreso →
`deleteMovement`. Bolsillo: retiro o mover → `removeReserveOp(state, id, scope)`; aporte (de
Disponible a un bolsillo) → `undoAporteOp(state, id, scope)`, función nueva en `reserve.ts` que
compone lo existente: `applyReserveCellEdit` bajando la celda `actual` del bolsillo en el monto del
aporte (valida techo, piso y déficit en cadena) y quita el movimiento del journal. Después, los
guardias de cierre, `worsenedBy` y descuadre de `writeMovement`.
I/O: `key` → `{ revision }`; la fila se borra y su `origin_ref` queda libre.
Failure: bolsillo que quedaría negativo → 422 `domain_rule_violation` (`piso`). Si la celda del
aporte ya vale menos que el monto (el dueño la bajó a mano en la grilla) → 422 `cell_already_changed`
y nada cambia: no se puede restar un aporte que ya no está.

**FR-3413 · La marca persiste y sobrevive a los guardados**
Method: `conservarOrigen(prev, next)` en `saveLedger`, junto a `conservarPlanoDeComentarios`: para
cada movimiento del estado entrante, su `origin` se REEMPLAZA por el del movimiento guardado con el
mismo id (o se quita si el guardado no lo tiene). El cliente no puede poner, cambiar ni quitar la
marca; solo puede borrar el movimiento entero. `writeMovement` no toca las columnas de origen.
I/O: `(estado guardado, estado entrante)` → estado entrante con `origin` autoritativo.
Failure: movimiento nuevo creado por el navegador con un `origin` inventado → se guarda sin marca.

**FR-3414 · Etiqueta en el Detalle**
Method: en la fila de movimiento de `CellDetail.tsx`, si `m.origin` existe se pinta un `<span>` de
texto con `origin.agentName` (clase utilitaria existente de etiqueta, `--fg-muted` sobre `--bg`,
`max-width` + `text-overflow: ellipsis`, `title` y `aria-label` con el nombre completo). Sin `origin`
no se renderiza nada: el DOM de una fila manual queda idéntico.
I/O: `Movement` → fila. Failure: nombre largo → elipsis, sin desbordar a 375 px.

**FR-3415 · Resumen del periodo**
Method: `agentSummary(ownerId, period?)`: carga el estado con apertura y ciclos;
`scope = serverScope(state, period)`; `rollupTable(state, [period])` para cada nodo y tipo;
`computeBalanceSeries(state, scope, openingCarry(state, scope))[period].actual` para Disponible y
reservado — la MISMA composición que `BalanceModule.tsx`; `resolvedBalance(state, leaf, period,
"actual", scope)` por bolsillo. Sin periodo: `cal.periodForDate(serverToday(req))`.
I/O: `period?` → el JSON de la sección API. Solo lectura, sin transacción de escritura.
Failure: periodo mal formado → 400; periodo sin datos → 200 con ceros.

**FR-3416 · Movimientos de un periodo y por referencia**
Method: `agentMovements(ownerId, period, node?)` reutiliza `getMovements` y filtra por
`subtreeIds(node)`; `agentMovementByRef` consulta por `(owner_id, origin_ref)`. `targetName` se
resuelve contra los nodos cargados.
I/O: → `AgentMovement[]`. Failure: 400 / 404 según la tabla.

**FR-3417 · Periodo de una fecha**
Method: `calendarOf(state, …)` + `periodForDate`, `rangeOf` (en modo mes, primer y último día del
mes) e `isClosed(closureFromRow(head, cal), period)`.
I/O: `date` → `{ period, mode, start, end, closed }`. Failure: fecha inválida o fuera del
calendario → 400 `invalid_date` (se captura la excepción de `periodForDate`).

**FR-3418 · Sincronización y no pérdida**
Method: toda escritura aceptada hace `revision + 1` en la misma transacción y, tras el commit,
`syncHub.publish(ownerId, { revision })` — el mismo evento que el navegador ya escucha. La no
pérdida la da el control optimista existente: un guardado completo con `baseRevision` anterior
recibe 409 y el cliente resincroniza.
I/O: escritura → evento SSE. Failure: escritura rechazada → sin cambio de revisión ni evento.

**FR-3419 (SHOULD) · Contrato documentado** — `docs/agent-api.md`, con ejemplos de datos inventados
y una prueba que busca el regex del token en el repositorio.

### Failure Blast Radius

Component: PostgreSQL
Blast radius: toda la superficie del agente y toda la app (es la única fuente de verdad).
User impact: Agent-L recibe 500 `internal_error`; el ayudante deja el movimiento pendiente y avisa.
Recovery: reintento del agente con la MISMA `ref` — la idempotencia garantiza que no se duplique.

Component: `withAgent` / resolución de token
Blast radius: solo `/api/agent/v1`. La app del navegador no depende de él.
User impact: el agente no puede leer ni escribir; el dueño sigue usando la app con normalidad.
Recovery: falla cerrado (401/404/500, nunca acceso). Se corrige y se redepliega.

Component: `syncHub` (en memoria)
Blast radius: la notificación en vivo a las pestañas abiertas.
User impact: el movimiento del agente no aparece hasta recargar; el dato sí está guardado.
Recovery: recarga, o el 409 del siguiente guardado fuerza la resincronización.

Component: limitador en memoria
Blast radius: un reinicio del proceso vacía los cubos.
User impact: ninguno visible; un agente en bucle gana una ventana extra de 30 escrituras.
Recovery: automático. Aceptado: una sola instancia.

Component: red `ledger-agent` / contenedor del agente
Blast radius: Agent-L no alcanza la app.
User impact: los movimientos quedan pendientes en el agente (su bandeja local), no se pierden.
Recovery: al volver la red, el agente reintenta con la misma `ref`.

## Security Design

**Fronteras de confianza.** (1) El contenido que Agent-L procesa —correos del banco y mensajes— es
NO confiable y lo lee un modelo de lenguaje: se asume que el agente puede ser inducido a pedir
cualquier cosa. La defensa es que la superficie es mínima, cada escritura queda marcada y es
reversible, y el agente no puede tocar lo que el dueño registró a mano. (2) El cuerpo de cada
petición es entrada no confiable aunque el token sea válido. (3) El cambio de privilegio ocurre en
`resolveToken`: de anónimo a «esta cuenta, estas siete operaciones».

**NFR-3410 → controles**
- Generación: `crypto.randomBytes(32)`; 256 bits.
- Almacenamiento: solo `sha256(token)`; el token se imprime una vez por stdout del comando y no se
  guarda en ningún archivo del servidor.
- Comparación: búsqueda por hash + `timingSafeEqual` sobre el hash recuperado.
- Transporte: solo en `Authorization`; `withAgent` no lee query string para el token.
- Sin fuga: el log usa `tokenId`; el envoltorio nunca registra cabeceras ni cuerpos; los errores no
  repiten la entrada.
- Negación por defecto: prueba estructural que recorre `src/app/api/agent/**/route.ts` y falla si un
  export HTTP no está construido con `withAgent`; otra que falla si existe una ruta HTTP que importe
  `agent_token` para escribir (los tokens solo se crean y revocan desde `scripts/`).
- Repositorio: `scripts/secret-scan.sh` gana el patrón `tla_[A-Za-z0-9_-]{43}`.

**NFR-3411 → controles**
- Validación: esquemas Zod `.strict()` por operación; límite de 16 KiB leído con el mismo contador
  de bytes que `leerJson`; ids acotados a 64 y `ref` a 128.
- Inyección: toda consulta va por Drizzle parametrizado o plantillas etiquetadas de `postgres`.
- Errores: `catch` único que responde `internal_error` y registra el detalle solo en el servidor.
- Cabecera `Cache-Control: no-store` en toda respuesta de la superficie.
- Exposición: `withAgent` responde 404 a toda petición que traiga cabeceras de proxy (ADR-06), así
  que la superficie no es alcanzable por `tailscale serve` ni por un Nginx delante; `DEPLOYMENT.md`
  documenta la red interna `ledger-agent` y `scripts/verificar-prod.sh` comprueba que la ruta del
  agente responde 404 por la URL externa.
- XSS: la etiqueta del Detalle renderiza `agentName` como texto de React (escapado); el nombre lo
  escribe el operador, no el agente.

**Otros controles**
- Aislamiento (NFR-3405): `ownerId` solo del token; toda consulta filtra por `owner_id`.
- CSRF: no aplica a la superficie del agente (no usa cookies; un navegador no puede adjuntar el
  token). La API del navegador conserva `SameSite` + allowlist de `Origin` (NFR-3402).
- Alcance del daño de un token robado o un agente inducido: registrar movimientos (marcados,
  acotados a 30/min, reversibles) y corregir o deshacer SOLO los que registró un agente. No puede
  leer otra cuenta, tocar el árbol, el presupuesto, los cierres ni lo registrado a mano.
- Fuerza bruta: 2^256 de espacio + cubo `agent:bad` + superficie no expuesta.

## Performance & Scalability

- Cada escritura carga el estado del dueño dentro de la transacción, igual que `insertMovement`
  hoy: mismo coste que un registro manual por la API. Volumen esperado ~50 movimientos/mes.
- `GET /summary` hace una carga de estado y cálculos puros en memoria (`rollupTable` es O(nodos),
  `computeBalanceSeries` O(periodos del rango)). Presupuesto NFR-3415: ≤ 1000 ms en el arnés de
  backend; se mide en el servidor con el `performance.now()` del envoltorio.
- Resolución del token: una consulta por índice único. `last_used_at` como mucho una escritura por
  minuto por token.
- Sin caché: los datos cambian con cada registro y la app es de una sola instancia; cachear el
  resumen abriría la puerta a cifras distintas de las de la pantalla (guardrail).
- Cotas de tamaño: cuerpo ≤ 16 KiB; `ref` ≤ 128; nota ≤ 280; las de `TOPES` del dominio siguen
  vigentes.
- Escalado horizontal: no previsto (limitador y `syncHub` en memoria, igual que hoy — TRF-01).

## Deployment Architecture

**Modelo: contenedores** (Docker Compose en Ultron, Raspberry Pi 5), el mismo de la app. Un solo
artefacto: la imagen `t-ledger:<tag>`; la migración `0013` viaja dentro de la imagen y la aplica
`scripts/migrate.mjs` al arrancar, como las anteriores.

- **Entornos.** Dev: `next dev` en `:3100` contra el Postgres de `docker-compose.dev.yml`, con
  `LEDGER_AGENT_API=on` en `.env.local` y un token creado para `admin@admin.com`. Producción:
  `docker-compose.yml` + el override opcional `docker-compose.agent.yml`.
- **Configuración nueva.** `LEDGER_AGENT_API` (opcional; `on` habilita). Se añade a `env.ts`, a
  `.env.example`, al `environment` del servicio `app` como `${LEDGER_AGENT_API:-}` y a
  `DEPLOYMENT.md`. No es requerida: `check-env.mjs` no cambia su lista.
- **Red.** `docker-compose.agent.yml` declara la red externa `ledger-agent` y la añade al servicio
  `app` con el alias `t-ledger`. El contenedor del agente se une a esa misma red (configuración en
  su repositorio) y llama a `http://t-ledger:3000/api/agent/v1`. La base de datos NO está en esa
  red. Un despliegue sin agente no usa el override y no necesita la red.
- **Operación.** `docker compose exec app node scripts/agent-token.mjs create|list|revoke …`.
- **CI/CD (NFR-3413).** `.github/workflows/ci.yml` sin cambios: las pruebas nuevas viven en
  `tests/unit`, `tests/integration`, `tests/e2e-backend` y `tests/e2e`, que los scripts existentes
  (`unit.sh`, `backend-full.sh`, `e2e.sh`) ya recogen.
- **Healthcheck (NFR-3414).** `/health` no cambia y no pasa por `withAgent`.
- **Observabilidad (NFR-3412).** `withAgent` escribe
  `[ISO] METHOD /ruta STATUS (ms) rid=… agent=<tokenId|->` — el formato de `withApi` más el token.

## Risk Analysis

**ADR-01: Dónde entra el agente**
Context: el agente necesita leer y escribir movimientos con las reglas del servidor.
Option A: aceptar el token en `withApi` (`/api/v1`) con una lista de rutas permitidas — menos código
nuevo; pero cada ruta actual y futura tendría que declarar qué puede el token, y un olvido es un
hueco silencioso (el PUT del libro entero vive ahí).
Option B: superficie aparte `/api/agent/v1` con envoltorio propio — más archivos; a cambio, lo que
no existe bajo ese prefijo no existe para el agente, y `/api/v1` no gana ninguna vía de entrada.
Option C: escritura directa en PostgreSQL — sin servidor de por medio; duplica todas las reglas en
el agente y la credencial da acceso total.
Decision: B — aprobada por el usuario el 2026-10-10.
Consequences: dos envoltorios que mantener; el contrato del agente puede evolucionar sin tocar el
del navegador; una ruta nueva en `/api/v1` nunca queda expuesta al agente por accidente.

**ADR-02: Formato y custodia del token**
Context: hace falta una credencial revocable para un programa sin navegador.
Option A: plugin `apiKey`/`bearer` de Better Auth — mantenido por la librería; pero el bearer
convierte el token en una SESIÓN completa (abriría `/api/v1`), añade tablas y rutas HTTP de gestión.
Option B: token opaco propio, SHA-256 en tabla propia, gestionado por comando — ~80 líneas con
`node:crypto`; sin rutas HTTP que fabriquen tokens; no es una sesión.
Option C: JWT firmado — sin consulta a la base; pero revocar exige una lista negra y el secreto de
firma se vuelve un punto único.
Decision: B.
Consequences: revocación inmediata (una consulta por petición, aceptable al volumen); la gestión
exige acceso al servidor, que es la intención.

**ADR-03: Cómo sobrevive la marca al guardado completo**
Context: `insertSnapshot` borra y reinserta todos los movimientos en cada PUT del navegador; una
columna que el cliente no reenvíe se pierde en el primer guardado.
Option A: tabla aparte `movement_origin` que el snapshot no toca — no cambia `movement`; pero quedan
filas huérfanas cuando el navegador borra el movimiento, y la unicidad de `ref` deja de reflejar los
movimientos vigentes.
Option B: columnas en `movement` + campo `origin` en el tipo `Movement`, y `saveLedger` restaura el
origen desde lo guardado por id — un solo lugar de verdad; la marca muere con el movimiento; el
cliente la recibe para pintar la etiqueta.
Decision: B.
Consequences: el servidor es la autoridad de `origin` (el cliente no puede falsificarlo); una pestaña
abierta con código anterior reenvía movimientos sin `origin` y el servidor lo repone, igual que ya
hace con el plano de los comentarios (BG-089).

**ADR-04: Idempotencia**
Context: el agente reintenta y el banco manda dos avisos por operación.
Option A: cabecera `Idempotency-Key` con tabla de respuestas guardadas — estándar; pero es una tabla
con caducidad que limpiar y devuelve respuestas viejas aunque el movimiento ya se haya corregido.
Option B: referencia de origen como dato del movimiento, única por cuenta, comprobada dentro de la
transacción que ya bloquea la fila `ledger` — sin tabla nueva; la misma `ref` sirve para buscar,
corregir y deshacer.
Decision: B.
Consequences: la `ref` es parte del contrato; deshacer libera la `ref`.

**ADR-05: Deshacer una operación de bolsillo**
Context: `deleteMovement` rechaza los movimientos de bolsillo; `removeReserveOp` cubre retiros y
moveres pero NO los aportes desde Disponible, que en el modelo viven en la celda.
Option A: no permitirlo (el dueño lo arregla en la app) — cero código; rompe el «anula eso» del
agente justo en los traslados.
Option B: componer funciones de dominio existentes: `removeReserveOp` para retiro y mover, y
`applyReserveCellEdit` + quitar el movimiento para el aporte (`undoAporteOp`).
Option C: guardar el libro completo desde el servidor — reutiliza todo; pero es la vía de mayor
alcance y la que el agente no debe tener.
Decision: B.
Consequences: una función nueva y pequeña en `reserve.ts` sin regla nueva (las validaciones son las
de `applyReserveCellEdit`); aparece un rechazo propio, `cell_already_changed`.

**ADR-06: Que la superficie no se alcance desde fuera**
Context: la app se publica con `tailscale serve`, que reenvía todas las rutas.
Option A: confiar en la configuración del proxy para no publicar `/api/agent` — nada en el código;
un proxy mal configurado la expone sin que nada lo delate.
Option B: `withAgent` responde 404 si la petición trae cabeceras que solo añade un proxy
(`x-forwarded-for`, `x-forwarded-host`, `forwarded`, `tailscale-user-login`) — el cliente que pasa
por el proxy no puede quitarlas; el agente, que llega por la red interna, no las trae.
Option C: segundo puerto de escucha solo para el agente — aislamiento real; Next.js no sirve rutas
distintas por puerto sin un servidor propio.
Decision: B, más la red interna dedicada y el token.
Consequences: la superficie no se puede probar a través del proxy (se prueba directo al puerto);
un despliegue con un proxy que no añada ninguna de esas cabeceras quedaría protegido solo por el
token — documentado en `DEPLOYMENT.md`.

**Riesgos principales**
1. *Refactor de `insertMovement`/`writeMovement` para compartir cuerpo con el agente* rompe la vía
   manual. Mitigación: extracción sin cambio de comportamiento, cubierta por la suite de backend
   existente (NFR-3409) y por las pruebas de paridad de NFR-3404.
2. *La marca se pierde en algún camino de reinserción no previsto.* Mitigación: `origin` viaja en el
   tipo y `rowsToState`/`insertSnapshot` son los únicos puntos de lectura/escritura de filas; prueba
   de ida y vuelta por PUT, cierre de mes y migración v4.
3. *Agente inducido por un correo.* Mitigación: confirmación en Telegram (lado del agente), marca,
   tope, y prohibición de tocar lo manual.
4. *Deshacer un aporte tras una edición manual de la celda.* Mitigación: rechazo explícito
   `cell_already_changed`; el dueño lo resuelve en la app.
5. *Prueba de punta a punta en dev:* el agente corre en la Pi y el dev en el Mac. Mitigación: el
   ayudante del agente se ejecuta desde el Mac contra `:3100` para la prueba, o se expone el dev por
   la IP de la tailnet; se decide al llegar a esa prueba (no afecta al diseño).

## Technical Risk Flags

[RISK] El resumen puede no coincidir con la pantalla si el rango de periodos difiere
Conflict: FR-3415 exige cifras idénticas a la app, pero el Disponible depende del rango con que se
abre la serie (`scope`) y el navegador lo deriva de la preferencia de horizonte, que el servidor no
conoce.
Mitigation: el servidor usa `serverScope(state, period)`, que cubre todos los periodos con datos
desde el inicio declarado; el arrastre es acumulativo, así que el Disponible de un periodo no depende
de dónde termina el rango. Una prueba compara el resumen contra `computeBalanceSeries` sobre el
rango del cliente para el libro de `admin@admin.com`.
Severity: medium

[RISK] Un ingreso en la ventana de pago no se puede asignar al ciclo que abre
Conflict: FR-3408 deriva el periodo de la fecha; el registro manual permite, para un ingreso dentro
de la ventana, contarlo en el ciclo que abre (FR-2406). La superficie del agente no ofrece esa
opción.
Mitigation: DECISIÓN DEL USUARIO (2026-10-13): todo lo que registra el agente cae en el periodo de la
fecha de la transacción, sin excepción; el ciclo o el mes es solo la forma de verlo. No se añade la
opción. El dueño puede moverlo en la app si alguna vez lo quiere (la marca se conserva).
Severity: low

[RISK] Limitador y cubo de tokens inválidos en memoria y sin IP real
Conflict: FR-3406 pide acotar por dirección de origen; los route handlers de Next no exponen la IP
del socket y `X-Forwarded-For` solo es fiable con `LEDGER_TRUST_PROXY`.
Mitigation: cubo global para tokens inválidos cuando no hay IP fiable; no afecta a los tokens
válidos, que se resuelven antes. La superficie además no es alcanzable por el proxy (ADR-06).
Severity: low

[RISK] La detección de proxy depende de las cabeceras que añade `tailscale serve`
Conflict: NFR-3411 exige que la superficie no se publique hacia fuera; ADR-06 lo garantiza solo si el
frente añade alguna de las cabeceras vigiladas.
Mitigation: `scripts/verificar-prod.sh` llama a la ruta del agente por la URL externa tras cada
despliegue y falla si no recibe 404; el token sigue siendo obligatorio en cualquier caso.
Severity: medium

[RISK] `agent_name` es una copia: renombrar un token no cambia las etiquetas ya escritas
Conflict: FR-3414 muestra el nombre del token; no hay operación de renombrar.
Mitigation: aceptado y coherente con FR-3413 (la marca refleja quién registró en ese momento).
Severity: low

### Traceability Checklist

- [x] FR-3401…FR-3419: cada uno tiene entrada en *Implementation Approach* y componente asignado.
- [x] NFR-3401 (`withApi` intacto + prueba estructural) · NFR-3402 (API del navegador sin cambios) ·
  NFR-3403 (resumen llama al dominio) · NFR-3404 (mismos guardias, cuerpo compartido) · NFR-3405
  (`ownerId` del token) · NFR-3406 (columnas NULL, índice parcial) · NFR-3407 (cubos propios) ·
  NFR-3408 (mismo `syncHub`, stream sin token) · NFR-3409 (suite existente) · NFR-3410 y NFR-3411
  (*Security Design*) · NFR-3412 (log de `withAgent`) · NFR-3413 (CI sin cambios) · NFR-3414
  (`/health` intacto) · NFR-3415 (*Performance*).
- [x] Seis ADR, todos con al menos dos opciones.
- [x] Nada del no-go entra en el diseño: sin migración de histórico, sin escritura sobre el árbol,
  sin cierres ni presupuesto, sin pantalla de tokens, sin bandeja de propuestas, sin código de
  Hermes, sin edición de operaciones de bolsillo, sin permiso sobre lo manual.
- [x] Blast radius documentado para cinco componentes.
- [x] *Technical Risk Flags* completo: cinco banderas (dos medias, tres bajas).
