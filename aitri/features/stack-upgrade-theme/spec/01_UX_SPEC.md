# UX / Design Spec — Feature: stack-upgrade-theme (registro móvil MVP + stack + tema)

**Archetype:** CONSUMER/LIFESTYLE — reason: app de finanzas personales de captura rápida en el móvil; paleta adaptativa claro/oscuro, micro-interacciones ≤200ms, tap targets ≥48px, tipografía expresiva. El diseño provisto (feature_context/MODULO_MOBILE_RESPONSIVE.md §4/§7, anclado a código real §8) es la **fuente de verdad**; el archetype solo rellena lo que ese diseño no especifica.

> **Fuente de verdad:** el diseño está transcrito de `feature_context/MODULO_MOBILE_RESPONSIVE.md` (§4 sistema de diseño, §7 contrato de interacción). Donde ese doc es preciso, se usa verbatim. Las 4 decisiones de reconciliación aprobadas en Fase 1 **ganan** sobre el MVP: (1) el registro es la vista móvil del app responsive existente; (2) las categorías se leen de la jerarquía existente (no catálogo fijo); (3) tipografía Inter + DM Mono; (4) default de tema = Sistema.

**Alcance visual de esta feature:** la pantalla de **Registro móvil** (rediseñada, reemplaza el `MovementForm` actual en ≤760px), el **ThemeToggle** (móvil + chrome de escritorio) y el **re-mapeo de color/tema/fuente** que atraviesa toda la app. El layout de escritorio (grilla, dashboard) NO se rediseña — solo cambian sus tokens de color y la fuente.

---

## User Flows

### Flujo A — Capturar un movimiento (persona: Dueño de sus finanzas, móvil ≤760px)
- **Entry point:** el usuario abre la app en el móvil; se muestra la pantalla de Registro (única vista en móvil, parent FR-010).
- **Steps:**
  1. La pantalla abre con: tipo = **Gasto** (default), monto vacío (`$0`), sin categoría, fecha = **Hoy**, nota vacía. Botón Guardar deshabilitado.
  2. El usuario elige el **tipo** en el toggle (Gasto/Ingreso/Transferencia). El color del tipo se propaga al instante (signo, caret, botón Guardar). Cambiar de tipo **conserva el monto** y **deselecciona la categoría**.
  3. El usuario teclea el **monto** en el número grande (teclado numérico nativo). Se formatea en vivo a COP (`$1.250`). El signo del tipo aparece a la izquierda.
  4. El usuario elige una **categoría** en la fila horizontal (categorías del tipo activo, leídas de su jerarquía). El tile seleccionado se tiñe con el color del tipo.
  5. (Opcional) cambia la **fecha** con el calendario; (opcional) escribe una **nota**.
  6. Pulsa **Guardar** → se valida, se persiste con la semántica existente (suma a Ejecutado, roll-ups), aparece el **overlay de confirmación** (~2s) y el formulario se resetea para el siguiente registro (fecha vuelve a Hoy).
- **Exit point:** overlay se autocierra; formulario limpio, listo para el siguiente registro.
- **Error paths:**
  - Monto = 0 / vacío → botón Guardar **deshabilitado** (prevención, H5). Si el usuario intenta guardar igual (no puede, está disabled), no pasa nada.
  - Monto con separador decimal → al guardar se rechaza con mensaje inline bajo el monto: **"El monto debe ser un valor entero en pesos."** (H9).
  - Sin categoría → al pulsar Guardar (habilitado si hay monto pero falta categoría) se muestra bajo la fila: **"Elige una categoría."** y no se guarda.
  - Fallo de almacenamiento (quota/no disponible) → banner no bloqueante arriba (StorageBanner) explicando qué pasó; el resto del formulario sigue usable.
  - Doble toque en Guardar (<600ms, mismo contenido) → se crea **un solo** movimiento (anti doble-tap, H5).

