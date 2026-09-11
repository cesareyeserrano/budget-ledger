# Cadencia — Presupuesto por ciclo de pago

**Nombre interno:** Cadencia
**Nombre de cara al usuario:** Ciclos

## 1. Problema

El presupuesto personal se organiza tradicionalmente por mes calendario (día 1 al último día del mes). Ese modelo asume que el ingreso llega al inicio del periodo. Cuando el ingreso llega a mitad de mes, el modelo se rompe: un mismo mes calendario se alimenta de dos ingresos distintos, y un mismo ingreso se reparte entre dos meses calendario.

El resultado es que el usuario no puede responder de forma directa la pregunta "¿con qué plata pago esta cuenta?", y los balances mensuales muestran distorsiones que no corresponden a la realidad financiera.

## 2. Concepto central: el ciclo

Un **ciclo** es el periodo que va desde la fecha en que se recibe un ingreso hasta el día anterior a la fecha del siguiente ingreso.

El ciclo, no el mes calendario, es la unidad de presupuesto.

La definición es independiente de cualquier día o frecuencia particular. El día 21 aparece en los ejemplos de este documento únicamente como ilustración; **no es un valor del modelo**. Ver sección 2.2.

**Ejemplo con pago el día 21:**

| Ciclo | Inicio | Fin |
|---|---|---|
| Ciclo 21-sep | 21 de septiembre | 20 de octubre |
| Ciclo 21-oct | 21 de octubre | 20 de noviembre |
| Ciclo 21-nov | 21 de noviembre | 20 de diciembre |

Cada ciclo tiene exactamente un ingreso principal y un conjunto cerrado de gastos.

### 2.1 Nomenclatura

El ciclo se identifica por la fecha de su ingreso, nunca por un nombre de mes. Se usa "Ciclo 21-sep", no "presupuesto de octubre".

Esto no es cosmético. Si el ciclo se nombra con un mes, el usuario lo compara mentalmente contra el calendario y reintroduce el problema que el modelo busca resolver.

## 2.2 Configurabilidad

El calendario de ciclos es **propiedad de cada usuario**. No existe un ciclo global, ni un valor por defecto que se aplique a toda la base de usuarios sin que el usuario lo haya elegido.

El motor de ciclos recibe una configuración y produce un calendario. No conoce ningún día ni frecuencia en particular.

### 2.2.1 Parámetros configurables

| Parámetro | Descripción | Valores |
|---|---|---|
| Frecuencia | Periodicidad del ingreso | Mensual, quincenal, semanal, catorcenal, personalizada |
| Anclas | Día o días que definen el inicio de ciclo | Uno o varios valores según la frecuencia |
| Ajuste por día no hábil | Qué hacer cuando el ancla cae en día no hábil | Día hábil anterior, día hábil siguiente, sin ajuste |
| Calendario de festivos | Qué días se consideran no hábiles | País o región del usuario; sábado hábil o no hábil |
| Fin de mes | Comportamiento cuando el ancla excede los días del mes | Último día del mes, o desplazar |

### 2.2.2 Casos que la configuración debe cubrir

Estos son escenarios reales que el modelo debe soportar sin código especial:

- **Mensual con ancla única.** Ancla en 21. Un ciclo por mes.
- **Quincenal por anclas fijas.** Anclas en 15 y 30. Dos ciclos por mes, de duración desigual. Es el esquema más común en Colombia.
- **Quincenal con fin de mes.** Anclas en 15 y último día del mes. Requiere el parámetro de fin de mes para resolver febrero y los meses de 31 días.
- **Ancla en día 29, 30 o 31.** Requiere el parámetro de fin de mes. Con ancla en 31 y política "último día del mes", febrero inicia ciclo el 28 o el 29.
- **Semanal o catorcenal.** El ancla es un día de la semana más una fecha de referencia, no un día del mes. Los ciclos se desalinean del calendario por completo, y eso es correcto.
- **Frecuencia personalizada.** El usuario define manualmente las fechas de inicio de sus ciclos, para ingresos irregulares.

### 2.2.3 Duración variable

