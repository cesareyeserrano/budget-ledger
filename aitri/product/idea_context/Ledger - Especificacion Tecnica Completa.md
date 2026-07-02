# Ledger — Especificación Técnica y Funcional Completa

> **Audiencia:** equipo de desarrollo. Este documento es la **base inicial de construcción**. Reúne (a) el diseño funcional por módulo, (b) los estilos y tokens CSS exactos, (c) todos los comportamientos e interacciones, (d) el modelo de datos, (e) los controles configurables ("tweaks"), y (f) un plan por fases y decisiones abiertas.
>
> **Naturaleza del entregable:** viene de un prototipo funcional de alta fidelidad construido con el sistema de diseño **César Augusto** (tema oscuro, tipografía mono). Las **reglas de cálculo** son la implementación de referencia del prototipo — funcionan, pero el equipo de discovery puede refinarlas (ver §12).
>
> **Moneda / idioma del prototipo:** COP, español. La UI usa español; el código y los identificadores, inglés.

---

## 1. Visión general

Ledger es una app de finanzas personales para registrar movimientos de dinero contra un presupuesto. Es **una sola aplicación responsive** con dos presentaciones de los mismos datos y conceptos:

- **Móvil** (`≤ 760px` de ancho): herramienta de captura diaria. Pantalla principal = registrar movimiento; presupuesto de un mes operable; indicadores condensados.
- **Escritorio** (`> 760px`): herramienta de planeación y análisis. Grilla de presupuesto de 12 meses con columnas presupuestado/ejecutado, edición en línea, CRUD de categorías y dashboard completo.

El breakpoint es único (`760px`) y alterna entre dos "shells" (§8). Datos, reglas y persistencia son idénticos entre ambos.

---

## 2. Fundamentos visuales (sistema de diseño César Augusto)

Tema oscuro único, sin modo claro. Tipografía **mono en todo**. **Bordes sobre rellenos.** Sin gradientes, sin glassmorphism, sin glow, sin emoji.

### 2.1 Tokens de color (CSS custom properties)

```css
:root{
  /* Superficies (elevación por reversión de oscuridad: más claro = más alto) */
  --bg:            #080c12;  /* shell de la app (más profundo) */
  --bg-elevated:   #0e1520;  /* overlays, inputs, chips, encabezados de grilla */
  --bg-card:       #131c2a;  /* tarjetas, panel derecho */
  --bg-card-hover: #182030;  /* tarjeta en hover */

  /* Acento (uno solo por defecto) */
  --primary:       #4a7fa5;  /* foco de input, acento primario */
  --accent:        #4a7fa5;  /* = primary (acento único) */
  --accent-light:  #7aaac8;  /* texto secundario / acento suave */

  /* Texto */
  --fg:            #e8edf5;  /* texto primario, títulos */
  --fg-secondary:  #7aaac8;  /* descripciones, etiquetas */
  --fg-muted:      #5a7a9a;  /* eyebrow, contadores, placeholder */

  /* Bordes */
  --border:        #1a2030;
  --border-strong: #1e2e42;
  --border-hover:  #253a50;

  /* Semántico */
  --success:       #10b981;  /* ingreso favorable */
  --warning:       #f59e0b;  /* ingreso por debajo del plan */
  --error:         #ef4444;  /* gasto sobre presupuesto */
}
```

**Uso semántico del color por tipo de movimiento** (ver §4.4):
- **Gasto** → `--error` (`#ef4444`) para "sobre presupuesto".
- **Ingreso** → `--success` (`#10b981`) favorable, `--warning` (`#f59e0b`) por debajo del plan.
- **Transferencia** → `--accent-light` (`#7aaac8`), neutro.

Los colores semánticos con relleno usan alpha: p. ej. sobre-presupuesto con énfasis "bold" usa `rgba(239,68,68,0.16)` de fondo + texto `#fecaca`; ingreso favorable `rgba(16,185,129,0.14)`; por debajo `rgba(245,158,11,0.14)`.

### 2.2 Tipografía

```css
--font-mono: 'Fira Code', 'Courier New', monospace;  /* todo el producto */
--line-height: 1.5;
--letter-spacing: -0.01em;  /* global; -0.02/-0.03em en tamaños display */
```

