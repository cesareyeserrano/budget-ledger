## Feature
Rediseño del sistema de color a un esquema **neutro (zinc) + acento dinámico por tipo**, con **temas claro y oscuro** conmutables (default = Sistema), reemplazando el sistema César Augusto steel-blue dark-only. Instala el stack de soporte (next-themes, react-day-picker, @testing-library/react).

## Problem / Why
El producto es dark-only con un acento steel-blue fijo (FR-012). Para llevarlo a nivel profesional se requiere: (1) soporte de **tema claro/oscuro** que siga la preferencia del sistema, (2) una paleta **neutra zinc** que no compita con los colores semánticos, y (3) que el **color del tipo** (Gasto/Ingreso/Transferencia) sea la identidad cromática — el acento es dinámico según el tipo activo. El usuario proporcionó la especificación de color exacta (§4.1–4.3) — es autoritativa; se implementa verbatim.

## Target Users
Usuario principal (dueño de finanzas) en escritorio y móvil; el revisor técnico del portafolio (evalúa un sistema de diseño profesional, accesible AA en ambos temas).

## New Behavior
- The system must soportar **tema claro y oscuro** vía `next-themes` con `attribute="class"`, **default = "system"** (sigue `prefers-color-scheme`); el usuario puede forzar claro/oscuro/sistema desde un **toggle** en la UI (escritorio y móvil).
- The system must aplicar los **tokens de color exactos** de la especificación del usuario (ver Tokens), theme-aware (set claro en `:root`/`.light`, set oscuro en `.dark`), reemplazando los tokens César Augusto. Sin peticiones externas.
- The system must usar el **acento dinámico = color del tipo activo** SOLO donde hay un tipo activo (pantalla de Registro: selector de tipo, foco, chips). En Presupuesto/Dashboard el **chrome es neutro** (`primary` zinc); cada tipo se colorea por fila/sección con su color de tipo.
- The system must colorear cada **tipo** con su color en ambos temas (AA): Gasto rojo, Ingreso verde, **Transferencia azul** (ver §4.3), reemplazando el mapeo actual (transfer = accent-light steel).
- The system must persistir la preferencia de tema (next-themes, clave propia) sin tocar las claves de datos.
- The system must instalar `react-day-picker` y `@testing-library/react` como fundación del stack (su USO —captura por fecha, tests de componente— es de features posteriores; aquí solo se agregan las deps).

## Tokens (especificación autoritativa del usuario — implementar verbatim)

### 4.1 Tema CLARO
background #FFFFFF · surface #F4F4F5 (zinc-100) · primary #18181B (zinc-900) · accent = dinámico (color del tipo activo) · error #DC2626 (red-600) · text-primary #18181B · text-secondary #52525B (zinc-600) · border #E4E4E7 (zinc-200).

### 4.2 Tema OSCURO
background #09090B (zinc-950) · surface #18181B (zinc-900) · primary #FAFAFA (zinc-50) · accent = dinámico (variante dark) · error #F87171 (red-400) · text-primary #FAFAFA · text-secondary #A1A1AA (zinc-400) · border #27272A (zinc-800).

### 4.3 Colores de tipo (un color por tipo, AA en ambos temas)
Gasto: claro #DC2626 (red-600) / oscuro #EF4444 (red-500). Ingreso: claro #16A34A (green-600) / oscuro #22C55E (green-500). Transferencia: claro #2563EB (blue-600) / oscuro #3B82F6 (blue-500).

Derivados a definir en el UX spec (por tema, todos AA): `surface-hover`, `border-strong`/`border-hover`, `text-muted`, y `accent-soft` (tinte del tipo para fondos de selección). La varianza de presupuesto (sobre/bajo) mapea a los colores de tipo/semánticos correspondientes.

## Success Criteria
- Given el SO en modo oscuro, when el usuario abre la app sin preferencia previa, then arranca en oscuro (zinc-950 fondo, §4.2); en SO claro arranca en claro (§4.1).
- Given el toggle de tema, when el usuario elige Claro/Oscuro/Sistema, then el tema cambia y la preferencia persiste al recargar.
- Given Registro con tipo=Gasto, when se observa el acento, then es el rojo de Gasto; al cambiar a Ingreso → verde; a Transferencia → azul.
- Given Presupuesto/Dashboard, when se observa el chrome (tabs/botones/filtros), then es neutro (primary zinc, no un color de tipo).
- Given cualquier texto primario/secundario en ambos temas, then el contraste es ≥4.5:1 (AA).

## Touch Points
- **REEMPLAZA FR-012** (César Augusto, dark-only, steel-blue) → sistema zinc neutro + acento dinámico + light/dark. **MODIFICA FR-008** (color por tipo: transfer steel → azul).
- `src/app/globals.css` (tokens theme-aware), `src/app/layout.tsx` (ThemeProvider), un componente **ThemeToggle**, `src/components/format.ts` (`typeColorVar` → nuevos colores de tipo). Toca superficies que usan `--accent`/`--fg`/etc. (DesktopShell, BudgetGrid, MovementForm, Dashboard, RecentList, ui/*).
- `package.json`: + next-themes, react-day-picker, @testing-library/react.

## Must Not Break (Regression Boundary)
- Toda la funcionalidad existente (registro, grilla, edición inline, borrado bloqueado, reparent, dashboard, persistencia, responsive móvil) sigue igual — solo cambia color/tema.
- FR-011/NFR-003: las claves de datos en localStorage no se tocan; la preferencia de tema es una clave aparte.
- Sin emoji/gradientes; íconos Lucide; motion con prefers-reduced-motion.
- Sin peticiones HTTP externas en runtime (NFR-004): next-themes no hace red; Lexend sigue self-hosted.
- Cero regresión de layout (grilla alineada, sticky, full-bleed) — solo color.
- Contraste AA (≥4.5:1) preservado o mejorado en ambos temas.

## Out of Scope
- **Uso** de react-day-picker (captura por fecha) — feature siguiente `date-capture`; aquí solo la dep.
- Tests de componente con @testing-library — solo la dep aquí.
- Selector de "tipo activo" en Presupuesto/Dashboard — el chrome ahí es neutro.
- Rediseño de layout/tipografía — se conservan (Lexend, full-bleed, espaciado); solo cambia el color.
