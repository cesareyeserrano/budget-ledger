# Technical Design Document (TRD / SDD) — techo-de-flujo

_Feature de T-Ledger. Fase 2 sobre `01_REQUIREMENTS.json` (FR-1801…FR-1808) y `01_UX_SPEC.md`
aprobados. Extiende la arquitectura raíz aprobada; no funda una paralela._

_**Este documento es la segunda versión.** La primera pasó un pase adversarial independiente que
encontró un defecto CRÍTICO en su decisión central —la regla bruta dejaba ciega a la validación
justo en el caso que la feature existe para cerrar— más trece hallazgos menores. Todos verificados
ejecutando el dominio y leyendo el código, y todos incorporados aquí. El apartado
`## Technical Risk Flags` conserva la traza de lo que se decidió a raíz de ellos._

## Executive Summary

El stack no cambia: **TypeScript 5.7 + Next.js 15.1 + React 19**, **Zustand 5.0**, **Drizzle 0.45
sobre PostgreSQL 16**, **Zod 3.24**, **Vitest 3** y **Playwright 1.50**. Todo el cálculo nuevo vive
en el dominio puro (`src/domain/`). **Sin migración de datos, sin cambio de esquema, sin endpoints
nuevos**: `data_version` sigue en 5 y las tablas quedan intactas.

**La decisión central y su corrección.** El mes debe consumir su cupo con los aportes **brutos**
(FR-1801), mientras el arrastre al mes siguiente sigue usando el **neto**. Pero hoy esas dos cosas
son la misma serie, y de ahí sale el defecto que el pase adversarial destapó: la validación vigente
compara el *exceso de techo* del candidato contra el del estado base, y bajo la regla bruta **una
operación sobre retiros no cambia el exceso de su mes** — así que eliminar el retiro (AC-1809) se
habría aceptado en silencio, reproduciendo exactamente el encierro. Verificado numéricamente:

```
AC-1809 · enero: flujo 1.000, reservado 1.500, retiro 500 → se elimina el retiro
  regla NETA  (hoy):   exceso base [0]   → candidato [500]   ⇒ bloquea ✓  (por casualidad afortunada)
  regla BRUTA (v1):    exceso base [500] → candidato [500]   ⇒ NO bloquea ✗ y el disponible cae a −500
  regla BRUTA (v2):    déficit base [0]  → candidato [500]   ⇒ bloquea ✓
```

La causa de raíz es que con la regla neta «reservar de más» y «dejar el disponible negativo» eran
aritméticamente **la misma condición**, y por eso una sola serie bastaba. Separar consumo de arrastre
los convierte en dos condiciones distintas, y la validación necesita las dos. Por eso ADR-01 publica
**tres** series desde el mismo barrido y ADR-06 añade la regla de déficit.

Las seis decisiones que estructuran el diseño (ADRs en `## Risk Analysis`):

1. **Un barrido, tres series: consumo (bruto), arrastre (neto) y déficit** (ADR-01).
2. **La validación en cadena gana la regla de déficit** (ADR-06) — sin ella la feature no cumple su
   propio north star.
3. **La observación del mes se DERIVA, no se almacena** (ADR-02), acotada al arrastre realmente
   disponible para no anunciar una extracción que no ocurrió.
4. **Editar un retiro conserva la identidad del movimiento** (ADR-03); `0` delega en la eliminación,
   que **adquiere validación** (el bug de fondo).
5. **Los segmentos son agrupación de filas dentro del mismo scroll** (ADR-04), y la fila «Retiros
   del mes» cambia de punto de montaje **sin salir de la cascada declarada** (ADR-07).
6. **`techoBreaches` se generaliza a `monthIssues`** (ADR-05).

## System Architecture

Delta sobre el diagrama raíz (lo no dibujado no cambia):

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            Browser (cliente)                              │
│   ≤760px                                   >760px                         │
│  ┌──────────────────────────┐  ┌───────────────────────────────────────┐  │
│  │ MobileShell — Register   │  │ DesktopShell → BudgetGrid             │  │
│  │ · límite del origen pasa │  │  UN contenedor de scroll · UN riel de  │  │
│  │   a reserveHeadroom      │  │  12 meses · columna de rótulos sticky  │  │
│  │   (hoy availableMargin:  │  │  ┌─────────────────────────────────┐  │  │
│  │   margen BRUTO que ya no │  │  │ SEG-1  Ingresos · Gastos        │  │  │
│  │   coincide con el cupo)  │  │  ├──── --spacing-6 ───────────────┤  │  │
│  └──────────────────────────┘  │  │ SEG-2  Reservas                 │  │  │
│                                │  │        · bolsillos (plegables)  │  │  │
│                                │  │        · CarryNote (mes)        │  │  │
│                                │  │        · «Retiros del mes» ◄────┼──┼──┤ MUDA
│                                │  ├──── --spacing-6 ───────────────┤  │  │ aquí
│                                │  │ SEG-3  BalanceModule            │  │  │
│                                │  │        3 bloques · 8 filas      │  │  │
│                                │  │        (sin la fila retiros)    │  │  │
│                                │  └─────────────────────────────────┘  │  │
│                                │  highlightMonth → los TRES segmentos  │  │
│                                │  MonthIssueMark en el encabezado      │  │
│                                │  ReserveCellEditor: «Máx.» absolute   │  │
│                                │    bajo el input, en TOTAL tecleable  │  │
│                                └───────────────┬───────────────────────┘  │
│  ┌─────────────────────────────────────────────▼────────────────────────┐ │
│  │ useLedgerStore — + editReserveOp · removeReserveOp devuelve rechazo  │ │
│  └─────────────────────────────┬────────────────────────────────────────┘ │
│  ┌─────────────────────────────▼────────────────────────────────────────┐ │
│  │ domain/reserve.ts                                                     │ │
│  │  techoScanRaw → { margin, consumo, arrastre, excess, deficit }        │ │
│  │  chainCheck   → techo (no empeora) + DÉFICIT (no empeora) + piso      │ │
│  │  cellHeadroom(state,leaf,month)  ← total tecleable (nuevo)            │ │
│  │  editReserveOp · monthCarryUsage · monthIssues                        │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
      Servidor, Postgres, esquema y data_version: SIN CAMBIO ALGUNO
