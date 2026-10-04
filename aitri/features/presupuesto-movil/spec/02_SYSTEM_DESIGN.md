# Technical Design Document (TRD / SDD)

Feature **presupuesto-movil** (BL-056, primera entrega). Añade al shell móvil (≤760 px) una vista de presupuesto de
un periodo, sobre el estado, las funciones de dominio y las acciones del store que ya usa escritorio. No hay
endpoints, tablas ni dependencias nuevas.

## Executive Summary

- **Stack (el del producto, sin cambios):** Next.js 15.1 (App Router) · React 19.3 · Zustand 5.0 · Tailwind CSS 4.0 ·
  lucide-react 0.474 · TypeScript 5.7 · Node 22.x. Pruebas con Vitest 4.1 y Playwright 1.63. Motivo: la feature es
  una superficie nueva de una app existente; cualquier otra elección fundaría una arquitectura paralela.
- **Qué se construye:** componentes nuevos bajo `src/components/mobile/`, dos módulos puros de composición
  (`src/domain/periodView.ts` y `src/components/balanceView.ts`) y un módulo de navegación por historial
  (`src/components/mobile/screenStack.ts`).
- **Qué se reutiliza sin cambiar su lógica:** `rollupTable`, `cellTone`/`cellGlyph`, `computeBalanceSeries`,
  `openingCarry`, `cellDetail`, `monthReserveOps`, `isClosed`, el calendario de periodos (`useCalendar`,
  `useActivePeriods`, `useNow`, `withRange`) y las acciones del store (`setLeafAmount`, `editMovement`,
  `deleteMovement`, `applyReserveEdit`, `editReserveOp`, `setPeriod`, `showToast`).
- **Qué se toca de lo existente (cinco cambios acotados, ninguno cambia comportamiento):**
  1. `MobileShell.tsx`: pasa de montar solo el registro a montar el control segmentado y las dos vistas.
  2. `BalanceModule.tsx`: sus funciones privadas `computeReserveFlows`, `cellValue` y `balanceColor`, y la regla
     «un resultado en cero se pinta 0», se MUEVEN a `src/components/balanceView.ts` y el módulo las importa
     (NFR-3106).
  3. `MovementEditor.tsx`: el ensayo de la edición (qué se guardaría, qué lo impide, a qué periodo pasa) se extrae
     a una función pura compartida, `movementEditVerdict` (ADR-03).
  4. Piezas del registro, con props OPCIONALES cuyo valor por defecto deja `Register.tsx` igual: `SaveButton`
     (`label`, `testId`), `NoteField` (`id`, `testId`), `AmountDisplay` (`signed`, `testId`), `DateTimeField` y
     `CategoryRow` (`testId`).
  5. `src/domain/tree.ts`: se añade `orderedGroups` y `orderedChildren` (el orden que hoy vive privado en la
     grilla). `CellDetail.tsx`: `dayLabel` se muda a `src/components/format.ts` y se re-exporta desde donde estaba.
- **Decisiones (ADRs en Risk Analysis):** navegación por historial del navegador sin rutas nuevas (ADR-01);
  la vista móvil lee de la misma tabla de roll-ups que la grilla a través de un view-model puro (ADR-02); el
  formulario de edición se compone con las piezas del registro sin tocar `Register.tsx` (ADR-03); los saldos
  protegidos no se renderizan mientras están ocultos (ADR-04); las dos vistas quedan montadas y se alterna
  inactiva; el registro siempre montado y el presupuesto montado en la primera visita (ADR-05); ids de prueba
  propios `mb-*` (ADR-06).

## System Architecture

```
┌──────────────────────────────── Navegador (≤760 px) ────────────────────────────────┐
│ app/page.tsx → LoginGate → ShellSwitch (matchMedia 760 px, sin cambios)             │
│        │                                                                            │
│  ┌─────▼──────────────────────────────── MobileShell (MODIFICADO) ───────────────┐  │
│  │ Encabezado: SegmentedNav [Registrar | Presupuesto] · Config · Tema · Salir    │  │
│  │ StorageBanner · Toaster (sin cambios)                                         │  │
│  │                                                                               │  │
│  │ ┌── vista "registrar" ──┐   ┌──────── vista "presupuesto" (NUEVA) ──────────┐ │  │
│  │ │ <Register/> intacto   │   │ MobileBudget ── lee screenStack (URL)         │ │  │
│  │ │ (hidden si inactiva)  │   │  ├ lista: PeriodBar · ClosedNotice ·          │ │  │
│  │ └───────────────────────┘   │  │        SummaryCard · BudgetSections       │ │  │
│  │                             │  │        (GroupCard › BudgetRow › ProgressBar)│ │  │
│  │                             │  ├ hoja:     LeafScreen (Categoría / Alcancía)│ │  │
│  │                             │  ├ editar:   MovementEditScreen               │ │  │
│  │                             │  ├ retiros:  WithdrawalsScreen                │ │  │
│  │                             │  └ balance:  BalanceScreen                    │ │  │
│  │                             └────────────────────┬──────────────────────────┘ │  │
│  └──────────────────────────────────────────────────┼────────────────────────────┘  │
│        screenStack.ts ── history.pushState / popstate (misma página, mismo origen)  │
│                                                      │                              │
│  ┌───────────────────────────────────────────────────▼───────────────────────────┐  │
│  │ useLedgerStore (Zustand, SIN acciones nuevas)                                 │  │
│  │  data · period · setPeriod · setLeafAmount · editMovement · deleteMovement ·  │  │
│  │  applyReserveEdit · editReserveOp · showToast                                 │  │
│  └───────────────┬───────────────────────────────────────────┬───────────────────┘  │
│                  │ funciones puras                            │ persistencia         │
│  ┌───────────────▼─────────────────────────┐   ┌──────────────▼──────────────────┐  │
│  │ domain/ (TS puro)                       │   │ ServerRepository (sin cambios)  │  │
│  │  NUEVO periodView.ts  → rollupTable,    │   │  PUT/GET /api/v1/ledger         │  │
│  │        cellTone, cellGlyph, tree        │   │  PATCH/DELETE /api/v1/movements │  │
│  │  components/balanceView.ts → computeBal-│   │  SSE /api/v1/sync/stream        │  │
│  │        Series, openingCarry, reserve    │   └──────────────┬──────────────────┘  │
│  │  existentes: detail, closure, reserve,  │                  │                     │
│  │        mutations, budgetState           │                  │                     │
│  └─────────────────────────────────────────┘                  │                     │
└───────────────────────────────────────────────────────────────┼─────────────────────┘
                                                                │ cookie de sesión
                              Servidor Next.js + PostgreSQL (SIN CAMBIOS: mismas rutas,
                              mismas validaciones, mismas reglas de cerrado y de reservas)
```