Como consecuencia de lo anterior, los ciclos no tienen duración fija. Un esquema quincenal con anclas en 15 y 30 produce ciclos de 15 y 16 días alternados, y de 13 días en febrero.

Ninguna lógica del sistema puede asumir duración constante, ni derivar valores diarios dividiendo entre un número fijo. Los promedios diarios se calculan sobre la duración real de cada ciclo.

### 2.2.4 Cambios de configuración en el tiempo

La configuración de ciclos es **versionada por fecha de vigencia**, no un valor único que se sobrescribe.

Cuando un usuario cambia de trabajo o su empleador cambia el día de pago, la configuración nueva aplica desde una fecha de corte hacia adelante. Los ciclos ya cerrados conservan las fechas con que fueron calculados originalmente, y sus balances no se recalculan.

Sobrescribir la configuración y recalcular hacia atrás destruye el histórico: los movimientos pasados se reasignan a ciclos que nunca existieron y los balances históricos cambian solos. Es el error más costoso de este modelo.

En la transición, el ciclo que queda entre la configuración vieja y la nueva puede ser más corto o más largo de lo normal. Se marca como ciclo de transición y se muestra como tal, sin intentar normalizarlo.

### 2.2.5 Mecánica de la transición

**Dato de entrada obligatorio.** Al cambiar la configuración, el usuario indica la **fecha del primer pago bajo el esquema nuevo**. El sistema no la infiere.

La inferencia es ambigua por naturaleza: con un ancla nueva en 30 y un cambio registrado en octubre, no hay información en el modelo que permita distinguir si el primer pago nuevo es el 30 de octubre o el 30 de noviembre. Solo el usuario lo sabe.

A partir de esa fecha, el ciclo de transición queda definido: inicia en la fecha del último ingreso bajo la configuración vieja y termina el día anterior al primer ingreso bajo la nueva.

**Ejemplos.** Último pago del esquema viejo el 21 de octubre:

| Cambio | Primer pago nuevo | Ciclo de transición | Duración |
|---|---|---|---|
| 21 → 5 | 5 de noviembre | 21 oct → 4 nov | 15 días |
| 21 → 30 | 30 de octubre | 21 oct → 29 oct | 9 días |
| 21 → quincenal 15/30 | 30 de octubre | 21 oct → 29 oct | 9 días |

**Tratamiento del ciclo de transición.** Los gastos recurrentes no se desplazan cuando se desplaza el pago. Un ciclo de transición corto puede contener vencimientos dimensionados para un periodo completo, y mostrar un déficit que no refleja un problema financiero sino la deformación del periodo.

Por eso el ciclo de transición:

- Se identifica visualmente como tal.
- Se excluye de promedios, tendencias y comparaciones entre ciclos.
- No dispara la alerta de RF-18.

### 2.2.6 Cambio de frecuencia

Un cambio de frecuencia (mensual a quincenal, por ejemplo) es estructuralmente distinto a un cambio de ancla. No corre la frontera: cambia cuántos ingresos hay por mes y de qué tamaño es cada uno.

El efecto secundario está en los gastos fijos, que fueron dimensionados contra el ingreso anterior. Un gasto grande que vence el día 1 cae completo en uno de los dos ciclos del mes, dejándolo en déficit permanente mientras el otro queda en superávit permanente, aunque el mes completo cierre bien.

**El sistema debe permitir prorratear un gasto recurrente entre los ciclos que lo anteceden.** El usuario define qué porción de un gasto se reserva en cada ciclo previo a su vencimiento. La reserva se descuenta del disponible del ciclo en que se aparta, y el pago se registra en el ciclo en que efectivamente vence.

Sin esta capacidad, la vista de ciclos deja de ser informativa bajo frecuencias más cortas que la de los gastos fijos.

## 3. Regla de asignación

Regla única que determina a qué ciclo pertenece cada movimiento:

> **Todo movimiento pertenece al ciclo cuyo ingreso fue el último en ocurrir antes de la fecha del movimiento.**

Aplicada a gastos: un gasto que vence el 5 de octubre pertenece al Ciclo 21-sep, porque el último ingreso anterior a esa fecha fue el del 21 de septiembre. Un gasto que vence el 25 de octubre pertenece al Ciclo 21-oct.

