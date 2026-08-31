# UX / Design Spec — techo-de-flujo

**Archetype: [PRO-TECH/DASHBOARD]** — reason: el producto es una grilla densa de doce meses con
cifras alineadas, tema claro/oscuro y tipografía mono tabular para todo dato; el usuario opera sobre
ella como sobre una hoja de cálculo. El archetype solo llena huecos: **manda el sistema de diseño ya
establecido del producto** (`src/app/globals.css` + los roles canónicos de `refinamiento-ui`
FR-1201), que esta feature NO altera.

**Diseño provisto por el cliente:** parcial y vinculante. El usuario (a) dibujó la disposición de la
grilla en tres bloques, (b) eligió la forma del indicador de límite sobre una comparación
**renderizada a escala real** el 2026-08-31 (celda de 108px, sus cifras, sus tokens) y (c) dictó
pieza por pieza qué se queda y qué se retira del inventario existente. Esas decisiones se
TRANSCRIBEN aquí; no se re-abren.

**Esta feature no introduce ningún token nuevo.**

---

## User Flows

Persona única: **Dueño del presupuesto** (usuario único, tech mid).

### F1 — Reservar en un mes desde la celda (escritorio, FR-1801 · FR-1808)
- **Entrada:** clic en la celda de un bolsillo, mes M, plano Ejecutado.
- **Pasos:**
  1. El editor abre con el valor actual seleccionado y, **debajo del input**, el cupo que queda:
     «Máx. 1.500.000». El input conserva el ancho íntegro de la celda.
  2. El usuario teclea. Mientras el valor cabe, el indicador sigue en gris apagado.
  3. Confirma con Enter. La celda se actualiza y el editor cierra.
- **Salida:** celda actualizada, cupo del mes recalculado en el indicador de las demás celdas.
- **Camino de error:** si el valor supera el cupo, el indicador pasa a rojo **mientras teclea**, antes
  de confirmar. Si aun así confirma, no se guarda: el editor queda abierto con el valor seleccionado y
  una franja bajo el indicador dice cuánto cabía. Escape descarta y restaura.
- **Cupo 0:** el editor abre con «Máx. 0» ya en rojo — se ve antes de teclear, no tras el rechazo.
- **Acción primaria:** Enter (guardar). **Escape:** Esc (descartar sin cambios).

### F2 — Sacar plata de un bolsillo (escritorio, FR-1805)
- **Entrada:** clic en la celda del mes en la fila **«Retiros del mes»**, ahora ÚLTIMA fila del
  segmento de Reservas (antes vivía al pie del Balance — el traslado resuelve BL-019).
- **Pasos:** se abre el popover con el desplegable de bolsillos (cada uno con su saldo), el monto, el
  campo «¿Para qué? (opcional)» y el botón Guardar.
- **Salida:** el retiro queda registrado; el saldo del bolsillo baja y la cuenta sube.
- **Camino de error:** sacar más de lo que el bolsillo tiene se rechaza con el saldo real en el
  mensaje; el popover no se cierra y el monto queda seleccionado para corregir.
- **Sin bolsillos:** el desplegable dice «No tienes bolsillos» y Guardar queda inerte.
- **Acción primaria:** Guardar. **Escape:** clic fuera o Esc.

### F3 — Corregir un retiro editando su monto (escritorio, FR-1802 · FR-1803)
- **Entrada:** el mismo popover de F2, sección «Operaciones de este mes».
- **Pasos:**
  1. Cada operación del mes se lista con su fecha, su bolsillo, su sentido y **su monto como campo
     editable** (ya no hay botón de borrar).
  2. El usuario teclea el monto nuevo — p. ej. 300 donde decía 500 — y confirma con Enter o al salir
     del campo.
  3. El saldo del bolsillo y la cuenta se ajustan; la celda de reservas del mes NO cambia.
