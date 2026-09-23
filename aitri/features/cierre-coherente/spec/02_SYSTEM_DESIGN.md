# Technical Design Document (TRD / SDD)

Feature **cierre-coherente** — el mes que el botón nombra es el que el servidor cierra.

## Executive Summary

Cambio de lógica puro sobre el stack vigente, sin tecnologías nuevas, sin migraciones y sin rutas nuevas:
Next.js 15 (App Router) + TypeScript, dominio puro en `src/domain`, contrato `/api/v1` y persistencia por
snapshot en `src/server/data/ledgerRepo.ts`.

El delta son tres piezas:

1. **`closureScope(state)`** (nueva, en `ledgerRepo.ts`): el rango con el que se decide el cierre, igual que
   `serverScope` pero anclando ADEMÁS en el mes de inicio declarado. Es una función NUEVA y no un cambio de
   `serverScope`, porque `serverScope` lo usan también todas las ESCRITURAS (PUT, POST, PATCH, DELETE) para
   juzgar techo, piso y arrastre: ampliarlo allí cambiaría el veredicto de rutas que esta feature no toca
   (ADR-01).
2. **`start_month` dentro del estado del cierre**: hoy `loadStateInTx` NO lo carga, así que el estado con el
   que `closeMonthFor` y `reopenMonthFor` trabajan no conoce el mes de inicio. Se añade al estado que esas
   dos funciones componen, leyéndolo de la fila `ledger` que ya tienen a la vista (`head`).
3. **Nada más cambia**: `nextClosable`, `closeMonth` y `reopenMonth` (dominio, `src/domain/closure.ts`) ya
   reciben el rango como PARÁMETRO (ADR-02 de cierre-de-mes) y se quedan intactos. Toda la corrección entra
   por el rango que se les pasa.

El cliente NO cambia: `activeBounds` ya ancla en el mes de inicio declarado (`src/domain/range.ts:117`). Lo
que hace esta feature es que el servidor use el mismo suelo.

## System Architecture

```
 Navegador                                     Servidor (route handlers)
 ┌────────────────────────────────┐            ┌──────────────────────────────────────────────┐
 │ Botón «Cerrar <mes>»           │            │ POST /api/v1/closure   { baseRevision }      │
 │   activeBounds(state, hoy)     │            │   closeMonthFor(ownerId, baseRevision, hoy)  │
 │     ancla: dato + cierre +     │            │     state = loadStateInTx(tx)                │
 │            START_MONTH  ──┐    │            │     + startMonth  ← head.start_month  (NUEVO)│
 │   nextClosable(state, hoy, │    │  POST      │     closureScope(state)               (NUEVO)│
 │                rango)      │    │ ─────────► │       ancla: dato + START_MONTH + mes actual │
 │            ▼               │    │            │     closeMonth(state, mesActual, rango)      │
 │   «Cerrar Julio»           │    │            │       nextClosable → MISMO mes que el botón  │
 └────────────────────────────┘    │            │     closeBlockers(…, closureScope(…))        │
                                   │            │     UPDATE ledger.closed_through             │
                                   │            └──────────────────────────────────────────────┘
        mismo suelo en las dos capas ──┘
```

| Componente | Responsabilidad en esta feature |
|---|---|
| `src/server/data/ledgerRepo.ts` `closureScope` (nuevo) | El rango del CIERRE: `serverScope` + el mes de inicio declarado como suelo |
| `src/server/data/ledgerRepo.ts` `closeMonthFor` | Compone el estado CON `startMonth` y pasa `closureScope` a `closeMonth` y a `closeBlockers` |
| `src/server/data/ledgerRepo.ts` `reopenMonthFor` | Igual, para que el rango de la reapertura no discrepe del que cerró |
| `src/server/data/ledgerRepo.ts` `serverScope` | SIN CAMBIOS: lo siguen usando las escrituras |
| `src/domain/closure.ts` `nextClosable`, `closeMonth`, `reopenMonth` | SIN CAMBIOS: reciben el rango como parámetro |
| `src/domain/range.ts` `activeBounds` | SIN CAMBIOS: el cliente ya ancla en el mes de inicio |

## Data Model

