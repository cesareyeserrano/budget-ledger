# UX / Design Spec — Feature: ux-consistency

**Archetype:** Data-Dense Dashboard (finanzas). Refinamiento del acabado, NO rediseño: se conservan identidad (zinc + acento por tipo, Inter + DM Mono), estructura y flujos. Este spec formaliza los **tokens exactos** del mockup de dirección aprobado por el usuario.

> Fuente de verdad: la dirección aprobada (mockup visual) + `feature_context/UX_AUDIT.md`. Donde el mockup fija un valor, se transcribe. Los flujos NO cambian (salvo 2 fixes funcionales: mes-en-curso y scroll-con-rueda).

---

## User Flows

Los flujos existentes se **conservan** (paridad, NFR-301). Solo cambian el acabado visual y 2 comportamientos:

### Flujo A — Registrar movimiento (móvil ≤760px / panel escritorio) — SIN cambio funcional
Entry: abrir app (móvil) o botón "Nuevo movimiento" (escritorio). Steps: tipo → monto → categoría (hoja: categoría-hoja o subcategoría desplegable) → fecha/nota → Guardar → overlay ~2s → reset. Error: monto ≤0 (botón disabled), sin categoría ("Elige una categoría."), quota (StorageBanner). Exit: overlay cierra, form limpio. **Refinamiento:** superficies/bordes/radios por token coherentes con el chrome (FR-307); campos con elevación del sistema.

### Flujo B — Presupuesto/Dashboard (escritorio) — SIN cambio funcional
Entry: escritorio >760px. Steps: tabs Resumen/Dashboard; filtro Mes/Año; grilla de 12 meses (edición inline de hojas) / KPIs + charts. **Refinamiento:** cabecera con intención (FR-304), KPIs con componente único (FR-308), cifras en DM Mono (FR-305), profundidad por capas (FR-301). **Cambio funcional:** el filtro arranca en el **mes en curso** (FR-312).

### Flujo C — Cambiar tema — SIN cambio funcional
Toggle Sol/Luna; claro/oscuro/sistema; persiste. **Refinamiento:** ambos temas con profundidad (FR-301).

### Flujo D — Gestionar categorías (escritorio) — refinado + icono
Entry: grilla, acciones de fila (crear/renombrar/borrar/reparent). **Nuevo:** al crear/editar, elegir icono de un **catálogo Lucide amplio** (FR-309) en un overlay shadcn (FR-310). Error path: sin nombre → bloquea; sin icono → fallback consistente.

### Cambios funcionales (los únicos)
- **FR-312 mes en curso:** el `period` por defecto es el mes actual (reloj), no enero/año fijo. El usuario cambia libremente.
- **FR-313 scroll con rueda:** contenedores desplazables (grilla vertical/horizontal, fila de categorías) responden a la rueda; se mapea deltaY→scroll horizontal en filas horizontales; `overscroll-behavior` correcto.

---

## Component Inventory

Estados: default / hover / (loading) / error / empty / disabled. Todos adoptan tokens (superficie/borde/radio/tipo) del sistema de Design Tokens abajo.