**Componentes y responsabilidad**

| Componente | Archivo | Responsabilidad única |
|---|---|---|
| `MobileShell` (modificado) | `src/components/MobileShell.tsx` | Encabezado, navegación entre las dos vistas, banner y toasts. `Register` siempre montado; `MobileBudget` se monta en la primera visita y queda montado; la vista inactiva lleva `hidden` |
| `SegmentedNav` | `src/components/mobile/SegmentedNav.tsx` | Control «Registrar \| Presupuesto» sobre `ui/tabs`. Escribe la vista en `screenStack` |
| `screenStack` | `src/components/mobile/screenStack.ts` | Fuente única de «qué pantalla se ve», respaldada por la URL y el historial del navegador |
| `MobileBudget` | `src/components/mobile/MobileBudget.tsx` | Enruta entre lista y pantallas de detalle según `screenStack`. Guarda qué grupos están desplegados |
| `PeriodBar` | `src/components/mobile/PeriodBar.tsx` | ‹ ›, rótulo y selector de periodo. Lee y escribe `period` del store |
| `SummaryCard` | `src/components/mobile/SummaryCard.tsx` | Los cuatro saldos, plegable y protegida (FR-3115). Usa `useHoldReveal` |
| `useHoldReveal` | `src/components/mobile/useHoldReveal.ts` | Estado «revelado» mientras dura la presión del puntero o de la tecla |
| `BudgetSections` | `src/components/mobile/BudgetSections.tsx` | Pinta el view-model: secciones, `GroupCard`, `BudgetRow`, `ProgressBar` |
| `LeafScreen` | `src/components/mobile/LeafScreen.tsx` | Categoría o alcancía: tarjetas Pres./Ejec. con «Cambiar» y lista de movimientos |
| `AmountEditCard` | `src/components/mobile/AmountEditCard.tsx` | Tarjeta de cifra editable (campo, Guardar, Cancelar, error). Recibe el `onSave` del plano |
| `MovementEditScreen` | `src/components/mobile/MovementEditScreen.tsx` | Formulario de edición con las piezas del registro y `movementEditVerdict` |
| `WithdrawalsScreen` | `src/components/mobile/WithdrawalsScreen.tsx` | Lista de retiros del periodo, corrección y borrado |
| `BalanceScreen` | `src/components/mobile/BalanceScreen.tsx` | Los tres bloques del Balance, solo lectura |
| `periodView` | `src/domain/periodView.ts` | View-model puro de la lista de un periodo |
| `balanceView` | `src/components/balanceView.ts` | Valores y color de las filas del Balance y resumen de saldos, puros. Vive junto a `balanceRows.ts` porque usa su `RowKey`/`RowSpec` |
| `movementEditVerdict` | `src/domain/movementEditVerdict.ts` | Veredicto puro de una edición en curso, compartido por escritorio y móvil |

**Patrón de interacción.** Igual que escritorio: UI optimista. Una acción muta el store, las vistas se recalculan
de inmediato y la persistencia va serializada y en diferido por `ServerRepository`. Los rechazos de dominio
vuelven como valor de retorno de la acción y se pintan junto al campo. Los fallos de persistencia los comunica el
`StorageBanner`. Otro dispositivo se entera por SSE.

## Data Model

**Contrato de preservación (no cambia nada):**
- Esquema de PostgreSQL: sin migraciones. Las tablas de `src/server/db/schema.ts` (`ledger`, `node`, `amountCell`, `movement`, `cellNote`,
  `closureEvent`, las de ciclos y las de autenticación) quedan como están.
- `LedgerState` (`src/domain/types.ts`): sin campos nuevos.
- `localStorage`: sin claves nuevas. El estado de la tarjeta de resumen (plegada, oculta) y de los grupos
  desplegados es estado de componente y se pierde al recargar, que es lo que pide FR-3115 («cada vez que se abre la
  app, vuelve a estar plegada y oculta»).

**Delta: tipos de vista (solo en memoria, derivados)**

```ts
// src/domain/periodView.ts
export interface PeriodRow {
  id: string;                 // id del nodo; "@retiros" para la fila Retiros del mes
  name: string;
  icon: string | null;
  level: 0 | 1 | 2;           // grupo, categoría, subcategoría
  type: "income" | "expense" | "transfer";
  budget: number;             // COP entero ≥ 0
  actual: number;             // COP entero ≥ 0
  leaf: boolean;              // true ⇒ abre pantalla; false ⇒ pliega/despliega
  tone: CellTone;             // cellTone(type, budget, actual)
  glyph: string;              // cellGlyph(...): "", "›", "››" o "‹"
  progress: number;           // 0..1, ver periodView
  children: PeriodRow[];
}
export interface PeriodSection { type: PeriodRow["type"]; budget: number; actual: number; groups: PeriodRow[]; }
export interface PeriodView { period: PeriodKey; closed: boolean; sections: PeriodSection[]; }

// src/components/balanceView.ts
export interface SaldoPar { actual: number; budget: number }
export interface BalanceSummary { resultado: SaldoPar; disponible: SaldoPar; reservado: SaldoPar; total: SaldoPar }

// src/components/mobile/screenStack.ts
export type Screen =
  | { view: "registrar" }
  | { view: "presupuesto"; detail: null }
  | { view: "presupuesto"; detail: { kind: "leaf"; id: string } }
  | { view: "presupuesto"; detail: { kind: "edit"; leafId: string; movementId: string } }
  | { view: "presupuesto"; detail: { kind: "retiros" } }
  | { view: "presupuesto"; detail: { kind: "balance" } };
```

**Codificación de `Screen` en la URL** (misma ruta `/`, mismo origen):

