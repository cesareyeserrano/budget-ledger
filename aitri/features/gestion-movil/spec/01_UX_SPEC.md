# UX / Design Spec

Feature **gestion-movil** (BL-089, segunda entrega del teléfono; continuación de `presupuesto-movil`). Lleva al
teléfono la gestión de la estructura —crear, renombrar, cambiar ícono, borrar y mover grupos, categorías y
subcategorías— y el cierre y la reapertura del mes. Construye DENTRO del sistema de diseño vigente y de las pantallas
de `presupuesto-movil`: mismos tokens de `src/app/globals.css`, mismo encabezado de detalle (`DetailHeader`), misma
pila de pantallas respaldada por el historial del navegador (`screenStack`), mismo patrón de confirmación en la
misma pantalla que ya usa «Borrar movimiento». No hay mockups del cliente para estas pantallas; se diseñan sobre lo
que ya existe y el usuario las aprueba con la composición ilustrativa de `UX_PREVIEW.html`.

**Archetype: CLINICAL/TRUST** — reason: finanzas personales; cada acción sobre la estructura o el cierre tiene que
decir sin ambigüedad qué va a pasar. Sus defaults (tema claro único, paleta slate) quedan **superados por el estándar
del producto padre**: temas claro y oscuro, paleta zinc, Inter + DM Mono. Del arquetipo se conservan el contraste
≥4,5:1 y la ausencia de animación decorativa.

**Medio:** web responsive. Todo lo de esta feature existe solo en el shell móvil (≤760 px). Se diseña a 375 px y es
fluido entre 360 y 760 px. A 768 px y 1440 px la app es la de escritorio, **sin cambios** (NFR-3201).

**Es una app WEB, no nativa** (decisión del usuario del 2-oct-2026, heredada): la navegación va arriba; cada pantalla
nueva es una entrada del historial del navegador, así que el «atrás» del navegador y la flecha «‹» hacen lo mismo;
no hay hojas inferiores, gestos ni arrastre. Mover se hace eligiendo el destino de una lista («Mover a…», BL-089).

**Tres decisiones de forma** (las que Phase 1 dejó a esta fase):

1. **Modo «Organizar», no un menú en cada fila de la lista.** La fila de la lista del periodo ya es un control
   completo (abre el detalle o pliega) y lleva nombre, cifra, barra y chevron: no cabe un cuarto elemento sin
   apretar las cifras de 9 dígitos. Además las filas con hijos no abren ninguna pantalla, así que no tendrían dónde
   colgar acciones. Por eso la estructura se gestiona en una pantalla aparte, **Organizar**, que muestra el árbol sin
   cifras: ícono, nombre y la entrada a sus acciones. La lista del periodo queda como estaba (NFR-3202).
2. **Una pantalla por elemento.** Tocar un elemento en Organizar abre su pantalla, con sus acciones en una lista
   («Renombrar», «Cambiar ícono», «Añadir…», «Mover a…», «Borrar»). Las acciones se ven siempre con su rótulo (H6);
   no hay menú de tres puntos que esconda nada.
3. **El cierre tiene pantalla propia**, «Cierre de mes», con dos bloques: cerrar y reabrir. Cada uno dice siempre en
   qué estado está y pide confirmación en la misma pantalla antes de actuar (FR-3207, FR-3208; confirmado por el
   usuario el 6-oct-2026).

**Entradas desde la lista del periodo:** en la línea del título «Presupuesto» aparecen, a la derecha, dos botones
discretos con ícono y rótulo: **Organizar** y **Cierre**. Es lo único que cambia en esa pantalla, además de dos
textos que hoy mandan al computador (ver F9 y F1).

Preview: `UX_PREVIEW.html` — se abre en un navegador. Trae los tokens en claro y oscuro, el contraste y una tira
ilustrativa con las pantallas nuevas.

## User Flows

Persona única: **dueño del libro en el teléfono** (Phase 1). Entrada común: app abierta a ≤760 px, sesión válida,
vista «Presupuesto». En cada pantalla nueva la flecha «‹» del encabezado vuelve a la anterior, igual que el «atrás»
del navegador.

### F1 — Entrar a Organizar y encontrar las acciones de un elemento (FR-3201)
- **Entry:** botón «Organizar» en la línea del título de Presupuesto. También el enlace «Crear la primera ›» que
  sustituye al texto «Se crean desde el computador» en una sección sin categorías.
