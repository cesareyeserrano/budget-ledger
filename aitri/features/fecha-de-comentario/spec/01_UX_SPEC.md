# UX / Design Spec

Feature **fecha-de-comentario**. Cambio acotado DENTRO del Detalle de celda de `diario-de-celda` (su 01_UX_SPEC.md,
FR-2508): la fila de comentario gana la columna de fecha que ya tienen las filas de movimiento, y los comentarios con
día se intercalan con los movimientos. No hay mockups nuevos; no se crean pantallas ni componentes: se modifica la
fila `DetailRow` (variante comentario) y el orden de `cellDetail`.

**Archetype: CLINICAL/TRUST** — reason: finanzas personales. Igual que en `diario-de-celda`, sus defaults visuales
quedan superados por el estándar del producto padre (`stack-upgrade-theme`: temas claro y oscuro, paleta zinc,
tipografía mono); se conservan contraste ≥4,5:1 y cero animaciones decorativas.

**Medio:** app web responsive. El Detalle existe solo en el shell de escritorio (>760 px). A 375 px la app muestra
únicamente «Nuevo movimiento» (FR-010 de la raíz): esta feature no cambia nada ahí.

**Constraint check:** sistema de diseño = el del producto (`src/app/globals.css`); accesibilidad = WCAG 2.1 AA;
viewport = escritorio 768-1440 px para el Detalle; rendimiento = sin cambio (el orden es un sort en memoria de las
líneas de UNA celda). Todo tomado de `01_REQUIREMENTS.json#constraints` y del spec padre; nada que preguntar.

Preview: `UX_PREVIEW.html` — muestra las cuatro variantes de fila (movimiento, comentario con día, comentario sin
día, orden intercalado) con los tokens reales en claro y oscuro.

## User Flows

Persona única: presupuestador personal (usuario único de producción).

### F1 — Añadir un comentario y verlo con su día (FR-2601, FR-2602, FR-2603)
- **Entry:** Detalle abierto sobre una celda de Ejecutado de un periodo abierto → enlace «+ Añadir comentario»
  (vigente, `comment-reveal`) → campo de comentario con foco.
- **Steps:** escribir el texto → Enter (o el botón de añadir vigente). No hay selector de fecha: el día es el de
  hoy en la hora local.
- **Exit:** el comentario aparece en la lista con el día de hoy («21 sep») en la columna de fecha, en su lugar
  cronológico entre los movimientos (después de los movimientos de hoy). El campo queda vacío y con foco, como hoy.
- **Error path:** texto vacío → Enter no hace nada (vigente). Más de 280 caracteres → contador en `--error` y
  rechazo sin truncar (vigente, FR-1012). Si el servidor rechaza el guardado (red caída, 422 invalid_payload), aplica el manejo de
  fallo de guardado vigente del store, el mismo que para cualquier otra escritura: esta feature no lo cambia.

### F2 — Leer una celda con comentarios antiguos (FR-2602, FR-2603)
- **Entry:** abrir el Detalle de una celda con comentarios escritos antes de esta feature.
- **Steps:** ninguno — solo lectura.
- **Exit:** los comentarios antiguos aparecen al final, en su orden de siempre, con la columna de fecha vacía y el
  texto alineado con las notas de los movimientos. Escape o clic fuera cierra el Detalle (vigente).
- **Error path:** no hay acción que pueda fallar; si la carga del ledger falla aplica el estado de error vigente
  de la app (sin Detalle que abrir).

### F3 — Celda de bolsillo (FR-2602, FR-2603)
- **Entry:** Detalle de una celda de bolsillo (transfer).
- **Exit:** los comentarios siguen al final, tras la nota automática y las notas de operaciones; los que tienen día
  primero (por fecha), luego los que no. El día se muestra con el mismo formato.
- **Error path:** idéntico a F1.

### F4 — Mes o ciclo cerrado (NFR-2603)
- **Entry:** Detalle de una celda de un periodo cerrado.
- **Steps:** el campo de comentario se ve siempre, como hoy (FR-2004: los comentarios no se congelan; en un mes
  cerrado es la única caja del panel) → escribir → Enter.
- **Exit:** el comentario aparece con el día de hoy, aunque ese día caiga fuera del mes cerrado: es el día en que se
  escribió, no un día del periodo. Movimientos y cifras siguen sin acciones (vigente, FR-2507). Escape cierra.
- **Error path:** idéntico a F1.

## Component Inventory

### Pantalla: Presupuesto — grilla escritorio — Detalle de celda

