# 02_SYSTEM_DESIGN — contrapartidas-reserva

## Executive Summary

Cambio a un sistema vivo, no producto nuevo: **no se añade ni una dependencia, ni un endpoint, ni una
tabla**. El stack sigue siendo Next.js 15.5.22 · React 19 · TypeScript · Postgres 16 vía Drizzle ·
Zustand · Vitest 3.2.6 · Playwright. Todo lo que esta feature necesita ya existe en el proyecto; lo
que cambia es **dónde se anota una operación de reserva** y **qué ve el usuario antes de operar**.

La decisión de fondo (ADR-01): **un mover alcancía→alcancía deja de escribir la celda del destino y
pasa a anotarse solo en el journal, por sus dos extremos.** La razón no es estética — es que la tabla
`amount_cell` declara `CHECK (amount >= 0)`, así que la alternativa "doble asiento en celdas" exigiría
celdas negativas y por tanto un cambio de esquema y de la semántica de FR-1003 («la celda es el aporte
del mes»). El journal ya es donde viven las salidas: llevar allí también las entradas de un mover es
la simetría barata.

Consecuencia en cadena: al no escribir celda, `reserveAportes = Σ celdas` vuelve a ser cierto sin
correcciones, el parche `reserveMovers` se retira, y la grilla —que suma celdas— deja de inflarse.
Un solo cambio de anotación arregla las dos lecturas.

**North Star:** cero discrepancia entre el roll-up de la grilla y la fila del Balance, con saldos
derivados y Saldo total idénticos. **Guardrail:** la conservación `total(m) = total(m−1) + flujo(m)`
y `Saldo reservado = Σ saldos derivados`, hoy en verde con 318/318.

## System Architecture

```
┌─ UI (React, cliente) ─────────────────────────────────────────────────────┐
│                                                                            │
│  BudgetGrid.tsx                          BalanceModule.tsx                 │
│   ├ encabezado de mes ──[FR-1606]──┐      ├ filas de la cascada            │
│   ├ fila de alcancía                │      ├ fila «Retiros del mes»        │
│   │   └ acción «Sacar» [FR-1607]────┼──┐   └ franja de techo [FR-1606]──┐  │
│   └ ReserveCells.tsx                │  │                                │  │
│       ├ ReserveCellEditor           │  │                                │  │
│       │   └ «Máx. N» ───[FR-1605]───┤  │                                │  │
│       └ WithdrawPopover (compartido)│  │                                │  │
│           ├ origen: lista | resuelto ◄─┘   [ADR-04]                     │  │
│           ├ nota «¿para qué?» [FR-1608]                                 │  │
│           └ lista del mes: retiros + MOVERES [FR-1609]                  │  │
└──────────────────┬──────────────────────────────────────────────────────┼──┘
                   │ useLedgerStore (Zustand)                             │
┌──────────────────▼─────────────────────────────────────────────────────┐│
│  DOMINIO PURO — src/domain/reserve.ts, balance.ts   (sin React/IO/red)  ││
│                                                                         ││
│   applyReserveOp ──[FR-1601]── mover: journal SIN escritura de celda    ││
│   reserveIndex   ──[NUEVO]──── UNA pasada sobre movements →             ││
│                                 {in[12], out[12]} por hoja  [ADR-05]    ││
│   resolvedSeries ──[FR-1602]── Σceldas + Σin − Σout                     ││
│   reserveAportes ──[FR-1603]── Σ celdas  (se retira reserveMovers)      ││
│   techoScan      ──[FR-1606]── ya calcula excess[12]; se expone         ││
│                                 techoBreaches()  [ADR-03] ─────────────►┘│
│   monthReserveOps─[FR-1609]── retiros + moveres del mes                 │
│   removeReserveOp─[FR-1609]── generaliza removeReserveRetiro            │
└──────────────────┬──────────────────────────────────────────────────────┘
                   │ ServerRepository (PUT/GET /api/v1/ledger — SIN CAMBIOS)
┌──────────────────▼──────────────────────────────────────────────────────┐
│  SERVIDOR — src/server/data/ledgerRepo.ts                                │
│   ensureV5InTx ──[FR-1604]── migración v4→v5 + marcador, MISMA tx        │
│   node · amount_cell · movement · cell_note  (esquema INTACTO)           │
└──────────────────────────────────────────────────────────────────────────┘
```

## Data Model

