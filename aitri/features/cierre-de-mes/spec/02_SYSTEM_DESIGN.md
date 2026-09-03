# Technical Design Document (TRD / SDD) — cierre-de-mes

_Fase 2 de la feature `cierre-de-mes`. Escrito el 2026-09-03 sobre los requisitos aprobados
(`01_REQUIREMENTS.json`) y verificado contra el código en el commit `0e4dd71`._

## Executive Summary

**La idea que sostiene todo el diseño: el cierre es un permiso de ESCRITURA, no un concepto de
CÁLCULO.** `computeBalanceSeries`, `reserve.ts` y los roll-ups no se enteran de que existen meses
cerrados: siguen recorriendo la misma lista de periodos que les da `activeRange` (multi-anio,
FR-1906) y produciendo los mismos números. Lo único que el cierre hace es impedir que ciertas
entradas cambien.

Esa decisión no es estética; es la que hace que **NFR-2002 y NFR-2003 se cumplan por construcción
y no por suerte**. El requisito más incómodo de esta feature es que el usuario eligió cierre
voluntario, así que el dominio tiene que funcionar igual de bien con meses cerrados y sin ninguno.
Si el cierre entrara en el cálculo habría dos algoritmos que mantener sincronizados para siempre —
justo la clase de deuda que el propio análisis del modelo (`feature_context/analisis-del-modelo.md`)
documenta como origen de los defectos actuales. Manteniéndolo fuera del cálculo, el mundo «sin meses
cerrados» ES literalmente el código de hoy, sin ramas nuevas.

Y **FR-2007 sale gratis de FR-2003**: si las cifras de un mes cerrado no pueden cambiar, su saldo de
cierre tampoco puede, porque es una función de entradas congeladas. El «punto de partida fijo» del
mes siguiente no necesita mecanismo propio — es un teorema, no una feature.

Elecciones técnicas, todas dentro del stack vigente (sin dependencias nuevas):

| Decisión | Elección | Por qué |
|---|---|---|
| Dónde vive el estado de cierre | Dos columnas en la tabla `ledger` + tabla `closure_event` | La frontera es un escalar por usuario; el rastro es un historial. Ver ADR-11 |
| Cómo se hace cumplir | **Un solo punto de estrangulamiento**: diff del snapshot en `saveLedger` | Cubre las vías de escritura que aún no existen. Ver ADR-12 |
| Representación de la frontera | `closedThrough` + `reopened` (periodos «YYYY-MM») | Una racha continua se describe con su borde; `reopened` es el guardia contra caminar hacia atrás. Ver ADR-13 |
| Dónde valida | Cliente **y** servidor, con el dominio puro compartido | El cliente da la ergonomía; el servidor da el contrato (NFR-2005) |
| Versiones | TypeScript 5 · Next.js 15 · React 19 · Drizzle + Postgres 16 · Zustand · Vitest 3 · Playwright | Stack ya vigente; esta feature no introduce ninguna dependencia |

## System Architecture

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Browser (cliente)                                 │
│                                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │ DesktopShell                                                              │ │
│  │   ├── ClosureControl   (NUEVO) — «Cerrar agosto» / «Reabrir agosto»      │ │
│  │   │                     FR-2002 · FR-2005 · FR-2008 · FR-2009            │ │
│  │   ├── ClosureBanner    (NUEVO) — aviso de meses sin cerrar. FR-2006      │ │
│  │   │                     Hermano de StorageBanner: mismo sitio y patrón    │ │
│  │   ├── BudgetGrid       columnas cerradas marcadas. FR-2009               │ │
│  │   ├── BalanceModule    idem, mismo riel de columnas                       │ │
│  │   └── Toaster          explica el rechazo al intentar editar. FR-2009    │ │
│  └────────────────────────────────┬─────────────────────────────────────────┘ │
│                                   │                                            │
│  ┌────────────────────────────────▼─────────────────────────────────────────┐ │
│  │ State — useLedgerStore (Zustand)                                          │ │
│  │   closure: { closedThrough, reopened }        ← NUEVO, parte del snapshot │ │
│  │   closeMonth() · reopenMonth()                ← NUEVO                     │ │
│  │   useClosure()                                ← hook, patrón de BG-001    │ │
│  │   Cada mutación consulta isClosed() ANTES de mutar → rechaza y avisa      │ │
│  └────────────────────────────────┬─────────────────────────────────────────┘ │
│                                   │                                            │
│  ┌────────────────────────────────▼─────────────────────────────────────────┐ │
│  │ Dominio PURO — sin React, DOM, IO ni red; el reloj entra por parámetro    │ │
│  │                                                                           │ │
│  │  src/domain/closure.ts   (NUEVO)  ── la única autoridad sobre el cierre   │ │
│  │    isClosed · nextClosable · nextReopenable · closeMonth · reopenMonth    │ │
│  │    closedPeriodsViolated(prev, next, closure)   ← EL GUARDIA (FR-2003)    │ │
│  │                                                                           │ │
│  │  balance.ts · reserve.ts · tree.ts · range.ts   ── SIN CAMBIOS            │ │
│  │    No conocen el cierre. Reciben la misma lista de periodos que hoy.      │ │
│  └────────────────────────────────┬─────────────────────────────────────────┘ │
└───────────────────────────────────┼────────────────────────────────────────────┘
                                    │ HTTPS · cookie de sesión
