# FEATURE_IDEA — multi-anio

_Escrito el 2026-09-02. Punto 1 del orden acordado tras el reorden de esa fecha (ver
`aitri/BACKLOG.md` § «Orden acordado»). Todo lo marcado como decisión del usuario se confirmó con él
en esa conversación; nada aquí es inferencia salvo lo que diga [ASSUMPTION]._

## Problem / Why

**El año no existe en el producto.** T-Ledger es un único año implícito: quien lo use más de doce
meses no tiene dónde poner el mes trece, no puede mirar atrás y no puede planear más allá de
diciembre.

Sale de una respuesta concreta del usuario. Diseñando la grilla dinámica se le preguntó cómo llegaría
a un mes pasado que quedó oculto, y contestó, textual:

> «Puede scrolear o con filtro de fechas (meses) para mostrar. Pone filtro, mostrar desde enero 2024
> y allí scrolea todo lo que necesite.»

Ese filtro cruza el año. Se le plantearon las dos salidas —filtro limitado al año en curso, o subir
multi-año en el orden— y decidió: **«Hay que hacer multi año, ya lo habíamos discutido.»**

Antecedente suyo del 2026-09-01, en `meses-y-saldo-inicial/FEATURE_IDEA.md`: «a futuro, poder
mostrar al menos 12 o 24 meses hacia adelante» y «cuando haya mucha historia, poder seleccionarlos
desde el selector de año».

**Por qué ahora y no después.** El 2026-09-02, por decisión del usuario, se vaciaron `amount_cell`
(219 filas), `movement` (1) y `cell_note` (2). Las tres tablas que llevan `month` están hoy en
**cero filas**; solo sobreviven los 23 nodos de la estructura, que no dependen del año. La migración
de datos, hoy, no tiene datos que migrar. Es la ventana más barata que va a existir.

## Target Users

El mismo usuario individual del proyecto raíz —gestiona sus finanzas personales, planea en escritorio
y captura en móvil— con la diferencia que define esta feature: **lleva más de un año usando la app**,
o quiere transcribir historia anterior a su primer mes. Persona heredada de los requisitos aprobados
del proyecto raíz; no se inventa una nueva.

## New Behavior

1. **El periodo pasa a ser año + mes.** Recomendación técnica: sustituir `MonthKey` por una única
   clave `PeriodKey = "YYYY-MM"`, ordenable como texto, en vez de añadir un `year` aparte y anidar
   los mapas. Razón: `AmountMap` y toda la lógica de `reserve.ts` operan sobre UNA lista ordenada de
   periodos; con una clave única el algoritmo sobrevive con la lista de otro tamaño, mientras que
   anidar por año obliga igualmente a aplanar para que el arrastre cruce diciembre→enero — el mismo
   trabajo más la anidación.

2. **La grilla es un rango continuo que cruza años, no un año a la vez.** Decisión del usuario, tras
   plantearle las dos formas. Coherente con «mostrar desde enero 2024 y allí scrolea». Consecuencia
   aceptada: el borde diciembre→enero se lee de corrido, sin cambiar de pantalla.

3. **El arrastre cruza el borde de año.** El saldo de diciembre abre enero del año siguiente. Se le
   presentó como supuesto y no lo corrigió; es lo que hace de esto un libro contable continuo y no
   doce columnas sueltas.

4. **El horizonte futuro es configurable: 12 o 24 meses, a elección del usuario.** Textual: «quizá
   configurable, 12 o 24 meses a elección de usuario». Es un horizonte rodante desde el mes en curso:
   la ventana avanza sola cada mes. No es un número fijo del sistema.

   *Dónde vive el ajuste, a validar en Fase 2:* la página de Configuración es el punto 4 del orden
   acordado, así que hoy no existe. Lo configurable verificado en el código son el tema
   (`ThemeToggle.tsx`) y el ancho de la columna de categorías (`readCatWidth`/`writeCatWidth`,
   FR-104), que persiste por su cuenta. Propuesta: persistir el horizonte igual que el ancho de
   columna, con **24 por defecto**, y que el control definitivo aterrice en Configuración cuando esa
   página exista. Así esta feature no queda bloqueada por una pantalla posterior ni inventa una de
   ajustes por su cuenta.

## Touch Points

Estado verificado en el código el 2026-09-02 — hechos, no estimaciones.

**Dominio.** `MonthKey` son doce literales (`"ene"…"dic"`, `src/domain/types.ts:9`); `AmountMap` es
`Record<nodeId, Partial<Record<MonthKey, number>>>`. `MonthKey` aparece en **19 archivos**:
`reserve.ts` (25 referencias), `migrate.ts` (12), `BudgetGrid.tsx` (10), `store.ts` (9),
`ReserveCells.tsx` (7), `ledgerRepo.ts` (6), y el resto con 2–5.

