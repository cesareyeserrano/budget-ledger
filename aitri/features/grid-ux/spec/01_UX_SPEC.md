# UX / Design Spec — Feature grid-ux

> Incremento de UX sobre la página de presupuesto de Ledger (FR-006) + cambio tipográfico global.
> **Diseño provisto = fuente de verdad:** el layout de la grilla se transcribe del mockup
> `idea_context/mockup-budget-desktop-gastos.png` y del prototipo `Ledger (offline).html` ya
> implementados en `src/components/BudgetGrid.tsx` / `DesktopShell.tsx`. Este spec define solo el
> DELTA (lo que se agrega/cambia). Todo lo no mencionado se conserva idéntico.

**Archetype:** PRO-TECH/DASHBOARD — reason: app de finanzas personales con grilla de datos densa (12 meses × jerarquía, roll-ups). Tema oscuro, alta densidad, cifras alineadas. (El archetype solo rige lo no especificado por el diseño provisto.)

---

## Design Tokens

**Color — SIN CAMBIOS.** Se conservan exactamente los tokens del sistema César Augusto (razón: decisión explícita del usuario de NO cambiar la paleta):
`--bg #080c12 · --bg-elevated #0e1520 · --bg-card #131c2a · --primary/--accent #4a7fa5 · --accent-light #7aaac8 · --fg #e8edf5 · --fg-secondary #7aaac8 · --fg-muted #5a7a9a · --border #1a2030 · --border-strong #1e2e42 · --success #10b981 · --warning #f59e0b · --error #ef4444`. Semántica de varianza por tipo (Gasto/Ingreso/Transferencia) sin cambios (FR-008).

**Tipografía — CAMBIA (FR-109).** Razón: el usuario pidió una fuente más legible que el mono Fira Code.
- Familia global `--font-mono` → se reemplaza por **Lexend** (sans, self-hosted vía `next/font/local` o `@font-face` con archivos en el proyecto; CERO peticiones externas, NFR-004/BG-001). Pesos: 300/400/500/600/700. Aplica a TODA la app (escritorio y móvil).
- **Cifras/montos** (KPIs, celdas de la grilla, dashboard, recientes): `font-variant-numeric: tabular-nums` para alineación vertical de un libro contable. Razón: sin mono, los dígitos deben quedar de ancho fijo.
- El resto de la escala (tamaños 0.6rem–1.9rem existentes, espaciado base 4px, radios, sombras, motion con prefers-reduced-motion) se conserva.

**Íconos:** Lucide de línea (Plus, Pencil, Trash2, Check, X, ChevronRight/Down, CornerDownRight). **Cero emoji** (regla dura FR-012). Los 🗑/✎/+ escritos en este spec y en los requisitos son taquigrafía; en el DOM son SVG Lucide.

---

## 2. Pantallas / superficies afectadas

Solo la **página de presupuesto en escritorio** (`DesktopShell` + `BudgetGrid`). La vista móvil (`MobileShell`, solo registro) NO cambia salvo que hereda la fuente global. El Dashboard hereda la fuente global; su layout no cambia.

### 2.1 Barra de navegación (DesktopShell) — FR-105
- La pestaña izquierda cambia su texto visible **“Budget” → “Resumen”** (valor interno `view="budget"` sin cambio). La otra pestaña sigue “Dashboard”.
- Estados de la pestaña: default (texto `--fg-secondary`) · activa (relleno alpha del acento + texto `--accent-light`) · hover (borde/color a `--fg`). Sin cambios de patrón respecto al actual.

### 2.2 Filtro de período (DesktopShell) — FR-106
- El período **por defecto** al primer arranque es **modo “Año”** (agrega todo el ejecutado del año) para que los KPIs no abran en $0. El toggle Mes/Año y el selector de mes siguen funcionando igual; el usuario puede ir a cualquier mes (incluido uno proyectado con ejecutado 0).
- KPIs (Presupuesto·Gastos / Ejecutado / Disponible): sin cambio de layout; solo reflejan el período por defecto con datos.

### 2.3 Grilla (BudgetGrid) — FR-101/102/103/104/108
Estructura existente (transcrita, sin cambios): columna “CATEGORÍA” sticky izquierda + 12 meses × (Pres./Ejec.), filas Tipo→Grupo→Categoría→Subcategoría con chevrons, indentación 16px/nivel, íconos por nivel, edición inline de celdas-hoja. **Deltas:**