### Contrato de preservación — lo que NO cambia
| Tabla | Compromiso |
|---|---|
| `node` | Sin cambios: columnas, PK `(owner_id,id)`, checks de `level` y `type` |
| `amount_cell` | Sin cambios. **`CHECK (amount >= 0)` se preserva** — es la restricción que decide ADR-01 |
| `movement` | Sin cambios. `from_id`/`to_id` ya existen y bastan; `note` ya existe y es lo que FR-1608 usa |
| `cell_note` | Sin cambios |
| `ledger` | Sin cambios de columna |

### Delta
Uno solo: **`ledger.data_version` pasa de 4 a 5.** `DATA_VERSION_FLOWS = 4` se conserva como
constante histórica y se añade `DATA_VERSION_COUNTERPARTY = 5`, que es el valor que
`saveLedger` estampa y el que `ensureV5InTx` compara — mismo patrón que la cadena v2→v3→v4.

### Semántica que cambia (sin cambiar el esquema)
| Dato | Antes | Después |
|---|---|---|
| `amount_cell` de una hoja transfer | aporte del mes **+ llegadas de moveres** | aporte del mes desde Disponible, **y nada más** |
| `movement` type=transfer con ambos extremos reales | rastro parcial (la llegada estaba en la celda) | **rastro completo** de la operación |

Invariante nuevo que la migración establece y el dominio mantiene:
`saldo(hoja,m) = Σ celdas[0..m] + Σ movimientos con to=hoja[0..m] − Σ movimientos con from=hoja[0..m]`

## API Design

Superficie HTTP: **sin cambios**. `GET/PUT /api/v1/ledger`, `POST /api/v1/movements`,
`/api/v1/sync/stream` conservan método, ruta, auth, forma de petición y de respuesta. El contrato
público que se preserva incluye el lock optimista por `revision` y el 409 en conflicto.

Cambia solo la API interna del dominio (`src/domain/reserve.ts`):

```ts
// ── CAMBIA comportamiento, no firma ────────────────────────────────────────
applyReserveOp(state, op): ReserveOpResult
//   mover (ambos extremos reales) → NO emite CellWrite; solo el movimiento. [FR-1601]
resolvedSeries(state, leafId, plane): readonly number[]
//   actual: Σceldas + entradas − salidas (antes: Σceldas − salidas).        [FR-1602]
reserveAportes(state, month, plane): number
//   vuelve a ser Σ celdas del tipo; se le quita la resta de moveres.        [FR-1603]

// ── NUEVO ──────────────────────────────────────────────────────────────────
techoBreaches(state): readonly { month: MonthKey; margin: number; excess: number }[]
//   meses con excess > 0, en orden. Derivado de techoScan.                  [FR-1606]
monthReserveOps(state, month): readonly ReserveOp[]
//   retiros (to=Disponible) Y moveres del mes, para la lista de corrección. [FR-1609]
removeReserveOp(state, movementId): LedgerState
//   generaliza removeReserveRetiro: acepta retiro puro Y mover.             [FR-1609]

// ── SE RETIRA ──────────────────────────────────────────────────────────────
reserveMovers(state, month, plane): number
//   parche de BG-001; innecesario una vez que el mover no escribe celda.
//   Se retira DESPUÉS de que la migración corra (ver Risk Flags, [RISK-5]).

// ── SERVIDOR (src/server/data/ledgerRepo.ts) ───────────────────────────────
ensureV5InTx(tx, ownerId, dataVersion, state): Promise<LedgerState>   [FR-1604]
```

Store (`src/state/store.ts`): `applyReserveWithdrawal` ya acepta `note` y **deja de descartarlo**;
`removeReserveWithdrawal` delega en `removeReserveOp`.

## Implementation Approach

**FR-1601: el mover se journaliza por ambos extremos y no escribe celda**
Method: guarda temprana en la construcción de `writes` de `applyReserveOp` — la escritura de celda del
destino se condiciona a que el ORIGEN sea Disponible (aporte), no solo a que el destino sea real.
I/O: `(state, {from,to,month,amount,date?,note?})` → `{state, movement}` | `{rejected}`. Para un mover,
`state.actuals` sale idéntico y `state.movements` gana un elemento.
Failure: extremos iguales, ambos sentinel, nodo inexistente, monto ≤0/no entero → `"invalid_target"`
sin mutar. Violación de piso en la cadena → `{rejected:{rule:"piso",…}}` sin mutar. El techo **deja de
poder rechazar un mover**, y es correcto: un mover no cambia el neto reservado del mes.

