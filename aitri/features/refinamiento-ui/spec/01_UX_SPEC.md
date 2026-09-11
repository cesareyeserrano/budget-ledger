# UX / Design Spec — feature `refinamiento-ui` (sistema visual, parte 1 de 2)

Esta spec **no re-inventa el sistema de diseño del producto: lo corrige donde está sobrecargado y declara las escalas que nunca se trajeron.** Todo lo que no se nombra aquí se hereda intacto del `01_UX_SPEC.md` raíz y de las features cerradas.

**Superficie:** escritorio (>760 px), más la retirada de la marca en el shell móvil. El dashboard queda fuera por decisión del usuario. **La interacción de fila, la composición del registro y el layout adaptativo están APARCADOS para la segunda feature** (ver `no_go_zone`): esta spec no los diseña.

`Preview: not generated` — esta feature no crea ninguna pantalla: reasigna color, comprime chrome existente y declara escalas. El riesgo visual real era el color, y ya se revisó sobre `feature_context/colisiones-de-color.html`, que el usuario aprobó el 2026-08-05; el estado de partida está fotografiado en 14 capturas de la app real (`feature_context/estudio-ui-ux-completo.md`). Un preview sintético aportaría menos que esas dos referencias.

**Referencias visuales en `feature_context/`:** `colisiones-de-color.html` (comparador sobre el que el usuario decidió), `estudio-ui-ux-completo.md` (14 capturas de la app real con sus datos, a 1024/1440/1920 en ambos temas) y `auditoria-ui-completa.md`.

---

## El principio que gobierna todo lo demás

**Cada canal perceptual hace UN solo trabajo.** Es el criterio con el que se resuelve cualquier duda que esta spec no cubra.

| Canal | Trabajo único | Nunca expresa |
|---|---|---|
| **Forma + peso** (glifo lateral `←` `→` `⇄`, mayúsculas, banda) | dónde empieza cada bloque de tipo | estado |
| **Alerta** (rojo / ámbar) | excepción: sobre-consumo, ingreso corto, saldo negativo, entrada inválida | identidad de tipo o categoría |
| **Favorable** (verde) | situación buena: saldo sano, ingreso sobre plan | identidad de tipo |
| **Acento** (tinta) | interacción: foco, edición, mes en foco, destino de arrastre | estado |
| **Superficie** (`--bg` vs `--bg-sunken`) | qué es editable | jerarquía o tipo |

**La excepción declarada — el registro.** Ahí el color por tipo se conserva. No es una inconsistencia: es que el campo perceptual y la tarea son otros. En el registro hay **un** tipo activo a la vez y no se muestra ningún estado, así que el color codifica **la selección en curso**, siempre sobre controles activos (segmento relleno, botón, borde de la categoría elegida). En la grilla conviven los tres tipos y el estado es la información buscada, así que codifica **estado**. *Color sobre control activo = selección. Color sobre texto en reposo = clasificación.*

---

## User Flows

### Flujo A — Leer el estado del presupuesto · FR-1201, FR-1202, FR-1203
1. **Entry:** el usuario recorre la grilla buscando desvíos.
2. La pantalla está **casi monocroma**: tinta neutra en filas, celdas, íconos de nodo y encabezados de bloque.
3. Los **tres encabezados** se distinguen por peso, banda y glifo lateral: `←` INGRESOS · `→` GASTOS · `⇄` RESERVAS.
4. Los **guiones de «sin dato» están atenuados**, no pintados del color de su categoría. Hoy hay ~30 coloreados en una pantalla de 1920.
5. El **único color saturado** aparece en las celdas Ejec. con desvío: ámbar `›` entre 100 % y 120 %, rojo `››` a partir de 120 %, y ámbar `‹` en un ingreso por debajo de su plan.
   **Regla que gobierna el par color↔forma:** toda celda coloreada con un rol de alerta lleva marca. Descubierto implementando: al unificar los tokens, el ingreso corto heredó el ámbar del sobre-consumo y se quedó sin marca — una celda coloreada sin canal no cromático, que es lo que WCAG 1.4.1 prohíbe. Lo detectó TC-BSC-453f.
6. **Exit:** lo coloreado es exactamente lo que exige acción.

### Flujo B — Situarse en la pantalla · FR-1204
1. **Entry:** el usuario abre la vista de Presupuesto.
2. Lee **un** nombre de vista, **una** vez el alcance del periodo, y ve sus cifras.
3. Los controles están agrupados por **clase**: navegación, trabajo, preferencia y cuenta ocupan grupos distintos y visualmente separados.
4. **Exit:** a 1024×768 ve más filas del módulo de Balance que las 3 actuales.

