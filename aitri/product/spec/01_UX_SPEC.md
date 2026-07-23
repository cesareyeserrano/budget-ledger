# UX / Design Spec — Ledger (T-Ledger)

**Archetype:** PRO-TECH/DASHBOARD — reason: app web de datos financieros densos (grilla de 12 meses, roll-ups, dashboard) para un usuario que planea y analiza; encaja con dark-first, alta densidad y tipografía monoespaciada. **Sin embargo, el diseño está PROVISTO por el cliente** (sistema de diseño "César Augusto" + mockups + prototipo HTML), que es la fuente de verdad y **anula** cualquier default del arquetipo. Este spec TRANSCRIBE ese diseño; el arquetipo solo llena lo que el diseño provisto no especifica.

> Fuente de verdad: `idea_context/Ledger (offline).html` (**prototipo funcional — punto de partida del código**, desempacado y estudiado: CSS `:root`, DOM completo desktop/mobile, y su JS de referencia con roll-up/seed/edición), `idea_context/Ledger - Especificacion Tecnica Completa.md` (§2 tokens, §5–§8 módulos), y los mockups `mockup-dashboard.png`, `mockup-budget-desktop-gastos*.png`. Los tokens fueron **verificados contra el `:root` real del prototipo** (coinciden exacto). Los comportamientos son transcripción del prototipo, salvo las **divergencias intencionales v1** listadas al final (decisiones del cliente que se apartan del prototipo).

**Regla de plataforma (v1):** es una APP WEB responsive con un único breakpoint de **760px**.
- **Pantalla pequeña (≤760px):** SOLO el módulo Registrar (versión compacta). No se renderiza grilla ni dashboard.
- **Pantalla grande (>760px):** app completa — Presupuesto (grilla 12 meses) + Dashboard + panel Registrar. Navegación por toggle Resumen/Dashboard y botón "Nuevo movimiento".

---

## User Flows

### Flujo A — Registrar un movimiento (persona: Dueño de finanzas) · FR-001
- **Entry point:** móvil ≤760px = pantalla de inicio (única vista); escritorio = botón "Nuevo movimiento" abre el panel lateral.
- **Pasos:**
  1. El usuario ve el selector de 3 tipos (Gasto/Ingreso/Transferencia); por defecto Gasto. Elegir tipo reacota las categorías al tipo activo y fija signo/color.
  2. Elige categoría (chips con scroll horizontal en móvil; `<select>` en escritorio). Si la categoría tiene subcategorías, aparece el selector de subcategoría; si no, no se muestra.
  3. Elige mes (default = mes en curso).
  4. Escribe el monto en un **input estándar** (NO teclado numérico ad-hoc). El monto se muestra grande arriba precedido del signo del tipo.
  5. Pulsa "Guardar movimiento".
- **Exit point:** el movimiento se suma al Ejecutado de la hoja destino en el mes, se recalculan roll-ups, se limpia el monto a 0 y aparece un toast (~2s). (BL-003: sin lista de "recientes".)
- **Error / prevención:** el botón "Guardar" está **deshabilitado** mientras monto=0 o no hay categoría (H5 error prevention). El input rechaza no-numéricos y negativos; si el usuario intenta un valor inválido, el campo no lo acepta y el botón permanece deshabilitado (mensaje inline "Ingresa un monto mayor a 0").

### Flujo B — Gestionar categorías (CRUD 3 niveles) (persona: Dueño de finanzas) · FR-002
- **Entry point:** escritorio, inline en la grilla (filas "+"/hover) o en el árbol del panel izquierdo; los 3 tipos fijos como eje.
- **Pasos:** crear grupo → crear categoría dentro → crear subcategoría (opcional); renombrar en línea; el CRUD alimenta los selectores de Registrar filtrados por tipo.
- **Edge:** al crear la primera subcategoría de una categoría-hoja, sus montos se trasladan a esa subcategoría (los totales no caen).
- **Exit point:** jerarquía persistida; totales por roll-up.
- **Error path:** los Tipos y la categoría "Sin asignar" no exponen acciones de renombrar/borrar (H3/H5). Intentar renombrar con nombre vacío → se rechaza y se conserva el nombre previo.

