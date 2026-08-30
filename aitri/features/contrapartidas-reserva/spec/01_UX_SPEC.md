# 01_UX_SPEC — contrapartidas-reserva

Diseño provisto por el cliente: NINGUNO (no hay mockups ni `feature_context/`). Las tres decisiones
de forma que la Fase 1 dejó abiertas las tomó el usuario el 2026-08-29 eligiendo entre opciones
presentadas: (1) la señal de techo va en el **encabezado del mes** de la grilla con el detalle en el
Balance; (2) el margen se muestra **inline junto al input**, con el patrón «Máx.» que ya existe;
(3) el retiro se inicia con una **acción en la fila de la alcancía**. Todo lo demás se deriva del
sistema de diseño vigente del producto.

**Autoridad de tokens:** el estándar del padre que el briefing adjunta está marcado SUPERADO por la
feature `stack-upgrade-theme`. La fuente de verdad vigente es `src/app/globals.css` (temas claro y
oscuro, paleta zinc neutra) más los roles canónicos de `refinamiento-ui` (FR-1201:
`--favorable`/`--alert-soft`/`--alert-strong`). Esta feature NO introduce ningún color nuevo.

**Alcance por viewport.** El producto no renderiza la grilla por debajo de 760px (estándar del padre:
a 375px solo existe «Registrar»). Las superficies nuevas de esta feature viven en la grilla y en el
Balance, así que son de **escritorio (≥768px)**. En móvil la ruta equivalente ya existe y no cambia:
el Registro (`register/ReserveRow.tsx`) resuelve los dos extremos de una operación De→A y muestra el
saldo de cada alcancía antes de operar. Ver §Responsive.

---

## User Flows

Persona única: **Dueño del presupuesto** (usuario único, tech mid).

### F1 — Reservar en una celda sabiendo cuánto cabe (FR-1605)
- **Entrada:** clic en la celda Ejec. de una alcancía en la grilla, mes M.
- **Pasos:**
  1. El editor abre con el valor actual seleccionado y, a su derecha, **«Máx. N»** — el margen del
     mes calculado ANTES de teclear nada.
  2. El usuario teclea. Mientras el valor no supere el margen, «Máx. N» se mantiene en
     `--fg-muted`.
  3. Si el incremento supera el margen, «Máx. N» pasa a `--alert-strong` **antes** de confirmar.
  4. Enter o blur confirma.
- **Salida:** celda actualizada, editor cerrado.
- **Camino de error:** al confirmar un valor rechazado, el editor **no se cierra**; la franja de
  bloqueo (comportamiento vigente) aparece bajo la celda con el mensaje del dominio, el input queda
  enfocado y seleccionado. El usuario corrige o pulsa Escape.
- **Caso margen 0:** el editor abre ya mostrando «Máx. 0» en `--alert-strong` — el usuario ve que
  no cabe nada ANTES de escribir, en vez de descubrirlo al ser rechazado.

### F2 — Enterarse de que un mes quedó por encima del techo (FR-1606)
- **Entrada:** cualquier estado en que las reservas netas de un mes superen su margen. El disparador
  típico no es reservar (eso se bloquea) sino **bajar un ingreso después de haber reservado**.
- **Pasos:**
  1. El encabezado de la columna de ese mes muestra el **ícono de alerta**, con `title` que nombra
     el mes y el exceso.
  2. Al pie del Balance aparece una **franja de detalle** que nombra el mes, el exceso y la
     consecuencia («los meses siguientes quedan sin margen»).
- **Salida:** el usuario corrige — baja la reserva o sube el ingreso — y ambas señales desaparecen
  solas, sin acción adicional.
- **Camino de error:** ninguno. La señal es informativa; **no bloquea nada** y no ofrece un botón que
  «arregle» automáticamente, porque cuál de los dos lados está mal es una decisión del usuario.
- **Estado vacío:** en un estado sano no hay ícono en ningún encabezado ni franja al pie.

### F3 — Sacar de una alcancía estando en ella (FR-1607, FR-1608)
- **Entrada:** el puntero entra en la fila de una alcancía en la grilla.
- **Pasos:**
  1. Aparece la acción **«Sacar»** en la fila (misma mecánica de aparición que el «+» de FR-102).
  2. Al activarla abre el popover de retiro **con el origen ya resuelto** — sin desplegable — y con
     **«Máx. S»** (el saldo de esa alcancía) visible desde el primer instante.
  3. Campos: monto, y **nota opcional «¿para qué?»** (FR-1608).
  4. Sacar → toast con **Deshacer** de un nivel, idéntico al de la fila del Balance.