- **Steps:** se abre **Organizar categorías**. Tres secciones —Ingresos, Gastos, Reservas—, cada una con su
  encabezado y, a la derecha, el botón «＋ Grupo». Dentro, una tarjeta por grupo con todo su árbol a la vista (sin
  plegar): cada fila lleva el ícono del elemento, su nombre y un chevron «›». Las categorías van con sangría de
  14 px y las subcategorías con 28 px. No hay cifras. Tocar una fila abre la pantalla de ese elemento (F2).
- **Exit:** «‹» vuelve a la lista del periodo, que recupera su posición de scroll.
- **Error path:** un enlace a un elemento que ya no existe (borrado en otro dispositivo) vuelve a Organizar sin
  pantalla en blanco. Una sección sin grupos muestra «Aún no hay grupos» y el botón «＋ Grupo» sigue disponible.

### F2 — Pantalla de un elemento (FR-3201)
- **Entry:** tocar una fila en F1.
- **Steps:** encabezado con el nombre y, debajo, la ruta («Gasto · Comida»). Una tarjeta de identidad con el ícono a
  40 px y el nombre. Debajo, la lista de acciones, una por fila de 48 px, cada una con ícono y rótulo:
  - «Renombrar» (F4).
  - «Cambiar ícono» (F5).
  - «Añadir categoría» en un grupo, o «Añadir subcategoría» en una categoría (F3). En una subcategoría no existe.
  - «Mover a…» (F7).
  - «Borrar», en `--alert-strong` y separada del resto (F6).
- **Exit:** «‹» vuelve a Organizar.
- **Error path:** un elemento del sistema (`system`) no muestra «Renombrar» ni «Borrar». Los tres tipos no tienen
  pantalla de elemento: su única acción es «＋ Grupo», en el encabezado de su sección.

### F3 — Crear un grupo, una categoría o una subcategoría (FR-3202)
- **Entry:** «＋ Grupo» en el encabezado de una sección (F1), o «Añadir categoría / subcategoría» en F2.
- **Steps:** se abre **Nuevo grupo** (o «Nueva categoría», «Nueva subcategoría») con la ruta de dónde va a quedar
  («en Gastos», «en Comida»). Un campo «Nombre» con su rótulo encima, con el teclado abierto. Botón principal
  «Crear», a todo el ancho, deshabilitado mientras el nombre esté vacío o sean solo espacios. Si el padre es una
  hoja con montos, bajo el campo aparece el aviso: «Los montos de Mercado pasarán a esta subcategoría» (`--alert-soft`
  con ícono), porque es lo que hace la regla de escritorio y no debe sorprender. Al crear: vuelve a la pantalla
  desde la que se entró, el elemento nuevo aparece en su lugar y un aviso del `Toaster` dice «Grupo creado»
  («Categoría creada», «Subcategoría creada»).
- **Exit:** «‹» o «Cancelar» descartan sin preguntar; no se crea nada.
- **Error path:** nombre vacío → «Crear» deshabilitado, sin mensaje de error (H5: se previene). Si el guardado falla
  en el servidor, lo avisa el `StorageBanner` vigente y, al recargar, el elemento no está.

### F4 — Renombrar (FR-3203)
- **Entry:** «Renombrar» en F2.
- **Steps:** la tarjeta de identidad pasa a modo edición: el nombre se vuelve un campo con el texto seleccionado y,
  debajo, «Guardar» (principal) y «Cancelar». «Guardar» se habilita solo si el texto cambió y no está vacío. Al
  guardar, la tarjeta vuelve a modo lectura con el nombre nuevo, el encabezado se actualiza y el `Toaster` dice
  «Nombre actualizado».
- **Exit:** «Cancelar» o «‹» conservan el nombre anterior.
- **Error path:** texto vacío → «Guardar» deshabilitado y el nombre anterior se conserva. Un nombre de 60 caracteres
  se guarda completo; en las filas se trunca con «…» y en la tarjeta de identidad parte en dos líneas.

### F5 — Cambiar el ícono (FR-3204)
- **Entry:** «Cambiar ícono» en F2, o tocar el ícono de la tarjeta de identidad.
- **Steps:** bajo la lista de acciones se despliega el selector: un campo «Buscar ícono» y una cuadrícula con el
  **mismo catálogo que escritorio** (`IconPicker`), en celdas de 48×48 px, 6 por fila a 375 px. El ícono actual va
  marcado con borde `--fg`. Tocar uno lo guarda, cierra el selector y actualiza la tarjeta de identidad.
