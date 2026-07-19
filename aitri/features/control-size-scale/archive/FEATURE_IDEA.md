## Feature
Establecer una **escala canónica de tamaños de control** (base de diseño atómico) y mapear todos los controles interactivos a ella. Escala confirmada con el usuario, 3 pasos:

| Token | Altura | Usos |
|---|---|---|
| **sm** | 32px | icon-button, TabsTrigger, Button sm |
| **md** | 40px | input, SelectTrigger, Button default, ThemeToggle |
| **lg** | 48px | acción primaria (Guardar), TypeToggle, tiles del registro, date-field |

Hoy NO existe una escala de TAMAÑO: conviven 6 alturas para el mismo tipo de elemento.

## Problem / Why
Deriva de tamaño no gobernada por ningún FR. Alturas actuales (verificadas en el código):
TabsTrigger ~30px (`tabs.tsx` py-1.5), Button sm/icon 32px (`button.tsx` h-8), Button default 36px (`button.tsx` h-9), SelectTrigger ~40px (`select.tsx` py-1.5), ThemeToggle 44px, TypeToggle/date-field/Guardar/tiles 48px. Elementos del mismo tipo se ven más grandes que otros. Es la misma clase de deriva que el audit encontró en tipografía (17 tamaños) y radios (dos convenciones) y que la feature ux-consistency corrigió en esas dimensiones — pero en la dimensión TAMAÑO, que quedó sin cubrir.

## Target Users
Usuario único de v1 (dueño de sus finanzas, escritorio + registro móvil). No cambia ninguna función; percibe una interfaz más consistente y ordenada.

## New Behavior
- Se define una escala de 3 tokens de altura (sm 32 / md 40 / lg 48) como única fuente de verdad para la altura de un control — un token CSS o una utilidad compartida, no valores sueltos por componente.
- Cada control se re-mapea a su token: tabs y icon-buttons → sm; botones estándar, inputs, selects y ThemeToggle → md; acción primaria (Guardar), TypeToggle, tiles del registro y date-field → lg.
- Cambios de altura resultantes (menores): tabs 30→32, Button default 36→40, ThemeToggle 44→40. Todo lo demás ya cae en la escala.
- Solo cambia la ALTURA/padding vertical del control; el resto (color, tipografía, radio, comportamiento) no se toca.

## Success Criteria
- Given cualquier control interactivo de la app, When se inspecciona su altura efectiva, Then pertenece a {32, 40, 48}px — 0 alturas ad-hoc fuera de la escala.
- Given los controles del registro (móvil y captura), When se miden, Then conservan ≥48px (objetivo táctil WCAG 2.5.5 / el test existente TC-UXC-353e no se rompe).
- Given la app tras el cambio, Then ninguna prueba funcional ni e2e existente falla (el cambio es puramente de tamaño).
- Given los 6 valores previos, Then quedan colapsados a 3 tokens y documentados en un solo lugar.

## Touch Points
MODIFICA:
- `src/app/globals.css` — (posible) tokens de altura de control (--control-sm/-md/-lg) si se opta por tokens CSS.
- `src/components/ui/button.tsx` — variantes sm/default/lg → sm/md/lg de la escala (h-8/h-9 → escala).
- `src/components/ui/select.tsx`, `tabs.tsx` — SelectTrigger → md; TabsTrigger → sm.
- `src/components/ui/*` y controles compuestos: ThemeToggle → md; TypeToggle, date-field, tiles del registro, botón Guardar → lg.
- FRs existentes tocados (no cambia su semántica, solo el sistema de tamaño): los de la grilla/registro/tema que rendericen estos controles.

ADITIVO:
- Un punto único que define la escala (token CSS o mapa de tamaños), del que dependen todos los controles.

## Must Not Break (Regression Boundary)
- **TC-UXC-353e** (ux-consistency): los controles del registro siguen ≥48px con foco visible — la escala mantiene lg=48 para ellos.
- Ningún cambio de comportamiento funcional: registrar, editar celdas, drag-drop, tema, filtros Mes/Año — todo igual.
- El código de estado (budget-state-color, FR-401/403), el reparent/degradar y la persistencia no se tocan.
- Accesibilidad: el objetivo táctil mínimo (48px) se conserva donde ya existía.

## Out of Scope
- Color, tipografía y radios: ya los unificó la feature ux-consistency; aquí NO se re-abren.
- Anchos de control (solo se gobierna la ALTURA/padding vertical en v1).
- Rediseño visual o de layout más allá de la altura de los controles.
- Introducir una librería de design tokens o un sistema de theming nuevo.