La regla se aplica por **fecha de vencimiento o de pago efectivo**, no por el mes al que el proveedor le ponga nombre en la factura. Una factura rotulada "servicios octubre" que vence el 8 de octubre pertenece al Ciclo 21-sep.

### 3.1 Ajuste por día no hábil

Cuando el ancla cae en día no hábil, el ingreso se recibe en la fecha desplazada según la política configurada por el usuario (sección 2.2.1). El ciclo inicia en la **fecha real de recepción**, no en la fecha nominal del ancla.

La política de desplazamiento no es universal: hay empleadores que pagan el día hábil anterior y otros el siguiente. Por eso es un parámetro y no una constante.

## 4. Balance del ciclo

El balance se calcula sobre el ciclo completo, aplicando la regla de asignación **tanto a ingresos como a gastos**.

```
Balance del ciclo = Ingresos del ciclo − Gastos del ciclo
```

**Ejemplo — Ciclo 21-sep:**

| Concepto | Detalle |
|---|---|
| Ingresos | Giro recibido el 21 de septiembre |
| Gastos | Vencimientos del 21 al 30 de septiembre + vencimientos del 1 al 20 de octubre |
| Balance | Ingresos − Gastos |

### 4.1 Error a evitar

El modelo falla si se aplican criterios distintos a cada columna. Si los ingresos se asignan por ciclo pero los gastos por mes calendario, el resultado es un mes con ingresos y sin gastos, seguido de otro con gastos y sin ingresos.

Ese resultado no refleja ninguna realidad financiera; es un artefacto de mezclar dos sistemas de corte. La validación correspondiente aparece en la sección 6.

### 4.2 Relación con el mes calendario

Un mes calendario queda partido entre dos ciclos. Octubre, por ejemplo, tiene sus primeros 20 días en el Ciclo 21-sep y los últimos 11 en el Ciclo 21-oct.

Esto es esperado y no debe corregirse. El sistema puede ofrecer vistas por mes calendario para efectos tributarios o de reporte, pero el presupuesto operativo se lleva por ciclo.

## 5. Casos especiales

### 5.1 Cierre de año

El último ciclo del año concentra tres presiones simultáneas:

- Gasto elevado de temporada en su primera mitad.
- Vencimientos anuales altos en su segunda mitad (impuesto predial, matrículas, seguros, renovaciones).
- Extensión efectiva del periodo por festivos y por el desplazamiento de fechas de pago.

**Tratamiento:** los ingresos extraordinarios de fin de año (prima, bonificaciones) no se suman al ingreso corriente del ciclo. Se registran como un fondo separado, asignado explícitamente al ciclo de enero.

Si se mezclan con el ingreso corriente, el sistema muestra un superávit en diciembre que induce a gastarlo, y el déficit reaparece en enero.

### 5.2 Compras diferidas

Una compra diferida a cuotas no es un gasto del ciclo en que se realiza. Cada cuota es un gasto del ciclo en que vence.

El sistema debe registrar la obligación completa al momento de la compra y distribuir las cuotas en los ciclos futuros correspondientes, de modo que el impacto sea visible antes de que ocurra.

### 5.3 Ingresos adicionales dentro de un ciclo

Un ingreso no programado que ocurre dentro de un ciclo se suma a ese ciclo por la misma regla de asignación. No abre un ciclo nuevo. Solo el ingreso recurrente principal define los límites de los ciclos.

### 5.4 Múltiples fuentes de ingreso

Un usuario puede tener más de un ingreso recurrente con calendarios distintos: por ejemplo, un salario el día 21 y honorarios el día 5.

**Solo una fuente define los ciclos.** El usuario designa cuál, y las demás se registran como ingresos que caen dentro del ciclo vigente por la regla de la sección 3.

La alternativa (generar ciclos a partir de todas las fuentes) produce periodos cada vez más cortos y solapados a medida que se agregan fuentes, y hace que agregar un ingreso reordene todo el calendario histórico. No se implementa.

Si el usuario cambia cuál es la fuente que define los ciclos, eso es un cambio de configuración y se trata según 2.2.4.

## 6. Requerimientos funcionales

