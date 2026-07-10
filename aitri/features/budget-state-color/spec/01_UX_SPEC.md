# UX / Design Spec — Feature: budget-state-color

**Arquetipo:** Data-Dense Dashboard (finanzas). Cambio de **señal**, no de composición: la grilla conserva
su layout, sus columnas y sus interacciones. Solo cambia *qué significa* el color del Ejecutado.

> **Principio rector (North Star):** *el ruido crece con los problemas, no con las filas.*
> Mientras todas las categorías estén dentro de su presupuesto, la grilla queda **completamente muda**:
> 0 celdas coloreadas, 0 marcas.

**Decisión del usuario (revisión del mockup):** el color **no avisa antes** de pasarse. Aparece **solo
cuando ya se superó** el presupuesto, y **gradúa la gravedad** del desvío.

| Consumo del presupuesto | Color | Marca |
|---|---|---|
| **≤ 100%** | neutro (`--fg`) | — |
| **> 100% y < 120%** | ámbar (`--state-warning`) | `›` |
| **≥ 120%** | rojo (`--state-over`) | `››` |

**Un solo canal.** El color y la marca viven **en la celda `Ejec.` del mes al que pertenecen**. No hay
indicador a nivel de fila, así que nunca hay ambigüedad sobre a qué mes se refiere la señal. *(Se evaluó
un pill de % por fila y el usuario lo descartó: "too much information", y en una grilla de 12 meses era
ambiguo. El porcentaje se difiere a los resúmenes — BL-004.)*

---

## User Flows

La grilla es una superficie de **escritorio** (>760px). En móvil (≤760px) solo existe el registro
(FR-010 del proyecto), así que **esta feature no tiene superficie en móvil**.

### Flujo A — Detectar un desvío y su gravedad (escritorio, persona "Dueño de sus finanzas")
- **Entry:** el usuario abre la app en escritorio; la vista Resumen muestra la grilla en el mes en curso.
- **Steps:**
  1. Recorre las filas de GASTOS. **Todo lo que va dentro del presupuesto se ve igual: neutro, sin marca.**
     La grilla no le pide atención.
  2. Una celda que superó el presupuesto salta: **ámbar con `›`** si se pasó poco (>100% y <120%),
     **rojo con `››`** si se pasó mucho (≥120%).
  3. Compara el `Pres.` de al lado para saber por cuánto se pasó — el dato ya está en la fila.
  4. Si no entiende el código, lo lee **una sola vez** en el pie de la grilla.
- **Exit:** el usuario identifica, en un vistazo, qué meses de qué categorías se salieron y con qué gravedad.
- **Error path:** no hay operación que falle — el estado es una **derivación pura** de datos ya presentes.
  Una categoría **sin presupuesto** (0) con ejecutado > 0 no admite porcentaje: se muestra en el estado
  más grave (rojo, `››`) **sin dividir por cero**.

### Flujo B — Cambiar el periodo (escritorio)
- **Entry:** el usuario usa el control Mes/Año.
- **Steps:** el filtro resalta la columna del mes elegido. **Los colores y las marcas no se mueven ni se
  recalculan**: cada celda ya expresa el estado de *su propio* mes. Cambiar el filtro solo cambia qué
  columna está resaltada y qué agregan los KPIs del encabezado.
- **Exit:** la señal es estable y no depende del filtro. *(Ésta es la razón principal para no haber puesto
  un indicador a nivel de fila.)*
- **Error path:** ninguno; el filtro ya existe y no cambia.

### Flujo D — Saber qué se puede editar (escritorio) — `FR-404`
- **Entry:** el usuario quiere corregir un presupuesto.
- **Steps:** distingue **de un vistazo** las filas hoja (lienzo, editables) de las filas padre (superficie
  hundida, totales calculados). Antes, la única pista era el cursor **después** de apuntar.
- **Exit:** hace clic directamente sobre una celda editable.
- **Error path:** hacer clic en una celda padre no hace nada (comportamiento actual, sin cambio) — pero
  ahora el usuario ya no lo intenta.

### Flujo C — Editar una celda (escritorio) — SIN cambio funcional
- Al editar inline el Presupuesto o el Ejecutado de una hoja, el estado (color + marca) **se recalcula al
  confirmar**, como cualquier otro derivado. La edición, el roll-up y la persistencia no cambian (NFR-404).

