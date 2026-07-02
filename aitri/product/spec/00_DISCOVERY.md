# Product Discovery — Problem Statement

**Resumen del problema (≤3 frases):** Una persona que gestiona sus finanzas personales necesita
registrar cada movimiento de dinero (gasto/ingreso/transferencia) y contrastarlo contra un presupuesto
propio a lo largo del año, pero hoy la captura y el presupuesto viven en herramientas separadas y rígidas.
Ledger unifica ambas cosas sobre los mismos datos, con una taxonomía de categorías que el propio usuario
gestiona. Es una app web responsive: en pantalla grande es la herramienta completa de planeación y análisis;
en pantalla pequeña, en esta primera versión, es una vista compacta pensada solo para capturar movimientos.

---

## Problem

La persona que quiere llevar sus finanzas personales "contra presupuesto" enfrenta hoy una fricción
concreta: la **captura** de un gasto (algo que ocurre muchas veces al día, en cualquier momento) y la
**planeación/análisis** del presupuesto anual son actividades distintas que las herramientas actuales no
conectan sobre los mismos datos.

- Con hojas de cálculo: el usuario define su propio presupuesto y categorías, pero registrar cada
  movimiento es tedioso, propenso a error, y la relación plan-vs-realidad hay que calcularla a mano.
- Con apps genéricas de finanzas: la captura puede ser cómoda, pero la taxonomía es rígida (no puede
  modelar sus propios grupos/categorías/subcategorías) y no ofrecen una vista de presupuesto anual de
  12 meses con agregación jerárquica (roll-up) de lo presupuestado vs lo ejecutado.

El resultado es que el usuario **no tiene una foto confiable y siempre-actualizada** de si va dentro o
fuera de su presupuesto, por categoría, en el mes y en el año. La situación que lo fuerza a actuar es
cotidiana: acaba de gastar y quiere dejar el registro en segundos; y periódicamente quiere sentarse a
revisar y ajustar el plan del año.

**Baseline actual:** existe un prototipo web offline de alta fidelidad (`idea_context/Ledger (offline).html`)
cuyas reglas de cálculo son la implementación de referencia — demuestra que el modelo funciona, pero no es
un producto mantenible ni desplegable.

## Users

**Usuario principal — Dueño de sus finanzas personales (single-user en v1).**
Un individuo que quiere controlar su dinero contra un presupuesto propio. Nivel técnico medio: cómodo con
herramientas web básicas, no es contador ni experto en software de contabilidad. Tiene dos momentos de uso
claramente distintos:
- **Capturar (frecuente, en cualquier pantalla):** acaba de gastar/recibir dinero y quiere registrarlo
  rápido. Este momento ocurre a menudo desde una pantalla pequeña. Su meta: dejar el movimiento asentado
  en pocos pasos, sin fricción.
- **Planear y analizar (periódico, en pantalla grande):** se sienta a revisar el año, ajustar lo
  presupuestado por categoría, y leer indicadores de salud financiera. Su meta: entender de un vistazo si
  va dentro del plan y dónde se está desviando.

**Usuario secundario — Autor / revisor técnico del portafolio.**
El proyecto también es una pieza de portafolio. El revisor (nivel técnico alto) evalúa que el flujo
completo funcione sin errores, que los datos sean coherentes entre las distintas vistas, y que las
decisiones de producto sean defendibles. Su meta: constatar una app coherente end-to-end, no un demo a medias.

## Success Criteria

Observables y falsables. La v1 tiene éxito si:

1. **Primer arranque operable sin configuración:** al abrir la app sin datos previos, el usuario ve una
   estructura de categorías y montos semilla coherentes y puede empezar a operar de inmediato (0 pasos de
   configuración obligatorios).
2. **Captura completa en pocos pasos:** desde el módulo de registro, el usuario puede asentar un movimiento
   eligiendo tipo → categoría → mes → monto y confirmando, y el movimiento queda reflejado en el total
   ejecutado de su categoría y en la lista de recientes inmediatamente (≤1 s de feedback visible).
