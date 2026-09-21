# UX / Design Spec

Feature **diario-de-celda** (BL-044). Construye DENTRO del sistema de diseño vigente del producto: tokens de
`stack-upgrade-theme` (FR-201, FR-202, FR-204, FR-205) en `src/app/globals.css`, tipografía mono, temas claro y
oscuro. No hay mockups nuevos para esta feature: se diseña sobre el editor de celda que ya existe
(`EditableCell` + sección de observaciones, `transferencias` Flujo 5 y `techo-de-flujo` FR-1809) y se reutilizan
sus piezas. La alerta de descuadre y el bloqueo de cierre reutilizan los avisos de problemas del mes que ya existen
(`TechoBanner` en el Balance, triángulo `techo-mark` en el encabezado del mes) y el control de cierre vigente
(`ClosureControl`).

**Archetype: CLINICAL/TRUST** — reason: finanzas personales, donde la cifra tiene que leerse sin ambigüedad.
Sus defaults (tema claro único, paleta slate) quedan **superados por el estándar del producto padre**: temas claro
y oscuro con preferencia del sistema, paleta zinc neutra y tipografía mono. De este arquetipo solo se conservan el
contraste ≥4.5:1 y la ausencia de animaciones decorativas.

**Medio:** app web responsive. La grilla, el Balance, el control de cierre y este Detalle existen solo en el shell de
escritorio (>760 px). A 375 px la app muestra únicamente «Nuevo movimiento» (FR-010 de la raíz), sin cambios por
esta feature.

**Descuadre** (FR-2511): una celda hoja de Ejecutado de gasto o ingreso cuyo valor no coincide con la suma de sus
movimientos. Las celdas de bolsillos y las de Presupuestado nunca están descuadradas.

Preview: `UX_PREVIEW.html` — se abre en un navegador para ver tokens, contraste y una composición ilustrativa del
Detalle, de la alerta y del botón de cierre bloqueado.

## User Flows

Persona única: **presupuestador personal** (Phase 1). Entrada común a los flujos F1-F7: grilla de presupuesto en
escritorio, clic en la celda de **Ejecutado** de una hoja de gasto o ingreso. Se abre el **editor de la celda**: el
campo de valor arriba y, debajo, el panel **Detalle**. Salida común: Escape o clic fuera cierra el editor (el valor
tecleado se confirma al perder el foco, como hoy).

### F1 — Ver el Detalle (FR-2501, FR-2508, FR-2509)
- **Entry:** clic en una celda de Ejecutado de hoja de gasto o ingreso.
- **Steps:** el panel muestra, en este orden: (1) el comentario automático del saldo anterior, si existe (solo
  bolsillos, como hoy); (2) los movimientos del mes o ciclo en orden cronológico ascendente; (3) los comentarios
  manuales por orden de creación. Cada movimiento: ícono · fecha «18 sep» · nota (o «Sin nota») · monto.
- **Exit:** Escape o clic fuera.
- **Error path:** no hay escritura. Si la hidratación no terminó, la celda no abre el editor (comportamiento
  vigente). Si falla la persistencia de otra operación, la avisa el `StorageBanner` existente.

### F2 — Añadir un movimiento desde el Detalle (FR-2502, FR-2503)
- **Entry:** línea «Añadir movimiento», al pie de la lista.
- **Steps:** (1) escribir el monto (solo dígitos, con separador de miles al mostrarse); (2) nota opcional; (3) fecha:
  el botón muestra la fecha propuesta —«Hoy» si hoy cae en el mes o ciclo de la celda; si no, su último día, p. ej.
  «20 sep»— y al abrirlo el calendario solo habilita días de ese mes o ciclo; (4) Enter en cualquier campo, o el
  botón «Añadir», confirma.
- **Exit:** el movimiento aparece en su posición cronológica, la celda muestra el total nuevo y la línea queda vacía
  para el siguiente, con el foco en «Monto».
- **Error path:**
  - Monto vacío o 0 → «Añadir» deshabilitado; Enter no hace nada (prevención, H5).
  - Nota de más de 280 caracteres → contador en `--error` («281/280») y «Añadir» deshabilitado; el texto no se
    trunca.
  - La operación rompería una regla de reservas (solo aplica si toca bolsillos; en gasto e ingreso no ocurre, BL-051)
    → debajo de la línea aparece el mensaje de la regla; nada se guarda y los campos conservan lo escrito.
  - El guardado no se confirma en el servidor → `StorageBanner` (vigente).

