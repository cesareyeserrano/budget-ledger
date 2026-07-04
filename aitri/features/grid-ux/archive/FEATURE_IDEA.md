## Feature
Pulido de UX de la grilla de presupuesto (escritorio): controles de fila fiables, capacidad de agregar completa (grupo/categoría/subcategoría) desde la grilla, y columna de categorías redimensionable con ancho recordado.

## Problem / Why
La grilla de presupuesto (FR-006) tiene fricciones de UX confirmadas contra el mockup/uso real:
1. **No se puede crear un GRUPO nuevo desde la grilla.** Existen los adders "+ Nueva categoría" (bajo grupo) y "+ Nueva subcategoría" (bajo categoría), pero falta el adder "+ Nuevo grupo" por tipo. Crear un grupo no tiene entrada de UI.
2. **Falta el "+" inline** para agregar un hijo directamente en la fila de un grupo (→ categoría) o de una categoría (→ subcategoría). Hoy en hover solo aparecen ✎ (renombrar) y 🗑 (borrar).
3. **Los controles de hover son frágiles** de accionar (el ✎/🗑 solo aparece al pasar el mouse y es difícil de alcanzar sin perder el hover), y quedan mal alineados.
4. **La columna de categorías es fija (240px)** con recorte por ellipsis: los nombres largos quedan ocultos y no hay forma de ampliarla.

## Target Users
Usuario principal — dueño de sus finanzas personales — en **escritorio** (donde vive la grilla). No afecta la vista móvil (solo registro).

## New Behavior
- The system must ofrecer un adder **"+ Nuevo grupo"** al final de cada sección de tipo (Gasto/Ingreso/Transferencia) que crea un grupo nuevo bajo ese tipo e inicia su renombrado en línea.
- The system must mostrar un botón **"+" inline** en la fila de cada grupo (agrega una categoría hija) y de cada categoría no-system (agrega una subcategoría hija), junto a los controles ✎/🗑, que crea el hijo e inicia su renombrado.
- The system must revelar los controles de fila (**+ agregar hijo, ✎ renombrar, 🗑 borrar**) al pasar el cursor sobre la fila de forma **fiable** (se mantienen accionables mientras el cursor está sobre la fila) y alineados a la derecha de la columna de categoría.
- The system must permitir **redimensionar el ancho de la columna de categorías** arrastrando una manija en su borde derecho (mínimo ~180px, máximo ~480px), y **recordar** el ancho elegido en localStorage para que persista al recargar.

## Success Criteria
- Given la grilla en escritorio, when el usuario pulsa "+ Nuevo grupo" bajo el tipo Gasto, then aparece un grupo nuevo bajo Gasto con su nombre en edición en línea, y al confirmar queda disponible como padre para categorías.
- Given una fila de grupo o categoría, when el usuario pasa el cursor y pulsa el "+" inline, then se crea un hijo (categoría o subcategoría según el nivel) con su nombre en edición en línea, y el padre se expande.
- Given una fila editable, when el usuario pasa el cursor sobre ella, then los controles +/✎/🗑 se muestran y permanecen accionables (clic en 🗑 abre la confirmación en línea sin perderse) mientras el cursor está sobre la fila.
- Given la columna de categorías, when el usuario arrastra su borde derecho, then el ancho cambia en vivo dentro de [180px, 480px]; y when recarga la página, then el ancho elegido se conserva.

## Touch Points
- **MODIFICA** `src/components/BudgetGrid.tsx` (grilla): filas de nodo, adders, controles de hover, y el ancho de la columna de categoría (hoy constante `LABEL_W = w-[240px]`).
- **MODIFICA (extiende) FR-006** (grilla de presupuesto en escritorio) y **FR-002** (CRUD de jerarquía — habilita crear grupo desde la grilla, que hoy no tiene UI).
- **USA FR-011 / persistencia** (localStorage) para recordar el ancho de la columna (clave nueva, no toca las claves de datos existentes).
- No toca dominio (`mutations.ts` ya expone `createNode` para los tres niveles) salvo que el diseño lo requiera.

## Must Not Break (Regression Boundary)
- FR-006: la **edición inline de celdas-hoja** (Pres./Ejec., Enter confirma / Escape cancela) sigue funcionando igual.
- FR-002/003/015: **CRUD, borrado→"Sin asignar" y reparent por drag-and-drop** siguen funcionando; el nuevo "+" inline y el resize no interfieren con el arrastre de nodos.
- NFR-001: editar una hoja sigue reflejando roll-ups en **≤150ms**; el resize de columna no degrada el render.
- FR-010: la **vista móvil (solo registro)** no se altera — este cambio es solo de escritorio.
- FR-011 / NFR-003: la persistencia de datos (jerarquía/budgets/actuals/movements) **no se corrompe**; la clave de ancho es independiente y su ausencia/corrupción cae al default 240px sin romper.
- FR-012: se respeta el sistema de diseño (bordes sobre rellenos, sin gradientes/emoji, tokens exactos); la manija de resize usa el estilo del sistema.

## Out of Scope
- **Backgrounds/tonos por nivel de jerarquía** — descartado explícitamente por el usuario; los niveles se siguen distinguiendo por indentación + ícono + peso de texto.
- Reordenar por posición (sort) y arrastrar grupos/tipos — sigue fuera de v1 (no_go_zone del proyecto).
- Cualquier cambio en la vista móvil.
- Ampliar el set de íconos de categoría más allá del actual (el selector de íconos existente se conserva).
