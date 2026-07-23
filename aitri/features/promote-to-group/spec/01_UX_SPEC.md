# UX / Design Spec — Feature promote-to-group

**Archetype: PRO-TECH/DASHBOARD (heredado).** Razón: es un incremento sobre el Ledger existente (grilla contable densa, escritorio); el sistema visual ya está fijado por las features previas. Esta feature **no introduce ni un token ni un patrón visual nuevo**: reutiliza el drag-drop de reparent (FR-015 / grid-ux), la edición inline de celda-hoja (FR-006) y el selector de destino del registro (FR-010). Solo agrega **destinos y estados** a componentes que ya existen.

## Design Tokens
**SIN CAMBIOS.** Se heredan íntegros los tokens del sistema César Augusto + Lexend (ver `grid-ux/01_UX_SPEC.md`): colores `--bg/--accent/--fg/--border/--success/--warning/--error`, Lexend 300–700, cifras `tabular-nums`, íconos Lucide de línea (cero emoji, FR-012), escala 4px. La semántica de tipo (Gasto rojo / Ingreso verde / Transferencia azul, FR-008) no cambia.

---

## 1. Superficies afectadas (todas MODIFICADAS, ninguna nueva)

### 1.1 Grilla — fila de TIPO como destino de promoción a grupo (FR-601)
La fila de encabezado de cada TIPO (GASTOS / INGRESOS / TRANSFERENCIAS), hoy solo un total con su “+” en hover, se vuelve **droppable**. Durante un arrastre de un nodo del **mismo tipo**, la fila de ese tipo muestra la afordancia de destino; soltar ahí promueve el nodo a grupo.
- **Afordancia de destino (mientras se arrastra):** la fila del tipo compatible muestra un borde/realce de 2px en `--accent` (mismo lenguaje que el destino de reparent existente sobre grupo/categoría) + un rótulo sutil “Soltar para crear grupo” alineado a la izquierda, `caption` en `--accent-light`. Solo se resalta el tipo **compatible** con el nodo arrastrado; los otros dos tipos no reaccionan (afordancia de prevención de error, H5).
- **Salto directo sub→grupo:** aplica igual si el nodo arrastrado es subcategoría o categoría — un solo gesto.
- **Cross-type:** soltar sobre un tipo distinto no resalta ni acepta; al soltar no ocurre nada (el nodo vuelve a su lugar, sin toast de error — es un no-op visual, coherente con el reparent actual).

### 1.2 Grilla — fila de grupo-hoja con celdas editables (FR-603 / FR-604 / FR-605)
Un grupo **sin hijos** se pinta como una fila de grupo (indent y peso de grupo) pero con **celdas Pres./Ejec. editables**, idénticas en interacción a una categoría-hoja (FR-006): clic abre input, Enter confirma, Escape cancela, `tabular-nums`. En cuanto el grupo tiene ≥1 hijo, sus celdas vuelven a ser **calculadas** (no editables, sin cursor de texto, valor = suma de hijos) — sin cambio de layout, solo de editabilidad.
- **Transición ganar-primer-hijo (FR-604):** al crear/promover el primer hijo, los montos del grupo se trasladan al hijo (sin animación especial; el número aparece en la fila del hijo y la celda del grupo pasa a calculada mostrando el mismo total). H1: el total del grupo no “salta”.
- **Transición perder-último-hijo (FR-605):** al borrar/mover fuera el último hijo, la fila del grupo vuelve a mostrar celdas editables en **0**.

### 1.3 Registro — grupo sin hijos como destino de movimiento (FR-606)
El selector de destino del módulo de captura (CategoryRow) hoy lista categorías y sus subcategorías. Ahora **también lista los grupos SIN hijos** como opción seleccionable de primer nivel (mismo tile/estilo que una categoría, con su ícono de grupo `folder`). Un grupo **con hijos** no aparece (es calculado). Seleccionarlo y guardar suma a su ejecutado como cualquier hoja.
- Orden y agrupación visual: el grupo-hoja aparece en la posición que le corresponde por tipo y `order`, junto a las categorías; no se separa en una sección aparte.

---

## 2. Estados de los componentes (default / hover / editing / empty / disabled)

| Componente | default | hover / dragging | editing/active | empty | disabled |
|---|---|---|---|---|---|
| Fila de TIPO como drop-target (FR-601) | total del tipo, “+” oculto | durante arrastre de nodo del mismo tipo: borde `--accent` + rótulo “Soltar para crear grupo” | al soltar: promueve a grupo (fila de grupo aparece) | — | tipo distinto al nodo arrastrado: no reacciona (no-op) |
| Celda de grupo-hoja (FR-603) | valor editable, `tabular-nums` | cursor de texto | input abierto (Enter confirma / Escape cancela) | valor 0 editable | grupo CON hijos: no editable (calculado) |
| Destino grupo-hoja en registro (FR-606) | tile seleccionable con ícono `folder` | realce de hover del tile | seleccionado = tinte del tipo | — | grupo con hijos: no listado |

