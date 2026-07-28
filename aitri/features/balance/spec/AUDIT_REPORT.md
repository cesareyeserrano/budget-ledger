# AUDIT_REPORT — Feature balance

## Requirements Coverage

_Auditoría de completitud intención → FR, 2026-07-28. Fuentes de intención: `01_REQUIREMENTS.json#original_brief` (el brief hablado del 2026-07-24, redactado por el agente) y `00_DISCOVERY.md`. Se traza hacia atrás cada necesidad expresada. El alcance del proyecto padre queda fuera de esta pasada._

**Veredicto: 24 necesidades trazadas · 15 cubiertas por FR/NFR · 9 fuera de alcance con decisión explícita · 0 dropped.** Es el `coverage_map` más limpio del proyecto: el brief venía con seis puntos marcados `[A DEFINIR EN DISCOVERY]` y los seis se resolvieron y quedaron registrados, ninguno se evaporó.

### Trazabilidad (evidencia de completitud, no asumida)

**Los 6 "New Behavior" del brief — 6/6 resueltos:**
1. *"Subtotales de grupo en TODOS los grupos, calculada por columna"* → **out_of_scope con razón verificada**: ya existía en el build (el roll-up de la fila del grupo, `BudgetGrid.tsx` → `rollupBudget`/`rollupActual`). No es una necesidad dropped: es una necesidad **ya satisfecha** antes de empezar, y el `coverage_map` lo dice con esas palabras.
2. *"Totales por tipo: Total Ingreso y Total Gasto"* → **out_of_scope, ya existía** (`TypeTotalRow`, `typeTotals`). Mismo caso.
3. *"Subtotales de categoría, opcional con checkbox"* + `[A DEFINIR EN DISCOVERY]` sobre el ámbito y la persistencia del toggle → **out_of_scope con decisión registrada**: el subtotal por categoría ya existe en la fila de categoría, y *"el usuario desestimó el toggle"*. La pregunta abierta se cerró, no se abandonó.
4. *"Separación visual de transferencias… espaciada del bloque de transacciones"*, con la nota del agente pidiendo confirmar que era disposición visual y no un modelo nuevo → **FR-904**, y la confirmación quedó: el tipo `transfer` del dominio no se tocó.
5. *"Módulo de Balance: Flujo disponible = Ingreso − Gasto · Saldo reservado = acumulado en transferencias · Saldo total = suma de ambos"* → **FR-905** (las seis cifras), **FR-906** (arrastre entre meses; el brief no lo pedía y el discovery lo definió), **FR-907** (acumulación del reservado, v1 solo aportes), **FR-908** (recálculo en vivo). La "Nota de nomenclatura" del brief —que pedía explícitamente definir los nombres en discovery— se resolvió: "Flujo disponible" pasó a "Saldo disponible" + "Flujo del mes", y **FR-911** fijó "RESERVAS" como rótulo del bloque `transfer`.
6. *"El módulo de tipos de transacción también llevará cálculo — el usuario aún no definió cuál"* → **out_of_scope con la razón exacta**: *"no definido por el usuario, fuera de alcance"*. Correcto: no se puede cubrir una necesidad que el cliente dejó sin enunciar, y queda registrada como tal en vez de desaparecer.

**Los 2 "Success Criteria" del brief — 2/2 con FR:** *"ve el subtotal de cada grupo, el Total Ingreso, el Total Gasto y las tres cifras de balance sin salir de la vista"* → FR-905 + los agregados preexistentes · `[ASSUMPTION]` *"la suma de subtotales de grupo de un tipo es igual al total de ese tipo, para cualquier estado de la grilla"* → **NFR-902** (`Regression`). **Ver el hallazgo BAL-1.**

**Los 5 "Must Not Break" del brief — 5/5 con NFR:** montos de hoja intactos y agregados derivados → NFR-901 · roll-ups existentes idénticos → NFR-902 · código de estado por color → NFR-903 · promote-to-group y demote-node → NFR-904 · registro de movimientos y móvil solo-registro → NFR-905. Añadidos por la feature: escala de tamaños y consistencia visual → NFR-906 · recálculo sin degradar la edición → NFR-907 · NFRs operacionales heredados → NFR-908.

**Alcance añadido tras el brief — 2/2 rastreado:** FR-909 (plegado del módulo y los cuatro bloques como pares) y FR-910 (orden Ingresos → Gastos → Reservas → Balance), ambos en el `coverage_map` con su necesidad de origen.

**Out-of-scope, correctamente excluido — 9/9:** los tres agregados que ya existían · sacar de una reserva / mover entre reservas / préstamos · cuenta-bolsillo-alcancía como entidades con saldo propio · saldo inicial manual del mes 1 · el cálculo no definido del módulo de tipos · proyecciones y comparación entre meses · gráficos y exportación · cambiar el modelo de datos almacenado. El brief los había dejado como *"[A DEFINIR EN DISCOVERY] El usuario no declaró explícitamente qué queda fuera. Candidatos a confirmar…"* — los candidatos se confirmaron y se escribieron en el `no_go_zone`, que es exactamente lo que debía pasar.

### Hallazgos

**[BAL-1]** `EL INVARIANTE ESTÁ DECLARADO PERO NO VERIFICADO` — NFR-902 se rompe hoy por un camino que ningún test comprueba
- Source: `[ASSUMPTION]` del brief — *"Las cifras cuadran: la suma de subtotales de grupo de un tipo es igual al total de ese tipo, para cualquier estado de la grilla"* → **NFR-902** (`category: "Regression"`, MUST duro): *"el total de un nivel sigue siendo la suma de sus hojas (sin huérfanos)"*.
- Estado: el invariante **no se cumple** tras arrastrar un nodo sobre una categoría-hoja que tiene montos propios. `moveNode` (`src/domain/mutations.ts:394-407`) no traslada los montos del destino a una hoja cuando el destino deja de serlo, así que quedan huérfanos y desaparecen de todos los agregados — incluidos los del módulo de Balance, que consume `typeTotals`. Con los datos semilla, arrastrar algo sobre "Vivienda" borra 300.000 mensuales del total del grupo.
- Por qué no es un gap de requisitos: la necesidad **sí** está capturada (NFR-902 la enuncia con precisión). Lo que falla es la verificación: el test que acredita el invariante en el reparent (`TC-105e`, `tests/domain/move-dashboard-seed.test.ts:87`) se titula "totales cuadran" y no comprueba ningún total, y los tests de esta feature (`tests/domain/balance.test.ts`) no ejercitan `moveNode`.
- Action: registrado en el `AUDIT_REPORT.md` raíz como **BUG-1** (`high`) y **BL-L** (P1). Al cerrarlos, añadir a `tests/domain/balance.test.ts` un caso que reestructure la jerarquía y verifique que la serie de balance conserva el total — es el único punto donde NFR-902 y NFR-904 se cruzan y hoy nadie lo cubre.

### Sin gaps de cobertura

Ninguna necesidad expresada en el brief quedó fuera de los FR ni fuera de una decisión explícita de alcance, y los seis puntos que el brief dejó abiertos se cerraron con decisión registrada.