### Flujo C — Confiar en lo que la pantalla afirma · FR-1205
1. **Entry:** el usuario mira el pie de la grilla.
2. No hay instrucciones de uso escritas y hay **una sola** leyenda: la del código de estado.
3. Ningún texto fijo afirma nada sobre sus datos que no derive del estado real.
4. **Exit:** no necesita verificar contra la grilla lo que el pie le dice.

---

## Component Inventory

### Pantalla: Presupuesto — grilla escritorio

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Encabezado de bloque de tipo** — FR-1202 | default · hover (revela `+` grupo) · drop-target | Rótulo y glifo en **tinta neutra (`--fg`)**, sin hue propio. Los tres se distinguen por **glifo lateral** (`←` `→` `⇄`) y peso. **Las celdas de total pasan a tinta neutra.** | H4, H6, H8 |
| **Ícono de nodo** — FR-1202 | default | **Tinta neutra**, ya no el color del tipo. Su comportamiento (abrir el `IconPicker`) no cambia: la interacción está aparcada. | H8 |
| **Celda sin dato (`—`)** — FR-1202 | default | **Tinta atenuada (`--fg-muted`)**. Nunca el color de un tipo: un guion significa «aquí no hay nada» y no debe gastar el canal más fuerte de la pantalla. | H8 |
| **Celda Ejec. de hoja** — FR-1201, FR-1203 | default (neutro) · alerta-leve (ámbar + `›`) · alerta-grave (rojo + `››` + peso 650) · cero (atenuado) · editing · highlight | Color y glifo salen de la MISMA llamada a `budgetState(b, e)`. Ingreso y Reserva pierden su hue de tipo: un ingreso sobre plan usa el token favorable, uno por debajo el de alerta leve, y una reserva queda neutra. | H1, H8 |
| **Celda de nodo padre** | default (superficie hundida, no editable) | **Sin cambio.** La superficie sigue derivándose del mismo predicado que gobierna la edición (ADR-05). Patrón a conservar. | H4, H8 |
| **Franja de resumen** — FR-1204 | default · empty (montos 0 → 0 %) · loading | Se **comprime**: hoy ocupa 110 px de alto y todo el ancho para mostrar tres cifras. La forma exacta la decide la implementación; el resultado es medible (chrome < 240 px, más filas de Balance a 1024). La tercera cifra se rotula **`RESTANTE`** — `DISPONIBLE` colisiona con el «Saldo disponible» del Balance en la misma pantalla midiendo otra cosa. Cálculo sin cambios. | H2, H8 |
| **Pie de la grilla** — FR-1205 | default | El **pie de ayuda se retira** (decisión del usuario). Queda **una sola leyenda**, la del código de estado, que nombra color **y** glifo para servir a quien no distingue ámbar de rojo. Ningún texto afirma un reparto de meses derivado de la semilla. | H1, H8, H10 |
| **Módulo de Balance** — FR-1201 | default · negativo (alerta + `‹‹`) | Sus filas de reserva dejan de usar el color de tipo. Conserva su marca `‹‹` —deliberadamente distinta de `›`/`››` porque significa otra cosa— y sus filas encabezadas por signo. **Nota medida:** con saldo sano hoy pinta ~36 cifras verdes simultáneas; el verde debe señalar la excepción sana, no ser el fondo permanente. | H1, H8 |

### Global

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Encabezado de la app** — FR-1204 | default | **La marca «Ledger» y su ícono de billetera se retiran de ambos shells** (decisión del usuario). **Un solo nombre por vista**: hoy el `<h1>` dice «Presupuesto» y la pestaña de la misma vista dice «Resumen». La etiqueta de alcance aparece **una sola vez** (hoy está en la barra de controles y otra vez como subtítulo de la primera tarjeta). | H4, H8 |
| **Grupos de control** — FR-1204 | default | Navegación, trabajo, preferencia y cuenta en **grupos separados**. Hoy los cuatro comparten fila y por eso «Salir» se lee como arbitrario. El control de cuenta indica a qué sesión pertenece. La pantalla de acceso y el botón **ya adoptan el sistema de diseño** (`servidor-fuente-unica` FR-1108): sólo cambia el sitio. | H2, H4, H5 |

---

