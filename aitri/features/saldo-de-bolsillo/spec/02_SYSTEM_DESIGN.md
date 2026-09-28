# Technical Design Document (TRD / SDD) — saldo-de-bolsillo

## Executive Summary

Decisión final del usuario (2026-09-27): la grilla muestra lo del mes y nada arrastra; lo acumulado vive en el
Balance. Lo que esta feature cambia es cómo se PLANEA un retiro: la celda Pres. de «Retiros del mes» abre el
mismo formulario que la celda Ejec., y cada retiro planeado queda en su alcancía.

- **Formulario Pres. (FR-3001).** `WithdrawCell` recibe `plane`. Con `plane="budget"` cambia el título
  («Planear sacar en <mes> → Disponible»), el botón («Planear»), el saldo de cada alcancía en el desplegable
  (`resolvedBalance(…, "budget")`), el «Máx.» (`maxWithdrawal(…, "budget")`) y la lista (retiros planeados del
  mes). No se crea un componente paralelo (restricción de Fase 1).
- **Retiro planeado por alcancía (FR-3002/3003).** Se guarda en la fila `@retiros:<alcancía>` de `budgets`,
  persistida en `amount_cell` como hoy la fila global. Dos funciones de dominio nuevas, `planRetiro` y
  `editPlannedRetiro`, lo validan con `chainCheck(…, "budget", …)`, la misma función que usan el navegador y el
  servidor. La nota «¿Para qué?» se guarda en `cellNotes["@retiros:<alcancía>"][mes]`, persistida en
  `cell_note`, que no restringe `node_id`.
- **Suma (FR-3004).** `reserveRetiros(…, "budget")` suma las filas `@retiros:*`. Ya está construido en d738813
  y se conserva.
- **Conversión única (FR-3006).** `convertPlannedRetiros` reparte la fila global. Se conserva tal cual de
  d738813, con `data_version = 7`.
- **Servidor (FR-3008).** El guardia compara las filas `@retiros:*` y las juzga con `chainCheck`. Se conserva
  de d738813.
- **Se retira lo construido en d738813 que mostraba saldos (NFR-3005):**
  - Se quitan `reserveCellTarget`, `cellTargetMax`, `subtreeReserveBalance`, `CELDA_NOTE` y
    `store.applyReserveTarget`.
  - La celda de un bolsillo vuelve a `map[hoja][mes]` y editarla vuelve a `applyReserveEdit`/`cellHeadroom`.
  - Las filas de grupo y «RESERVAS» vuelven a los roll-ups.
  - Se conserva el editor de mes cerrado (solo observaciones).

Stack sin cambios (versiones instaladas el 2026-09-27): Next.js 15.5.25, React 19.3.0, TypeScript 5.9.3,
Zustand 5.0.15, drizzle-orm 0.45.3 sobre PostgreSQL 16.14, Vitest 4.1.11 y Playwright 1.63.0. Sin
dependencias nuevas.

## System Architecture

```
┌──────────────────────────────── Navegador ─────────────────────────────────┐
│ BudgetGrid                                                                   │
│  ├─ ReserveLeafCell ── budgets|actuals[hoja][mes]         (APORTE, sin cambio)│
│  ├─ ReserveCellEditor ── store.applyReserveEdit ── cellHeadroom (sin cambio)  │
│  ├─ fila grupo / «RESERVAS» ── rollups                    (sin cambio)        │
│  ├─ WithdrawCell plane="actual" ── applyReserveOp / editReserveOp (sin cambio)│
│  └─ WithdrawCell plane="budget"                                  (CAMBIA)     │
│        desplegable ── resolvedBalance(hoja, mes, "budget")                    │
│        Máx. ──────── maxWithdrawal(hoja, mes, "budget")                       │
│        Planear ───── store.planWithdrawal ── planRetiro ── chainCheck(budget) │
│        lista ─────── plannedRetiroRows(mes) ── PlanRow                        │
│                        └ store.editPlannedWithdrawal ── editPlannedRetiro     │
│ BalanceModule ── reserveAportes / reserveRetiros            (sin cambio)      │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ PUT /api/v1/ledger (snapshot)
┌──────────────────────────── Servidor Next.js ────────────────────────────────┐
│ loadLedger ── data_version < 7 ? convertPlannedRetirosFor → persiste         │
│ saveLedger ── convierte @retiros global entrante (cliente viejo)             │
│            ├ closedPeriodsViolated (budgets incluye @retiros:*)              │
│            └ worsenedBy ── touchesReserves (+ @retiros:*) ── chainCheck      │
└────────────────────────────────────┬────────────────────────────────────────┘
          PostgreSQL: amount_cell (node_id '@retiros:<hoja>'), cell_note; sin DDL
```