**El supuesto de «doce casillas» está en la LÓGICA, no solo en la vista.**
`computeBalanceSeries` (`balance.ts:142`) recorre `MONTH_KEYS` entero y abre en `ZERO_CARRY`.
`reserve.ts` opera por índice sobre esa lista de doce: `MONTH_KEYS.indexOf(month)`, bucles
`for (let k = i; k < MONTH_KEYS.length; k++)`, y el techo tomando el mínimo de la serie «desde este
mes hasta el final». Con horizonte abierto «el final» deja de existir — de ahí que el horizonte
configurable no sea un adorno de UI sino un input del cálculo.

**Base de datos.** Tres tablas llevan `month text` con CHECK contra los doce literales:
`amount_cell`, `movement` y `cell_note`. En `amount_cell` y `cell_note` **`month` forma parte de la
llave primaria**. La migración toca llaves primarias, constraints y el `data_version` de `ledger`.

**Pruebas.** 32 de los 84 ficheros de prueba mencionan meses literales o `MonthKey` — el 38 % de la
suite entra en el radio del cambio.

**Presentación.** `BudgetGrid.tsx`, `BalanceModule.tsx`, `Dashboard.tsx`, `ReserveCells.tsx`,
`register/ReserveRow.tsx` y el selector de mes de `DesktopShell.tsx` pintan los doce meses sin
condición.

## Must Not Break (Regression Boundary)

Esta feature reescribe el eje temporal del que cuelga TODO el producto. Es el mayor riesgo de
regresión del proyecto hasta la fecha, y el usuario fijó la no-regresión como parte de la medida de
éxito, no como un extra.

- **La suite completa sigue verde.** 610+ pruebas unitarias y e2e existentes pasan tras la
  migración. Es la mitad del criterio de éxito confirmado por el usuario.
- **El arrastre de saldo sigue siendo correcto dentro de un año.** `computeBalanceSeries` produce
  los mismos números para un año que hoy son correctos.
- **El techo de flujo y la maquinaria de reservas conservan su veredicto.** `reserve.ts` —
  headrooms encadenados, `verdictOf`, límite del techo, regla de déficit, `maxWithdrawal`,
  `monthCarryUsage`— da los mismos resultados para los mismos datos dentro de un año. Es la capa que
  acaba de pasar un pase adversarial de 6.000 pasos; no puede degradarse.
- **Los roll-ups jerárquicos** (hoja → subcategoría → categoría → grupo → tipo) no cambian.
- **La persistencia no pierde nada ni rompe el bloqueo optimista** por `revision`
  (`src/server/data/ledgerRepo.ts`).
- **El registro móvil sigue capturando** contra el periodo correcto.

## Success Criteria

Confirmado por el usuario el 2026-09-02 — «planear cruzando años sin romper nada». Dos condiciones
observables, ambas obligatorias:

1. **Cruzar el año funciona.** El usuario registra y planea meses de 2027, y el saldo de diciembre de
   2026 abre enero de 2027 encadenado, visible en la misma tira continua sin cambiar de pantalla.
2. **Nada se rompió.** Las 610+ pruebas existentes siguen verdes tras la migración. Es la condición
   que protege de verdad: el 38 % de la suite toca meses literales.

## Out of Scope

Confirmado por el usuario el 2026-09-02, los cuatro puntos:

- **Ocultar meses vacíos y el filtro visual de rango** — es la feature `grilla-dinamica` (punto 2),
  que se construye ENCIMA de ésta. Aquí se entrega el modelo con años; allí, la presentación. Su
  expediente ya está escrito en `aitri/features/grilla-dinamica/FEATURE_IDEA.md`.
- **Cierre de mes** (punto 3) y **saldo inicial + página de Configuración** (punto 4). No se tocan,
  aunque ambos dependan del modelo temporal que esta feature deja montado.
- **Multi-moneda.** El brief original excluyó «multi-año y multi-moneda» juntos como Fase 2.
  Multi-año se está haciendo; la moneda sigue siendo COP única y fuera de alcance.
- **Importar historia de años anteriores.** Ninguna carga masiva ni importador: si el usuario quiere
  2024 y 2025, los teclea.

## Preguntas abiertas — CONFIRMAR antes de cerrar la Fase 1

1. **¿Hasta dónde llega el pasado?** El futuro ya está acotado por el horizonte configurable; el
   pasado no. ¿El rango llega hasta el primer mes con datos, o el usuario declara desde cuándo?
   (Conecta con el «mes de inicio declarado» del punto 4, que aquí todavía no existe.)
2. **¿Qué ve un usuario nuevo, sin ningún dato?** No tiene pasado: su rango sería el mes en curso más
   el horizonte. Conviene dejarlo dicho explícitamente.
