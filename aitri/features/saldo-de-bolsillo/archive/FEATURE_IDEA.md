<!-- AGENT: if you fill this for the user, confirm the ground-truth fields
     (Problem / Why, Target Users, Success Criteria, Out of Scope) with them —
     do not silently infer. Mark anything you inferred as "[ASSUMPTION] …".
     Phase 1 records these as a provenance contract and blocks unconfirmed,
     untracked guesses on the highest-value inputs. -->

## Feature
La celda de un bolsillo en la grilla pasa a decir lo que hay AHORRADO en ese bolsillo al cierre de cada
mes (su saldo), y no lo que se metió ese mes. Escribir un número encima significa «ahora tengo esto».

## Problem / Why
CONFIRMADO por el usuario el 2026-09-27, replicando el caso él mismo en su cuenta de pruebas.

Hoy la celda de un bolsillo guarda y muestra el APORTE del mes (FR-1003 de transferencias, decisión del
2026-07-29). Sacar plata de un bolsillo no baja su celda: el retiro se anota aparte, en la fila «Retiros
del mes». El usuario lee la celda como «lo que tengo en ese bolsillo», y esa lectura le da una cifra que
no es cierta. Sus palabras al verlo: «lo que dices es que cuando saco dinero de alguna alcancía, eso no
se resta?» y, como decisión, «sí que reste».

Medido en pantalla el 2026-09-27 sobre `795ca8a`, con datos inventados:

- Un bolsillo recibe 1.000.000, se le sacan 500.000 y se le vuelven a meter 500.000 en el mismo mes. La
  celda dice 1.500.000; en el bolsillo hay 1.000.000. El botón del bolsillo en «Nuevo movimiento» →
  «Reserva» sí dice 1.000.000.
- Un bolsillo recibe 600.000 en un mes y 400.000 en el siguiente, y en el tercero se le sacan 300.000. La
  fila dice 600.000, 400.000 y vacío; en el bolsillo hay 600.000, 1.000.000 y 700.000.
- La app rechaza sacar 1.500.000 del primer bolsillo: el dominio ya conoce el saldo real
  (`resolvedSeries` en `src/domain/reserve.ts`). Lo que falta es mostrarlo en la celda.

Con UN solo bolsillo la fila «Saldo reservado» del Balance coincide con su saldo, y por eso el hueco no
se nota en una cuenta con un bolsillo. Con dos o más, ninguna fila de la grilla dice cuánto hay en cada
uno.

No es un error de cálculo: todas las cifras de hoy son correctas para lo que cada fila declara. Lo que
cambia es la regla. Origen: BL-041 del backlog de la raíz, que además es deuda previa de BL-056 (móvil) y
BL-057 (Tony): los dos necesitan una sola respuesta a «cuánto tengo en el bolsillo X».

## Target Users
[ASSUMPTION] El usuario único de producción (presupuestador personal), igual que en las features
anteriores. No abre tipos de usuario nuevos.

## New Behavior
Las dos primeras reglas están CONFIRMADAS por el usuario el 2026-09-27. Las demás son propuestas a
confirmar en la fase de requisitos.

1. CONFIRMADO. En Ejecutado, la celda de un bolsillo muestra lo que hay ahorrado en ese bolsillo al
   cierre de ese mes: todo lo que entró menos todo lo que salió, desde el principio hasta ese mes. Sus
   palabras: «debería ser lo que tengo ahorrado cada mes en ese rubro». Se descartó mostrar el neto del
   mes (aportes − retiros del mes), que puede quedar negativo.
2. CONFIRMADO. Escribir un número encima de la celda significa «ahora tengo esto». La app anota la
   DIFERENCIA con lo que había: si el número es mayor, como plata que entró al bolsillo; si es menor,
   como un retiro. Siempre con fecha. Se descartaron «corregir lo aportado sin anotar retiro» (falla en
   un mes donde no se metió nada) y «celda de solo lectura».