┌───────────────────────────────────▼────────────────────────────────────────────┐
│                          Servidor (Next.js route handlers)                      │
│                                                                                 │
│   PUT /api/v1/ledger ──────► saveLedger()   ┐                                  │
│                                              ├─► closedPeriodsViolated()        │
│   POST /api/v1/movements ──► insertMovement()┘    (el MISMO módulo puro)        │
│   POST /api/v1/closure ────► closeMonth()    ← NUEVO                            │
│   DELETE /api/v1/closure ──► reopenMonth()   ← NUEVO                            │
│                                                                                 │
│   Los CUATRO comparten el guardia. No hay quinta vía de escritura: PATCH y      │
│   DELETE de /movements ya responden «unsupported» hoy.                          │
└───────────────────────────────────┬────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────────────┐
│  Postgres 16                                                                    │
│    ledger        + closed_through text NULL   + reopened_period text NULL       │
│    closure_event (NUEVA)  owner_id · period · action · at                       │
│    amount_cell · movement · cell_note · node   ── SIN CAMBIOS                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Responsabilidad de cada componente nuevo**

| Componente | Responsabilidad única |
|---|---|
| `src/domain/closure.ts` | Decidir qué está cerrado, qué es cerrable, qué es reabrible y qué mutación viola un mes cerrado. No persiste ni pinta |
| `ClosureControl` | Ofrecer las dos acciones y decir en qué estado está. No decide reglas: pregunta al dominio |
| `ClosureBanner` | Señalar que hay meses terminados sin cerrar. No cierra nada |
| `closure_event` | Conservar el rastro de cierres y reaperturas. Solo se le añaden filas |
| `POST/DELETE /api/v1/closure` | Mover la frontera con validación de servidor y bajo el mismo lock optimista |

## Data Model

### Contrato de preservación — lo que NO cambia

Esta feature es un incremento sobre un sistema en producción. **No se modifica ni una columna
existente**, y ésa es una decisión, no una casualidad: `amount_cell` y `cell_note` llevan el periodo
en su llave primaria desde la migración 0002 (multi-anio), y volver a tocarlas sería el segundo
cambio de llave primaria en dos semanas.

- `amount_cell`, `movement`, `cell_note`, `node`: **intactas**. El cierre no marca las filas; marca
  el periodo, y el periodo ya está en cada fila.
- `ledger.revision` y su bloqueo optimista: **intactos** (NFR-2007).
- `user.horizon`: intacta. El horizonte es una preferencia de usuario; el cierre es dato del ledger.
  Son cosas distintas y siguen viviendo en sitios distintos (ver ADR-11).
- `LedgerState` conserva todos sus campos; `closure` se añade como **delta aditivo opcional**, igual
  que `cellNotes` en FR-1012: un estado sin `closure` carga y opera como un ledger sin nada cerrado
  (FR-2001, tercer criterio).

### Delta que introduce esta feature

```sql
-- drizzle/0004_cierre_de_mes.sql
ALTER TABLE "ledger" ADD COLUMN "closed_through"  text;
ALTER TABLE "ledger" ADD COLUMN "reopened_period" text;

ALTER TABLE "ledger" ADD CONSTRAINT "ledger_closed_through_ck"
  CHECK ("closed_through"  IS NULL OR "closed_through"  ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_reopened_period_ck"
  CHECK ("reopened_period" IS NULL OR "reopened_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
-- Un mes reabierto solo existe si hay frontera: no se puede reabrir lo que nunca se cerro.
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_reopened_needs_boundary_ck"
  CHECK ("reopened_period" IS NULL OR "closed_through" IS NOT NULL);

CREATE TABLE "closure_event" (
  "id"       bigserial PRIMARY KEY,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "period"   text NOT NULL,
  "action"   text NOT NULL,
  "at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "closure_event_action_ck" CHECK ("action" in ('close','reopen')),
  CONSTRAINT "closure_event_period_ck" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE INDEX "closure_event_owner_at_idx" ON "closure_event" ("owner_id", "at" DESC);

UPDATE "ledger" SET "data_version" = 4 WHERE "data_version" < 4;
```

**Campos, con su significado exacto**

| Campo | Tipo | Nulo | Significado |
|---|---|---|---|
| `ledger.closed_through` | `text` «YYYY-MM» | sí | La frontera. **Todo periodo ≤ este valor está cerrado.** `NULL` = nada cerrado, que es el estado de todo usuario existente y de todo usuario nuevo |
| `ledger.reopened_period` | `text` «YYYY-MM» | sí | El mes actualmente reabierto, o `NULL`. Cuando no es nulo vale siempre `addMonths(closed_through, 1)`. Es el guardia de «uno a la vez» (FR-2005) |
| `closure_event.action` | `'close' \| 'reopen'` | no | Solo se INSERTA. Nunca se actualiza ni se borra: es el rastro (FR-2005) |

**Por qué la frontera es un escalar y no una marca por fila.** FR-2001 exige que los meses cerrados
sean una racha continua y FR-2002 que el cierre sea secuencial. Con una marca por mes, «racha
continua» sería un invariante que hay que vigilar en cada escritura y que se puede violar; con un
escalar, **es imposible de expresar un estado no contiguo**. El invariante se vuelve indecible en
vez de vigilado — que es la única clase de invariante que no se rompe.