Import: `https://fonts.googleapis.com/css2?family=Fira+Code:wght@300..700&display=swap`.

Escala tipográfica usada (rem):
- Título de app "Presupuesto 2026": `1.4rem` / peso 450.
- Eyebrow "LEDGER": `0.62rem` / peso 700 / `letter-spacing:0.18em` / `--fg-muted`.
- KPI numérico grande: `1.35rem` / peso 300.
- Monto héroe (registro móvil): `3rem` / peso 300 / `letter-spacing:-0.04em`.
- Celdas de grilla: `0.74rem`, números con `font-variant-numeric: tabular-nums`.
- Encabezados de mes: `0.76rem` / peso 500.
- Sub-encabezados "Pres."/"Ejec.": `0.6rem` / `--fg-muted`.
- Etiquetas de sección (eyebrow): `0.58–0.62rem` / `letter-spacing:0.1–0.14em`.

Pesos: `300` light, `400` regular, `450` headline (intencional, no redondear), `500` medium, `600` semibold, `700` bold.

### 2.3 Espaciado, radios, sombras

```css
/* Espaciado base 4px */
--space-1:.25rem; --space-2:.5rem; --space-3:.75rem; --space-4:1rem;
--space-5:1.25rem; --space-6:1.5rem; --space-8:2rem; --space-10:2.5rem; --space-12:3rem;

/* Radios (no mezclar por tipo de elemento) */
--radius-sm:8px; --radius-md:12px; --radius-lg:16px; --radius-full:9999px;

/* Sombras (rgba negro puro, sin glow) */
--shadow-sm:0 1px 2px rgba(0,0,0,.3);
--shadow-md:0 4px 12px rgba(0,0,0,.4);
--shadow-lg:0 8px 30px rgba(0,0,0,.5);
```

Aplicación: contenedor de app con `--shadow-lg` y `--radius` 14px; tarjetas `--radius-md`; chips/inputs `--radius-sm`; pastillas de contacto `--radius-full`.

### 2.4 Motion

```css
--duration-fast:120ms; --duration-normal:160ms; --duration-slow:400ms;
--ease-snap: cubic-bezier(0.16,1,0.3,1);   /* paneles, hojas */
--ease-soft: cubic-bezier(0.22,1,0.36,1);
```

Reglas: micro-interacciones (hover/focus) ≤160ms `ease`; entradas de presencia (panel, hoja, pantalla) hasta ~320–400ms. Animaciones concretas del prototipo:
- Panel de movimiento (escritorio) entra con `slideIn` (translateX 20px→0 + opacity), `0.3s ease-snap`.
- Pantallas móviles entran con `mvScreenIn` (translateY 8px→0 + opacity), `0.26s ease`.
- Hoja inferior / overlay: `sheetUp` translateY 101%→0, `0.32s ease-snap`, con backdrop `rgba(0,0,0,0.6)` plano (sin blur).
- Toasts: fade-in `0.2–0.24s`, autodescarte a ~1.9–2.1s.
- Barras (adherencia, top categorías): transición de `width` 250–300ms.
- **Respetar `prefers-reduced-motion`**: desactivar todas las duraciones (`animation/transition: 0.001ms`).

### 2.5 Reglas duras del sistema
- **Fondo siempre sólido.** Sin gradientes, patrones ni texturas.
- **Bordes hacen el trabajo:** el hover cambia el color de borde, no el fondo (salvo estados explícitos de selección con relleno alpha del acento).
- **Sin emoji en ninguna superficie.** Íconos = línea, 1.5–2px, `currentColor`, 13–20px.
- Scrollbars finas y oscuras (track `--bg`, thumb `--border-strong`).

---

## 3. Modelo de datos

### 3.1 Entidades

**Nodo de jerarquía** (`node`):
```
{ id, type, level, parentId, name, icon }
  type:   'expense' | 'income' | 'transfer'   (fijo)
  level:  'group' | 'category' | 'sub'
  parentId: id del padre | null (grupos)
  name:   string
  icon:   nombre de glifo (categoría/grupo) | null (subcategoría)
```

