<!-- Origen: hueco 2 de la auditoría de requisitos de gestion-movil (7-oct-2026). El usuario decidió el
     8-oct-2026 llevarlo al teléfono («Sí, llevarlo») y dejar fuera el historial de cierres y el aviso de
     meses sin cerrar («Siguen fuera»). Es el FR-2010 de cierre-de-mes, que hoy solo existe en escritorio. -->

## Feature
En el teléfono, al corregir un mes reabierto, se muestra qué meses posteriores se movieron y cuáles quedaron sin cubrir, igual que en escritorio.

## Problem / Why
Desde gestion-movil se puede reabrir un mes y corregirlo desde el teléfono. Corregir un mes reabierto mueve el saldo de apertura de los meses siguientes, y eso en el teléfono es invisible: el usuario cambia agosto y septiembre cambia bajo sus pies sin que nada lo diga. En escritorio ya existe un panel que lo muestra (cierre-de-mes FR-2010); en el teléfono no. Palabras del usuario al pedir ese panel (3-sep-2026): «lo que más quiero cuidar es que al reabrir el usuario no cause daños en sus propias cuentas o al menos poderle decir dónde los causó».

## Target Users
El dueño de la cuenta cuando corrige un mes reabierto desde el teléfono (pantalla de 760 px o menos).

## New Behavior
- El sistema debe mostrar en el teléfono, mientras haya un mes reabierto y alguna corrección haya movido un mes posterior, la lista de esos meses: cada uno con su periodo y el disponible de antes y de después.
- El sistema debe señalar en esa lista los meses que quedaron sin cubrir por la corrección, con ícono y texto además del color.
- El sistema debe mostrar el aviso sin que el usuario tenga que ir a buscarlo: en la lista del periodo y en las pantallas donde se corrige (detalle de una categoría).
- El sistema no debe bloquear ninguna corrección por este aviso: informa y deja seguir.
- El sistema debe usar el mismo cálculo que escritorio, de modo que las dos superficies muestren los mismos meses y las mismas cifras.
- El sistema no debe mostrar nada cuando no hay mes reabierto o cuando ningún mes posterior se movió.

## Success Criteria
- Dado agosto reabierto y septiembre abierto, cuando subo en 100 un gasto de agosto desde el teléfono, entonces veo que septiembre pasó de su disponible anterior al nuevo (100 menos), sin salir de la pantalla.
- Dado ese mismo cambio, entonces la lista del teléfono tiene los mismos meses y cifras que el panel de escritorio.
- Dado un cambio que deja septiembre en negativo cuando antes estaba cubierto, entonces septiembre aparece marcado «quedó sin cubrir» y el cambio se guarda igual.
- Dado un cambio que no altera el cierre del mes reabierto, entonces no aparece ningún aviso.
- A 360 px el aviso cabe sin desplazamiento horizontal, con cifras de nueve dígitos.

## Touch Points
- AÑADE: un aviso de impacto para el teléfono en `src/components/mobile/`.
- MODIFICA: la lista del periodo y el detalle de una categoría del teléfono, para montarlo.
- REUTILIZA sin cambiar: `downstreamImpact` (`src/domain/closure.ts`) y `useDownstreamImpact` (`src/state/store.ts`), los mismos que usa el panel de escritorio.
- No toca: el servidor, el esquema ni el panel de escritorio (`ImpactPanel`).

## Must Not Break (Regression Boundary)
- El panel de impacto de escritorio sigue igual.
- Las pantallas del teléfono no cambian cuando no hay mes reabierto: ni la lista, ni el detalle, ni Organizar, ni Cierre.
- Ninguna corrección se bloquea por el impacto.
- Las cifras del teléfono siguen siendo las de escritorio.

## Out of Scope
- El historial de cierres y reaperturas en el teléfono (decisión del usuario, 8-oct-2026: «Siguen fuera»).
- El aviso de meses terminados sin cerrar en el teléfono (misma decisión).
- Bloquear o pedir confirmación antes de una corrección que mueve otros meses: el aviso informa, no frena (decisión del usuario del 3-sep-2026, cierre-de-mes).
- Cambiar el cálculo del impacto o lo que escritorio muestra.
- Deshacer la corrección desde el aviso.