**Migración.** `0004` es puramente aditiva: dos columnas nulables y una tabla nueva. No hay datos
que convertir (ningún usuario tiene cierres) y no toca ninguna llave primaria, así que no necesita
el orden de despliegue estricto que sí necesitó multi-anio. Corre en transacción y es idempotente
por `data_version` (NFR-2008). **No hay migración inversa** y es deliberado: revertir bastaría con
ignorar las columnas, y un `down` que las borrase destruiría el rastro de `closure_event`.

### El tipo en el dominio

```ts
// src/domain/types.ts — delta aditivo
export interface Closure {
  /** Todo periodo ≤ este valor está cerrado. null = nada cerrado. */
  closedThrough: PeriodKey | null;
  /** El mes actualmente reabierto, o null. Si no es null, vale addMonths(closedThrough, 1). */
  reopened: PeriodKey | null;
}

export interface LedgerState {
  // …campos existentes, sin cambios…
  /** Delta aditivo: ausente en estados previos — cargan y operan como si nada estuviera cerrado. */
  closure?: Closure;
}
```

## API Design

### Contrato preservado

`GET/PUT /api/v1/ledger` y `POST /api/v1/movements` **conservan su forma**: mismos verbos, mismos
cuerpos, mismos códigos. `PUT` sigue siendo un reemplazo transaccional con lock optimista por
`revision` que responde `409` en conflicto (FR-508 / ADR-06). Lo único que cambia es que ahora
pueden responder `422` cuando la escritura violaría un mes cerrado — un código que hoy no emiten,
así que ningún cliente existente rompe: nadie lo espera.

`PATCH` y `DELETE` de `/api/v1/movements/[id]` siguen respondiendo «unsupported», tal como hoy.

### Endpoints nuevos

```
POST /api/v1/closure                       auth: requerida
  Cierra el mes cerrable. El servidor decide CUÁL: el cliente no lo propone.
  request  { baseRevision: number }
  200      { revision: number, closure: { closedThrough, reopened } }
  409      { error: { code: "revision_conflict" }, revision }
  422      { error: { code: "not_closable",  detail: { closable: PeriodKey | null } } }
             — no hay mes cerrable, o el más antiguo abierto es futuro (FR-2002, FR-2008)
  401      sin sesión

DELETE /api/v1/closure                     auth: requerida
  Reabre el último mes cerrado.
  request  { baseRevision: number }
  200      { revision: number, closure: { closedThrough, reopened } }
  409      { error: { code: "revision_conflict" }, revision }
  422      { error: { code: "not_reopenable", detail: { reason: "nothing_closed" | "already_reopened" } } }
  401      sin sesión

GET /api/v1/closure/events                 auth: requerida
  El rastro (FR-2005). Solo lectura; del ownerId de la sesión.
  200      { events: Array<{ period: PeriodKey, action: "close" | "reopen", at: string }> }
```

**Por qué el cliente no propone qué mes cerrar.** Si el cuerpo llevara `period`, el servidor tendría
que validarlo y el cliente podría pedir cualquier cosa; mandando solo `baseRevision`, el mes
cerrable es una función del estado del servidor y **la petición no puede expresar un cierre fuera de
orden**. Misma filosofía que la frontera escalar: preferir lo indecible a lo vigilado.

### API interna del dominio (`src/domain/closure.ts`)

```ts
/** ¿Está cerrado este periodo? Es la pregunta que hace TODA mutación antes de mutar. */
export function isClosed(closure: Closure | undefined, period: PeriodKey): boolean;

/** El mes que se puede cerrar ahora: el abierto más antiguo, si no es futuro. null si ninguno. */
export function nextClosable(
  state: LedgerState, currentPeriod: PeriodKey
): PeriodKey | null;

/** El mes que se puede reabrir ahora: el último cerrado, salvo que ya haya uno reabierto. */
export function nextReopenable(closure: Closure | undefined): PeriodKey | null;

/** Mueve la frontera. Devuelve el resultado o el motivo del rechazo; NUNCA lanza. */
export function closeMonth(
  state: LedgerState, currentPeriod: PeriodKey
): { ok: true; closure: Closure; closed: PeriodKey } | { ok: false; reason: "not_closable" };

export function reopenMonth(
  state: LedgerState
): { ok: true; closure: Closure; reopened: PeriodKey }
 | { ok: false; reason: "nothing_closed" | "already_reopened" };

/**
 * EL GUARDIA (FR-2003, NFR-2005). Compara dos estados y devuelve los periodos CERRADOS cuyas
 * cifras difieren. Vacío = la mutación es legal. Ignora deliberadamente `cellNotes`: las
 * observaciones no se congelan (FR-2004).
 */
export function closedPeriodsViolated(
  prev: LedgerState, next: LedgerState
): PeriodKey[];

/** Meses ya terminados y sin cerrar. Alimenta el aviso de FR-2006. */
export function unclosedEndedPeriods(
  state: LedgerState, currentPeriod: PeriodKey
): PeriodKey[];
```

## Implementation Approach