### F3 — Teclear un total en la celda (FR-2504)
- **Entry:** el campo de valor del editor (el mismo input de hoy, «Editar valor»).
- **Steps:** teclear el total y pulsar Enter, o sacar el foco del editor.
- **Exit:** si el valor tecleado es distinto de **la suma de los movimientos** de la celda, se crea un movimiento con
  nota «Ajuste manual» por la diferencia y la celda queda en el valor tecleado. Si el editor sigue abierto, el ajuste
  aparece en el Detalle, resaltado 1,5 s con el borde en `--accent` (feedback H1; sin animación con
  `prefers-reduced-motion`). Teclear el valor de una celda descuadrada la cuadra: su triángulo y su línea del aviso
  desaparecen (F8).
- **Error path:**
  - Valor igual a la suma de los movimientos → no pasa nada (sin ajuste).
  - Solo se aceptan dígitos; el mínimo es 0.
  - Escape descarta lo tecleado (vigente).

### F4 — Editar un movimiento (FR-2505)
- **Entry:** ícono lápiz de la fila. Aparece al pasar el cursor por la fila o al llegar a ella con Tab.
- **Steps:** la fila se convierte en un bloque de edición con cuatro campos etiquetados: **Monto**, **Nota** (contador
  0/280), **Fecha** (calendario) y **Categoría** (select con las hojas del mismo tipo). Si la fecha elegida cae en
  otro mes o ciclo, bajo la fecha aparece «Pasará a «Octubre · 21 sep – 20 oct»» (el mismo aviso que ya da
  «Nuevo movimiento», FR-2405). «Guardar» (Enter) y «Cancelar» (Escape).
- **Exit:** la fila vuelve a su forma normal con los valores nuevos; si cambió de celda, desaparece de este Detalle y
  el total de ambas celdas se actualiza.
- **Poner el monto en CERO elimina el movimiento (FR-2505, corregido el 2026-09-18).** Es la salida que el usuario ya
  conoce: FR-1802 de `techo-de-flujo` la fijó con sus propias palabras para los retiros de bolsillo. Al dejar el
  campo **Monto** en `0`, el botón dice **«Eliminar»** en lugar de «Guardar» y se pinta en `--error`, de modo que la
  consecuencia se lee ANTES de pulsar y nadie borra sin querer; al confirmarlo la fila desaparece y la celda baja en
  su monto, exactamente igual que con la papelera (F5). No se pide una segunda confirmación: teclear 0 y pulsar un
  botón que dice «Eliminar» ya son dos actos deliberados.
  *La versión anterior de esta sección deshabilitaba «Guardar» con el monto en 0, obligando a aprender dos idiomas
  distintos para la misma intención según se estuviera en un bolsillo o en un gasto.*
- **Error path:**
  - Monto vacío → «Guardar» deshabilitado. (Monto `0` NO es un error: elimina, ver arriba.) En un ajuste el monto
    admite un «−» inicial; en un movimiento normal, no.
  - **La edición dejaría una celda por debajo de 0** → bajo el bloque: «No se puede: Restaurantes quedaría en
    −10.000, y ninguna celda puede quedar por debajo de 0.» y «Guardar» deshabilitado. Se calcula al cambiar el
    monto, la categoría o la fecha, antes de guardar (H5).
  - **Eliminar con 0 dejaría la celda por debajo de 0** → el botón «Eliminar» se deshabilita y aparece el MISMO aviso
    que da la papelera en F5 («No se puede borrar: la celda quedaría en −100.000.»). Dos vías para el mismo acto
    tienen que dar el mismo mensaje, o el usuario creerá que son cosas distintas.
  - **Mes o ciclo cerrado** → en un mes cerrado no hay lápiz, así que esta vía no se ofrece; una petición directa se
    rechaza con `closed_period_violation` (FR-2507). El cierre gana también sobre el 0.
  - Fecha en un mes o ciclo **cerrado** → bajo la fecha: «Agosto está cerrado: no se puede mover ahí. Elige una fecha
    de un ciclo abierto.» y «Guardar» deshabilitado.
  - Fecha fuera del rango activo del ledger → el calendario no habilita esos días.
  - Escape dentro del bloque cancela solo la edición de la fila; un segundo Escape cierra el editor de la celda.

### F5 — Borrar un movimiento (FR-2506)
- **Entry:** ícono papelera de la fila (mismas condiciones de aparición que el lápiz).
- **Steps:** la papelera se sustituye por la confirmación inline que ya usa la grilla: check «Confirmar borrado» ·
  X «Cancelar borrado».
- **Exit:** al confirmar, la fila desaparece y la celda baja en su monto; al cancelar, todo queda igual.
- **Error path:**
  - **El borrado dejaría la celda por debajo de 0** → en lugar de la confirmación, la fila muestra «No se puede
    borrar: la celda quedaría en −100.000.» y el check no aparece; X cierra el aviso.
  - Clic fuera o Escape durante la confirmación = cancelar (H3).

