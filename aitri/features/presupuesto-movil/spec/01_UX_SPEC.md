# UX / Design Spec

Feature **presupuesto-movil** (BL-056, primera entrega). Lleva al teléfono lo que se hace cada mes en escritorio:
leer el periodo, cambiar lo planeado, corregir movimientos, operar alcancías y ver el Balance. Construye DENTRO del
sistema de diseño vigente del producto: tokens de `src/app/globals.css` (temas claro/oscuro de `stack-upgrade-theme`,
roles canónicos de `refinamiento-ui` FR-1201, superficies de `ux-consistency` FR-301, alturas de `control-size-scale`
FR-801), Inter para texto y DM Mono para montos. No hay mockups del cliente para el móvil; esta vista se diseña
sobre lo que ya existe y el usuario la aprueba con la composición ilustrativa de `UX_PREVIEW.html`.

**Archetype: CLINICAL/TRUST** — reason: finanzas personales, donde cada cifra tiene que leerse sin ambigüedad. Sus
defaults (tema claro único, paleta slate) quedan **superados por el estándar del producto padre**: temas claro y
oscuro, paleta zinc, Inter + DM Mono. Del arquetipo se conservan el contraste ≥4.5:1 y la ausencia de animación
decorativa.

**Medio:** web responsive. Esta vista existe solo en el shell móvil (≤760 px). Se diseña a 375 px y es fluida entre
360 y 760 px. A 768 px y 1440 px la app es la de escritorio, sin cambios (FR-3113, NFR-3103).

**Es una app WEB, no nativa** (decisión del usuario al revisar las maquetas, 2-oct-2026: «tener en cuenta que es
app web, no app nativa»). Esto fija tres reglas de diseño:
- La navegación va arriba, en el encabezado, con el mismo control segmentado que escritorio («Resumen | Dashboard»).
  No hay barra inferior de app nativa, porque además chocaría con la barra del navegador, que en Safari para iPhone va
  abajo.
- Cada pantalla de detalle es una entrada del historial del navegador: el «atrás» del navegador y el gesto de volver
  funcionan. La flecha «‹» de la página hace lo mismo.
- Las páginas se desplazan con scroll vertical normal, dentro del contenedor de contenido que el shell móvil ya
  tiene, sin gestos ocultos (nada depende de deslizar). Lo único fijo es la barra de periodo, con
  `position: sticky`. Al volver de un detalle, la lista recupera la posición de scroll que tenía. La única acción de
  «mantener presionado» es la del ojo del resumen, que el usuario pidió y que tiene un control visible (FR-3115).

**Estilo aprobado por el usuario** (3-oct-2026). Tras rechazar la primera versión («el diseño es bastante horrible»),
el usuario comparó tres estilos de la pantalla del mes —A limpio, B tarjetas, C extracto— con cifras de hasta 9
dígitos y eligió **la mezcla de A y B** («aprobado»):
- Del B: una tarjeta de resumen oscura arriba (relleno `--primary`), con el saldo disponible como cifra principal.
- Del A: filas limpias. Cada fila muestra el nombre, lo ejecutado a la derecha, una **barra de avance** fina debajo y
  el texto «de <presupuestado>».
- Cada grupo va en una tarjeta suave (`--bg-card` con hairline), y al abrirlo sus categorías aparecen dentro de la
  misma tarjeta.
- La tarjeta de resumen es **pequeña, plegable y con los valores protegidos**: abre plegada y muestra «$ ••••••»
  hasta que se mantiene presionado el ojo (FR-3115).

La barra de avance es un elemento nuevo respecto a escritorio. No añade un cálculo: pinta la razón
ejecutado/presupuestado que ya decide el color de estado, con los mismos tonos.

**Directriz del usuario sobre el formulario de edición** («tener en cuenta si aprovechamos o modificamos el módulo
de registrar movimientos»). **Decisión: se REUSA el formulario de registro móvil**, abierto en modo edición y con los
datos del movimiento cargados. Motivo: ya está hecho para el dedo (monto héroe, categorías en fichas, fecha y nota
apiladas, botón a todo el ancho) y el usuario ya lo conoce. Editar con la misma pantalla con la que se anota cumple
H4. El editor de escritorio (`MovementEditor`) es una fila compacta pensada para teclado y popover, y a 375 px
obligaría a rediseñarlo entero. Del editor de escritorio se reusa la LÓGICA: el ensayo en el dominio
(`editMovement`/`deleteMovement` en modo de prueba) habilita «Guardar cambios», y el aviso «Pasará a …» sale de ahí.
El modo de registrar no cambia (NFR-3101).

Preview: `UX_PREVIEW.html` — se abre en un navegador. Trae los tokens en claro y oscuro, el contraste y una tira
ilustrativa con las pantallas del teléfono.

## User Flows

Persona única: **dueño del libro en el teléfono** (Phase 1). Entrada común: app abierta a ≤760 px, sesión válida.
El control segmentado del encabezado, siempre visible, es la salida a la otra vista. En cada pantalla de detalle, la
flecha «‹» del encabezado vuelve a la anterior.