**FR-2001: Un mes puede cerrarse, y su cierre forma parte del ledger**
Method: campo opcional `closure` en `LedgerState`, persistido en dos columnas de `ledger` y leído
por `loadLedger` como parte del snapshot; contigüidad garantizada por representación (frontera
escalar), no por validación.
I/O: `loadLedger(ownerId) → { revision, state: { …, closure? } }`; `saveLedger` escribe las dos
columnas dentro de la misma transacción que ya bloquea la fila ancla `FOR UPDATE`.
Failure: `closed_through` ilegible o fuera de formato → se trata como `null` (nada cerrado) y se
registra en el log; nunca impide arrancar. Es la misma política que `normalizeHorizon` (FR-1907).

**FR-2002: El cierre es SECUENCIAL**
Method: `nextClosable` = el primer periodo de `activeRange` estrictamente posterior a
`closedThrough` (o el más antiguo del rango si es `null`), descartado si es posterior al mes en
curso. El endpoint no acepta un periodo del cliente, así que un cierre fuera de orden no es
expresable.
I/O: `(LedgerState, currentPeriod) → PeriodKey | null`.
Failure: sin rango o sin mes cerrable → `null` → la UI deshabilita la acción y el endpoint responde
`422 not_closable` con `detail.closable`, que es lo que la UI muestra («primero cierra agosto»).

**FR-2003: Las cifras de un mes cerrado son inmutables**
Method: **punto de estrangulamiento por diff** (ADR-12). `closedPeriodsViolated` recorre
`budgets`, `actuals` y `movements` de ambos estados y compara por periodo, considerando altas,
bajas y cambios de valor; un movimiento cuenta como tocado si su periodo cambia hacia o desde un
mes cerrado. Se ejecuta en `saveLedger` e `insertMovement` (autoridad) y en el store antes de
mutar (ergonomía). Las seis vías enumeradas en el requisito quedan cubiertas por ser todas ellas
escrituras sobre esas tres estructuras — y una séptima que se añada mañana también.
I/O: `(prev: LedgerState, next: LedgerState) → PeriodKey[]`.
Failure: lista no vacía → la transacción se aborta antes de escribir y responde `422` con los
periodos violados; el cliente muestra el aviso y descarta la mutación local.

**FR-2004: Las observaciones de un mes cerrado siguen editables**
Method: omisión explícita — `closedPeriodsViolated` NO inspecciona `cellNotes`. Es una línea de
código y un comentario, y por eso se documenta aquí: la ausencia de una comprobación es
indistinguible de un olvido si nadie la declara.
I/O: sin contrato propio; es una propiedad del guardia.
Failure: n/a — una nota nunca puede violar el invariante porque no entra en ningún cálculo.

**FR-2005: Reapertura del último mes cerrado, una a la vez, con rastro**
Method: `reopenMonth` retrocede `closedThrough` un mes y fija `reopened` al mes liberado; exige
`reopened === null`, que es el guardia contra caminar hacia atrás. Volver a cerrar ese mismo mes
limpia `reopened`. El rastro se INSERTA en `closure_event` dentro de la misma transacción.
I/O: `(LedgerState) → { ok, closure, reopened } | { ok: false, reason }`.
Failure: `nothing_closed` o `already_reopened` → `422` con el motivo, sin tocar la frontera ni
insertar evento. Si el INSERT del evento falla, la transacción entera se revierte: **no existe una
reapertura sin rastro**.

**FR-2006: Aviso de meses sin cerrar; la app nunca cierra sola**
Method: `unclosedEndedPeriods` = periodos del rango activo estrictamente anteriores al mes en curso
y posteriores a `closedThrough`. `ClosureBanner` lo pinta con el mismo patrón que `StorageBanner`
(no envuelve nada cuando no hay aviso). No existe ningún temporizador, cron ni efecto que llame a
`closeMonth`: la ausencia de cierre automático se verifica por búsqueda, no por confianza.
I/O: `(LedgerState, currentPeriod) → PeriodKey[]`.
Failure: lista vacía → el componente no pinta nada.

**FR-2007: Cerrar fija el punto de partida del mes siguiente**
Method: **ninguno — es consecuencia de FR-2003.** El saldo de cierre de un mes es una función pura
de entradas que ya no pueden cambiar, así que el saldo de apertura del siguiente es estable sin
mecanismo alguno. No se congela ningún valor derivado ni se cachea nada: hacerlo introduciría una
segunda fuente de verdad que podría divergir del cálculo.
I/O: n/a.
Failure: n/a. La Fase 3 lo verifica como propiedad observable, no como código propio.

**FR-2008: Solo se cierra un mes terminado o el en curso; nunca uno futuro**
Method: `nextClosable` descarta cualquier candidato posterior al mes en curso, que entra por
parámetro (ADR-02: el dominio no lee el reloj).
I/O: parte del contrato de `nextClosable`.
Failure: candidato futuro → `null` → acción deshabilitada y `422 not_closable`.

**FR-2009: La interfaz muestra qué está cerrado y por qué no se deja editar**
Method: `useClosure()` (hook suscrito al estado, siguiendo el patrón que BG-001 obligó a adoptar en
`useActivePeriods`) marca las cabeceras de columna con `data-closed="true"` y un icono de candado;
las celdas cerradas pierden el control de edición y conservan el de observación. El rechazo se
comunica por el `Toaster` existente, con el texto que corresponda a si el mes es reabrible o no.
I/O: `() → Closure`; `data-closed` en `[data-month-head]` y en las celdas.
Failure: si el estado de cierre no llegó todavía, se pinta todo como abierto — el servidor sigue
rechazando, así que un pintado optimista nunca produce una escritura ilegal.