**Configuración**

| ID | Requerimiento |
|---|---|
| RF-01 | Cada usuario define su propia configuración de ciclos. El sistema no aplica ninguna configuración por defecto sin elección explícita del usuario. |
| RF-02 | El sistema permite configurar frecuencia, anclas, política de día no hábil, calendario de festivos y comportamiento de fin de mes (sección 2.2.1). |
| RF-03 | El sistema soporta todos los esquemas listados en 2.2.2 mediante configuración, sin ramas de código específicas por esquema. |
| RF-04 | El sistema permite definir manualmente las fechas de inicio de ciclo para usuarios con ingresos irregulares. |
| RF-05 | El sistema permite al usuario previsualizar los próximos ciclos que genera una configuración antes de guardarla. |

**Motor de ciclos**

| ID | Requerimiento |
|---|---|
| RF-06 | El sistema genera el calendario de ciclos a partir de la configuración vigente, con fechas de inicio y fin calculadas. |
| RF-07 | El sistema almacena la configuración como versiones con fecha de vigencia, y conserva el histórico de versiones anteriores. |
| RF-08 | Un cambio de configuración aplica solo hacia adelante desde su fecha de vigencia. Los ciclos ya cerrados no se recalculan. |
| RF-09 | El sistema identifica y marca como ciclo de transición el periodo generado entre dos versiones de configuración. |
| RF-09a | Al cambiar la configuración, el sistema exige la fecha del primer pago bajo el esquema nuevo y no la infiere. |
| RF-09b | El sistema excluye los ciclos de transición de promedios, tendencias, comparaciones y alertas. |
| RF-09c | El sistema permite prorratear un gasto recurrente entre los ciclos anteriores a su vencimiento, descontando la reserva del disponible de cada uno. |

**Asignación y balance**

| ID | Requerimiento |
|---|---|
| RF-10 | El sistema asigna cada movimiento a un ciclo aplicando la regla de la sección 3, sin intervención manual. |
| RF-11 | El sistema calcula el balance de cada ciclo como ingresos menos gastos del mismo ciclo. |
| RF-12 | El sistema permite registrar gastos recurrentes con día de vencimiento y los proyecta a los ciclos futuros. |
| RF-13 | El sistema distribuye las cuotas de una compra diferida en los ciclos correspondientes a sus fechas de vencimiento. |
| RF-14 | El sistema permite marcar un ingreso como extraordinario y asignarlo manualmente a un ciclo distinto de aquel en que se recibió. |
| RF-15 | El sistema permite designar cuál fuente de ingreso define los ciclos cuando existe más de una. |

**Presentación**

| ID | Requerimiento |
|---|---|
| RF-16 | El sistema ofrece una vista alterna por mes calendario, claramente diferenciada de la vista por ciclo. |
| RF-17 | El sistema muestra, dentro del ciclo activo, el saldo disponible después de descontar los gastos comprometidos aún no pagados. |
| RF-18 | El sistema advierte cuando los gastos proyectados de un ciclo futuro superan el ingreso esperado de ese ciclo. |
| RF-19 | Las comparaciones entre ciclos indican cuando los periodos comparados tienen duración distinta. |

## 7. Reglas de validación

| ID | Regla |
|---|---|
| RV-01 | Ningún movimiento puede quedar sin ciclo asignado. |
| RV-02 | Ningún movimiento puede pertenecer a más de un ciclo. |
| RV-03 | Los ciclos deben ser contiguos: el fin de un ciclo es el día anterior al inicio del siguiente, sin huecos ni traslapes. |
| RV-04 | Un ciclo con ingresos y sin gastos, o con gastos y sin ingresos, se marca como anomalía de configuración y requiere revisión. |
| RV-05 | La suma de los balances de todos los ciclos de un periodo debe igualar la suma de ingresos menos gastos de ese mismo periodo calculada de forma independiente. |
| RV-06 | La contigüidad de RV-03 debe cumplirse también en la frontera entre dos versiones de configuración. |
| RV-07 | Un cambio de configuración no puede alterar el balance de ningún ciclo anterior a su fecha de vigencia. Verificable comparando balances históricos antes y después del cambio. |
| RV-08 | Ninguna configuración válida puede generar ciclos de duración cero o negativa, ni anclas duplicadas dentro del mismo periodo. |
| RV-09 | Toda fecha de inicio de ciclo debe respetar la política de día no hábil configurada, contra el calendario de festivos del usuario. |
| RV-10 | La suma de las reservas prorrateadas de un gasto debe igualar el monto del gasto. Una reserva no puede asignarse a un ciclo posterior al vencimiento. |