### F1 — Pasar entre Registrar y Presupuesto (FR-3101, FR-3113)
- **Entry:** la app abre en **Registrar**, como hoy.
- **Steps:** en el encabezado, el control segmentado **Registrar | Presupuesto**, con el mismo componente y estilo
  que «Resumen | Dashboard» de escritorio. Tocar **Presupuesto** cambia la vista sin recargar y abre en el periodo
  actual. Tocar **Registrar** vuelve al formulario, que conserva lo escrito. Volver a **Presupuesto** encuentra el
  mismo periodo y las mismas tarjetas desplegadas.
- **Exit:** el otro segmento. Desde una pantalla de detalle, el «atrás» del navegador o la flecha «‹» vuelven a la
  pantalla anterior.
- **Error path:** no hay escritura. Si un guardado anterior no se confirmó en el servidor, el `StorageBanner`
  vigente aparece bajo el encabezado en las dos vistas. Si el usuario llega a una pantalla de detalle por el
  historial y esa hoja ya no existe (se borró en otro dispositivo), la app vuelve a la lista del periodo.

### F2 — Elegir el periodo (FR-3102)
- **Entry:** barra de periodo, arriba de la vista Presupuesto: `‹  Octubre 2026 · 21 sep – 20 oct ▾  ›`. En modo
  mes el rótulo es solo «Octubre 2026».
- **Steps:** «‹» y «›» van al periodo anterior y al siguiente. Tocar el rótulo abre la lista de todos los periodos
  activos, la misma que el selector de escritorio, con un candado en los cerrados.
- **Exit:** al elegir, la lista se cierra y la vista muestra ese periodo.
- **Error path:** en el primer periodo «‹» está deshabilitado, y en el último lo está «›» (H5). No hay estado de
  error: la lista sale del calendario ya cargado.

### F3 — Leer el presupuesto del periodo (FR-3103, FR-3104)
- **Entry:** vista Presupuesto.
- **Steps:** de arriba abajo:
  1. Barra de periodo, fija al hacer scroll.
  2. Si el periodo está cerrado, el aviso de periodo cerrado (F9).
  3. La **tarjeta de resumen** de saldos, plegada y con los valores protegidos (F10).
  4. Tres secciones: **INGRESOS**, **GASTOS** y **RESERVAS**. Cada una tiene un encabezado con su nombre a la
     izquierda y su total a la derecha, en pequeño: «123.288.000 de 154.110.000» (ejecutado de presupuestado).
  - Debajo de cada encabezado va una **tarjeta por grupo**. Plegada, la tarjeta es una sola fila: nombre, lo
    ejecutado a la derecha con su tono y glifo, chevron, la barra de avance debajo y «de <presupuestado>».
  - Tocar la fila del grupo despliega la tarjeta: debajo, dentro de la misma tarjeta y con sangría, aparecen sus
    categorías y subcategorías con la misma anatomía de fila, en letra un escalón menor. Las categorías con
    subcategorías tienen su propio chevron de plegar. Las tarjetas empiezan plegadas y el estado se conserva mientras
    la app está abierta.
  - Una fila hoja termina en un chevron › y abre su pantalla. Un grupo sin hijos (hoja, `promote-to-group` FR-603)
    es una tarjeta de una fila con › que abre F4.
  - Lo ejecutado lleva el tono y el glifo de escritorio (`cellTone`/`cellGlyph`): gasto dentro del plan en neutro,
    › y `--alert-soft` si supera el plan, ›› y `--alert-strong` desde 1,2×; ingreso en `--favorable` o ‹ y
    `--alert-soft`; reserva neutra. La barra de avance usa el mismo tono y se llena hasta el 100 % como máximo. Una
    cifra vacía es «—» atenuado y su barra queda vacía.
  - En RESERVAS, cada alcancía es su propia tarjeta de una fila, con lo aportado en el periodo (no el saldo). Al
    final va la tarjeta **Retiros del mes**, sin barra: muestra los retiros reales y «Plan <retiros planeados>».
- **Exit:** tocar una fila hoja abre F4 si es gasto o ingreso, o F6 si es alcancía. La tarjeta «Retiros del mes»
  abre F7.
- **Error path:** sin escritura. Un periodo sin datos muestra las tarjetas con «—» y barras vacías (no en blanco).

### F4 — Ver una categoría y cambiar lo planeado (FR-3105, FR-3106)
- **Entry:** tocar una hoja de gasto o ingreso en F3.
- **Steps:** se abre la pantalla **Categoría**. Encabezado: «‹», nombre de la hoja y su ruta en una línea
  («Gastos · Vivienda»), periodo. Debajo van dos tarjetas lado a lado:
  - **Presupuestado**, con la cifra y el botón «Cambiar».
  - **Ejecutado**, con la cifra y su tono de estado.

  Al tocar «Cambiar», la tarjeta pasa a un campo de monto (teclado numérico, `inputmode="numeric"`) con «Guardar» y
  «Cancelar». Al guardar se aplica con la misma acción que la grilla (`setLeafAmount`) y la cifra nueva sube por
  los padres.

  Debajo va la lista **Movimientos**, en el orden del Detalle de escritorio (`cellDetail`). Cada fila muestra:
  - el día («5 oct»)
  - la nota, o «Sin nota» atenuado
  - el monto en DM Mono
  - un botón lápiz de 40 px, que lleva a F5

  Los ajustes llevan su ícono de ajuste. Los comentarios existentes van al final, solo de lectura.
