# Product Discovery — Problem Statement

Feature **Ciclos** (nombre interno: Cadencia). Fuente: `feature_context/requerimiento-ciclos-de-pago.md`, aportado por el usuario el 2026-09-08, más dos rondas de discovery con él el 2026-09-10. Donde una resolución de abajo contradice el documento, la resolución gana: es la capa más nueva, validada por el usuario.

## Problem

El presupuesto se lleva hoy por mes calendario (del 1 al último día), y ese modelo asume que el ingreso llega el día 1. El ingreso del usuario llega el 21. Con eso, el salario que entra el 21 de agosto paga las cuentas del 21 de agosto al 20 de septiembre, pero la app lo muestra como dinero de agosto y reparte esos gastos entre dos columnas distintas. El usuario no puede responder «¿con qué plata pago esta cuenta?» y los balances mensuales muestran una realidad que no es la suya: un mes con ingreso y pocos gastos seguido de otro con gastos y sin ingreso.

Medido en los datos reales del usuario el 2026-09-10: su único ingreso registrado es el salario del 21-ago; tiene 27 movimientos con fecha entre el 21-ago y el 8-sep, todos pagados con ese mismo salario, y hoy la app los parte en 9 para agosto y 18 para septiembre.

En palabras del usuario: «no sé cuándo un pago entra el 21 de un mes, pero con eso pago lo de otro mes. Es confuso y creo que contablemente erróneo».

**Resumen en tres frases.** El dinero del usuario entra en ciclos de pago que van de un 21 al 20 siguiente, no en meses calendario. La app corta por mes calendario, así que cada ciclo queda partido en dos columnas y cada columna mezcla dos ciclos. La unidad de presupuesto tiene que ser el ciclo de pago, y el usuario tiene que poder elegirlo.

## Users

- **El presupuestador personal, usuario único del producto.** El mismo de todas las features anteriores: lleva la grilla de meses, teclea su plan en las celdas y registra cada gasto desde el Registro con fecha. Cobra un salario el 21 de cada mes (o el día hábil anterior si el 21 cae en fin de semana o festivo, sin que eso cambie para él qué ciclo abre ese pago). Su meta al abrir la app es saber, para el ciclo en curso, cuánto le queda del salario que ya recibió.
- No hay un tipo de usuario nuevo. Otros usuarios de la misma instancia seguirán en modo mes a mes salvo que activen ciclos: es una elección por usuario, nunca global.

## Success Criteria

1. **Modo elegible.** En Configuración el usuario elige entre «mes a mes» (por defecto, el comportamiento actual, sin cambios) y «ciclos» indicando el día del mes en que cobra. Con «mes a mes» ninguna pantalla cambia respecto a hoy.
2. **Cada ciclo es una columna con nombre de mes y rango visible.** Con ciclos activos y día 21, la columna «Septiembre» muestra debajo «21 ago – 20 sep»; «Octubre» muestra «21 sep – 20 oct». Los ciclos son contiguos: el fin de uno es el día anterior al inicio del siguiente, sin huecos ni traslapes, para cualquier día configurado del 1 al 31 (con ancla 31, febrero cierra el 28 o 29).
3. **Todo movimiento cae en un solo ciclo por su fecha de transacción, sin intervención manual.** Un gasto del 5-oct cae en «Octubre» (21 sep – 20 oct); uno del 25-oct cae en «Noviembre». Verificable con los 27 movimientos reales del usuario: al activar ciclos con día 21, los 27 quedan en «Septiembre» y ninguno en otra columna.
4. **El salario cuenta en el ciclo que abre, aunque llegue uno o dos días antes por festivo.** Pagado el viernes 20-nov porque el 21 cae sábado, ese ingreso aparece en «Diciembre» (21 nov – 20 dic), no en «Noviembre». Sin calendario de festivos: la frontera del ciclo no se mueve.
5. **Lo tecleado en las celdas conserva su valor y se reubica de forma predecible.** Al activar ciclos, el plan que hoy vive en la columna de agosto (tecleado para el salario del 21-ago) aparece en «Septiembre», el de septiembre en «Octubre», y así en adelante. Ni un peso se pierde ni se duplica: la suma de todas las celdas antes y después de activar es idéntica.
6. **Cierre y arrastre funcionan igual que hoy, sobre la frontera del ciclo.** Cerrar «Septiembre» congela el 21 ago – 20 sep exactamente como hoy se congela un mes: secuencial, uno a la vez, con reapertura solo del último cerrado. El sobrante de un ciclo abre el siguiente, como hoy pasa entre meses.
7. **Cambiar el día de pago no reescribe el pasado.** El usuario crea una nueva configuración con la fecha de su primer pago bajo el día nuevo. Los ciclos ya cerrados conservan sus fechas y sus balances (comparados antes y después: idénticos). El periodo entre el último pago viejo y el primero nuevo aparece como ciclo de transición, marcado como tal, y no dispara alertas ni entra en comparaciones.
8. **Nada de lo que hoy funciona en modo mes cambia de resultado.** Con el modo por defecto, la suite completa del proyecto sigue en verde y los totales de cada mes son los mismos que antes de la feature.