- **Salida:** movimiento journalizado, saldo derivado actualizado.
- **Camino de error:** monto mayor que el saldo → el botón Sacar queda deshabilitado y «Máx. S» pasa
  a `--alert-strong`; el popover no se cierra. Un rechazo del dominio muestra el mensaje inline.
- **Sin alcancías:** la acción no aparece en filas que no son alcancías (hojas transfer).

### F4 — Corregir un mover equivocado (FR-1609)
- **Entrada:** clic en la celda Ejec. de la fila «Retiros del mes» del Balance (superficie vigente).
- **Pasos:**
  1. La lista de operaciones del mes muestra **retiros y moveres**. Cada retiro se lee
     «de «X» → Disponible»; cada mover **«de «X» → «Y»»**, con los dos extremos.
  2. Cada elemento tiene su acción de eliminar.
- **Salida:** el movimiento desaparece y los saldos de ambos extremos vuelven a lo previo.
- **Camino de error:** un id inexistente o un mover cuyo destino ya se borró no cambia nada y no
  lanza; la lista se re-deriva.
- **Estado vacío:** «Sin operaciones este mes» — mismo tratamiento que hoy.

---

## Component Inventory

### Pantalla: Presupuesto — grilla escritorio (≥768px)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Encabezado de mes — marca de techo roto** (NUEVO, FR-1606) | **default**: sin marca · **error**: ícono `TriangleAlert` de Lucide 13px, `currentColor` en `--alert-strong`, a la izquierda del nombre del mes, con `title` = «agosto: reservas 14.998.500 por encima del margen» · **empty/loading/disabled**: sin marca (durante la hidratación no se pinta: un falso positivo en el esqueleto sería peor que el retardo) | Derivado, no almacenado: aparece y desaparece con el estado. `aria-label` en el encabezado repite el texto del `title` | H1 visibilidad del estado, H9 reconocer y diagnosticar |
| **Editor de celda de reserva — indicador de margen** (MODIFICA `ReserveCellEditor`, FR-1605) | **default**: «Máx. N» a la derecha del input, `--fg-muted`, `text-caption` · **error**: el valor tecleado supera el margen → «Máx. N» en `--alert-strong` (antes de confirmar) · **disabled**: margen 0 → «Máx. 0» en `--alert-strong` al abrir · **loading**: n/a (cálculo síncrono) · **empty**: n/a | Se recalcula en cada tecleo. NO reemplaza la sección «Observaciones», que sigue bajo la celda. NO desplaza la grilla: se pinta dentro del ancho de celda ya reservado (`CELL_W`) | H1 visibilidad, H5 prevención del error, H4 consistencia con «Máx.» del retiro |
| **Fila de alcancía — acción «Sacar»** (NUEVO, FR-1607) | **default**: oculta · **hover/focus-within**: visible, ícono de línea + etiqueta accesible «Sacar de «X»» · **disabled**: saldo 0 → visible pero inerte, con `title` «Sin saldo que sacar» · **empty**: no se renderiza en filas que no son hojas transfer · **loading**: no se renderiza hasta que el estado está hidratado | Alcanzable por teclado (aparece con `focus-within`, no solo con ratón). Abre el popover de retiro con `fromId` fijado | H3 control del usuario, H7 flexibilidad y eficiencia, H6 reconocimiento sobre recuerdo |
| Celda de reserva (`ReserveLeafCell`) | sin cambio | sin cambio | — |
| Franja de bloqueo del editor | sin cambio | sin cambio | H9 |

### Pantalla: Módulo de Balance (al pie de la grilla)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Franja de detalle de techo roto** (NUEVO, FR-1606) | **default**: ausente · **error**: presente, bajo la última fila del Balance; ícono `TriangleAlert` + texto «agosto: reservas 14.998.500 por encima del margen del mes — los meses siguientes quedan sin margen»; borde `--alert-strong`, fondo `--bg-card`, `--radius-sm` · **empty**: ausente en estado sano · **loading/disabled**: ausente | Lista TODOS los meses en exceso, uno por línea, en orden de mes. `role="status"` — informa sin robar el foco | H1 visibilidad, H9 diagnóstico, H10 ayuda |
| **Lista de operaciones del mes** (MODIFICA el mini-form de `WithdrawCell`, FR-1609) | **default**: retiros y moveres del mes, cada uno con acción de eliminar · **empty**: «Sin operaciones este mes» · **error**: mensaje inline del dominio, la lista no se cierra · **loading**: n/a · **disabled**: n/a | Un retiro se lee «de «X» → Disponible»; un mover «de «X» → «Y»». La eliminación es inmediata y reversible re-registrando | H3 control y libertad, H6 reconocimiento, H9 recuperación |
| Fila «Retiros del mes» | sin cambio de comportamiento | sigue operando y graduando el sobre-retiro | — |