### F6 — Comentarios (FR-2508, FR-2509)
- **Entry:** campo «Añadir comentario», al final del panel (el mismo que hoy se llama «Añadir observación»).
- **Steps:** escribir el texto y pulsar Enter.
- **Exit:** el comentario aparece al final de la lista de comentarios; el campo queda vacío.
- **Error path:** texto vacío → Enter no hace nada; más de 280 caracteres → contador en `--error` y rechazo sin
  truncar (vigente, FR-1809).

### F7 — Mes o ciclo cerrado (FR-2507)
- **Entry:** clic en una celda de un mes o ciclo cerrado.
- **Steps:** el valor se muestra como texto (vigente, «Valor de un mes cerrado, no editable»). En el Detalle, primera
  fila: aviso con candado «Agosto está cerrado. Para cambiar sus movimientos, reábrelo desde el cierre de mes.»
  La lista se ve igual pero **sin** lápiz ni papelera —no se puede cambiar monto, nota, fecha ni categoría— y **sin**
  la línea «Añadir movimiento». «Añadir comentario» sigue disponible (FR-2004).
- **Exit:** Escape o clic fuera.
- **Error path:** si el mes se cierra desde otra pestaña con el editor abierto y se intenta guardar → el servidor
  responde «closed_period_violation», nada cambia y el panel pasa al estado cerrado con el mismo aviso.

### F8 — Ver y resolver descuadres (FR-2511)
- **Entry:** la grilla o el Balance de escritorio, en un mes o ciclo con al menos una celda descuadrada.
- **Steps:**
  1. El encabezado del mes muestra el **triángulo** de problemas del mes (el mismo `techo-mark` vigente). Su `title` y
     su `aria-label` dicen «Septiembre: 2 celdas no cuadran con sus movimientos». Si el mes tiene además un problema
     de reservas, ambos textos van juntos separados por « · ».
  2. El **aviso de problemas del Balance** (el mismo `TechoBanner` vigente) gana una línea por mes:
     «**Septiembre:** 2 celdas no cuadran con sus movimientos — Restaurantes, Taxi. Teclea su valor o corrige sus
     movimientos.» Con más de 3 celdas: «Restaurantes, Taxi, Mercado y 2 más».
  3. El usuario abre la celda nombrada y la cuadra: tecleando su valor (F3) o corrigiendo o añadiendo movimientos
     (F2, F4, F5).
- **Exit:** al quedar cuadradas todas las celdas del mes, desaparecen su triángulo y su línea del aviso. Si era la
  única línea del aviso, el aviso entero desaparece (vigente).
- **Error path:** no hay escritura propia; la app nunca crea ajustes por su cuenta. Un descuadre que el usuario no
  resuelve se queda señalado indefinidamente: es su decisión.

### F9 — Cerrar un mes con descuadres (FR-2512)
- **Entry:** el control de cierre de escritorio (`ClosureControl`), cuando el mes que toca cerrar tiene celdas
  descuadradas.
- **Steps:** el botón «Cerrar Septiembre» se muestra **deshabilitado** y, a su lado, el motivo: ícono `TriangleAlert`
  + «No se puede cerrar: 1 celda no cuadra (Taxi)». Con varias: «No se puede cerrar: 3 celdas no cuadran
  (Restaurantes, Taxi, Mercado)», y a partir de 4, «… y 2 más». El `title` del botón repite el motivo.
- **Exit:** al cuadrar la última celda, el motivo desaparece y el botón se habilita; pulsarlo cierra el mes (vigente).
- **Error path:** si llega una petición de cierre con celdas descuadradas (otra pestaña con datos viejos), el servidor la
  rechaza, el mes sigue abierto y el control muestra el motivo actualizado. «Reabrir» nunca se bloquea por descuadres.

## Component Inventory

### Pantalla: Presupuesto — grilla escritorio — editor de celda de Ejecutado (gasto o ingreso)

