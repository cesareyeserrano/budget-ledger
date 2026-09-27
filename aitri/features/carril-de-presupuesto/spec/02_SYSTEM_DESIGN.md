# Technical Design Document (TRD / SDD) — carril-de-presupuesto

## Executive Summary

Presupuestado y Ejecutado pasan a calcular igual, cada uno sobre sus propios datos. Es un cambio de REGLA en el
dominio puro, sin tecnología nueva, sin esquema nuevo y sin endpoint nuevo:

- `computeBalanceSeries` (`src/domain/balance.ts`) lleva DOS acumuladores en vez de uno: cada plano abre el mes
  con su propio cierre anterior (FR-2901). Los dos arrancan del mismo `opening` (FR-2902).
- `techoScanRaw` (`src/domain/reserve.ts`) calcula el barrido del plano pedido con el arrastre DE ESE plano: el
  margen, el consumo, el arrastre y el déficit del plan salen del carril del plan (FR-2903).
- `chainCheck` deja de devolver «avisos» para el plan: aplica techo, piso y déficit a los dos planos y
  BLOQUEA en los dos, con el mismo criterio de «solo lo que la escritura empeora» (FR-2904).
- El guardia del servidor (`worsenedBy`, `src/domain/guard.ts`) juzga también el plano Pres. (FR-2906).
- La UI reutiliza en Pres. el editor, la pastilla «Máx.» y la franja de rechazo que ya usa Ejec., y retira el
  aviso ámbar «!» del plan; los meses del plan que se pasan salen en el triángulo del mes (FR-2905).

Stack sin cambios (versiones instaladas el 2026-09-27): Next.js 15.5.25 (App Router), React 19.3.0,
TypeScript 5.9.3, Zustand 5.0.15, drizzle-orm 0.45.3 sobre PostgreSQL 16.14, Vitest 4.1.11 y Playwright 1.63.0. Ninguna dependencia nueva (constraint de Phase 1).

## System Architecture

```
┌─────────────────────────── Navegador ────────────────────────────┐
│ BudgetGrid ─┬─ ReserveLeafCell (Pres./Ejec.)   [sin «!» del plan]│
│             ├─ ReserveCellEditor (Pres./Ejec.) [Máx. + rechazo   │
│             │                                    en los 2 planos]│
│             └─ encabezado de mes ── monthIssues ─┐               │
│ BalanceModule ─ computeBalanceSeries ─┐          │ (techo +      │
│               └ franja ─ monthIssues ─┼──────────┘  techo_plan)  │
│ useLedgerStore.applyReserveEdit ─ applyReserveCellEdit           │
│                                   └ validateReserveWrite         │
│                                     └ chainCheck(plane)          │
│                                       └ techoScan(plane) ── techoScanRaw(plane)
└───────────────────────────────┬──────────────────────────────────┘
                                │ PUT /api/v1/ledger (snapshot)
┌──────────────────────── Servidor Next.js ────────────────────────┐
│ saveLedger ── worsenedBy ── chainCheck("actual") + chainCheck("budget")
│            └ 422 domain_rule_violation si alguno empeora          │
└───────────────────────────────┬──────────────────────────────────┘
                                │ Drizzle (sin cambios)
                        PostgreSQL (sin cambios)
```

Componentes y responsabilidad en esta feature:
- **computeBalanceSeries** — las seis cifras por mes y plano. Cambia de un acumulador compartido a uno por plano.
- **techoScanRaw / techoScan** — barrido de doce o más periodos de UN plano: margen, consumo, arrastre, exceso y
  déficit. Cambia el arrastre del plano Pres. La memoización por identidad no cambia.
- **chainCheck** — las tres reglas sobre un candidato vs. la base, para un plano. Cambia: bloquea en Pres.
- **chainedAporteSlack / cellHeadroom** — el «Máx.» de la celda. Cambia: en Pres. mira la cadena completa, como Ejec.
- **monthIssues / monthIssueText** — problemas por mes. Añade el problema del plan (`techo_plan`).
- **worsenedBy** — guardia del servidor. Añade el plano Pres.
- **ReserveLeafCell / ReserveCellEditor** — celdas de bolsillo. Retiran el aviso del plan; muestran «Máx.» en Pres.
- **BudgetGrid / BalanceModule** — pintan los problemas del mes; ya consumen `monthIssues`, solo aprenden el kind nuevo.