### Móvil (375px) — comportamiento explícito
**Sin cambios.** A ≤760px la grilla no se renderiza; el registro móvil conserva su propagación de color
por tipo (NFR-401). Esta feature no añade, quita ni modifica nada visible en móvil.

---

## Component Inventory

| Componente | Estados | Comportamiento | Heurísticas Nielsen |
|---|---|---|---|
| **Celda `Ejec.` (gasto)** | **default:** neutro `--fg` (≤100%) · **over-soft:** `--state-warning` + marca `›` (>100%, <120%) · **over-hard:** `--state-over` + marca `››` (≥120%) · **empty:** ejecutado 0 → em-dash `—` en `--fg-secondary` (tratamiento actual, se conserva) · **loading:** no aplica (derivación síncrona, sin datos remotos) · **error:** no aplica (no hay operación que falle) · **disabled:** celda de nodo padre, no editable (ya existente, sin cambio) | El color y la marca se derivan de `(presupuesto, ejecutado)` **de esa misma celda/mes**. `presupuesto = 0` y `ejecutado > 0` → estado over-hard sin dividir por cero. Editar y confirmar recalcula. | H1 (visibilidad del estado), H8 (minimalista: nada mientras no haya problema) |
| **Marca de forma** (`›` / `››`) | **over-soft:** `›` · **over-hard:** `››` · **empty:** **no se renderiza** (≤100%, o ejecutado 0, o fila de Ingreso/Transferencia/total) · **loading / error / disabled:** no aplican (elemento no interactivo, derivación pura) | Se dibuja **dentro de la celda, antes del monto**, en el mismo color del estado. Es el **canal redundante** de WCAG 1.4.1: duplica la señal sin usar el tono. No es un número ni un pill. `aria-hidden` (la información ya la porta el texto del monto y la del `Pres.` adyacente); el estado se expone además a lectores de pantalla mediante el `title`/`aria-label` de la celda. | H6 (reconocer antes que recordar), **WCAG 1.4.1** |
| **Leyenda del código de estado** (en `GridFooter`) | **default:** una línea con los tres estados, su color **y su marca** · **empty/loading/error/disabled:** no aplican (texto estático, siempre presente junto al resto del pie) | Explica **una sola vez**: dentro del presupuesto (neutro) · te pasaste poco (`›` ámbar) · te pasaste mucho (`››` rojo). Nombrar la **marca** además del color hace que la leyenda también sirva a quien no distingue los tonos. Se rechaza un icono de información por fila. | H2 (lenguaje del usuario), H10 (ayuda), H8 |
| **Fila HOJA / editable** (subcategoría · categoría sin hijos) | default / hover (acciones `+ ✎ 🗑`) / naming / drag / drop / **editando** (input inline) | Superficie `--bg` (lienzo). Es la única fila **editable**: su celda abre el input al hacer clic. Sin cambios de comportamiento. | H4 (consistencia) |
| **Fila NO EDITABLE** (total por tipo · **todo** grupo, incluso vacío · categoría con hijos) — `FR-404` | default / hover / expandido-colapsado / drop-target · **sin estado "editando"** | Superficie **hundida** `--bg-sunken` **en toda la fila** (columna fija + celdas de mes), la misma capa del encabezado. Comunica "esto es estructura, no un dato que puedas tocar". La regla es **`!isLeaf`** (= no editable), no "tiene hijos": un grupo vacío tampoco es editable, así que también la lleva. Conserva su color por tipo y **nunca** muestra la marca de sobre-consumo en la fila de total. | H1 (visibilidad), **H6 (la afordancia se ve, no se descubre al apuntar)**, H4 |

---

## Nielsen Compliance

**Pantalla: Resumen / grilla de presupuesto (escritorio, referencia 1440px).**

- **H1 — Visibilidad del estado del sistema.** Un desvío y su gravedad se comunican sin que el usuario
  haga nada. Antes, todo gasto se veía igual de alarmante y el rojo no significaba nada.
- **H2 — Correspondencia con el mundo real.** `›` y `››` se leen como "te pasaste" y "te pasaste bastante";
  el pie lo dice con palabras.
- **H4 — Consistencia y estándares.** Se reutilizan los tokens, la escala tipográfica (`.tabular`,
  `.caption`) y el patrón de `LegendDot` que el pie **ya** usa para la leyenda de meses. No se inventa
  ningún tratamiento nuevo.
