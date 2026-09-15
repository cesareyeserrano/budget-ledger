# Technical Design Document (TRD / SDD)

Feature **diario-de-celda** (BL-044). Extiende la arquitectura aprobada de la raíz sin fundar una paralela: mismo
cliente optimista con persistencia por snapshot, mismo dominio puro en `src/domain/`, mismas envolturas de API
(`withApi`), mismo modelo en PostgreSQL y el mismo patrón de «problemas del mes» y de cierre. Cada desviación se
justifica en un ADR. Base medida en el código el 2026-09-14 (rutas y líneas citadas). Esta versión incorpora la
revisión adversarial del 2026-09-14 y las decisiones del usuario tomadas a partir de ella (fase 1 re-aprobada: sin
cuadre automático, con alerta de descuadre y bloqueo de cierre).

## Executive Summary

**Stack, sin tecnologías nuevas** (versiones instaladas, `package-lock.json`, 2026-09-14): Next.js 15.5.25 (App Router)
· React 19.2.7 · TypeScript 5.9.3 · Zustand 5.0.14 (store `useLedgerStore`) · Zod 3.25.76 (contrato cliente/servidor) ·
Drizzle ORM 0.45.2 sobre `postgres` 3.4.9 · PostgreSQL 16 (`postgres:16-alpine`) · Better Auth 1.6.23 (sesión) ·
Radix Popover 1.1.19 y Select 2.3.2 (vía shadcn/ui) · react-day-picker 9.14.0 (calendario vigente) · lucide-react 0.474.0
· Vitest 4.1.11 · Playwright 1.61.1 · Testcontainers 12.0.4 · Node 24 en desarrollo y 22-alpine en la imagen.
Ninguna dependencia nueva.

**Qué cambia, por capa:**
- **Dominio (puro):** leer el Detalle de una celda; crear ajustes; editar y borrar movimientos; proponer la fecha; detectar
  **descuadres** (celda de Ejecutado de gasto o ingreso ≠ suma de sus movimientos) y **celdas negativas**; un tipo nuevo de
  problema del mes (`descuadre`); un motivo nuevo para rechazar el cierre (`unbalanced_cells`).
- **Store (Zustand):** acciones nuevas que persisten como hoy (PUT snapshot serializado y coalescido, BL-010); estado de
  cierre con sus celdas bloqueantes; mapeo propio de los 422 de dominio, periodo, cuadre y celda negativa.
- **API:** PATCH y DELETE de `/api/v1/movements/{id}` reales (NFR-2501, NFR-2508). El PUT de `/api/v1/ledger` y las rutas
  nuevas validan «no empeora el cuadre» y «ninguna celda negativa». El POST de cierre rechaza con `unbalanced_cells`.
- **Datos:** columna `movement.kind` (`manual` | `adjustment`) y un CHECK de monto que admite negativos solo en ajustes
  (migración `0009`).
- **UI:** el editor de la celda monta `CellDetail`; el triángulo del mes y el aviso del Balance aceptan varios problemas
  por mes; `ClosureControl` muestra el motivo del bloqueo.

**Nada automático** (decisión del usuario): el sistema nunca crea ajustes ni corrige cifras por su cuenta. Un descuadre se
señala (FR-2511) y bloquea el cierre de su mes (FR-2512); cuadrar es acción del usuario (FR-2504).

## System Architecture

```
┌──────────────────────────────── Browser (escritorio >760px) ─────────────────────────────────┐
│ BudgetGrid                                                                                     │
│  ├─ encabezado de mes ── triángulo (MonthIssue[]: techo | retiro_planeado | descuadre) FR-2511 │
│  └─ EditableCell (celda de Ejecutado de hoja)                                                  │
│       ├─ input «Editar valor» ──commit──► store.setLeafAmount (ajuste, FR-2504)                │
│       └─ CellDetail (NUEVO; sustituye a CellNotesSection en el editor)                         │
│            ├─ DetailRow × N (movimiento | ajuste | comentario | automático | nota De→A)         │
│            │    ├─ MovementEditor (NUEVO) ──► store.editMovement                               │
│            │    └─ borrado inline         ──► store.deleteMovement                             │
│            ├─ AddMovementLine (NUEVO)     ──► store.addMovementInCell                          │
│            └─ CellNotesSection (vigente, renombrado) ──► store.addCellNote                     │
│ BalanceModule ── TechoBanner: una línea por MonthIssue, incluido «descuadre» (FR-2511)         │
│ ClosureControl ── useClosureStatus().blockedBy → botón deshabilitado + motivo (FR-2512)        │
│                                                                                                │
│ useLedgerStore ── acciones ──► domain/ (TS puro)                                               │
│   persist(snapshot) ─► drainSaves (1 PUT en vuelo) ─► ServerRepository.save                    │
│   ◄─ resync + aviso en 409 · closed_period_violation · period_mismatch · domain_rule_violation │
│      · cell_movement_mismatch · negative_cell · unbalanced_cells (NUEVO mapeo)                 │
└───────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                            │ fetch JSON · cookie SameSite · Origin
┌───────────────────────────────────────────▼──────── Servidor Next.js ─────────────────────────┐
│ withApi(): Origin allowlist (mutación) → sesión → Zod → handler → log [ts] METHOD path status  │
│  GET    /api/v1/ledger          → loadLedger (SOLO LECTURA; ahora mapea `kind`)                 │
│  PUT    /api/v1/ledger          → saveLedger                                                    │
│  POST   /api/v1/movements       → insertMovement (sin cambio de contrato)                       │
│  PATCH  /api/v1/movements/{id}  → updateMovement (NUEVO)                                        │
│  DELETE /api/v1/movements/{id}  → removeMovement (NUEVO)                                        │
│  POST   /api/v1/closure         → closeMonthFor (+ rechazo unbalanced_cells)                    │
│  GET    /api/v1/sync/stream     → SSE `revision` (vigente)                                      │
│ Pipeline de escritura (PUT, PATCH, DELETE):                                                     │
│   revisión → periodo/fecha → cierre → celda negativa → cuadre relativo → reglas de reservas     │
└───────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                            │ Drizzle (transacción, SELECT … FOR UPDATE en ledger)
                           ┌────────────────▼──────────────────┐
                           │ PostgreSQL 16                      │
                           │ movement (+kind, CHECK de monto)   │
                           │ amount_cell · cell_note · ledger   │
                           └────────────────────────────────────┘
```