```

**Componentes y responsabilidad (solo los tocados):**

- **`domain/reserve.ts`** — `techoScanRaw` publica tres series en vez de una; `chainCheck` gana la
  regla de déficit; `reserveHeadroom` pasa a derivar del consumo bruto; nace `cellHeadroom` (el
  total tecleable de una celda concreta); `editReserveOp` y `monthCarryUsage` son nuevas;
  `removeReserveOp` devuelve resultado tipado; `techoBreaches` → `monthIssues`.
- **`BudgetGrid`** — agrupa filas en tres segmentos dentro del mismo contenedor de scroll; monta la
  fila «Retiros del mes» al final del segmento de Reservas; arranca los grupos de bolsillos
  **plegados** (AC-1820); propaga `highlightMonth` al Balance.
- **`ReserveCellEditor`** — el «Máx.» sale del flujo horizontal (absolute bajo el input) y pasa a
  mostrar el **total tecleable**, no el incremento.
- **`BalanceModule`** — su franja lee `monthIssues`; aplica `highlightMonth`; cede el punto de
  montaje de la fila operable de retiros; y **reestructura su cascada en tres bloques rotulados**
  (FR-1810, ADR-09) leyendo los mismos números que hoy.
- **`balanceRows.ts`** — `ROWS` pasa de nueve filas a **diez**, cada una con su `block`; `CASCADE`
  declara tres eslabones, nace `MIRROR` (la fila que se muestra dos veces) y los niveles bajan a
  tres. El rótulo de la fila operable pasa a una spec propia, `RETIROS_ROW` (ADR-09).
- **`domain/balance.ts`** — `MonthBalance` **expone** `income` y `expense` (ya se calculaban dentro
  de `computeBalanceSeries`); `reserveSplit` se elimina. La aritmética no cambia.
- **`register/Register.tsx`** — el límite mostrado pasa de `availableMargin` a `reserveHeadroom`
  (hoy anuncia el margen bruto, que bajo la regla nueva ya no es lo que el dominio acepta).
- **`useLedgerStore`** — expone `editReserveOp`, propaga el rechazo de `removeReserveOp`, y pasa la
  fecha de hoy al crear un retiro desde la grilla (hoy nace sin fecha y la lista no puede mostrarla).

## Data Model

### Contrato de preservación (lo que NO cambia)

- **Ninguna tabla cambia de esquema**; `ledger.data_version` sigue en 5. Cero migraciones.
- **`LedgerState` no gana ni pierde campos.** `budgets`, `actuals`, `movements`, `cellNotes`, `nodes`
  conservan su forma. `cellNotes` gana ALCANCE (celdas de cualquier tipo, FR-1809), no estructura: su
  mapa ya es `nodeId → month → notas[]` y la tabla `cell_note` no restringe el tipo del nodo.
- Celdas de hojas expense/income y sus roll-ups: **idénticos byte a byte** (NFR-1803).
- El significado de la celda transfer se conserva: **lo reservado del mes** (no_go_zone).
- **El sentinel `@retiros` y el plan de retiros se conservan** con su semántica actual (ver ADR-08).
- **`computeBalanceSeries` conserva su aritmética íntegra.** FR-1810 reestructura las FILAS que se
  pintan, no el cálculo: `available`, `reservedBalance` y `total` salen de la misma fórmula de hoy
  (ver ADR-09). Es la garantía de que la reestructuración no puede mover un peso.

### Delta — solo derivaciones

**1. El barrido publica tres series** (antes: dos, con `delta` sirviendo a dos fines incompatibles):

```
margen(m)    = max(0, arrastre(m−1) + flujo(m))
consumo(m)   = Σ aportes brutos del mes                      ← el cambio de FR-1801
arrastre(m)  = arrastre(m−1) + flujo(m) − (aportes(m) − retiros(m))    ← NETO, sin cambio
excess(m)    = max(0, consumo(m) − margen(m))                ← gobierna las escrituras de aporte
deficit(m)   = max(0, −arrastre(m))                          ← gobierna las operaciones de retiro
```

`deficit` es la serie que la v1 no tenía y sin la cual AC-1809 es insatisfacible. Nótese que
`margen` se acota a 0, así que un arrastre negativo **no** se refleja en `excess`: por eso el
déficit debe medirse sobre `arrastre`, antes del acote.

**2. `monthCarryUsage` — la observación derivada, acotada al arrastre real:**

```ts
export function monthCarryUsage(state, month, plane):
  { reservado: number; delSaldoAnterior: number; mesAnterior: MonthKey } | null;