- **Exit:** «‹» vuelve a la lista con el scroll donde estaba.
- **Error path:**
  - Monto vacío, con letras o negativo: «Guardar» deshabilitado y un texto bajo el campo, «Escribe un monto en pesos,
    sin signo».
  - Sin movimientos: «Sin movimientos en Octubre. Los gastos se anotan desde Registrar», con un botón «Ir a
    Registrar».

### F5 — Editar o borrar un movimiento (FR-3107, FR-3108)
- **Entry:** el lápiz de una fila en F4.
- **Steps:** se abre **Editar movimiento**. Es el formulario de Registrar con estos cambios:
  - Título «Editar movimiento» con «‹».
  - **Sin** el selector de tipo: el tipo no cambia, así que se muestra solo como etiqueta «Gasto» o «Ingreso» con su
    color.
  - El monto, la categoría (solo fichas del mismo tipo), la fecha y la nota vienen cargados.
  - El botón principal dice «Guardar cambios». Se habilita solo si algo cambió y el ensayo del dominio lo acepta.
  - Abajo va un botón secundario de peligro, «Borrar movimiento».

  Si la fecha nueva cae en otro periodo, bajo la fecha aparece «Pasará a Noviembre 2026» (`--alert-soft` con ícono).

  Al guardar: vuelve a F4 y un aviso del `Toaster` dice «Movimiento actualizado». Las cifras ya incluyen el cambio.
  Poner el monto en 0 cambia el botón a «Borrar movimiento» (misma regla que escritorio: 0 elimina).

  «Borrar movimiento» abre una confirmación en la misma pantalla: «¿Borrar este gasto de $200 del 12 oct?», con
  «Borrar» (relleno `--alert-strong`) y «Cancelar». Al confirmar vuelve a F4 con el aviso «Movimiento borrado».
- **Exit:** «‹» o «Cancelar» descartan los cambios sin preguntar. No hay guardado parcial.
- **Error path:**
  - Monto con letras: «Guardar cambios» deshabilitado y el texto vigente del registro bajo el monto.
  - Una regla de dominio rechaza: el motivo aparece bajo el botón con los textos de escritorio y en
    `--alert-strong`. Los campos conservan lo escrito.
  - El servidor rechaza (p. ej. 422 de periodo cerrado, porque otro dispositivo lo cerró mientras tanto): la cifra
    vuelve al valor del servidor y el `StorageBanner` lo avisa. El formulario se cierra porque el periodo ya está
    cerrado (F9).
  - Un ajuste (kind `adjustment`) admite monto con signo, como en escritorio. El campo acepta «−» delante y el
    indicador de signo lo refleja.

### F6 — Cambiar lo aportado a una alcancía (FR-3109)
- **Entry:** tocar una alcancía en RESERVAS.
- **Steps:** se abre la pantalla **Alcancía**, con la misma anatomía que F4: tarjetas **Pres.** y **Ejec.** del
  aporte del periodo, cada una con «Cambiar». Al guardar se aplica con la acción del editor de escritorio
  (`applyReserveEdit`) en ese plano. Debajo va la lista de aportes del periodo, solo de lectura y sin lápiz (BG-084).
- **Exit:** «‹».
- **Error path:** si la regla rechaza (techo, piso o déficit), bajo el campo aparece la franja de bloqueo con el
  texto de escritorio (`blockMessage`), por ejemplo «Esta celda admite hasta $1.200 este mes». La cifra no
  cambia y el campo conserva lo escrito.

### F7 — Ver, corregir y borrar los retiros del mes (FR-3110)
- **Entry:** tocar la tarjeta «Retiros del mes».
- **Steps:** se abre la pantalla **Retiros del mes**, con la misma anatomía que F4:
  - Dos tarjetas: **Pres.** (retiros planeados, solo lectura) y **Ejec.** (retiros reales). La cifra de Ejec. lleva
    el tono y el glifo de escritorio para esta fila: sacar más de lo planeado se gradúa como un sobre-consumo.
  - Debajo, la lista «Operaciones de este mes», la misma de escritorio. Cada fila muestra de dónde a dónde
    («Viaje → Disponible»; un movimiento entre alcancías se ve «Viaje → Carro» y no suma a la cifra de retiros), la
    nota, el monto, el lápiz y la papelera.

  Al corregir, el monto se edita en la misma fila, con «Guardar» y «Cancelar». Poner 0 elimina la operación. La
  papelera pide la confirmación de F5 y hace lo mismo que poner 0. Es la misma acción de escritorio
  (`editReserveOp`). **Sacar plata no tiene pantalla propia**: se hace desde «Registrar» → Reserva, de la alcancía a
  Disponible (decisión del usuario: «la de retiros no se necesita porque ya está el módulo de movimientos»).
- **Exit:** «‹» o el atrás del navegador.
- **Error path:**
  - Si una regla rechaza la corrección o el borrado (p. ej. dejaría un mes posterior en déficit), el mensaje de
    escritorio (`blockMessage`) aparece bajo la fila y nada cambia.
  - Sin operaciones: «Sin operaciones este mes. Para sacar de una alcancía, usa Registrar → Reserva», con un botón
    «Ir a Registrar».