- **FR-104 — Ancho de columna redimensionable.** En el borde derecho de la columna “CATEGORÍA” hay una **manija** de 6px de ancho, invisible en reposo, con `cursor: col-resize`; al hover/arrastre muestra un filo de `--accent`. Arrastrar cambia el ancho en vivo, aplicado a TODAS las filas (header, tipos, nodos, adders) y a la posición sticky. Límites [180px, 480px]. El ancho se persiste en `localStorage` clave dedicada `ledger.grid.catWidth.v1`; al cargar se restaura; ausente/corrupto → default 240px. Estados: reposo (manija invisible) · hover (filo acento) · arrastrando (filo acento + `user-select:none` global).
- **FR-103 — Controles de fila en hover, fiables.** El estado `hover` vive en el contenedor de la fila ENTERA (no solo el texto), de modo que mover el cursor del nombre a los botones no los oculta. Los controles se alinean a la derecha de la columna con `margin-left:auto`, `flex:none`, sin empujar ni recortar el nombre (el nombre usa `overflow:hidden;text-overflow:ellipsis`). En reposo (sin hover) los controles no ocupan espacio (`display:none`). Alcanzables por teclado (foco visible, ya provisto por la regla global `:focus-visible`).
- **FR-102 — “+” inline.** En hover, las filas de **grupo** (no-system) y **categoría** (no-system) muestran, ANTES de ✎/🗑, un botón **Plus** (título “Agregar categoría”/“Agregar subcategoría” según nivel). Crea el hijo (categoría bajo grupo, subcategoría bajo categoría), expande el padre e inicia el renombrado inline. La categoría **“Sin asignar” (system) NO** muestra “+” (ni ✎/🗑, ya vigente).
- **FR-101 — Adder “+ Nuevo grupo”.** Al final de cada sección de tipo (tras el último grupo y su adder de categoría) se agrega una fila adder **“+ Nuevo grupo”** (ícono Plus, texto `--fg-muted`, hover `--fg`), a profundidad de grupo (indent 16px). Crea un grupo del tipo e inicia su renombrado inline. Una por cada uno de los 3 tipos.
- **FR-108 — Conector “└” en subcategorías.** Cada fila de subcategoría antepone un conector de árbol (ícono `CornerDownRight`/glifo “└”, `--fg-muted`) a la izquierda del nombre, alineado por su indentación (16px/nivel). Grupos y categorías no lo muestran.