- **Salida:** operación corregida, lista actualizada en el sitio.
- **Teclear 0:** elimina la operación. La fila desaparece con una confirmación breve en línea
  («Operación eliminada») que se desvanece; no hay diálogo modal.
- **Camino de error:** si la edición dejaría un bolsillo en negativo o un mes por encima de su techo,
  no se guarda: el campo vuelve a su valor anterior y aparece bajo la fila el motivo nombrando el mes
  afectado («Febrero ya reservó contando con este retiro»).
- **Estado vacío:** «Sin operaciones este mes».
- **Acción primaria:** Enter (confirmar el monto). **Escape:** Esc devuelve el valor anterior.

### F4 — Entender de dónde salió la plata del mes (escritorio, FR-1804)
- **Entrada:** ninguna — la observación automática aparece sola en el mes cuyas reservas se
  completaron del saldo anterior.
- **Pasos:** el usuario ve el indicador de observación en el mes y lo abre para leer: «De los 1.500
  reservados este mes, 500 salieron del saldo de enero».
- **Salida:** lectura; no hay acción que tomar.
- **Actualización:** si baja la reserva, el texto se reescribe solo; si ya cabe en el flujo del mes, la
  observación desaparece.
- **Camino de error:** no aplica (no hay entrada del usuario). Las observaciones escritas a mano
  conviven con ella y nunca se pisan.

### F4b — Anotar una observación en cualquier celda (escritorio, FR-1809)
- **Entrada:** el usuario abre una celda cualquiera de la grilla — gasto, ingreso o bolsillo, en
  cualquiera de los dos planos.
- **Pasos:** escribe el texto en el campo de observación y confirma.
- **Salida:** la celda pasa a mostrar el indicador de observación; el texto se lee al abrirlo y
  sobrevive a la recarga.
- **Camino de error:** un texto vacío o de más de 280 caracteres no se guarda y las observaciones
  vigentes de esa celda no cambian; el motivo aparece junto al campo.
- **Estado vacío:** una celda sin observaciones no muestra indicador — la grilla no gana ruido donde
  no hay nada anotado.
- **Acción primaria:** confirmar. **Escape:** Esc cierra sin guardar.

### F5 — Ver y resolver un error del mes (escritorio, FR-1806)
- **Entrada:** el usuario ve una marca de alerta en el encabezado de un mes.
- **Pasos:** al pasar el ratón lee el resumen; baja al Balance y la franja detalla el error nombrando
  el mes y la cifra.
- **Salida:** el usuario corrige la causa (baja una reserva, sube un ingreso, ajusta un retiro) y
  ambas señales desaparecen sin recargar.
- **Camino de error:** la franja no ofrece corrección automática a propósito: cuál de los dos lados
  está mal solo lo sabe el usuario.
- **Estado sano:** ninguna marca en ningún encabezado y la franja no se renderiza.

### F0 — Móvil a 375px (todas las FR)
La grilla **no se renderiza** bajo 760px: la única vista sigue siendo **Registrar**, sin cambios en
esta feature. Reservar y sacar desde móvil se hacen ahí, con el límite del origen visible antes de
teclear (comportamiento vigente que se conserva). No hay desbordes horizontales: el ancho del
documento no supera el del viewport.

---

## Component Inventory