### F8 — Ver el Balance del periodo (FR-3111)
- **Entry:** el enlace «Ver Balance completo ›» de la tarjeta de resumen desplegada (F10).
- **Steps:** se abre la pantalla **Balance**, con los tres bloques de escritorio en el mismo orden y con los mismos
  nombres. Cada fila lleva a la derecha la cifra real (Ejec.) y debajo, en pequeño, «Plan <cifra>», como el resumen.
  Dos columnas lado a lado no caben con cifras de 9 dígitos a 375 px. Las filas resultado («= Resultado del mes»,
  «= Saldo disponible», «= Saldo total») van en peso 600. El color sigue la regla de escritorio (`balanceColor`):
  neutro por defecto, sumandos en `--fg-secondary`, y `--alert-strong` solo cuando «Saldo disponible» o «Saldo
  total» son negativos. Un resultado en cero se pinta «0» y un sumando vacío «—», como en escritorio. Solo lectura.
- **Exit:** «‹».
- **Error path:** sin escritura. En un periodo sin datos todas las filas muestran «—», salvo el arrastre del saldo
  anterior.

### F9 — Periodo cerrado (FR-3112)
- **Entry:** elegir en F2 un periodo cerrado.
- **Steps:** bajo la barra de periodo aparece el aviso con candado: «Septiembre 2026 está cerrado. Puedes mirarlo;
  para cambiarlo, reábrelo desde el cierre de mes en el computador». En todas las pantallas de ese periodo
  desaparecen «Cambiar», los lápices y las papeleras. Las listas siguen visibles.
- **Exit:** elegir un periodo abierto devuelve las acciones.
- **Error path:** si el periodo se cierra desde otro dispositivo mientras F5 está abierto, el formulario se cierra
  con el aviso de periodo cerrado, igual que el Detalle de escritorio.

### F10 — Ver los saldos protegidos del resumen (FR-3115)
- **Entry:** la tarjeta de resumen, arriba de la lista. Abre **plegada**: eyebrow «SALDO DISPONIBLE», el valor
  oculto «$ ••••••», el ícono del ojo y la flecha de desplegar.
- **Steps:**
  - **Mantener presionado el ojo** muestra las cifras de la tarjeta mientras dura la presión. Al soltar, vuelven a
    «$ ••••••». El ojo cambia de «ojo tachado» a «ojo» y toma un fondo circular mientras está presionado.
  - **Tocar la flecha** despliega la tarjeta. Aparecen «Plan» bajo el saldo disponible y una fila de tres saldos:
    Resultado del mes, Saldo reservado y Saldo total, cada uno con lo real y su «Plan» debajo, también ocultos. Al
    final va el enlace «Ver Balance completo ›», que abre F8. Tocar la flecha otra vez la pliega.
  - Cada vez que se abre la app, la tarjeta vuelve a estar plegada y oculta.
- **Exit:** soltar el ojo, plegar la tarjeta o abrir el Balance completo.
- **Error path:**
  - Un toque corto sobre el ojo no deja nada a la vista. Bajo la tarjeta aparece durante 2 s la pista «Mantén
    presionado para ver» (H10), para quien no conoce el gesto.
  - Si el dedo sale del ojo, la pestaña pierde el foco o la app pasa a segundo plano, los valores se ocultan.
  - En iPhone, mantener presionado no debe abrir el menú del sistema ni seleccionar texto: el botón lleva
    `user-select: none`, `-webkit-touch-callout: none` y anula `contextmenu`.
  - Con teclado: mantener Espacio o Enter sobre el ojo muestra, soltar oculta. Para lectores de pantalla el botón se
    llama «Mantén presionado para ver los saldos» y la cifra oculta se anuncia como «oculto».
  - Mientras están ocultos, los dígitos no están en el DOM (se renderiza el texto «$ ••••••»), así que tampoco los
    lee un lector de pantalla ni quedan en una captura.

## Component Inventory

Estados por componente: **default · loading · error · empty · disabled**. La hidratación termina antes de montar el
shell (`AuthPending`), así que dentro de la vista no hay carga inicial. «Loading» aplica solo al guardar, y las
mutaciones son optimistas como en escritorio. Los errores de persistencia los avisa el `StorageBanner` vigente.

### Pantalla: Shell móvil (Registrar / Presupuesto) — FR-3101, FR-3113
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Encabezado | default · loading (n/a) · error (n/a) · empty (n/a) · disabled (n/a) | El que ya existe (`MobileShell`), con margen lateral de 20 px. A la izquierda el control segmentado; a la derecha Configuración, tema y Salir, sin cambios (NFR-3102). El `h1` de cada vista pasa a ser la primera línea de su contenido, en `.title-sm`: «Nuevo movimiento» en Registrar (conserva su id de prueba `page-title`) y «Presupuesto» en la otra (id propio). En las pantallas de detalle el `h1` es el nombre del detalle | H4, H6 |
| **Control segmentado Registrar \| Presupuesto** (nuevo uso de un componente existente) | default (Registrar activo) · loading (n/a) · error (n/a) · empty (n/a) · disabled (n/a) | El mismo `ui/tabs` que «Resumen \| Dashboard» en escritorio, a `--control-md` (40 px de alto). Segmento activo con borde `--fg` y fondo `--bg-card`; el inactivo en `--fg-muted`. `role="tablist"` y `aria-selected`. Sin barra inferior: es app web (ver arriba) | H4, H6, H7 |
| Historial del navegador | default · resto n/a | Abrir una pantalla de detalle añade una entrada al historial (misma página y mismo origen, sin recarga ni nueva hidratación). El «atrás» la cierra | H3, H4 |
| `StorageBanner` | default (oculto) · error (visible) · resto n/a | Vigente, sin cambios, en las dos vistas | H1, H9 |
| `Toaster` | default (oculto) · visible (aviso) · resto n/a | Vigente. Muestra «Movimiento actualizado», «Movimiento borrado» y «Retiro corregido» | H1, H3 |