## Data Model

Contrato de preservación: NADA de lo guardado cambia (NFR-2906).
- Tablas `ledger`, `node`, `amount_cell`, `movement`, `cell_note`, `closure_event`, `cycle_config_version`,
  `relocation_origin`: sin columnas, índices ni CHECK nuevos. Sin migración de Drizzle.
- `LedgerState` (`src/domain/types.ts`): sin campos nuevos. `budgets[@retiros]` sigue siendo el retiro planeado
  por mes.

Delta (solo en memoria, derivado):
- `MonthIssue` gana una variante:
  `{ kind: "techo_plan"; period: PeriodKey; margin: number; excess: number }` — el mes cuyo PLAN reserva más de
  lo que el plan deja disponible. Misma forma que `techo` a propósito: las superficies que solo pintan la cifra
  no ramifican.
- `TechoScan` (tipo interno) no cambia de forma; cambia el contenido de `arrastre`, `margin` y `deficit` cuando
  `plane === "budget"`.

## API Design

HTTP — contrato preservado: ningún endpoint nuevo, ningún cambio de ruta, método, auth ni cuerpo.
- `PUT /api/v1/ledger` — `{ baseRevision, state }` → 200 `{ revision }` | 409 `revision_conflict` |
  422 `closed_period_violation` | 422 `period_mismatch` | 422 `domain_rule_violation` |
  422 `cell_movement_mismatch`. CAMBIA SOLO QUÉ dispara `domain_rule_violation`: ahora también una escritura que
  empeora el plano Pres. Cuerpo de error igual que hoy:
  `{ error: { code: "domain_rule_violation", detail: { violations: [{ rule: "techo"|"piso"|"deficit", period, leafId?, limit }] } } }`.
  El orden de guardias no cambia: cierre primero (ADR-19 de cierre-de-mes), luego periodo, luego dominio.
- `POST /api/v1/movements` — sin cambios: solo escribe Ejecutado.

Módulos internos (TypeScript) — firmas que se preservan y lo que cambia:
- `computeBalanceSeries(state, periods, opening = ZERO_CARRY): BalanceSeries` — misma firma. `opening` siembra
  los DOS planos en `periods[0]`.
- `chainCheck(base, cand, plane, affectedLeaves, periods): ChainResult` — misma firma. `warnings` queda siempre
  vacío; `blocking` se llena en los dos planos.
- `validateReserveWrite(...)`, `applyReserveCellEdit(...)` — misma firma; en Pres. pueden devolver `ok:false` /
  `rejected`, como en Ejec.
- `cellHeadroom(state, leafId, month, plane, periods): number` — misma firma; en Pres. deja de acotar solo su mes.
- `monthIssues(state, periods): readonly MonthIssue[]` — misma firma; añade `techo_plan`.
- `monthIssueText(issue, money): string` — añade el texto «Plan: reservas {X} por encima del margen del mes».
- `worsenedBy(prev, next, periods): ReserveWarning[]` — misma firma; añade el plano Pres.
- `planTechoMonths(...)` — SE RETIRA (su único consumidor era el aviso ámbar de la celda).

## Implementation Approach

FR-2901: El Balance Pres. arrastra su propio saldo
Method: dos acumuladores `Carry` en `computeBalanceSeries` (`prevBudget`, `prevActual`), cada uno actualizado con
el `MonthBalance` de su plano al final del mes. `monthBalance` no cambia.
I/O: `(state, periods, opening)` → `BalanceSeries` con `budget.prevAvailable/prevReserved` = cierre Pres. de
`periods[i-1]`.
Failure: celdas ausentes resuelven 0 como hoy; un rango vacío devuelve serie vacía; nada lanza.

