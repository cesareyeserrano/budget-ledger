<!-- Fuente AUTORITATIVA: feature_context/requerimiento-ciclos-de-pago.md (aportado por el usuario el
     2026-09-08; nombre interno «Cadencia», nombre de cara al usuario «Ciclos»). Este fichero lo RESUME
     para el pipeline; ante cualquier discrepancia manda el documento del cliente. Las decisiones que el
     documento ya tomó se llevan a los FR tal cual. Lo que el documento deja abierto (§8) y lo que el
     análisis de impacto BL-043 destapó se marca [ASSUMPTION] o [DISCOVERY] y se resuelve CON el usuario. -->

## Feature
El presupuesto se lleva por CICLO DE PAGO (desde la fecha de un ingreso hasta el día anterior al siguiente), no por mes calendario; el calendario de ciclos es configurable por usuario, versionado por fecha de vigencia, y todo movimiento se asigna a su ciclo por una regla única.

## Problem / Why
Confirmado por el usuario (§1 del documento). El presupuesto por mes calendario asume que el ingreso llega el día 1. Cuando llega a mitad de mes, un mismo mes se alimenta de dos ingresos distintos y un mismo ingreso se reparte entre dos meses. El usuario no puede responder «¿con qué plata pago esta cuenta?» y los balances mensuales muestran distorsiones que no corresponden a su realidad. Medido en la base de dev el 2026-09: los 27 movimientos reales del ledger de admin ya quedan partidos por el corte de mes calendario.

## Target Users
El presupuestador personal, usuario único del producto (mismo usuario de todas las features previas). Recibe su ingreso principal en una fecha que no es el día 1. Sin tipo de usuario nuevo.
[ASSUMPTION] El esquema concreto del usuario (mensual con un ancla, quincenal 15/30, otro) NO está en el documento: el día 21 de los ejemplos es solo ilustración (§2). Hay que preguntárselo; define el primer caso real que la configuración debe cubrir.

## New Behavior
Trasladados del documento del cliente (§6 RF-01…RF-19 y §7 RV-01…RV-10), sin re-decidir:

**Configuración**
- RF-01 Cada usuario define su propia configuración de ciclos; el sistema no aplica ninguna configuración por defecto sin elección explícita.
- RF-02 Se configura: frecuencia (mensual, quincenal, semanal, catorcenal, personalizada), anclas, política de día no hábil (anterior / siguiente / sin ajuste), calendario de festivos (país/región, sábado hábil o no) y comportamiento de fin de mes (último día del mes / desplazar).
- RF-03 Todos los esquemas de §2.2.2 se cubren por configuración, sin ramas de código por esquema.
- RF-04 Fechas de inicio de ciclo definidas a mano para ingresos irregulares.
- RF-05 Previsualizar los próximos ciclos que genera una configuración antes de guardarla.

**Motor de ciclos**
- RF-06 Genera el calendario de ciclos (inicio y fin calculados) a partir de la configuración vigente. Los ciclos tienen duración VARIABLE (§2.2.3): ninguna lógica asume duración fija ni divide entre un número constante de días.
- RF-07 La configuración se almacena como versiones con fecha de vigencia; se conserva el histórico.
- RF-08 Un cambio de configuración aplica solo hacia adelante; los ciclos ya cerrados no se recalculan.
- RF-09 El periodo entre dos versiones de configuración se marca como ciclo de transición.
- RF-09a Al cambiar la configuración el usuario indica la fecha del primer pago bajo el esquema nuevo; el sistema no la infiere.
- RF-09b Los ciclos de transición se excluyen de promedios, tendencias, comparaciones y alertas.
- RF-09c Un gasto recurrente se puede prorratear entre los ciclos anteriores a su vencimiento, descontando la reserva del disponible de cada uno.

**Asignación y balance**
- RF-10 Todo movimiento pertenece al ciclo cuyo ingreso fue el último en ocurrir antes de la fecha del movimiento (fecha de vencimiento o pago efectivo, no el mes que nombre la factura). Sin intervención manual.
- RF-11 Balance del ciclo = ingresos del ciclo − gastos del ciclo, con la MISMA regla de corte en ambas columnas (§4.1).
- RF-12 Gastos recurrentes con día de vencimiento, proyectados a los ciclos futuros.
- RF-13 Las cuotas de una compra diferida se distribuyen en los ciclos de sus vencimientos; la obligación completa se registra al comprar.
- RF-14 Un ingreso extraordinario (prima, bonificación) se marca como tal y se asigna a mano a otro ciclo (§5.1: no se suma al ingreso corriente).
- RF-15 Con más de una fuente de ingreso, el usuario designa cuál define los ciclos; las demás caen dentro del ciclo vigente (§5.4). Los ingresos adicionales no abren ciclo (§5.3).