| Pantalla | Query |
|---|---|
| Registrar | *(sin parámetros)* |
| Lista del periodo | `?v=p` |
| Categoría o alcancía | `?v=p&d=leaf&id=<nodeId>` |
| Editar movimiento | `?v=p&d=edit&id=<nodeId>&m=<movementId>` |
| Retiros del mes | `?v=p&d=retiros` |
| Balance | `?v=p&d=balance` |

El periodo NO va en la URL: vive en `period` del store, como en escritorio, y así se conserva al cambiar de vista
(FR-3101).

## API Design

**Contrato de red preservado.** Ninguna ruta de `/api/v1` ni de `/api/auth` cambia: mismas rutas, mismos métodos,
mismos esquemas Zod, mismos códigos (`422 closed_period_violation`, `409` por revisión obsoleta, `403` por origen).
La vista móvil no hace ningún `fetch` propio; todo pasa por las acciones del store.

**API interna nueva (firmas exportadas)**

```ts
// src/domain/periodView.ts
/** Lista de un periodo en el orden de la grilla. `closed` sale de `isClosed(closureOf(state), period)`. */
export function periodView(state: LedgerState, period: PeriodKey): PeriodView;

// src/domain/tree.ts  (NUEVO: el orden que hoy está privado en BudgetGrid.buildRows/pushNode)
export const TYPE_ORDER: readonly NodeType[];        // ["income", "expense", "transfer"]
export function orderedGroups(nodes: LedgerNode[], type: NodeType): LedgerNode[];     // level "group", por `order`
export function orderedChildren(nodes: LedgerNode[], parentId: string): LedgerNode[]; // childrenOf(...) por `order`

// src/components/balanceView.ts  (las tres primeras se MUEVEN desde BalanceModule.tsx, sin cambiar su cuerpo)
export function reserveFlows(state: LedgerState, periods: readonly PeriodKey[]): ReserveFlows;
export function balanceRowValue(m: MonthBalance, key: RowKey, flows: { aportes: number; retiros: number }): number;
export function balanceColor(spec: RowSpec, value: number): string;      // neutro; alerta solo si spec.alarms y < 0
export function zeroIsAnswer(spec: RowSpec, value: number): boolean;     // resultado en 0 ⇒ «0», no «—»
export function balanceSummary(series: BalanceSeries, period: PeriodKey, flows: ReserveFlows): BalanceSummary;

// src/domain/movementEditVerdict.ts  (extraído de MovementEditor.tsx; usa tipos de src/domain/adjust.ts)
export interface MovementDraft { amount: string; note: string; date: string; target: string }
export type EditVerdict =
  | { kind: "invalid"; reason: "amount" | "note" | "date" | "closed_target" }  // Guardar deshabilitado + texto
  | { kind: "delete"; dry: DeleteMovementResult }           // monto 0: ensayo del borrado (puede venir rechazado)
  | { kind: "edit"; dry: EditResult; patch: MovementPatch; movesTo: PeriodKey | null };  // movesTo ⇒ «Pasará a …»
export function movementEditVerdict(
  state: LedgerState, movement: Movement, draft: MovementDraft, cal: Calendar, periods: readonly PeriodKey[]
): EditVerdict;
// «Sin cambios» NO es parte del veredicto: escritorio no tiene esa regla. La calcula solo la pantalla móvil,
// comparando el borrador con los valores con que se abrió.

// src/components/mobile/screenStack.ts
export function useScreen(): Screen;                 // useSyncExternalStore sobre location.search
export function openScreen(next: Screen): void;      // history.pushState + aviso a los suscriptores
export function replaceScreen(next: Screen): void;   // history.replaceState (enlaces rotos, redirecciones)
export function goBack(): void;                      // history.back() si la entrada anterior es de la app; si no, replaceScreen al padre
export function parseScreen(search: string): Screen; // puro; entrada no confiable ⇒ siempre un Screen válido

// src/components/mobile/useHoldReveal.ts
export function useHoldReveal(): { shown: boolean; hint: boolean; bind: HoldHandlers };
```

**Ids de prueba nuevos (contrato con la fase 3):** `mb-nav`, `mb-budget`, `mb-period-bar`, `mb-period-prev`,
`mb-period-next`, `mb-period-select`, `mb-closed-notice`, `mb-summary`, `mb-summary-eye`, `mb-summary-toggle`,
`mb-saldo-<clave>`, `mb-section-<tipo>`, `mb-group`, `mb-row`, `mb-row-actual`, `mb-row-budget`, `mb-bar`,
`mb-title`, `mb-leaf`, `mb-amount-card-<plano>`, `mb-amount-edit`, `mb-mov-row`, `mb-mov-edit`, `mb-edit-form`, `mb-edit-save`,
`mb-edit-amount`, `mb-edit-note`, `mb-edit-date`, `mb-edit-category`, `mb-edit-delete`, `mb-confirm-delete`, `mb-retiros`, `mb-retiro-row`, `mb-balance`, `mb-balance-row`, `mb-back`.
Los ids de escritorio (`budget-grid`, `balance-module`, `cell-leaf`, `detail-row`…) NO se usan en móvil (ADR-06).

## Implementation Approach

FR-3101: En el teléfono se pasa del registro al presupuesto y de vuelta
Method: `screenStack` como fuente única, con `useSyncExternalStore` suscrito a `popstate` y a un evento propio que
`openScreen` emite tras `history.pushState`. Cada entrada que apila la app lleva `history.state = { mb: n }`, con
`n` la profundidad dentro de la app. `MobileShell` deja `Register` siempre montado y monta `MobileBudget` la
primera vez que se visita «Presupuesto»; desde ahí queda montado y se alterna `hidden` (ADR-05). Cambiar de vista
con el segmentado usa `replaceScreen` (no apila); abrir un detalle usa `openScreen` (apila). «‹» llama a `goBack()`:
si `history.state.mb > 0` hace `history.back()`; si no (enlace directo o recarga), hace `replaceScreen` al padre.
Scroll: el shell conserva su contenedor `overflow-y-auto`; `MobileBudget` guarda `scrollTop` de la lista al abrir
un detalle y lo restaura en un `useLayoutEffect` al volver. El `h1` de Registrar conserva `data-testid="page-title"`;
el de Presupuesto usa `mb-title`, así nunca hay dos `page-title`.
I/O: `location.search` → `Screen` vía `parseScreen`. `openScreen(Screen)` → URL de la tabla de arriba.
Failure: parámetros desconocidos o un `id` que no existe en `state.nodes` ⇒ `replaceScreen` a la lista del periodo
(o a Registrar si falta `v`); nunca pantalla en blanco. Un enlace directo a `d=edit` busca el movimiento: si existe,
fija el periodo con `setPeriod` al de `movement.period`; si no, cae a la lista. Volver de Configuración aterriza en
Registrar, como hoy (`router.push("/")`).