### Contrato de preservación (NO cambia)
- **Ninguna tabla, columna, CHECK ni índice cambia. No hay migración.** El mes de inicio ya vive en
  `ledger.start_month` (`text` nullable, feature meses-y-saldo-inicial, FR-2201) y ya se valida al
  declararse (`startPutSchema`, `setStartMonthFor`).
- `ledger.closed_through`, `reopened_period`, `reopen_base_available` y `reopen_base_reserved` conservan su
  forma y su significado; el CHECK `ledger_reopen_baseline_ck` sigue gobernando el par reabierto/línea base.
- Ninguna fila se reescribe por esta feature.

### Delta
Ninguno en la base. El delta es en MEMORIA: el `LedgerState` que `closeMonthFor` y `reopenMonthFor`
componen pasa a llevar `startMonth` (el mismo campo que `loadLedger` ya rellena por fuera de la
transacción, `openingFromRow`).

## API Design

**Sin endpoints nuevos y sin cambios de contrato.**

### Contrato preservado
- `POST /api/v1/closure` (auth: sesión requerida, `mutation: true`) body `{ baseRevision }` →
  `200 { revision, closedThrough }` · `409 revision_conflict` · `422 not_closable` ·
  `422 unbalanced_cells { period, cells }` (FR-2512 de diario-de-celda). Los códigos y sus cuerpos no
  cambian.
- `DELETE /api/v1/closure` (reabrir) conserva su contrato.
- `GET`/`PUT /api/v1/ledger` no se tocan.

Lo que cambia es **qué mes** devuelve `closedThrough` en un ledger cuyo inicio declarado es anterior a su
primer dato: antes el primer periodo con datos, ahora el mes de inicio declarado.

### Delta en la API interna
```ts
// src/server/data/ledgerRepo.ts
/** El rango del CIERRE: como serverScope, pero anclando también en el mes de inicio declarado. */
export function closureScope(state: LedgerState, extra?: PeriodKey): PeriodKey[];
```
`serverScope(state, extra?)` conserva su firma y su comportamiento.

## Implementation Approach

FR-2701: el servidor ancla su rango también en el mes de inicio declarado
Method: `closureScope(state, extra)` reúne los mismos extremos que `serverScope` —`oldestPeriodWithData`,
`newestPeriodWithData`, `extra`— y añade `normalizeStartMonth(state.startMonth)`. El suelo es el MÍNIMO de
todos, así que un dato anterior al inicio declarado sigue extendiendo el rango hacia atrás y el inicio
declarado solo puede ampliarlo, nunca recortarlo. `normalizeStartMonth` ya devuelve `null` ante un valor
ausente o inválido, y un `null` se filtra igual que hoy. La lista final sale del calendario del dueño
(`calendarOf`), como en `serverScope`, para que en modo ciclos lleve las claves de transición.
I/O: `(state, extra?)` → `PeriodKey[]` continuo de suelo a techo.
Failure: sin datos y sin inicio declarado, devuelve lo mismo que `serverScope` hoy (`[extra]` o `[]`).

FR-2702: cerrar avanza mes a mes desde el mes de inicio declarado
Method: `closeMonthFor` compone el estado con `startMonth` (de `head.start_month`, vía `openingFromRow`) y
pasa `closureScope(conCierre, currentPeriod)` a `closeMonth` y a `closeBlockers`. El avance mes a mes ya lo
hace `nextClosable`: sin nada cerrado toma `range[0]` —ahora el mes de inicio— y con algo cerrado, el
primero posterior a `closedThrough`. Un mes vacío se cierra igual porque `nextClosable` no mira contenido.
I/O: `POST /api/v1/closure` → `closed_through` = mes de inicio declarado en la primera petición.
Failure: si el mes objetivo cae después del mes en curso, `nextClosable` devuelve `null` y la ruta responde
`422 not_closable` sin escribir (comportamiento vigente, FR-2008).

FR-2703: el mes que el botón nombra es el que el servidor cierra
Method: no hay código propio — es la CONSECUENCIA de que las dos capas usen el mismo suelo. Lo que la
feature añade es la prueba que lo fija: sobre el mismo `LedgerState`, `nextClosable(state, hoy, rango del
cliente)` y `nextClosable(state, hoy, closureScope(state, hoy))` deben devolver el mismo periodo, y se
comprueba sobre una tabla de estados con inicio declarado y primer dato distintos.
I/O: mismo `PeriodKey` en las dos capas.
Failure: si difieren, la prueba falla nombrando los dos meses.