**FR-1602: el saldo derivado suma las entradas**
Method: índice por hoja de una sola pasada (`reserveIndex`, ADR-05) que devuelve `{in[12], out[12]}`;
`resolvedSeries` acumula `celdas[i] + in[i] − out[i]`. Sustituye a `retirosByMonth`, que recorría el
journal completo **por hoja**.
I/O: `(state, leafId, plane)` → `readonly number[12]`. En `budget` no hay journal: sigue siendo el
acumulado de celdas planeadas.
Failure: hoja desconocida → `[0×12]`; un movimiento con mes inválido se ignora (comportamiento actual).

**FR-1603: una sola cifra de lo reservado**
Method: retirar la resta compensatoria de `reserveAportes` y de `reserveRetiros`. `reserveRetiros`
conserva la condición `isAvailable(m.to)` que ya introdujo el arreglo de BG-001 — sigue siendo la
definición correcta y no depende del parche.
I/O: `(state, month, plane)` → `number`. Failure: nunca lanza; un mes sin datos devuelve 0.
Cierra la mitad de presentación de **BG-001**.

**FR-1604: migración v4→v5**
Method: transformación dirigida dentro de la MISMA transacción que estampa el marcador, calcada de
`ensureV4InTx`. Para cada movimiento transfer con ambos extremos reales, restar su monto de la celda
`(to, month, 'actual')`. **La idempotencia la da el MARCADOR, no la aritmética** — restar dos veces
sería incorrecto, exactamente como en v3→v4.
I/O: `(tx, ownerId, dataVersion, state)` → `LedgerState` migrado; escribe celdas y `data_version=5`.
Failure: si la resta dejara una celda negativa (posible solo si el usuario editó a la baja la celda del
destino DESPUÉS del mover), se acota a 0 y el residuo se registra en el log de migración — ver
[RISK-1]; nunca se escribe un valor que viole `CHECK (amount >= 0)`. Fallo a mitad → `ROLLBACK`
completo: ni celdas convertidas ni marcador.

**FR-1605: «Máx. N» en el editor de celda**
Method: `availableMargin(state, month)` ya existe y devuelve exactamente el límite que el dominio usa
para rechazar; el editor lo lee al montar y en cada tecleo compara `valor − actual` contra él.
I/O: `(state, month)` → `number` → render `Máx. {money(n)}`, color según `tecleado − actual > n`.
Failure: el indicador es informativo; si el cálculo diera 0 el editor lo muestra y el commit sigue
gobernado por `validateReserveWrite` — **la fuente de verdad del rechazo no cambia**, así que un
indicador equivocado nunca deja pasar una escritura inválida.

**FR-1606: señal de techo roto**
Method: `techoBreaches(state)` sobre `techoScan(state,'actual').excess` — el MISMO cálculo que decide
los bloqueos, expuesto (ADR-03). Un solo selector memoizado devuelve los doce meses; el encabezado
consulta el mapa, no recalcula por columna.
I/O: `(state)` → `[{month,margin,excess}]` (vacío en estado sano) → ícono en el encabezado + franja.
Failure: puramente derivado; no bloquea nada y no ofrece corrección automática (decisión de UX: cuál
lado está mal lo sabe el usuario). Durante la hidratación no se pinta.
Cierra **BG-002 (transferencias)**.

**FR-1607: retiro desde la fila de la alcancía**
Method: extraer el popover de `WithdrawCell` a un componente compartido con dos modos de origen
(`"choose" | "fixed"`) (ADR-04); la fila monta el trigger en modo `fixed`.
I/O: `(leafId, month)` → misma `applyReserveWithdrawal` que la fila del Balance → mismo toast + Deshacer.
Failure: monto > saldo → botón inerte y «Máx.» en alerta; rechazo del dominio → mensaje inline, el
popover no se cierra. Cierra **BL-019**.

**FR-1608: nota «¿para qué?»**
Method: conectar el parámetro `note` que `applyReserveWithdrawal` ya acepta y hoy se descarta; la
normalización (`normalizeNote`, ≤280, vacío→null) ya existe y se reutiliza sin tocarla.
I/O: `(from, month, amount, note?: string|null)` → movimiento con `note`.
Failure: >280 → contador en alerta y no se guarda; vacío → `null`.