**Componentes y responsabilidad** (nuevo o modificado):
- **`CellDetail`** (nuevo, `src/components/CellDetail.tsx`): pinta el Detalle a partir de `cellDetail(...)`; decide qué
  acciones ofrecer según cierre, tipo de hoja y celda negativa. Sin lógica de negocio.
- **`DetailRow`**, **`MovementEditor`**, **`AddMovementLine`** (nuevos): presentación y validación de formulario; delegan en
  el store y consultan `wouldGoNegative` del dominio antes de habilitar «Guardar» o el check de borrado.
- **`CellNotesSection`** (vigente): se reduce al campo de comentario; conserva `data-testid` `cell-notes`, `cell-note`,
  `carry-note` y `cell-notes-empty` (NFR-2503). Su texto cambia por FR-2509 (change request sobre `transferencias`).
- **`EditableCell`** (modificado, `BudgetGrid.tsx:757`): monta `CellDetail` y lo posiciona sin desbordar el viewport.
- **`BudgetGrid` encabezado de mes** (modificado, `BudgetGrid.tsx:259-264`, `:481-492`): `breachByMonth` pasa de
  `MonthIssue` a `MonthIssue[]`; `title`/`aria-label` unen los textos con « · ».
- **`TechoBanner`** (modificado, `BalanceModule.tsx:555-592`): pinta la línea del tipo `descuadre`.
- **`ClosureControl`** (modificado, `ClosureControl.tsx:62-66`): deshabilita «Cerrar» y muestra el motivo con
  `useClosureStatus().blockedBy`.
- **`useLedgerStore`** (modificado, `src/state/store.ts`): acciones nuevas, `useClosureStatus` con `blockedBy`, mapeo de 422.
- **Dominio** (modificado/nuevo, `src/domain/`): ver API Design § Módulo de dominio.
- **`ledgerRepo`** (modificado): `updateMovement`, `removeMovement`, mapeo de `kind` en lectura y escritura, validaciones del
  pipeline; `closeMonthFor` con la regla de descuadres.
- **Rutas** (modificado): `movements/[id]/route.ts` (PATCH/DELETE), `closure/route.ts` (código `unbalanced_cells`).

**Patrón de interacción** (el de la raíz): UI optimista → PUT snapshot diferido y serializado → el servidor revalida todo →
SSE a los otros dispositivos. PATCH y DELETE existen como contrato de API y para las pruebas de seguridad; el cliente web
persiste por PUT (ADR-02). Ninguna lectura escribe.

## Data Model

### Contrato preservado (lo que NO cambia)
- **`amount_cell`** (`schema.ts:173-190`): PK `(owner_id, node_id, period, kind)`, `CHECK amount >= 0`. El Ejecutado se sigue
  **guardando** aquí (ADR-01). Ninguna celda baja de 0: el dominio y el servidor rechazan antes de llegar al CHECK (FR-2505,
  FR-2506).
- **`cell_note`**, **`ledger`** (`revision`, frontera de cierre, configuración de ciclos), **`closure_event`**,
  **`cycle_config_version`**, **`relocation_origin`**: sin cambios de esquema.
- **Filas existentes de `movement`**: no se reescriben; reciben `kind = 'manual'` por el DEFAULT.
- **`data_version`**: no se usa ni se toca (desalineado: `0002_multi_anio.sql:53` lo pone en 6 y `saveLedger` lo reescribe en 5,
  `ledgerRepo.ts:586`; se reporta aparte).
- **CHECK de periodo con sufijo `t`**: la migración `0007_ciclos.sql:46-48` ya lo relajó. La `0009` se escribe **a mano**, sin
  `drizzle-kit generate`, porque `schema.ts:186/218/288` conserva la regex vieja y regenerar podría revertirla.

### Delta
**Migración `drizzle/0009_diario_de_celda.sql`**, registrada en `drizzle/meta/_journal.json` (un `.sql` fuera del diario se
ignora en silencio; comprobar el esquema después de migrar):
```sql
ALTER TABLE "movement" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'manual';
ALTER TABLE "movement" DROP CONSTRAINT IF EXISTS "movement_kind_ck";
ALTER TABLE "movement" ADD CONSTRAINT "movement_kind_ck" CHECK ("kind" in ('manual','adjustment'));
ALTER TABLE "movement" DROP CONSTRAINT IF EXISTS "movement_amount_ck";
ALTER TABLE "movement" ADD CONSTRAINT "movement_amount_ck" CHECK (
  ("kind" = 'manual' AND "amount" >= 1)
  OR ("kind" = 'adjustment' AND "amount" <> 0 AND "type" in ('expense','income'))
);
```
Se actualiza también `schema.ts` (columna `kind` y CHECK) para que el tipo de Drizzle coincida.

**Tipo de dominio** (`src/domain/types.ts:62`), delta aditivo:
```ts
interface Movement { /* …campos vigentes… */ kind?: "adjustment"; /* ausente = manual */ }
```
- `amount`: manual → entero en [1, MONTO_MAX]; ajuste → entero ≠ 0 con |amount| ≤ MONTO_MAX; solo gasto o ingreso.
- `kind` es inmutable. Borrar elimina la fila (sin borrado lógico: el historial de ediciones está fuera de alcance).

**Mapeo de `kind`** en cada lugar donde el snapshot se lee o se reescribe. Sin esto, `kind` se perdería en cada PUT porque el
snapshot se borra y se reinserta:
- `rowsToState` (`ledgerRepo.ts:144-159`): `kind` de la fila → `Movement.kind` (solo si es `adjustment`).
- `insertSnapshot` (`ledgerRepo.ts:420-434`) y el `insertSnapshot` que usa la reubicación de ciclos (`cyclesRepo.ts:140`):
  `Movement.kind` → columna.