- **Exit:** «Cerrar» en el selector, o «‹», conservan el ícono anterior.
- **Error path:** una búsqueda sin resultados muestra «Ningún ícono coincide con “xyz”» y deja el campo para
  corregir.

### F6 — Borrar, o saber por qué no se puede (FR-3205)
- **Entry:** «Borrar» en F2. La acción se muestra **siempre**, también cuando está bloqueada.
- **Steps (se puede):** bajo la acción se abre la confirmación en la misma pantalla, con el patrón de «Borrar
  movimiento»: «¿Borrar la categoría “Prueba”? No tiene valores ni movimientos.», con «Borrar» (relleno
  `--alert-strong`) y «Cancelar». Al confirmar: vuelve a Organizar, el elemento ya no está y el `Toaster` dice
  «Categoría borrada».
- **Steps (bloqueado):** no hay confirmación. Bajo la acción aparece el motivo, en `--alert-strong` con ícono, y qué
  hacer:
  - Tiene elementos dentro: «No se puede borrar: tiene categorías dentro. Muévelas o bórralas primero.»
  - Tiene valores: «No se puede borrar: tiene valores presupuestados, ejecutados o saldo. Vacíala primero.»
  - Tiene operaciones: «No se puede borrar: hay movimientos entre alcancías que quedarían rotos. Corrígelos primero.»
- **Exit:** «Cancelar» cierra la confirmación; el elemento sigue.
- **Error path:** si entre abrir la confirmación y confirmar el elemento pasó a estar bloqueado (cambio desde otro
  dispositivo), no se borra y se muestra el motivo. El motivo sale siempre de `deleteBlockReason`, igual que en
  escritorio (NFR-3204).

### F7 — Mover a… (FR-3206)
- **Entry:** «Mover a…» en F2.
- **Steps:** se abre **Mover “Restaurantes”**, con la ruta actual debajo («Está en Gasto · Comida»). La lista de
  destinos, solo del mismo tipo:
  1. Primera fila, separada: «Convertir en grupo de Gastos» (no aparece si ya es un grupo).
  2. Luego el árbol de grupos y categorías del tipo, con la misma sangría que Organizar. No se listan el propio
     elemento ni sus descendientes. Las subcategorías no se listan: nada puede colgar de ellas.
  3. El padre actual aparece deshabilitado con la marca «Aquí está».
  4. Un destino donde el elemento **no cabe** (algún descendiente caería por debajo de subcategoría) aparece
     deshabilitado con el texto de escritorio debajo: «Vacía o mueve las subcategorías primero».

  Cada destino válido dice a la derecha en qué se convierte el elemento: «como categoría» o «como subcategoría».
  Tocar un destino válido aplica el movimiento, vuelve a la pantalla del elemento (con la ruta nueva) y el `Toaster`
  dice «Movido a Ocio». La validez de cada destino sale de ensayar `moveNode` del dominio, sin una segunda lista de
  reglas.
- **Exit:** «‹» no mueve nada.
- **Error path:** sin ningún destino válido, la lista muestra los bloqueados con su motivo y el texto «No hay otro
  lugar donde quepa». Si el movimiento se rechaza al aplicarlo (estado cambiado desde otro dispositivo), nada cambia
  y se muestra el motivo bajo ese destino.

### F8 — Cerrar el mes (FR-3207)
- **Entry:** botón «Cierre» en la línea del título de Presupuesto, o el enlace del aviso de periodo cerrado (F9).
- **Steps:** se abre **Cierre de mes**. Primer bloque, «Cerrar»:
  - **Hay mes cerrable:** el nombre del periodo como título del bloque («Septiembre 2026», con el rango del ciclo
    debajo cuando aplica: «21 ago – 20 sep»), una línea «Es el mes abierto más antiguo» y el botón «Cerrar
    septiembre» (principal, 48 px, con candado).
  - Al tocarlo, el bloque pasa a confirmación: «¿Cerrar septiembre 2026? Sus cifras quedarán fijas. Podrás
    reabrirlo mientras sea el último mes cerrado.», con «Sí, cerrar» y «Cancelar».
  - Al confirmar: el botón queda deshabilitado con «Cerrando…» hasta que el servidor responde; luego el bloque pasa
    al mes siguiente (o a «No hay ningún mes por cerrar») y el `Toaster` dice «Septiembre cerrado».
  - **Bloqueado** (celdas descuadradas): el botón está deshabilitado y debajo se lee el motivo **completo**, en
    varias líneas si hace falta, en `--alert-strong` con ícono. No se trunca (a diferencia de escritorio, donde va en
    una línea con el texto completo en `title`; el teléfono no tiene `title`).
  - **Nada que cerrar:** «No hay ningún mes por cerrar.» en `--fg-muted`, sin botón.