## Out of Scope

Primer incremento = **el núcleo que ajusta las transacciones actuales del usuario** (decisión del usuario, 2026-09-10). Todo lo siguiente queda explícitamente fuera y se registra en el backlog como incrementos posteriores; no se pierde, se aplaza:

- **Frecuencias distintas de la mensual con un solo día** (quincenal 15/30, quincenal con fin de mes, semanal, catorcenal, fechas manuales para ingresos irregulares — documento §2.2.2, RF-03, RF-04). El núcleo cubre un día del mes, versionable en el tiempo.
- **Calendario de festivos y política de día no hábil** (RF-02 en esa parte, RV-09): retirados por decisión del usuario, no aplazados. La frontera es nominal y el pago adelantado se resuelve con el criterio 4.
- **Gastos recurrentes con día de vencimiento proyectados a ciclos futuros** (RF-12) y **cuotas de compras diferidas** (RF-13, §5.2).
- **Prorrateo de un gasto entre los ciclos que lo anteceden** (RF-09c, RV-10, §2.2.6).
- **Ingreso extraordinario asignado a mano a otro ciclo** (RF-14, §5.1) y **varias fuentes de ingreso con una designada** (RF-15, §5.4). En el núcleo hay una sola fuente que define los ciclos: el salario.
- **Vista alterna por mes calendario** (RF-16, §4.2, §9): el rango bajo el nombre basta por ahora; cualquier reporte tributario futuro se construirá sobre esa vista, no sobre ciclos.
- **Disponible tras gastos comprometidos no pagados** (RF-17), **alerta de ciclo futuro en déficit** (RF-18) y **aviso de duración distinta al comparar ciclos** (RF-19).
- **Ingreso de monto variable con proyectado vs confirmado** (§8.3): no aplica al salario fijo del usuario; se retoma si entran fuentes variables.
- **Criterio tributario** (§9): el modelo no cambia cuándo se realiza un ingreso para efectos de renta.
- **Migrar a otros usuarios**: activar ciclos es una acción de cada usuario sobre su propio ledger; no hay migración masiva.

## Resolutions

Decisiones tomadas por el usuario en discovery (2026-09-10). Cada línea: tensión → decisión → qué descarta.