### Pantalla: Presupuesto (lista del periodo) — FR-3102, FR-3103, FR-3104, FR-3114
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Barra de periodo** (nuevo) | default · disabled (‹ en el primero, › en el último) · empty (n/a: siempre hay un periodo) · loading (n/a) · error (n/a) | Botones ‹ › de 40×40 px a los lados. Al centro, el rótulo (`withRange`, `.label` 500) con ▾ que abre el `Select` vigente (`ui/select`) con los periodos activos y un candado en los cerrados. Fija arriba al hacer scroll | H1, H3, H6 |
| Aviso de periodo cerrado | default (oculto) · visible (cerrado) · resto n/a | Franja `--bg-sunken` con borde y ícono `Lock`, texto `.caption` `--fg-secondary`. Copy en F9 | H1, H9 |
| **Tarjeta de resumen de saldos** (nuevo) — FR-3115 | default (plegada, oculta) · expanded (cuatro saldos, ocultos) · revealed (ojo presionado: cifras visibles) · empty (sin datos: «—» al revelar) · loading (n/a) · error (n/a) · disabled (n/a) | Card con relleno `--primary` y texto `--primary-foreground`, radio `--radius-lg` (14 px), `.elevated-md`, padding 10 px vertical y 16 px a la izquierda. **Plegada** (alto ≈ 60 px): eyebrow «SALDO DISPONIBLE» (opacidad 70 %), valor en DM Mono a 20 px, y a la derecha dos botones de 40×40 px: ojo (`EyeOff`; `Eye` con fondo circular mientras se presiona) y flecha (`ChevronDown` / `ChevronUp`). **Desplegada**: «Plan <cifra>» en `.caption` bajo el saldo; separador; rejilla de 3 columnas con «RESULTADO DEL MES», «SALDO RESERVADO» y «SALDO TOTAL» (eyebrow de 9,5 px, cifra en DM Mono 12,5 px y «Plan <cifra>» en 10,5 px, para que quepan tres cifras de 9 dígitos a 375 px); enlace «Ver Balance completo ›». Oculto, cada cifra es el texto «$ ••••••». Sobre el relleno oscuro las cifras no llevan tono de estado (irían sin contraste); un saldo negativo se distingue por su signo «−». Valores: `available`, `flow`, `reservedBalance` y `total` de `computeBalanceSeries`, iguales a las filas de escritorio | H1, H3, H5, H8, H10 |
| Encabezado de sección (INGRESOS / GASTOS / RESERVAS) | default · empty (totales «—») · resto n/a | Una línea: eyebrow con el nombre a la izquierda; a la derecha, «123.288.000 de 154.110.000» (ejecutado de presupuestado) en DM Mono `.caption` `--fg-muted`. En INGRESOS y RESERVAS, igual. Margen superior de 20 px | H4, H8 |
| **Tarjeta de grupo** (nuevo) | default (plegada) · expanded · empty («—», barra vacía) · disabled (n/a) · loading (n/a) · error (n/a) | Card `--bg-card` + hairline + `.elevated-sm`, radio `--radius-lg` (14 px), padding horizontal 14 px, 10 px entre tarjetas. Contiene la fila del grupo y, desplegada, las filas de sus hijos separadas por hairline. Tocar la fila del grupo pliega o despliega (chevron ⌄ / ›, `--duration-fast`) | H1, H6, H8 |
| **Fila de presupuesto** (grupo, categoría o subcategoría; nuevo) | default · empty («—» `--fg-muted`, barra vacía) · expanded (con hijos) · disabled (n/a) · loading (n/a) · error (n/a) | Tres partes, alto ≈ 64 px, padding 12 px arriba y 8 px abajo. (1) Línea principal: nombre a la izquierda (grupo: 14 px / 600; hijo: `.label` 13 px / 500, con sangría de 14 px por nivel), lo ejecutado a la derecha en DM Mono (grupo 15 px, hijo 13 px) con glifo y tono, y el chevron de 14 px. (2) **Barra de avance**. (3) «de <presupuestado>» en `.caption` `--fg-muted`, alineado a la derecha bajo la cifra. El nombre se trunca con «…» | H1, H6 |
| **Barra de avance** (nuevo) | default · empty (sin ejecutado: pista vacía) · over (≥100 %: llena) · resto n/a | Pista de 4 px de alto, `--border`, radio `--radius-full`. Relleno = ejecutado / presupuestado, tope 100 %; si no hay presupuesto y sí ejecutado, llena. Color del relleno: el tono de `cellTone` (`--fg-muted` dentro del plan, `--alert-soft`, `--alert-strong`, `--favorable`). Es decorativa para lectores de pantalla (`aria-hidden`): la información está en las dos cifras | H1 |
| Tarjeta de alcancía | default · empty («—») · resto n/a | Tarjeta de una fila con la misma anatomía: nombre, lo aportado (Ejec.) a la derecha, barra de avance contra lo planeado y «de <planeado>». Tono neutro. Abre F6 | H4 |
| Tarjeta «Retiros del mes» | default · empty («—») · resto n/a | Al final de RESERVAS. Una fila sin barra: retiros reales a la derecha, con el tono y el glifo que escritorio da a esta fila (real contra planeado), y «Plan <retiros planeados>» debajo. Abre F7 | H4 |
| Cifra | default · empty («—») · resto n/a | DM Mono, `tabular-nums`, separador de miles «.». Diseñada y probada en maqueta con cifras de hasta 9 dígitos («256.850.000»). En una fila de grupo, la cifra a 15 px mide ≈100 px y deja ≈190 px al nombre a 375 px. En las tarjetas Presupuestado/Ejecutado de F4, a `.display` (22 px) hace falta bajar a `.title-sm` cuando pasa de 8 dígitos. Regla general: si una cifra no cabe, baja un escalón antes de cortarse o desbordar (FR-3114). El monto héroe de Editar ya se achica solo (`fontSizeForDisplay` del registro) | H8 |