**Presupuestado** (`budgets`): mapa `nodeId → { mesKey → monto }`, solo para **hojas**.
**Ejecutado** (`actuals`): mapa `nodeId → { mesKey → monto }`, solo para **hojas**.
**Movimiento** (`movement`): `{ id, type, catId, subId|null, target, amount, month }` — `target` = subId si existe, si no catId.

Claves de mes: `ene, feb, mar, abr, may, jun, jul, ago, sep, oct, nov, dic` (12).

### 3.2 Jerarquía (3 niveles editables bajo 3 tipos fijos)

```
Tipo (fijo: Gasto / Ingreso / Transferencia)
└── Grupo            ("Esenciales", "Estilo de vida", "Trabajo"…)
    └── Categoría      ("Comida", "Vivienda", "Transporte"…)
        └── Subcategoría ("Mercado", "Restaurantes", "Café"…)
```

- Grupo contiene Categorías. Categoría contiene Subcategorías **o** es hoja por sí misma.
- Subcategoría siempre es hoja. **"Hoja"** = nivel más bajo que almacena montos.
- Categoría/Grupo/Tipo **no** almacenan montos; se calculan por roll-up (§4.1).

### 3.3 Persistencia (prototipo)
`localStorage`, tres claves:
- `ledger.nodes.v1` — la jerarquía (compartida con la pantalla de Categorías).
- `ledger.budget.v2` — `{ budgets, actuals, movements }`.

> **Para producción:** definir backend, sincronización multi-dispositivo, autenticación, manejo de múltiples monedas y multi-año. El prototipo asume single-user, single-currency, single-year.

### 3.4 Datos semilla (para demo/QA)
Al primer arranque (sin datos guardados) se genera una jerarquía semilla determinística y montos dummy por hoja/mes: Ene–May "ejecutados", Jun en curso, Jul–Dic proyectados (ejecutado = 0). Ingresos con base mayor que gastos; transferencias intermedias. Sirve solo como estado inicial demostrable; producción parte vacío o de onboarding.

---

## 4. Reglas de negocio (implementación de referencia)

### 4.1 Roll-up (agregación de abajo hacia arriba)
```
Subcategoría → Categoría → Grupo → Tipo
```
- Presupuestado/Ejecutado de una Categoría por mes = suma de sus hojas descendientes.
- Grupo = suma de sus categorías; Tipo = suma de todas sus hojas.
- Editar una hoja recalcula todos los ancestros al instante.
- **Detalle de implementación:** el *presupuestado* de un nodo padre agrega solo sus **hojas** (`leafDescendants`); el *ejecutado* agrega **todo el subárbol** (`subtreeIds`) — así un ejecutado registrado directamente en una categoría-hoja o en cualquier nivel se contabiliza.


### 4.3 CRUD de categorías + reasignación al borrar
- **Crear** grupo/categoría/subcategoría; al crear la primera subcategoría de una categoría-hoja, sus montos se **trasladan** a esa primera subcategoría para que los totales no caigan.
- **Renombrar** cualquier nodo (edición en línea).
- **Borrar:**
  - Hoja sin movimientos → borra directo.
  - **Categoría con movimientos** → exige **reasignar** los movimientos a una categoría hermana (mismo tipo) antes de borrar; no se pierde historial.
  - **Grupo con categorías** → **bloqueado** hasta mover/eliminar las categorías. *(D-2 refina el guardrail exacto.)*
  - Al borrar un subárbol se eliminan también sus entradas en `budgets`/`actuals`.

### 4.4 Tipo / signo / varianza
| Tipo | Signo | Color base | Regla de varianza |
|---|---|---|---|
| Gasto | `−` | `--error` | Ejecutado > Presupuestado ⇒ **sobre presupuesto** (alerta). |
| Ingreso | `+` | `--success` / `--warning` | ≥ presupuesto = favorable (`success`); < presupuesto = bajo (`warning`). |
| Transferencia | `↔` | `--accent-light` | Neutro; sin juicio de sobre/bajo. |

### 4.5 Registro de movimiento
Al guardar: suma `amount` al **Ejecutado** de la hoja destino (`target`) en el mes elegido, recalcula roll-ups, agrega el movimiento al log y muestra toast de confirmación.