- `ensureV4InTx` (`ledgerRepo.ts:340-354`): conserva `kind` al reescribir.
- `apiMovementSchema` (`schemas.ts:46-61`): `kind` opcional y `amount` según `kind` (ver API Design). El cliente reutiliza ese
  esquema para validar el GET (`serverRepository.ts:29`), así que acepta los ajustes negativos.

**Descuadre** (FR-2511), definido una sola vez en el dominio (`cellMismatches`):
> Una hoja L de tipo `expense` o `income` en el periodo P está **descuadrada** si
> `actuals[L][P] ?? 0  ≠  Σ amount de los movimientos m con m.type ≠ 'transfer', m.target = L y m.period = P`.

Las hojas `transfer` y el plano `budget` nunca cuentan. Un movimiento cuyo `target` no es hoja (caso preexistente de
`moveNode` hacia grupo, `mutations.ts:632-646`, registrado como **BG-039**) no forma parte de ninguna celda hoja: queda fuera del
Detalle y del cuadre. BG-039 se arregla antes de construir esta feature, así que el diseño asume que todo movimiento de gasto o
ingreso apunta a una hoja.

**Celda negativa**: una operación que dejaría `actuals[L][P] < 0` en cualquier celda que toque se rechaza (`negative_cell`).

## API Design

### Contrato preservado
- `POST /api/v1/movements`, `GET /api/v1/movements[?period]`, `GET /api/v1/movements/{id}`, `GET /api/v1/sync/stream`,
  `/health`, `DELETE /api/v1/closure {baseRevision}` para reabrir: **sin cambio de contrato**. `POST /api/v1/movements` sigue
  creando solo movimientos `manual`.
- Errores vigentes (formas verificadas en `ledger/route.ts:25-47` y `closure/route.ts:20-24` el 2026-09-15): 401 · 403 · 422
  `invalid_payload` · 422 `closed_period_violation {detail:{periods}}` · 422 `period_mismatch {detail:{ids}}` en el PUT (en
  `POST /api/v1/movements`, `{detail:{expected}}`) · 422 `domain_rule_violation {detail:{violations}}` · 422 `not_closable
  {detail:{closable:null}}` · 409 `revision_conflict` · 500 `internal_error`.

### `GET /api/v1/ledger` (contrato ampliado, sin escritura)
- La respuesta incluye `kind: "adjustment"` en los ajustes, que pueden traer `amount` negativo. No escribe nada.

### `PUT /api/v1/ledger` (modificado)
- Body `{ baseRevision: int ≥0, state: LedgerState }`. `apiMovementSchema`: `kind: z.literal("adjustment").optional()` y
  `superRefine` sobre `amount`: sin `kind` → `amountSchema` (≥1); con `kind` → entero ≠0, |x| ≤ MONTO_MAX y tipo gasto o
  ingreso; con tipo `transfer` y `kind` → 422 `invalid_payload`.
- Orden de validación (el del código, `ledgerRepo.ts:518-566`, más los pasos nuevos):
  1. revisión (409);
  2. periodo/fecha (`periodMismatches`, `:549`);
  3. cierre (`closedPeriodsViolated`, `:556`), que ahora compara también `note`, `date` y `kind`;
  4. **celda negativa**: en el PUT no llega a este paso, porque `actuals` se valida con `cellAmountSchema` (≥0,
     `schemas.ts:44`, `validation.ts:63`) y `withApi` responde antes 422 `invalid_payload`. `negative_cell
     {detail:[{nodeId, period, value}]}` lo emiten PATCH y DELETE, donde el servidor calcula las celdas;
  5. **cuadre relativo** (nuevo): 422 `cell_movement_mismatch {detail:[{nodeId, period, cell, sum}]}`;
  6. reglas de reservas (`worsenedBy`, `:564`, alcance vigente).
- Éxito: `200 { revision }` y `syncHub.publish`.

### `PATCH /api/v1/movements/{id}` (nuevo; hoy 404 `unsupported_operation`)
- `withApi({ auth: "required", mutation: true, schema: movementPatchSchema })`.
- Body (`.strict()`, al menos un campo):
  ```ts
  { amount?: int; note?: string | null /* ≤280, trim, vacío→null */;
    date?: string /* "YYYY-MM-DDTHH:mm" válido */; countInOpeningCycle?: boolean /* FR-2406 */;
    catId?: string /* 1..64 */; subId?: string | null }
  ```
  El periodo **no** viaja: el servidor lo deriva de `date` con el `Calendar` del dueño (y de `countInOpeningCycle` para un
  ingreso dentro de la ventana de pago).
- En una transacción con `SELECT … FOR UPDATE` sobre `ledger`:
  1. carga el movimiento por `(owner_id, id)`: si no existe o no es del usuario → **404 `not_found`**, sin distinguir;
  2. si es `transfer` → **422 `unsupported_type`**;
  3. aplica `editMovement` del dominio, que recalcula las celdas de origen y destino (el cliente nunca manda cifras de celda);
  4. valida en el mismo orden que el PUT, añadiendo: destino hoja del mismo tipo y dueño (422 `invalid_target`) y fecha dentro
     del rango activo y no anterior al mes de inicio del ledger (patrón `orphanedByStart`, `opening.ts:109`; 422
     `period_mismatch`);
  5. persiste la fila, hace upsert del diff de celdas `actual`, `revision + 1` y `syncHub.publish`.
- Respuestas: **200** `{ movement, revision }` · **404** `not_found` · **422** `invalid_payload` | `unsupported_type` |
  `period_mismatch {detail:{ids:[id]}}` | `closed_period_violation {detail:{periods}}` | `invalid_target` | `negative_cell` |
  `cell_movement_mismatch` | `domain_rule_violation {detail:{violations}}` · 401 · 403. Un `amount` que no respeta el `kind`
  guardado (manual <1, ajuste = 0) → 422 `invalid_payload`, sin llegar al CHECK de la base.
- `amount` respeta el `kind` guardado: manual ≥1, ajuste ≠0.