3. [ASSUMPTION] La fecha de esa anotación sigue la regla que ya usan las celdas de gasto e ingreso
   (`proposedDate`, FR-2503 de diario-de-celda): hoy si hoy cae en el mes o ciclo de la celda; si no, el
   último día de ese periodo.
4. [ASSUMPTION] Un mes sin operaciones muestra el saldo que viene del mes anterior, no una celda vacía.
   Una celda queda vacía solo mientras el bolsillo nunca ha tenido plata.
5. CONFIRMADO como principio el 2026-09-27, con el ALCANCE por confirmar. Palabras del usuario: «el
   presupuesto debería comportarse igual que el ejecutado, solo que en su carril de presupuesto; hoy día
   tiene una mezcla rara». Para la celda de un bolsillo significa: en Presupuestado dice lo que el plan
   tendría ahorrado en ese bolsillo al cierre del mes, y escribir un número encima anota la diferencia
   como aporte o retiro PLANEADO de ese bolsillo.
   LA MEZCLA, medida en pantalla el mismo día: los dos planos abren cada mes en el cierre REAL del mes
   anterior (ADR-03 del Balance, revisado el 2026-07-27; `computeBalanceSeries` en `src/domain/balance.ts`
   y `techoScanRaw` en `src/domain/reserve.ts`). El cierre presupuestado de un mes no alimenta al
   siguiente. Además el retiro planeado es UNA fila por mes, sin bolsillo (`@retiros`).
   CONFIRMADO el mismo día que «su carril» alcanza a TODA la columna Pres. del Balance: el presupuesto
   arrastra su propio saldo de mes a mes. Palabras del usuario: «esa regla vieja es mal diseño, hay que
   corregirlo». Registrado como BL-059 en el backlog de la raíz.
   YA ENTREGADO: el usuario eligió dos entregas y la primera, la feature carril-de-presupuesto (5/5,
   2026-09-27, commits 5eacb9c y 708d34c), ya hace que el plan arrastre su propio saldo y que sus reglas
   de reservas bloqueen como en Ejecutado («comportamientos iguales»). Esta feature parte de ahí.
   LO QUE QUEDA AQUÍ del lado del plan, CONFIRMADO el 2026-09-27: el plan funciona igual que lo real
   («sí, deberíamos dejarlo igual que ejecutado (real)», elegido tras ver con un ejemplo la alternativa de
   un retiro planeado sin bolsillo). La celda Pres. de un bolsillo muestra lo que el plan tendría ahorrado
   en él; bajarla anota un retiro PLANEADO de ESE bolsillo. La fila «Retiros del mes» Pres. pasa a ser la
   suma de los retiros planeados de los bolsillos y deja de escribirse directamente. Hoy el retiro
   planeado es una sola fila por mes, sin bolsillo (`@retiros`).
5b. CONFIRMADO el 2026-09-27 («ok»). Los retiros planeados que YA existen sin bolsillo los reasigna la
   actualización sola, sin que el usuario corrija nada a mano: cada uno va al bolsillo con más plata
   planeada ese mes y, si no alcanza, lo que falte sale del siguiente. Ejemplo mostrado con su cuenta de
   pruebas: 10.000.000 planeados para octubre irían al bolsillo que tenía 43.728.582 planeados.
6. [ASSUMPTION] Las filas de grupo y de tipo («Ahorro», «RESERVAS») suman lo que hay en sus bolsillos, así
   que la fila «RESERVAS» pasa a coincidir con «Saldo reservado» del Balance. POR CONFIRMAR con el usuario.
7. [ASSUMPTION] `amount_cell` sigue guardando aportes y el journal las operaciones reales; el saldo se
   DERIVA al pintar, así que los ledgers existentes muestran el saldo correcto sin que el usuario corrija
   nada. Lo único que cambia de forma es el retiro planeado, que pasa a tener bolsillo (punto 5b); cómo se
   guarda lo decide el diseño.
8. Las reglas vigentes se aplican igual a lo escrito en la celda: no se puede reservar más de lo disponible
   en el mes, no se puede sacar más de lo que hay en el bolsillo, y ninguna operación deja un mes con
   gastos sin cubrir (FR-2801 de retirar-para-gastar). Un número que las rompe se rechaza diciendo cuál.