### Flujo C — Borrar categoría con historial (persona: Dueño de finanzas) · FR-003
- **Entry point:** icono papelera en la fila de una categoría (hover en grilla).
- **Pasos:** el usuario confirma el borrado (confirmación explícita, H3). Si la categoría tiene movimientos, **no se destruye**: se convierte en subcategoría dentro de "Sin asignar" del mismo grupo, con sus movimientos agrupados.
- **Exit point:** "Sin asignar" (del grupo) aparece con la ex-categoría como subcategoría; cero huérfanos.
- **Error path:** borrar un Grupo que aún contiene categorías → **bloqueado** con mensaje "Mueve o elimina primero las categorías de este grupo" (H9: dice qué hacer). Borrar una hoja sin movimientos → se elimina directo.

### Flujo D — Reorganizar por arrastrar-y-soltar (persona: Dueño de finanzas) · FR-015
- **Entry point:** escritorio; una subcategoría (incl. las que quedaron en "Sin asignar") con affordance de arrastre (cursor grab).
- **Pasos:** el usuario arrastra la subcategoría; los destinos válidos (categorías/grupos del **mismo tipo**) se resaltan en ≤100ms; suelta sobre una categoría → se vuelve su subcategoría; suelta en zona de grupo → se promueve a categoría nueva.
- **Exit point:** nodo reubicado, movimientos viajan con él, roll-ups de origen y destino recalculados en ≤150ms; "Sin asignar" se vacía a medida que se reubica su contenido.
- **Error path:** soltar sobre un Tipo, un Grupo (como grupo), o una categoría de otro tipo → drop rechazado (sin resalte, cursor "no permitido"), la jerarquía queda intacta.

### Flujo E — Editar presupuesto/ejecutado en la grilla (persona: Dueño de finanzas) · FR-006, FR-004
- **Entry point:** escritorio, grilla de 12 meses.
- **Pasos:** clic en una celda **de hoja** (subcategoría o categoría-hoja) Pres. o Ejec. → input inline. Enter/blur confirma; Escape cancela. Los ancestros se recalculan por roll-up en ≤150ms. (D-3: el Ejecutado es editable en grilla como override manual además de derivarse de movimientos.)
- **Exit point:** valor persistido; totales de ancestros actualizados.
- **Error path:** celdas de nodo padre (categoría con hijos, grupo, tipo) muestran total por roll-up y **no** abren input (clic no hace nada editable). Valor no numérico en el input → se descarta al confirmar y se conserva el valor previo.

### Flujo F — Leer el dashboard (persona: Dueño de finanzas / Revisor) · FR-009
- **Entry point:** escritorio, toggle "Dashboard".
- **Pasos:** ver 7 indicadores; alternar filtro Mes/Año recalcula sobre el periodo.
- **Exit point:** lectura; sin mutación de datos.
- **Empty state:** "Sobre presupuesto" sin excesos → "Todo dentro del presupuesto en este periodo".

### Flujo G — Primer arranque (persona: Dueño de finanzas / Revisor) · FR-013, FR-011
- **Entry point:** abrir la app sin datos previos.
- **Pasos:** se genera jerarquía semilla + montos dummy (Ene–May ejecutado, Jun en curso, Jul–Dic proyectado=0). El usuario opera sin configurar.
- **Error path (persistencia):** si el localStorage está corrupto (JSON inválido), la app se recupera al estado semilla sin pantalla en blanco (H9), sin exigir acción al usuario.

---

## Component Inventory

> Estados por componente: **default · loading · error · empty · disabled**. En una app localStorage síncrona, "loading" es típicamente instantáneo (skeleton solo en el arranque/hidratación); se documenta igual.

### Pantalla: Registrar (móvil compacto + panel escritorio) — FR-001
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Selector de tipo (3 toggles con ícono) | default (Gasto activo) · disabled (n/a) · error (n/a) · empty (n/a) · loading (n/a) | Cambia tipo → reacota categorías, fija signo/color del tipo | H4 consistencia, H6 reconocimiento |
| Monto héroe + input | default (0) · error (no-numérico/negativo rechazado, borde --error + hint) · disabled (n/a) · empty (=0) · loading (n/a) | Input estándar; muestra signo del tipo; borde inferior 2px del color del tipo | H5 prevención, H1 estado |
| Selector de categoría (chips móvil / select escritorio) | default · empty ("crea una categoría") · disabled (sin tipo) · error (n/a) · loading (skeleton al hidratar) | Chip seleccionado: fondo alpha + borde + texto del tipo | H6, H2 lenguaje del usuario |
| Selector de subcategoría | default · empty (oculto si la categoría no tiene subs) · disabled · error (n/a) · loading | Aparece solo si la categoría tiene subcategorías | H8 minimalista |
| Selector de mes | default (mes en curso) · disabled · empty (n/a) · error (n/a) · loading | 12 meses | H6 |
| Botón "Guardar movimiento" | default · **disabled (monto=0 o sin categoría)** · loading (guardando, instantáneo) · error (n/a) · empty (n/a) | Habilitado toma color del tipo con relleno alpha | H5, H1 |
| Toast de confirmación | default (visible ~2s) · resto n/a | Fade-in 0.2s, autodescarte ~2s; respeta reduced-motion | H1 |