### Popover de retiro (`WithdrawCell` → compartido por las dos puertas)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Origen** | **default (puerta del Balance)**: desplegable con todas las alcancías, ruta y saldo — sin cambio · **default (puerta de la fila)**: origen RESUELTO, mostrado como texto no editable con su saldo · **empty**: «No tienes alcancías» · **error/loading/disabled**: n/a | Una sola implementación, dos modos de entrada | H4 consistencia |
| Monto + «Máx.» | sin cambio | sin cambio | H5 |
| **Campo de nota «¿para qué?»** (NUEVO, FR-1608) | **default**: vacío, placeholder «¿Para qué? (opcional)» · **error**: >280 caracteres → contador en `--alert-strong` y el guardado se impide, mismo tratamiento que las observaciones de celda · **empty**: se guarda `null`, no cadena vacía · **disabled/loading**: n/a | Opcional siempre: Enter en el monto sigue guardando sin pasar por la nota | H6 reconocimiento, H8 diseño minimalista (opcional, no obligatorio) |
| Toast + Deshacer | sin cambio, y **la puerta nueva lo hereda** (FR-1607) | undo de un nivel, 6s | H3 control y libertad |

---

## Nielsen Compliance

**Grilla de Presupuesto**
- **H1 Visibilidad del estado** — el margen se ve antes de teclear (era invisible hasta el rechazo) y el techo roto se marca en el encabezado del mes, que está a la vista mientras se trabaja. *Trade-off:* el encabezado gana un elemento en una zona densa; se acota a un ícono de 13px sin texto, con el detalle delegado al Balance.
- **H4 Consistencia** — «Máx. N» usa la misma palabra, posición y tratamiento que el «Máx.» del popover de retiro. NFR-1613 exige que las tres superficies muestren el límite antes de operar; esta es la que faltaba.
- **H5 Prevención del error** — el objetivo declarado: que el usuario no llegue a teclear un imposible. La franja de bloqueo queda como red, no como primer aviso.
- **H6 Reconocimiento sobre recuerdo** — la acción «Sacar» en la fila elimina el paso de recordar cuál alcancía era para volver a elegirla en una lista.
- **H7 Flexibilidad** — dos puertas para el mismo retiro: la de la fila (rápida, contexto resuelto) y la del Balance (vista del mes, corrección). *Trade-off:* dos caminos son más superficie que mantener; se mitiga compartiendo una sola implementación de popover.

**Módulo de Balance**
- **H1/H9 Visibilidad y diagnóstico** — la franja dice qué pasó (exceso), en qué mes, y qué consecuencia tiene (los meses siguientes sin margen). Antes la única señal era un número negativo sin explicación.
- **H3 Control y libertad** — FR-1609 devuelve la reversibilidad a los moveres. *Trade-off decidido:* la franja NO ofrece un botón que corrija sola, porque cuál lado está mal —la reserva o el ingreso— solo lo sabe el usuario.
- **H10 Ayuda** — el texto de la franja es la explicación; no hay documentación aparte que consultar.

**Accesibilidad (WCAG 2.1 AA, nivel declarado del producto)**
- Toda señal de estado lleva **canal no cromático** además del color (WCAG 1.4.1): el ícono `TriangleAlert` para el techo roto — forma propia, distinta de los glifos ya en uso `›`, `››`, `‹` y `!`, que esta feature no toca.
- Contraste, **medido para esta feature** (no copiado de los comentarios del CSS): `--alert-strong` 5.76:1 sobre el lienzo claro y 6.02:1 sobre el oscuro — AA para texto normal en ambos. `--fg-muted` 4.93:1 en claro y 6.72:1 en oscuro: pasa AA para texto normal, y aquí se usa en `text-caption` (0.75rem), que es texto pequeño, así que el margen es el justo — si el revisor quiere holgura, `--fg-secondary` (6.90:1 claro) es el reemplazo sin salir del sistema.
- **Discrepancia anotada, no corregida:** `globals.css` comenta `--alert-strong` como «4.85:1» y la medición da 5.76:1 sobre el lienzo (6.16:1 sobre blanco). El comentario parece haber quedado atrás de un cambio de hexadecimal. No afecta a esta feature —el valor real es mejor que el documentado— pero conviene que alguien lo revise; queda fuera de este alcance.
- La acción «Sacar» aparece con `focus-within`, no solo con `:hover` — alcanzable por teclado.
- La franja usa `role="status"`: la anuncia el lector de pantalla sin robar el foco al usuario que está tecleando.
- `prefers-reduced-motion`: sin animaciones nuevas; la aparición de la franja y de la acción es un cambio de opacidad que la regla global ya reduce a 0.001ms.