| Componente | Estados | Refinamiento (tratamiento) | Heurísticas |
|---|---|---|---|
| **TopBar / marca** | default | Marca discreta (mark 22px `--r-sm` + wordmark); NO doble eyebrow. `--surface` translúcida + blur, hairline inferior. | H4, H8 |
| **PageHeader** | default | Un título (`title`) + año/periodo como pill/segmento (`--r-full`) — no título grande apilado (FR-304). | H2, H8 |
| **Kpi (único, compartido)** | default/hover; empty (—) | `--surface` + hairline + `--shadow-sm`, `--r-md`, padding único; eyebrow (`.eyebrow`) + valor `.tabular` (DM Mono) + pill de variación (up/down semántico). Un solo componente en dashboard y escritorio (FR-308). | H1, H4 |
| **Card / Panel** | default | `--surface` + hairline + `--shadow-sm`, `--r-lg`; popover/panel usa `--surface-2` + `--shadow-md`. | H8 |
| **BudgetGrid** | default/hover fila; edición inline (input) | Encabezado `--sunken` (hundido); filas hairline; hover `color-mix(--fg 3%)`; celdas `.tabular`; acento por tipo en swatch/varianza; **rueda desplaza** (FR-313). Sticky col + meses. Layout INTACTO. | H4, H6 |
| **Dashboard** | default; empty ("todo dentro del presupuesto") | KPIs (componente único), charts Recharts; **tooltip cursor con token theme-aware** (no blanco fijo, FR-301). | H1 |
| **Register (móvil+escritorio)** | ver feature previa | Campos con superficie/borde/radio por token (FR-307); monto `.tabular`; toggle de tipo con contraste AA (FR-311). | H5, H6 |
| **TypeToggle (único)** | default/active | Un solo patrón (se resuelve la duplicación con ToggleGroupItem, FR-308); segmento activo relleno del tipo con **texto AA ≥4.5:1** (FR-311). | H4 |
| **CategoryRow / tiles** | default/selected/expanded/empty | Tiles `--surface` + hairline + `--r-md`; seleccionado = tinte del tipo; scroll horizontal con **rueda** (FR-313). | H6 |
| **IconPicker (nuevo)** | default/hover/empty(sin resultados) | Overlay shadcn (Popover/Dialog); grid de iconos Lucide (≥40) buscable; selección persiste; fallback. | H3, H6 |
| **Select / Dropdown / Popover / Tooltip** | default/open/highlighted | Primitivas shadcn/Radix consistentes (FR-310); **sombra `var(--shadow-lg)`** (no rgba negro fijo, FR-301); sin clase malformada (FR-314). | H1, H4 |
| **Button** | default/hover/disabled | Fuente de texto (Inter, no mono); `--r-sm`; bordes-sobre-relleno + hover de borde/elevación. | H2 |
| **ThemeToggle / StorageBanner / ConfirmOverlay** | como feature previa | Adoptan tokens/escala; sin cambio de comportamiento. | H1, H9 |

---

## Nielsen Compliance

- **H1 Visibilidad:** hover de fila/KPI, tooltip visible en ambos temas, overlays con feedback inmediato.
- **H2 Match mundo real:** títulos con jerarquía clara; año como control reconocible.
- **H3 Control/libertad:** overlays (icon picker/calendario) cierran por Escape/click-fuera.
- **H4 Consistencia:** UNA escala de tipos/radios/eyebrow/cifras; un Kpi y un selector de tipo; primitivas shadcn uniformes.
- **H5 Prevención de error:** guardado deshabilitado con monto inválido (sin cambio).
- **H6 Reconocimiento:** iconos ricos y buscables; labels visibles; afordancias de scroll.
- **H8 Minimalista/estético:** profundidad por capas + cabecera deliberada; se retira el relleno redundante.
- **Contraste (H + a11y):** texto sobre relleno de acento ≥4.5:1 (FR-311); text-primary/secondary ≥4.5:1 en ambos temas.
- **Trade-off:** el sistema evoluciona de "bordes sobre rellenos puro" a "hairline + elevación suave" — se acepta la sombra sutil para ganar profundidad (sin gradientes/glow ni emoji).

---

## Design Tokens

Transcritos del mockup aprobado. Conservan identidad (zinc + acento por tipo). **Se AFINAN** para profundidad y AA (permitido por FR/NFR-302). Fuente única en `globals.css` (`@theme inline` + `:root`/`.dark`).

### Superficies y elevación (el cambio central — profundidad)
| Token | Claro | Oscuro | Razón |
|---|---|---|---|
| `--canvas` (lienzo/bg) | `#F2F3F5` | `#0B0B0E` | Lienzo NO blanco puro → las cards flotan (fin del "ultra-plano") |
| `--surface` (card) | `#FFFFFF` | `#161619` | Nivel base elevado sobre el lienzo |
| `--surface-2` (popover/panel) | `#FFFFFF`+`--shadow-md` | `#1E1E22` | Nivel superior |
| `--sunken` (encabezado grilla/inset) | `#ECEDF0` | `#0E0E11` | Hundido |
| `--border` (hairline) | `#E4E4E7` | `#27272A` | Definición |
| `--border-strong` | `#D4D4D8` | `#35353A` | Énfasis / hover |
| `--primary` (chrome neutro) | `#18181B` | `#FAFAFA` | Identidad zinc |
| `--primary-foreground` (texto sobre relleno) | `#FFFFFF` | `#18181B` | Token nuevo (FR-314) |
| `--text` | `#18181B` | `#FAFAFA` | 16.9:1 / 18.1:1 ✅ |
| `--text-2` | `#52525B` | `#A1A1AA` | 7.5:1 / 6.4:1 ✅ |
| `--text-3` (muted/eyebrow) | `#8A8F98` | `#71717A` | ≥4.5:1 ✅ |

