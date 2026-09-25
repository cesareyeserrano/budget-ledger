## Feature
El techo de un mes deja de contar la plata que sacas de un bolsillo como si siguiera ahorrada: sacar de
una reserva para pagar un gasto no marca el mes como error, y la plata que entra después se puede reservar
entera.

## Problem / Why
El techo del mes en Ejecutado se consume con los aportes BRUTOS: un retiro no devuelve cupo
(`reserveAportes` y `techoScanRaw` en `src/domain/reserve.ts`, FR-1801 de techo-de-flujo). Se hizo así
para cerrar un caso real (enero: entran 1.000, reservo 1.000, saco 500, y con consumo neto la app dejaba
teclear 1.500), pero castiga el ciclo que la propia app prescribe para cubrir un gasto con reservas.

REPRODUCIDO con el dominio actual el 2026-09-24, sobre `7a05403` y ya con cierre-de-mes entregado. Junio:
entran 1.000, reservo 1.000, aparece un gasto de 300.
- Sacar 300 de la reserva para pagarlo: aceptado, disponible 0, y junio queda MARCADO `techo:300` para
  siempre. Cerrar junio no quita la marca.
- Bajar la celda de 1.000 a 700 (el camino que PIERDE información): aceptado, disponible 0, sin marca.
  Los números son idénticos al camino anterior; solo cambia el veredicto.
- Volver a subir esa celda a 1.000: RECHAZADO (`techo`, límite 0). Es el trinquete de BL-038.
- Plata fresca: tras sacar 300 y gastarlos entran 400 más (disponible 400). Reservar esos 400: RECHAZADO,
  solo caben 100.

Origen: BL-037 y BL-038 del backlog de la raíz, que son un solo defecto con dos caras. Se congelaron el
2026-09-01 hasta tener el cierre de mes (BL-036), con la hipótesis de que lo disolvería. La medición de
arriba muestra que no: cierre-de-mes prometió no tocar el techo y lo cumplió. El análisis ejecutado del
2026-09-01 está en `aitri/features/cierre-de-mes/feature_context/analisis-del-modelo.md`.

## Target Users
El usuario único de producción (presupuestador personal). No abre tipos de usuario nuevos.

## New Behavior
Regla que el usuario enunció el 2026-09-01 y confirmó el 2026-09-24:
1. En Ejecutado, se puede reservar hasta lo que haya DISPONIBLE en el mes. El techo se consume con lo
   reservado NETO del mes (aportes − retiros), no con los aportes brutos.
2. Se puede sacar hasta lo que haya en el bolsillo. Sin cambios: la regla vigente ya lo exige.
3. Ninguna operación puede dejar un mes con gastos sin cubrir (disponible negativo en ningún mes). Esta
   regla es la que mantiene bloqueado el encierro original.
- Sacar de una reserva para cubrir un gasto del mismo mes no produce marca de techo en ese mes.
- Una celda de bolsillo que se bajó se puede volver a subir mientras quepa en el disponible del mes: el
  trinquete desaparece.
- Los meses ya marcados en los datos existentes se re-evalúan con la regla nueva al desplegar: la marca
  que solo existía por contar en bruto desaparece sola, sin que el usuario tenga que tocar nada.
- El servidor aplica la misma regla que el navegador (el guardia de reglas-en-el-servidor delega en
  `chainCheck`, así que deben seguir siendo una sola función).

## Success Criteria
- Dado junio con 1.000 de ingreso, 1.000 reservados y un gasto de 300, cuando el usuario saca 300 de la
  reserva, entonces se acepta y junio NO tiene ninguna marca.
- Dado ese mismo estado tras bajar la celda del bolsillo a 700, cuando el usuario la vuelve a subir a
  1.000, entonces se acepta si el disponible del mes lo cubre y se rechaza con el límite correcto si no.
- Dado junio con 1.400 de ingreso, 300 de gasto, 1.000 reservados y 300 retirados (disponible 400),
  cuando el usuario reserva 400 más, entonces se acepta; y reservar 401 se rechaza.
- Dado enero con 1.000 de ingreso, la celda del bolsillo en 1.500 y un retiro de 500 (en el cajón hay
  1.000), cuando el usuario intenta borrar el retiro, entonces se rechaza porque dejaría meses con gastos
  sin cubrir (el encierro original sigue bloqueado).
- Dado un ledger con meses marcados por la regla vieja, cuando se carga con la regla nueva, entonces solo
  quedan marcados los meses que la regla nueva considera violados.

## Touch Points
MODIFICA:
- `src/domain/reserve.ts`: `reserveAportes`, `techoScanRaw`, `chainCheck`, `reserveHeadroom`,
  `cellHeadroom`, `monthIssues` (la marca de techo) y lo que consuma el techo en Ejecutado.
- FR-1801 de **techo-de-flujo** (el techo lo consumen los aportes brutos) y sus pruebas, que fijan el
  comportamiento viejo (TC-TDF-001h: cupo 0 tras reservar 1.000 y sacar 500).
- TC-CDM-222f de **cierre-de-mes**: compara el texto de `techoScanRaw`, `reserveAportes` y `chainCheck`
  contra el commit ancla `4b941d0` para vigilar que ESA feature no tocara el techo. Esta feature lo cambia
  a propósito, así que el ancla hay que avanzarla con la justificación escrita junto a ella, como ya se
  hizo antes. Sin ancla nueva, esa prueba falla.
- El guardia del servidor (`src/domain/guard.ts`, reglas-en-el-servidor) hereda el cambio vía `chainCheck`.
- La franja de avisos del Balance y el triángulo de la grilla, que pintan `monthIssues`.

## Must Not Break (Regression Boundary)
- Sacar de un bolsillo más de lo que tiene sigue rechazado.
- El encierro original sigue bloqueado: en enero con 1.000 de ingreso, la celda del bolsillo en 1.500 y
  un retiro de 500, borrar el retiro se rechaza.
- No hay doble consumo entre meses: la fórmula `disponible = saldo anterior + ingresos − gastos −
  reservado neto` se sigue cumpliendo mes a mes.
- Los meses cerrados siguen congelados: un PUT sobre un mes cerrado sigue respondiendo 422
  `closed_period_violation`.
- El plano Presupuestado no cambia (ya consumía el techo en neto).
- Borrar un bolsillo que recibió y entregó plata sigue bloqueado si alteraría el saldo de otro bolsillo
  (BG-023).
- El retiro planeado por encima de lo que el plan reserva sigue marcándose (BG-020).
- Los descuadres de celda contra sus movimientos siguen marcándose y bloqueando el cierre (FR-2511,
  FR-2512).

## Out of Scope
- Qué número muestra la celda de un bolsillo (lo aportado en el mes o el saldo que hay en el cajón).
  Es BL-041 y se decide aparte (decisión del usuario del 2026-09-24). Consecuencia aceptada: con la regla
  nueva, poner 1.000, sacar 500 y volver a meter 500 deja la celda del mes en 1.500 con 1.000 en el cajón.
- Cambiar el plano Presupuestado o el techo del plan (BL-039).
- Cambios en el cierre de mes o en la reapertura.