---

## Design Tokens

Esta feature **no define ningún token nuevo**. Todos los valores salen del sistema vigente
(`src/app/globals.css`) y de los roles canónicos de `refinamiento-ui` FR-1201. Se listan los que la
feature consume, con la razón de cada uso. Un token que contradijera el estándar del padre sería un
defecto; aquí no hay ninguno.

### Roles de color consumidos

| Rol | Claro | Oscuro | Uso en esta feature | Razón |
|---|---|---|---|---|
| `--alert-strong` | `#ad3932` | `#ec6a66` | Ícono de techo roto, borde de la franja, «Máx.» al pasarse | Rol canónico de la excepción grave (FR-1201). Techo superado y saldo negativo son la misma familia de problema |
| `--fg-muted` | `#6b6b73` | `#9b9ba3` | «Máx. N» en estado normal | Dato de apoyo, no protagonista: no debe competir con la cifra que se teclea |
| `--fg` | `#1c1c1f` | `#f4f4f5` | Texto de la franja de detalle | Texto de lectura: el máximo contraste (16.4:1 claro) |
| `--fg-secondary` | `#55555d` | `#b4b4bb` | Etiqueta y placeholder del campo de nota | Jerarquía secundaria, 7.3:1 en claro |
| `--bg-card` | `#ffffff` | `#1b1b1f` | Fondo de la franja de detalle | Superficie estándar; la franja flota sobre el lienzo como cualquier tarjeta |
| `--bg-elevated` | `#ffffff` | `#26262b` | Fondo del campo de nota en el popover | Igual que el resto de inputs del popover de retiro |
| `--border` | `#e3e3e7` | `#33333a` | Borde del campo de nota | Estándar de input |
| `--border-hover` | `#d3d3d9` | `#43434c` | Borde de la fila con la acción «Sacar» visible | Regla dura del sistema: **el hover cambia el borde, no el fondo** |

**No se usan:** `--type-expense`, `--type-income`, `--type-transfer`. La regla de `refinamiento-ui`
(FR-1201) es que **el color codifica ESTADO, no CATEGORÍA**, y la grilla quedó con cero color de tipo
(TC-RUI-002f lo barre). Esta feature no lo reintroduce.

### Tipografía
Sin cambios. `--font-sans` (Inter) para texto; `--font-mono` (DM Mono) con `tabular-nums` para toda
cifra, incluido «Máx. N» y el exceso de la franja — el producto alinea números en columna.
Escala consumida: `--text-caption` (0.75rem) para «Máx. N» y la franja; `--text-label` (0.8125rem)
para la etiqueta del campo de nota.

### Espaciado, radios, motion
Sin cambios. Franja: `--spacing-3` de padding, `--radius-sm` (8px), `--shadow-md` como el resto de
elementos elevados. Ícono del encabezado: `--spacing-1` de separación del nombre del mes. Acción
«Sacar»: altura `--control-sm` (32px). Motion: solo opacidad, `--duration-fast` (120ms) con
`--ease-snap`, sujeto a `prefers-reduced-motion` como todo el producto.

### Responsive
- **375px (móvil):** la grilla y el Balance NO se renderizan (estándar del padre: bajo 760px solo
  existe «Registrar»). Ninguna superficie nueva de esta feature aparece. La ruta equivalente para
  operar reservas ya existe y NO cambia: el Registro resuelve los dos extremos con chips y muestra
  el saldo de cada alcancía antes de operar — ya cumple la regla «el estado se ve antes de operar».
  **Nota para el revisor:** el criterio de FR-1607 que dice «operable a 375px sin scroll horizontal»
  se satisface por esta vía, no por la puerta nueva. Si se quiere la puerta nueva también en móvil,
  es un cambio de alcance que hay que decidir antes de la Fase 2.
- **768px (tablet):** todo presente. La franja de detalle ocupa el ancho del módulo de Balance y
  hace `wrap` a dos líneas si hace falta; no provoca scroll horizontal.
- **1440px (escritorio):** la marca del encabezado viaja con la columna del mes en el scroll
  horizontal de la grilla; la columna de rótulos sticky no la tapa.

Preview: `UX_PREVIEW.html` — transcripción visual de estos tokens, no vinculante.
