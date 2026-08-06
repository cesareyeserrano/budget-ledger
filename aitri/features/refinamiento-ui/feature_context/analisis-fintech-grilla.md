# Análisis de la grilla — diagnóstico medido y patrones de productos fintech

> **Qué es este documento.** El insumo que el usuario pidió el 2026-08-05 (*"hay que analizar y diseñar basado en fintech products"*) para poder cerrar las cuatro decisiones abiertas de `FEATURE_IDEA.md`.
>
> **Qué NO es.** La decisión. Cada propuesta lleva su alternativa y su coste. Lo que aquí se afirma como hecho está medido sobre el código real (`src/components/BudgetGrid.tsx`, 559 líneas, y `src/app/globals.css`); lo que se propone está marcado como propuesta.

---

## Parte 1 — Lo que se midió

### 1.1 El color: los tokens no solo significan cosas distintas, **son el mismo valor**

El diagnóstico del 2026-07-27 decía que el rojo significa tres cosas. Es peor que eso, y ahora hay prueba: en **tema oscuro los tokens son literalmente idénticos**.

| Concepto | Token | Claro | **Oscuro** |
|---|---|---|---|
| «esto es un gasto» (identidad de tipo) | `--type-expense` | `#c4453e` | **`#ec6a66`** |
| «te pasaste ≥120 % del presupuesto» | `--state-over` | `#ad3932` | **`#ec6a66`** |
| «tu saldo es negativo» | `--error-strong` | `#ad3932` | **`#ec6a66`** |
| «error de la aplicación» (StorageBanner) | `--error` | `#c4453e` | **`#ec6a66`** |

Los cuatro rojos colapsan en `#ec6a66` en oscuro. En claro hay dos valores (`#c4453e` y `#ad3932`) separados por una diferencia que **ningún usuario puede distinguir** sin un cuentagotas — y además `--error` coincide exacto con `--type-expense`.

Lo mismo en verde: `--type-income`, `--success` y `--success-strong` son **todos `#5fbe82`** en oscuro y `#2f7d53`/`#2d7650` en claro. Y en ámbar: `--warning` y `--state-warning` son ambos `#e0a458` en oscuro.

**Consecuencia:** no es que el color esté mal elegido. Es que **el canal está saturado**: se le pidió transportar cuatro mensajes con el mismo símbolo. Ningún ajuste de tono lo arregla — solo se arregla quitándole trabajo.

### 1.2 Cuántos canales cromáticos compiten en una sola pantalla

Contados sobre el código, en la vista de Presupuesto sin hacer scroll:

1. **Identidad de tipo** — filas de total (rótulo + ambas celdas, en negrita), íconos de cada nodo, color del `IconPicker`, ícono del `DragOverlay`.
2. **Estado de sobre-consumo** — celda Ejec. de gasto: neutro ≤100 %, ámbar >100 %, rojo ≥120 %, con glifos `›` / `››`.
3. **Varianza de ingreso** — celda Ejec. de ingreso: verde si ≥ presupuesto, ámbar si <.
4. **Neutro de transferencia** — celda Ejec. de reserva en `--accent-light`.
5. **Aviso de techo del plan** — `!` + ámbar en celdas Pres. (FR-1008).
6. **Balance** — verde saldo sano / rojo saldo negativo / azul reservado.
7. **Acento de interacción** — mes resaltado (6–8 % de tinte), destino de arrastre (18 % + anillo), foco, bordes de edición.
8. **Superficie de editabilidad** — `--bg` (hoja editable) vs `--bg-sunken` (estructura).

Ocho sistemas. Los cuatro primeros ocupan **la misma celda**.

**Nota importante:** el nº 8 es el único que está bien resuelto. `cellSurface()` deriva la superficie del **mismo predicado** que gobierna la edición (`leaf`), así que la afordancia no puede desalinearse del comportamiento — el propio código lo documenta como ADR-05. Es el patrón a conservar y extender, no a tocar.

### 1.3 La jerarquía de interacción no existe: hay nueve gestos sin orden declarado

| Gesto | Qué hace | Problema |
|---|---|---|
| Clic en chevron | Expandir/colapsar | — |
| Clic en el nombre | Expandir/colapsar | **Compite con el arrastre** (ver abajo) |
| Clic en celda hoja | Editar inline | — |
| Clic en el ícono | Abre el `IconPicker` | Un popover de ≥40 íconos a un clic de distancia del gesto más frecuente |
| Hover en fila | Revela `+` / lápiz / papelera | 3 controles que aparecen y desaparecen |
| Clic en papelera | Confirmación inline `✓`/`✗` | Un cuarto y quinto control en el mismo espacio |
| Arrastre del rótulo | Reparent / promover / degradar | — |
| Arrastre de la manija | Redimensionar la columna | — |
| Enter / Escape / blur | Confirmar / cancelar edición | — |