// delSaldoAnterior = min(aportes(m) − flujo(m), arrastre(m−1)), y null si ese mínimo es ≤ 0.
// El acote importa: sin él, un mes que reserva de más POR ENCIMA de su techo (estado legado,
// RISK-1) anunciaría haber tomado de un saldo anterior que no existía. Y enero, sin mes anterior
// (arrastre 0), devuelve null en vez de nombrar un mes inexistente.
```

**3. `cellHeadroom` — el total tecleable de UNA celda** (distinto de `reserveHeadroom`, que es el
incremento que aún cabe en el mes):

```ts
export function cellHeadroom(state, leafId, month, plane): number;
// = margen(m) − (consumo(m) − valorActualDeLaCelda). Es el TOTAL máximo que esa celda admite,
// que es lo que el editor muestra y contra lo que el usuario compara lo que teclea.
// reserveHeadroom sigue existiendo para el registro de operaciones (donde el monto SÍ es un delta).
```

**4. La lista de errores del mes:**

```ts
export type MonthIssue = { kind: "techo"; month: MonthKey; margin: number; excess: number };
export function monthIssues(state: LedgerState): readonly MonthIssue[];
```

## API Design

### Contrato preservado (superficie HTTP)

**Ningún endpoint cambia**: método, payload, códigos y validación Zod intactos en
`/api/v1/ledger`, `/api/v1/movements`, `/api/v1/movements/[id]`, `/api/v1/sync/stream`, `/health` y
`/api/auth/*`. La edición de un retiro viaja por el **snapshot PUT** vigente (verificado: `saveLedger`
borra y reinserta las filas del owner, así que un monto cambiado sobre un `id` existente se persiste
sin caso especial). `PATCH`/`DELETE` sobre un movimiento siguen respondiendo 404.

*Alcance:* la validación de invariantes en el servidor sigue ausente (BG-002 de `backend`); este
diseño no la empeora ni la resuelve, y las reglas nuevas viven en el dominio compartido que
`insertMovement` ya ejecuta.

### API interna del dominio

```ts
// ── Nuevas ──────────────────────────────────────────────────────────────────────
export function cellHeadroom(state, leafId: string, month: MonthKey, plane: Plane): number;
export function monthCarryUsage(state, month: MonthKey, plane: Plane):
  { reservado: number; delSaldoAnterior: number; mesAnterior: MonthKey } | null;
export function monthIssues(state: LedgerState): readonly MonthIssue[];
export function editReserveOp(state: LedgerState, movementId: string, newAmount: number):
  { state: LedgerState; movement: Movement | null } | { rejected: ReserveVerdict | "invalid_target" };
  // 0 → delega en removeReserveOp (movement: null).
  // Conserva id, createdAt, date, from, to, note: el MISMO movimiento con otro monto (AC-1807).
  // Hojas afectadas = TODOS los extremos reales de la operación: un retiro aporta una (`from`);
  //   un MOVER aporta DOS (`from` y `to`), porque bajar un mover puede dejar al destino sin
  //   respaldo en un mes posterior. Mismo criterio que applyReserveOp ya usa.
  // Un rechazo por piso en el mes de la operación re-mapea `limit` al saldo REAL del bolsillo
  //   (mismo re-mapeo que applyReserveOp): sin él, `limit` viaja como el saldo NEGATIVO resultante
  //   y el mensaje diría «solo tiene −500» (AC-1810).

// ── Cambian de retorno ──────────────────────────────────────────────────────────
export function removeReserveOp(state: LedgerState, movementId: string):
  { state: LedgerState } | { rejected: ReserveVerdict };
  // Id inexistente / no eliminable → { state } con el estado intacto (AC-1812).
  // El alias deprecado `removeReserveRetiro` se RETIRA en el mismo cambio (FR-1807).

// ── Cambian de valor, no de firma ───────────────────────────────────────────────
export function reserveHeadroom(state, month): number;   // ahora margen − consumo BRUTO
export function validateReserveWrite(...): ReserveVerdict;   // usa la cadena con déficit
export function applyReserveCellEdit(...): ReserveEditResult;
export function applyReserveOp(...): ReserveOpResult;

// ── Interno: la regla de cadena ─────────────────────────────────────────────────
// chainCheck(base, cand, plane, hojasAfectadas) comprueba, todas con «no empeora» salvo el piso:
//   piso    — pocketSeries(hoja) ≥ 0 en los 12 meses (ABSOLUTO, sobre las hojas afectadas)
//   techo   — excess(m) del candidato ≤ el del base   → gobierna las escrituras de aporte
//   déficit — deficit(m) del candidato ≤ el del base  → gobierna las operaciones de retiro  [NUEVO]
// El `limit` del rechazo por techo pasa a derivar de la MISMA serie de consumo que el indicador
// (hoy usa `baseScan.delta`, que desaparece): sin este cambio, el editor diría «Máx. 0» y el
// rechazo «cabían 500» sobre el mismo estado (FR-1808/AC-1834).

// ── Retirados (FR-1807) ─────────────────────────────────────────────────────────
// techoBreaches / TechoBreach → monthIssues / MonthIssue
// removeReserveRetiro (alias) · WithdrawCell props fixedFrom y trigger
```

**Cobertura UX → API:** F1 → `cellHeadroom` + `applyReserveCellEdit`; F2 → `applyReserveOp`;
F3 → `monthReserveOps` + `editReserveOp`; F4 → `monthCarryUsage`; F5 → `monthIssues`.

## Implementation Approach

- **FR-1801 · El techo es del mes y lo consumen las brutas** — *Método:* `techoScanRaw` publica
  `consumo` (Σ aportes, vía `reserveAportes`), `arrastre` (neto, vía `reserveDelta`) y `deficit`.
  *I/O:* `(state, plane)` → `{margin[12], consumo[12], arrastre[12], excess[12], deficit[12]}`.
  *Fallo:* margen negativo por sobregasto se acota a 0 y no marca exceso; los gastos no se vigilan
  (NFR-1803).

- **FR-1802 · El retiro se edita, 0 lo elimina** — *Método:* `editReserveOp` construye el candidato
  sustituyendo el monto en el mismo objeto (spread preservando identidad y fecha), reúne las hojas
  afectadas (una para un retiro, **dos para un mover**) y corre `chainCheck`. *I/O:* `(state, id,
  monto)` → `{state, movement}` o `{rejected}`. *Fallo:* monto no numérico/negativo o id no
  editable → `"invalid_target"` sin mutar; violación de cadena → veredicto con el mes que la rompe.

- **FR-1803 · Editar o eliminar se valida** — *Método:* `chainCheck` con sus tres reglas;
  `removeReserveOp` la adquiere. La regla de **déficit** es la que atrapa el caso de AC-1809, que la
  de techo no puede ver bajo consumo bruto. *I/O:* candidato → `ReserveVerdict`. *Fallo:* el rechazo
  devuelve `{rule, month, leafId, limit}` con `limit` ya re-mapeado al saldo real cuando la regla es
  el piso; el estado base queda intacto (todas las mutaciones clonan antes de aplicar).

- **FR-1804 · Observación automática del mes** — *Método:* `monthCarryUsage` como derivación pura,
  acotada al arrastre disponible. Se renderiza como indicador en la celda del mes de la **fila del
  total de Reservas** — la celda que agrega el mes sin pertenecer a ningún bolsillo, que es lo que
  FR-1804 exige («del MES, no de un movimiento»). Con FR-1809 esa celda admite observaciones como
  cualquier otra, así que la automática usa el MISMO indicador visual sin desviarse de la UX: lo que
  no comparte es el almacenamiento (es derivada, ver ADR-02). *I/O:* `(state, month, plane)` →
  `{reservado, delSaldoAnterior, mesAnterior}` o `null`. *Fallo:* enero, mes fuera de escala, sin
  reservas o sin arrastre previo → `null`. No lanza.

- **FR-1805 · La grilla en tres segmentos** — *Método:* `BudgetGrid` agrupa filas en tres
  contenedores dentro del **mismo** wrapper de scroll, separados con `--spacing-6`; `CELL_W` y la
  columna sticky no cambian, así que la alineación es estructural (ADR-04). La fila «Retiros del
  mes» se monta como última del segmento de Reservas conservando su lugar en la cascada declarada
  (ADR-07). Los grupos de bolsillos arrancan **plegados** (hoy `initialExpanded` los abre todos), que
  es lo que hace visible la fila de retiros con seis bolsillos (AC-1820). `highlightMonth` se propaga
  a `BalanceModule`. *Fallo:* un tipo sin nodos renderiza su rótulo y su fila de tipo, no un hueco.

- **FR-1806 · Errores del mes** — *Método:* `monthIssues` devuelve una lista discriminada por `kind`
  que la marca del encabezado y la franja del Balance consumen — misma fuente, no pueden discrepar.
  *I/O:* `(state)` → `MonthIssue[]` en orden de calendario. *Fallo:* estado sano → lista vacía →
  ninguna superficie se renderiza.

- **FR-1807 · Limpieza y suite verde** — *Método:* retirar el botón «Sacar» de la fila con su estado
  inerte, las props `fixedFrom`/`trigger`, el título de origen fijo, los botones de borrar con su
  tooltip, y el alias `removeReserveRetiro`. **Migración de llamadas de `removeReserveOp`:** el
  cambio de retorno afecta a ~15 puntos vivos (store, `reserve.test.ts`, `reserve-balance.test.ts`,
  `contrapartidas-reserva.test.ts`, incluidos bucles de conservación que asumen éxito siempre y una
  aserción de identidad `toBe(s1)`); se migran en el mismo commit con un helper de test que
  desempaqueta `{state}` o falla con el motivo. Actualizar las dos pruebas que esperan
  `data_version=4` **sin relajar lo que verifican**. *Fallo:* n/a — el gate es la suite.

- **FR-1809 · Observaciones en todas las celdas** — *Método:* el almacenamiento ya es genérico
  (`cellNotes: nodeId → month → notas[]` y la tabla `cell_note` con `node_id` sin restricción de
  tipo), así que el cambio es de ALCANCE, no de modelo: `addCellNote` sustituye su guarda
  `isReserveLeaf` por «hoja existente cualquiera», y el indicador más `CellNotesSection` —hoy solo en
  `ReserveCells`— pasan a montarse también en las celdas de gasto e ingreso de `BudgetGrid`. La
  validación de texto (no vacío, ≤280) y el orden por antigüedad no cambian. *I/O:*
  `addCellNote(state, leafId, month, texto)` → `{state}` o `{rejected}`. *Fallo:* nodo inexistente o
  no-hoja → `"invalid_target"`; texto vacío o >280 → `"invalid_note"`, sin truncar y sin alterar las
  observaciones vigentes. *Nota:* `cellObservations` deriva además las notas de las operaciones De→A,
  que solo existen en transfer — en gasto e ingreso la lista contiene solo las manuales, sin caso
  especial.

- **FR-1808 · El «Máx.» debajo del input** — *Método:* montar el indicador en el contenedor
  `absolute left-0 top-full` que el editor **ya tiene**, con `--bg-elevated`, `--radius-sm`,
  `--shadow-md` y `nowrap`; el input recupera `w-full`. La cifra es `cellHeadroom` (**total
  tecleable**), no `reserveHeadroom`, y el estado de alerta compara el TOTAL tecleado contra ella —
  hoy la comparación es incremental (`valor − actual > headroom`) y con la regla nueva pintaría en
  rojo una celda que solo se está bajando. *I/O:* `(cellHeadroom, valorTecleado)` → color.
  *Fallo:* `cellHeadroom` 0 → abre en `--alert-strong` desde el primer render (AC-1832).

- **FR-1810 · El Balance en tres bloques** — *Método:* capa de presentación únicamente (ADR-09).
  `computeBalanceSeries` **expone** `income` y `expense` en `MonthBalance` (ya los calcula dentro; es
  publicarlos, no recalcularlos) y todo lo demás queda igual. `balanceRows.ts` sustituye sus nueve
  filas por ocho, cada una con su `block` (`"mes" | "reparto" | "cierre"`) para el micro-rótulo, y
  `CASCADE` pasa a declarar dos eslabones —`monthResult ← {income, expense}` y
  `total ← {availableClose, reservedClose}`— más un `BREAKDOWN` nuevo,
  `monthResult → {toReserves, toAvailable}`, con su invariante `validateBreakdown`. `cellValue` mapea:
  `income→m.income`, `expense→m.expense`, `monthResult→m.flow`, `toReserves→m.reserved`,
  `toAvailable→m.flow − m.reserved`, `availableClose→m.available`, `reservedClose→m.reservedBalance`,
  `total→m.total`. Solo `availableClose` y `total` llevan `alarms: true`: un «Quedó disponible»
  negativo es información, no deuda, y ésa es la corrección que motiva el FR. Las filas de resultado
  pintan `0` explícito en vez del guion de vacío. *I/O:* `(MonthBalance, RowKey)` → número.
  *Fallo:* n/a — es derivación total sobre una serie que ya es total; un mes sin datos da ceros.

- **NFRs** — **1801/1802**: el arrastre no cambia de fórmula; protegidos por secuencia determinista.
  **1803**: las rutas de expense/income no se tocan y ninguna escritura suya adquiere validación.
  **1804**: `reservedTotal` y el mover conservan su cálculo; sobre su *eliminabilidad* ver
  [RISK-5]. **1805**: sin migración nueva. **1806**: la cascada del Balance
  conserva su ARITMÉTICA íntegra; sus filas sí se reestructuran, por mandato expreso de FR-1810
  (ADR-09), y la equivalencia se prueba contra la fórmula vigente en los doce meses (AC-1842).
  **1807** (perf): el barrido no gana pasadas; `monthCarryUsage` reusa `reserveAportes`,
  que NO está memoizado (`typeTotals` no tiene caché) — se mide en el guardrail y, si hiciera falta,
  se memoiza por identidad como el resto. **1808** (CI): `ci.yml` vigente sin cambios.

## Security Design

`NFR-1809 (Security): Not applicable` — se restata la exclusión de Fase 1: la feature opera sobre el
dominio y superficies del usuario ya autenticado. **No añade ni modifica ninguna ruta HTTP**, ni
autenticación, ni sesiones, ni secretos, ni entrada de red; tampoco cambia el esquema ni la
validación Zod vigente. Fronteras de confianza sin cambio: `withApi()` exige sesión, valida cuerpo
con Zod y aplica allowlist de Origin; `ownerId` sale de la sesión, jamás del payload. El único
efecto de borde es **restrictivo**: el dominio compartido que `insertMovement` ejecuta acepta menos
estados que antes. La ausencia de validación de invariantes en el PUT sigue siendo BG-002 de
`backend`, fuera de alcance.

## Performance & Scalability

- **Cotas:** 1 usuario, 12 meses, decenas de nodos, journal de cientos de movimientos.
- **El barrido no gana pasadas:** `techoScanRaw` ya invocaba `reserveDelta`, que suma aportes y
  retiros por separado; publicar tres series es contabilidad. La memoización vigente por identidad
  (`techoMemo` sobre `movements` × mapa del plano) se conserva.
- **Corrección respecto a la v1 de este documento:** `reserveAportes` delega en `typeTotals`, que
  **no está memoizado** y filtra hojas en cada llamada. No es un problema con las cotas declaradas
  (docenas de nodos), pero la afirmación «ya calculado» era falsa. `cellHeadroom` y
  `monthCarryUsage` se apoyan en él; si el guardrail de 150ms (NFR-1807) se acercara al umbral, la
  mitigación es memoizar `typeTotals` por identidad, como ya hacen `seriesMemo` y `journalIndexMemo`.
- **`editReserveOp`** cuesta lo mismo que `applyReserveOp`: un clon más un `chainCheck` de
  O(12·(H+1)) sobre series memoizadas.
- **Render:** tres contenedores en vez de uno; el número de filas montadas **baja**, porque los
  grupos de bolsillos arrancan plegados.
- **BD:** cero consultas nuevas, cero índices nuevos, snapshot del mismo tamaño.

## Deployment Architecture

**Modelo: contenedorizado, sin cambio** — Docker (`next start`) → Nginx (TLS/headers) → Ultron
(Raspberry Pi 5), `docker-compose` con `postgres:16-alpine`. Entornos: dev local (compose dev +
Mailpit), CI (GitHub Actions con testcontainers), producción (Pi).

**Piezas de despliegue de esta feature: ninguna.** Sin migración de esquema, sin migración de datos
(`data_version` intacto en 5), sin variables de entorno nuevas. Es sustituir el contenedor.

**Rollback:** trivial en ambos sentidos — al no tocar datos ni esquema, el bundle anterior lee los
mismos registros. Volver atrás reintroduce el defecto del cupo, no corrompe nada.

**CI (NFR-1808):** `ci.yml` vigente corre typecheck, lint, unit/integración (testcontainers) y e2e
en cada push a main. Esta feature debe dejarlo verde, incluidas las dos pruebas hoy rojas.

## Risk Analysis

**ADR-01 — Un barrido, tres series**
*Context:* FR-1801 cambia qué consume el cupo (bruto) conservando el arrastre (neto). Hoy
`techoScanRaw` publica una sola `delta` que sirve a los dos fines.
*Option A — Tres series con nombre desde el mismo barrido* (`consumo`, `arrastre`, y `deficit`
derivado del arrastre): un solo punto de verdad, memoización y firmas intactas, coste igual.
*Option B — Una función `monthCap` paralela:* deja el barrido intacto, pero crea dos caminos para la
misma cifra — el defecto que originó BG-001 y toda esta línea de trabajo.
*Decision:* **A**.
*Consequences:* el «Máx.» y el `limit` del rechazo cambian a la vez y por construcción — pero
`chainCheck` calculaba `limit` desde `delta`, que desaparece: esa línea es obligatoria y está
declarada en API Design (hallazgo adversarial 2).

**ADR-06 — La cadena gana la regla de déficit** *(nace del hallazgo crítico)*
*Context:* bajo consumo bruto, una operación sobre retiros no altera el consumo de su mes, luego no
altera su exceso, luego `chainCheck` —que compara excesos— es **ciega** a ella. Eliminar el retiro de
AC-1809 se aceptaba y dejaba el disponible en −500, reproduciendo el encierro. Con la regla neta esto
no pasaba porque «reservar de más» y «disponible negativo» eran la misma condición aritmética.
*Option A — Añadir la regla de déficit (`deficit(m)` no puede empeorar):* mide el arrastre ANTES del
acote a 0, así que ve exactamente lo que la de techo no ve. Verificado: bloquea AC-1809 y acepta la
eliminación legítima (retiro de 200 con margen de sobra).
*Option B — Hacer la regla de techo absoluta (`excess = 0` siempre):* también atraparía el caso, pero
convierte cualquier estado legado por encima del techo en un bloqueo total de la app —
el encierro por otra puerta, y contra NFR-1803.
*Option C — Volver al consumo neto:* renuncia a FR-1801, que es la feature.
*Decision:* **A**. Dos condiciones distintas necesitan dos reglas distintas.
*Consequences:* `chainCheck` pasa de dos reglas a tres; el mensaje de rechazo por déficit necesita su
propio texto («eliminarlo dejaría marzo sin respaldo»), distinto del de techo.

**ADR-02 — La observación del mes se deriva, no se almacena**
*Context:* FR-1804 exige que se actualice sola, no acumule, sea del MES y no pise las notas escritas
a mano. El mecanismo vigente (`cellNotes`) solo AGREGA y está anclado a (nodo, mes).
*Option A — Derivarla de `monthCarryUsage`:* las cuatro exigencias salen por construcción; nada que
migrar ni sincronizar.
*Option B — Persistirla en `cellNotes` con una clave sentinel:* obliga a enseñar a `cellNotes` a
reemplazar, a distinguir notas de la app de las del usuario en la misma lista, y a reescribirla en
cada mutación que cambie el flujo del mes — con la garantía de que algún camino se olvide y deje una
nota mintiendo.
*Decision:* **A**.
*Consequences:* la observación no es editable ni descartable (no es un dato del usuario) y no deja
registro histórico — coherente con lo pedido. La UX aprobada dice «reusa el mecanismo de
observaciones por celda»: se reusa su **patrón visual**, no su almacenamiento, y se ancla a la fila
del TIPO Reservas para no atribuirla a un bolsillo arbitrario ([RISK-3]).

**ADR-03 — Editar un retiro: mutar el movimiento, no sustituirlo**
*Context:* AC-1807 exige conservar fecha e identidad.
*Option A — Mutación en sitio* (spread preservando `id`/`createdAt`/`date`/extremos): la lista no
reordena, el historial no miente, el snapshot lo persiste sin caso especial.
*Option B — Eliminar y recrear:* más corto reusando funciones existentes, pero genera `id` y
`createdAt` nuevos: el movimiento salta al principio y pierde su fecha. Contradice AC-1807.
*Decision:* **A**.
*Consequences:* `editReserveOp` construye su propio candidato; `0` delega en `removeReserveOp` para
no duplicar la regla. Nota: los retiros creados desde la grilla nacen **sin `date`** (el store no la
pasa), así que la lista no tendría fecha que mostrar — se corrige pasando la fecha de hoy al crear
(hallazgo adversarial 14).

**ADR-04 — Los segmentos son agrupación de filas, no grillas independientes**
*Context:* FR-1805 pide tres bloques y la constraint exige un riel único de meses con un solo scroll.
*Option A — Tres contenedores de filas dentro del MISMO wrapper de scroll,* compartiendo `CELL_W` y
la columna sticky: la alineación es estructural, no sincronizada.
*Option B — Tres grillas independientes con scroll sincronizado por JS:* permite cabeceras propias,
pero cualquier desincronización deja enero de Gastos sobre febrero de Reservas — lo que la constraint
prohíbe.
*Decision:* **A**.
*Consequences:* una sola fila de encabezados de mes arriba del todo; al bajar, el Balance queda lejos
de su cabecera — mitigado por el sombreado de la columna activa, que ahora atraviesa los tres bloques.

**ADR-07 — La fila «Retiros del mes» cambia de montaje sin salir de la cascada**
*Context:* FR-1805 la muda al segmento de Reservas; NFR-1806 exige que el Balance conserve su
cascada. Verificado: `retiros` es una fila declarada de `ROWS` y un **sumando de `monthAvailable`**
en `CASCADE`; `validateCascadeOrder` falla con «falta la fila retiros» si desaparece, y hay tests
(TC-BJE-001h/e, TC-BJE-003h/f) sobre esos invariantes.
*Option A — Conservar `ROWS` y `CASCADE` intactos y mover solo el punto de MONTAJE:* la fila sigue
declarada y sigue siendo sumando; las validaciones de orden pasan a operar sobre el orden RENDERIZADO
completo (segmento de Reservas + Balance), donde `retiros` sigue apareciendo **antes** que
`monthAvailable` — el invariante se mantiene verdadero, no se relaja.
*Option B — Sacar `retiros` de `ROWS` y del `CASCADE`:* rompe cuatro invariantes con test y deja
`monthAvailable` sin uno de sus sumandos declarados: la aritmética del Balance dejaría de estar
declarada, que es justo lo que esas validaciones existen para impedir.
*Decision:* **A** — el usuario pidió mover la fila de sitio, no sacarla de la contabilidad.
*Consequences:* `BalanceModule` deja de renderizar esa fila y `BudgetGrid` la monta al final del
segmento de Reservas; las validaciones reciben el orden compuesto. La aritmética no cambia.

**ADR-05 — `techoBreaches` se generaliza a `monthIssues`**
*Context:* FR-1806 amplía el alcance a «cualquier error del mes», hoy con un tipo.
*Option A — Lista de uniones discriminadas por `kind`:* las dos superficies consumen la lista;
añadir un tipo no obliga a tocarlas.
*Option B — Listas hermanas por tipo:* cada superficie tendría que conocerlas y combinarlas todas.
*Decision:* **A**, con un solo `kind` hoy (`"techo"`).
*Consequences:* renombrar el export lo recoge FR-1807; el formateo del mensaje vive en la UI.

**ADR-08 — El plano Presupuestado y el retiro planeado** *(nace del hallazgo adversarial 6)*
*Context:* `techoScanRaw` es paramétrico por plano y su `excess` alimenta `planTechoMonths`, que
pinta el aviso ámbar en las celdas Pres. En el plano budget, `reserveDelta` resta el retiro PLANEADO
(`budgets["@retiros"]`). Con consumo bruto, ese retiro dejaría de descontar y meses de plan que hoy
no avisan pasarían a avisar — un cambio que ningún FR pidió.
*Option A — La regla bruta aplica SOLO al plano Ejecutado; el plano Presupuestado conserva el
consumo neto:* FR-1801 nace de una operación real (retirar y volver a reservar el mismo mes) que en
el plan no existe —no hay journal de retiros, solo una cifra planeada—, así que la razón de la regla
no aplica ahí. `planTechoMonths`, `plannedRetiroLimit` y `setPlannedRetiro` conservan su
comportamiento exacto.
*Option B — Aplicarla a los dos planos por simetría:* cambia el aviso del plan sin que nadie lo
pidiera y sin decidir si un retiro planeado debe consumir cupo del plan — una decisión de producto
que este diseño no tiene mandato para tomar.
*Decision:* **A**, y queda declarado como el límite explícito del alcance.
*Consequences:* `techoScanRaw` elige la serie de consumo según el plano; el aviso del plan sigue
comportándose como hoy. Si más adelante se quiere simetría, es una decisión de producto separada.

**ADR-09 — El Balance se reestructura en tres bloques; la aritmética no se toca** *(FR-1810;
SUPERSEDE la decisión de ADR-07 sobre `retiros` en la cascada)*
*Context:* el usuario declaró el Balance ilegible («las operaciones en balance son súper confusas, no
se logran leer ni entender bien»), pidió la lectura contable y eligió la estructura de tres bloques.
El principio: guardar en una alcancía no es un gasto, es mover plata entre bolsillos propios — luego
las reservas no pueden RESTAR en la cuenta del mes, tienen que aparecer como destino.
*Revisión v3 (mismo día):* la primera forma del bloque del medio —un REPARTO del resultado en dos
destinos— se rechazó al verla con datos reales. Mostraba «Quedó disponible −500», y el usuario objetó
el concepto, no el rótulo: «no puedes decir que quedó un acumulado de menos 500, el acumulado ahí es
cero porque te los gastaste, no quedaste debiendo acumulado». Tiene razón —**un saldo que se gastó
vale cero, no menos**— y el fallo era estructural: la metáfora del reparto sólo se sostiene mientras
lo guardado quepa en el resultado del mes, y el caso que motivó la feature entera es precisamente el
contrario. El bloque pasa a ser LA CUENTA del bolsillo disponible, término a término, que es la
fórmula que el propio usuario enunció. El −500 no se esconde: deja de existir, porque lo que salió
del saldo anterior se ve salir en su propia línea en vez de deducirse de un negativo.
*Option A — Reestructurar solo la capa de PRESENTACIÓN (`ROWS`/`CASCADE`/`cellValue`), dejando
`computeBalanceSeries` intacto:* las ocho filas nuevas se leen de campos que la serie ya publica
(`flow`, `reserved`, `available`, `reservedBalance`, `total`) más `income`/`expense`, que la función
ya calcula internamente y solo hay que exponer. Las identidades del bloque nuevo se cumplen por
construcción, no por una fórmula nueva: `Guardado + Quedó = flujo` porque `Quedó := flujo − reservado`,
y `Disponible(m) = Disponible(m−1) + Quedó(m)` porque `available := prevAvailable + flujo − reservado`.
*Option B — Reescribir también el dominio para que produzca las ocho cifras:* introduce una segunda
fuente de verdad para números que hoy ya son correctos, y pone en riesgo la conservación (guardrail
declarado) a cambio de nada — la reestructuración es un problema de lectura, no de cálculo.
*Decision:* **A**. La reestructuración NO puede mover un peso, y esa propiedad se prueba comparando
«Disponible» contra la fórmula vigente en los doce meses (AC-1842).
*Consequences:*
  1. `retiros` **sale de la cascada como fila neta y vuelve como fila BRUTA**. La v2 lo neteaba
     dentro de «Reservas del mes»; la v3 lo publica en su propia fila, «Retiros de reservas»,
     con su cifra bruta y signo `+`. Esto revoca la Option A de ADR-07 sólo en su mecanismo (la fila
     ya no es `retiros` sino `toWithdrawals`, y ya no alimenta a `monthAvailable`, que dejó de
     existir), pero RESTITUYE su intención: el retiro vuelve a estar dentro de la cuenta del Balance,
     que es lo que ADR-07 protegía. La fila OPERABLE sigue montada al final del segmento de Reservas
     (FR-1805) con su spec propia `RETIROS_ROW`; la del Balance es su reflejo de sólo lectura.
  2. **No hay relación inversa que declarar.** La v2 necesitaba un `BREAKDOWN` con su propio
     invariante porque su bloque del medio era un DESGLOSE (el total arriba, las partes debajo). En la
     v3 ese bloque es una CUENTA normal —sus términos preceden a su resultado—, así que encaja en
     `CASCADE` sin excepciones y `BREAKDOWN`/`validateBreakdown` se **eliminan**. Menos maquinaria y
     un invariante menos que mantener: la estructura correcta necesitaba menos aparato que la
     equivocada.
  3. **`monthResult` se muestra DOS veces** (cierre del bloque 1, término del bloque 2). Son dos
     claves de fila distintas —`monthResult` y `monthResultCarry`— porque `CASCADE` y los validadores
     buscan por clave y una clave repetida los rompería. Se declara además un `MIRROR` que ata las
     dos a la misma cifra, con su invariante: sin él, la repetición sería el único punto del módulo
     donde dos filas podrían divergir en silencio.
  4. `reserveSplit` **se elimina** (su consumidor era la cascada de la v1) y `computeReserveFlows`
     **se conserva**: la v3 vuelve a necesitar los aportes y los retiros BRUTOS, que es justo lo que
     publica. La limpieza sigue la regla de FR-1807 (barrido `grep` de cada símbolo retirado).
  5. Los NIVELES bajan de cuatro a tres (`0..2`). Con la v3, `monthResult` y `available` son ambos
     resultados intermedios al mismo nivel (1), y sus términos al 2. No es una simplificación
     cosmética: si `monthResult` quedara al mismo nivel que los términos del bloque 2, la marcha
     atrás de `validateContiguity` desde `available` lo recogería como sumando suyo, que no lo es.
  6. **Se restituye `prevAvailable`** («Saldo del mes anterior»), que la v2 había retirado con el
     argumento de que ese dato es la columna de la izquierda. El argumento vale para un contador y es
     falso para ESTE usuario, en cuya fórmula declarada esa cifra es un término explícito. Con ello
     [RISK-8] —la lectura horizontal no es exacta en el plano Presupuestado— **queda cerrado**: la
     columna ya no depende de mirar a la izquierda, porque publica su propia apertura.

**Riesgos principales:**

1. **Estados legados por encima del techo nuevo** — el propio estado del usuario los tiene.
   `chainCheck` bloquea solo lo que EMPEORA, así que no encierra; `monthIssues` los señala. Ver
   [RISK-1].
2. **Concurrencia multi-dispositivo** — sin cambio: lock optimista por `revision` + SSE.
3. **La edición de un retiro toca el arrastre de todos los meses siguientes** — razón de AC-1829;
   cubierto por `chainCheck` sobre los doce meses.

## Failure Blast Radius

Component: **PostgreSQL**
Blast radius: toda persistencia; la UI optimista sigue operando en memoria.
User impact: `StorageBanner` avisa; nunca un falso «guardado».
Recovery: el drenador reintenta; al volver la BD se aplica el último snapshot. Sin estado parcial.

Component: **Dominio — el barrido del techo y la cadena (`techoScanRaw` + `chainCheck`)**
Blast radius: es el único punto de verdad del cupo; un error deja mal a la vez el «Máx.», todos los
rechazos y las señales de error del mes.
User impact: o rechaza reservas legítimas, o acepta las que no caben — el defecto que la feature
cierra, reintroducido. **Es el componente con más riesgo de la feature**, y el que el hallazgo
crítico afectó.
Recovery: sin corrupción de datos (derivación pura, nada se persiste); revertir el bundle restaura
el comportamiento anterior. Cubierto por NFR-1801/1802 con secuencia determinista y por los casos
numéricos de AC-1801…1804, 1809 y 1829.

Component: **Better Auth / sesión**
Blast radius: sin sesión no hay API. La feature no lo toca.
User impact: redirección a login. Recovery: re-login; sesiones en BD.

Component: **syncHub (SSE)**
Blast radius: los otros dispositivos no se enteran en vivo (singleton en memoria, OBS-1).
User impact: lo ven en la próxima recarga; el 409 + resync evita pisarse.
Recovery: reconexión automática; la verdad está en Postgres.

## Technical Risk Flags

[RISK-1] Un ledger guardado bajo la regla vieja tiene meses por encima del techo nuevo
Conflict: FR-1801 declara que ninguna secuencia aceptada deja un mes por encima de su techo, pero el
estado ya persistido del usuario contiene ese caso (enero con 1.500 sobre 1.000), creado por la regla
que se sustituye.
Mitigation: `chainCheck` compara candidato vs base y bloquea solo lo que EMPEORA, así que el estado
histórico no encierra al usuario; `monthIssues` lo marca y la franja lo detalla para que lo corrija
con operaciones normales. Sin migración: FR-1806 existe precisamente para hacerlo visible.
Severity: medium

[RISK-2] `monthCarryUsage` acotado puede quedarse corto en un estado legado
Conflict: la fórmula se acota al arrastre real para no anunciar una extracción inexistente, así que
en un mes que reservó POR ENCIMA de su techo (RISK-1) la observación dirá menos de la diferencia
bruta — el resto no salió de ningún saldo, salió de la nada.
Mitigation: es lo correcto (la alternativa miente), y ese mes lleva además la marca de error de
FR-1806, que es la señal adecuada para un estado imposible. Documentado en el Data Model.
Severity: low

[RISK-3] RESUELTO — el domicilio de la observación ya no desvía de la UX
Conflict (v1): la UX decía «reusa el mecanismo de observaciones por celda», pero ese mecanismo estaba
anclado a (bolsillo, mes) y FR-1804 prohíbe atribuir la observación a un bolsillo concreto.
Resolution: el usuario resolvió la tensión ampliando el alcance — FR-1809 lleva las observaciones a
TODAS las celdas, así que la celda del total de Reservas es una celda como cualquier otra y la
observación automática vive ahí con el mismo indicador. Ya no hay desviación que confirmar: la UX y
el diseño dicen lo mismo.
Severity: n/a (cerrado)

[RISK-4] El «Máx.» pasa a ser el total tecleable, no el incremento
Conflict: el editor compara hoy el DELTA contra `reserveHeadroom`; bajo la regla nueva una celda con
el cupo agotado tendría headroom 0 y se pintaría en alerta aunque el usuario solo esté bajando el
valor — la señal mentiría sobre el resultado.
Mitigation: se introduce `cellHeadroom` (total tecleable de esa celda) y el editor compara el total.
`reserveHeadroom` sigue existiendo para el registro de operaciones, donde el monto sí es un delta.
Ambas derivan del mismo barrido, así que no pueden discrepar.
Severity: medium

[RISK-5] Validar la eliminación choca con la letra de NFR-1804 sobre el mover
Conflict: NFR-1804 (MUST de regresión) dice que la operación entre bolsillos «sigue siendo
eliminable»; al adquirir `chainCheck`, eliminar un mover cuyo destino ya operó retiros pasa a
rechazarse.
Mitigation: la intención de NFR-1804 es que el mover no pierda su capacidad de corrección (antes
estaba ATRAPADO, sin forma de deshacerlo), no que sea eliminable en estados donde eso rompería la
contabilidad — la misma regla que ya gobierna todo lo demás. La vía de corrección sigue existiendo
(editar su monto, FR-1802). **Confirmar esta lectura en el approve.**
Severity: medium

[RISK-6] El límite de la pantalla Registrar quedaría desincronizado si no se cambia
Conflict: `Register.tsx` muestra `availableMargin` (margen BRUTO). Bajo la regla nueva ese número ya
no es lo que el dominio acepta: en el enero del usuario anunciaría «Margen del mes 1.000» mientras
rechaza cualquier aporte. Y Registrar es la ÚNICA vista bajo 760px.
Mitigation: pasa a mostrar `reserveHeadroom` (el cupo que queda, que es un delta — y en Registrar el
monto es un delta, así que la semántica coincide sin necesidad de `cellHeadroom`). Declarado en
System Architecture y en el bloque NFR.
Severity: medium

[RISK-7] El cambio de retorno de `removeReserveOp` alcanza ~15 llamadas vivas, no dos pruebas
Conflict: la v1 de este documento afirmaba que la única deuda era corregir dos pruebas. Verificado:
el alias `removeReserveRetiro` está vivo, el store compara identidad (`data === prev`), y hay bucles
de propiedad en `contrapartidas-reserva.test.ts` y `reserve-balance.test.ts` que asignan el resultado
asumiendo éxito siempre — justo los tests que NFR-1801 exige.
Mitigation: la migración es parte de FR-1807 y está declarada en su entrada de Implementation
Approach, con un helper de test que desempaqueta el resultado. Es trabajo mecánico, pero debe
planificarse: descubrirlo a mitad del build es lo que rompe una estimación.
Severity: low

[RISK-8] La lectura horizontal del cierre es exacta en Ejecutado y NO en Presupuestado
Conflict: FR-1810 retira «Saldo mes anterior» porque el cierre del mes previo es la columna de la
izquierda. Eso es literalmente cierto en el plano Ejecutado. En Presupuestado NO: ADR-03 de
`balance.ts` re-ancla el plan de cada mes al cierre REAL del anterior, así que la columna Pres. de
febrero no se encadena con la Pres. de enero. El usuario ya tropezó con el síntoma («Saldo reservado»
Pres. mostrando 1.000 en febrero) y se le explicó.
Mitigation: NO se resuelve aquí — es una decisión de producto preexistente (el re-anclaje) que este
documento no tiene mandato para revocar, y la alternativa (conservar «Saldo mes anterior» solo para
Pres.) reintroduciría la fila que el usuario pidió quitar. Queda anotado como candidato de backlog:
o se marca el re-anclaje en la UI, o el Balance muestra solo Ejecutado. Ambas se le ofrecieron al
usuario y quedaron aparte de esta feature.
Severity: low

## Traceability Checklist

- [x] FR-1801…FR-1808: cada uno con entrada en Implementation Approach y componente en System
  Architecture; F1–F5 de la UX mapeados a firmas en API Design. AC-1820 (plegado) y AC-1834
  (indicador = rechazo) tienen ahora elemento de diseño explícito.
- [x] NFR-1801…1808 → bloque NFR e Implementation Approach; NFR-1809/1810/1811 → exclusiones
  restatadas. NFR-1804 y NFR-1806 con su tensión declarada ([RISK-5], ADR-07).
- [x] ADR-01…ADR-08, todos con ≥2 opciones evaluadas y consecuencias declaradas.
- [x] no_go_zone: sin cierre de mes, sin cambiar el modelo de celdas, sin bloquear ediciones de
  ingresos/gastos, sin retirar el mover ni la migración v5, sin metas ni multiusuario.
- [x] Failure Blast Radius: 4 componentes críticos, con el de mayor riesgo nombrado.
- [x] Technical Risk Flags: 7 flags; dos piden confirmación explícita en el approve ([RISK-3] y
  [RISK-5]).