## Security Design

**Frontera de confianza.** Todo lo que llega por HTTP es hostil, incluida una petición fabricada a
mano con una cookie de sesión válida. El navegador **no** es parte de la base de cómputo confiable:
el `ClosureControl` deshabilitado y las celdas sin control de edición son ergonomía, no seguridad.

**NFR-2005 → control.** El guardia `closedPeriodsViolated` corre en el SERVIDOR, dentro de la
transacción de `saveLedger` y de `insertMovement`, **después** de tomar el lock `FOR UPDATE` de la
fila ancla y **antes** de cualquier escritura. Se compara contra el estado ya persistido, no contra
el que dice el cliente: un cliente que mienta sobre `prev` no consigue nada porque `prev` lo lee el
servidor. Los endpoints de cierre no aceptan un periodo del cliente (ver API Design), así que el
cierre fuera de orden y la reapertura ilegal no son expresables en el protocolo.

Esto importa especialmente aquí: **BG-002 de `backend` está abierto** — hoy `PUT /api/v1/ledger`
acepta cualquier snapshot sin validar los invariantes del dominio, porque la regla del techo vive
solo en el navegador. Esta feature no arregla ese bug (no es su alcance) pero **no repite su
patrón**: la regla del cierre nace validada en el servidor. El guardia que se introduce aquí es,
además, el sitio natural donde la validación del techo podrá engancharse cuando BG-002 se aborde.

- **Auth**: ambos endpoints nuevos usan `withApi({ auth: "required" })`, el mismo envoltorio del
  resto de `/api/v1`. El `ownerId` sale SIEMPRE de la sesión; un `ownerId` en el cuerpo se ignora,
  tal como ya hace `saveLedger`.
- **Validación de entrada**: cuerpo validado por esquema (`src/server/schemas.ts`) — solo
  `baseRevision: number`. Superficie de ataque mínima por diseño.
- **Inyección**: consultas por Drizzle parametrizado; los periodos además pasan por CHECK de
  formato en la base, que es una segunda barrera independiente del código.
- **XSS**: la feature no renderiza contenido del usuario nuevo. Las observaciones de celda ya
  existen y su tratamiento no cambia (FR-1012).
- **Fuga entre usuarios**: `closure_event` se consulta siempre filtrada por el `ownerId` de la
  sesión y su FK cae en cascada con el usuario.
- **Denegación**: los endpoints son O(1) sobre una fila; heredan el rate-limit del envoltorio.

## Performance & Scalability

**Cotas reales, no hipotéticas.** El caso máximo previsto es la estructura de 23 nodos por el rango
máximo de multi-anio (historial más 2 años ≈ 36–60 periodos): del orden de 1.400 celdas por mapa.

- `closedPeriodsViolated` es **O(celdas + movimientos)** con dos recorridos y comparación por clave:
  unos pocos miles de comparaciones de números, del orden de decenas de microsegundos. Se ejecuta
  una vez por escritura, no por render. NFR-2006 (≤150ms) tiene tres órdenes de magnitud de margen.
- `isClosed` es una comparación de dos cadenas «YYYY-MM» — el orden lexicográfico coincide con el
  cronológico desde FR-1901. **No se memoiza nada**: memoizar una comparación de cadenas cuesta más
  que la comparación.
- `nextClosable` y `unclosedEndedPeriods` recorren la lista de periodos del rango (decenas de
  elementos) y se consumen desde hooks suscritos al estado, con el mismo patrón de identidad estable
  que BG-001 impuso: devuelven listas memoizadas por identidad del estado para no disparar renders.
- **El cálculo no se toca**, así que el presupuesto de 150ms de `computeBalanceSeries` y `reserve.ts`
  (NFR-1907, heredado) queda exactamente donde está: esta feature no añade trabajo a la ruta
  caliente del recómputo (NFR-2002, NFR-2003, NFR-2006).
- `closure_event` crece ~2 filas al mes por usuario. Con índice `(owner_id, at DESC)` y un producto
  de usuario único, no hay problema de escala que resolver. Se declara explícitamente para no
  diseñar paginación que nadie necesita.

## Deployment Architecture

**Modelo de despliegue: aplicación Next.js 15 en Node (`next build` + `next start`), no
contenerizada.** Es el modelo vigente del proyecto y esta feature no da ninguna razón para cambiarlo.

- **Entornos**: desarrollo local contra el Postgres de `docker-compose.dev.yml`; producción contra
  el Postgres gestionado. Configuración por variables de entorno (`DATABASE_URL`), sin valores
  incrustados.
- **Orden de despliegue — SIN restricción, a diferencia de multi-anio.** La migración `0004` es
  puramente aditiva: dos columnas nulables y una tabla nueva. **El código viejo sigue funcionando
  contra la base migrada** (ignora columnas que no conoce) y el código nuevo funciona contra una
  base sin migrar en modo degradado. Se recomienda igualmente `pg_dump` → `npm run db:migrate` →
  desplegar, pero la ventana entre pasos no rompe nada.
- **Reversión**: revertir el código es seguro y no exige tocar la base. No se escribe migración
  inversa: borrar las columnas destruiría el rastro de `closure_event` y daría una falsa sensación
  de seguridad, el mismo criterio que se aplicó en multi-anio.