Posición del panel: debajo de la celda, alineado a su borde izquierdo. **Si no cabe a la derecha del viewport, se
alinea al borde derecho de la celda** (FR-2501: sin desborde horizontal a 768 px ni a 1440 px). Ancho:
`min(320px, 100vw − 32px)`. La lista tiene `max-height: 360px` y scroll vertical propio; el campo de valor y los
campos de añadir quedan siempre visibles.

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Campo de valor** (input vigente, «Editar valor») | default (valor actual) · loading (n/a: la escritura es optimista) · error (el servidor rechaza → vuelve al valor anterior + mensaje bajo el editor) · empty (0) · disabled (mes cerrado → texto «Valor de un mes cerrado, no editable») | Enter o perder el foco confirma; Escape descarta. En gasto o ingreso, un valor distinto de la suma de movimientos crea un ajuste (F3) | H3, H5, H1 |
| **Botón del bloque de edición** (F4) | default («Guardar», `--accent`) · **monto en 0 («Eliminar», `--error`)** · disabled (monto vacío, o la operación dejaría una celda bajo 0) · loading (n/a: escritura optimista) · error (mensaje bajo el bloque) | El rótulo cambia con el valor tecleado, así que la consecuencia se lee antes de pulsar. «Eliminar» hace lo mismo que la papelera de F5 | H1, H3, H5 |
| **Panel Detalle** (contenedor) | default (lista) · loading (n/a: los datos ya están hidratados al abrir) · error (mensaje en su franja inferior) · empty («Sin movimientos ni comentarios», `caption`, `--fg-muted`) · disabled (mes cerrado: F7) | Superficie `--bg-elevated`, borde `--border`, `--radius-sm`, sombra `--shadow-md`, padding 8 px, ancho `min(320px, 100vw − 32px)`. Título en `eyebrow`: «Detalle» | H8, H1 |
| **Fila de movimiento** | default · hover/focus (borde `--border-strong`; aparecen lápiz y papelera) · loading (n/a) · error (aviso de celda negativa al intentar borrar, F5) · empty (sin nota → «Sin nota» en `--fg-muted`) · disabled (mes cerrado: sin acciones) | Ícono `Receipt` 12 px · fecha «18 sep» (`tabular`, `--fg-muted`, ancho fijo 44 px) · nota en 1 línea con puntos suspensivos y el texto completo en `title` · monto a la derecha (ver regla de signo). Todo en `caption` | H6, H4, H8 |
| **Fila de ajuste** (variante de movimiento) | igual que la fila de movimiento · resaltado 1,5 s al crearse (borde `--accent`) | Ícono `SlidersHorizontal` 12 px en lugar de `Receipt`. Nota por defecto «Ajuste manual» | H1, H6 |
| **Fila de comentario manual** | default · hover (n/a: no se edita desde aquí) · loading (n/a) · error (n/a) · empty (n/a) · disabled (n/a: editable también en mes cerrado) | Ícono `MessageSquare` 12 px · texto del comentario (sin monto ni fecha), en varias líneas | H6, H4 |
| **Fila de comentario automático** (bolsillos, FR-1804) | default · resto n/a | Ícono `Info` 12 px en `--alert-soft` sobre tinte `--alert-soft` 8 % (su aspecto actual, que es el modelo de estilo pedido por el usuario) | H1 |
| **Línea «Añadir movimiento»** | default · disabled (monto vacío o 0; o mes cerrado → la línea no se renderiza) · error (nota >280 → contador en `--error`; rechazo del servidor → mensaje debajo) · empty (campos vacíos, fecha propuesta visible) · loading (n/a: optimista) | Etiqueta `eyebrow` «Añadir movimiento» sobre una fila: Monto (input `tabular`, 96 px, aria-label «Monto») · Nota (input flexible, aria-label «Nota», placeholder «Nota (opcional)») · botón Fecha (ícono `CalendarClock` + «Hoy»/«20 sep», abre el calendario vigente limitado al mes o ciclo) · botón `Plus` «Añadir». Enter confirma | H5, H6, H7 |
| **Bloque de edición de movimiento** | default (valores actuales) · disabled («Guardar» deshabilitado con monto vacío/0, nota >280, fecha en periodo cerrado o **celda que quedaría negativa**) · error (mensaje junto al campo que falla, o bajo el bloque) · empty (n/a) · loading (n/a) | Sustituye a la fila. Campos con etiqueta visible (`label`, `--fg-secondary`): Monto · Nota (contador) · Fecha (calendario; aviso «Pasará a …» si cambia de ciclo) · Categoría (select vigente de shadcn con las hojas del mismo tipo). Botones «Guardar» (primario) y «Cancelar» (ghost). Enter guarda; Escape cancela | H3, H5, H9, H6 |
| **Aviso de celda negativa** (nuevo) | default (oculto) · error (visible) · resto n/a | Bajo el bloque de edición o en la fila al intentar borrar: ícono `TriangleAlert` 12 px + «No se puede: Restaurantes quedaría en −10.000, y ninguna celda puede quedar por debajo de 0.» (en borrar: «No se puede borrar: la celda quedaría en −100.000.»), en `--error`, `caption` | H5, H9 |
| **Confirmación de borrado inline** (vigente, Global) | default · disabled (mes cerrado: no aparece; celda negativa: el check no aparece) · resto n/a | Check «Confirmar borrado» / X «Cancelar borrado», 12 px. Clic fuera o Escape = cancelar | H3 |
| **Aviso de mes cerrado** | default (visible solo en mes cerrado) · resto n/a | Primera fila del panel: ícono `Lock` 12 px + «Agosto está cerrado. Para cambiar sus movimientos, reábrelo desde el cierre de mes.» (`caption`, `--fg-secondary`) | H1, H9 |
| **Mensaje de rechazo del servidor** | default (oculto) · error (visible) · resto n/a | Franja al pie de la zona afectada: ícono `TriangleAlert` 12 px + el motivo (mes cerrado, regla de reservas, dato inválido), en `--error`. Desaparece al corregir cualquier campo | H9 |
| **Campo «Añadir comentario»** (renombrado del vigente) | default · disabled (n/a) · error (>280: contador en `--error`, rechazo sin truncar) · empty (placeholder «Añadir comentario») · loading (n/a) | Input al pie del panel. Enter añade | H5, H6 |
| **Marcador de celda** (vigente, FR-1809) | default (sin marca) · con comentarios (punto `--alert-soft` 7 px) · resto n/a | **Sin cambio de regla: marca solo las celdas con COMENTARIOS, no con movimientos.** Justificación: 17 de las 19 celdas con valor del usuario tienen movimientos; marcarlas pintaría casi toda la grilla y contradice «la grilla no gana ruido donde no hay nada anotado» (FR-1809). Un descuadre NO se marca en la celda: se señala en el encabezado del mes y en el Balance (F8) | H8 |