- **Exit:** «‹» o «Cancelar».
- **Error path:** el servidor rechaza o no responde → el bloque vuelve a su estado anterior y muestra «No se pudo
  cerrar. Revisa la conexión e inténtalo de nuevo.» en `--alert-strong`; ningún mes queda cerrado. Un segundo toque
  mientras dice «Cerrando…» no hace nada.

### F9 — Reabrir el último mes cerrado, y el aviso de periodo cerrado (FR-3208, FR-3209)
- **Entry:** segundo bloque de **Cierre de mes**, «Reabrir». También el enlace del aviso de periodo cerrado.
- **Steps:**
  - **Hay mes reabrible:** «Último mes cerrado: Septiembre 2026» y el botón «Reabrir septiembre» (secundario, con
    candado abierto). Al tocarlo: «¿Reabrir septiembre 2026? Volverá a admitir cambios. Mientras esté reabierto no
    podrás reabrir otro.», con «Sí, reabrir» y «Cancelar». Al confirmar: «Reabriendo…», luego el `Toaster` dice
    «Septiembre reabierto».
  - **Hay un mes reabierto:** «Septiembre 2026 está reabierto. Ciérralo de nuevo antes de reabrir otro.», sin botón.
  - **Nada cerrado:** «Aún no has cerrado ningún mes.», sin botón.
  - **Aviso de periodo cerrado (cambia el copy de `presupuesto-movil` F9):** en un periodo cerrado, bajo la barra de
    periodo, el aviso dice «Septiembre 2026 está cerrado. Puedes mirarlo; para cambiarlo, reábrelo.» y, si ese
    periodo es el reabrible, termina con el enlace «Ir a Cierre de mes ›». Si no lo es: «Agosto 2026 está cerrado.
    Solo se puede reabrir el último mes cerrado (Septiembre 2026).», sin enlace. En ningún caso menciona el
    computador ni escritorio.
- **Exit:** «‹» o «Cancelar».
- **Error path:** el servidor rechaza → «No se pudo reabrir. Revisa la conexión e inténtalo de nuevo.» y el periodo
  sigue cerrado. Al reabrir desde el enlace del aviso y volver, las acciones de edición del periodo ya están (sin
  recargar).

### F10 — Guardado y sincronización (FR-3211)
- **Entry:** cualquier cambio de F3 a F9.
- **Steps:** los cambios de estructura son optimistas, como en escritorio: se ven al instante y se guardan por el
  guardado del libro vigente. El cierre y la reapertura esperan al servidor (por eso tienen «Cerrando…»).
- **Exit:** n/a.
- **Error path:** el guardado falla → el `StorageBanner` vigente lo avisa en la lista del periodo y en las pantallas
  nuevas; al recargar, el libro es el del servidor.

## Component Inventory

Estados por componente: **default · loading · error · empty · disabled**. Como en `presupuesto-movil`, la hidratación
termina antes de montar el shell, así que no hay carga inicial dentro de estas pantallas. «Loading» aplica al cierre
y a la reapertura (esperan al servidor); las mutaciones de estructura son optimistas. Los errores de persistencia los
avisa el `StorageBanner` vigente. Se **reusan** `DetailHeader`, `ui/button`, `ui/input`, `NodeIcon`, el catálogo de
`IconPicker`, `Toaster`, `StorageBanner` y el bloque de confirmación de «Borrar movimiento».

### Pantalla: Presupuesto (lista del periodo) — cambios — FR-3201, FR-3209
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Botones «Organizar» y «Cierre»** (nuevo) | default · loading (n/a) · error (n/a) · empty (n/a) · disabled (n/a: siempre disponibles) | En la línea del `h1` «Presupuesto», alineados a la derecha. `ui/button` variante `ghost`, alto `--control-md` (40 px), ícono de 16 px (`ListTree` y `Lock`) + rótulo `.label`. Abren F1 y F8 apilando una entrada en el historial. A 360 px caben con el título (título ≈110 px, botones ≈96 y ≈78 px, de 320 disponibles) | H6, H7 |
| Aviso de periodo cerrado (cambia el copy) | default (oculto) · visible (cerrado, reabrible: con enlace) · visible (cerrado, no reabrible: sin enlace) · resto n/a | La misma franja `--bg-sunken` con `Lock`. Copy nuevo en F9. El enlace «Ir a Cierre de mes ›» es `.caption` 600 subrayado, con área táctil de 40 px de alto | H1, H9 |
| Texto de sección vacía (cambia el copy) | default (oculto) · empty (visible) · resto n/a | «Aún no hay categorías.» + enlace «Crear la primera ›» que abre F1. Sustituye a «Se crean desde el computador» | H9, H10 |

