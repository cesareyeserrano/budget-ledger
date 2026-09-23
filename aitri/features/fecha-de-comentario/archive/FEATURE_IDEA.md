## Feature
Los comentarios de una celda llevan la fecha del día en que se escribieron, visible en el Detalle igual que la de un movimiento.

## Problem / Why
Pedido del usuario el 21-sep-2026, al revisar la tarjeta del Detalle: «a ese comentario le falta poner fecha».
Hoy un comentario (cell_note) no guarda fecha: su `createdAt` es un contador interno de secuencia, no un
instante, así que no hay nada que mostrar. Los movimientos sí muestran su día («18 sep») en la misma lista,
y el comentario queda como la única fila sin fecha.

## Target Users
El presupuestador personal (único usuario de la app) que anota comentarios en las celdas del Ejecutado.

## New Behavior
- Al añadir un comentario, el sistema guarda el día en que se escribe (hora local del usuario, UTC-5), sin preguntar.
- El Detalle muestra ese día en la fila del comentario, en el mismo lugar y formato que la fecha de un movimiento («18 sep», o «Hoy»).
- En el Detalle, los comentarios con fecha se ordenan junto a los movimientos por fecha.
- Los comentarios anteriores a esta feature (29 en dev, los de producción) no tienen fecha real: se muestran sin fecha y conservan su lugar al final de la lista, como hoy.

## Success Criteria
- Given una celda abierta en el Detalle, When el usuario añade un comentario, Then la fila del comentario muestra el día de hoy como fecha.
- Given un comentario escrito un día anterior, When se abre el Detalle, Then la fila muestra ese día («18 sep»), no «Hoy».
- Given un comentario creado antes de esta feature, When se abre el Detalle, Then se muestra sin fecha, sin inventar una, y sin error.
- Given un comentario con fecha y movimientos de días distintos, When se abre el Detalle, Then el comentario aparece entre los movimientos según su fecha.

## Touch Points
- Modifica: FR-2508 de diario-de-celda (fila de comentario en el Detalle) y FR-1012 de transferencias (el comentario de celda).
- Esquema: tabla `cell_note` gana una columna de fecha opcional (migración drizzle nueva).
- Dominio: `CellNote` (src/domain/types.ts), `addCellNote` (mutations), `cellDetail` (detail.ts, orden).
- Servidor: schemas.ts (validación del snapshot / la nota), ledgerRepo.ts (leer y escribir la columna).
- UI: CellDetail.tsx (fila del comentario); CellNoteInput.tsx solo si hace falta pasar la fecha.

## Must Not Break (Regression Boundary)
- Los comentarios existentes (sin fecha) siguen apareciendo todos, con su texto intacto, en el Detalle (FR-2508).
- Un comentario sigue sin sumar a la celda (FR-2508).
- Un periodo cerrado sigue sin admitir comentarios nuevos (FR-2507).
- El orden de los movimientos entre sí no cambia (FR-2501).
- El límite de 280 caracteres del comentario sigue igual (FR-1012).

## Out of Scope
- Elegir o editar la fecha de un comentario: siempre es el día en que se escribe (decisión del usuario, 21-sep).
- Inventar o reconstruir fechas para los comentarios ya existentes.
- Mostrar la hora del comentario (solo el día).
- La nota automática de arrastre de los bolsillos (FR-1804): no es un comentario escrito y no lleva fecha.