---

## 5. Módulo: Gestión de categorías

**Qué hace.** Construir y mantener la jerarquía Tipo → Grupo → Categoría → Subcategoría de la que dependen todos los demás módulos. (Pantalla móvil independiente en el prototipo; en el módulo de presupuesto el CRUD está embebido, §7.)

**Contenido y layout.**
- Selector de los **tres tipos fijos**; cada uno con su **ícono de tipo** a la izquierda (flecha-abajo gasto, flecha-arriba ingreso, intercambio transferencia).
- Lista expandible de **Grupos**. Cada fila de grupo: **chevron** (izq.) para expandir · **ícono carpeta** · nombre con ordinal dos dígitos ("01 — Esenciales") · meta ("N categorías") · a la derecha **lápiz** (editar) y **papelera** (borrar).
- **Categorías** (al expandir grupo): chevron · **ícono de categoría** (glifo elegible) · nombre · **insignia** opcional "N movs" cuando hay movimientos · lápiz · papelera.
- **Subcategorías** (al expandir categoría): **ícono rama/hoja** · nombre · lápiz · papelera.
- Acciones **"agregar"** con **ícono +** al final de cada nivel: "Nueva subcategoría", "Nueva categoría", "Nuevo grupo".

**Estilos clave.** Filas = tarjetas `--bg-card`, borde `--border`, radio `--radius-md`; en hover cambia solo el borde a `--border-hover`. Insignia = pastilla `--radius-full` con color del tipo. Formulario de crear/editar = hoja inferior (`sheetUp`) con input de nombre (borde inferior 2px del color del tipo) y, para categorías, selector horizontal de ícono.

**Comportamientos.** Crear (abre hoja con nombre + ícono para categorías) · renombrar · borrar (flujo §4.3) · expandir/colapsar en cada nivel. Persiste en `ledger.nodes.v1`.

---

## 6. Módulo: Registro de movimientos ("Registrar")

**Qué hace.** Captura un movimiento. En **móvil es la pantalla principal**; en escritorio es un **panel lateral opcional**.

**Contenido.**
- **Monto héroe** arriba, precedido por el **signo** del tipo activo (`3rem`, peso 300).
- Selector de **tres tipos** (cada uno con ícono). Cambiar tipo reacota categorías.
- **Selector de categoría** (chips con scroll horizontal en móvil; `<select>` en escritorio), cada opción con su ícono.
- **Selector de subcategoría** (aparece solo si la categoría tiene subcategorías).
- **Selector de mes** (default = mes en curso).
- **Teclado numérico** (móvil): dígitos, tecla "000" y tecla **retroceso (⌫)**. En escritorio se escribe directo.
- Botón **"Guardar movimiento"** (deshabilitado si monto=0 o sin categoría; habilitado toma color del tipo con relleno alpha).
- **Movimientos recientes**: ícono de categoría · nombre · meta (tipo · cuándo) · monto con signo y color del tipo.

**Estilos.** Teclas del teclado: `--bg-card`, borde `--border`, radio `--radius-sm`, `1.2rem`; en `:active` fondo `--bg-elevated`. Campo de monto con borde inferior 2px del color del tipo. Chips de categoría seleccionados: fondo alpha del color del tipo + borde del tipo + texto del tipo.

**Comportamientos.** Elegir tipo → categoría → (opcional) subcategoría → mes → monto → **Guardar** ⇒ suma al Ejecutado (§4.5), limpia el monto, muestra toast, prepende a recientes.

---

## 7. Módulo: Presupuesto — Escritorio

**Qué hace.** Muestra plan vs realidad a lo ancho del año y permite editar plan y ejecutado en el lugar.

### 7.1 Estructura

**Encabezado de app**: eyebrow "LEDGER" + título "Presupuesto 2026"; a la derecha, leyenda (Presupuestado / Ejecutado / Sobre presupuesto) y botón **"Nuevo movimiento"** (abre/cierra el panel lateral).

**Barra de controles**:
- Toggle **Mes / Año** (segmentado).
- Cuando "Mes": **selector de mes** (default mes en curso).
- Etiqueta de alcance ("Junio 2026" / "Año 2026").
- Toggle de vista **Resumen / Dashboard**.