### `DELETE /api/v1/movements/{id}` (nuevo)
- `withApi({ auth: "required", mutation: true })`, sin body.
- Misma transacción: 404 si no es del usuario → 422 `unsupported_type` si es `transfer` → `deleteMovement` → cierre → celda
  negativa → cuadre relativo → reglas → persistir.
- Respuestas: **200** `{ revision }` · **404** · **422** `unsupported_type` | `closed_period_violation` | `negative_cell` |
  `cell_movement_mismatch` | `domain_rule_violation` · 401 · 403.

### `POST /api/v1/closure` `{ baseRevision }` — cerrar (modificado)
- Protocolo vigente sin cambios: cuerpo `closurePostSchema = { baseRevision }.strict()` (`schemas.ts:175`); el servidor decide
  qué mes cierra. Reabrir es `DELETE /api/v1/closure { baseRevision }`.
- `closeMonthFor` (`ledgerRepo.ts:781-805`), tras `closeMonth`: si el mes objetivo tiene descuadres → no cierra y devuelve
  `{ ok:false, rejected:"unbalanced_cells", cells:[{nodeId, name}] }`.
- La ruta (`closure/route.ts:20-24`) responde **422** `{ error: { code: "unbalanced_cells", detail: { period, cells } } }`.
- `DELETE` (reabrir) no cambia y no consulta descuadres.

### Módulo de dominio (`src/domain/`, TypeScript puro)
```ts
type DetailEntry =
  | { kind: "auto"; text: string }                                  // comentario automático de bolsillo (FR-1804)
  | { kind: "reserveNote"; text: string; createdAt: number }        // nota De→A de un bolsillo (cellObservations vigente)
  | { kind: "movement" | "adjustment"; movement: Movement }
  | { kind: "comment"; note: CellNote };
cellDetail(state, leafId, period, periods): DetailEntry[]           // orden: auto → movimientos (date, createdAt) → comentarios
displayAmount(type, amount): { sign: "+" | "−"; abs: number; addsToCell: boolean }
proposedDate(cal, period, now: Date): string                        // hoy si cae en el periodo; si no, su último día (FR-2503)
isDateInPeriod(cal, period, date): boolean
movementSum(state, leafId, period): number
adjustCell(state, leafId, period, value, date, periods):
  { state; created: Movement | null } | { rejected: "not_leaf" | "transfer" | "closed" }   // diff = value − movementSum
editMovement(state, id, patch, cal, periods):
  { state } | { rejected: "not_found" | "unsupported_type" | "invalid_amount" | "invalid_target" | "period_mismatch" | "negative_cell" }
deleteMovement(state, id): { state } | { rejected: "not_found" | "unsupported_type" | "negative_cell" }
wouldGoNegative(prev, next): { nodeId; period; value }[]
cellMismatches(state, periods): { nodeId; name; period; cell; sum }[]
worsenedCellMismatches(prev, next, periods): { nodeId; period; cell; sum }[]   // solo pares tocados que antes cuadraban
monthIssues(state, periods): MonthIssue[]   // + { kind: "descuadre"; period; cells: {nodeId; name}[] }
monthIssueText(issue, money): string        // «2 celdas no cuadran con sus movimientos»
closeBlockers(state, period, periods): { nodeId; name }[]
```
`closedPeriodsViolated` (`closure.ts:318`): `diffMovements` (`:357-382`) añade `note`, `date` y `kind` a la comparación.

### Store
```ts
addMovementInCell(i: { leafId; period; amount: number; note?: string; date: string }): boolean
setLeafAmount(leafId, period, kind, value)   // "actual" + hoja gasto/ingreso → adjustCell; resto: comportamiento vigente
editMovement(id, patch): { ok: true } | { ok: false; reason }
deleteMovement(id): { ok: true } | { ok: false; reason }
useClosureStatus(): { closable; reopenable; reopened; pending; blockedBy: { nodeId; name }[] }
closeMonth(): rechazo `unbalanced_cells` → aviso con los nombres y resync
```

## Implementation Approach

FR-2501: El Detalle de una celda lista los movimientos que la forman
Method: selector puro `cellDetail` que filtra `state.movements` por `target = leafId`, `period` y `type ≠ transfer`, ordena por
`date` y luego por `createdAt`, y añade los comentarios; en hojas `transfer` reutiliza `cellObservations` como entradas
`reserveNote`. `CellDetail` lo calcula con `useMemo` solo para la celda abierta.
I/O: `(state, leafId, period, periods)` → `DetailEntry[]`; fila: `18 sep · nota|«Sin nota» · displayAmount`.
Failure: hoja inexistente o sin datos → `[]` y estado vacío «Sin movimientos ni comentarios»; un movimiento sin `date` (previo a
`stack-upgrade-theme`) se ordena por `createdAt` y muestra el primer día del periodo.

FR-2502: Añadir un movimiento desde el Detalle
Method: `AddMovementLine` valida en el cliente (entero ≥1, nota ≤280, fecha dentro del periodo) y llama a
`store.addMovementInCell`, que reutiliza `addMovement` del dominio con `{type: tipo de la hoja, catId/subId desde leafId, period,
date, note}`, sin tocar `Register`.
I/O: `{leafId, period, amount: int ≥1, note?: ≤280, date}` → movimiento nuevo y `actuals[leaf][period] += amount`.
Failure: validación de cliente → «Añadir» deshabilitado; 422 al guardar → `resync` y aviso con el motivo; doble pulsación en menos
de 600 ms → ignorada (guarda vigente, `store.ts:214`).

FR-2503: Fecha propuesta y fecha válida
Method: `proposedDate(cal, period, now)` con el `Calendar` vigente (`cycles.ts:172`): `now` si `cal.periodForDate(now) === period`;
si no, el último día del rango a las 12:00. `isDateInPeriod` limita el calendario y valida en el cliente. El servidor revalida con
`isValidMovementPeriod` y el rango activo.
I/O: `(Calendar, PeriodKey, Date)` → `"YYYY-MM-DDTHH:mm"`.
Failure: periodo fuera del horizonte → último día del rango; fecha fuera → rechazo visible en el cliente, 422 `period_mismatch` en el
servidor. Para un ingreso, el servidor también acepta la ventana de pago adelantado (`cycles.ts:384`); la regla estricta «dentro
del ciclo de la celda» la aplica el cliente al añadir desde la celda.