### Pantalla: Organizar categorías — FR-3201, FR-3210
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| `DetailHeader` | default · resto n/a | Vigente. Título «Organizar categorías», contexto «Crea, renombra, mueve o borra» | H4, H6 |
| Encabezado de sección con «＋ Grupo» (nuevo uso) | default · empty (sección sin grupos: «Aún no hay grupos») · loading (n/a) · error (n/a) · disabled (n/a) | Eyebrow con el ícono y el nombre del tipo, como en la lista. A la derecha, botón `ghost` «＋ Grupo» de 40 px de alto. Margen superior 20 px | H4, H6 |
| **Tarjeta de grupo de Organizar** (variante de la tarjeta de grupo vigente) | default · empty (grupo sin hijos: solo su fila) · loading (n/a) · error (n/a) · disabled (n/a) | Misma card (`--bg-card`, hairline, `.elevated-sm`, `--radius-lg`, padding horizontal 14 px, 10 px entre tarjetas). Dentro, la fila del grupo y TODAS las de su árbol, sin plegar | H4, H8 |
| **Fila de elemento** (nuevo) | default · empty (n/a) · loading (n/a) · error (n/a) · disabled (n/a) | Botón a todo el ancho, alto `--control-lg` (48 px), hairline inferior. `NodeIcon` de 18 px en `--fg-secondary` (16 px de hueco si el elemento no tiene ícono, para alinear nombres), nombre (grupo: 14 px / 600; hijos `.label` 13 px / 500, sangría de 14 px por nivel) truncado con «…», y chevron «›» de 14 px en `--fg-muted`. `aria-label` «Gestionar <nombre>». Abre F2 | H4, H6 |

### Pantalla: Elemento — FR-3201, FR-3203, FR-3204, FR-3205
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| `DetailHeader` | default · resto n/a | Título = nombre del elemento (se actualiza al renombrar). Contexto = ruta: «Gasto · Comida» | H1, H6 |
| **Tarjeta de identidad** (nuevo) | default (lectura) · editing (renombrando) · disabled («Guardar» apagado: sin cambio o vacío) · loading (n/a) · error (n/a) · empty (n/a: siempre hay nombre) | Card `--bg-card`, `--radius-md`, padding 12 px. Lectura: botón de ícono de 40×40 px (`--bg-sunken`, `--radius-sm`; abre F5) y el nombre en `.title-sm`, hasta dos líneas. Edición: `ui/input` de 48 px con rótulo «Nombre» encima y el texto seleccionado; debajo «Guardar» (principal) y «Cancelar» (`ghost`), ambos de 48 px | H3, H5, H6 |
| **Lista de acciones** (nuevo) | default · disabled (n/a: una acción que no aplica no se pinta) · resto n/a | Card `--bg-card`, `--radius-md`. Una fila de 48 px por acción, con ícono de 16 px (`Pencil`, `Smile`, `Plus`, `FolderInput`) y rótulo `.label`, hairline entre filas. «Borrar» va en una card aparte, 12 px más abajo, con `Trash2` y texto en `--alert-strong` | H4, H6, H8 |
| **Selector de ícono** (reúso del catálogo de `IconPicker`, presentación nueva) | default (cerrado) · open · empty («Ningún ícono coincide con “…”») · loading (n/a: íconos empaquetados) · error (n/a) · disabled (n/a) | Se despliega dentro de la pantalla, no en popover (a 375 px un popover de 6 columnas no cabe con margen). `ui/input` «Buscar ícono» de 48 px; cuadrícula de celdas 48×48 px con ícono de 20 px, 6 por fila a 375 px y 5 a 360 px; el actual con borde `--fg` de 1,5 px. Botón «Cerrar» `ghost` al final | H3, H6, H7 |
| **Confirmación de borrado** (reúso del patrón de «Borrar movimiento») | default (oculta) · visible · resto n/a | Bloque `role="alertdialog"` en la misma pantalla: borde `--border-strong`, `--bg-card`, `--radius-md`, padding 12 px. Pregunta en `.label`; «Cancelar» (`ghost`) y «Borrar» (relleno `--alert-strong`, texto `--primary-foreground` del tema claro), ambos de 48 px | H3, H4, H5 |
| **Motivo de bloqueo** (nuevo) | default (oculto) · visible · resto n/a | `role="alert"`, `.caption` en `--alert-strong` con `TriangleAlert` de 13 px, bajo la acción «Borrar». Tres textos, en F6. No se cierra solo | H1, H9 |