### Pantalla: Presupuesto — grilla escritorio — FR-006, FR-004, FR-008
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Barra de controles (toggle Mes/Año, selector de mes, toggle Resumen/Dashboard) | default (Mes, mes en curso) · disabled · empty (n/a) · error (n/a) · loading | Filtro afecta solo tarjetas de resumen; la grilla siempre muestra 12 meses | H4, H7 |
| Franja de indicadores (Presupuestado / Ejecutado %/ Disponible) | default · empty (montos 0) · loading (skeleton) · error (n/a) · disabled (n/a) | Disponible: --success si ≥0, --error si <0 | H1 |
| Columna categoría sticky (240px) | default · empty ("sin categorías, crea una") · loading · error (n/a) · disabled (n/a) | Filas Tipo→Grupo→Categoría→Subcategoría; chevron expandir; indent 16px/nivel | H6, H4 |
| Celda Pres./Ejec. de HOJA | default · editing (input inline) · error (valor inválido → descarta) · empty (— o 0) · disabled (celda de padre = no editable) | Clic abre input; Enter/blur confirma; Escape cancela; Ejec. colorea por varianza | H3 (Escape=undo), H5 |
| Fila de total por Tipo | default (no editable, sin acciones) · resto n/a | Fondo --bg-elevated, texto color del tipo, peso 600–700 | H8 |
| Acciones de fila (hover: + / lápiz / papelera) | default (ocultas) · hover (visibles) · disabled (en filas de Tipo y en "Sin asignar": sin renombrar/borrar) · error (n/a) · empty (n/a) | + agregar hijo (solo categorías); lápiz renombrar; papelera borra (Flujo C) | H3, H6 |
| Filas "+" (nuevo grupo/categoría/subcategoría) | default · disabled · resto n/a | CRUD inline directo en grilla | H7 |
| Nodo arrastrable (drag handle) | default (grab) · dragging (fantasma + drop targets resaltados ≤100ms) · invalid-drop (cursor no permitido) · disabled (grupos/tipos no arrastrables) · error (drop rechazado, sin cambios) | Reubica subcategorías/categorías (FR-015) | H3, H1 |
| Categoría "Sin asignar" (por grupo) | default (oculta) · **visible solo con datos** · disabled (no renombrar/borrar; montos sí editables) · error (n/a) · loading | Recibe categorías borradas como subcategorías | H2, H9 |

### Pantalla: Dashboard — escritorio — FR-009
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| KPI cards (Ingresos, Gastos, Balance neto, Tasa de ahorro) | default · empty (0 / "sin datos") · loading (skeleton) · error (n/a) · disabled (n/a) | Tasa de ahorro colorea por umbral (≥20% success, ≥0 warning, <0 error) | H1, H2 |
| Ejecución mensual (barras ingreso vs gasto) | default · empty ("sin movimientos este año") · loading · error (n/a) · disabled (n/a) | Mes activo resaltado; barras transición width 250–300ms | H1 |
| Adherencia de gastos (% + barra) | default · empty (0%) · loading · error (n/a) · disabled (n/a) | Umbrales >100% error, >85% warning, resto accent | H1 |
| Top categorías de gasto | default · **empty ("sin gastos registrados")** · loading · error (n/a) · disabled (n/a) | Ranking mayor→menor con barras proporcionales | H8 |
| Sobre presupuesto | default (lista +monto/%) · **empty ("Todo dentro del presupuesto en este periodo")** · loading · error (n/a) · disabled (n/a) | Solo categorías con Ejec.>Pres. | H1, H9 |