**Presentación**
- RF-16 Vista alterna por mes calendario, claramente diferenciada de la vista por ciclo.
- RF-17 Dentro del ciclo activo: saldo disponible tras descontar los gastos comprometidos aún no pagados.
- RF-18 Advertencia cuando los gastos proyectados de un ciclo futuro superan su ingreso esperado (no aplica al ciclo de transición).
- RF-19 Las comparaciones entre ciclos indican cuando los periodos tienen duración distinta.
- Nomenclatura (§2.1): el ciclo se identifica por la fecha de su ingreso («Ciclo 21-sep»), nunca por un nombre de mes.

**Reglas de validación (§7)**
- RV-01 Ningún movimiento sin ciclo. RV-02 Ninguno en más de un ciclo. RV-03 Ciclos contiguos, sin huecos ni traslapes. RV-06 Contigüidad también en la frontera entre versiones de configuración.
- RV-04 Un ciclo con ingresos y sin gastos, o con gastos y sin ingresos, se marca como anomalía de configuración (ver caso abierto 8.2).
- RV-05 La suma de balances de los ciclos de un periodo iguala ingresos − gastos del periodo calculado de forma independiente.
- RV-07 Un cambio de configuración no altera el balance de ningún ciclo anterior a su vigencia (verificable comparando balances históricos antes y después). REGRESIÓN DURA.
- RV-08 Ninguna configuración válida produce ciclos de duración cero o negativa ni anclas duplicadas.
- RV-09 Toda fecha de inicio respeta la política de día no hábil contra el calendario de festivos del usuario.
- RV-10 La suma de reservas prorrateadas de un gasto iguala su monto; ninguna reserva en un ciclo posterior al vencimiento.

## Success Criteria
- Dado un usuario con configuración mensual ancla 21, cuando registra un gasto con fecha 5-oct, entonces pertenece al Ciclo 21-sep; con fecha 25-oct, al Ciclo 21-oct (RF-10).
- Dado el Ciclo 21-sep, cuando se calcula su balance, entonces incluye el giro del 21-sep y los vencimientos del 21-sep al 20-oct, y nunca aparece un ciclo con ingresos sin gastos seguido de otro con gastos sin ingresos por mezclar cortes (RF-11, §4.1).
- Dada una configuración quincenal 15/30, cuando se genera el calendario, entonces los ciclos alternan 15 y 16 días y febrero produce 13, sin huecos ni traslapes (RF-06, RV-03).
- Dado un cambio de ancla 21→30 con primer pago nuevo el 30-oct y último viejo el 21-oct, cuando se guarda, entonces existe un ciclo de transición 21-oct→29-oct de 9 días marcado como tal, excluido de promedios y de la alerta RF-18 (RF-09, RF-09a, RF-09b).
- Dado cualquier cambio de configuración, cuando se comparan los balances de los ciclos anteriores a su vigencia antes y después, entonces son idénticos (RV-07).
- Dado un gasto de 300 prorrateado en 3 ciclos, cuando se guardan las reservas, entonces suman 300, ninguna cae después del vencimiento y cada una descuenta del disponible de su ciclo (RF-09c, RV-10).
- Dado que el usuario no ha elegido configuración, cuando abre la app, entonces no existe ningún ciclo por defecto (RF-01).

## Touch Points
Medidos en el código el 2026-09-08 y re-verificados el 2026-09-10. Es la feature más grande del proyecto: cambia el EJE de indexación del dinero.
- **PeriodKey «YYYY-MM»** (`src/domain/periods.ts:21`, presente en 25 ficheros de `src/`): los mapas de dinero se indexan por mes (`budgets[hoja][periodo]`). Un ciclo es un rango de fechas de duración variable que no se alinea con el calendario. MODIFICA.
- **Movement.date** (`src/domain/types.ts:49`): ya guarda la fecha ISO de captura y de ella se DERIVA `period`. Es la pieza a favor: los movimientos capturados desde el Registro ya tienen el día que RF-10 necesita. Pero es opcional (movimientos previos no lo tienen). MODIFICA la derivación.
- **Celda de la grilla tecleada directo** (`setLeafAmount`, `src/domain/mutations.ts:385`) NO es un movimiento: es un monto de un mes sin día. Bajo ciclos no tiene a qué ciclo pertenecer. ES EL HUECO CENTRAL. `addMovement` (`mutations.ts:69`) acumula, `setLeafAmount` asigna: ya hoy discrepan.
- **cierre-de-mes (FR-2001…FR-2011)**: `closedThrough`/`reopenedPeriod` son PeriodKey de mes (26 usos en `src/domain/closure.ts`). Cierre secuencial, trinquete de reapertura y línea base del impacto están definidos sobre la frontera del mes. MODIFICA.
- **meses-y-saldo-inicial (FR-2201…FR-2207)**: `startMonth` (`types.ts:142`) ancla el historial en un MES; la página de Configuración (FR-2204) es donde vive lo configurable y es el lugar natural de la configuración de ciclos. MODIFICA / AÑADE.
- **multi-anio (FR-1901…FR-1910)**: `activeRange` (`src/domain/range.ts`) deriva el eje visible de meses; la grilla continua de FR-1905 y la de 12 columnas de FR-006 asumen meses. MODIFICA.
- **transferencias (FR-1001…FR-1015)**: RF-09c (reservar por adelantado porciones de un gasto, descontando del disponible) es conceptualmente el motor de alcancías con techo (FR-1006) y piso (FR-1007). [DISCOVERY] estudiar reusarlo en vez de construir otro: la mayor economía posible de la feature.
- **Balance (FR-1009, feature balance)**: el arrastre de saldo entre periodos YA EXISTE y opera sobre el mes (FR-1903 lo cruza por año). Caso abierto 8.1.
- **Persistencia** (FR-011, drizzle en `src/server/db`): configuración versionada, ciclos, gastos recurrentes, cuotas y prorrateos son tablas/columnas nuevas con migración.

