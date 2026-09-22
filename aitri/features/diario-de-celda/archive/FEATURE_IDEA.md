# FEATURE_IDEA — diario-de-celda

_Escrito el 2026-09-14 a partir de BL-044 (`aitri/product/spec/BACKLOG.json`), que se redactó el
2026-09-09 midiendo el código y con los datos reales del usuario. Lo marcado `[ASSUMPTION]` todavía no
lo confirmó el usuario; lo marcado `[DECISIÓN ABIERTA]` se resuelve en el discovery._

## Feature
Al abrir cualquier celda hoja, su panel muestra los movimientos que la forman —día, monto y nota— y
permite cargar uno nuevo desde ahí, de modo que la celda suma sola.

## Problem / Why
La nota de un movimiento de **ingreso o gasto** no se ve en ninguna parte de la aplicación. El dato se
guarda (`movement.note`) y nada lo lee.

Caso real que originó la petición (2026-09-09, con 27 movimientos cargados): al abrir
Tecnología > Accesorios de agosto (187.500) el usuario no podía saber qué fue. La celda decía «Sin
observaciones este mes» mientras la nota «Accesorio de cámara» estaba en la base.

Medido en el código:
- `cellObservations` (`src/domain/reserve.ts`) arma las observaciones de una celda con las notas
  manuales y las notas de movimientos, pero filtra por `m.type === "transfer"`: los gastos e ingresos
  quedan fuera por construcción.
- Ninguna pantalla lista movimientos. El diario de ingresos y gastos no existe como superficie.
- Esa invisibilidad ya costó un bug: BG-017 (un ingreso de 6.500.000 apuntado a un nodo que ya no era
  hoja) se detectó solo mirando la base.

Lo que el usuario pidió, en sus palabras: que la observación «tenga un campo de valor y la celda sume
sola». **No se construye así:** hoy ya hay dos escritores del mismo número (`setLeafAmount` asigna,
`addMovement` acumula) y una nota con valor sería un tercero. El mecanismo que el usuario describe ya
existe —es el movimiento—; lo que falta es la superficie.

## Target Users
El usuario del ledger (hoy, una sola cuenta en producción) cuando revisa o carga sus gastos e ingresos
del mes.

## New Behavior
- Al abrir el editor de cualquier celda hoja, el panel lista los movimientos de ese nodo y ese periodo
  en orden cronológico, cada uno con día, monto y nota. Un movimiento sin nota se lista igual.
- Desde el panel se puede añadir un movimiento: monto, concepto y fecha, con la fecha por defecto
  dentro del periodo de la celda. Delega en `addMovement` y la celda sube sola; el usuario nunca teclea
  el total.
- Las notas manuales de la celda (`cellNotes`) se siguen mostrando, visualmente distinguibles de las
  notas de movimientos (`CellObservation.source` ya distingue `movement` de `manual`).
- Una celda cuyo valor tecleado no coincide con la suma de sus movimientos lo dice. No se elige un
  ganador en silencio.

## Success Criteria
- Dado agosto con el movimiento «Accesorio de cámara» de 187.500, cuando abro Tecnología > Accesorios
  de agosto, entonces veo «26 ago · 187.500 · Accesorio de cámara» en lugar de «Sin observaciones este mes».
- Dada Restaurantes de agosto formada por cuatro consumos, cuando abro la celda, entonces veo los
  cuatro en orden cronológico y su suma es exactamente el valor de la celda (336.700).
- Dado el panel abierto, cuando añado un movimiento, entonces el total de la celda sube sin teclearlo.
- Dada una celda con movimientos, cuando tecleo un valor distinto de su suma, entonces la interfaz
  muestra el descuadre. `[ASSUMPTION]` La forma exacta depende de la decisión abierta 1.

## Touch Points
Modifica:
- `src/domain/reserve.ts` — `cellObservations`, que hoy excluye gastos e ingresos.
- `src/components/ReserveCells.tsx` — `CellNotesSection`, el panel de la celda.
- `src/components/BudgetGrid.tsx` — `EditableCell`, y la edición directa del valor (`setLeafAmount`).
- `src/domain/mutations.ts` — `addMovement` y `setLeafAmount`.
- `src/app/api/v1/movements/…` — hoy PATCH y DELETE responden «no soportado» (decisión abierta 3).

Interactúa con reglas ya entregadas: cierre de mes (un mes cerrado congela el alta de movimientos),
ciclos de pago (el periodo de una celda puede ser un ciclo, y el movimiento se asigna por su fecha) y
las reglas del servidor (`reglas-en-el-servidor`).

