# System Architecture — Feature: balance

## Executive Summary

El módulo de Balance es una **capa de derivación pura** sobre el estado existente del ledger (`nodes`, `budgets`, `actuals`, `movements`), en el MISMO patrón que `src/domain/rollup.ts`: funciones puras que calculan, no persisten. Añade un archivo de dominio `src/domain/balance.ts` (las seis cifras por mes × dos planos, con arrastre) y un componente de presentación al pie de `BudgetGrid.tsx`, más un cambio de layout para separar el bloque Transferencia (FR-904).

Ninguna cifra del balance se almacena: todas se recalculan del store en cada render (FR-908 se satisface "gratis" por reactividad de Zustand + `useMemo` a nivel de componente, el mismo patrón que ya usan `DesktopShell.tsx` y `BudgetGrid.tsx`). **v1 es puramente ADITIVO:** solo se guarda en reservas (aportes ≥ 0), así que NO toca el modelo de datos ni el `CHECK amount >= 0` del schema — cero blast-radius de persistencia. "Sacar" de una reserva se difiere a la feature `transferencias` (ADR-02).

Alcance: NO se re-implementan las filas de agregación existentes (total por tipo, subtotales) — el balance las consume vía `typeTotals`/`rollup`. NO hay endpoints nuevos: el balance se deriva en el cliente.

## System Architecture

Capas (todas ya existen salvo las marcadas NUEVO):

- **Dominio** (`src/domain/`): funciones puras. NUEVO `balance.ts` — consume `LedgerState` y produce la serie de balance. Reutiliza `rollup.ts`/`typeTotals`, `months.ts`, `types.ts`.
- **Estado** (`src/state/store.ts`, Zustand + localStorage): fuente única en memoria. No añade estado persistido. El `BalanceModule` se suscribe a `s.data` (como el resto de la grilla) y deriva con `useMemo(() => computeBalanceSeries(data), [data.nodes, data.budgets, data.actuals])` — el patrón que ya usa el repo (DesktopShell/BudgetGrid), NO un selector memoizado de store: Zustand v5 vanilla no memoiza selectores y devolver un objeto nuevo por llamada sería el footgun "getSnapshot should be cached".
- **Presentación** (`src/components/BudgetGrid.tsx` + NUEVO `BalanceModule`): filas de solo lectura al pie de la grilla, reutilizando la rejilla de columnas (columna fija + meses × {Pres., Ejec.}) y las superficies `--bg-sunken`. Cambio de layout para el separador de Transferencia (FR-904).
- **Persistencia** (localStorage v1; Postgres vía feature backend): sin tablas nuevas y **sin tocar el schema ni el `CHECK`** — v1 solo guarda aportes ≥ 0, que el modelo actual ya acepta.

Flujo de datos: `store (s.data)` → `useMemo` en `BalanceModule` → `computeBalanceSeries(data)` en `balance.ts` → render. Cualquier mutación del store hace `set({data})` con objeto nuevo → el `useMemo` recomputa → re-render.

