# Technical Design Document (TRD / SDD) — ciclos

## Executive Summary

**La decisión que gobierna todo lo demás: la clave de periodo NO cambia.** Hoy el dinero se indexa por
`PeriodKey = "YYYY-MM"` en 25 ficheros de `src/` (`budgets[hoja][periodo]`, `closedThrough`,
`startMonth`, `activeRange`, las series de balance y de reservas). El usuario decidió en discovery que
un ciclo se nombra por el **mes en que termina** («Septiembre · 21 ago – 20 sep»). Esa decisión, que
parecía cosmética, es la que hace la feature construible en un incremento: **un ciclo ES una clave
`YYYY-MM` con un rango de fechas distinto detrás.** Nada de lo que se indexa por clave se toca; lo único
que cambia es (1) cómo una FECHA se convierte en clave, (2) cómo una clave se rotula, (3) cuál es la
clave «de hoy» y (4) la lista de claves que se pintan. Las cuatro cosas se concentran en un módulo
puro nuevo, `src/domain/cycles.ts`, que expone un **`Calendar`**; en modo «Mes a mes» ese calendario es
`MONTH_CALENDAR`, cuyas funciones son las de hoy — así NFR-2401 (modo mes idéntico) se cumple por
construcción y no por disciplina.

Stack: el vigente, sin dependencias nuevas. **Next.js 15.1 App Router** (rutas `/api/v1/*` con
`withApi`), **React 19**, **Zustand 5** (store + selectores), **TypeScript 5** (dominio puro),
**Drizzle ORM 0.45 + postgres 3.4** sobre **PostgreSQL** (migración `0007_ciclos.sql`), **Zod 3.24**
en el borde, **Better Auth 1.6** para la sesión, **Vitest 3** y **Playwright 1.50** para las pruebas.
Todo el cálculo de fechas se hace con aritmética de `Date` en UTC sobre cadenas `YYYY-MM-DD`; no se
añade `date-fns` ni similar: el calendario necesita cuatro operaciones (días del mes, sumar días,
comparar, bisiesto) y una dependencia por eso es deuda, no ayuda.

**North Star (project_summary):** con día 21, los 27 movimientos del usuario caen en una sola columna
«Septiembre» con su salario. **Guardrail:** modo mes byte a byte idéntico; sumas idénticas al reubicar.

Lo que este diseño decide y por qué, en cinco líneas:
1. Clave de periodo conservada; calendario puro por encima (ADR-01).
2. El ciclo de transición recibe una clave con sufijo, `"2026-10t"`, que ordena entre `2026-10` y
   `2026-11` sin tocar la comparación de cadenas (ADR-02).
3. La configuración vive en su propia tabla append-only de versiones, NO dentro del snapshot que el
   cliente reemplaza con `PUT /api/v1/ledger`; el snapshot solo la LEE y el modo vigente se DERIVA de
   la última versión — sin columna denormalizada que pueda divergir (ADR-03).
4. La previsualización la calcula el servidor con la misma función pura que luego aplica: lo que se
   ve es lo que se hace (ADR-04).
5. La reubicación es una transacción con `SELECT … FOR UPDATE` sobre `ledger`, sube `revision` y
   publica por SSE, igual que el cierre y el saldo inicial (ADR-05).
6. **El Ejecutado se descompone antes de reubicar.** `actuals[hoja][periodo]` es un almacén MIXTO:
   lo teclea el usuario en «Ejec.» y lo incrementa cada movimiento (`mutations.ts:96`,
   `reserve.ts:1145`). Reubicar «la celda» entera M→M+1 mientras los movimientos van por fecha
   dejaría sumas idénticas y dinero en la columna equivocada (hallazgo 1 de la revisión adversarial
   del 2026-09-10). Por eso `relocate` separa cada celda en **residuo tecleado + Σ aportes de
   movimientos**, mueve el residuo como dato sin día y cada aporte con su movimiento (ADR-06).
7. **El dato sin día sigue al ejecutado de su rubro y recuerda de dónde vino (re-derivación
   2026-09-10).** Aplicada sobre el ledger real, la regla original —todo dato sin día de M va al ciclo
   M+1— separó el presupuesto del ejecutado: el usuario presupuesta en M lo que paga a principios de M
   con el salario del 21 anterior. `placeDateless` decide el ciclo de cada dato sin día por su rubro en
   tres casos (movimientos del mes → costumbre del rubro → mismo nombre), y cada parte movida queda
   anotada en `relocation_origin` con su mes, para que la vuelta a mes a mes sea exacta aunque varios
   meses se hayan sumado en una celda (ADR-07).

Este documento incorpora las correcciones de una revisión adversarial independiente (2026-09-10,
12 hallazgos, todos verificados contra el código): inventario completo de la aritmética de meses
(FLAG-1), descomposición del Ejecutado (ADR-06), séptimo CHECK (`closure_event`), `normalizeClosure`
y `reopenMonth` con calendario, `PERIOD_KEY` real en `domain/validation.ts`, reloj del servidor por
zona horaria (FLAG-2), versiones ordenadas por secuencia, contrato único de bloqueo, y el camino de
vuelta de `startMonth` (FR-2410). La re-derivación del 2026-09-10 pasó una segunda revisión adversarial (8 hallazgos, incorporados): residuo negativo en la memoria, `restoreParts` por fila, `negative_cell`, mes de inicio vacío, celdas en 0, contexto de la vuelta, y alcance de la identidad; el de fusiones al cambiar de día se descartó porque ninguna clave desaparece (18.910 cambios de día probados con el calendario real).

## System Architecture