## Must Not Break (Regression Boundary)
- Las celdas de bolsillos (tipo `transfer`) muestran sus observaciones derivadas del journal exactamente
  como hoy, y pasan sus TCs existentes sin cambios.
- Un mes cerrado sigue sin admitir movimientos nuevos por ninguna vía, incluido este panel; las
  observaciones manuales de la celda siguen siendo editables en un mes cerrado.
- En modo ciclos, un movimiento cargado desde el panel cae en el ciclo que corresponde a su fecha, igual
  que un movimiento cargado por la vía actual.
- Cargar un movimiento por la vía actual sigue sumando a su celda igual que hoy.
- Las reglas de techo y piso siguen validándose en el servidor para cualquier movimiento nuevo.

## Out of Scope
- Notas con valor que sumen a la celda: descartado a propósito (sería un tercer escritor del mismo número).
- Ligar un gasto a la alcancía que lo financió (BL-035, diferido por decisión del usuario del 2026-08-29).

## Decisiones del usuario (discovery guiado, 2026-09-14)
- **D1 — escribir a mano crea un ajuste.** Teclear un valor en la celda de EJECUTADO crea un movimiento de
  ajuste por la diferencia (sube o baja), con descripción vacía y un texto por defecto; el usuario puede
  escribirle la descripción después. La celda y su lista de movimientos siempre cuadran. (El presupuesto
  no tiene movimientos y se sigue tecleando como hoy.)
- **D1a-final — manda el CIERRE, no la fecha de fin (opción a, elegida tras repasar las reglas de
  cierre-de-mes FR-2002..FR-2010).** Se puede anotar, editar y borrar en cualquier mes/ciclo que NO esté
  cerrado —terminado o en curso—, y en el último reabierto; la fecha tiene que caer dentro de ese
  mes/ciclo (con la excepción del ingreso adelantado de D9). Un mes/ciclo cerrado no admite nada y lo
  olvidado va como movimiento en uno abierto. Es como la app funciona hoy con «Nuevo movimiento».
  SUPERA a la versión intermedia de abajo, que decía «un ciclo que ya terminó no admite registros».
- **D1a (versión intermedia, superada por D1a-final)** — dónde y con qué fecha se anota. Solo se
  anota en el mes/ciclo EN CURSO, o en uno REABIERTO. La fecha puede ser cualquiera DENTRO de ese mes/ciclo
  (por defecto la del sistema). Un mes/ciclo que ya terminó, o que está cerrado, no admite más registros:
  lo olvidado se anota como ajuste en el mes/ciclo actual. Primera versión de esta respuesta, ya superada:
  «la fecha es el timestamp del sistema».
- **D1b — también en celdas sin movimientos**, con nota automática por defecto.
- **D1c — ajustes negativos, sí.** Hoy la app no acepta movimientos negativos; esta feature los introduce
  solo para los ajustes. La celda nunca baja de 0.

- **D2 — las 28 notas manuales se quedan.** Conviven con los movimientos en la misma sección de la celda,
  y TODAS las entradas (movimientos, notas manuales y notas automáticas de bolsillos) comparten un estilo
  visual similar al de las notas automáticas actuales.
- **D4 — alcance recortado tras revisar «Nuevo movimiento» (el usuario lo pidió).** Cargar transacciones YA
  está resuelto: el formulario existente (`src/components/register/Register.tsx`) pide tipo, monto,
  categoría, fecha (que asigna mes o ciclo) y «Nota (opcional)». Lo que falta es VERLAS: ninguna pantalla
  lista movimientos después de guardarlos. Por tanto:
  - la **vía principal** para registrar es «Nuevo movimiento», sin formulario nuevo;
  - el detalle de la celda **lista** sus movimientos y comentarios;
  - **escribir directo en la grilla sigue permitido** como vía secundaria y crea el ajuste de D1.
  Sin notas con monto y sin un segundo formulario.
- **D6 — «Añadir movimiento» dentro del detalle de la celda (UX elegida, opción b).** Se descartó abrir el
  formulario grande desde la celda: el usuario lo vio raro, porque al tocar la celda ya se está escribiendo
  en ella. En su lugar, el detalle ofrece una línea compacta **monto + nota** (fecha por defecto la de hoy,
  editable dentro del mes/ciclo), como el campo de comentario que ya existe: escribir «30.000 · Almuerzo»
  suma a la celda sin cuentas mentales y con la nota en el momento. Motivo con datos del usuario: sus 27
  movimientos tienen nota (el 100 %) y hay celdas con varios gastos (hasta 7), así que la opción (a)
  —teclear el total nuevo y poner la nota después— obligaba a sumar de cabeza y dejaba ajustes sin contexto.
  Teclear el número en la celda sigue creando el ajuste (D1) para corregir un total.