**FR-1609: corregir un mover**
Method: `removeReserveOp` relaja la guarda de `removeReserveRetiro` para aceptar también un mover. Es
seguro **solo después de FR-1601**: al no escribir celda, quitar el movimiento restaura por
construcción — el mismo argumento que ya sostiene la eliminación de un retiro puro.
I/O: `(state, movementId)` → `LedgerState` (el mismo objeto si el id no es eliminable).
Failure: id inexistente, tipo equivocado o extremo ya borrado → estado intacto, nunca lanza.
Completa **BG-001** por su mitad de corrección.

## Security Design

La Fase 1 declaró seguridad **no aplicable** (NFR-1610) y el diseño lo sostiene: esta feature no añade
ni modifica rutas HTTP, no toca autenticación ni sesiones, no maneja secretos ni datos de terceros y no
acepta entrada de red nueva. Las fronteras de confianza del producto no se mueven: la única entrada no
confiable sigue siendo el cuerpo de `PUT /api/v1/ledger`, validado en forma por `ledgerPutSchema` (Zod)
y con el `ownerId` **impuesto por el parámetro del servidor, nunca leído del payload** — ese control se
preserva intacto. La nota de FR-1608 es texto del propio usuario que se renderiza como texto en React
(escapado por defecto), con el mismo tratamiento que las observaciones de celda ya vigentes.

Queda anotado, y fuera de alcance por decisión de la Fase 1: `PUT /api/v1/ledger` **no valida los
invariantes del dominio**, solo la forma del JSON (BG-002 de la feature `backend`). Esta feature reduce
la incidencia —el techo deja de ser silencioso— pero no cierra esa puerta.

## Performance & Scalability

- **Un índice, una pasada.** Hoy `retirosByMonth` recorre `movements` **por cada hoja** consultada:
  O(H×M). `reserveIndex` lo sustituye por una sola pasada O(M) que llena `{in,out}` de todas las hojas
  a la vez (ADR-05). Con el journal creciendo con el uso, esto mejora el coste actual en vez de
  empeorarlo — que es lo que NFR-1608 exige.
- **Memoización por identidad, conservada.** El índice se memoiza con el mismo `WeakMap` sobre
  `state.movements` que ya usa `resolvedSeries`: cada mutación clona el array, así que la invalidación
  es automática y no hay clave que mantener a mano.
- **`techoBreaches` memoizado igual**, sobre `(budgets, actuals, movements)`. El encabezado de mes lee
  un mapa de 12 entradas ya calculado; **no se llama por columna**.
- **Cotas.** Producto de un solo usuario: nodos en decenas, movimientos en cientos-miles, doce meses
  fijos. Ninguna cota nueva. El guardrail de perf vigente (`tests/domain/rollup-perf.test.ts`) se
  extiende a este camino.

## Deployment Architecture

**Modelo: aplicación Next.js desplegada como proceso Node** (no contenedor, no serverless, no
librería) contra un Postgres gestionado — exactamente el modelo vigente; esta feature no lo cambia.
Entornos: desarrollo local (Postgres y Mailpit vía `docker-compose.dev.yml`, app en `next dev`) y
producción. CI ejecuta la suite unitaria y la e2e en cada push a la rama principal (NFR-1609).

**Lo único con paso de despliegue propio es la migración v4→v5**, y no requiere ventana ni script
aparte: corre sola, dentro de la transacción de la primera lectura o escritura de cada usuario, igual
que la cadena v2→v3→v4 lleva haciéndolo. Rollback: la versión anterior del código lee un ledger v5
**incorrectamente** (contaría los moveres solo por el journal y no vería su llegada en la celda), así
que el retroceso exige restaurar el respaldo de la base, no solo el código. Está en [RISK-4].

## Risk Analysis

### ADR-01: Dónde se anota la llegada de un mover
Context: el mover no tiene contrapartida; hay que dársela.
Option A — **Journal por ambos extremos, sin escritura de celda.** La celda recupera un significado
único; el journal ya lleva las salidas. Exige un término nuevo en el saldo derivado y una migración.
Option B — **Doble asiento en celdas**: sumar en el destino y restar en el origen. Simétrico y legible
en la grilla, pero el origen puede quedar negativo y `amount_cell` declara `CHECK (amount >= 0)`:
obligaría a cambiar el esquema y a que la celda deje de significar «el aporte del mes» (FR-1003).
Decision: **A** — no toca esquema, no rompe FR-1003, y alinea el mover con el retiro, que ya se anota
solo en el journal.
Consequences: habilita FR-1609 (borrar un mover restaura por construcción) y la retirada del parche
`reserveMovers`. Obliga a la migración FR-1604 y a que ninguna lectura de saldo se salte el índice.