### Pantalla: Categoría — FR-3105, FR-3106
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Encabezado de detalle (nuevo) | default · resto n/a | «‹» de 40×40 px, nombre `.title-sm`, ruta y periodo en `.caption` `--fg-muted`. Se reusa en Alcancía, Retiros, Balance y Editar | H3, H4 |
| **Tarjeta Presupuestado** (nuevo) | default (cifra + «Cambiar») · editing (campo + Guardar / Cancelar) · error (texto bajo el campo, `--alert-strong`) · disabled (periodo cerrado: sin «Cambiar») · loading (n/a: optimista) | Card de medio ancho. El campo usa `input` de `ui/input` a `--control-lg`, con teclado numérico y foco automático. Enter guarda y Escape cancela | H3, H5, H9 |
| Tarjeta Ejecutado | default · empty («—») · resto n/a | Card de medio ancho, solo lectura, con el tono de estado | H1 |
| Lista Movimientos | default · empty (texto + botón «Ir a Registrar») · disabled (periodo cerrado: sin lápiz) · loading (n/a) · error (n/a) | Filas de 52 px: día en DM Mono `.caption`, nota `.label` (dos líneas máximo, luego «…»), monto a la derecha y lápiz de 40×40 px. Contenido y orden de `cellDetail`. Los comentarios van al final con ícono `MessageSquare`, sin acciones | H6, H8 |

### Pantalla: Editar movimiento — FR-3107, FR-3108
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Etiqueta de tipo (reemplaza al `TypeToggle` en modo edición) | default · resto n/a | Pastilla `--radius-full` con signo y nombre del tipo en su `--type-*`. No se puede tocar | H4, H5 |
| `AmountDisplay` (reusado) | default (cargado) · error (texto vigente bajo el monto) · empty (0 → el botón pasa a «Borrar movimiento») · disabled (n/a) · loading (n/a) | Vigente. En un ajuste acepta «−» delante | H5 |
| `CategoryRow` (reusado) | default (categoría actual seleccionada) · empty (n/a) · disabled (n/a) · loading (n/a) · error (n/a) | Vigente, filtrado al tipo del movimiento | H6 |
| `DateTimeField` (reusado) + aviso «Pasará a …» | default · warning (otro periodo, `--alert-soft` + `CalendarClock`) · resto n/a | El aviso sale del mismo cálculo que `MovementEditor` | H1, H5 |
| `NoteField` (reusado) | default · error (más de 280: contador en `--alert-strong`) · resto n/a | Vigente | H5 |
| Botón «Guardar cambios» | default · disabled (sin cambios o el ensayo rechaza) · loading (n/a: optimista) · error (motivo debajo) · empty (n/a) | `SaveButton` vigente con otro texto | H1, H5 |
| Botón «Borrar movimiento» + confirmación | default · confirming (pregunta + Borrar / Cancelar) · disabled (periodo cerrado) · resto n/a | Botón con borde `--alert-strong` y texto del mismo color. La confirmación reemplaza al botón en el sitio | H3 |

### Pantalla: Alcancía — FR-3109
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Tarjetas Pres. / Ejec. del aporte | default · editing · error (franja de bloqueo con `blockMessage`) · disabled (periodo cerrado) · loading (n/a) | Igual que la tarjeta Presupuestado de F4, pero aplican `applyReserveEdit` en su plano | H5, H9 |
| Lista de aportes | default · empty («Sin aportes en Octubre») · resto n/a | Como la lista de F4, sin lápiz (BG-084) | H4 |

### Pantalla: Retiros del mes — FR-3110
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Tarjetas Pres. / Ejec. | default · empty («—») · resto n/a | Como las de F4, solo lectura | H1 |
| Lista de operaciones del periodo | default · editing (monto en la fila + Guardar / Cancelar) · error (motivo bajo la fila, `--alert-strong`) · empty (texto + «Ir a Registrar») · disabled (periodo cerrado: sin lápiz ni papelera) · loading (n/a) | Filas de 52 px: «Origen → Destino», nota, monto, lápiz y papelera de 40×40 px. Borrar pide la confirmación de F5 y equivale a corregir a 0 | H3, H6, H9 |