- **H6 — Reconocer antes que recordar.** La señal está a la vista; no se esconde tras un hover ni un tooltip.
- **H8 — Diseño minimalista.** Las celdas dentro del presupuesto no muestran **nada**: ni color, ni marca,
  ni icono. La interfaz solo compite por la atención cuando hay algo que decir.
- **H10 — Ayuda y documentación.** El código se explica una vez, en el pie que ya existe.
- **WCAG 1.4.1 (uso del color) — el motivo de la marca.** Ámbar y rojo son un par **rojo-verde
  problemático**: para una persona con deuteranopia o protanopia (≈1 de cada 12 hombres) se ven casi
  idénticos, y con acromatopsia no se ven en absoluto. La marca `›` / `››` es un canal de **forma**
  (no de tono) que hace los dos estados distinguibles sin color. Es la razón por la que la marca es
  obligatoria y no un adorno.

### Trade-offs asumidos (decididos con el usuario)
- **Se pierde el aviso temprano.** Con el umbral en >100%, cuando el color aparece el presupuesto ya se
  superó. El usuario lo decidió a sabiendas: prefiere una grilla muda mientras va bien, y que el color
  gradúe la **gravedad** del desvío en vez de anticiparlo. *(Esto reemplaza el JTBD original "reaccionar
  antes de pasarse".)*
- **Un grupo y su categoría hija pueden marcarse ambos.** Si los dos se pasaron, ambas celdas se colorean.
  Se acepta: son dos problemas reales, no dos filas.
- **El 100% exacto queda neutro.** Consumir justo todo el presupuesto no es un desvío.
- **El rojo tenía dos significados y `FR-404` lo resuelve.** La fila de total `GASTOS` lleva el rojo de
  *identidad del tipo*, no de estado. Al ponerla sobre la superficie hundida, se lee como encabezado de
  estructura y no compite con el rojo de "te pasaste mucho" de una celda de datos. *(Este conflicto lo
  destapó el mockup; sin `FR-404` la señal quedaba erosionada.)*
- **El porcentaje no se muestra.** El usuario lo descartó por ruido. La magnitud del desvío se infiere de
  la pareja `Pres.` / `Ejec.`, que está a la vista, y la gravedad la comunica el color + la marca.

---

## Design Tokens

Todo se deriva de los tokens ya sellados por `ux-consistency` (autoridad 0: el sistema existente). Esta
feature **no redefine** ningún token — **agrega** dos, y abajo se explica por qué era obligatorio.

### El problema que obliga a tokens nuevos (medido, no asumido)

Las filas de la grilla se pintan sobre `--bg` (canvas), pero la **celda del mes seleccionado** lleva un
tinte de realce (`color-mix(in srgb, var(--accent) 6%, transparent)`) que en claro oscurece el fondo a
**`#EAEAEB`**. Contrastes reales medidos ahí:

| Color sobre la celda resaltada (claro `#EAEAEB`) | Ratio | AA |
|---|---|---|
| `--warning` `#B45309` | 4.18:1 | ❌ |
| `--error` `#C4453E` | 4.09:1 | ❌ |

> **Hallazgo:** el rojo de "sobre presupuesto" **ya falla AA hoy** cuando la categoría cae en el mes
> seleccionado. `ux-consistency` no lo detectó porque midió el contraste contra la superficie, no contra
> la celda tintada. Esta feature lo corrige.

### Tokens NUEVOS (aditivos — uso exclusivo del estado de sobre-consumo en la grilla)

| Token | Claro | Oscuro | Razón | Ratio (mejor) | Ratio (peor) |
|---|---|---|---|---|---|
| `--state-warning` | `#9E4708` | `#E0A458` | Ámbar "te pasaste poco". El claro se oscurece respecto de `--warning` lo justo para pasar AA sobre **las cuatro** superficies. | 5.84 | **4.92** ✅ |
| `--state-over` | `#AD3932` | `#EC6A66` | Rojo "te pasaste mucho". Mismo hue ladrillo, apenas más oscuro en claro. | 5.76 | **4.85** ✅ |

*(Columna "ratio" = mejor caso, fila hoja. "Peor caso" = celda del mes resaltado sobre una fila padre, `#E4E4E6` — la superficie más oscura de la grilla en claro. En oscuro el peor caso es la celda resaltada de una hoja, `#212123`: ámbar 7.36, rojo 5.22.)*

Ambos conservan el **hue** de `--warning` / `--error` (ámbar y ladrillo): la identidad no cambia, solo la
luminancia necesaria para AA. En oscuro coinciden con los existentes porque **ya pasaban**.
`--warning` y `--error` **siguen intactos** y con su uso actual (StorageBanner, dashboard, errores del
registro). No se tocan.

Además, la diferencia de **luminancia** entre ámbar y rojo (5.54 vs 5.29 en claro) es deliberadamente
pequeña: **no** se apoya la distinción en el brillo, porque no sería fiable a 12px. La distinción la
carga la **marca**, no el color.

### Las cuatro superficies de la grilla (y por qué son cuatro)

`FR-404` da a las **filas no editables** (total por tipo, todo grupo, categoría con hijos) la superficie
**hundida** `--bg-sunken` **en toda la fila** — la misma capa que ya usa el encabezado — para que la
**estructura** se distinga del **dato editable** sin tener que apuntar con el mouse.

**Por qué hundida y no elevada.** Las filas de tipo hoy usan la capa *elevada* (`--bg-elevated`). Se midió
esa opción y **falla AA en oscuro**: `--state-over` `#EC6A66` sobre la celda del mes resaltado de una fila
elevada da **4.14:1** ❌ (en oscuro "elevado" es más claro, y el realce lo aclara aún más). Sobre la
hundida da **5.22:1** ✅. Por eso la capa de estructura es la hundida — y las filas de tipo migran a ella,
quedando todas las filas no editables sobre una única superficie, coherente con el encabezado.

Eso multiplica las superficies contra las que hay que medir AA:

| Superficie | Claro | Oscuro | Quién la usa |
|---|---|---|---|
| Fila hoja | `#F7F7F8` | `#131316` | celdas **editables** |
| Fila padre (hundida) | `#F1F1F3` | `#0F0F12` | roll-ups, **no editables** |
| Celda resaltada de hoja | `#EAEAEB` | `#212123` | mes del filtro |
| **Celda resaltada de padre** | **`#E4E4E6`** | `#1D1D20` | **peor caso en claro** |

Con `--state-over` en `#B53E36` (el valor previo), el rojo caía a **4.46:1** sobre `#E4E4E6` → fallaba AA.
Por eso ambos tokens se oscurecieron un paso.

### Tokens REUTILIZADOS (sin cambio)

| Rol | Token | Valor | Uso aquí |
|---|---|---|---|
| Texto neutro (dentro del presupuesto) | `--fg` | `#1C1C1F` / `#F4F4F5` | Ejecutado ≤100% — 15.9:1 / 16.9:1 |
| Ejecutado en 0 | `--fg-secondary` | `#55555D` / `#B4B4BB` | Em-dash atenuado (tratamiento actual) |
| Fondo de fila | `--bg` | `#F7F7F8` / `#131316` | Superficie contra la que se mide todo lo anterior |
| Celda del mes resaltado | `color-mix(--accent 6%)` | `#EAEAEB` / `#212123` | Segunda superficie contra la que hay que medir AA |
| Puntos de la leyenda | `--radius-xs` | `6px` | Idéntico al `LegendDot` que el pie ya usa |

### Tipografía y espaciado (reutilizados, sin tokens nuevos)

| Elemento | Estilo | Razón |
|---|---|---|
| Monto de la celda `Ejec.` | `.tabular` (DM Mono, `tabular-nums`), peso 400/500 | Regla ya sellada: **toda cifra en DM Mono**; el peso se mantiene bajo para que el color sea la señal, no el grosor |
| Marca `›` / `››` | mismo color del estado · `0.75rem` · `margin-right: 4px` · `flex-none` · `aria-hidden` | Debe leerse como un signo, no como un dato. La celda conserva su alineación a la derecha: el último dígito del monto sigue alineado entre filas |
| Leyenda del pie | `.caption` en `--fg-muted`, con un punto de color de 9×9px y la marca en texto | Extiende el patrón de la leyenda de meses que el pie **ya** tiene |

**Restricción de ancho a verificar en el build:** la sub-celda de mes mide 108px. Un monto de 7 cifras
(`1.250.000`) más la marca `››` debe seguir cabiendo sin recortar ni romper la alineación — hay que
probarlo explícitamente a 1440px con un monto largo.

### Responsive
- **1440px / 768px (escritorio):** grilla con el comportamiento descrito. La columna de categoría sigue
  siendo redimensionable y **no se toca**.
- **375px (móvil):** la grilla no existe. **Cero cambios visibles.**
