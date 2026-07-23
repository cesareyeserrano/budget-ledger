# UX / Design Spec — Feature demote-node

Preview: not generated — la feature no introduce ninguna superficie visual nueva; solo habilita el arrastre en filas de grupo ya existentes y reutiliza el realce de destino `--accent` y el toast del sistema. No hay look & feel nuevo que previsualizar.

**Archetype: PRO-TECH/DASHBOARD (heredado).** Incremento sobre la grilla existente del Ledger. No introduce token ni patrón visual nuevo: reutiliza el drag-drop de reparent/promoción (FR-015 / promote-to-group) y sus mismos destinos droppables (grupo, categoría). Solo **habilita** que los grupos sean arrastrables y agrega el **feedback de bloqueo** cuando un movimiento desborda el techo de 3 niveles.

## Design Tokens
**SIN CAMBIOS.** Hereda íntegro el sistema César Augusto + Lexend (colores `--bg/--accent/--fg/--error`, íconos Lucide, escala 4px). El realce de destino de drop usa el mismo `--accent` ya vigente.

---

## 1. Superficies afectadas (todas MODIFICADAS, ninguna nueva)

### 1.1 Grilla — los grupos se vuelven arrastrables (FR-701)
Hoy solo subcategorías y categorías son arrastrables; los grupos no. Ahora la fila de un **grupo** (no-system) también es arrastrable: su etiqueta muestra la misma afordancia `cursor: grab` / `active:grabbing` que las demás filas arrastrables. Se puede soltar sobre los destinos droppables existentes:
- Sobre otra **categoría** → el grupo baja a subcategoría de esa categoría.
- Sobre otro **grupo** → el grupo baja a categoría de ese grupo.
- Sobre la **fila de un tipo** (destino de promoción) → no aplica a un grupo (ya es grupo); no cambia nada.
Solo dentro del mismo tipo; el realce de destino aparece únicamente en destinos compatibles (H5).

### 1.2 Grilla — feedback de bloqueo por desborde (FR-703)
Cuando el usuario suelta un grupo en un destino donde su subárbol NO cabe (los nietos caerían a nivel 4), el movimiento se rechaza y el estado no cambia. Se muestra un **aviso no bloqueante** (el toast existente, patrón ya usado por el store) con el texto: **"Vacía o mueve las subcategorías primero"**. Cero reestructuración: la jerarquía queda idéntica a antes del intento.

---

## 2. Estados de los componentes (default / hover / dragging / drop / blocked)

| Componente | default | hover / dragging | drop válido | drop inválido / desborde |
|---|---|---|---|---|
| Fila de grupo arrastrable (FR-701) | cursor grab en la etiqueta | opacidad 0.4 al arrastrar (igual que las demás) | realce `--accent` en el destino compatible; al soltar, el grupo baja de nivel | destino de otro tipo: no reacciona; destino que desborda: toast "Vacía o mueve las subcategorías primero", sin cambios |

---

## 3. Responsive
- **Grilla (FR-701/702/703):** solo **escritorio** (>760px), como toda la grilla. A 375px la vista sigue siendo únicamente el registro (parent FR-010); el drag de grupos no existe en móvil.
- Breakpoints de verificación: 768/1440 (grilla + drag de grupos + bloqueo). El toast de bloqueo hereda el estilo/tiempos del toast existente.

---

## Nielsen Compliance
- **H3 (control y libertad):** la degradación hace reversible la promoción (subir/bajar); el arrastre se cancela soltando fuera de un destino válido.
- **H4 (consistencia):** los grupos usan la MISMA afordancia grab y el MISMO realce de destino `--accent` que las categorías/subcategorías; el aviso usa el MISMO toast del sistema.
- **H5 (prevención de error):** solo los destinos compatibles (mismo tipo, que caben) se resaltan; el cross-type nunca acepta.
- **H9 (recuperación de errores):** el aviso de bloqueo dice QUÉ hacer ("vacía o mueve las subcategorías primero"), no un "Error" genérico; el estado no se toca, así que no hay nada que deshacer.
- **H1 (estado del sistema):** el bloqueo da feedback inmediato (toast ≤1s) y la jerarquía visible confirma que nada cambió.

---

## User Flows

**Flujo 1 — Bajar un grupo vacío a categoría (caso del usuario) (FR-701).**
1. El usuario tiene un grupo sin hijos (que antes fue una categoría promovida y luego vació).
2. Arrastra la fila del grupo (cursor grab) y la suelta dentro de otro grupo del mismo tipo.
3. El grupo pasa a ser categoría de ese grupo, conservando sus montos. Fin.

**Flujo 2 — Bajar un grupo con categorías-hoja (FR-702).**
1. Arrastra un grupo cuyas categorías no tienen subcategorías, y lo suelta dentro de otro grupo.
2. El grupo baja a categoría y sus categorías bajan a subcategorías (cabe en 3 niveles), sin huérfanos.

**Flujo 3 — Intento que desborda, bloqueado (FR-703).**
1. Arrastra un grupo cuyas categorías SÍ tienen subcategorías, y lo suelta dentro de una categoría (los nietos caerían a nivel 4).
2. El sistema rechaza el movimiento; aparece el toast "Vacía o mueve las subcategorías primero".
3. La jerarquía queda idéntica. El usuario reacomoda las subcategorías a mano y reintenta.

---

## Component Inventory

| Componente | Ubicación | Cambio | FR | Notas |
|---|---|---|---|---|
| Fila de nodo (NodeRow) | BudgetGrid | modificado (grupos arrastrables: quitar `disabled` para grupos) | FR-701 | reutiliza useDraggable + cursor grab existentes |
| Handler onDragEnd | BudgetGrid | modificado (maneja el rechazo por desborde → toast) | FR-703 | mapea `would_overflow` al toast del sistema |
| Toast (Toaster) | store/Toaster | reutilizado (aviso de bloqueo) | FR-703 | mismo patrón que storageError/showToast |

---

## Assets provistos
Ninguno nuevo. No hay mockup; el diseño se deriva por transcripción de los patrones ya aprobados (drag-drop de reparent/promoción, toast del sistema). Cero UI inventada.