FR-2504: Teclear un valor crea un ajuste por la diferencia
Method: `setLeafAmount` detecta plano `actual` y hoja de gasto o ingreso, y llama a `adjustCell`: `diff = value − movementSum(leaf,
period)`; si `diff = 0` no crea ajuste; si no, crea `{kind:"adjustment", amount: diff, note: "Ajuste manual", date: proposedDate(...)}`.
En ambos casos deja la celda en `value` (clamp ≥0 vigente): así, teclear la suma de sus movimientos en una celda descuadrada
(p. ej. 100.000 en una celda de 120.000 cuyos movimientos suman 100.000) la cuadra sin crear nada, y teclear su valor actual en
una celda sin movimientos la cuadra con un ajuste por el total (AC-2511b). Hojas `transfer` y plano
`budget` siguen por la ruta vigente.
I/O: `(leafId, period, "actual", value: int ≥0)` → `{state, created: Movement | null}`.
Failure: periodo cerrado → no-op (la UI no ofrece el input, `BudgetGrid.tsx:272`); rechazo del servidor → `resync` al valor anterior y aviso.

FR-2505: Editar un movimiento
Method: `MovementEditor` arma un `patch`; `editMovement` resta el monto de la celda de origen, aplica el patch, deriva el periodo
de la fecha (o de la propuesta de ingreso adelantado, FR-2406), suma en la celda de destino y valida hoja destino del mismo tipo.
Antes de habilitar «Guardar», el componente llama a `wouldGoNegative(prev, next)` e `isClosed` sobre el destino. Persistencia por
PUT; el servidor aplica cierre, celda negativa y cuadre relativo.
I/O: `(id, patch)` → `{state}` o `{rejected: reason}`; aviso «Pasará a «Octubre · 21 sep – 20 oct»» cuando cambia el periodo.
Failure: `negative_cell` → «No se puede: Restaurantes quedaría en −10.000…» y «Guardar» deshabilitado; destino cerrado → mensaje y
«Guardar» deshabilitado; si igual llega al servidor, 422 → `resync`. La operación es atómica en el snapshot: el movimiento no se pierde.

FR-2506: Borrar un movimiento
Method: la papelera consulta `wouldGoNegative` antes de mostrar el check; `store.deleteMovement` → `deleteMovement` del dominio
(quita la fila y resta de su celda) → PUT.
I/O: `(id)` → `{state}` o `{rejected: "not_found" | "unsupported_type" | "negative_cell"}`.
Failure: celda que quedaría negativa → aviso en la fila y sin check; rechazo por cierre o por regla de reservas → `resync` y el
movimiento reaparece con el motivo.

FR-2507: Periodos cerrados y reabiertos
Method: la UI usa `isClosed(closure, period)` (`closure.ts:135`) para ocultar las acciones y mostrar el aviso. El servidor aplica
`closedPeriodsViolated` en PUT, PATCH y DELETE; su `diffMovements` compara ahora también `note`, `date` y `kind`, así que
cambiar solo la nota o la fecha de un movimiento de un periodo cerrado también se rechaza. El último reabierto no está cerrado
para `isClosed` (`closure.ts:244-248`).
I/O: `(Closure, PeriodKey)` → `boolean`; escrituras → 422 `closed_period_violation`.
Failure: cierre llegado desde otro dispositivo con el editor abierto → rechazo → `resync` → panel en estado cerrado.

FR-2508: Comentarios en el Detalle, con el mismo estilo
Method: `cellDetail` añade `cellNotes` y el comentario automático como entradas `comment`/`auto`; `DetailRow` aplica anatomía y
tintes del UX; el campo sigue siendo `CellNotesSection` → `addCellNote` (≤280, vigente).
I/O: entradas sin monto.
Failure: vacío o >280 → rechazo sin truncar (vigente); el marcador de celda sigue contando solo `cellNotes` (`BudgetGrid.tsx:613-615`).

FR-2509: Un solo nombre por concepto
Method: sustitución de literales en `ReserveCells.tsx` y `CellDetail` y un test estructural que recorre `src/components` y
`src/app` y falla si reaparecen «Observaciones» o «Añadir observación». Los dos TCs aprobados de `transferencias` que esperan
el texto viejo (TC-TRF4-012e y TC-TRF4-012h) se actualizan por el change request aprobado; la etiqueta de `techo-de-flujo.spec.ts:339`
cambia solo en el código de su e2e.
I/O: textos visibles.
Failure: n/a (contrato textual); el test estructural es la guarda.

FR-2511: Las celdas descuadradas se señalan como un problema del mes
Method: `cellMismatches` construye un mapa `(target, period) → suma` en una pasada sobre los movimientos y compara con `actuals`
de las hojas de gasto e ingreso; `monthIssues` añade una entrada `{kind:"descuadre", period, cells}` por mes. `breachByMonth` guarda
`MonthIssue[]` y el triángulo une los textos con « · »; `TechoBanner` pinta la línea con hasta 3 nombres y «y N más».
I/O: `(state, periods)` → `MonthIssue[]`.
Failure: sin hidratar → no se pinta nada (patrón vigente, `BudgetGrid.tsx:261`); nombre de hoja inexistente → se omite de la lista
(el conteo lo incluye). Nunca escribe.

FR-2512: Un mes o ciclo con celdas descuadradas no se puede cerrar
Method: `closeBlockers(state, period)` = celdas de `cellMismatches` de ese periodo. `useClosureStatus` expone `blockedBy` para el
mes `closable`; `ClosureControl` deshabilita el botón y pinta el motivo. En el servidor, `closeMonthFor` calcula `closeBlockers`
sobre el estado persistido tras `closeMonth` y rechaza con `unbalanced_cells`. Reabrir no consulta descuadres.
I/O: `(state, period)` → `{nodeId, name}[]`; `POST /api/v1/closure {baseRevision}` → 422 `unbalanced_cells {period, cells}`.
Failure: cliente con datos viejos → el servidor rechaza, el store hace `resync` y el control muestra el motivo actualizado.