Componentes y responsabilidad:
- **WithdrawCell** (`ReserveCells.tsx`): el formulario de la fila «Retiros del mes». CAMBIA: recibe
  `plane` y `closed`. En Pres. sustituye a `PlannedWithdrawCell`, que se retira; su marca ámbar de BG-020 pasa
  al disparador en modo Pres.
- **PlanRow** (`ReserveCells.tsx`, NUEVO): una línea de la lista Pres. Muestra la alcancía, las notas unidas
  por « · » y un monto editable. Es la contraparte de `OpRow`, con la misma interacción: Enter o blur
  confirma, Escape revierte y 0 elimina.
- **planRetiro / editPlannedRetiro** (`reserve.ts`, NUEVAS): escriben la fila `@retiros:<hoja>` y sus notas,
  y validan en cadena.
- **plannedRetiroRows** (`reserve.ts`, NUEVA): las líneas de la lista del mes, `{ leafId, amount, notes }`.
- **maxWithdrawal** (`reserve.ts`): CAMBIA la firma. Se añade `plane`, con `"actual"` por defecto.
- **store.ts**:
  - Acciones NUEVAS: `planWithdrawal` y `editPlannedWithdrawal`.
  - Se retiran `setPlannedRetiro` y `applyReserveTarget`.
- **ledgerRepo / guard / mutations**: se conservan de d738813. `mutations` además mueve y borra las notas de
  la fila `@retiros:<hoja>`.

## Data Model

Contrato de preservación:
- Esquema de Postgres SIN cambios. `amount_cell` (PK owner, node_id, period, kind; `amount >= 0`), `cell_note`
  (PK owner, node_id, period, id; texto ≤ 280), `movement` y `ledger` (`data_version`). Sin fichero nuevo en
  `drizzle/`.
- `amount_cell` de bolsillos sigue guardando el APORTE del mes en los dos planos (NFR-3005, FR-1003).
  `movement` guarda solo operaciones reales: un retiro planeado nunca es un movimiento.
- Ninguna fila de datos reales se reescribe (NFR-3007).

Delta:
- `budgets["@retiros:<leafId>"][period]`: retiro planeado de esa alcancía en ese mes.
  - Entero ≥ 1; en 0 la clave se borra.
  - Se persiste en `amount_cell` con `node_id = '@retiros:<leafId>'` y `kind = 'budget'`.
  - No es un nodo, así que los roll-ups no lo cuentan.
  - Dos retiros planeados de la misma alcancía y mes se SUMAN en la misma celda (AC-3008).
- `cellNotes["@retiros:<leafId>"][period]`: las notas «¿Para qué?» de esos retiros, en orden de creación
  (`CellNote`: id, createdAt, text ≤ 280, date del día local). Se persisten en `cell_note` con el mismo
  `node_id`. La lista las muestra unidas por « · » (AC-3016). Eliminar el retiro (monto 0) elimina sus notas.
- `budgets["@retiros"]` (global) deja de escribirse; la conversión la vacía. Solo sobrevive si el ledger no
  tiene ninguna alcancía.
- `ledger.data_version`: < 7 → 7 al convertir. Un ledger nuevo nace en 7. Se usa 7 porque la migración 0002
  ya fijaba 6.

## API Design

HTTP: se preserva el contrato, sin endpoints nuevos ni cambios de cuerpo.
- `GET /api/v1/ledger`: devuelve el snapshot ya convertido, con las filas `@retiros:*` en `budgets` y sus notas
  en `cellNotes`.