### Pantalla: Balance — FR-3111
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Bloque del Balance | default · empty («—») · resto n/a | Cada bloque es una tarjeta (`--bg-card`, hairline, radio `--radius-md`). Cada fila: operador, nombre y, a la derecha, la cifra real en DM Mono 14 px con «Plan <cifra>» debajo en 11 px `--fg-muted`. Son tres, con eyebrow («EL MES», «LO DISPONIBLE», «EL CIERRE»). Filas de unos 44 px; operador (+ − =) en `--fg-muted` y nombre `.label`. Las filas «=» van en 600 y con su tono. Nombres y orden de `balanceRows` | H2, H4 |

## Nielsen Compliance

### Shell móvil y Presupuesto
- **H1 (estado):** el segmento activo, el periodo elegido y el candado de cerrado siempre están a la vista. Cada cambio
  se refleja al instante (optimista, ≤150 ms, NFR-3107) y el `Toaster` lo confirma.
- **H2 (mundo real):** los mismos nombres que escritorio y que usa el usuario: «Presupuesto», «Alcancía»,
  «Retiros del mes», «Saldo disponible». Nada de «hoja», «plano» ni «roll-up».
- **H3 (control):** «‹» y el «atrás» del navegador en cada pantalla de detalle, «Cancelar» en toda edición y
  confirmación antes de borrar.
- **H4 (consistencia):** mismo color y glifo de estado, mismos textos de error, mismo formulario de registro y el
  mismo control segmentado de escritorio para navegar. El «atrás» se comporta como en cualquier página web.
  Trade-off aceptado: escritorio edita en popovers y el móvil en pantallas completas. Es el patrón del medio y los
  textos y las reglas son los mismos.
- **H5 (prevención):** los botones se deshabilitan antes de un error, el «Máx.» se ve antes de teclear, «Pasará a …»
  avisa antes de guardar y un periodo cerrado no ofrece acciones.
- **H6 (reconocimiento):** las acciones están siempre visibles (lápiz, papelera, «Cambiar», chevron, ojo). Nada
  depende de deslizar. Trade-off aceptado, pedido por el usuario: los saldos del resumen se ven solo al mantener
  presionado el ojo. El control está a la vista, un toque corto muestra la pista «Mantén presionado para ver» y el
  Balance completo sigue a un toque, sin proteger.
- **H7 (eficiencia):** «cuánto llevo en Vivienda» se ve sin tocar nada en la fila del grupo, con su barra, y «cuánto
  en Mercado» con un toque más: abrir la tarjeta. ‹ › cambian de periodo con un toque.
- **H8 (minimalismo):** cada fila muestra lo ejecutado, la barra y «de cuánto». Los grupos empiezan plegados, el
  resumen abre en una línea y el detalle vive en su pantalla. Trade-off aceptado: hay más scroll que en una tabla;
  a cambio, cada cifra se lee de un vistazo, que es el estilo que eligió el usuario.
- **H9 (errores):** cada rechazo dice qué regla y qué límite («máximo $1.200»), junto al campo que lo causó.
- **H10 (ayuda):** los estados vacíos dicen qué hacer («Los gastos se anotan desde Registrar»).

### Categoría, Editar, Alcancía, Retiros y Balance
- **H3:** salir de Editar sin guardar descarta el cambio sin pedir confirmación. Es un trade-off aceptado: lo
  descartado es una edición en curso, no un dato guardado, y preguntar cada vez estorba más de lo que protege.
- **H5:** «Guardar cambios» se habilita solo si el ensayo del dominio acepta el cambio. Lo que se deshabilita es lo
  mismo que rechazaría el servidor (NFR-3105).
- **H9:** si el servidor rechaza porque el periodo se cerró en otro dispositivo, se explica con el aviso de cerrado,
  no con un error genérico.

## Design Tokens

**Fuente: el estándar del producto padre, sin tokens nuevos.** Todos los valores están en `src/app/globals.css`. La
sección de tokens del spec raíz quedó superada por `stack-upgrade-theme` (lo dice la propia raíz). Esta feature no
añade colores, tamaños ni sombras. Las únicas medidas nuevas son de maquetación (alturas de fila y ancho de columna
de cifras) y se derivan de tokens existentes, con el motivo indicado.

