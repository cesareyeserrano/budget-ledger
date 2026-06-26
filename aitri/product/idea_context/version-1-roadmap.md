# Version 1 — Roadmap (REENCUADRE desktop-primario, 2026-06-24)

> ⚠️ REENCUADRE IMPORTANTE (confirmado por el usuario 2026-06-24): **Ledger Version 1 es
> principalmente DESKTOP, optimizado para mobile** (no mobile-first como asumía el plan
> previo, heredado de la Fase 1 del root). **El HOME es el módulo de PRESUPUESTO ampliado**
> — la grilla desktop "Presupuesto 2026" del HTML/mockups —, y en **mobile se reduce**.
> **Categorías NO es un módulo aparte: es parte del presupuesto** (el árbol del panel
> izquierdo de la grilla; gestión inline en desktop). El registro/captura es panel lateral
> en desktop y pantalla primaria en mobile.

## Documentos fuente (en idea_context/)
- `Ledger - Functional Spec.md` — spec funcional (concepts, business rules, D-1…D-8).
- `Ledger (offline).html` + `mockup-*.png` — el prototipo desktop = el HOME (grilla presupuesto, transferencias, panel "Nuevo movimiento", dashboard). FUENTE VISUAL.
- `parte2-presupuesto-notas-rescatadas.md` — notas de dominio previas.

## Lo que YA existe (root, aprobado) y cómo se reubica con el reencuadre
- Captura de movimiento (FR-002…008, mobile) → en desktop pasa a panel lateral "Nuevo movimiento"; en mobile sigue siendo pantalla primaria (reducida).
- Catálogo de categorías FIJO (`src/domain/categories.ts`) → se reemplaza por la jerarquía gestionable (panel izquierdo de la grilla).
- `/presupuestos` simple (FR-013) → reemplazado por la grilla de presupuesto (el núcleo/home).
- Backend Postgres + Auth.js (feature `backend`, 5/5) → se reaprovecha y se extiende (el backend se ajusta al requerimiento).
- Tipos fijos (Gasto/Ingreso/Transferencia), signo y color (`domain/sign.ts`, `lib/tokens.ts`) → se mantienen (D-1 Opción A).
- Pantalla Lista (`/movimientos`, FR-008) → su función (ver movimientos) se cubre con recientes en captura + ejecución en la grilla; se retira cuando corresponda (no en una feature de nav aparte).

## Diseño: el spec manda, el código es implementación fiel
Reutilizar el sistema de diseño YA implementado en `src/` (tokens de globals.css,
`--type-color` de lib/tokens.ts, Lucide 20×20, motion ≤200ms/130ms, tap ≥48px, shadcn/ui).
No inventar. Si el código diverge del spec, se actualiza el spec (regla de sincronía).
HTML/mockups = referencia VISUAL del objetivo, no fuente de patrones.

## Partición revisada (desktop-primario)

### F1 — `category-hierarchy` (RE-SCOPEADA → fundación de datos, sin pantalla mobile)
El **modelo de jerarquía + operaciones** (cimiento de los roll-ups del presupuesto).
REUTILIZA lo ya especificado: CRUD Grupo/Categoría/Subcategoría, nodo "Sin asignar" +
re-asignación (incl. drag-and-drop), migración del catálogo fijo a seed editable,
persistencia (extensión backend), y subtotales/roll-up de montos por nodo/tipo.
- **CAMBIA respecto al plan previo:** se SUELTA la pantalla mobile dedicada (FR-029) y el
  acordeón-como-pantalla (FR-028); la jerarquía se VE y se gestiona como **panel izquierdo
  de la grilla desktop** (entregado en F2). F1 queda como capa de datos/lógica (como lo fue
  `backend`), sin UX propia → sin fase UX.
- **Reusa FRs:** FR-025/026/027 (CRUD), FR-031/032 (Sin asignar + DnD), FR-033 (migración), FR-034 (persistencia), FR-035 (roll-up). Se retiran FR-028/029 (UX mobile). FR-030 (integración registro) se mueve a la captura de F2/F3.
- Decisiones firmes: D-1 Opción A (tipos fijos); D-2 "Sin asignar"; DnD reasignar.