FR-3102: La vista de presupuesto muestra un periodo a la vez, con selector
Method: `PeriodBar` lee `period` del store (ya vale el periodo actual tras la hidratación, `nowFor`) y la lista
`useActivePeriods()`; ‹ › hacen `setPeriod({mode:"month", month: periods[i±1]})`; el selector es el `Select` de
`ui/select` con `withRange(cal, p)` como rótulo y un candado si `isClosed(closure, p)`. Si `period.mode` es
`"year"` (el usuario estaba en modo Año en escritorio y la ventana bajó de 761 px en la misma sesión), la vista
usa `useNow()` y normaliza a mes.
I/O: `(periods: PeriodKey[], period: PeriodFilter)` → periodo mostrado; salida `setPeriod`.
Failure: periodo del store fuera de `periods` (cambió el horizonte) ⇒ cae al periodo actual. En los extremos el
botón correspondiente queda `disabled`.

FR-3103: El presupuesto del periodo se lee por categoría, plegable, con el color de escritorio
Method: `periodView(state, period)` arma las secciones en el orden de la grilla: tipos en `TYPE_ORDER` (ingresos,
gastos, reservas), grupos con `orderedGroups` e hijos con `orderedChildren`, ambos por el campo `order`. Lee cada
cifra de `rollupTable(state, [period])` (la misma tabla de BL-009). Para hojas `transfer` la cifra es
`budgets/actuals[leaf][period]` (el aporte, como `ReserveLeafCell`); la fila «Retiros del mes» toma
`reserveRetiros(state, period, plane)` y su tono sale de `budgetState(planeado, real)`, como `WithdrawCell`. En las
demás filas `tone`/`glyph` salen de `cellTone`/`cellGlyph`.
`progress = budget > 0 ? min(actual / budget, 1) : (actual > 0 ? 1 : 0)`.
I/O: `(LedgerState, PeriodKey)` → `PeriodView`. Componentes: `BudgetSections` pinta sin calcular.
Failure: periodo sin datos ⇒ filas con 0, que la UI pinta «—» y barra vacía. Árbol vacío ⇒ secciones sin grupos y
un texto «Aún no hay categorías. Se crean desde el computador».

FR-3104: El teléfono muestra las mismas cifras que escritorio
Method: no hay aritmética en `src/components/mobile/`. `periodView` y `balanceView` solo componen funciones que
escritorio ya usa. Un test de dominio compara `periodView` celda a celda contra `rollupTable` y `typeTotals`, y un
e2e de paridad compara lo pintado a 375 px contra la grilla a 1440 px sobre el mismo libro. Un guardia de
arquitectura (test de fuente) falla si un archivo de `src/components/mobile/` importa de `src/domain/rollup` algo
distinto de tipos, o contiene `reduce(`/sumas sobre montos.
I/O: mismos datos ⇒ mismas cifras, por construcción.
Failure: cualquier divergencia hace caer el test de paridad (es el guardrail del producto).

FR-3105: Desde el teléfono se cambia lo planeado de una categoría
Method: `AmountEditCard` con `parsePesos` y `amountInputError` (`src/lib/money`), los mismos del registro. Al
guardar llama `setLeafAmount(leafId, period, "budget", value)`, la acción de la grilla. Verificado en el código:
escritorio no aplica ninguna regla extra a esta edición (solo que sea hoja y que el periodo esté abierto, y ambas
cosas las decide la UI), así que el móvil no se salta nada.
I/O: texto del campo → entero COP ≥ 0 → `setLeafAmount` (devuelve `void`). Solo se ofrece si `row.leaf && type !==
"transfer" && !closed`.
Failure: `amountInputError` trata el vacío como válido y `parsePesos("")` da 0, así que la tarjeta añade su propia
regla: campo vacío ⇒ «Guardar» deshabilitado (para poner cero hay que escribir 0). Texto inválido ⇒ «Guardar»
deshabilitado y el mensaje de `amountInputError`. Cancelar o Escape restaura la cifra. Rechazo del servidor ⇒
resync + `StorageBanner` (comportamiento vigente).

FR-3106: Tocar una categoría muestra sus movimientos del periodo
Method: `LeafScreen` llama `cellDetail(state, leafId, period, periods, "actual")` y pinta sus entradas en el orden
que devuelve (`auto`, `movement`, `adjustment`, `tecleado`, `comment`), con `displayAmount` del dominio y `dayLabel`
(mudado a `src/components/format.ts` para no importar el componente de escritorio).
I/O: `DetailEntry[]` → filas `mb-mov-row`. El lápiz aparece solo en `movement` y `adjustment` de hojas no
`transfer` y con el periodo abierto.
Failure: sin entradas ⇒ estado vacío con «Ir a Registrar» (`replaceScreen({view:"registrar"})`). Hoja inexistente
⇒ vuelve a la lista (ver FR-3101).

FR-3107: Desde el teléfono se edita un movimiento
Method: `MovementEditScreen` compone `AmountDisplay` (con `signed` si el movimiento es un ajuste), `CategoryRow`,
`DateTimeField`, `NoteField` y `SaveButton` (con `label="Guardar cambios"`), todos con `testId` propio `mb-edit-*`
para no duplicar los ids del registro montado (ADR-03). El borrador se inicia igual que escritorio (fecha:
`movement.date ?? firstDayOf(period)` a mediodía; categoría: `catSubOf(movement.target)`). En cada cambio calcula
`movementEditVerdict(...)`. «Sin cambios» lo decide la pantalla comparando con el borrador inicial. Guardar llama
`store.editMovement(id, verdict.patch)`.
I/O: `MovementDraft` → `EditVerdict`. `edit` con `dry` aceptado ⇒ botón habilitado y, si `movesTo`, el aviso
«Pasará a <periodLabel>».
Failure: `invalid` ⇒ botón deshabilitado con texto (`closed_target`: «ese mes está cerrado»). `dry` rechazado, o un
resultado fallido de la acción al guardar ⇒ mensaje bajo el botón con los textos de escritorio; campos intactos.
Movimiento borrado en otro dispositivo (`not_found`) ⇒ `goBack()` con toast.

