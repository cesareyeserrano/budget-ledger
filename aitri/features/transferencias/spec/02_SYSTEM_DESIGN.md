# Technical Design Document (TRD) — feature transferencias (Reservas) · modelo v4

## Executive Summary

Cambio sobre el sistema existente, **sin dependencias nuevas**. Modelo v4 (decidido por el usuario
en uso real, 2026-07-29, tras construir y revertir el modelo de celdas-saldo v3): las celdas del
tipo `transfer` son **APORTES del mes** (flujo, la misma semántica de los otros dos tipos); los
**RETIROS son operaciones explícitas del journal** (`Movement` con `from`/`to`); el **saldo por
alcancía es DERIVADO** — `resolvedBalance = Σ aportes(celdas) − Σ retiros(journal)` — y lo
consumen las reglas, el registro, el mini-form de retiros y el Balance (FR-1001). Todo el trabajo
vive en el patrón probado del producto: **núcleo puro en `src/domain`** consumido por las tres
puertas (grilla FR-1003, fila «Retiros del mes» FR-1014/FR-1015, registro FR-1005) y por el
servidor vía el dominio compartido. Persistencia versionada `ledger.budget.v4` / `data_version=4`
con migraciones idempotentes v2→v4 (identidad) y v3→v4 (deshace saldos; deltas negativos →
retiros sintetizados) — FR-1010. La aritmética de `monthBalance` NO cambia (FR-1009, NFR-1001).

## System Architecture

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                 src/domain (puro, sin IO)                │
  BudgetGrid ──────▶│  reserve.ts                                              │
  (celda = aporte,  │   · AVAILABLE_ID "@disponible" · RETIROS_PLAN_ID "@retiros"
   FR-1002/1003)    │   · resolvedBalance/resolvedSeries (derivado, memo)  FR-1001
                    │   · reserveAportes (Σ celdas) / reserveRetiros       FR-1009
  BalanceModule ───▶│     (journal en Ejec.; budgets[@retiros] en Pres.)   FR-1015
  fila Retiros      │   · validateReserveWrite (techo FR-1006 + piso FR-1007,
  (FR-1014/1015)    │     cadena 12 meses, no-empeorar vs base)
                    │   · applyReserveOp (guardar celda+journal · sacar    FR-1004
  Register De→A ───▶│     journal-only · mover celda destino+journal)
  (FR-1005)         │   · applyReserveCellEdit (corrige aporte, jamás journal)
                    │   · setPlannedRetiro + plannedRetiroLimit            FR-1015
  server/ledgerRepo │   · removeReserveRetiro (corrección)                 FR-1014
  (insertMovement) ─▶│   · cellObservations / addCellNote (≤280)           FR-1012
                    │  mutations.ts: repointReserveMovements — el journal
                    │   SIGUE a las celdas en FR-604; deleteNode conserva  FR-1011
                    │   el retiro cuyo origen vive (adversarial 2026-07-30)
                    │  migrate.ts: v3→v4 (deltas; negativos → journal /
                    │   @retiros del plan) · v2→v4 identidad              FR-1010
                    └──────────────────────────────────────────────────────────┘
   Persistencia: localStorage ledger.budget.v4 · Postgres (ledger.data_version=4,
   movement.from_id/to_id, cell_note) · PUT/GET /api/v1 (schemas con from/to y cellNotes)