### Color roles
| Rol | Claro | Oscuro | Uso en esta feature (motivo) |
|---|---|---|---|
| background `--bg` | `#f7f7f8` | `#131316` | Lienzo de la vista, igual que Registrar |
| surface `--bg-card` | `#ffffff` | `#1b1b1f` | Tarjetas (resumen, grupos, alcancías, Presupuestado/Ejecutado, bloques del Balance) y segmento activo: flotan sobre el lienzo (FR-301) |
| surface-2 `--bg-elevated` | `#ffffff` | `#26262b` | Lista del `Select` de periodos y `Toaster` |
| sunken `--bg-sunken` | `#f1f1f3` | `#0f0f12` | Fondo del control segmentado y aviso de cerrado |
| primary `--primary` | `#1c1c1f` | `#f4f4f5` | Relleno de la tarjeta de resumen y del botón principal («Guardar cambios») |
| on-primary `--primary-foreground` | `#ffffff` | `#1c1c1f` | Texto sobre la tarjeta de resumen y el botón principal: 17:1 en claro y 15:1 en oscuro. Los rótulos a 70 % de opacidad quedan en ≥7:1 |
| accent `--accent-light` | `#55555d` | `#9b9ba3` | Anillo de foco (`:focus-visible`) |
| text-primary `--fg` | `#1c1c1f` | `#f4f4f5` | Nombres y cifras |
| text-secondary `--fg-secondary` | `#55555d` | `#b4b4bb` | Ruta, textos de aviso |
| text-muted `--fg-muted` | `#6b6b73` | `#9b9ba3` | Eyebrows, «—», segmento inactivo, chevrons |
| border `--border` | `#e3e3e7` | `#33333a` | Hairline de filas y tarjetas |
| alert-strong `--alert-strong` (error) | `#ad3932` | `#ec6a66` | ›› sobre-consumo grave, saldo negativo, errores de validación, borrar |
| alert-soft `--alert-soft` | `#9e4708` | `#e0a458` | › sobre-consumo leve, ingreso bajo el plan, aviso «Pasará a …» |
| favorable `--favorable` | `#2d7650` | `#5fbe82` | Ingreso que alcanza o supera su plan (regla `cellTone`) |
| tipo `--type-expense` / `--type-income` / `--type-transfer` | `#c4453e` / `#2f7d53` / `#2f6db4` | `#ec6a66` / `#5fbe82` / `#6ba6f1` | Solo la etiqueta de tipo en Editar y el formulario de registro reusado (NFR-1203: en el registro el color codifica la selección) |

Contraste (verificado en `globals.css`): `--fg` sobre `--bg` 16.4:1 en claro. `--fg-muted` ≥4.68:1 en las tres
superficies claras y 6.8:1 en oscuro. `--alert-strong` 4.85:1, `--alert-soft` 4.92:1 y `--favorable` 4.87:1 en claro,
y en oscuro todos ≥5.2:1 sobre las superficies de la grilla. Todos los roles de texto quedan en ≥4.5:1 (FR-3114).

### Type scale (font family rationale)
- **Inter** (`--font-sans`) para texto y **DM Mono** (`--font-mono`, `.tabular`) para montos, como en todo el
  producto (FR-213). El mono con `tabular-nums` alinea las columnas Pres. y Ejec.
- Roles de `globals.css`, sin tamaños nuevos:
  - `.title-sm` 17 px / 600: título del encabezado y nombre en el detalle.
  - `.label` 13 px / 500: nombres de fila, cifras y segmentos.
  - `.caption` 12 px / 400: ruta, día, avisos y cifras que no caben.
  - `.eyebrow` 11 px / 600, mayúsculas: secciones y columnas.
  - `.display` 22 px / 400: cifras de las tarjetas Presupuestado y Ejecutado.
- Pesos: 400, 500 y 600 (DM Mono carga solo 400/500; el 600 de los totales es Inter en los rótulos y 500 en las
  cifras).

### Spacing scale
- Base 4 px (`--spacing-1..6`: 4, 8, 12, 16, 20, 24). Margen lateral de la vista de 20 px (`px-5`), igual que el
  Registrar actual. Espacio entre bloques de 16 px y dentro de las tarjetas de 12 px.
- Radios: `--radius-lg` (14 px) en la tarjeta de resumen y las tarjetas de grupo; `--radius-md` (10 px) en las
  tarjetas de detalle (Presupuestado, Ejecutado, bloques del Balance); `--radius-sm` (8 px) en campos y botones;
  `--radius-full` en la etiqueta de tipo, la barra de avance y el fondo del ojo.
- Alturas táctiles (FR-3114, mínimo 40 px): `--control-md` 40 px para íconos, ‹ › y el control segmentado;
  `--control-lg` 48 px para campos y botones principales. Filas: 44 px (tipo y grupo) y 48 a 52 px (hoja y movimiento), todo en
  múltiplos de 4.
- Columna de cifra en filas: 88 px = 22 × 4, el ancho de «999.999.999» en DM Mono a 13 px (≈85 px). En tarjetas,
  media tarjeta (~150 px a 375 px).
- Tarjetas de grupo: padding horizontal de 14 px, 10 px entre tarjetas, 20 px entre secciones.
- Barra de avance: 4 px de alto, 6 px de margen arriba y 4 px abajo.
- Motion: `mvScreenIn` (8 px, `--duration-normal`) al entrar a una pantalla de detalle; chevron con
  `--duration-fast`. `prefers-reduced-motion` las anula (regla vigente).

### Responsive
- **360 a 760 px (móvil):** esta vista. Las tarjetas ocupan el ancho menos 20 px por lado. En las filas, el nombre
  ocupa lo que dejan las dos columnas de 88 px y se trunca; a 360 px dispone de ~130 px. Sin desborde horizontal en ninguna pantalla.
- **375 px:** ancho de diseño de las maquetas.
- **768 px y 1440 px:** la app de escritorio, sin cambios. Esta vista no existe ahí.
- **Límite:** 760 px es móvil y 761 px es escritorio (NFR-3104).