### Global
| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Shell responsive | móvil (≤760px: solo Registrar) · escritorio (>760px: app completa) · loading (hidratación) · error (recupera a semilla) · empty (semilla) | Conmutación por CSS @media; mismo estado/datos | H4 |
| Confirmación de borrado inline (check / X) | default · disabled · resto n/a | Confirmar/cancelar acción destructiva | H3 |

---

## Nielsen Compliance

**Registrar:** H1 (toast + monto se limpia, feedback ≤1s) · H2 (Gasto/Ingreso/Transferencia, "Guardar movimiento", lenguaje del usuario) · H5 (botón deshabilitado si inválido; input rechaza negativos) · H6 (labels en cada campo, chips visibles) · H8 (subcategoría solo si aplica). Trade-off: sin teclado numérico ad-hoc (decisión de plataforma web) — se acepta usar el input nativo.

**Presupuesto (grilla):** H3 (Escape cancela edición = undo; borrado con confirmación) · H4 (misma mecánica de edición en toda celda-hoja) · H5 (celdas de padre no editables evitan errores de reparto; validación de input) · H6 (íconos de nivel, chevrons, acciones en hover con affordance) · H7 (edición inline en un clic). Trade-off: acciones en hover (menos descubribles en touch) — aceptable porque la grilla es solo escritorio.

**Drag-and-drop (FR-015):** H1 (drop targets resaltados ≤100ms, feedback de arrastre) · H3 (soltar fuera de destino válido cancela sin cambios) · H5 (destinos inválidos no se resaltan → previene el error) · H9 (cursor "no permitido" comunica por qué). Trade-off: interacción avanzada; se complementa con el CRUD/menú como camino alterno.

**Dashboard:** H1 (indicadores responden al filtro) · H2 (nombres de indicadores en lenguaje financiero simple) · H8 (solo lo relevante del periodo) · H9 (empty states explican el estado, no una pantalla vacía).

**Global/Persistencia:** H4 (mismos datos móvil/escritorio) · H9 (recuperación de estado corrupto a semilla, sin pantalla en blanco) · H10 (semilla al primer arranque actúa como onboarding operable sin configurar).

---

## Design Tokens

> Verificados VERBATIM contra el `:root` real del prototipo `Ledger (offline).html` (líneas 77–83) y la spec §2. Autoridad: diseño provisto por el cliente. No improvisar estética; el desarrollador implementa exactamente estos tokens.
>
> **Nota de fidelidad (verificada en el prototipo):** el `:root` del prototipo declara SOLO los colores + `--radius-sm/md/lg`. El espaciado (`--space-*`), las sombras (`--shadow-*`), `--radius-full`, y el motion (`--duration-*`, `--ease-*`) NO son variables en el prototipo: están **inline** (p. ej. contenedor de app `border-radius:14px; box-shadow:0 8px 30px rgba(0,0,0,.5)`; animaciones `@keyframes slideIn` (desktop, `translateX(20px)`), `@keyframes mvScreenIn` (mobile, `translateY(8px)`, 0.26s), `fadeIn` para toasts). La spec §2 los formaliza como tokens; se recomienda implementarlos como CSS custom properties (mantenibilidad), con **los mismos valores** del prototipo. La regla `@media (prefers-reduced-motion: reduce){*{animation/transition-duration:0.001ms!important}}` existe literal en el prototipo (línea 111).

### Color roles
```css
:root{
  /* Superficies (elevación por reversión: más claro = más alto) */
  --bg:            #080c12;  /* background — shell de la app (más profundo) */
  --bg-elevated:   #0e1520;  /* surface — overlays, inputs, chips, encabezados de grilla */
  --bg-card:       #131c2a;  /* surface — tarjetas, panel derecho */
  --bg-card-hover: #182030;  /* surface — tarjeta en hover */

  /* Acento (único por defecto: acero) */
  --primary:       #4a7fa5;  /* primary — foco de input, acento primario */
  --accent:        #4a7fa5;  /* accent = primary */
  --accent-light:  #7aaac8;  /* accent suave — texto secundario/transferencias */

  /* Texto */
  --fg:            #e8edf5;  /* text-primary */
  --fg-secondary:  #7aaac8;  /* text-secondary — descripciones, etiquetas */
  --fg-muted:      #5a7a9a;  /* text-muted — eyebrow, contadores, placeholder */

  /* Bordes (el trabajo lo hacen los bordes, no los rellenos) */
  --border:        #1a2030;  /* border */
  --border-strong: #1e2e42;  /* border — separadores de mes */
  --border-hover:  #253a50;  /* border — hover de fila/tarjeta */

  /* Semántico */
  --success:       #10b981;  /* ingreso favorable / disponible ≥0 */
  --warning:       #f59e0b;  /* ingreso por debajo del plan */
  --error:         #ef4444;  /* gasto sobre presupuesto / disponible <0 */
}
```
Semántica por tipo: **Gasto** → `--error`; **Ingreso** → `--success` (favorable) / `--warning` (bajo); **Transferencia** → `--accent-light` (neutro). Énfasis "bold" de varianza usa alpha: sobre-presupuesto `rgba(239,68,68,0.16)` + texto `#fecaca`; ingreso favorable `rgba(16,185,129,0.14)`; bajo `rgba(245,158,11,0.14)`. **En v1 los tweaks quedan fijos: acento acero + densidad comfortable + varianza subtle.**