**Franja de indicadores (Resumen)** — mínimo 3, gobernados por el filtro Mes/Año:
1. **Total presupuestado** (gastos) — color `--fg`.
2. **Ejecutado** con **% del presupuesto** — color `--accent-light`.
3. **Disponible** (presupuesto − ejecutado) — `--success` si ≥0, `--error` si negativo.

**Grilla** (construida con **divs flex**, no `<table>` — requisito para que sobreviva empaquetado a un solo archivo y para control fino de sticky):
- **Columna de Categoría fija** (sticky izquierda, 240px): fila de **total por Tipo**, luego Grupos → Categorías → Subcategorías, expandible en cada nivel. Indentación por profundidad (16px por nivel); **chevron** para expandir; **ícono de nivel** (tipo / carpeta / glifo / rama).
- **12 columnas de mes** con scroll horizontal; encabezados de mes y sub-encabezados **sticky top**. El mes del filtro se **resalta** (`--accent-light`) en su encabezado.
- Cada mes = **2 sub-columnas: Presupuestado y Ejecutado** (ancho `108px` cada una en modo cómodo).
- Filas de **total por Tipo** con fondo `--bg-elevated`, texto en color del tipo, peso 600–700, no editables ni con acciones.
- **Filas "agregar"** (ícono +) al final de cada nivel: nueva subcategoría / categoría / grupo, directo en la grilla.
- Al **hover** sobre una fila de nodo aparecen sus **acciones**: **+** (agregar hijo, solo categorías) · **lápiz** (renombrar) · **papelera** (borrar).

### 7.2 Comportamientos
- **Editar Presupuestado**: clic en celda Pres. de categoría o subcategoría → input; padres distribuyen (§4.2). Enter confirma, Escape cancela, blur confirma.
- **Editar Ejecutado**: clic en celda Ejec. (misma mecánica) — alternativa en grilla al panel de movimientos.
- **CRUD inline** (agregar/renombrar/borrar) sincronizado con el store de categorías.
- **Filtro Mes/Año** afecta **solo las tarjetas de resumen**; la grilla **siempre** muestra los 12 meses.
- **Panel "Nuevo movimiento"** (opcional): mismo formulario del §6 como panel lateral (`slideIn`), con lista de registrados en la sesión.

### 7.3 Estilos de celda
- Borde de fila: `1px solid var(--border)`; separador entre meses: `2px solid var(--border-strong)` (borde izquierdo de la sub-columna Pres.).
- Pres.: texto `--fg-muted`, alineado a la derecha, tabular-nums.
- Ejec.: color por varianza (§4.4). Con énfasis "bold" (tweak, §9): fondo alpha + texto claro + peso 600.
- Encabezados y columna sticky con fondo `--bg-elevated`.

---

## 8. Módulo: Dashboard ("Indicadores")

**Qué hace.** Convierte los datos de presupuesto en salud financiera. Respeta el filtro Mes/Año.

**Conjunto mínimo de indicadores** (el *tipo* de visualización es decisión de diseño; aquí solo el indicador y su semántica):
1. **Ingresos** (ejecutado) con referencia de presupuestado.
2. **Gastos** (ejecutado) con referencia de presupuestado.
3. **Balance neto** (ingresos − gastos), positivo/negativo.
4. **Tasa de ahorro** (balance neto / ingreso, %). Umbrales de color: ≥20% `--success`, ≥0% `--warning`, <0 `--error`.
5. **Adherencia del presupuesto de gastos**: % ejecutado del presupuesto, con sentido "por debajo / cerca / por encima" (umbrales de referencia: >100% `--error`, >85% `--warning`, resto `--accent-light`) + barra de progreso.
6. **Top categorías de gasto**: lista rankeada mayor→menor con barras proporcionales.
7. **Sobre presupuesto**: categorías cuyo Ejecutado excede Presupuestado, con cuánto (+monto) y %; estado vacío claro ("todo dentro del presupuesto") cuando no hay ninguna.

**Apoyo (deseable, no mínimo):** tendencia mensual ingreso-vs-gasto a lo largo del año (en el prototipo, mini-barras por mes con el mes activo resaltado).