**El hallazgo concreto:** el rótulo de fila entero es a la vez **superficie de arrastre** (`{...draggable.listeners}` sobre todo el div, con `cursor-grab`) **y** contenedor del nombre clicable, del selector de íconos y de los tres botones de acción. `canDrag = !node.system` es verdadero para prácticamente todos los nodos, así que **toda la columna de categorías dice "arrástrame"** con el cursor, incluso donde el gesto esperado es un clic. La `activationConstraint: { distance: 6 }` evita disparos accidentales, pero no arregla la ambigüedad de la afordancia: el cursor promete una cosa y la mitad de los píxeles hacen otra.

En la misma fila conviven hasta **cinco controles superpuestos en hover** (`+`, lápiz, papelera, y luego `✓`/`✗`), todos de 13 px, sobre una fila de 34 px de alto.

### 1.4 Densidad

- Celda de mes: **108 px**; mes completo (Pres. + Ejec.) **216 px**; los 12 meses ocupan **2 592 px** de scroll horizontal.
- Alto de fila: **34 px**. Tipografía de celda: **0,74 rem ≈ 11,8 px**.
- La columna de categorías es redimensionable y persiste (FR-104).

Esta densidad es **correcta** para el caso de uso: la nota de `FEATURE_IDEA` lo dice — el momento de uso de la grilla es de sesión larga, no de captura rápida. Los productos fintech densos van por ahí. El problema no es la densidad; es que **dentro de esa densidad no hay jerarquía visual**.

---

## Parte 2 — Cómo lo resuelven los productos fintech

Patrones consolidados en herramientas de planeación financiera densa (hojas de presupuesto, terminales de trading, paneles de tesorería, libros contables). No son reglas de moda: son respuestas a la misma restricción que tiene esta grilla — mucho dato numérico, poco espacio, y un usuario que escanea buscando la excepción.

### P1 — La tabla es casi monocroma; el color se reserva para la excepción

**El principio:** el color es el canal perceptual más fuerte de una pantalla. En una tabla densa, si se gasta en decorar categorías, ya no queda nada para señalar lo que exige acción — que es lo único por lo que el usuario abrió la vista.

La regla operativa: **el color codifica ESTADO, no CATEGORÍA.** La categoría ya la dicen el rótulo, la indentación y el ícono. Gastarle color es redundancia cara.

**Aplicado aquí:** retirar `--type-*` de las filas de total y de los íconos de nodo. La grilla queda en `--fg` / `--fg-secondary` / `--fg-muted`, y el color aparece solo donde hay desvío: sobre-consumo y saldo negativo. Es la propuesta que ya estaba preparada el 2026-07-27; el análisis de tokens de §1.1 la respalda con evidencia dura.

**Coste honesto:** se pierde el barrido cromático que hoy permite ubicar de un vistazo dónde empieza el bloque de INGRESOS. Se compensa con separación estructural (la banda `border-t-border-strong` ya existe), peso tipográfico y el ícono del tipo — que **sí** puede conservar color, porque es un elemento único por bloque y no compite con las celdas.

### P2 — Un color, un significado, en toda la superficie

Corolario de P1 y respuesta directa a §1.1. Si el rojo queda reservado a «esto exige tu atención», entonces `--type-expense` desaparece y `--state-over`, `--error-strong` y `--error` pueden **unificarse en un único token de alerta**. Deja de haber cuatro rojos que colisionan: hay uno, y significa una cosa.

Igual con el verde: si deja de significar «esto es un ingreso», puede significar solo «tu saldo está sano».

### P3 — La escala de gravedad se lee sin color

El par ámbar/rojo es un par rojo-verde: indistinguible para ≈1 de cada 12 hombres. **Esto ya está bien resuelto aquí** — `stateGlyph()` emite `›` / `››` indexado por el mismo `BudgetState` que el color, y el código documenta explícitamente por qué (ADR-02: una sola tabla, así el canal redundante no puede contradecir al color). Es un acierto del diseño actual y **no debe perderse en el rediseño** — está protegido como frontera de regresión (FR-402, WCAG 1.4.1).

La oportunidad: si el color se retira de la identidad de tipo, este canal de forma se vuelve **el** portador de gravedad, y puede reforzarse (p. ej. peso tipográfico progresivo) sin competir con nada.

### P4 — Números alineados a la derecha, tabulares, y el cero atenuado

**Ya está hecho** (`tabular`, `justify-end`, `--fg-secondary` para el ejecutado en 0). Se conserva.

Lo que falta es la consecuencia natural: en una tabla densa, **el dato que no aporta debe recéder**. Hoy todas las celdas Pres. tienen el mismo peso visual estén en 0 o no.

### P5 — Un gesto primario por superficie; el resto, progresivo

En productos densos el gesto primario ocupa el área grande y no se comparte. Lo secundario se revela (hover, menú contextual, atajo), y lo destructivo pide confirmación **fuera** del flujo de escaneo.

**Aplicado aquí** — es el arreglo de §1.3: separar el asa de arrastre del cuerpo del rótulo. Un asa explícita (la zona del ícono, o una banda de 12 px a la izquierda) deja el resto del rótulo libre para el clic de expandir, y el cursor deja de mentir. Y los cinco controles en hover piden consolidación: en tablas densas lo habitual es un único `⋯` que abre el menú de fila, o mover renombrar al doble clic sobre el nombre.