FR-2902: El primer mes abre los dos carriles en el mismo punto
Method: los dos acumuladores se inicializan con el mismo `opening` (el que el llamador pasa: `openingCarry` del
saldo inicial declarado, o `ZERO_CARRY`). En `techoScanRaw`, `availBudget` y `availActual` arrancan en
`openingCarry(state, periods).available`.
I/O: `periods[0]` → `prevAvailable` igual en los dos planos.
Failure: saldo inicial no declarado o corrupto → `openingCarry` ya lo normaliza a 0 (FR-2207); no cambia.

FR-2903: Todo lo que el plan deriva de su arrastre lee el carril del plan
Method: `techoScanRaw(state, "budget", periods)` lleva `availBudget` = `availBudget + flowBudget − deltaBudget` y
publica `arrastre`/`deficit` desde él; `margin = max(0, availBudget_prev + flowBudget)`. Como `monthCarryUsage`,
`cellHeadroom` y `monthIssues` ya leen el barrido del plano pedido, heredan el carril sin cambio propio.
`chainedAporteSlack` deja de cortar en el propio mes cuando `plane === "budget"`: aplica los mismos límites
encadenados (techo de meses posteriores, déficit) que en Ejec.
I/O: `techoScan(state, "budget", periods)` → `{ excess, margin, consumo, arrastre, deficit }` del carril del plan.
Failure: sin reservas en el plan → consumo 0, sin exceso ni observación (AC-2910); nada lanza.

FR-2904: Las reglas de reservas bloquean en Pres. igual que en Ejec.
Method: `chainCheck` aplica al plano recibido las tres reglas con el criterio «candidato vs. base»: piso por
bolsillo sobre `resolvedSeries(cand, leaf, plane)` (en Pres. es el acumulado de aportes planeados, que no baja de
0 mientras el retiro planeado siga siendo una fila global), techo por mes y déficit por mes. Se elimina la rama
`if (plane === "budget") return { blocking: null, warnings }`. `setPlannedRetiro` conserva su propio tope
(`plannedRetiroLimit`, NFR-2907).
I/O: `(base, cand, plane, leaves, periods)` → `{ blocking: ReserveWarning | null, warnings: [] }`.
Failure: una escritura que empeora cualquier regla en cualquier mes → `blocking` con el mes más temprano y el
límite operativo (mínimo entre las violaciones de delta, como hoy); estado intacto. Un plan legado que ya
violaba → no bloquea escrituras que no lo empeoran (AC-2913, AC-2914).

FR-2905: El editor Pres. se comporta como el de Ejec. al rechazar
Method: `ReserveCellEditor` calcula `headroom` en los dos planos (`cellHeadroom(data, leaf, month, plane,
periods)`), y su `commit` ya usa `validateReserveWrite` + `blockMessage` → el rechazo en Pres. sale por el mismo
camino. `ReserveLeafCell` retira `planWarn`, el glifo «!», el color `--state-warning`, el `title` y
`data-plan-warn`; `BudgetGrid` deja de calcular `planWarnMonths`. `monthIssues` añade `techo_plan` desde
`techoScan(state, "budget")`; el triángulo del encabezado y la franja del Balance lo pintan con `monthIssueText`.
La franja del Balance hoy tiene texto propio por kind: se añade la rama `techo_plan`.
I/O: tecleo → `{ block: string | null }` en el editor; `monthIssues` → lista con `techo_plan`.
Failure: validación síncrona sin red; si el servidor rechazara después (otra pestaña), el store hace `resync` y
avisa por `StorageBanner`, como hoy.

FR-2906: El servidor aplica las reglas del plan
Method: `worsenedBy` llama a `chainCheck` con "actual" y con "budget" sobre los mismos `prev`/`next` y devuelve
el `blocking` del periodo más temprano entre los dos. `touchesReserves` ya compara `budgets` y `actuals`, así que
el acotamiento a escrituras de reservas se conserva (NFR-2908).
I/O: `(prev, next, periods)` → `ReserveWarning[]` (0 o 1 elemento).
Failure: `saveLedger` devuelve `domainViolation` y la ruta responde 422 sin escribir; la transacción no abre
ninguna escritura antes del guardia (FR-2101).

## Security Design