### ADR-02: Forma de la migración v4→v5
Context: los moveres ya guardados escribieron la celda del destino; con el modelo nuevo se contarían dos veces.
Option A — **Resta dirigida**: por cada mover del journal, restar su monto de la celda del destino.
Mínima superficie; idempotencia por marcador.
Option B — **Recomputar todas las celdas** desde el journal. Suena más limpio, pero es imposible: las
celdas son la ÚNICA fuente de los aportes tecleados en la grilla, que no dejan rastro en el journal.
Recomputarlas los borraría.
Decision: **A**. Consequences: la idempotencia depende del marcador `data_version`, no de la
aritmética — restar dos veces corrompería. El marcador es carga estructural, no adorno.

### ADR-03: De dónde sale la señal de techo
Context: FR-1606 necesita saber qué meses exceden el margen.
Option A — **Exponer `techoScan`**, que ya calcula `excess[12]` y es lo que decide los bloqueos.
Option B — Un cálculo nuevo en la capa de presentación. Más libre, pero abre la puerta a que la señal
y el bloqueo discrepen — el defecto exacto que esta feature existe para cerrar.
Decision: **A** — una sola aritmética, una sola verdad. Consequences: `techoScan` deja de ser privada;
su firma pasa a ser superficie y hay que memoizarla.

### ADR-04: Una puerta nueva de retiro o dos componentes
Context: FR-1607 añade una segunda entrada al mismo retiro.
Option A — **Un popover compartido con dos modos de origen** (`choose` | `fixed`).
Option B — Un componente propio para la fila. Independencia, a cambio de garantizar que las dos puertas
diverjan con el tiempo — y AC-1622 exige que produzcan movimientos indistinguibles.
Decision: **A**. Consequences: `WithdrawCell` se refactoriza para extraer el popover; el refactor toca
código cubierto por TCs vigentes de `transferencias`, que deben seguir verdes sin tocarlos.

### ADR-05: Índice de journal por hoja
Context: `resolvedSeries` necesita ahora entradas Y salidas por hoja y por mes.
Option A — **Un índice de una pasada** que llena `{in,out}` de todas las hojas.
Option B — Dos funciones al estilo actual (`retirosByMonth` + `moversInByMonth`), cada una recorriendo
el journal por hoja: duplica un coste que ya era O(H×M).
Decision: **A** — cumple NFR-1608 mejorando el coste vigente en lugar de empeorarlo.
Consequences: una estructura memoizada más; su invalidación va atada a la identidad de
`state.movements`, como la que ya existe.

## Technical Risk Flags

[RISK-1] Migración: la celda del destino pudo editarse a la baja después del mover
Conflict: FR-1604 resta el monto del mover de la celda del destino, pero `amount_cell` declara
`CHECK (amount >= 0)`; si el usuario editó esa celda por debajo del monto del mover, la resta daría
negativo — y NFR-1603 exige que los saldos derivados no cambien de valor.
Mitigation: acotar a 0 y registrar el residuo en el log de migración, de modo que el desvío sea
VISIBLE en vez de silencioso. Verificado sobre los datos reales del usuario: el único mover existente
(9.200.300) tiene la celda del destino exactamente en 9.200.300, así que resta a 0 limpio y el saldo
derivado no se mueve. Phase 3 debe cubrir el caso patológico como test de borde.
Severity: high

[RISK-2] La memoización puede servir un saldo obsoleto si el índice se invalida por otra clave
Conflict: NFR-1603 exige exactitud del saldo; `resolvedSeries` memoiza por identidad de
`(map, movements)` y el índice nuevo debe invalidarse por EXACTAMENTE lo mismo.
Mitigation: colgar el índice del mismo `WeakMap` sobre `state.movements` ya en uso, no de una clave
propia. Phase 3 debe incluir un test que mute el journal y verifique que el saldo cambia.
Severity: medium