### 2.4 Pie de ayuda (BudgetGrid / DesktopShell) — FR-107
Bajo la grilla (solo escritorio) se agrega un **footer** de dos líneas, `--fg-muted`, tamaño 0.76rem:
- Línea 1 (ayuda de interacción): «Clic en una celda **Pres.**/**Ejec.** para editar · Pasa el cursor sobre una fila para **agregar**, **renombrar** o **eliminar** · Arrastra el borde de la columna para ampliarla.»
- Línea 2 (leyenda de meses): «**Ene–May** ejecutado · **Jun** en curso · **Jul–Dic** proyectado.»
- NO incluye ninguna mención a “reparto/distribución del monto” (función eliminada en D-4). No se renderiza a 375px (móvil).

---

## 3. Estados de los componentes nuevos (default/hover/editing/empty/disabled)

| Componente | default | hover | editing/active | empty | disabled |
|---|---|---|---|---|---|
| Manija de resize (FR-104) | invisible | filo `--accent` | arrastrando: filo acento + no-select | — | — |
| Controles de fila +/✎/🗑 (FR-103) | ocultos (no ocupan espacio) | visibles, ícono `--fg-muted`→`--fg` al hover del botón | 🗑→confirm ✓/✗ inline | — | 'Sin asignar' (system): 0 controles |
| “+” inline (FR-102) | oculto | visible en hover de la fila | al pulsar: crea hijo + rename inline | — | oculto en categorías system |
| Adder “+ Nuevo grupo” (FR-101) | visible, `--fg-muted` | texto `--fg` | al pulsar: crea grupo + rename inline | — | — |
| Pestaña “Resumen” (FR-105) | `--fg-secondary` | `--fg` | activa: acento | — | — |

---

## 4. Responsive

- **Grilla y todos sus controles nuevos (FR-101/102/103/104/107/108):** solo **escritorio** (> breakpoint 760px). A 375px/≤760px la vista sigue siendo únicamente el módulo de registro (FR-010, sin cambios). El pie de ayuda y la manija no existen en móvil.
- **Tipografía Lexend (FR-109):** token **global** — aplica a 375px, 768px y 1440px. El módulo de registro móvil debe renderizar sin desborde con Lexend (regresión NFR-104). Contraste de texto primario ≥ 4.5:1 en todos los tamaños.
- Breakpoints de verificación: 375 (móvil, solo registro con Lexend), 768/1440 (escritorio, grilla + controles + pie).

---

## Nielsen Compliance
- **H2 (lenguaje del usuario):** “Resumen” en español (FR-105); etiquetas de acción en español (“Agregar…”, “Renombrar”, “Eliminar”).
- **H6 (reconocer, no recordar):** los controles +/✎/🗑 son afordancias visibles en hover; el pie de ayuda (FR-107) hace explícitas las interacciones; la manija tiene `cursor: col-resize`.
- **H1 (estado del sistema):** el período por defecto muestra datos reales (FR-106), evitando la pantalla “vacía” $0; el resize se refleja en vivo.
- **H3 (control y libertad):** el borrado mantiene su confirmación inline ✓/✗ (sin cambios); el rename inline se cancela con Escape.
- **H4 (consistencia):** los nuevos adders/controles reutilizan el patrón e íconos ya existentes en la grilla.
- **Accesibilidad:** íconos SVG con `title`/aria-label; foco visible (regla `:focus-visible` global); contraste ≥ 4.5:1 mantenido con Lexend.

---

## User Flows

**Flujo 1 — Crear un grupo desde la grilla (FR-101).**
1. Usuario en escritorio ve, al final de la sección GASTOS, la fila «+ Nuevo grupo».
2. Clic → se crea un grupo de tipo Gasto y su nombre aparece en un input inline con autofocus.
3. Escribe el nombre → Enter confirma (o Escape restaura el nombre por defecto). El grupo queda en la jerarquía y muestra su propio adder «+ Nueva categoría».
- Error/edge: nombre vacío al confirmar → se conserva el nombre por defecto (mismo patrón que el rename actual).

**Flujo 2 — Agregar categoría/subcategoría con “+” inline (FR-102).**
1. Usuario pasa el cursor sobre una fila de grupo (o categoría) → aparecen los controles +/✎/🗑.
2. Clic en “+” → se crea el hijo (categoría bajo grupo, subcategoría bajo categoría), el padre se expande y el nombre del hijo entra en edición inline.
3. Enter confirma. Roll-ups del padre se recalculan (≤150ms, sin cambio de comportamiento).
- Edge: en la categoría “Sin asignar” (system) no hay “+”, así que el flujo no aplica.

**Flujo 3 — Renombrar/eliminar con controles de hover fiables (FR-103).**
1. Usuario pasa el cursor sobre una fila → controles visibles.
2. Mueve el cursor del nombre al botón 🗑 SIN que los controles desaparezcan (hover en la fila entera).
3. Clic 🗑 → confirmación inline ✓/✗. ✓ elimina (o mueve a “Sin asignar” si tiene historial, FR-003/BG-003); ✗ cancela.
- ✎ → input inline; Enter confirma, Escape cancela.

**Flujo 4 — Redimensionar la columna de categorías (FR-104).**
1. Usuario acerca el cursor al borde derecho de la columna “CATEGORÍA” → aparece filo de acento y `cursor: col-resize`.
2. Arrastra → el ancho cambia en vivo (clamp [180,480]px), aplicado a todas las filas.
3. Suelta → el ancho se guarda en `localStorage`. Al recargar, la columna reabre con ese ancho.
- Error/edge: valor persistido ausente/corrupto → default 240px, sin excepción.

**Flujo 5 — Arranque con datos (FR-106).**
1. Usuario abre la app en escritorio → período por defecto “Año” → KPIs (Ejecutado/Disponible) muestran valores > 0.
2. Puede cambiar a Mes y a cualquier mes; los KPIs recalculan por período.

## Component Inventory

| Componente | Ubicación | Tipo | FR | Nota |
|---|---|---|---|---|
| Pestaña “Resumen” | DesktopShell (tabs) | modificado (texto) | FR-105 | “Budget”→“Resumen”; valor interno igual |
| Período por defecto “Año” | DesktopShell/store | modificado (default) | FR-106 | evita KPIs en $0 al arrancar |
| Adder «+ Nuevo grupo» | BudgetGrid (fin de tipo) | nuevo | FR-101 | 1 por tipo; crea grupo + rename inline |
| Botón “+” inline | BudgetGrid (fila grupo/categoría) | nuevo | FR-102 | Lucide Plus; crea hijo; oculto en system |
| Controles de fila +/✎/🗑 | BudgetGrid (rowact) | modificado (hover fiable + alineación) | FR-103 | hover en fila entera; íconos Lucide |
| Manija de resize | BudgetGrid (borde col. categoría) | nuevo | FR-104 | col-resize; clamp [180,480]; persiste |
| Conector “└” | BudgetGrid (fila subcategoría) | nuevo/ajuste | FR-108 | CornerDownRight; solo subs |
| Pie de ayuda | DesktopShell/BudgetGrid (bajo grilla) | nuevo | FR-107 | 2 líneas; solo escritorio; sin “reparto” |
| Fuente global Lexend | globals.css / layout | modificado (token) | FR-109 | self-hosted; cifras tabular-nums; toda la app |