**Estilos.** Tarjetas `--bg-card` + borde `--border` + `--radius-md`. KPIs numéricos peso 300. Barras sobre pista `--bg-elevated`, radio `--radius-full`.

---

## 9. Responsive: Móvil vs Escritorio

Breakpoint único: **`max-width: 760px`** activa el shell móvil; por encima, el de escritorio. Mismo componente, mismos datos y reglas.

| Área | Móvil (≤760px) | Escritorio (>760px) |
|---|---|---|
| **Pantalla principal** | Registrar movimiento (inicio). | Grilla de presupuesto completa. |
| **Navegación** | Barra inferior: **Registrar · Presupuesto · Indicadores**, cada uno con ícono. | Toggle Resumen/Dashboard + panel de movimiento opcional. |
| **Presupuesto** | **Un mes a la vez** (selector de mes en el header). Jerarquía = tarjetas apiladas con barra de progreso y Pres./Ejec. por nodo. | **12 meses** con scroll horizontal, sub-columnas Pres./Ejec., columna de categoría + encabezados sticky. |
| **Editar valores** | Tocar Pres./Ejec. del nodo (mismas reglas). | Clic en cualquier celda Pres./Ejec. |
| **Captura de movimientos** | Pantalla principal con teclado numérico. | Panel lateral opcional. |
| **CRUD categorías** | Íconos +/lápiz/papelera en cada tarjeta. | Inline en la grilla (aparecen en hover) + filas "agregar". |
| **Dashboard** | Tarjetas de indicadores apiladas (2 columnas). | Indicadores + visuales de apoyo lado a lado. |
| **Filtro de periodo** | Implícito (móvil es de un mes por naturaleza). | Toggle Mes/Año; afecta solo tarjetas de resumen. |

**Nota de implementación:** el shell móvil se muestra/oculta con reglas `@media (max-width:760px)` que alternan `display` entre los contenedores `.lx-desktop` y `.lx-mobile`. Ambos leen el mismo estado/props.

---

## 10. Inventario de íconos (línea, `currentColor`, 13–20px)

| Ícono | Dónde | Significado / acción |
|---|---|---|
| Flecha abajo/salida | Selectores de tipo | Tipo **Gasto**. |
| Flecha arriba/entrada | Selectores de tipo | Tipo **Ingreso**. |
| Intercambio | Selectores de tipo | Tipo **Transferencia**. |
| Chevron (der/abajo) | Izq. de filas expandibles | Expandir / colapsar. |
| Carpeta | Filas de grupo | Nodo Grupo (contenedor). |
| Glifo de categoría (elegible: comida, casa, auto, salud, ocio, bolsa, laptop, banco, alcancía, tendencia…) | Filas y chips de categoría | Identidad de la categoría; se elige al crear/editar. |
| Rama / hoja | Filas de subcategoría | Nivel más bajo. |
| Más (+) | Filas "agregar", hover de categoría, "Nuevo movimiento" | Crear nodo / iniciar movimiento. |
| Lápiz | Acciones de fila (hover) | Renombrar. |
| Papelera | Acciones de fila (hover) | Borrar (dispara flujo §4.3). |
| Check / X | Confirmación de borrado inline | Confirmar / cancelar. |
| Retroceso (⌫) | Teclado numérico móvil | Borrar último dígito. |
| Calendario | Selectores de periodo/mes | Acotar por mes/año. |
| Tendencia (↗) | Nav inferior (Indicadores), glifos | Ir al dashboard / categoría de crecimiento. |
| Cerrar (X) | Panel de movimiento, hojas/overlays | Descartar. |

Reglas: 1.5–2px de trazo, sin relleno, sin chip de fondo. **Sin emoji.**

---

## 11. Controles configurables (Tweaks)

El prototipo expone tres controles que **reconfiguran la sensación** del módulo de presupuesto (declarados como props del componente; en producción pueden mapear a preferencias de usuario o quedar fijos según diseño):