### Pantalla: Nuevo grupo / categoría / subcategoría — FR-3202
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| `DetailHeader` | default · resto n/a | Título «Nuevo grupo», «Nueva categoría» o «Nueva subcategoría». Contexto «en Gastos» / «en Comida» | H1, H6 |
| Campo «Nombre» | default (vacío, con foco) · filled · error (n/a: se previene) · disabled (n/a) · loading (n/a) · empty = default | `ui/input` de 48 px, rótulo «Nombre» encima (`.eyebrow`), `maxLength` el del dominio, `enterKeyHint="done"`; Enter equivale a «Crear» | H5, H6 |
| Aviso de traslado de montos | default (oculto) · visible (el padre es hoja con montos) · resto n/a | `.caption` en `--alert-soft` con `Info` de 13 px: «Los montos de <padre> pasarán a esta <categoría/subcategoría>» | H1, H5 |
| Botón «Crear» | default · disabled (nombre vacío o solo espacios) · loading (n/a: optimista) · error (n/a) · empty (n/a) | `ui/button` principal, 48 px, a todo el ancho. Debajo, «Cancelar» `ghost` | H5, H7 |

### Pantalla: Mover a… — FR-3206
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| `DetailHeader` | default · resto n/a | Título «Mover “<nombre>”» (truncado). Contexto «Está en Gasto · Comida» | H1, H6 |
| Fila «Convertir en grupo» | default · disabled (n/a: si ya es grupo no se pinta) · resto n/a | Card propia arriba, 48 px, ícono `FolderUp`, texto «Convertir en grupo de Gastos» | H6 |
| **Fila de destino** (nuevo) | default (válido) · disabled-current («Aquí está») · disabled-blocked (no cabe, con motivo) · empty (lista sin válidos: «No hay otro lugar donde quepa») · loading (n/a) · error (rechazo al aplicar: motivo bajo la fila) | Misma anatomía que la fila de elemento: ícono, nombre con sangría, y a la derecha en `.caption` `--fg-muted` el resultado («como categoría» / «como subcategoría»). Deshabilitada: nombre en `--fg-muted`, sin chevron, `aria-disabled`. Bloqueada: segunda línea «Vacía o mueve las subcategorías primero» en `.caption` `--alert-soft`, alto 60 px | H1, H5, H9 |

### Pantalla: Cierre de mes — FR-3207, FR-3208
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| `DetailHeader` | default · resto n/a | Título «Cierre de mes». Contexto «Cerrar congela las cifras del mes» | H10 |
| **Bloque «Cerrar»** (nuevo) | default (hay cerrable) · confirming · loading («Cerrando…») · error («No se pudo cerrar…») · empty («No hay ningún mes por cerrar.») · disabled (bloqueado, con motivo completo) | Card `--bg-card`, `--radius-md`, padding 16 px. Eyebrow «CERRAR»; periodo en `.title-sm`; rango del ciclo en `.caption` `--fg-muted`; botón principal de 48 px a todo el ancho con `Lock`. En confirmación, el botón se sustituye por la pregunta y «Sí, cerrar» / «Cancelar». Motivo de bloqueo: `.caption` `--alert-strong`, sin truncar | H1, H3, H5, H9 |
| **Bloque «Reabrir»** (nuevo) | default (hay reabrible) · confirming · loading («Reabriendo…») · error («No se pudo reabrir…») · empty («Aún no has cerrado ningún mes.») · disabled (hay un mes reabierto: texto, sin botón) | Misma card, 12 px debajo. Eyebrow «REABRIR»; «Último mes cerrado: Septiembre 2026» en `.label`; botón **secundario** (borde `--border-strong`, fondo `--bg-card`) de 48 px con `LockOpen`: reabrir es la acción menos frecuente y no compite con cerrar | H1, H3, H5 |
| `Toaster` | default (oculto) · visible · resto n/a | Vigente. Avisos nuevos: «Grupo creado», «Categoría creada», «Subcategoría creada», «Nombre actualizado», «Categoría borrada», «Movido a <destino>», «<Mes> cerrado», «<Mes> reabierto» | H1 |
| `StorageBanner` | default (oculto) · error (visible) · resto n/a | Vigente, sin cambios; se monta también en las pantallas nuevas | H1, H9 |

