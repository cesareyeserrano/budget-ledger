# Technical Design Document (TRD) — feature transferencias (Reservas)

## Executive Summary

Cambio sobre el sistema existente, **sin dependencias nuevas**: el tipo `transfer` pasa de celdas-flujo a **celdas-saldo con arrastre**, y se añade la operación de reserva **De→A** con dos reglas de dominio (techo global, piso por alcancía). Todo el trabajo nuevo vive en el patrón ya probado del producto: **núcleo puro en `src/domain`** (nueva derivación `resolvedBalance`, nueva mutación `applyReserveOp`, nuevo validador `validateReserveWrite`), consumido por las dos puertas (grilla y registro) y por el servidor vía el dominio compartido (NFR-507 del backend se conserva). Persistencia: bump versionado `ledger.budget.v2 → v3` con migración **idempotente y con dueño** (cliente en modo localStorage; servidor en modo servidor, con marcador transaccional). La aritmética de `monthBalance` NO cambia — `reserved` pasa a ser el delta de saldos resueltos y la conservación se hereda por construcción (verificado contra el motor real en la sesión de diseño).

Justificación de stack: cero opciones nuevas que justificar — la feature es la extensión natural del diseño aprobado del monorepo (Next 15 + dominio TS puro + Zustand + Drizzle/Postgres). La decisión de fondo (guardar SALDOS, no deltas) es ADR-01.

## System Architecture

```
                    ┌───────────────────────────────────────────────────────┐
                    │                src/domain (puro, sin IO)              │
                    │                                                       │
  BudgetGrid ──────▶│  reserve.ts (NUEVO)                                   │
  (editor celda)    │   · AVAILABLE_ID = "@disponible" (sentinel)           │
                    │   · resolvedBalance(state, leafId, m, plane)          │
  Register ────────▶│   · resolvedTypeTotal / reserveDeltas (Σ por mes)     │
  (De→A)            │   · validateReserveWrite(state, edit) → ok | rechazo  │
                    │       techo GLOBAL + piso por hoja, cadena 12 meses,  │
  Balance ─────────▶│       Ejecutado bloquea / Pres. avisa                 │
  (reserveNet v2)   │   · applyReserveOp(state, {from,to,month,amount,...}) │
                    │       lee resueltos → valida → escribe ≤2 hojas +     │
  server/ledgerRepo │       movimiento from/to  (addMovement delega aquí    │
  (insertMovement) ─▶│       cuando type === "transfer")                    │
                    │  migrate.ts (NUEVO): v2→v3 cumsum ambos planos        │
                    └───────────────────────────────────────────────────────┘
   Persistencia: localStorage ledger.budget.v3  ·  Postgres (ledger.data_version,
   movement.from_id/to_id, tabla cell_note)  ·  PUT/GET /api/v1 (schemas extendidos)
```

Componentes tocados: `domain/{reserve,migrate,mutations,balance,types,validation}.ts` · `state/store.ts` (acción de reserva + undo de un nivel) · `components/{BudgetGrid,BalanceModule,register/*,Toaster}` · `data/repository.ts` (carga v2|v3) · `server/{schemas,db/schema,data/ledgerRepo}.ts` · `drizzle/` (migración SQL aditiva).

## Data Model

**Contrato de preservación (NO cambia):** `node` (jerarquía, CHECKs), celdas de `expense`/`income` (flujo mensual), `amount_cell` con su PK y su `CHECK amount >= 0`, los campos existentes de `movement` (`id, ownerId, type, catId, subId, target, amount, month, createdAt, date, note`), las tablas de auth, `ledger.revision` (lock optimista), las claves `ledger.nodes.v1` y `theme`. `Movement.target` conserva su invariante — SIEMPRE un nodo real; el sentinel jamás va ahí.

**Delta que introduce esta feature:**