FR-3108: Desde el teléfono se borra un movimiento
Method: confirmación en el sitio; al confirmar, `store.deleteMovement(id)`. Monto 0 produce el veredicto `delete`,
que trae el ensayo del borrado: el botón pasa a «Borrar movimiento» y usa el mismo camino.
I/O: `id` → resultado de la acción.
Failure: ensayo o resultado rechazado (`negative_cell`, `closed`) ⇒ se muestra el motivo con `textoBorradoNegativo`
y no se borra. Cancelar no llama nada.

FR-3109: Desde el teléfono se cambia lo aportado a una alcancía
Method: `LeafScreen` en modo alcancía usa dos `AmountEditCard`, una por plano, cuyo `onSave` llama
`store.applyReserveEdit(leafId, period, plane, value)`. Bajo el campo se muestra el cupo con `cellHeadroom`, como
el editor de escritorio (FR-1808). `cellHeadroom` es de solo lectura y queda en la lista blanca del guardia de
NFR-3105.
I/O: `(leafId, period, plane, entero)` → `ReserveEditResult`.
Failure: `rejected === "invalid_target"` ⇒ «Operación inválida». Veredicto de regla ⇒ franja con
`blockMessage(data, verdict, { editedMonth: period, attempted: value, maxTotal: headroom })`, los mismos argumentos
de `ReserveCellEditor`, para que el texto sea el de escritorio («Esta celda admite hasta $X este mes»). La cifra no
cambia y el campo conserva lo escrito. Campo vacío ⇒ «Guardar» deshabilitado; 0 es válido (quita el aporte).

FR-3110: La fila «Retiros del mes» abre los retiros del periodo para corregirlos o borrarlos
Method: `WithdrawalsScreen` lista `monthReserveOps(state, period)`, la misma lista de `WithdrawCell`. Esa lista
trae toda operación que sale de una alcancía: retiros a Disponible y también movimientos entre alcancías. Cada fila
pinta `labelOfEnd(from) → labelOfEnd(to)`, como `OpRow`; los movimientos entre alcancías se ven pero no suman a la
cifra de Ejec. (`reserveRetiros` cuenta solo los que van a Disponible). Corregir: campo en la fila y
`store.editReserveOp(id, amount)`. Borrar: confirmación y `store.editReserveOp(id, 0)`, que es lo que hace
escritorio y tiene la guarda de periodo cerrado. No se usa `removeReserveWithdrawal` (no tiene llamadores ni esa
guarda). No hay formulario de alta: el estado vacío enlaza a Registrar.
I/O: `Movement[]` → filas `mb-retiro-row`; la acción devuelve `{ok:true}` o `{ok:false; rejected}`.
Failure: `rejected === "invalid_target"` ⇒ «Operación inválida»; veredicto ⇒ `blockMessage` bajo la fila, nada
cambia. Periodo cerrado ⇒ sin lápiz ni papelera.

FR-3111: Desde el teléfono se ve el Balance del periodo
Method: `BalanceScreen` calcula la serie como `BalanceModule`:
`computeBalanceSeries(data, scope, openingCarry(data, scope))`, memoizada por identidad de `data`. Recorre `BLOCKS`
y `ROWS` de `balanceRows.ts` y obtiene cada valor con `balanceRowValue(balanceAt(series, period)[plane], key, reserveFlows(...)[period][plane])`.
El color sale de `balanceColor(spec, value)` y el «0 contra —» de `zeroIsAnswer`, las mismas funciones que usa
`BalanceModule` tras la mudanza.
I/O: `(LedgerState, scope, period)` → filas `{label, op, actual, budget}`.
Failure: periodo sin datos ⇒ ceros; las filas resultado pintan «0» y las de insumo «—», como escritorio.

FR-3112: Un periodo cerrado se mira pero no se cambia desde el teléfono
Method: `closed = isClosed(closureOf(state), period)` viaja en `PeriodView` y por props. Con `closed`, no se
montan «Cambiar», lápices, papeleras ni confirmaciones; se monta `ClosedNotice`. Si el periodo se cierra con
`MovementEditScreen` abierta (SSE), un efecto hace `goBack()`. El servidor sigue siendo la autoridad
(`closedPeriodsViolated` ⇒ 422).
I/O: `closed: boolean` → controles ausentes del DOM.
Failure: una escritura que llegue igual al servidor responde 422; el store resincroniza y el `StorageBanner` avisa.

FR-3113: FR-010 cambia: en el teléfono hay registro y presupuesto; el dashboard sigue siendo de escritorio
Method: `ShellSwitch` y el breakpoint no se tocan. `MobileShell` no importa `BudgetGrid`, `BalanceModule`,
`Dashboard` ni `DesktopShell` (lo verifica un test de fuente), así que siguen fuera del DOM en móvil.
I/O: ancho ≤760 ⇒ `MobileShell` con dos vistas; >760 ⇒ `DesktopShell` sin cambios.
Failure: n/a. Las pruebas existentes se tratan según ADR-06 y la lista de Risk Analysis.

FR-3114: La vista de presupuesto cabe en el teléfono y se toca con el dedo
Method: layout en flujo normal del documento con `min-w-0` y `truncate` en nombres, cifras en `tabular` con
`whitespace-nowrap`, alturas con `--control-md`/`--control-lg`. Regla de escalón: una clase utilitaria por longitud
de la cifra formateada (`≤10` caracteres ⇒ tamaño base; `>10` ⇒ un escalón menos), como `fontSizeForDisplay`.
I/O: longitud de la cifra → clase de tamaño.
Failure: nombre largo ⇒ «…»; nunca desborde horizontal (lo comprueba el e2e con `scrollWidth === clientWidth`).