## Security Design

**Fronteras de confianza:**
1. **Navegador → API** (`/api/v1/*`): todo el JSON es no confiable. Entra por `withApi`: Origin allowlist en mutaciones (403) →
   sesión (401) → Zod (422) → handler.
2. **Sesión → datos**: el `ownerId` sale solo de la sesión; `insertSnapshot` fija el `ownerId` del parámetro en cada fila
   (`ledgerRepo.ts:396, 421, 454, 573`), así que un snapshot no puede escribir en otra cuenta.
3. **Servidor → Postgres**: Drizzle parametrizado.

**NFR-2501 → controles:**
- *Solo el dueño edita o borra:* búsqueda por `(owner_id = session.userId, id)`; ausencia → 404 `not_found`, igual para «no existe»
  y «es de otro». TC-BE-018f/019f siguen valiendo.
- *Bolsillos fuera:* movimiento `transfer` → 422 `unsupported_type`, antes de mutar nada.
- *Sesión y Origin:* `withApi({auth:"required", mutation:true})`.
- *Entrada:* `movementPatchSchema.strict()`; `amount` entero con tope `MONTO_MAX`; `note` ≤280 tras `trim`; `date` con regex e
  `isValidDate`; `catId`/`subId` ≤64; sin `period` en el body.
- *Rango:* fecha dentro del rango activo y no anterior al mes de inicio (patrón `orphanedByStart`).
- *Destino legítimo:* `catId`/`subId` resueltos contra los nodos del mismo dueño y del mismo tipo → si no, 422 `invalid_target`.
- *El cliente no fabrica cifras:* PATCH/DELETE recalculan celdas en el servidor; el PUT rechaza celdas negativas y cuadres empeorados.

**NFR-2508 → control:** PATCH y DELETE envueltos por `withApi`, que registra `[ts] METHOD path status (ms) rid` (`http.ts:132`).

**Mitigaciones generales:** XSS — notas y comentarios como texto de React; CSRF — cookie `SameSite` + Origin allowlist
(RQ-SEC-008); headers de seguridad sin cambios (NFR-512); los logs no llevan notas ni montos.

## Performance & Scalability

- **Tamaño real:** un usuario, 27 movimientos en su primer ciclo; horizonte de años → miles de movimientos como máximo. Sin paginación.
- **Detalle:** `cellDetail` O(M) solo para la celda abierta, memoizado.
- **Problemas del mes:** `cellMismatches` O(M + C) con un mapa `(target, period) → suma`; `monthIssues` ya está memoizado por
  identidad de `data` (`BudgetGrid.tsx:259`). Para M, C ≤ 10⁴, del orden de milisegundos.
- **Guardrail ≤150 ms:** las mutaciones nuevas cambian como mucho dos celdas y una fila; los roll-ups no cambian.
- **PUT snapshot:** celda negativa y cuadre relativo son O(M + C) y solo miran los pares tocados por el diff; corren después de
  las validaciones baratas.
- **Concurrencia:** `SELECT … FOR UPDATE` sobre `ledger` serializa PUT, PATCH, DELETE y cierre del mismo usuario; un PUT pendiente
  tras un PATCH de otro dispositivo recibe 409 y hace `resync` (vigente). No hay escrituras en lecturas.

## Deployment Architecture

- **Modelo: contenedorizado (vigente).** Imagen Docker `t-ledger:<sha>` (`node:22-alpine`, Next `standalone`) + `postgres:16-alpine`
  con volumen `pgdata`, orquestados por `docker-compose.yml`, en Ultron (Raspberry Pi 5) y publicados por Tailscale.
- **Orden:** (1) respaldo `pg_dump` (**obligatorio**); (2) `docker compose run --rm app node scripts/migrate.mjs` (aplica `0009`;
  comprobar la columna `kind` y el CHECK); (3) levantar la imagen nueva. No hay paso de datos: los descuadres existentes solo se
  señalan (FR-2511).
- **Rollback:** mientras no exista ningún ajuste negativo, la imagen anterior funciona contra la base migrada. **Una vez creado un
  ajuste negativo**, la imagen anterior rechaza el snapshot (su esquema exige monto ≥1) y dejaría la app sin datos: volver atrás
  exige restaurar el respaldo del paso 1 (restricción aprobada en Phase 1).
- **Entornos:** desarrollo (`docker-compose.dev.yml`), CI (Testcontainers Postgres 16), producción (Ultron).
- **CI/CD (NFR-2509):** el workflow existente `.github/workflows/ci.yml` ejecuta typecheck, lint, unit+integración y e2e en PR a
  develop/staging/main y push a main; no se añade workflow. Ramas develop → staging → main.
- **Change request sobre `transferencias`:** antes de construir esta feature se re-deriva su fase de pruebas (`aitri feature run-phase
  transferencias tests --feedback "…"`) para actualizar TC-TRF4-012e y TC-TRF4-012h, y se re-verifica esa feature.

## Risk Analysis

**ADRs**

ADR-01: Dónde vive el valor de Ejecutado de gasto e ingreso
Context: la feature necesita saber si una celda cuadra con sus movimientos; hoy `actuals` se guarda en `amount_cell`, aparte del
journal (`ledgerRepo.ts:138-142`).
Option A: seguir guardándolo y detectar descuadres comparando — cambio acotado; los descuadres son posibles y hay que señalarlos.
Option B: derivarlo de los movimientos — sin descuadres por construcción; toca cierre, reubicación de ciclos, balance, migraciones
v4/v5 y las suites de más de 20 features.
Decision: A — el radio de B reabriría features aprobadas; y el usuario decidió que un descuadre es un estado legítimo que se señala.
Consequences: FR-2511 y FR-2512 son la red de seguridad; toda vía nueva de escritura debe mover celda y journal a la vez.