**Contraste (razón):** `--fg #e8edf5` sobre `--bg #080c12` ≈ 15:1 (≥4.5:1 ✓). `--accent-light #7aaac8` sobre `--bg` ≈ 6.7:1 (✓ texto). `--fg-muted #5a7a9a` sobre `--bg` ≈ 4.0:1 → usar SOLO para texto grande/UI (≥3:1), no para body <18px. Colores semánticos sobre `--bg`: success ≈ 6.5:1, warning ≈ 8.9:1, error ≈ 4.9:1 (✓). Sin gaps para body salvo `--fg-muted`, restringido a large/UI.

### Type scale (font family rationale)
```css
--font-mono: 'Fira Code', 'Courier New', monospace;  /* mono en TODO el producto — decisión del sistema César Augusto: números tabulares, aire técnico */
--line-height: 1.5;
--letter-spacing: -0.01em; /* global; -0.02/-0.03em en display */
```
Escala (rem): título app 1.4/450 · eyebrow 0.62/700 (ls 0.18em, muted) · KPI grande 1.35/300 · monto héroe 3/300 (ls -0.04em) · celdas grilla 0.74 (tabular-nums) · encabezado mes 0.76/500 · sub-encabezado Pres./Ejec. 0.6/muted · etiquetas sección 0.58–0.62 (ls 0.1–0.14em). Pesos: 300/400/450/500/600/700. Import Fira Code `wght@300..700`.

### Spacing / radios / sombras / motion
```css
/* Espaciado base 4px */
--space-1:.25rem; --space-2:.5rem; --space-3:.75rem; --space-4:1rem; --space-5:1.25rem;
--space-6:1.5rem; --space-8:2rem; --space-10:2.5rem; --space-12:3rem;
/* Radios (no mezclar por tipo de elemento) */
--radius-sm:8px; --radius-md:12px; --radius-lg:16px; --radius-full:9999px;
/* Sombras (rgba negro puro, SIN glow) */
--shadow-sm:0 1px 2px rgba(0,0,0,.3); --shadow-md:0 4px 12px rgba(0,0,0,.4); --shadow-lg:0 8px 30px rgba(0,0,0,.5);
/* Motion */
--duration-fast:120ms; --duration-normal:160ms; --duration-slow:400ms;
--ease-snap:cubic-bezier(0.16,1,0.3,1); --ease-soft:cubic-bezier(0.22,1,0.36,1);
```
Aplicación: app `--shadow-lg`, radio 14px; tarjetas `--radius-md`; chips/inputs `--radius-sm`; pastillas `--radius-full`. Reglas duras: fondo siempre sólido (sin gradientes/patrones); hover cambia **borde**, no fondo; **sin emoji**; íconos de línea 1.5–2px `currentColor` 13–20px (Lucide); scrollbars finas oscuras. **`prefers-reduced-motion`: todas las duraciones a 0.001ms.**

### Responsive (breakpoints por pantalla)
- **375px (móvil):** SOLO Registrar. Monto héroe, selectores apilados, chips de categoría con scroll horizontal, botón full-width. Sin grilla ni dashboard en el DOM visible. Sin desbordes.
- **768px (tablet):** app completa (shell escritorio, ya que >760px). Grilla con scroll horizontal, panel Registrar como lateral opcional; dashboard en 2 columnas.
- **1440px (desktop):** grilla 12 meses con columna categoría sticky (240px) + encabezados sticky-top; dashboard lado a lado; panel Registrar (slideIn) opcional.
- **Boundary 760px:** exactamente 760px = shell móvil (solo Registrar).