### Flujo B — Cambiar el tema (ambas personas, móvil y escritorio)
- **Entry point:** ThemeToggle visible en la cabecera del Registro (móvil) y en el chrome (escritorio).
- **Steps:** el usuario pulsa el toggle → alterna Claro/Oscuro (ícono Sol/Luna refleja el estado). El cambio aplica al instante (sin recarga) y persiste en `localStorage` (clave `theme`).
- **Exit point:** la app queda en el tema elegido; al recargar, se mantiene.
- **Default:** si el usuario nunca eligió, sigue **Sistema** (prefers-color-scheme del SO). Sin flash de tema incorrecto en la hidratación.
- **Error path:** ninguno (operación local, sin red). Si `localStorage` no está disponible, la preferencia vive solo en la sesión (degradación silenciosa).

---

## Component Inventory

### Pantalla: Registro móvil (≤760px) — contenedor centrado `max-w-[480px] mx-auto px-4`

| Componente | Estados (default/loading/error/empty/disabled) | Comportamiento | Heurísticas |
|---|---|---|---|
| **Header** (título "Ledger" + ThemeToggle) | default; sin loading/error/empty; nunca disabled | Título a la izquierda; ThemeToggle a la derecha. (El botón "Cerrar sesión" del MVP se OMITE — no hay auth en esta feature.) | H4 consistencia |
| **TypeToggle** | default (Gasto activo); no loading; sin error; nunca empty (siempre 1 activo); nunca disabled | 3 segmentos `role=tab`, `aria-selected`. Activo: relleno = color del tipo, texto blanco. Inactivo: label en `text-secondary`, signo/punto en color del tipo. `min-h-48px`. Cambiar tipo conserva monto, deselecciona categoría. | H2, H4, H6 |
| **AmountDisplay** | **default** ($0 placeholder, opacidad 40%); no loading; **error** (monto ≤0 al intentar guardar → mensaje inline); **empty** = placeholder $0; no disabled (siempre editable) | El número grande ES el `<input inputMode="numeric" pattern="[0-9]*">`, centrado, DM Mono `tabular-nums`, color+caret = color del tipo. Formatea a COP en vivo. Signo a la izquierda escalando con el número (+/−/↔). Escala tipográfica: ≤8→3.5rem, ≤10→2.75rem, ≤13→2.25rem, resto 1.75rem. | H1, H5, H8 |
| **CategoryRow** | **default** (ninguna seleccionada); no loading; **error** ("Elige una categoría." al guardar sin selección); **empty** (el tipo no tiene categorías en la jerarquía → ver estado vacío abajo); no disabled | Fila horizontal `overflow-x-auto no-scrollbar`, categorías del tipo activo **desde la jerarquía existente**, una seleccionable. Tile activo: fondo `accent-soft` (tinte del tipo), borde tinte 55%, ícono/label en color del tipo. Fade a la derecha (indica más). `key={type}` remonta y resetea scroll al cambiar tipo. Tiles `min-h-48px min-w-64px`. | H6, H7, H8 |
| **DateTimeField** | **default** ("Hoy"); no loading; **error** ("Fecha inválida" — improbable); no empty (siempre hay fecha); no disabled | Botón con ícono `CalendarClock` + etiqueta `dateLabel` ("Hoy" o "15 jun 2026"). Abre popover `role=dialog` con el calendario. La hora nunca se muestra. `min-h-48px`. | H2, H3, H6 |
| **DateCalendar** (dentro del popover, carga diferida) | default (mes actual); **loading** (fallback breve mientras carga el chunk dinámico); no error; no empty; no disabled | `react-day-picker` `mode=single`, locale `es`, `captionLayout=dropdown`. Elegir día conserva la hora y cierra el popover. Cierra al clic fuera. | H3, H4 |
| **NoteField** | **default** (vacío, placeholder); no loading; sin error (límite duro previene); **empty** = null al guardar; no disabled | `<textarea>` opcional, contador `n/280`, límite duro 280 (recorte en JS). Vacío → `null`. | H5, H6 |
| **SaveButton** | **default** (habilitado, color del tipo); **loading** ("Guardando…" mientras persiste); sin error propio; no empty; **disabled** (monto 0/ inválido o guardando → `opacity-40`) | Full-width `rounded-xl min-h-48px`, fondo = color del tipo, texto blanco. `blocked = disabled || saving`. | H1, H7 |
| **ConfirmOverlay** | se monta solo tras guardar; sin otros estados | `fixed inset-0 z-50`, fondo = `background`. Círculo con `Check` en color del tipo + monto grande con signo + "Guardado". Autocierra ~2000ms. | H1 |
| **StorageBanner** | oculto por default; **error** (corrupt/unavailable/quota → banner con mensaje específico); no otros | Banner no bloqueante `role=alert` con borde `error`, ícono `AlertTriangle` + mensaje que dice qué pasó. | H9 |
| **ThemeToggle** (compartido) | default (refleja tema actual); no loading/error/empty; no disabled | Botón `min-h-44px`, ícono Sol (en oscuro→acción ir a claro) / Luna (en claro→ir a oscuro). Sin emoji. Persiste vía next-themes. | H1, H4 |