[RISK-3] Retirar `reserveMovers` antes de que la migración haya corrido
Conflict: FR-1603 retira el parche, pero un ledger todavía en v4 tiene las llegadas de moveres dentro
de las celdas; sin el parche y sin migrar, `reserveAportes` las contaría como aportes.
Mitigation: la migración corre dentro de la misma transacción de la primera lectura, así que ningún
código de la app llega a ver un estado v4 — pero el orden es carga estructural: la retirada del parche
NO puede desplegarse sin `ensureV5InTx`. Se anota como ítem de despliegue, no como opción.
Severity: medium

[RISK-4] El retroceso de versión no es solo de código
Conflict: la Deployment Architecture asume rollback por despliegue; el código v4 leyendo datos v5
mostraría saldos incorrectos (vería el journal del mover pero no su llegada, que ya no está en la celda).
Mitigation: documentar que el rollback exige restaurar el respaldo de la base. Producto de un solo
usuario con respaldo trivial; se acepta.
Severity: medium

[RISK-5] El servidor sigue sin validar invariantes
Conflict: NFR-1604 promete que techo y piso siguen bloqueando, pero `PUT /api/v1/ledger` acepta
cualquier snapshot que cumpla la forma del JSON — la garantía es del cliente, no del sistema.
Mitigation: fuera de alcance por decisión de la Fase 1 (BG-002 de `backend`). Esta feature reduce la
probabilidad de llegar a un estado inválido —el techo deja de ser silencioso— pero NO cierra la puerta,
y el diseño no debe presentarse como si lo hiciera.
Severity: medium (aceptado, con constancia)

[RISK-6] El refactor del popover toca código ya verificado
Conflict: ADR-04 extrae el popover de `WithdrawCell`, cubierto por TCs vigentes de `transferencias`.
Mitigation: la extracción es mecánica y los TCs existentes se ejecutan SIN modificarse — si alguno
necesita cambiar, es señal de que el refactor cambió comportamiento y hay que revisarlo, no ajustar el
test. NFR-1606 lo protege explícitamente.
Severity: low

## Failure Blast Radius

Component: Postgres / `ledgerRepo` — migración v4→v5
Blast radius: si la migración falla, la transacción revierte y el ledger queda en v4; la app no puede
leer con código v5 y el arranque del usuario falla.
User impact: la app no carga sus datos y muestra el aviso de persistencia vigente (`StorageBanner` en
modo `network`/`malformed`); **no ve datos corruptos ni parciales** — el todo-o-nada lo garantiza la
transacción.
Recovery: reintento en la siguiente carga (la migración es reentrante por el marcador). Si el fallo
persiste, restaurar el respaldo; el esquema no cambió, así que el respaldo v4 es directamente válido.

Component: Dominio de reserva (`src/domain/reserve.ts`)
Blast radius: es puro y síncrono — no falla por indisponibilidad, solo por lógica. Un error aquí se
propaga a los saldos, al Balance y a las dos señales nuevas a la vez.
User impact: cifras incorrectas sin ningún síntoma visible — el modo de fallo más peligroso del
producto y la razón de que NFR-1601 a NFR-1607 existan.
Recovery: no hay recuperación en runtime; la red es la suite (conservación, Σderivados, saldos exactos)
y el gate de mutación, que es lo único que detecta un test que pasa sin ejercitar nada.

Component: Store + `ServerRepository` (persistencia del cliente)
Blast radius: si el PUT no llega, la mutación vive solo en memoria.
User impact: aviso `network` vigente; lo que se ve en pantalla no está guardado.
Recovery: comportamiento actual sin cambios — reintento en la siguiente mutación y resync por SSE.

## Traceability Checklist
- [x] Todo FR está atendido por al menos un componente — FR-1601/1602/1603/1604 en el dominio y el
      repositorio; FR-1605/1606/1607/1608/1609 en dominio + UI
- [x] `Implementation Approach` tiene entrada para los NUEVE MUST FR
- [x] Todo NFR tiene decisión de diseño: NFR-1601..1607 (regresión) → la suite y el contrato de
      preservación; NFR-1608 → ADR-05 y memoización; NFR-1609 → CI; NFR-1610/1611/1612 → exclusiones
      restatadas; NFR-1613 → ADR-04 y FR-1605
- [x] Los cinco ADR evalúan ≥2 opciones
- [x] Ningún ítem del `no_go_zone` aparece en la arquitectura — sin envelope budgeting, sin validación
      en servidor, sin destinos nuevos de retiro, sin pantalla de ajustes
- [x] Blast radius documentado para tres componentes críticos
- [x] Technical Risk Flags con seis banderas declaradas
