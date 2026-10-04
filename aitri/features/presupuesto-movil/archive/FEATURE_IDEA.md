## Feature
Gestionar las finanzas del mes desde el teléfono (BL-056, primera entrega): elegir un mes o ciclo y ver el presupuesto por categoría, cambiar lo planeado, ver y corregir los movimientos de una categoría, operar las alcancías y ver el Balance del mes. Hoy todo eso se hace solo en el computador.

## Problem / Why
A ≤760px la app solo muestra el registro de movimientos (`MobileShell.tsx`). Todo lo demás exige el computador: ver cómo va el mes, cambiar el presupuesto, corregir un gasto mal anotado, mover plata de las alcancías y ver el Balance.

Palabras del usuario del 2-oct-2026:
- «lo que necesito es poder consultar de alguna forma el mes y el presupuesto, lo que tenga en la grilla»
- «podría ser los gastos. si se pueden editar desde mobile también»
- «más que ver la grilla, lo que necesito es poder gestionar mis finanzas desde el teléfono. la app ya lo permite desde desktop»

El mismo día el usuario aceptó partir el pedido en dos entregas. Esta feature es la PRIMERA, con lo que se usa cada mes. La segunda entrega se hará en otra feature: categorías y cierre de mes. El usuario decidió además que el dashboard queda fuera del teléfono («ok, el dashboard queda fuera»).

Que el móvil no muestre la grilla es una decisión aprobada de la raíz (FR-010 y su no_go_zone: «ampliar la experiencia móvil → posterior»). Esta feature es el change request a FR-010.

## Target Users
El dueño del libro (usuario único por cuenta). Usa la app fuera del computador para llevar el mes: mirar cuánto le queda, ajustar el plan y corregir lo anotado. Usa el mismo login y los mismos datos que en escritorio.

## New Behavior
- En móvil (≤760px), además del registro, hay una vista de PRESUPUESTO, con navegación entre las dos.
- La vista muestra UN periodo a la vez (mes o ciclo, según el modo del libro), con un selector para moverse por los periodos del horizonte. Por defecto abre en el periodo actual.
- Para el periodo elegido, se ve la jerarquía de la grilla (Tipo > Grupo > Categoría > Subcategoría) con Presupuestado y Ejecutado por nodo. Los padres muestran su total por roll-up y se pliegan y despliegan. El color y el glifo de estado siguen la misma regla que en escritorio. [ASSUMPTION] la forma exacta (lista plegable u otra) se decide en UX con maqueta.
- Se puede CAMBIAR el Presupuestado de una hoja (lo planeado), con las mismas reglas que la grilla de escritorio.
- Tocar una hoja muestra sus movimientos del periodo, lo mismo que el Detalle de la celda de Ejecutado en escritorio (diario-de-celda).
- Desde esa lista, cada movimiento se puede EDITAR (monto, nota, fecha, categoría) y BORRAR, con las mismas reglas que en escritorio (FR-2505, FR-2506).
- Directriz de diseño del usuario: «tener en cuenta si aprovechamos o modificamos el módulo de registrar movimientos». La fase de diseño debe evaluar y justificar si la edición REUSA el formulario de registro móvil (abierto precargado) o adapta el editor de escritorio (MovementEditor). La regla de dominio es una sola en los dos casos.
- Alcancías: se puede cambiar lo aportado a una alcancía en el periodo (Pres. y Ejec.), sacar plata de una alcancía, planear un retiro y corregir o eliminar los retiros del mes. Todo con las mismas reglas de techo, piso y déficit que escritorio.
- Se ve el Balance del periodo con sus tres bloques (El mes, Lo disponible, El cierre) y las mismas cifras que escritorio.
- Un periodo CERRADO se puede mirar pero no cambiar: no se edita el plan, ni los movimientos, ni las alcancías.
- Si una regla rechaza un cambio, el teléfono dice qué falló, igual que escritorio, y la cifra no cambia.
- Todas las cifras salen del mismo estado y de las mismas funciones de dominio que escritorio. No hay cálculos propios del móvil.

## Success Criteria
- Given un libro con datos en un periodo, When se abre la vista de presupuesto a 375px en ese periodo, Then Presupuestado y Ejecutado de cada nodo y las filas del Balance coinciden cifra a cifra con escritorio para los mismos datos (prueba de paridad).
- Given 375px de ancho, Then ninguna pantalla de la vista tiene desborde horizontal de página.
- Given un cambio hecho en el teléfono (plan, movimiento o alcancía), When se abre escritorio, Then muestra la misma cifra.
- Given un periodo cerrado, When se intenta cambiar algo desde el teléfono, Then no hay forma de hacerlo y se ve por qué.
- [ASSUMPTION] Métrica de éxito: el usuario lleva el mes desde el teléfono sin necesitar el computador para lo de cada mes. Por confirmar.

## Touch Points
- MODIFICA FR-010 (raíz) y su no_go_zone. Las ~15 pruebas e2e que afirman que a 375px no hay grilla, Balance ni Detalle (TC-010h, TC-213f, TC-BAL-904f, TC-FDC-026e, entre otras) cambian a propósito.
- MODIFICA `src/components/MobileShell.tsx` (navegación) y quizá el módulo de registro (`src/components/register/*`) si se reusa para editar.
- AÑADE los componentes de la vista móvil.
- REUTILIZA sin cambiar la lógica: roll-ups, `cellTone`/`cellGlyph`, `computeBalanceSeries` y las filas del Balance, `cellDetail`, las acciones del store (`setLeafAmount`, `editMovement`, `deleteMovement`, `applyReserveEdit`, `applyReserveWithdrawal`, `planWithdrawal`, `editReserveOp`, `editPlannedWithdrawal`, `removeReserveWithdrawal`), el calendario de periodos y `isClosed`. Las piezas del Balance que hoy son privadas de `BalanceModule.tsx` se extraen para compartirlas, sin cambiar su resultado.

## Must Not Break (Regression Boundary)
- El registro móvil (FR-001) sigue igual al REGISTRAR: mismo formulario, mismo guardado, mismo ConfirmOverlay.
- En móvil siguen a la mano Configuración (FR-2204), el cambio de tema y el cierre de sesión.
- Escritorio (>760px) no cambia: grilla, Balance, dashboard, Detalle y formularios de alcancías.
- El breakpoint sigue en 760px: 760 es móvil, 761 es escritorio.
- Las reglas aceptan y rechazan lo mismo para la misma operación, venga del teléfono o del computador.
- Las cifras del Balance y de la grilla de escritorio no cambian al extraer piezas compartidas.

## Out of Scope
- El dashboard en móvil. Decisión del usuario del 2-oct-2026.
- Segunda entrega, que será otra feature: crear, renombrar, borrar y mover categorías; cerrar y reabrir el mes. Cerrar desde el teléfono necesita antes BL-055.
- Teclear el Ejecutado de una hoja encima de la celda, con su ajuste por diferencia. En el teléfono, lo ejecutado se cambia anotando o corrigiendo movimientos. [ASSUMPTION]
- Comentarios de celda en móvil. [ASSUMPTION] no se pidieron.
- Ver varios periodos a la vez o la grilla de 12 meses encogida.
- Configuración (saldo inicial, ciclos, horizonte): ya funciona en el teléfono y no cambia.
- App nativa: sigue siendo la web responsive.