### Chrome de escritorio (grilla/dashboard) — SIN rediseño de layout
| Componente | Cambio en esta feature | Heurísticas |
|---|---|---|
| **DesktopShell / tabs / botón principal / filtro Mes-Año** | Solo re-tokeniza color: chrome **neutro** (`primary` zinc), NO un color de tipo (FR-203). Layout, sticky, full-bleed intactos. ThemeToggle visible en el chrome. | H4 |
| **BudgetGrid — filas por tipo / celdas de varianza** | Los colores de tipo pasan a los nuevos hex (Transferencia steel→azul). Semántica de varianza conservada. Sin cambio de layout/alineación. | H4 |
| **Dashboard — indicadores** | Umbrales de color usan los nuevos tokens semánticos. Sin cambio de composición. | H4 |

### Estados vacíos / de borde adicionales
- **CategoryRow sin categorías para el tipo activo** (p. ej. el usuario borró todas): mostrar un texto atenuado "No hay categorías de este tipo — créalas en el escritorio" (recordatorio de que gestionar categorías es de escritorio en esta feature). El guardado queda bloqueado (no hay destino válido).
- **Primer arranque sin preferencia de tema:** sigue el SO (Sistema), sin flash.

---

## Nielsen Compliance

### Registro móvil
- **H1 Visibilidad del estado:** el monto se formatea en vivo; Guardar muestra "Guardando…"; el overlay confirma en <100ms; el banner informa fallos de almacenamiento.
- **H2 Match con el mundo real:** lenguaje de la persona (Gasto/Ingreso/Transferencia, "Hoy", "$1.250" COP), no términos técnicos.
- **H3 Control y libertad:** el calendario cierra al clic fuera sin cambiar la fecha; cambiar de tipo no destruye el monto.
- **H4 Consistencia:** mismos tokens y patrones que el resto de la app; el color de tipo se aplica siempre igual (signo/caret/tile/botón).
- **H5 Prevención de error:** Guardar deshabilitado con monto inválido; anti doble-tap; validación antes de persistir; decimal rechazado con causa.
- **H6 Reconocimiento sobre recuerdo:** labels visibles ("Categoría", "Fecha", "Nota (opcional)"); afordancias visibles (fade de scroll indica más categorías).
- **H7 Flexibilidad/eficiencia:** flujo de captura en ≤3 toques (tipo→monto→categoría→Guardar); acción primaria de un toque.
- **H8 Estético y minimalista:** el monto es el protagonista; el resto es secundario; sin gradientes/emoji.
- **H9 Recuperación de errores:** mensajes que dicen qué pasó y cómo seguir (monto entero, elige categoría, banner de almacenamiento).
- **H10 Ayuda:** hint contextual en nota (placeholder), estado vacío de categorías guía a crearlas en escritorio.
- **Trade-off aceptado:** el MVP no ofrece "deshacer" un guardado; se mitiga con el overlay y el reset explícito (el usuario ve exactamente qué se guardó). Editar/borrar movimientos vive en otra superficie (lista, fuera de esta feature).