## Success Criteria
[ASSUMPTION] Propuestos por el agente; POR CONFIRMAR con el usuario.

- Dado un bolsillo que recibió 1.000.000, al que se le sacaron 500.000 y se le volvieron a meter 500.000
  en el mismo mes, cuando se abre la grilla, entonces su celda de ese mes dice 1.000.000.
- Dado un bolsillo con 600.000 en un mes, 400.000 en el siguiente y un retiro de 300.000 en el tercero,
  cuando se abre la grilla, entonces la fila dice 600.000, 1.000.000 y 700.000.
- Dada una celda que dice 1.000.000, cuando el usuario escribe 800.000, entonces la celda dice 800.000,
  aparece un retiro de 200.000 con fecha y «Saldo disponible» sube 200.000.
- Dada una celda que dice 1.000.000, cuando el usuario escribe 1.200.000 y hay 200.000 disponibles,
  entonces la celda dice 1.200.000 y «Saldo disponible» baja 200.000.
- Para cualquier bolsillo y cualquier mes, la celda de la grilla y el botón de ese bolsillo en «Nuevo
  movimiento» → «Reserva» dicen la misma cifra.
- Un ledger guardado antes de la feature muestra los saldos correctos al abrirlo, sin migración.

## Touch Points
MODIFICA:
- FR-1003 (transferencias): «Editar la celda corrige el aporte del mes — jamás genera retiros ni
  journal». Es la regla que esta feature cambia.
- FR-1001 (transferencias): el saldo derivado «no se muestra celda a celda». Pasa a mostrarse.
- FR-1808 (techo-de-flujo): el «Máx.» del editor de la celda de bolsillo, hoy un total de aporte.
- FR-1603 (transferencias): el roll-up del grupo «Reservas» lee la misma cifra que «− Reservas del mes».
- FR-1804 (techo-de-flujo): la observación automática de la celda («De los X reservados este mes…»).
- NFR-2503 (diario-de-celda): «los bolsillos tienen su propia regla» al escribir un valor en la celda.
- `src/domain/reserve.ts` (`applyReserveCellEdit`, `cellHeadroom`, `validateReserveWrite`),
  `src/components/ReserveCells.tsx`, `src/state/store.ts`, `src/domain/rollup.ts`.

NO TOCA: el esquema de la base, la API de movimientos, el registro «Nuevo movimiento».

## Must Not Break (Regression Boundary)
- Para los mismos datos, las filas del Balance dan las mismas cifras que hoy en la columna Ejec.:
  «Reservas del mes», «Retiros de reservas», «Saldo disponible», «Saldo reservado» y «Saldo total». La
  columna Pres. del Balance da las mismas cifras que tras carril-de-presupuesto.
- La fila «Retiros del mes» sigue listando los retiros y sigue permitiendo corregirlos y borrarlos
  (FR-1802, FR-1803, FR-1609).
- «Nuevo movimiento» → «Reserva» (meter, sacar y mover entre bolsillos) se comporta igual, y el botón de
  cada bolsillo sigue mostrando su saldo.
- Las reglas de techo, piso y déficit aceptan y rechazan exactamente lo mismo que hoy para la misma
  operación (FR-2801).
- Un mes cerrado no se puede modificar escribiendo en la celda de un bolsillo (FR-2003 de cierre-de-mes).
- En ciclos, toda anotación nueva tiene fecha y su periodo es el de esa fecha (FR-2405).
- Las celdas de gasto e ingreso siguen creando su ajuste por la diferencia (FR-2504).
- Lo guardado en `amount_cell` y `movement` de un ledger existente no cambia al abrirlo.

## Out of Scope
[ASSUMPTION] Propuesto por el agente; POR CONFIRMAR con el usuario.

- La vista móvil (BL-056) y la integración con Tony (BL-057). Esta feature les deja la regla decidida.
- El color del Balance (BL-042).
- Cambiar qué filas tiene el Balance o cómo se calculan.