No aplica (NFR-2910): la feature no añade endpoints, entradas aceptadas, sesiones ni secretos. FR-2906 añade una
regla de dominio al guardia ya existente de `PUT /api/v1/ledger`, que conserva `withApi` (sesión obligatoria,
validación Zod del cuerpo, allowlist de Origin en mutaciones) y el aislamiento por `ownerId` de la sesión.
Frontera de confianza sin cambios: el snapshot del cliente sigue siendo no confiable y el servidor lo compara con
el estado que él mismo carga dentro de la transacción (`for update`). Añadir el plano Pres. al guardia CIERRA una
vía, no abre ninguna: hoy un snapshot fabricado podía guardar un plan que la UI habría rechazado.

## Performance & Scalability

- `computeBalanceSeries`: sigue siendo una pasada por periodo; el segundo acumulador es una suma más por mes
  (NFR-2909).
- `techoScan` sigue memoizado por identidad `(movements, map del plano, periods, plane)`. El plano Pres. ya tenía
  su entrada en caché; lo que cambia es su contenido, no el número de barridos por render.
- `worsenedBy` hace un barrido más en el servidor (plano Pres.) solo cuando la escritura toca reservas: O(P) con
  P ≤ 36 periodos; despreciable frente a la transacción.
- `monthIssues` lee un barrido más (Pres.), también memoizado.
- Límite de datos sin cambios: horizonte de 1 o 2 años más lo que exista (FR-1904).

## Deployment Architecture

Modelo: contenedor Docker (`next start`) detrás de Nginx en Ultron (Raspberry Pi 5), sin cambios. Sin migración:
la imagen nueva se despliega igual que cualquier release (develop → staging → main por PR, merge commit; el
usuario corre el despliegue y `scripts/verificar-prod.sh`). CI existente (build-and-test en PR y en push a main)
corre las pruebas nuevas sin tocar el workflow (NFR-2912).

## Risk Analysis

1. **Revierte reglas aprobadas y probadas.** FR-906/ADR-03 de balance, el «avisa sin bloquear» de FR-1008 de
   transferencias y NFR-2805 de retirar-para-gastar («el plano Presupuestado no cambia… sus avisos que no
   bloquean») tienen pruebas que fallarán por diseño. Mitigación: se reescriben, no se borran, cada una citando
   FR-2901/FR-2904 como la regla que la sustituye; el ancla de TC-CDM-222f se avanza como hizo retirar-para-gastar.
2. **Planes legados que ya se pasan.** Al abrir, los meses del plan que exceden aparecerán con el triángulo del
   mes. Es lo buscado (el plan se comporta como Ejec.), y el criterio «solo bloquea lo que empeora» impide que un
   plan viejo congele escrituras ajenas.
3. **Divergencia navegador–servidor.** Si el navegador bloquea en Pres. y el servidor no (o al revés), el usuario
   vería rechazos inexplicables o planes que no se guardan. Mitigación: los dos llaman a la misma `chainCheck`
   (constraint de Phase 1) y FR-2906 tiene pruebas de integración contra la API real.
4. **Cifras Pres. distintas en producción.** El usuario verá cambiar la columna Pres. de su ledger real al
   desplegar. Es el efecto buscado; se le avisa antes del despliegue.

ADR-01: De dónde arranca cada mes del plan
Context: FR-2901 pide que Pres. arrastre su propio saldo; ADR-03 de balance (2026-07-27) hacía lo contrario.
Option A: carril propio puro — dos acumuladores, cada plano sobre sus datos. Simula el año; un mes peor que el
plan no se refleja en los Pres. siguientes.
Option B: carril propio solo en meses futuros — los meses ya terminados re-anclan al real. Evita arrancar sobre
plata inexistente; mezcla las dos lógicas, que es lo que el usuario llamó «mezcla rara».
Option C: dejar ADR-03 (todo re-anclado al real). No permite planear hacia adelante.
Decision: A — elegida por el usuario el 2026-09-27 conociendo B y C y el caso de julio que motivó ADR-03.
Consequences: Pres. y Ejec. se leen como dos trayectorias independientes desde el mismo origen; la desviación se
lee comparando columnas.

