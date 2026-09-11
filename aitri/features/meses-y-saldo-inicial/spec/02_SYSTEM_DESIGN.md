# Technical Design Document (TRD / SDD) — meses-y-saldo-inicial

## Executive Summary

Esta feature **no funda arquitectura**: se acopla a la existente, y su valor de diseño está en
elegir DÓNDE encaja cada pieza dentro de patrones que el producto ya estableció.

**El cálculo no se reescribe.** `computeBalanceSeries(state, periods, opening)` acepta la apertura
desde FR-2010 de `cierre-de-mes`, con `ZERO_CARRY` por defecto. Esta feature se limita a alimentar
ese parámetro. Cero fórmulas nuevas, cero cascada tocada.

**Tecnologías — ninguna nueva.** Next.js 15 (App Router) · React 19 · TypeScript · Zustand
(`useLedgerStore`, singleton de módulo) · Drizzle + PostgreSQL · Zod en el borde HTTP ·
`next-themes` para el tema. Razón de no añadir dependencias: las cuatro piezas que faltan —una
columna, una tarjeta, una ruta y un cableado— se construyen enteras con lo que ya está en el
`package.json`, y una dependencia nueva sería coste de mantenimiento sin capacidad nueva.

**Las cuatro decisiones que importan**, cada una con su ADR y su precedente en el propio repositorio:

| | Decisión | Precedente que la gobierna |
|---|---|---|
| ADR-01 | Los dos valores viven en **columnas de `ledger`**, no en `user` | ADR-11 de `cierre-de-mes`: `closed_through` vive ahí «para heredar gratis el lock optimista — a diferencia de `user.horizon`, que es preferencia y NO sube revision» |
| ADR-02 | Se escriben por un **endpoint dedicado**, no por el PUT del snapshot | NFR-2205 y **BG-002** (abierto, high): «PUT /api/v1/ledger acepta cualquier snapshot sin validar los invariantes del dominio: la regla vive SOLO en el navegador» |
| ADR-03 | **Una sola derivación** de la apertura, consumida por todos los llamadores | `closure.ts:85` también arranca una serie en la cabeza del rango: dos derivaciones se separarían |
| ADR-04 | El mes de inicio es un **tercer ancla** del rango, no un recorte | ADR-14 de `multi-anio` y NFR-2203: «se AÑADE como ancla, no sustituye a las existentes» |

**Lo que este documento NO diseña**, porque ya existe y está verificado en el código el 2026-09-06:
la grilla dinámica por meses (`src/domain/range.ts`, FR-1904/FR-1906), el multi-año (`PeriodKey` es
`"YYYY-MM"`), y la frontera del cierre con su reapertura auditada (FR-2005), que esta feature
CONSUME sin tocar.

---

## System Architecture

El diagrama muestra **solo el delta**. Todo lo no marcado es la arquitectura raíz aprobada, sin
cambios. `[+]` = pieza nueva · `[~]` = pieza existente que se modifica · `[-]` = pieza que se retira.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Browser (cliente)                                │
│                                                                               │
│   app/page.tsx  ──────────────────────┐        ┌──────────────────────────┐  │
│      │                                 │        │ [+] app/configuracion/    │  │
│      │  ≤760px          >760px         │        │     page.tsx              │  │
│      ▼                    ▼            │        │  Ruta propia. 5 ajustes:  │  │
│  ┌──────────────┐  ┌──────────────────┐│        │  tema · ancho · horizonte │  │
│  │ MobileShell  │  │ DesktopShell     ││        │  · mes inicio · saldo ini │  │
│  │ [~] +botón   │  │ [~] +botón ajustes│        │  «Volver» → router.push   │  │
│  │   ajustes    │  │ [-] −HorizonSelect│◄───────┤   (navegación de cliente) │  │
│  └──────┬───────┘  └────────┬─────────┘│        └────────────┬─────────────┘  │
│         │                    │          │                     │                │
│         │          ┌─────────▼────────┐ │                     │                │
│         │          │ BudgetGrid       │ │                     │                │
│         │          │ [+] <OpeningCard>│ │  la tarjeta de      │                │
│         │          │  sobre la grilla │ │  arranque (FR-2203) │                │
│         │          │ [~] BalanceModule│ │  NO existe ≤760px   │                │
│         │          └─────────┬────────┘ │                     │                │
│         └──────────┬─────────┘          │                     │                │
│                    ▼                     ▼                     ▼                │
│   ┌───────────────────────────────────────────────────────────────────────┐   │
│   │  useLedgerStore (Zustand) — SINGLETON DE MÓDULO                       │   │
│   │  [+] setStart(startMonth, openingBalance)   [~] data.startMonth/       │   │
│   │      un solo save, una sola subida de revision      .openingBalance    │   │
│   │  Sobrevive a la navegación cliente ⇒ volver de /configuracion NO       │   │
│   │  re-hidrata ni pierde el estado de la grilla (criterio de FR-2204)     │   │
│   └───────────────┬───────────────────────────────────┬───────────────────┘   │
│                   ▼                                    ▼                        │
│   ┌───────────────────────────────────┐   ┌───────────────────────────────┐   │
│   │  domain/ (TS puro, sin efectos)   │   │  ServerRepository             │   │
│   │  [+] opening.ts                   │   │  [+] saveStart()              │   │
│   │      · normalizeStartMonth()      │   └───────────┬───────────────────┘   │
│   │      · openingCarry(state,periods)│               │                        │
│   │      · orphanedByStart()          │               │                        │
│   │  [~] range.ts   → 3.er ancla      │               │                        │
│   │  [~] balance.ts → llamadores      │               │                        │
│   │  [~] closure.ts → closingCarry    │               │                        │
│   └───────────────────────────────────┘               │ fetch JSON             │
└───────────────────────────────────────────────────────┼────────────────────────┘
                                                        │ cookie SameSite