| Pieza | Cambio | Notas |
|---|---|---|
| Celdas de nodos `transfer` | REINTERPRETACIÓN: el número almacenado es el SALDO del mes (≥ 0, natural con el CHECK) | Ausente = arrastra el previo; 0 explícito = vaciada. Ambos planos |
| `Movement` | + `from?: string`, + `to?: string` (ids de hoja transfer o `"@disponible"`) | Aditivo como `date`/`note`; movimientos viejos sin ellos siguen válidos |
| `movement` (BD) | + columnas `from_id text NULL`, `to_id text NULL` | Sin FK (como `target`); migración SQL aditiva |
| `ledger` (BD) | + `data_version integer NOT NULL DEFAULT 2` | El marcador que hace la migración detectable e idempotente |
| `cell_note` (BD, NUEVA) | `(owner_id, node_id, month, id) PK · created_at bigint · text text(≤280)` | Observaciones manuales por celda (FR-1012); CASCADE por owner |
| localStorage | `ledger.budget.v3` = `{version:3, budgets, actuals, movements, cellNotes}` | `cellNotes: Record<nodeId, Partial<Record<MonthKey, {id, createdAt, text}[]>>>` |
| Zod persistencia | `persistedBudgetSchema` → unión discriminada `v2 | v3` | v2 se acepta SOLO para migrar (una vez); v3 es lo que se escribe |

**Migración v2→v3 (`domain/migrate.ts`, pura):** para cada hoja transfer y cada plano, `saldo[m] = Σ aportes[1..m]` (celdas explícitas en los 12 meses — conserva la corrección aunque pierda el gris de arrastre en datos históricos, aceptado en el diseño §9). Expense/income: intactos. Idempotencia por MARCA, no por heurística: la clave/columna de versión decide si corre, nunca el contenido.

## API Design

**Contrato preservado:** todas las rutas `/api/v1` conservan método, path, auth y formas actuales; `GET /api/v1/ledger` → `{revision, state}` · `PUT` → lock optimista por `baseRevision` (409) · `POST /api/v1/movements` → 201/422. El bundle cliente no gana envs nuevas.

**Delta de contrato:**
- `apiMovementSchema` y `movementInputSchema`: + `from`/`to` opcionales (`z.string().optional()`); el `ledgerStateSchema` del PUT: + `cellNotes` opcional. Las CINCO capas del precedente `date`/`note` se tocan a la vez: schema Zod de persistencia · schemas del API · columnas BD · `rowsToState` · `insertSnapshot` (más `cell_note` en las últimas tres).
- `insertMovement` (servidor): para `type==="transfer"` ejecuta `applyReserveOp` del dominio compartido y persiste **el diff completo de celdas** (todas las hojas cuyo saldo cambió) + el movimiento, en UNA transacción con bump de `revision`. Deja de asumir "un movimiento = una celda".
- `loadLedger` (servidor): si `data_version < 3`, migra DENTRO de la misma transacción (`for update` sobre la fila ancla), estampa `data_version = 3` y devuelve el estado migrado — lazy, one-shot, sin carrera entre dispositivos (ADR-03).

**API interna del dominio (firmas):**
```ts
export const AVAILABLE_ID = "@disponible";
type Plane = "budget" | "actual";
function resolvedBalance(state: LedgerState, leafId: string, m: MonthKey, plane: Plane): number;
function reserveDelta(state: LedgerState, m: MonthKey, plane: Plane): number;        // Σres(m) − Σres(m−1)
function reserveAportes(state, m, plane): number;  function reserveRetiros(state, m, plane): number;
type ReserveEdit = { leafId: string; month: MonthKey; plane: Plane; newBalance: number };
type ReserveVerdict = { ok: true; derived: DerivedEffect[] } |
  { ok: false; rule: "techo" | "piso"; month: MonthKey; leafId?: string; limit: number };
function validateReserveWrite(state: LedgerState, edit: ReserveEdit): ReserveVerdict; // Pres.: siempre ok + warnings
type ReserveOp = { from: string; to: string; month: MonthKey; amount: number; date?: string; note?: string };
function applyReserveOp(state: LedgerState, op: ReserveOp):
  { state: LedgerState; movement: Movement } | { rejected: ReserveVerdict | "invalid_target" };
function clearReserveCell(state: LedgerState, leafId: string, m: MonthKey, plane: Plane): LedgerState;
function migrateBudgetV2toV3(v2: PersistedBudgetV2): PersistedBudgetV3;              // pura, testeable
```