**Regla de signo y color del monto en la fila** (FR-2501):

> **CORREGIDA el 2026-09-18.** La versión anterior de esta sección decía «signo mostrado = signo del tipo × signo del
> monto guardado», y se presentaba a sí misma como la solución a «la tensión entre FR-2501 "con el signo del tipo" y
> FR-2504 "un ajuste de −10.000"». Esa tensión no venía del cliente: el brief solo pide «día, monto y nota», y la
> frase «con el signo del tipo» se había introducido en la fase 1 sin respaldo. La regla que se construyó encima
> producía, en el ledger real del usuario, cuatro filas de −150.000, −40.000, −50.000 y −10.000 bajo una celda que
> mostraba 250.000 en positivo. Palabras del usuario al verlo: «ya por defecto se sabe que es gasto, y no tiene
> lógica cuando esas cifras suman en cada celda».

- **El signo mostrado es el del APORTE A LA CELDA, no el del tipo.** Lo que suma se muestra sin signo; solo lo que
  resta lleva «−». Gasto: un movimiento de 50.000 se ve «50.000»; un ajuste de −10.000 se ve «−10.000». Ingreso:
  exactamente igual — 20.000 se ve «20.000» y un ajuste de −10.000, «−10.000». Ningún monto lleva «+».
- **Por qué sin signo y no con «+»:** la celda ya dice de qué tipo es; repetirlo en cada fila es ruido, y anteponer
  «−» a cada gasto contradice lo único que el panel promete, que sus filas sumen el valor de la celda. Con esta
  regla las cifras se leen como una cuenta: se suman tal cual están escritas y dan el total de la celda.
- **Color (CORREGIDO el 2026-09-20):** el monto que suma va en el color normal del texto, `--fg`; el que resta, en
  `--fg-secondary`. Ni rojo ni verde.
  *La versión anterior pintaba cada gasto en `--type-expense` (rojo) y cada ingreso en `--type-income` (verde). Salía
  de la misma sección inventada que la regla de signo, y cuando se corrigió el signo el color se conservó por error.
  Contradecía lo que el rojo ya significaba en la app: la grilla (feature `budget-state-color`) pinta en rojo solo el
  gasto que SE PASÓ de su presupuesto; un gasto dentro de presupuesto va en color normal. Con la regla retirada, el
  Detalle pintaba en color de alarma diecinueve gastos que estaban exactamente en su presupuesto, y el usuario lo leyó
  —con razón— como que algo iba mal: «veo los números en rojo aún».*
- **La distinción entre lo que suma y lo que resta sigue viajando por DOS vías** —el «−» y el gris— así que no depende
  del color a solas (WCAG 1.4.1). Lo que se quita es el color del TIPO, que no distinguía nada: la celda ya dice de qué
  tipo es.
- **Los datos no cambian:** el movimiento sigue guardando su monto con signo (FR-2504, ajustes negativos aprobados
  en el discovery D1c) y las pruebas de dominio siguen afirmando sobre ese valor. Lo que cambia es la PRESENTACIÓN.