┌───────────────────────────────────────────────────────▼────────────────────────┐
│                    Servidor Next.js (mismo bundle)                              │
│   [+] PUT /api/v1/ledger/start   — withApi{auth:required, schema, mutation}     │
│       Valida EN SERVIDOR: mes abierto (FR-2205) · sin huérfanos (FR-2206)       │
│       · monto ≥0 finito. 200 · 409 stale · 422 regla · 401 sin sesión           │
│   [~] GET/PUT /api/v1/ledger     — el snapshot ahora TRANSPORTA los dos campos  │
│       (lectura). El PUT los IGNORA: mismo trato que `closure` (ADR-02)          │
│   [~] syncHub.publish            — los otros dispositivos, al día (FR-511)      │
└────────────────────────────────┬────────────────────────────────────────────────┘
                                 │ Drizzle
                   ┌─────────────▼─────────────────────────┐
                   │  PostgreSQL — tabla `ledger`          │
                   │  [+] start_month      text NULL       │
                   │  [+] opening_balance  bigint NULL     │
                   │  (junto a closed_through: mismo lock) │
                   └───────────────────────────────────────┘
```

**Componentes y responsabilidad — solo los nuevos y los modificados:**

- **`domain/opening.ts` [+]** — módulo puro, sin efectos. Tres funciones y ninguna más:
  `normalizeStartMonth(v)` (tolerante a basura → `null`), `openingCarry(state, periods)` (la ÚNICA
  derivación de la apertura, ADR-03) y `orphanedByStart(state, candidate)` (los periodos con datos
  que quedarían fuera si el inicio se moviera a `candidate` — la regla de FR-2206). Vive en
  `domain/` y no en el store porque es lógica verificable sin montar componentes, igual que
  `closure.ts`.
- **`range.ts` [~]** — `activeRange` gana el mes de inicio como TERCER ancla, junto a
  `oldestPeriodWithData` y la frontera del cierre. Sin mes declarado, la función es byte a byte la
  de hoy (NFR-2203).
- **`closure.ts` [~]** — `closingCarry` pasa a arrancar su serie con `openingCarry(...)` en vez de
  con el defecto. Es el acoplamiento no obvio de esta feature: sin este cambio, el saldo que el
  cierre fotografía y el que el Balance pinta se separarían en cuanto alguien declarara apertura.
- **`OpeningCard` [+]** — presentacional. No lee del servidor: recibe `startMonth`, `hasData` y el
  callback `setStart` del store. Se monta dentro de `BudgetGrid` (solo escritorio, por construcción:
  `MobileShell` no importa la grilla).
- **`app/configuracion/page.tsx` [+]** — ruta cliente. Reúne los cinco ajustes; tres de ellos
  (tema, ancho, horizonte) reutilizan mecanismos existentes sin duplicarlos.
- **`PUT /api/v1/ledger/start` [+]** — el único punto de escritura de los dos valores. Es donde
  viven las reglas de FR-2205 y FR-2206 del lado del servidor.

**Patrón de interacción:** el mismo de siempre — UI optimista, mutación en el store, persistencia
diferida y serializada, `StorageBanner` si el guardado no llega, SSE a los demás dispositivos. La
única salvedad es que `setStart` **no** es optimista sin red: como el servidor puede rechazar por
regla (422), la tarjeta y Configuración esperan la respuesta antes de dar el cambio por bueno. Es
la misma disciplina que ya siguen los endpoints de cierre.

---

## Data Model

### Contrato de preservación — lo que NO puede cambiar

| Elemento | Compromiso |
|---|---|
| `LedgerState` (`domain/types.ts`) | Los 6 campos actuales conservan nombre, tipo y semántica. Los dos nuevos son **opcionales**, como `cellNotes` (FR-1012) y `closure` (FR-2001) |
| Tabla `ledger` | Las 8 columnas actuales no se alteran. Las dos nuevas son `NULL`ables, sin default no nulo, sin backfill |
| `data_version` | **NO se toca.** Esa columna marca el formato de las CELDAS DE MONTO, y aquí no cambia ninguna. Es la decisión que `drizzle/0005_cierre_impacto.sql:11` ya documentó al añadir columnas de forma aditiva |
| `computeBalanceSeries` | Firma intacta. `opening` ya existe y ya vale `ZERO_CARRY` por defecto |
| `oldestPeriodWithData`, `newestPeriodWithData` | Sin cambios. `activeRange` los sigue consultando igual |
| Fila «Saldo del mes anterior» | `balanceRows.ts:135` no se toca: mismo `key`, `label`, `tone`, `level`, `weight` y `alarms` |
| Ledger existente sin declarar | Ambas columnas `NULL` ≡ «no declarado» ≡ comportamiento de hoy, byte a byte (NFR-2201) |

### El delta

**Dominio** — `LedgerState` gana dos campos opcionales:

```ts
export interface LedgerState {
  // … los 6 existentes, sin cambios …
  /** Delta aditivo (FR-2201): ausente ≡ sin mes de inicio declarado. */
  startMonth?: PeriodKeyT | null;
  /** Delta aditivo (FR-2202): ausente ≡ sin saldo declarado. Entero COP ≥ 0. */
  openingBalance?: number | null;
}
```

**Base de datos** — migración `drizzle/0006_saldo_inicial.sql`, puramente aditiva e idempotente
por `IF NOT EXISTS` (el patrón de 0005), sin tocar `data_version`:

| Columna | Tipo | Restricción | Razón |
|---|---|---|---|
| `start_month` | `text` NULL | `CHECK` formato `^\d{4}-(0[1-9]\|1[0-2])$` | Mismo tipo y misma validación de forma que `closed_through`, que ya guarda un `PeriodKey` como texto |
| `opening_balance` | `bigint` NULL | `CHECK (opening_balance >= 0)` | `bigint` como `reopen_base_available`, por el mismo motivo: los montos son enteros COP y pueden superar `integer`. El `>= 0` es la regla de FR-2202 en su última defensa |

**Un `CHECK` de coherencia**, con el mismo espíritu que `ledger_reopen_baseline_ck` de la 0005:

```sql
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_opening_ck"
  CHECK ("opening_balance" IS NULL OR "start_month" IS NOT NULL);