### Sombras (elevación, theme-aware — evoluciona "bordes sobre rellenos")
| Token | Claro | Oscuro |
|---|---|---|
| `--shadow-sm` (cards) | `0 1px 2px rgba(24,24,27,.06)` | `0 1px 2px rgba(0,0,0,.4)` |
| `--shadow-md` (popover/panel) | `0 4px 16px -6px rgba(24,24,27,.12)` | `0 6px 20px -8px rgba(0,0,0,.55)` |
| `--shadow-lg` (modal/select) | `0 14px 36px -10px rgba(24,24,27,.16)` | `0 18px 44px -12px rgba(0,0,0,.65)` |
| `--elev-highlight` (oscuro) | `transparent` | `inset 0 1px 0 rgba(255,255,255,.04)` |

### Acento por tipo (identidad conservada; texto pequeño usa variante AA)
| Tipo | Claro fill | Oscuro fill | Texto pequeño claro (AA) |
|---|---|---|---|
| expense | `#DC2626` | `#EF4444` | `#DC2626` (4.8:1) |
| income | `#16A34A` | `#22C55E` | `#15803D` (green-700, 5.0:1) |
| transfer | `#2563EB` | `#3B82F6` | `#2563EB` (5.2:1) |
| Semánticos: `--success`/`--warning`/`--error` (verde/ámbar/rojo), `--warning` claro `#D97706`. |

**Texto sobre relleno de acento (FR-311):** el label del segmento activo usa `--primary-foreground` (#FFFFFF) con peso ≥600; para Ingreso, el relleno del estado activo se oscurece a `#15803D` (green-700) SOLO en ese rol para alcanzar ≥4.5:1 con texto blanco. Gasto/Transferencia con blanco ya ≥4.5:1.

### Radios (finos y consistentes)
`--radius-xs: 6px` · `--radius-sm: 8px` · `--radius-md: 10px` · `--radius-lg: 14px` · `--radius-full: 9999px`. Todos expuestos en `@theme`. Uso: chips/inputs → xs/sm; botones/celdas → sm; cards/campos → md; paneles/modales → lg; pills/toggle → full. **Sin esquinas cuadradas ni literales rounded-2xl.**

### Tipografía (Inter + DM Mono; escala con roles)
| Rol | Clase | Tamaño / peso | Uso |
|---|---|---|---|
| display | `.display` | 1.75rem / 600 | valor KPI grande, monto |
| title | `.title` | 1.25rem / 600 | título de pantalla |
| title-sm | `.title-sm` | 1.0625rem / 600 | títulos de sección/panel |
| body | — | 0.875rem / 400–500 | texto general, labels de campo |
| label | `.label` | 0.8125rem / 500 | controles |
| caption | `.caption` | 0.75rem / 400 | meta/ayuda |
| eyebrow | `.eyebrow` | 0.6875rem / 600, uppercase, tracking .09em, `--text-3` | etiquetas de sección (única) |
| cifras | `.tabular` | DM Mono, `tabular-nums` | TODA cifra monetaria (FR-305) |

Line-height 1.5 en texto. Pesos estándar (sin `font-[450]`). Fuentes self-hosted (next/font) — sin red.

### Espaciado
Escala 4px (`gap`/`padding` en múltiplos: 4/8/12/16/20/24). Se eliminan mágicos `[9px]/[7px]/[5px]/[18px]/[26px]`. El registro es dueño de su padding horizontal (no doble padding anidado).

### Responsive
375 / 768 / 1440. Móvil ≤760px = solo registro (parent FR-010). Sin scroll horizontal del body; contenedores desbordantes con overflow propio + **rueda** (FR-313). Contraste AA y foco visible en ambos temas.