- `PUT /api/v1/ledger`: mismas respuestas que hoy:
  - 200 y 409.
  - 422 con `closed_period_violation`, `period_mismatch`, `domain_rule_violation` o `cell_movement_mismatch`.

  Un retiro planeado en un mes cerrado cambia `budgets`, así que `closedPeriodsViolated` lo rechaza sin
  cambios en el guardia (NFR-3004). Las notas no se congelan (FR-2004), igual que hoy.
- `POST /api/v1/movements`: sin cambios.

Módulos internos (TypeScript):
- `planRetiro(state, { leafId, period, amount, note?, day? }, periods): { state } | { rejected: ReserveVerdict | "invalid_target" | "invalid_note" }`
  NUEVA.
- `editPlannedRetiro(state, leafId, period, amount, periods): { state } | { rejected: ReserveVerdict | "invalid_target" }`
  NUEVA. `amount = 0` elimina.
- `plannedRetiroRows(state, month): readonly { leafId: string; amount: number; notes: readonly string[] }[]`
  NUEVA. Recorre las alcancías en el orden de la grilla (`reserveLeafIds`).
- `maxWithdrawal(state, leafId, month, periods, plane: Plane = "actual"): number`: firma ampliada. Las
  llamadas de hoy no cambian.
- `reserveRetiros`, `resolvedSeries` (Pres. resta `@retiros:<hoja>`), `plannedRetiroKey`,
  `isPlannedRetiroKey` y `convertPlannedRetiros`: se conservan de d738813.
- Store:
  - `planWithdrawal(from, month, amount, note?): { ok: true } | { ok: false; rejected }`.
  - `editPlannedWithdrawal(leafId, month, amount): { ok: true } | { ok: false; rejected }`.
- SE RETIRAN:
  - `reserveCellTarget`, `cellTargetMax`, `subtreeReserveBalance`, `CELDA_NOTE`.
  - `ReserveTarget`/`ReserveTargetResult`.
  - `store.applyReserveTarget`.
  - `setPlannedRetiro` (dominio y store), porque ninguna vía escribe ya la fila global.
  - `plannedRetiroLimit` se conserva para la marca ámbar de un ledger legado (BG-020).

## Implementation Approach

FR-3001: La fila «Retiros del mes · Pres.» abre el mismo formulario
Method:
- `BudgetGrid` monta `<WithdrawCell plane="budget" closed={closedPeriods.has(m)} />` donde hoy monta
  `PlannedWithdrawCell`.
- Dentro de `WithdrawCell`, una tabla de textos por plano:
  - Título: «Sacar en» → «Planear sacar en».
  - Botón: «Sacar» → «Planear».
  - Encabezado de la lista: «Operaciones de este mes» → «Retiros planeados de este mes».
  - Lista vacía: «Sin operaciones este mes» → «Sin retiros planeados este mes».
  - `title`: «Planear sacar de una alcancía (o corregir un retiro planeado)».
- El desplegable pinta `resolvedBalance(data, id, month, plane, periods)`.
- `Máx.` = `maxWithdrawal(data, fromId, month, periods, plane)`.
- `canSave`, Enter, Escape y Cancelar no cambian.
- Testids:
  - Controles de dentro: los mismos de Ejec.
  - Disparador: `planned-withdraw-cell`, para no romper los selectores existentes.
I/O: (data, month, plane) → popover. Guardar llama a `planWithdrawal(fromId, month, parsed, nota|null)`.
Failure:
- Sin alcancías: la opción «No tienes alcancías» y «Planear» deshabilitado.
- Mes cerrado: el disparador no abre y lleva `title` «Mes cerrado».
- Monto > Máx.: «Máx.» en `--error` y «Planear» deshabilitado.

FR-3002: Cada retiro planeado sale de una alcancía y respeta las reglas
Method:
- `planRetiro` valida la entrada:
  - `leafId` ∈ `reserveLeafIds`, `period` ∈ `periods` y `amount` entero ≥ 1. Si no, `invalid_target`.
  - La nota se recorta. Vacía = sin nota; más de 280 = `invalid_note`.
- Arma el candidato: `budgets[@retiros:leaf][period] += amount` y, si hay nota, la agrega a
  `cellNotes[@retiros:leaf][period]` con `uid()`, `nextSeq()` y `day`.