1. **Nombre del ciclo.** El documento §2.1 prohíbe nombrar el ciclo por un mes («Ciclo 21-sep», nunca «presupuesto de octubre»); el usuario quiere «Septiembre · 21 ago – 20 sep» → **se nombra por el mes en que el ciclo TERMINA y se muestra siempre el rango debajo** (supersede §2.1). Descarta la nomenclatura por fecha de ingreso. *Alternativa que el usuario debe ver al aprobar:* nombrarlo por el mes en que EMPIEZA («Agosto · 21 ago – 20 sep») coincide con cómo él mismo rotuló y tecleó su salario hoy («Salario agosto 2026», en la columna de agosto) y evitaría correr las celdas un mes (criterio 5). El usuario lo dijo dos veces: para él ese ciclo es septiembre. Se respeta.
2. **Sustituir la grilla mensual o convivir con ella.** El README de origen planteaba dos productos → **es un MODO por usuario en Configuración**: «mes a mes» por defecto (idéntico a hoy) o «ciclos». Nunca las dos vistas a la vez, con lo que no se mezclan dos sistemas de corte (§4.1 queda satisfecho). Descarta la convivencia de plan mensual con ejecución por ciclo.
3. **Frontera del ciclo cuando el pago se adelanta.** El documento §3.1 dice que el ciclo empieza en la fecha real de recepción; el usuario dice que si el 21 cae en no hábil le pagan el día hábil anterior y eso no mueve el cierre → **la frontera es nominal (siempre el día configurado)** (supersede §3.1). Descarta el calendario de festivos y la política de día no hábil (RF-02 en esa parte, RV-09). Consecuencia pendiente de confirmar, criterio 4: **el salario que define los ciclos cuenta en el ciclo que abre, aunque llegue antes** [ASSUMPTION: el usuario no confirmó entender esta regla; ver Evidence gaps].
4. **Qué es «cerrado» bajo ciclos.** RF-08 habla de ciclos cerrados y cierre-de-mes cierra meses → **la misma lógica de cierre de mes, aplicada a la columna del ciclo**. Descarta un segundo mecanismo de cierre.
5. **Fecha que asigna el movimiento.** RF-10 habla de fecha de vencimiento o de pago; la app guarda la fecha de la transacción → **la fecha de la transacción es la que asigna** (precisa RF-10). Descarta un campo de vencimiento en el núcleo (vuelve con RF-12).
6. **Arrastre de saldo entre ciclos** (§8.1) → **igual que hoy entre meses**: el sobrante pasa al siguiente ciclo. Descarta ciclos que arrancan en cero.
7. **Corrección retroactiva** (§8.4 decía que sí recalcula un ciclo cerrado) → **misma lógica de cierre de mes: se reabre el último cerrado y luego se corrige** (supersede §8.4). Descarta corregir un ciclo cerrado en sitio.
8. **Ingreso fuera de fecha** (§8.2) → con frontera nominal, un pago que llega tarde cae en su ciclo por fecha sin más; el pago adelantado se cubre en la resolución 3. Descarta la fecha esperada vs real y el conflicto con RV-04.
9. **Reembolsos** (§8.5) → **una transacción más: un ingreso en el ciclo en que llega**, con monto positivo, sin gasto en negativo (recomendación aceptada por el usuario). Descarta corregir el ciclo original.
10. **Vista por mes calendario con ciclos activos** (RF-16) → **no en el núcleo**; el rango bajo el nombre basta (recomendación aceptada). Se aplaza.
11. **Cambiar el día de pago** (punto adicional del usuario: «el próximo año cambia al 15») → **se crea una configuración nueva con fecha de vigencia y fecha del primer pago nuevo; lo cerrado no se toca, lo abierto y futuro se regenera; el hueco es un ciclo de transición** (RF-07, RF-08, RF-09, RF-09a, RF-09b tal cual). Descarta editar la configuración en sitio, que el documento llama «el error más costoso de este modelo».
12. **Alcance del primer incremento** → **primero el núcleo que ajusta las transacciones actuales del usuario, luego lo demás** (lista en Out of Scope). Descarta entregar los 19 RF de una vez; BL-043 ya avisaba que no era una feature sino varias.
13. **Sus celdas de agosto.** Las 14 celdas tecleadas en la columna de agosto (salario del 21-ago y sus gastos) → **son del ciclo «Septiembre»**. De ahí sale el criterio 5: al activar ciclos, cada columna tecleada se reubica al ciclo que abre el salario de ese mes.
14. **¿Es esta la solución?** El usuario preguntó si se me ocurría otra. → **Sí es la solución**: presupuestar por periodo de pago es el modelo estándar para ingresos que no llegan el día 1, y no es contablemente erróneo para un presupuesto personal de caja. La alternativa barata (seguir en meses y registrar el salario en el mes que «paga») no arregla nada, porque los gastos del 1 al 20 seguirían partidos.

## Discovery Confidence
Confidence: medium
Evidence gaps:
- La regla del criterio 4 (el salario cuenta en el ciclo que abre aunque llegue el 19 o el 20 por festivo) la propuse dos veces y el usuario respondió «no sé si entiendo tu regla». Está escrita con su caso concreto (pagado el 20-nov → «Diciembre») para que la confirme o la corrija al aprobar. Si la rechaza, el pago adelantado caería en el ciclo anterior por fecha y habría que decidir otra regla.
- El usuario eligió nombrar el ciclo por el mes en que termina sin conocer la consecuencia de que sus celdas tecleadas se corren un mes (criterio 5, resolución 1). Debe verla explícitamente antes de aprobar; la alternativa está anotada.
- El día de pago del usuario (21) se infirió de sus datos reales y de sus ejemplos; el documento decía que el 21 era solo ilustración. Él no lo desmintió en dos rondas.
Handoff decision: ready — las decisiones estructurales están tomadas por el usuario; los dos gaps son confirmaciones sobre una regla ya escrita y pasan por la checklist de aprobación.