### Pantalla: Presupuesto — encabezado de mes y Balance (escritorio) — FR-2511
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Triángulo de problemas del mes** (vigente `techo-mark`, nuevo tipo «descuadre») | default (oculto: mes sin problemas) · con problemas (visible) · loading (oculto hasta hidratar) · error (n/a) · disabled (n/a) | Ícono `TriangleAlert` 13 px en `--alert-strong`, junto al nombre del mes. `title` y `aria-label`: «Septiembre: 2 celdas no cuadran con sus movimientos»; si convive con un problema de reservas, ambos textos separados por « · » | H1, H6 |
| **Línea de descuadre en el aviso de problemas** (vigente `TechoBanner`, nuevo tipo de línea) | default (oculta) · con descuadres (visible) · loading (oculta hasta hidratar) · error (n/a) · empty (sin líneas → el aviso entero no se renderiza, vigente) · disabled (n/a) | Misma anatomía que las líneas vigentes: ícono `TriangleAlert` 14 px en `--alert-strong` + «**Septiembre:** 2 celdas no cuadran con sus movimientos — Restaurantes, Taxi. Teclea su valor o corrige sus movimientos.» Hasta 3 nombres y «y N más». Una línea por mes, en orden de periodo. `role="status"` (vigente) | H1, H2, H9 |

### Pantalla: Presupuesto — control de cierre (escritorio) — FR-2512
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Botón «Cerrar {mes}»** (vigente) | default (habilitado) · loading (deshabilitado mientras cierra, vigente) · **disabled por descuadre** (nuevo) · error (rechazo del servidor → motivo actualizado) · empty (n/a: sin mes cerrable el botón no se renderiza, vigente) | Con descuadres en el mes que toca cerrar: `disabled`, y su `title` repite el motivo | H5, H1 |
| **Motivo de cierre bloqueado** (nuevo) | default (oculto) · visible (mes cerrable con descuadres) · resto n/a | A la derecha del botón: ícono `TriangleAlert` 12 px en `--alert-strong` + «No se puede cerrar: 1 celda no cuadra (Taxi)», `caption`, `--fg-secondary`, en una línea con puntos suspensivos y el texto completo en `title`. Cumple la regla vigente del control: un botón deshabilitado siempre dice por qué (AC-2031) | H1, H9 |
| **Botón «Reabrir {mes}»** (vigente) | sin cambio: nunca se deshabilita por descuadres | — | H4 |

### Pantalla: Presupuesto — editor de celda de bolsillo (transfer)
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Panel Detalle de bolsillo | igual que el de gasto e ingreso, salvo: disabled total para «Añadir movimiento», lápiz y papelera (no aplican a bolsillos en esta feature) | Título «Detalle». Las notas De→A del mes y el comentario automático se muestran como filas de comentario con el estilo común (FR-2508). La regla de edición del valor del bolsillo NO cambia (NFR-2503). Un bolsillo nunca cuenta como descuadre | H4 |

### Textos renombrados en toda la app (FR-2509)
| Antes | Después |
|---|---|
| «Observaciones» (título de la sección del editor) | «Detalle» |
| «Añadir observación» (placeholder y aria-label) | «Añadir comentario» |
| «Sin observaciones este mes» | «Sin movimientos ni comentarios» |
| «Nota (opcional)» en «Nuevo movimiento» | sin cambio |
| Botón «Nuevo movimiento» | sin cambio |

### Pantalla: Registrar («Nuevo movimiento») — FR-001
Sin cambios de UI (NFR-2504). Cada movimiento que guarda aparece en el Detalle de su celda.

## Nielsen Compliance

### Editor de celda y Detalle
- **H1 Visibilidad del estado:** la celda y la lista se actualizan al instante (escritura optimista); un ajuste nuevo
  se resalta 1,5 s; el aviso de mes cerrado aparece antes de que el usuario intente escribir.
- **H2 Lenguaje del usuario:** «Detalle», «Movimiento», «Nota», «Comentario», «Ajuste manual»: las palabras que el
  usuario eligió en el discovery. Las fechas en formato corto en español («18 sep»).
- **H3 Control y libertad:** Escape cancela en dos niveles (primero la fila, luego el editor); el borrado pide
  confirmación inline; editar permite corregir un error de monto sin acumular correcciones.
- **H4 Consistencia:** se reutilizan el input de celda, el calendario de «Nuevo movimiento», el select de shadcn y la
  confirmación de borrado de la grilla. Todas las filas comparten anatomía y estilo.
- **H5 Prevención de errores:** botones deshabilitados con monto vacío o 0, con nota >280 y cuando la celda quedaría
  negativa (calculado antes de guardar); el calendario solo habilita días válidos; el aviso «Pasará a …» anuncia el
  cambio de ciclo antes de guardar.
- **H6 Reconocer antes que recordar:** íconos distintos para movimiento, ajuste, comentario y comentario automático,
  con etiqueta accesible; lápiz y papelera visibles al pasar el cursor o con el foco de teclado.
- **H7 Eficiencia:** añadir un gasto es una sola línea con Enter; teclear el total sigue disponible como atajo, y también
  cuadra una celda descuadrada.