## Nielsen Compliance

### Organizar, Elemento, Nuevo y Mover a…
- **H1 Estado visible:** cada cambio se ve al instante (optimista) y lo confirma el `Toaster`; la pantalla del
  elemento muestra siempre su ruta, que cambia tras mover.
- **H2 Lenguaje del usuario:** «grupo», «categoría», «subcategoría», «convertir en grupo», «vacíala primero». Ningún
  término interno (`has_data`, `would_overflow`, «nodo»).
- **H3 Control y libertad:** «‹» y «Cancelar» en todas; borrar pide confirmación; crear y renombrar no guardan nada
  hasta confirmar.
- **H4 Consistencia:** mismo encabezado, mismas tarjetas, misma confirmación que «Borrar movimiento», mismos textos
  de bloqueo que escritorio donde escritorio tiene texto.
- **H5 Prevención:** «Crear» y «Guardar» apagados con nombre vacío; los destinos inválidos de «Mover a…» no se pueden
  tocar; el aviso de traslado de montos avisa antes de crear.
- **H6 Reconocer, no recordar:** todas las acciones con rótulo; no hay menú de tres puntos ni gestos.
- **H7 Eficiencia:** dos toques de la lista a un elemento (Organizar → fila); crear un grupo, tres.
- **H8 Minimalismo:** Organizar no muestra cifras; la lista del periodo no muestra acciones de estructura.
- **H9 Recuperarse de errores:** cada bloqueo dice qué pasa y qué hacer («Muévelas o bórralas primero»).
- **H10 Ayuda:** la línea de contexto de cada encabezado dice para qué es la pantalla.
- **Trade-off aceptado:** gestionar exige salir de la lista del periodo (un toque más) a cambio de no apretar las
  cifras ni tocar las filas de la primera entrega.

### Cierre de mes y aviso de periodo cerrado
- **H1:** cada bloque dice siempre su estado, también cuando no hay nada que hacer; «Cerrando…» mientras espera.
- **H3:** confirmación antes de cerrar y de reabrir; reabrir existe como salida a un cierre equivocado.
- **H5:** el botón nombra el mes; con celdas descuadradas no se deja pulsar.
- **H9:** el motivo de bloqueo se lee completo; el error de red dice qué hacer.
- **H4:** mismos rótulos que escritorio («Cerrar septiembre», «Reabrir septiembre», «septiembre reabierto»).
- **Trade-off aceptado:** un paso de confirmación que escritorio no tiene, por el riesgo de toque accidental
  (decisión del usuario del 6-oct-2026).

## Design Tokens

**Fuente: el estándar del producto padre, sin tokens nuevos.** Todos los valores están en `src/app/globals.css` y son
los mismos que usa `presupuesto-movil`. Esta feature no añade colores, tamaños ni sombras; las únicas medidas nuevas
son de maquetación y se derivan de tokens existentes, con el motivo indicado. **Desviación del estándar padre:** una
sola, justificada — el selector de íconos se presenta desplegado en la pantalla y no en el popover de escritorio,
porque a 375 px un popover con margen no deja celdas de 40 px; el catálogo y la búsqueda son los mismos.