- Juzga con `chainCheck(state, cand, "budget", [leafId], periods)`. Un retiro solo puede romper el piso de su
  alcancía: sacar baja el neto reservado del mes, y techo y déficit solo mejoran.
- El bloqueo se traduce con `verdictOf` extendido a `plane`. Si el piso cae en el propio mes, el `limit` es
  `resolvedBalance(…, "budget")` del estado BASE, así que el mensaje dice ««Viaje» solo tiene $300»
  (AC-3006). Si cae en un mes posterior, se nombra ese mes («junio», AC-3007).
- El store pasa `day = todayISO()` y persiste. Sin toast con Deshacer: la corrección vive en la lista
  (FR-3003), igual que las ediciones de celda del plan.
I/O: (state, { leafId, period, amount, note, day }) → { state } | { rejected }.
Failure: un rechazo no muta nada. El formulario muestra `blockMessage` en `withdraw-error` y no se cierra.

FR-3003: Los retiros planeados se corrigen desde la lista
Method:
- `plannedRetiroRows(state, month)` da una línea por alcancía con `budgets[@retiros:leaf][month] > 0`, con sus
  notas.
- `PlanRow` (testids `op-plan-<leaf>`, `op-plan-amount-<leaf>` y `op-error-plan-<leaf>`) confirma con Enter o
  blur y llama a `editPlannedWithdrawal(leaf, month, n)`.
- `editPlannedRetiro` fija el valor:
  - Con 0 borra la clave del mes y `cellNotes[@retiros:leaf][month]`.
  - Juzga con `chainCheck(…, "budget", [leaf])`.
  - El piso del propio mes se re-mapea a `saldo + monto anterior`: lo que el retiro ya sacaba vuelve al tope,
    como AC-1810.
- 0 levanta «Operación eliminada», con el mismo aviso del contenedor que Ejec.
I/O: (state, leafId, period, amount ≥ 0) → { state } | { rejected }.
Failure:
- Rechazo: el campo vuelve al monto anterior y el motivo sale bajo la línea.
- Monto igual: no-op sin persistir.
- Hoja o mes inválidos: `invalid_target` («Ese monto no es válido.»).

FR-3004: La celda Pres. suma los retiros planeados
Method:
- El disparador pinta `cellNum(reserveRetiros(data, month, "budget"))`, que suma todas las filas `@retiros:*`
  (construido en d738813).
- El Balance del plan y la graduación ›/›› de la celda Ejec. ya leen esa función.
- La marca ámbar de BG-020 se conserva (`plannedRetiroLimit`).
I/O: (state, month) → entero ≥ 0; 0 se pinta «—».
Failure: sin filas → 0 → «—».

FR-3006: Los retiros planeados sin alcancía se reparten solos
Method: se conserva de d738813.
- `convertPlannedRetiros` recorre los meses en orden. Para cada `@retiros[m] = R`, ordena las alcancías por
  saldo planeado al cierre de m (ya con lo convertido antes) de mayor a menor y asigna `min(R restante, saldo)`
  hasta cubrir R. Si no alcanza, el resto va a la de mayor saldo, así que el total del mes se conserva.
  Empates: por orden del nodo.
- `loadLedger`, cuando `data_version < 7`, la corre en una transacción `for update`, persiste las filas `@retiros%`
  y fija 7. `ensureV4InTx` y `saveLedger` también la corren.
I/O: LedgerState → { state, converted }.
Failure:
- Idempotente: un ledger sin fila global devuelve el mismo objeto y `converted: false`.
- Un error de BD revierte la transacción, queda registrado y el ledger se sirve sin convertir; la siguiente
  carga reintenta.

FR-3008: El servidor aplica las reglas a los retiros planeados
Method: se conserva de d738813. `touchesReserves` compara las filas `isPlannedRetiroKey`, y `worsenedBy` juzga
los dos planos con `chainCheck` y devuelve el bloqueo más temprano.
I/O: (prev, next, periods) → violaciones.
Failure: 422 `domain_rule_violation` sin escribir; el cliente hace resync como hoy.