### Pantalla: Presupuesto — grilla escritorio (≥768px)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Editor de celda con límite debajo** (MODIFICA `ReserveCellEditor`, FR-1808) | **default**: input a ancho íntegro + «Máx. N» flotando debajo en `--fg-muted` · **error**: el valor supera el cupo → «Máx. N» y el borde de su recuadro en `--alert-strong`, ANTES de confirmar · **disabled**: cupo 0 → abre ya en alerta · **loading/empty**: n/a | El indicador se posiciona `absolute` bajo el input (mismo contenedor donde ya vive el mensaje de rechazo), así que NO consume ancho: con «Máx. 10.200.000» el input sigue completo. Forma elegida por el usuario sobre comparación renderizada; se descartaron «solo al pasarse» (no permite saber el cupo por adelantado) y «en el encabezado del mes» (sube el alto de la cabecera) | H5 prevención del error, H1 visibilidad, H6 reconocimiento |
| **Segmentos de la grilla** (NUEVO agrupamiento, FR-1805) | **default**: tres bloques —Ingresos+Gastos · Reservas · Balance— separados por `--spacing-6` · **empty**: un tipo sin nodos muestra su rótulo y su fila de tipo, no un hueco · **loading**: esqueleto por bloque, conservando la separación · **error/disabled**: n/a | Reservas SALE del bloque de Ingresos y Gastos. Los tres comparten UN riel de columnas de mes y UN scroll horizontal: enero de Gastos y enero de Reservas caen en la misma columna | H8 minimalista, H4 consistencia |
| **Fila «Retiros del mes»** (SE MUDA, FR-1805) | **default**: última fila del segmento de Reservas, con su cifra por mes · **empty**: 0 en el mes sin retiros · **error**: mensaje inline del dominio, el popover no se cierra · **loading/disabled**: n/a | Es la puerta para sacar (F2). Al plegarse los grupos de bolsillos permanece visible sin scroll adicional | H6, H7 eficiencia: la acción está donde está el dato |
| **Sombreado de la columna del mes activo** (SE AMPLÍA, FR-1805) | **default**: la columna del mes activo con `color-mix(--accent 8%)` · **empty/loading/error/disabled**: n/a | Hoy existe en la grilla y NO en el Balance; pasa a atravesar los tres bloques con el mismo tratamiento, y se mueve en los tres a la vez al cambiar de mes | H4 consistencia, H1 |
| **Marca de error en el encabezado del mes** (SE AMPLÍA, FR-1806) | **default**: sin marca · **error**: icono `TriangleAlert` en `--alert-strong` con `title`/`aria-label` que resume el error · resto: n/a | Deja de saber solo de «techo excedido»: se alimenta de la lista de errores del mes, hoy con un tipo y abierta a otros. Icono + texto: el color no es el único canal | H1, H9 recuperación |
| **Observación automática del mes** (NUEVO, FR-1804) | **default**: indicador de observación en la celda del mes de la fila **total de Reservas**, con el texto al abrirlo · **empty**: sin observación no hay indicador · **loading/error/disabled**: n/a | Vive en la celda del TOTAL de Reservas porque es del MES y de ningún bolsillo — atribuirla a uno concreto sería arbitrario con varios bolsillos. Usa el mismo indicador que cualquier otra observación (FR-1809), así que no inventa vocabulario visual. Se reescribe sola y desaparece cuando la reserva cabe en el flujo; jamás pisa las escritas a mano, que se listan aparte | H2 lenguaje del usuario, H10 ayuda contextual, H4 consistencia |
| **Observación en cualquier celda** (AMPLÍA `CellNotesSection`, FR-1809) | **default**: campo de texto opcional al abrir la celda; con observaciones, la celda muestra su indicador · **empty**: sin observaciones no hay indicador ni ruido visual · **error**: texto vacío o >280 caracteres → no se guarda y el motivo aparece junto al campo · **loading**: durante la persistencia el campo queda inerte · **disabled**: n/a | Hoy solo las celdas de bolsillos las admiten; pasan a estar en TODAS (gastos, ingresos y reservas, en los dos planos). El almacenamiento ya es genérico por nodo y mes: es extender el alcance, no un modelo nuevo | H6 reconocimiento, H10 ayuda y documentación |
| Celdas de Gastos e Ingresos | ganan el indicador y el campo de observación (FR-1809); el resto sin cambio | Su edición, sus roll-ups y su presencia en la grilla no cambian (NFR-1803) | H4 |

