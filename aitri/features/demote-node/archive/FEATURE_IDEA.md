## Feature
Permitir BAJAR de nivel un nodo (degradar): mover un grupo a categoría (dentro de otro grupo) o a subcategoría (dentro de una categoría), siempre que su subárbol quepa en el techo de 3 niveles. Completa el reparent: hoy solo se puede subir (feature promote-to-group), no bajar.

## Problem / Why
Tras la feature promote-to-group, un nodo se puede promover a grupo, pero NO existe forma de revertirlo ni de degradar en general: `moveNode` rechaza mover cualquier grupo (mutations.ts:278) y la UI hace los grupos no arrastrables (BudgetGrid.tsx:326). Caso real reportado por el usuario: promovió una categoría a grupo, le quitó todos los hijos, y ya no puede volver a ponerla como categoría dentro de otro grupo — queda atrapada como grupo. El bloqueo es demasiado amplio: un grupo SIN hijos es estructuralmente idéntico a una hoja y puede bajar sin ningún riesgo.

## Target Users
Los usuarios de v1 (un solo usuario del Ledger, escritorio) que reorganizan su taxonomía y necesitan que el movimiento sea reversible: bajar lo que subieron, sin recrear nodos ni perder montos.

## New Behavior
- El sistema debe permitir arrastrar un grupo y soltarlo dentro de otro grupo (→ pasa a categoría) o dentro de una categoría (→ pasa a subcategoría), del MISMO tipo (regla dura).
- Al bajar un nodo, todo su subárbol baja el mismo número de niveles.
- El sistema debe permitir el movimiento SOLO si el subárbol completo cabe dentro del techo de 3 niveles (grupo→categoría→subcategoría). Un grupo sin hijos siempre cabe; un grupo con categorías-hoja cabe al bajar a grupo; un grupo con subcategorías (nietos) desborda al bajar más allá de lo que el techo permite.
- Cuando un movimiento haría que algún descendiente caiga por debajo del nivel 3 (desborde), el sistema debe BLOQUEARLO con un aviso claro ("vacía o mueve las subcategorías primero") — cero pérdida de datos, cero reestructuración silenciosa. Por ahora el usuario reacomoda los nietos manualmente.
- Los grupos se vuelven arrastrables en la grilla (afordancia de cursor grab), pero soltar en un destino inválido/de otro tipo/que desborda no realiza el cambio (o avisa).

## Success Criteria
- Given un grupo SIN hijos (que vino de una categoría), When lo arrastro dentro de otro grupo del mismo tipo, Then pasa a ser categoría de ese grupo conservando sus montos, sin huérfanos.
- Given un grupo sin hijos, When lo arrastro dentro de una categoría del mismo tipo, Then pasa a ser subcategoría conservando sus montos.
- Given un grupo con categorías que a su vez tienen subcategorías, When intento bajarlo a un punto donde los nietos caerían a nivel 4, Then el movimiento se bloquea y nada cambia (aviso claro).
- Given un intento de bajar cruzando de tipo, Then se rechaza (cross_type), sin mutar el estado.
- Given cualquier degradación válida, Then el invariante padre == Σ hojas se mantiene y no hay movimientos huérfanos.

## Touch Points
MODIFICA:
- `src/domain/mutations.ts` — `moveNode`: quitar el bloqueo general de mover grupos; agregar un chequeo de "cabe" (profundidad del subárbol vs. destino) y re-nivelar el subárbol; introducir un SEAM de política de desborde (ver "Must Not Break / diseño").
- `src/domain/tree.ts` — helper de profundidad de subárbol (`subtreeDepth` o similar) para el chequeo de cabida (reutiliza leafDescendants/subtreeIds).
- `src/state/store.ts` — si cambia el tipo de resultado de moveNode (nuevo motivo de rechazo por desborde).
- `src/components/BudgetGrid.tsx` — hacer los grupos arrastrables (quitar `disabled` para grupos); feedback al soltar en destino que desborda.
- FRs existentes tocados: FR-015 (reparent), FR-601/602 (promote-to-group — la degradación es su inverso parcial).

ADITIVO:
- Un motivo de rechazo nuevo para el desborde (p.ej. `rejected: "would_overflow"`), separado de `invalid_target`/`cross_type`.

## Must Not Break (Regression Boundary)
- promote-to-group (FR-601..606): promover a grupo, grupo sin hijos editable, traslado al primer hijo, reverso a 0, destino de movimientos — todo sigue igual.
- FR-015: el reparent existente sub→categoría y categoría→categoría/grupo sigue funcionando y nunca cruza de tipo.
- FR-004 / NFR-005: padre == Σ hojas y cero movimientos huérfanos tras cualquier degradación.
- El gate de borrado (FR-003 + BG-006) y el registro de movimientos siguen intactos.
- **Diseño para el futuro (requisito explícito del usuario):** el manejo del desborde debe vivir detrás de un SEAM de política (una función/estrategia enchufable), no incrustado en el core de `moveNode`. Hoy la única política es "bloquear". Mañana se podrán agregar políticas ("reasignar el desborde a la zona de no-asignados", "aplanar") SIN reescribir `moveNode` — solo registrando una política nueva. Esto evita un mega-refactor cuando se redefina la zona de no-asignados.

## Out of Scope
- La "zona de no asignados" (Sin asignar): fue retirada del código y está pendiente de redefinición; NO se reintroduce aquí. Solo se deja el seam listo para engancharla después.
- Forzar movimientos que desbordan (subárbol de 3 niveles completo): se bloquean; su resolución automática queda para cuando exista la zona de no-asignados.
- Degradar cruzando de tipo: prohibido (regla dura de tipo).
- Reordenar categorías por arrastre dentro del mismo nivel: sigue fuera de alcance.
- Multi-año / multi-moneda.