### P6 — Congelar la columna de identidad y el encabezado

**Ya está hecho** (columna sticky + encabezados sticky-top + resaltado del mes en foco). Se conserva.

### P7 — Totales que se distinguen por estructura, no por color

Las filas de agregación se separan con superficie, filete y peso — no con tinte. **Aquí ya se hace bien a medias**: `--bg-sunken` marca la estructura y el filete `border-t-border-strong` abre cada bloque. Falta solo retirarles el color, que es P1.

---

## Parte 3 — Qué implicaría, decisión por decisión

### Decisión 1 — ¿Se adopta «el color codifica ESTADO, no CATEGORÍA»?

**A favor:** es la única salida real a §1.1 (cuatro rojos que son el mismo píxel). Reduce ocho sistemas cromáticos a tres: estado (alerta), acento (interacción) y superficie (editabilidad). Es el estándar en la categoría.

**En contra / coste:** toca cuatro features cerradas (`budget-state-color`, `ux-consistency`, `stack-upgrade-theme`, `grid-ux`) y el registro móvil, que propaga el color por tipo como acento dinámico (FR-203). Es la decisión de mayor alcance de la feature.

**Alternativa intermedia:** conservar el color de tipo **solo en el ícono del encabezado de bloque** (tres píldoras en toda la pantalla, no una por fila) y retirarlo de filas, celdas e íconos de nodo. Baja el ruido casi tanto y no rompe la asociación aprendida.

### Decisión 2 — ¿Qué mide y cómo se llama cada tarjeta del resumen?

El choque es real: `DISPONIBLE` (presupuesto de gastos − ejecutado) contra `Saldo disponible` del Balance (saldo anterior + flujo − reservas), en la misma pantalla sin scroll.

Tres caminos:
- **Renombrar** la tarjeta a algo que diga lo que mide: «Presupuesto restante» o «Sin ejecutar». Barato; resuelve el choque sin tocar el cálculo. **Re-deriva FR-016** (sus AC nombran los rótulos actuales).
- **Redefinir** qué mide la tarjeta para que sí sea «cuánta plata tengo», y entonces es el Balance quien queda redundante.
- **Replantear** el resumen entero — es lo que el usuario difirió el 2026-07-27 al decir que estas tarjetas «todavía no están trabajadas a fondo».

Depende de la decisión 1 solo en lo estético; el choque de rótulo es independiente y hay que cerrarlo igual.

### Decisión 3 — El criterio de éxito medible

Candidatos, de más a menos falsable:

1. **Número de significados por color.** Hoy: 4 para el rojo, 3 para el verde. Objetivo: **1 y 1**. Es objetivo, se audita leyendo los tokens y su uso, y ataca exactamente el problema. **Recomendado.**
2. **Gestos ambiguos en la columna de categorías.** Hoy: el rótulo entero es arrastre y clic a la vez. Objetivo: cero superficies con dos gestos primarios.
3. **Tiempo o pasos para una tarea nombrada** (p. ej. «ajustar el presupuesto de tres categorías en tres meses distintos»). Más cercano a «user friendly», pero exige medir un antes — y no hay línea base registrada.
4. **Lista cerrada de fricciones que deben desaparecer.** El menos elegante y el más honesto si no quieres instrumentar nada.

Se pueden combinar: 1 + 2 son verificables por inspección y cubren el núcleo de la queja.

### Decisión 4 — Qué más del front entra

- **Registro móvil:** entra **solo si** se adopta la decisión 1, porque hoy propaga el color de tipo como acento dinámico (FR-203). Si el color de tipo desaparece de la grilla pero se queda en el registro, el producto se contradice.
- **Pantalla de login (BL-011):** independiente del resto. Está sin sistema de diseño y es lo primero que ve un usuario en modo servidor. Barato y de alto impacto; entra o sale sin afectar a nada más.
- **Limpieza:** entra en cualquier caso — es transversal y ya hay dos casos confirmados.

---

## Parte 4 — Lo que este análisis NO decide

- No elige paleta ni tono concreto. Si se adopta la decisión 1, los valores de alerta se derivan de los `--state-*` actuales, que ya cumplen AA en ambos temas (4,85:1 el peor caso) — no hay que reinventarlos.
- No propone cambiar densidad, tipografía ni geometría: están bien para el caso de uso.
- No toca cálculo, reglas de negocio ni modelo de datos.
- No decide si el arrastre se rediseña o solo se le separa el asa: eso es diseño de la Fase 1, una vez cerrado el principio.

---

## Resumen en una línea

La grilla no falla por fea ni por densa: falla porque **le pidió al color que dijera cuatro cosas a la vez, y al rótulo de fila que aceptara dos gestos a la vez**. Las dos son decisiones de asignación de canal, no de estética — y por eso se arreglan decidiendo qué se retira, no qué se añade.
