# UX / Design Spec

Feature **impacto-movil**. Lleva al teléfono el aviso de impacto de `cierre-de-mes` FR-2010: al corregir un mes
reabierto, qué meses posteriores se movieron y cuáles quedaron sin cubrir. Construye DENTRO del sistema de diseño
vigente y de las pantallas de `presupuesto-movil` y `gestion-movil`: mismos tokens de `src/app/globals.css`, mismas
tarjetas, mismo patrón de plegado que la tarjeta de resumen. No hay mockups del cliente; el contenido se transcribe del
panel de escritorio (`ImpactPanel`), que es el diseño vigente de esta información, y solo se decide aquí su forma en
375 px. El usuario lo aprueba con la composición ilustrativa de `UX_PREVIEW.html`.

**Archetype: CLINICAL/TRUST** — reason: finanzas personales; el aviso dice dónde tuvo efecto una corrección y tiene que
leerse sin ambigüedad. Los defaults del arquetipo (tema claro único, paleta slate) quedan superados por el estándar del
producto padre: temas claro y oscuro, paleta zinc, Inter + DM Mono. Se conservan el contraste ≥4,5:1 y la ausencia de
animación decorativa.

**Medio:** web responsive. El aviso existe solo en el shell móvil (≤760 px); se diseña a 375 px y es fluido entre 360 y
760 px. A 768 px y 1440 px la app es la de escritorio, con su `ImpactPanel` sin cambios (NFR-3301).

**Decisión de forma: una tarjeta plegable, plegada por defecto, con el resumen siempre a la vista.** El panel de
escritorio es una lista fija, pero ahí hay ancho de sobra y el rango suele verse entero. En el teléfono la lista puede
tener doce filas o más y empujaría las cifras del mes fuera de la pantalla. La cabecera dice lo esencial —qué mes se
corrigió, cuántos meses se movieron y cuántos quedaron sin cubrir— y un toque despliega el detalle. Es el mismo patrón
que la tarjeta de resumen de saldos (H4). El estado plegado o desplegado se conserva al ir de la lista al detalle y
volver.

Preview: `UX_PREVIEW.html` — se abre en un navegador. Trae los tokens en claro y oscuro, el contraste y una tira
ilustrativa con el aviso plegado, desplegado y dentro del detalle de una categoría.

## User Flows

Persona única: **dueño del libro corrigiendo un mes reabierto desde el teléfono**. Entrada común: app a ≤760 px, un mes
reabierto (desde «Cierre de mes»), vista «Presupuesto».

### F1 — Corregir y ver el impacto sin salir de la pantalla (FR-3301, FR-3303, FR-3304)
- **Entry:** detalle de una categoría del mes reabierto.
- **Steps:** el usuario cambia lo planeado, edita o borra un movimiento, o cambia un aporte. La corrección se guarda
  como siempre, en un paso. Si movió el disponible de algún mes posterior, bajo el encabezado del detalle aparece la
  tarjeta **Impacto**, plegada: «Al corregir Agosto 2026 se movió 1 mes». Aparece sola; el usuario no navega.
- **Exit:** sigue corrigiendo o vuelve con «‹»; la tarjeta sigue en la lista del periodo, bajo la barra de periodo y el
  aviso de cerrado, en cualquier periodo que se mire.
- **Error path:** si el guardado falla, lo avisa el `StorageBanner` vigente y, al converger con el servidor, la tarjeta
  refleja el estado real (desaparece si la corrección no quedó).

### F2 — Leer el detalle (FR-3301, FR-3302)
- **Entry:** tocar la cabecera de la tarjeta (toda la cabecera es el control, con chevron ⌄).
- **Steps:** se despliega la lista, una fila por mes movido, en orden cronológico: el periodo a la izquierda y, a la
  derecha, el disponible de antes, una flecha y el de después, en DM Mono. Si el mes pasó de cubierto a descubierto por
  la corrección, debajo de sus cifras va la marca con triángulo: «quedó sin cubrir». Si hay alguna fila así, al pie:
  «Ese mes quedó con gastos sin cubrir por esta corrección. La app no te frena: puedes arreglarlo ahora o dejarlo para
  después.» (en plural, «Esos meses quedaron…»).