- **CI/CD**: sin cambios. Los `quality_gates` existentes (lint, typecheck, tokens de diseño,
  configuración de seguridad, escaneo de secretos y smoke) siguen siendo los mismos y esta feature
  no añade ninguno nuevo.
- **Observabilidad**: los rechazos por mes cerrado se registran con el envoltorio de log estructurado
  ya existente en `withApi`, con su código de error (`closed_period_violation`, `not_closable`,
  `not_reopenable`). `/health` no cambia. `closure_event` es, de hecho, la traza de auditoría del
  dominio.

## Risk Analysis

### Los cinco riesgos principales

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **El guardia se salta una vía de escritura** y una cifra cerrada cambia en silencio — el fallo que la feature existe para evitar | Punto de estrangulamiento único en la capa de persistencia (ADR-12), no comprobaciones repartidas. Cubre las vías futuras por construcción. La Fase 3 debe atacarlo con una prueba que enumere las seis vías y una que fabrique peticiones a mano |
| 2 | **Los dos mundos divergen**: el código con meses cerrados y el código sin ellos se comportan distinto en los meses abiertos | Mitigado por diseño: el cierre no entra en el cálculo, así que el mundo «sin cierres» es el código de hoy sin ramas. NFR-2002 lo verifica comparando resultados con y sin frontera |
| 3 | **BL-037 y BL-038 siguen vivos** y el usuario podría esperar que esta feature los disuelva | Está escrito en el `no_go_zone` y en el `project_summary`, y se le presentó antes de decidir. El riesgo es de expectativa, no técnico; se gestiona diciéndolo, no construyendo |
| 4 | **La reapertura deja el ledger en un estado que el usuario no esperaba**: reabre agosto, edita, y septiembre cambia bajo sus pies | Es correcto y deseado (el arrastre debe propagarse), pero debe ser VISIBLE. FR-2009 exige que se vea qué está reabierto; la Fase 3 debería cubrir el aviso al reabrir |
| 5 | **Concurrencia entre dispositivos**: dos pestañas, una cierra y la otra guarda una edición de ese mes | Resuelto por el lock optimista existente: la segunda recibe `409` y resincroniza. El guardia corre DESPUÉS del `FOR UPDATE`, así que no hay ventana entre validar y escribir |

### ADR-11: Dónde vive el estado de cierre

**Context:** el cierre tiene que persistir, viajar entre dispositivos y participar del bloqueo
optimista. Hay tres sitios plausibles en el esquema vigente.

- **Option A — Columnas en `ledger` + tabla `closure_event`.** La frontera es un escalar por usuario
  y vive junto a `revision`, así que entra gratis en la transacción y en el lock que ya existen. El
  rastro, que sí es un historial, vive en su propia tabla append-only. Coste: dos columnas nulables
  más en una tabla que ya tiene cuatro.
- **Option B — Marca por fila en `amount_cell` / `movement` / `cell_note`.** El cierre viajaría con
  el dato. Coste: tres tablas migradas por segunda vez en dos semanas, «racha continua» pasa a ser
  un invariante vigilado en vez de indecible, y cerrar un mes se vuelve un UPDATE masivo en vez de
  una asignación.
- **Option C — Preferencia de usuario, junto a `user.horizon`.** Coste inaceptable: el horizonte NO
  sube `revision` a propósito (FR-1907), y el cierre SÍ debe subirla porque cambia qué es editable.
  Meterlos juntos obligaría a partir la semántica de la tabla.

**Decision: Option A.** Es la única que hereda el lock optimista sin trabajo, la única que hace
imposible un estado no contiguo, y la única que no vuelve a tocar una llave primaria.

**Consequences:** habilita que `closure` viaje en el snapshot como delta aditivo, igual que
`cellNotes`; y restringe el modelo a «una sola frontera por usuario», que es exactamente lo que
FR-2001 y FR-2002 piden — si alguna vez se quisieran cierres no contiguos, esta decisión habría que
revisarla entera.

### ADR-12: Cómo se hace cumplir la inmutabilidad

**Context:** FR-2003 enumera seis vías de escritura y el requisito advierte que **una vía olvidada
es exactamente el fallo que la feature viene a evitar**. Hay que elegir dónde vive la comprobación.

- **Option A — Guardia por operación**: cada mutación (`setLeafAmount`, alta de movimiento, aporte,
  retiro, traslado…) pregunta `isClosed` antes de actuar. Ventaja: el rechazo es inmediato y el
  mensaje es específico. Coste: la corrección depende de que NADIE olvide la comprobación al añadir
  una mutación nueva — es decir, depende de disciplina indefinida.
- **Option B — Punto de estrangulamiento por diff**: una única función compara el estado entrante
  con el persistido y rechaza si alguna cifra de un periodo cerrado difiere. Ventaja: cubre las seis
  vías Y las que no existen todavía; la corrección no depende de recordar nada. Coste: el mensaje de
  error es menos específico y hay que recorrer el estado en cada escritura.
- **Option C — Constraints en la base**: un trigger que rechace escrituras sobre periodos cerrados.
  Ventaja: imposible de saltar. Coste: la lógica se parte entre TypeScript y PL/pgSQL, se vuelve
  intestable con Vitest y no puede compartirse con el cliente — el proyecto no tiene ningún trigger
  hoy y ésta sería la primera regla de negocio fuera del dominio puro.