```
┌──────────────────────────────── Browser ──────────────────────────────────┐
│  /configuracion (page.tsx)            /  DesktopShell · MobileShell         │
│  ┌──────────────────────────┐         ┌──────────────────────────────────┐  │
│  │ Sección «Periodo del     │         │ BudgetGrid (cabecera 2 líneas)   │  │
│  │ presupuesto» (A0–A10)    │         │ Selector «Mes» (nombre · rango)  │  │
│  │  previewPeriodMode()     │         │ Register (línea Ciclo, D2)       │  │
│  │  applyPeriodMode()       │         │ ClosureControl/HistoryPanel      │  │
│  └────────────┬─────────────┘         └───────────────┬──────────────────┘  │
│               │ acciones                              │ selectores           │
│  ┌────────────▼──────────────────────────────────────▼──────────────────┐   │
│  │ useLedgerStore (Zustand)                                             │   │
│  │  data.cycles?: CycleConfig   ← llega en el snapshot (solo lectura)   │   │
│  │  useCalendar()  = buildCalendar(data.cycles)  [memo por config]      │   │
│  │  periodsFor()   = calendar.keys(from,to)      (antes periodRange)    │   │
│  │  hoy            = calendar.periodForDate(todayISO())                 │   │
│  └────────────┬─────────────────────────────────────────────────────────┘   │
│               │                                                             │
│  ┌────────────▼─────────────┐   ┌────────────────────────────────────────┐  │
│  │ domain/cycles.ts (puro)  │   │ domain/* existente (rollup, balance,   │  │
│  │  Calendar · MONTH_CALENDAR│  │ closure, reserve, range, mutations)    │  │
│  │  buildCalendar · relocate │◄──│ SIN CAMBIOS de lógica: reciben la      │  │
│  │  proposeOpeningCycle      │   │ lista de claves y la clave «hoy»       │  │
│  │  isValidMovementPeriod    │   │ desde fuera, como ya hacen             │  │
│  └────────────┬─────────────┘   └────────────────────────────────────────┘  │
│               │ ServerRepository.previewCycles / applyCycles (fetch JSON)    │
└───────────────┼─────────────────────────────────────────────────────────────┘
                │ cookie SameSite + Origin allowlist (withApi)
┌───────────────▼─────────────────────────────────────────────────────────────┐
│ Servidor Next.js                                                             │
│  POST /api/v1/ledger/cycles/preview  → cyclesRepo.previewFor  (misma pura)   │
│  PUT  /api/v1/ledger/cycles          → cyclesRepo.applyFor    (tx + revision)│
│  GET  /api/v1/ledger                 → snapshot + cycles (lectura)           │
│  POST /api/v1/movements              → + isValidMovementPeriod(calendar)     │
│  POST /api/v1/closure                → currentPeriod = calendar del dueño    │
│  PUT  /api/v1/ledger                 → valida periodos contra el calendario  │
│  syncHub.publish({revision})         → los otros dispositivos re-cargan      │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │ Drizzle (transacción, FOR UPDATE sobre ledger)
┌───────────────▼─────────────────────────────────────────────────────────────┐
│ PostgreSQL                                                                   │
│  cycle_config_version (append-only, seq)     ← versiones = modo + historial │
│  amount_cell / movement / cell_note / closure_event / ledger.*: CHECK de     │
│  periodo relajado para admitir la clave de transición «YYYY-MMt»            │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Componentes y responsabilidad (solo lo nuevo o lo que cambia):**
- **`domain/cycles.ts`** — el único sitio que sabe qué es un ciclo. Exporta el tipo `Calendar` y
  su implementación para ambos modos, el constructor desde la configuración versionada, la
  reubicación pura en las dos direcciones (sobre la descomposición residuo + aportes, ADR-06), la
  regla del ingreso adelantado y el validador de periodo de un movimiento. Sin efectos, sin reloj: recibe `todayISO` como argumento (mismo criterio que
  ADR-02 de multi-anio: el dominio no lee la fecha).
- **`lib/date.ts`** — sigue siendo EL RELOJ. Gana `todayISO()` (`YYYY-MM-DD` local) y
  `currentPeriodFor(calendar)`; `currentPeriod()` se conserva y equivale a
  `currentPeriodFor(MONTH_CALENDAR)`. Los 14 sitios que hoy llaman `currentPeriod()` pasan a la
  variante con calendario (lista completa en Implementation Approach, FR-2407).
- **`state/store.ts`** — `data.cycles` viaja en el snapshot; `useCalendar()` memoiza el calendario
  por identidad de `data.cycles`; `periodsFor` construye la lista con `calendar.keys`; dos acciones
  nuevas (`previewPeriodMode`, `applyPeriodMode`) que NO mutan el estado local hasta que el servidor
  confirma (mismo patrón que `setStart`: un rechazo no deja la interfaz afirmando algo que no pasó).
- **`server/data/cyclesRepo.ts`** — `previewFor` y `applyFor`. `applyFor` es la única escritura:
  transacción, `FOR UPDATE` sobre `ledger`, `baseRevision`, inserta la versión, **reescribe el estado
  completo reubicado** (celdas con montos nuevos, claves de movimientos y notas,
  `ledger.start_month/closed_through/reopened_period`) y sube `revision`. `loadLedger` gana la
  lectura de `cycle_config_version` para poblar `cycles`, y `serverScope`/`unionScope`
  (`ledgerRepo.ts:510-525`) construyen su rango con el calendario del dueño, no con `periodRange`.
- **`server/schemas.ts`** — `cyclesTargetSchema` (Zod). El `PERIOD_KEY` real vive en
  `src/domain/validation.ts:19` (`.max(7)` + regex): pasa a `.max(8)` con `t?`; la defensa fuerte no
  es la regex sino la pertenencia a `calendar.keys`, que el servidor comprueba en cada escritura.
- **Rutas** — dos nuevas bajo `/api/v1/ledger/cycles`; tres existentes ganan una validación.
- **UI** — la sección de Configuración (spec UX A0–A10), la cabecera de `BudgetGrid` (B1/B2), el
  `SelectItem` del selector «Mes» (C1), `Register` (D1/D2), `ClosureControl`/`ClosureHistoryPanel`
  (E1/E2), `Dashboard` (F1). Ningún componente base nuevo.

**Patrón de interacción:** el de la raíz (cliente-servidor, UI optimista para lo que ya era optimista).
La reubicación y el cambio de versión NO son optimistas: pasan por previsualización, el servidor
aplica en transacción y el cliente recarga el snapshot con la nueva `revision` (como `closeMonth`).

**Desviaciones del estándar padre:** ninguna de patrón. Una de convención, justificada: la clave de
transición extiende el formato `PeriodKey` (ADR-02); se limita a un sufijo de un carácter para que la
comparación de cadenas, `periodYear` y `periodMonth` sigan funcionando sin cambios.

## Data Model

### Contrato de preservación — lo que NO puede cambiar
- **`amount_cell(owner_id, node_id, period, kind, amount)`**, **`movement(… period, date …)`**,
  **`cell_note`**: mismas columnas, mismos índices, misma semántica. Un ledger en modo mes se lee y se
  escribe byte a byte igual (NFR-2401, NFR-2406).
- **`ledger.revision`** sigue siendo el lock optimista de todo lo que cambia cifras; **`data_version`**
  no se toca (mismo criterio que 0005 y 0006: marca el modelo de las celdas, no esto).
- **`ledger.closed_through`, `reopened_period`, `start_month`, `opening_balance`** conservan tipo y
  CHECKs de valor; solo el patrón de formato se amplía (abajo). **No se añade ninguna columna a
  `ledger`**: el modo se deriva de la última versión.
- **`user.horizon`** intacto: el horizonte sigue siendo preferencia de presentación.
- **`closure_event`** conserva filas y columnas (append-only, audit); solo su CHECK de formato se
  amplía, porque cerrar una transición inserta `period:"2026-10t"` (`ledgerRepo.ts:692`). Sus filas
  antiguas conservan las claves con que se escribieron: es historia, no se reescribe.
- **El snapshot `LedgerState`** conserva todos sus campos; gana uno opcional.

### El delta

**Tipos de dominio (`src/domain/types.ts`, aditivo):**
```ts
export type PeriodMode = "month" | "cycle";
export type EndOfMonthPolicy = "last_day" | "shift";
export interface CycleVersion {
  seq: number;                    // orden de creación (bigserial); la última fila es la vigente
  mode: PeriodMode;               // "month" = vuelta a mes a mes (fila de historial)
  anchorDay: number | null;       // 1..31 en "cycle"; null en "month"
  eomPolicy: EndOfMonthPolicy | null;
  effectiveFrom: string;          // "YYYY-MM-DD": día en que la versión entró en vigor (lo que A5/A10 muestran)
  firstPay: string | null;        // "YYYY-MM-DD": PRIMER PAGO bajo esta versión (RF-09a). null en la
                                  // primera activación (el calendario cubre todo el historial) y en "month"
  restoreStartMonth: PeriodKey | null; // startMonth ANTES de activar; lo usa la vuelta a mes (FR-2410)
  createdAt: string;              // ISO, informativo
}
export interface CycleConfig { mode: PeriodMode; versions: CycleVersion[] } // orden: seq asc; mode = última.mode
// LedgerState: cycles?: CycleConfig   ← ausente ≡ { mode:"month", versions:[] } ≡ hoy
export interface OriginPart {                 // ADR-07 — una fila de relocation_origin
  subject: "budget" | "actual" | "movement" | "note";
  ref: string;                                // leafId (budget/actual) · movement.id · note.id
  period: PeriodKey;                          // clave donde vive HOY
  originPeriod: PeriodKey;                    // mes calendario del que vino (sin sufijo)
  amount: number;                             // parte de la celda; 0 en movement/note
}
// LedgerState: origins?: OriginPart[]        ← SOLO servidor (GET no la expone); ausente ≡ sin memoria
```

**`PeriodKey` (sin cambio de tipo, cambio de gramática):** `^[0-9]{4}-(0[1-9]|1[0-2])t?$`.
**Regla de clave del ciclo de transición (revisión adversarial de la fase 3, hallazgo 5):** como
cualquier ciclo, la transición se nombra por el **mes en que TERMINA**; solo cuando esa clave ya la
ocupa el ciclo anterior (la transición termina en el mismo mes que el ciclo que la precede) recibe el
sufijo `t`. Ejemplos con último pago viejo el 21-oct: 21→30 con primer pago 30-oct ⇒ transición
21–29 oct termina en octubre, clave ocupada por «Octubre» (21 sep–20 oct) ⇒ `"2026-10t"`; 21→5 con
primer pago 5-nov ⇒ transición 21 oct–4 nov termina en noviembre ⇒ clave `"2026-11"` (marcada
transición), y el ciclo 5 nov–4 dic es `"2026-12"`. Así ningún mes pierde su clave mientras la
transición dure menos de un mes. **Ninguna clave desaparece:** como `lastPay` es el último ancla de la versión vigente anterior a `firstPayDate`, la transición nunca dura más que un ciclo viejo y toma la clave del mes en que termina, o esa clave con `t`. Con primer pago el 5-dic el 21-nov sigue siendo pago viejo: «Noviembre» (21 oct–20 nov) se conserva y la transición es 21 nov–4 dic = `"2026-12"`. En el caso 21→5 con primer pago 5-nov la transición 21 oct–4 nov toma `"2026-11"` y las celdas de `"2026-11"` se quedan en `"2026-11"`. Verificado sobre 18.910 cambios de día válidos con el calendario real: ninguna clave desaparece (TC-CIC-150e y TC-CIC-178e). **`lastPay`** = el último ancla de la versión vigente estrictamente anterior a
`firstPayDate`; `firstPayDate ≤ lastPay` es `first_pay_invalid`. Hoy `isPeriodKey` exige `length === 7` (`periods.ts:46`) y `periodYear`/`periodMonth` devuelven `NaN`
a través de él: **se relajan** a longitud 7 u 8 con `t?`; los slices 0–4 y 5–7 ya funcionan con el
sufijo. `comparePeriods` (comparación de cadenas) la ordena correctamente:
`"2026-10" < "2026-10t" < "2026-11"`. `addMonths` **rechaza** (lanza) una clave con sufijo en vez de
perderlo en silencio — y por eso las rutas que prometen «nunca lanzar» la protegen: `normalizeClosure`
no hace aritmética (arriba), `activeBounds` reduce una cota con sufijo a su mes (`monthOf("2026-10t") =
"2026-10"`) antes de `periodOf`/`periodRange` (la lista `calendar.keys(from,to)` sigue incluyendo la
transición porque cae entre `2026-10` y `2026-11`), y `oldestPeriodWithData`/`newestPeriodWithData`
solo comparan cadenas; `periodRange`, `monthsBetween`, `isYearStart`, `periodOf` siguen siendo aritmética
de meses puros y solo se llaman desde `periods.ts`, `range.ts` (cotas) y `cycles.ts`. En modo ciclos la
lista y la vecindad las da SIEMPRE el calendario (`calendar.keys`, `next`, `prev`). Consecuencia
asumida: en modo mes una clave con sufijo que llegara del exterior pasaría `isPeriodKey`; no puede
persistirse porque el servidor exige pertenencia a `MONTH_CALENDAR.keys` (`period_mismatch`).

**Tabla nueva `cycle_config_version` (append-only):**
```sql
CREATE TABLE IF NOT EXISTS cycle_config_version (
  id                  bigserial PRIMARY KEY,                 -- = seq: el orden es el de creación
  owner_id            text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  mode                text NOT NULL CHECK (mode IN ('month','cycle')),
  anchor_day          integer      CHECK (anchor_day IS NULL OR anchor_day BETWEEN 1 AND 31),
  eom_policy          text         CHECK (eom_policy IS NULL OR eom_policy IN ('last_day','shift')),
  effective_from      date NOT NULL,                         -- día en que entró en vigor (A5/A10)
  first_pay           date,                                  -- primer pago bajo la versión; NULL en la 1.ª activación y en 'month'
  restore_start_month text CHECK (restore_start_month IS NULL OR restore_start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cycle_cfg_shape_ck CHECK (
    (mode = 'cycle' AND anchor_day IS NOT NULL AND eom_policy IS NOT NULL) OR
    (mode = 'month' AND anchor_day IS NULL AND eom_policy IS NULL AND first_pay IS NULL))
);
CREATE INDEX IF NOT EXISTS cycle_cfg_owner_id_idx ON cycle_config_version(owner_id, id);
```
Es a la vez el modo vigente (`mode` de la última fila por `id`; sin filas = `month`), la
configuración vigente, el histórico (RF-07) y el historial que NFR-2410 pide (A10: una fila por
versión, más recientes arriba, y al final una fila SINTETIZADA «Mes a mes · hasta <effective_from de
la primera versión>» que representa el estado previo a la primera activación; con cero versiones la
lista está vacía y A10 muestra su estado vacío). No se borra ni se
edita: cambiar es INSERTAR (RF-08). **Sin `UNIQUE (owner_id, effective_from)`**: activar, volver y
activar el mismo día son tres filas legítimas con la misma fecha; el orden lo da `id`.

**Ninguna columna nueva en `ledger`.** Una columna `period_mode` denormalizada sería una segunda
fuente de verdad sin CHECK cruzado posible; `loadLedger` hace una consulta indexada más por dueño
(≤ decenas de filas) y deriva el modo. Es una decisión de la revisión adversarial (hallazgo 12).

**Tabla nueva `relocation_origin` (migración `drizzle/0008_ciclos_origen.sql`) — la memoria de origen (ADR-07):**
```sql
CREATE TABLE IF NOT EXISTS relocation_origin (
  owner_id      text   NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  subject       text   NOT NULL CHECK (subject IN ('budget','actual','movement','note')),
  ref           text   NOT NULL,                                                  -- node_id · movement.id · cell_note.id
  period        text   NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])t?$'),  -- clave donde vive hoy
  origin_period text   NOT NULL CHECK (origin_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount        bigint NOT NULL DEFAULT 0,                                         -- con signo solo en 'actual' (residuo, ADR-06)
  PRIMARY KEY (owner_id, subject, ref, period, origin_period),
  CONSTRAINT relocation_origin_amount_ck CHECK (subject = 'actual' OR amount >= 0)
);
```
- **Se escribe solo al activar** (mes → ciclos): una fila por cada celda, movimiento sin fecha y nota que existía antes de activar —celda de Presupuestado, residuo tecleado del Ejecutado aunque valga 0, movimiento sin fecha, nota—, **también cuando no cambia de clave ni junta meses**. Sin eso la vuelta no es exacta: un gasto del 25-ago sin presupuesto de agosto más un
  presupuesto de septiembre pagado el 3-sep devolvería ese presupuesto a agosto (AC-2443). Una celda
  que junta agosto y septiembre tiene dos filas con sus montos.
- **Cambiar el día de pago** (ciclos → ciclos) no la toca: ningún cambio de día hace desaparecer una clave (ver «Ninguna clave desaparece»), así que ninguna celda cambia de clave ni se junta con otra (AC-2448).
- **Volver a mes** (ciclos → mes) la consume y la borra entera en la misma transacción.
- **Sin FK** a `amount_cell`, `movement` ni `cell_note`: las escrituras del snapshot (`insertSnapshot`,
  `applyCyclesFor`) borran y reinsertan esas filas, y una FK en cascada borraría la memoria en cada
  guardado. Una fila cuya celda ya no existe se lee como celda en 0.
- `PUT /api/v1/ledger` no la lee ni la escribe (como `cycles`, ADR-03) y `GET` no la devuelve: el
  cliente nunca reubica. `loadStateInTx` la adjunta como `LedgerState.origins` solo en el servidor.
- **La memoria se construye DENTRO de `relocate`** (`next.origins`): la previsualización ejecuta las mismas
  validaciones que la escritura, y un residuo negativo se detecta antes de intentar insertar.
- **Vuelta de una celda con memoria** (`restoreParts`, FR-2410), por fila. **Presupuestado:** V es el valor
  actual de la celda y las partes p1…pn van por mes ascendente; D = V − Σp; si D ≥ 0, pn recibe D; si
  D < 0 se descuenta de pn, luego de pn−1, hacia atrás, sin partes negativas; lo devuelto suma V
  (AC-2442, AC-2444). **Ejecutado:** la memoria guarda RESIDUOS con signo (ADR-06); V es el residuo
  actual, es decir, el valor de la celda menos Σ deltas de sus movimientos; D = V − Σp va a pn. El
  límite no es la parte sino la celda reconstruida: cada mes devuelto vale pₘ + deltasₘ, con los deltas
  de los movimientos que vuelven a ese mes por fecha, y debe quedar ≥ 0; por eso pₘ ≥ −deltasₘ y lo
  que no cabe baja al mes anterior (AC-2445). Si ni el mes más antiguo lo absorbe, `negative_cell`.
  Un movimiento sin fecha o una nota vuelven a su `origin_period`. Una fila de memoria cuya celda ya
  no existe, porque el usuario la borró, no recrea nada.
- **Celdas en 0:** una celda existente con monto 0 se conserva al reubicar y su parte se anota con
  `amount = 0`; al volver, toda parte con memoria reconstruye su fila aunque valga 0. `relocate` solo
  limpia los ceros que ella misma crea al restar (AC-2433: el ledger del usuario tiene cinco).

**CHECKs de formato relajados (siete)** en `amount_cell.period`, `movement.period`, `cell_note.period`
(migración 0002), `ledger.closed_through`, `ledger.reopened_period`, **`closure_event.period`**
(migración 0004) y `ledger.start_month` (0006): `~ '^[0-9]{4}-(0[1-9]|1[0-2])t?$'`. Puramente
ampliatorio: toda fila existente sigue cumpliendo.

**Migración `drizzle/0007_ciclos.sql`:** en transacción, idempotente por `IF NOT EXISTS` /
`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` (criterio de 0005/0006), sin backfill: un ledger previo
queda sin versiones (= modo mes) y se comporta igual que antes (NFR-2406). Reversible: soltar la
tabla y devolver los siete CHECKs al patrón sin `t?` (solo posible si no existen claves con sufijo; la
reversión documenta esa condición).

**Reglas de datos (invariantes que el servidor impone en `applyFor`):**
- Una versión `cycle` con `first_pay` exige `first_pay >` último pago de la versión vigente y fuera de
  todo periodo cerrado (FR-2408 negativo). La primera activación lleva `first_pay = NULL`.
- Tras cualquier reubicación, DENTRO de la transacción: (i) `Σ amount_cell.amount` por `kind` y
  `Σ movement.amount` idénticos al antes; (ii) por cada hoja, `Σ` de sus celdas idéntica; (iii) toda
  clave de `amount_cell`/`movement`/`cell_note` pertenece a `calendar.keys` (RV-01/RV-02); (iv) por
  cada movimiento con fecha, `period === periodForDate(date)` o la excepción de FR-2406; **(v) ninguna
  alcancía queda con saldo derivado negativo en ningún periodo** (FR-1007, piso): un retiro fechado
  puede adelantarse al aporte tecleado que lo financiaba (el aporte es dato sin día y va al ciclo que decide `placeDateless`; el retiro va por fecha), y las sumas no lo ven. Si algo falla, `ROLLBACK` con `relocation_invariant`
  y `detail: { rule: "keys_in_calendar" | "period_matches_date" | "sums" | "leaf_sums" |
  "reserve_floor" | "negative_cell", ids?: string[], leafId?: string, period?: PeriodKey }` (FR-2404 atomicidad); la
  previsualización devuelve el mismo bloqueo, así el usuario ve QUÉ alcancía y en qué ciclo antes de
  intentar. (i) no basta solo: (ii)–(v) son los que detectan «sumas iguales, columna equivocada». **(vi) Ninguna celda queda negativa** (`amount_cell_amount_ck`): con la regla nueva un residuo negativo
  (Ejecutado tecleado por debajo de sus movimientos) puede caer en un ciclo con menos movimientos que
  con la regla anterior. Si pasa, `relocation_invariant` con `rule: "negative_cell"`, `leafId` y
  `period`; la UI traduce `leafId` al NOMBRE del rubro y pinta el texto literal de A9 (AC-2447).

## API Design

### Contrato preservado
- `GET /api/v1/ledger` → snapshot como hoy **más** `cycles?: CycleConfig` (ausente en modo mes para
  que el JSON de un ledger previo sea idéntico).
- `PUT /api/v1/ledger` (snapshot-replace) → **ignora** cualquier campo `cycles` del cuerpo (ADR-03) y
  gana una validación: en modo ciclos, cada movimiento con `date` debe cumplir
  `isValidMovementPeriod(calendar, mv)` y cada clave de celda/movimiento/nota debe estar en
  `calendar.keys` → si no, `422 { error: { code: "period_mismatch", detail: { ids } } }`.
- `POST /api/v1/movements` → misma validación por movimiento (`period_mismatch`).
- `POST /api/v1/closure` → `closeMonthFor(userId, baseRevision, currentPeriodFor(calendarDelDueño))`.
- `PUT /api/v1/ledger/start`, `/preferences/horizon`, `/closure/events`, `/sync/stream`: sin cambios.
- Códigos ya existentes que se reutilizan, tal como `withApi` (`server/http.ts:118`) y las rutas los
  emiten hoy: **cuerpo inválido según Zod ⇒ `422 { error:{ code:"invalid_payload" } }`** (NO 400),
  `401 unauthorized`, `403 origin_not_allowed`, `409 revision_conflict`, `422 closed_period_violation`;
  cierre: `POST /api/v1/closure` cierra y **`DELETE /api/v1/closure` reabre**, con rechazos
  `422 not_closable { detail:{ closable:null } }` y `422 not_reopenable { detail:{ reason:
  "nothing_closed"|"already_reopened" } }` (`closure/route.ts:20-22`). `period_mismatch` lleva
  `detail: { ids?: string[], expected?: PeriodKey }` (`ids` en `PUT /ledger`, `expected` en
  `POST /movements`).

### Endpoints nuevos (ambos `withApi({ auth:"required", mutation:true })`)

**`POST /api/v1/ledger/cycles/preview`** — calcula, no escribe.
```
Request  { target: { mode:"month" }
                 | { mode:"cycle", anchorDay:1..31, eomPolicy:"last_day"|"shift", firstPayDate?:"YYYY-MM-DD" } }
