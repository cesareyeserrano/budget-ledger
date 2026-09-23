## Feature
El mes que el botón de cierre NOMBRA y el mes que el servidor CIERRA son siempre el mismo, porque los dos
cuentan desde el mes de inicio declarado.

## Problem / Why
Cerrar un mes congela ese mes y todos los anteriores, y solo se puede reabrir el último cerrado, de uno en
uno. Hoy el cliente y el servidor deciden «qué mes toca cerrar» desde anclajes DISTINTOS: la app parte del
mes de inicio declarado (`activeBounds`, `src/domain/range.ts:105`, que ya cuenta `startMonth` como ancla) y
el servidor parte del primer periodo CON DATOS (`serverScope` → `oldestPeriodWithData`,
`src/domain/range.ts:52`, que ignora `startMonth`). Los dos proponen «el primer mes de su rango»
(`nextClosable`, `src/domain/closure.ts:154`), así que cualquier diferencia entre los rangos convierte el
botón en una promesa falsa.

REPRODUCIDO con el código real el 2026-09-22 (inicio declarado 2026-07, primer dato 2026-09, hoy 2026-10):
el botón propone `2026-07` y el servidor cerraría `2026-09`. Como cerrar septiembre congela también julio y
agosto, el usuario pide cerrar un mes y se le congelan tres, y deshacerlo exige reabrir de uno en uno.

LATENTE hoy, no activo: en la cuenta real el inicio declarado y el primer dato coinciden (2026-09), así que
el botón acierta. Despierta en cuanto se declare un inicio anterior al primer dato. Registrado como BG-040
(medium, abierto) y BL-055.

## Target Users
El usuario único de producción (presupuestador personal). No abre tipos de usuario nuevos.

## New Behavior
- El servidor debe contar el MES DE INICIO DECLARADO como ancla de su rango, igual que ya hace el cliente:
  el mes objetivo del cierre sale del mismo punto de partida en las dos capas.
- El cierre debe seguir siendo mes a mes y en orden: con inicio declarado en julio y datos desde septiembre,
  cerrar tres veces cierra julio, luego agosto y luego septiembre.
- El mes que el botón nombra y el que el servidor cierra deben coincidir SIEMPRE, y eso debe quedar fijado
  por una prueba que hoy no existe.

## Success Criteria
- Dado un ledger con mes de inicio declarado 2026-07 y su primer movimiento en 2026-09, cuando el usuario
  pulsa el botón de cierre, entonces el servidor cierra 2026-07 (`closed_through = 2026-07`) y ni agosto ni
  septiembre quedan congelados.
- Dado ese mismo ledger, cuando se pulsa el botón tres veces seguidas, entonces se cierran julio, agosto y
  septiembre en ese orden, y el botón nombra cada vez el mes que se va a cerrar.
- Dado un ledger donde el inicio declarado y el primer dato coinciden (el caso real de hoy), entonces el
  comportamiento del cierre no cambia en nada.
- Existe una prueba que compara el mes que propone el cliente con el que decide el servidor sobre el mismo
  estado y falla si difieren.

## Touch Points
MODIFICA:
- `src/server/data/ledgerRepo.ts` — `serverScope` (y los sitios que lo usan para el cierre: `closeMonth` en
  la línea ~974 y `reopenMonth` en la ~1094).
- FR-2002 / FR-2005 / FR-2008 de **cierre-de-mes** (qué mes es cerrable y cuál reabrible).
- FR-2201 de **meses-y-saldo-inicial** (el mes de inicio declarado como ancla).
AÑADE: las pruebas de coherencia cliente/servidor.

## Must Not Break (Regression Boundary)
- Con inicio declarado igual al primer dato (la cuenta real), el mes cerrable y el cierre no cambian.
- No se cierra fuera de orden ni hacia el futuro: sigue sin poder cerrarse un mes posterior al actual
  (FR-2008) ni saltarse meses (FR-2002).
- Reabrir sigue alcanzando solo al último mes cerrado, de uno en uno (FR-2005).
- El cierre sigue congelando cifras y movimientos de los meses cerrados: un PUT sobre un mes cerrado sigue
  respondiendo 422 `closed_period_violation` (NFR-2507 de diario-de-celda, FR-2507).
- Los comentarios se siguen pudiendo escribir en un mes cerrado (FR-2004).
- Un mes vacío anterior al inicio declarado no entra en el rango: el suelo es el inicio declarado, no un mes
  arbitrario.

## Out of Scope
- Reabrir varios meses de golpe o reabrir cualquier mes cerrado: FR-2005 sigue igual.
- Cerrar varios meses en una sola acción.
- Cambiar cómo se declara el mes de inicio, ni la pantalla donde se declara.
- Tocar el arrastre, el saldo inicial o cualquier cifra: esta feature solo cambia QUÉ MES se cierra.