## Implementation Approach

- **FR-1001 (resolvedBalance):** una pasada por hoja (array de 12, carry-forward). Memoización por identidad del objeto `data` (WeakMap) — cada mutación reemplaza `data`, así que el caché es correcto por construcción. I/O: `LedgerState → number`. Fallo: imposible (total, `?? carry`).
- **FR-1002/1003 (grilla):** `BudgetGrid` bifurca el render de celdas por `node.type === "transfer"`: tinta por estado (explícita/arrastrada/0/—), badge SALDO en la fila de tipo, editor extendido (franja de bloqueo/preview ancladas a la celda, acción «↺ Volver al arrastre» → `clearReserveCell`, sección de observaciones). Commit: `setLeafAmount` delega en el camino de reserva cuando es hoja transfer — traduce `newBalance` a `applyReserveOp` con `from/to` inferidos (subida = Disponible→hoja; bajada = hoja→Disponible). Sin cambio = no-op ANTES de llamar al dominio. Fallo: `ReserveVerdict` alimenta la franja con el mes y el límite.
- **FR-1004 (applyReserveOp):** valida con `validateReserveWrite` sobre el estado candidato de AMBOS extremos; escribe los saldos resueltos ± monto como explícitos en el mes; `unshift` del movimiento con `from/to`; `target` = la alcancía (retiro: from; aporte/mover: to). `deleteNode` extiende su filtro a `from/to`. Fallo: rechazo tipado, estado intacto.
- **FR-1005 (registro):** `TypeToggle` renombra el segmento; `Register` monta `ReserveRow` (dos filas de chips De/A con saldo, exclusión mutua, guía Máx/Margen) en lugar de `CategoryRow` para el tipo transfer; guardar llama la acción de store `applyReserveOp`. Fallo: guía en `--error` + botón deshabilitado; el mensaje del dominio si llega el rechazo (carrera).
- **FR-1006 (techo):** `validateReserveWrite` recorre los 12 meses una vez con los agregados resueltos precalculados: techo = `Σdelta(m) ≤ max(0, prevAvailable(m) + flow(m))` — GLOBAL por mes (necesita la serie del balance: reusa `computeBalanceSeries` del estado candidato). Devuelve el PRIMER mes ofensor con su margen. Ejecutado: bloquea; Pres.: `ok` + lista de meses marcados (la UI pinta «!»). El patrón de primera carga pasa por construcción (el ingreso del mes entra en `flow`).
- **FR-1007 (piso):** en la misma pasada, la serie resuelta POR HOJA debe quedar ≥ 0 en los 12 meses del estado candidato; un retiro jamás consulta el techo (solo reduce `Σdelta`). Devuelve la hoja y el mes ofensor con su saldo («"Viaje" solo tiene $150.000»). Fallo: rechazo tipado; la UI decide franja (grilla) o guía (registro).
- **FR-1008 (plan):** `reserveDelta(budget)` ancla contra `resolvedBalance(..., m−1, "actual")` (ADR-03 de balance); el aviso es un derivado de `validateReserveWrite` en modo plan.
- **FR-1009 (Balance):** `reserveNet` se reemplaza por `reserveAportes/reserveRetiros`; `BalanceModule` inserta la fila «+ Retiros del mes» (tone reserve, siempre visible). `monthBalance` intacto: `reserved = aportes − retiros`.
- **FR-1010 (migración):** ver Data Model/API. El camino cliente (localStorage) migra en `LocalStorageRepository.load` (lee v2 → escribe v3 → borra clave v2); el servidor en `loadLedger`. Spec dedicado de idempotencia.
- **FR-1011 (reestructurar):** `mergeMonthMap` gana variante para transfer: materializa (12 valores explícitos resueltos) ambas series y suma — la conservación de Σresolved(m) queda por construcción; el helper de tests gana `resolvedYearByMonth` para el invariante.
- **FR-1012 (observaciones):** derivadas (notas de movimientos from/to del mes de la hoja) + manuales (`cellNotes`). Punto indicador si `derived.length + manual.length > 0`.
- **Undo (FR-1003):** el store guarda `{prevData, description}` del último retiro; el toast llama `undoLastReserveOp` que restaura `prevData` y persiste — un solo nivel, en memoria, se descarta con cualquier mutación posterior.