## Must Not Break (Regression Boundary)
- Todo movimiento capturado antes de la feature conserva su `period` y su monto; el agregado de la raíz sigue 59/59 y ninguna feature sellada cambia de verde.
- RV-07 como NFR de regresión: los balances de ciclos anteriores a un cambio de configuración son idénticos antes y después.
- cierre-de-mes: un periodo cerrado sigue inmutable (FR-2003), el cierre sigue secuencial (FR-2002) y la reapertura sigue siendo una sola a la vez (FR-2005) sobre la frontera que se decida en discovery.
- multi-anio: el saldo de diciembre sigue abriendo enero (FR-1903) y el horizonte en años (FR-1904) sigue funcionando.
- transferencias: techo global (FR-1006) y piso por alcancía (FR-1007) siguen bloqueando exactamente igual; los saldos derivados (FR-1001) no cambian de valor.
- meses-y-saldo-inicial: el saldo inicial sigue abriendo el primer periodo del historial (FR-2202) y persiste en el servidor (FR-2207).
- FR-011: Postgres sigue siendo la única fuente de verdad; la migración es versionada e idempotente como exige FR-1010.
- La vista por mes calendario (RF-16) reproduce los mismos totales mensuales que hoy para los mismos datos (es la base de cualquier reporte tributario, §9).

## Out of Scope
- Criterio tributario (§9): el modelo no modifica cuándo se realiza un ingreso para declaración de renta; cualquier reporte tributario se construye sobre la vista de mes calendario, no sobre ciclos.
- Generar ciclos a partir de TODAS las fuentes de ingreso (§5.4): no se implementa; solo una fuente define los ciclos.
- Una configuración de ciclos por defecto para toda la base de usuarios (RF-01).
- Normalizar o «arreglar» el ciclo de transición (§2.2.4): se muestra como es.

## Casos abiertos — a resolver en discovery CON el usuario
[DISCOVERY] Ninguno de estos está decidido en el documento; no se inventa una respuesta.
1. **Sustituir o convivir** (README de origen): ¿las columnas de la grilla pasan a ser ciclos (rehace FR-006/FR-1905 y todo lo tecleado en celdas se reasigna a mano) o la grilla mensual se queda para planear y los ciclos son la vista de ejecución (más barato, pero hay que definir qué manda cuando discrepan, que es justo el error de §4.1)? Reloj: cada celda tecleada directo desde el 2026-09-08 es dato sin día.
2. **8.1 Arrastre de saldo entre ciclos**: ¿sobrante pasa al siguiente o cada ciclo arranca en cero? El arrastre ya existe sobre el mes; hay que decidir si opera sobre la frontera del ciclo.
3. **8.2 Ingreso fuera de fecha**: ¿fecha esperada abre el ciclo provisionalmente y la real lo confirma? Choca con RV-04.
4. **8.3 Ingreso de monto variable**: cómo distinguir proyectado de confirmado en la interfaz.
5. **8.4 Corrección retroactiva**: corregir un movimiento de un ciclo cerrado SÍ recalcula; cambiar configuración NO. Verificar caminos separados y cómo se concilia con FR-2003 (mes cerrado inmutable).
6. **8.5 Reembolsos**: ¿corrigen el ciclo original o entran como ingreso del actual?
7. **Esquema real del usuario** y su calendario de festivos (país/región, sábado).
8. **Orden con BL-044** (panel de celda como diario): su análisis recomienda hacerla ANTES porque empuja la captura hacia el movimiento con fecha y reduce la superficie del hueco 1. El usuario decidió ir a Ciclos ya; queda anotado.