## 8. Casos abiertos para discovery

Los siguientes casos surgieron al modelar la feature pero no están resueltos en este documento. Algunos pueden estar ya cubiertos por comportamiento existente de la aplicación; el propósito de listarlos es verificar en discovery si aplican, y si lo hacen, si el comportamiento actual sigue siendo correcto bajo la frontera del ciclo en vez de la del mes calendario.

### 8.1 Arrastre de saldo entre ciclos

**Pregunta:** ¿el sobrante de un ciclo pasa al siguiente, o cada ciclo arranca en cero?

Las dos opciones son válidas y producen productos distintos. Con arrastre, el balance refleja la posición acumulada del usuario. Sin arrastre, cada ciclo mide el desempeño de ese periodo de forma aislada.

El caso a resolver es el déficit: si un ciclo cierra en rojo, ese faltante tiene que aparecer en algún lugar del siguiente.

**A verificar:** si la aplicación ya arrastra saldos, confirmar que la lógica opera sobre la frontera del ciclo y no sobre la del mes calendario. Es una falla silenciosa: el cálculo funciona, pero contra el periodo equivocado.

### 8.2 Ingreso recibido fuera de la fecha esperada

**Pregunta:** ¿cómo se comporta un ciclo cuyo ingreso se atrasa o se adelanta respecto de lo proyectado?

Los ciclos se definen por fecha real de recepción (sección 3.1), pero el ciclo no puede quedar sin abrir esperando confirmación. Sugiere separar fecha esperada, que abre el ciclo de forma provisional, de fecha real, que lo confirma y ajusta sus fronteras.

**Conflicto conocido:** la RV-04 marca como anomalía un ciclo con gastos y sin ingresos. Un ingreso pendiente produciría ese estado de forma legítima. La regla necesita distinguir ambos casos.

### 8.3 Ingreso de monto variable

**Pregunta:** ¿cómo se proyectan los ciclos futuros cuando el monto del ingreso no es fijo?

Aplica a comisiones, horas extra, honorarios y cualquier componente variable de la remuneración. Las proyecciones requieren un estimado, y la interfaz debe distinguir de forma inequívoca entre monto proyectado y monto confirmado.

Si ambos se presentan igual, el usuario presupuesta contra ingresos que aún no existen.

### 8.4 Corrección retroactiva de movimientos

**Pregunta:** ¿qué pasa cuando se corrige un movimiento perteneciente a un ciclo ya cerrado?

Corregir un dato mal capturado **sí debe** recalcular el balance del ciclo afectado. Es un caso distinto al de la RV-07, donde lo que se prohíbe es que un cambio de configuración altere balances históricos.

**A verificar:** que ambos casos estén implementados por caminos separados. Tratarlos como el mismo produce uno de dos errores: o los cambios de configuración corrompen el histórico, o las correcciones legítimas quedan bloqueadas.

### 8.5 Reembolsos y reversiones

**Pregunta:** cuando un reembolso llega en un ciclo distinto al del gasto original, ¿corrige el ciclo original o entra como ingreso en el ciclo actual?

Es el caso de menor impacto de esta lista, pero sin definición explícita cada implementación lo resuelve distinto y los balances dejan de ser comparables entre sí.

## 9. Fuera de alcance

Este modelo aplica al presupuesto operativo del usuario. No modifica el criterio tributario: para efectos de declaración de renta de persona natural no obligada a llevar contabilidad, el ingreso se realiza en la fecha en que efectivamente se recibe, con independencia del ciclo al que se le asigne aquí.

Si el sistema genera reportes con fines tributarios, deben construirse sobre la vista de mes calendario (RF-16), no sobre la vista de ciclos.