### F2 — `budget` (NÚCLEO desktop = el HOME) — el espinazo de Version 1
La **grilla de presupuesto desktop** como pantalla principal (mockups):
- Panel izquierdo: **árbol de categorías** (la jerarquía de F1) con CRUD inline + acordeón + íconos + "Sin asignar".
- Grilla: **12 columnas de mes × (Presupuestado/Ejecutado)**, columna de categoría sticky, scroll horizontal, edición inline, **distribución proporcional** al editar un padre, **roll-ups** (subcat→cat→grupo→tipo), **cards de resumen** (Presupuesto/Ejecutado/Disponible), toggle **Resumen/Dashboard**.
- Panel lateral **"Nuevo movimiento"** (captura en desktop; Ejecutado = suma de movimientos).
- Reemplaza FR-013. Resuelve D-3 (editar Ejecutado), D-4 (distribución), D-5 (linkage), **D-6 (transferencias/cuentas/doble-disponible/saldo rodante — resolver en discovery de F2)**.
- ⚠️ DECISIÓN ABIERTA D-6 (acordado: discovery de F2): spec trata transfer como tipo neutral; las notas rescatadas tienen modelo rico (cuentas, doble disponible, saldo rodante). Resolver con esfuerzo/valor.
- ⚠️ DECISIÓN DIFERIDA A F2 — comportamiento del drop al arrastrar un movimiento de "Sin asignar": F1 fija el modelo "solo hojas guardan montos" (default seguro, barato de relajar). F2 decide el UX del drop sobre un PADRE: (a) solo resaltar hojas válidas, (b) abrir selector de hoja, o (c) permitir que una categoría-con-subcategorías tenga bucket propio (opción B — relaja el invariante de F1 + ajusta roll-up). No bloquea F1.

### F3 — `mobile-reduced` (la vista reducida de mobile)
La versión **reducida** para mobile del presupuesto (mes en curso + selector de mes) y la
**captura** como pantalla primaria mobile. Aquí viven las decisiones de **shell/navegación
mobile** (cómo se navega en la versión reducida) — propiamente scopeadas a mobile-como-reducida.
- Depende de F2 (el modelo de presupuesto y la jerarquía).

### F4 — `dashboard` (indicadores)
El toggle **"Dashboard"** del módulo (mockup 4): 7 indicadores mínimos (Ingresos, Gastos,
Balance neto, Tasa de ahorro, Adherencia, Top categorías, Sobre-presupuesto) + tendencia
mensual. Respeta filtro Mes/Año. Desktop y su reducción mobile. Depende de F2.

## Features descartadas por el reencuadre
- **`app-shell`** (nav mobile hamburguesa-only, home=Registrar): **ARCHIVADA/eliminada**.
  Premisa equivocada (mobile-first, home=Registrar). El shell desktop es el toggle
  Resumen/Dashboard + paneles de la grilla (F2); el shell mobile vive en F3. El "retiro de
  Lista" + recientes en captura se reabsorben en F2/F3.

## Fuera de Version 1 → backlog
D-7 (drag-to-reorder de la ESTRUCTURA de la jerarquía), multi-año, multi-moneda, export, indicadores extra.

## ⚠️ Alineación del backend (se mantiene)
El backend se EXTIENDE para servir el requerimiento (schema jerarquía + budgeted/actual por
mes), nunca al revés. Cada feature alinea su persistencia con la fundación `backend` por
consistencia, no como límite de alcance.

## Estado
- [~] F1 `category-hierarchy` — RE-SCOPEAR: conservar modelo (FR-025/026/027/031/032/033/034/035), retirar FR-028/029 (UX mobile), mover FR-030 a captura. Quitar su 01_UX_SPEC.md. Re-aprobar Phase 1.
- [ ] F2 `budget` — núcleo desktop (home). El grande.
- [ ] F3 `mobile-reduced` — vista reducida + nav mobile.
- [ ] F4 `dashboard` — indicadores.
- [x] `app-shell` — DESCARTADA (eliminar carpeta).
- [x] `backend` — 5/5 (se reaprovecha/extiende).