```

## Data Model

**Contrato de preservación:** `node`, celdas de `expense`/`income`, `amount_cell` (PK y
`CHECK amount >= 0`), campos existentes de `movement`, tablas de auth, `ledger.revision`,
`ledger.nodes.v1`, `theme`. `Movement.target` = SIEMPRE una alcancía real; el sentinel jamás.

| Pieza | Modelo v4 | Notas |
|---|---|---|
| Celdas de nodos `transfer` | APORTES del mes (flujo ≥ 0) — FR-1002 | Misma semántica que expense/income |
| Retiros | SOLO journal: `Movement{type:"transfer", from:alcancía, to:"@disponible"\|alcancía}` — FR-1004 | Sacar no toca celdas; eliminar el movimiento restaura el saldo (FR-1014) |
| `budgets["@retiros"]` | Retiro PLANEADO global por mes — FR-1015 | Clave sentinel del mapa, no un nodo: los roll-ups por nodos jamás la cuentan; persiste como cualquier celda |
| `Movement.from/to` | extremos De→A (hoja transfer o "@disponible") | Aditivo; movimientos viejos sin ellos válidos (NFR-1003) |
| `ledger.data_version` | 2 = aportes sin journal · 3 = saldos (revertido) · 4 = VIGENTE | Marca de idempotencia (FR-1010) |
| `cell_note` (BD) / `cellNotes` (estado) | observaciones manuales ≤280 — FR-1012 | rechazo sin truncar |
| localStorage | `ledger.budget.v4 = {version:4, budgets, actuals, movements, cellNotes?}` | schemas Zod: enteros ≥ 0 (blob corrupto → semilla, NFR-1003) |

**Migraciones (`domain/migrate.ts`, puras) — FR-1010:** v2→v4 = identidad de celdas (solo marca).
v3→v4 = por hoja transfer: serie resuelta (arrastre) → deltas; delta>0 → celda aporte; delta<0 →
retiro sintetizado (journal con nota, plano Ejec.) o acumulado en `budgets["@retiros"]` (plano
Pres.). El saldo derivado v4 == saldo resuelto v3, mes a mes. Idempotencia por MARCA.

## API Design

**Contrato preservado:** rutas `/api/v1` con método/path/auth/formas actuales; journal inmutable
por API (PATCH/DELETE de movimiento → 404) — la corrección de retiros (FR-1014) viaja por el PUT
snapshot como todo lo demás.

- `movementInputSchema`/`apiMovementSchema`: + `from`/`to` opcionales; `ledgerStateSchema`: +
  `cellNotes` opcional. Las 5 capas del precedente date/note cubiertas (FR-1010).
- `insertMovement` (servidor): **garantiza v4 antes de operar** (`ensureV4InTx`, hallazgo
  adversarial: un POST sobre un ledger v3 leería saldos como aportes) y persiste el diff completo
  de celdas + el movimiento en UNA transacción con bump de `revision` (FR-1004).
- `loadLedger`: migra lazy DENTRO de la transacción (`for update` + re-check del marcador) — dos
  dispositivos concurrentes migran exactamente una vez (FR-1010).

**API interna del dominio (firmas reales):**
```ts
export const AVAILABLE_ID = "@disponible"; export const RETIROS_PLAN_ID = "@retiros";
function resolvedBalance(state, leafId, m, plane): number;              // FR-1001
function reserveAportes/reserveRetiros/reserveDelta(state, m, plane): number; // FR-1009
function availableMargin(state, m): number;                             // FR-1006
function validateReserveWrite(state, {leafId, month, plane, newAmount}): ReserveVerdict; // FR-1003/1006/1007/1008
function applyReserveOp(state, {from,to,month,amount,date?,note?}): {state,movement}|{rejected}; // FR-1004
function applyReserveCellEdit(state, edit): {state,warnings,noop}|{rejected}; // FR-1003
function setPlannedRetiro(state, m, v): {state}|{rejected:{limit}};     // FR-1015
function plannedRetiroLimit(state, m): number;                          // FR-1015
function removeReserveRetiro(state, movementId): LedgerState;           // FR-1014
function cellObservations/addCellNote(...);                             // FR-1012
function migrateStateV3toV4(state): LedgerState;                        // FR-1010
```

## Implementation Approach

- **FR-1001:** serie derivada por hoja memoizada por IDENTIDAD (WeakMap budgets/actuals →
  WeakMap movements → Map hoja): cada mutación clona, el caché es correcto por construcción
  (NFR-1005, con contadores de instrumentación para los TCs).
- **FR-1002/1003 (grilla):** las celdas transfer usan `ReserveLeafCell`/`ReserveCellEditor`
  (`ReserveCells.tsx`): edición estándar + franja de bloqueo inline del veredicto; editar jamás
  journaliza. Totales de fila/tipo por `typeTotals` (celdas del mes).
- **FR-1004:** guardar → celda destino += monto + journal; sacar → journal-only; mover → celda
  destino + journal con ambos extremos. Candidato validado con `chainCheck` (techo global
  no-empeorar + piso derivado por hoja afectada). `target` = alcancía (retiro: from; resto: to).
- **FR-1011 + integridad estructural:** `repointReserveMovements` en los 4 sitios FR-604
  (createNode + 3 ramas de moveNode) — el journal sigue a las celdas; `deleteNode` conserva el
  retiro cuyo `from` sigue vivo convertido en retiro a Disponible (hallazgos adversariales 1-3).
- **FR-1014 (fila Retiros del mes · Ejec.):** `WithdrawCell` en `BalanceModule`: Σ retiros
  graduada con `budgetState(planeado, ejecutado)` (misma tabla ›/›› de gastos); popover con
  select jerárquico (`leafPathLabel`), Máx., historial del mes con eliminación
  (`removeReserveRetiro`); toast + Deshacer (undo de un nivel por referencia — ADR-07).
- **FR-1015 (fila Retiros del mes · Pres.):** `PlannedWithdrawCell`: escribe
  `budgets["@retiros"]`; `setPlannedRetiro` rechaza sobre `plannedRetiroLimit` (franja inline);
  marca auto-sanadora cuando el plan de aportes deja de cubrirlo.
- **FR-1005 (registro):** `TypeToggle` «Reserva»; `ReserveRow` (chips De/A con saldo derivado,
  exclusión mutua); guía Máx./Margen; guarda vía `addMovement` (delega en `applyReserveOp`).
- **FR-1006/1007:** `techoScan` forward (margen = max(0, disponiblePrevio + flujo); neto =
  aportes − retiros; bloquea solo `candExcess > baseExcess`); piso = serie derivada ≥ 0 de cada
  hoja afectada en el candidato, nombrando el primer mes ofensor.
- **FR-1008:** plano budget de `chainCheck` → warnings (jamás bloquea); `planTechoMonths` para
  las marcas «!» de celdas.
- **FR-1009:** `BalanceModule`: filas reserved(=aportes) / retiros / monthAvailable
  (flow − reserved) / available / reservedBalance / total; `reserveNet = reserveDelta`.
- **FR-1012:** derivadas del journal (from/to del mes) + `cellNotes` manuales; punto indicador,
  tooltip y sección del editor.

## Security Design

Sin superficie nueva de red ni auth. Postura heredada intacta (`ownerId` de sesión, `withApi`,
rate-limit). Campos nuevos por Zod en el borde (`from`/`to` acotados; `cell_note.text` ≤280;
`@retiros` pasa `gte(0)`); render como texto plano (React). **ADR-04 — PUT confiado:** el PUT
snapshot NO re-valida techo/piso (datos históricos pueden violarlos legítimamente; las reglas son
integridad de UX del dominio compartido, no seguridad; la BD garantiza `amount ≥ 0`). Documentado
como decisión (NFR-1004): un blob artesanal solo afecta los datos del propio usuario autenticado.

## Performance & Scalability

`resolvedSeries` O(hojas×12) memoizada por identidad; `validateReserveWrite` = un `techoScan`
(O(12) con typeTotals) + series por hoja afectada, por tecleo. Presupuesto NFR-1005: ≤150 ms con
30 alcancías (TC propio con contadores). Migración O(hojas×12) una vez, transaccional. La edición
expense/income no invoca las reglas de reservas (contador = 0 en el TC).

## Deployment Architecture

El existente sin cambios (Docker Next standalone + Postgres, o localStorage). Lo único nuevo: la
migración drizzle aditiva `0001_transferencias.sql` (data_version, from_id/to_id, cell_note) con
`npm run db:migrate` antes del rollout; la de DATOS es lazy por usuario. Rollback: columnas/tabla
inertes para código viejo.

## Risk Analysis

- **R1 · Migración corrompe datos (alto):** marca de versión (nunca heurística), conversión pura
  testeable (v3→v4 preserva el saldo derivado exacto), transacción con for update, `insertMovement`
  también migra. Mitigado + verificado adversarialmente.
- **R2 · Operaciones estructurales fabrican/pierden plata (alto — MATERIALIZADO y corregido):**
  los hallazgos adversariales 1-3 (saldo fantasma por createNode/moveNode; resurrección por
  deleteNode) se cierran con `repointReserveMovements` + conservación del retiro vivo; FR-1011
  exige el invariante Σ derivado(m) idéntico y sus TCs lo afirman.
- **R3 · Falso verde por re-derivación de TCs (alto):** los TC-TRF-* del modelo v3 se re-derivan a
  v4 (NFR-1007); la suite agregada en verde es el gate.
- **R4 · UX de retiros no definitiva (medio, aceptado):** BL-019; la v1 es funcional y validada
  operativamente.

**ADR-01v4 — Celdas = aportes; retiros = journal; saldo = derivado.** Sustituye al ADR-01 (saldos
almacenados): el usuario, en uso real, rechazó la semántica de celda-saldo (rompía el gesto de
teclear movimientos y generaba retiros implícitos). Consecuencia: el CHECK ≥ 0 sigue natural, la
grilla es homogénea entre tipos, y el journal es la única fuente de retiros.
**ADR-02 — Sentinel `@disponible` solo en from/to; `@retiros` solo como clave del plan.**
**ADR-03 — Migración lazy con marcador; dueño = quien posee el dato; insertMovement garantiza v4.**
**ADR-04 — PUT confiado** (ver Security).
**ADR-05 — `applyReserveOp` separada; `addMovement` delega por tipo; expense/income intactos.**
**ADR-06 — Observaciones: derivadas del journal + `cellNotes`; historial de retiros en el mini-form.**
**ADR-07 — Undo de un nivel en memoria, validado por identidad de referencia; corrección duradera
via eliminación de retiros (FR-1014).**

## Technical Risk Flags

[RISK] La clave sentinel "@retiros" viaja por mapas de celdas
Conflict: cualquier consumidor nuevo que itere claves crudas de budgets podría tratarla como nodo.
Mitigation: los consumidores actuales iteran `nodes` (verificado por grep + adversarial); regla
documentada aquí y en reserve.ts; TC negativo dedicado.
Severity: low

[RISK] Corrección de retiros reordena la historia
Conflict: eliminar un retiro antiguo puede dejar un techo histórico "peor" que el presente.
Mitigation: decisión explícita — la eliminación es SIEMPRE permitida (equivale al estado previo al
error, que existió legítimamente); el techo con regla no-empeorar tolera estados históricos.
Severity: low