ADR-02: Cómo persiste el cliente editar y borrar
Context: la raíz persiste por PUT snapshot serializado (BL-010); los NFR piden PATCH y DELETE con dueño y logging.
Option A: el cliente sigue con PUT y la API expone PATCH/DELETE con el mismo pipeline — un camino en el cliente; dos puertas en
el servidor.
Option B: el cliente usa PATCH/DELETE — escrituras pequeñas; convive con el PUT del resto y abre carreras entre caminos.
Decision: A.
Consequences: pruebas verifican que PUT y PATCH/DELETE rechazan con el mismo código los mismos casos (cierre, cuadre relativo,
reglas) y que, cuando una escritura rompe dos reglas, gana la primera del orden de validación real del código. Única diferencia
declarada: una celda negativa por PUT es `invalid_payload` (esquema) y por PATCH/DELETE es `negative_cell`.

ADR-03: Cómo se marca un ajuste
Context: ícono distinto y «−» solo en ajustes; la nota «Ajuste manual» es editable.
Option A: columna `kind` — explícita, inmutable, con CHECK.
Option B: inferirlo de la nota o del id — sin migración; se rompe al cambiar la nota.
Decision: A.
Consequences: migración `0009` escrita a mano; `kind` se mapea en `rowsToState`, `insertSnapshot` (×2) y `ensureV4InTx`.

ADR-04: Montos negativos en ajustes
Context: FR-2504 crea ajustes hacia abajo; la tabla exige `amount >= 1`.
Option A: `amount` con signo solo con `kind='adjustment'` — las sumas funcionan igual; hay que auditar los supuestos ≥1.
Option B: `amount ≥ 1` y un campo `direction` — conserva la regla; obliga a aplicar el signo en cada suma.
Decision: A.
Consequences: `addMovement` sigue rechazando negativos (los ajustes entran por `adjustCell`). Supuestos a revisar en la fase 4
(verificados por la revisión adversarial): `validation.ts:51` y sus usos en `schemas.ts:19` y `:53`; `mutations.ts:72-73`
(`parseAmount`); `cycles.ts:561` (`Math.abs` en `placementContext`); `cycles.ts:765` (piso de `restoreParts`); `Register.tsx:90/113/140`,
`AmountDisplay.tsx:38` y `money.ts:55` si se reutilizan; tests `bg-021-tope-de-monto.test.ts` y `reserve-migration.test.ts`.

ADR-05: Qué hace el sistema ante un descuadre
Context: una celda puede descuadrarse por caminos existentes (reubicación de ciclos, `cycles.ts:698-781`; reabrir un mes;
datos previos). Una validación absoluta bloquearía todo guardado.
Option A: cuadre automático (crear ajustes al detectar) — sin estados descuadrados; choca con `checkRelocationInvariants`
(`cycles.ts:913-915` exige igual número y suma de movimientos) y con «nada automático».
Option B: validación absoluta en el PUT — garantiza cuadre; un descuadre previo bloquea todo guardado.
Option C: señalar (FR-2511), bloquear solo el cierre (FR-2512) y rechazar en escrituras únicamente lo que empeora (NFR-2502,
mismo criterio que `worsenedBy`, `guard.ts:82-83`).
Decision: C — decisión explícita del usuario («si nunca cierra, es su decisión»).
Consequences: sin escrituras en lecturas ni en la reubicación; el cierre pasa a tener su primera regla de bloqueo.

ADR-06: Componente del Detalle
Context: el editor monta `CellNotesSection`, cuyos `data-testid` usan `transferencias` y `techo-de-flujo`.
Option A: ampliar `CellNotesSection` — un componente con lista, formularios y comentarios mezclados.
Option B: `CellDetail` nuevo que compone filas y formularios y reutiliza `CellNotesSection` para el comentario.
Decision: B.
Consequences: los `data-testid` vigentes se conservan; los bolsillos siguen viendo sus notas De→A como filas (`reserveNote`).

ADR-07: Varios problemas por mes en el encabezado
Context: `breachByMonth` guarda un solo `MonthIssue` por mes (`BudgetGrid.tsx:262`); el descuadre puede convivir con «techo».
Option A: `MonthIssue[]` por mes y textos unidos — conserva un único triángulo.
Option B: un segundo ícono por tipo — más ruido en un encabezado de 38-52 px.
Decision: A.
Consequences: cambia el tipo de `breachByMonth` y las TCs que lean su `title` con un solo problema siguen valiendo.

**Riesgos principales**
1. **El bloqueo de cierre rompe TCs de `cierre-de-mes`** cuyas fixtures siembran Ejecutado sin movimientos → verificación en la
   fase 3; se ajustan fixtures, no resultados esperados (NFR-2507).
2. **Supuestos ocultos de `amount >= 1`** (lista del ADR-04) → auditoría y tests con ajustes negativos en cada agregado.
3. **Descuadres al cambiar de modo de ciclos: solo un caso borde** (verificado en `cycles.ts:694-781` el 2026-09-15). La
   reubicación separa cada celda en *residuo tecleado* (celda − Σ movimientos) y *movimientos*, mueve los movimientos por fecha y
   recompone. Una celda formada solo por movimientos con fecha tiene residuo 0 y **nunca se descuadra**: cambiar de modo es solo
   mover el calendario. Con FR-2504 teclear crea ajustes con fecha, así que no nacen residuos nuevos. El único caso posible son
   celdas que ya tenían un residuo tecleado **al activar ciclos** y **solo al volver a mes a mes**: `restoreParts` (`cycles.ts:765`)
   puede repartir ese residuo en varios meses. Si pasa, se señala y bloquea el cierre de ese mes; un test de integración documenta
   el caso.
4. **Pestaña con el código anterior tras desplegar** → su GET no valida ajustes negativos (StorageBanner) y no guarda; al recargar
   usa el código nuevo.
5. **`moveNode` hacia grupo** (`mutations.ts:632-646`): mover una categoría con subcategorías a un grupo-hoja con montos deja los
   montos del grupo en un nodo que no es hoja, fuera del Detalle y del cuadre. Es un error preexistente, registrado como **BG-039**,
   y el usuario decidió **arreglarlo antes de construir esta feature**.