- **Exit:** otro toque en la cabecera pliega.
- **Error path:** n/a (solo lectura).

### F3 — Cuándo no hay aviso (FR-3304)
- **Entry:** cualquier pantalla del teléfono.
- **Steps:** sin mes reabierto, o con uno reabierto y ningún mes posterior movido, la tarjeta no existe y no ocupa
  espacio. Al volver a cerrar el mes reabierto, desaparece. No aparece en Registrar, Organizar, alta, «Mover a…»,
  Cierre de mes ni Balance.
- **Exit:** n/a.
- **Error path:** n/a.

## Component Inventory

Estados por componente: **default · loading · error · empty · disabled**. El aviso es de solo lectura y se deriva del
libro ya cargado: no tiene carga propia ni error propio.

### Pantalla: Presupuesto (lista del periodo) y Detalle de categoría — FR-3301, FR-3302, FR-3303, FR-3304
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Tarjeta de impacto** (nuevo; mismo contenido que `ImpactPanel` de escritorio) | default (plegada) · expanded (lista visible) · empty (sin mes reabierto o sin meses movidos: NO se pinta, sin hueco) · loading (n/a: derivada del estado) · error (n/a) · disabled (n/a) | `role="status"`. Card `--bg-card` con borde `--border` (borde `--alert-strong` si hay algún mes sin cubrir), `--radius-md`, `.elevated-sm`, margen inferior 12 px. En la lista va bajo la barra de periodo y el aviso de cerrado, sobre la tarjeta de resumen; en el detalle, bajo el encabezado y el aviso de cerrado, sobre Presupuestado/Ejecutado | H1, H8 |
| **Cabecera de la tarjeta** (nuevo) | default · expanded · resto n/a | Botón a todo el ancho, alto mínimo `--control-lg` (48 px), `aria-expanded`. Ícono `TriangleAlert` de 14 px (`--alert-soft`; `--alert-strong` si hay roto). Texto `.label`: «Al corregir {mes reabierto} se movió 1 mes» / «se movieron N meses». Segunda línea `.caption`: «frente a cómo estaban al reabrirlo» y, si aplica, « · 1 quedó sin cubrir» / « · N quedaron sin cubrir» en `--alert-strong`. Chevron ⌄/⌃ de 14 px a la derecha | H1, H6, H7 |
| **Fila de mes movido** (nuevo) | default · broken (con marca) · resto n/a | Hairline superior, padding vertical 8 px. Línea 1: periodo (`cycleLabel`, `.caption` `--fg-muted`) a la izquierda; a la derecha «antes → después» en DM Mono `.label`, el «después» en `--fg`, el «antes» en `--fg-secondary`, flecha `ArrowRight` 12 px. Las cifras no se cortan: si no caben en una línea con el periodo, el bloque de cifras baja a la línea siguiente (flex-wrap). Línea de marca (solo rotas): `TriangleAlert` 12 px + «quedó sin cubrir» en `.caption` `--alert-strong`, alineada a la derecha | H1, H6 |
| **Pie de la tarjeta** | default (oculto) · visible (hay rotas) · resto n/a | `.caption` `--fg-muted`, con el texto de escritorio. Solo desplegada | H9, H10 |

## Nielsen Compliance

### Tarjeta de impacto (lista del periodo y detalle de categoría)
- **H1 Estado visible:** el efecto de una corrección sobre otros meses aparece al instante en la pantalla donde se hizo.
- **H2 Lenguaje del usuario:** «se movieron», «quedó sin cubrir», «la app no te frena»: los textos de escritorio.
- **H3 Control y libertad:** no bloquea ni pide confirmación; se pliega y despliega.
- **H4 Consistencia:** mismo contenido y mismas palabras que el panel de escritorio; mismo patrón de plegado que la
  tarjeta de resumen.