NFR-3005: Lo que se revierte de d738813
- `ReserveLeafCell` vuelve a pintar `map[leaf][month]`.
- `ReserveCellEditor` vuelve a `applyReserveEdit` y `cellHeadroom`, pero conserva el modo `closed`.
- `NodeRow` y `TypeTotalRow` vuelven a `rollupBudget`/`rollupActual`/`typeTotals` para las filas `transfer`.
- Las pruebas de otras features que d738813 reescribió al saldo vuelven a su aserción de aporte:
  TC-TRF4-002h/002e, 014f, 015e, TC-TDF-072f y TC-SFU-104h. `014f` conserva la fila `@retiros:c-viaje`.

## Security Design

Fuera de alcance, como declara NFR-3008: no hay endpoints, entradas aceptadas, sesiones ni secretos nuevos.
Las filas `@retiros:*` y sus notas entran por el `PUT` existente, validadas por el mismo esquema Zod:
- `apiAmountMap`: enteros acotados por `cellAmountSchema`.
- `apiCellNotes`: texto ≤ 280.

El mismo guardia las juzga, y el CHECK de `cell_note` repite el límite en la base.

La frontera de confianza no cambia. El snapshot del cliente no es confiable, y el servidor lo compara con su
propio estado dentro de la transacción: cierre, cadena de reglas y aislamiento por `ownerId`. La nota se pinta
como texto de React (escapado), nunca como HTML. Un id `@retiros:<x>` cuyo bolsillo no existe se descarta al
convertir y al guardar.

## Performance & Scalability

- `resolvedSeries` sigue memoizada por identidad; en Pres. restar la fila de la alcancía es O(P).
- El desplegable calcula `resolvedBalance` por alcancía, O(hojas × P), solo con el popover abierto, igual que
  Ejec.
- `plannedRetiroRows` es O(hojas) por mes.
- `convertPlannedRetiros` corre una vez por ledger: O(meses × alcancías × log alcancías).
- Límite de datos sin cambios (horizonte de 1 o 2 años, FR-1904).

## Deployment Architecture

- Modelo: contenedor Docker (`next start`) detrás de Nginx en Ultron (Raspberry Pi 5), sin cambios.
- Sin migración de esquema. La conversión de datos corre sola en la primera carga de cada ledger con la imagen
  nueva y queda marcada con `data_version = 7`.
- Respaldo pg_dump antes de desplegar, como siempre que hay conversión de datos.
- El despliegue termina con `scripts/verificar-prod.sh`.
- CI existente sin cambios (NFR-3010).

## Risk Analysis

1. **La conversión reparte con una regla que el usuario no ve.** Mitigación: regla decidida por el usuario el
   2026-09-27. Conserva el total del mes, así que el Balance no se mueve (NFR-3001), y cada retiro queda
   visible y corregible en la lista del formulario Pres.
2. **Un id de nodo que cambia.** `promote-to-group`, `demote-node`, `moveNode` y `deleteNode` operan por id de
   nodo. Mitigación: `repointMovements` mueve la fila `@retiros:<hoja>` y sus notas, `rewriteForDelete` las
   borra, y `nodeHasData` cuenta un retiro planeado como dato.
3. **Cliente con código viejo** que reenvía `@retiros` global. Mitigación: `saveLedger` lo convierte antes de
   juzgar.
4. **Revertir a medias lo construido en d738813.** Un resto del modo saldo (una celda o una fila de grupo que
   aún sume saldos) violaría la no_go_zone. Mitigación:
   - Borrar las funciones de saldo del dominio, no dejarlas sin uso, para que el compilador delate cualquier
     llamada restante.
   - Probar NFR-3005 con el ejemplo del AC (600, 400 y «—»).

ADR-01: Dónde se guarda el retiro planeado por alcancía
Context: FR-3002 necesita un retiro planeado con alcancía.
- Option A: filas `@retiros:<alcancía>` en `budgets`, persistidas en `amount_cell` como hoy la fila global.
  - Pro: sin DDL; reutiliza snapshot, Zod, cierre y guardia.
  - Contra: dos retiros del mismo mes y alcancía se funden en una cifra.
- Option B: movimientos del journal marcados como plan. Guardarían cada retiro por separado, pero todo el
  código de movimientos asume que son reales, así que exigen un CHECK nuevo y tocar diario-de-celda, cierre y
  descuadres.