ADR-02: El plan bloquea o avisa
Context: FR-2904 («comportamientos iguales»). Hoy el plan avisa con un «!» ámbar y nunca rechaza.
Option A: bloquear en Pres. con las mismas reglas que Ejec. Consistente; el plan deja de admitir planes
imposibles.
Option B: seguir avisando en Pres. con el cálculo nuevo. Más permisivo; mantiene dos comportamientos.
Decision: A — confirmado por el usuario («no, no debe, comportamientos iguales»).
Consequences: se retira el aviso ámbar y `planTechoMonths`; el rechazo en Pres. usa el editor de Ejec.

ADR-03: Cómo se señala un mes del plan que ya se pasa
Context: sin el «!» por celda, un plan legado que excede necesita una señal.
Option A: el triángulo del mes y la franja del Balance, con un kind nuevo `techo_plan`. Es lo que Ejec. usa.
Option B: conservar el «!» por celda solo para planes legados. Dos sistemas de aviso.
Decision: A — consistencia con Ejec. (UX spec, H4 y H8).
Consequences: `MonthIssue` gana una variante; las superficies que ramifican por kind (franja del Balance) añaden
su texto.

ADR-04: Dónde aplica el servidor la regla del plan
Context: FR-2906.
Option A: dentro de `worsenedBy`, llamando a `chainCheck` con los dos planos. Un solo punto de estrangulamiento.
Option B: una comprobación aparte en `saveLedger`. Duplica el acotamiento a escrituras de reservas.
Decision: A — mantiene «una regla, todas las puertas» (FR-2101) sin tocar `saveLedger`.
Consequences: el guardia hace un barrido más solo cuando la escritura toca reservas.

## Failure Blast Radius

Component: dominio de reservas (`techoScanRaw` / `chainCheck`)
Blast radius: todas las escrituras de reservas en los dos planos, en navegador y servidor.
User impact: un error de cálculo rechazaría escrituras válidas o aceptaría inválidas; un rechazo indebido se ve
como una franja roja con un límite que no cuadra.
Recovery: pruebas de dominio con los números de los AC y la prueba de propiedad existente del «Máx.» exacto
(límite aceptado, límite + 1 rechazado) extendida a Pres.; rollback del release si aparece en producción.

Component: guardia del servidor (`saveLedger` → `worsenedBy`)
Blast radius: todos los PUT que tocan reservas.
User impact: si rechazara de más, el navegador recibiría 422, haría `resync` y el `StorageBanner` avisaría que
el cambio no se guardó.
Recovery: la transacción no escribe nada antes del guardia; basta con corregir y redesplegar. Sin datos dañados.

Component: PostgreSQL
Blast radius: sin cambios respecto de hoy; la feature no lo toca.
User impact: el de siempre (la app no carga datos).
Recovery: el de siempre (contenedor con `restart: unless-stopped`, respaldos pg_dump).

## Technical Risk Flags

[RISK] Pruebas aprobadas de otras features fijan la regla vieja
Conflict: FR-2901 y FR-2904 requieren cambiar `computeBalanceSeries`, `techoScanRaw` y `chainCheck`, pero
TC-BAL-915e (balance), las pruebas de FR-1008 (transferencias), las de NFR-2805 (retirar-para-gastar) y el ancla
de TC-CDM-222f (cierre-de-mes) fijan la regla vieja.
Mitigation: reescribirlas en el build citando la regla nueva, y avanzar el ancla de TC-CDM-222f al commit de esta
feature. Se listan en el BUILD_PLAN para que ninguna se borre en silencio.
Severity: medium

[RISK] Planes guardados que la regla nueva marca como error
Conflict: FR-2905 marca los meses del plan que exceden, pero ledgers reales pueden tener planes escritos cuando
el plan solo avisaba.
Mitigation: FR-2904 bloquea solo lo que empeora; la marca es informativa y no impide cerrar el mes (el cierre
solo lo bloquean los descuadres, FR-2512). Se revisa el ledger de pruebas antes de desplegar.
Severity: low