Response 200 {
  cycles: [ { key:"2026-09", label:"Septiembre 2026", start:"2026-08-21", end:"2026-09-20",
              transition:false, current:true }, … 6 elementos desde el ciclo actual ],
  relocation: { cellsMoved:15, movementsMoved:27, movementsKeyChanged:10, mergedCells:3,
                cellsSumBefore:114523000, cellsSumAfter:114523000,
                movementsSumBefore:…, movementsSumAfter:…, identical:true,
                historyStart:"2026-09", note:"Cada presupuesto queda en el mismo ciclo que lo que pagaste de ese rubro. …" },
}
Response 422 { error:{ code:"closed_period"|"first_pay_required"|"first_pay_invalid"|"no_change",
                       detail?:{ period?:"2026-09", lastPay?:"2026-10-21" } } }   ← MISMO contrato que apply
Errors   422 invalid_payload (Zod) · 401 · 403
```
`mergedCells` cuenta las celdas de dato sin día que juntan dos o más meses (al volver, las que se separan). La UI pinta «N celdas cambian de columna · M movimientos cambian de ciclo · K celdas juntan dos meses · Totales idénticos ✓» con `cellsMoved`, `movementsKeyChanged` y `mergedCells`, y omite el segmento de fusiones cuando vale 0 (UX A6b). Sobre el ledger del usuario: 15 · 10 · 3 (AC-2409).
`firstPayDate` es obligatorio cuando ya hay una versión `cycle` vigente y cambia `anchorDay` o
`eomPolicy` (FR-2408, RF-09a); en la primera activación se ignora (`first_pay = NULL`: el calendario
cubre todo el historial) y `effective_from` es la fecha de activación. Un bloqueo se responde con `422`
y el mismo `code` en `preview` y en `apply`: un solo contrato, la UI lo pinta en A9 en ambos casos.

**`PUT /api/v1/ledger/cycles`** — aplica.
```
Request  { baseRevision:number, target: <igual que preview> }
Response 200 { revision:number, cycles: CycleConfig }
         409 { error:{ code:"revision_conflict" }, revision }
         422 { error:{ code: "closed_period"|"first_pay_required"|"first_pay_invalid"|"no_change"
                             |"relocation_invariant", detail } }     ← los cuatro primeros, idénticos a preview