FR-3115: Resumen de saldos del periodo: pequeño, plegable y con los valores protegidos
Method: `SummaryCard` recibe `balanceSummary(series, period)`. Estado local `open` (false al montar). `useHoldReveal`
da `shown`: `pointerdown` ⇒ true y `setPointerCapture`; `pointerup`, `pointercancel`, `lostpointercapture`,
`blur` de ventana y `visibilitychange` ⇒ false; `keydown` de Espacio/Enter (sin `repeat`) ⇒ true y `keyup` ⇒ false;
`contextmenu` ⇒ `preventDefault`. Si la presión dura menos de 300 ms, `hint` vale true durante 2 s («Mantén
presionado para ver»). Con `shown === false` el componente renderiza el literal «$ ••••••» y NO el número (ADR-04).
CSS del botón: `user-select:none; -webkit-touch-callout:none; touch-action:none`.
I/O: `BalanceSummary` + `shown` → texto de cada saldo. `aria-label` del botón: «Mantén presionado para ver los
saldos»; el valor oculto lleva `aria-label="oculto"`.
Failure: el dedo sale del botón o se cancela el puntero ⇒ se oculta. Sin datos ⇒ al revelar se ve «0» o «—» según
la regla de `balanceRows`.

**NFR → decisión de diseño**

| NFR | Decisión |
|---|---|
| NFR-3101 registro intacto | `Register.tsx` no se modifica. Sus piezas reciben solo props opcionales con el valor de hoy por defecto (ADR-03). El presupuesto no está en el DOM hasta la primera visita (ADR-05), así que las pruebas del registro ven el mismo DOM que hoy |
| NFR-3102 Config/tema/salir | Se quedan en el encabezado de `MobileShell`, común a las dos vistas |
| NFR-3103 escritorio intacto | Solo refactors mecánicos (mudar funciones del Balance, extraer el veredicto, exportar el orden, mudar `dayLabel`). Sin cambios de comportamiento; las suites de escritorio son el guardia |
| NFR-3104 breakpoint | `page.tsx` no se toca |
| NFR-3105 mismas reglas | La vista llama a las acciones del store; test de fuente que prohíbe importar funciones de validación de reservas o de cierre desde `src/components/mobile/`, salvo las de solo lectura: `isClosed`, `cellHeadroom`, `monthReserveOps`, `labelOfEnd` y los textos |
| NFR-3106 Balance idéntico | Las funciones se mueven con su cuerpo; test de serie contra fixtures capturados antes del cambio |
| NFR-3107 ≤150 ms | `rollupTable` sobre UN periodo; serie del Balance memoizada por identidad de `data` |
| NFR-3108 seguridad | No aplica (ver Security Design) |
| NFR-3109 observabilidad | No aplica: sin rutas ni procesos nuevos |
| NFR-3110 CI | Las specs nuevas siguen el patrón de archivo que ya recoge el workflow |

## Security Design

**No aplica como superficie nueva** (NFR-3108, razón de la fase 1): sin endpoints, sesiones, secretos ni entradas
nuevas en el servidor; el teléfono usa las mismas acciones y el mismo `/api/v1` autenticado y filtrado por dueño
que escritorio. Aun así, el diseño fija tres controles del lado del cliente:

- **Límite de confianza nuevo: la URL.** `?v`, `d`, `id` y `m` son entrada no confiable (un enlace pegado, el
  historial). `parseScreen` acepta solo los valores de la tabla; `id` y `m` se usan únicamente para BUSCAR en
  `state.nodes` y `state.movements` del propio usuario. Nunca viajan a un `fetch`, a `dangerouslySetInnerHTML` ni a
  un selector. Un id ajeno o inexistente no encuentra nada y cae a la lista.
- **Saldos protegidos (FR-3115).** Protege de miradas en la pantalla, no es un control de acceso: los datos ya
  están en memoria del cliente autenticado. Aun así, mientras están ocultos los dígitos no están en el DOM, así que
  no aparecen en capturas, lectores de pantalla ni en el texto copiable.
- **Autoridad del servidor.** Ocultar controles en un periodo cerrado es UX; la regla la aplica el servidor (422).
  Las mutaciones conservan cookie `SameSite`, allowlist de `Origin` y validación Zod (sin cambios).

## Performance & Scalability

- **Costo de la lista:** `rollupTable(state, [period])` es una pasada por los nodos para un solo periodo. Se
  memoiza por identidad de `data` y por periodo (`useMemo`), como el caché de la grilla.
- **Costo del Balance:** `computeBalanceSeries` recorre el rango activo (hasta ~36 periodos con horizonte 2). Se
  calcula una vez por `data` en `MobileBudget` y lo comparten `SummaryCard` y `BalanceScreen`.
- **Presupuesto:** NFR-3107 pide ≤150 ms al cambiar de periodo o editar, con la jerarquía semilla. Se mide en un
  test de dominio sobre `periodView` + `balanceSummary` (sin red).
- **Las dos vistas montadas (ADR-05):** el registro es un formulario; su costo de render oculto es despreciable y
  no se suscribe a nada que cambie al navegar el presupuesto, salvo `data`.
- **Red:** cada edición dispara el PUT del snapshot completo, como en escritorio (BL-017, fuera de alcance). El
  drenador vigente coalesce escrituras, así que una ráfaga de ediciones produce un guardado en vuelo y uno pendiente.
- **Sin límites nuevos de tamaño:** la lista no pagina; el árbol está acotado por la jerarquía del usuario.

## Deployment Architecture

**Modelo de despliegue: contenedor, sin cambios.** La misma imagen Docker (`next start`) detrás de Nginx en Ultron.
- Sin migraciones de base de datos y sin variables de entorno nuevas. El `next dev` del usuario en `:3100` sigue
  cargando durante el build de la feature.
- Ambientes: dev local (`:3100` + Postgres en Docker), CI (GitHub Actions: `test:run`, `test:e2e`, gates de
  calidad) y producción (Ultron). El despliegue lo corre el usuario y termina con `scripts/verificar-prod.sh`.
- Rama: `develop`, PR a `main` con merge commit (sin squash).