---

## 3. Responsive
- **Grilla (FR-601, FR-603/604/605):** solo **escritorio** (>760px), como toda la grilla (parent FR-010). El drag-drop de promoción y la edición de celda de grupo-hoja no existen a 375px.
- **Registro (FR-606):** superficie **móvil + escritorio**. A 375px el grupo-hoja aparece como destino seleccionable sin desborde (tile de igual tamaño que una categoría, tap target ≥48px). Breakpoints de verificación: 375 (registro con grupo-hoja como destino), 768/1440 (grilla + promoción + edición de grupo-hoja).

---

## Nielsen Compliance
- **H2 (lenguaje del usuario):** “Soltar para crear grupo”, no “reparent a nivel raíz”.
- **H3 (control y libertad):** la promoción es reversible por las vías del modelo (crear un hijo devuelve el grupo a calculado; el reverso a hoja-en-0 es automático). El arrastre se cancela soltando fuera de un destino válido (nodo vuelve a su lugar).
- **H4 (consistencia):** el destino de tipo usa el MISMO realce `--accent` que el destino de reparent sobre grupo/categoría; la celda de grupo-hoja usa el MISMO editor inline que una categoría-hoja; el destino en el registro usa el MISMO tile que una categoría.
- **H5 (prevención de error):** solo el tipo compatible se resalta durante el arrastre; el cross-type nunca acepta.
- **H6 (reconocer, no recordar):** la afordancia de destino aparece en el arrastre; el ícono `folder` distingue el grupo-hoja en el registro.
- **H1 (estado del sistema):** el total del grupo no cambia al trasladar montos al primer hijo (el número se mantiene, solo cambia dónde es editable).

---

## User Flows

**Flujo 1 — Promover “Café” (subcategoría) a grupo (FR-601).**
1. El usuario arrastra la fila “Café” (sub, tipo Gasto).
2. La fila del tipo GASTOS se resalta con borde `--accent` y “Soltar para crear grupo”; INGRESOS/TRANSFERENCIAS no reaccionan.
3. Suelta sobre GASTOS → “Café” pasa a ser un grupo de gasto (parentId null), conservando sus montos como grupo-hoja editable.
4. Error path: si suelta sobre INGRESOS o fuera de un destino → no ocurre nada, “Café” vuelve a su lugar.

**Flujo 2 — Promover una categoría con subcategorías (FR-601/602).**
1. Arrastra la categoría (con subs) a la fila de su tipo.
2. Suelta → la categoría es ahora grupo; sus subcategorías ascienden a categorías del nuevo grupo, con montos y movimientos intactos.

**Flujo 3 — Presupuestar directo en un grupo nuevo y luego detallarlo (FR-603/604).**
1. El usuario crea un grupo (por el flujo existente) o promueve un nodo a grupo; el grupo no tiene hijos.
2. Edita su celda Pres. de un mes directamente (clic → input → Enter). El valor persiste.
3. Más tarde le agrega su primera categoría → el monto se traslada a la categoría, la celda del grupo pasa a calculada mostrando el mismo total.

**Flujo 4 — Registrar un gasto contra un grupo sin hijos (FR-606).**
1. En el registro, el usuario abre el selector de destino.
2. El grupo sin hijos aparece como opción (ícono `folder`); lo selecciona, teclea el monto, guarda.
3. Su ejecutado del mes sube en exactamente ese monto.
4. Error path: sin destino o monto 0 → guardar bloqueado (regla existente FR-010, sin cambios).

---

## Component Inventory

| Componente | Ubicación | Cambio | FR | Notas |
|---|---|---|---|---|
| Fila de TIPO (TypeTotalRow) | BudgetGrid | modificado (droppable + afordancia de destino) | FR-601 | @dnd-kit useDroppable id `root:{type}`; realce `--accent` solo en tipo compatible |
| Celda de mes (grid cell) | BudgetGrid | modificado (editable si el nodo es grupo-hoja) | FR-603/604/605 | reutiliza el editor inline de FR-006; editabilidad = isLeaf(grupo-sin-hijos) |
| Selector de destino (CategoryRow) | register | modificado (incluye grupos sin hijos) | FR-606 | mismo tile que categoría; ícono `folder`; excluye grupos con hijos |

---

## 7. Assets provistos
Ninguno nuevo. No hay mockup para esta feature; el diseño se deriva por transcripción de los patrones ya aprobados (reparent, edición inline, tiles del registro). Toda decisión visual reutiliza un patrón existente — no se generó UI nueva desde cero.