```

Razón: un saldo de apertura sin mes al que aplicarse no significa nada — la base impide ese estado
en vez de confiar en que nadie lo escriba. Lo inverso SÍ es legal: mes declarado sin saldo es
exactamente el estado 3 y 4 de la tarjeta (`«Empiezo desde cero»` y `teclear sin responder`), donde
el usuario declaró CUÁNDO empieza pero no trae dinero previo. El saldo ausente se lee como 0.

**Invariante de dominio que la base NO puede expresar** y por tanto vive en el servidor (ADR-02):
`start_month` no puede moverse hacia adelante dejando periodos con datos fuera. Eso exige mirar
`budgets`, `actuals`, `movements` y `cell_note`, así que es una regla de aplicación, no un `CHECK`.

---

## API Design

### Contrato preservado

| Endpoint | Compromiso |
|---|---|
| `GET /api/v1/ledger` | Sigue devolviendo `{ revision, state }`. `state` ahora **puede** traer `startMonth` y `openingBalance`; un cliente viejo los ignora sin romperse |
| `PUT /api/v1/ledger` | Firma intacta. Acepta los dos campos en el cuerpo pero **los IGNORA al escribir**, exactamente como ya hace con `state.closure`. Declararlos en `ledgerStateSchema` **no es opcional**: ese mismo esquema valida la RESPUESTA que `ServerRepository.load()` parsea, y Zod descarta lo que no declara — sin la línea, los dos valores viajarían correctos desde el servidor y desaparecerían en silencio antes de tocar el store. Es literalmente la trampa que `schemas.ts:77-84` documenta para `closure` |
| `PUT /api/v1/preferences/horizon` | Sin cambios. El horizonte sigue siendo preferencia de cuenta y **no** sube `revision` |
| `POST` / `DELETE /api/v1/closure` | Sin cambios. Esta feature consume la frontera, no la mueve |

### El endpoint nuevo

```
PUT /api/v1/ledger/start
```

| | |
|---|---|
| **Auth** | `withApi({ auth: "required", schema: startPutSchema, mutation: true })`. El `ownerId` sale de la SESIÓN; uno en el cuerpo se ignora (misma regla que `/api/v1/closure`) |
| **Request** | `{ baseRevision: number, startMonth: PeriodKey, openingBalance: number \| null }` |
| **200** | `{ revision, startMonth, openingBalance }` |
| **409** | `{ error: { code: "revision_conflict" }, revision }` — lock optimista, igual que el resto del ledger |
| **422** | `{ error: { code, detail } }` con `code ∈ { "month_closed", "would_orphan", "invalid_amount" }`. `detail` de `would_orphan` lleva `{ periods: PeriodKey[] }` — los meses concretos que quedarían fuera, que es lo que el mensaje de FR-2206 tiene que nombrar |
| **401** | Sin sesión. Nunca 200 sin sesión (NFR-2205) |

Esquema Zod, junto a los existentes en `server/schemas.ts`:

```ts
export const startPutSchema = z.object({
  baseRevision: z.number().int().gte(0),
  startMonth: PERIOD_KEY,
  openingBalance: z.number().int().gte(0).finite().nullable(),
});
```

**Un solo endpoint para los dos valores, no dos.** El usuario declara UN hecho —«mi historia
empieza en junio con 1.200.000»— y partirlo en dos escrituras crearía una ventana en la que el mes
ya cambió pero el saldo todavía no, con la cascada recalculada a medias entre las dos. Además sube
`revision` una sola vez, que es lo que el flujo A3 del spec de UX describe.

### Superficie interna nueva (`domain/opening.ts`)

```ts
/** Tolerante a basura: cualquier cosa que no sea un PeriodKey válido → null. */
export function normalizeStartMonth(v: unknown): PeriodKey | null;

/**
 * La ÚNICA derivación de la apertura (ADR-03). Devuelve el carry declarado si y solo si la serie
 * arranca EXACTAMENTE en el mes de inicio; en cualquier otro caso, ZERO_CARRY.
 */
export function openingCarry(state: LedgerState, periods: readonly PeriodKey[]): Carry;