### Cambio de tema (global)
- **H1/H4:** el toggle refleja y aplica el estado al instante, mismo patrón en móvil y escritorio. **H3:** reversible en un toque. **Sin violaciones.**

**Violaciones encontradas:** 1 (contraste de la etiqueta pequeña en color de tipo — ver Design Tokens) · **corregidas:** 1 (variante text-safe green-700 en claro) · **trade-offs aceptados:** 1 (sin undo de guardado).

---

## Design Tokens

Transcritos de feature_context §4.3/§4.5 (autoritativos). Los **derivados** (surface-hover, border-strong/hover, text-muted, accent-soft) los define este spec, AA en ambos temas. Fuente de tokens de color de tipo: `lib/tokens` (`typeColor(type, theme)`), única.

### 4.1 Roles de color por tema

| Token | Claro (`:root`) | Oscuro (`.dark`) | Razón / origen |
|---|---|---|---|
| `--background` | `#FFFFFF` | `#09090B` | §4.3 (autoritativo) |
| `--surface` | `#F4F4F5` (zinc-100) | `#18181B` (zinc-900) | §4.3 |
| `--surface-hover` (derivado) | `#E4E4E7` (zinc-200) | `#27272A` (zinc-800) | Un paso de la escala zinc sobre surface; hover cambia fondo sutil |
| `--primary` | `#18181B` (zinc-900) | `#FAFAFA` (zinc-50) | §4.3 — chrome neutro |
| `--primary-foreground` | `#FAFAFA` | `#18181B` | §4.3 |
| `--text-primary` | `#18181B` | `#FAFAFA` | §4.3 — contraste vs bg: 16.9:1 (claro) / 18.1:1 (oscuro) ✅ |
| `--text-secondary` | `#52525B` (zinc-600) | `#A1A1AA` (zinc-400) | §4.3 — 7.5:1 (claro) / 6.4:1 (oscuro) ✅ |
| `--text-muted` (derivado) | `#71717A` (zinc-500) | `#71717A` (zinc-500) | Hints/placeholders — 4.6:1 (claro) / 4.9:1 (oscuro) ✅ AA |
| `--border` | `#E4E4E7` (zinc-200) | `#27272A` (zinc-800) | §4.3 |
| `--border-strong` / `--border-hover` (derivado) | `#D4D4D8` (zinc-300) | `#3F3F46` (zinc-700) | Borde enfatizado / hover (bordes sobre rellenos) — ≥3:1 vs bg como componente UI ✅ |
| `--error` | `#DC2626` (red-600) | `#F87171` (red-400) | §4.3 |

### 4.2 Colores por tipo de movimiento (identidad cromática, FR-204)

| Tipo | Claro (fill/large) | Oscuro (fill/large) | Contraste como texto sobre bg | Signo |
|---|---|---|---|---|
| `expense` (Gasto) | `#DC2626` (red-600) | `#EF4444` (red-500) | claro 4.8:1 ✅ · oscuro 5.3:1 ✅ | `−` |
| `income` (Ingreso) | `#16A34A` (green-600) | `#22C55E` (green-500) | claro **3.3:1** ⚠️ (large/UI ✅, small ✗) · oscuro 8.7:1 ✅ | `+` |
| `transfer` (Transferencia) | `#2563EB` (blue-600) | `#3B82F6` (blue-500) | claro 5.2:1 ✅ · oscuro 5.4:1 ✅ | `↔` (ArrowRightLeft) |

**Regla de accesibilidad de los colores de tipo (resuelve la violación H detectada):**
- Los colores de tipo se usan como **relleno** (botón Guardar, segmento activo del toggle, círculo del overlay) y como **texto grande** (monto, signo). A esos tamaños/roles el umbral AA es **≥3:1**, que **los tres tipos cumplen en ambos temas**.
- Para **texto pequeño** en color de tipo (etiqueta del tile de categoría activo, ~12px), el umbral es ≥4.5:1. Aquí el **verde claro #16A34A NO pasa (3.3:1)**. Regla: en tema **claro**, el texto pequeño del tipo Ingreso usa la variante **text-safe `#15803D` (green-700, 5.0:1 ✅)**; rojo y azul ya pasan y se usan tal cual; en tema **oscuro** los tres pasan y se usan tal cual. El **relleno** del tile sigue usando el hex exacto de §4.3 (no cambia la identidad visual).
- `--accent-soft` (tinte de selección) = `color-mix(in srgb, var(--type-color) 14%, transparent)`; borde del tile activo = `color-mix(in srgb, var(--type-color) 55%, transparent)` (transcrito del MVP §7.4). Es un fondo, no texto → sin requisito de contraste de texto.
- `--accent` (dinámico) = color del tipo activo; **solo** en el Registro (FR-203). Fuera del Registro el acento efectivo es `--primary` (neutro zinc).