### Pantalla: Balance (panel de escritorio)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Franja de errores del mes** (SE AMPLÍA, FR-1806) | **default**: no se renderiza · **error**: una línea por mes con error, con icono, mes y cifra · **empty**: sin errores, ausente · **loading/disabled**: n/a | `role="status"`: se anuncia sin robar el foco a quien teclea. Deriva de la MISMA lista que la marca del encabezado — no puede haber marca sin detalle ni detalle sin marca | H1, H9, H3 control (no corrige por su cuenta) |
| **Cascada del Balance** | sin cambio de estructura, orden ni signos | Conserva la alarma vigente del disponible en negativo: es la señal del sobregasto real | H1 |

### Popover de retiros (desde la fila «Retiros del mes»)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Lista «Operaciones de este mes» con monto editable** (MODIFICA, FR-1802) | **default**: fecha, bolsillo, sentido y **monto como campo editable** · **empty**: «Sin operaciones este mes» · **error**: el campo vuelve a su valor previo y bajo la fila aparece el motivo nombrando el mes afectado · **loading**: durante la persistencia el campo queda inerte · **disabled**: n/a | Teclear 0 elimina la operación (confirmación en línea que se desvanece; sin modal). Se retiran los botones de borrar y su tooltip. La misma edición aplica a los movimientos entre bolsillos que la lista muestra | H3 control y libertad, H9, H7 |
| **Selector de bolsillo, monto y «¿Para qué? (opcional)»** | sin cambio | El campo de propósito SE QUEDA (decisión del usuario) | H6 |
| Botón «Sacar» de la fila del bolsillo | **RETIRADO** | Su función la cubre la fila «Retiros del mes» ya mudada al segmento de Reservas | H8 minimalista |

---

## Nielsen Compliance

**Grilla**
- **H5 Prevención del error** — el cupo del mes se ve antes de teclear y avisa en rojo mientras se
  escribe, no al confirmar. *Trade-off aceptado:* el indicador flota sobre la fila de abajo mientras el
  editor está abierto; el usuario lo eligió frente a esconderlo o subirlo a la cabecera.
- **H1 Visibilidad del estado** — un mes con error lo dice en su encabezado, donde se trabaja, y en el
  Balance, donde se explica. Antes lo único que lo delataba era un disponible negativo al pie que el
  usuario no vio, y de ahí salió el encierro.
- **H4 Consistencia** — el sombreado del mes activo pasa a comportarse igual en los tres bloques; el
  «Máx.» usa el mismo patrón que el módulo de Registrar.
- **H8 Minimalista** — Reservas deja de competir por espacio con Ingresos y Gastos; el botón «Sacar»
  duplicado desaparece al mudarse la fila de retiros junto a los bolsillos.
- **H3 Control y libertad** — corregir un retiro es teclear su monto; 0 lo elimina. La corrección
  destructiva es reversible por construcción (el saldo se restaura solo) y por eso no necesita un
  diálogo de confirmación: lleva confirmación en línea, no modal.
- **H9 Recuperación** — un rechazo no dice solo «no se puede»: nombra el mes que quedaría sin
  respaldo y la cifra que sí cabía.
- **H2 Lenguaje del usuario** — la observación dice «salieron del saldo de enero», no «carry-over».

**Accesibilidad (WCAG 2.1 AA)**
- Contrastes MEDIDOS para esta feature contra el lienzo de cada tema: `--alert-strong` 5,76:1 en
  claro y 6,02:1 en oscuro; `--fg-muted` 4,93:1 en claro y 6,72:1 en oscuro. Los cuatro pasan AA.
  *(Nota heredada: `globals.css` comenta `--alert-strong` como 4,85:1 y la medición da 5,76:1 — el
  comentario quedó atrás de un cambio de color; conviene que alguien lo revise.)*
- El error nunca depende solo del color: la marca lleva icono con `aria-label` y la franja lleva
  icono más texto.
- La franja usa `role="status"` (no `alert`): informa sin interrumpir a quien está tecleando.
- Los campos de monto editables de la lista llevan etiqueta accesible con el bolsillo y el sentido.
- `prefers-reduced-motion`: la confirmación en línea aparece sin transición cuando está activo.