- **H5 Prevención:** n/a por decisión del usuario (informar, no frenar). El aviso llega después, no antes.
- **H6 Reconocer:** la marca de roto lleva ícono y texto, no solo color.
- **H8 Minimalismo:** plegada por defecto; sin nada que decir, no existe.
- **H9 Recuperarse:** el pie dice qué pasó y que se puede arreglar ahora o después.
- **Trade-off aceptado:** plegada por defecto, el detalle queda a un toque; a cambio no desplaza las cifras del mes. La
  cabecera ya dice cuántos meses y si alguno quedó sin cubrir.

## Design Tokens

**Fuente: el estándar del producto padre, sin tokens nuevos.** Todos los valores están en `src/app/globals.css` y son
los que ya usan `presupuesto-movil` y `gestion-movil`. **Desviación del estándar padre:** una, justificada — el panel de
escritorio es una lista siempre desplegada; en el teléfono es una tarjeta plegable para no empujar las cifras del mes
fuera de la pantalla. El contenido y los textos son los mismos.

### Color roles
| Rol | Claro | Oscuro | Uso en esta feature (motivo) |
|---|---|---|---|
| background `--bg` | `#f7f7f8` | `#131316` | Lienzo sobre el que flota la tarjeta |
| surface `--bg-card` | `#ffffff` | `#1b1b1f` | Fondo de la tarjeta de impacto |
| primary `--primary` | `#1c1c1f` | `#f4f4f5` | No se usa aquí: el aviso no tiene acción principal |
| accent `--accent-light` | `#55555d` | `#9b9ba3` | Anillo de foco de la cabecera |
| text-primary `--fg` | `#1c1c1f` | `#f4f4f5` | Título de la cabecera y disponible «después» |
| text-secondary `--fg-secondary` | `#55555d` | `#b4b4bb` | Disponible «antes» |
| text-muted `--fg-muted` | `#6b6b73` | `#9b9ba3` | Periodo, «frente a cómo estaban…», pie, chevron |
| border `--border` | `#e3e3e7` | `#33333a` | Borde de la tarjeta y hairline de filas |
| error `--alert-strong` | `#ad3932` | `#ec6a66` | Marca «quedó sin cubrir», recuento de rotos y borde de la tarjeta con rotos |
| alert-soft `--alert-soft` | `#9e4708` | `#e0a458` | Ícono de la cabecera cuando solo hay meses movidos |

Contraste (verificado en `globals.css`): `--fg` sobre `--bg-card` 17:1 en claro; `--fg-secondary` 7,3:1; `--fg-muted`
≥4,68:1 en claro y 6,8:1 en oscuro; `--alert-strong` 4,85:1 en claro y ≥5,2:1 en oscuro. Todos los textos quedan en
≥4,5:1 (FR-3302).

### Type scale (font family rationale)
- **Inter** (`--font-sans`) para los textos y **DM Mono** (`--font-mono`, `.tabular`) para las cifras, como en todo el
  producto.
- `.label` 13 px / 500: título de la cabecera y cifras. `.caption` 12 px / 400: periodo, subtítulo, marca y pie.
- Pesos 400 y 500 (DM Mono no carga 600).

### Spacing scale
- Base 4 px. Padding de la tarjeta 12 px horizontal; cabecera con alto mínimo `--control-lg` (48 px); filas con 8 px de
  padding vertical; 12 px bajo la tarjeta. Radio `--radius-md` (10 px).
- Cifras: «999.999.999 → 999.999.999» mide ≈200 px a 13 px en DM Mono; con el periodo (≈110 px) no cabe en 296 px
  útiles a 360 px, así que el bloque de cifras baja de línea por `flex-wrap` en vez de cortarse.

### Responsive
- **360 a 760 px (móvil):** la tarjeta ocupa el ancho menos 20 px por lado; sin desborde horizontal; holgura ≥4 px en
  los textos que caben justos (Linux mide ~3 px más ancho).
- **375 px:** ancho de diseño.
- **768 px y 1440 px:** la app de escritorio con su `ImpactPanel`, sin cambios; esta tarjeta no existe ahí.
