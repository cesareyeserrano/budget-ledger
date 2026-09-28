<!-- AGENT: if you fill this for the user, confirm the ground-truth fields
     (Problem / Why, Target Users, Success Criteria, Out of Scope) with them —
     do not silently infer. Mark anything you inferred as "[ASSUMPTION] …".
     Phase 1 records these as a provenance contract and blocks unconfirmed,
     untracked guesses on the highest-value inputs. -->

## Feature
La columna Presupuestado arrastra su PROPIO saldo de mes a mes, igual que Ejecutado, cada una en su
carril: cada mes Pres. abre con el cierre presupuestado del mes anterior, no con el cierre real.

## Problem / Why
CONFIRMADO por el usuario el 2026-09-27, viendo el caso en su propia pantalla.

Hoy los dos planos abren cada mes en el cierre EJECUTADO del mes anterior (ADR-03 de la feature balance,
revisado el 2026-07-27; FR-906). El cierre presupuestado de un mes no alimenta al siguiente. Con eso no se
puede planear hacia adelante: el plan de un mes futuro no le pasa nada al siguiente, así que armar el
presupuesto de un año o dos no se sostiene. Palabras del usuario: «el presupuesto debería comportarse
igual que el ejecutado, solo que en su carril de presupuesto; hoy día tiene una mezcla rara», «esa regla
vieja es mal diseño, hay que corregirlo» y, como motivo, «qué pasa si quiero hacer el presupuesto de todo
un año o dos; eso como está no me permite hacerlo».

La mezcla no es solo el arrastre. `plannedRetiroLimit` (`src/domain/reserve.ts`) YA acumula en su propio
carril (aportes planeados menos retiros planeados), mientras el Balance y el techo del plan se re-anclan a
lo real. Hoy conviven las dos ideas.

DECISIÓN CON HISTORIA. El 2026-07-24 la app nació con carril propio y el usuario la invirtió el
2026-07-27: un mes mal ejecutado dejaba el plan de los siguientes arrancando con plata que ya no existía
(julio planeó guardar 300 y guardó 500; agosto Pres. abría en 200 que no existían). El 2026-09-27 se le
mostró ese caso y dos alternativas (dejarlo, o encadenar el plan solo en los meses futuros) y eligió el
carril propio puro, aceptando a sabiendas que un mes peor que el plan no se refleja en la columna Pres. de
los siguientes: la desviación se lee comparando Pres. con Ejec. Origen: BL-059 del backlog de la raíz.

## Target Users
[ASSUMPTION] El usuario único de producción (presupuestador personal). No abre tipos de usuario nuevos.

## New Behavior
1. CONFIRMADO. Para todo mes que no sea el primero del rango, «Saldo del mes anterior» en Pres. es el
   «Saldo disponible» en Pres. del mes anterior, y el saldo reservado de Pres. arrastra el reservado de
   Pres. del mes anterior. Ejecutado sigue arrastrando lo suyo, como hoy.
2. CONFIRMADO el 2026-09-27. El primer mes del rango abre los dos planos en el mismo punto: el saldo
   inicial declarado (FR-2202 de meses-y-saldo-inicial), o 0 si no hay. Desde el segundo mes cada plano
   sigue su camino.
0. PRINCIPIO, CONFIRMADO el 2026-09-27 y que manda sobre el resto: Presupuestado y Ejecutado tienen el
   MISMO comportamiento de cálculo, cada uno sobre sus propios datos. Palabras del usuario: «el
   presupuesto y el ejecutado deberían tener el mismo comportamiento, para poder hacer una simulación real
   y una comparación real». CONFIRMADO también que las reglas BLOQUEAN en Pres. igual que en Ejec.:
   preguntado si en el presupuesto la app debe dejar guardar más plata de la que el plan tiene, respondió
   «no, no debe, comportamientos iguales». Esto REEMPLAZA el punto 3.