### Color roles
| Rol | Claro | Oscuro | Uso en esta feature (motivo) |
|---|---|---|---|
| background `--bg` | `#f7f7f8` | `#131316` | Lienzo de las pantallas nuevas, igual que el resto del teléfono |
| surface `--bg-card` | `#ffffff` | `#1b1b1f` | Tarjetas de grupo, identidad, acciones, destinos y bloques de cierre |
| sunken `--bg-sunken` | `#f1f1f3` | `#0f0f12` | Fondo del botón de ícono y aviso de periodo cerrado |
| primary `--primary` | `#1c1c1f` | `#f4f4f5` | Botones principales: «Crear», «Guardar», «Cerrar septiembre», «Sí, cerrar» |
| on-primary `--primary-foreground` | `#ffffff` | `#1c1c1f` | Texto de los botones principales (17:1 claro, 15:1 oscuro) |
| accent `--accent-light` | `#55555d` | `#9b9ba3` | Anillo de foco (`:focus-visible`) |
| text-primary `--fg` | `#1c1c1f` | `#f4f4f5` | Nombres, rótulos de acción, borde del ícono elegido |
| text-secondary `--fg-secondary` | `#55555d` | `#b4b4bb` | Íconos de fila, texto de avisos y confirmaciones |
| text-muted `--fg-muted` | `#6b6b73` | `#9b9ba3` | Eyebrows, chevrons, ruta, «como categoría», destinos deshabilitados, estados vacíos |
| border `--border` | `#e3e3e7` | `#33333a` | Hairline de filas y tarjetas |
| border-strong `--border-strong` | `#d3d3d9` | `#43434c` | Borde de la confirmación y del botón secundario «Reabrir» |
| error `--alert-strong` | `#ad3932` | `#ec6a66` | «Borrar», motivos de bloqueo, errores de cierre |
| alert-soft `--alert-soft` | `#9e4708` | `#e0a458` | Aviso de traslado de montos y «Vacía o mueve las subcategorías primero» |

Contraste (verificado en `globals.css`, igual que en `presupuesto-movil`): `--fg` sobre `--bg` 16,4:1 en claro;
`--fg-muted` ≥4,68:1 en las tres superficies claras y 6,8:1 en oscuro; `--alert-strong` 4,85:1 y `--alert-soft`
4,92:1 en claro, ≥5,2:1 en oscuro. Todos los roles de texto quedan en ≥4,5:1 (FR-3210). Un destino deshabilitado usa
`--fg-muted`, que cumple 4,5:1: deshabilitado no significa ilegible, porque su motivo hay que poder leerlo.

### Type scale (font family rationale)
- **Inter** (`--font-sans`) para todo el texto de esta feature. **DM Mono** no interviene: estas pantallas no
  muestran montos.
- Roles de `globals.css`, sin tamaños nuevos:
  - `.title-sm` 17 px / 600: títulos de encabezado, nombre en la tarjeta de identidad, periodo en el bloque de cierre.
  - 14 px / 600: nombre de grupo en filas (el mismo de la lista del periodo).
  - `.label` 13 px / 500: nombres de categoría y subcategoría, rótulos de acción y de botón, preguntas de confirmación.
  - `.caption` 12 px / 400: ruta, resultado del destino, motivos y avisos.
  - `.eyebrow` 11 px / 600, mayúsculas: secciones, «CERRAR», «REABRIR», rótulo «Nombre».
- Pesos: 400, 500 y 600.

### Spacing scale
- Base 4 px (`--spacing-1..6`: 4, 8, 12, 16, 20, 24). Margen lateral de 20 px (`px-5`), como el resto del teléfono.
- Radios: `--radius-lg` (14 px) en tarjetas de grupo; `--radius-md` (10 px) en identidad, acciones, destinos,
  confirmación y bloques de cierre; `--radius-sm` (8 px) en campos, botones y celdas de ícono.
- Alturas táctiles (FR-3210, mínimo 40 px): `--control-md` 40 px para «Organizar», «Cierre», «＋ Grupo» y el botón de
  ícono; `--control-lg` 48 px para filas de elemento, de acción y de destino, campos y botones de formulario. Fila de
  destino bloqueado: 60 px (dos líneas).
- Sangría por nivel: 14 px, la misma de la lista del periodo.
- Celdas de ícono: 48×48 px con 4 px de separación → 6 columnas = 308 px, que caben en 335 px (375 − 40); a 360 px,
  5 columnas = 256 px con holgura. Se calcula por ancho disponible, no por punto de corte.
- Entre tarjetas 10 px; entre secciones 20 px; entre bloques de una pantalla 12 px.
- Motion: `mvScreenIn` al entrar a una pantalla (vigente). Sin animación nueva. `prefers-reduced-motion` la anula.

### Responsive
- **360 a 760 px (móvil):** todas las pantallas de esta feature. Sin desborde horizontal; los nombres largos se
  truncan en filas y parten en dos líneas en la tarjeta de identidad; los textos que caben justos dejan al menos
  4 px de holgura (Linux mide el texto unos 3 px más ancho que macOS).
- **375 px:** ancho de diseño.
- **768 px y 1440 px:** la app de escritorio, sin cambios. Estas pantallas no existen ahí; un enlace directo a una
  de ellas en escritorio muestra la app de escritorio normal.
- **Límite:** 760 px es móvil y 761 px es escritorio (NFR-3207).
