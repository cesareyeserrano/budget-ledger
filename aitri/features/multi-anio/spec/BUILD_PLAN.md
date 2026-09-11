# BUILD_PLAN — multi-anio

## Aviso que gobierna el orden: esto no tiene estados intermedios compilables

Cambiar `MonthKey` por `PeriodKey` es un cambio de TIPO que atraviesa 19 ficheros de `src/`. En
cuanto se toca `types.ts`, TypeScript deja de compilar hasta que el último punto de acceso está
actualizado. **Los epics EP-01 a EP-05 no son entregas independientes**: son unidades de organización y de
verificación, no estados desplegables. El proyecto vuelve a compilar al cerrar EP-05.

Esto se dice por adelantado para que nadie interprete un `tsc` en rojo a mitad de camino como una
regresión.

## Línea base ANTES de tocar nada (requisito de las seis NFR de regresión)

Las NFR-1901…1906 se prueban **por comparación**, no por suposición. Así que el primer paso, antes
de la primera línea de código, es capturar la línea base:

1. Correr la suite completa y registrar: exit code, número de pruebas ejecutadas y `N failed`.
2. Volcar a un fichero de referencia, con el código ACTUAL: la serie de balance del juego de datos de
   referencia, el resultado de las seis funciones auditadas de `reserve.ts` en los doce meses, los
   roll-ups del árbol de 23 nodos, y los contadores `__reservePerfCounters` por operación.

Sin esa foto, «no rompimos nada» es una opinión.

---

## EP-01 — La clave de periodo   [status: done]

Módulo nuevo `src/domain/periods.ts` (sustituye a `months.ts`): `PeriodKey`, `isPeriodKey`,
`comparePeriods`, `addMonths`, `periodRange`, `periodFromDate`, `currentPeriod`. `types.ts` pasa a
indexar por `PeriodKey`.

**Makes pass:** TC-MAN-001h · 002e · 003f · 004e

## EP-02 — La base de datos   [status: done]

`drizzle/0002_multi_anio.sql` (DROP constraints → RENAME columna → CHECK regex → PRIMARY KEY →
`data_version = 6`), con **guarda previa que aborta si las tres tablas no están vacías**.
`schema.ts` y la escalera `ensureV4InTx` de `ledgerRepo.ts` al escalón v6.

**Makes pass:** TC-MAN-010h · 011e · 012f · 013e · 014f · 015f · 280h · 281f · 282e

## EP-03 — El rango activo y el horizonte   [status: done]

`oldestPeriodWithData(state)` en el dominio. En `store.ts`, el borde del reloj: `currentPeriod`,
lectura del horizonte y derivación de `activePeriods` — **una sola lista, calculada una vez**.
Columna de horizonte en la tabla `user` y endpoint `/api/v1/preferences/horizon`.

**Makes pass:** TC-MAN-030h · 031h · 032e · 033e · 034f · 050h · 051h · 052e · 053e · 054f ·
060h · 061e · 062f · 063f · 064f

## EP-04 — El arrastre y las reservas sobre la lista   [status: done]

`computeBalanceSeries(state, periods)`: solo `periods[0]` abre en `ZERO_CARRY`. Las 26 funciones
exportadas de `reserve.ts` reciben la lista; `MONTH_KEYS.indexOf` → `periods.indexOf` **con rechazo
explícito del −1** en cada punto (RISK-03 del TRD).

**Makes pass:** TC-MAN-020h · 021h · 022e · 023e · 024f · 025e · 080h · 081h · 082e · 083f · 084e

## EP-05 — La siembra   [status: done]

`buildSeed(ownerId, currentPeriod)`; `FACTOR` pasa de `Record<MonthKey, number>` a factores por
posición. **Aquí el proyecto vuelve a compilar.**

**Makes pass:** TC-MAN-090h · 091e · 092f · 093e

## EP-06 — La interfaz   [status: done]

`BudgetGrid`, `BalanceModule`, `Dashboard`, `ReserveCells`, `register/ReserveRow` y el selector de
`DesktopShell` iteran `activePeriods`. Encabezado con marca de cambio de año. Un solo scroll
compartido con el Balance, como hoy.