**Blast radius — `balance.ts` (componente crítico #1):** si su cálculo falla o lanza, el `BalanceModule` cae al estado `error` (una fila "No se pudo calcular el balance") y el RESTO de la grilla sigue funcionando (el fallo se aísla al módulo, no propaga a las filas de datos). Recuperación: el error es determinista sobre el estado; corregir la entrada o el cálculo. No hay red ni IO — no hay fallo transitorio.

**Blast radius — `BudgetGrid.tsx` (componente crítico #2):** el módulo se monta dentro de la grilla existente; un error de render del `BalanceModule` no debe tumbar la grilla. Mitigación: el módulo es un subárbol aislado al pie; su estado `error` es local. Recuperación: la grilla y su edición siguen operativas aunque el balance no se pinte.

## Data Model

**Sin entidades nuevas.** El balance es derivado. Estructuras reutilizadas (de `types.ts`):
- `AmountMap` (`budgets`, `actuals`): `nodeId → { MonthKey → number }`. El balance lee de aquí vía rollup.
- `LedgerNode` con `type: 'transfer'` y `level: 'sub'|'category'` = un ítem de reserva (alcancía/bolsillo). El saldo de reserva por ítem se DERIVA (no se almacena).

Tipo derivado NUEVO (en memoria, no persistido) en `balance.ts`:
```
type Plane = 'budget' | 'actual';
interface MonthBalance {
  prevAvailable: number;  // arrastrado: cierre del MISMO plano en el mes previo
  prevReserved: number;   // arrastrado: cierre del MISMO plano en el mes previo
  flow: number;           // Ingreso − Gasto del plano
  reserved: number;       // neto transferido del plano (+guardar/−sacar)
  available: number;      // prevAvailable + flow − reserved
  reservedBalance: number;// prevReserved + reserved
  total: number;          // available + reservedBalance
}
type BalanceSeries = Record<MonthKey, { budget: MonthBalance; actual: MonthBalance }>;
```

**Sin cambio de restricción.** v1 solo guarda aportes ≥ 0, que el `CHECK amount >= 0` actual ya acepta. El saldo de reserva por ítem solo crece (nunca negativo). "Sacar" (que exigiría negativos) se difiere a `transferencias` (ADR-02).

## API Design

**Sin endpoints nuevos.** El balance se deriva en el cliente a partir del estado ya cargado.

Contrato del módulo de dominio (API pública de `balance.ts`, comprometida como los `rollup`):
- `computeBalanceSeries(state: LedgerState): BalanceSeries` — calcula los 12 meses × 2 planos en una pasada. I: estado completo. O: la serie. Falla: si un nodo referencia mal, retorna 0 para esa celda (no lanza), igual que `rollup*`.
- `reserveNet(state, month, plane): number` — neto de reserva del mes (suma de actuals/budgets de hojas transfer, con signo).
- Consumo en el componente vía `useMemo(() => computeBalanceSeries(data), [data.nodes, data.budgets, data.actuals])` (patrón del repo), no un selector de store.

El repo backend (`ledgerRepo.ts`) y `api/v1/ledger` NO cambian su contrato: siguen guardando/devolviendo `amount_cell`; solo cambia qué valores acepta (ADR-02).

## Implementation Approach

- **FR-904 (separación Transferencia):** cambio de layout en `BudgetGrid.tsx` — insertar un espaciador (`--border` + gap ~24px) antes del bloque `type='transfer'`. Método: en el render de `TYPE_ORDER`, cuando el tipo es `transfer`, anteponer un `<TransferSeparator/>`. I: orden de tipos (sin cambio de datos). O: DOM con separación. Falla: n/a (solo CSS).
- **FR-905 (seis cifras × dos planos):** `computeBalanceSeries` recorre `MONTH_KEYS` en orden. Para cada mes calcula el plano `actual` (real) y el `budget`. `flow = typeTotals(income).X − typeTotals(expense).X`; `reserved = reserveNet(...)`. I: estado. O: `MonthBalance` por plano. Falla: celdas ausentes → 0.
- **FR-906 (arrastre por plano):** el saldo mes anterior de CADA plano = el cierre de ESE plano en el mes previo (`prevAvailable/prevReserved` del plano = `available/reservedBalance` del mismo plano en el mes i−1). Mes 0 (ene): 0/0 en ambos planos. Las dos cadenas son independientes: el presupuestado acumula su plan, el ejecutado lo real; ninguno lee del otro. Método: dos acumuladores (`prevBudget`, `prevActual`) en la misma iteración. I/O como FR-905. Falla: mes sin previo → 0.
- **FR-907 (guardar; reservado global acumulado):** `reserveNet(state, month, plane)` suma los actuals/budgets de TODAS las hojas transfer del mes (aportes ≥ 0 en v1). El reservado global se acumula = reservado del mes previo + `reserveNet` del mes. No se computa ni se muestra un saldo por alcancía (decisión del usuario: 'global basta'); el módulo muestra solo el reservado global. No requiere almacenar negativos → no toca el CHECK. I: hojas transfer. O: neto (≥ 0). Falla: sin hojas transfer → reservado 0.
- **FR-908 (recalculo en vivo):** ninguna acción explícita — el `useMemo` del `BalanceModule` depende de `data.nodes/budgets/actuals`; toda mutación hace `set({data})` con objeto nuevo, cambia esas referencias y dispara re-render + recálculo. I: cambio de store. O: cifras frescas. Falla: n/a (React/Zustand ya garantizan la propagación que usa el resto de la grilla).

## Security Design

Sin superficie de seguridad nueva. El balance es cálculo derivado de SOLO LECTURA sobre datos ya validados (montos enteros; validación de entrada en `validation.ts`, cubierta por la NFR de seguridad raíz). No maneja secretos, autenticación ni entradas de usuario nuevas; no hace IO ni red. Trust boundary sin cambios: los datos entran por las mismas rutas (edición de celda / registro de movimiento) que ya existen y ya se validan.

v1 NO toca el schema ni el CHECK (solo aportes ≥ 0), así que la integridad numérica del dominio (NFR raíz "sin huérfanos, totales = suma de hojas") se preserva sin cambios. La NFR de seguridad raíz y las de CI/CD/healthcheck se heredan sin cambios (NFR-908).

## Performance & Scalability

`computeBalanceSeries` es O(meses × hojas) = 12 × (nº de hojas), trivial con los datos semilla y realistas (decenas de hojas). Se ejecuta en el cliente. El `useMemo` del componente evita recomputar si `data.nodes/budgets/actuals` no cambiaron. Objetivo NFR-907: actualización imperceptible (<100 ms) tras editar una celda — holgado dado el tamaño. No hay escalado de servidor (derivación cliente). Sin nuevas consultas a Postgres.

## Deployment Architecture

Sin cambios de despliegue. El código nuevo es dominio + componente cliente, incluido en el mismo bundle Next.js. **Sin migraciones** (v1 no toca el schema). Rollback: revertir el bundle; no hay estado nuevo que deshacer.

## Risk Analysis

- **Doble "disponible" en pantalla.** La KPI card "DISPONIBLE" existente (solo gastos) y el "Saldo disponible" del módulo son números distintos con rótulo parecido. NO se rediseña aquí (fuera de alcance); se señala para un item aparte (como BL-005). Riesgo: UX, no técnico.
- **"Toda transferencia cuenta" (v1 solo guardar).** Simplificación consciente; sacar, mover entre reservas y préstamos viven en la feature `transferencias`. No es riesgo de este diseño — es alcance diferido y explícito.

## Technical Risk Flags

**None detected.** Tras (1) diferir "sacar" a `transferencias` — se eliminó la relajación del `CHECK` y todo toque al schema — y (2) hacer los dos planos INDEPENDIENTES (cada uno arrastra su propio cierre) — se eliminó la dependencia de orden de cómputo entre planos — el diseño es cálculo derivado puro sobre el estado existente, sin migraciones, sin red, sin cruce a otras features. El stack es plenamente compatible (mismo patrón que `rollup.ts`). Riesgos remanentes son de UX/alcance (doble "disponible", cubierto en Risk Analysis), no técnicos.

## ADRs

**ADR-01: Dónde vive el cálculo del balance — módulo de dominio puro vs. selector de store vs. cálculo en componente.**
- Opción A (elegida): funciones puras en `src/domain/balance.ts`, como `rollup.ts`. Testeable sin React, reutiliza el patrón existente, sin estado.
- Opción B: lógica en un selector de Zustand. Rechazada: mezcla cálculo con estado, más difícil de testear aislado.
- Opción C: calcular en `BalanceModule` (componente). Rechazada: no testeable sin render, tienta a duplicar rollups.
- Decisión: A. Consistencia con el dominio existente y testabilidad pura.

**ADR-02: Cómo manejar "sacar" de una reserva frente a `CHECK amount >= 0`.**
- Opción A: relajar el CHECK para permitir negativos en celdas transfer-actual (monto con signo). Rechazada: cruza al schema Postgres de la feature backend, exige migración + validación de app + tests de regresión, y una reserva NO puede tener saldo negativo (una alcancía no debe 20) — habría que topar el "sacar" al saldo disponible del ítem, más lógica.
- Opción B: guardar el SALDO ACUMULADO del ítem (siempre ≥0) en vez del neto mensual. Rechazada: cambia la semántica de `amount_cell` (mensual→acumulado) para un solo tipo, rompe `rollup`/`typeTotals`.
- Opción C (elegida): **diferir "sacar" a la feature `transferencias`.** v1 de balance solo GUARDA (aportes ≥ 0): la reserva solo crece, nunca queda negativa, y NO se toca el schema. `transferencias` hará las transferencias calculadas (origen→destino) —donde "sacar" es mover de una reserva a disponible— y volverá las celdas de transferencia no editables a mano, que es donde esa lógica (topes, validación, no-negativos) encaja bien.
- Decisión: C. Decidida con el usuario el 2026-07-24 al notar que una reserva no puede ser negativa: sacar es una transferencia con reglas propias que pertenecen a la feature dedicada, no un parche en balance. Elimina todo el blast-radius de schema de esta feature.

**ADR-03: Cómputo del arrastre bi-plano (saldo mes anterior por plano).**
- Opción A (elegida): cada plano arrastra su propio cierre — el Presupuestado acumula su plan, el Ejecutado lo real; las dos cadenas son independientes (`computeBalanceSeries` lleva dos acumuladores, `prevBudget` y `prevActual`, sin cruce). El módulo de balance es de solo lectura: no se teclea nada en él; el presupuestado sale de las celdas de presupuesto que el usuario tecleó en la grilla.
- Opción B: un único carry REAL siembra ambas columnas (el presupuestado arranca del dinero real). Rechazada: el usuario decidió (2026-07-24) que el presupuestado es su plan manual y NO debe mezclar datos reales; el balance presupuestado es una trayectoria de plan pura.
- Decisión: A. Planos independientes; la reconciliación (Saldo total = total previo + flujo) se garantiza DENTRO de cada plano. Más simple que B: sin dependencia de orden de cómputo entre planos.

## Traceability Checklist
- FR-904 (separación Transferencia) → System Architecture (Presentación) + Implementation Approach.
- FR-905 (seis cifras × dos planos) → Data Model (`MonthBalance`) + Implementation Approach + ADR-03.
- FR-906 (arrastre por plano) → Implementation Approach + ADR-03.
- FR-907 (guardar por ítem, v1 solo aportes) → Implementation Approach + Data Model + ADR-02 (diferir sacar).
- FR-908 (recalculo en vivo) → System Architecture (Estado/selector) + Implementation Approach.
- NFR-901..906 (regresión) → Security/Risk + tests; el diseño no toca datos almacenados salvo el CHECK acotado (ADR-02).
- NFR-907 (perf) → Performance & Scalability. NFR-908 (seguridad) → Security Design.