- **D5 — un movimiento guardado se puede EDITAR: monto, nota y fecha («todo»).** Con las mismas reglas de
  D1a: solo en el mes/ciclo en curso o en uno reabierto, y la nueva fecha tiene que quedar dentro de ese
  mismo mes/ciclo. Hoy no existe (la API responde «Operación no soportada en v1»). Confirmado además:
  - **se puede BORRAR** un movimiento (p. ej. un gasto cargado dos veces);
  - **se puede cambiar la CATEGORÍA**: el monto sale de una celda y entra en la otra, dentro del mismo
    mes/ciclo.
- **D7 — comentarios nuevos, sí.** Se pueden seguir agregando comentarios (solo texto) en la celda, con el
  mismo formato nuevo que movimientos y comentarios automáticos.
- **D10 — editar la FECHA sí puede mover un movimiento a otro mes/ciclo (supera en parte a D8).** Al preparar la
  fase 1 apareció que FR-2405 (feature `ciclos`, aprobada) ya dice: «editar la fecha de un movimiento de 20-oct a
  21-oct lo mueve de Octubre a Noviembre». Presentada la contradicción con D8, el usuario eligió que gane FR-2405:
  cambiar la fecha reasigna el ciclo, siempre que ni el de origen ni el de destino estén cerrados. Queda fuera
  solo arrastrar un movimiento a otra celda.
- **D8 (superada en parte por D10)** — mover un movimiento a OTRO mes/ciclo queda FUERA. Si hace falta, se borra y se crea de nuevo en el
  ciclo correcto. El usuario pidió que se le avise si aparece una buena razón para incluirlo.
- **D9 — editar valida la fecha igual que «Nuevo movimiento».** Motivo: el formulario ya permite que un
  INGRESO cercano al día de pago cuente en el ciclo que abre aunque su fecha caiga en el anterior
  (`Register.tsx`, propuesta de pago adelantado, FR-2405/FR-2406). Exigir «fecha dentro de su ciclo» al
  editar rechazaría esa fecha legítima. Cargar y editar se comportan igual. (En los datos del usuario hoy
  no hay ningún ingreso en ese caso.)
- **Criterios de éxito confirmados por el usuario:** los 8 propuestos en el discovery, con el 2 cambiado a
  «Añadir movimiento» dentro del detalle.
- **D3 — un nombre para cada cosa, en toda la app** (el usuario pidió dejar de alternar entre notas,
  observaciones y detalles). Confirmado:
  - **Detalle**: lo que se ve al abrir la celda (reemplaza a «Observaciones»).
  - **Movimiento**: cada línea con fecha y monto; un ajuste también es un movimiento.
  - **Nota**: el texto de un movimiento (el formulario ya lo llama «Nota (opcional)»). Donde este documento
    dice «descripción» de un ajuste, es su nota.
  - **Comentario**: una línea solo de texto, sin monto (las 28 manuales y las automáticas de bolsillos).
  «Un movimiento tiene nota; la celda tiene comentarios.»

## Decisiones abiertas (se resuelven en el discovery, con el usuario)
1. **La central:** qué manda cuando el valor tecleado de la celda y la suma de sus movimientos
   discrepan. (a) la celda pasa a solo lectura cuando tiene movimientos; (b) teclear crea un movimiento
   de ajuste por la diferencia; (c) la celda sigue mandando y se marca el descuadre.
2. Si las notas de movimientos sustituyen a las 27 observaciones manuales duplicadas escritas el
   2026-09-09 (y entonces se borran) o si conviven.
3. Si entra en alcance editar o borrar un movimiento, que hoy el producto no tiene.

_BG-017, que BL-044 proponía cerrar aquí, ya está arreglado: `repointMovements` re-apunta todos los
tipos de movimiento. Queda fuera de esta feature._

_Las cifras de los ejemplos (187.500, 336.700, 6.500.000, «Accesorio de cámara») son las anonimizadas
de BL-044 y NO existen en la base real. Los criterios de éxito se comprueban con datos de prueba._