**Makes pass:** TC-MAN-040h · 041h · 042e · 043f · 070h · 071h · 072e · 073f · 250h · 251f · 252e

## EP-07 — Regresión y endurecimiento   [status: done]

Adaptar los **32 ficheros de prueba** que mencionan meses literales — adaptar, no desactivar.
`isPeriodKey` en el borde de los tres endpoints con el acotado de año (NFR-1908). Comparación contra
la línea base del paso 0.

**Makes pass:** TC-MAN-200h · 201e · 202f · 210h · 211e · 212f · 220h · 221e · 222f · 230h · 231e ·
232f · 240h · 241f · 242e · 260h · 261f · 262e · 270f · 271f · 272f · 273f · 274h

---

## Riesgos del TRD que este plan atiende explícitamente

| Bandera | Dónde se atiende |
|---|---|
| RISK-01 coste ~7× | Epic 3 (una sola lista) + Epic 7 (contadores contra línea base) |
| RISK-02 `BalanceSeries` dispersa | Epic 4: acceso por helper; la UI itera `activePeriods`, nunca claves sueltas |
| RISK-03 `indexOf` → −1 | Epic 4: rechazo explícito en cada punto, con TC-MAN-083f como red |
| RISK-04 ventana de despliegue | Epic 2: respaldo → migrar → desplegar, documentado |
| RISK-05 sentinel `@retiros` | Epic 2: la guarda no valida `node_id`, con TC-MAN-015f como red |


---

## Cierre (2026-09-02)

Los siete epics están hechos y la línea base del paso 0 se cumplió: **645 unitarias/integración y
380 e2e en verde**, frente a las 576 y 344 de partida. Ninguna prueba se perdió ni se desactivó —
`TC-MAN-202f` lo comprueba mecánicamente barriendo los 59 ficheros en busca de `skip`, `only` o
`todo`, y no encuentra ninguno.

### Lo que cambió respecto del plan, y por qué

**Tres decisiones del usuario tomadas AL VER la grilla construida**, que obligaron a re-derivar las
fases 1, 2 y 3 (el expediente estaba diciendo algo distinto de lo que hacía el código):

1. El horizonte se cuenta en **años completos**, no en meses (ADR-08). «24 meses» cortaba 2028 en
   agosto. Consecuencia aceptada: la ventana rueda una vez al año.
2. El filtro **Año recorta las columnas** a ese año — de ahí la separación entre `activePeriods`
   (cálculo) y `visiblePeriods` (columnas), que es el ADR-09.
3. Elegir un mes **lo trae al frente**, con el primer posicionamiento instantáneo.

### Defectos reales encontrados durante la construcción

- **`applyReserveCellEdit` aceptaba un periodo malformado** y escribía una celda que ninguna
  derivación puede leer: dinero invisible. Lo cazó `TC-MAN-003f`. Endurecidas las cuatro puertas.
- **La migración v3→v4 no traducía**: leía claves viejas y las devolvía viejas. Ahora detecta la
  forma de las claves y devuelve el eje actual.
- **Mezclar las dos listas de periodos** dejó el encabezado en 12 columnas y las filas en 32
  (`[RISK-06]`). Lo vio el usuario en pantalla.
- **`visiblePeriods` devolvía un array nuevo por llamada** y tiraba la caché del dominio en cada
  render (`[RISK-07]`).
- **El scroll suave al montar se comía el primer gesto de rueda** del usuario (~1,5s de grilla
  clavada). Ahora el posicionamiento inicial es instantáneo; lo vigila `TC-MAN-045h`.

### Riesgos del TRD, cerrados con medición

`[RISK-01]` (coste ~7×) queda **descartado con números**: el coste POR PERIODO es plano —1,4 µs de
12 a 168 periodos— y catorce años completos se recalculan en 0,23 ms, muy por debajo del tope de
150 ms. La primera medición dio un factor 139 que resultó ser calentamiento del JIT, no el
algoritmo: `TC-MAN-262e` mide con repeticiones por esa razón.