## Risk Analysis

**ADR-01: Cómo navegan las pantallas del móvil**
Context: FR-3101 exige que el «atrás» del navegador vuelva de un detalle a la lista, sin recargar ni rehidratar.
Option A: Rutas de Next (`/presupuesto`, `/presupuesto/[id]`) — URLs limpias y `Link` nativo; pero cada página
remonta `LoginGate`, que es el único punto de hidratación (ADR-06 de la raíz): rehidratar en cada navegación rompe
«sin nueva hidratación» y pierde lo escrito en el registro.
Option B: Estado en memoria, sin historial — lo más simple; pero «atrás» sacaría al usuario de la app.
Option C: Una sola página con `history.pushState` y parámetros de consulta, leídos con `useSyncExternalStore`.
Decision: C — cumple «atrás» sin remontar nada y permite recargar o compartir un detalle.
Consequences: la URL pasa a ser entrada no confiable (ver Security Design). Next 15 sincroniza su router con
`pushState` nativo, así que no hay conflicto; no se usa `useSearchParams` para no exigir un límite de `Suspense`.

**ADR-02: De dónde salen las cifras de la lista**
Context: FR-3104 y el guardrail prohíben que el teléfono difiera de escritorio.
Option A: Extraer de `BudgetGrid.tsx` su composición de filas a un selector común y hacer que la grilla lo use —
una sola fuente; pero reescribe el corazón de un componente de 1.073 líneas con 28 features encima (NFR-3103).
Option B: Un view-model puro nuevo (`periodView`) que lee de la MISMA `rollupTable` y las MISMAS `cellTone`/
`cellGlyph` que la grilla, sin tocarla, con paridad asegurada por pruebas.
Decision: B — la tabla de roll-ups ya es la fuente única de las cifras (BL-009); lo que se duplica es solo el
recorrido del árbol para pintar, no un cálculo.
Consequences: el orden de las filas se verifica con un test de paridad contra la grilla. Si algún día la grilla
cambia de orden, ese test avisa.

**ADR-03: El formulario para editar un movimiento**
Context: el usuario pidió evaluar si se aprovecha o se modifica el módulo de registrar; el UX spec eligió
reusarlo. NFR-3101 exige que registrar siga igual.
Option A: Añadir un modo `editing` a `Register.tsx` — un solo componente; pero mezcla dos flujos (alta con
overlay y reinicio; edición con ensayo y borrado) en un componente que tiene estado de reservas, propuestas de
ciclo y temporizadores, y todo cambio ahí arriesga el registro.
Option B: Adaptar `MovementEditor` de escritorio — reusa la lógica; pero es una fila compacta para popover y
teclado, y a 375 px habría que rediseñarla entera.
Option C: Pantalla nueva compuesta con las MISMAS piezas del registro, con el ensayo extraído de `MovementEditor`
a una función pura.
Decision: C — el usuario ve el formulario de Registrar, `Register.tsx` no se toca y el ensayo queda en un solo
sitio para escritorio y móvil.
Consequences: las piezas no sirven tal cual, así que reciben props OPCIONALES: `SaveButton` tiene el rótulo y el
id fijos; `NoteField` tiene `id="note"` fijo (dos en el DOM romperían la etiqueta); `AmountDisplay` no muestra ni
acepta negativos, y un ajuste puede serlo. Con los valores por defecto, el registro queda idéntico; lo comprueban
sus pruebas vigentes y un test que monta cada pieza sin las props nuevas. `MovementEditor` pasa a consumir
`movementEditVerdict` sin cambiar su comportamiento: el veredicto no incluye «sin cambios», que escritorio no tiene.

**ADR-04: Cómo se protegen los saldos del resumen**
Context: FR-3115 pide que los valores no se vean hasta mantener presionado el ojo.
Option A: Ocultar con CSS (`filter: blur`, color transparente) — trivial; pero los dígitos siguen en el DOM:
salen en capturas con el inspector, en lectores de pantalla y al seleccionar texto.
Option B: No renderizar la cifra mientras `shown` es falso; pintar un literal fijo.
Decision: B.
Consequences: el ancho de la tarjeta no delata la magnitud (el literal siempre mide lo mismo). El test puede
afirmar que el texto de la tarjeta no contiene dígitos.

**ADR-05: Conservar lo escrito al cambiar de vista**
Context: FR-3101 pide que el registro conserve su contenido y el presupuesto su periodo y sus grupos desplegados.
Varias pruebas vigentes del registro recorren TODO el DOM del shell móvil (TC-UXC-306h cuenta `.eyebrow` y espera
cero; TC-BSC-451f busca colores de alerta en cualquier descendiente).
Option A: Desmontar la vista inactiva y subir su estado al store — el DOM queda mínimo; pero obliga a mover el
estado interno de `Register.tsx` (diez `useState`) al store, que es justo lo que NFR-3101 quiere evitar.
Option B: Montar siempre las dos vistas y alternar `hidden` — simple; pero el presupuesto oculto mete `.eyebrow` y
tonos de alerta en el DOM desde el arranque y rompe esas pruebas.
Option C: `Register` siempre montado; `MobileBudget` se monta la primera vez que se visita y queda montado.
Decision: C.
Consequences: al abrir la app el DOM es el de hoy. Tras visitar el presupuesto, la vista inactiva existe oculta;
las pruebas nuevas usan visibilidad, no solo presencia.

**ADR-06: Ids de prueba y las pruebas que afirman «en móvil no hay grilla»**
Context: unas 15 pruebas e2e afirman que a 375 px no existen `budget-grid`, `balance-module`, `cell-leaf` ni
`detail-row`.
Option A: Reusar esos ids en la vista móvil — las pruebas caen y hay que reescribirlas todas.
Option B: Ids propios `mb-*`; los componentes de escritorio siguen sin montarse en móvil.
Decision: B — la afirmación «el componente de escritorio no se monta en móvil» sigue siendo cierta y útil
(FR-3113).
Consequences: con ids propios y el montaje perezoso (ADR-05), las 14 pruebas que afirman la ausencia de la grilla,
el Balance o el Detalle a 375/760 px siguen en verde, pero varias por una razón más estrecha que la que su título
declara («solo Registrar», «no hay Detalle»). La fase 3 las revisa una por una y deja escrito qué hace con cada
una; ninguna se borra ni se salta (la suite prohíbe `skip`):
- Se reescribe la intención (el enunciado quedó falso): TC-010h, TC-010f, TC-SUT-257e, TC-213f, TC-FDC-026e,
  TC-UXC-306h («en móvil no queda ningún eyebrow»: pasa a afirmarlo solo de la vista Registrar) y TC-BSC-451f
  («tokens de estado exclusivos de la grilla»: pasa a afirmarlo de Registrar).