6. **Reglas de reservas no vigilan gasto ni ingreso** (`guard.ts:37-55`) → paridad aceptada (BL-051).

## Failure Blast Radius

Component: PostgreSQL
Blast radius: todas las lecturas y escrituras del libro, el Detalle, las ediciones y el cierre.
User impact: la app no carga o muestra el `StorageBanner`; las ediciones optimistas quedan sin confirmar.
Recovery: `restart: unless-stopped`; el cliente reintenta el PUT pendiente; restauración desde `pg_dump`.

Component: Pipeline de validación de escrituras (`saveLedger` / `updateMovement` / `removeMovement`)
Blast radius: un defecto en «celda negativa» o «cuadre relativo» rechazaría guardados legítimos del usuario.
User impact: aviso de guardado rechazado; el servidor queda en la última revisión válida.
Recovery: el 422 lleva la celda exacta; al ser relativas, un error de datos previo no bloquea operaciones sobre otras celdas; un defecto
de código se revierte con la imagen anterior mientras no existan ajustes negativos, y con restauración del respaldo si ya existen.

Component: Regla de cierre (`closeMonthFor` + `closeBlockers`)
Blast radius: un falso positivo impediría cerrar un mes que cuadra.
User impact: «Cerrar» deshabilitado con un motivo que nombra celdas; el mes sigue abierto y editable.
Recovery: el motivo identifica la celda; si es un defecto, se corrige la regla sin pérdida de datos (el cierre no escribe nada al rechazar).

Component: `syncHub` (SSE, singleton en memoria)
Blast radius: otros dispositivos no se enteran de ediciones, borrados ni cierres.
User impact: datos viejos en otra pestaña hasta recargar; un guardado desde ella recibe 409.
Recovery: reconexión de `EventSource`; la revisión y el 409 evitan pisar datos.

## Traceability Checklist

- [x] FR → componente: FR-2501 `CellDetail`/`cellDetail` · FR-2502 `AddMovementLine`/`addMovementInCell` · FR-2503 `proposedDate`/
  `isDateInPeriod` · FR-2504 `adjustCell`/`movementSum` · FR-2505 `MovementEditor`/`editMovement`/PATCH/`wouldGoNegative` · FR-2506
  `deleteMovement`/DELETE/`wouldGoNegative` · FR-2507 `isClosed`/`closedPeriodsViolated` ampliado · FR-2508 `DetailRow`/
  `CellNotesSection` · FR-2509 literales + test estructural + change request · FR-2511 `cellMismatches`/`monthIssues`/`TechoBanner`/
  triángulo · FR-2512 `closeBlockers`/`useClosureStatus`/`ClosureControl`/`closeMonthFor`.
- [x] Implementation Approach tiene entrada para los 11 MUST FR.
- [x] NFR → decisión: NFR-2501 Security Design · NFR-2502 `worsenedCellMismatches` en el pipeline · NFR-2503 `transfer` fuera, `data-testid`
  conservados y change request · NFR-2504 `Register`/`addMovement` sin cambios · NFR-2505 reglas al final del pipeline · NFR-2506
  plano `budget` por la ruta vigente · NFR-2507 `closedPeriodsViolated` en las tres puertas y fixtures de cierre · NFR-2508 `withApi` ·
  NFR-2509 CI existente.
- [x] Cada ADR evalúa ≥2 opciones.
- [x] `no_go_zone` fuera del diseño: sin notas con monto, sin segundo formulario, sin arrastre entre celdas, sin escrituras en
  cerrados, sin negativos manuales, sin historial de ediciones, sin BL-035, sin Detalle en móvil, sin cuadre automático.
- [x] Failure Blast Radius para 4 componentes.
- [x] Technical Risk Flags completo.

## Technical Risk Flags

[RISK] Primera regla que bloquea el cierre de mes
Conflict: FR-2512 exige no cerrar un mes con descuadres, pero `closeMonth`/`nextClosable` (`closure.ts:154-218`) y sus TCs se
diseñaron sin bloqueos, y fixtures de `cierre-de-mes` pueden sembrar Ejecutado sin movimientos.
Mitigation: la regla vive en `closeBlockers`, aparte de `nextClosable` (que sigue diciendo qué mes toca); el servidor la aplica en
`closeMonthFor`; en la fase 3 se revisan las fixtures de cierre (NFR-2507).
Severity: high

[RISK] Montos negativos contra supuestos de `amount >= 1`
Conflict: FR-2504 introduce ajustes negativos, pero `amountSchema` (`validation.ts:51`), el CHECK `movement_amount_ck`, `placementContext`
(`cycles.ts:561`), `restoreParts` (`cycles.ts:765`) y tests asumen ≥1.
Mitigation: negativos solo con `kind='adjustment'`; auditoría de la lista del ADR-04; tests de cada agregado con un ajuste negativo.
Severity: medium

[RISK] `kind` perdido en la reescritura del snapshot
Conflict: NFR-2502 y FR-2504 dependen de distinguir ajustes, pero `saveLedger` borra y reinserta el snapshot (`ledgerRepo.ts:569-572`)
y la reubicación de ciclos también (`cyclesRepo.ts:140`).
Mitigation: mapeo de `kind` en `rowsToState`, los dos `insertSnapshot` y `ensureV4InTx`; test de ida y vuelta (guardar → leer → guardar)
que conserva `kind` y el signo.
Severity: medium

[RISK] Rollback con ajustes negativos exige restaurar la base
Conflict: el despliegue promete volver a la imagen anterior, pero esa imagen valida `amount >= 1` en su GET (`serverRepository.ts:29`).
Mitigation: respaldo obligatorio antes de migrar; restricción aprobada en Phase 1; documentado en DEPLOYMENT.md en la fase 5.
Severity: medium

[RISK] Reglas de reservas no cubren gasto e ingreso
Conflict: NFR-2505 pide que techo y piso apliquen a las escrituras nuevas, pero `worsenedBy` solo evalúa diffs de bolsillos
(`guard.ts:37-55`).
Mitigation: paridad con el comportamiento vigente, aceptada por el usuario (BL-051).
Severity: low