- **H8 Minimalismo:** las acciones de fila aparecen solo con hover o foco; el marcador de la grilla no se extiende a
  los movimientos ni a los descuadres.
- **H9 Recuperación de errores:** el aviso de celda negativa dice qué celda y en cuánto quedaría; el de mes cerrado
  dice cómo desbloquearlo (reabrir).
- **H10 Ayuda:** no aplica como onboarding; la ayuda contextual es el aviso «Pasará a …» y la fecha propuesta.

### Encabezado de mes, Balance y control de cierre
- **H1 Visibilidad del estado:** el descuadre se ve donde el usuario ya mira los problemas del mes (triángulo y aviso
  del Balance) y justo en el momento de cerrar (motivo junto al botón).
- **H2 Lenguaje del usuario:** «no cuadran con sus movimientos», con los nombres de sus propias categorías.
- **H4 Consistencia:** el descuadre es un tipo más de problema del mes: mismo triángulo, mismo aviso, mismo patrón de
  «botón deshabilitado con motivo» del control de cierre.
- **H5 Prevención de errores:** cerrar un mes descuadrado no se puede intentar; el servidor lo rechaza igual si llega.
- **H9 Recuperación de errores:** cada línea dice qué celdas y cómo resolverlo («Teclea su valor o corrige sus
  movimientos»).

**Trade-offs aceptados:**
- En la línea «Añadir movimiento», la etiqueta visible es un único `eyebrow` sobre la fila y cada campo lleva
  aria-label y placeholder, en lugar de una etiqueta visible por campo. Motivo: el panel mide 320 px y apilar tres
  etiquetas alargaría el editor sobre la grilla. En el bloque de edición, que no se usa en cada carga, sí hay
  etiqueta visible por campo.
- Las acciones de fila solo aparecen con hover o foco (H6 frente a H8). Motivo: con hasta 7 movimientos por celda,
  mostrarlas siempre duplica el ruido; siguen alcanzables con teclado.
- El descuadre no se marca en la celda (H6 frente a H8). Motivo: el marcador de celda ya significa «tiene
  comentarios», y un segundo marcador en la misma esquina de 7 px sería ambiguo; los nombres de las celdas ya
  aparecen en el aviso y en el motivo de cierre.

## Design Tokens

Fuente: **estándar del producto padre** (`stack-upgrade-theme` FR-202/FR-204, `src/app/globals.css`). Esta feature
**no introduce colores nuevos**; solo compone tokens existentes. Los hexadecimales del spec raíz (paleta oscura del
prototipo) están superados por esa feature y no se usan.

### Color roles

| Rol | Token | Claro | Oscuro | Uso en esta feature y razón |
|---|---|---|---|---|
| background | `--bg` | #f7f7f8 | #131316 | Lienzo de la grilla; borde del marcador de celda (vigente) |
| surface | `--bg-elevated` | #ffffff | #26262b | Fondo del panel Detalle: es un popover, y el sistema reserva esta superficie para popovers y paneles |
| surface (aviso) | `--bg-card` | #ffffff | #1b1b1f | Fondo del aviso de problemas del Balance (vigente, `TechoBanner`) |
| primary / accent | `--accent` | #1c1c1f | #f4f4f5 | Borde de foco de inputs y resaltado del ajuste recién creado; es el acento neutro del sistema |
| error | `--error` (= `--alert-strong`) | #ad3932 | #ec6a66 | Contador >280, aviso de celda negativa, rechazos; triángulo de problemas del mes y motivo de cierre bloqueado (vigente para los problemas del mes) |
| text-primary | `--fg` | #1c1c1f | #f4f4f5 | Nota, comentario y texto del aviso del Balance |
| text-secondary | `--fg-secondary` | #55555d | #b4b4bb | Etiquetas de campos, aviso de mes cerrado, motivo de cierre bloqueado y montos que restan al total |
| text-muted | `--fg-muted` | #6b6b73 | #9b9ba3 | Fechas, «Sin nota», vacío, íconos de acción |
| border | `--border` | #e3e3e7 | #33333a | Borde del panel y de las filas en reposo |
| border (hover) | `--border-strong` | #d3d3d9 | #43434c | Borde de fila en hover o foco: en el sistema el hover cambia el borde, no el relleno |
| tipo gasto | `--type-expense` | #c4453e | #ec6a66 | Monto de un gasto que suma a la celda; el color por tipo ya es AA en ambos temas (FR-204) |
| tipo ingreso | `--type-income` | #2f7d53 | #5fbe82 | Monto de un ingreso que suma a la celda |
| alerta leve | `--alert-soft` | #9e4708 | #e0a458 | Ícono y tinte del comentario automático, y marcador de celda: su aspecto vigente |