3. CONFIRMADO el 2026-09-27 (versión final, ver punto 0). Las reglas de reservas del plan —no reservar más
   de lo que el plan deja disponible, no sacar más de lo que el plan tiene en el bolsillo, no dejar un mes
   del plan con gastos sin cubrir— se calculan con el carril del propio plan y BLOQUEAN igual que en
   Ejecutado. Hoy el plan solo avisa (FR-1008 de transferencias): eso cambia. Primera respuesta del
   usuario: «el presupuesto va por su carril, el ejecutado sobre su carril. Simple».
   [ASSUMPTION] Como en Ejecutado, un plan guardado que YA rompe una regla no se borra ni se corrige solo:
   la regla bloquea solo lo que una escritura EMPEORA (el criterio que `chainCheck` ya aplica a Ejecutado).
4. [ASSUMPTION] Todo lo que hoy se deriva del arrastre del plan pasa a leer el carril del plan: el Balance
   Pres. completo, los totales del encabezado con el Balance plegado y el retiro planeado.
5. [ASSUMPTION] Nada guardado cambia: es una regla de cálculo. Un ledger existente muestra el carril
   corregido al abrirlo, sin migración y sin corrección a mano.

## Success Criteria
[ASSUMPTION] Propuestos por el agente; POR CONFIRMAR con el usuario.

- Dado un plan de octubre que cierra con 500 disponibles y un real que cierra con 400, cuando se abre la
  grilla, entonces noviembre Pres. abre con 500 y noviembre Ejec. con 400.
- Dado un plan escrito de enero a diciembre del año siguiente sin nada ejecutado, cuando se abre la
  grilla, entonces cada mes Pres. abre con el cierre Pres. del anterior y el Saldo total Pres. de
  diciembre es el acumulado de todo el plan.
- Para los mismos datos, toda cifra de la columna Ejec. del Balance es idéntica a la de hoy.
- Un ledger guardado antes de la feature muestra el carril corregido al abrirlo, sin migración.

## Touch Points
MODIFICA:
- FR-906 (balance): «Arrastre del saldo entre meses: ambos planos abren en el cierre REAL previo». Es la
  regla que esta feature revierte, con su ADR-03.
- FR-905 (balance): las seis cifras de Pres. cambian para todo mes que no sea el primero.
- FR-1008 (transferencias): el techo del plan de aportes.
- `computeBalanceSeries` (`src/domain/balance.ts`), `techoScanRaw` y `chainCheck` (`src/domain/reserve.ts`).
- Pruebas que fijan la regla vieja, entre ellas TC-BAL-915e.

NO TOCA: el esquema de la base, la API, el registro «Nuevo movimiento», lo que muestra una celda.

## Must Not Break (Regression Boundary)
- Para los mismos datos, toda cifra de la columna Ejec. del Balance es idéntica a la de hoy.
- Las reglas que BLOQUEAN en Ejecutado (techo, piso y déficit, FR-2801 de retirar-para-gastar) aceptan y
  rechazan exactamente lo mismo que hoy.
- El saldo inicial declarado (FR-2202) sigue abriendo el primer mes del rango.
- El cierre de mes (FR-2001 a FR-2010 de cierre-de-mes) congela y calcula el impacto igual que hoy en Ejec.
- En ciclos (FR-2407), el arrastre del plan sigue el mismo orden de periodos que el real.
- Lo guardado en la base de un ledger existente no cambia al abrirlo.

## Out of Scope
[ASSUMPTION] Propuesto por el agente; POR CONFIRMAR con el usuario.

- Lo que muestra la celda de un bolsillo y qué pasa al escribir encima: va en la feature saldo-de-bolsillo
  (BL-041), la entrega siguiente.
- El retiro planeado POR BOLSILLO: también va en saldo-de-bolsillo.
- Copiar o repetir un plan de un mes a los siguientes (herramientas para armar el año más rápido).
- La vista móvil (BL-056) y Tony (BL-057).