- Se conservan con el título ajustado a lo que de verdad comprueban (el componente de escritorio no se monta):
  TC-213h, TC-TDF-045f, TC-CDP-046e, TC-SDB-045e, TC-BAL-904f, TC-BAL-955e, TC-RSP-041f, TC-RSP-042e, TC-MSI-025e.
- Dependen de un único `page-title` visible a 375 px y siguen igual: `coverage-skips.spec.ts:62`,
  `ux-consistency.spec.ts:143` y `:236`, TC-DDC-172e.

**Riesgos principales**
1. **Mantener presionado en Safari de iPhone** puede abrir el menú del sistema, seleccionar texto o cancelar el
   puntero al mover el dedo. Mitigación: CSS del botón, `setPointerCapture`, `contextmenu` anulado y prueba manual
   en un iPhone real antes de cerrar la feature (TC manual).
2. **Regresión en escritorio por los dos refactors** (`BalanceModule`, `MovementEditor`). Mitigación: mover sin
   reescribir, fixtures de la serie del Balance capturados antes, y las suites de `balance`, `techo-de-flujo` y
   `diario-de-celda` como guardia. Se prueba en rojo con un worktree del commit anterior.
3. **Divergencia de cifras** entre superficies. Mitigación: ADR-02 y los tests de paridad.
4. **Pruebas viejas que pasan por la razón equivocada** tras el cambio de alcance de FR-010. Mitigación: ADR-06.
5. **Ediciones en red móvil lenta**: el guardado es optimista y un fallo se ve tarde. Mitigación: `StorageBanner`
   vigente en las dos vistas; sin cambio de modelo (BL-017 fuera de alcance).

**Failure Blast Radius**

Component: API `/api/v1` o PostgreSQL caídos
Blast radius: no se guarda ninguna edición del teléfono ni del computador; la lectura sigue con lo ya cargado.
User impact: la cifra cambia en pantalla (optimista) y el `StorageBanner` avisa que el guardado no se confirmó.
Recovery: el drenador reintenta con el siguiente cambio; al volver el servicio, `resync` deja el estado del servidor.

Component: Sesión (Better Auth) vencida
Blast radius: toda mutación responde 401.
User impact: `LoginGate` vuelve a pedir el acceso; lo no guardado se pierde, como hoy.
Recovery: iniciar sesión; la URL conserva la pantalla y `parseScreen` la restaura.

Component: SSE (`/api/v1/sync/stream`)
Blast radius: el teléfono no se entera de cambios hechos en el computador (p. ej. un cierre de mes).
User impact: cifras o controles desactualizados hasta recargar; una edición sobre un periodo ya cerrado recibe 422.
Recovery: reconexión automática del stream vigente; el 422 dispara resync.

Component: `screenStack` (URL/historial)
Blast radius: solo la navegación del móvil.
User impact: con un enlace roto o un id borrado, se abre la lista del periodo en vez del detalle.
Recovery: automática (`replaceScreen`); no hay estado persistido que reparar.

**Traceability Checklist**
- [x] Cada FR (FR-3101…FR-3115) tiene componente y entrada en Implementation Approach.
- [x] Cada NFR (NFR-3101…NFR-3110) tiene decisión en la tabla NFR → diseño.
- [x] Los seis ADR evalúan ≥2 opciones.
- [x] no_go_zone respetado: sin dashboard en móvil, sin gestión de categorías, sin cerrar/reabrir, sin pantalla
      para sacar o planear retiros, sin teclear el Ejecutado, sin escribir comentarios, sin alta desde la lista, sin
      cambios en Configuración, sin escritura incremental, sin protección de cifras fuera del resumen.
- [x] Failure Blast Radius para cuatro componentes.
- [x] Technical Risk Flags completo.

## Technical Risk Flags

[RISK] Mantener presionado en navegadores móviles
Conflict: FR-3115 requiere revelar solo mientras dura la presión, pero Safari iOS trata la pulsación larga como
gesto del sistema (menú contextual, selección, lupa) y puede cancelar el puntero.
Mitigation: `touch-action:none`, `-webkit-touch-callout:none`, `user-select:none`, captura del puntero y
`preventDefault` en `contextmenu`; ocultar ante `pointercancel`. Verificación manual en iPhone real, porque
Playwright (Chromium/WebKit de escritorio) no reproduce ese gesto del sistema.
Severity: medium

[RISK] Historial del navegador dentro de una página de Next
Conflict: FR-3101 requiere «atrás» sin rehidratar, pero el App Router de Next 15 intercepta `history` para su
propio estado.
Mitigation: Next ≥14.1 soporta `pushState`/`replaceState` nativos y sincroniza su router; la ruta no cambia (solo
la consulta), así que no hay petición RSC ni remonte. Un e2e cuenta las llamadas a `GET /api/v1/ledger` durante la
navegación y exige que no aumenten.
Severity: low

[RISK] Guardado por snapshot completo desde redes móviles
Conflict: NFR-3107 pide respuesta inmediata, pero cada edición envía el libro entero (`saveLedger`, BL-017).
Mitigation: la respuesta inmediata es local (optimista) y no depende de la red; la coalescencia vigente evita
colas. El costo de red no se reduce en esta feature (decisión de alcance).
Severity: low

[RISK] Refactor de componentes de escritorio con muchas pruebas encima
Conflict: NFR-3103 y NFR-3106 exigen que escritorio no cambie, pero el diseño mueve dos funciones de
`BalanceModule` y extrae el veredicto de `MovementEditor`.
Mitigation: cambios mecánicos, sin tocar firmas públicas de los componentes; fixtures previos y suites vigentes.
Severity: medium