| Control | Opciones | Efecto |
|---|---|---|
| **Acento** (`accent`) | 4 swatches: `#4a7fa5` acero (default), `#2f9e8f` teal, `#c8873f` ámbar, `#7d6ad1` violeta | Sobrescribe `--accent` / `--accent-light` / `--primary` en todo el árbol: selección, foco, mes resaltado, barras, enlaces. |
| **Densidad** (`density`) | `comfortable` (default) / `compact` | Reconfigura alto de fila, padding de celdas y ancho de columnas numéricas (108→92px) — de "superficie de planeación" a "hoja de cálculo densa". |
| **Énfasis de varianza** (`varianceEmphasis`) | `subtle` (default) / `bold` | `subtle` = solo color de texto en Ejec.; `bold` = rellena la celda Ejec. con fondo alpha (rojo sobre-presupuesto, verde/ámbar ingreso) + peso 600, para escaneo analítico rápido. |

> **Para desarrollo:** son props del componente raíz. Si producción no quiere exponerlos como preferencias, tomar `comfortable` + `subtle` + acento acero como valores base del sistema de diseño.

---

## 12. Decisiones abiertas para discovery

- **D-1 — Tipos fijos vs dinámicos.** Prototipo: los 3 tipos son **fijos**, jerarquía editable debajo (seguro ante regresiones). Alternativa: eje superior = grupos definidos por el usuario que declaran su signo. **Impacta el modelo de datos.**
- **D-2 — Reasignación / guardrails al borrar.** Confirmar: reasignación forzada a hermana (propuesto) vs archivar/soft-delete vs cascada; y bloqueo vs cascada para grupos no vacíos.
- **D-3 — Editar Ejecutado directo.** ¿El ejecutado se **deriva solo de movimientos** (edición deshabilitada) o sigue editable en grilla? Si editable, cómo concilia con el log de movimientos.
- **D-4 — Distribución proporcional.** Validar el reparto por proporciones vs bloquear padres vs otra estrategia.
- **D-5 — Vínculo Movimiento ↔ presupuesto.** Confirmar log único de punta a punta (móvil + escritorio), incluyendo ediciones y borrados de movimientos.
- **D-6 — Periodos, moneda, proyección.** Multi-año, multi-moneda, y cómo se determina "proyectado" vs "ejecutado".
- **D-7 — Reordenar.** Drag-and-drop de grupos/categorías/subcategorías (no está en el prototipo).
- **D-8 — Movimientos a nivel subcategoría.** Confirmar asignación directa a subcategoría (prototipo lo permite) y su interacción con presupuestos a nivel categoría.

---

## 13. Plan de desarrollo por fases

Secuencial; cada fase es entregable de forma independiente.

**Fase 0 — Fundamentos.** Fijar modelo de datos (§3), resolver **D-1** y **D-6**, establecer backend/persistencia y el shell responsive (breakpoint 760px, §9). Cargar tokens del sistema de diseño (§2).

**Fase 1 — Captura (MVP móvil).** Pantalla Registrar (§6): tipo, categoría, subcategoría opcional, mes, monto, guardar. Lectura de jerarquía + creación mínima. Lista de recientes. *Resultado:* registrar movimientos reales en el teléfono.

**Fase 2 — Gestión de categorías (CRUD completo).** Crear/renombrar/borrar en 3 niveles con íconos (§5), reasignación al borrar y guardrails (**D-2**), sincronización entre superficies. *Resultado:* el usuario es dueño de su taxonomía.

**Fase 3 — Presupuesto.** Móvil un mes (tarjetas con progreso, edición inline, roll-ups) y escritorio grilla 12 meses (sub-columnas, sticky, scroll horizontal, distribución **D-4**, CRUD inline). Resolver **D-3** y **D-5**. Franja de indicadores mínimos. *Resultado:* plan vs realidad editable en ambos dispositivos.

**Fase 4 — Dashboard.** Los 7 indicadores mínimos (§8) respetando el filtro Mes/Año, más visual de tendencia si se valida. *Resultado:* salud financiera de un vistazo.

**Fase 5 — Mejoras (post-MVP).** Drag-reorder (**D-7**), multi-año, multi-moneda, exportación, tweaks como preferencias (§11), indicadores adicionales.

---

*Base inicial de construcción. Las reglas de cálculo (§4) son la implementación de referencia del prototipo; discovery las valida y refina antes de desarrollo definitivo.*