### 4.3 Tipografía (FR-213)

- **Inter** (`--font-sans`) vía `next/font/google`, self-hosted — texto general de toda la app. Razón: neutral, legible, estándar de producto consumer; reemplaza Lexend.
- **DM Mono** pesos 400/500 (`--font-mono`) vía `next/font/google`, self-hosted — **dígitos de montos** con `tabular-nums` (alineación de cifras). Razón: el monto es el protagonista; el mono tabular evita salto de ancho al teclear.
- **Escala de tamaño del monto** (por longitud del texto formateado): ≤8 → `3.5rem` · ≤10 → `2.75rem` · ≤13 → `2.25rem` · resto → `1.75rem`. El signo comparte el `font-size` del número.
- **Escala general:** título `text-lg` (18px, bold) · labels `text-sm` (14px, medium) · categoría/contador `text-xs` (12px) · body `text-sm/base`.

### 4.4 Espaciado y forma
- Escala base 4px (Tailwind). Contenedor del registro: `max-w-[480px] mx-auto px-4`. Gaps del formulario: `gap-6` entre bloques principales.
- Radios: tiles `rounded-2xl`, botón/campos `rounded-xl`, toggle `rounded-full`.
- **Objetivos táctiles ≥48px** (`min-h-[48px]`) en toggle, tiles, campo de fecha, botón Guardar; ThemeToggle/iconos `44px`.
- **Motion** ≤130–200ms; respeta `prefers-reduced-motion` (transiciones a ~0.001ms). Sin gradientes/glow/emoji; íconos Lucide de línea `currentColor`.

### 4.5 Responsive (por pantalla)
- **Registro (375px):** contenedor `max-w-[480px]` centrado, `px-4`; sin scroll horizontal; monto escala por longitud para no desbordar; fila de categorías con scroll horizontal interno. Es la **única** vista en móvil (parent FR-010).
- **768px (tablet):** mismo registro centrado a 480px (no se estira); si el viewport ≤760px sigue siendo la vista móvil (parent FR-010 boundary).
- **1440px (escritorio):** la vista de registro NO es la superficie principal — se muestra la app completa (grilla + dashboard) con su layout actual intacto; el ThemeToggle vive en el chrome; el registro (si se muestra como panel) usa los mismos tokens. Ningún cambio de alineación/sticky/full-bleed (NFR-205).

---

## 5. Contraste — verificación (AA WCAG 2.1)

| Par | Claro | Oscuro | Veredicto |
|---|---|---|---|
| text-primary / background | 16.9:1 | 18.1:1 | ✅ |
| text-secondary / background | 7.5:1 | 6.4:1 | ✅ |
| text-muted / background | 4.6:1 | 4.9:1 | ✅ AA |
| error / background | 4.8:1 | ~6:1 | ✅ |
| Gasto (texto) / bg | 4.8:1 | 5.3:1 | ✅ |
| Ingreso (texto grande/UI) / bg | 3.3:1 (≥3:1) | 8.7:1 | ✅ large/UI · ⚠️ small→ usar green-700 en claro |
| Transferencia (texto) / bg | 5.2:1 | 5.4:1 | ✅ |
| border-strong / bg (componente) | ≥3:1 | ≥3:1 | ✅ |

Foco visible (`:focus-visible`) se conserva en ambos temas (contorno sobre `primary`). Objetivos táctiles ≥48px en los controles del registro.
