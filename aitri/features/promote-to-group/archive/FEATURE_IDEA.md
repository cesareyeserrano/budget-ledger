## Feature
Permitir reorganizar la taxonomía subiendo un nodo a un nivel superior (incluido promover a grupo), y que un grupo sin hijos tenga presupuesto/ejecutado editables directamente, pasando a total calculado en cuanto se le agrega el primer hijo.

## Problem / Why
Hoy la reorganización de la taxonomía es asimétrica y limitada:
1. Una subcategoría solo se puede promover a categoría; no existe forma —ni en dominio ni en UI— de convertir un nodo en grupo (subir dos niveles), ni de subir una categoría a grupo. El usuario reportó esto como el bug BG-008.
2. Un grupo nunca es editable: sus celdas siempre son un roll-up de sus hijos, incluso cuando no tiene ninguno. El usuario espera poder capturar un presupuesto/ejecutado directamente en un grupo recién creado y que ese grupo pase a "calculado" solo cuando le agrega su primer hijo — el mismo patrón de traslado que ya existe hoy al convertir una categoría-hoja en padre (FR-002).

Nota de intención (confirmado con el usuario): el usuario creía que el comportamiento (2) existía antes. Se verificó que NO: `isLeaf` está igual desde el commit inicial (grupo nunca es hoja) y el `00_DISCOVERY.md` aprobado lo puso explícitamente fuera de alcance ("No existe la función de editar un total padre"). Por eso esto es capacidad NUEVA que revisa esa decisión de alcance, no una regresión.

## Target Users
Los usuarios existentes de v1 (un solo usuario del Ledger) que organizan su propia taxonomía de grupos/categorías/subcategorías y quieren reestructurarla sin recrear nodos ni perder montos.

## New Behavior
- El sistema debe permitir promover una subcategoría a categoría (ya existe) y también a grupo.
- El sistema debe permitir promover una categoría a grupo.
- El sistema debe permitir, de forma general, mover un nodo a cualquier nivel superior compatible con su tipo (expense/income/transfer), sin cruzar de tipo.
- El sistema debe tratar un grupo SIN hijos como hoja editable: sus celdas de presupuesto y ejecutado se editan directamente en la grilla.
- El sistema debe, al agregar el PRIMER hijo a un grupo (por promoción de un nodo hacia él, o por crear una categoría nueva bajo él), trasladar los montos propios del grupo al nuevo hijo y volver las celdas del grupo un total calculado (roll-up), replicando el traslado que hoy hace FR-002 en categoría→sub.
- El sistema debe conservar la integridad: cero movimientos huérfanos y el invariante padre == Σ hojas tras cualquier promoción o edición (NFR-005).

## Success Criteria
- Given un grupo recién creado sin hijos, When el usuario edita su celda de presupuesto de un mes, Then el valor queda fijado en el grupo (editable, sin roll-up) y persiste.
- Given un grupo con presupuesto/ejecutado propios y sin hijos, When se le agrega el primer hijo, Then los montos del grupo se trasladan íntegros al nuevo hijo, el total del grupo no cambia, y las celdas del grupo pasan a no-editables (calculadas).
- Given una subcategoría "Café" bajo una categoría, When el usuario la promueve a grupo, Then queda como grupo del mismo tipo, con parentId nulo, conservando sus montos como grupo-hoja editable (o en un hijo si el modelo lo requiere), sin huérfanos.
- Given una categoría con subcategorías, When se promueve a grupo, Then sus subcategorías quedan colgando del nuevo grupo como categorías, con montos y movimientos preservados.
- Given cualquier promoción, When se completa, Then no hay movimientos cuyo target apunte a un nodo inexistente (cero huérfanos) y padre == Σ hojas.

## Touch Points
MODIFICA:
- `src/domain/tree.ts` — `isLeaf` (un grupo sin hijos pasa a ser hoja editable).
- `src/domain/rollup.ts` — roll-up debe respetar el monto propio de un grupo-hoja.
- `src/domain/mutations.ts` — `moveNode` (nuevo destino "root/grupo" y promoción de la cadena de descendientes), regla de traslado al primer hijo (`createNode` y por promoción), `setLeafAmount` (permitir editar un grupo-hoja).
- `src/state/store.ts` — firma de `moveNode`.
- `src/components/BudgetGrid.tsx` — hacer droppable la fila de TIPO como destino de promoción a grupo; permitir edición de celdas de un grupo-hoja.
- FRs existentes tocados: FR-002 (traslado al crear primer hijo — se generaliza a grupos), FR-004 (roll-up), FR-015 (reparent por drag-drop).

ADITIVO:
- Nuevo destino de reparent "a grupo / a nivel raíz de tipo".

## Must Not Break (Regression Boundary)
- FR-002: convertir una categoría-hoja en padre sigue trasladando sus montos a la primera subcategoría (los totales no caen).
- FR-004 / NFR-005: el invariante padre == Σ hojas se mantiene tras cualquier promoción o edición; cero movimientos huérfanos.
- FR-003: borrado de categoría/sub y el gate de borrado (una categoría/sub con ejecutado vigente no se borra; vacía sí) — incluidos los fixes recién verificados BG-006.
- FR-015: el reparent existente sub→categoría y categoría→categoría sigue funcionando y no cruza de tipo.
- El registro de movimientos sigue incrementando el ejecutado de la hoja destino en exactamente el monto capturado.
- Grupos que YA tienen hijos siguen siendo totales calculados no editables.

## Out of Scope
- Reparto proporcional al editar un total padre CON hijos (sigue fuera de alcance; solo el grupo SIN hijos es editable).
- Reordenar categorías por arrastre (sigue fuera de alcance, decisión de discovery).
- Degradar/mover un grupo a un nivel inferior (convertir grupo en categoría) — este incremento cubre solo subir de nivel; bajar queda para otra feature si se necesita.
- Multi-año / multi-moneda (fuera de alcance de v1).
