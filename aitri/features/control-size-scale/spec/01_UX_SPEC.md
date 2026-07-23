# UX / Design Spec — Feature control-size-scale

Preview: not generated — la feature NO introduce ninguna superficie, pantalla ni componente visual nuevo. Solo unifica la ALTURA de controles ya existentes a una escala de 3 tokens. No hay look & feel nuevo que previsualizar; la verificación es por medición de altura de los controles en la app corriendo (32/40/48px) y por la no-regresión de las suites existentes.

**Archetype: PRO-TECH/DASHBOARD (heredado).** Incremento de design system sobre la UI existente del Ledger. NO introduce token de color, tipografía o radio nuevo — esos ya los unificó la feature ux-consistency y aquí quedan intactos. Lo único nuevo es una **escala canónica de ALTURA de control** (dimensión que ningún FR cubría) y el re-mapeo de cada control a ella.

## Design Tokens

**Color, tipografía y radios: SIN CAMBIOS.** Hereda íntegro el sistema César Augusto + Lexend (`--bg/--surface/--accent/--fg/--error`, escala tipográfica y radios de ux-consistency).

**NUEVO — escala de altura de control (única fuente de verdad, FR-801):**

| Token | Altura | Padding vertical equivalente |
|---|---|---|
| `--control-sm` | **32px** | (reemplaza h-8 / py-1.5 de tabs) |
| `--control-md` | **40px** | (reemplaza h-9 / py-2.5) |
| `--control-lg` | **48px** | (objetivo táctil; ya vigente en registro) |

Se retiran las alturas 30, 36 y 44px. Contraste: sin cambios (no se toca color) — todos los roles siguen ≥4.5:1 (heredado, confirmado por ux-consistency).

## 1. Superficies afectadas (todas MODIFICADAS, ninguna nueva)

Mapeo de cada control a su token (FR-802):

| Control | Token | Altura | Antes |
|---|---|---|---|
| TabsTrigger (Resumen/Dashboard, Mes/Año) | sm | 32px | ~30px |
| icon-button (🗑, +, editar, etc.) | sm | 32px | 32px (igual) |
| Button `sm` | sm | 32px | 32px (igual) |
| Button `default` | md | 40px | 36px |
| `input` (editor de celda, nombre) | md | 40px | ~40px |
| SelectTrigger (Mes, tema) | md | 40px | ~40px |
| ThemeToggle | md | 40px | 44px |
| Botón **Guardar** (acción primaria) | lg | 48px | 48px (igual) |
| TypeToggle (Ingreso/Gasto/Transf.) | lg | 48px | 48px (igual) |
| Tiles del registro (destinos) | lg | 48px | 48px (igual) |
| date-field (registro móvil) | lg | 48px | 48px (igual) |

Cambios de altura reales (menores, solo 3 controles): tabs 30→32, Button default 36→40, ThemeToggle 44→40. Todo lo demás ya cae en la escala. Ningún cambio de ancho, color, tipografía, radio o comportamiento.

## 2. Estados de los componentes

**SIN CAMBIOS.** La feature no toca los estados (default / hover / focus / disabled / loading) de ningún control — solo su altura. El foco visible, los estados hover y disabled heredan su tratamiento actual. En particular, los controles del registro conservan su indicador de foco y su altura ≥48px (NFR-801).

## 3. Responsive
- **Escritorio (>760px):** grilla + encabezado + KPIs con los controles re-mapeados a la escala.
- **Móvil (375px):** registro de captura; sus controles (TypeToggle, tiles, date-field, Guardar) permanecen en **lg = 48px** — el objetivo táctil mínimo (WCAG 2.5.5) NO baja (NFR-801, TC-UXC-353e).
- Breakpoints de verificación: 375 (registro móvil, táctil ≥48) · 768 · 1440 (grilla/encabezado).

## Nielsen Compliance
- **H4 (consistencia y estándares):** ES el objetivo de la feature — controles del mismo tipo comparten altura; se elimina la deriva de 6 valores a 3 tokens.
- **H8 (diseño estético y minimalista):** una escala reducida y deliberada se lee más ordenada que 6 alturas arbitrarias.
- **Accesibilidad (WCAG 2.5.5 Target Size):** el mínimo táctil de 48px en el registro se conserva; ningún control interactivo táctil baja de 48px donde ya lo cumplía.
- Sin violaciones nuevas: la feature no cambia flujos, textos ni affordances — solo altura.

## User Flows
No hay flujos nuevos ni modificados. Los flujos existentes (registrar, editar celda, drag-drop, cambiar tema, filtrar Mes/Año) se ejecutan idénticos; solo cambia la altura de los controles que participan. Verificación: las suites e2e existentes de esos flujos siguen verdes (NFR-802).

## Component Inventory

| Componente | Ubicación | Cambio | FR | Notas |
|---|---|---|---|---|
| Escala de altura (tokens) | globals.css | ADITIVO (--control-sm/-md/-lg) | FR-801 | única fuente de verdad de altura |
| Button | ui/button.tsx | modificado (variantes → sm/md) | FR-802 | h-8→sm, h-9→md |
| Tabs / TabsTrigger | ui/tabs.tsx | modificado (→ sm) | FR-802 | py-1.5 → 32px |
| Select / SelectTrigger | ui/select.tsx | modificado (→ md) | FR-802 | → 40px |
| ThemeToggle | components/* | modificado (→ md) | FR-802 | 44 → 40px |
| TypeToggle / tiles / date-field / Guardar | components/register/* | verificado (ya lg 48) | FR-802/NFR-801 | conserva 48px táctil |

## Assets provistos
Ninguno. El diseño se deriva por transcripción de los patrones ya aprobados (componentes de control existentes) + la escala de 3 pasos confirmada por el usuario. Cero UI inventada.
