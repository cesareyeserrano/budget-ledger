## Feature
Refactor de **consistencia de UX/UI y sistema de diseño** en TODA la app T-Ledger, a partir de la
auditoría independiente (`feature_context/UX_AUDIT.md`, contexto designado/autoritativo). Unifica cómo
los componentes consumen el sistema de tokens zinc — sin cambiar funcionalidad.

## Problem / Why
Tras la migración a zinc + acento dinámico (feature stack-upgrade-theme) los tokens están bien
definidos pero los componentes los ignoran: **17 tamaños de fuente ad-hoc sin escala**, el "eyebrow"
implementado de ~5 formas, **las cifras usan 3 fuentes distintas** (el spec manda DM Mono para montos),
el registro contradice el principio "bordes sobre rellenos" del resto de la app, componentes
duplicados/divergentes (Kpi, selector de tipo), dos convenciones de radios, espaciados fuera de la
escala 4px, y **2 bugs reales de tema** (tooltip blanco hardcodeado y sombra negra fija que se ven mal
en claro). Resultado: un "reguero" visual inconsistente entre móvil/escritorio y entre el registro y la
grilla/dashboard. El usuario (dueño/revisor de portafolio) percibe la app como poco pulida.

## Target Users
Los mismos del proyecto: el dueño de sus finanzas (usa la app a diario) y el revisor técnico del
portafolio (evalúa un sistema de diseño profesional y coherente). No desbloquea usuarios nuevos.

## New Behavior
- The system must estandarizar UNA escala de diseño: 6 tamaños de texto, una clase `.eyebrow`,
  `.tabular` (DM Mono) en TODA cifra, radios por token (`--radius-*`, exponer `--radius-full`),
  espaciado en la escala 4px — aplicada en toda la app.
- The system must corregir los 2 bugs de tema: el cursor del tooltip del dashboard usa un token
  theme-aware (no `rgba(255,255,255,…)`); la sombra del Select usa `var(--shadow-lg)` (no un rgba negro fijo).
- The system must unificar el "eyebrow" (etiqueta mayúscula) en una sola clase/estilo en todas las superficies.
- The system must renderizar TODA cifra monetaria en DM Mono (`.tabular`): KPIs, celdas de grilla,
  lista de recientes y registro.
- The system must alinear los campos del registro con el lenguaje visual del resto de la app
  ("bordes sobre rellenos") o exponer una variante de superficie documentada y consistente.
- The system must consolidar los componentes duplicados/divergentes: un `Kpi`/`Card` compartido y un
  único patrón de selector de tipo (adoptar o retirar `ToggleGroupItem`).
- The system must ofrecer un selector de iconos rico (catálogo Lucide amplio) para categorías y
  subcategorías, en vez del set fijo de ~13 iconos actual.
- The system must adoptar componentes shadcn/ui (dialog, popover, dropdown, tooltip…) de forma
  consistente donde hoy hay implementaciones ad-hoc.
- The system must resolver el contraste blanco-sobre-relleno del tipo Ingreso (≥AA) en el toggle activo.

## Success Criteria
- Given cualquier superficie (móvil/escritorio, claro/oscuro), when se inspecciona, then usa la escala
  de tipos única, el `.eyebrow` único, cifras en DM Mono, radios y espaciado por token — sin valores ad-hoc.
- Given el dashboard en tema claro, when se muestra el tooltip, then su cursor es visible (token, no blanco fijo).
- Given el Select en tema claro, when se abre, then su sombra usa `var(--shadow-lg)` (no la variante oscura fija).
- Given la creación/edición de una categoría, when se elige su icono, then hay un catálogo amplio de iconos (Lucide).
- Given el flujo end-to-end (registrar → categorías → presupuesto → dashboard) en ambos temas, when se
  recorre, then no hay regresión funcional ni de layout y el contraste es ≥AA.

## Touch Points
MODIFICA (estilo/consumo de tokens, sin cambiar lógica): `src/app/globals.css` (escala, `.eyebrow`,
`--radius-full`, `--primary-foreground`), `src/components/DesktopShell.tsx`, `MobileShell.tsx`,
`BudgetGrid.tsx`, `Dashboard.tsx`, `RecentList.tsx`, `NodeIcon.tsx`, `format.ts`,
`src/components/ui/*` (button, select, tabs, toggle-group), `src/components/register/*`.
AGREGA: componente selector de iconos; posibles componentes shadcn/ui nuevos (Kpi/Card/Dialog/Popover
compartidos). Supersede parcialmente el estilo de FR-012/FR-213 (unifica su aplicación; no re-decide la paleta).

## Must Not Break (Regression Boundary)
- Toda la funcionalidad existente sigue idéntica: registro (guardar → Ejecutado + roll-ups), grilla de
  12 meses + edición inline, borrado/'Sin asignar', reparent drag-drop, dashboard + filtro Mes/Año,
  persistencia localStorage, conmutación responsive móvil/escritorio.
- El tema claro/oscuro/sistema y los tokens de color aprobados (paleta zinc, colores de tipo) se conservan.
- Accesibilidad AA (≥4.5:1) preservada o mejorada en ambos temas; objetivos táctiles ≥48px.
- Sin peticiones HTTP externas en runtime; fuentes self-hosted.
- La suite completa existente (unit + integration + e2e del root y de las features previas) sigue en verde.

## Out of Scope
- Cambiar funcionalidad, el modelo de datos, o el flujo/layout de las pantallas (grilla de 12 meses,
  dashboard, flujo de registro conservan su estructura — es consistencia de estilo + componentes).
- Re-abrir las decisiones de paleta/color ya aprobadas (solo se unifica su aplicación).
- Cambios en el pipeline de despliegue (Docker/Next) o migración a export estático.
- Auth/login, multi-ruta/TabBar (siguen fuera, como en el resto del proyecto v1).