Decision: A. Es el mínimo cambio y la lista por alcancía con notas unidas cubre AC-3016.
Consequences: un id con prefijo reservado que hay que mantener al mover o borrar alcancías.

ADR-02: Dónde se guarda la nota «¿Para qué?» del retiro planeado
Context: FR-3002 pide guardar la nota sin cambio de esquema.
- Option A: `cellNotes["@retiros:<alcancía>"][mes]` en la tabla `cell_note`.
  - Pro: `node_id` no está atado a `node`; cierre, rango, ciclos e ids ya recorren `cellNotes` de forma
    genérica.
  - Contra: `addCellNote` exige una hoja, así que `planRetiro` escribe la nota por su cuenta.
- Option B: guardar la nota en la celda de la alcancía (`cellNotes[<alcancía>]`). Mezclaría las
  observaciones del aporte con las del retiro, y borrar el retiro no sabría qué nota quitar.

Decision: A.
Consequences: las notas del retiro planeado no aparecen en el Detalle de la celda del bolsillo, sino en la
lista del formulario, que es donde se anotaron.

ADR-03: Cómo se reutiliza el formulario de Ejec.
Context: restricción de Fase 1: «reutiliza el componente, no crea uno paralelo».
- Option A: un prop `plane` en `WithdrawCell`, con una tabla de textos y de funciones por plano. La lista
  cambia de `OpRow` a `PlanRow`.
  - Pro: controles, teclas, estilos y el aviso de borrado comparten código.
  - Contra: el componente tiene dos ramas.
- Option B: un `PlannedWithdrawForm` que copie el JSX. Las dos copias acabarían divergiendo, el mismo defecto
  que ya pasó con el aviso de celda negativa.

Decision: A.
Consequences: una prueba de NFR-3002 fija que Ejec. no cambió.

ADR-04: Qué pasa con lo construido en d738813 que mostraba saldos
Context: el usuario revirtió la decisión tras verlo en dev.
- Option A: borrarlo, junto con sus pruebas.
- Option B: dejar las funciones sin uso por si se retoman. Contradice «no diseñar para requisitos futuros» y
  deja código vivo que viola la no_go_zone si alguien lo llama.

Decision: A.
Consequences: las pruebas de d738813 sobre saldos se retiran, y las de otras features vuelven a su aserción
original.

## Failure Blast Radius

Component: conversión de retiros planeados (`convertPlannedRetiros` + `ledgerRepo`)
Blast radius: la primera carga de cada ledger que tenga `@retiros` global.
User impact: si falla, la transacción se revierte y la app carga el ledger sin convertir. La celda Pres. sigue
sumando la fila global y no se pierde nada.
Recovery: la siguiente carga reintenta; respaldo pg_dump previo al despliegue.

Component: dominio de reservas (`planRetiro`, `editPlannedRetiro`, `chainCheck`)
Blast radius: la fila «Retiros del mes · Pres.» y el Balance del plan, en navegador y servidor.
User impact: un rechazo indebido muestra un motivo que no cuadra; una aceptación indebida la frena el servidor
con 422 y resync.
Recovery: pruebas de dominio con los números de los AC; rollback de la imagen.

Component: PostgreSQL
Blast radius: sin cambios respecto de hoy.
User impact: el de siempre (`StorageBanner` si el guardado no llega).
Recovery: el de siempre (restart y respaldos).

## Technical Risk Flags

[RISK] Filas con prefijo reservado que dependen del id de la alcancía
Conflict: FR-3002 guarda el retiro planeado y su nota bajo `@retiros:<leafId>`, pero promote-to-group,
demote-node, deleteNode y moveNode operan por id de nodo.
Mitigation: `plannedRetiroKey` es el único constructor del id. Las mutaciones mueven o borran la fila y sus
notas, con pruebas propias.
Severity: medium

[RISK] Pruebas que d738813 reescribió al modo saldo
Conflict: NFR-3005 vuelve a la celda como aporte del mes, pero d738813 cambió pruebas aprobadas de
transferencias, techo-de-flujo y servidor-fuente-unica para que afirmaran saldos.
Mitigation: devolverlas a su aserción original en el build, listadas en BUILD_PLAN. Donde un ancla se movió
en d738813, avanzarla con la razón escrita.
Severity: medium