**Decision: Option B como AUTORIDAD, Option A como ergonomía.** El diff en la capa de persistencia
es el contrato; las comprobaciones por operación en el store existen para dar retroalimentación
inmediata y desactivar controles, no para garantizar nada. Si las dos discrepasen, manda el
servidor.

**Consequences:** habilita que una vía de escritura futura quede protegida sin tocarla, que es la
propiedad que más importa aquí; y constriñe el mensaje de error del servidor a «estos periodos
cerrados cambiaron», por lo que la explicación fina (FR-2009) es responsabilidad del cliente. El
coste de recorrer el estado se mide en decenas de microsegundos (ver Performance).

### ADR-13: Cómo se impide caminar hacia atrás reabriendo

**Context:** FR-2005 exige que reabrir el último mes cerrado no permita alcanzar meses anteriores.
Sin un guardia, reabrir agosto deja la frontera en julio y julio pasa a ser «el último cerrado».

- **Option A — Marca de agua**: guardar `closedHighWater` y permitir reabrir solo si
  `closedThrough === closedHighWater`. Ventaja: un solo campo escalar. Coste: es un concepto que no
  significa nada para el usuario y no se puede pintar en pantalla.
- **Option B — `reopened` explícito**: guardar qué mes está reabierto ahora; reabrir exige que sea
  `null`. Ventaja: el mismo campo que impide el retroceso es el que la interfaz necesita para decir
  «agosto está reabierto» (FR-2009). Coste: hay que mantener el invariante
  `reopened === addMonths(closedThrough, 1)`.
- **Option C — Derivarlo de `closure_event`**: mirar el historial para saber si hay una reapertura
  sin cierre posterior. Ventaja: cero estado nuevo. Coste: convierte una tabla de auditoría en
  fuente de verdad operativa — si alguien purgara el historial, cambiaría el comportamiento.

**Decision: Option B.** Un campo que sirve a la vez de guardia y de dato de presentación es
preferible a uno que solo sirve de guardia, y mantiene la auditoría como lo que debe ser: un
registro que se puede leer, exportar o borrar sin alterar el comportamiento del sistema.

**Consequences:** habilita que la UI diga exactamente qué mes está reabierto; constriñe a validar el
invariante entre `reopened` y `closedThrough` en el borde de carga, donde se normaliza igual que
`normalizeHorizon`.

## Failure Blast Radius

**Component: Postgres**
Blast radius: se cae toda la persistencia. Ni cerrar, ni reabrir, ni guardar ni cargar.
User impact: el `StorageBanner` existente avisa de que no se pudo guardar; la app queda utilizable
en lectura con el último estado en memoria. El cierre y la reapertura aparecen deshabilitados.
Recovery: sin cambio respecto a hoy — reintento manual; el lock optimista impide que una escritura
tardía pise una posterior. Ninguna frontera queda a medias: `closeMonth` y su `closure_event` van en
la misma transacción.

**Component: `closedPeriodsViolated` (el guardia)**
Blast radius: si diera un falso NEGATIVO, se escribiría en un mes cerrado — es el único fallo que
rompe el criterio de éxito de la feature. Si diera un falso POSITIVO, se rechazarían escrituras
legítimas sobre meses abiertos y la app quedaría inutilizable para editar.
User impact: falso negativo — silencioso, que es lo grave: el usuario no ve nada y su historia se
corrompe. Falso positivo — ruidoso e inmediato: todo lo que edite se rechaza.
Recovery: el falso positivo se detecta solo, en el primer intento de edición. El falso negativo NO
se detecta solo, y por eso la Fase 3 debe cubrirlo con una prueba que compare el mes cerrado
completo antes y después de trastear el mes abierto (AC-2010), y no solo con pruebas de rechazo.

**Component: Capa de autenticación (`withApi`)**
Blast radius: sin sesión válida no hay cierre, reapertura ni consulta del rastro.
User impact: `401` y redirección al acceso, igual que en el resto de `/api/v1`.
Recovery: volver a autenticarse. El estado de cierre no se pierde: vive en la base, no en la sesión.

**Component: `useLedgerStore` (estado del cliente)**
Blast radius: si `closure` no llega o llega corrupto, la UI pinta todo como abierto.
User impact: el usuario ve controles de edición que el servidor va a rechazar; recibe el aviso al
intentar guardar.
Recovery: degradación segura por diseño — el pintado optimista es incapaz de producir una escritura
ilegal, porque la autoridad está en el servidor (ADR-12). Recargar resincroniza.

## Technical Risk Flags

```
[RISK] El congelamiento se apoya en una capa que hoy no valida nada
Conflict: NFR-2005 exige que el servidor rechace toda escritura sobre un mes cerrado, pero
          PUT /api/v1/ledger acepta hoy cualquier snapshot sin validar invariantes del dominio
          (BG-002 de la feature backend, abierto y de severidad high)
Mitigation: esta feature NO hereda ese patrón: introduce el guardia dentro de la transacción de
          saveLedger, después del FOR UPDATE y antes de escribir, comparando contra el estado
          persistido y no contra lo que afirme el cliente. No arregla BG-002 —no es su alcance—
          pero crea el punto donde la validación del techo podrá engancharse cuando se aborde
Severity: medium
```