Errors   422 invalid_payload (Zod) · 401 · 403
```
Tras `200` el servidor `syncHub.publish(userId, { revision })` y el cliente hace `resync` (recarga el
snapshot), como tras `closure`. La respuesta NO trae el snapshot reubicado: es grande y el cliente ya
sabe recargarlo.

### Superficie interna nueva (`src/domain/cycles.ts`)
```ts
export interface Calendar {
  readonly mode: PeriodMode;
  keys(from: PeriodKey, to: PeriodKey): PeriodKey[];         // lista contigua, incluye transiciones
  next(p: PeriodKey): PeriodKey;  prev(p: PeriodKey): PeriodKey;
  periodForDate(isoDate: string): PeriodKey;                  // RF-10; fecha inválida → throw en dominio, el borde la filtra antes
  rangeOf(p: PeriodKey): { start: string; end: string } | null; // null en modo mes (sin rango que mostrar)
  isTransition(p: PeriodKey): boolean;
  rangeLabel(p: PeriodKey): string | null;                    // "21 ago – 20 sep" | null en mes
  containsToday(p: PeriodKey, todayISO: string): boolean;
}
export const MONTH_CALENDAR: Calendar;                          // = comportamiento actual
export function buildCalendar(cfg: CycleConfig | undefined, bounds: { from: string; to: string }): Calendar;
export function relocate(state: LedgerState, from: Calendar, to: Calendar, todayISO: string):
  { state: LedgerState; summary: RelocationSummary } | { blocked: "closed_period" | "no_change" };
  // lee state.origins al volver a mes y devuelve next.origins al activar; al cambiar de día no la toca (ADR-07)
export function placementContext(state: LedgerState, cycleCal: Calendar, direction: "activate" | "return"): PlacementContext;
  // una pasada O(movimientos). cycleOf(mv): al activar, cycleCal.periodForDate(date); al volver, mv.period (así
  // cuenta el ingreso contado en el ciclo que abre, FR-2406). Por hoja: Σ deltas por (mes de la fecha, cycleOf) y costumbre
export function placeDateless(ctx: PlacementContext, leafId: string, month: PeriodKey): PeriodKey;
  // FR-2404: (1) ciclo con mayor suma de los movimientos de la hoja fechados en `month`, empate al más antiguo;
  // (2) costumbre de la hoja; (3) ciclo del mismo nombre
export function returnDateless(ctx: PlacementContext, leafId: string, cycleKey: PeriodKey): PeriodKey;
  // FR-2410: los tres casos al revés, SOLO para lo que no tiene memoria (creado ya en ciclos)
export function restoreParts(value: number, parts: Array<{ month: PeriodKey; amount: number }>): Array<{ month: PeriodKey; amount: number }>;
  // FR-2410: la diferencia al mes más reciente; una reducción mayor sigue hacia atrás; Σ = value
export function planVersionChange(cfg: CycleConfig, target: CycleTarget, closedThrough: PeriodKey | null, lastPay: string):
  { cfg: CycleConfig } | { blocked: "first_pay_required" | "first_pay_invalid" };
export function proposeOpeningCycle(cal: Calendar, type: NodeType, isoDate: string): PeriodKey | null; // FR-2406
export function isValidMovementPeriod(cal: Calendar, mv: Pick<Movement,"type"|"date"|"period">): boolean;
export function transitionKey(monthKey: PeriodKey): PeriodKey;   // "2026-10" → "2026-10t"
// ADR-06 — la descomposición del Ejecutado:
export function movementDeltas(mv: Movement): Array<{ leafId: string; delta: number }>;
  // exactamente el efecto que addMovement (mutations.ts:96) / applyReserveOp (reserve.ts:1128-1146)
  // tuvieron sobre `actuals` al registrar `mv`; verificado por test de propiedad (FLAG-6)
export function reassignMovementPeriod(state: LedgerState, movementId: string, period: PeriodKey): LedgerState;
  // primitiva de relocate: resta los deltas del periodo viejo, los suma al nuevo, cambia mv.period
// range.ts (aditivo, sin cambiar activeRange):
export function activeBounds(state, currentPeriod, horizon): { from: PeriodKey; to: PeriodKey };
export function activeKeys(state, calendar, currentPeriod, horizon): PeriodKey[]; // = calendar.keys(activeBounds)
// closure.ts — la relación «reopened = siguiente de closedThrough» se IMPONE al escribir y se
// VERIFICA en el borde (donde hay calendario); normalizeClosure deja de re-validarla aguas abajo:
export function normalizeClosure(v: unknown): Closure;
  // solo FORMA (isPeriodKey de ambos, reopened exige closedThrough); NUNCA lanza; si alguna clave lleva
  // sufijo no hace aritmética de meses (hallazgo A). Los 8 llamadores internos siguen igual.
export function checkClosureNeighbors(c: Closure, next: (p: PeriodKey) => PeriodKey): Closure;
  // el borde (closureFromRow en el servidor, hydrate en el cliente) la llama con calendar.next y degrada
  // reopened a null si no es el siguiente — el mismo efecto que hoy tiene normalizeClosure, una sola vez