NFR-2701..2705 (regresión): se cumplen por construcción —`serverScope` intacto para las escrituras,
`nextClosable`/`closeMonth`/`reopenMonth` intactos, sin cambios de esquema ni de contrato— y se verifican con
tests en la fase 3.

## Security Design

- **NFR-2706 está declarado «No aplica»** en la fase 1 y la razón se mantiene: la feature no añade rutas,
  entradas ni datos nuevos. No se lee nada del cuerpo de la petición que no se leyera ya.
- **Autenticación/autorización sin cambios:** `POST/DELETE /api/v1/closure` siguen con
  `withApi({ auth: "required", mutation: true })`, exigencia de `Origin` y todo filtrado por `ownerId` de la
  sesión (FR-505, FR-507).
- **Frontera de confianza:** el único valor que se empieza a leer, `ledger.start_month`, NO es entrada de
  esta petición: es un dato del propio dueño, ya validado al declararse (`startPutSchema`) y normalizado otra
  vez con `normalizeStartMonth` antes de usarse. Un valor corrupto en la base degrada a `null`, es decir, al
  comportamiento de hoy.
- **Bloqueo optimista:** el cierre sigue comparando `baseRevision` bajo `SELECT … FOR UPDATE`, así que dos
  cierres simultáneos siguen resolviéndose con un `409` y no con un doble avance.

## Performance & Scalability

- `closureScope` añade una comparación de cadenas a un cálculo que ya recorre celdas y movimientos: coste
  despreciable.
- El rango puede crecer en los meses vacíos entre el inicio declarado y el primer dato. Son claves de
  periodo, no filas: con un inicio declarado un año antes, son 12 claves más en una lista que ya recorre el
  historial completo. `closeBlockers` itera ese rango, pero solo consulta celdas que existen.
- Sin consultas nuevas: `start_month` viene en la fila `ledger` que la transacción ya bloqueó.

## Deployment Architecture

- **Modelo:** contenedor Docker (imagen `t-ledger:<sha>`) + Postgres en contenedor, en Ultron (Raspberry Pi
  5) publicado por Tailscale. Sin cambios de topología.
- **Migraciones: NINGUNA.** Es el primer despliegue de una feature desde la 0009 que no toca el esquema.
- **Orden:** indiferente. La imagen nueva y la anterior leen y escriben exactamente las mismas columnas.
- **Rollback:** volver la imagen anterior es suficiente y no pierde nada. Lo único que revierte es el
  comportamiento: el mes cerrable vuelve a anclarse en el primer dato. Un mes que ya se cerró sigue cerrado.
- **Entornos:** dev (Postgres local, `:3100`), e2e (Testcontainers), producción (Ultron).
- **CI/CD:** sin cambios en `.github/workflows/ci.yml`.

## Risk Analysis

1. **Ampliar el rango en las ESCRITURAS** — si el ancla nueva se metiera en `serverScope`, el guardia de
   techo, piso y arrastre de PUT/POST/PATCH/DELETE pasaría a juzgar meses vacíos anteriores al primer dato, y
   un veredicto que hoy pasa podría cambiar. Mitigación: función aparte (`closureScope`, ADR-01) usada solo
   por el cierre y la reapertura; `serverScope` se queda como está, y un test fija que las escrituras siguen
   juzgando el mismo rango.
2. **El estado del cierre no lleva `startMonth`** — `loadStateInTx` no lo carga, así que anclar en él sin
   añadirlo al estado no haría nada: el defecto seguiría vivo y los tests de dominio pasarían igual, que es
   la peor combinación. Mitigación: se compone explícitamente en `closeMonthFor` y `reopenMonthFor`, y hay un
   test de integración que cierra por la ruta real y mira `closed_through` en la base, no en el dominio.
3. **Cerrar y reabrir con rangos distintos** — si el cierre anclara en el inicio declarado y la reapertura
   no, la línea base de la reapertura se calcularía sobre otra serie. Mitigación: las dos usan
   `closureScope`; un test cierra tres meses y los reabre en orden inverso.