/** Los periodos CON DATOS que quedarían fuera si el inicio se moviera a `candidate` (FR-2206). */
export function orphanedByStart(state: LedgerState, candidate: PeriodKey): PeriodKey[];
```

---

## Implementation Approach

**FR-2201: El usuario declara el mes en que empieza su historia**
*Method:* `start_month` como TERCER ancla de `activeRange`, junto a `oldestPeriodWithData` y la
frontera del cierre. El mes declarado fija el suelo del rango; los otros dos anclas lo extienden
hacia atrás si fueran anteriores, de modo que un dato previo nunca queda oculto (ADR-04). Sin mes
declarado la expresión se reduce a la de hoy, término a término.
*I/O:* `activeRange(state, currentPeriod, horizon)` → `PeriodKey[]`, sin cambio de firma.
*Failure:* `start_month` corrupto o con formato inválido ⇒ `normalizeStartMonth` devuelve `null` y
el rango se comporta como si no hubiera declaración. Nunca un rango que arranca en un periodo
inválido — la misma regla que `oldestPeriodWithData` ya aplica a las claves basura.

**FR-2202: El saldo inicial abre el primer mes del historial**
*Method:* alimentar el parámetro `opening` que `computeBalanceSeries` ya acepta, con el valor de
`openingCarry(state, periods)`. Cero fórmula nueva. El carry declarado es
`{ available: openingBalance, reservedBalance: 0 }` — las alcancías arrancan vacías por decisión
del usuario (el saldo inicial es UN número).
*I/O:* `openingCarry(state, periods)` → `Carry`; `computeBalanceSeries(state, periods, carry)` →
`BalanceSeries` sin cambio de firma.
*Failure:* saldo ausente o `null` ⇒ `ZERO_CARRY`, indistinguible de hoy en las cifras. Negativo o no
finito ⇒ rechazado en el borde HTTP (422) y, si aun así llegara a estado, `openingCarry` lo trata
como ausente en vez de propagar `NaN` a toda la serie.
*Nota de alcance:* «Resultado del mes» es `flow = income − expense` y `balance.ts:36` documenta que
NO incluye el arrastre ni las reservas, así que la apertura no lo toca por construcción. No hace
falta ninguna guarda para el criterio de aceptación 2.

**FR-2203: La tarjeta de arranque pregunta una vez y se aparta**
*Method:* renderizado condicional dentro de `BudgetGrid`, gobernado por un predicado derivado del
estado —`sin datos ∧ sin declaración`— y por NADA más. Sin marca propia de «ya preguntado»: esa es
la decisión del usuario que hace que la tarjeta vuelva si el ledger se borra (FR-2207). Las cuatro
salidas convergen en la misma escritura: `setStart(mes, monto|0)`.
*I/O:* `(hasData: boolean, startMonth, openingBalance) → boolean` para la visibilidad;
`setStart(startMonth, openingBalance)` para las cuatro resoluciones.
*Failure:* si la escritura falla, la tarjeta NO se retira y el monto tecleado permanece en el campo;
el fallo lo comunica el `StorageBanner` existente. Nunca desaparece por un guardado que no llegó.
*Por construcción:* no existe en móvil — `MobileShell` no importa `BudgetGrid`, así que la garantía
es estructural, no una media query que alguien pueda cambiar.

**FR-2204: Una página de Configuración que reúne lo configurable**
*Method:* ruta de App Router `app/configuracion/page.tsx` (`"use client"`), alcanzable con
`router.push` desde ambas cabeceras — el patrón que `app/recuperar/page.tsx` ya usa. Los cinco
ajustes se conectan a sus mecanismos EXISTENTES sin duplicar ninguno: `next-themes` (`setTheme`),
`writeCatWidth`/`clampCatWidth` de `lib/gridWidth.ts`, `setHorizon` del store, y `setStart` para los
dos nuevos. `HorizonSelect` se MUEVE aquí sin reescribirse y se retira de `DesktopShell` (FR-1907).
*I/O:* ruta `/configuracion` → pantalla; cada control invoca su setter existente.
*Failure:* la página se pinta aunque el ledger no cargue; los dos ajustes de «Tu historia» aparecen
deshabilitados con su motivo, y los tres de presentación siguen operando (no dependen del ledger).
Volver nunca pierde el estado: `useLedgerStore` es un singleton de módulo y `hydrated` sigue en
`true`, así que la navegación de cliente no re-hidrata.

**FR-2205: El saldo inicial solo se edita con su mes abierto**
*Method:* `isClosed(closureOf(state), startMonth)` — el predicado que `domain/closure.ts:105` ya
expone. Se evalúa en DOS sitios y por dos motivos distintos: en el cliente para deshabilitar el
campo y explicar la vía (prevenir, no castigar), y en el servidor dentro del endpoint para que la
regla no viva solo en el navegador (NFR-2205, lección de BG-002).
*I/O:* `(closure, startMonth) → boolean`; en el endpoint, `true` ⇒ `422 { code: "month_closed" }`.
*Failure:* el rechazo es total — ni el mes ni el saldo cambian, `revision` no sube y ninguna cifra
de ningún periodo se altera.

**FR-2206: Mover el mes de inicio hacia adelante no puede dejar datos huérfanos**
*Method:* `orphanedByStart(state, candidate)` recorre las CUATRO fuentes de dato que
`oldestPeriodWithData` ya considera —`budgets`, `actuals`, `movements` y `cellNotes`— y devuelve los
periodos anteriores a `candidate` que tienen alguno. Lista no vacía ⇒ bloqueo. Reutilizar el mismo
criterio de «qué cuenta como dato» no es economía: si divergiera, un mes con solo una observación
sería visible para el rango e invisible para el bloqueo, y se perdería en silencio.
*I/O:* `(state, candidate) → PeriodKey[]`; en el endpoint, no vacía ⇒
`422 { code: "would_orphan", detail: { periods } }`.
*Failure:* rechazo total, sin mutación. Mover hacia atrás nunca se evalúa: no puede huerfanar nada.
Mover hacia adelante sobre meses vacíos devuelve lista vacía y se acepta.

**FR-2207: Mes de inicio y saldo inicial persisten en el servidor como parte del ledger**
*Method:* dos columnas en `ledger`, junto a `revision` y `closed_through`, escritas en la misma
transacción que incrementa la revisión (ADR-01). Lectura: `loadLedger` las proyecta al snapshot;
`ledgerStateSchema` las declara para que sobrevivan al parseo de la respuesta.
*I/O:* `saveStart(ownerId, baseRevision, startMonth, openingBalance)` →
`{ ok, revision } | { conflict, revision } | { rejected }`.
*Failure:* `baseRevision` obsoleta ⇒ 409 sin escribir, y el cliente hace `resync` como con cualquier
otra mutación. Ledger sin las columnas ⇒ ambas `NULL` ≡ no declarado. Borrado del ledger ⇒ las
columnas caen con la fila (`ON DELETE CASCADE` del `ownerId`), que es exactamente la regla que el
usuario decidió: la tarjeta vuelve a preguntar como el primer día.

---

## Security Design

**Superficie añadida: un (1) endpoint mutador.** Ninguna ruta pública nueva, ningún dato nuevo
expuesto a terceros, ninguna dependencia nueva.

**NFR-2205 → controles concretos:**

| Exigencia del NFR | Control de diseño |
|---|---|
| «ningún endpoint nuevo sin sesión» | `withApi({ auth: "required" })` — la misma envoltura de todas las rutas. Sin sesión, 401 antes de tocar el dominio |
| «un usuario no puede leer ni escribir la apertura de otro» | El `ownerId` sale de la sesión, **nunca del cuerpo**. La fila de `ledger` tiene `owner_id` como PK con `references(user.id)`, así que la consulta está acotada por construcción. Un `ownerId` en el cuerpo se ignora, igual que en `/api/v1/closure` |
| «se validan en el SERVIDOR, no solo en el navegador» | Las dos reglas de dominio —mes cerrado (FR-2205) y huérfanos (FR-2206)— se evalúan **dentro del endpoint**, en la misma transacción que la escritura. Es la razón de existir de ADR-02 |
| «la lección de BG-002» | BG-002 sigue ABIERTO en `PUT /api/v1/ledger` y esta feature **no lo hereda**: el snapshot no es la vía de escritura de estos dos valores. La deuda existente no se agranda |

**Validación de entrada:** Zod en el borde (`startPutSchema`) antes de castear — `PERIOD_KEY` para
la forma del mes, `z.number().int().gte(0).finite()` para el monto. Tres defensas en profundidad
para el monto: Zod en el borde, la regla de dominio, y el `CHECK (opening_balance >= 0)` de la
columna como última barrera.

**Fronteras de confianza:**

1. **HTTP → servidor** (`PUT /api/v1/ledger/start`): entra dato no confiable. Se cruza con sesión
   verificada + Zod + allowlist de `Origin` en mutación (defensa en profundidad; la defensa CSRF
   efectiva es la cookie `SameSite`).
2. **Servidor → PostgreSQL**: Drizzle con consultas parametrizadas. Cero SQL construido por
   concatenación, cero superficie de inyección.
3. **Servidor → cliente**: el snapshot cruza validado por `ledgerStateSchema` en AMBOS sentidos.
4. **Sin cambio de privilegio en ninguna parte:** no hay roles, no hay escalada posible. Un usuario
   solo alcanza su propia fila.

**XSS:** los dos valores son un `PeriodKey` y un entero. Ninguno se renderiza como HTML ni alimenta
`dangerouslySetInnerHTML`; React escapa por defecto. El único texto libre del ledger son las
observaciones de celda, que esta feature no toca.

---

## Performance & Scalability

**NFR-2204 — coste añadido: ninguno medible, y la razón es estructural, no una medición optimista.**

| Operación | Coste | Razón |
|---|---|---|
| `openingCarry(state, periods)` | O(1) | Dos lecturas de campo y una comparación de cadenas. No recorre nada |
| `activeRange` con el 3.er ancla | O(1) añadido | Un `normalizeStartMonth` y una comparación más sobre una lista de tres. Los barridos de `oldestPeriodWithData`/`newestPeriodWithData` son los mismos de hoy |
| `computeBalanceSeries` | **0** | La firma ya aceptaba `opening`. Se pasa otro valor, no se hace otro trabajo |
| `orphanedByStart` | O(celdas) | **Solo en el servidor y solo al escribir el mes de inicio** — una acción rara, no una ruta caliente. Mismo orden que `oldestPeriodWithData`, que ya corre en cada derivación del rango |

El guardarraíl vigente de **150 ms** para la derivación de la serie de doce meses se mantiene sin
cambios: ningún camino de render gana un barrido nuevo.

**Memoización:** `periodsFor` cachea `activeRange` por identidad de estado y horizonte
(`store.ts:56`). El mes de inicio viaja DENTRO de `state`, así que declararlo produce una identidad
nueva y la caché se invalida sola — sin tocar la clave de caché. Este detalle importa: BG-001 de
`multi-anio` fue exactamente lo contrario (consumidores suscritos a una identidad que nunca
cambiaba), y aquí no se repite porque el dato no es una preferencia externa al estado.

**Cotas de tamaño:** dos escalares por usuario. `text` de 7 bytes y un `bigint`. Sin índices nuevos
—no se consulta por ellos, se leen con la fila que ya se lee por PK—, sin paginación, sin caché
nueva.

---

## Deployment Architecture

**Modelo: containerizado.** Sin cambios respecto de la raíz — la feature no introduce ningún
artefacto desplegable nuevo.

```
Docker (next start)  →  Nginx (TLS + cabeceras)  →  Ultron (Pi 5)
```

**Lo único que el despliegue gana es una migración**: `drizzle/0006_saldo_inicial.sql`, que corre
con el mismo mecanismo que las cinco anteriores.

- **Aditiva y sin backfill:** dos columnas `NULL`ables. Ningún `UPDATE` masivo, ningún bloqueo largo
  sobre la tabla.
- **Idempotente por `IF NOT EXISTS` / `DROP ... IF EXISTS`**, NO por `data_version` — el patrón que
  `0005_cierre_impacto.sql` estableció y documentó.
- **Compatible hacia atrás durante el despliegue:** la versión anterior del código sigue funcionando
  con las columnas presentes, porque las ignora. No hace falta ventana de mantenimiento ni
  despliegue coordinado.
- **Reversible:** revertir es soltar las dos columnas y el `CHECK`. No hay dato que reconstruir,
  porque nada más depende de ellos.

**Entornos:** los de hoy (desarrollo local con Postgres en Docker, producción en Ultron). **CI/CD:**
sin cambios. **Gates:** los ya declarados en el `04_BUILD_REPORT.json` del proyecto; esta feature no
añade ninguno nuevo, y su gate de humo sigue siendo el mismo `/health`.

---

## Risk Analysis

### ADR-01: Dónde viven el mes de inicio y el saldo inicial

**Context:** son dos valores por usuario que hay que persistir. El producto tiene dos sitios
posibles y ya usa los dos: columnas en `ledger` (bajo lock optimista) o columnas en `user`
(preferencias, sin lock).
**Option A — columnas en `user`, como `horizon`:** más simple, sin lock, escritura barata. Pero
`horizon` NO altera ninguna cifra: solo decide cuántas columnas se pintan. El saldo inicial SÍ las
altera.
**Option B — columnas en `ledger`, como `closed_through`:** hereda el lock optimista por `revision`
sin escribir una línea. Coste: toda escritura sube `revision` y obliga a los otros dispositivos a
resincronizar.
**Decision: B.** El criterio ya lo fijó `cierre-de-mes` y está escrito en `db/schema.ts`:
`closed_through` vive junto a `revision` «para heredar gratis el lock optimista — a diferencia de
`user.horizon`, que es preferencia de presentación y NO sube revision». El saldo inicial está del
lado del cierre, no del horizonte.
**Consequences:** habilita que dos pestañas no se pisen la apertura en silencio (criterio de
FR-2207). Restringe: cambiar el saldo inicial invalida la revisión de los demás dispositivos —
aceptable, porque cambia todas las cifras y necesitan enterarse de todos modos.

### ADR-02: Por dónde se escriben

**Context:** el cliente ya sabe hacer `PUT /api/v1/ledger` con el snapshot completo. Añadir dos
campos ahí sería el camino de menor código.
**Option A — por el snapshot:** cero endpoints nuevos, cero rutas que mantener. Pero las reglas de
FR-2205 (mes cerrado) y FR-2206 (huérfanos) quedarían solo en el navegador, y el servidor aceptaría
cualquier apertura que le llegara.
**Option B — endpoint dedicado `PUT /api/v1/ledger/start`:** una ruta más que mantener, a cambio de
un punto único donde las dos reglas se evalúan en servidor, dentro de la misma transacción.
**Decision: B.** NFR-2205 lo exige por escrito («se validan en el SERVIDOR, no solo en el
navegador») y el proyecto tiene el contraejemplo abierto: **BG-002, severidad high** — «PUT
/api/v1/ledger acepta cualquier snapshot sin validar los invariantes del dominio: la regla vive SOLO
en el navegador». Repetir ese patrón para una regla nueva sería añadir deuda conocida a sabiendas.
Además el precedente es literal: `saveLedger` ya IGNORA `state.closure` a propósito, porque la
frontera solo la mueven sus endpoints.
**Consequences:** habilita códigos de rechazo específicos (`month_closed`, `would_orphan`) con el
detalle que FR-2206 necesita para nombrar los meses. Restringe: el cliente tiene que esperar la
respuesta antes de dar el cambio por bueno; no es una mutación optimista pura.

### ADR-03: Cómo llega la apertura a la serie

**Context:** `computeBalanceSeries` acepta `opening`, pero tiene VARIOS llamadores que arrancan una
serie en la cabeza del rango, no solo la UI del Balance.
**Option A — que cada llamador calcule su apertura:** directo, sin módulo nuevo. Pero
`BalanceModule.tsx:320` y `closure.ts:85` (`closingCarry`) tendrían dos copias de la misma regla, y
`closingCarry` es lo que el cierre FOTOGRAFÍA al reabrir un mes: si se separan, el saldo que el
cierre guarda deja de ser el que el Balance muestra, y el impacto aguas abajo se calcula contra una
referencia falsa.
**Option B — una función `openingCarry(state, periods)` en el dominio, consumida por todos.**
**Decision: B.** El acoplamiento no es hipotético: `closingCarry` llama hoy
`computeBalanceSeries(state, upTo)` sin apertura, y su propio comentario dice que se calcula «con la
misma serie que pinta el Balance: una sola fuente de verdad, sin fórmula paralela». Mantener esa
promesa exige que la apertura también sea una sola.
**Consequences:** habilita cablear el cierre y el Balance de una vez y verificarlo con una prueba de
dominio, sin montar componentes. Restringe: todo llamador futuro que arranque una serie en la cabeza
del rango DEBE pasar por `openingCarry` — se documenta en el módulo para que no se olvide.

### ADR-04: Cómo el mes de inicio afecta al rango

**Context:** `activeRange` decide qué meses existen. El mes declarado tiene que hacer visible un
junio vacío, pero no puede esconder un dato.
**Option A — recortar el rango en el mes de inicio:** cumple literalmente «no se muestran meses
anteriores». Pero si por cualquier vía existiera un dato antes, quedaría invisible e incorregible.
**Option B — tercer ancla, junto a `oldest` y la frontera del cierre:** el mes declarado fija el
suelo; un dato o una frontera anteriores lo extienden hacia atrás.
**Decision: B.** NFR-2203 lo pide con esas palabras («se AÑADE como ancla, no sustituye a las
existentes») y ADR-14 de `multi-anio` ya resolvió el mismo dilema para el cierre: «un mes cerrado
fuera del rango es un mes que el usuario no puede ver ni —tras reabrirlo— corregir». El caso de dato
anterior es además inalcanzable por la UI, porque FR-2206 lo bloquea: la opción B solo se comporta
distinto en un estado que no debería existir, y ahí falla de forma segura.
**Consequences:** habilita que declarar el mes nunca pueda ocultar dinero. Restringe: la propiedad
«no hay meses anteriores» se sostiene por la regla de escritura (FR-2206), no por el recorte de
lectura — así que esa regla no es opcional.

### Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| **R1** | **`closingCarry` se olvida** y el cierre fotografía un saldo sin la apertura | **Alto.** El impacto aguas abajo de FR-2010 se mediría contra una referencia falsa, y en silencio: nada falla, solo salen cifras distintas | ADR-03 lo convierte en una sola derivación. Fase 3 debe cubrirlo con un caso explícito: declarar apertura, cerrar un mes, reabrirlo, y comprobar que la línea de base incluye la apertura |
| **R2** | **La serie arranca en un mes ≠ `startMonth`** (dato anterior por vía no prevista) y la apertura se aplicaría al mes equivocado | Medio | `openingCarry` devuelve el carry declarado **si y solo si** `periods[0] === startMonth`; en cualquier otro caso `ZERO_CARRY`. Falla hacia «como hoy», nunca hacia una cifra inventada |
| **R3** | **Regresión silenciosa en quien no declara** (NFR-2201) | Alto si ocurre: afecta a todos los usuarios actuales | Ausencia ⇒ `ZERO_CARRY` y rango idéntico término a término. Fase 3 debe verificarlo comparando series **byte a byte** con y sin los campos, no solo comprobando que «no revienta» |
| **R4** | **`data_version` inconsistente, preexistente y ajeno a esta feature.** `drizzle/0002_multi_anio.sql:53` hace `UPDATE ledger SET data_version = 6`, mientras `ledgerRepo.ts` topa en `DATA_VERSION_COUNTERPARTY = 5`. Todo ledger queda en 6, que es ≥ 5, así que `ensureV4InTx` retorna temprano y la migración v3→v4 se saltaría en un ledger que aún no la hubiera hecho | Desconocido; **fuera del alcance de esta feature** | Se declara aquí porque la migración 0006 toca la MISMA tabla y el revisor debe saberlo. **No se corrige aquí**: es territorio de `multi-anio` y no está registrado como bug. La 0006 **no toca `data_version`**, así que no agranda el problema. Acción sugerida: registrarlo como bug propio |
| **R5** | **La tarjeta desaparece por un guardado que no llegó**, y el usuario cree haber declarado | Medio | La tarjeta solo se retira tras respuesta 200. Fallo ⇒ permanece con el monto intacto y el `StorageBanner` lo dice. Nunca un falso «guardado» (BG-012, BL-022) |

---

## Failure Blast Radius

**Component: PostgreSQL (tabla `ledger`)**
*Blast radius:* deja de poder declararse o leerse la apertura; con la base caída, todo el ledger
está caído — esta feature no amplía el radio existente.
*User impact:* el usuario nuevo ve la tarjeta y, al guardar, recibe el aviso de persistencia; el
monto no se pierde. El usuario en marcha ve sus cifras del último snapshot cargado.
*Recovery:* reintento manual desde la tarjeta o desde Configuración. Ningún estado a medias: la
escritura es una transacción única que sube `revision` o no hace nada.

**Component: `PUT /api/v1/ledger/start` (endpoint nuevo)**
*Blast radius:* solo la declaración de apertura. **Todo lo demás del producto sigue operando** —
registrar, editar la grilla, cerrar mes, dashboard: ninguno lo consume.
*User impact:* con 5xx, el aviso de persistencia y la tarjeta que no se retira. Con 409, un
resync transparente. Con 422, el mensaje concreto de la regla que lo impidió.
*Recovery:* reintentar. Es idempotente en efecto: guardar dos veces el mismo par deja el mismo
estado (sube `revision` dos veces, que es inocuo).

**Component: capa de autenticación (Better Auth / sesión)**
*Blast radius:* el endpoint devuelve 401 y no se declara nada. Igual que el resto de `/api/v1`.
*User impact:* la app cae a la pantalla de sesión expirada, que ya existe.
*Recovery:* volver a iniciar sesión. Nada del ledger se pierde: el snapshot está en el servidor.

**Component: `openingCarry` (derivación de dominio)**
*Blast radius:* si devolviera un valor incorrecto, **toda la serie de saldos** desde el mes de
inicio saldría desplazada — es el punto más sensible de la feature, porque falla en silencio: las
cifras siguen cuadrando entre sí, solo que sobre una base equivocada.
*User impact:* saldos consistentes pero falsos. No hay error visible, y ése es exactamente el
peligro.
*Recovery:* no hay recuperación en ejecución. La defensa es de diseño: función pura, sin efectos,
con la guarda `periods[0] === startMonth` que la hace degradar a `ZERO_CARRY` ante cualquier duda, y
verificable exhaustivamente en Fase 3 sin montar UI.

---

## Traceability Checklist

- [x] **Todo FR está tratado por al menos un componente.** FR-2201 → `range.ts` + `opening.ts` ·
  FR-2202 → `opening.ts` + `balance.ts` (llamadores) · FR-2203 → `OpeningCard` · FR-2204 →
  `app/configuracion/page.tsx` + ambas cabeceras · FR-2205 → endpoint + `closure.isClosed` ·
  FR-2206 → `orphanedByStart` + endpoint · FR-2207 → migración 0006 + `ledgerRepo` + `schemas.ts`
- [x] **Implementation Approach tiene entrada para los 7 MUST FR.** Ninguno marcado como
  auto-evidente.
- [x] **Todo NFR tiene decisión de diseño.** NFR-2201 → apertura ausente ⇒ `ZERO_CARRY` (R3) ·
  NFR-2202 → cero cambios de firma, todo aditivo · NFR-2203 → ADR-04, tercer ancla ·
  NFR-2204 → sección Performance, coste O(1) en el camino de render · NFR-2205 → sección Security,
  tabla de mapeo · NFR-2206 → FR-2203, sin scrim ni foco atrapado, garantía estructural en móvil
- [x] **Los 4 ADR evalúan ≥2 opciones**, con la opción descartada nombrada y su coste dicho.
- [x] **Ningún elemento del `no_go_zone` aparece en la arquitectura.** Verificado uno a uno: no se
  rediseña la grilla dinámica (se consume `range.ts`) · no hay multi-año · no se mueve la frontera
  del cierre (solo se lee `isClosed`) · no hay saldo por bolsillo (el carry declarado lleva
  `reservedBalance: 0`) · no se renombra la fila del Balance (`balanceRows.ts:135` intacto) · los
  ajustes son cinco, sin inventar ninguno · no hay formulario de bienvenida · la celda del Balance
  no es editable · no se construye borrado de datos (solo la consecuencia del `ON DELETE CASCADE`)
  · la tarjeta no llega al móvil, y por construcción.
- [x] **Radio de impacto documentado para 4 componentes críticos** (base de datos, endpoint nuevo,
  autenticación, y la derivación de dominio).
- [x] **Technical Risk Flags completa** — ver abajo.

---

## Technical Risk Flags

Análisis del stack elegido contra los 7 FR y los 6 NFR. **Tres banderas**, ninguna bloqueante; las
tres son cosas que el humano debe saber ANTES de aprobar.

**🚩 FLAG-1 — El cambio de mayor riesgo no está en ningún FR: es `closingCarry`.**
Toda la feature parece un cableado de UI, y seis de los siete FR lo son. Pero
`domain/closure.ts:85` arranca una serie en la cabeza del rango sin apertura, y es lo que
`cierre-de-mes` fotografía al reabrir un mes (FR-2010). Si esa llamada no recibe la apertura, el
cierre y el Balance divergen **en silencio**: nada falla, ninguna prueba existente se pone en rojo
—porque hoy nadie declara apertura— y el impacto aguas abajo se mide contra una referencia falsa.
*Por qué se declara:* es un cambio en el dominio de OTRA feature ya cerrada 5/5, y no lo pide
ninguna línea de los requisitos: sale de leer el código. La Fase 3 tiene que cubrirlo con un caso
propio, y el revisor debe saber que existe.

**🚩 FLAG-2 — La propiedad «no se muestran meses anteriores al de inicio» NO la garantiza la lectura.**
ADR-04 elige no recortar el rango, para que un dato anterior nunca quede oculto. La consecuencia es
que esa propiedad se sostiene **enteramente** sobre la regla de escritura de FR-2206: si el bloqueo
de huérfanos fallara o se relajara, aparecerían meses anteriores al declarado sin que nada más lo
impida. Es una decisión deliberada —preferimos un mes de más visible a dinero invisible— pero
acopla dos requisitos que a primera vista son independientes.
*Consecuencia para Fase 3:* FR-2206 no es un caso de borde de la UI; es el guardián de una
propiedad de FR-2201.

**🚩 FLAG-3 — Inconsistencia preexistente de `data_version` en la misma tabla que se migra.**
`drizzle/0002_multi_anio.sql:53` estampa `data_version = 6` mientras `ledgerRepo.ts` topa en 5
(`DATA_VERSION_COUNTERPARTY`). No lo causa esta feature y **no se corrige aquí** —es territorio de
`multi-anio` y no está registrado como bug—, pero la migración 0006 toca esa misma tabla y sería
deshonesto no declararlo. La 0006 no toca `data_version` en absoluto, siguiendo el criterio que
`0005_cierre_impacto.sql:11` ya dejó escrito. *Acción sugerida al humano:* registrarlo como bug
propio para que no se pierda.

**No detectado:** ninguna incompatibilidad de stack, ningún desajuste de rendimiento (el camino de
render no gana barridos), ninguna tensión de escalado (dos escalares por usuario), ninguna
dependencia nueva y ninguna capacidad que el stack vigente no cubra.
