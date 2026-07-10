# T-Ledger — Style & UX Consistency Audit (fuente de esta feature)

> Auditoría independiente de la app tras la migración a zinc + acento dinámico. Los tokens están
> bien; el problema es que los componentes los ignoran. Referencias `file:line` a `src/…`.

## Hallazgos por severidad

### HIGH — rompe consistencia o tema
- **H1. Tooltip con `rgba(255,255,255,0.03)` hardcodeado** — `Dashboard.tsx:42` `<Tooltip cursor={{fill:...}}>`. Invisible en tema claro. → usar token (`color-mix(in srgb, var(--fg) 4%, transparent)`).
- **H2. Sombra oscura hardcodeada** — `ui/select.tsx:40` `shadow-[0_8px_30px_rgba(0,0,0,0.5)]` fija el valor oscuro; muy pesada en claro. → `boxShadow: var(--shadow-lg)` (theme-aware, como BudgetGrid/Toaster ya hacen).
- **H3. El "eyebrow" (etiqueta mayúscula) está hecho de ~5 formas** — `DesktopShell.tsx:43` (0.62rem/0.18em/bold), `MobileShell.tsx:14` (0.58rem/0.18em/bold), `DesktopShell.tsx:112` (0.58rem/0.14em/sin bold), `RecentList.tsx:16` (0.58rem/0.12em), KPI `DesktopShell.tsx:150`+`Dashboard.tsx:88` (0.6rem/0.1em), `BudgetGrid.tsx:121` (0.62rem/0.06em/semibold/fg-secondary). 3 tamaños × 5 tracking × 3 pesos × 2 colores. → una sola clase `.eyebrow`.
- **H4. Las cifras usan 3 fuentes** — el spec manda DM Mono (`.tabular`) para montos. Registro/overlay ✅ `.tabular`; grilla+KPI escritorio solo `tabular-nums` (Inter) `BudgetGrid.tsx:340`,`DesktopShell.tsx:151`; KPI dashboard ni eso `Dashboard.tsx:89`; RecentList Inter plano `RecentList.tsx:37`. → `.tabular` en toda cifra.
- **H5. Los campos del registro contradicen "bordes sobre rellenos"** — el chrome usa borde+`rounded-[--radius-sm]`; el registro usa rellenos sin borde: `DateTimeField.tsx:65`, `NoteField.tsx:29`, `TypeToggle.tsx:27`. Lee como otro lenguaje visual. → dar borde a los campos del registro, o documentar variante de superficie rellena.

### MEDIUM — deriva notable
- **M1. Sin escala de tipos: 17 tamaños `text-[…rem]`** (0.58…2). Clusters 0.72–0.85 = "un tamaño" fragmentado en 6; 0.58–0.66 = "eyebrow/caption" en 5. → colapsar a 6 pasos (usar `text-xs/sm/base/lg`).
- **M2. `Kpi` duplicado y divergente** — `DesktopShell.tsx:147` y `Dashboard.tsx:85` definen su propio Kpi (paddings distintos, uno con tabular-nums y otro no). → un `Kpi`/`Card` compartido.
- **M3. `ToggleGroupItem` (hecho para el selector de tipo) está bypasseado** — `register/TypeToggle.tsx` reimplementa el selector con otro estado activo (relleno sólido + blanco + rounded-full) vs el componente (texto de tipo + tinte + borde + radius-sm). Dos tratamientos contradictorios; el componente quedó muerto. → unificar.
- **M4. Dos convenciones de radios** — chrome usa tokens `rounded-[--radius-sm/md]`; registro usa literales `rounded-full/2xl/xl`. → estandarizar en tokens; exponer `--radius-full` en `@theme`.
- **M5. Contraste blanco-sobre-relleno de tipo (verde)** — `TypeToggle.tsx:40` texto blanco 14px sobre `--type-income` #16a34a ≈ 3.4:1 (<4.5 AA). → subir peso/tamaño o oscurecer el verde en ese rol.
- **M6. Espaciados fuera de la escala 4px** — `py-[9px]`, `mb-[7px]`, `mt-[5px]`, `px-[18px]`, `pt-[18px]`, `pb-[26px]`; MobileShell padea `px-[18px]` mientras el Register interno padea `px-4` (padding anidado desalineado). → snap a la escala 4px; el registro dueño de su padding horizontal.
- **M7. Tamaños de título inconsistentes** — `DesktopShell.tsx:44` 1.4rem, panel 1.15rem, móvil 1.15rem, todos con `font-[450]` (peso no estándar). → dos tokens de título + peso real.

### LOW — nitpicks
- **L1. Variante Tailwind rota (dead class)** — `ui/select.tsx:59` `data-[highlighted:bg-elevated]` (malformada) junto a la correcta. → quitar la rota.
- **L2. `font-[450]` peso no estándar** — `DesktopShell.tsx:44,113`, `MobileShell.tsx:15`. → `font-normal`/`font-medium`.
- **L3. Transferencia pierde su identidad azul en la grilla** — `BudgetGrid.tsx:36` `ejecColor` devuelve `--accent-light` (gris) para transfer. Confirmar intención (¿neutro fuera del registro?).
- **L4. Literales `white`/`#FFFFFF` para texto sobre relleno** — `SaveButton.tsx:26`, `ConfirmOverlay.tsx:30`, `TypeToggle.tsx:40,45`. → token `--primary-foreground`/`--on-accent`.
- **L5. Gap label→control inconsistente en el registro** — `DateTimeField.tsx:57`/`NoteField.tsx:18` `gap-1.5` vs Categoría `Register.tsx:92` `gap-3`. → unificar.

## Escala recomendada (derivada de lo más común)
- **Tipos (6):** eyebrow `.eyebrow` (0.6rem, 0.1em, semibold, uppercase, fg-muted) · caption `text-xs` · body/label `text-sm` · grid-dense 0.75rem · title-sm `text-lg` (1.125rem) · title/kpi 1.375rem.
- **Eyebrow:** siempre UPPERCASE + `.eyebrow` + fg-muted.
- **Cifras:** siempre `.tabular` (DM Mono) — nunca `tabular-nums` pelado ni Inter.
- **Radios:** tokens `--radius-sm/md/lg/full` en todos lados; exponer `--radius-full` en `@theme`.
- **Espaciado:** escala 4px; eliminar `[9px]/[7px]/[5px]/[18px]/[26px]`.

## Quick wins vs refactors
- **Quick wins:** H1, H2, L1, L2, H4 (dashboard/recientes), agregar `.eyebrow` + `--radius-full` al `@theme`.
- **Refactors:** H3 (eyebrow global), M1 (escala), H5 (bordes en registro), M2 (Kpi/Card), M3 (selector de tipo), M4/M6 (radios+espaciado), M5 (contraste verde).

## Alcance adicional pedido por el usuario (fuera del audit)
- **Selector de iconos rico** para categorías/subcategorías (Lucide completo) en vez del set fijo (~13 iconos en `NodeIcon`/`CATEGORY_ICONS`).
- **Adopción de más componentes shadcn/ui** (dialog, popover, dropdown, tooltip…) de forma consistente, reemplazando ad-hoc.
- "Y todo lo que aplique y no tenga en mi radar" — latitud para mejoras de consistencia adicionales.