4. **Meses vacíos que se cierran «sin querer»** — con un inicio declarado muy anterior, el usuario tendría
   que pulsar varias veces para llegar a su primer mes con datos. Es la consecuencia ACEPTADA de la opción
   elegida (decisión del usuario del 2026-09-22): nada se congela sin que él lo cierre. Mitigación: ninguna
   técnica; queda escrito aquí y en el brief.

### ADRs

ADR-01: Rango propio para el cierre en vez de ampliar `serverScope`
Context: el cliente ancla en el mes de inicio declarado y el servidor no; hay que igualarlos.
Option A: añadir el ancla dentro de `serverScope` — un solo sitio; pero `serverScope` gobierna también el
juicio de todas las escrituras (líneas 585, 740, 746, 754, 849, 869 de `ledgerRepo.ts`), que esta feature no
quiere tocar.
Option B: `closureScope` nueva, usada solo por `closeMonthFor`, `reopenMonthFor` y `closeBlockers` — el radio
de explosión queda acotado al cierre; a cambio hay dos funciones parecidas y el riesgo de que alguien use la
equivocada.
Decision: B, con `closureScope` implementada EN TÉRMINOS de `serverScope` (mismos extremos más el inicio
declarado) para que no puedan divergir, y con el porqué escrito en su doc.
Consequences: las escrituras conservan su veredicto actual; cualquier sitio futuro que decida «qué mes se
cierra» debe usar `closureScope`.

ADR-02: El inicio declarado AÑADE suelo, no lo fija
Context: ¿qué pasa si hay un dato anterior al mes de inicio declarado?
Option A: el inicio declarado manda y el rango empieza ahí — dejaría fuera datos reales que existen.
Option B: el suelo es el mínimo entre el inicio declarado y el primer dato.
Decision: B — es la misma regla que `activeBounds` ya aplica en el cliente (NFR-2203 de
meses-y-saldo-inicial), así que las dos capas siguen coincidiendo también en ese caso.
Consequences: el inicio declarado nunca recorta el historial; solo puede extenderlo hacia atrás.

ADR-03: El dominio no cambia
Context: la corrección podría meterse en `nextClosable`.
Option A: que `nextClosable` lea `state.startMonth` — dejaría de recibir el rango como único parámetro y
rompería ADR-02 de cierre-de-mes, que puso el rango fuera a propósito para que el dominio sea determinista.
Option B: corregir el rango en el borde y dejar el dominio intacto.
Decision: B.
Consequences: cero cambios en `src/domain/closure.ts`; todos los tests de cierre existentes siguen valiendo
tal cual.

## Technical Risk Flags

[RISK] El ancla nueva no llega al dominio si el estado no lleva `startMonth`
Conflict: FR-2701 exige que el servidor ancle en el mes de inicio, pero `loadStateInTx` no carga ese campo y
`closeMonthFor` compone su estado a partir de ahí; anclar en `state.startMonth` sin añadirlo sería un cambio
inerte que además parecería correcto en una lectura del diff.
Mitigation: componer `startMonth` en `closeMonthFor` y `reopenMonthFor` desde `head`, y verificarlo con un
test de INTEGRACIÓN que cierre por la ruta real y lea `closed_through` en Postgres.
Severity: high

[RISK] Dos funciones de rango parecidas
Conflict: `serverScope` y `closureScope` se diferencian en un ancla; usar la equivocada en un sitio futuro
reintroduce el defecto sin que nada lo delate.
Mitigation: `closureScope` se implementa sobre `serverScope`, su doc dice cuándo usar cada una, y el test de
coherencia cliente/servidor falla si el cierre vuelve a usar el rango sin el ancla.
Severity: medium

[RISK] Cambia el comportamiento de una acción difícil de deshacer, ya desplegada
Conflict: FR-2702 cambia qué mes cierra el botón, y reabrir solo alcanza al último cerrado, de uno en uno.
Mitigation: en la cuenta real el inicio declarado y el primer dato coinciden, así que el comportamiento no
cambia (NFR-2701, con test propio); el cambio solo se manifiesta en ledgers donde hoy el botón MIENTE.
Severity: medium