## Security Design

Sin superficie nueva de red ni de auth. Postura heredada intacta: `ownerId` de la sesión (jamás del payload), rutas bajo `withApi` (401/422/origin), cookies y rate-limit sin cambio. Validación de entrada: los campos nuevos pasan por Zod en el borde (`from/to` strings acotados; `cell_note.text` ≤ 280 con trim — mismo tratamiento que `note`; render como texto plano, jamás HTML → XSS neutralizado por React igual que las notas existentes). Trust boundaries: (1) entrada del usuario → schemas Zod del borde; (2) sesión → `ownerId` estructural en `ledgerRepo`; sin cambio. **Decisión del PUT snapshot (constraint de Fase 1): el PUT permanece como puerta CONFIADA** — no valida techo/piso. Racional (ADR-04): los datos migrados y los históricos pueden violar legítimamente el techo (las reglas no existían cuando se escribieron); rechazar el snapshot bloquearía la sincronización de cuentas válidas. Las reglas son integridad de UX del dominio compartido, no seguridad; la BD sigue garantizando `amount ≥ 0`. No hay NFRs de seguridad activos nuevos en el PRD (NFR-1004 es de arquitectura de reglas y queda cubierto arriba).

## Performance & Scalability

- `resolvedBalance`: O(1) por consulta tras una pasada O(hojas×12) memoizada por identidad de `data` (WeakMap). Con 30 alcancías: 360 celdas — trivial.
- `validateReserveWrite`: una corrida de `computeBalanceSeries` (<100 ms medido en TC-BAL-957h) + la serie por hoja (O(hojas×12)) sobre el estado candidato, por tecleo. Presupuesto NFR-1005: ≤150 ms con 30 alcancías — TC de perf propio (no se hereda la cifra vieja).
- Migración: O(hojas×12) una vez; en servidor dentro de la transacción existente de `loadLedger` (sin round-trips extra).
- Sin caching nuevo, sin cambio de límites del INSERT_CHUNK; `cell_note` acotada por texto ≤280 y PK compuesta.

## Deployment Architecture

**Modelo: el existente, sin cambios — contenedor Docker (Next standalone) + Postgres**, o modo localStorage sin backend. Entornos y CI/CD: los actuales (ci.yml completo + job de seguridad). Lo único nuevo para desplegar: **una migración drizzle aditiva** (`ALTER TABLE ledger ADD COLUMN data_version…`, `ALTER TABLE movement ADD COLUMN from_id/to_id…`, `CREATE TABLE cell_note…`) que corre con `npm run db:migrate` antes del rollout — es de ESQUEMA; la de DATOS (v2→v3) es lazy por usuario en `loadLedger`, sin ventana de mantenimiento. Rollback: las columnas/tabla nuevas son inertes para el código viejo.

## Risk Analysis