export function closeMonth(state, currentPeriod, range): CloseResult;                 // sin cambio
export function reopenMonth(state, range, prev: (p: PeriodKey) => PeriodKey = monthPrev): ReopenResult;
```
Las funciones son deterministas; `todayISO` entra como argumento. `buildCalendar` es O(n) en meses
del rango y produce una tabla ordenada de `{key,start,end}`; `periodForDate` es búsqueda binaria.
`activeRange` (`range.ts:86`) se conserva con su firma y su cuerpo (= `periodRange(activeBounds)`):
los TCs de FR-1903/1904/1906 no se tocan (NFR-2403); el store usa `activeKeys` en su lugar.

## Implementation Approach

**FR-2401 · Modo en Configuración.** *Método:* sección A0 en `app/configuracion/page.tsx` con el
radiogroup de A1 (mismo componente que el tema); el estado vigente sale de `data.cycles` (A5). Elegir
no persiste: habilita A2/A3/A7 y A4. La persistencia real es `applyPeriodMode` (FR-2404/FR-2410).
*I/O:* `data.cycles` → `{ mode, anchorDay, eomPolicy, effectiveFrom }` vigente; entrada de usuario →
`CycleTarget`. *Fallo:* día fuera de 1..31, decimal, vacío ⇒ `aria-invalid` + mensaje, A4 deshabilitado
(cliente); el mismo valor enviado a la API ⇒ `400 invalid_body` por Zod (`anchorDay: z.number().int().min(1).max(31)`),
sin efecto (NFR-2408). Ledger sin `cycles` ⇒ «Mes a mes» marcado y cero cambios (AC-2401, AC-2436).

**FR-2402 · Calendario.** *Método:* `buildCalendar` genera, por versión `cycle`, los inicios de ciclo:
para cada mes M del rango, `start = clampToMonth(M, anchorDay, eomPolicy)` (`last_day`: `min(día,
díasDelMes)`; `shift`: si `día > díasDelMes` → día 1 del mes siguiente); el ciclo que empieza en el
pago del mes M se llama `M+1` (mes en que termina); `end = next.start − 1 día`. Entre dos versiones,
el tramo `[lastPayVieja, firstPayNueva − 1]` es `transitionKey(mesDeLastPay)`. Contigüidad por
construcción: cada `end` se deriva del `start` siguiente. *I/O:* `CycleConfig + bounds` → tabla
`{key,start,end,transition}[]` ordenada. *Fallo:* `anchorDay` inválido o `effectiveFrom` no ISO ⇒
`buildCalendar` lanza `InvalidCycleConfig`; el borde (Zod) lo impide antes y el calendario anterior
sigue en memoria (AC-2408). Duración mínima 28 / máxima 31 en versiones estables; la transición puede
ser de 1 a 59 días y nunca 0: `planVersionChange` rechaza `firstPayDate ≤ lastPay` (RV-08).

**FR-2403 · Previsualización.** *Método:* `previewPeriodMode(target)` → `POST …/cycles/preview`; el
servidor carga el estado en transacción de solo lectura, construye ambos calendarios y llama a la
MISMA `relocate` que usará `applyFor` (ADR-04); responde `cycles` (6 desde el actual, con
`current`/`transition`) y `relocation`. La UI pinta A6; Confirmar solo aparece si `!blocked`. *I/O:*
`CycleTarget` → `PreviewResponse`. *Fallo:* red o 5xx ⇒ A9 «No pudimos calcular la previsualización.
Tus datos no cambiaron.» + Reintentar; `blocked` ⇒ A9 con el motivo; Cancelar ⇒ no hay petición de
escritura, el snapshot local no se tocó (AC-2410). Ledger vacío ⇒ `cellsMoved:0, movementsMoved:0`,
`identical:true` (AC-2411). El resumen de A6b usa `cellsMoved`, `movementsKeyChanged` y `mergedCells`: 15 · 10 · 3 sobre el ledger del usuario (AC-2409).

**FR-2404 · Activar reubica.** *Método:* `relocate(state, MONTH_CALENDAR, cycleCal, today)` en tres
pasos. **Paso 1, descomponer (ADR-06):** para cada hoja y periodo, `residuo[hoja][M] =
actuals[hoja][M] − Σ movementDeltas(mv)` sobre los movimientos con `period === M` que aportan a esa
hoja; `budgets` es todo residuo (nunca lo escribe un movimiento). **Paso 2, mover:** (a) residuos de
`budgets` y `actuals`, notas de celda y movimientos SIN `date` de la hoja R en el mes M: al ciclo
`placeDateless(ctx, R, M)`. (1) Si R tiene movimientos fechados en M, atribuidos por `movementDeltas`,
va al ciclo del calendario destino donde cae su mayor suma; empate, al más antiguo. (2) Si no, pero R
tiene movimientos fechados en otros meses, sigue su costumbre: un movimiento «cobra desde el día de pago» cuando el mes de su ciclo (`cycleOf(mv)`) es posterior al mes de su fecha; si la suma de esos supera a la del
resto, va al ciclo que abre el pago de M (nombrado M+1); si no, al ciclo del mismo nombre M. (3) Sin
movimientos fechados, al ciclo del mismo nombre M. Dos meses de R que caen en el mismo ciclo se SUMAN,
y cada parte movida se anota en `next.origins` con su mes (ADR-07). (b) movimientos CON `date`: `reassignMovementPeriod(…,
cycleCal.periodForDate(date))`, que lleva consigo sus deltas; (c) `closedThrough`/`reopenedPeriod`: al ciclo que abre el pago de su mes, porque no hay rubro que consultar (FLAG-3); (d) `startMonth` → el más antiguo entre la clave más antigua con datos tras mover, el ciclo del movimiento fechado más antiguo y, si el mes declarado no tenía ningún dato, el ciclo que abre su pago
(AC-2439) y la versión guarda `restoreStartMonth = startMonth` original; `openingBalance` no cambia.
**Paso 3, recomponer:** `actuals[hoja][K] = residuo movido + Σ deltas de los movimientos que quedaron
en K`. Caso real del usuario: presupuesto y Ejecutado de agosto (pagado del 21 al 29) y de septiembre (pagado del 1 al 8) quedan juntos en «Septiembre», con presupuesto igual al ejecutado en cada rubro; solo el presupuesto de septiembre del Salario, que siempre cobra el 21, va a «Octubre» (AC-2412). Parqueaderos, Restaurantes y Ropa juntan dos meses y guardan dos filas de memoria cada una (AC-2440). Invariantes (i)–(iv) del Data Model comprobados antes de escribir. Servidor: `applyFor` en
`db.transaction` con `FOR UPDATE` sobre `ledger`, `baseRevision`, `INSERT cycle_config_version`,
`UPDATE ledger SET start_month, closed_through, reopened_period, revision = revision+1`, y la
escritura del estado reubicado con el mismo mecanismo que `saveLedger` usa para un snapshot
(borrar-e-insertar por dueño dentro de la transacción; las celdas cambian de MONTO, no solo de clave,
así que un `UPDATE … SET period` no basta). *I/O:* `LedgerState + calendarios` → `LedgerState` nuevo
+ `RelocationSummary`. *Fallo:* excepción o invariante rota ⇒ `ROLLBACK`, `422 relocation_invariant`,
el ledger queda en modo mes intacto (AC-2414); `409` si otro dispositivo escribió entre preview y apply
(el usuario vuelve a previsualizar).

**FR-2405 · Asignación por fecha.** *Método:* `Register.tsx:60` cambia `periodKeyFromDate(date)` por
`calendar.periodForDate(date)` (en modo mes son la misma función); D1 se deriva del mismo valor. El
servidor añade `isValidMovementPeriod(calendar, mv)` en `POST /movements` y en `PUT /ledger`
(`period === periodForDate(date)` o la excepción de FR-2406). **El producto no tiene edición de movimientos** (journal inmutable en v1: `movements/[id]/route.ts:20`
responde 404 a PATCH/DELETE) y esta feature no la introduce. AC-2416 («editar la fecha … lo mueve de
Octubre a Noviembre») se realiza como propiedad del DOMINIO sobre la primitiva
`reassignMovementPeriod` — la misma que usa `relocate` — y la fase 3 la prueba a ese nivel (la
columna de origen baja el monto, la de destino lo sube), sin superficie de UI nueva. Se declara aquí
para que el revisor lo vea: si quiere edición de fecha en la interfaz, es una feature aparte.
*I/O:* `isoDate` → `PeriodKey`. *Fallo:* fecha fuera de `activeRange` ⇒ el cliente
deshabilita Guardar y D1 marca «Fuera del rango»; en el servidor `422 period_mismatch` (AC-2417). Sin
`date` en modo ciclos ⇒ `422` (`movementInputSchema` exige `date` cuando el dueño está en ciclos).

**FR-2406 · Ingreso adelantado (propuesta).** *Método:* `proposeOpeningCycle(cal, type, date)`
devuelve `next(periodForDate(date))` si `type==="income"` y `0 < startOf(next) − date ≤ 3 días`; si no,
`null`. `Register` monta D2 solo cuando devuelve clave; el radio «Mantener» está preseleccionado y el
movimiento se guarda con el `period` elegido. El servidor acepta ese periodo porque
`isValidMovementPeriod` incorpora exactamente la misma ventana (una sola función, dos bordes).
*I/O:* `(calendar, type, isoDate)` → `PeriodKey | null`. *Fallo:* gasto en la ventana o ingreso a 4
días ⇒ `null` (AC-2419); modo mes ⇒ `MONTH_CALENDAR` devuelve siempre `null` (AC-2421); el usuario no
toca nada ⇒ queda por fecha (AC-2420, AC-2438).

**FR-2407 · Nombre + rango.** *Método:* `calendar.rangeLabel(key)` (`null` en mes ⇒ nada que pintar,
por eso el modo mes queda idéntico). `BudgetGrid` B1/B2: cabecera de 52px cuando `rangeLabel !== null`,
`ArrowLeftRight` + «Transición» cuando `isTransition`. `DesktopShell` C1: `SelectItem` con
`periodLabel(p) + " · " + rangeLabel(p)`. `ClosureControl`/`ClosureHistoryPanel`: `title`/sufijo con
`rangeLabel`. `Dashboard` F1: título condicional; barras sin cambio. **La clave «hoy»** deja de ser
`currentPeriod()` en los 14 sitios medidos: `app/configuracion/page.tsx:73,109,247`,
`api/v1/closure/route.ts:30` (servidor: calendario del dueño y `todayISO(LEDGER_TZ)`, FLAG-2),
`state/store.ts:223,294,298,300,302,545,643,648,703,741,744`,
`components/DesktopShell.tsx:116`, `components/OpeningCard.tsx:55`; todos pasan a
`currentPeriodFor(calendar)`. `Register.tsx:60` es FR-2405. *I/O:* `PeriodKey` → `{ label, range|null,
transition, current }`. *Fallo:* clave que el calendario no conoce (dato corrupto) ⇒ `rangeOf` devuelve
`null` y la cabecera pinta solo el nombre: degradación visible, no excepción.

**FR-2408 · Cambio de versión.** *Método:* `planVersionChange` valida `firstPayDate` (obligatoria,
> `lastPay` de la versión vigente, no dentro de `closedThrough`) y produce el `CycleConfig` con la
versión añadida; `buildCalendar` deriva la transición; `relocate(state, calViejo, calNuevo, today)`
aplica la regla del dato sin día: **las claves de mes se conservan** (una celda de «Noviembre» sigue en
`2026-11`), la transición nace sin celdas, y solo los movimientos con `date ≥ effectiveFrom − duración
de la transición` se re-derivan por fecha; los ciclos con `end < firstPayDate` no cambian de rango
(RV-07 por construcción: sus filas no se tocan). *I/O:* `CycleTarget{anchorDay, eomPolicy,
firstPayDate}` → `CycleConfig` + calendario con transición. *Fallo:* `firstPayDate` ausente ⇒ A4
deshabilitado / `422 first_pay_required`; `≤ lastPay` o dentro de cerrado ⇒ `first_pay_invalid`
(AC-2427); balances anteriores comparados en el test de invariantes (NFR-2407). La memoria de origen no cambia: ningún cambio de día hace desaparecer una clave, así que ninguna celda cambia de clave (AC-2448).

**FR-2409 · Cierre sobre la frontera del ciclo.** *Método:* `nextClosable(state, currentPeriod, range)`
ya decide con «candidato ≤ hoy» sobre la lista que recibe; con `range = activeKeys(calendar)` y
`currentPeriod = currentPeriodFor(calendar)`, «terminado» pasa a significar «su fin ya pasó o contiene
hoy». `closure.ts` tiene **dos** sitios de aritmética de meses, no uno: `normalizeClosure`
(`closure.ts:54`, `reopened === addMonths(closedThrough,1)`: con la transición como reabierto anularía
`reopened` y su línea de base al cargar) y `reopenMonth` (`closure.ts:218`, `back = addMonths(target,−1)`:
saltaría la transición y dejaría dos periodos abiertos). `normalizeClosure` se llama desde ocho
funciones internas (`closureOf`, `isClosed`, `nextReopenable`, `downstreamImpact`,
`closedPeriodsViolated`, `unclosedEndedPeriods`, `closeMonth`, `reopenMonth`) que no tienen
calendario, así que parametrizarla no basta (re-verificación adversarial, hallazgo 3): **la relación
de vecindad sale de `normalizeClosure`**, que pasa a validar solo la forma y nunca lanza, y se impone
en dos sitios que sí tienen calendario: al ESCRIBIR (`reopenMonth` con `prev`, `closeMonth` no la
necesita) y en el BORDE al cargar (`checkClosureNeighbors(c, calendar.next)` en `closureFromRow` del
servidor y en `hydrate` del cliente), que degrada `reopened` a `null` si no es el siguiente — el mismo
efecto que hoy, una sola vez y con el calendario correcto. El servidor construye su rango con `calendar.keys(monthOf(oldest), monthOf(newest), extra)` en
`serverScope`/`unionScope` (`ledgerRepo.ts:510-525`) — sin horizonte, como hoy — y no con `periodRange`: si no, `closeMonthFor`
(`:677`) cerraría «Noviembre» saltándose la transición y `reserve.ts:165/1093` ignoraría toda reserva
en ella. `computeBalanceSeries` arrastra por posición en la lista: cruza año y transición sin
enterarse (AC-2432). *I/O:* sin cambio. *Fallo:* mismos rechazos y rastros de cierre-de-mes.

**FR-2410 · Volver a mes.** *Método:* `relocate(state, cycleCal, MONTH_CALENDAR, today)` inverso:
misma descomposición residuo + aportes (ADR-06); lo que tiene memoria (`state.origins`) vuelve parte por parte a su mes, con `restoreParts` para una celda editada; lo que no tiene memoria, porque se creó ya en ciclos, vuelve por `returnDateless` con el contexto del calendario de ciclos de origen: caso 1 por los movimientos cuyo `period` es esa clave, caso 2 por la costumbre con `cycleOf`, caso 3 al mes de `monthOf(clave)`, que también cubre las claves de transición; la memoria se borra en la misma transacción; las claves de transición sin memoria caen así en el caso 3, y lo que tiene memoria vuelve por ella; movimientos con fecha → mes calendario de la
fecha; **`startMonth` → `restoreStartMonth` de la versión de activación si ningún dato queda antes de
él, y si no, el mes calendario del dato más antiguo** — también cuando `restoreStartMonth` es null: un ledger sin mes de inicio declarado vuelve sin él (AC-2446), porque en una versión de activación `restore_start_month` NULL significa exactamente «no había inicio declarado» (hallazgo 6: `prev` a ciegas rompía la identidad
cuando la activación había tomado la rama del dato más antiguo); **`closedThrough !== null` ⇒
`blocked: "closed_period"`** (AC-2435). Ida y vuelta sin ediciones y sin ciclos cerrados ⇒ identidad (con uno cerrado la vuelta exige reabrir, y la reapertura ya deja rastro), verificada por test de propiedad
sobre el snapshot serializado (AC-2433). Se inserta una versión `mode:"month"` (historial); el modo vigente
pasa a ser `month` por ser la última fila. *I/O:* como FR-2404. *Fallo:* como FR-2404 (atomicidad, AC-2435 prevenido en
cliente y rechazado en servidor).

## Security Design

Frontera de confianza: **el cuerpo de cada petición** (Zod antes de tocar nada) y **la sesión** (Better
Auth, cookie `SameSite`); dentro del servidor, **`ownerId` de la sesión** es la única llave de datos —
ningún parámetro de la petición nombra a otro usuario.

- **NFR-2408 → controles:**
  - Autenticación: los dos endpoints nuevos usan `withApi({ auth:"required", mutation:true })`: sin
    sesión `401`; `Origin` fuera de la allowlist `403` (defensa en profundidad, como la raíz).
  - Alcance por dueño: `cyclesRepo.previewFor/applyFor(ownerId, …)` filtran por el `userId` de la
    sesión en cada `SELECT`/`UPDATE`/`INSERT`; no existe ruta que reciba un `ownerId`.
  - Validación en servidor: `cyclesTargetSchema` = `z.discriminatedUnion("mode", [ { mode:"month" },
    { mode:"cycle", anchorDay: z.number().int().min(1).max(31), eomPolicy: z.enum([...]),
    firstPayDate: z.string().regex(ISO_DATE).optional() } ])`; `baseRevision: z.number().int().min(0)`.
    Reglas de dominio (`firstPayDate` > último pago y fuera de cerrado; nada cerrado al volver a mes)
    en `planVersionChange`/`relocate`, ejecutadas en el servidor; CHECKs de base como tercera defensa
    (1..31, políticas, formato de clave). Lección de BG-002 respetada: el navegador solo previene.
  - Consistencia del periodo (RV-01/RV-02): `isValidMovementPeriod` en `POST /movements` y en
    `PUT /ledger`; un cliente que envíe un `period` incoherente con la fecha recibe `422`.
- **NFR-2401…2406 (regresión)**: no son controles de seguridad; se cubren en Performance y Risk.
- **Inyección / XSS:** Drizzle parametriza; la reescritura masiva de claves usa parámetros (`ANY($1)`)
  y nunca interpola claves en SQL. Los rótulos (`rangeLabel`) son cadenas construidas en dominio, no
  entrada del usuario, y React las escapa.
- **Cabeceras / TLS:** las de la raíz (Nginx), sin cambio.
- **Datos personales:** el día de pago y las fechas de pago son datos del usuario; viven en su fila y
  caen en `ON DELETE CASCADE` con la cuenta.

**Re-derivación 2026-09-10:** `relocation_origin` se lee y escribe siempre filtrada por el `owner_id` de la sesión dentro de la transacción de `applyFor`, igual que el resto del ledger; ninguna ruta la expone.

## Performance & Scalability

- **Cálculo del calendario:** una tabla de ≤ 40 entradas (rango activo de hasta 36 meses + transiciones)
  por configuración; se memoiza en el store por identidad de `data.cycles` y en el servidor por
  petición. `periodForDate` es búsqueda binaria: O(log n) por movimiento.
- **Guardarraíl de 150 ms (NFR-2409):** el recómputo de balance/rollup no gana barridos: recibe la
  misma lista de claves que hoy (una lista, no dos). Se mide con el escenario de referencia de
  meses-y-saldo-inicial (`tests/domain`), con el calendario de ciclos en lugar del mensual.
- **Reubicación (NFR-2409, 2 s para 5000 celdas + 2000 movimientos):** el dominio produce el estado
  reubicado en O(celdas + movimientos); el servidor lo escribe por el MISMO camino que `saveLedger`
  (borrar-e-insertar por dueño, inserciones por lotes dentro de la transacción) — una sola estrategia,
  la que FR-2404 describe; las celdas cambian de monto además de clave, así que un `UPDATE` de claves
  no serviría. Los invariantes (i)–(iv) se comprueban en memoria sobre el estado antes de escribir y
  las sumas con dos `SELECT SUM` tras escribir, en la misma transacción. Medido en test de
  integración con datos sintéticos contra el umbral de 2 s.
- **Tamaño de respuesta:** `preview` devuelve 6 ciclos y 8 números; `apply` devuelve `revision` y la
  configuración (< 2 KB). El snapshot completo se recarga por el camino que ya existe.
- **Concurrencia:** `FOR UPDATE` sobre la fila de `ledger` serializa reubicación contra guardados de
  snapshot y cierres del mismo dueño; entre dueños no hay contención.
- **`loadLedger`** hace una consulta indexada más (`cycle_config_version` por dueño, ≤ decenas de
  filas) para derivar el modo y la configuración: sub-milisegundo, dentro de la misma transacción.
- **Escritura de la reubicación:** borrar-e-insertar por dueño (el camino de `saveLedger`), en lotes;
  medido contra el umbral de 2 s con 5000 celdas + 2000 movimientos (NFR-2409).
- **Sin caché nueva** y sin índices nuevos aparte del de `cycle_config_version(owner_id, id)`.

**Re-derivación 2026-09-10:** `placementContext` recorre los movimientos una vez (O(movimientos)) y cada dato sin día se ubica en O(1). La memoria añade una fila por dato sin día movido (≤ 5000 en F-BIG), insertada en bloque en la misma transacción; el tope de 2 s de NFR-2409 se mantiene y se vuelve a medir en TC-CIC-130e.

## Deployment Architecture

**Modelo:** el de la raíz, **contenedor Docker** (`next build` + `next start`) detrás de Nginx en Ultron,
sin proceso nuevo ni servicio adicional. Las migraciones `0007_ciclos.sql` y `0008_ciclos_origen.sql` se aplican con
`scripts/migrate.mjs` en el despliegue, ANTES de arrancar la imagen nueva (aditiva y compatible hacia
atrás: la imagen anterior sigue funcionando sobre el esquema migrado, porque solo relaja CHECKs y añade
una columna con `DEFAULT` y una tabla que no lee). `GET /health` sigue respondiendo `200` tras migrar
(NFR-2410). **En dev la app del usuario (`next dev`, puerto 3100) recarga el código en caliente contra su base real**: toda migración nueva se aplica allí, con respaldo previo y su permiso, antes de que el código que la necesita llegue a esa app (incidente del 2026-09-10: con 0007 sin aplicar la app mostró una semilla vacía). Entornos: dev (Docker Compose local, Postgres en `ledger-dev-db`), gate e2e
(Testcontainers por suite) y producción (Ultron). CI/CD (NFR-2411): las pruebas nuevas van a
`tests/domain/ciclos.test.ts`, `tests/integration/backend/ciclos.test.ts` y `tests/e2e/ciclos.spec.ts`,
recogidas por los globs de `vitest.config.ts` y de Playwright; `npm run test:e2e` sigue apuntando a
`./e2e.sh`. Config por entorno: **una variable nueva, `LEDGER_TZ`** (IANA, por defecto `America/Bogota`), con la
que el servidor calcula «hoy» (`todayISO(tz)` vía `Intl.DateTimeFormat`) para el cierre (FLAG-2);
documentada en `.env.example` y en DEPLOYMENT.md. **Dos variables SOLO de pruebas**, ignoradas cuando
`NODE_ENV === "production"` y documentadas como tales: `LEDGER_TODAY` (`YYYY-MM-DD`) fija «hoy» en el
servidor para que los e2e —que arrancan Next en otro proceso (`e2e.sh`), donde `page.clock` no
llega— puedan fijar la fecha de vigencia y el ciclo actual; y `LEDGER_TEST_FAIL_AFTER=first_insert`
hace que `applyFor` lance tras su primera escritura, para probar el `ROLLBACK` real (no basta un
dato «corrupto» que las invariantes no miran). Ninguna de las dos se lee en producción.

## Risk Analysis

### ADR-01: Eje de indexación bajo ciclos
**Contexto:** el dinero se indexa por `PeriodKey` en 25 ficheros; un ciclo no es un mes.
**Opción A — clave nueva `cycleId` que sustituye a `PeriodKey`:** modelo puro, pero reescribe rollup,
balance, reserve, closure, range, mutations, migraciones y 25 ficheros; el modo mes deja de ser
«idéntico» por construcción y pasa a serlo por pruebas.
**Opción B — conservar `PeriodKey` y poner un `Calendar` que traduce fecha↔clave y clave→rango:** el
ciclo se identifica por el mes en que termina (decisión del usuario); el dominio indexado no se toca.
Limita el primer incremento a ≤ un ciclo por mes (justo el alcance aprobado; quincenal está aplazado).
**Decisión: B.** **Consecuencias:** NFR-2401 se cumple porque `MONTH_CALENDAR` ES el código actual;
las frecuencias con más de un ciclo por mes (BL-045) necesitarán claves compuestas o la opción A: se
documenta como límite explícito, no se pre-diseña.

### ADR-02: Cómo se identifica el ciclo de transición
**Contexto:** entre dos versiones hay un tramo que no es ningún mes y necesita clave para indexar.
**Opción A — clave con sufijo `"YYYY-MMt"`:** ordena bien por cadena, `periodYear/Month` funcionan;
exige relajar seis CHECKs de formato y `isPeriodKey`, y sustituir `addMonths` por `calendar.next` en
`closure.ts:93`. **Opción B — fundir la transición con el ciclo vecino:** cero cambios de formato,
pero contradice §2.2.4 del documento y el criterio de FR-2408 (el gasto del 25-oct debe caer en
«Transición»). **Opción C — tabla de ciclos con id propio:** es la opción A de ADR-01 por la puerta de atrás.
**Decisión: A.** **Consecuencias:** una gramática de clave un carácter más ancha en toda la app; los
sitios que hacen aritmética de meses sobre claves quedan listados (FLAG-1) y se auditan en Fase 3.

### ADR-03: Dónde vive la configuración
**Opción A — dentro del snapshot (`LedgerState.cycles`) y se guarda con `PUT /ledger`:** simple, pero
`PUT /ledger` es snapshot-replace desde un cliente que puede ir con código viejo: un cliente sin
`cycles` la borraría al guardar, y la reubicación quedaría fuera de la transacción que la valida.
**Opción B — tabla propia append-only, el modo derivado de su última fila; el snapshot solo la LEE:** la
configuración solo cambia por el endpoint que también reubica; `PUT /ledger` la ignora.
**Decisión: B**, sin columna denormalizada de modo (hallazgo 12 de la revisión). **Consecuencias:** un
endpoint más; historial gratis (RF-07, NFR-2410); un cliente viejo no puede corromperla; el modo es
una función de la última fila y no puede divergir de ella.

### ADR-06: Cómo se reubica el Ejecutado
**Contexto:** `actuals[hoja][periodo]` mezcla lo tecleado en «Ejec.» con lo que cada movimiento suma
(`mutations.ts:96`, `reserve.ts:1145`). **Opción A — mover la celda entera M→M+1 y los movimientos por
fecha:** sencillo, sumas idénticas, pero los 18 movimientos de septiembre quedarían en «Septiembre» y su
importe en la celda de «Octubre»: dinero en la columna equivocada con el invariante en verde.
**Opción B — descomponer cada celda en residuo tecleado + Σ aportes de movimientos, mover el residuo
como dato sin día y cada aporte con su movimiento, recomponer:** exige una función `movementDeltas`
que reproduzca el efecto exacto de registrar cada tipo de movimiento (incluidas las reservas De→A), y
un invariante por hoja. **Opción C — re-derivar el Ejecutado entero desde el journal y descartar lo
tecleado:** pierde datos del usuario. **Decisión: B.** **Consecuencias:** `relocate` depende de que
`movementDeltas` sea lineal y exacta (FLAG-6, test de propiedad: aplicar los movimientos desde cero
reproduce `actuals`); un residuo negativo (celda tecleada por debajo de lo que sus movimientos suman)
se conserva como residuo negativo y se mueve igual: no se inventa ni se pierde un peso.

### ADR-07: Dónde vive la memoria de origen (re-derivación 2026-09-10)
**Contexto:** la regla nueva (FR-2404) suma en una celda datos sin día de meses distintos, y FR-2410
promete que activar y volver sin editar deja el ledger idéntico. Sin memoria la vuelta tiene que
adivinar, y los tres casos al revés se equivocan incluso con celdas que no juntaron meses (AC-2443).
**Opción A — columna `origin jsonb` en `amount_cell`:** junto al dato, pero `insertSnapshot` borra y
reinserta las celdas en cada guardado desde un cliente que no conoce la columna: la memoria se
perdería en el primer `PUT`, y no cubre movimientos sin fecha ni notas. **Opción B — punto de
restauración: copia del snapshot previo guardada con la versión de activación:** vuelta exacta sin
ediciones, pero no resuelve una celda editada (FR-2410 manda la diferencia al mes más reciente) y
duplica el ledger entero en cada activación. **Opción C — tabla `relocation_origin` del servidor, una
fila por parte movida, escrita y consumida solo por el endpoint de ciclos:** sobrevive a los guardados
del cliente, resuelve la celda editada y cuesta una fila por dato sin día movido. **Decisión: C.**
**Consecuencias:** sin FK a las filas que recuerda; una fila huérfana se lee como celda en 0; `GET
/ledger` no la expone; el ledger de dev del usuario, alineado a mano el 2026-09-10, no tiene memoria (R6).

### ADR-04: Quién calcula la previsualización
**Opción A — el cliente, con la función pura local:** ≤100 ms y sin red, pero lo que se muestra podría
diferir de lo que el servidor aplica si los estados divergen (otro dispositivo, código distinto).
**Opción B — el servidor, con la misma función que aplica:** una petición (≤1 s en el criterio de UX),
y «lo que ves es lo que se hace». **Decisión: B**, con el skeleton de A6 cubriendo la latencia.
**Consecuencias:** `relocate` vive en dominio compartido y se ejecuta en ambos lados en las pruebas.

### ADR-05: Atomicidad de la reubicación
**Opción A — varias peticiones (config, luego snapshot reubicado desde el cliente):** reutiliza
`PUT /ledger`, pero deja una ventana con configuración nueva y datos viejos, y el cliente sería quien
reescribe claves. **Opción B — una transacción en servidor con `FOR UPDATE`, `UPDATE` masivos y
verificación de sumas antes del `COMMIT`:** o todo o nada (FR-2404/FR-2410). **Decisión: B.**

### Riesgos
- **R1 — Un `currentPeriod()`, `periodRange` o `addMonths` olvidado.** 14 sitios de reloj y 5 de
  aritmética medidos (FLAG-1); uno sin migrar hace que «hoy» sea el mes calendario o que la transición
  no exista en una lista. *Mitigación:* `currentPeriod()` se marca `@deprecated` y un test estático
  (patrón de `no-legacy-mode`, NFR-1107) falla si `currentPeriod(`, `periodRange(` o `addMonths(`
  aparecen en `src/` fuera de `lib/date.ts`, `periods.ts`, `range.ts`, `cycles.ts` y `seed.ts`
  (ignorando comentarios).
- **R2 — Claves de transición donde no se esperan.** *Mitigación:* FLAG-1 + test de propiedad: para
  todo `Calendar` generado, `keys()` es contiguo y cada clave pasa `isPeriodKey`.
- **R3 — Sumas idénticas pero datos mal ubicados.** La invariante de sumas no detecta una celda que
  fue a la columna equivocada. *Mitigación:* AC-2412 con el ledger real del usuario como fixture
  (presupuesto igual al ejecutado por rubro en «Septiembre», solo el Salario en «Octubre») y el test de ida y vuelta (AC-2433).
- **R4 — Regresión silenciosa en modo mes.** *Mitigación:* NFR-2401 con la suite completa;
  `MONTH_CALENDAR` implementado delegando en las funciones actuales, no re-escritas.
- **R5 — El usuario activa sobre datos reales sin respaldo.** *Mitigación:* previsualización
  obligatoria (FR-2403), transacción, y FR-2410 como camino de vuelta; en el despliegue, respaldo de
  la base antes de migrar (procedimiento de DEPLOYMENT.md tras BG-037).
- **R6 — El ledger de dev del usuario ya está en ciclos y sin memoria.** Lo activó con la regla
  anterior y sus presupuestos se alinearon a mano por la API (revisión 84); `relocation_origin` nace
  vacía, así que volver a mes usaría los tres casos al revés y Parqueaderos, Restaurantes y Ropa
  volverían enteros a septiembre. *Mitigación:* al desplegar, con permiso del usuario y respaldo
  previo, un script de un solo uso reconstruye su memoria desde el respaldo previo a la activación
  (`~/PROJECTS/T-Ledger-backups/ledger-dev-antes-0007-20260910-113407.sql`) aplicando `placeDateless`.

## Failure Blast Radius

**Component: PostgreSQL** · *Blast radius:* nada se lee ni se escribe; la reubicación no puede ni
previsualizarse. *User impact:* la app no hidrata (`AuthPending`/`StorageBanner`, como hoy); en A6,
A9 «No pudimos calcular la previsualización. Tus datos no cambiaron.». *Recovery:* reintento manual;
ninguna escritura parcial es posible (transacción).

**Component: transacción `applyFor`** · *Blast radius:* si falla a mitad (`relocation_invariant`,
excepción, pérdida de conexión), `ROLLBACK`: la configuración, las claves y `revision` quedan como
estaban. *User impact:* `422`/`5xx` → A9 con el motivo y «Reintentar»; el modo vigente no cambia
(AC-2414). *Recovery:* el usuario repite la previsualización; si el invariante falla de forma
reproducible es un bug de `relocate` y se registra (`aitri feature bug ciclos add`).

**Component: `syncHub` (SSE, singleton en memoria)** · *Blast radius:* los otros dispositivos del mismo
usuario no se enteran de la reubicación hasta recargar; si guardan un snapshot con `baseRevision`
vieja reciben `409` y hacen `resync` (BG-011). *User impact:* «Se actualizó desde otro dispositivo»
al recargar. *Recovery:* el `409` es la red de seguridad; no se pierde nada.

**Component: Better Auth / sesión** · *Blast radius:* los endpoints nuevos responden `401`; la
configuración no se puede leer ni cambiar. *User impact:* pantalla de login, como en toda la app.
*Recovery:* iniciar sesión.

## Traceability Checklist
- [x] FR-2401 → A0–A5 + `cyclesTargetSchema` · FR-2402 → `buildCalendar` · FR-2403 → `preview` + A6 ·
  FR-2404 → `placeDateless` + `relocate` + `relocation_origin` + `applyFor` · FR-2405 → `periodForDate` + `isValidMovementPeriod` ·
  FR-2406 → `proposeOpeningCycle` + D2 · FR-2407 → `rangeLabel` + B/C/E/F + 14 sitios de «hoy» ·
  FR-2408 → `planVersionChange` + transición · FR-2409 → `closure.ts` con `calendar.next` ·
  FR-2410 → `relocate` inverso con memoria (`restoreParts`, `returnDateless`) + bloqueo por cerrado.
- [x] Implementation Approach: entrada por cada uno de los 10 MUST.
- [x] NFR-2401 (`MONTH_CALENDAR` = código actual) · NFR-2402 (`closure.ts` intacto salvo una línea) ·
  NFR-2403 (`activeRange` recibe la misma forma) · NFR-2404 (`reserve.ts` recibe la lista) ·
  NFR-2405 (`startMonth`/`openingBalance` reubicados, no recalculados) · NFR-2406 (migración 0007
  aditiva, idempotente) · NFR-2407 (invariantes en `relocate` + test de balances) · NFR-2408
  (Security Design) · NFR-2409 (Performance) · NFR-2410 (tabla de versiones = historial; `/health`; la línea de log por petición la escribe ya
  `withApi` en `server/http.ts:132` para toda ruta, incluidas las nuevas) ·
  NFR-2411 (Deployment/CI) · NFR-2412 (previsualización obligatoria, `rangeLabel` único).
- [x] ADR-01…07 con ≥2 opciones.
- [x] no_go_zone: sin festivos, sin frecuencias múltiples, sin vencimientos, sin prorrateo, sin
  fuentes múltiples, sin vista mes-calendario, sin negativos, sin edición en sitio de versiones
  (append-only), sin migración masiva (todo por dueño y a petición).
- [x] Blast radius: 4 componentes.
- [x] Technical Risk Flags: abajo.

## Technical Risk Flags

**[RISK] FLAG-1 — Aritmética de meses sobre claves que ahora pueden ser de transición**
Conflict: FR-2408 exige un ciclo de transición con clave propia (`"2026-10t"`), pero `periods.ts`
(`addMonths`, `periodRange`, `monthsBetween`, `isYearStart`, `periodOf`) y sus llamadores asumen
`YYYY-MM` puro. **Inventario completo** (verificado el 2026-09-10): (1) `closure.ts:54`
`normalizeClosure` (`reopened === addMonths(closedThrough,1)`); (2) `closure.ts:218` `reopenMonth`
(`back = addMonths(target,−1)`); (3) `range.ts:86-131` `activeRange` (`periodRange(from,to)`,
`periodOf(periodYear(current)+h,12)`); (4) **servidor**: `ledgerRepo.ts:510-525` `unionScope`/
`serverScope` (`periodRange`), usados por `saveLedger:462`, `insertMovement:591/597/605`,
`closeMonthFor:677`, `reopenMonthFor:784`; (5) `seed.ts:58` (`addMonths` sobre el periodo de
siembra, siempre de mes); (6) validadores: `periods.ts:46` `isPeriodKey` (`length === 7`),
`domain/validation.ts:19` `PERIOD_KEY` (`.max(7)`), `movements/route.ts:14-22` (`?period=`), y los
siete CHECKs de base. Mitigation: (1)(2) reciben `next`/`prev` como parámetro con defecto mensual;
(3) se conserva y se añade `activeBounds`+`activeKeys`; (4) pasa a `calendar.keys(monthOf(oldest), monthOf(newest), extra)` — el servidor no tiene horizonte
por diseño (`ledgerRepo.ts:497-502`), así que no usa `activeKeys`;
(5) no cambia (siempre mes); (6) se relajan a `t?` y `addMonths` lanza ante un sufijo; test estático
que prohíbe `currentPeriod(`/`periodRange(`/`addMonths(` fuera de los módulos permitidos
(`lib/date.ts`, `domain/periods.ts`, `domain/range.ts`, `domain/cycles.ts` y `domain/seed.ts`, que
solo siembra meses), ignorando comentarios.
Severity: **high** (un sitio olvidado produce una columna que no existe, un cierre que salta la
transición o una reserva rechazada en ella).

**[RISK] FLAG-2 — Dos relojes: cliente y servidor deben coincidir en «hoy»**
Conflict: FR-2409 decide cerrable por «hoy» y el servidor lo re-evalúa (`closure/route.ts:30` con
`currentPeriod()` del proceso). Con el servidor en UTC y el usuario en Colombia (UTC−5), entre las
19:00 y las 24:00 locales el día del servidor va uno por delante; con frontera el 21 importa.
Mitigation: **el cliente NO envía la fecha** — `closurePostSchema` es `.strict()` con solo
`baseRevision` a propósito (ADR-12 de cierre-de-mes: «el cliente no propone qué cerrar») y abrirlo
reintroduciría influencia del cliente sobre el cierre. El servidor calcula «hoy» en la zona horaria
del despliegue, `LEDGER_TZ` (12-factor, por defecto `America/Bogota`), con `Intl.DateTimeFormat`; el
cliente usa su reloj local. La ventana de discrepancia queda reducida a un usuario que viaje fuera
de esa zona, y en ese caso el servidor manda. Severity: **medium** → **low** con la variable.

**[RISK] FLAG-3 — Asimetría: activar con periodos cerrados desplaza `closedThrough`; volver a mes con
cerrados se rechaza**
Conflict: FR-2404 no prohíbe activar con meses cerrados (un usuario con años de historia no podría
reabrirlos todos), así que la activación mapea `closedThrough` como una clave más (`M → M+1`); FR-2410
(AC-2435) sí exige rechazar la vuelta con un ciclo cerrado. Es coherente con los criterios aprobados
pero asimétrico, y los `closure_event` antiguos conservan claves del modelo previo (audit, no se
reescriben: al leer el historial en modo ciclos se rotulan con el calendario vigente, lo que puede
mostrar un rango que no era el de aquel cierre). Mitigation: el historial E2 muestra el rango solo
para eventos posteriores a la última versión (`at ≥ created_at` de esa versión); los anteriores solo el nombre. Se
declara para que el revisor decida si prefiere prohibir también la activación con cerrados
(cambio de una línea en `relocate`). **Con la regla nueva** un ciclo puede juntar un mes cerrado y uno abierto (agosto pagado desde el 21 y septiembre pagado antes del 21 caen en «Septiembre»): llevar `closedThrough` al ciclo que abre el pago del mes cerrado mantiene cerrado todo lo que estaba cerrado, a costa de cerrar también los primeros días del mes siguiente, que el usuario puede reabrir; la alternativa dejaría editable dinero ya cerrado. Severity: **medium**.

**[RISK] FLAG-4 — `PUT /ledger` desde un cliente con código anterior**
Conflict: NFR-2406/NFR-2401 exigen que un cliente viejo siga funcionando; ese cliente no conoce
`cycles` y envía snapshots con periodos derivados por mes calendario. Mitigation: ADR-03 (la
configuración no viaja en el `PUT`) y la validación `period_mismatch` en `PUT /ledger`, que rechaza
el snapshot incoherente con `422` en vez de aceptarlo; el `StorageBanner` lo comunica. Un usuario en
ciclos con un dispositivo sin actualizar verá el aviso hasta recargar. Severity: **low**.

**[RISK] FLAG-6 — `movementDeltas` debe reproducir EXACTAMENTE el efecto de cada tipo de movimiento**
Conflict: ADR-06 descompone `actuals` en residuo + Σ deltas; si `movementDeltas` difiere en un caso
(una operación De→A de `applyReserveOp` que escriba `actuals` de forma no lineal — `reserve.ts:1128-1146`
fija `w.value`, no suma) el residuo calculado sería falso y la reubicación movería dinero de hoja.
Mitigation: `movementDeltas` se deriva del mismo código que aplica los movimientos (no se re-escribe
a mano) y un test de propiedad en Fase 3 lo verifica: para un estado sin residuos tecleados, aplicar
todos los movimientos desde cero reproduce `actuals` al peso; para el ledger real del usuario, el
residuo de cada celda es ≥ 0 salvo donde él haya tecleado por debajo. Si la propiedad falla para las
reservas, la reubicación de reservas se bloquea (`relocation_invariant`) en vez de adivinar.
Además, `movementDeltas` es `[]` para un retiro o un mover entre alcancías (solo journal) y
`+amount` sobre `to` para un aporte desde Disponible (`reserve.ts:1128-1146`): el saldo por periodo
de una alcancía SÍ puede cambiar de signo al reubicar (retiro fechado 15-ago financiado por un aporte
tecleado en agosto que va a «Septiembre»), y por eso existe la invariante (v). Severity: **high** (es el
único punto donde la reubicación puede mover dinero entre HOJAS).

**[RISK] FLAG-5 — La invariante de sumas no cubre las reservas derivadas**
Conflict: NFR-2404 exige que los saldos derivados por alcancía sean idénticos entre modos para los
mismos movimientos; la reubicación conserva sumas totales pero cambia en qué periodo cae cada
movimiento de reserva, y `reserve.ts` calcula techo/piso por periodo. Mitigation: los saldos
DERIVADOS al final de la lista son idénticos (misma secuencia de movimientos); los saldos POR PERIODO
cambian legítimamente porque el periodo cambió. El AC de NFR-2404 se prueba «al final del último
periodo», que es lo que la fase 1 escribió. Severity: **low**.

**[RISK] FLAG-7 — La regla depende de cómo se atribuye un movimiento a un rubro**
Conflict: `placeDateless` decide por los movimientos fechados de cada hoja; si esa atribución no
coincide con lo que muestra la celda de Ejecutado, el presupuesto seguiría a otra parte. Mitigation:
la atribución es `movementDeltas`, la misma función que descompone el Ejecutado (ADR-06): un aporte a
una alcancía cuenta para la alcancía y un retiro no cuenta para nadie, así que una alcancía solo con
retiros cae en el caso 3. Test de propiedad en Fase 3: tras activar, en todo rubro sin residuo
tecleado, el presupuesto de cada mes queda en el ciclo que recibe la mayor parte de su ejecutado.
Severity: **medium**.