| Componente | default | loading | error | empty | disabled | Comportamiento | Nielsen |
|---|---|---|---|---|---|---|---|
| Fila de comentario (`detail-row` `data-kind="comment"`) — MODIFICADO | Ícono comentario 12 px · **fecha** (`detail-date`, 44 px, `--fg-muted`, «18 sep») · texto (`cell-note`, `--fg`, en varias líneas) | No aplica: el Detalle pinta el estado ya cargado; un comentario recién añadido aparece al instante (actualización optimista vigente) | Si el guardado falla, aplica el manejo de fallo de guardado vigente del store (sin cambios) | Comentario sin día: la columna de fecha existe con sus 44 px pero **vacía** (sin texto, sin guion) | Sin estado deshabilitado: los comentarios no tienen acciones (no se editan ni se borran) en ningún mes | Misma anatomía que la fila de movimiento: ícono · fecha · texto; sin columna de monto | H1, H4, H8 |
| Lista del Detalle (orden) — MODIFICADO | Movimientos y comentarios con día intercalados por fecha ascendente; a igual día, comentario después; al final los comentarios sin día por antigüedad | Vigente | Vigente | «Sin movimientos ni comentarios» (vigente) | Vigente | En bolsillos: nota automática, notas de operaciones y, al final, comentarios (con día por fecha, luego sin día) | H4, H6 |
| Campo «Añadir comentario» (`CellNoteInput`) — SIN CAMBIOS | Vigente | Vigente | Vigente (contador >280 en `--error`) | Vigente | No aplica: se ofrece también en mes cerrado (FR-2004, vigente) | No gana selector de fecha: el día se toma solo al guardar | H5, H7 |

## Nielsen Compliance

### Detalle de celda
- **H1 Visibilidad del estado:** el comentario recién añadido aparece al instante con el día de hoy: el usuario ve
  qué se guardó y cuándo, sin recargar.
- **H4 Consistencia:** la fecha del comentario usa exactamente la columna, el ancho (44 px), el formato («18 sep») y
  el color (`--fg-muted`) de la fecha de un movimiento. Por eso un comentario de hoy dice «21 sep» y no «Hoy»: el
  «Hoy» solo existe en el botón de fecha de «Añadir movimiento», que es un control, no una fila.
- **H6 Reconocer antes que recordar:** leer comentarios en su lugar cronológico evita tener que recordar a qué
  gasto se refería una nota escrita al final.
- **H7 Eficiencia:** ningún paso nuevo para comentar: sin selector de fecha (decisión del usuario).
- **H8 Minimalismo:** sin hora, sin guion ni «sin fecha» en los antiguos: la columna vacía basta.
- **Trade-off aceptado:** un comentario antiguo sin día no puede ubicarse en el tiempo; se deja al final en vez de
  inventarle una posición (guardrail de Phase 1: ninguna fecha inventada).

## Design Tokens

Fuente: **estándar del producto padre** (`stack-upgrade-theme` FR-202/FR-204, `src/app/globals.css`) y spec de
`diario-de-celda`. Esta feature **no introduce tokens nuevos**: reutiliza los de la fila de movimiento.

### Color roles

| Rol | Token | Claro | Oscuro | Uso y razón |
|---|---|---|---|---|
| background | `--bg` | #f7f7f8 | #131316 | Lienzo de la grilla (vigente) |
| surface | `--bg-elevated` | #ffffff | #26262b | Fondo del panel Detalle (vigente) |
| primary / accent | `--accent` | #1c1c1f | #f4f4f5 | Borde de foco del campo de comentario (vigente) |
| error | `--error` | #ad3932 | #ec6a66 | Contador >280 y aviso de guardado fallido (vigente) |
| text-primary | `--fg` | #1c1c1f | #f4f4f5 | Texto del comentario (vigente) |
| text-secondary | `--fg-secondary` | #55555d | #b4b4bb | Sin uso nuevo |
| text-muted | `--fg-muted` | #6b6b73 | #9b9ba3 | **Fecha del comentario** e ícono: el mismo token que la fecha del movimiento (H4) |
| border | `--border` | #e3e3e7 | #33333a | Borde del panel (vigente) |
| fila | `color-mix(in srgb, var(--fg-muted) 4%, transparent)` | — | — | Fondo de toda fila del Detalle (vigente, FR-2508) |

**Contraste** (WCAG AA ≥4,5:1, texto de 12 px): `--fg-muted` sobre la fila tintada 4 % = 5,0 (claro) / 5,1
(oscuro); `--fg` sobre la fila = 16,3 / 12,9. Son los mismos pares ya verificados en `diario-de-celda`; ningún par
nuevo.

### Type scale (font family rationale)
- Familia `--font-mono` (DM Mono): estándar del producto; las fechas alinean por columna con `tabular-nums`.
- `caption` 0,75 rem / 400 para fecha y texto del comentario (igual que la fila de movimiento).
- `.tabular` en la fecha.

### Spacing scale
- Base 4 px. Fila: padding 4 px vertical, 6 px horizontal; separación interna 6 px; ícono 12 px, trazo 1,5.
- Columna de fecha: 44 px fijos (`w-[44px] flex-none`), también cuando está vacía, para alinear el texto.
- Radio de fila `--radius-xs`. Motion: ninguna.

### Responsive
- **375 px:** el Detalle no existe; sin cambios («Nuevo movimiento» únicamente).
- **768 px:** panel `min(440px, 100vw − 32px)` (vigente). El texto del comentario se parte en varias líneas; la fecha
  queda arriba a la izquierda, alineada con la primera línea.
- **1440 px:** igual que 768 px.