**Responsive**
- **375px:** solo Registrar; la grilla no se monta. Sin desbordes horizontales.
- **768px:** app completa; los tres segmentos apilados con su separación y scroll horizontal por meses.
- **1440px:** doce meses visibles con la columna de rótulos fija; los tres segmentos comparten riel.

---

## Design Tokens

Esta feature **no define ningún token nuevo**. Consume los del producto
(`src/app/globals.css` + roles canónicos de `refinamiento-ui` FR-1201), con su razón:

| Rol | Claro | Oscuro | Uso en esta feature | Razón |
|---|---|---|---|---|
| `--bg` | `#f7f7f8` | `#131316` | Lienzo de la grilla | Estándar vigente del producto |
| `--bg-card` | `#ffffff` | `#1b1b1f` | Superficie de los tres segmentos | Estándar vigente |
| `--bg-elevated` | `#ffffff` | `#26262b` | Recuadro del indicador «Máx.», popover de retiros | Flota sobre la grilla: se distingue por `--shadow-md` |
| `--bg-sunken` | `#f1f1f3` | `#0f0f12` | Encabezado de meses (donde vive la marca de error) | Estándar vigente para insets |
| `--fg` | `#1c1c1f` | `#f4f4f5` | Cifras de las celdas y montos editables | Texto de lectura; máximo contraste |
| `--fg-secondary` | `#55555d` | `#b4b4bb` | Rótulos de fila, etiquetas del popover | Jerarquía secundaria |
| `--fg-muted` | `#6b6b73` | `#9b9ba3` | «Máx. N» en estado normal, encabezados de mes, texto de la observación | Dato de apoyo: no compite con la cifra. AA: 4,93:1 / 6,72:1 |
| `--alert-strong` | `#ad3932` | `#ec6a66` | «Máx.» al pasarse, marca de error del mes, franja del Balance | Rol canónico de la excepción grave (FR-1201). AA: 5,76:1 / 6,02:1 |
| `--accent` | `#1c1c1f` | `#f4f4f5` | Borde del input en edición; base del sombreado de columna activa (`color-mix` al 8%) | Estándar vigente |
| `--border` / `--border-strong` | `#e3e3e7` / `#d3d3d9` | `#33333a` / `#43434c` | Separación de celdas, bordes del recuadro del indicador y de los campos editables | Regla dura del sistema: **el hover cambia el borde, no el fondo** |

**No se usan** `--type-expense`, `--type-income` ni `--type-transfer`: la regla de `refinamiento-ui`
(FR-1201) es que el color codifica ESTADO, no CATEGORÍA. Esta feature no lo reintroduce, y por eso la
separación entre bloques se hace con **espacio**, no con color de tipo.

**Tipografía.** Sin cambios: `--font-sans` (Inter) para texto; `--font-mono` (DM Mono) con
`tabular-nums` para toda cifra —incluidos los montos editables de la lista, para que alineen—.
`--text-caption` (0,75rem) para las celdas y el «Máx.»; `--text-label` (0,8125rem) para etiquetas del
popover.

**Espaciado, radios, motion.** Sin tokens nuevos. La separación entre segmentos usa `--spacing-6`
(24px), suficiente para leerlos como bloques distintos sin desperdiciar alto en una grilla densa. El
indicador «Máx.» se separa del input con `--spacing-1` (4px) y usa `--radius-sm` (8px) y
`--shadow-md`, como cualquier superficie flotante. Controles a `--control-sm` (32px) en escritorio.

**Medidas heredadas que condicionan el diseño.** Ancho de celda `CELL_W` = 108px (`gridLayout.ts`):
es la restricción que obligó a sacar el indicador del flujo horizontal del input. Columna de rótulos
240px, sticky a la izquierda.

Preview: `UX_PREVIEW.html` — manual visual de estos tokens y de las tres piezas nuevas; no vinculante.
