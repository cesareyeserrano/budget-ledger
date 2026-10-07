<!-- AGENT: if you fill this for the user, confirm the ground-truth fields
     (Problem / Why, Target Users, Success Criteria, Out of Scope) with them —
     do not silently infer. Mark anything you inferred as "[ASSUMPTION] …".
     Phase 1 records these as a provenance contract and blocks unconfirmed,
     untracked guesses on the highest-value inputs. -->

<!-- Origen: BL-089, la segunda entrega del presupuesto en el teléfono (corte aceptado por el usuario
     el 2026-10-02). La primera fue la feature presupuesto-movil. El bloqueo que tenía cerrar desde el
     teléfono (BL-055) ya lo resolvió la feature cierre-coherente: no queda nada previo por decidir. -->

## Feature
Desde el teléfono se gestionan las categorías (crear, renombrar, cambiar ícono, borrar y mover) y se cierra o reabre el mes, sin tener que ir al computador.

## Problem / Why
En el teléfono hoy se ve el presupuesto y se cambian las cifras, pero la estructura es de solo lectura: si falta una categoría, tiene mal el nombre o está en el grupo equivocado, hay que esperar a estar en el computador. Lo mismo con el cierre: el mes solo se cierra o se reabre desde escritorio. Quien lleva el día a día desde el teléfono se queda a medias justo en las dos tareas que ordenan el libro.

## Target Users
El dueño de la cuenta cuando usa T-Ledger en el teléfono (pantalla de 760 px o menos). No hay usuarios nuevos.

## New Behavior
- El sistema debe permitir crear desde el teléfono un grupo, una categoría dentro de un grupo y una subcategoría dentro de una categoría, en ingresos, gastos y alcancías, con las mismas reglas de escritorio.
- El sistema debe permitir renombrar desde el teléfono cualquier grupo, categoría o subcategoría que escritorio deje renombrar; un nombre vacío o inválido conserva el anterior.
- El sistema debe permitir cambiar el ícono de un elemento desde el teléfono, con el mismo catálogo de íconos de escritorio.
- El sistema debe permitir borrar un elemento desde el teléfono solo cuando escritorio lo permitiría; si está bloqueado, debe decir el motivo (tiene elementos dentro, tiene valores o tiene operaciones) en vez de esconder la opción.
- El sistema debe permitir mover un elemento con una acción «Mover a…» que lista solo los destinos válidos, en lugar de arrastrar; mover incluye convertir una categoría en grupo y bajar un grupo a categoría, con las mismas reglas y bloqueos de escritorio.
- [ASSUMPTION] El sistema debe permitir cambiar el orden de un elemento entre sus hermanos (subir / bajar) desde el teléfono.
- El sistema debe permitir cerrar desde el teléfono el mes cerrable, nombrando siempre qué mes se va a cerrar y pidiendo confirmación; si no se puede cerrar, debe decir por qué, con el mismo motivo que da escritorio.
- El sistema debe permitir reabrir desde el teléfono el último mes cerrado, con confirmación.
- El sistema debe impedir desde el teléfono los mismos cambios de estructura que escritorio impide sobre periodos cerrados.
- Todo cambio hecho desde el teléfono debe quedar guardado y verse en escritorio, y al revés, por el mismo camino de guardado y sincronización que ya existe.

## Success Criteria
- Dado el mismo libro, cuando se hace una operación de estructura desde el teléfono (crear, renombrar, ícono, borrar, mover, subir o bajar de nivel), entonces el libro queda idéntico a como lo dejaría la misma operación hecha en escritorio.
- Dado un elemento que escritorio no deja borrar o mover, cuando se intenta desde el teléfono, entonces se bloquea con el mismo motivo y el libro no cambia.
- Dado un mes cerrable, cuando se cierra desde el teléfono, entonces el mes que el botón nombra es el que queda cerrado, y el mismo mes aparece cerrado en escritorio.
- Dado un mes que no se puede cerrar, cuando se abre el control en el teléfono, entonces se lee el motivo y no hay cierre.
- A 375 px de ancho todas las pantallas nuevas caben sin desplazamiento horizontal y cada control se puede tocar con el dedo.
- [ASSUMPTION] La entrega se da por buena cuando las siete operaciones (crear, renombrar, ícono, borrar, mover, cerrar, reabrir) se completan en el teléfono sobre el libro de pruebas de admin@admin.com sin abrir escritorio.

## Touch Points
- MODIFICA: la vista de presupuesto del teléfono (`src/components/mobile/` — secciones, pantalla de detalle, pila de pantallas) para sumar las acciones de estructura y el control de cierre.
- MODIFICA: presupuesto-movil FR-3112 («un periodo cerrado se mira pero no se cambia») y su no_go_zone, que dejaban fuera de la primera entrega gestionar categorías y cerrar/reabrir.
- REUTILIZA sin cambiar las reglas: `src/domain/mutations.ts` (crear, renombrar, ícono, borrar con su motivo, mover), promover/bajar de nivel (features promote-to-group y demote-node), `src/domain/closure.ts` y el estado de cierre de `src/state/store.ts`, la ruta de cierre del servidor.
- No toca: el servidor ni el esquema de la base. [ASSUMPTION]

## Must Not Break (Regression Boundary)
- Escritorio no cambia: la grilla, arrastrar para mover, el control de cierre y sus textos siguen igual.
- Lo que la primera entrega dejó en el teléfono sigue igual: ver el periodo, cambiar lo planeado, editar y borrar movimientos, alcancías, retiros del mes, Balance y el resumen de saldos.
- El registro de movimientos del teléfono sigue igual y conserva lo escrito al cambiar de vista.
- Las reglas de borrado no se relajan: un elemento con valores, con saldo de alcancía o con operaciones sigue sin poder borrarse.
- El cierre sigue en orden, mes a mes desde el inicio declarado; reabrir sigue alcanzando solo al último cerrado.
- Un periodo cerrado sigue sin admitir cambios de cifras desde el teléfono.
- El dashboard y la grilla de 12 meses siguen sin renderizarse en el teléfono.

## Out of Scope
- El dashboard en el teléfono (decisión del usuario del 2026-10-02).
- Arrastrar para mover en el teléfono: se usa «Mover a…».
- Añadir comentarios de celda, teclear el Ejecutado sobre la celda y planear retiros desde el teléfono (siguen como en la primera entrega).
- Cambiar reglas de negocio de categorías o de cierre: el teléfono hace lo mismo que escritorio, no algo distinto.
- Cambios en Configuración (saldo inicial, ciclos, horizonte), que ya funciona en el teléfono.
- Escritura incremental del libro (BL-017) y una app nativa.