```
[RISK] El cierre voluntario obliga al dominio a soportar dos mundos indefinidamente
Conflict: NFR-2002 exige que un ledger sin meses cerrados se comporte EXACTAMENTE como hoy, y el
          usuario eligió cierre voluntario (no_go_zone), así que ese mundo no desaparece nunca:
          no hay fecha a partir de la cual pueda retirarse el camino antiguo
Mitigation: se elimina la bifurcación por diseño en vez de gestionarla — el cierre no entra en el
          cálculo, solo en el permiso de escritura, así que no hay dos algoritmos sino uno con una
          puerta delante. El mundo «sin cierres» es el código actual sin ramas nuevas
Severity: medium
```

```
[RISK] Un falso negativo del guardia es silencioso
Conflict: FR-2003 y el criterio de éxito exigen CERO alteraciones en meses cerrados, pero un fallo
          del guardia por defecto no produce ningún síntoma visible: la cifra cambia y nadie se
          entera, que es exactamente la clase de defecto que la feature existe para eliminar
Mitigation: la Fase 3 no puede limitarse a probar que los rechazos ocurren; necesita al menos una
          prueba de PROPIEDAD que capture el mes cerrado completo, ejecute la batería de las seis
          vías de escritura sobre el mes abierto y compare la captura entera (AC-2010). Es la única
          forma de detectar una vía olvidada, porque una prueba por vía solo cubre las que se
          recordaron
Severity: high
```

```
[RISK] Reabrir mueve cifras de meses posteriores sin que el usuario lo pida
Conflict: FR-2005 exige que la reapertura propague el recálculo hacia adelante, y FR-2007 que el
          futuro siga editable: al reabrir agosto y corregirlo, el saldo de apertura de septiembre
          y todo lo que cuelga de él cambian solos
Mitigation: es el comportamiento correcto —un libro contable continuo no puede hacer otra cosa—
          pero no puede ser invisible. FR-2009 exige señalar qué está reabierto; el diseño deja al
          cliente la explicación fina. Se marca aquí para que la Fase 3 cubra la visibilidad del
          efecto y no solo su corrección aritmética
Severity: medium
```

```
[RISK] Ninguno de escala, rendimiento ni compatibilidad de stack
Conflict: ninguno detectado. El guardia es O(celdas+movimientos) sobre un máximo de ~1.400 celdas,
          tres órdenes de magnitud por debajo del presupuesto de 150ms (NFR-2006); la migración es
          aditiva y no impone orden de despliegue; no se añade ninguna dependencia; y el producto es
          de usuario único, sin requisitos de concurrencia, alta disponibilidad, búsqueda de texto,
          almacenamiento de ficheros, offline ni cumplimiento normativo que puedan chocar con
          Next.js 15 sobre Postgres 16
Mitigation: n/a — se declara explícitamente para dejar constancia de que las categorías se
          revisaron una por una y no se omitieron
Severity: low
```

## Traceability Checklist

- [x] **Todo FR está atendido por al menos un componente** — FR-2001 (`ledger` + `closure.ts` +
      `loadLedger`/`saveLedger`), FR-2002 (`nextClosable` + `POST /closure`), FR-2003
      (`closedPeriodsViolated` en `saveLedger` e `insertMovement`), FR-2004 (omisión declarada de
      `cellNotes` en el guardia), FR-2005 (`reopenMonth` + `reopened` + `closure_event` +
      `DELETE /closure`), FR-2006 (`unclosedEndedPeriods` + `ClosureBanner`), FR-2007 (consecuencia
      de FR-2003, sin componente propio y declarado como tal), FR-2008 (`nextClosable` con el mes en
      curso por parámetro), FR-2009 (`useClosure` + `data-closed` + `Toaster`).
- [x] **Implementation Approach tiene entrada para cada MUST FR** — las nueve, incluida la de
      FR-2007, que es un «no se implementa nada» explícito y razonado, nunca un salto silencioso.
- [x] **Todo NFR tiene una decisión de diseño** — NFR-2001 (sin cambios de contrato: nada que
      adaptar en la suite existente), NFR-2002 y NFR-2003 (el cierre fuera del cálculo),
      NFR-2004 (`activeRange` intacto; el cierre no recorta el rango), NFR-2005 (Security Design),
      NFR-2006 (Performance & Scalability), NFR-2007 (contrato de preservación: `revision` y su
      lock intactos), NFR-2008 (migración `0004` aditiva, en transacción, idempotente por
      `data_version`).
- [x] **Todo ADR evalúa ≥2 opciones** — ADR-11 (3), ADR-12 (3), ADR-13 (3).
- [x] **Ningún elemento del `no_go_zone` aparece en la arquitectura** — no hay ajuste-en-mes-abierto,
      no hay temporizador ni cron de cierre automático, no se toca la maquinaria del techo
      (BL-037/BL-038), no hay forma de reabrir dos meses ni de alcanzar uno anterior al último
      cerrado, no hay saldo inicial ni página de Configuración, no hay roles ni permisos, no hay
      multi-moneda, y no hay exportación ni archivado.
- [x] **Blast radius documentado para ≥2 componentes críticos** — cuatro: Postgres, el guardia, la
      capa de autenticación y el estado del cliente.
- [x] **Technical Risk Flags completo** — cinco entradas, cuatro riesgos reales con severidad y una
      declaración explícita de «ninguno detectado» para las categorías de stack revisadas.