**Tintes compuestos (sin hex nuevo):**
- Fila de movimiento, ajuste y comentario: `background: color-mix(in srgb, var(--fg-muted) 4%, transparent)`.
  Razón: da a todas las filas la misma «caja» que el comentario automático (pedido del usuario), pero neutra, para
  que el color siga reservado a la semántica. **Por qué 4 % y no más:** es el tinte más fuerte en el que todos los
  pares de texto siguen en AA en ambos temas. Con 6 %, el monto de un gasto en tema oscuro cae a 4,45:1 (falla);
  con 5 % queda en 4,51:1, un margen de 0,01 que el redondeo de `color-mix` podría romper.
- Fila de comentario automático: `color-mix(in srgb, var(--alert-soft) 8%, transparent)`, sin cambio.

**Contraste** (texto de 12-14 px, objetivo WCAG AA ≥4,5:1). Ratios calculados con la fórmula de luminancia relativa
de WCAG 2.1 sobre los hex de los tokens:

| Par | Claro | Oscuro |
|---|---|---|
| `--fg` / `--bg-elevated` | 17,0 | 13,7 |
| `--fg-secondary` / `--bg-elevated` | 7,4 | 7,3 |
| `--fg-muted` / `--bg-elevated` | 5,3 | 5,5 |
| `--type-expense` / `--bg-elevated` | 4,9 | 4,9 |
| `--type-income` / `--bg-elevated` | 5,0 | 6,6 |
| `--error` / `--bg-elevated` | 6,2 | 4,9 |
| `--alert-soft` / su tinte del 8 % sobre `--bg-elevated` | 5,5 | 6,0 |
| `--fg-muted` / fila tintada 4 % | 5,0 | 5,1 |
| `--type-expense` / fila tintada 4 % | 4,7 | 4,6 |
| `--error` / fila tintada 4 % | 5,9 | 4,6 |
| `--fg` / `--bg-card` (aviso del Balance) | 17,0 | 15,6 |
| `--error` / `--bg-card` (triángulo y texto de problema) | 6,2 | 5,6 |
| `--fg-secondary` / `--bg` (motivo de cierre, sobre la barra) | 6,9 | 9,0 |

Todos los pares pasan AA. El más ajustado es el monto de gasto sobre la fila tintada en tema oscuro (4,57).
`UX_PREVIEW.html` recalcula estos mismos valores en el navegador.

### Type scale (font family rationale)
- Familia: `--font-mono` (DM Mono, con `ui-monospace` y `SF Mono` de respaldo). Mono en todo el producto por decisión
  del sistema de diseño: los montos alinean por columnas (`tabular-nums`).
- `eyebrow` 0,6875 rem / 600 / mayúsculas / tracking 0,09 em → títulos «Detalle» y «Añadir movimiento».
- `label` 0,8125 rem / 500 → etiquetas del bloque de edición.
- `caption` 0,75 rem / 400 → filas, fechas, montos, estados vacíos, mensajes, línea del aviso del Balance (vigente) y
  motivo de cierre bloqueado. Es el tamaño del panel de observaciones vigente (12 px); no se agranda para no alargar
  el editor sobre la grilla.
- `.tabular` en fecha y monto.

### Spacing scale
- Base 4 px (estándar padre).
- Panel: padding 8 px; separación entre filas 2 px; entre la lista y la línea de añadir, 8 px.
- Fila: padding 4 px vertical y 6 px horizontal; separación interna de 6 px; ícono 12 px con trazo 1,5.
- Radios: fila `--radius-xs` (6 px), como el comentario automático; panel e inputs `--radius-sm` (8 px).
- Sombra del panel: `--shadow-md`.
- Medidas: ancho del panel `min(320px, 100vw − 32px)`; `max-height` de la lista 360 px; fecha 44 px; input de monto
  96 px; motivo de cierre bloqueado con `max-width` 320 px y puntos suspensivos.
- Aviso del Balance y triángulo del mes: sin cambios de medida (vigentes).
- Motion: ninguna animación nueva. Resaltado del ajuste = cambio de borde durante 1,5 s, sin transición con
  `prefers-reduced-motion: reduce`.

### Responsive
- **375 px:** el Detalle, el aviso del Balance y el control de cierre no existen; la app muestra solo «Nuevo
  movimiento», sin cambios.
- **768 px:** shell de escritorio con la grilla en scroll horizontal. El panel mide `min(320px, 100vw − 32px)` y se
  alinea al borde derecho de la celda cuando no cabe a la derecha; nunca desborda el viewport. El motivo de cierre
  bloqueado se trunca con puntos suspensivos y conserva el texto completo en `title`.
- **1440 px:** igual que 768 px; en columnas cercanas al borde derecho aplica la misma regla de alineación.