---

## D-3 (decisión de diseño registrada)
El **Ejecutado** en la grilla del escritorio es **editable a mano (override manual)** además de derivarse de los movimientos capturados — consistente con FR-006 (celdas de hoja Pres./Ejec. editables) y con el prototipo (`commitEdit` edita `actuals` de una hoja). Un override manual fija el valor de la celda-hoja; los movimientos posteriores se siguen sumando sobre ese valor. (Si en Fase 2/arquitectura se decide derivar exclusivamente de movimientos, deshabilitar la edición de Ejec. y anotarlo.)

## Divergencias intencionales vs. el prototipo (decisiones v1)
El prototipo `Ledger (offline).html` es el punto de partida del código, PERO estas decisiones del cliente (v1) se apartan de él a propósito. Quien construya desde el HTML debe aplicar estos cambios:

| # | Prototipo (offline.html) | v1 (implementar así) | FR |
|---|---|---|---|
| 1 | Móvil tiene 3 pantallas + nav inferior (`mNav`: Registrar/Presupuesto/Indicadores, línea 1306) | Móvil (≤760px) muestra **SOLO Registrar**; presupuesto y dashboard son de escritorio. No renderizar `mIsPresupuesto`/`mIsDashboard` ni la nav inferior en v1 | FR-010, FR-007(elim.) |
| 2 | Registrar móvil usa **teclado numérico** (`.mkey`, grid 3col, monto héroe 3rem) | **Sin teclado ad-hoc**: input estándar de formulario web para el monto | FR-001 |
| 3 | Editar la celda de un **padre distribuye** proporcionalmente a las subs (`commitEdit`, rama `else`, líneas 874–882; el último hijo absorbe el redondeo) | **Sin distribución**: solo se editan celdas de **hoja**; los padres son de solo lectura (roll-up). Eliminar la rama de distribución | FR-004, FR-005(elim.) |
| 4 | Borrado de categoría (esquema original del prototipo) | Categoría con movimientos → se convierte en **subcategoría de "Sin asignar"** (una **por grupo**; auto, no renombrable/borrable, montos editables, visible solo con datos) | FR-003 |
| 5 | Sin arrastrar-y-soltar | **Drag-and-drop** para reubicar (reparent) subcategorías/categorías a categorías o grupos del mismo tipo; mecanismo para vaciar "Sin asignar" | FR-015 |
| 6 | App web de escritorio + móvil como shells del mismo bundle | Igual (una app web responsive); no es app nativa | FR-010 |

## Detalles de referencia verificados en el prototipo (para Fase 2/4)
Transcritos del JS de referencia del prototipo — úsense como base de la lógica de dominio (respetando las divergencias de arriba):
- **Roll-up:** `budget(nodo)` = Σ sobre `leafDescendants` (solo hojas); `actual(nodo)` = Σ sobre `subtreeIds` (todo el subárbol, incluye montos puestos directo en una categoría-hoja). Ver `cellSums` (prototipo).
- **isLeaf:** `sub` siempre es hoja; `category` es hoja si no tiene hijos.
- **Persistencia:** claves `ledger.nodes.v1` (jerarquía) y `ledger.budget.v2` (`{budgets, actuals, movements}`); montos solo en hojas.
- **Semilla determinista (`genBudget`):** presupuesto base por hoja según `type` y `hash(id)` redondeado a 10.000; ejecutado = base × factor-mes × jitter, con factores `{ene:0.96, feb:1.07, mar:0.86, abr:1.14, may:0.91, jun:0.55, jul..dic:0}` (Ene–May ejecutado, Jun en curso, Jul–Dic proyectado=0). Sin aleatoriedad real (todo por hash).
- **Crear 1ª subcategoría de una categoría-hoja:** trasladar los montos de la categoría a la nueva sub para que los totales no caigan.
- **Edición de hoja:** `commitEdit` fija `Math.max(0, round(valor))` en `budgets`/`actuals` de la hoja; persiste. (En v1, esta es la ÚNICA rama; se descarta la de distribución a padres.)
- **Formato:** `toLocaleString('es-CO')`, prefijo `$`; valor 0 se muestra como `—` en la grilla.