2b. **Consistencia captura→presupuesto:** un movimiento registrado incrementa el "ejecutado" de la hoja
    destino en exactamente el monto capturado, y ese incremento sube por la jerarquía (categoría → grupo → tipo).
3. **Gestión de la propia taxonomía:** el usuario puede crear, renombrar y borrar grupos, categorías y
   subcategorías; los cambios persisten al recargar.
4. **Borrado sin pérdida de historial:** al borrar una categoría que tiene movimientos, esos movimientos se
   conservan reasignados a una categoría "Sin asignar" de su mismo grupo — cero movimientos huérfanos tras
   la operación.
5. **Plan-vs-realidad en el escritorio:** en pantalla grande el usuario ve, para los 12 meses del año, lo
   presupuestado y lo ejecutado por categoría, y al editar el valor de una hoja los totales de sus
   ancestros se recalculan al instante (≤150 ms de reflejo perceptible).
6. **Salud financiera de un vistazo:** el dashboard muestra los indicadores clave (ingresos, gastos, balance
   neto, tasa de ahorro, adherencia al presupuesto, top categorías de gasto, categorías sobre-presupuesto)
   y responde al filtro de periodo (mes / año) recalculando sobre el periodo elegido.
7. **Vista compacta móvil coherente:** en pantalla pequeña (v1) el usuario ve únicamente el módulo de
   registro; presupuesto y dashboard no se muestran ahí, pero los datos capturados en pantalla pequeña son
   los mismos que se ven en pantalla grande.
8. **Éxito global (criterio principal):** el flujo end-to-end (capturar → gestionar categorías → editar
   presupuesto → leer dashboard) se recorre completo con datos coherentes entre todas las vistas y sin bugs
   observables — "demo funcional completa".

## Out of Scope

Fronteras explícitas de esta primera versión:

1. **Presupuesto y dashboard en pantalla pequeña:** en v1 la vista compacta (móvil) muestra SOLO el módulo
   de captura de movimientos. La grilla de presupuesto anual y el dashboard son de pantalla grande. Ampliar
   la experiencia de pantalla pequeña queda para una versión posterior.
2. **Reparto proporcional al editar un total padre:** editar el presupuesto/ejecutado se hace sobre las
   hojas; los niveles superiores se calculan por agregación. No existe la función de "editar un total padre
   y que se reparta hacia abajo".
3. **Cuentas de usuario / multiusuario / libros compartidos:** v1 es de un solo usuario, sin inicio de
   sesión. No hay libros compartidos ni permisos.
4. **Conexiones/servicios externos:** v1 no se conecta con bancos ni servicios externos para importar o
   consultar movimientos.
5. **Multi-año y multi-moneda:** v1 cubre un único año y una única moneda.
6. **Reordenar por arrastre y exportar datos:** no se pueden reordenar categorías arrastrándolas ni exportar
   la información a archivos.
7. **Preferencias de apariencia configurables:** los ajustes de acento/densidad/énfasis quedan fijos en sus
   valores base; no se exponen como preferencias editables por el usuario.

## Discovery Confidence
Confidence: high
Evidence gaps:
  - D-3: si el "ejecutado" en la grilla del escritorio es editable a mano (override) o se deriva solo de los movimientos capturados — a resolver en diseño (Fase 1/2). No bloquea el problema.
  - D-8: si un movimiento puede asignarse directamente a una subcategoría y cómo interactúa con el presupuesto a nivel categoría — a precisar en diseño. No bloquea el problema.
  - Umbral exacto de tamaño de pantalla para conmutar entre vista compacta y completa — decisión de diseño, no del problema.
Handoff decision: ready — problema, usuarios, éxito y fronteras confirmados con el owner; los gaps abiertos son de diseño, no de definición del problema.