- **R1 · La migración corrompe datos (impacto alto):** mitigado por marca de versión (nunca heurística), migración pura testeable, spec dedicado de idempotencia (cargar 2× == 1×), y transacción con `for update` en servidor. ADR-03.
- **R2 · Falso verde por el blast-radius de tests declarado (alto):** 4 TCs de balance + 1 de storage-keys mueren por diseño y 8 seeds se re-basan; mitigado por NFR-1007 (la suite agregada en verde al cierre, re-derivaciones listadas en el build report) — el costo está DECLARADO, no se descubre en verify.
- **R3 · Doble semántica en una grilla confunde (medio):** mitigado por badge SALDO + banner one-shot + tintas de arrastre (spec UX); el riesgo residual se mide en el uso real.
- **R4 · El editor traduce mal edición→operación (medio):** la traducción (subida/bajada → De/A) vive en UNA función del dominio con tests de tabla; la UI no calcula nada.
- **R5 · Muro de diciembre (bajo, aceptado):** restricción heredada single-year, ratificada en el no_go_zone; sin código.

**ADR-01 — Guardar SALDOS, no deltas.** Contexto: la celda muestra saldo; ¿almacenar saldo o delta? Decisión: saldo (el número que el usuario ve y teclea ES el almacenado; `CHECK ≥ 0` = el piso, natural; ausente=arrastre expresable). Consecuencia: los deltas se derivan; migración = cumsum.
**ADR-02 — Sentinel `@disponible` solo en `from`/`to`.** `target` conserva su contrato (los 4 suites de noOrphans se re-derivan con el sentinel como caso, no se relajan).
**ADR-03 — Migración lazy con marcador, dueño = quien posee el dato.** localStorage: el cliente al cargar; Postgres: el servidor en `loadLedger` transaccional. Nunca el cliente por PUT (carreras).
**ADR-04 — PUT confiado.** Ver Security Design.
**ADR-05 — `applyReserveOp` separada; `addMovement` delega por tipo.** Reutilizar `addMovement` sumaría sobre saldos (retiros fantasma); gastos/ingresos no cambian ni un byte (NFR-1002).
**ADR-06 — Observaciones: derivadas de movimientos + `cellNotes` manuales.** No se inventa un journal-vista; la celda es la superficie de lectura (decisión del usuario).
**ADR-07 — Undo de un nivel en memoria.** Suficiente para el gesto blur-commit; un historial general está fuera de alcance.

## Technical Risk Flags

[RISK] Validación en cadena por tecleo compite con el guardrail de latencia
Conflict: NFR-1005 exige ≤150 ms por edición, pero validateReserveWrite corre computeBalanceSeries + series por hoja sobre el estado candidato en cada commit.
Mitigation: pasada única memoizada por identidad de data (WeakMap); presupuesto medido con TC propio (30 alcancías); si excede, precomputar las series del estado base y aplicar el delta candidato incrementalmente.
Severity: medium

[RISK] La reinterpretación de celdas rompe consumidores no inventariados
Conflict: FR-1002 cambia el significado del dato almacenado para transfer, y cualquier lector directo de budgets/actuals (typeTotals, dashboard, KPIs, tests) que no pase por resolvedBalance leerá saldos como flujos.
Mitigation: grep-inventario en build de TODO lector de mapas para type transfer (typeTotals, dashboardMetrics, helpers de tests) y redirección a la capa resuelta; NFR-1007 exige la suite agregada verde como red final.
Severity: high

[RISK] Migración lazy en servidor bajo concurrencia de dispositivos
Conflict: FR-1010 exige one-shot, pero dos GET simultáneos podrían migrar dos veces sin serialización.
Mitigation: la migración corre dentro de la transacción con `select … for update` de la fila ancla `ledger` (el mismo lock del save) + re-check de data_version tras adquirirlo.
Severity: medium

[RISK] El sentinel se filtra a superficies que esperan nodos
Conflict: FR-1004 introduce "@disponible" en from/to; cualquier código que resuelva esos campos contra el árbol (render de journal futuro, deleteNode) lanzaría o dejaría huérfanos.
Mitigation: helpers únicos isAvailable(id)/labelOfEnd(id) en domain/reserve.ts; deleteNode extendido a ambos extremos; TC negativo dedicado.
Severity: low