## Design Tokens

### Roles de color tras la unificación

| Rol | Sustituye a | Claro | Oscuro | Peor caso verificado |
|---|---|---|---|---|
| `--alert-strong` | `--type-expense`, `--state-over`, `--error-strong`, `--error` | `#ad3932` | `#ec6a66` | 4,85:1 |
| `--alert-soft` | `--warning`, `--state-warning` | `#9e4708` | `#e0a458` | 4,92:1 |
| `--favorable` | `--type-income`, `--success`, `--success-strong` | `#2d7650` | `#5fbe82` | 4,87:1 |

**No se declara ningún valor NUEVO.** De cada grupo se conserva la variante con **mejor contraste verificado** (`--state-over` sobre `--type-expense`, `--state-warning` sobre `--warning`, `--success-strong` sobre `--success`), así que la unificación **sube el contraste o lo deja igual** — nunca lo baja.

Los `--type-*` **permanecen declarados** porque el registro los consume (FR-203/FR-204, protegido por NFR-1203). Lo que se retira es su **uso fuera del registro**.

### Escala de espaciado — nueva

No existía ninguna. Medido: **9 valores de gap distintos**, con 6, 10 y 14 px fuera de rejilla. Se declara sobre **base 4 px** (`--space-1: 4px` … `--space-6: 24px`) y todo `gap`/`padding` de `src/components/` sale de ella.

### Escala de motion — nueva

No existía. Medido: tres `duration-[130ms]` a mano. Se declaran duraciones (rápida / normal / lenta) y curvas, y los componentes las consumen. `prefers-reduced-motion` ya está resuelto globalmente y **no se toca**.

### Tipografía — sin cambios, pero cerrada

La escala de roles (`.display`, `.title`, `.title-sm`, `.label`, `.caption`, `.eyebrow`) **se conserva tal cual**: funciona, con 157 usos. Lo que cambia es que **se cierra la puerta a saltársela**: hoy hay 18 tamaños `text-[…rem]` ad-hoc en 6 ficheros, exactamente los que FR-303 dijo haber eliminado.

> **Divergencia declarada frente al padre.** El `01_UX_SPEC.md` raíz asigna color por tipo en la grilla (heredado de FR-008 y del prototipo). Esta feature lo revoca **en la grilla y en el Balance**, por decisión del usuario del 2026-08-05 con la evidencia de colisión de tokens. FR-008 sigue vigente para el signo y la regla de varianza; cambia qué canal transporta la identidad de tipo. En el registro **no** se revoca.

---

## Nielsen Compliance

Se aplican las 10 heurísticas. Esta feature corrige cuatro violaciones heredadas y acepta un trade-off declarado.

- **H6 · Reconocer antes que recordar.** El usuario tenía que recordar qué significa el rojo en cada zona. Corregido en FR-1201.
- **H8 · Estética y diseño minimalista.** Elementos coloreados que repetían lo que el rótulo ya decía —incluidos ~30 guiones de «sin dato»— y 240 px de chrome para mostrar tres ceros. Corregido en FR-1202 y FR-1204.
- **H4 · Consistencia y estándares.** Cuatro rótulos compitiendo, dos nombres para la misma vista, cuatro clases de control en una fila. Corregido en FR-1204.
- **H10 · Ayuda y documentación.** La interfaz se explicaba por escrito con un pie de tres líneas, y una de ellas afirmaba algo falso sobre los datos. Corregido en FR-1205.

**Trade-off aceptado (H6):** los tres bloques dejan de distinguirse por hue. Se compensa con el glifo lateral, el rótulo en mayúsculas, el peso y la banda estructural. Registrado en `idea_gaps`: si al verlo el usuario lo rechaza, la variante es reintroducir un hue de estructura — que él ya descartó una vez.

---

## Accesibilidad

- **Contraste:** los tres roles nuevos conservan valores ya verificados AA en ambos temas; el peor caso sigue siendo la celda del mes resaltado sobre fila hundida (4,85:1).
- **No dependencia del color:** el estado se lee por glifo (`›` / `››`) y peso; la identidad de bloque por glifo lateral (`←` / `→` / `⇄`); el saldo negativo por `‹‹` y signo. Con la unificación **los canales de forma ganan importancia**, no la pierden.
- **`prefers-reduced-motion`** ya está resuelto globalmente; la escala de motion nueva se declara respetándolo.
- **Foco visible** global (`:focus-visible`) — se conserva sin cambios.
